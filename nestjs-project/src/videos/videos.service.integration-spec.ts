import type { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import { emptyTestBucket, obliterateTestQueues } from '../test/test-infra';
import { createUserWithChannel } from '../test/video-fixtures';
import { createVideosTestingModule } from '../test/videos-test-module';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

describe('VideosService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideosService;
  let storage: StorageService;

  beforeAll(async () => {
    module = await createVideosTestingModule().compile();
    await module.init();
    dataSource = module.get(DataSource);
    service = module.get(VideosService);
    storage = module.get(StorageService);
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
      expect(row.part_count).toBe(2);
      await expect(
        storage.listParts(row.storage_key, row.upload_id!),
      ).resolves.toEqual([]);
      await storage.abortMultipartUpload(row.storage_key, row.upload_id!);
    });
  });
});
