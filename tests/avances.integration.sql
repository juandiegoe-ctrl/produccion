-- Transactional authorization/integration check. All production data changes are rolled back.
begin;
select set_config('test.advance_admin',(select id::text from public.profiles where rol::text='ADMINISTRADOR' and activo limit 1),true);
select set_config('test.advance_reader',(select id::text from public.profiles where rol::text='PRODUCCION_LECTURA' and activo limit 1),true);
select set_config('test.advance_item',(select i.id::text from public.items_produccion i join public.ordenes_produccion o on o.id=i.orden_id where i.estado='MOLDE' and not coalesce(o.cerrada,false) limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('test.advance_reader'),true);
set local role authenticated;
do $$
declare request public.solicitudes_avance_items; affected integer; rejected boolean:=false;
begin
  request:=public.solicitar_avance_item(current_setting('test.advance_item')::uuid);
  perform set_config('test.advance_request',request.id::text,true);
  if (select estado from public.items_produccion where id=request.item_id)<>request.estado_origen then raise exception 'Request changed item state before approval'; end if;
  begin perform public.solicitar_avance_item(request.item_id); exception when unique_violation then rejected:=true; end;
  if not rejected then raise exception 'Duplicate pending request accepted'; end if;
  update public.items_produccion set estado='FUNDIR' where id=request.item_id;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Consultation user directly updated item'; end if;
  rejected:=false;
  begin perform public.revisar_avance_item(request.id,true); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Consultation user approved request'; end if;
  update public.solicitudes_avance_items set estado='APROBADA',revisor_id=auth.uid(),revisado_en=now() where id=request.id;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Consultation user forged approval'; end if;
  rejected:=false;
  begin insert into public.solicitudes_avance_items(item_id,estado_origen,estado_solicitado,solicitante_id) values(request.item_id,'MOLDE','FUNDIR',current_setting('test.advance_admin')::uuid); exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'Consultation user forged request author'; end if;
  rejected:=false;
  begin insert into public.solicitudes_avance_items(item_id,estado_origen,estado_solicitado) values(request.item_id,'MOLDE','ENTREGADO'); exception when check_violation then rejected:=true; end;
  if not rejected then raise exception 'Consultation user skipped production steps'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.advance_admin'),true);
do $$
declare request public.solicitudes_avance_items; rejected boolean:=false;
begin
  request:=public.revisar_avance_item(current_setting('test.advance_request')::uuid,true,'Confirmado en prueba');
  if request.estado<>'APROBADA' or request.revisor_id<>auth.uid() then raise exception 'Administrator approval failed'; end if;
  if (select estado from public.items_produccion where id=request.item_id)<>'FUNDIR' then raise exception 'Approval did not advance item'; end if;
  if not exists(select 1 from public.historial_items where item_id=request.item_id and estado_anterior='MOLDE' and estado_nuevo='FUNDIR' and usuario_id=auth.uid()) then raise exception 'Existing item history trigger did not run'; end if;
  begin perform public.revisar_avance_item(request.id,true); exception when invalid_parameter_value then rejected:=true; end;
  if not rejected then raise exception 'Approval applied twice'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.advance_reader'),true);
select set_config('test.advance_request',(public.solicitar_avance_item(current_setting('test.advance_item')::uuid)).id::text,true);
select set_config('request.jwt.claim.sub',current_setting('test.advance_admin'),true);
do $$
declare request public.solicitudes_avance_items;
begin
  request:=public.revisar_avance_item(current_setting('test.advance_request')::uuid,false,'Rechazado en prueba');
  if request.estado<>'RECHAZADA' or (select estado from public.items_produccion where id=request.item_id)<>'FUNDIR' then raise exception 'Rejection changed item state'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.advance_reader'),true);
select set_config('test.advance_request',(public.solicitar_avance_item(current_setting('test.advance_item')::uuid)).id::text,true);
select set_config('request.jwt.claim.sub',current_setting('test.advance_admin'),true);
update public.items_produccion set estado='ALISTAR' where id=current_setting('test.advance_item')::uuid;
do $$
declare request public.solicitudes_avance_items;
begin
  request:=public.revisar_avance_item(current_setting('test.advance_request')::uuid,true);
  if request.estado<>'OBSOLETA' or (select estado from public.items_produccion where id=request.item_id)<>'ALISTAR' then raise exception 'Stale approval changed the item'; end if;
end $$;
rollback;
select 'PASS: consultation requests without changing state; duplicate, direct-write and self-approval protections; administrator approval/rejection; history; stale requests; all changes rolled back.' as verification;
