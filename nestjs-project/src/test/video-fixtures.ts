import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { originalKey } from '../storage/storage-keys';
import { User } from '../users/entities/user.entity';
import { Video, type VideoMetadata } from '../videos/entities/video.entity';
import { generatePublicId } from '../videos/public-id';
import type { CreateDraftData } from '../videos/videos.repository';

/** Entidades necessárias para um DataSource de teste que toca vídeos. */
export const VIDEO_TEST_ENTITIES = [
  User,
  Channel,
  RefreshToken,
  VerificationToken,
  Video,
];

export const PART_SIZE_BYTES = 64 * 1024 * 1024;

export interface UserWithChannel {
  user: User;
  channel: Channel;
}

/** Cria um usuário confirmado com o próprio canal. */
export async function createUserWithChannel(
  dataSource: DataSource,
): Promise<UserWithChannel> {
  const suffix = randomUUID().slice(0, 8);
  const user = await dataSource.getRepository(User).save(
    dataSource.getRepository(User).create({
      email: `video_owner_${suffix}@example.com`,
      password: 'hashed',
      is_confirmed: true,
    }),
  );
  const channel = await dataSource.getRepository(Channel).save(
    dataSource.getRepository(Channel).create({
      name: `owner${suffix}`,
      nickname: `owner${suffix}`,
      user_id: user.id,
    }),
  );
  return { user, channel };
}

/** Dados de um rascunho válido no canal informado. */
export function buildDraftData(
  channelId: string,
  overrides: Partial<CreateDraftData> = {},
): CreateDraftData {
  const id = overrides.id ?? randomUUID();
  const sizeBytes = overrides.size_bytes ?? 2 * PART_SIZE_BYTES;
  return {
    id,
    channel_id: channelId,
    original_filename: 'my-video.mp4',
    mime_type: 'video/mp4',
    size_bytes: sizeBytes,
    storage_key: originalKey(id),
    upload_id: `upload-${id}`,
    part_size_bytes: PART_SIZE_BYTES,
    part_count: Math.ceil(sizeBytes / PART_SIZE_BYTES),
    ...overrides,
  };
}

/** Insere um vídeo pronto no estado desejado (sem passar pelo fluxo de upload). */
export async function seedVideo(
  dataSource: DataSource,
  channelId: string,
  overrides: Partial<Video> = {},
): Promise<Video> {
  const data = buildDraftData(channelId);
  const repo = dataSource.getRepository(Video);
  await repo.insert({
    ...data,
    upload_id: null,
    public_id: generatePublicId(),
    ...overrides,
  });
  return repo.findOneByOrFail({ id: overrides.id ?? data.id });
}

export const SAMPLE_METADATA: VideoMetadata = {
  width: 320,
  height: 240,
  video_codec: 'h264',
  audio_codec: 'aac',
  bitrate: 187456,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  frame_rate: 25,
  size_bytes: 47404,
};
