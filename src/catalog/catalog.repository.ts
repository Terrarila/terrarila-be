import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { decodeCursor, pageResult } from '../common/pagination.js';
import type { PageQuery } from '../common/pagination.js';
import type { MaterialsQuery } from './catalog.dto.js';

export type MaterialRow = {
  id: string;
  legacyId: string;
  slug: string;
  category: string;
  name: string;
  description: string;
  imageUrl: string | null;
  priceVnd: number | null;
  unit: string | null;
  availability: 'available' | 'unavailable' | 'inquiry';
  sortOrder: number;
  revision: number;
  published: boolean;
  parentMaterialId: string | null;
  sizeLabel: string | null;
  sizes: MaterialRow[];
  requiresSize: boolean;
};
export type CategoryRow = {
  code: string;
  name: string;
  description: string;
  selectionMode: 'single' | 'multiple';
  minSelections: number;
  maxSelections: number | null;
  sortOrder: number;
};
const materialColumns = `m.id,m.legacy_id AS "legacyId",m.slug,c.code AS category,m.name,m.description,
  m.image_url AS "imageUrl",m.price_vnd AS "priceVnd",m.unit,m.availability,m.published,m.sort_order AS "sortOrder",m.revision,
  m.parent_material_id AS "parentMaterialId",m.size_label AS "sizeLabel",
  EXISTS(SELECT 1 FROM materials s WHERE s.parent_material_id=m.id) AS "requiresSize",
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'legacyId',s.legacy_id,'slug',s.slug,'category',c.code,'name',s.name,'description',s.description,'imageUrl',s.image_url,'priceVnd',s.price_vnd,'unit',s.unit,'availability',s.availability,'published',s.published,'sortOrder',s.sort_order,'revision',s.revision,'parentMaterialId',s.parent_material_id,'sizeLabel',s.size_label) ORDER BY s.sort_order,s.id)
    FROM materials s WHERE s.parent_material_id=m.id AND s.published),'[]'::jsonb) AS sizes`;

@Injectable()
export class CatalogRepository {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async categories() {
    return (
      await this.db.query<CategoryRow>(
        `SELECT code,name,description,selection_mode AS "selectionMode", min_selections AS "minSelections",max_selections AS "maxSelections",sort_order AS "sortOrder" FROM material_categories WHERE active ORDER BY sort_order,code`,
      )
    ).rows;
  }
  async materials(query: MaterialsQuery, includeDraft = false) {
    const cursor = decodeCursor(query.cursor);
    const rows = (
      await this.db.query<MaterialRow>(
        `SELECT ${materialColumns} FROM materials m JOIN material_categories c ON c.id=m.category_id
      WHERE (m.published OR $5) AND (c.active OR $5) AND (m.parent_material_id IS NULL OR $5) AND ($1::text IS NULL OR c.code=$1)
      AND ($2::int IS NULL OR (m.sort_order,m.id)>($2::int,$3::uuid))
      ORDER BY m.sort_order,m.id LIMIT $4`,
        [
          query.category ?? null,
          cursor?.sortOrder ?? null,
          cursor?.id ?? null,
          query.limit + 1,
          includeDraft,
        ],
      )
    ).rows;
    return pageResult(rows, query.limit);
  }
  async selectedMaterials(ids: string[]) {
    return (
      await this.db.query<MaterialRow>(
        `SELECT ${materialColumns} FROM materials m JOIN material_categories c ON c.id=m.category_id WHERE m.id=ANY($1::uuid[]) AND m.published AND c.active
        AND (m.parent_material_id IS NULL OR EXISTS(SELECT 1 FROM materials p WHERE p.id=m.parent_material_id AND p.published AND p.availability<>'unavailable')) ORDER BY c.sort_order,m.sort_order,m.id`,
        [ids],
      )
    ).rows;
  }
  async products(query: PageQuery, kind: 'products' | 'portfolio_entries', includeDraft = false) {
    const cursor = decodeCursor(query.cursor);
    // Published products appear directly in portfolio: no copied rows can drift or duplicate.
    // Only this closed internal union selects SQL; never interpolate request input.
    const source =
      kind === 'products'
        ? 'products'
        : `(
      SELECT id,slug,name,description,images,sort_order,published,revision,
        NULL::text AS highlight_image_url,NULL::uuid AS source_product_id
      FROM portfolio_entries
      UNION ALL
      SELECT id,slug,name,description,images,sort_order,published,revision,
        highlight_image_url,id AS source_product_id
      FROM products WHERE published
    ) AS portfolio`;
    const price =
      kind === 'products'
        ? ',price_vnd AS "priceVnd",availability,highlight_image_url AS "highlightImageUrl"'
        : ',highlight_image_url AS "highlightImageUrl",source_product_id AS "sourceProductId"';
    const rows = (
      await this.db.query<{ id: string; sortOrder: number }>(
        `SELECT id,slug,name,description,images,sort_order AS "sortOrder",published,revision${price} FROM ${source} WHERE (published OR $4)
      AND ($1::int IS NULL OR (sort_order,id)>($1::int,$2::uuid)) ORDER BY sort_order,id LIMIT $3`,
        [cursor?.sortOrder ?? null, cursor?.id ?? null, query.limit + 1, includeDraft],
      )
    ).rows;
    return pageResult(rows, query.limit);
  }
  async designPresets(query: PageQuery) {
    const cursor = decodeCursor(query.cursor);
    const rows = (
      await this.db.query<{
        id: string;
        slug: string;
        name: string;
        description: string;
        imageUrl: string;
        isDemo: boolean;
        sortOrder: number;
        materialIds: string[];
      }>(
        `SELECT p.id,p.slug,p.name,p.description,p.image_url AS "imageUrl",p.is_demo AS "isDemo",p.sort_order AS "sortOrder",
      ARRAY(SELECT material_id FROM design_preset_materials WHERE preset_id=p.id ORDER BY material_id) AS "materialIds"
      FROM design_presets p WHERE p.published
      AND ($1::int IS NULL OR (p.sort_order,p.id)>($1::int,$2::uuid))
      ORDER BY p.sort_order,p.id LIMIT $3`,
        [cursor?.sortOrder ?? null, cursor?.id ?? null, query.limit + 1],
      )
    ).rows;
    return pageResult(rows, query.limit);
  }
  async product(slug: string) {
    const result = await this.db.query(
      `SELECT id,slug,name,description,images,price_vnd AS "priceVnd",availability,highlight_image_url AS "highlightImageUrl" FROM products WHERE slug=$1 AND published`,
      [slug],
    );
    if (!result.rows[0]) throw new NotFoundException('Product not found');
    return result.rows[0];
  }
  async content(key: 'about' | 'storefront', includeDraft = false) {
    const result = await this.db.query(
      `SELECT data,revision,updated_at AS "updatedAt" FROM site_content WHERE key=$1 AND (published OR $2::boolean)`,
      [key, includeDraft],
    );
    if (!result.rows[0]) throw new NotFoundException('Content not published');
    return result.rows[0];
  }
}
