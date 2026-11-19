import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsUUID } from 'class-validator';
import { SessionGuard } from '../auth/session.guard.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AdminGuard } from './admin.guard.js';
import { parseRevision } from '../common/pagination.js';
import { PortfolioRecipesService } from '../catalog/portfolio-recipes.service.js';

export class PortfolioRecipeDto {
  @ApiProperty({ type: [String], maxItems: 50 })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  materialIds!: string[];
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
@ApiTags('Admin Portfolio recipes')
@ApiBearerAuth()
@UseGuards(SessionGuard, AdminGuard)
@Controller('v1/admin/portfolio/:id/recipe')
export class PortfolioRecipesController {
  constructor(@Inject(PortfolioRecipesService) private readonly recipes: PortfolioRecipesService) {}
  @Get() get(@Param('id', ParseUUIDPipe) id: string) {
    return this.recipes.get(id);
  }
  @Patch()
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Recipe revision; 0 only when not configured',
  })
  save(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') revision: string | undefined,
    @Body() input: PortfolioRecipeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.recipes.save(
      id,
      revision === '0' ? 0 : parseRevision(revision),
      input,
      req.user.id,
    );
  }
}
