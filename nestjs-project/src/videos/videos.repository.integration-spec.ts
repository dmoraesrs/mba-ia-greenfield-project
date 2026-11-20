import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import {
  buildDraftData,
  createUserWithChannel,
  VIDEO_TEST_ENTITIES,
} from '../test/video-fixtures';
import { Video, VideoStatus } from './entities/video.entity';
import * as publicIdModule from './public-id';
import { VideosRepository } from './videos.repository';

describe('VideosRepository (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let videosRepository: VideosRepository;

  beforeAll(async () => {
    dataSource = createTestDataSource(VIDEO_TEST_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    videosRepository = new VideosRepository(videoRepository);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createDraft', () => {
    it('should persist a draft with a valid 11-character public_id', async () => {
      const { channel } = await createUserWithChannel(dataSource);
      const data = buildDraftData(channel.id);

      const video = await videosRepository.createDraft(data);

      expect(video.id).toBe(data.id);
      expect(video.status).toBe(VideoStatus.DRAFT);
      expect(publicIdModule.isValidPublicId(video.public_id)).toBe(true);
      expect(video.upload_id).toBe(data.upload_id);
    });

    it('should retry with a new public_id when the first one collides', async () => {
      const { channel } = await createUserWithChannel(dataSource);
      const taken = await videosRepository.createDraft(
        buildDraftData(channel.id),
      );
      jest
        .spyOn(publicIdModule, 'generatePublicId')
        .mockReturnValueOnce(taken.public_id)
        .mockReturnValueOnce('freshPublic');

      const video = await videosRepository.createDraft(
        buildDraftData(channel.id),
      );

      expect(video.public_id).toBe('freshPublic');
      expect(await videoRepository.count()).toBe(2);
    });

    it('should give up after 5 consecutive collisions', async () => {
      const { channel } = await createUserWithChannel(dataSource);
      const taken = await videosRepository.createDraft(
        buildDraftData(channel.id),
      );
      const generator = jest
        .spyOn(publicIdModule, 'generatePublicId')
        .mockReturnValue(taken.public_id);

      await expect(
        videosRepository.createDraft(buildDraftData(channel.id)),
      ).rejects.toThrow(/UQ_videos_public_id/);
      expect(generator).toHaveBeenCalledTimes(5);
    });
  });

  describe('findOwnedById', () => {
    it('should return the video for its owner and null for another user', async () => {
      const owner = await createUserWithChannel(dataSource);
      const stranger = await createUserWithChannel(dataSource);
      const video = await videosRepository.createDraft(
        buildDraftData(owner.channel.id),
      );

      const forOwner = await videosRepository.findOwnedById(
        video.id,
        owner.user.id,
      );
      const forStranger = await videosRepository.findOwnedById(
        video.id,
        stranger.user.id,
      );

      expect(forOwner?.id).toBe(video.id);
      expect(forStranger).toBeNull();
    });
  });

  describe('findReadyByPublicId', () => {
    it('should only return videos in ready status', async () => {
      const { channel } = await createUserWithChannel(dataSource);
      const video = await videosRepository.createDraft(
        buildDraftData(channel.id),
      );

      expect(
        await videosRepository.findReadyByPublicId(video.public_id),
      ).toBeNull();

      await videoRepository.update(video.id, { status: VideoStatus.READY });

      expect(
        (await videosRepository.findReadyByPublicId(video.public_id))?.id,
      ).toBe(video.id);
    });
  });

  describe('updateWhereStatus', () => {
    it('should update the row when it is in the expected status', async () => {
      const { channel } = await createUserWithChannel(dataSource);
      const video = await videosRepository.createDraft(
        buildDraftData(channel.id),
      );

      const affected = await videosRepository.updateWhereStatus(
        video.id,
        VideoStatus.DRAFT,
        { status: VideoStatus.PROCESSING, upload_id: null },
      );

      const reloaded = await videoRepository.findOneByOrFail({ id: video.id });
      expect(affected).toBe(true);
      expect(reloaded.status).toBe(VideoStatus.PROCESSING);
      expect(reloaded.upload_id).toBeNull();
    });

    it('should not touch the row when it is in a different status', async () => {
      const { channel } = await createUserWithChannel(dataSource);
      const video = await videosRepository.createDraft(
        buildDraftData(channel.id),
      );
      await videoRepository.update(video.id, { status: VideoStatus.READY });

      const affected = await videosRepository.updateWhereStatus(
        video.id,
        VideoStatus.DRAFT,
        { status: VideoStatus.FAILED, failure_reason: 'upload_expired' },
      );

      const reloaded = await videoRepository.findOneByOrFail({ id: video.id });
      expect(affected).toBe(false);
      expect(reloaded.status).toBe(VideoStatus.READY);
      expect(reloaded.failure_reason).toBeNull();
    });

    it('should return false for an unknown id', async () => {
      expect(
        await videosRepository.updateWhereStatus(
          randomUUID(),
          VideoStatus.DRAFT,
          { status: VideoStatus.FAILED },
        ),
      ).toBe(false);
    });
  });

  describe('findExpiredDrafts', () => {
    it('should return only drafts created before the cutoff, oldest first', async () => {
      const { channel } = await createUserWithChannel(dataSource);
      const oldest = await videosRepository.createDraft(
        buildDraftData(channel.id),
      );
      const older = await videosRepository.createDraft(
        buildDraftData(channel.id),
      );
      const oldButProcessing = await videosRepository.createDraft(
        buildDraftData(channel.id),
      );
      const recent = await videosRepository.createDraft(
        buildDraftData(channel.id),
      );
      const setCreatedAt = (id: string, hoursAgo: number) =>
        dataSource.query(
          `UPDATE "videos" SET "created_at" = now() - ($2 || ' hours')::interval WHERE "id" = $1`,
          [id, hoursAgo],
        );
      await setCreatedAt(oldest.id, 50);
      await setCreatedAt(older.id, 30);
      await setCreatedAt(oldButProcessing.id, 40);
      await videoRepository.update(oldButProcessing.id, {
        status: VideoStatus.PROCESSING,
      });
      const cutoff = new Date(Date.now() - 24 * 3600 * 1000);

      const expired = await videosRepository.findExpiredDrafts(cutoff, 100);

      expect(expired.map((v) => v.id)).toEqual([oldest.id, older.id]);
      expect(expired.map((v) => v.id)).not.toContain(recent.id);
    });

    it('should respect the batch limit', async () => {
      const { channel } = await createUserWithChannel(dataSource);
      for (let i = 0; i < 3; i++) {
        const video = await videosRepository.createDraft(
          buildDraftData(channel.id),
        );
        await dataSource.query(
          `UPDATE "videos" SET "created_at" = now() - interval '48 hours' WHERE "id" = $1`,
          [video.id],
        );
      }

      const expired = await videosRepository.findExpiredDrafts(new Date(), 2);

      expect(expired).toHaveLength(2);
    });
  });
});
