import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
  ValidateNested,
} from 'class-validator';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AdminGuard } from './admin.guard.js';
import { CatalogAdminService } from './catalog-admin.service.js';
import { CatalogRepository } from '../catalog/catalog.repository.js';
import { MaterialsQuery } from '../catalog/catalog.dto.js';
import { PageQuery, parseRevision } from '../common/pagination.js';
import { UpdateMaterialDto } from './admin.controller.js';
import { auditChanges } from '../common/audit-context.js';
import { DatabaseService } from '../database/database.service.js';

export class CreateMaterialDto extends OmitType(UpdateMaterialDto, ['name'] as const) {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiProperty() @Matches(/^[a-z][a-z0-9-]{0,39}$/) category!: string;
  @ApiProperty() @Matches(/^[a-z0-9][a-z0-9-]{0,79}$/) legacyId!: string;
  @ApiProperty() @Matches(/^[a-z0-9][a-z0-9-]{0,119}$/) slug!: string;
}
export class ImageAssetDto {
  @ApiProperty()
  @IsString()
  @MaxLength(1024)
  @Matches(/^(https:\/\/[^\s]+|\/assets\/[^\s]+)$/)
  url!: string;
  @ApiProperty() @IsString() @MaxLength(200) alt!: string;
}
export class PortfolioDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiProperty() @Matches(/^[a-z0-9][a-z0-9-]{0,119}$/) slug!: string;
  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(4000)
  description?: string;
  @ApiProperty({ type: [ImageAssetDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ImageAssetDto)
  images!: ImageAssetDto[];
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
export class ProductDto extends PortfolioDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Matches(/^(https:\/\/[^\s]+|\/assets\/[^\s]+)$/)
  highlightImageUrl?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  priceVnd?: number | null;
  @ApiPropertyOptional()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['available', 'unavailable', 'inquiry'])
  availability?: string;
}
export class ProductPatchDto extends PartialType(ProductDto, { skipNullProperties: false }) {}
export class PortfolioPatchDto extends PartialType(PortfolioDto, { skipNullProperties: false }) {}
export class AboutDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @ApiProperty() @IsString() @MaxLength(200) eyebrow!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(4000, { each: true })
  paragraphs!: string[];
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Matches(/^(https:\/\/[^\s]+|\/assets\/[^\s]+)$/)
  imageUrl?: string | null;
}
export class StorefrontDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) brand!: string;
  @ApiProperty() @IsString() @MaxLength(200) tagline!: string;
  @ApiProperty() @IsString() @MaxLength(500) deliveryNote!: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @Matches(/^https:\/\/[^\s]+$/)
  @MaxLength(1024)
  messengerUrl?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @IsString()
  @Matches(/^https:\/\/[^\s]+$/)
  @MaxLength(1024)
  zaloUrl?: string | null;
}
@ApiTags('Admin catalog')
@ApiBearerAuth()
@UseGuards(SessionGuard, AdminGuard)
@Controller('v1/admin')
export class AdminCatalogController {
  constructor(
    @Inject(CatalogAdminService) private readonly writes: CatalogAdminService,
    @Inject(CatalogRepository) private readonly catalog: CatalogRepository,
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}
  @Get('materials') materials(@Query() query: MaterialsQuery) {
    return this.catalog.materials(query, true);
  }
  @Post('materials') material(@Body() input: CreateMaterialDto, @Req() req: AuthenticatedRequest) {
    return this.writes.createMaterial(input, req.user.id);
  }
  @Get('products') products(@Query() query: PageQuery) {
    return this.catalog.products(query, 'products', true);
  }
  @Post('products') product(@Body() input: ProductDto, @Req() req: AuthenticatedRequest) {
    return this.writes.create('products', input, req.user.id);
  }
  @Patch('products/:id') @ApiHeader({ name: 'If-Match', required: true }) updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') revision: string | undefined,
    @Body() input: ProductPatchDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.writes.update('products', id, parseRevision(revision), input, req.user.id);
  }
  @Get('portfolio') portfolio(@Query() query: PageQuery) {
    return this.catalog.products(query, 'portfolio_entries', true);
  }
  @Post('portfolio') entry(@Body() input: PortfolioDto, @Req() req: AuthenticatedRequest) {
    return this.writes.create('portfolio_entries', input, req.user.id);
  }
  @Patch('portfolio/:id') @ApiHeader({ name: 'If-Match', required: true }) updatePortfolio(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') revision: string | undefined,
    @Body() input: PortfolioPatchDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.writes.update('portfolio_entries', id, parseRevision(revision), input, req.user.id);
  }
  private async content(
    key: 'about' | 'storefront',
    input: AboutDto | StorefrontDto,
    actor: string,
    revision: number,
  ) {
    return this.db.transaction(async (client) => {
      const previous = (
        await client.query<{ data: unknown; revision: number }>(
          'SELECT data,revision FROM site_content WHERE key=$1 FOR UPDATE',
          [key],
        )
      ).rows[0];
      if ((previous?.revision ?? 0) !== revision)
        throw new ConflictException('Content changed; reload before editing');
      const row = (
        await client.query(
          `INSERT INTO site_content(key,data,published,revision) VALUES($1,$2::jsonb,true,1)
        ON CONFLICT(key) DO UPDATE SET data=excluded.data,published=true,revision=site_content.revision+1,updated_at=now()
        WHERE site_content.revision=$3 RETURNING key,revision,updated_at AS "updatedAt"`,
          [key, JSON.stringify(input), revision],
        )
      ).rows[0];
      if (!row) throw new ConflictException('Content changed; reload before editing');
      await client.query(
        `INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) VALUES($1,$2,'00000000-0000-4000-8000-000000000000',$3::jsonb)`,
        [actor, `content.${key}.updated`, auditChanges(input, previous?.data ?? null)],
      );
      return row;
    });
  }
  @Get('content/about') readAbout() {
    return this.catalog.content('about', true);
  }
  @Get('storefront') readStorefront() {
    return this.catalog.content('storefront', true);
  }
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Loaded content revision; 0 only when the document does not exist',
  })
  @Patch('content/about')
  about(
    @Body() input: AboutDto,
    @Req() req: AuthenticatedRequest,
    @Headers('if-match') revision?: string,
  ) {
    return this.content('about', input, req.user.id, contentRevision(revision));
  }
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Loaded content revision; 0 only when the document does not exist',
  })
  @Patch('storefront')
  storefront(
    @Body() input: StorefrontDto,
    @Req() req: AuthenticatedRequest,
    @Headers('if-match') revision?: string,
  ) {
    return this.content('storefront', input, req.user.id, contentRevision(revision));
  }
}

// Revision zero is reserved for creating content that is genuinely absent.
function contentRevision(value?: string) {
  return value === '0' ? 0 : parseRevision(value);
}
