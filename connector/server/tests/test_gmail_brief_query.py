"""Search inputs must constrain Gmail rather than silently listing the whole inbox."""
import httpx
import pytest
from app.providers.builtins.google import gmail
from app.providers.registry import registry


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['gmail.fetch_emails', 'gmail.list_threads', 'gmail.search_threads'])
async def test_gmail_query_translates_without_forwarding_presentation_fields(monkeypatch, action):
    requests = []
    async def guarded(**kwargs):
        requests.append(kwargs)
        return httpx.Response(200, json={'messages':[]})
    monkeypatch.setattr(gmail, 'execute_guarded_request', guarded)
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: pytest.fail('No network'))) as client:
        await registry.get_action(action).execute({'query':'is:unread is:important', 'detail':'ids', 'maxResults':50}, {'accessToken':'test-only'}, client)
    assert requests[0]['method'] == 'GET'
    assert requests[0]['params'] == {'q':'is:unread is:important', 'maxResults':50}


@pytest.mark.asyncio
@pytest.mark.parametrize('fails', [False, True])
async def test_gmail_bodies_never_enter_run_log(monkeypatch, fails):
    from app.services import action_runner
    from unittest.mock import AsyncMock
    action = registry.get_action('gmail.get_message')
    content = 'Synthetic sensitive message body'
    async def execute(*args):
        if fails: raise ValueError(content)
        return {'payload':{'body':{'data':content}}, 'snippet':content}
    monkeypatch.setattr(action, 'execute', execute)
    monkeypatch.setattr(action_runner.ConnectionService, 'resolve_credentials', AsyncMock(return_value={'accessToken':'test-only'}))
    monkeypatch.setattr(action_runner, 'create_guarded_client', AsyncMock(return_value=AsyncMock()))
    class Session:
        def __init__(self): self.rows = []
        def add(self, value): self.rows.append(value)
        async def commit(self): pass
    session = Session()
    result = await action_runner.ActionRunner.run(session, 'test', 'gmail.get_message', {'messageId':'test-message'})
    assert result['success'] is not fails
    assert len(session.rows) == 1
    assert session.rows[0].input_summary is None and session.rows[0].output_summary is None
    assert content not in (session.rows[0].error_message or '')
    if not fails: assert content in str(result['data'])
