import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { ChannelsService } from '../channels/channels.service';
import {
  InvalidPartNumberException,
  InvalidUploadPartsException,
  UploadSizeMismatchException,
  UploadTooLargeException,
  VideoNotFoundException,
  VideoNotInDraftException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { originalKey } from '../storage/storage-keys';
import {
  StorageInvalidPartsError,
  StorageUploadNotFoundError,
} from '../storage/storage.errors';
import { StorageService } from '../storage/storage.service';
import type { CompleteUploadDto } from './dto/complete-upload.dto';
import type { CreateVideoDto } from './dto/create-video.dto';
import {
  type CreateVideoResponseDto,
  type SignPartsResponseDto,
  type UploadedPartsResponseDto,
  VideoResponseDto,
} from './dto/video-response.dto';
import { type Video, VideoStatus } from './entities/video.entity';
import { attachmentDisposition } from './content-disposition';
import { PublicVideoResponseDto } from './dto/public-video-response.dto';
import { isValidPublicId } from './public-id';
import { VideoProcessingQueue } from './video-processing.queue';
import { VIDEO_FAILURE_REASONS } from './videos.constants';
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
    private readonly videoProcessingQueue: VideoProcessingQueue,
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

  /**
   * Conclui o multipart, confere o tamanho real contra o declarado e o limite
   * de 10 GiB e, se estiver tudo certo, passa o vídeo para `processing` e
   * enfileira o processamento.
   */
  async completeUpload(
    userId: string,
    id: string,
    dto: CompleteUploadDto,
  ): Promise<VideoResponseDto> {
    const video = await this.findOwnedDraft(userId, id);

    try {
      await this.storageService.completeMultipartUpload(
        video.storage_key,
        video.upload_id,
        [...dto.parts]
          .sort((a, b) => a.part_number - b.part_number)
          .map((p) => ({ partNumber: p.part_number, etag: p.etag })),
      );
    } catch (err) {
      if (err instanceof StorageInvalidPartsError) {
        // O vídeo continua em draft: o cliente pode reenviar/corrigir as partes.
        throw new InvalidUploadPartsException();
      }
      throw this.translateUploadError(err);
    }

    const { contentLength } = await this.storageService.headObject(
      video.storage_key,
    );
    if (contentLength > this.config.maxSizeBytes) {
      await this.rejectUploadedObject(
        video,
        VIDEO_FAILURE_REASONS.UPLOAD_TOO_LARGE,
      );
      throw new UploadTooLargeException();
    }
    if (contentLength !== video.size_bytes) {
      await this.rejectUploadedObject(
        video,
        VIDEO_FAILURE_REASONS.UPLOAD_SIZE_MISMATCH,
      );
      throw new UploadSizeMismatchException();
    }

    const moved = await this.videosRepository.updateWhereStatus(
      video.id,
      VideoStatus.DRAFT,
      { status: VideoStatus.PROCESSING, upload_id: null },
    );
    if (!moved) {
      // Corrida com a expiração de rascunhos: o vídeo saiu de draft no meio.
      throw new VideoNotInDraftException();
    }
    // Sem atomicidade entre Postgres e fila: se o add falhar, o vídeo fica em
    // processing sem job (limitação conhecida, registrada no progress da fase).
    await this.videoProcessingQueue.enqueue(video.id);

    const updated = await this.videosRepository.findById(video.id);
    if (!updated) {
      throw new VideoNotFoundException();
    }
    return VideoResponseDto.fromEntity(updated);
  }

  /** Consulta do dono, para acompanhar o processamento (qualquer status). */
  async getOwned(userId: string, id: string): Promise<VideoResponseDto> {
    const video = await this.videosRepository.findOwnedById(id, userId);
    if (!video) {
      throw new VideoNotFoundException();
    }
    return VideoResponseDto.fromEntity(video);
  }

  /** Dados públicos de um vídeo `ready` pelo identificador da URL única. */
  async getPublic(publicId: string): Promise<PublicVideoResponseDto> {
    return PublicVideoResponseDto.fromEntity(
      await this.getReadyVideo(publicId),
    );
  }

  /**
   * URL pré-assinada de curta duração (endpoint público) que entrega o arquivo
   * original como `attachment`; os bytes não passam pela API.
   */
  async getDownloadUrl(publicId: string): Promise<string> {
    const video = await this.getReadyVideo(publicId);
    return this.storageService.signGetObject(video.storage_key, {
      internal: false,
      expiresIn: this.config.downloadUrlExpirationSeconds,
      responseContentDisposition: attachmentDisposition(
        video.original_filename,
      ),
    });
  }

  /**
   * Formato inválido, inexistente ou fora de `ready` resultam no mesmo
   * `VIDEO_NOT_FOUND`, sem revelar a existência do vídeo.
   */
  async getReadyVideo(publicId: string): Promise<Video> {
    const video = isValidPublicId(publicId)
      ? await this.videosRepository.findReadyByPublicId(publicId)
      : null;
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  private async rejectUploadedObject(
    video: Video,
    failureReason: string,
  ): Promise<void> {
    await this.storageService.deleteObject(video.storage_key);
    await this.videosRepository.updateWhereStatus(video.id, VideoStatus.DRAFT, {
      status: VideoStatus.FAILED,
      failure_reason: failureReason,
      upload_id: null,
    });
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
