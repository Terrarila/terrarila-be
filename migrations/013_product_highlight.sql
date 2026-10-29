ALTER TABLE products ADD COLUMN highlight_image_url text;
ALTER TABLE products ADD CONSTRAINT products_highlight_image_url_valid CHECK (
  highlight_image_url IS NULL OR (
    length(highlight_image_url) <= 1024
    AND highlight_image_url ~ '^(https://[^[:space:]]+|/assets/[^[:space:]]+)$'
  )
);
