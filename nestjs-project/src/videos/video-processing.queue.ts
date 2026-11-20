import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  PROCESS_VIDEO_JOB,
  type ProcessVideoJobData,
  VIDEO_PROCESSING_QUEUE,
} from '../queue/queue.constants';

const PROCESS_VIDEO_ATTEMPTS = 3;
const PROCESS_VIDEO_BACKOFF_MS = 1000;
const FAILED_JOB_RETENTION_SECONDS = 86400;

/** Produtor do job `process-video`. O consumidor vive só no worker. */
@Injectable()
export class VideoProcessingQueue {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<ProcessVideoJobData>,
  ) {}

  async enqueue(videoId: string): Promise<void> {
    await this.queue.add(
      PROCESS_VIDEO_JOB,
      { videoId },
      {
        // jobId determinístico: deduplica o mesmo vídeo enquanto o job existir.
        jobId: videoId,
        attempts: PROCESS_VIDEO_ATTEMPTS,
        backoff: { type: 'exponential', delay: PROCESS_VIDEO_BACKOFF_MS },
        removeOnComplete: true,
        removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
      },
    );
  }
}
