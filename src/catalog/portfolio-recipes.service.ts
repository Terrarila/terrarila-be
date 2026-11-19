import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { auditChanges } from '../common/audit-context.js';
import { ConfigurationService } from '../configuration/configuration.service.js';
import { DatabaseService } from '../database/database.service.js';
import type { SqlClient } from '../database/database.service.js';

type Source = { id: string; kind: 'product' | 'portfolio' };
type Recipe = { id: string; revision: number; enabled: boolean; materialIds: string[] };
@Injectable()
export class PortfolioRecipesService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ConfigurationService) private readonly configuration: ConfigurationService,
  ) {}
  private async source(client: SqlClient, id: string, lock = false): Promise<Source> {
    for (const [table, kind] of [
      ['portfolio_entries', 'portfolio'],
      ['products', 'product'],
    ] as const) {
      const row = (
        await client.query<{ id: string }>(
          `SELECT id FROM ${table} WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
          [id],
        )
      ).rows[0];
      if (row) return { ...row, kind };
    }
    throw new NotFoundException('Portfolio source not found');
  }
  private async recipe(client: SqlClient, source: Source, lock = false) {
    const column = source.kind === 'product' ? 'source_product_id' : 'source_portfolio_id';
    return (
      await client.query<Recipe>(
        `SELECT p.id,p.revision,p.published AS enabled,
      ARRAY(SELECT material_id FROM design_preset_materials WHERE preset_id=p.id ORDER BY material_id) AS "materialIds"
      FROM design_presets p WHERE ${column}=$1${lock ? ' FOR UPDATE' : ''}`,
        [source.id],
      )
    ).rows[0];
  }
  async get(id: string) {
    const source = await this.source(this.db.client, id);
    const recipe = await this.recipe(this.db.client, source);
    return {
      sourceId: id,
      revision: recipe?.revision ?? 0,
      enabled: recipe?.enabled ?? false,
      materialIds: recipe?.materialIds ?? [],
    };
  }
  async save(
    id: string,
    revision: number,
    input: { materialIds: string[]; enabled: boolean },
    actor: string,
  ) {
    return this.db.transaction(async (client) => {
      const source = await this.source(client, id, true);
      const previous = await this.recipe(client, source, true);
      if ((previous?.revision ?? 0) !== revision)
        throw new ConflictException('Recipe changed; reload before editing');
      const existingMaterials = await client.query(
        'SELECT id FROM materials WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',
        [input.materialIds],
      );
      if (existingMaterials.rows.length !== input.materialIds.length)
        throw new BadRequestException('Some recipe materials no longer exist');
      if (input.enabled) {
        // Hold the selected rows and glass parents while validating the same transaction snapshot.
        await client.query(
          'SELECT id FROM materials WHERE id=ANY($1::uuid[]) OR id IN (SELECT parent_material_id FROM materials WHERE id=ANY($1::uuid[])) ORDER BY id FOR SHARE',
          [input.materialIds],
        );
        await client.query('SELECT id FROM material_categories ORDER BY id FOR SHARE');
        await this.configuration.validate(input, false, client);
      }
      const presetId = previous?.id ?? randomUUID();
      if (previous) {
        await client.query(
          'UPDATE design_presets SET published=$2,revision=revision+1 WHERE id=$1',
          [presetId, input.enabled],
        );
        await client.query('DELETE FROM design_preset_materials WHERE preset_id=$1', [presetId]);
      } else {
        await client.query(
          `INSERT INTO design_presets(id,slug,name,image_url,published,source_product_id,source_portfolio_id)
          VALUES($1,$2,'Portfolio recipe','',$3,$4,$5)`,
          [
            presetId,
            `portfolio-recipe-${presetId}`,
            input.enabled,
            source.kind === 'product' ? id : null,
            source.kind === 'portfolio' ? id : null,
          ],
        );
      }
      if (input.materialIds.length)
        await client.query(
          'INSERT INTO design_preset_materials(preset_id,material_id) SELECT $1,unnest($2::uuid[])',
          [presetId, input.materialIds],
        );
      await client.query(
        'INSERT INTO admin_audit_log(actor_subject,action,entity_id,changes) VALUES($1,$2,$3,$4::jsonb)',
        [actor, 'portfolio.recipe_updated', id, auditChanges(input, previous ?? null)],
      );
      return { sourceId: id, revision: (previous?.revision ?? 0) + 1, ...input };
    });
  }
}
