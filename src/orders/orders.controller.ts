import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  Query,
  Header,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AdminGuard } from '../admin/admin.guard.js';
import {
  CreateOrderDto,
  CreateQuoteDto,
  OrderStatusDto,
  PricingDto,
  RecordPaymentDto,
} from './orders.dto.js';
import { OrdersService } from './orders.service.js';
import { PageQuery, parseRevision } from '../common/pagination.js';
@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('v1')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}
  @Post('quotes') quote(@Req() req: AuthenticatedRequest, @Body() input: CreateQuoteDto) {
    return this.orders.quote(req.user.id, input);
  }
  @Post('orders')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  order(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateOrderDto,
  ) {
    if (!key || !isUUID(key)) throw new BadRequestException('Idempotency-Key UUID required');
    return this.orders.order(req.user.id, key, input);
  }
  @Get('orders') list(@Req() req: AuthenticatedRequest, @Query() query: PageQuery) {
    return this.orders.list(req.user.id, query);
  }
  @Get('orders/:id') get(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(req.user.id, id);
  }
  @Get('orders/:id/invoice') invoice(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.invoice(req.user.id, id);
  }
}
@ApiTags('Admin orders')
@ApiBearerAuth()
@UseGuards(SessionGuard, AdminGuard)
@Controller('v1/admin')
export class AdminOrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}
  @Get('pricing') pricingInfo() {
    return this.orders.pricingInfo();
  }
  @Get('orders') list(@Query() query: PageQuery) {
    return this.orders.list(null, query);
  }
  @Patch('pricing') @ApiHeader({ name: 'If-Match', required: true }) pricing(
    @Req() req: AuthenticatedRequest,
    @Body() input: PricingDto,
    @Headers('if-match') revision: string | undefined,
  ) {
    return this.orders.pricing(input, req.user.id, parseRevision(revision));
  }
  @Get('orders/:id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(null, id);
  }
  @Get('orders/:id/invoice') invoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.invoice(null, id);
  }
  @Post('orders/:id/payments') payment(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RecordPaymentDto,
  ) {
    return this.orders.payment(id, input, req.user.id);
  }
  @Patch('orders/:id/status') status(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: OrderStatusDto,
  ) {
    return this.orders.status(id, input, req.user.id);
  }
}

@ApiTags('Pricing')
@Controller('v1/pricing')
export class PublicPricingController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}
  @Get()
  @Header('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300')
  info() {
    return this.orders.pricingInfo();
  }
}
