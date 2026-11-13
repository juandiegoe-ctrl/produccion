#!/usr/bin/env python3
"""Run locally after applying db/usuarios-produccion.sql. Never stores credentials."""
import getpass
import json
import os
import sys
import urllib.error
import urllib.request

PROJECT_URL = 'https://ujyhzcomdzhppggteqnv.supabase.co'
ACCOUNTS = [
    ('produccion@estona.co', 'Miguel', 'PRODUCCION', False),
    ('jhonathan@estona.co', 'Jhonathan', 'PRODUCCION_LECTURA', True),
    ('jeancarlos@estona.co', 'Jean Carlos', 'PRODUCCION', False),
    ('juangabriel@estona.co', 'Juan Gabriel', 'PRODUCCION_LECTURA', True),
    ('alex@estona.co', 'Alex', 'PRODUCCION_LECTURA', True),
    ('sebastian@estona.co', 'Sebastián', 'PRODUCCION_LECTURA', True),
    ('victor@estona.co', 'Víctor', 'PRODUCCION_LECTURA', True),
    ('ivan@estona.co', 'Iván', 'PRODUCCION_LECTURA', True),
]

class AdminClient:
    def __init__(self, key):
        self.key = key

    def request(self, method, path, payload=None):
        headers = {'apikey': self.key, 'Authorization': 'Bearer ' + self.key,
                   'Content-Type': 'application/json', 'Prefer': 'return=representation'}
        if path == '/rest/v1/':
            headers['Accept'] = 'application/openapi+json'
        req = urllib.request.Request(PROJECT_URL + path, method=method, headers=headers,
                                     data=None if payload is None else json.dumps(payload).encode())
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                data = response.read()
                return json.loads(data) if data else None
        except urllib.error.HTTPError as error:
            # Do not echo response bodies: they may contain account or request data.
            raise RuntimeError(f'Supabase devolvió HTTP {error.code} en {method} {path.split("?")[0]}.') from None
        except urllib.error.URLError:
            raise RuntimeError('No se pudo conectar a Supabase por HTTPS.') from None


def provision(client, password, report=print):
    if client.request('POST', '/rest/v1/rpc/production_access_setup_ready', {}) is not True:
        raise RuntimeError('Primero ejecuta db/usuarios-produccion.sql en el SQL Editor.')
    schema = client.request('GET', '/rest/v1/')
    fields = schema.get('definitions', {}).get('profiles', {}).get('properties', {})
    if not {'id', 'nombre', 'rol', 'activo'}.issubset(fields):
        raise RuntimeError('La estructura de profiles no coincide; no se crearon cuentas.')
    existing = set()
    page = 1
    while True:
        batch = client.request('GET', f'/auth/v1/admin/users?page={page}&per_page=100').get('users', [])
        existing.update(user.get('email', '').lower() for user in batch)
        if len(batch) < 100:
            break
        page += 1
    created = []
    for email, name, role, view_only in ACCOUNTS:
        if email in existing:
            report(f'Ya existe: {email}. No se cambió su clave ni sus permisos; requiere revisión.')
            continue
        user = client.request('POST', '/auth/v1/admin/users', {
            'email': email, 'password': password, 'email_confirm': True,
            'user_metadata': {'nombre': name},
            'app_metadata': {'production_view_only': view_only},
        })
        user_id = user.get('id') or user.get('user', {}).get('id')
        if not user_id:
            raise RuntimeError(f'No se pudo verificar la creación de {email}. Revisa Authentication.')
        try:
            path = '/rest/v1/profiles?id=eq.' + user_id
            profile = {'nombre': name, 'rol': role, 'activo': True}
            if 'email' in fields:
                profile['email'] = email
            rows = client.request('GET', path + '&select=id,rol,activo')
            if rows:
                saved = client.request('PATCH', path, profile)
            else:
                saved = client.request('POST', '/rest/v1/profiles', dict(profile, id=user_id))
            if not saved or saved[0].get('rol') != role or saved[0].get('activo') is not True:
                raise RuntimeError('No se pudo verificar el perfil.')
        except Exception:
            # Roll back only the account created in this iteration, never an existing account.
            try:
                client.request('DELETE', '/auth/v1/admin/users/' + user_id)
            except Exception:
                raise RuntimeError(f'Revisa y desactiva {email}: no se verificó su perfil ni su reversión.') from None
            raise RuntimeError(f'No se configuró el perfil de {email}; se revirtió esa cuenta nueva.') from None
        created.append(email)
        report(f'Creado: {email} — {"solo visor" if view_only else "producción"}.')
    return created


def main():
    print('Proyecto Supabase: ' + PROJECT_URL)
    print('No se enviarán invitaciones ni se modificarán cuentas que ya existan.')
    key = os.environ.get('SUPABASE_ADMIN_KEY') or getpass.getpass('Clave administrativa de Supabase (oculta): ')
    password = getpass.getpass('Contraseña inicial para las cuentas nuevas (oculta): ')
    if not key or len(password) < 8:
        raise RuntimeError('Falta la clave administrativa o la contraseña inicial tiene menos de 8 caracteres.')
    created = provision(AdminClient(key), password)
    print(f'Cuentas nuevas verificadas: {len(created)}.')

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, KeyboardInterrupt, EOFError) as error:
        print(str(error) or 'Operación cancelada.', file=sys.stderr)
        sys.exit(1)
