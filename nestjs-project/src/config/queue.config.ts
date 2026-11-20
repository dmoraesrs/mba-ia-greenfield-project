import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  host: process.env.QUEUE_HOST ?? 'valkey',
  port: parseInt(process.env.QUEUE_PORT ?? '6379', 10),
  prefix: process.env.QUEUE_PREFIX ?? 'streamtube',
  workerConcurrency: parseInt(process.env.VIDEO_WORKER_CONCURRENCY ?? '2', 10),
}));
