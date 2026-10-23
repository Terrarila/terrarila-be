import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import data from './catalog-seed.json' with { type: 'json' };
import presets from './design-presets-seed.json' with { type: 'json' };
import { loadConfig } from '../src/common/config.js';
import { createPool } from '../src/database/database.service.js';
import type { SqlClient } from '../src/database/database.service.js';

export async function seedCatalog(
  client: SqlClient,
  assetBaseUrl: string | null,
  syncDisplay = false,
) {
  const asset = (path: string | null) => (path && assetBaseUrl ? `${assetBaseUrl}${path}` : path);
  for (const category of data) {
    await client.query(
      `INSERT INTO material_categories(code,name,description,selection_mode,min_selections,max_selections,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(code) DO NOTHING`,
      [
        category.code,
        category.name,
        category.description,
        category.selectionMode,
        category.minSelections,
        category.maxSelections,
        category.sortOrder,
      ],
    );
    for (const item of category.materials) {
      await client.query(
        `INSERT INTO materials(category_id,legacy_id,slug,name,description,image_url,published,sort_order)
        SELECT id,$2,$3,$4,$5,$6,true,$7 FROM material_categories WHERE code=$1 ON CONFLICT(category_id,legacy_id) DO NOTHING`,
        [
          category.code,
          item.legacyId,
          item.slug,
          item.name,
          item.description,
          asset(item.imageUrl),
          item.sortOrder,
        ],
      );
    }
  }
  if (syncDisplay) {
    // Explicit one-time display sync only: keep UUIDs, prices, stock and publish flags.
    for (const category of data) {
      await client.query(
        `UPDATE material_categories SET name=$2,description=$3,sort_order=$4 WHERE code=$1`,
        [category.code, category.name, category.description, category.sortOrder],
      );
      for (const item of category.materials) {
        await client.query(
          `UPDATE materials m SET name=$3,description=$4,image_url=$5,sort_order=$6,
          revision=m.revision+1,updated_at=now() FROM material_categories c
          WHERE c.id=m.category_id AND c.code=$1 AND m.legacy_id=$2
          AND (m.name,m.description,m.image_url,m.sort_order) IS DISTINCT FROM ($3::text,$4::text,$5::text,$6::int)`,
          [
            category.code,
            item.legacyId,
            item.name,
            item.description,
            asset(item.imageUrl),
            item.sortOrder,
          ],
        );
      }
    }
  }
  for (const [index, preset] of presets.entries()) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO design_presets(slug,name,description,image_url,is_demo,published,sort_order)
      VALUES($1,$2,$3,$4,$5,true,$6) ON CONFLICT(slug) DO NOTHING RETURNING id`,
      [preset.slug, preset.name, preset.description, asset(preset.imageUrl), preset.isDemo, index],
    );
    // Existing preset edits and recipes are preserved on subsequent seed runs.
    if (!inserted.rows[0]) continue;
    const linked = await client.query<{ material_id: string }>(
      `INSERT INTO design_preset_materials(preset_id,material_id)
      SELECT $1,id FROM materials WHERE slug=ANY($2::text[]) RETURNING material_id`,
      [inserted.rows[0].id, preset.materialSlugs],
    );
    if (linked.rows.length !== preset.materialSlugs.length)
      throw new Error(`Incomplete preset recipe: ${preset.slug}`);
  }
  // The FE prices are design/reference content, not confirmed sellable prices.
  for (const [index, item] of [
    { slug: 'reu-nho', name: 'Rêu nhỏ', description: 'Bể tròn · Rêu & đá' },
    { slug: 'rung-dung', name: 'Rừng đứng', description: 'Bể trụ · Dương xỉ' },
    { slug: 'vuon-luc-giac', name: 'Vườn lục giác', description: 'Bể đa giác · Rêu & đá' },
  ].entries()) {
    await client.query(
      `INSERT INTO products(slug,name,description,sort_order) VALUES($1,$2,$3,$4) ON CONFLICT(slug) DO NOTHING`,
      [item.slug, item.name, item.description, index],
    );
  }
  const about = {
    eyebrow: 'MỘT DỰ ÁN NHỎ, TỪ TÌNH YÊU CÂY CỎ',
    title: 'Chậm một chút. Xanh thêm một chút.',
    paragraphs: [
      'Terralá bắt đầu từ mong muốn mang một khoảng thiên nhiên vào những không gian thường ngày. Mỗi bể là một lần sắp đặt, quan sát và chăm chút — từ lớp đất đầu tiên đến chiếc lá nhỏ nhất.',
    ],
    imageUrl: asset('/assets/landing/botanical-story.png'),
  };
  const storefront = {
    brand: 'terralá',
    tagline: 'Một chiếc lá. Một thế giới nhỏ.',
    deliveryNote: 'Hiện nhận giao trong TP. Hồ Chí Minh.',
    messengerUrl: null,
    zaloUrl: null,
  };
  for (const [key, value] of [
    ['about', about],
    ['storefront', storefront],
  ])
    await client.query(
      `INSERT INTO site_content(key,data,published) VALUES($1,$2::jsonb,true) ON CONFLICT(key) DO NOTHING`,
      [key, JSON.stringify(value)],
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const pool = createPool(
    { ...config, poolMax: 1 },
    process.env.MIGRATION_DATABASE_URL ?? config.databaseUrl,
  );
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await seedCatalog(client, config.assetBaseUrl, process.argv.includes('--sync-display'));
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally {
      client.release();
    }
    console.log(
      process.argv.includes('--sync-display')
        ? 'Catalog display synchronized; IDs, prices, stock and publish flags preserved.'
        : 'Catalog seed applied; existing edits, prices and stock preserved.',
    );
  } finally {
    await pool.end();
  }
}
