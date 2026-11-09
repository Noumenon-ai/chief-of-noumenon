"""Every CLI call is fake, including reads. No machine or network state changes."""
import asyncio
import copy
import json
from datetime import timedelta
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest

from app.auth import store
from app.auth.policy import Principal
from app.auth.routes import require_admin
from app.core.config import settings
from app.routers.phone import requests
from app.services import phone_access as phone
from tests.auth.test_auth_api import app, auth_settings, client, factory, login, set_owner, pairing_code  # noqa: F401

HOST = 'chief.example.ts.net'
TARGET = 'http://127.0.0.1:8931'


@pytest.fixture(autouse=True)
def fake(monkeypatch, tmp_path):
    monkeypatch.setattr(phone, 'record_path', lambda: tmp_path / 'phone.json')
    monkeypatch.setattr(phone, '_target', TARGET)
    monkeypatch.setattr(phone, '_lock', asyncio.Lock())
    monkeypatch.setattr(settings, 'HOST_EXECUTION_DISABLED', False)
    monkeypatch.setattr(settings, 'TENANT_SCHEMAS_ENABLED', False)
    data = NS(status={'BackendState': 'Running', 'Self': {'DNSName': HOST + '.'}, 'CertDomains': [HOST]}, config={}, calls=[])
    async def command(*args):
        data.calls.append(args)
        if args == ('status', '--json'):
            return copy.deepcopy(data.status)
        if args == ('serve', 'status', '--json'):
            return copy.deepcopy(data.config)
        assert args[:2] == ('serve', '--bg')
        port = args[2].removeprefix('--https=')
        assert int(port) in phone.PORTS
        if args[-1] == 'off':
            assert args[3:] == ('--set-path=/', 'off')
            key = f'{HOST}:{port}'
            del data.config['Web'][key]['Handlers']['/']
            if not data.config['Web'][key]['Handlers']:
                del data.config['Web'][key]
                del data.config['TCP'][port]
        else:
            assert args[3:] == (TARGET,)
            data.config.setdefault('TCP', {})[port] = {'HTTPS': True}
            data.config.setdefault('Web', {})[f'{HOST}:{port}'] = {'Handlers': {'/': {'Proxy': TARGET}}}
        return {}
    monkeypatch.setattr(phone, 'command', command)
    requests.reset()
    return data


def service(fake, port, target='http://127.0.0.1:9999', path='/'):
    fake.config.setdefault('TCP', {})[str(port)] = {'HTTPS': True}
    fake.config.setdefault('Web', {}).setdefault(f'{HOST}:{port}', {'Handlers': {}})['Handlers'][path] = {'Proxy': target}


async def test_missing(monkeypatch):
    monkeypatch.setattr(phone, 'command', AsyncMock(side_effect=FileNotFoundError))
    assert (await phone.run())['state'] == 'not_installed'


@pytest.mark.parametrize('state', ['NeedsLogin', 'NeedsMachineAuth', 'Stopped', 'NoState'])
async def test_signed_out(fake, state):
    fake.status['BackendState'] = state
    assert (await phone.run())['state'] == 'signed_out'
    assert fake.calls == [('status', '--json')]


async def test_ready_on_exact_address_and_off(fake):
    assert (await phone.run())['state'] == 'ready'
    result = await phone.run('on')
    assert result['state'] == 'on' and result['address'] == f'https://{HOST}'
    assert (await phone.run('on'))['state'] == 'on'
    assert sum(call[-1] == TARGET for call in fake.calls) == 1
    assert phone.chat_link(42) == f'https://{HOST}/chat/?thread=42'
    await phone.run('off')
    assert not phone.private_origin()
    assert f'{HOST}:443' not in fake.config['Web']
    assert '443' not in fake.config['TCP']


async def test_uses_10000_preserves_other_services_and_new_paths(fake):
    service(fake, 443)
    service(fake, 8443)
    before = copy.deepcopy(fake.config)
    result = await phone.run('on')
    assert result['address'] == f'https://{HOST}:10000'
    service(fake, 10000, path='/other')
    assert (await phone.run('off'))['state'] != 'on'
    for port in (443, 8443):
        assert fake.config['Web'][f'{HOST}:{port}'] == before['Web'][f'{HOST}:{port}']
        assert fake.config['TCP'][str(port)] == before['TCP'][str(port)]
    assert '/other' in fake.config['Web'][f'{HOST}:10000']['Handlers']
    assert all('reset' not in call for call in fake.calls)


