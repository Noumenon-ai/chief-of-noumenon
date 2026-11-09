"""Private phone access. Only fixed Tailscale CLI operations; never a public listener.

The small ownership record contains no credentials. It is shared with the alert
worker and survives restarts. A matching proxy alone is never proof of ownership.
"""
import asyncio
import json
import re
import shutil
from pathlib import Path

from app.core.config import settings
from app.services.agent_memory import redact_secrets

MAX_STATUS_BYTES = 1_000_000
PORTS = (443, 8443, 10000)
DNS_PAGE = "https://login.tailscale.com/admin/dns"
_NAME = re.compile(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net\Z")
_target: str | None = None
_lock = asyncio.Lock()


def configure(host: str, port: int, base_path: str = "") -> None:
    global _target
    # This feature never makes a LAN/public bind usable remotely.
    _target = f"http://127.0.0.1:{port}" if host in ("127.0.0.1", "localhost") and 1 <= port <= 65535 and not base_path else None


def record_path() -> Path:
    return settings.SQLITE_FILE.parent / "phone-access.json"


def record() -> dict:
    try:
        value = json.loads(record_path().read_text())
        if (isinstance(value, dict) and _NAME.fullmatch(value.get("host", ""))
                and value.get("port") in PORTS
                and re.fullmatch(r"http://127\.0\.0\.1:[0-9]{1,5}", value.get("target", ""))):
            return value
    except (OSError, ValueError, TypeError):
        pass
    return {}


def save(value: dict) -> None:
    path = record_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value))
    temporary.chmod(0o600)
    temporary.replace(path)


def private_origin() -> str:
    saved = record()
    if not saved.get("enabled"):
        return ""
    port = saved["port"]
    return f"https://{saved['host']}" + (f":{port}" if port != 443 else "")


def chat_link(thread_id: int | None = None) -> str:
    origin = private_origin()
    return f"{origin}/chat/" + (f"?thread={int(thread_id)}" if thread_id else "") if origin else ""


class ToolFailure(Exception):
    pass


def plain_reason(output: str) -> str:
    # Never return login URLs, auth keys or ANSI control sequences from the tool.
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", output)
    text = re.sub(r"tskey-[A-Za-z0-9_-]+", "[redacted]", text)
    text = re.sub(r"https?://\S+", "[link removed]", text)
    text = redact_secrets(text)[0]
    return " ".join(text.split())[:600] or "Tailscale could not finish. Check that it is running and try again."


def parse_status(raw: bytes | str) -> dict:
    if len(raw) > MAX_STATUS_BYTES:
        raise ToolFailure("Tailscale status is too large.")
    try:
        value = json.loads(raw)
        if value is None:
            return {}
        if isinstance(value, dict):
            return value
    except (ValueError, UnicodeError, RecursionError):
        pass
    raise ToolFailure("Tailscale returned an unreadable status. Update Tailscale and check again.")


def account_summary(status: dict) -> dict:
    """Only the current computer's login and aggregate counts leave the backend."""
    own = status.get("Self") or {}
    users = status.get("User") or {}
    user = users.get(str(own.get("UserID")), {}) if isinstance(users, dict) and isinstance(own, dict) else {}
    login = user.get("LoginName", "") if isinstance(user, dict) else ""
    account = ""
    if isinstance(login, str) and re.fullmatch(r"[A-Za-z0-9_.+@-]{1,200}", login) and redact_secrets(login)[0] == login and not login.startswith("tskey-"):
        name, _, provider = login.rpartition("@")
        account = f"GitHub account {name}" if provider.lower() == "github" else login
    peers = status.get("Peer")
    # Tailscale reports "Peer" as null (or leaves it out) when no other device has joined.
    if status.get("Peer") is None and status.get("BackendState") == "Running" and isinstance(own, dict) and own:
        peers = {}
    valid = isinstance(peers, dict)
    return {"account": account, "other_devices": len(peers) if valid else None,
            "online_devices": sum(isinstance(p, dict) and p.get("Online") is True for p in peers.values()) if valid else None}


async def bounded_output(process):
    async def read(stream):
        chunks, size = [], 0
        while chunk := await stream.read(65536):
            size += len(chunk)
            if size > MAX_STATUS_BYTES:
                raise ToolFailure("Tailscale status is too large.")
            chunks.append(chunk)
        return b"".join(chunks)
    readers = [asyncio.create_task(read(stream)) for stream in (process.stdout, process.stderr)]
    try:
        stdout, stderr = await asyncio.gather(*readers)
        await process.wait()
        return stdout, stderr
    finally:
        for task in readers:
            task.cancel()
        await asyncio.gather(*readers, return_exceptions=True)


