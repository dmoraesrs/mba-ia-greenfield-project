import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import storageConfig from '../config/storage.config';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { generateSampleVideo } from '../test/fixtures';
import { emptyTestBucket, testStorageConfig } from '../test/test-infra';
import { FfmpegService } from './ffmpeg.service';
import { InvalidVideoFileError, MediaToolError } from './media.errors';
import { MediaModule } from './media.module';
import { parseProbeOutput } from './probe-parser';

describe('FfmpegService (integration, real binaries)', () => {
  let module: TestingModule;
  let ffmpeg: FfmpegService;
  let storage: StorageService;
  let workDir: string;

  async function uploadAndSign(path: string, contentType: string) {
    const key = `videos/${randomUUID()}/original`;
    await storage.putObject(key, await readFile(path), contentType);
    return storage.signGetObject(key, { expiresIn: 300, internal: true });
  }

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
        MediaModule,
      ],
    })
      .overrideProvider(storageConfig.KEY)
      .useValue(testStorageConfig())
      .compile();
    await module.init();
    ffmpeg = module.get(FfmpegService);
    storage = module.get(StorageService);
    workDir = await mkdtemp(join(tmpdir(), 'ffmpeg-spec-'));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
    await emptyTestBucket();
    await module.close();
  });

  describe('probe', () => {
    it('should extract duration and metadata of a remote H.264/AAC video', async () => {
      const path = join(workDir, 'with-audio.mp4');
      await generateSampleVideo(path, { seconds: 2, withAudio: true });
      const url = await uploadAndSign(path, 'video/mp4');

      const { durationSeconds, metadata } = parseProbeOutput(
        await ffmpeg.probe(url),
      );

      expect(durationSeconds).toBeGreaterThanOrEqual(1.9);
      expect(durationSeconds).toBeLessThanOrEqual(2.1);
      expect(metadata).toMatchObject({
        width: 320,
        height: 240,
        video_codec: 'h264',
        audio_codec: 'aac',
        frame_rate: 25,
        size_bytes: (await stat(path)).size,
      });
      expect(metadata.bitrate).toBeGreaterThan(0);
    });

    it('should report no audio codec for a video without an audio track', async () => {
      const path = join(workDir, 'no-audio.mp4');
      await generateSampleVideo(path, { seconds: 2, withAudio: false });
      const url = await uploadAndSign(path, 'video/mp4');

      const { metadata } = parseProbeOutput(await ffmpeg.probe(url));

      expect(metadata.audio_codec).toBeNull();
    });

    it('should throw InvalidVideoFileError for a text file disguised as .mp4', async () => {
      const path = join(workDir, 'fake.mp4');
      await writeFile(path, 'this is definitely not a video\n'.repeat(100));
      const url = await uploadAndSign(path, 'video/mp4');

      await expect(
        ffmpeg.probe(url).then((json) => parseProbeOutput(json)),
      ).rejects.toBeInstanceOf(InvalidVideoFileError);
    });

    it('should throw MediaToolError when the input cannot be reached', async () => {
      await expect(
        ffmpeg.probe('http://rustfs:9/unreachable'),
      ).rejects.toBeInstanceOf(MediaToolError);
    });
  });

  describe('extractFrame', () => {
    it('should return a non-empty 640px wide JPEG', async () => {
      const path = join(workDir, 'frame-source.mp4');
      await generateSampleVideo(path, { seconds: 2, withAudio: false });
      const url = await uploadAndSign(path, 'video/mp4');

      const jpeg = await ffmpeg.extractFrame(url, 1);

      expect(jpeg.length).toBeGreaterThan(0);
      expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      const jpegPath = join(workDir, 'frame.jpg');
      await writeFile(jpegPath, jpeg);
      const probe = JSON.parse(await ffmpeg.probe(jpegPath)) as {
        streams: { width: number }[];
      };
      expect(probe.streams[0].width).toBe(640);
    });
  });
});
