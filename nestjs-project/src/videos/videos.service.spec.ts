import { Test } from '@nestjs/testing';
import { ChannelsService } from '../channels/channels.service';
import type { Channel } from '../channels/entities/channel.entity';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
import {
  InvalidPartNumberException,
  VideoNotFoundException,
  VideoNotInDraftException,
} from '../common/exceptions/domain.exception';
import { StorageUploadNotFoundError } from '../storage/storage.errors';
import { type Video, VideoStatus } from './entities/video.entity';
import { VideosRepository } from './videos.repository';
import { VideosService } from './videos.service';

interface StorageMock {
  createMultipartUpload: jest.MockedFunction<
    StorageService['createMultipartUpload']
  >;
  abortMultipartUpload: jest.MockedFunction<
    StorageService['abortMultipartUpload']
  >;
  signUploadParts: jest.MockedFunction<StorageService['signUploadParts']>;
  listParts: jest.MockedFunction<StorageService['listParts']>;
}

interface RepositoryMock {
  createDraft: jest.MockedFunction<VideosRepository['createDraft']>;
  findOwnedById: jest.MockedFunction<VideosRepository['findOwnedById']>;
}

const USER_ID = 'user-1';
const CHANNEL = { id: 'channel-1', user_id: USER_ID } as Channel;

function draftFrom(
  data: Parameters<VideosRepository['createDraft']>[0],
): Video {
  return {
    ...data,
    public_id: 'abcdefghijk',
    status: VideoStatus.DRAFT,
    thumbnail_key: null,
    duration_seconds: null,
    metadata: null,
    failure_reason: null,
    created_at: new Date(),
    updated_at: new Date(),
  } as Video;
}

