import { get as httpGet, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { extractSampleFrame, generateSampleVideo } from '../src/test/fixtures';
import { emptyTestBucket, obliterateTestQueues } from '../src/test/test-infra';
import { SAMPLE_METADATA, seedVideo } from '../src/test/video-fixtures';
import { type Video, VideoStatus } from '../src/videos/entities/video.entity';
import {
  createVideosE2eApp,
  registerAndLogin,
  resetThrottler,
  type VideosE2eContext,
} from './helpers/videos-e2e';

/** Parser do superagent que acumula o corpo binário em um Buffer. */
function binaryParser(
  res: unknown,
  callback: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  const stream = res as NodeJS.ReadableStream;
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
}

describe('Videos: public stream and thumbnail (e2e)', () => {
  let context: VideosE2eContext;
  let storage: StorageService;
  let workDir: string;
  let file: Buffer;
  let jpeg: Buffer;
  let video: Video;
  let baseUrl: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'stream-e2e-'));
    const videoPath = join(workDir, 'sample.mp4');
    const jpegPath = join(workDir, 'thumbnail.jpg');
    await generateSampleVideo(videoPath, { seconds: 2, withAudio: true });
    await extractSampleFrame(videoPath, jpegPath);
    file = await readFile(videoPath);
    jpeg = await readFile(jpegPath);

    context = await createVideosE2eApp();
    storage = context.app.get(StorageService);
    await context.app.listen(0);
    const server = context.app.getHttpServer() as unknown as Server;
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
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
      size_bytes: file.length,
      duration_seconds: 2,
      metadata: { ...SAMPLE_METADATA, size_bytes: file.length },
    });
    const thumbnailKey = `videos/${video.id}/thumbnail.jpg`;
    await storage.putObject(video.storage_key, file, 'video/mp4');
    await storage.putObject(thumbnailKey, jpeg, 'image/jpeg');
    await context.dataSource
      .getRepository('Video')
      .update(video.id, { thumbnail_key: thumbnailKey });
  });

  const stream = (range?: string) => {
    const req = request(context.app.getHttpServer())
      .get(`/videos/public/${video.public_id}/stream`)
      .buffer(true)
      .parse(binaryParser);
    return range ? req.set('Range', range) : req;
  };
  const thumbnail = () =>
    request(context.app.getHttpServer())
      .get(`/videos/public/${video.public_id}/thumbnail`)
      .buffer(true)
      .parse(binaryParser);
  const setStatus = (patch: Partial<Video>) =>
    context.dataSource.getRepository('Video').update(video.id, patch);

  describe('GET /videos/public/:publicId/stream', () => {
    it('range-responde-206-com-trecho-exato', async () => {
      const res = await stream('bytes=0-1023').expect(206);

      expect(res.headers['content-range']).toBe(`bytes 0-1023/${file.length}`);
      expect(res.headers['content-length']).toBe('1024');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.headers['etag']).toBeTruthy();
      expect(res.body).toEqual(file.subarray(0, 1024));
    });

    it('range-aberto-e-sufixo', async () => {
      const size = file.length;

      const suffix = await stream('bytes=-500').expect(206);
      const open = await stream(`bytes=${size - 10}-`).expect(206);

      expect(suffix.headers['content-range']).toBe(
        `bytes ${size - 500}-${size - 1}/${size}`,
      );
      expect(suffix.body).toEqual(file.subarray(size - 500));
      expect(open.headers['content-length']).toBe('10');
      expect(open.body).toEqual(file.subarray(size - 10));
    });

    it('sem-range-responde-200-com-arquivo-inteiro', async () => {
      const res = await stream().expect(200);

      expect(res.headers['content-length']).toBe(String(file.length));
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-type']).toBe('video/mp4');
      expect((res.body as Buffer).equals(file)).toBe(true);
    });

    it('range-fora-do-tamanho-responde-416', async () => {
      const res = await request(context.app.getHttpServer())
        .get(`/videos/public/${video.public_id}/stream`)
        .set('Range', `bytes=${file.length}-`)
        .expect(416);
      const body = res.body as ErrorBody;

      expect(body).toEqual({
        statusCode: 416,
        error: 'RANGE_NOT_SATISFIABLE',
        message: 'Requested range not satisfiable',
      });
      expect(res.headers['content-range']).toBe(`bytes */${file.length}`);
    });

    it('abortar-conexao-nao-deixa-sockets-pendentes', async () => {
      const url = `${baseUrl}/videos/public/${video.public_id}/stream`;
      for (let i = 0; i < 20; i++) {
        await new Promise<void>((resolve, reject) => {
          const req = httpGet(url, (res) => {
            res.once('data', () => req.destroy());
          });
          req.on('close', () => resolve());
          req.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ECONNRESET') resolve();
            else reject(err);
          });
        });
      }

      const res = await stream('bytes=0-1023').expect(206);

      expect(res.body).toEqual(file.subarray(0, 1024));
    });

    it('video-fora-de-ready-recebe-404', async () => {
      await setStatus({ status: VideoStatus.PROCESSING });

      const res = await request(context.app.getHttpServer())
        .get(`/videos/public/${video.public_id}/stream`)
        .set('Range', 'bytes=0-1023')
        .expect(404);

      expect((res.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
    });
  });

  describe('GET /videos/public/:publicId/thumbnail', () => {
    it('thumbnail-de-video-ready', async () => {
      const res = await thumbnail().expect(200);
      const body = res.body as Buffer;

      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(res.headers['content-length']).toBe(String(jpeg.length));
      expect(body.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect(body.equals(jpeg)).toBe(true);
    });

    it('thumbnail-de-video-processing-recebe-404', async () => {
      await setStatus({ status: VideoStatus.PROCESSING });
      const processing = await request(context.app.getHttpServer())
        .get(`/videos/public/${video.public_id}/thumbnail`)
        .expect(404);

      await setStatus({ status: VideoStatus.READY, thumbnail_key: null });
      const noThumbnail = await request(context.app.getHttpServer())
        .get(`/videos/public/${video.public_id}/thumbnail`)
        .expect(404);

      expect((processing.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
      expect((noThumbnail.body as ErrorBody).error).toBe('VIDEO_NOT_FOUND');
    });
  });
});
