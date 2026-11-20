import type { ValidationError } from 'joi';
import { envValidationSchema } from './env.validation';

const requiredEnv = {
  DB_USERNAME: 'user',
  DB_PASSWORD: 'pass',
  DB_NAME: 'db',
  JWT_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  STORAGE_ENDPOINT: 'http://minio:9000',
  STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000',
  STORAGE_BUCKET: 'streamtube-test',
  STORAGE_ACCESS_KEY: 'access-key',
  STORAGE_SECRET_KEY: 'secret-key',
};

const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(
    { ...requiredEnv, ...env },
    { allowUnknown: true, abortEarly: false },
  );

const validateWithout = (...keys: (keyof typeof requiredEnv)[]) => {
  const env: Record<string, string> = { ...requiredEnv };
  for (const key of keys) delete env[key];
  return envValidationSchema.validate(env, {
    allowUnknown: true,
    abortEarly: false,
  });
};

describe('envValidationSchema — SWAGGER_ENABLED', () => {
  it('should reject SWAGGER_ENABLED with an invalid value', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'invalid' });
    expect(error).toBeDefined();
    expect(error!.message).toContain('SWAGGER_ENABLED');
  });

  it('should accept SWAGGER_ENABLED=true', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });
    expect(error).toBeUndefined();
  });

  it('should accept SWAGGER_ENABLED=false', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'false' });
    expect(error).toBeUndefined();
  });

  it('should apply default false when SWAGGER_ENABLED is not set', () => {
    const { value, error } = validate({}) as {
      value: Record<string, string>;
      error?: ValidationError;
    };
    expect(error).toBeUndefined();
    expect(value.SWAGGER_ENABLED).toBe('false');
  });
});

describe('envValidationSchema: storage, queue and video variables', () => {
  it.each([
    'STORAGE_ENDPOINT',
    'STORAGE_PUBLIC_ENDPOINT',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY',
    'STORAGE_SECRET_KEY',
  ] as const)('should reject the environment when %s is missing', (key) => {
    const { error } = validateWithout(key);
    expect(error).toBeDefined();
    expect(error!.message).toContain(key);
  });

  it('should list every missing STORAGE_* variable in a single error', () => {
    const { error } = validateWithout('STORAGE_BUCKET', 'STORAGE_ACCESS_KEY');
    expect(error!.message).toContain('STORAGE_BUCKET');
    expect(error!.message).toContain('STORAGE_ACCESS_KEY');
  });

  it('should apply queue and video defaults when they are not set', () => {
    const { value, error } = validate({}) as {
      value: Record<string, unknown>;
      error?: ValidationError;
    };
    expect(error).toBeUndefined();
    expect(value).toMatchObject({
      STORAGE_REGION: 'us-east-1',
      QUEUE_HOST: 'valkey',
      QUEUE_PORT: 6379,
      QUEUE_PREFIX: 'streamtube',
      VIDEO_WORKER_CONCURRENCY: 2,
      UPLOAD_PART_URL_EXPIRATION_SECONDS: 3600,
      DOWNLOAD_URL_EXPIRATION_SECONDS: 300,
      UPLOAD_EXPIRATION_HOURS: 24,
      UPLOAD_EXPIRATION_SWEEP_INTERVAL_MS: 3600000,
    });
  });

  it('should reject a non-numeric VIDEO_WORKER_CONCURRENCY', () => {
    const { error } = validate({ VIDEO_WORKER_CONCURRENCY: 'many' });
    expect(error!.message).toContain('VIDEO_WORKER_CONCURRENCY');
  });
});
