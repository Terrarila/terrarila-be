import {
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { CatalogAdminService } from './catalog-admin.service.js';
import { AdminGuard } from './admin.guard.js';
import { parseRevision } from '../common/pagination.js';

export class UpdateMaterialDto {
  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Matches(/^(https:\/\/[^\s]+|\/assets\/[^\s]+)$/)
  imageUrl?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: 2147483647 })
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  priceVnd?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  unit?: string | null;
  @ApiPropertyOptional({ enum: ['available', 'unavailable', 'inquiry'] })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['available', 'unavailable', 'inquiry'])
  availability?: string;
  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  published?: boolean;
  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(SessionGuard, AdminGuard)
@Controller('v1/admin/materials')
export class AdminMaterialsController {
  constructor(@Inject(CatalogAdminService) private readonly catalog: CatalogAdminService) {}
  @Patch(':id')
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Current material revision, e.g. "1"; prevents overwriting another admin edit',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() input: UpdateMaterialDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalog.update('materials', id, parseRevision(ifMatch), input, req.user.id);
  }
}
