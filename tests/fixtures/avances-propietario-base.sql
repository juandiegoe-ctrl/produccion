-- ISOLATED TEST DATABASE ONLY. Creates fake roles, schemas and users, not real accounts.

create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public to authenticated;grant execute on function auth.uid() to authenticated;
create table auth.users(id uuid primary key,raw_app_meta_data jsonb default '{}');
create table public.profiles(id uuid primary key,nombre text,rol text,activo boolean);
create type public.production_item_status as enum ('MOLDE','FUNDIR','PULIR','ALISTAR','ENTREGADO','CERRADO');
create table public.ordenes_produccion(id uuid primary key,cerrada boolean);
create table public.items_produccion(id uuid primary key,orden_id uuid references public.ordenes_produccion,estado public.production_item_status);
create table public.catalogo_productos(id uuid);create table public.mezclas_produccion(id uuid);create table public.registros_dosificacion(id uuid);
create table public.historial_items(id uuid);create table public.empleados_produccion(id uuid);create table public.asistencia_empleados(id uuid);
create table storage.objects(id uuid,bucket_id text);
grant select,update on public.items_produccion,public.profiles to authenticated;
insert into auth.users values
 ('00000000-0000-0000-0000-000000000001','{}'),
 ('00000000-0000-0000-0000-000000000002','{}'),
 ('00000000-0000-0000-0000-000000000003','{"production_view_only":true}'),
 ('00000000-0000-0000-0000-000000000004','{}'),
 ('00000000-0000-0000-0000-000000000005','{"production_view_only":true}');
insert into profiles values
 ('00000000-0000-0000-0000-000000000001','Admin','ADMINISTRADOR',true),
 ('00000000-0000-0000-0000-000000000002','Produccion','PRODUCCION',true),
 ('00000000-0000-0000-0000-000000000003','Visor','PRODUCCION_LECTURA',true),
 ('00000000-0000-0000-0000-000000000004','Inactivo','PRODUCCION_LECTURA',false),
 ('00000000-0000-0000-0000-000000000005','Visor restringido','PRODUCCION',true);
insert into ordenes_produccion values ('10000000-0000-0000-0000-000000000001',false),('10000000-0000-0000-0000-000000000002',true);
insert into items_produccion values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','FUNDIR'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','PULIR'),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','MOLDE');

alter table auth.users add column email text;
update auth.users set email='other@example.com';
update auth.users set email='juandiegoe@gmail.com' where id='00000000-0000-0000-0000-000000000001';
insert into auth.users values ('00000000-0000-0000-0000-000000000006','{}','otro-admin@example.com');
insert into profiles values ('00000000-0000-0000-0000-000000000006','Otro admin','ADMINISTRADOR',true);
alter table items_produccion add column comentarios text;
grant select,update on ordenes_produccion to authenticated;
grant insert on items_produccion to authenticated;
create publication supabase_realtime;
