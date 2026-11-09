"""Loopback-only Chief connector entry point: python -m app.serve."""
import os


def main():
    os.umask(0o077)
    callback = os.environ.setdefault("CONNECTOR_OAUTH_CALLBACK_BASE", "http://127.0.0.1:8000/api/v1/integrations/connector/oauth")
    from urllib.parse import urlsplit
    origin = urlsplit(callback)
    os.environ.setdefault("CONNECTOR_ALLOWED_RETURN_ORIGINS", f"{origin.scheme}://{origin.netloc},http://localhost:8000,http://localhost:3000,http://127.0.0.1:3000")
    from app.core.config import settings
    if settings.HOST != "127.0.0.1" or settings.EXPOSE_LOCAL_TOKEN or settings.ALLOW_PUBLIC_ACCESS or settings.ALLOW_ANONYMOUS_MCP:
        raise RuntimeError("Chief connector requires loopback binding and authenticated access without token exposure")
    from pathlib import Path
    from sqlalchemy.engine import make_url
    database = make_url(settings.DATABASE_URL)
    if database.get_backend_name() == "sqlite":
        path = Path(database.database).expanduser().resolve()
        if path.parent != settings.DATA_DIR.resolve():
            raise RuntimeError("The connector database must live in CONNECTOR_DATA_DIR")
        if path.exists() and (path.is_symlink() or path.stat().st_mode & 0o077):
            raise RuntimeError("The connector database must be an owner-only file (0600)")
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=settings.PORT, access_log=False)


if __name__ == "__main__":
    main()
