-- Sizes are selectable material rows. Shape IDs remain stable for existing presets/drafts.
ALTER TABLE materials ADD COLUMN parent_material_id uuid REFERENCES materials(id) ON DELETE RESTRICT;
ALTER TABLE materials ADD COLUMN size_label text;
ALTER TABLE materials ADD CONSTRAINT material_size_fields CHECK (
 (parent_material_id IS NULL AND size_label IS NULL) OR
 (parent_material_id IS NOT NULL AND size_label IS NOT NULL AND parent_material_id<>id AND length(trim(size_label)) BETWEEN 1 AND 120)
);
CREATE INDEX material_sizes_parent ON materials(parent_material_id,sort_order,id) WHERE parent_material_id IS NOT NULL;
INSERT INTO materials(category_id,legacy_id,slug,name,description,image_url,published,sort_order,price_vnd,unit,availability,parent_material_id,size_label)
SELECT p.category_id,p.legacy_id||'-'||v.code,p.slug||'-'||v.code,p.name||' · '||v.label,v.label,p.image_url,true,v.sort_order,v.price_vnd,'bể',p.availability,p.id,v.label
FROM (VALUES
 ('vertical-rectangle','25x10x18','25×10×18 cm (D×R×C)',150000,0),
 ('vertical-rectangle','15x15x25','15×15×25 cm (D×R×C)',150000,1),
 ('vertical-rectangle','10x10x20','10×10×20 cm (D×R×C)',120000,2),
 ('cubic-square','10x10','Cubic 10×10 cm',60000,0),
 ('cubic-square','12x12','Cubic 12×12 cm',80000,1),
 ('cubic-square','15x15','Cubic 15×15 cm',100000,2),
 ('cubic-square','20x20','Cubic 20×20 cm',130000,3),
 ('horizontal-retangle','15x6x6','15×6×6 cm',90000,0),
 ('horizontal-retangle','20x10x10','20×10×10 cm',110000,1)
) AS v(parent,code,label,price_vnd,sort_order)
JOIN materials p ON p.legacy_id=v.parent
JOIN material_categories c ON c.id=p.category_id AND c.code='glass'
ON CONFLICT(category_id,legacy_id) DO NOTHING;
-- Shape-level prices are no longer usable without an explicitly selected size.
UPDATE materials p SET price_vnd=NULL,unit=NULL,revision=revision+1,updated_at=now()
WHERE EXISTS(SELECT 1 FROM materials s WHERE s.parent_material_id=p.id);
