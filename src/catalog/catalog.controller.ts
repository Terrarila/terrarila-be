import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { validateMaterialSelection } from '../configuration/configuration.service.js';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PageQuery } from '../common/pagination.js';
import { CatalogRepository } from './catalog.repository.js';
import type { PresetRow } from './catalog.repository.js';
import { MaterialsQuery } from './catalog.dto.js';

const CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
@ApiTags('Catalog')
@Controller('v1')
export class CatalogController {
  constructor(@Inject(CatalogRepository) private readonly catalog: CatalogRepository) {}
  @Get('material-categories')
  @Header('Cache-Control', CACHE)
  @ApiOperation({
    summary: 'Categories and selection constraints; FE must not hardcode the moss limit',
  })
  categories() {
    return this.catalog.categories();
  }
  @Get('materials')
  @Header('Cache-Control', CACHE)
  materials(@Query() query: MaterialsQuery) {
    return this.catalog.materials(query);
  }
  @Get('design-presets')
  @Header('Cache-Control', CACHE)
  @ApiOperation({
    summary:
      'Editable starting designs with materials; not fixed-price products. Invalid or unavailable recipes cannot be applied.',
  })
  async designPresets(@Query() query: PageQuery) {
    const page = await this.catalog.designPresets(query);
    return this.expandPresets(page, true);
  }
  @Get('portfolio-templates')
  @Header('Cache-Control', CACHE)
  @ApiOperation({
    summary:
      'Live published Portfolio items with explicitly configured material recipes; never infer a recipe from an image.',
  })
  async portfolioTemplates(@Query() query: PageQuery) {
    return this.expandPresets(await this.catalog.portfolioTemplates(query), false);
  }
  private async expandPresets<T extends PresetRow>(
    page: { items: T[]; nextCursor: string | null },
    allowShapeWithoutSize: boolean,
  ) {
    const ids = [...new Set(page.items.flatMap((item) => item.materialIds))];
    const [categories, materials] = await Promise.all([
      this.catalog.categories(),
      this.catalog.selectedMaterials(ids),
    ]);
    const byId = new Map(materials.map((material) => [material.id, material]));
    const items = page.items.map(({ materialIds, enabled = true, ...preset }) => {
      if (!enabled) return { ...preset, materials: [], selectable: false, configured: false };
      try {
        const selected = materialIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
        const { materials } = validateMaterialSelection(
          materialIds,
          categories,
          selected,
          allowShapeWithoutSize,
        );
        return { ...preset, materials, selectable: true, configured: true };
      } catch (error) {
        if (!(
          error instanceof BadRequestException || error instanceof UnprocessableEntityException
        ))
          throw error;
        return { ...preset, materials: [], selectable: false, configured: true };
      }
    });
    return { ...page, items };
  }
  @Get('products')
  @Header('Cache-Control', CACHE)
  products(@Query() query: PageQuery) {
    return this.catalog.products(query, 'products');
  }
  @Get('products/:slug')
  @Header('Cache-Control', CACHE)
  product(@Param('slug') slug: string) {
    return this.catalog.product(slug);
  }
  @Get('portfolio')
  @Header('Cache-Control', CACHE)
  portfolio(@Query() query: PageQuery) {
    return this.catalog.products(query, 'portfolio_entries');
  }
  @Get('content/about')
  @Header('Cache-Control', CACHE)
  about() {
    return this.catalog.content('about');
  }
  @Get('storefront')
  @Header('Cache-Control', CACHE)
  storefront() {
    return this.catalog.content('storefront');
  }
}
