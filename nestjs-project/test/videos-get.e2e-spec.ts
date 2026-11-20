import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { emptyTestBucket, obliterateTestQueues } from '../src/test/test-infra';
import { SAMPLE_METADATA, seedVideo } from '../src/test/video-fixtures';
import { VideoStatus } from '../src/videos/entities/video.entity';
import {
  type AuthenticatedUser,
  createVideosE2eApp,
  registerAndLogin,
  resetThrottler,
  type VideosE2eContext,
} from './helpers/videos-e2e';

type Body = Record<string, unknown>;

describe('Videos: GET /videos/:id and GET /videos/public/:publicId (e2e)', () => {
  let context: VideosE2eContext;
  let owner: AuthenticatedUser;
  let stranger: AuthenticatedUser;

  beforeAll(async () => {
    context = await createVideosE2eApp();
  });

  afterAll(async () => {
    await emptyTestBucket();
    await obliterateTestQueues();
    await context.app.close();
  });

  beforeEach(async () => {
    await context.dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(context.dataSource);
    owner = await registerAndLogin(context);
    stranger = await registerAndLogin(context);
    resetThrottler(context);
  });

  const server = () => context.app.getHttpServer();
  const getOwned = (id: string, token?: string) => {
    const req = request(server()).get(`/videos/${id}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const getPublic = (publicId: string) =>
    request(server()).get(`/videos/public/${publicId}`);

  describe('GET /videos/:id', () => {
    it('dono-acompanha-status-processing', async () => {
      const video = await seedVideo(context.dataSource, owner.channelId, {
        status: VideoStatus.PROCESSING,
      });

      const res = await getOwned(video.id, owner.accessToken).expect(200);
      const body = res.body as Body;

      expect(body).toMatchObject({
        id: video.id,
        status: 'processing',
        metadata: null,
        duration_seconds: null,
        has_thumbnail: false,
        failure_reason: null,
      });
      expect(body).not.toHaveProperty('storage_key');
      expect(body).not.toHaveProperty('upload_id');
      expect(body).not.toHaveProperty('channel_id');
    });

    it('dono-ve-ready-com-metadados-e-thumbnail', async () => {
      const id = randomUUID();
      const video = await seedVideo(context.dataSource, owner.channelId, {
        id,
        status: VideoStatus.READY,
        duration_seconds: 2,
        metadata: SAMPLE_METADATA,
        thumbnail_key: `videos/${id}/thumbnail.jpg`,
      });

      const res = await getOwned(video.id, owner.accessToken).expect(200);

      expect(res.body).toMatchObject({
        status: 'ready',
        duration_seconds: 2,
        metadata: SAMPLE_METADATA,
        has_thumbnail: true,
      });
    });

    it('dono-ve-motivo-de-falha', async () => {
      const video = await seedVideo(context.dataSource, owner.channelId, {
        status: VideoStatus.FAILED,
        failure_reason:
          'invalid_video_file: Invalid data found when processing input',
      });

      const res = await getOwned(video.id, owner.accessToken).expect(200);
      const body = res.body as Body;

      expect(body.status).toBe('failed');
      expect(body.failure_reason).toMatch(/^invalid_video_file:/);
    });

    it('outro-usuario-e-id-invalido', async () => {
      const video = await seedVideo(context.dataSource, owner.channelId, {
        status: VideoStatus.READY,
      });

      const stranger404 = await getOwned(video.id, stranger.accessToken).expect(
        404,
      );
      const unknown404 = await getOwned(randomUUID(), owner.accessToken).expect(
        404,
      );
      const badId = await getOwned('nao-e-uuid', owner.accessToken).expect(400);
      await getOwned(video.id).expect(401);

      expect((stranger404.body as Body).error).toBe('VIDEO_NOT_FOUND');
      expect((unknown404.body as Body).error).toBe('VIDEO_NOT_FOUND');
      expect((badId.body as Body).error).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /videos/public/:publicId', () => {
    it('anonimo-ve-dados-publicos-de-video-ready', async () => {
      const video = await seedVideo(context.dataSource, owner.channelId, {
        status: VideoStatus.READY,
        duration_seconds: 2,
        metadata: SAMPLE_METADATA,
      });

      const res = await getPublic(video.public_id).expect(200);
      const body = res.body as Body;

      expect(body).toMatchObject({
        public_id: video.public_id,
        mime_type: video.mime_type,
        duration_seconds: 2,
        metadata: SAMPLE_METADATA,
      });
      expect(new Date(body.created_at as string).toISOString()).toBe(
        body.created_at,
      );
      for (const key of ['id', 'channel_id', 'storage_key', 'upload_id']) {
        expect(body).not.toHaveProperty(key);
      }
    });

    it('mesma-resposta-404-sem-revelar-existencia', async () => {
      const processing = await seedVideo(context.dataSource, owner.channelId, {
        status: VideoStatus.PROCESSING,
      });

      const notReady = await getPublic(processing.public_id).expect(404);
      const unknown = await getPublic('AAAAAAAAAAA').expect(404);
      const malformed = await getPublic('curto!').expect(404);

      expect((notReady.body as Body).error).toBe('VIDEO_NOT_FOUND');
      expect(unknown.body).toEqual(notReady.body);
      expect(malformed.body).toEqual(notReady.body);
    });
  });
});
