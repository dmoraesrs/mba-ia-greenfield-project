import { Test } from '@nestjs/testing';
import { type Job, UnrecoverableError } from 'bullmq';
import queueConfig from '../../config/queue.config';
import { FfmpegService } from '../../media/ffmpeg.service';
import {
  InvalidVideoFileError,
  MediaToolError,
} from '../../media/media.errors';
import type { ProcessVideoJobData } from '../../queue/queue.constants';
import { StorageService } from '../../storage/storage.service';
import { type Video, VideoStatus } from '../entities/video.entity';
import { VideosRepository } from '../videos.repository';
import { VideoProcessingProcessor } from './video-processing.processor';

interface RepositoryMock {
  findById: jest.MockedFunction<VideosRepository['findById']>;
  updateWhereStatus: jest.MockedFunction<VideosRepository['updateWhereStatus']>;
}

interface StorageMock {
  signGetObject: jest.MockedFunction<StorageService['signGetObject']>;
  putObject: jest.MockedFunction<StorageService['putObject']>;
}

interface FfmpegMock {
  probe: jest.MockedFunction<FfmpegService['probe']>;
  extractFrame: jest.MockedFunction<FfmpegService['extractFrame']>;
}

const VIDEO_ID = 'video-1';

const PROBE_JSON = JSON.stringify({
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 320,
      height: 240,
      avg_frame_rate: '25/1',
    },
  ],
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '1.5',
    bit_rate: '100000',
    size: '2048',
  },
});

const video = (status: VideoStatus): Video =>
  ({
    id: VIDEO_ID,
    status,
    storage_key: `videos/${VIDEO_ID}/original`,
  }) as Video;

const job = (attemptsMade = 0, attempts = 3): Job<ProcessVideoJobData> =>
  ({
    data: { videoId: VIDEO_ID },
    attemptsMade,
    opts: { attempts },
  }) as Job<ProcessVideoJobData>;

describe('VideoProcessingProcessor', () => {
  let processor: VideoProcessingProcessor;
  let repository: RepositoryMock;
  let storage: StorageMock;
  let ffmpeg: FfmpegMock;

  beforeEach(async () => {
    repository = {
      findById: jest.fn().mockResolvedValue(video(VideoStatus.PROCESSING)),
      updateWhereStatus: jest.fn().mockResolvedValue(true),
    };
    storage = {
      signGetObject: jest.fn().mockResolvedValue('http://rustfs:9000/signed'),
      putObject: jest.fn().mockResolvedValue(undefined),
    };
    ffmpeg = {
      probe: jest.fn().mockResolvedValue(PROBE_JSON),
      extractFrame: jest.fn().mockResolvedValue(Buffer.from([0xff, 0xd8])),
    };

    const module = await Test.createTestingModule({
      providers: [
        VideoProcessingProcessor,
        { provide: VideosRepository, useValue: repository },
        { provide: StorageService, useValue: storage },
        { provide: FfmpegService, useValue: ffmpeg },
        { provide: queueConfig.KEY, useValue: queueConfig() },
      ],
    }).compile();

    processor = module.get(VideoProcessingProcessor);
  });

  describe('process', () => {
    it.each([VideoStatus.READY, VideoStatus.FAILED, VideoStatus.DRAFT])(
      'should skip a video in %s status without side effects',
      async (status) => {
        repository.findById.mockResolvedValue(video(status));

        await expect(processor.process(job())).resolves.toBe('skipped');
        expect(ffmpeg.probe).not.toHaveBeenCalled();
        expect(repository.updateWhereStatus).not.toHaveBeenCalled();
      },
    );

    it('should skip a video that no longer exists', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(processor.process(job())).resolves.toBe('skipped');
    });

    it('should store the thumbnail and mark the video ready with duration and metadata', async () => {
      await expect(processor.process(job())).resolves.toBe('processed');

      expect(ffmpeg.extractFrame).toHaveBeenCalledWith(
        'http://rustfs:9000/signed',
        0.75,
      );
      expect(storage.putObject).toHaveBeenCalledWith(
        `videos/${VIDEO_ID}/thumbnail.jpg`,
        expect.any(Buffer),
        'image/jpeg',
      );
      expect(repository.updateWhereStatus).toHaveBeenCalledWith(
        VIDEO_ID,
        VideoStatus.PROCESSING,
        expect.objectContaining({
          status: VideoStatus.READY,
          duration_seconds: 1.5,
          thumbnail_key: `videos/${VIDEO_ID}/thumbnail.jpg`,
          failure_reason: null,
        }),
      );
    });

    it('should turn InvalidVideoFileError into an UnrecoverableError with the failure reason', async () => {
      ffmpeg.probe.mockRejectedValue(
        new InvalidVideoFileError('moov atom not found'),
      );

      const result = processor.process(job());

      await expect(result).rejects.toBeInstanceOf(UnrecoverableError);
      await expect(result).rejects.toThrow(
        'invalid_video_file: moov atom not found',
      );
    });

    it('should rethrow transient errors so the job is retried', async () => {
      const transient = new MediaToolError('ffprobe timed out');
      ffmpeg.probe.mockRejectedValue(transient);

      await expect(processor.process(job())).rejects.toBe(transient);
    });
  });

  describe('onFailed', () => {
    it('should not touch the video while retries remain', async () => {
      await processor.onFailed(job(1, 3), new MediaToolError('boom'));

      expect(repository.updateWhereStatus).not.toHaveBeenCalled();
    });

    it('should mark the video failed with processing_failed after the last attempt', async () => {
      await processor.onFailed(job(3, 3), new MediaToolError('boom'));

      expect(repository.updateWhereStatus).toHaveBeenCalledWith(
        VIDEO_ID,
        VideoStatus.PROCESSING,
        {
          status: VideoStatus.FAILED,
          failure_reason: 'processing_failed: boom',
        },
      );
    });

    it('should mark the video failed immediately for an unrecoverable error', async () => {
      await processor.onFailed(
        job(1, 3),
        new UnrecoverableError('invalid_video_file: not a video'),
      );

      expect(repository.updateWhereStatus).toHaveBeenCalledWith(
        VIDEO_ID,
        VideoStatus.PROCESSING,
        {
          status: VideoStatus.FAILED,
          failure_reason: 'invalid_video_file: not a video',
        },
      );
    });

    it('should log instead of throwing when the status update fails', async () => {
      repository.updateWhereStatus.mockRejectedValue(new Error('db down'));

      await expect(
        processor.onFailed(job(3, 3), new MediaToolError('boom')),
      ).resolves.toBeUndefined();
    });
  });
});
