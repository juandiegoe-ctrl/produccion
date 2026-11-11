-- A named pigment with NULL percentage is dosed by eye. Empty name means unused.
alter table public.mezclas_produccion
  add column pigmento_1_nombre text not null default '' check (length(pigmento_1_nombre) <= 120),
  add column pigmento_1_pct numeric(7,4) default null,
  add column pigmento_2_nombre text not null default '' check (length(pigmento_2_nombre) <= 120),
  add column pigmento_2_pct numeric(7,4) default null,
  add constraint pigmento_1_dosis check (pigmento_1_pct is null or (pigmento_1_pct between 0 and 100 and length(btrim(pigmento_1_nombre)) > 0)),
  add constraint pigmento_2_dosis check (pigmento_2_pct is null or (pigmento_2_pct between 0 and 100 and length(btrim(pigmento_2_nombre)) > 0));
comment on column public.mezclas_produccion.pigmento_1_pct is 'Percentage of cement weight; NULL with a nonempty name means by eye.';
comment on column public.mezclas_produccion.pigmento_2_pct is 'Percentage of cement weight; NULL with a nonempty name means by eye.';
notify pgrst, 'reload schema';
