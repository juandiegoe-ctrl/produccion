import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('accounts', Path(__file__).parents[1] / 'scripts/crear-usuarios-produccion.py')
accounts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(accounts)

class FakeClient:
    def __init__(self, existing=(), ready=True, fail_profile=False):
        self.calls = []
        self.existing = existing
        self.ready = ready
        self.fail_profile = fail_profile
        self.next_id = 0

    def request(self, method, path, payload=None):
        self.calls.append((method, path, payload))
        if path.endswith('/production_access_setup_ready'):
            return self.ready
        if path == '/rest/v1/':
            return {'definitions': {'profiles': {'properties': dict.fromkeys(['id', 'nombre', 'rol', 'activo', 'email'])}}}
        if method == 'GET' and path.startswith('/auth/'):
            return {'users': [{'email': email} for email in self.existing]}
        if method == 'POST' and path == '/auth/v1/admin/users':
            self.next_id += 1
            return {'id': 'new-' + str(self.next_id)}
        if path.startswith('/rest/v1/profiles'):
            if method == 'GET':
                return []
            if self.fail_profile:
                raise RuntimeError('Profile unavailable')
            return [payload]
        if method == 'DELETE':
            return None
        raise AssertionError((method, path))

class ProvisioningTests(unittest.TestCase):
    def test_eight_accounts_with_correct_roles_and_private_metadata(self):
        client = FakeClient()
        messages = []
        created = accounts.provision(client, 'dummy-test-password', messages.append)
        self.assertEqual(len(created), 8)
        self.assertIn('produccion@estona.co', created)
        users = [payload for method, path, payload in client.calls if method == 'POST' and path == '/auth/v1/admin/users']
        self.assertEqual(sum(not user['app_metadata']['production_view_only'] for user in users), 2)
        self.assertTrue(all(user['email_confirm'] for user in users))
        profiles = [payload for method, path, payload in client.calls if method == 'POST' and path == '/rest/v1/profiles']
        self.assertEqual(sum(profile['rol'] == 'PRODUCCION' for profile in profiles), 2)
        self.assertEqual(sum(profile['rol'] == 'PRODUCCION_LECTURA' for profile in profiles), 6)
        self.assertNotIn('dummy-test-password', '\n'.join(messages))

    def test_existing_accounts_are_not_modified(self):
        client = FakeClient(existing=['ivan@estona.co'])
        created = accounts.provision(client, 'dummy-test-password', lambda _: None)
        self.assertNotIn('ivan@estona.co', created)
        self.assertEqual(len(created), 7)
        self.assertFalse(any(method == 'PUT' for method, _, _ in client.calls))

    def test_guard_setup_is_required_before_account_creation(self):
        client = FakeClient(ready=False)
        with self.assertRaises(RuntimeError):
            accounts.provision(client, 'dummy-test-password')
        self.assertEqual(len(client.calls), 1)

    def test_profile_failure_rolls_back_only_new_account(self):
        client = FakeClient(fail_profile=True)
        with self.assertRaises(RuntimeError):
            accounts.provision(client, 'dummy-test-password')
        deletes = [path for method, path, _ in client.calls if method == 'DELETE']
        self.assertEqual(deletes, ['/auth/v1/admin/users/new-1'])

if __name__ == '__main__':
    unittest.main()
