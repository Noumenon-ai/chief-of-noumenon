"""Card authority and persistence, with an isolated database and no engine turns."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from sqlalchemy import select
from app.db.models import Agent, AppSetting, Event, Routine, Team, Thread, Turn
from app.services import chat_cards, thread_store as store, connector_service
from app.services.chat_card_schema import definitions
from tests.services.test_chief_day import sessions  # noqa: F401


@pytest.fixture
async def rt(sessions, tmp_path):
    async with sessions() as db:
        agent = Agent(owner_id='owner', name='Chief', provider='claude', workspace_path=str(tmp_path))
        db.add(agent); await db.flush()
        db.add(Team(owner_id='owner', name='Team', lead_agent_id=agent.id)); await db.commit()
    runtime = SimpleNamespace(session=sessions, owner_id='owner', hub=SimpleNamespace(notify=lambda _: None), agent=agent)
    async def create_thread(*, agent_id, db=None):
        assert db is not None
        return await store.create_thread(db, owner_id='owner', provider='claude', agent_id=agent_id, workspace_path=str(tmp_path), commit=False)
    async def send(thread_id, prompt, **kwargs):
        async with sessions() as db:
            return await store.start_turn(db, thread_id, prompt, card_answer=kwargs.get('card_answer'))
    runtime.create_thread = create_thread
    runtime.send_turn = AsyncMock(side_effect=send)
    return runtime


async def new_card(rt, kind='question', **extra):
    async with rt.session() as db:
        thread = await store.create_thread(db, owner_id=rt.owner_id, provider='claude', agent_id=rt.agent.id, workspace_path=rt.agent.workspace_path)
        card = await chat_cards.add(db, thread.id, {'kind': kind, **({'question': 'Which?', 'options': ['First', 'Second']} if kind == 'question' else {}), **extra})
        await db.commit()
    return thread, card


@pytest.mark.parametrize('choice', [0, 1, 2, -1])
async def test_first_greeting_once_and_no_engine(rt, choice, monkeypatch):
    monkeypatch.setattr(chat_cards, 'provider', AsyncMock(return_value={'service': 'gmail'}))
    first = await chat_cards.welcome(rt)
    assert first['thread_id']
    async with rt.session() as db:
        events = await store.list_all_events(db, first['thread_id'])
        assert len(events) == 1 and events[0].data['kind'] == 'welcome'
        assert list(await db.scalars(select(Routine))) == []
    await chat_cards.respond(rt, first['thread_id'], events[0].data['id'], choice, admin=True)
    assert await chat_cards.welcome(rt) == {'thread_id': None}
    rt.send_turn.assert_not_called()
    async with rt.session() as db:
        assert list(await db.scalars(select(Turn))) == []
        assert list(await db.scalars(select(Routine))) == []
        cards = [e for e in await store.list_all_events(db, first['thread_id']) if e.type == 'chat.card']
        assert sum(c.data['kind'] == 'welcome' for c in cards) == 1


async def test_existing_install_never_gets_greeting_even_after_deleting_chat(rt):
    thread, _ = await new_card(rt)
    assert await chat_cards.welcome(rt) == {'thread_id': None}
    async with rt.session() as db:
        await store.delete_thread(db, thread.id)
    assert await chat_cards.welcome(rt) == {'thread_id': None}


async def test_question_answers_once_and_is_a_person_reply(rt):
    thread, card = await new_card(rt, options=['<img src=x onerror=alert(1)>', '[approve](https://evil.test)'])
    results = await asyncio.gather(*(chat_cards.respond(rt, thread.id, card['id'], 0) for _ in range(2)), return_exceptions=True)
    assert sum(isinstance(r, ValueError) for r in results) == 1
    rt.send_turn.assert_awaited_once()
    async with rt.session() as db:
        turns = list(await db.scalars(select(Turn)))
        assert len(turns) == 1 and turns[0].prompt_text == card['options'][0]
        assert sum(e.type == 'chat.card.answered' for e in await store.list_all_events(db, thread.id)) == 1


async def test_typed_answer_collapses_question_but_not_approval(rt):
    thread, card = await new_card(rt)
    async with rt.session() as db:
        await store.append_event(db, thread.id, 'approval.requested', {'approval_id': 'separate', 'status': 'pending'})
        await store.start_turn(db, thread.id, 'My own answer')
        events = await store.list_all_events(db, thread.id)
        assert next(e.data for e in events if e.type == 'chat.card.answered') == {'id': card['id'], 'answer': 'My own answer'}
        assert not any(e.type == 'approval.resolved' for e in events)


@pytest.mark.parametrize('choice', [0, 1])
async def test_brief_only_enabled_after_person_tap_in_their_timezone(rt, choice):
    thread, card = await new_card(rt, 'brief')
    async with rt.session() as db:
        assert list(await db.scalars(select(Routine))) == []
    with pytest.raises(PermissionError):
        await chat_cards.respond(rt, thread.id, card['id'], choice, timezone='Asia/Jerusalem')
    await chat_cards.respond(rt, thread.id, card['id'], choice, timezone='Asia/Jerusalem', admin=True)
    async with rt.session() as db:
        active = list(await db.scalars(select(Routine).where(Routine.paused.is_(False))))
        assert len(active) == (1 if choice == 0 else 0)
        if active:
            assert active[0].timezone == 'Asia/Jerusalem'
            assert active[0].schedule_spec['time'] == '08:00'
            assert active[0].approval_mode == 'plan' and not active[0].uninterrupted_access
    with pytest.raises(ValueError):
        await chat_cards.respond(rt, thread.id, card['id'], choice, timezone='Asia/Jerusalem', admin=True)


async def test_suggestion_grants_nothing_and_offer_is_once(rt, monkeypatch):
    thread, _ = await new_card(rt)
    monkeypatch.setattr(chat_cards, 'provider', AsyncMock(return_value={'service': 'gmail', 'displayName': 'Gmail'}))
    emit = AsyncMock(return_value=True)
    run = SimpleNamespace(thread_id=thread.id, agent_id=rt.agent.id, ctx=SimpleNamespace(aborted=False, draft_only=False, media_review_only=False, chat_cards_allowed=True), recorder=SimpleNamespace(emit=emit))
    async with rt.session() as db:
        before = await connector_service.grants(db, rt.owner_id, rt.agent.id)
    await chat_cards.suggest(rt, run, 'suggest_connect', {'provider': 'gmail'})
    async with rt.session() as db:
        assert await connector_service.grants(db, rt.owner_id, rt.agent.id) == before == {}
    assert (await chat_cards.suggest(rt, run, 'offer_daily_brief', {}))['shown']
    assert not (await chat_cards.suggest(rt, run, 'offer_daily_brief', {}))['shown']
    assert emit.await_count == 2


@pytest.mark.parametrize('identifier', ['unknown', '../gmail', 'Gmail', '<img>', 'gmail'])
async def test_unknown_blocked_untrusted_provider_refused(rt, monkeypatch, identifier):
    class Catalog:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def request(self, *args): return [{'service': 'known'}]
    monkeypatch.setattr(connector_service, 'client', AsyncMock(return_value=Catalog()))
    if identifier == 'gmail': monkeypatch.setenv('CONNECTOR_BLOCKED_PROVIDERS', 'gmail')
    async with rt.session() as db:
        with pytest.raises(ValueError): await chat_cards.provider(db, rt.owner_id, identifier)


@pytest.mark.parametrize('args', [{'question': 'Choose', 'options': ['a']}, {'question': 'Choose', 'options': ['a'] * 6}, {'question': 'GOCSPX-' + 'a' * 24, 'options': ['a', 'b']}, {'question': 'Choose', 'options': ['a','b'], 'clientSecret': 'private'}])
def test_question_schema_rejects_credentials_and_bad_choices(args):
    with pytest.raises(ValueError): chat_cards.validate('ask_question', args)


def test_cli_and_local_mcp_share_card_definitions(tmp_path):
    from app.team.mcp_server import Server
    assert Server(tmp_path, cards_only=True).tools == definitions()
    assert {'ask_question', 'suggest_connect', 'offer_daily_brief'} <= {d['name'] for d in Server(tmp_path).tools}


async def test_explicit_connect_request_is_local_catalog_only_and_grants_nothing(rt, monkeypatch):
    thread, _ = await new_card(rt)
    monkeypatch.setattr(chat_cards, 'provider', AsyncMock(return_value={'service': 'gmail', 'displayName': 'Gmail'}))
    await chat_cards.request_connect(rt, thread.id, 'gmail')
    rt.send_turn.assert_not_called()
    async with rt.session() as db:
        assert await connector_service.grants(db, rt.owner_id, rt.agent.id) == {}
        events = await store.list_all_events(db, thread.id)
        assert events[-2].data == {'text': 'Connect Gmail'}
        assert events[-1].data['kind'] == 'connect'


def test_card_credential_input_is_redacted_before_durable_events_or_logs():
    from app.computers.native import durable_input
    secret = 'GOCSPX-' + 'a' * 24
    for name in ('ask_question', 'suggest_connect', 'offer_daily_brief'):
        safe = durable_input('mcp__team__' + name, {'question': secret, 'clientSecret': 'private-client-value'})
        assert secret not in json.dumps(safe)
        assert 'private-client-value' not in json.dumps(safe)


async def test_greeting_for_first_helper_without_silently_creating_a_team(rt):
    async with rt.session() as db:
        team = await db.scalar(select(Team).where(Team.owner_id == rt.owner_id))
        await db.delete(team); await db.commit()
    first = await chat_cards.welcome(rt)
    assert first['thread_id']
    async with rt.session() as db:
        assert await db.scalar(select(Team).where(Team.owner_id == rt.owner_id)) is None
        assert (await store.list_all_events(db, first['thread_id']))[0].data['name'] == rt.agent.name
    rt.send_turn.assert_not_called()
