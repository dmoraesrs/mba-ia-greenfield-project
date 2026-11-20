import { ApiProperty } from '@nestjs/swagger';
import {
  type Video,
  type VideoMetadata,
  VideoStatus,
} from '../entities/video.entity';

export class VideoMetadataDto implements VideoMetadata {
  @ApiProperty({ example: 1920 })
  width: number;

  @ApiProperty({ example: 1080 })
  height: number;

  @ApiProperty({ example: 'h264' })
  video_codec: string;

  @ApiProperty({ type: String, nullable: true, example: 'aac' })
  audio_codec: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 4500000 })
  bitrate: number | null;

  @ApiProperty({ example: 'mov,mp4,m4a,3gp,3g2,mj2' })
  container: string;

  @ApiProperty({ type: Number, nullable: true, example: 29.97 })
  frame_rate: number | null;

  @ApiProperty({ example: 134217728 })
  size_bytes: number;
}

export class VideoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ', minLength: 11, maxLength: 11 })
  public_id: string;

  @ApiProperty({ enum: VideoStatus, enumName: 'VideoStatus' })
  status: VideoStatus;

  @ApiProperty({ example: 'my-video.mp4' })
  original_filename: string;

  @ApiProperty({ example: 'video/mp4' })
  mime_type: string;

  @ApiProperty({ example: 134217728 })
  size_bytes: number;

  @ApiProperty({ type: Number, nullable: true, example: 12.5 })
  duration_seconds: number | null;

  @ApiProperty({ type: VideoMetadataDto, nullable: true })
  metadata: VideoMetadataDto | null;

  @ApiProperty()
  has_thumbnail: boolean;

  @ApiProperty({ type: String, nullable: true, example: null })
  failure_reason: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updated_at: string;

  static fromEntity(video: Video): VideoResponseDto {
    return {
      id: video.id,
      public_id: video.public_id,
      status: video.status,
      original_filename: video.original_filename,
      mime_type: video.mime_type,
      size_bytes: video.size_bytes,
      duration_seconds: video.duration_seconds,
      metadata: video.metadata,
      has_thumbnail: video.thumbnail_key !== null,
      failure_reason: video.failure_reason,
      created_at: video.created_at.toISOString(),
      updated_at: video.updated_at.toISOString(),
    };
  }
}

export class SignedPartDto {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({
    description: 'URL pré-assinada para `PUT` da parte direto no storage',
  })
  url: string;
}

export class UploadSessionDto {
  @ApiProperty({ example: 67108864 })
  part_size_bytes: number;

  @ApiProperty({ example: 2 })
  part_count: number;

  @ApiProperty({ type: [SignedPartDto] })
  parts: SignedPartDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  expires_at: string;
}

export class CreateVideoResponseDto {
  @ApiProperty({ type: VideoResponseDto })
  video: VideoResponseDto;

  @ApiProperty({ type: UploadSessionDto })
  upload: UploadSessionDto;
}

export class UploadedPartDto {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({ example: '"9b2cf535f27731c974343645a3985328"' })
  etag: string;

  @ApiProperty({ example: 67108864 })
  size_bytes: number;
}

export class UploadedPartsResponseDto {
  @ApiProperty({ type: [UploadedPartDto] })
  parts: UploadedPartDto[];
}

export class SignPartsResponseDto {
  @ApiProperty({ type: [SignedPartDto] })
  parts: SignedPartDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  expires_at: string;
}
