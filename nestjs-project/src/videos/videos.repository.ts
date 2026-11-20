import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  LessThan,
  QueryFailedError,
  Repository,
  type FindOptionsWhere,
} from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { generatePublicId } from './public-id';
import {
  Video,
  VIDEO_PUBLIC_ID_UNIQUE,
  VideoStatus,
} from './entities/video.entity';

const PG_UNIQUE_VIOLATION = '23505';
const MAX_PUBLIC_ID_ATTEMPTS = 5;

export interface CreateDraftData {
  id: string;
  channel_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string;
  upload_id: string;
  part_size_bytes: number;
  part_count: number;
}

export type VideoPatch = QueryDeepPartialEntity<Video>;

function isPublicIdCollision(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driverError = err.driverError as {
    code?: unknown;
    constraint?: unknown;
  };
  return (
    driverError.code === PG_UNIQUE_VIOLATION &&
    driverError.constraint === VIDEO_PUBLIC_ID_UNIQUE
  );
}

@Injectable()
export class VideosRepository {
  constructor(
    @InjectRepository(Video)
    private readonly repository: Repository<Video>,
  ) {}

  /**
   * Insere o rascunho com um `public_id` aleatório; em colisão do UNIQUE gera
   * outro e tenta de novo. Cada tentativa é um INSERT isolado (fora de
   * transação), então a falha não aborta as seguintes.
   */
  async createDraft(data: CreateDraftData): Promise<Video> {
    for (let attempt = 1; ; attempt++) {
      const video = this.repository.create({
        ...data,
        public_id: generatePublicId(),
        status: VideoStatus.DRAFT,
      });
      try {
        await this.repository.insert(video);
        return await this.repository.findOneByOrFail({ id: data.id });
      } catch (err) {
        if (!isPublicIdCollision(err) || attempt >= MAX_PUBLIC_ID_ATTEMPTS) {
          throw err;
        }
      }
    }
  }

  async findById(id: string): Promise<Video | null> {
    return this.repository.findOneBy({ id });
  }

  /** Vídeo do canal do usuário; vídeo de outro usuário resulta em `null`. */
  async findOwnedById(id: string, userId: string): Promise<Video | null> {
    return this.repository
      .createQueryBuilder('video')
      .innerJoin('video.channel', 'channel')
      .where('video.id = :id', { id })
      .andWhere('channel.user_id = :userId', { userId })
      .getOne();
  }

  async findReadyByPublicId(publicId: string): Promise<Video | null> {
    return this.repository.findOneBy({
      public_id: publicId,
      status: VideoStatus.READY,
    });
  }

  /**
   * Update condicional: só altera a linha se ela ainda estiver em
   * `expectedStatus`. Retorna se alguma linha foi afetada.
   */
  async updateWhereStatus(
    id: string,
    expectedStatus: VideoStatus,
    patch: VideoPatch,
  ): Promise<boolean> {
    const where: FindOptionsWhere<Video> = { id, status: expectedStatus };
    const result = await this.repository.update(where, patch);
    return (result.affected ?? 0) > 0;
  }

  /** Rascunhos criados antes de `cutoff`, mais antigos primeiro. */
  async findExpiredDrafts(cutoff: Date, limit: number): Promise<Video[]> {
    return this.repository.find({
      where: { status: VideoStatus.DRAFT, created_at: LessThan(cutoff) },
      order: { created_at: 'ASC' },
      take: limit,
    });
  }
}
