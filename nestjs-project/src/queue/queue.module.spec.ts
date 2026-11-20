import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import { testQueueConfig } from '../test/test-infra';
import { VIDEO_PROCESSING_QUEUE } from './queue.constants';
import { QueueModule } from './queue.module';

describe('QueueModule', () => {
  it('should compile and apply the configured prefix to registered queues', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueueModule,
        BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
      ],
    })
      .overrideProvider(queueConfig.KEY)
      .useValue(testQueueConfig())
      .compile();

    const queue = module.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));

    expect(queue.name).toBe(VIDEO_PROCESSING_QUEUE);
    expect(queue.opts.prefix).toBe(testQueueConfig().prefix);
    await module.close();
  });
});
