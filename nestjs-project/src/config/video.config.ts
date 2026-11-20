import { registerAs } from '@nestjs/config';

/** 10 GiB: limite de tamanho de um vídeo (10 737 418 240 bytes). */
const MAX_SIZE_BYTES = 10 * 1024 * 1024 * 1024;
/** 64 MiB por parte: 10 GiB cabem em 160 partes, bem abaixo do limite S3 de 10 000. */
const PART_SIZE_BYTES = 64 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
] as const;

export default registerAs('video', () => ({
  maxSizeBytes: MAX_SIZE_BYTES,
  partSizeBytes: PART_SIZE_BYTES,
  allowedMimeTypes: ALLOWED_MIME_TYPES,
  partUrlExpirationSeconds: parseInt(
    process.env.UPLOAD_PART_URL_EXPIRATION_SECONDS ?? '3600',
    10,
  ),
  downloadUrlExpirationSeconds: parseInt(
    process.env.DOWNLOAD_URL_EXPIRATION_SECONDS ?? '300',
    10,
  ),
  uploadExpirationHours: parseInt(
    process.env.UPLOAD_EXPIRATION_HOURS ?? '24',
    10,
  ),
  uploadExpirationSweepIntervalMs: parseInt(
    process.env.UPLOAD_EXPIRATION_SWEEP_INTERVAL_MS ?? '3600000',
    10,
  ),
}));
