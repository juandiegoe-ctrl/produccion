-- General production-order notes; existing orders remain unchanged.
alter table public.ordenes_produccion add column observaciones text;
comment on column public.ordenes_produccion.observaciones is 'General order observations shown on the printed production sheet.';
notify pgrst, 'reload schema';
