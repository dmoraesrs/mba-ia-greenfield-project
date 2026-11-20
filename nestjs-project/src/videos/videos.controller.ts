import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProduces,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { PublicVideoResponseDto } from './dto/public-video-response.dto';
import { SignPartsDto } from './dto/sign-parts.dto';
import {
  CreateVideoResponseDto,
  SignPartsResponseDto,
  UploadedPartsResponseDto,
  VideoResponseDto,
} from './dto/video-response.dto';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { sendStream } from './stream-response';
import { VideoStreamingService } from './video-streaming.service';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly videoStreamingService: VideoStreamingService,
  ) {}

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

  // Rotas `public/...` declaradas antes de `:id`.
  @Public()
  @Get('public/:publicId')
  @ApiParam({
    name: 'publicId',
    description: 'Unique public identifier (11 base64url characters)',
    example: 'dQw4w9WgXcQ',
  })
  @ApiOperation({
    summary: 'Get public video data',
    description:
      'Returns the public data of a ready video accessed through its unique link. No authentication required.',
  })
  @ApiResponse({
    status: 200,
    description: 'Public data of the ready video',
    type: PublicVideoResponseDto,
  })
  @ApiResponse({
    status: 404,
    description:
      'Invalid public id, unknown video or video not ready (same response for all)',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getPublic(
    @Param('publicId') publicId: string,
  ): Promise<PublicVideoResponseDto> {
    return this.videosService.getPublic(publicId);
  }

  // Players fazem muitas requisições Range por minuto (buffer, seek): o rate
  // limit global de 10 req/min quebraria a reprodução.
  @SkipThrottle()
  @Public()
  @Get('public/:publicId/stream')
  @ApiParam({ name: 'publicId', example: 'dQw4w9WgXcQ' })
  @ApiHeader({
    name: 'Range',
    required: false,
    description:
      'Single byte range: bytes=start-end, bytes=start- or bytes=-suffix',
  })
  @ApiProduces('video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska')
  @ApiOperation({
    summary: 'Stream a ready video',
    description:
      'Streams the video from the object storage, forwarding the Range header. Answers 206 Partial Content for a valid range and 200 with the whole file otherwise. No authentication required.',
  })
  @ApiResponse({
    status: 200,
    description: 'Whole file (no Range header)',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({
    status: 206,
    description: 'Requested byte range, with Content-Range',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({
    status: 404,
    description: 'Invalid public id, unknown video or video not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 416,
    description:
      'Range starts beyond the end of the file; Content-Range: bytes */{size}',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @Param('publicId') publicId: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await sendStream(
      res,
      await this.videoStreamingService.openStream(publicId, range),
    );
  }

  @SkipThrottle()
  @Public()
  @Get('public/:publicId/thumbnail')
  @ApiParam({ name: 'publicId', example: 'dQw4w9WgXcQ' })
  @ApiProduces('image/jpeg')
  @ApiOperation({
    summary: 'Get the thumbnail of a ready video',
    description:
      'Returns the JPEG thumbnail generated by the video worker. No authentication required.',
  })
  @ApiResponse({
    status: 200,
    description: 'JPEG thumbnail',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({
    status: 404,
    description:
      'Invalid public id, unknown video, video not ready or without thumbnail',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async thumbnail(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ): Promise<void> {
    await sendStream(
      res,
      await this.videoStreamingService.openThumbnail(publicId),
    );
  }

  @Public()
  @Get('public/:publicId/download')
  @ApiParam({ name: 'publicId', example: 'dQw4w9WgXcQ' })
  @ApiOperation({
    summary: 'Download a ready video',
    description:
      'Redirects (302) to a short-lived presigned URL that serves the original file with Content-Disposition: attachment. No authentication required.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to the presigned download URL (Location header)',
  })
  @ApiResponse({
    status: 404,
    description: 'Invalid public id, unknown video or video not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @Param('publicId') publicId: string,
    @Res() res: Response,
  ): Promise<void> {
    res.redirect(
      HttpStatus.FOUND,
      await this.videosService.getDownloadUrl(publicId),
    );
  }

  @Get(':id')
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Video id' })
  @ApiOperation({
    summary: 'Get an owned video',
    description:
      'Returns a video of the authenticated user in any status, to follow its processing.',
  })
  @ApiResponse({
    status: 200,
    description: 'The video',
    type: VideoResponseDto,
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
  async getOwned(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoResponseDto> {
    return this.videosService.getOwned(user.sub, id);
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
