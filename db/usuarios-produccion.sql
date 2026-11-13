-- Run once in Supabase SQL Editor BEFORE provisioning the new accounts.
-- Existing roles and their permissions stay unchanged; only users marked by
-- the Auth Admin API with app_metadata.production_view_only=true are restricted.
begin;
create or replace function public.is_production_view_only()
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from auth.users u where u.id=auth.uid()
    and u.raw_app_meta_data->>'production_view_only'='true'
  );
$$;
revoke all on function public.is_production_view_only() from public,anon,authenticated;

create or replace function public.guard_production_view_only()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_schema='storage' then
    if tg_op='DELETE' then
      if old.bucket_id<>'planos-produccion' then return old; end if;
    elsif tg_op='UPDATE' then
      if old.bucket_id<>'planos-produccion' and new.bucket_id<>'planos-produccion' then return new; end if;
    elsif new.bucket_id<>'planos-produccion' then return new;
    end if;
  end if;
  if public.is_production_view_only() then
    raise exception 'Este usuario solo puede consultar Producción.' using errcode='42501';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.guard_production_view_only() from public,anon,authenticated;

do $$
declare target text;
begin
  foreach target in array array[
    'public.profiles','public.ordenes_produccion','public.items_produccion',
    'public.catalogo_productos','public.mezclas_produccion','public.registros_dosificacion',
    'public.historial_items','public.solicitudes_avance_items',
    'public.empleados_produccion','public.asistencia_empleados','storage.objects'
  ] loop
    if to_regclass(target) is null then raise exception 'Falta la tabla %; no se aplicaron cambios.',target; end if;
    execute format('drop trigger if exists production_view_only_guard on %s',target);
    execute format('create trigger production_view_only_guard before insert or update or delete on %s for each row execute function public.guard_production_view_only()',target);
  end loop;
end;
$$;

-- Service-role-only preflight used by scripts/crear-usuarios-produccion.py.
create or replace function public.production_access_setup_ready()
returns boolean language sql stable set search_path='' as $$ select true; $$;
revoke all on function public.production_access_setup_ready() from public,anon,authenticated;
grant execute on function public.production_access_setup_ready() to service_role;
notify pgrst,'reload schema';
commit;
