import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  RangeNotSatisfiableException,
  VideoNotFoundException,
} from '../common/exceptions/domain.exception';
import {
  StorageObjectNotFoundError,
  StorageRangeNotSatisfiableError,
} from '../storage/storage.errors';
import {
  StorageService,
  type StoredObjectStream,
} from '../storage/storage.service';
import { parseRange, toRangeHeader } from './range';
import { VideosService } from './videos.service';

const THUMBNAIL_CACHE_CONTROL = 'public, max-age=300';

export interface StreamResult {
  status: 200 | 206;
  headers: Record<string, string>;
  body: Readable;
}

/**
 * Entrega vídeo e thumbnail em stream a partir do storage, repassando o
 * `Range` do cliente ao `GetObject` (o arquivo nunca é carregado em memória).
 */
@Injectable()
export class VideoStreamingService {
  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
  ) {}

  async openStream(
    publicId: string,
    rangeHeader: string | undefined,
  ): Promise<StreamResult> {
    const video = await this.videosService.getReadyVideo(publicId);
    const size =
      video.metadata?.size_bytes ||
      (await this.headOrNotFound(video.storage_key));
    const range = parseRange(rangeHeader, size);

    const object = await this.openObject(
      video.storage_key,
      range ? toRangeHeader(range) : undefined,
      size,
    );

    const headers: Record<string, string> = {
      'Content-Type': video.mime_type,
      'Content-Length': String(object.contentLength),
      'Accept-Ranges': 'bytes',
    };
    if (object.etag) headers['ETag'] = object.etag;
    if (range) {
      headers['Content-Range'] =
        object.contentRange ?? `bytes ${range.start}-${range.end}/${size}`;
    }
    return { status: range ? 206 : 200, headers, body: object.body };
  }

  async openThumbnail(publicId: string): Promise<StreamResult> {
    const video = await this.videosService.getReadyVideo(publicId);
    if (!video.thumbnail_key) {
      throw new VideoNotFoundException();
    }
    const object = await this.openObject(video.thumbnail_key);
    const headers: Record<string, string> = {
      'Content-Type': object.contentType ?? 'image/jpeg',
      'Content-Length': String(object.contentLength),
      'Cache-Control': THUMBNAIL_CACHE_CONTROL,
    };
    if (object.etag) headers['ETag'] = object.etag;
    return { status: 200, headers, body: object.body };
  }

  private async openObject(
    key: string,
    range?: string,
    size = 0,
  ): Promise<StoredObjectStream> {
    try {
      return await this.storageService.getObjectStream(key, range);
    } catch (err) {
      if (err instanceof StorageRangeNotSatisfiableError) {
        throw new RangeNotSatisfiableException(size);
      }
      if (err instanceof StorageObjectNotFoundError) {
        throw new VideoNotFoundException();
      }
      throw err;
    }
  }

  private async headOrNotFound(key: string): Promise<number> {
    try {
      return (await this.storageService.headObject(key)).contentLength;
    } catch (err) {
      if (err instanceof StorageObjectNotFoundError) {
        throw new VideoNotFoundException();
      }
      throw err;
    }
  }
}