async def command(*args: str) -> dict:
    executable = shutil.which("tailscale")
    if not executable:
        raise FileNotFoundError
    process = await asyncio.create_subprocess_exec(executable, *args, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        stdout, stderr = await asyncio.wait_for(bounded_output(process), timeout=12)
    except asyncio.CancelledError:
        if process.returncode is None:
            process.kill()
        await process.communicate()
        raise
    except ToolFailure:
        if process.returncode is None:
            process.kill()
        await process.communicate()
        raise
    except TimeoutError:
        if process.returncode is None:
            process.kill()
        await process.communicate()
        raise ToolFailure("Tailscale took too long. Check that it is running, then try again.") from None
    output = (stderr or stdout).decode(errors="replace")
    if process.returncode:
        raise ToolFailure(plain_reason(output))
    if args[-1:] == ("--json",):
        return await asyncio.to_thread(parse_status, stdout)
    return {}


def configs(config: dict):
    yield config
    for key in ("Foreground", "Services"):
        for child in (config.get(key) or {}).values():
            yield from configs(child)


def occupied(config: dict, port: int) -> bool:
    return any(str(port) in (item.get("TCP") or {}) or
               any(key.endswith(f":{port}") for key in (item.get("Web") or {})) or
               any(key.endswith(f":{port}") and enabled for key, enabled in (item.get("AllowFunnel") or {}).items())
               for item in configs(config))


def owned(config: dict, saved: dict) -> bool:
    if not saved or saved.get("target") != _target:
        return False
    key = f"{saved['host']}:{saved['port']}"
    return ((config.get("TCP") or {}).get(str(saved['port'])) == {"HTTPS": True}
            and (config.get("Web") or {}).get(key, {}).get("Handlers", {}).get("/") == {"Proxy": _target}
            and not any((item.get("AllowFunnel") or {}).get(key) for item in configs(config)))


def state(name: str, message: str, **extra) -> dict:
    return {"state": name, "message": message, "address": "", **extra}


async def inspect() -> tuple[dict, dict, str]:
    if not _target or settings.HOST_EXECUTION_DISABLED or settings.TENANT_SCHEMAS_ENABLED:
        return state("unavailable", "Use the installed website to set up your phone. This separate development frontend cannot make a working phone link."), {}, ""
    status = await command("status", "--json")
    if status.get("BackendState") in ("NeedsLogin", "NeedsMachineAuth", "Stopped", "NoState"):
        return state("signed_out", "Open Tailscale on this computer and sign in, then check again."), {}, ""
    if status.get("BackendState") != "Running":
        raise ToolFailure("Tailscale is not ready. Open Tailscale on this computer and check its connection.")
    host = (status.get("Self", {}).get("DNSName") or "").lower().rstrip(".")
    if not _NAME.fullmatch(host):
        raise ToolFailure("This computer has no private Tailscale address yet. Enable MagicDNS in Tailscale and check again.")
    summary = account_summary(status)
    config = await command("serve", "status", "--json")
    saved = record()
    if saved.get("host") == host and owned(config, saved):
        save({**saved, "enabled": True})
        return state("on", "Your private phone link is on.", address=private_origin(), **summary), config, host
    if saved.get("enabled"):
        save({**saved, "enabled": False})
    if host not in [name.rstrip(".").lower() for name in status.get("CertDomains", [])]:
        return state("failed", "Turn on HTTPS certificates in Tailscale, then check again.", help_url=DNS_PAGE, **summary), config, host
    if all(occupied(config, port) for port in PORTS):
        return state("failed", "All three private HTTPS ports are in use by other services. Free one in Tailscale before turning this on.", **summary), config, host
    return state("ready", "Ready to make a private link to this app.", **summary), config, host


async def run(action: str = "status") -> dict:
    async with _lock:
        try:
            current, config, host = await inspect()
            if current["state"] == "unavailable":
                return current
            if action == "on" and current["state"] == "ready":
                # Read again immediately before writing; never reuse a stale UI snapshot.
                config = await command("serve", "status", "--json")
                port = next((p for p in PORTS if not occupied(config, p)), None)
                if port is None:
                    return state("failed", "All three private HTTPS ports are in use by other services.")
                # Persist intent first so a timeout/crash after the CLI succeeds is recoverable.
                save({"host": host, "port": port, "target": _target, "enabled": False})
                await command("serve", "--bg", f"--https={port}", _target)
                return (await inspect())[0]
            if action == "off":
                saved = record()
                if not saved:
                    return current
                config = await command("serve", "status", "--json")
                if not owned(config, saved) or saved.get("host") != host:
                    return state("failed", "This app's private link has changed outside the app. Nothing was removed. Check Tailscale.")
                key = f"{saved['host']}:{saved['port']}"
                # The CLI deletes the TCP listener when its last host handler goes.
                # Another hostname may share that listener: leave it all untouched.
                if any(name != key and name.endswith(f":{saved['port']}") for name in (config.get("Web") or {})):
                    return state("failed", "Another service shares this private port. Nothing was removed. Check Tailscale.")
                # Remove only our root handler, preserving any later-added paths/services.
                await command("serve", "--bg", f"--https={saved['port']}", "--set-path=/", "off")
                save({**saved, "enabled": False})
                return (await inspect())[0]
            return current
        except FileNotFoundError:
            return state("not_installed", "Tailscale is a free private link between your own devices.")
        except (ToolFailure, OSError, TypeError, AttributeError) as exc:
            return state("failed", plain_reason(str(exc)))
