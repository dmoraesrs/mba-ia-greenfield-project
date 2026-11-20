export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const PROCESS_VIDEO_JOB = 'process-video';

export const VIDEO_MAINTENANCE_QUEUE = 'video-maintenance';
export const EXPIRE_ABANDONED_UPLOADS_JOB = 'expire-abandoned-uploads';

export const ALL_QUEUES = [
  VIDEO_PROCESSING_QUEUE,
  VIDEO_MAINTENANCE_QUEUE,
] as const;

export interface ProcessVideoJobData {
  videoId: string;
}
