import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { VIDEO_PROCESSING_QUEUE } from '../src/queue/queue.constants';
import { StorageObjectNotFoundError } from '../src/storage/storage.errors';
import { StorageService } from '../src/storage/storage.service';
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

interface VideoBody {
  id: string;
  status: string;
}

interface ErrorBody {
  error: string;
}

describe('Videos: POST /videos/:id/upload/complete (e2e)', () => {
  let context: VideosE2eContext;
  let queue: Queue;
  let storage: StorageService;
  let owner: AuthenticatedUser;
  let stranger: AuthenticatedUser;
  let created: CreatedVideo;

  beforeAll(async () => {
    context = await createVideosE2eApp({ video: { partSizeBytes: PART_SIZE } });
    queue = context.app.get(getQueueToken(VIDEO_PROCESSING_QUEUE));
    storage = context.app.get(StorageService);
  });

  afterAll(async () => {
    await emptyTestBucket();
    await obliterateTestQueues();
    await context.app.close();
  });

  beforeEach(async () => {
    await context.dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(context.dataSource);
    await obliterateTestQueues();
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

  const uploadParts = (sizes: number[]) =>
    Promise.all(
      sizes.map((size, i) => putPart(created.upload.parts[i].url, size)),
    );
  const complete = (
    token: string,
    parts: { part_number: number; etag: string }[] | [],
    id = created.video.id,
  ) =>
    request(context.app.getHttpServer())
      .post(`/videos/${id}/upload/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts });
  const row = () =>
    context.dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: created.video.id });

  it('conclui-e-enfileira-processamento', async () => {
    const [etag1, etag2] = await uploadParts([PART_SIZE, PART_SIZE]);

    const res = await complete(owner.accessToken, [
      { part_number: 2, etag: etag2 },
      { part_number: 1, etag: etag1 },
    ]).expect(200);
    const body = res.body as VideoBody;

    expect(body.id).toBe(created.video.id);
    expect(body.status).toBe('processing');
    const job = await queue.getJob(created.video.id);
    expect(job?.name).toBe('process-video');
    expect(job?.data).toEqual({ videoId: created.video.id });
    const video = await row();
    expect(video.status).toBe(VideoStatus.PROCESSING);
    expect(video.upload_id).toBeNull();
    await expect(storage.headObject(video.storage_key)).resolves.toMatchObject({
      contentLength: 2 * PART_SIZE,
    });
  });

  it('tamanho-real-diferente-do-declarado', async () => {
    const [etag1, etag2] = await uploadParts([PART_SIZE, PART_SIZE + 1]);

    const res = await complete(owner.accessToken, [
      { part_number: 1, etag: etag1 },
      { part_number: 2, etag: etag2 },
    ]).expect(422);

    expect((res.body as ErrorBody).error).toBe('UPLOAD_SIZE_MISMATCH');
    const video = await row();
    expect(video.status).toBe(VideoStatus.FAILED);
    expect(video.failure_reason).toBe('upload_size_mismatch');
    await expect(storage.headObject(video.storage_key)).rejects.toBeInstanceOf(
      StorageObjectNotFoundError,
    );
    expect(await queue.getJob(created.video.id)).toBeUndefined();
  });

  it('etag-errado-mantem-draft', async () => {
    const [etag1, etag2] = await uploadParts([PART_SIZE, PART_SIZE]);

    const res = await complete(owner.accessToken, [
      { part_number: 1, etag: etag1 },
      { part_number: 2, etag: '"00000000000000000000000000000000"' },
    ]).expect(400);

    expect((res.body as ErrorBody).error).toBe('INVALID_UPLOAD_PARTS');
    const video = await row();
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.upload_id).not.toBeNull();
    expect(await queue.getJob(created.video.id)).toBeUndefined();

    const retry = await complete(owner.accessToken, [
      { part_number: 1, etag: etag1 },
      { part_number: 2, etag: etag2 },
    ]).expect(200);
    expect((retry.body as VideoBody).status).toBe('processing');
  });

  it('segunda-conclusao-recebe-409', async () => {
    const [etag1, etag2] = await uploadParts([PART_SIZE, PART_SIZE]);
    const parts = [
      { part_number: 1, etag: etag1 },
      { part_number: 2, etag: etag2 },
    ];
    await complete(owner.accessToken, parts).expect(200);

    const res = await complete(owner.accessToken, parts).expect(409);

    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_IN_DRAFT');
    const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
    expect(counts.waiting + counts.delayed + counts.active).toBe(1);
    expect((await queue.getJob(created.video.id))?.id).toBe(created.video.id);
  });

  it('outro-usuario-recebe-404', async () => {
    const [etag1, etag2] = await uploadParts([PART_SIZE, PART_SIZE]);

    const res = await complete(stranger.accessToken, [
      { part_number: 1, etag: etag1 },
      { part_number: 2, etag: etag2 },
    ]).expect(404);

    expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
    expect((await row()).status).toBe(VideoStatus.DRAFT);
  });

  it('valida-entrada', async () => {
    const empty = await complete(owner.accessToken, []).expect(400);
    const badId = await complete(
      owner.accessToken,
      [{ part_number: 1, etag: '"x"' }],
      'nao-e-uuid',
    ).expect(400);
    await request(context.app.getHttpServer())
      .post(`/videos/${created.video.id}/upload/complete`)
      .send({ parts: [{ part_number: 1, etag: '"x"' }] })
      .expect(401);

    expect((empty.body as ErrorBody).error).toBe('VALIDATION_ERROR');
    expect((badId.body as ErrorBody).error).toBe('VALIDATION_ERROR');
  });
});
