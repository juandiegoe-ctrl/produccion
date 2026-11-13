-- Alternative to the Python script: first create the eight accounts in
-- Supabase Authentication > Users > Add user, using the chosen password.
-- Run db/usuarios-produccion.sql first, then this file in SQL Editor.
-- No passwords are read, stored, reset or changed by this file.
begin;
do $$
declare r record; user_id uuid; profile public.profiles; has_email boolean;
begin
  perform public.production_access_setup_ready();
  select exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='email') into has_email;
  for r in select * from (values
    ('produccion@estona.co','Miguel','PRODUCCION',false),
    ('jhonathan@estona.co','Jhonathan','PRODUCCION_LECTURA',true),
    ('jeancarlos@estona.co','Jean Carlos','PRODUCCION',false),
    ('juangabriel@estona.co','Juan Gabriel','PRODUCCION_LECTURA',true),
    ('alex@estona.co','Alex','PRODUCCION_LECTURA',true),
    ('sebastian@estona.co','Sebastián','PRODUCCION_LECTURA',true),
    ('victor@estona.co','Víctor','PRODUCCION_LECTURA',true),
    ('ivan@estona.co','Iván','PRODUCCION_LECTURA',true)
  ) as accounts(email,nombre,rol,solo_visor) loop
    select id into user_id from auth.users where lower(email)=r.email for update;
    if not found then raise exception 'Primero crea la cuenta % en Authentication. No se aplicaron cambios.',r.email; end if;
    if exists(select 1 from public.profiles where id=user_id and rol::text='ADMINISTRADOR') then
      raise exception '% ya es administrador; no se cambiarán sus permisos.',r.email;
    end if;
    -- Derive the existing enum type from profiles without guessing its name.
    select * into profile from jsonb_populate_record(null::public.profiles,jsonb_build_object('rol',r.rol));
    if has_email then
      execute 'insert into public.profiles(id,nombre,rol,activo,email) values ($1,$2,$3,true,$4)
        on conflict(id) do update set nombre=excluded.nombre,rol=excluded.rol,activo=true,email=excluded.email'
        using user_id,r.nombre,profile.rol,r.email;
    else
      insert into public.profiles(id,nombre,rol,activo) values (user_id,r.nombre,profile.rol,true)
        on conflict(id) do update set nombre=excluded.nombre,rol=excluded.rol,activo=true;
    end if;
    update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)
      ||jsonb_build_object('production_view_only',r.solo_visor) where id=user_id;
  end loop;
end;
$$;
commit;

select u.email,p.nombre,p.rol,p.activo,
  u.raw_app_meta_data->>'production_view_only' as solo_visor
from auth.users u join public.profiles p on p.id=u.id
where lower(u.email) in ('produccion@estona.co','jhonathan@estona.co','jeancarlos@estona.co',
 'juangabriel@estona.co','alex@estona.co','sebastian@estona.co','victor@estona.co','ivan@estona.co')
order by u.email;
