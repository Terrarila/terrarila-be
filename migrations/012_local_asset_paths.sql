UPDATE materials SET image_url=regexp_replace(image_url, '^http://(localhost|127\.0\.0\.1):3000(/assets/)', '\2') WHERE image_url ~ '^http://(localhost|127\.0\.0\.1):3000/assets/';
UPDATE design_presets SET image_url=regexp_replace(image_url, '^http://(localhost|127\.0\.0\.1):3000(/assets/)', '\2') WHERE image_url ~ '^http://(localhost|127\.0\.0\.1):3000/assets/';
UPDATE products SET images=regexp_replace(images::text, 'http://(localhost|127\.0\.0\.1):3000(/assets/)', '\2', 'g')::jsonb WHERE images::text ~ 'http://(localhost|127\.0\.0\.1):3000/assets/';
UPDATE portfolio_entries SET images=regexp_replace(images::text, 'http://(localhost|127\.0\.0\.1):3000(/assets/)', '\2', 'g')::jsonb WHERE images::text ~ 'http://(localhost|127\.0\.0\.1):3000/assets/';
UPDATE site_content SET data=regexp_replace(data::text, 'http://(localhost|127\.0\.0\.1):3000(/assets/)', '\2', 'g')::jsonb WHERE data::text ~ 'http://(localhost|127\.0\.0\.1):3000/assets/';
