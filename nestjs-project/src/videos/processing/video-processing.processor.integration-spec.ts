import { getQueueToken } from '@nestjs/bullmq';
import type { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { FfmpegService } from '../../media/ffmpeg.service';
import { MediaToolError } from '../../media/media.errors';
import {
  type ProcessVideoJobData,
  VIDEO_PROCESSING_QUEUE,
} from '../../queue/queue.constants';
import { StorageService } from '../../storage/storage.service';
import { cleanAllTables } from '../../test/create-test-data-source';
import { generateSampleVideo } from '../../test/fixtures';
import { emptyTestBucket, obliterateTestQueues } from '../../test/test-infra';
import {
  buildDraftData,
  createUserWithChannel,
} from '../../test/video-fixtures';
import { createWorkerTestingModule } from '../../test/worker-test-module';
import { Video, VideoStatus } from '../entities/video.entity';
import { VideoProcessingQueue } from '../video-processing.queue';

const FINAL_STATUSES = [VideoStatus.READY, VideoStatus.FAILED];

describe('VideoProcessingProcessor (integration, in-process worker)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let storage: StorageService;
  let ffmpeg: FfmpegService;
  let queue: Queue<ProcessVideoJobData>;
  let producer: VideoProcessingQueue;
  let workDir: string;
  let sampleVideo: Buffer;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'processor-spec-'));
    const samplePath = join(workDir, 'sample.mp4');
    await generateSampleVideo(samplePath, { seconds: 2, withAudio: true });
    sampleVideo = await readFile(samplePath);

    module = await createWorkerTestingModule().compile();
    await module.init();
    dataSource = module.get(DataSource);
    storage = module.get(StorageService);
    ffmpeg = module.get(FfmpegService);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    producer = new VideoProcessingQueue(queue);
  }, 30000);

  afterAll(async () => {
    await module.close();
    await obliterateTestQueues();
    await emptyTestBucket();
    await rm(workDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Cria um vídeo `processing` cujo original já está no storage. */
  async function processingVideoWith(content: Buffer): Promise<Video> {
    const { channel } = await createUserWithChannel(dataSource);
    const data = buildDraftData(channel.id, {
      size_bytes: content.length,
      upload_id: null as unknown as string,
    });
    await storage.putObject(data.storage_key, content, 'video/mp4');
    const repo = dataSource.getRepository(Video);
    await repo.insert({
      ...data,
      upload_id: null,
      public_id: data.id.replace(/-/g, '').slice(0, 11),
      status: VideoStatus.PROCESSING,
    });
    return repo.findOneByOrFail({ id: data.id });
  }

  async function waitForFinalStatus(id: string, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const video = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id });
      if (FINAL_STATUSES.includes(video.status)) return video;
      if (Date.now() > deadline) {
        throw new Error(
          `Video ${id} still ${video.status} after ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  it('should mark a valid video ready with duration, metadata and a thumbnail in the bucket', async () => {
    const video = await processingVideoWith(sampleVideo);

    await producer.enqueue(video.id);
    const done = await waitForFinalStatus(video.id);

    expect(done.status).toBe(VideoStatus.READY);
    expect(done.duration_seconds).toBeGreaterThanOrEqual(1.9);
    expect(done.duration_seconds).toBeLessThanOrEqual(2.1);
    expect(done.metadata).toMatchObject({
      width: 320,
      height: 240,
      video_codec: 'h264',
      audio_codec: 'aac',
      frame_rate: 25,
      size_bytes: sampleVideo.length,
    });
    expect(done.thumbnail_key).toBe(`videos/${video.id}/thumbnail.jpg`);
    expect(done.failure_reason).toBeNull();
    const thumbnail = await storage.headObject(done.thumbnail_key!);
    expect(thumbnail.contentLength).toBeGreaterThan(0);
    expect(thumbnail.contentType).toBe('image/jpeg');
  });

  it('should fail a non-video file with invalid_video_file after a single attempt', async () => {
    const textPath = join(workDir, 'fake.mp4');
    await writeFile(textPath, 'not a video at all\n'.repeat(200));
    const video = await processingVideoWith(await readFile(textPath));

    await producer.enqueue(video.id);
    const done = await waitForFinalStatus(video.id);

    expect(done.status).toBe(VideoStatus.FAILED);
    expect(done.failure_reason).toMatch(/^invalid_video_file: /);
    const job = await queue.getJob(video.id);
    expect(job?.attemptsMade).toBe(1);
  });

  it('should fail with processing_failed when a transient error persists in all 3 attempts', async () => {
    jest
      .spyOn(ffmpeg, 'probe')
      .mockRejectedValue(new MediaToolError('ffprobe timed out'));
    const video = await processingVideoWith(sampleVideo);

    await producer.enqueue(video.id);
    const done = await waitForFinalStatus(video.id);

    expect(done.status).toBe(VideoStatus.FAILED);
    expect(done.failure_reason).toBe('processing_failed: ffprobe timed out');
    expect((await queue.getJob(video.id))?.attemptsMade).toBe(3);
  });

  it('should end ready when a transient error happens only in the first attempt', async () => {
    jest
      .spyOn(ffmpeg, 'probe')
      .mockRejectedValueOnce(new MediaToolError('connection reset'));
    const video = await processingVideoWith(sampleVideo);

    await producer.enqueue(video.id);
    const done = await waitForFinalStatus(video.id);

    expect(done.status).toBe(VideoStatus.READY);
  });
});
