import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { generateSampleVideo } from '../src/test/fixtures';
import {
  emptyTestBucket,
  obliterateTestQueues,
  testStorageConfig,
} from '../src/test/test-infra';
import { SAMPLE_METADATA, seedVideo } from '../src/test/video-fixtures';
import { type Video, VideoStatus } from '../src/videos/entities/video.entity';
import {
  createVideosE2eApp,
  registerAndLogin,
  resetThrottler,
  type VideosE2eContext,
} from './helpers/videos-e2e';

interface ErrorBody {
  error: string;
}

describe('Videos: GET /videos/public/:publicId/download (e2e)', () => {
  let context: VideosE2eContext;
  let storage: StorageService;
  let workDir: string;
  let file: Buffer;
  let video: Video;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'download-e2e-'));
    const videoPath = join(workDir, 'sample.mp4');
    await generateSampleVideo(videoPath, { seconds: 2, withAudio: true });
    file = await readFile(videoPath);
    context = await createVideosE2eApp();
    storage = context.app.get(StorageService);
  }, 30000);

  afterAll(async () => {
    await emptyTestBucket();
    await obliterateTestQueues();
    await context.app.close();
    await rm(workDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await context.dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(context.dataSource);
    const owner = await registerAndLogin(context);
    resetThrottler(context);
    video = await seedVideo(context.dataSource, owner.channelId, {
      status: VideoStatus.READY,
      original_filename: 'meu-video.mp4',
      size_bytes: file.length,
      duration_seconds: 2,
      metadata: { ...SAMPLE_METADATA, size_bytes: file.length },
    });
    await storage.putObject(video.storage_key, file, 'video/mp4');
  });

  const download = (publicId = video.public_id) =>
    request(context.app.getHttpServer())
      .get(`/videos/public/${publicId}/download`)
      .redirects(0);

  it('redireciona-para-url-pre-assinada', async () => {
    const res = await download().expect(302);
    const location = res.headers['location'];
    const config = testStorageConfig();

    expect(location.startsWith(config.publicEndpoint)).toBe(true);
    expect(location).toContain(`/${config.bucket}/videos/${video.id}/original`);
    const query = new URL(location).searchParams;
    expect(query.get('response-content-disposition')).toMatch(/^attachment/);
    expect(query.get('X-Amz-Expires')).toBe('300');
  });

  it('url-do-location-entrega-o-arquivo-como-attachment', async () => {
    const res = await download().expect(302);

    const fileResponse = await fetch(res.headers['location']);
    const body = Buffer.from(await fileResponse.arrayBuffer());

    expect(fileResponse.status).toBe(200);
    expect(fileResponse.headers.get('content-disposition')).toMatch(
      /^attachment; filename="meu-video.mp4"/,
    );
    expect(body.equals(file)).toBe(true);
  });

  it('video-fora-de-ready-ou-inexistente-recebe-404', async () => {
    await context.dataSource
      .getRepository('Video')
      .update(video.id, { status: VideoStatus.PROCESSING });

    const notReady = await download().expect(404);
    const unknown = await download('AAAAAAAAAAA').expect(404);

    expect(notReady.headers['location']).toBeUndefined();
    expect((notReady.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
    expect((unknown.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
  });
});
