"""Local connector management is person-only and account grants are owner scoped."""
import json
from uuid import uuid4

import pytest
from sqlalchemy import delete

from app.db.models import Agent, UserCredential
from app.routers import connector as routes
from app.services import agent_store, connector_service
from tests.services.test_local_connector import connector, ADMIN, CREDENTIAL_A  # noqa: F401
from tests.auth.test_auth_api import app, factory, auth_settings, client, login, pairing_code, set_owner  # noqa: F401

PATH = '/api/v1/integrations/connector'
FIXTURE_CLIENT_SECRET = 'GOCSPX-' + 'not-a-real-value-' + 'fixture-only'


@pytest.fixture
async def admin(app, factory, connector, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'LOCAL_EXECUTION_ENABLED', True)
    owner = 'local_connector_api_' + uuid4().hex
    monkeypatch.setattr(routes, 'LOCAL_OWNER_ID', owner)
    await set_owner(factory)
    async with factory() as db:
        await connector_service.save(db, owner, ADMIN)
    async with client(app) as api:
        session = await login(api)
        api.headers['X-CSRF-Token'] = session['csrf_token']
        yield api, owner
    async with factory() as db:
        await db.execute(delete(UserCredential).where(UserCredential.user_id == owner))
        await db.execute(delete(Agent).where(Agent.owner_id == owner)); await db.commit()


async def test_catalog_aliases_per_bot_grants_and_wrong_owner(admin, factory, connector):
    api, owner = admin
    result = await api.get(PATH)
    assert result.status_code == 200, result.text
    assert ADMIN not in result.text and CREDENTIAL_A not in result.text
    assert len(result.json()['providers']) == 269  # 268 imported providers plus test provider
    accounts = [c for c in result.json()['connections'] if c['service'] == 'testapp']
    assert {c['connectionName'] for c in accounts} == {'work', 'personal'}
    async with factory() as db:
        agent = await agent_store.create_agent(db, owner_id=owner, name='Owner bot')
        other = await agent_store.create_agent(db, owner_id='someone-else', name='Other bot')
    try:
        assert (await api.get(f'{PATH}/grants/{agent.id}')).json() == {}
        assert (await api.put(f'{PATH}/grants/{other.id}', json={connector['a']: 'act'})).status_code == 404
        assert (await api.put(f'{PATH}/grants/{agent.id}', json={connector['a']: 'act'})).json() == {connector['a']: 'act'}
        assert (await api.put(f'{PATH}/grants/{agent.id}', json={'foreign-account': 'act'})).status_code == 422
        assert (await api.put(f'{PATH}/grants/{agent.id}', json={connector['a']: 'always_allow'})).status_code == 422
    finally:
        async with factory() as db:
            await db.execute(delete(Agent).where(Agent.id == other.id)); await db.commit()


async def test_anonymous_paired_chat_and_csrf_cannot_manage(app, factory, connector):
    await set_owner(factory)
    async with client(app) as anonymous:
        assert (await anonymous.get(PATH)).status_code == 401
    async with client(app) as owner, client(app) as phone:
        session = await login(owner)
        assert (await owner.put(PATH + '/grants/1', json={})).status_code == 403
        code = await pairing_code(owner, session['csrf_token'], scope='chat')
        token = (await phone.post('/api/v1/auth/pair', json={'code': code})).json()['token']
        phone.headers['Authorization'] = 'Bearer ' + token
        for method, path in [('GET', PATH), ('PUT', PATH + '/grants/1'), ('DELETE', PATH + '/connections/' + connector['a']), ('POST', PATH + '/oauth/testapp')]:
            assert (await phone.request(method, path, json={})).status_code == 403


async def test_blocked_provider_absent_and_cannot_connect(admin, connector, monkeypatch):
    api, _ = admin
    monkeypatch.setenv('CONNECTOR_BLOCKED_PROVIDERS', ' testapp ')
    result = await api.get(PATH)
    assert all(p['service'] != 'testapp' for p in result.json()['providers'])
    assert result.json()['connections'] == []
    assert (await api.put(PATH + '/connections/testapp', json={'connectionName': 'new', 'authType': 'api_key', 'values': {'apiKey': CREDENTIAL_A}})).status_code == 403


