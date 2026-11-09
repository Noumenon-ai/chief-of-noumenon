"""One turn's mailbox and atomic approval consumption."""
import asyncio
from datetime import timedelta
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace
from sqlalchemy import select, update
from app.db.models import Approval, Turn, Agent
from app.db.transactions import begin_write
from app.team import fence, management, notices, policy, service, setup


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


async def consume_allowed_approval(db, turn_id, owner_token, tool, arguments):
    await begin_write(db)
    turn = await db.get(Turn, turn_id)
    if turn is None or turn.status != 'running' or turn.owner_token != owner_token:
        await db.rollback()
        return False
    threshold = service.now() - timedelta(minutes=15)
    approvals = (await db.execute(select(Approval).where(
        Approval.turn_id == turn_id, Approval.tool == tool, Approval.status == 'allowed',
        Approval.consumed_at.is_(None), Approval.decided_at >= threshold).order_by(Approval.created_at))).scalars()
    expected = canonical(arguments)
    for approval in approvals:
        if canonical(approval.input) != expected:
            continue
        claimed = await db.execute(update(Approval).where(Approval.id == approval.id, Approval.consumed_at.is_(None), Approval.status == 'allowed').values(consumed_at=service.now()))
        await db.commit()
        return claimed.rowcount == 1
    await db.rollback()
    return False


