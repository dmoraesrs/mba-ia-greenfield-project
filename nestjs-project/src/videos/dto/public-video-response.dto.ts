import { ApiProperty } from '@nestjs/swagger';
import type { Video } from '../entities/video.entity';
import { VideoMetadataDto } from './video-response.dto';

/** Dados públicos de um vídeo `ready`, acessado pela URL única. */
export class PublicVideoResponseDto {
  @ApiProperty({ example: 'dQw4w9WgXcQ', minLength: 11, maxLength: 11 })
  public_id: string;

  @ApiProperty({ example: 'video/mp4' })
  mime_type: string;

  @ApiProperty({ example: 12.5 })
  duration_seconds: number;

  @ApiProperty({ type: VideoMetadataDto })
  metadata: VideoMetadataDto;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: string;

  static fromEntity(video: Video): PublicVideoResponseDto {
    return {
      public_id: video.public_id,
      mime_type: video.mime_type,
      duration_seconds: video.duration_seconds ?? 0,
      metadata: video.metadata as VideoMetadataDto,
      created_at: video.created_at.toISOString(),
    };
  }
}