async def test_oauth_callback_requires_owner_and_refuses_invalid_state(admin, app):
    api, _ = admin
    path = PATH + '/oauth/linear/callback?state=invalid&code=not-a-real-code'
    async with client(app) as anonymous:
        assert (await anonymous.get(path)).status_code == 401
    response = await api.get(path)
    assert response.status_code == 400
    assert 'not-a-real-code' not in response.text


async def test_oauth_start_returns_google_sign_in_with_lasting_access(admin):
    api, _ = admin
    result = await api.post(PATH + '/oauth/gmail', json={'connectionName': 'personal', 'clientId': '123456-fixture.apps.googleusercontent.com', 'clientSecret': FIXTURE_CLIENT_SECRET, 'returnUrl': 'http://localhost:3000/apps/'})
    assert result.status_code == 200, result.text
    url = result.json()['url']
    assert url.startswith('https://accounts.google.com/')
    assert 'access_type=offline' in url and 'prompt=consent' in url
    assert 'test-secret' not in result.text


async def test_google_client_saved_for_both_and_secrets_not_returned_or_logged(admin, caplog):
    api, _ = admin
    secret = 'GOCSPX-' + 'synthetic_client_secret_12345'
    client_id = '123456-fixture.apps.googleusercontent.com'
    response = await api.post(PATH + '/oauth/gmail', json={'connectionName': 'home', 'clientId': client_id, 'clientSecret': secret, 'returnUrl': 'http://localhost:3000/apps/'})
    assert response.status_code == 200
    catalog = await api.get(PATH)
    google = [p for p in catalog.json()['oauth'] if p['service'] in ('gmail', 'googlecalendar')]
    assert len(google) == 2 and all(p['configured'] for p in google)
    assert secret not in response.text + catalog.text + caplog.text
    assert client_id not in catalog.text + caplog.text
    again = await api.post(PATH + '/oauth/googlecalendar', json={'connectionName': 'calendar', 'returnUrl': 'http://localhost:3000/apps/'})
    assert again.status_code == 200


@pytest.mark.parametrize('provider,payload', [
    ('gmail', {'clientId': 'wrong', 'clientSecret': 'bad'}),
    ('googledrive', {'clientId': 'wrong', 'clientSecret': 'bad'}),
    ('googlesheets', {'clientId': 'wrong', 'clientSecret': 'bad'}),
    ('google_analytics', {'clientId': 'wrong', 'clientSecret': 'bad'}),
    ('google_bigquery', {'clientId': 'wrong', 'clientSecret': 'bad'}),
    ('google_search_console', {'clientId': 'wrong', 'clientSecret': 'bad'}),
    ('gmail', {'clientId': '1234-fixture.apps.googleusercontent.com'}),
    ('unknown', {'clientId': 'any', 'clientSecret': 'any'}),
])
async def test_invalid_google_values_and_unknown_app_refused_without_echo(admin, provider, payload, caplog):
    api, _ = admin
    response = await api.post(PATH + '/oauth/' + provider, json={'connectionName': 'test', **payload})
    assert response.status_code == 422
    assert '"wrong"' not in response.text and '"bad"' not in response.text
    assert not caplog.text


@pytest.mark.parametrize('provider', ['googledrive', 'googlesheets', 'googledocs', 'youtube', 'google_analytics', 'google_bigquery', 'google_search_console'])
async def test_other_google_apps_start_guided_sign_in(admin, provider):
    api, _ = admin
    response = await api.post(PATH + '/oauth/' + provider, json={
        'connectionName': 'Personal', 'clientId': '123456-fixture.apps.googleusercontent.com',
        'clientSecret': FIXTURE_CLIENT_SECRET, 'returnUrl': 'http://localhost:3000/apps/'})
    assert response.status_code == 200, response.text
    assert response.json()['url'].startswith('https://accounts.google.com/')
    assert FIXTURE_CLIENT_SECRET not in response.text
