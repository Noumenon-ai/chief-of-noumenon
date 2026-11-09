"""Turn mailbox: Docker, screen state and one-use permits stay in the backend.

The child only sees tool schemas and a mailbox. A forged mailbox request cannot
authorize itself: a delivered, unspent approval for the exact input is required.
"""
import asyncio
from datetime import timedelta
from pathlib import Path
import sys
from types import SimpleNamespace

from sqlalchemy import select, update

from app.computers import grants, mcp_server, policy
from app.db.models import Approval, Turn
from app.db.transactions import begin_write
from app.services.connector_bridge import ConnectorBridge
from app.services.thread_store import utcnow


class ComputerBridge(ConnectorBridge):
    # Allow JSON escaping of the gate's 50,000 reviewable Unicode characters.
    max_request_bytes = 1_000_000

    def __init__(self, runtime, run, binding):
        super().__init__(runtime, run, {})
        self.binding = binding
        args = binding.launch.args
        def option(name, default=None):
            return args[args.index(name) + 1] if name in args else default
        self.server = mcp_server.Server(
            binding.name, option("--user"), binding.grants_dir,
            Path(option("--state")), option("--docker"), binding.kind,
            option("--turn-id", ""), int(option("--max-screen-actions", "300")),
            binding.browser_enabled,
        )
        self.lock = asyncio.Lock()

    @property
    def launch(self):
        return SimpleNamespace(command=sys.executable, args=[
            *(["--computer-mailbox"] if getattr(sys, "frozen", False) else ["-m", "app.computers.mailbox"]), "--mailbox", str(self.folder),
            "--kind", self.binding.kind,
            *(["--browser"] if self.binding.browser_enabled else []),
        ], env={"PYTHONPATH": str(Path(__file__).resolve().parents[2]),
                "PYTHONDONTWRITEBYTECODE": "1"})

    async def list_tools_now(self):
        return self.server.handle({"id": 1, "method": "tools/list"})["result"]["tools"] + ([mcp_server.HANDOFF_TOOL] if self.binding.kind == "desktop" else [])

    async def consume_approval(self, name, args):
        async with self.runtime.session() as db:
            await begin_write(db)
            turn = await db.get(Turn, self.run.turn_id)
            if (turn is None or turn.status != "running" or turn.owner_token != self.run.owner_token
                    or self.run.ctx.aborted):
                await db.rollback()
                return False
            rows = await db.scalars(select(Approval).where(
                Approval.turn_id == turn.id, Approval.tool == policy.COMPUTER_TOOL_PREFIX + name,
                Approval.status == "allowed", Approval.delivered_at.is_not(None),
                Approval.consumed_at.is_(None), Approval.decided_at >= utcnow() - timedelta(minutes=15),
            ).order_by(Approval.created_at))
            for row in rows:
                if grants.canonical(row.input) != grants.canonical(args):
                    continue
                # Both credentials are backend-only; failure spends neither a
                # different input nor a different turn's approval.
                if not grants.consume(self.binding.grants_dir, name, args):
                    break
                result = await db.execute(update(Approval).where(
                    Approval.id == row.id, Approval.consumed_at.is_(None),
                ).values(consumed_at=utcnow()))
                await db.commit()
                return result.rowcount == 1
            await db.rollback()
            return False

    async def execute(self, name, args):
        async with self.lock:
            if self.run.ctx.draft_only or self.run.ctx.media_review_only:
                return mcp_server._text(mcp_server.NOT_APPROVED, error=True)
            if policy.automatic(policy.COMPUTER_TOOL_PREFIX + name, self.run.ctx.approval_mode) == ("denied", "plan_mode"):
                return mcp_server._text("Plan mode is read only. Nothing was run.", error=True)
            if not await self.consume_approval(name, args):
                return mcp_server._text(mcp_server.NOT_APPROVED, error=True)
            if name == "request_handoff":
                self.server.screen.needs_observation = True
                return mcp_server._text("The person finished the hand-off. Take a fresh observation before acting. No takeover input is returned.")
            if getattr(self.run, "handoff_waiting", False):
                return mcp_server._text("Waiting for the person to finish the hand-off. Nothing was run.", error=True)
            # The permit was atomically spent above. Only this private backend
            # method bypasses the standalone server's filesystem permit check.
            return await asyncio.to_thread(self.server.call, name, args, _approved=True)
