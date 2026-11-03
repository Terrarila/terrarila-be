import { auditChanges } from '../common/audit-context.js';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

const fields = {
  materials: {
    name: 'name',
    description: 'description',
    imageUrl: 'image_url',
    priceVnd: 'price_vnd',
    unit: 'unit',
    availability: 'availability',
    published: 'published',
    sortOrder: 'sort_order',
  },
  products: {
    highlightImageUrl: 'highlight_image_url',
    name: 'name',
    description: 'description',
    slug: 'slug',
    images: 'images',
    priceVnd: 'price_vnd',
    availability: 'availability',
    published: 'published',
    sortOrder: 'sort_order',
  },
  portfolio_entries: {
    name: 'name',
    description: 'description',
    slug: 'slug',
    images: 'images',
    published: 'published',
    sortOrder: 'sort_order',
  },
} as const;
export type CatalogEntity = keyof typeof fields;
export function catalogWriteError(error: unknown): never {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  if (code === '23505') throw new ConflictException('Duplicate slug or catalog identifier');
  if (code === '23514' || code === '23502')
    throw new BadRequestException(
      'Invalid catalog values; a material price requires a non-empty unit',
    );
  throw error;
}
@Injectable()
export class CatalogAdminService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}
  async update(table: CatalogEntity, id: string, revision: number, input: object, actor: string) {
    const mapping: Record<string, string> = fields[table];
    const entries = Object.entries(input).filter(
      ([key, value]) => mapping[key] && value !== undefined,
    );
    if (!entries.length) throw new BadRequestException('No fields to update');
    const values: unknown[] = entries.map(([key, value]) =>
      key === 'images' ? JSON.stringify(value) : value,
    );
    const assignments = entries.map(
      ([key], index) => `${mapping[key]}=$${index + 1}${key === 'images' ? '::jsonb' : ''}`,
    );
    const offset = entries.length;
    values.push(id, revision, actor, auditChanges(input));
    try {
      const result = await this.db.query(
        `WITH previous AS MATERIALIZED (
        SELECT to_jsonb(t) AS data FROM ${table} t WHERE id=$${offset + 1}::uuid AND revision=$${offset + 2} FOR UPDATE
      ), changed AS (
        UPDATE ${table} SET ${assignments.join(',')},revision=revision+1,updated_at=now() WHERE id=$${offset + 1}::uuid AND revision=$${offset + 2} AND EXISTS(SELECT 1 FROM previous) RETURNING id,revision
      ),audit AS (
        INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) SELECT $${offset + 3},'${table}.updated',id,jsonb_set($${offset + 4}::jsonb,'{_before}',(SELECT data FROM previous)) FROM changed RETURNING id
      ) SELECT id,revision FROM changed`,
        values,
      );
      if (!result.rows[0])
        throw new ConflictException(
          'Catalog revision changed or item missing; reload before editing',
        );
      return result.rows[0];
    } catch (error) {
      catalogWriteError(error);
    }
  }
  async create(
    table: 'products' | 'portfolio_entries',
    input: {
      slug: string;
      name: string;
      description?: string;
      images: object[];
      highlightImageUrl?: string | null;
      priceVnd?: number | null;
      availability?: string;
      published?: boolean;
      sortOrder?: number;
    },
    actor: string,
  ) {
    try {
      return await this.db.transaction(async (client) => {
        const values: unknown[] = [
          input.slug,
          input.name,
          input.description ?? '',
          JSON.stringify(input.images),
          input.published ?? false,
          input.sortOrder ?? 0,
        ];
        const extra = table === 'products' ? ',price_vnd,availability,highlight_image_url' : '';
        const placeholders = table === 'products' ? ',$7,$8,$9' : '';
        if (table === 'products')
          values.push(
            input.priceVnd ?? null,
            input.availability ?? 'inquiry',
            input.highlightImageUrl ?? null,
          );
        const row = (
          await client.query(
            `INSERT INTO ${table}(slug,name,description,images,published,sort_order${extra}) VALUES($1,$2,$3,$4::jsonb,$5,$6${placeholders}) RETURNING id,revision`,
            values,
          )
        ).rows[0]!;
        await client.query(
          `INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) VALUES($1,$2,$3,$4::jsonb)`,
          [actor, `${table}.created`, row.id, auditChanges(input)],
        );
        return row;
      });
    } catch (error) {
      catalogWriteError(error);
    }
  }
  async createMaterial(
    input: {
      category: string;
      legacyId: string;
      slug: string;
      name: string;
      description?: string;
      imageUrl?: string | null;
      priceVnd?: number | null;
      unit?: string | null;
      availability?: string;
      published?: boolean;
      sortOrder?: number;
    },
    actor: string,
  ) {
    try {
      return await this.db.transaction(async (client) => {
        const category = (
          await client.query('SELECT id FROM material_categories WHERE code=$1', [input.category])
        ).rows[0];
        if (!category) throw new BadRequestException('Material category not found');
        const row = (
          await client.query(
            `INSERT INTO materials(category_id,legacy_id,slug,name,description,image_url,price_vnd,unit,availability,published,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,revision`,
            [
              category.id,
              input.legacyId,
              input.slug,
              input.name,
              input.description ?? '',
              input.imageUrl ?? null,
              input.priceVnd ?? null,
              input.unit ?? null,
              input.availability ?? 'inquiry',
              input.published ?? false,
              input.sortOrder ?? 0,
            ],
          )
        ).rows[0]!;
        await client.query(
          `INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) VALUES($1,'materials.created',$2,$3::jsonb)`,
          [actor, row.id, auditChanges(input)],
        );
        return row;
      });
    } catch (error) {
      catalogWriteError(error);
    }
  }
}
