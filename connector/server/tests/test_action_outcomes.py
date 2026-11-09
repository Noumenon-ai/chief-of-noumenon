"""Provider refusal survives transport; contact results never enter audit logs."""
from unittest.mock import AsyncMock
import httpx
import pytest
from app.services import action_runner
from app.providers.registry import registry


@pytest.mark.asyncio
@pytest.mark.parametrize('fault,expected', [(400, 400), (403, 403), (503, 502), ('timeout', 500), (None, 200)])
async def test_provider_result_and_private_audit(monkeypatch, fault, expected):
    action = registry.get_action('hubspot.search_contacts')
    sensitive = 'Synthetic Person contact@example.test'
    async def execute(*args):
        request = httpx.Request('POST', 'https://example.test')
        if fault == 'timeout': raise httpx.ReadTimeout(sensitive, request=request)
        if fault:
            response = httpx.Response(fault, request=request)
            raise httpx.HTTPStatusError(sensitive, request=request, response=response)
        return {'results': [{'name': sensitive}]}
    monkeypatch.setattr(action, 'execute', execute)
    monkeypatch.setattr(action_runner.ConnectionService, 'resolve_credentials', AsyncMock(return_value={'accessToken': 'fake-only'}))
    monkeypatch.setattr(action_runner, 'create_guarded_client', AsyncMock(return_value=AsyncMock()))
    class Session:
        def __init__(self): self.rows = []
        def add(self, row): self.rows.append(row)
        async def commit(self): pass
    session = Session()
    result = await action_runner.ActionRunner.run(session, 'test', action.id, {'query': 'Synthetic'})
    assert result.get('status_code', 200) == expected
    assert result['success'] is (fault is None)
    assert session.rows[0].input_summary is None and session.rows[0].output_summary is None
    assert sensitive not in (session.rows[0].error_message or '')


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [200, 202, 400, 503])
async def test_real_hubspot_adapter_preserves_response_status(monkeypatch, status):
    # Exercise the real adapter: it wraps successful data and raises ValueError
    # for HTTP failures, unlike adapters that call raise_for_status().
    from app.core import ssrf
    monkeypatch.setattr(ssrf.socket, 'getaddrinfo', lambda *a, **k: [(2, 1, 6, '', ('93.184.216.34', 443))])
    action = registry.get_action('hubspot.search_contacts')
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(status, json={'results': []})))
    monkeypatch.setattr(action_runner, 'create_guarded_client', AsyncMock(return_value=client))
    monkeypatch.setattr(action_runner.ConnectionService, 'resolve_credentials', AsyncMock(return_value={'accessToken': 'fake-only'}))
    class Session:
        def add(self, row): pass
        async def commit(self): pass
    result = await action_runner.ActionRunner.run(Session(), 'test', action.id, {'query': 'Example'})
    assert result['success'] is (status == 200)
    assert result.get('status_code', 200) == (502 if status in (202, 503) else status)


@pytest.mark.asyncio
async def test_front_contacts_route_is_a_read(monkeypatch):
    from app.providers.builtins.communication import front
    from app.core import ssrf
    monkeypatch.setattr(ssrf.socket, 'getaddrinfo', lambda *a, **k: [(2, 1, 6, '', ('93.184.216.34', 443))])
    calls = []
    async def request(**kwargs):
        calls.append(kwargs)
        return httpx.Response(200, json={'_results': [], '_pagination': {}})
    monkeypatch.setattr(front, 'execute_guarded_request', request)
    result = await registry.get_action('front.list_contacts').execute({'accessToken': 'fake-only'}, {'limit': 100}, AsyncMock())
    assert calls[0]['method'] == 'GET' and calls[0]['url'].endswith('/contacts')
    assert result == {'_results': [], '_pagination': {}}
