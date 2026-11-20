import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import queueConfig from '../../config/queue.config';
import videoConfig from '../../config/video.config';
import {
  EXPIRE_ABANDONED_UPLOADS_JOB,
  VIDEO_MAINTENANCE_QUEUE,
} from '../../queue/queue.constants';
import { QueueModule } from '../../queue/queue.module';
import { obliterateTestQueues, testQueueConfig } from '../../test/test-infra';
import { UploadExpirationScheduler } from './upload-expiration.scheduler';

describe('UploadExpirationScheduler (integration, Valkey)', () => {
  let module: TestingModule;
  let queue: Queue;

  beforeAll(async () => {
    await obliterateTestQueues();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [queueConfig, videoConfig],
        }),
        QueueModule,
        BullModule.registerQueue({ name: VIDEO_MAINTENANCE_QUEUE }),
      ],
      providers: [UploadExpirationScheduler],
    })
      .overrideProvider(queueConfig.KEY)
      .useValue(testQueueConfig())
      .compile();
    queue = module.get(getQueueToken(VIDEO_MAINTENANCE_QUEUE));
  });

  afterAll(async () => {
    await obliterateTestQueues();
    await module.close();
  });

  it('should keep a single job scheduler after the worker boots twice', async () => {
    await module.init();
    await module.get(UploadExpirationScheduler).onApplicationBootstrap();

    const schedulers = await queue.getJobSchedulers();

    expect(schedulers).toHaveLength(1);
    expect(schedulers[0].key).toBe(EXPIRE_ABANDONED_UPLOADS_JOB);
    expect(schedulers[0].every).toBe(
      videoConfig().uploadExpirationSweepIntervalMs,
    );
  });
});
