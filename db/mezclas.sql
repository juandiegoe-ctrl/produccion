-- Reusable color/grain recipes. Water, additive and carbonate keep the portal's base recipe.
create table public.mezclas_produccion (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  cemento_tipo text not null check (cemento_tipo in ('BLANCO','GRIS')),
  arena_fina_color text not null check (length(btrim(arena_fina_color)) between 1 and 120),
  arena_gruesa_color text not null check (length(btrim(arena_gruesa_color)) between 1 and 120),
  grano_1_color text not null default '',
  grano_1_tamano text not null default '',
  grano_1_pct numeric(7,4) not null default 0 check (grano_1_pct between 0 and 100),
  grano_2_color text not null default '',
  grano_2_tamano text not null default '',
  grano_2_pct numeric(7,4) not null default 0 check (grano_2_pct between 0 and 100),
  grano_3_color text not null default '',
  grano_3_tamano text not null default '',
  grano_3_pct numeric(7,4) not null default 0 check (grano_3_pct between 0 and 100),
  created_at timestamptz not null default now(),
  constraint grano_1_referencia check (grano_1_pct = 0 or (length(btrim(grano_1_color)) between 1 and 120 and length(btrim(grano_1_tamano)) between 1 and 120)),
  constraint grano_2_referencia check (grano_2_pct = 0 or (length(btrim(grano_2_color)) between 1 and 120 and length(btrim(grano_2_tamano)) between 1 and 120)),
  constraint grano_3_referencia check (grano_3_pct = 0 or (length(btrim(grano_3_color)) between 1 and 120 and length(btrim(grano_3_tamano)) between 1 and 120))
);
create unique index mezclas_produccion_nombre_idx on public.mezclas_produccion (lower(btrim(nombre)));
alter table public.mezclas_produccion enable row level security;
revoke all on public.mezclas_produccion from anon;
grant select, insert, update on public.mezclas_produccion to authenticated;
create policy mezclas_consultar on public.mezclas_produccion for select to authenticated
  using ((select public.current_user_role())::text in ('ADMINISTRADOR','PRODUCCION','PRODUCCION_LECTURA','COMERCIAL'));
create policy mezclas_crear on public.mezclas_produccion for insert to authenticated
  with check ((select public.current_user_role())::text in ('ADMINISTRADOR','PRODUCCION'));
create policy mezclas_editar on public.mezclas_produccion for update to authenticated
  using ((select public.current_user_role())::text in ('ADMINISTRADOR','PRODUCCION'))
  with check ((select public.current_user_role())::text in ('ADMINISTRADOR','PRODUCCION'));
alter table public.items_produccion add column mezcla_id uuid references public.mezclas_produccion(id) on delete restrict;
create index items_produccion_mezcla_idx on public.items_produccion (mezcla_id) where mezcla_id is not null;
notify pgrst, 'reload schema';
