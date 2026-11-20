import { Test } from '@nestjs/testing';
import { ChannelsService } from '../channels/channels.service';
import type { Channel } from '../channels/entities/channel.entity';
import videoConfig from '../config/video.config';
import { StorageService } from '../storage/storage.service';
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
}

interface RepositoryMock {
  createDraft: jest.MockedFunction<VideosRepository['createDraft']>;
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
    };
    repository = {
      createDraft: jest.fn((data) => Promise.resolve(draftFrom(data))),
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
});
