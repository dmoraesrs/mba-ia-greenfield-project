import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';
import {
  VIDEO_ALLOWED_MIME_TYPES,
  VIDEO_MAX_SIZE_BYTES,
  type VideoMimeType,
} from '../videos.constants';

export class CreateVideoDto {
  /** Nome do arquivo no dispositivo do usuário, usado no download. */
  @IsString()
  @Length(1, 255)
  filename: string;

  /** MIME declarado pelo cliente; só formatos de vídeo suportados. */
  @IsIn(VIDEO_ALLOWED_MIME_TYPES)
  mime_type: VideoMimeType;

  /** Tamanho total do arquivo em bytes (máximo 10 GiB). */
  @IsInt()
  @Min(1)
  @Max(VIDEO_MAX_SIZE_BYTES)
  size_bytes: number;
}
