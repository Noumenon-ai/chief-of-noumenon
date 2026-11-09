"""Authentication and owner checks on person-only card answers."""
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from app.core.config import settings
from app.routers.threads import get_runtime
from app.services import chat_cards, thread_store as store
from tests.auth.test_auth_api import app, factory, auth_settings, client, login, pairing_code, set_owner  # noqa: F401


async def test_no_auth_wrong_owner_and_assistant_refused(app, factory, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, 'LOCAL_EXECUTION_ENABLED', True)
    await set_owner(factory)
    rt = SimpleNamespace(session=factory, owner_id='card-owner')
    app.dependency_overrides[get_runtime] = lambda: rt
    async with factory() as db:
        thread = await store.create_thread(db, owner_id='someone-else', provider='fixture', workspace_path=str(tmp_path))
    path = f'/api/v1/threads/{thread.id}/cards/' + 'a' * 32
    respond = AsyncMock()
    monkeypatch.setattr(chat_cards, 'respond', respond)
    try:
        async with client(app) as anonymous:
            assert (await anonymous.post(path, json={'choice': 0})).status_code == 401
        async with client(app) as owner, client(app) as assistant:
            session = await login(owner)
            assert (await owner.post(path, json={'choice': 0})).status_code == 403  # CSRF
            owner.headers['X-CSRF-Token'] = session['csrf_token']
            assert (await owner.post(path, json={'choice': 0})).status_code == 404
            code = await pairing_code(owner, session['csrf_token'], scope='assistant')
            token = (await assistant.post('/api/v1/auth/pair', json={'code': code})).json()['token']
            assistant.headers['Authorization'] = 'Bearer ' + token
            assert (await assistant.post(path, json={'choice': 0})).status_code == 403
        respond.assert_not_called()
    finally:
        async with factory() as db: await store.delete_thread(db, thread.id)
