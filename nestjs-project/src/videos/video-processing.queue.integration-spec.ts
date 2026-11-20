import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import queueConfig from '../config/queue.config';
import {
  PROCESS_VIDEO_JOB,
  type ProcessVideoJobData,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';
import { QueueModule } from '../queue/queue.module';
import { obliterateTestQueues, testQueueConfig } from '../test/test-infra';
import { VideoProcessingQueue } from './video-processing.queue';

describe('VideoProcessingQueue (integration, Valkey)', () => {
  let module: TestingModule;
  let producer: VideoProcessingQueue;
  let queue: Queue<ProcessVideoJobData>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
        BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
      ],
      providers: [VideoProcessingQueue],
    })
      .overrideProvider(queueConfig.KEY)
      .useValue(testQueueConfig())
      .compile();

    producer = module.get(VideoProcessingQueue);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await obliterateTestQueues();
    await module.close();
  });

  it('should add a process-video job keyed by the video id with retries and exponential backoff', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);

    const job = await queue.getJob(videoId);
    expect(job).toBeDefined();
    expect(job!.name).toBe(PROCESS_VIDEO_JOB);
    expect(job!.data).toEqual({ videoId });
    expect(job!.opts.jobId).toBe(videoId);
    expect(job!.opts.attempts).toBe(3);
    expect(job!.opts.backoff).toEqual({ type: 'exponential', delay: 1000 });
  });

  it('should not create a duplicate job when the same video is enqueued twice', async () => {
    const videoId = randomUUID();

    await producer.enqueue(videoId);
    await producer.enqueue(videoId);

    const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
    expect(counts.waiting + counts.delayed + counts.active).toBe(1);
  });

  it('should keep jobs under the test prefix, invisible to the development queue', async () => {
    const videoId = randomUUID();
    const devQueue = new Queue(VIDEO_PROCESSING_QUEUE, {
      connection: { host: queueConfig().host, port: queueConfig().port },
      prefix: queueConfig().prefix,
    });

    try {
      await producer.enqueue(videoId);

      expect(queue.opts.prefix).toBe(testQueueConfig().prefix);
      expect(await queue.getJob(videoId)).toBeDefined();
      expect(await devQueue.getJob(videoId)).toBeUndefined();
    } finally {
      await devQueue.close();
    }
  });
});
