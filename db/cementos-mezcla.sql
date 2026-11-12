-- Split the existing cement quantity between white and gray cement.
alter table public.mezclas_produccion
  add column cemento_blanco_pct numeric(7,4),
  add column cemento_gris_pct numeric(7,4);
update public.mezclas_produccion set
  cemento_blanco_pct=case when cemento_tipo='BLANCO' then 100 else 0 end,
  cemento_gris_pct=case when cemento_tipo='GRIS' then 100 else 0 end
where cemento_blanco_pct is null and cemento_gris_pct is null;
alter table public.mezclas_produccion
  alter column cemento_blanco_pct set default 100,
  alter column cemento_blanco_pct set not null,
  alter column cemento_gris_pct set default 0,
  alter column cemento_gris_pct set not null,
  add constraint mezcla_cemento_blanco_pct_check check(cemento_blanco_pct between 0 and 100),
  add constraint mezcla_cemento_gris_pct_check check(cemento_gris_pct between 0 and 100),
  add constraint mezcla_cementos_total_check check(cemento_blanco_pct+cemento_gris_pct=100);
comment on column public.mezclas_produccion.cemento_blanco_pct is 'Share of total cement weight. White plus gray must equal 100%.';
comment on column public.mezclas_produccion.cemento_gris_pct is 'Share of total cement weight. Ingredients at 0% are omitted from dosage and printed recipes.';
notify pgrst, 'reload schema';
