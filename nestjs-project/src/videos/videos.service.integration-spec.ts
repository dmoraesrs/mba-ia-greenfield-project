import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { emptyTestBucket, obliterateTestQueues } from '../test/test-infra';
import { createUserWithChannel } from '../test/video-fixtures';
import { createVideosTestingModule } from '../test/videos-test-module';
import { Video, VideoStatus } from './entities/video.entity';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE } from '../queue/queue.constants';
import { StorageObjectNotFoundError } from '../storage/storage.errors';
import { UploadSizeMismatchException } from '../common/exceptions/domain.exception';
import { VideosService } from './videos.service';

const PART_SIZE = 5 * 1024 * 1024;

async function putPart(url: string, size: number): Promise<string> {
  const response = await fetch(url, {
    method: 'PUT',
    body: new Uint8Array(size),
  });
  expect(response.status).toBe(200);
  return response.headers.get('etag')!;
}

describe('VideosService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideosService;
  let storage: StorageService;
  let queue: Queue;

  beforeAll(async () => {
    module = await createVideosTestingModule({
      video: { partSizeBytes: PART_SIZE },
    }).compile();
    await module.init();
    dataSource = module.get(DataSource);
    service = module.get(VideosService);
    storage = module.get(StorageService);
    queue = module.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    await emptyTestBucket();
    await obliterateTestQueues();
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
  });

  describe('initiateUpload', () => {
    it('should persist the draft with its upload id and open a multipart upload in the storage', async () => {
      const { user, channel } = await createUserWithChannel(dataSource);

      const result = await service.initiateUpload(user.id, {
        filename: 'a.mp4',
        mime_type: 'video/mp4',
        size_bytes: 134217728,
      });

      const row = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: result.video.id });
      expect(row.status).toBe(VideoStatus.DRAFT);
      expect(row.channel_id).toBe(channel.id);
      expect(row.storage_key).toBe(`videos/${row.id}/original`);
      expect(row.upload_id).toEqual(expect.any(String));
      expect(row.part_count).toBe(26);
      await expect(
        storage.listParts(row.storage_key, row.upload_id!),
      ).resolves.toEqual([]);
      await storage.abortMultipartUpload(row.storage_key, row.upload_id!);
    });
  });

  describe('listUploadedParts', () => {
    it('should list the part sent through the presigned URL with its etag and size', async () => {
      const { user } = await createUserWithChannel(dataSource);
      const created = await service.initiateUpload(user.id, {
        filename: 'a.mp4',
        mime_type: 'video/mp4',
        size_bytes: 134217728,
      });
      const body = new Uint8Array(1024);
      const put = await fetch(created.upload.parts[0].url, {
        method: 'PUT',
        body,
      });
      expect(put.status).toBe(200);

      const result = await service.listUploadedParts(user.id, created.video.id);

      expect(result.parts).toEqual([
        {
          part_number: 1,
          etag: put.headers.get('etag'),
          size_bytes: body.length,
        },
      ]);
    });
  });

  describe('completeUpload', () => {
    const startTwoPartUpload = async () => {
      const { user } = await createUserWithChannel(dataSource);
      const created = await service.initiateUpload(user.id, {
        filename: 'a.mp4',
        mime_type: 'video/mp4',
        size_bytes: 2 * PART_SIZE,
      });
      return { user, created };
    };

    it('should move the video to processing and create the process-video job', async () => {
      await queue.obliterate({ force: true });
      const { user, created } = await startTwoPartUpload();
      const [p1, p2] = created.upload.parts;
      const etag1 = await putPart(p1.url, PART_SIZE);
      const etag2 = await putPart(p2.url, PART_SIZE);

      const result = await service.completeUpload(user.id, created.video.id, {
        parts: [
          { part_number: 2, etag: etag2 },
          { part_number: 1, etag: etag1 },
        ],
      });

      const row = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: created.video.id });
      const job = await queue.getJob(created.video.id);
      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(row.status).toBe(VideoStatus.PROCESSING);
      expect(row.upload_id).toBeNull();
      expect(job?.name).toBe('process-video');
      expect(job?.data).toEqual({ videoId: created.video.id });
      await expect(storage.headObject(row.storage_key)).resolves.toMatchObject({
        contentLength: 2 * PART_SIZE,
      });
    });

    it('should fail the video, delete the object and not enqueue when the real size differs', async () => {
      const { user, created } = await startTwoPartUpload();
      const [p1, p2] = created.upload.parts;
      const etag1 = await putPart(p1.url, PART_SIZE);
      const etag2 = await putPart(p2.url, PART_SIZE + 1);

      await expect(
        service.completeUpload(user.id, created.video.id, {
          parts: [
            { part_number: 1, etag: etag1 },
            { part_number: 2, etag: etag2 },
          ],
        }),
      ).rejects.toBeInstanceOf(UploadSizeMismatchException);

      const row = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: created.video.id });
      expect(row.status).toBe(VideoStatus.FAILED);
      expect(row.failure_reason).toBe('upload_size_mismatch');
      await expect(storage.headObject(row.storage_key)).rejects.toBeInstanceOf(
        StorageObjectNotFoundError,
      );
      expect(await queue.getJob(created.video.id)).toBeUndefined();
    });
  });
});
