"""Sign-in codes never reach the access log."""
import logging

from app.core.logging import HideOAuthCallbackQuery


def record(path):
    return logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d', ("127.0.0.1:1", "GET", path, "1.1", 303), None)


def test_callback_query_is_removed():
    item = record("/api/v1/integrations/connector/oauth/gmail/callback?state=s3&code=c0de&scope=x")
    assert HideOAuthCallbackQuery().filter(item) is True
    assert "c0de" not in item.getMessage() and "s3" not in item.getMessage()
    assert "/oauth/gmail/callback" in item.getMessage()


def test_other_paths_and_odd_records_are_unchanged():
    item = record("/api/v1/threads?limit=5")
    assert HideOAuthCallbackQuery().filter(item) is True
    assert "limit=5" in item.getMessage()
    plain = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "hello", None, None)
    assert HideOAuthCallbackQuery().filter(plain) is True
