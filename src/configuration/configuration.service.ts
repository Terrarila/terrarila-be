import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CatalogRepository } from '../catalog/catalog.repository.js';
@Injectable()
export class ConfigurationService {
  constructor(@Inject(CatalogRepository) private readonly catalog: CatalogRepository) {}
  async validate(input: { materialIds: string[] }, allowShapeWithoutSize = false) {
    const [categories, materials] = await Promise.all([
      this.catalog.categories(),
      this.catalog.selectedMaterials(input.materialIds),
    ]);
    if (materials.length !== input.materialIds.length)
      throw new BadRequestException({
        code: 'MATERIAL_NOT_FOUND',
        message: 'Some selected materials are not published or do not exist',
      });
    const unavailable = materials.filter((item) => item.availability === 'unavailable');
    if (unavailable.length)
      throw new UnprocessableEntityException({
        code: 'MATERIAL_UNAVAILABLE',
        message: 'Some materials are currently unavailable',
      });
    if (
      !allowShapeWithoutSize &&
      materials.some((item) => item.category === 'glass' && item.requiresSize)
    )
      throw new UnprocessableEntityException({
        code: 'GLASS_SIZE_REQUIRED',
        message: 'Choose a size for the selected glass vessel',
      });
    for (const category of categories) {
      const count = materials.filter((item) => item.category === category.code).length;
      if (
        count < category.minSelections ||
        (category.maxSelections !== null && count > category.maxSelections)
      ) {
        throw new UnprocessableEntityException({
          code: 'SELECTION_LIMIT',
          message: `Category ${category.code} requires ${category.minSelections}..${category.maxSelections ?? 'unlimited'} selections`,
        });
      }
    }
    return {
      valid: true,
      materials,
      currency: 'VND',
      note: 'Selection validation only; pricing and stock must be confirmed again when quoting or ordering.',
    };
  }
}
