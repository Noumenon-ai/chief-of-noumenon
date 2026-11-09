"""Credential-free computer MCP shim. No Docker launch or permit path."""
import argparse
import json
import sys

from app.composio_mcp_server import Server as Mailbox
from app.computers import browser, mcp_server, screen


class Server(Mailbox):
    def __init__(self, mailbox, kind="shell", browser_enabled=False):
        super().__init__(mailbox, {})
        self.tools = mcp_server.TOOLS + (screen.TOOLS + [mcp_server.HANDOFF_TOOL] if kind == "desktop" else []) + (browser.TOOLS if kind == "desktop" and browser_enabled else [])
        self.names = {tool["name"] for tool in self.tools}

    def handle(self, message):
        if message.get("id") is not None and message.get("method") == "tools/call":
            params = message.get("params") or {}
            result = self.call(params.get("name"), params.get("arguments") or {})
            if "content" not in result:
                result = mcp_server._text(result.get("error", "The computer did not answer."), error=True)
            return {"jsonrpc": "2.0", "id": message["id"], "result": result}
        return super().handle(message)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mailbox", required=True)
    parser.add_argument("--kind", choices=("shell", "desktop"), default="shell")
    parser.add_argument("--browser", action="store_true")
    args = parser.parse_args()
    server = Server(args.mailbox, args.kind, args.browser)
    for line in sys.stdin:
        try:
            result = server.handle(json.loads(line))
            if result is not None:
                print(json.dumps(result), flush=True)
        except (ValueError, OSError, TypeError):
            continue


if __name__ == "__main__":
    main()
