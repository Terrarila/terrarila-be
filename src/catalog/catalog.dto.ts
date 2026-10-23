import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';
import { PageQuery } from '../common/pagination.js';
export class MaterialsQuery extends PageQuery {
  @ApiPropertyOptional({ example: 'moss' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9-]{0,39}$/)
  category?: string;
}
