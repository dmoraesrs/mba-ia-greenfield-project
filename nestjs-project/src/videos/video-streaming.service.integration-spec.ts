import type { TestingModule } from '@nestjs/testing';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { generateSampleVideo } from '../test/fixtures';
import { emptyTestBucket, obliterateTestQueues } from '../test/test-infra';
import {
  createUserWithChannel,
  SAMPLE_METADATA,
  seedVideo,
} from '../test/video-fixtures';
import { createVideosTestingModule } from '../test/videos-test-module';
import { type Video, VideoStatus } from './entities/video.entity';
import { VideoStreamingService } from './video-streaming.service';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

describe('VideoStreamingService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideoStreamingService;
  let storage: StorageService;
  let workDir: string;
  let file: Buffer;
  let video: Video;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'streaming-spec-'));
    const path = join(workDir, 'sample.mp4');
    await generateSampleVideo(path, { seconds: 2, withAudio: true });
    file = await readFile(path);

    module = await createVideosTestingModule().compile();
    await module.init();
    dataSource = module.get(DataSource);
    service = module.get(VideoStreamingService);
    storage = module.get(StorageService);
  }, 30000);

  afterAll(async () => {
    await emptyTestBucket();
    await obliterateTestQueues();
    await module.close();
    await rm(workDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
    const { channel } = await createUserWithChannel(dataSource);
    video = await seedVideo(dataSource, channel.id, {
      status: VideoStatus.READY,
      size_bytes: file.length,
      duration_seconds: 2,
      metadata: { ...SAMPLE_METADATA, size_bytes: file.length },
    });
    await storage.putObject(video.storage_key, file, 'video/mp4');
  });

  it('should answer 206 with exactly the requested bytes for a Range', async () => {
    const result = await service.openStream(video.public_id, 'bytes=100-1123');

    const body = await readAll(result.body);
    expect(result.status).toBe(206);
    expect(result.headers['Content-Range']).toBe(
      `bytes 100-1123/${file.length}`,
    );
    expect(result.headers['Content-Length']).toBe('1024');
    expect(body).toEqual(file.subarray(100, 1124));
  });

  it('should answer 200 with the whole file without a Range', async () => {
    const result = await service.openStream(video.public_id, undefined);

    const body = await readAll(result.body);
    expect(result.status).toBe(200);
    expect(result.headers['Content-Length']).toBe(String(file.length));
    expect(result.headers['Accept-Ranges']).toBe('bytes');
    expect(body.equals(file)).toBe(true);
  });
});
