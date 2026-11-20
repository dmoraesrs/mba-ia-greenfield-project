import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import {
  buildDraftData,
  createUserWithChannel,
  VIDEO_TEST_ENTITIES,
} from '../../test/video-fixtures';
import { Video, type VideoMetadata, VideoStatus } from './video.entity';

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channel: Channel;

  beforeAll(async () => {
    dataSource = createTestDataSource(VIDEO_TEST_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
    ({ channel } = await createUserWithChannel(dataSource));
  });

  const insertVideo = (overrides: Partial<Video> = {}) =>
    videoRepository.save(
      videoRepository.create({
        ...buildDraftData(channel.id),
        public_id: 'abcdefghijk',
        ...overrides,
      }),
    );

  it('should default to draft with processing fields empty', async () => {
    const saved = await insertVideo();

    const video = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.duration_seconds).toBeNull();
    expect(video.metadata).toBeNull();
    expect(video.thumbnail_key).toBeNull();
    expect(video.failure_reason).toBeNull();
  });

  it('should reject two videos with the same public_id', async () => {
    await insertVideo({ public_id: 'samePublicI' });

    await expect(
      insertVideo({ public_id: 'samePublicI' }),
    ).rejects.toBeInstanceOf(QueryFailedError);
  });

  it.each([0, 10737418241])(
    'should reject size_bytes = %d',
    async (sizeBytes) => {
      await expect(
        insertVideo({ size_bytes: sizeBytes, part_count: 1 }),
      ).rejects.toThrow(/CHK_videos_size_bytes/);
    },
  );

  it('should accept size_bytes at the 10GB limit', async () => {
    const saved = await insertVideo({
      size_bytes: 10737418240,
      part_count: 160,
    });

    const video = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(video.size_bytes).toBe(10737418240);
  });

  it.each([0, 10001])('should reject part_count = %d', async (partCount) => {
    await expect(insertVideo({ part_count: partCount })).rejects.toThrow(
      /CHK_videos_part_count/,
    );
  });

  it('should delete the videos of a channel when the channel is deleted', async () => {
    const saved = await insertVideo();

    await dataSource.getRepository(Channel).delete({ id: channel.id });

    expect(await videoRepository.findOneBy({ id: saved.id })).toBeNull();
  });

  it('should round-trip metadata as jsonb and size_bytes as a number', async () => {
    const metadata: VideoMetadata = {
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      audio_codec: null,
      bitrate: 4_500_000,
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      frame_rate: 29.97,
      size_bytes: 134217728,
    };
    const saved = await insertVideo({ metadata, duration_seconds: 12.5 });

    const video = await videoRepository.findOneByOrFail({ id: saved.id });
    expect(video.metadata).toEqual(metadata);
    expect(video.duration_seconds).toBe(12.5);
    expect(typeof video.size_bytes).toBe('number');
    expect(video.size_bytes).toBe(saved.size_bytes);
  });
});
