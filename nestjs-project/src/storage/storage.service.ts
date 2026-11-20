import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import { mapStorageError, StorageObjectNotFoundError } from './storage.errors';

export interface SignedUploadPart {
  partNumber: number;
  url: string;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface StoredObjectHead {
  contentLength: number;
  contentType?: string;
  etag?: string;
}

export interface StoredObjectStream {
  body: Readable;
  contentLength: number;
  contentRange?: string;
  contentType?: string;
  etag?: string;
}

export interface SignGetObjectOptions {
  expiresIn: number;
  responseContentDisposition?: string;
  /** true: URL com endpoint interno (worker); false: endpoint público (cliente). */
  internal: boolean;
}

/**
 * Adapter S3 (MinIO em desenvolvimento). Usa dois clientes: o interno, pelo nome
 * do serviço do Compose, para todas as chamadas; e o público, apenas para assinar
 * URLs entregues ao cliente (o host faz parte da assinatura).
 */
@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly internalClient: S3Client;
  private readonly publicClient: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(storageConfig.KEY)
    config: ConfigType<typeof storageConfig>,
  ) {
    const base = {
      region: config.region,
      forcePathStyle: true,
      // Sem isso o SDK embute na URL assinada o checksum CRC32 de um corpo vazio
      // e o PUT da parte feito pelo cliente é rejeitado com BadDigest.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    this.internalClient = new S3Client({ ...base, endpoint: config.endpoint });
    this.publicClient = new S3Client({
      ...base,
      endpoint: config.publicEndpoint,
    });
    this.bucket = config.bucket;
  }

  get bucketName(): string {
    return this.bucket;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  onModuleDestroy(): void {
    this.internalClient.destroy();
    this.publicClient.destroy();
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.internalClient.send(
        new HeadBucketCommand({ Bucket: this.bucket }),
      );
    } catch (err) {
      if (!(mapStorageError(err) instanceof StorageObjectNotFoundError)) {
        throw err;
      }
      this.logger.log(`Creating storage bucket "${this.bucket}"`);
      await this.internalClient.send(
        new CreateBucketCommand({ Bucket: this.bucket }),
      );
    }
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const result = await this.run(() =>
      this.internalClient.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          ContentType: contentType,
        }),
      ),
    );
    if (!result.UploadId) {
      throw new Error('Storage did not return an UploadId');
    }
    return result.UploadId;
  }

  async signUploadParts(
    key: string,
    uploadId: string,
    partNumbers: number[],
    expiresIn: number,
  ): Promise<SignedUploadPart[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          this.publicClient,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn },
        ),
      })),
    );
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    do {
      const page = await this.run(() =>
        this.internalClient.send(
          new ListPartsCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: marker,
          }),
        ),
      );
      for (const part of page.Parts ?? []) {
        if (part.PartNumber === undefined || !part.ETag) continue;
        parts.push({
          partNumber: part.PartNumber,
          etag: part.ETag,
          size: part.Size ?? 0,
        });
      }
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    await this.run(() =>
      this.internalClient.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: ordered.map((p) => ({
              PartNumber: p.partNumber,
              ETag: p.etag,
            })),
          },
        }),
      ),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.run(() =>
      this.internalClient.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
        }),
      ),
    );
  }

  async headObject(key: string): Promise<StoredObjectHead> {
    const result = await this.run(() =>
      this.internalClient.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      ),
    );
    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType,
      etag: result.ETag,
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.run(() =>
      this.internalClient.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      ),
    );
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.run(() =>
      this.internalClient.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      ),
    );
  }

  /**
   * Abre a leitura do objeto, opcionalmente parcial (`range` no formato do
   * cabeçalho HTTP, ex.: `bytes=0-9`). O chamador é dono do `body` e deve
   * consumi-lo até o fim ou destruí-lo.
   */
  async getObjectStream(
    key: string,
    range?: string,
  ): Promise<StoredObjectStream> {
    const result = await this.run(() =>
      this.internalClient.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }),
      ),
    );
    if (!result.Body) {
      throw new StorageObjectNotFoundError();
    }
    return {
      body: result.Body as Readable,
      contentLength: result.ContentLength ?? 0,
      contentRange: result.ContentRange,
      contentType: result.ContentType,
      etag: result.ETag,
    };
  }

  async signGetObject(
    key: string,
    options: SignGetObjectOptions,
  ): Promise<string> {
    const client = options.internal ? this.internalClient : this.publicClient;
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: options.responseContentDisposition,
      }),
      { expiresIn: options.expiresIn },
    );
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      throw mapStorageError(err);
    }
  }
}
