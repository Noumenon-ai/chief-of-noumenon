import ast
import inspect
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.security import scrub_credentials
from app.core.ssrf import execute_guarded_request
from app.providers.registry import registry
from app.providers.catalog import get_actions_catalog
from main import app


def test_operation_metadata_preserved_for_every_catalog_action():
    for actions in get_actions_catalog().values():
        for metadata in actions:
            action = registry.get_action(metadata['id'])
            if action is not None:
                assert action.to_dict()['operationType'] == metadata.get('operationType')
                assert action.to_dict()['method'] == metadata.get('method')


def test_local_defaults_do_not_expose_token_or_docs():
    assert settings.EXPOSE_LOCAL_TOKEN is False
    with TestClient(app) as client:
        assert client.get('/api/auth/status').json().get('localToken') is None
        assert client.get('/docs').status_code == 404
        assert client.get('/openapi.json').status_code == 404


def test_exact_provider_secret_echo_and_fragment_scrubbed():
    secret = 'unusual-short-provider-secret'
    output = scrub_credentials({'text': secret, 'account_id': secret[:8] + '...', 'Authorization': secret}, {'apiKey': secret})
    assert secret not in str(output)
    assert secret[:8] not in str(output)
    assert output['text'] == '[REDACTED]'


@pytest.mark.asyncio
@pytest.mark.parametrize('payload', [{'code': 40100, 'message': 'Bad token'}, {}, {'code': 0, 'data': {}}])
async def test_tiktok_http_200_checks_application_status(payload):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload))) as client:
        provider = registry.get_provider('tiktok_business')
        if payload.get('code') == 0:
            assert await provider.validate_credentials({'accessToken': 'test-only-token'}, client)
        else:
            with pytest.raises(ValueError, match='rejected'):
                await provider.validate_credentials({'accessToken': 'test-only-token'}, client)


def test_backend_callback_base_is_used_in_provider_registration(monkeypatch):
    from app.services.oauth_service import OAuthService
    monkeypatch.setattr(settings, 'OAUTH_CALLBACK_BASE', 'https://chief.example/api/v1/integrations/connector/oauth')
    assert OAuthService.callback_url('linear') == 'https://chief.example/api/v1/integrations/connector/oauth/linear/callback'


def test_backend_completion_requires_authentication():
    with TestClient(app) as client:
        response = client.post('/api/oauth/linear/complete', json={'state': 'invalid', 'code': 'fake-code'})
        assert response.status_code == 401


def test_no_provider_collapses_the_scheme_of_its_validation_url():
    builtins = Path(__file__).parents[1] / 'app' / 'providers' / 'builtins'
    assert not [path.name for path in builtins.rglob('*.py') if 'replace("//", "/")' in path.read_text()]


@pytest.mark.asyncio
async def test_cloudflare_dns_validates_against_a_real_absolute_url():
    seen = []
    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(200, json={'success': True, 'result': {'id': 'token', 'status': 'active'}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await registry.get_provider('cloudflare_dns').validate_credentials({'apiKey': 'value'}, client)
    assert seen == ['https://api.cloudflare.com/client/v4/user/tokens/verify']


def test_every_provider_call_matches_the_guarded_request_signature():
    accepted = set(inspect.signature(execute_guarded_request).parameters)
    builtins = Path(__file__).parents[1] / 'app' / 'providers' / 'builtins'
    bad = []
    for path in builtins.rglob('*.py'):
        for node in ast.walk(ast.parse(path.read_text())):
            if isinstance(node, ast.Call) and getattr(node.func, 'id', '') == 'execute_guarded_request':
                bad += [(path.name, kw.arg) for kw in node.keywords if kw.arg and kw.arg not in accepted]
    assert not bad


@pytest.mark.asyncio
async def test_guarded_request_sends_a_json_body_under_either_name():
    bodies = []
    def handler(request):
        bodies.append(request.content)
        return httpx.Response(200, json={})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await execute_guarded_request(client, 'POST', 'https://example.com/a', json={'a': 1})
        await execute_guarded_request(client, 'POST', 'https://example.com/a', json_body={'a': 1})
    assert len(bodies) == 2 and bodies[0] == bodies[1] and b'"a"' in bodies[0]


def test_search_finds_actions_from_natural_words_best_first():
    for query in ('GitHub create issue', 'create an issue', 'create_issue'):
        assert registry.search_actions(query, 'github')[0].id == 'github.create_issue'
    assert registry.search_actions('list my repositories', 'github')
    assert not registry.search_actions('zzzznothing', 'github')
    assert len(registry.search_actions('my the', 'github')) == len(registry.search_actions('', 'github'))
