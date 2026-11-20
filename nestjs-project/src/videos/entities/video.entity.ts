import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

/** Metadados extraídos pelo `ffprobe` no worker (coluna jsonb `metadata`). */
export interface VideoMetadata {
  width: number;
  height: number;
  video_codec: string;
  audio_codec: string | null;
  bitrate: number | null;
  container: string;
  frame_rate: number | null;
  size_bytes: number;
}

export const VIDEO_PUBLIC_ID_UNIQUE = 'UQ_videos_public_id';

/** `bigint` chega do driver `pg` como string; os tamanhos cabem com folga em 2^53. */
const bigintToNumber: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('videos')
@Unique(VIDEO_PUBLIC_ID_UNIQUE, ['public_id'])
@Check('CHK_videos_size_bytes', '"size_bytes" BETWEEN 1 AND 10737418240')
@Check('CHK_videos_part_count', '"part_count" BETWEEN 1 AND 10000')
@Index('IDX_videos_channel_id', ['channel_id'])
@Index('IDX_videos_status_created_at', ['status', 'created_at'])
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 11 })
  public_id: string;

  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    enumName: 'videos_status_enum',
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  @Column({ type: 'varchar', length: 255 })
  original_filename: string;

  @Column({ type: 'varchar', length: 100 })
  mime_type: string;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  size_bytes: number;

  @Column({ type: 'varchar', length: 512 })
  storage_key: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  upload_id: string | null;

  @Column({ type: 'integer' })
  part_size_bytes: number;

  @Column({ type: 'integer' })
  part_count: number;

  @Column({ type: 'varchar', length: 512, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'double precision', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: VideoMetadata | null;

  @Column({ type: 'text', nullable: true })
  failure_reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
