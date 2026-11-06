import {
  ApiTags,
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AdminGuard } from '../admin/admin.guard.js';
import { PageQuery, parseRevision } from '../common/pagination.js';
import { DesignRequestsService } from './requests.service.js';
import { DesignRequestDto, ReviewRequestDto, TrackRequestDto } from './requests.dto.js';
function guest(value: string | undefined) {
  if (!value || !/^Bearer [a-f0-9]{64}$/.test(value)) throw new UnauthorizedException();
  return value.slice(7);
}
@ApiTags('Design requests')
@ApiBearerAuth('guest')
@ApiUnauthorizedResponse({ description: 'Thiếu khóa phiên khách hoặc sai định dạng' })
@Controller('v1/design-requests')
export class DesignRequestsController {
  constructor(@Inject(DesignRequestsService) private readonly requests: DesignRequestsService) {}
  @Post()
  @ApiOperation({
    summary: 'Gửi yêu cầu tư vấn theo thiết kế',
    description:
      'Dùng materialIds UUID từ Catalog. Một bể kính, tối đa ba rêu theo rule hiện tại. Không nhận giá từ FE. Cùng khóa và nội dung gửi lại trả cùng yêu cầu.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID mới cho yêu cầu mới; giữ nguyên khi gửi lại cùng nội dung',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiCreatedResponse({
    description: 'Đã lưu yêu cầu; chưa phải đơn đã chốt giá',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        number: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'contacted', 'closed'] },
      },
    },
  })
  @ApiConflictResponse({ description: 'Đã dùng khóa này cho nội dung khác' })
  create(
    @Headers('authorization') auth: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: DesignRequestDto,
  ) {
    if (!key || !isUUID(key)) throw new BadRequestException('Idempotency-Key UUID required');
    return this.requests.create(guest(auth), key, input);
  }
  @Post('track')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Tra cứu bằng mã; chỉ trả trạng thái và snapshot vật liệu, không trả dữ liệu cá nhân',
  })
  track(@Headers('authorization') auth: string | undefined, @Body() input: TrackRequestDto) {
    return this.requests.track(guest(auth), input);
  }
  @Get(':id')
  @ApiOperation({
    summary: 'Xem yêu cầu của cùng phiên khách',
    description:
      'Trả snapshot lựa chọn và trạng thái; không trả thông tin liên hệ. Phiên khác nhận 404.',
  })
  @ApiOkResponse({
    description: 'id, number, status, selection[{id, category, name}], createdAt, updatedAt',
  })
  get(@Param('id', ParseUUIDPipe) id: string, @Headers('authorization') auth: string | undefined) {
    return this.requests.get(id, guest(auth));
  }
}
@ApiTags('Admin design requests')
@ApiBearerAuth()
@UseGuards(SessionGuard, AdminGuard)
@Controller('v1/admin/design-requests')
export class AdminDesignRequestsController {
  constructor(@Inject(DesignRequestsService) private readonly requests: DesignRequestsService) {}
  @Get()
  @ApiOperation({
    summary: 'Danh sách yêu cầu và liên hệ của khách',
    description: 'Phân trang cursor: dùng nguyên nextCursor để lấy trang kế tiếp.',
  })
  list(@Query() query: PageQuery) {
    return this.requests.list(query);
  }
  @Patch(':id')
  @ApiOperation({
    summary: 'Cập nhật trạng thái tiếp nhận yêu cầu',
    description:
      'pending: chờ xác nhận; contacted: đã liên hệ; closed: kết thúc yêu cầu. Không xác nhận cọc tại endpoint này.',
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'revision mới nhất của yêu cầu, ví dụ 1',
    schema: { type: 'string', example: '1' },
  })
  @ApiConflictResponse({ description: 'Yêu cầu đã thay đổi, tải lại revision trước khi sửa' })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') revision: string | undefined,
    @Body() input: ReviewRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.requests.review(id, parseRevision(revision), input, req.user.id);
  }
}
