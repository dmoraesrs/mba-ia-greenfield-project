import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import videoConfig from '../../config/video.config';
import {
  EXPIRE_ABANDONED_UPLOADS_JOB,
  VIDEO_MAINTENANCE_QUEUE,
} from '../../queue/queue.constants';

/**
 * Agenda a varredura periódica de uploads abandonados no boot do worker.
 * `upsertJobScheduler` é idempotente: reiniciar o worker não duplica o agendamento.
 */
@Injectable()
export class UploadExpirationScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(VIDEO_MAINTENANCE_QUEUE)
    private readonly queue: Queue,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.schedule();
  }

  async schedule(): Promise<void> {
    await this.queue.upsertJobScheduler(
      EXPIRE_ABANDONED_UPLOADS_JOB,
      { every: this.config.uploadExpirationSweepIntervalMs },
      {
        name: EXPIRE_ABANDONED_UPLOADS_JOB,
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: { age: 86400 },
        },
      },
    );
  }
}
