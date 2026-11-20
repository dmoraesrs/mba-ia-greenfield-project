import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { SignPartsDto } from './dto/sign-parts.dto';
import {
  CreateVideoResponseDto,
  SignPartsResponseDto,
  UploadedPartsResponseDto,
  VideoResponseDto,
} from './dto/video-response.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      "Creates the video as a draft in the authenticated user's channel, opens a multipart upload in the object storage and returns presigned URLs for every part. The client uploads each part with PUT straight to the storage; the file never passes through the API.",
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created and upload started',
    type: CreateVideoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (unsupported MIME type, size or filename)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<CreateVideoResponseDto> {
    return this.videosService.initiateUpload(user.sub, dto);
  }

  @Get(':id/upload/parts')
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Video id' })
  @ApiOperation({
    summary: 'List uploaded parts',
    description:
      'Lists the parts the object storage has already received for a draft video, so the client can resume an interrupted upload.',
  })
  @ApiResponse({
    status: 200,
    description: 'Parts received so far, in ascending order',
    type: UploadedPartsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Video id is not a uuid',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in draft status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async listUploadedParts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UploadedPartsResponseDto> {
    return this.videosService.listUploadedParts(user.sub, id);
  }

  @Post(':id/upload/parts')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Video id' })
  @ApiOperation({
    summary: 'Re-sign upload parts',
    description:
      'Returns new presigned URLs for the given parts of a draft video (expired URLs or resumed upload).',
  })
  @ApiResponse({
    status: 200,
    description: 'New presigned URLs for the requested parts',
    type: SignPartsResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed (VALIDATION_ERROR) or a part number exceeds the part count (INVALID_PART_NUMBER)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in draft status',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async signParts(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignPartsDto,
  ): Promise<SignPartsResponseDto> {
    return this.videosService.signParts(user.sub, id, dto.part_numbers);
  }

  @Post(':id/upload/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Video id' })
  @ApiOperation({
    summary: 'Complete a video upload',
    description:
      'Completes the multipart upload, checks the real object size against the declared size and the 10GB limit, moves the video to processing and enqueues the automatic processing job.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed; video is processing',
    type: VideoResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Validation failed (VALIDATION_ERROR) or the storage rejected the part list (INVALID_UPLOAD_PARTS); the video stays in draft',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or owned by another user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in draft status (includes a second completion)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 422,
    description:
      'Real size differs from the declared size (UPLOAD_SIZE_MISMATCH) or exceeds 10GB (UPLOAD_TOO_LARGE); the object is deleted and the video fails',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<VideoResponseDto> {
    return this.videosService.completeUpload(user.sub, id, dto);
  }
}
