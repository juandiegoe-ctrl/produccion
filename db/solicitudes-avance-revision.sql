-- Reviewed rows are no longer visible to UPDATE under RLS; reject missing locked rows explicitly.
create or replace function public.revisar_avance_item(p_solicitud_id uuid,p_aprobar boolean,p_comentario text default null)
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
notify pgrst,'reload schema';