async def test_no_free_ports(fake):
    for port in phone.PORTS:
        service(fake, port)
    before = copy.deepcopy(fake.config)
    result = await phone.run('on')
    assert result['state'] == 'failed' and 'in use' in result['message']
    assert fake.config == before
    assert all(call[-1] == '--json' for call in fake.calls)


@pytest.mark.parametrize('container', ['Foreground', 'Services'])
async def test_foreground_and_service_ports_also_reserved(fake, container):
    fake.config[container] = {'other': {'TCP': {'443': {'HTTPS': True}, '8443': {'TCPForward': '127.0.0.1:9999'}}}}
    assert (await phone.run('on'))['address'].endswith(':10000')


async def test_https_disabled(fake):
    fake.status['CertDomains'] = []
    result = await phone.run('on')
    assert result['state'] == 'failed' and 'HTTPS certificates' in result['message']
    assert result['help_url'] == phone.DNS_PAGE
    assert all(call[-1] == '--json' for call in fake.calls)


async def test_never_adopts_identical_service_without_ownership(fake):
    service(fake, 443, TARGET)
    assert (await phone.run('on'))['address'].endswith(':8443')
    await phone.run('off')
    assert fake.config['Web'][f'{HOST}:443']['Handlers']['/']['Proxy'] == TARGET


async def test_changed_owned_entry_never_removed(fake):
    await phone.run('on')
    service(fake, 443, 'http://127.0.0.1:9999')
    before = copy.deepcopy(fake.config)
    result = await phone.run('off')
    assert result['state'] == 'failed' and 'Nothing was removed' in result['message']
    assert fake.config == before
    assert not phone.private_origin()


async def test_funnel_is_not_private_and_never_changed(fake):
    await phone.run('on')
    fake.config['AllowFunnel'] = {f'{HOST}:443': True}
    before = copy.deepcopy(fake.config)
    assert (await phone.run('off'))['state'] == 'failed'
    assert fake.config == before
    assert not phone.private_origin()


@pytest.mark.parametrize('host', ['evil.ts.net;touch /tmp/no', '*.ts.net', 'evil.com', 'x.ts.net/secret', '-bad.ts.net'])
async def test_no_user_or_tool_values_reach_command_arguments(fake, host):
    fake.status['Self']['DNSName'] = host
    assert (await phone.run('on'))['state'] == 'failed'
    assert fake.calls == [('status', '--json')]


async def test_tool_failure_reason_redacts_keys_and_links(monkeypatch):
    monkeypatch.setattr(phone, 'command', AsyncMock(side_effect=phone.ToolFailure('Permission denied: tskey-auth-abc123 https://login.example/secret')))
    result = await phone.run('on')
    assert result['state'] == 'failed' and 'Permission denied' in result['message']
    assert 'abc123' not in result['message'] and 'login.example' not in result['message']


@pytest.mark.parametrize('host,base', [('0.0.0.0',''), ('192.168.1.2',''), ('127.0.0.1','/prefix')])
async def test_non_loopback_and_prefix_unavailable(fake, host, base):
    phone.configure(host, 8931, base)
    assert (await phone.run('on'))['state'] == 'unavailable'
    assert not fake.calls


@pytest.mark.parametrize('action', ['status', 'on', 'off', 'pairing-code'])
async def test_auth_csrf_chat_and_wrong_owner_refused(app, factory, fake, action):
    path = f'/api/v1/phone/{action}'
    await set_owner(factory)
    async with client(app) as api:
        assert (await api.post(path, json={})).status_code == 401
        csrf = (await login(api))['csrf_token']
        assert (await api.post(path, json={})).status_code == 403
        code = await pairing_code(api, csrf, 'chat')
    async with client(app) as paired:
        session = (await paired.post('/api/v1/auth/pair', json={'code': code, 'cookie': True})).json()['session']
        assert (await paired.post(path, json={}, headers={'X-CSRF-Token': session['csrf_token']})).status_code == 403
    app.dependency_overrides[require_admin] = lambda: Principal(kind='account', tenant_id='other')
    async with client(app) as owner:
        csrf = (await login(owner))['csrf_token']
        assert (await owner.post(path, json={}, headers={'X-CSRF-Token': csrf})).status_code == 403
    assert not fake.calls


