import { Controller, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AdminGuard } from '../admin/admin.guard.js';
import { MediaService, MAX_IMAGE_BYTES } from './media.service.js';
import type { ImageUpload } from './media.service.js';
import { Inject } from '@nestjs/common';
@ApiTags('Admin media')
@ApiBearerAuth()
@UseGuards(SessionGuard, AdminGuard)
@Controller('v1/admin/media')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}
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
    return this.media.upload(file, request.user.id);
  }
}
