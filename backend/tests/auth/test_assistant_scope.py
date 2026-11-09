import pytest
from app.auth import store
from app.auth.policy import allows_request
from tests.auth.test_auth_api import factory, auth_settings, app, client, set_owner, login, pairing_code  # noqa: F401


@pytest.mark.parametrize('method,path', [
    ('POST', '/threads/1/approvals/a'), ('PATCH', '/agents/1'),
    ('POST', '/auth/setup'), ('POST', '/auth/login'), ('POST', '/auth/pair'),
    ('PUT', '/settings'), ('GET', '/credentials'), ('POST', '/auth/pairing-codes'),
    ('POST', '/composio/connect'), ('PATCH', '/routines/1'), ('PUT', '/engines/openai_compat/config'),
])
async def test_assistant_scope_refuses_owner_actions(app, factory, method, path):
    async with factory() as db:
        token, _ = await store.create_session(db, kind='device', label='MCP', scopes=store.scopes_for('assistant'))
    async with client(app, headers={'Authorization': 'Bearer ' + token}) as api:
        response = await api.request(method, '/api/v1' + path, json={})
    assert response.status_code == 403
    assert response.json()['detail']['error_code'] == 'scope_denied'


async def test_assistant_pairing_roundtrip(app, factory):
    await set_owner(factory)
    async with client(app) as owner:
        code = await pairing_code(owner, (await login(owner))['csrf_token'], scope='assistant')
    async with client(app) as api:
        response = await api.post('/api/v1/auth/pair', json={'code': code})
        assert response.status_code == 200
        assert response.json()['session']['scopes'] == ['assistant']
        response = await api.get('/api/v1/auth/session', headers={'Authorization': 'Bearer ' + response.json()['token']})
        assert response.status_code == 200 and response.json()['scopes'] == ['assistant']


@pytest.mark.parametrize('method,path', [('GET', '/agents'), ('POST', '/threads'), ('POST', '/threads/1/turns'), ('GET', '/threads/1/approvals'), ('GET', '/planner/items'), ('POST', '/planner/items'), ('POST', '/routines/1/run')])
def test_assistant_chat_and_task_allowlist(method, path):
    assert allows_request(('assistant',), method, '/api/v1' + path)
    assert not allows_request(('assistant', 'admin'), 'POST', '/api/v1/threads/1/approvals/a')
