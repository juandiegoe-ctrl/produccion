-- Run in the Supabase SQL Editor for the production project.
-- Add GLB without replacing allowed formats, changing access policies or file limits.
-- A NULL list already permits all MIME types and must remain unrestricted.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'model/gltf-binary')
where id = 'planos-produccion'
  and allowed_mime_types is not null
  and not coalesce('model/gltf-binary' = any(allowed_mime_types), false);

-- Verify the bucket exists and the resulting allowlist.
select id, allowed_mime_types, file_size_limit
from storage.buckets
where id = 'planos-produccion';
