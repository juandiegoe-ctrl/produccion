-- Keep immutable recipe and item labels with every registered batch.
alter table public.registros_dosificacion
  add column item_id uuid references public.items_produccion(id) on delete set null,
  add column mezcla_id uuid references public.mezclas_produccion(id) on delete set null,
  add column item_codigo text,
  add column mezcla_nombre text,
  add column receta_snapshot jsonb;
create index registros_dosificacion_item_idx on public.registros_dosificacion(item_id) where item_id is not null;
create index registros_dosificacion_mezcla_idx on public.registros_dosificacion(mezcla_id) where mezcla_id is not null;
notify pgrst, 'reload schema';
