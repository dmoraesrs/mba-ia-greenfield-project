import { registerAs } from '@nestjs/config';
import {
  VIDEO_ALLOWED_MIME_TYPES,
  VIDEO_MAX_SIZE_BYTES,
  VIDEO_PART_SIZE_BYTES,
} from '../videos/videos.constants';

export default registerAs('video', () => ({
  maxSizeBytes: VIDEO_MAX_SIZE_BYTES,
  partSizeBytes: VIDEO_PART_SIZE_BYTES,
  allowedMimeTypes: VIDEO_ALLOWED_MIME_TYPES,
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
