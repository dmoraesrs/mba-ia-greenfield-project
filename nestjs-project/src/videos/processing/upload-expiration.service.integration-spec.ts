import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import storageConfig from '../../config/storage.config';
import videoConfig from '../../config/video.config';
import { StorageUploadNotFoundError } from '../../storage/storage.errors';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { emptyTestBucket, testStorageConfig } from '../../test/test-infra';
import {
  buildDraftData,
  createUserWithChannel,
  VIDEO_TEST_ENTITIES,
} from '../../test/video-fixtures';
import { Video, VideoStatus } from '../entities/video.entity';
import { VideosRepository } from '../videos.repository';
import { UploadExpirationService } from './upload-expiration.service';

const HOUR_MS = 3600 * 1000;

describe('UploadExpirationService (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let videosRepository: VideosRepository;
  let storage: StorageService;
  let service: UploadExpirationService;
  let channelId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, videoConfig],
        }),
        TypeOrmModule.forRoot(
          createTestDataSource(VIDEO_TEST_ENTITIES).options,
        ),
        TypeOrmModule.forFeature([Video]),
        StorageModule,
      ],
      providers: [VideosRepository, UploadExpirationService],
    })
      .overrideProvider(storageConfig.KEY)
      .useValue(testStorageConfig())
      .compile();
    await module.init();
    dataSource = module.get(DataSource);
    videoRepository = dataSource.getRepository(Video);
    videosRepository = module.get(VideosRepository);
    storage = module.get(StorageService);
    service = module.get(UploadExpirationService);
  });

  afterAll(async () => {
    await emptyTestBucket();
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
    ({
      channel: { id: channelId },
    } = await createUserWithChannel(dataSource));
  });

  /** Rascunho com multipart real aberto no storage, criado `hoursAgo` horas atrás. */
  async function draftWithUpload(hoursAgo: number): Promise<Video> {
    const data = buildDraftData(channelId);
    const uploadId = await storage.createMultipartUpload(
      data.storage_key,
      'video/mp4',
    );
    const video = await videosRepository.createDraft({
      ...data,
      upload_id: uploadId,
    });
    await dataSource.query(
      `UPDATE "videos" SET "created_at" = $2 WHERE "id" = $1`,
      [video.id, new Date(Date.now() - hoursAgo * HOUR_MS)],
    );
    return videoRepository.findOneByOrFail({ id: video.id });
  }

  it('should fail an expired draft with upload_expired and abort its multipart upload', async () => {
    const expired = await draftWithUpload(25);

    const count = await service.expireAbandonedUploads();

    const row = await videoRepository.findOneByOrFail({ id: expired.id });
    expect(count).toBe(1);
    expect(row.status).toBe(VideoStatus.FAILED);
    expect(row.failure_reason).toBe('upload_expired');
    expect(row.upload_id).toBeNull();
    await expect(
      storage.listParts(expired.storage_key, expired.upload_id!),
    ).rejects.toBeInstanceOf(StorageUploadNotFoundError);
  });

  it('should leave recent drafts and old processing videos untouched', async () => {
    const recent = await draftWithUpload(1);
    const oldProcessing = await draftWithUpload(48);
    await videoRepository.update(oldProcessing.id, {
      status: VideoStatus.PROCESSING,
    });

    const count = await service.expireAbandonedUploads();

    expect(count).toBe(0);
    const recentRow = await videoRepository.findOneByOrFail({ id: recent.id });
    const processingRow = await videoRepository.findOneByOrFail({
      id: oldProcessing.id,
    });
    expect(recentRow.status).toBe(VideoStatus.DRAFT);
    expect(recentRow.upload_id).toBe(recent.upload_id);
    expect(processingRow.status).toBe(VideoStatus.PROCESSING);
    await expect(
      storage.listParts(recent.storage_key, recent.upload_id!),
    ).resolves.toEqual([]);
  });

  it('should keep going when a multipart upload no longer exists in the storage', async () => {
    const alreadyAborted = await draftWithUpload(30);
    await storage.abortMultipartUpload(
      alreadyAborted.storage_key,
      alreadyAborted.upload_id!,
    );
    const expired = await draftWithUpload(26);

    const count = await service.expireAbandonedUploads();

    expect(count).toBe(2);
    for (const id of [alreadyAborted.id, expired.id]) {
      const row = await videoRepository.findOneByOrFail({ id });
      expect(row.status).toBe(VideoStatus.FAILED);
      expect(row.failure_reason).toBe('upload_expired');
    }
  });
});
