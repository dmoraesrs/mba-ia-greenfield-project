import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import videoConfig from '../../config/video.config';
import { StorageUploadNotFoundError } from '../../storage/storage.errors';
import { StorageService } from '../../storage/storage.service';
import { type Video, VideoStatus } from '../entities/video.entity';
import { VIDEO_FAILURE_REASONS } from '../videos.constants';
import { VideosRepository } from '../videos.repository';

const BATCH_SIZE = 100;
const HOUR_MS = 3600 * 1000;

@Injectable()
export class UploadExpirationService {
  private readonly logger = new Logger(UploadExpirationService.name);

  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly storageService: StorageService,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  /**
   * Expira rascunhos mais antigos que `UPLOAD_EXPIRATION_HOURS`: aborta o
   * multipart e marca o vídeo `failed` com `upload_expired`. Retorna quantos
   * vídeos foram expirados.
   */
  async expireAbandonedUploads(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - this.config.uploadExpirationHours * HOUR_MS,
    );
    let expired = 0;
    for (;;) {
      const batch = await this.videosRepository.findExpiredDrafts(
        cutoff,
        BATCH_SIZE,
      );
      for (const video of batch) {
        if (await this.expire(video)) expired++;
      }
      // Cada vídeo do lote sai de draft (ou já saiu), então o próximo lote
      // traz os seguintes; lote incompleto significa que acabou.
      if (batch.length < BATCH_SIZE) break;
    }
    if (expired > 0) {
      this.logger.log(`Expired ${expired} abandoned upload(s)`);
    }
    return expired;
  }

  private async expire(video: Video): Promise<boolean> {
    if (video.upload_id) {
      try {
        await this.storageService.abortMultipartUpload(
          video.storage_key,
          video.upload_id,
        );
      } catch (err) {
        // Upload já abortado ou concluído no storage: segue para o status.
        if (!(err instanceof StorageUploadNotFoundError)) throw err;
      }
    }
    // Condicional: não sobrescreve um vídeo concluído no meio da varredura.
    return this.videosRepository.updateWhereStatus(
      video.id,
      VideoStatus.DRAFT,
      {
        status: VideoStatus.FAILED,
        failure_reason: VIDEO_FAILURE_REASONS.UPLOAD_EXPIRED,
        upload_id: null,
      },
    );
  }
}
