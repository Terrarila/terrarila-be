import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ConfigurationDto } from '../configuration/configuration.controller.js';
export class DesignRequestDto extends ConfigurationDto {
  @ApiProperty({
    description: 'Tên khách để shop liên hệ',
    example: 'Khách thử nghiệm',
    minLength: 2,
    maxLength: 120,
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  recipientName!: string;
  @ApiProperty({ description: 'Số Việt Nam: 0 hoặc +84 và 9 chữ số', example: '0901234567' })
  @IsString()
  @Matches(/^(?:0|\+84)[0-9]{9}$/)
  phone!: string;
  @ApiProperty({
    description: 'Khu vực nhận tại TP.HCM hoặc nhận tại shop',
    example: 'Thủ Đức',
    minLength: 2,
    maxLength: 160,
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  area!: string;
  @ApiPropertyOptional({
    description: 'Ngày mong muốn; shop cần xác nhận',
    type: String,
    format: 'date',
    example: '2026-12-01',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  preferredDate?: string;
  @ApiPropertyOptional({ example: 'Muốn bố cục rừng nhỏ trên bàn làm việc', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
export class ReviewRequestDto {
  @ApiProperty({
    enum: ['pending', 'contacted', 'closed'],
    description: 'Trạng thái tiếp nhận tư vấn, không phải trạng thái thanh toán',
  })
  @IsIn(['pending', 'contacted', 'closed'])
  status!: 'pending' | 'contacted' | 'closed';
}
