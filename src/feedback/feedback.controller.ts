import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { SessionGuard } from '../auth/session.guard.js';
import { AdminGuard } from '../admin/admin.guard.js';
import { guestToken } from '../common/guest.js';
import { PageQuery } from '../common/pagination.js';
import { FeedbackDto } from './feedback.dto.js';
import { FeedbackService } from './feedback.service.js';

@ApiTags('Feedback')
@Controller('v1/feedback')
export class FeedbackController {
  constructor(@Inject(FeedbackService) private readonly feedback: FeedbackService) {}
  @Post()
  @ApiBearerAuth('guest')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Lưu góp ý website, không gửi email tự động' })
  create(
    @Headers('authorization') auth: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: FeedbackDto,
  ) {
    if (!key || !isUUID(key)) throw new BadRequestException('Idempotency-Key UUID required');
    return this.feedback.create(guestToken(auth), key, input);
  }
}

@ApiTags('Admin feedback')
@ApiBearerAuth()
@UseGuards(SessionGuard, AdminGuard)
@Controller('v1/admin/feedback')
export class AdminFeedbackController {
  constructor(@Inject(FeedbackService) private readonly feedback: FeedbackService) {}
  @Get()
  list(@Query() query: PageQuery) {
    return this.feedback.list(query);
  }
}
