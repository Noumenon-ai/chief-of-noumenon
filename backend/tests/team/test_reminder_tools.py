"""Scripted engine exercises the real automatic gate and reminder mailbox."""
import json
from sqlalchemy import select
from app.db.models import Approval
from app.services import reminders, decision_log
from app.services.provider_adapter import TurnOutcome
from app.team.bridge import TeamBridge
from tests.team.test_collaboration import harness  # noqa: F401
from tests.services.thread_harness import sessions, owner, cleanup, wait_until  # noqa: F401


async def test_person_reminder_auto_gate_mailbox_and_private_decision_log(harness, sessions, owner, monkeypatch, tmp_path):
    rt, engine, lead, _ = harness
    thread = await rt.create_thread(agent_id=lead.id)
    text = 'remind me in 10 minutes to read the synthetic private note'
    monkeypatch.setattr(decision_log, 'log_dir', lambda: tmp_path / 'decisions')
    answers = []
    async def handler(ctx, sink, gate):
        run = rt._runs[ctx.turn_id]
        bridge = TeamBridge(rt, run)
        try:
            for index in range(2):
                args = {'text':text}
                handle = await gate.open(request_id=f'reminder-{index}', tool='mcp__team__create_reminder', input=args, summary=text, kind='tool')
                decision = await gate.decide(handle)
                assert decision.kind == 'allow'
                path = bridge.folder / f'req-{index}.working'
                path.write_text(json.dumps({'name':'create_reminder', 'arguments':args}))
                await bridge.handle(path)
                answers.append(json.loads((bridge.folder / f'resp-{index}.json').read_text()))
            return TurnOutcome('succeeded', result='Reminder saved.')
        finally:
            await bridge.close()
    engine.handlers[thread.id] = handler
    turn = await rt.send_turn(thread.id, text)
    await wait_until(lambda: turn.id not in rt._runs)
    assert len(answers) == 2 and answers[0]['id'] == answers[1]['id']
    async with sessions() as db:
        assert len(await reminders.list_all(db, owner)) == 1
        assert not list(await db.scalars(select(Approval).where(Approval.turn_id == turn.id, Approval.status == 'pending')))
    for path in (tmp_path / 'decisions').glob('*.ndjson'):
        assert 'synthetic private note' not in path.read_text()
