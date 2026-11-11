-- A recipe belongs to one production order. Preserve current assignments and snapshots.
alter table public.mezclas_produccion add column orden_id uuid;

-- Existing recipes have no creation-order field. Infer only when usage is unambiguous.
do $$
declare recipe record; owners uuid[];
begin
  for recipe in select id from public.mezclas_produccion loop
    select array_agg(distinct orden_id) into owners from (
      select orden_id from public.items_produccion where mezcla_id=recipe.id
      union
      select orden_id from public.registros_dosificacion where mezcla_id=recipe.id
    ) usage;
    if coalesce(cardinality(owners),0) <> 1 then
      raise exception 'Cannot infer one order for mixture %. Migration cancelled without changing assignments.',recipe.id;
    end if;
    update public.mezclas_produccion set orden_id=owners[1] where id=recipe.id;
  end loop;
end $$;

alter table public.mezclas_produccion
  alter column orden_id set not null,
  add constraint mezclas_produccion_orden_fkey foreign key(orden_id) references public.ordenes_produccion(id) on delete cascade,
  add constraint mezclas_produccion_id_orden_key unique(id,orden_id);
drop index public.mezclas_produccion_nombre_idx;
create unique index mezclas_produccion_orden_nombre_idx on public.mezclas_produccion(orden_id,lower(btrim(nombre)));

-- Reject assignments and records referring to recipes from a different order.
alter table public.items_produccion
  drop constraint items_produccion_mezcla_id_fkey,
  add constraint items_produccion_mezcla_orden_fkey foreign key(mezcla_id,orden_id)
    references public.mezclas_produccion(id,orden_id) on delete no action deferrable initially immediate;
alter table public.registros_dosificacion
  drop constraint registros_dosificacion_mezcla_id_fkey,
  add constraint registros_dosificacion_mezcla_orden_fkey foreign key(mezcla_id,orden_id)
    references public.mezclas_produccion(id,orden_id) on delete set null (mezcla_id);

create function public.preserve_mixture_order() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.orden_id is distinct from old.orden_id then
    raise exception 'La mezcla pertenece a su orden de origen.' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.preserve_mixture_order() from public,anon,authenticated;
create trigger preserve_mixture_order before update of orden_id on public.mezclas_produccion
for each row execute function public.preserve_mixture_order();

drop policy mezclas_consultar on public.mezclas_produccion;
drop policy mezclas_crear on public.mezclas_produccion;
drop policy mezclas_editar on public.mezclas_produccion;
create policy mezclas_consultar on public.mezclas_produccion for select to authenticated
  using ((select public.current_user_role())::text in ('ADMINISTRADOR','PRODUCCION','PRODUCCION_LECTURA','COMERCIAL')
    and exists(select 1 from public.ordenes_produccion o where o.id=mezclas_produccion.orden_id));
create policy mezclas_crear on public.mezclas_produccion for insert to authenticated
  with check ((select public.current_user_role())::text in ('ADMINISTRADOR','PRODUCCION')
    and exists(select 1 from public.ordenes_produccion o where o.id=mezclas_produccion.orden_id));
create policy mezclas_editar on public.mezclas_produccion for update to authenticated
  using ((select public.current_user_role())::text in ('ADMINISTRADOR','PRODUCCION')
    and exists(select 1 from public.ordenes_produccion o where o.id=mezclas_produccion.orden_id))
  with check ((select public.current_user_role())::text in ('ADMINISTRADOR','PRODUCCION')
    and exists(select 1 from public.ordenes_produccion o where o.id=mezclas_produccion.orden_id));
notify pgrst, 'reload schema';
