from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
import os
from pathlib import Path
import secrets

BASE_DIR = Path(__file__).resolve().parent.parent.parent

def data_dir() -> Path:
    folder = Path(os.environ.get("CONNECTOR_DATA_DIR", str(Path.home() / ".local/share/chief-of-noumenon/connector"))).expanduser().resolve()
    if BASE_DIR.parents[1].resolve() == folder or BASE_DIR.parents[1].resolve() in folder.parents:
        raise RuntimeError("CONNECTOR_DATA_DIR must be outside the checkout")
    return folder


def _secret(name: str, filename: str) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value
    path = data_dir() / filename
    if path.exists():
        if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
            raise RuntimeError(f"{filename} must be a regular owner-only file (0600)")
        value = path.read_text().strip()
        if value:
            return value
    if os.environ.get("CONNECTOR_DEV") != "1":
        raise RuntimeError(f"Missing {name}; provision the connector before starting it")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as output:
        value = secrets.token_urlsafe(32)
        output.write(value)
    return value


def _resolve_encryption_key() -> str:
    return _secret("CONNECTOR_ENCRYPTION_KEY", ".secret.key")


def _resolve_admin_token() -> str:
    return _secret("CONNECTOR_ADMIN_TOKEN", ".admin_token")

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CONNECTOR_", env_file=".env", extra="ignore")

    PROJECT_NAME: str = "ConnectorHub"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/v1"
    
    # Server host & port
    HOST: str = "127.0.0.1"
    PORT: int = 8100
    PUBLIC_ORIGIN: str = Field(
        default=os.environ.get("CONNECTOR_PUBLIC_ORIGIN") or os.environ.get("PUBLIC_ORIGIN") or "http://127.0.0.1:8100",
        description="Public origin used for OAuth callbacks and reverse proxy"
    )
    OAUTH_CALLBACK_BASE: str = ""
    HOSTED_ORIGIN: str = "https://connector.suparagent.ai"
    HOSTED_DOMAIN: str = "connector.suparagent.ai"
    
    # SQLite Database
    DATABASE_URL: str = f"sqlite+aiosqlite:///{data_dir() / 'connector.db'}"
    DATA_DIR: Path = Field(default_factory=data_dir)
    
    # Cryptographic AES-256-GCM encryption key
    ENCRYPTION_KEY: str = Field(
        default_factory=_resolve_encryption_key,
        description="Base64 or 32-char key for credential encryption"
    )
    ADMIN_TOKEN: str = Field(
        default_factory=_resolve_admin_token,
        description="Bearer token required for /api admin endpoints"
    )
    RUNTIME_TOKEN: str = Field(
        default="",
        description="Optional static Bearer token for /v1 and /mcp"
    )
    
    # Set CONNECTOR_EXPOSE_LOCAL_TOKEN=false on any network-facing deployment.
    EXPOSE_LOCAL_TOKEN: bool = False
    DOCS_ENABLED: bool = False
    CLIENT_ORIGINS: str = ""

    # SSRF Protection
    ALLOW_PRIVATE_NETWORK: bool = False

    # Public Access Gate for Open Web Console
    ALLOW_PUBLIC_ACCESS: bool = Field(
        default=os.environ.get("CONNECTOR_ALLOW_PUBLIC_ACCESS", os.environ.get("ALLOW_PUBLIC_ACCESS", "false")).lower() in ("true", "1", "yes"),
        description=("Shared public sandbox: let visitors without a token use the console and API inside their own "
                     "isolated tenant. Off by default; never enable it on an instance holding real credentials you do not want shared.")
    )

    # Origins (besides PUBLIC_ORIGIN) allowed as post-OAuth return URLs, comma separated.
    ALLOWED_RETURN_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # MCP Authentication Gate (Fail-Closed by default)
    ALLOW_ANONYMOUS_MCP: bool = Field(
        default=False,
        description="Explicit opt-in to allow unauthenticated MCP access (restricted to loopback)"
    )

settings = Settings()
settings.DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
