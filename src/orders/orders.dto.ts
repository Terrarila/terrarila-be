import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
export class QuoteItemDto {
  @ApiProperty() @IsUUID() materialId!: string;
  @ApiProperty({ minimum: 1, maximum: 1000 }) @IsInt() @Min(1) @Max(1000) quantity!: number;
}
export class CreateQuoteDto {
  @ApiProperty({ enum: ['custom', 'product'] }) @IsIn(['custom', 'product']) kind!:
    'custom' | 'product';
  @ApiPropertyOptional({ type: [QuoteItemDto] })
  @ValidateIf((dto: CreateQuoteDto) => dto.kind === 'custom')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => QuoteItemDto)
  items?: QuoteItemDto[];
  @ApiPropertyOptional()
  @ValidateIf((dto: CreateQuoteDto) => dto.kind === 'product')
  @IsUUID()
  productId?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @ValidateIf((dto: CreateQuoteDto) => dto.kind === 'product')
  @IsInt()
  @Min(1)
  @Max(10)
  quantity?: number;
}
export class CreateOrderDto {
  @ApiProperty() @IsUUID() quoteId!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) recipientName!: string;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(30) phone!: string;
  @ApiProperty({ enum: ['pickup', 'delivery'] }) @IsIn(['pickup', 'delivery']) fulfillment!:
    'pickup' | 'delivery';
  @ApiPropertyOptional()
  @ValidateIf((dto: CreateOrderDto) => dto.fulfillment === 'delivery')
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address?: string;
  @ApiPropertyOptional()
  @ValidateIf((dto: CreateOrderDto) => dto.fulfillment === 'delivery')
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  deliveryAreaCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class RecordPaymentDto {
  @ApiProperty() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) amountVnd!: number;
  @ApiProperty({ description: 'Unique bank code + transaction reference; e.g. VCB:TX123' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  reference!: string;
}
export class OrderStatusDto {
  @ApiProperty({ enum: ['building', 'ready', 'shipping', 'completed', 'cancelled'] })
  @IsIn(['building', 'ready', 'shipping', 'completed', 'cancelled'])
  status!: string;
}
export class PricingDto {
  @ApiProperty({
    description: 'Custom labour markup in basis points: 5000 = 50% of material subtotal',
  })
  @IsInt()
  @Min(0)
  @Max(10000)
  labourBps!: number;
  @ApiProperty({ description: 'Basis points: 5000 = 50%' })
  @IsInt()
  @Min(0)
  @Max(10000)
  depositBps!: number;
  @ApiProperty({ enum: ['per_selection', 'quantity'] })
  @IsIn(['per_selection', 'quantity'])
  quantityMode!: 'per_selection' | 'quantity';
  @ApiProperty({ enum: ['separate', 'pickup'] }) @IsIn(['separate', 'pickup']) shippingMode!:
    'separate' | 'pickup';
  @ApiProperty({
    type: [String],
    description: 'Allowed delivery area codes, e.g. HCM; empty means pickup only',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  deliveryAreaCodes!: string[];
}
