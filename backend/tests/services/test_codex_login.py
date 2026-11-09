"""Sign-in stays in the terminal; status uses the CLI without credential IO."""
from pathlib import Path
import pytest
from app.services import codex_adapter, cli_probe


@pytest.mark.parametrize('signed_in', [True, False])
async def test_terminal_signin_status_only(monkeypatch, signed_in):
    calls = []
    monkeypatch.setattr(codex_adapter, 'resolve_codex_executable', lambda: Path('/fake/codex'))
    async def probe(args, **kwargs):
        from types import SimpleNamespace
        calls.append(args)
        return SimpleNamespace(ok=True if args[-1] == '--version' else signed_in,
            stdout='test' if args[-1] == '--version' else ('Logged in using ChatGPT' if signed_in else 'Not logged in'),
            stderr='', timed_out=False, failed_to_start=None)
    monkeypatch.setattr(cli_probe, 'run', probe)
    result = await codex_adapter.CodexAdapter().probe(models=False)
    assert result.signed_in == signed_in
    assert calls == [['/fake/codex', '--version'], ['/fake/codex', 'login', 'status']]
    if not signed_in:
        assert 'codex login' in result.reason and 'Refresh' in result.reason


def test_no_device_login_implementation_or_frontend_callers():
    root = Path(__file__).resolve().parents[3]
    assert not (root / 'backend/app/services/codex_login.py').exists()
    for path in (root / 'frontend/lib/api.ts', root / 'frontend/components/CodexEngineSetup.tsx'):
        source = path.read_text()
        assert 'startCodexLogin' not in source
        assert 'CodexLoginOperation' not in source
    source = (root / 'frontend/components/CodexEngineSetup.tsx').read_text()
    assert 'Install Codex from OpenAI' in source
    assert 'codex login' in source and 'Refresh' in source
