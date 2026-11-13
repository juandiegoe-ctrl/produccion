-- Run in Supabase SQL Editor. Only Juan Diego can change states or approve.
begin;
create or replace function public.puede_aprobar_avances_produccion()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
   where p.id=auth.uid() and p.activo and p.rol::text='ADMINISTRADOR'
   and lower(u.email)='juandiegoe@gmail.com') and not public.is_production_view_only();
$$;
create or replace function public.puede_solicitar_avances_produccion()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.activo
   and p.rol::text in ('ADMINISTRADOR','PRODUCCION','PRODUCCION_LECTURA'))
   and not public.is_production_view_only() and not public.puede_aprobar_avances_produccion();
$$;
revoke all on function public.puede_aprobar_avances_produccion() from public,anon;
revoke all on function public.puede_solicitar_avances_produccion() from public,anon;
grant execute on function public.puede_aprobar_avances_produccion() to authenticated;
grant execute on function public.puede_solicitar_avances_produccion() to authenticated;

drop policy if exists avances_consultar on public.solicitudes_avance_items;
create policy avances_consultar on public.solicitudes_avance_items for select to authenticated using (
 (select public.puede_aprobar_avances_produccion()) or
 (solicitante_id=(select auth.uid()) and (select public.puede_solicitar_avances_produccion()))
);
drop policy if exists avances_solicitar on public.solicitudes_avance_items;
create policy avances_solicitar on public.solicitudes_avance_items for insert to authenticated with check (
 (select public.puede_solicitar_avances_produccion()) and solicitante_id=(select auth.uid())
 and estado='PENDIENTE' and revisor_id is null and revisado_en is null
 and exists(select 1 from public.items_produccion i join public.ordenes_produccion o on o.id=i.orden_id
   where i.id=item_id and i.estado=estado_origen and not coalesce(o.cerrada,false))
);
drop policy if exists avances_revisar on public.solicitudes_avance_items;
create policy avances_revisar on public.solicitudes_avance_items for update to authenticated
 using (estado='PENDIENTE' and (select public.puede_aprobar_avances_produccion()))
 with check (estado in ('APROBADA','RECHAZADA','OBSOLETA') and revisor_id=(select auth.uid())
   and revisado_en is not null and (select public.puede_aprobar_avances_produccion()));

-- Restrictive policies also constrain any other permissive policies in the project.
drop policy if exists avances_solicitar_sin_aprobar on public.solicitudes_avance_items;
create policy avances_solicitar_sin_aprobar on public.solicitudes_avance_items as restrictive for insert to authenticated
 with check ((select public.puede_solicitar_avances_produccion()) and solicitante_id=(select auth.uid())
   and estado='PENDIENTE' and revisor_id is null and revisado_en is null);
drop policy if exists avances_solo_propietario_revisa on public.solicitudes_avance_items;
create policy avances_solo_propietario_revisa on public.solicitudes_avance_items as restrictive for update to authenticated
 using ((select public.puede_aprobar_avances_produccion()))
 with check ((select public.puede_aprobar_avances_produccion()) and revisor_id=(select auth.uid()));
revoke delete on public.solicitudes_avance_items from authenticated;

create or replace function public.exigir_propietario_para_cambiar_estado()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Administrative maintenance without an authenticated application user remains possible.
 if auth.uid() is not null and not public.puede_aprobar_avances_produccion() then
   if tg_op='INSERT' then
     if new.estado::text<>'MOLDE' then
       raise exception 'Los ítems nuevos deben iniciar en MOLDE. Solicita el avance para aprobación.' using errcode='42501';
     end if;
   elsif new.estado is distinct from old.estado then
     raise exception 'El cambio de estado requiere aprobación de Juan Diego.' using errcode='42501';
   end if;
 end if;
 return new;
