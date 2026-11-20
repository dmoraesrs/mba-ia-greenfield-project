import request from 'supertest';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { emptyTestBucket, obliterateTestQueues } from '../src/test/test-infra';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import {
  type AuthenticatedUser,
  createVideosE2eApp,
  registerAndLogin,
  resetThrottler,
  type VideosE2eContext,
} from './helpers/videos-e2e';

interface CreateVideoBody {
  video: Record<string, unknown> & { id: string; public_id: string };
  upload: {
    part_size_bytes: number;
    part_count: number;
    parts: { part_number: number; url: string }[];
    expires_at: string;
  };
}

interface ErrorBody {
  error: string;
  message: string | string[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Videos: POST /videos (e2e)', () => {
  let context: VideosE2eContext;
  let owner: AuthenticatedUser;

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
    resetThrottler(context);
    owner = await registerAndLogin(context);
  });

  const countVideos = () => context.dataSource.getRepository(Video).count();

  it('cria-rascunho-e-devolve-urls-das-partes', async () => {
    const res = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        filename: 'a.mp4',
        mime_type: 'video/mp4',
        size_bytes: 134217728,
      })
      .expect(201);
    const body = res.body as CreateVideoBody;

    expect(body.video).toMatchObject({
      status: 'draft',
      original_filename: 'a.mp4',
      mime_type: 'video/mp4',
      size_bytes: 134217728,
      has_thumbnail: false,
      duration_seconds: null,
      metadata: null,
    });
    expect(body.video.public_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(body.video.id).toMatch(UUID_PATTERN);
    expect(body.upload.part_size_bytes).toBe(67108864);
    expect(body.upload.part_count).toBe(2);
    expect(body.upload.parts.map((p) => p.part_number)).toEqual([1, 2]);
    body.upload.parts.forEach((p) => expect(typeof p.url).toBe('string'));
    expect(new Date(body.upload.expires_at).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(body.video).not.toHaveProperty('storage_key');
    expect(body.video).not.toHaveProperty('upload_id');

    const row = await context.dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: body.video.id });
    expect(row.status).toBe(VideoStatus.DRAFT);
    expect(row.channel_id).toBe(owner.channelId);
    expect(row.storage_key).toBe(`videos/${row.id}/original`);
    expect(row.upload_id).not.toBeNull();
    expect(row.part_count).toBe(2);

    const storage = context.app.get(StorageService);
    await expect(
      storage.listParts(row.storage_key, row.upload_id!),
    ).resolves.toEqual([]);
  });

  it('rejeita-mime-fora-da-lista', async () => {
    const res = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ filename: 'a.avi', mime_type: 'video/avi', size_bytes: 1024 })
      .expect(400);
    const body = res.body as ErrorBody;

    expect(body.error).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.message)).toBe(true);
    expect((body.message as string[]).join(' ')).toContain('mime_type');
    expect(await countVideos()).toBe(0);
  });

  it('rejeita-tamanho-acima-de-10gb', async () => {
    const res = await request(context.app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        filename: 'a.mp4',
        mime_type: 'video/mp4',
        size_bytes: 10737418241,
      })
      .expect(400);
    const body = res.body as ErrorBody;

    expect(body.error).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(body.message)).toContain('size_bytes');
    expect(await countVideos()).toBe(0);
  });

  it('exige-autenticacao', async () => {
    await request(context.app.getHttpServer())
      .post('/videos')
      .send({ filename: 'a.mp4', mime_type: 'video/mp4', size_bytes: 1024 })
      .expect(401);

    expect(await countVideos()).toBe(0);
  });
});
