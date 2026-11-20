import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CompletedPartDto {
  /** Número da parte, de 1 a 10 000. */
  @IsInt()
  @Min(1)
  @Max(10000)
  part_number: number;

  /** Cabeçalho `ETag` devolvido pelo storage no `PUT` da parte. */
  @IsString()
  @IsNotEmpty()
  etag: string;
}

export class CompleteUploadDto {
  /** Todas as partes enviadas; a API ordena por `part_number`. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts: CompletedPartDto[];
}
