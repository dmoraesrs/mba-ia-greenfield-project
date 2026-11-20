/** 10 GiB: limite de tamanho de um vídeo (10 737 418 240 bytes). */
export const VIDEO_MAX_SIZE_BYTES = 10 * 1024 * 1024 * 1024;

/** 64 MiB por parte: 10 GiB cabem em 160 partes, bem abaixo do limite S3 de 10 000. */
export const VIDEO_PART_SIZE_BYTES = 64 * 1024 * 1024;

/** Formatos aceitos pelo MIME declarado no início do upload. */
export const VIDEO_ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
] as const;

export type VideoMimeType = (typeof VIDEO_ALLOWED_MIME_TYPES)[number];

export const VIDEO_FAILURE_REASONS = {
  UPLOAD_EXPIRED: 'upload_expired',
  UPLOAD_SIZE_MISMATCH: 'upload_size_mismatch',
  UPLOAD_TOO_LARGE: 'upload_too_large',
  INVALID_VIDEO_FILE: 'invalid_video_file',
  PROCESSING_FAILED: 'processing_failed',
} as const;
