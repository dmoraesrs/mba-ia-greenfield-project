import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { type Job, UnrecoverableError } from 'bullmq';
import queueConfig from '../../config/queue.config';
import { FfmpegService } from '../../media/ffmpeg.service';
import { InvalidVideoFileError } from '../../media/media.errors';
import { parseProbeOutput } from '../../media/probe-parser';
import {
  type ProcessVideoJobData,
  VIDEO_PROCESSING_QUEUE,
} from '../../queue/queue.constants';
import { thumbnailKey } from '../../storage/storage-keys';
import { StorageService } from '../../storage/storage.service';
import { VideoStatus } from '../entities/video.entity';
import { VIDEO_FAILURE_REASONS } from '../videos.constants';
import { VideosRepository } from '../videos.repository';

const SOURCE_URL_EXPIRATION_SECONDS = 3600;
const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';

export type ProcessVideoResult = 'processed' | 'skipped';

/**
 * Consumidor do job `process-video`. Registrado só no `WorkerModule` (processo
 * `video-worker`); a API apenas produz o job.
 */
@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly storageService: StorageService,
    private readonly ffmpegService: FfmpegService,
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    // A concorrência vem do ambiente (VIDEO_WORKER_CONCURRENCY), não do decorator.
    this.worker.concurrency = this.config.workerConcurrency;
    this.logger.log(
      `Consuming queue "${VIDEO_PROCESSING_QUEUE}" (prefix "${this.config.prefix}", concurrency ${this.config.workerConcurrency})`,
    );
  }

  async process(job: Job<ProcessVideoJobData>): Promise<ProcessVideoResult> {
    const { videoId } = job.data;
    const video = await this.videosRepository.findById(videoId);
    if (!video || video.status !== VideoStatus.PROCESSING) {
      // Idempotência: reentrega de job para vídeo já finalizado não tem efeito.
      return 'skipped';
    }

    try {
      const sourceUrl = await this.storageService.signGetObject(
        video.storage_key,
        { internal: true, expiresIn: SOURCE_URL_EXPIRATION_SECONDS },
      );
      const { durationSeconds, metadata } = parseProbeOutput(
        await this.ffmpegService.probe(sourceUrl),
      );
      const jpeg = await this.ffmpegService.extractFrame(
        sourceUrl,
        Math.min(1, durationSeconds / 2),
      );
      const key = thumbnailKey(video.id);
      await this.storageService.putObject(key, jpeg, THUMBNAIL_CONTENT_TYPE);

      await this.videosRepository.updateWhereStatus(
        video.id,
        VideoStatus.PROCESSING,
        {
          status: VideoStatus.READY,
          duration_seconds: durationSeconds,
          metadata,
          thumbnail_key: key,
          failure_reason: null,
        },
      );
      return 'processed';
    } catch (err) {
      if (err instanceof InvalidVideoFileError) {
        // Falha permanente: não gasta retentativas.
        throw new UnrecoverableError(
          `${VIDEO_FAILURE_REASONS.INVALID_VIDEO_FILE}: ${err.detail}`,
        );
      }
      throw err;
    }
  }

  /**
   * Fecha o ciclo em `failed` quando não haverá nova tentativa: erro não
   * retentável ou retentativas esgotadas.
   */
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ProcessVideoJobData> | undefined,
    err: Error,
  ): Promise<void> {
    if (!job) return;
    const unrecoverable =
      err instanceof UnrecoverableError || err.name === 'UnrecoverableError';
    const attempts = job.opts.attempts ?? 1;
    if (!unrecoverable && job.attemptsMade < attempts) return;

    const failureReason = unrecoverable
      ? err.message
      : `${VIDEO_FAILURE_REASONS.PROCESSING_FAILED}: ${err.message}`;
    try {
      await this.videosRepository.updateWhereStatus(
        job.data.videoId,
        VideoStatus.PROCESSING,
        { status: VideoStatus.FAILED, failure_reason: failureReason },
      );
    } catch (updateErr) {
      // Handler de evento em background: relançar derrubaria o worker.
      this.logger.error(
        `Could not mark video ${job.data.videoId} as failed`,
        updateErr instanceof Error ? updateErr.stack : String(updateErr),
      );
    }
  }
}
