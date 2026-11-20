import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ConfigType } from '@nestjs/config';
import { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { ALL_QUEUES } from '../queue/queue.constants';

/**
 * Config de fila para testes: prefixo próprio (`{QUEUE_PREFIX}-test`), invisível
 * para o `video-worker` de desenvolvimento.
 */
export function testQueueConfig(): ConfigType<typeof queueConfig> {
  const base = queueConfig();
  return { ...base, prefix: `${base.prefix}-test` };
}

/** Apaga todas as filas sob o prefixo de teste (usar em `afterAll`). */
export async function obliterateTestQueues(): Promise<void> {
  const config = testQueueConfig();
  for (const name of ALL_QUEUES) {
    const queue = new Queue(name, {
      connection: { host: config.host, port: config.port },
      prefix: config.prefix,
    });
    try {
      await queue.obliterate({ force: true });
    } finally {
      await queue.close();
    }
  }
}

/**
 * Config de storage para testes: bucket próprio (`{STORAGE_BUCKET}-test`) e
 * URLs assinadas com o endpoint interno, já que os testes rodam dentro do
 * container e não alcançam o endpoint público (localhost do host).
 */
export function testStorageConfig(): ConfigType<typeof storageConfig> {
  const base = storageConfig();
  return {
    ...base,
    bucket: `${base.bucket}-test`,
    publicEndpoint: base.endpoint,
  };
}

/**
 * Remove todos os objetos e aborta os uploads multipart abertos do bucket de
 * teste (usar em `afterAll`).
 */
export async function emptyTestBucket(): Promise<void> {
  const config = testStorageConfig();
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  try {
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          ContinuationToken: token,
        }),
      );
      const keys = (page.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => !!k);
      if (keys.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: config.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          }),
        );
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);

    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    do {
      const page = await client.send(
        new ListMultipartUploadsCommand({
          Bucket: config.bucket,
          KeyMarker: keyMarker,
          UploadIdMarker: uploadIdMarker,
        }),
      );
      for (const upload of page.Uploads ?? []) {
        if (!upload.Key || !upload.UploadId) continue;
        await client.send(
          new AbortMultipartUploadCommand({
            Bucket: config.bucket,
            Key: upload.Key,
            UploadId: upload.UploadId,
          }),
        );
      }
      keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
      uploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
    } while (keyMarker);
  } finally {
    client.destroy();
  }
}
