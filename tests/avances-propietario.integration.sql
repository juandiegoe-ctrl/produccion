-- Isolated fixtures only. Never run on the production database.
begin;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.seleccionar_actividad_produccion('20000000-0000-0000-0000-000000000001',true);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
set local role authenticated;
do $$
declare request public.solicitudes_avance_items;
begin
 request:=public.solicitar_avance_item('20000000-0000-0000-0000-000000000001');
 perform set_config('test.owner_request',request.id::text,true);
 if request.estado<>'PENDIENTE' then raise exception 'Request not pending'; end if;
 if (select estado::text from public.items_produccion where id=request.item_id)<>'FUNDIR' then raise exception 'Request changed state'; end if;
 if not exists(select 1 from public.actividades_produccion where item_id=request.item_id) then raise exception 'Request removed shared task'; end if;
 begin
  update public.items_produccion set estado='PULIR' where id=request.item_id;
  raise exception 'Production bypassed approval';
 exception when insufficient_privilege then null; end;
 begin
  perform public.revisar_avance_item(request.id,true);
  raise exception 'Production self-approved';
 exception when insufficient_privilege then null; end;
 update public.solicitudes_avance_items set estado='APROBADA',revisor_id=auth.uid(),revisado_en=now() where id=request.id;
 if (select estado from public.solicitudes_avance_items where id=request.id)<>'PENDIENTE' then raise exception 'Direct self-approval'; end if;
 begin
  insert into public.items_produccion(id,orden_id,estado) values ('20000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','PULIR');
  raise exception 'Advanced insertion bypassed approval';
 exception when insufficient_privilege then null; end;
 update public.items_produccion set comentarios='Edición permitida' where id=request.item_id;
 begin
  perform public.solicitar_avance_item(request.item_id);
  raise exception 'Duplicate pending request';
 exception when unique_violation then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',true);
set local role authenticated;
do $$begin
 if public.puede_aprobar_avances_produccion() then raise exception 'Other administrator can approve'; end if;
 begin
  update public.items_produccion set estado='PULIR' where id='20000000-0000-0000-0000-000000000001';
  raise exception 'Other administrator bypassed approval';
 exception when insufficient_privilege then null; end;
 begin
  perform public.revisar_avance_item(current_setting('test.owner_request')::uuid,true);
  raise exception 'Other administrator approved';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$begin
 begin
  perform public.solicitar_avance_item('20000000-0000-0000-0000-000000000002');
  raise exception 'View-only user requested advance';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare request public.solicitudes_avance_items;
begin
 request:=public.revisar_avance_item(current_setting('test.owner_request')::uuid,true);
 if request.estado<>'APROBADA' then raise exception 'Owner approval failed'; end if;
 if (select estado::text from public.items_produccion where id=request.item_id)<>'PULIR' then raise exception 'Approval did not advance'; end if;
 if exists(select 1 from public.actividades_produccion where item_id=request.item_id) then raise exception 'Approved task remains pending'; end if;
 begin
  perform public.revisar_avance_item(request.id,true);
  raise exception 'Repeated approval accepted';
 exception when sqlstate '22023' then null; end;
 update public.items_produccion set estado='ALISTAR' where id=request.item_id;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select set_config('test.reject_request',(public.solicitar_avance_item('20000000-0000-0000-0000-000000000002')).id::text,true);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$
declare request public.solicitudes_avance_items;
begin
 request:=public.revisar_avance_item(current_setting('test.reject_request')::uuid,false);
 if request.estado<>'RECHAZADA' then raise exception 'Rejection failed'; end if;
 if (select estado::text from public.items_produccion where id=request.item_id)<>'PULIR' then raise exception 'Rejection changed item'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select set_config('test.stale_request',(public.solicitar_avance_item('20000000-0000-0000-0000-000000000002')).id::text,true);
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
set local role authenticated;
update public.items_produccion set estado='ALISTAR' where id='20000000-0000-0000-0000-000000000002';
do $$
declare request public.solicitudes_avance_items;
begin
 request:=public.revisar_avance_item(current_setting('test.stale_request')::uuid,true);
 if request.estado<>'OBSOLETA' then raise exception 'Stale request approved'; end if;
 if (select estado::text from public.items_produccion where id=request.item_id)<>'ALISTAR' then raise exception 'Stale approval changed state'; end if;
end $$;
rollback;
select 'PASS: non-owner requests only, no state/write/form/API bypass, only owner approval/direct edits, viewer denial, duplicate protection, rejection and shared-task removal only after approval.' as verification;
