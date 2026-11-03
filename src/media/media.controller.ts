import { Body, Get, BadRequestException, Param, ParseUUIDPipe } from '@nestjs/common';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { CONFIG } from '../common/config.js';
import type { AppConfig } from '../common/config.js';
import { UploadIntentsService } from './upload-intents.service.js';
import { Controller, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AdminGuard } from '../admin/admin.guard.js';
import { MediaService, MAX_IMAGE_BYTES } from './media.service.js';
import type { ImageUpload } from './media.service.js';
import { Inject } from '@nestjs/common';
class UploadIntentInput {
  @IsString() @MaxLength(200) originalName!: string;
  @IsIn(['image/png', 'image/jpeg', 'image/webp']) mimeType!: string;
  @IsInt() @Min(1) @Max(MAX_IMAGE_BYTES) sizeBytes!: number;
}
@ApiTags('Admin media')
@ApiBearerAuth()
@UseGuards(SessionGuard, AdminGuard)
@Controller('v1/admin/media')
export class MediaController {
  constructor(
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(UploadIntentsService) private readonly intents: UploadIntentsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}
  @Get('upload-config')
  uploadConfig() {
    return {
      mode: this.config.mediaStorage === 'vercel-blob' ? 'direct' : 'multipart',
      maxBytes: MAX_IMAGE_BYTES,
    };
  }
  @Post('upload-intents')
  createIntent(@Body() input: UploadIntentInput, @Req() request: AuthenticatedRequest) {
    return this.intents.create(input, request.user.id);
  }
  @Post('upload-intents/:id/complete')
  completeIntent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    if (request.body && Object.keys(request.body as object).length)
      throw new BadRequestException('Completion does not accept a URL or body');
    return this.intents.complete(id, request.user.id);
  }
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 1 },
    }),
  )
  upload(@UploadedFile() file: ImageUpload | undefined, @Req() request: AuthenticatedRequest) {
    if (this.config.mediaStorage !== 'local')
      throw new BadRequestException('Use direct Blob upload for cloud media');
    return this.media.upload(file, request.user.id);
  }
}
