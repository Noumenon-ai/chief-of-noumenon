"""Workspace MCP transport; all authority and execution stay in the backend."""
import asyncio
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from uuid import uuid4

from app.services.api_tools import Tools
from app.services.workspace_schema import definitions
from app.services.connector_bridge import ConnectorBridge


class WorkspaceBridge(ConnectorBridge):
    max_request_bytes = 1_000_000

    def __init__(self, runtime, run):
        super().__init__(runtime, run, {})
        self.tools = Tools(run.ctx, run.recorder, run.gate)
        self.tools.require_sandbox = True
        self.lock = asyncio.Lock()

    @property
    def launch(self):
        return SimpleNamespace(command=sys.executable,
            args=['-m', 'app.services.workspace_mailbox', '--mailbox', str(self.folder),
                  *(['--chat-cards'] if self.run.ctx.chat_cards_allowed else [])],
            env={'PYTHONPATH': str(Path(__file__).resolve().parents[2]), 'PYTHONDONTWRITEBYTECODE': '1'})

    async def list_tools_now(self):
        from app.services.chat_card_schema import definitions as cards
        return schemas() + (cards() if self.run.ctx.chat_cards_allowed else [])

    async def execute(self, name, args):
        # The child has no permit. The durable gate automatically allows confined
        # reads; acts keep their existing decisions and execution boundary.
        async with self.lock:
            if self.run.ctx.aborted or self.run.ctx.draft_only or self.run.ctx.media_review_only:
                return {'isError': True, 'content': [{'type': 'text', 'text': 'This turn cannot run tools.'}]}
            release = self.run.ctx.hold_clock() if self.run.ctx.hold_clock else lambda: None
            try:
                from app.services import chat_cards
                if name in chat_cards.TOOLS:
                    handle = await self.run.gate.open(request_id=uuid4().hex, tool='mcp__team__' + name,
                        input=args, summary='Chat suggestion', kind='tool')
                    if handle is None:
                        raise asyncio.CancelledError
                    try:
                        decision = await self.run.gate.decide(handle)
                    except BaseException:
                        await self.run.gate.cancel(handle.request_id)
                        raise
                    value = json.dumps(await chat_cards.suggest(self.runtime, self.run, name, args) if decision.kind == 'allow'
                                       else {'error': decision.message or 'This turn cannot suggest cards.'})
                else:
                    value = await self.tools.call(uuid4().hex, name, args)
                return {'content': [{'type': 'text', 'text': value}]}
            except ValueError:
                return {'isError': True, 'content': [{'type': 'text', 'text': 'Invalid workspace tool request.'}]}
            finally:
                release()


def schemas():
    return [{'name': item['function']['name'], 'description': item['function']['description'],
             'inputSchema': item['function']['parameters']} for item in definitions()]
