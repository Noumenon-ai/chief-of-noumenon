"""The app has no Codex credential-brokering route, even for its owner."""
import pytest
from tests.auth.test_auth_api import app, factory, auth_settings, client, login, set_owner  # noqa: F401


@pytest.mark.parametrize('method,path', [('post', '/api/v1/engines/codex/login'),
    ('get', '/api/v1/engines/codex/login/old-flow'), ('delete', '/api/v1/engines/codex/login/old-flow')])
async def test_codex_login_routes_removed(app, factory, method, path):
    await set_owner(factory)
    async with client(app) as browser:
        session = await login(browser)
        response = await getattr(browser, method)(path, headers={'X-CSRF-Token': session['csrf_token']})
        assert response.status_code in (404, 405), response.text
    assert not any('/codex/login' in getattr(route, 'path', '') for route in app.routes)
