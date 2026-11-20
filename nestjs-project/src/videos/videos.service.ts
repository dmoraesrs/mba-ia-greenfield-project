import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ChannelsService } from '../channels/channels.service';
import {
  InvalidPartNumberException,
  VideoNotFoundException,
  VideoNotInDraftException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { originalKey } from '../storage/storage-keys';
import { StorageUploadNotFoundError } from '../storage/storage.errors';
import { StorageService } from '../storage/storage.service';
import type { CreateVideoDto } from './dto/create-video.dto';
import {
  type CreateVideoResponseDto,
  type SignPartsResponseDto,
  type UploadedPartsResponseDto,
  VideoResponseDto,
} from './dto/video-response.dto';
import { type Video, VideoStatus } from './entities/video.entity';
import { VideosRepository } from './videos.repository';

interface DraftVideo extends Video {
  upload_id: string;
}

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

    const signed = await this.signPartUrls(
      storageKey,
      uploadId,
      Array.from({ length: partCount }, (_, i) => i + 1),
    );

    return {
      video: VideoResponseDto.fromEntity(video),
      upload: {
        part_size_bytes: partSizeBytes,
        part_count: partCount,
        ...signed,
      },
    };
  }

  /** Partes já recebidas pelo storage, para o cliente retomar o upload. */
  async listUploadedParts(
    userId: string,
    id: string,
  ): Promise<UploadedPartsResponseDto> {
    const video = await this.findOwnedDraft(userId, id);
    try {
      const parts = await this.storageService.listParts(
        video.storage_key,
        video.upload_id,
      );
      return {
        parts: parts.map((p) => ({
          part_number: p.partNumber,
          etag: p.etag,
          size_bytes: p.size,
        })),
      };
    } catch (err) {
      throw this.translateUploadError(err);
    }
  }

  /** Reassina partes (URLs expiradas ou retomada do upload). */
  async signParts(
    userId: string,
    id: string,
    partNumbers: number[],
  ): Promise<SignPartsResponseDto> {
    const video = await this.findOwnedDraft(userId, id);
    if (partNumbers.some((n) => n > video.part_count)) {
      throw new InvalidPartNumberException();
    }
    return this.signPartUrls(video.storage_key, video.upload_id, partNumbers);
  }

  private async findOwnedDraft(
    userId: string,
    id: string,
  ): Promise<DraftVideo> {
    const video = await this.videosRepository.findOwnedById(id, userId);
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.status !== VideoStatus.DRAFT || video.upload_id === null) {
      throw new VideoNotInDraftException();
    }
    return video as DraftVideo;
  }

  private async signPartUrls(
    storageKey: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<SignPartsResponseDto> {
    const expiresIn = this.config.partUrlExpirationSeconds;
    const parts = await this.storageService.signUploadParts(
      storageKey,
      uploadId,
      partNumbers,
      expiresIn,
    );
    return {
      parts: parts.map((p) => ({ part_number: p.partNumber, url: p.url })),
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  /** Upload abortado no storage (ex.: expiração) equivale a "fora de draft". */
  private translateUploadError(err: unknown): unknown {
    return err instanceof StorageUploadNotFoundError
      ? new VideoNotInDraftException()
      : err;
  }
}
