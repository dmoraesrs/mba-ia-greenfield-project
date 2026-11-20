import type { TestingModule } from '@nestjs/testing';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { generateSampleVideo } from '../src/test/fixtures';
import { emptyTestBucket, obliterateTestQueues } from '../src/test/test-infra';
import { createWorkerTestingModule } from '../src/test/worker-test-module';
import {
  type AuthenticatedUser,
  createVideosE2eApp,
  registerAndLogin,
  resetThrottler,
  type VideosE2eContext,
} from './helpers/videos-e2e';

const PART_SIZE = 5 * 1024 * 1024;
const READY_TIMEOUT_MS = 60_000;

interface VideoBody {
  id: string;
  public_id: string;
  status: string;
  duration_seconds: number | null;
  metadata: { width: number; height: number } | null;
  has_thumbnail: boolean;
  failure_reason: string | null;
}

interface CreatedVideo {
  video: VideoBody;
  upload: {
    part_count: number;
    parts: { part_number: number; url: string }[];
  };
}

function binaryParser(
  res: unknown,
  callback: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  const stream = res as NodeJS.ReadableStream;
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Videos: upload -> worker -> streaming flow (e2e)', () => {
  let context: VideosE2eContext;
  let worker: TestingModule;
  let owner: AuthenticatedUser;
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'flow-e2e-'));
    context = await createVideosE2eApp({ video: { partSizeBytes: PART_SIZE } });
    worker = await createWorkerTestingModule().compile();
    await worker.init();
  }, 30000);

  afterAll(async () => {
    await worker.close();
    await context.app.close();
    await obliterateTestQueues();
    await emptyTestBucket();
    await rm(workDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await context.dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(context.dataSource);
    owner = await registerAndLogin(context);
    resetThrottler(context);
  });

  const server = () => context.app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${owner.accessToken}` });

  /** Inicia, envia as partes direto ao storage e conclui o upload. */
  async function uploadThroughApi(
    file: Buffer,
    filename: string,
  ): Promise<CreatedVideo> {
    const created = await request(server())
      .post('/videos')
      .set(auth())
      .send({ filename, mime_type: 'video/mp4', size_bytes: file.length })
      .expect(201);
    const body = created.body as CreatedVideo;

    const parts = await Promise.all(
      body.upload.parts.map(async ({ part_number, url }) => {
        const chunk = file.subarray(
          (part_number - 1) * PART_SIZE,
          part_number * PART_SIZE,
        );
        const response = await fetch(url, {
          method: 'PUT',
          body: new Uint8Array(chunk),
        });
        expect(response.status).toBe(200);
        return { part_number, etag: response.headers.get('etag')! };
      }),
    );

    await request(server())
      .post(`/videos/${body.video.id}/upload/complete`)
      .set(auth())
      .send({ parts })
      .expect(200);
    return body;
  }

  async function waitUntilProcessed(id: string): Promise<VideoBody> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      resetThrottler(context);
      const res = await request(server())
        .get(`/videos/${id}`)
        .set(auth())
        .expect(200);
      const video = res.body as VideoBody;
      if (video.status === 'ready' || video.status === 'failed') return video;
      if (Date.now() > deadline) {
        throw new Error(`Video ${id} still ${video.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  it('valid video is uploaded in 2 parts, processed to ready, streamed with 206 and downloadable', async () => {
    const path = join(workDir, 'sample.mp4');
    await generateSampleVideo(path, {
      seconds: 2,
      withAudio: true,
      videoBitrate: '26M',
    });
    const file = await readFile(path);
    expect(file.length).toBeGreaterThan(PART_SIZE);

    const created = await uploadThroughApi(file, 'sample.mp4');
    expect(created.upload.part_count).toBe(2);

    const video = await waitUntilProcessed(created.video.id);
    expect(video.status).toBe('ready');
    expect(video.duration_seconds).toBeGreaterThanOrEqual(1.9);
    expect(video.duration_seconds).toBeLessThanOrEqual(2.1);
    expect(video.metadata?.width).toBe(320);
    expect(video.has_thumbnail).toBe(true);

    const streamed = await request(server())
      .get(`/videos/public/${video.public_id}/stream`)
      .set('Range', 'bytes=0-99')
      .buffer(true)
      .parse(binaryParser)
      .expect(206);
    expect(streamed.body).toEqual(file.subarray(0, 100));

    const thumbnail = await request(server())
      .get(`/videos/public/${video.public_id}/thumbnail`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(thumbnail.headers['content-type']).toBe('image/jpeg');
    expect((thumbnail.body as Buffer).subarray(0, 2)).toEqual(
      Buffer.from([0xff, 0xd8]),
    );

    const download = await request(server())
      .get(`/videos/public/${video.public_id}/download`)
      .redirects(0)
      .expect(302);
    const fileResponse = await fetch(download.headers['location']);
    const downloaded = Buffer.from(await fileResponse.arrayBuffer());
    expect(fileResponse.headers.get('content-disposition')).toMatch(
      /^attachment; filename="sample.mp4"/,
    );
    expect(downloaded.equals(file)).toBe(true);
  }, 90_000);

  it('text file declared as video/mp4 ends failed with invalid_video_file', async () => {
    const file = Buffer.from('definitely not a video\n'.repeat(500));

    const created = await uploadThroughApi(file, 'fake.mp4');
    const video = await waitUntilProcessed(created.video.id);

    expect(video.status).toBe('failed');
    expect(video.failure_reason).toMatch(/^invalid_video_file:/);
  }, 90_000);
});
