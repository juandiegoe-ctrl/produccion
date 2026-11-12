-- Consultation users request the next production step; only administrators approve it.
create table public.solicitudes_avance_items (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items_produccion(id) on delete cascade,
  estado_origen public.production_item_status not null,
  estado_solicitado public.production_item_status not null,
  solicitante_id uuid not null default auth.uid() references public.profiles(id),
  estado text not null default 'PENDIENTE' check(estado in ('PENDIENTE','APROBADA','RECHAZADA','OBSOLETA')),
  creado_en timestamptz not null default now(),
  revisor_id uuid references public.profiles(id),
  revisado_en timestamptz,
  comentario_revision text check(length(comentario_revision)<=2000),
  constraint avance_siguiente_etapa check (
    (estado_origen='MOLDE' and estado_solicitado='FUNDIR') or
    (estado_origen='FUNDIR' and estado_solicitado='PULIR') or
    (estado_origen='PULIR' and estado_solicitado='ALISTAR') or
    (estado_origen='ALISTAR' and estado_solicitado='ENTREGADO')
  ),
  constraint avance_revision_consistente check (
    (estado='PENDIENTE' and revisor_id is null and revisado_en is null) or
    (estado<>'PENDIENTE' and revisor_id is not null and revisado_en is not null)
  )
);
create unique index solicitudes_avance_item_pendiente_idx on public.solicitudes_avance_items(item_id) where estado='PENDIENTE';
create index solicitudes_avance_solicitante_idx on public.solicitudes_avance_items(solicitante_id,estado);
create index solicitudes_avance_revisor_idx on public.solicitudes_avance_items(revisor_id) where revisor_id is not null;
create index solicitudes_avance_pendientes_idx on public.solicitudes_avance_items(creado_en) where estado='PENDIENTE';
alter table public.solicitudes_avance_items enable row level security;
revoke all on public.solicitudes_avance_items from anon,authenticated;
grant select on public.solicitudes_avance_items to authenticated;
grant insert(item_id,estado_origen,estado_solicitado) on public.solicitudes_avance_items to authenticated;
grant update(estado,revisor_id,revisado_en,comentario_revision) on public.solicitudes_avance_items to authenticated;
create policy avances_consultar on public.solicitudes_avance_items for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.activo
    and (p.rol::text='ADMINISTRADOR' or solicitante_id=p.id))
);
create policy avances_solicitar on public.solicitudes_avance_items for insert to authenticated with check (
  solicitante_id=(select auth.uid()) and estado='PENDIENTE' and revisor_id is null and revisado_en is null
  and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.activo and p.rol::text='PRODUCCION_LECTURA')
  and exists(select 1 from public.items_produccion i join public.ordenes_produccion o on o.id=i.orden_id
    where i.id=item_id and i.estado=estado_origen and not coalesce(o.cerrada,false))
);
create policy avances_revisar on public.solicitudes_avance_items for update to authenticated
  using (estado='PENDIENTE' and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.activo and p.rol::text='ADMINISTRADOR'))
  with check (estado in ('APROBADA','RECHAZADA','OBSOLETA') and revisor_id=(select auth.uid()) and revisado_en is not null
    and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.activo and p.rol::text='ADMINISTRADOR'));

create function public.solicitar_avance_item(p_item_id uuid) returns public.solicitudes_avance_items
language plpgsql security invoker set search_path='' as $$
declare item public.items_produccion; next_state public.production_item_status; request public.solicitudes_avance_items;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.activo and p.rol::text='PRODUCCION_LECTURA') then
    raise exception 'Solo el usuario de consulta puede solicitar avances.' using errcode='42501';
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

create function public.revisar_avance_item(p_solicitud_id uuid,p_aprobar boolean,p_comentario text default null)
returns public.solicitudes_avance_items language plpgsql security invoker set search_path='' as $$
declare request public.solicitudes_avance_items; item public.items_produccion; owner_order uuid; order_closed boolean; decision text;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid() and p.activo and p.rol::text='ADMINISTRADOR') then
    raise exception 'Solo el administrador puede confirmar o rechazar avances.' using errcode='42501';
  end if;
  if p_aprobar is null then raise exception 'Selecciona confirmar o rechazar.' using errcode='22023'; end if;
  select * into request from public.solicitudes_avance_items where id=p_solicitud_id;
  if not found then raise exception 'La solicitud ya no está disponible.' using errcode='22023'; end if;
  select orden_id into owner_order from public.items_produccion where id=request.item_id;
  -- Lock order, item, then request. A concurrent order close or state change cannot race approval.
  select coalesce(cerrada,false) into order_closed from public.ordenes_produccion where id=owner_order for update;
  select * into item from public.items_produccion where id=request.item_id for update;
  select * into request from public.solicitudes_avance_items where id=p_solicitud_id for update;
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
alter publication supabase_realtime add table public.solicitudes_avance_items;
notify pgrst,'reload schema';
