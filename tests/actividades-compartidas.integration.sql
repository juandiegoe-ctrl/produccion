-- Isolated PostgreSQL fixture test: uses only the deterministic test UUIDs below.
-- Do not run against production. Run after installing both access and activity SQL.
begin;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.seleccionar_actividad_produccion('20000000-0000-0000-0000-000000000002',true);
select public.seleccionar_actividad_produccion('20000000-0000-0000-0000-000000000001',true);
do $$
declare first_priority bigint;
begin
 select prioridad into first_priority from public.actividades_produccion where item_id='20000000-0000-0000-0000-000000000002';
 perform public.seleccionar_actividad_produccion('20000000-0000-0000-0000-000000000002',true);
 if (select count(*) from public.actividades_produccion)<>2 then raise exception 'Duplicate selection'; end if;
 if (select prioridad from public.actividades_produccion where item_id='20000000-0000-0000-0000-000000000002')<>first_priority then raise exception 'Priority changed'; end if;
 if not(first_priority<(select prioridad from public.actividades_produccion where item_id='20000000-0000-0000-0000-000000000001')) then raise exception 'Selection order lost'; end if;
 begin
   perform public.seleccionar_actividad_produccion('20000000-0000-0000-0000-000000000003',true);
   raise exception 'Closed order accepted';
 exception when sqlstate '22023' then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$
begin
 if (select count(*) from public.actividades_produccion)<>2 then raise exception 'Viewer cannot read shared activities'; end if;
 begin
   perform public.seleccionar_actividad_produccion('20000000-0000-0000-0000-000000000001',false);
   raise exception 'Viewer edited activities';
 exception when insufficient_privilege then null; end;
 begin
   insert into public.actividades_produccion_adicionales(fecha,texto,actualizado_por) values ('2026-11-13','No permitido',auth.uid());
   raise exception 'Viewer edited additional tasks';
 exception when insufficient_privilege then null; end;
 begin
   update public.items_produccion set estado='PULIR' where id='20000000-0000-0000-0000-000000000001';
   raise exception 'Viewer advanced an item';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
set local role authenticated;
do $$
begin
 begin
   perform public.seleccionar_actividad_produccion('20000000-0000-0000-0000-000000000001',false);
   raise exception 'Restricted production account edited activities';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
set local role authenticated;
insert into public.actividades_produccion_adicionales(fecha,texto,actualizado_por) values ('2026-11-13','Barrer',auth.uid());
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
set local role authenticated;
do $$begin
 if (select texto from public.actividades_produccion_adicionales where fecha='2026-11-13') is distinct from 'Barrer' then raise exception 'Viewer cannot read shared extra tasks'; end if;
 update public.actividades_produccion_adicionales set texto='No permitido' where fecha='2026-11-13';
 if (select texto from public.actividades_produccion_adicionales where fecha='2026-11-13') is distinct from 'Barrer' then raise exception 'Viewer changed shared text'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
set local role authenticated;
update public.items_produccion set estado=estado where id='20000000-0000-0000-0000-000000000001';
do $$begin
 if (select count(*) from public.actividades_produccion)<>2 then raise exception 'Unchanged item removed a task'; end if;
end $$;
update public.items_produccion set estado='PULIR' where id='20000000-0000-0000-0000-000000000001';
do $$begin
 if exists(select 1 from public.actividades_produccion where item_id='20000000-0000-0000-0000-000000000001') then raise exception 'Advance did not remove task'; end if;
 if not exists(select 1 from public.actividades_produccion where item_id='20000000-0000-0000-0000-000000000002') then raise exception 'Unrelated task lost'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
set local role authenticated;
do $$begin
 if exists(select 1 from public.actividades_produccion) then raise exception 'Inactive user can read'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$begin
 begin
   perform count(*) from public.actividades_produccion;
   raise exception 'Anonymous access';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
select 'PASS: shared read, insertion order, duplicate safety, closed-order rejection, viewer write protection, production edits, advance cleanup, inactive and anonymous denial.' as verification;
