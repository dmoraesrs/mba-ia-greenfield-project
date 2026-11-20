import request from 'supertest';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { emptyTestBucket, obliterateTestQueues } from '../src/test/test-infra';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import {
  type AuthenticatedUser,
  createVideosE2eApp,
  putPart,
  registerAndLogin,
  resetThrottler,
  type VideosE2eContext,
} from './helpers/videos-e2e';

const PART_SIZE = 5 * 1024 * 1024;

interface CreatedVideo {
  video: { id: string };
  upload: { parts: { part_number: number; url: string }[] };
}

interface UploadedPartsBody {
  parts: { part_number: number; etag: string; size_bytes: number }[];
}

interface SignPartsBody {
  parts: { part_number: number; url: string }[];
  expires_at: string;
}

interface ErrorBody {
  error: string;
}

const unquote = (etag: string) => etag.replace(/"/g, '');

describe('Videos: upload parts (e2e)', () => {
  let context: VideosE2eContext;
  let owner: AuthenticatedUser;
  let stranger: AuthenticatedUser;
  let created: CreatedVideo;

  beforeAll(async () => {
    context = await createVideosE2eApp({ video: { partSizeBytes: PART_SIZE } });
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
    const res = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        filename: 'a.mp4',
        mime_type: 'video/mp4',
        size_bytes: 2 * PART_SIZE,
      })
      .expect(201);
    created = res.body as CreatedVideo;
  });

  const server = () => context.app.getHttpServer();
  const listParts = (token: string, id = created.video.id) =>
    request(server())
      .get(`/videos/${id}/upload/parts`)
      .set('Authorization', `Bearer ${token}`);
  const signParts = (token: string, partNumbers: unknown) =>
    request(server())
      .post(`/videos/${created.video.id}/upload/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ part_numbers: partNumbers });

  it('lista-partes-recebidas-pelo-storage', async () => {
    const etag = await putPart(created.upload.parts[0].url, PART_SIZE);
    expect(etag).not.toBe('');

    const res = await listParts(owner.accessToken).expect(200);
    const body = res.body as UploadedPartsBody;

    expect(body.parts).toHaveLength(1);
    expect(body.parts[0].part_number).toBe(1);
    expect(unquote(body.parts[0].etag)).toBe(unquote(etag));
    expect(body.parts[0].size_bytes).toBe(PART_SIZE);
  });

  it('reassina-parte-pendente', async () => {
    const res = await signParts(owner.accessToken, [2]).expect(200);
    const body = res.body as SignPartsBody;

    expect(body.parts).toHaveLength(1);
    expect(body.parts[0].part_number).toBe(2);
    expect(typeof body.parts[0].url).toBe('string');
    const minutesAhead =
      (new Date(body.expires_at).getTime() - Date.now()) / 60000;
    expect(minutesAhead).toBeGreaterThan(55);
    expect(minutesAhead).toBeLessThan(65);

    await expect(putPart(body.parts[0].url, PART_SIZE)).resolves.not.toBe('');
  });

  it('rejeita-parte-acima-do-part-count', async () => {
    const res = await signParts(owner.accessToken, [3]).expect(400);

    expect((res.body as ErrorBody).error).toBe('INVALID_PART_NUMBER');
  });

  it('outro-usuario-recebe-404', async () => {
    const list = await listParts(stranger.accessToken).expect(404);
    const sign = await signParts(stranger.accessToken, [1]).expect(404);

    expect((list.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
    expect((sign.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
  });

  it('video-fora-de-draft-recebe-409', async () => {
    await context.dataSource
      .getRepository(Video)
      .update(created.video.id, { status: VideoStatus.PROCESSING });

    const list = await listParts(owner.accessToken).expect(409);
    const sign = await signParts(owner.accessToken, [1]).expect(409);

    expect((list.body as ErrorBody).error).toBe('VIDEO_NOT_IN_DRAFT');
    expect((sign.body as ErrorBody).error).toBe('VIDEO_NOT_IN_DRAFT');
  });

  it('valida-entrada', async () => {
    const badId = await listParts(owner.accessToken, 'nao-e-uuid').expect(400);
    const emptyList = await signParts(owner.accessToken, []).expect(400);
    await request(server())
      .get(`/videos/${created.video.id}/upload/parts`)
      .expect(401);

    expect((badId.body as ErrorBody).error).toBe('VALIDATION_ERROR');
    expect((emptyList.body as ErrorBody).error).toBe('VALIDATION_ERROR');
  });
});
