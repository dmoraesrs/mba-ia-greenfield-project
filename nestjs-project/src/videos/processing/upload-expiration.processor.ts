import { Processor, WorkerHost } from '@nestjs/bullmq';
import { VIDEO_MAINTENANCE_QUEUE } from '../../queue/queue.constants';
import { UploadExpirationService } from './upload-expiration.service';

/** Consumidor do job agendado `expire-abandoned-uploads` (só no worker). */
@Processor(VIDEO_MAINTENANCE_QUEUE)
export class UploadExpirationProcessor extends WorkerHost {
  constructor(
    private readonly uploadExpirationService: UploadExpirationService,
  ) {
    super();
  }

  async process(): Promise<number> {
    return this.uploadExpirationService.expireAbandonedUploads();
  }
}
