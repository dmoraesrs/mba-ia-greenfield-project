import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ChannelsService } from '../channels/channels.service';
import videoConfig from '../config/video.config';
import { originalKey } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import type { CreateVideoDto } from './dto/create-video.dto';
import {
  type CreateVideoResponseDto,
  VideoResponseDto,
} from './dto/video-response.dto';
import type { Video } from './entities/video.entity';
import { VideosRepository } from './videos.repository';

@Injectable()
export class VideosService {
  constructor(
    private readonly videosRepository: VideosRepository,
    private readonly storageService: StorageService,
    private readonly channelsService: ChannelsService,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  /**
   * Inicia o upload: cria o rascunho no canal do usuário, abre o multipart no
   * storage e devolve as URLs pré-assinadas de todas as partes. O arquivo vai
   * do cliente direto ao storage.
   */
  async initiateUpload(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<CreateVideoResponseDto> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new Error(`User ${userId} has no channel`);
    }

    const partSizeBytes = this.config.partSizeBytes;
    const partCount = Math.ceil(dto.size_bytes / partSizeBytes);
    const id = randomUUID();
    const storageKey = originalKey(id);

    const uploadId = await this.storageService.createMultipartUpload(
      storageKey,
      dto.mime_type,
    );

    let video: Video;
    try {
      video = await this.videosRepository.createDraft({
        id,
        channel_id: channel.id,
        original_filename: dto.filename,
        mime_type: dto.mime_type,
        size_bytes: dto.size_bytes,
        storage_key: storageKey,
        upload_id: uploadId,
        part_size_bytes: partSizeBytes,
        part_count: partCount,
      });
    } catch (err) {
      // Compensação: sem rascunho, o multipart aberto ficaria órfão.
      await this.storageService.abortMultipartUpload(storageKey, uploadId);
      throw err;
    }

    const expiresIn = this.config.partUrlExpirationSeconds;
    const parts = await this.storageService.signUploadParts(
      storageKey,
      uploadId,
      Array.from({ length: partCount }, (_, i) => i + 1),
      expiresIn,
    );

    return {
      video: VideoResponseDto.fromEntity(video),
      upload: {
        part_size_bytes: partSizeBytes,
        part_count: partCount,
        parts: parts.map((p) => ({ part_number: p.partNumber, url: p.url })),
        expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      },
    };
  }
}