class TeamBridge:
    def __init__(self, runtime, run, *, pdf_only=False, cards_only=False):
        self.runtime, self.run = runtime, run
        self.pdf_only = pdf_only
        self.cards_only = cards_only
        # A fresh private folder outside all agent workspaces. Not backed up.
        self.folder = Path(tempfile.mkdtemp(prefix=f'open-dots-team-{run.turn_id}-'))
        self.task = None
        self.calls = set()

    @property
    def launch(self):
        extra = ['--cards-only'] if self.cards_only else ['--pdf-only'] if self.pdf_only else ['--escalations'] if notices.escalations_on() else []
        if self.pdf_only and getattr(self.run.ctx, 'chat_cards_allowed', False):
            extra += ['--chat-cards']
        if getattr(sys, 'frozen', False):
            return SimpleNamespace(command=sys.executable, args=['--team-mcp', '--mailbox', str(self.folder), *extra], env={})
        root = str(Path(__file__).resolve().parents[2])
        return SimpleNamespace(command=sys.executable, args=['-m', 'app.team.mcp_server', '--mailbox', str(self.folder), *extra], env={'PYTHONPATH': root})

    def start(self):
        self.task = asyncio.create_task(self.poll())

    async def close(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
        for task in self.calls:
            task.cancel()
        await asyncio.gather(*self.calls, return_exceptions=True)
        shutil.rmtree(self.folder, ignore_errors=True)

    async def poll(self):
        while not self.run.ctx.aborted:
            for path in self.folder.glob('req-*.json'):
                claimed = path.with_suffix('.working')
                try:
                    path.rename(claimed)
                except FileNotFoundError:
                    continue
                task = asyncio.create_task(self.handle(claimed))
                self.calls.add(task)
                task.add_done_callback(self.calls.discard)
            await asyncio.sleep(.1)

    async def handle(self, path):
        try:
            if path.stat().st_size > 64000:
                raise service.TeamError('too_large', 'The team request is too large.')
            request = await asyncio.to_thread(lambda: json.loads(path.read_text(encoding='utf-8')))
            name, args = request['name'], request['arguments']
            if not isinstance(name, str) or not isinstance(args, dict):
                raise ValueError('Invalid request')
            async with self.runtime.session() as db:
                allowed = await consume_allowed_approval(db, self.run.turn_id, self.run.owner_token, 'mcp__team__' + name, args)
            if not allowed:
                result = {'error': 'This call has no matching, unused approval.', 'code': 'not_approved'}
            else:
                result = await self.execute(name, args)
        except service.TeamError as exc:
            result = {'error': str(exc), 'code': exc.code}
        except Exception:
            result = {'error': 'The team call could not be completed.', 'code': 'team_error'}
        response = self.folder / path.name.replace('req-', 'resp-').replace('.working', '.json')
        tmp = response.with_suffix('.tmp')
        await asyncio.to_thread(lambda: tmp.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8'))
        os.replace(tmp, response)
        path.unlink(missing_ok=True)

    async def execute(self, name, args):
        rt, run = self.runtime, self.run
        if self.pdf_only:
            from app.services.pdf_contract import NAMES
            from app.services.chat_card_schema import TOOLS as CARD_TOOLS
            if name not in NAMES and not (getattr(run.ctx, 'chat_cards_allowed', False) and name in CARD_TOOLS):
                return {'error': 'Only PDF tools are available through this bridge.'}
        from app.services import chat_cards
        if name in chat_cards.TOOLS:
            if not getattr(run.ctx, 'chat_cards_allowed', False):
                raise service.TeamError('outside_origin', 'This turn cannot suggest cards.')
            return await chat_cards.suggest(rt, run, name, args)
        if self.cards_only:
            raise service.TeamError('unknown_tool', 'Only chat cards are available.')
        from app.services import reminders
        if name in reminders.TOOLS:
            async with rt.session() as db:
                await service.member(db, rt.owner_id, run.agent_id, team_id=run.ctx.team.team_id)
            return await reminders.call(rt, run, name, args)
        if name == 'refresh_today':
            async with rt.session() as db:
                caller = await service.member(db, rt.owner_id, run.agent_id, team_id=run.ctx.team.team_id)
                team = await service.team_for(db, rt.owner_id)
                if team is None or team.id != run.ctx.team.team_id or team.lead_agent_id != caller.id:
                    raise service.TeamError('lead_only', 'Only the current team lead can read this snapshot.')
            from app.routers.needs_you import service_for
            return await service_for(rt).read(refresh=True)
        async with rt.session() as db:
            caller = await service.member(db, rt.owner_id, run.agent_id, team_id=run.ctx.team.team_id)
            if name == 'list_agents':
                rows = (await db.execute(select(Agent).where(Agent.team_id == caller.team_id, Agent.owner_id == rt.owner_id, Agent.archived_at.is_(None)).order_by(Agent.id))).scalars()
                return {'agents': [{'id': a.id, 'name': fence.line(a.name), 'title': fence.line(a.title), 'can_delegate': a.delegation_enabled} for a in rows]}
        from app.services import pdf_contract, pdf_tools
        if name in pdf_contract.NAMES:
            # A turn may retain an old workspace after the agent's folder changes.
            # PDF access always belongs to the current calling bot.
            from app.services.local_claude_runner import workspace_dir
            expected = Path(caller.workspace_path) if caller.workspace_path else workspace_dir() / 'agents' / str(caller.id)
            if run.ctx.workspace is None or Path(run.ctx.workspace) != expected.absolute():
                return {'error': 'PDF access refused: this is not the calling bot folder.'}
            return await pdf_tools.call(run, name, args)
        if name == 'find_contact':
            from app.services.contact_lookup import find
            return await find(rt, run, args.get('name'))
        if name == 'check_post_draft':
            from app.services import post_drafts
            async with rt.session() as db:
                return post_drafts.check(args.get('text'), args.get('networks'), await post_drafts.list_all(db, rt.owner_id))
        if name in management.TOOLS:
            return await management.call(rt, run, name, args)
        if name in setup.TOOLS:
            return await setup.call(rt, run, name, args)
        if name == 'ask_agent':
            return await rt.team_jobs.ask(run, args)
        if name == 'delegate':
            return await rt.team_jobs.delegate(run, args)
        if name == 'job_status':
            return await rt.team_jobs.job_status(run, args)
        if name == 'retry_thread':
            return await rt.notices.retry_thread(run, args)
        if name == 'raise_escalation':
            return await rt.notices.raise_escalation(run, args)
        if name in ('list_rooms', 'create_room', 'say_in_room'):
            return await rt.rooms.tool(run, name, args)
        raise service.TeamError('unknown_tool', 'Unknown team tool.')
