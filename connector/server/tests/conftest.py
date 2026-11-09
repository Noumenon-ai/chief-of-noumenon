"""Isolated test storage; provider tests must never contact live services."""
import os
import socket
import tempfile
from pathlib import Path

import pytest

_TEST_DATA = Path(tempfile.mkdtemp(prefix="connector-tests-"))
os.environ["CONNECTOR_DATA_DIR"] = str(_TEST_DATA)
os.environ["CONNECTOR_DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DATA / 'test.db'}"
os.environ["CONNECTOR_ENCRYPTION_KEY"] = "connector-test-only-encryption-key"
os.environ["CONNECTOR_ADMIN_TOKEN"] = "connector-test-only-admin-token"


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    original_connect = socket.socket.connect
    original_resolve = socket.getaddrinfo

    def connect(sock, address):
        if isinstance(address, tuple) and address[0] not in ("127.0.0.1", "::1"):
            raise OSError("External network is disabled in connector tests")
        return original_connect(sock, address)

    def resolve(host, port, *args, **kwargs):
        import ipaddress
        try:
            ipaddress.ip_address(host)
        except ValueError:
            if host not in ("localhost", None):
                return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", port))]
        return original_resolve(host, port, *args, **kwargs)

    import httpx
    original_request = httpx.AsyncHTTPTransport.handle_async_request
    async def reject_provider(self, request):
        if request.url.host not in ("127.0.0.1", "localhost", "::1"):
            return httpx.Response(401, json={"error": "invalid test credential"}, request=request)
        return await original_request(self, request)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", reject_provider)
    monkeypatch.setattr(socket.socket, "connect", connect)
    monkeypatch.setattr(socket, "getaddrinfo", resolve)
