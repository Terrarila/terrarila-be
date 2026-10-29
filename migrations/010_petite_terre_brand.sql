-- Rename only brand text; preserve other content, contact links and publication flags.
UPDATE site_content
SET data = regexp_replace(data::text, 'terralá', 'Petite Terre', 'gi')::jsonb,
    updated_at = now()
WHERE data::text ~* 'terralá';

UPDATE site_content
SET data = jsonb_set(jsonb_set(data, '{brand}', '"Petite Terre"'::jsonb), '{tagline}', '"Terrarium Studio"'::jsonb),
    updated_at = now()
WHERE key = 'storefront';