end;
$$;
revoke all on function public.exigir_propietario_para_cambiar_estado() from public,anon,authenticated;
drop trigger if exists exigir_propietario_para_cambiar_estado on public.items_produccion;
create trigger exigir_propietario_para_cambiar_estado before insert or update of estado
 on public.items_produccion for each row execute function public.exigir_propietario_para_cambiar_estado();
create or replace function public.solicitar_avance_item(p_item_id uuid) returns public.solicitudes_avance_items
language plpgsql security invoker set search_path='' as $$
declare item public.items_produccion; next_state public.production_item_status; request public.solicitudes_avance_items;
begin
  if not public.puede_solicitar_avances_produccion() then
    raise exception 'No tienes permiso para solicitar avances.' using errcode='42501';
  end if;
  select i.* into item from public.items_produccion i join public.ordenes_produccion o on o.id=i.orden_id
    where i.id=p_item_id and not coalesce(o.cerrada,false);
  if not found then raise exception 'El ítem no está disponible o su orden está cerrada.' using errcode='22023'; end if;
  next_state:=case item.estado::text when 'MOLDE' then 'FUNDIR' when 'FUNDIR' then 'PULIR' when 'PULIR' then 'ALISTAR' when 'ALISTAR' then 'ENTREGADO' else null end;
  if next_state is null then raise exception 'Este ítem no tiene otro avance para solicitar.' using errcode='22023'; end if;
  insert into public.solicitudes_avance_items(item_id,estado_origen,estado_solicitado)
    values(item.id,item.estado,next_state)
    on conflict(item_id) where estado='PENDIENTE' do nothing returning * into request;
  if not found then raise exception 'Este ítem ya tiene un avance pendiente de confirmación.' using errcode='23505'; end if;
  return request;
end $$;
create or replace function public.revisar_avance_item(p_solicitud_id uuid,p_aprobar boolean,p_comentario text default null)
returns public.solicitudes_avance_items language plpgsql security invoker set search_path='' as $$
declare request public.solicitudes_avance_items; item public.items_produccion; owner_order uuid; order_closed boolean; decision text;
begin
  if not public.puede_aprobar_avances_produccion() then
    raise exception 'Solo Juan Diego puede aprobar o rechazar avances.' using errcode='42501';
  end if;
  if p_aprobar is null then raise exception 'Selecciona confirmar o rechazar.' using errcode='22023'; end if;
  select * into request from public.solicitudes_avance_items where id=p_solicitud_id;
  if not found then raise exception 'La solicitud ya no está disponible.' using errcode='22023'; end if;
  select orden_id into owner_order from public.items_produccion where id=request.item_id;
  -- Lock order, item, then request. A concurrent order close or state change cannot race approval.
  select coalesce(cerrada,false) into order_closed from public.ordenes_produccion where id=owner_order for update;
  select * into item from public.items_produccion where id=request.item_id for update;
  select * into request from public.solicitudes_avance_items where id=p_solicitud_id for update;
  if not found then raise exception 'Esta solicitud ya fue revisada.' using errcode='22023'; end if;
  if request.estado<>'PENDIENTE' then raise exception 'Esta solicitud ya fue revisada.' using errcode='22023'; end if;
  if not p_aprobar then decision:='RECHAZADA';
  elsif order_closed or item.estado is distinct from request.estado_origen then decision:='OBSOLETA';
  else
    update public.items_produccion set estado=request.estado_solicitado where id=item.id;
    decision:='APROBADA';
  end if;
  update public.solicitudes_avance_items set estado=decision,revisor_id=auth.uid(),revisado_en=now(),
    comentario_revision=nullif(btrim(p_comentario),'') where id=request.id returning * into request;
  return request;
end $$;
revoke all on function public.solicitar_avance_item(uuid) from public,anon;
revoke all on function public.revisar_avance_item(uuid,boolean,text) from public,anon;
grant execute on function public.solicitar_avance_item(uuid) to authenticated;
grant execute on function public.revisar_avance_item(uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
