import {
  DeleteBucketCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import storageConfig from '../config/storage.config';
import { emptyTestBucket, testStorageConfig } from '../test/test-infra';
import {
  StorageObjectNotFoundError,
  StorageUploadNotFoundError,
} from './storage.errors';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const MIN_PART_SIZE = 5 * 1024 * 1024;

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

async function putPart(url: string, body: Buffer): Promise<string> {
  const response = await fetch(url, {
    method: 'PUT',
    body: new Uint8Array(body),
  });
  expect(response.status).toBe(200);
  const etag = response.headers.get('etag');
  expect(etag).toBeTruthy();
  return etag!;
}

async function createModule(
  config = testStorageConfig(),
): Promise<TestingModule> {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
      StorageModule,
    ],
  })
    .overrideProvider(storageConfig.KEY)
    .useValue(config)
    .compile();
  await module.init();
  return module;
}

describe('StorageService (integration, MinIO)', () => {
  let module: TestingModule;
  let storage: StorageService;

  beforeAll(async () => {
    module = await createModule();
    storage = module.get(StorageService);
  });

  afterAll(async () => {
    await emptyTestBucket();
    await module.close();
  });

  describe('multipart upload with presigned part URLs', () => {
    const key = `videos/${randomUUID()}/original`;
    const part1 = randomBytes(MIN_PART_SIZE);
    const part2 = randomBytes(1024);

    beforeAll(async () => {
      const uploadId = await storage.createMultipartUpload(key, 'video/mp4');
      const [signed1, signed2] = await storage.signUploadParts(
        key,
        uploadId,
        [1, 2],
        300,
      );
      const etag1 = await putPart(signed1.url, part1);
      const etag2 = await putPart(signed2.url, part2);

      const listed = await storage.listParts(key, uploadId);
      expect(listed.map((p) => p.partNumber)).toEqual([1, 2]);

      await storage.completeMultipartUpload(key, uploadId, [
        { partNumber: 2, etag: etag2 },
        { partNumber: 1, etag: etag1 },
      ]);
    });

    it('should produce an object whose size is the sum of the parts', async () => {
      const head = await storage.headObject(key);

      expect(head.contentLength).toBe(part1.length + part2.length);
      expect(head.contentType).toBe('video/mp4');
    });

    it('should return exactly the requested bytes for a Range read', async () => {
      const result = await storage.getObjectStream(key, 'bytes=0-9');
      const body = await readAll(result.body);

      expect(body).toEqual(part1.subarray(0, 10));
      expect(result.contentLength).toBe(10);
      expect(result.contentRange).toBe(
        `bytes 0-9/${part1.length + part2.length}`,
      );
    });

    it('should sign a download URL that answers with Content-Disposition: attachment', async () => {
      const url = await storage.signGetObject(key, {
        expiresIn: 60,
        responseContentDisposition: 'attachment; filename="a.mp4"',
        internal: false,
      });

      const response = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      await response.arrayBuffer();

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-disposition')).toBe(
        'attachment; filename="a.mp4"',
      );
    });
  });

  it('should abort a multipart upload so its parts can no longer be listed', async () => {
    const key = `videos/${randomUUID()}/original`;
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

    await storage.abortMultipartUpload(key, uploadId);

    await expect(storage.listParts(key, uploadId)).rejects.toBeInstanceOf(
      StorageUploadNotFoundError,
    );
  });

  it('should delete an object so headObject reports it as not found', async () => {
    const key = `videos/${randomUUID()}/thumbnail.jpg`;
    await storage.putObject(key, Buffer.from('jpeg'), 'image/jpeg');

    await storage.deleteObject(key);

    await expect(storage.headObject(key)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
  });

  it('should throw StorageObjectNotFoundError for headObject of a missing key', async () => {
    await expect(
      storage.headObject(`videos/${randomUUID()}/original`),
    ).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it('should create the bucket on module init when it does not exist', async () => {
    const config = {
      ...testStorageConfig(),
      bucket: `streamtube-boot-${randomUUID().slice(0, 8)}`,
    };
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    const bootModule = await createModule(config);
    try {
      await expect(
        client.send(new HeadBucketCommand({ Bucket: config.bucket })),
      ).resolves.toBeDefined();
    } finally {
      await client.send(new DeleteBucketCommand({ Bucket: config.bucket }));
      client.destroy();
      await bootModule.close();
    }
  });
});