async def test_rate_limit(app, factory):
    await set_owner(factory)
    async with client(app) as api:
        csrf = (await login(api))['csrf_token']
        for _ in range(20):
            assert (await api.post('/api/v1/phone/status', json={}, headers={'X-CSRF-Token': csrf})).status_code == 200
        assert (await api.post('/api/v1/phone/on', json={}, headers={'X-CSRF-Token': csrf})).status_code == 429


async def test_qr_once_expiry_host_origin_and_secure_cookie(app, factory, fake, monkeypatch, caplog):
    await set_owner(factory)
    async with client(app) as owner:
        csrf = (await login(owner))['csrf_token']
        assert (await owner.post('/api/v1/phone/on', json={}, headers={'X-CSRF-Token': csrf})).json()['state'] == 'on'
        response = await owner.post('/api/v1/phone/pairing-code', json={}, headers={'X-CSRF-Token': csrf})
        assert response.headers['cache-control'] == 'no-store'
        url = response.json()['url']
        assert url.startswith(f'https://{HOST}/pair#code=')
        secret = url.split('#code=')[1]
        second = (await owner.post('/api/v1/phone/pairing-code', json={}, headers={'X-CSRF-Token': csrf})).json()['url'].split('#code=')[1]
    async with client(app, base_url=f'https://{HOST}') as phone_client:
        response = await phone_client.post('/api/v1/auth/pair', json={'code': secret, 'cookie': True}, headers={'Origin': f'https://{HOST}'})
        assert response.status_code == 200
        assert response.json()['session']['scopes'] == ['chat']
        assert 'Secure' in response.headers['set-cookie']
        assert (await phone_client.post('/api/v1/auth/pair', json={'code': secret})).status_code == 401
        assert (await phone_client.get('/api/v1/auth/session', headers={'Host': 'other.example.ts.net'})).status_code == 421
        assert (await phone_client.get('/api/v1/auth/session', headers={'Origin': 'https://other.example.ts.net'})).status_code == 403
    now = store.utcnow()
    monkeypatch.setattr(store, 'utcnow', lambda: now + timedelta(minutes=6))
    async with client(app) as expired:
        assert (await expired.post('/api/v1/auth/pair', json={'code': second})).status_code == 401
    assert secret not in caplog.text and second not in caplog.text


async def test_cli_exec_has_no_shell_and_bounded_timeout(monkeypatch, fake):
    import importlib.util
    # Load isolated module because the fixture replaced the normal command.
    spec = importlib.util.spec_from_file_location('phone_cli_contract', phone.__file__)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module.shutil, 'which', lambda name: '/fake/tailscale')
    import threading
    parser = module.parse_status
    def off_loop(raw):
        assert threading.current_thread() is not threading.main_thread()
        return parser(raw)
    monkeypatch.setattr(module, 'parse_status', off_loop)
    stdout = asyncio.StreamReader(); stdout.feed_data(b'{}'); stdout.feed_eof()
    stderr = asyncio.StreamReader(); stderr.feed_eof()
    proc = NS(stdout=stdout, stderr=stderr, wait=AsyncMock(), communicate=AsyncMock(return_value=(b'{}', b'')), returncode=0, kill=lambda: None)
    spawn = AsyncMock(return_value=proc)
    monkeypatch.setattr(module.asyncio, 'create_subprocess_exec', spawn)
    real_wait = asyncio.wait_for
    waits = []
    async def bounded(coro, *, timeout):
        waits.append(timeout)
        return await real_wait(coro, timeout=timeout)
    monkeypatch.setattr(module.asyncio, 'wait_for', bounded)
    assert await module.command('serve', 'status', '--json') == {}
    assert spawn.call_args.args == ('/fake/tailscale', 'serve', 'status', '--json')
    assert 'shell' not in spawn.call_args.kwargs
    assert waits == [12]


async def test_same_origin_static_pages_enforce_exact_host(fake, tmp_path):
    import httpx
    from app.server.static_ui import serve_ui
    await phone.run('on')
    (tmp_path / 'index.html').write_text('<html>Chief</html>')
    inner = AsyncMock()
    transport = httpx.ASGITransport(serve_ui(inner, tmp_path, check_hosts=True))
    async with httpx.AsyncClient(transport=transport, base_url=f'https://{HOST}') as api:
        assert (await api.get('/')).status_code == 200
        assert (await api.get('/', headers={'Host': 'wrong.example.ts.net'})).status_code == 421
    inner.assert_not_called()


