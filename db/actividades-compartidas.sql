-- Run in Supabase SQL Editor. Keeps existing browser selections for explicit import.
begin;
create or replace function public.puede_ver_actividades_produccion()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and activo
   and rol::text in ('ADMINISTRADOR','PRODUCCION','PRODUCCION_LECTURA'));
$$;
create or replace function public.puede_editar_actividades_produccion()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and activo
   and rol::text in ('ADMINISTRADOR','PRODUCCION')) and not public.is_production_view_only();
$$;
revoke all on function public.puede_ver_actividades_produccion() from public,anon;
revoke all on function public.puede_editar_actividades_produccion() from public,anon;
grant execute on function public.puede_ver_actividades_produccion() to authenticated;
grant execute on function public.puede_editar_actividades_produccion() to authenticated;

create table if not exists public.actividades_produccion (
 item_id uuid primary key references public.items_produccion(id) on delete cascade,
 estado_seleccionado public.production_item_status not null,
 prioridad bigint generated always as identity unique,
 seleccionado_por uuid not null references public.profiles(id),
 seleccionado_en timestamptz not null default now()
);
create table if not exists public.actividades_produccion_adicionales (
 fecha date primary key,
 texto text not null default '' check(length(texto)<=5000),
 actualizado_por uuid not null references public.profiles(id),
 actualizado_en timestamptz not null default now()
);
alter table public.actividades_produccion enable row level security;
alter table public.actividades_produccion_adicionales enable row level security;
revoke all on public.actividades_produccion,public.actividades_produccion_adicionales from anon,authenticated;
grant select on public.actividades_produccion to authenticated;
grant select,insert,update on public.actividades_produccion_adicionales to authenticated;
drop policy if exists actividades_ver on public.actividades_produccion;
create policy actividades_ver on public.actividades_produccion for select to authenticated
 using ((select public.puede_ver_actividades_produccion()));
drop policy if exists adicionales_ver on public.actividades_produccion_adicionales;
create policy adicionales_ver on public.actividades_produccion_adicionales for select to authenticated
 using ((select public.puede_ver_actividades_produccion()));
drop policy if exists adicionales_crear on public.actividades_produccion_adicionales;
create policy adicionales_crear on public.actividades_produccion_adicionales for insert to authenticated
 with check ((select public.puede_editar_actividades_produccion()) and actualizado_por=(select auth.uid()));
drop policy if exists adicionales_editar on public.actividades_produccion_adicionales;
create policy adicionales_editar on public.actividades_produccion_adicionales for update to authenticated
 using ((select public.puede_editar_actividades_produccion()))
 with check ((select public.puede_editar_actividades_produccion()) and actualizado_por=(select auth.uid()));

create or replace function public.seleccionar_actividad_produccion(p_item_id uuid,p_seleccionado boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare owner_order uuid; closed boolean; item public.items_produccion;
begin
 if not public.puede_editar_actividades_produccion() then
   raise exception 'Solo Producción y Administración pueden editar las actividades.' using errcode='42501';
 end if;
 if p_seleccionado is null then raise exception 'Selecciona marcar o quitar.' using errcode='22023'; end if;
 select orden_id into owner_order from public.items_produccion where id=p_item_id;
 if not found then raise exception 'El ítem ya no existe.' using errcode='22023'; end if;
 -- Same order-first locking convention as the item-advance workflow.
 select coalesce(cerrada,false) into closed from public.ordenes_produccion where id=owner_order for update;
 select * into item from public.items_produccion where id=p_item_id for update;
 if not found then raise exception 'El ítem ya no existe.' using errcode='22023'; end if;
 if p_seleccionado then
   if closed or item.estado::text not in ('MOLDE','FUNDIR','PULIR','ALISTAR') then
     raise exception 'El ítem no está pendiente o su orden está cerrada.' using errcode='22023';
   end if;
   insert into public.actividades_produccion(item_id,estado_seleccionado,seleccionado_por)
     values (p_item_id,item.estado,auth.uid()) on conflict(item_id) do nothing;
 else
   delete from public.actividades_produccion where item_id=p_item_id;
 end if;
 return true;
end;
$$;
revoke all on function public.seleccionar_actividad_produccion(uuid,boolean) from public,anon;
grant execute on function public.seleccionar_actividad_produccion(uuid,boolean) to authenticated;

create or replace function public.retirar_actividad_al_avanzar()
returns trigger language plpgsql security definer set search_path='' as $$
declare stages text[]:=array['MOLDE','FUNDIR','PULIR','ALISTAR','ENTREGADO','CERRADO'];
begin
 if new.estado is distinct from old.estado then
   if new.estado::text in ('ENTREGADO','CERRADO')
     or array_position(stages,new.estado::text)>array_position(stages,old.estado::text) then
     delete from public.actividades_produccion where item_id=new.id;
   else
     update public.actividades_produccion set estado_seleccionado=new.estado where item_id=new.id;
   end if;
 end if;
 return new;
end;
$$;
revoke all on function public.retirar_actividad_al_avanzar() from public,anon,authenticated;
drop trigger if exists retirar_actividad_al_avanzar on public.items_produccion;
create trigger retirar_actividad_al_avanzar after update of estado on public.items_produccion
 for each row execute function public.retirar_actividad_al_avanzar();

do $$
begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='actividades_produccion') then
     alter publication supabase_realtime add table public.actividades_produccion;
   end if;
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='actividades_produccion_adicionales') then
     alter publication supabase_realtime add table public.actividades_produccion_adicionales;
   end if;
 end if;
end;
$$;
notify pgrst,'reload schema';
commit;
