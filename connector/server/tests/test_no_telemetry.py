"""The API dependency has no recording or automatic export enabled."""
import pytest
from main import app


@pytest.mark.parametrize('signal', ['tracing', 'metrics', 'logs', 'operation_spans', 'auto_configure'])
def test_framework_telemetry_disabled(signal, monkeypatch):
    monkeypatch.setenv('FASTAPI_OTEL_AUTO_CONFIGURE', 'true')
    monkeypatch.setenv('OTEL_EXPORTER_OTLP_ENDPOINT', 'https://unused.invalid')
    assert app._telemetry[signal] is False
    assert not app._native_telemetry.enabled()