async def test_trusted_loopback_proxy_cookie_and_csrf(app, factory, fake):
    await phone.run('on')
    await set_owner(factory)
    async with client(app, peer=('127.0.0.1', 12345), base_url=f'http://{HOST}', behind=['127.0.0.1'],
                      headers={'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '100.64.0.2', 'Origin': f'https://{HOST}'}) as api:
        response = await api.post('/api/v1/auth/login', json={'passphrase': 'a long owner passphrase'})
        assert response.status_code == 200 and 'Secure' in response.headers['set-cookie']
        # httpx sees its transport URL as HTTP; explicitly carry the secure cookie as a real HTTPS browser would.
        token = response.cookies.get('od_session')
        headers = {'Cookie': f'od_session={token}', 'X-CSRF-Token': response.json()['csrf_token']}
        assert (await api.post('/api/v1/phone/status', json={}, headers=headers)).status_code == 200
        assert (await api.post('/api/v1/phone/off', json={}, headers={'Cookie': f'od_session={token}'})).status_code == 403


async def test_turn_off_never_removes_a_listener_shared_with_another_host(fake):
    await phone.run('on')
    fake.config['Web']['other.example.ts.net:443'] = {'Handlers': {'/': {'Proxy': 'http://127.0.0.1:9999'}}}
    before = copy.deepcopy(fake.config)
    calls = len(fake.calls)
    result = await phone.run('off')
    assert result['state'] == 'failed' and 'shares' in result['message']
    assert fake.config == before
    assert all(call[-1] == '--json' for call in fake.calls[calls:])


@pytest.mark.parametrize('peers,joined,online', [({}, 0, 0), ({'a': {'Online': False}}, 1, 0),
    ({'a': {'Online': True, 'TailscaleIPs': ['100.64.1.2']}, 'b': {'Online': False}}, 2, 1)])
def test_account_and_peer_parser_only_reveals_self_login_and_counts(peers, joined, online):
    raw = json.dumps({'Self': {'UserID': 7}, 'User': {'7': {'LoginName': 'example-user@github'},
        '8': {'LoginName': 'private@example.com'}}, 'Peer': peers})
    assert phone.account_summary(phone.parse_status(raw)) == {
        'account': 'GitHub account example-user', 'other_devices': joined, 'online_devices': online}


@pytest.mark.parametrize('raw', ['{}', '{"Self": null, "User": [], "Peer": null}'])
def test_missing_account_fields_are_unknown_not_zero(raw):
    assert phone.account_summary(phone.parse_status(raw)) == {'account': '', 'other_devices': None, 'online_devices': None}


@pytest.mark.parametrize('extra', [{}, {'Peer': None}])
def test_running_status_without_peers_means_no_device_joined(extra):
    raw = json.dumps({**extra, 'BackendState': 'Running', 'Self': {'UserID': 7, 'DNSName': 'laptop.example.ts.net.'},
        'User': {'7': {'LoginName': 'example-user@github'}}})
    assert phone.account_summary(phone.parse_status(raw)) == {
        'account': 'GitHub account example-user', 'other_devices': 0, 'online_devices': 0}


@pytest.mark.parametrize('raw', ['garbage', '[1, 2]', '{', 'x' * (phone.MAX_STATUS_BYTES + 1)])
def test_status_parser_rejects_garbage_and_oversize(raw):
    with pytest.raises(phone.ToolFailure):
        phone.parse_status(raw)


async def test_status_reports_account_when_no_phone_has_joined(fake):
    fake.status.update(Self={'DNSName': HOST, 'UserID': 7}, User={'7': {'LoginName': 'example-user@github'}}, Peer={})
    result = await phone.run()
    assert result['account'] == 'GitHub account example-user'
    assert result['other_devices'] == result['online_devices'] == 0


async def test_status_output_is_bounded():
    stream = asyncio.StreamReader()
    stream.feed_data(b'x' * (phone.MAX_STATUS_BYTES + 1))
    stream.feed_eof()
    err = asyncio.StreamReader(); err.feed_eof()
    with pytest.raises(phone.ToolFailure, match='too large'):
        await phone.bounded_output(NS(stdout=stream, stderr=err, wait=AsyncMock()))


async def test_unready_health_never_exposes_peer_details(fake):
    fake.status.update(BackendState='Starting', Health=['peer private@example.test at 100.64.2.3'])
    result = await phone.run()
    assert 'private@example.test' not in str(result) and '100.64.2.3' not in str(result)
