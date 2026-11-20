import { ConfigModule, type ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from './storage.config';
import queueConfig from './queue.config';
import videoConfig from './video.config';

const MANAGED_KEYS = [
  'STORAGE_ENDPOINT',
  'STORAGE_PUBLIC_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
  'QUEUE_HOST',
  'QUEUE_PORT',
  'QUEUE_PREFIX',
  'VIDEO_WORKER_CONCURRENCY',
  'UPLOAD_PART_URL_EXPIRATION_SECONDS',
  'DOWNLOAD_URL_EXPIRATION_SECONDS',
  'UPLOAD_EXPIRATION_HOURS',
  'UPLOAD_EXPIRATION_SWEEP_INTERVAL_MS',
] as const;

interface LoadedConfigs {
  storage: ConfigType<typeof storageConfig>;
  queue: ConfigType<typeof queueConfig>;
  video: ConfigType<typeof videoConfig>;
}

const loadConfigs = async (
  env: Partial<Record<(typeof MANAGED_KEYS)[number], string>>,
): Promise<LoadedConfigs> => {
  for (const key of MANAGED_KEYS) delete process.env[key];
  Object.assign(process.env, env);

  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        load: [storageConfig, queueConfig, videoConfig],
      }),
    ],
  }).compile();

  const configs: LoadedConfigs = {
    storage: module.get(storageConfig.KEY),
    queue: module.get(queueConfig.KEY),
    video: module.get(videoConfig.KEY),
  };
  await module.close();
  return configs;
};

describe('storage, queue and video config namespaces', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should map STORAGE_* variables to the storage namespace', async () => {
    const { storage } = await loadConfigs({
      STORAGE_ENDPOINT: 'http://rustfs:9000',
      STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000',
      STORAGE_REGION: 'sa-east-1',
      STORAGE_BUCKET: 'videos-bucket',
      STORAGE_ACCESS_KEY: 'ak',
      STORAGE_SECRET_KEY: 'sk',
    });

    expect(storage).toEqual({
      endpoint: 'http://rustfs:9000',
      publicEndpoint: 'http://localhost:9000',
      region: 'sa-east-1',
      bucket: 'videos-bucket',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
    });
  });

  it('should coerce queue numeric variables to numbers', async () => {
    const { queue } = await loadConfigs({
      QUEUE_HOST: 'valkey',
      QUEUE_PORT: '6380',
      QUEUE_PREFIX: 'streamtube-test',
      VIDEO_WORKER_CONCURRENCY: '4',
    });

    expect(queue).toEqual({
      host: 'valkey',
      port: 6380,
      prefix: 'streamtube-test',
      workerConcurrency: 4,
    });
  });

  it('should expose queue defaults when variables are absent', async () => {
    const { queue } = await loadConfigs({});

    expect(queue.prefix).toBe('streamtube');
    expect(queue.workerConcurrency).toBe(2);
    expect(queue.port).toBe(6379);
  });

  it('should expose the 10GB limit and fixed part size in the video namespace', async () => {
    const { video } = await loadConfigs({});

    expect(video.maxSizeBytes).toBe(10737418240);
    expect(video.partSizeBytes).toBe(67108864);
    expect(video.allowedMimeTypes).toEqual([
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'video/x-matroska',
    ]);
    expect(video.uploadExpirationHours).toBe(24);
  });

  it('should coerce video expiration variables to numbers', async () => {
    const { video } = await loadConfigs({
      UPLOAD_PART_URL_EXPIRATION_SECONDS: '1800',
      DOWNLOAD_URL_EXPIRATION_SECONDS: '60',
      UPLOAD_EXPIRATION_HOURS: '12',
      UPLOAD_EXPIRATION_SWEEP_INTERVAL_MS: '60000',
    });

    expect(video.partUrlExpirationSeconds).toBe(1800);
    expect(video.downloadUrlExpirationSeconds).toBe(60);
    expect(video.uploadExpirationHours).toBe(12);
    expect(video.uploadExpirationSweepIntervalMs).toBe(60000);
  });
});