describe('VideosService', () => {
  let service: VideosService;
  let storage: StorageMock;
  let repository: RepositoryMock;

  beforeEach(async () => {
    storage = {
      createMultipartUpload: jest.fn().mockResolvedValue('upload-1'),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      signUploadParts: jest.fn(
        (...args: Parameters<StorageService['signUploadParts']>) =>
          Promise.resolve(
            args[2].map((partNumber) => ({
              partNumber,
              url: `https://storage/part-${partNumber}`,
            })),
          ),
      ),
      listParts: jest.fn().mockResolvedValue([]),
    };
    repository = {
      createDraft: jest.fn((data) => Promise.resolve(draftFrom(data))),
      findOwnedById: jest.fn().mockResolvedValue(null),
    };

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: VideosRepository, useValue: repository },
        { provide: StorageService, useValue: storage },
        {
          provide: ChannelsService,
          useValue: { findByUserId: jest.fn().mockResolvedValue(CHANNEL) },
        },
        { provide: videoConfig.KEY, useValue: videoConfig() },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  describe('initiateUpload', () => {
    it.each([
      [1, 1],
      [67108864, 1],
      [67108865, 2],
      [134217728, 2],
      [10737418240, 160],
    ])(
      'should split %d bytes into %d part(s) of 64 MiB',
      async (sizeBytes, expectedParts) => {
        const result = await service.initiateUpload(USER_ID, {
          filename: 'a.mp4',
          mime_type: 'video/mp4',
          size_bytes: sizeBytes,
        });

        expect(result.upload.part_count).toBe(expectedParts);
        expect(result.upload.part_size_bytes).toBe(67108864);
        expect(result.upload.parts).toHaveLength(expectedParts);
        expect(result.upload.parts.at(-1)?.part_number).toBe(expectedParts);
        expect(repository.createDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            part_count: expectedParts,
            channel_id: CHANNEL.id,
          }),
        );
      },
    );

    it('should store the draft under videos/{id}/original with the multipart upload id', async () => {
      await service.initiateUpload(USER_ID, {
        filename: 'a.mp4',
        mime_type: 'video/mp4',
        size_bytes: 1024,
      });

      const data = repository.createDraft.mock.calls[0][0];
      expect(data.storage_key).toBe(`videos/${data.id}/original`);
      expect(data.upload_id).toBe('upload-1');
      expect(storage.createMultipartUpload).toHaveBeenCalledWith(
        data.storage_key,
        'video/mp4',
      );
    });

    it('should abort the multipart upload and rethrow when the draft insert fails', async () => {
      const insertError = new Error('insert failed');
      repository.createDraft.mockRejectedValueOnce(insertError);

      await expect(
        service.initiateUpload(USER_ID, {
          filename: 'a.mp4',
          mime_type: 'video/mp4',
          size_bytes: 1024,
        }),
      ).rejects.toBe(insertError);

      const key = storage.createMultipartUpload.mock.calls[0][0];
      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        key,
        'upload-1',
      );
      expect(storage.signUploadParts).not.toHaveBeenCalled();
    });
  });

  describe('listUploadedParts and signParts', () => {
    const ownedDraft = (overrides: Partial<Video> = {}): Video => ({
      ...draftFrom({
        id: 'video-1',
        channel_id: CHANNEL.id,
        original_filename: 'a.mp4',
        mime_type: 'video/mp4',
        size_bytes: 134217728,
        storage_key: 'videos/video-1/original',
        upload_id: 'upload-1',
        part_size_bytes: 67108864,
        part_count: 2,
      }),
      ...overrides,
    });

    it('should throw VideoNotFoundException when the video is not owned by the user', async () => {
      repository.findOwnedById.mockResolvedValue(null);

      await expect(
        service.listUploadedParts(USER_ID, 'video-1'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
      await expect(
        service.signParts(USER_ID, 'video-1', [1]),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
      expect(repository.findOwnedById).toHaveBeenCalledWith('video-1', USER_ID);
    });

    it.each([VideoStatus.PROCESSING, VideoStatus.READY, VideoStatus.FAILED])(
      'should throw VideoNotInDraftException when the video is %s',
      async (status) => {
        repository.findOwnedById.mockResolvedValue(ownedDraft({ status }));

        await expect(
          service.listUploadedParts(USER_ID, 'video-1'),
        ).rejects.toBeInstanceOf(VideoNotInDraftException);
        await expect(
          service.signParts(USER_ID, 'video-1', [1]),
        ).rejects.toBeInstanceOf(VideoNotInDraftException);
      },
    );

    it('should throw InvalidPartNumberException for a part above part_count', async () => {
      repository.findOwnedById.mockResolvedValue(ownedDraft());

      await expect(
        service.signParts(USER_ID, 'video-1', [1, 3]),
      ).rejects.toBeInstanceOf(InvalidPartNumberException);
      expect(storage.signUploadParts).not.toHaveBeenCalled();
    });

    it('should sign only the requested parts', async () => {
      repository.findOwnedById.mockResolvedValue(ownedDraft());

      const result = await service.signParts(USER_ID, 'video-1', [2]);

      expect(result.parts).toEqual([
        { part_number: 2, url: 'https://storage/part-2' },
      ]);
      expect(storage.signUploadParts).toHaveBeenCalledWith(
        'videos/video-1/original',
        'upload-1',
        [2],
        3600,
      );
    });

    it('should map storage parts to the response shape', async () => {
      repository.findOwnedById.mockResolvedValue(ownedDraft());
      storage.listParts.mockResolvedValue([
        { partNumber: 1, etag: '"abc"', size: 67108864 },
      ]);

      const result = await service.listUploadedParts(USER_ID, 'video-1');

      expect(result.parts).toEqual([
        { part_number: 1, etag: '"abc"', size_bytes: 67108864 },
      ]);
    });

    it('should translate an aborted multipart upload into VideoNotInDraftException', async () => {
      repository.findOwnedById.mockResolvedValue(ownedDraft());
      storage.listParts.mockRejectedValue(new StorageUploadNotFoundError());

      await expect(
        service.listUploadedParts(USER_ID, 'video-1'),
      ).rejects.toBeInstanceOf(VideoNotInDraftException);
    });

    it('should rethrow other storage errors unchanged', async () => {
      const storageDown = new Error('connect ECONNREFUSED');
      repository.findOwnedById.mockResolvedValue(ownedDraft());
      storage.listParts.mockRejectedValue(storageDown);

      await expect(service.listUploadedParts(USER_ID, 'video-1')).rejects.toBe(
        storageDown,
      );
    });
  });
});
