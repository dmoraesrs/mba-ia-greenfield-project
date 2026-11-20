import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';

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

/** Remove todos os objetos do bucket de teste (usar em `afterAll`). */
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
  } finally {
    client.destroy();
  }
}
