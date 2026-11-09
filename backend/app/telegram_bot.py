"""Owner-only Telegram alerts for the durable thread runtime.

No Boat tasks, credentials, approval modes or grants are accepted from chat.
Run with python -m app.telegram_bot after the normal database migrations.
"""
from __future__ import annotations

import asyncio
from contextlib import contextmanager
import json
import logging
import os
from pathlib import Path
import re
import time

from sqlalchemy import select
from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.error import BadRequest, Conflict, NetworkError, RetryAfter, TelegramError

from app.core import data_lease
from app.core.config import settings
from app.db.models import Agent, Approval, Notification, Thread
from app.db.models.app_setting import AppSetting
from app.db.transactions import begin_write
from app.services import thread_store, phone_access
from app.services.agent_memory import redact_secrets
from app.services.thread_runtime import runtime

logger = logging.getLogger(__name__)
from app.services.voice import VOICE_LIMIT, transcribe, voice_language  # compatibility imports


def configuration(token, owner):
    if not token and not owner:
        return None
    if not token or not str(owner).isascii() or not str(owner).isdigit() or int(owner) <= 0:
        raise ValueError("Set TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_ID together; TELEGRAM_OWNER_ID must be a positive integer.")
    return int(owner)


def split_text(text, limit=4000):
    """Plain text; bound UTF-16 units too, without splitting a Unicode scalar."""
    while text:
        units, end = 0, 0
        for ch in text:
            cost = 2 if ord(ch) > 0xffff else 1
            if units + cost > limit:
                break
            units += cost
            end += 1
        if end < len(text):
            prefix = text[:end]
            boundaries = [m.end() for m in re.finditer(r"\n\n|[.!?] (?=\S)|\n", prefix)]
            if boundaries and boundaries[-1] > end // 2:
                end = boundaries[-1]
        yield text[:end]
        text = text[end:]


def card_text(approval):
    # Redact labelled scalar values before serialization (JSON quotes obscure labels).
    def redact(value):
        if isinstance(value, dict):
            return {key: ("[REDACTED]" if re.search(r"secret|token|password|api.?key", key, re.I)
                          else redact(item)) for key, item in value.items()}
        if isinstance(value, list):
            return [redact(item) for item in value]
        return redact_secrets(value)[0] if isinstance(value, str) else value
    text = f"Tool: {approval.tool}\nExact input (secrets redacted):\n" + json.dumps(redact(approval.input), ensure_ascii=False, indent=2)
    if approval.tool in ("mcp__composio__apps_search", "mcp__composio__apps_run"):
        return redact(getattr(approval, "summary", None) or "Connected app") + "\n" + text
    first = next(split_text(text, 3600))
    return first + ("\n[Truncated. Review the full input in the app before allowing.]" if first != text else "")


@contextmanager
def poller_lock(folder):
    folder.mkdir(parents=True, exist_ok=True)
    fd = os.open(folder / 'telegram-poller.lock', os.O_CREAT | os.O_RDWR, 0o600)
    try:
        if not data_lease._try_lock(fd):
            raise RuntimeError("Another Telegram poller is already running. Stop it before starting this one.")
        yield
    finally:
        os.close(fd)


async def preferences(rt, **changes):
    """Non-secret transport cursors and owner choices; serialized with Settings."""
    key = f"telegram:{rt.owner_id}"
    async with rt.session() as db:
        await begin_write(db)
        row = await db.get(AppSetting, key, with_for_update=True)
        value = dict(row.value_json or {}) if row else {}
        if changes:
            value.update(changes)
            if row is None:
                row = AppSetting(key=key, value_json=value, version=1, updated_by=rt.owner_id)
                db.add(row)
            else:
                row.value_json = value
                row.version += 1
            await db.commit()
        return value




class TelegramChannel:
    def __init__(self, bot, rt, owner_id, *, folder=None):
        self.bot, self.rt, self.owner = bot, rt, owner_id
        self.folder = folder or settings.SQLITE_FILE.parent / 'telegram'
        self._io_lock = asyncio.Lock()
        self.sleep = asyncio.sleep

    def authorized(self, update):
        user, chat = update.effective_user, update.effective_chat
        ok = bool(user and chat and user.id == self.owner and chat.id == self.owner and chat.type == 'private')
        if not ok:
            logger.info('telegram_update_ignored')
        return ok

    async def send(self, text, **kwargs):
        result = None
        parts = list(split_text(text))
        for index, part in enumerate(parts):
            options = dict(kwargs)
            if index != len(parts) - 1:
                options.pop("reply_markup", None)
            result = await self.bot.send_message(chat_id=self.owner, text=part, parse_mode=None, **options)
        return result

    async def callback(self, query):
        data = query.data or ''
        match = re.fullmatch(r'ap:([0-9a-f]{32}):(allow|deny)', data)
        if not match:
            await query.answer('This button is stale or invalid.')
            return
        approval_id, decision = match.groups()
        prefs = await preferences(self.rt)
        card = prefs.get('cards', {}).get(approval_id)
        if not card or card.get('owner_id') != self.owner or card['message_id'] != query.message.message_id:
            await query.answer('This request is stale or expired.')
            return
        async with self.rt.session() as db:
            approval = await db.get(Approval, approval_id)
            thread = await db.get(Thread, approval.thread_id) if approval else None
        if thread is None or thread.owner_id != self.rt.owner_id or not await self.rt.answer_approval(approval_id, decision):
            await query.answer('This request is stale, expired or already answered.')
        else:
            await query.answer(('Continuing.' if decision == 'allow' else 'Cancelled.') if approval.kind == 'handoff' else ('Allowed.' if decision == 'allow' else 'Denied.'))
        await self.sync_cards()

    async def handle(self, update):
        if not self.authorized(update):
            return
        async with self._io_lock:
            if update.callback_query:
                await self.callback(update.callback_query)
                return
            if update.effective_message is None:
                return
            # Persist before sending: restart/retry cannot produce a flood of replies.
            prefs = await preferences(self.rt)
            now = time.time()
            if now - prefs.get('app_reply_at', 0) < 60:
                return
            await preferences(self.rt, app_reply_at=now)
            link = phone_access.chat_link()
            await self.send('Chat happens in the app.' + (f' Open: {link}' if link else ' Open the website on your computer.'))

    def open_buttons(self, thread_id):
        link = phone_access.chat_link(thread_id)
        return [[InlineKeyboardButton('Open', url=link)]] if link else []

    async def sync_cards(self):
        prefs = await preferences(self.rt)
        cards = dict(prefs.get('cards', {}))
        for approval_id, card in list(cards.items()):
            async with self.rt.session() as db:
                approval = await db.get(Approval, approval_id)
            status = approval.status if approval else 'expired'
            if status != 'pending':
                final = True
                text = ('Hand-off ' + {'allowed': 'continued', 'denied': 'cancelled', 'expired': 'timed out'}.get(status, status) + '.' if approval and approval.kind == 'handoff' else 'Approval ' + status + '.')
                if approval and status == 'allowed' and approval.tool.startswith('mcp__composio__'):
                    from app.services.composio_bridge import is_action
                    name = approval.tool.removeprefix('mcp__composio__')
                    if name == 'apps_run' or is_action(name, approval.input):
                        from app.db.models import Event, Turn
                        from app.services.action_outcomes import MESSAGES
                        async with self.rt.session() as db:
                            events = list(await db.scalars(select(Event).where(Event.turn_id == approval.turn_id, Event.type == 'app.action_result').order_by(Event.seq.desc())))
                            turn = await db.get(Turn, approval.turn_id)
                        result = next((e.data for e in events if e.data.get('approval_id') == approval.id), None)
                        if result:
                            text = MESSAGES.get(result.get('outcome'), MESSAGES['unknown'])
                        elif turn and turn.status == 'running':
                            text, final = 'Approved; awaiting provider confirmation. Outcome not established.', False
                        else:
                            text = MESSAGES['unknown'] if approval.consumed_at else 'Failed: the approved request was not dispatched.'
                buttons = self.open_buttons(approval.thread_id) if approval else []
                try:
                    await self.bot.edit_message_text(chat_id=self.owner, message_id=card['message_id'],
                                                     text=text, reply_markup=InlineKeyboardMarkup(buttons) if buttons else None, parse_mode=None)
                except BadRequest as exc:
                    # An acknowledged edit may have preceded a crash before cursor commit.
                    if not any(reason in str(exc).lower() for reason in ('message is not modified', 'message to edit not found')):
                        raise
                if final:
                    del cards[approval_id]
        await preferences(self.rt, cards=cards)

    async def flush(self):
        """Deliver durable notices and pending cards without any inbound chat flow."""
        async with self._io_lock:
            await self.rt.sweep_stale()
            prefs = await preferences(self.rt)
            async with self.rt.session() as db:
                threads = list(await db.scalars(select(Thread).join(Approval, Approval.thread_id == Thread.id).where(
                    Thread.owner_id == self.rt.owner_id, Approval.status == 'pending').distinct()))
                notices = list(await db.scalars(select(Notification).where(Notification.owner_id == self.rt.owner_id,
                    Notification.id > prefs.get('notice_cursor', 0)).order_by(Notification.id)))
            routine_notify = bool(settings.ROUTINE_TELEGRAM_CHAT_ID) and settings.ROUTINE_TELEGRAM_CHAT_ID == str(self.owner)
            from app.services.quiet_notifications import visible
            from app.services.alert_privacy import redact_alert
            async with self.rt.session() as db:
                visible_ids = {notice.id for notice in await visible(db, self.rt.owner_id, notices)}
            for notice in notices:
                allowed = notice.kind in ('reminder', 'daily_brief', 'inbox_urgent', 'quiet_summary') or (
                    routine_notify and notice.kind == 'needs_input')
                if notice.id in visible_ids and allowed:
                    buttons = self.open_buttons(notice.thread_id)
                    await self.send(redact_alert(notice.title + ('\n\n' + notice.body if notice.body else ''), 3500),
                                    reply_markup=InlineKeyboardMarkup(buttons) if buttons else None)
                await preferences(self.rt, notice_cursor=notice.id)
            for thread in threads:
                async with self.rt.session() as db:
                    approvals = await thread_store.list_approvals(db, thread.id, status='pending')
                    agent = await db.get(Agent, thread.agent_id) if thread.agent_id else None
                for approval in approvals:
                    prefs = await preferences(self.rt)
                    cards = dict(prefs.get('cards', {}))
                    if approval.id in cards:
                        continue
                    handoff = approval.kind == 'handoff'
                    text = (redact_alert(agent.name, 80) + ' needs your approval\n' if agent else '') + card_text(approval)
                    if handoff:
                        text = ('Computer waiting for you: ' + redact_alert(approval.summary or '', 2000)
                                + '\nOpen the app to take control. Continue when ready, or cancel this hand-off.')
                    buttons = [[
                        InlineKeyboardButton('Continue' if handoff else 'Allow', callback_data=f'ap:{approval.id}:allow'),
                        InlineKeyboardButton('Cancel' if handoff else 'Deny', callback_data=f'ap:{approval.id}:deny')]]
                    buttons += self.open_buttons(thread.id)
                    message = await self.send(text, reply_markup=InlineKeyboardMarkup(buttons))
                    cards[approval.id] = {'message_id': message.message_id, 'owner_id': self.owner}
                    await preferences(self.rt, cards=cards)
            await self.sync_cards()


async def poll(channel, *, sleep=asyncio.sleep):
    """Bounded retries; a committed update offset prevents prompt replay."""
    backoff = 1
    while True:
        try:
            prefs = await preferences(channel.rt)
            updates = await channel.bot.get_updates(offset=prefs.get('offset', 0), timeout=2,
                                                    allowed_updates=['message', 'callback_query'])
            for update in updates:
                await preferences(channel.rt, offset=update.update_id + 1)
                await channel.handle(update)
            await channel.flush()
            backoff = 1
        except Conflict:
            raise RuntimeError('Another Telegram poller is using this bot token. Stop it first.') from None
        except (NetworkError, RetryAfter):
            logger.warning('telegram_network_retry')
            await sleep(backoff)
            backoff = min(30, backoff * 2)
        except TelegramError:
            logger.error('telegram_delivery_failed')
            await sleep(5)


def configure_channel_logging():
    # Runtime failures can include SQL parameters in exception tracebacks. The
    # standalone phone worker emits fixed event names; details stay in the app.
    import structlog
    logger.setLevel(logging.INFO)
    structlog.configure(
        processors=[lambda logger, method, event: {"event": "telegram_runtime_" + method},
                    structlog.processors.JSONRenderer()],
        wrapper_class=structlog.make_filtering_bound_logger(logging.WARNING),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=False,
    )
    for name in ('httpx', 'httpcore', 'telegram'):
        logging.getLogger(name).setLevel(logging.CRITICAL)


async def run():
    owner = configuration(settings.TELEGRAM_BOT_TOKEN, settings.TELEGRAM_OWNER_ID)
    if owner is None:
        return
    folder = settings.SQLITE_FILE.parent / 'telegram'
    configure_channel_logging()
    with poller_lock(folder):
        bot = Bot(settings.TELEGRAM_BOT_TOKEN)
        backoff = 1
        try:
            while True:
                try:
                    await bot.initialize()
                    break
                except (NetworkError, RetryAfter):
                    logger.warning('telegram_network_retry')
                    await asyncio.sleep(backoff)
                    backoff = min(30, backoff * 2)
            await poll(TelegramChannel(bot, runtime, owner, folder=folder))
        finally:
            await runtime.shutdown()
            await bot.shutdown()


TIME_RE = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
# JS-style weekday numbering (Sunday = 0), matching the web UI's schedule form.
WEEKDAY_CODES = {"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}

SCHEDULE_USAGE = (
    "Usage:\n"
    "/schedule hourly <prompt>\n"
    "/schedule daily HH:MM <prompt>\n"
    "/schedule weekdays HH:MM <prompt>\n"
    "/schedule weekly <mon|tue|wed|thu|fri|sat|sun> HH:MM <prompt>\n\n"
    "Times are UTC. Example: /schedule daily 08:00 Generate my daily report"
)


def _parse_schedule_args(args: list[str]) -> tuple[str, str]:
    """Turns the words after /schedule into (cron_expression, prompt_text).
    Raises ValueError with a user-facing message on anything malformed."""
    if not args:
        raise ValueError(SCHEDULE_USAGE)

    frequency, rest = args[0].lower(), args[1:]

    if frequency == "hourly":
        if not rest:
            raise ValueError(SCHEDULE_USAGE)
        return "0 * * * *", " ".join(rest)

    if frequency in ("daily", "weekdays"):
        if len(rest) < 2 or not TIME_RE.match(rest[0]):
            raise ValueError(SCHEDULE_USAGE)
        hour, minute = map(int, rest[0].split(":"))
        cron = f"{minute} {hour} * * *" if frequency == "daily" else f"{minute} {hour} * * 1-5"
        return cron, " ".join(rest[1:])

    if frequency == "weekly":
        if len(rest) < 3 or rest[0].lower() not in WEEKDAY_CODES or not TIME_RE.match(rest[1]):
            raise ValueError(SCHEDULE_USAGE)
        weekday = WEEKDAY_CODES[rest[0].lower()]
        hour, minute = map(int, rest[1].split(":"))
        return f"{minute} {hour} * * {weekday}", " ".join(rest[2:])

    raise ValueError(SCHEDULE_USAGE)



# Legacy Boat result helpers. The owner channel above never invokes these.
from app.db.session import AsyncSessionLocal
from app.db.transactions import release_snapshot
from app.services import task_execution_service, schedule_service, user_sandbox_service
from telegram.constants import MessageLimit
from telegram import Update
from telegram.ext import ContextTypes
DEFAULT_TTL_SECONDS = 1800
async def _get_or_create_sandbox(user_id: str) -> str:
    async with AsyncSessionLocal() as db:
        _, box = await user_sandbox_service.ensure(
            db, user_id=user_id, ttl_seconds=DEFAULT_TTL_SECONDS
        )
        return box.id


POLL_INTERVAL_SECONDS = 3
POLL_ATTEMPTS = task_execution_service.MAX_TASK_SECONDS // POLL_INTERVAL_SECONDS + 1

async def _poll_task(bot, chat_id: int, task_id: int) -> None:
    async with AsyncSessionLocal() as db:
        task = await task_execution_service.get_task(db, task_id)
        for _ in range(POLL_ATTEMPTS):
            if task is None or task.status not in task_execution_service.ACTIVE_STATUSES:
                break
            await release_snapshot(db)  # do not hold a snapshot while waiting
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            task = await task_execution_service.sync_task_status(db, task)

    if task is None:
        message = "Task disappeared unexpectedly."
    elif task.status == "succeeded":
        message = task.result or "Task completed."
    elif task.status in task_execution_service.ACTIVE_STATUSES:
        message = f"Task #{task.id} is still {task.status}. Check its status in the web UI."
    else:
        message = f"Task failed: {task.error}"

    # Reports and CLI errors can exceed Telegram's per-message text limit.
    # Send every part in order rather than losing the entire completion.
    for start in range(0, len(message), MessageLimit.MAX_TEXT_LENGTH):
        await bot.send_message(
            chat_id=chat_id, text=message[start:start + MessageLimit.MAX_TEXT_LENGTH]
        )



async def schedules_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user_id = str(update.effective_user.id)
    async with AsyncSessionLocal() as db:
        schedules = await schedule_service.list_schedules(db, user_id)

    if not schedules:
        await update.message.reply_text("You have no schedules. Create one with /schedule.")
        return

    lines = []
    for s in schedules:
        if s.paused_reason:
            status = f"paused — {s.paused_reason}"
        elif not s.is_active:
            status = "paused"
        else:
            status = f"next run {s.next_run_at.strftime('%Y-%m-%d %H:%M UTC')}"
        lines.append(f"#{s.id} [{s.cron_expression}] {s.prompt_text[:60]} — {status}")

    message = "\n".join(lines)
    for start in range(0, len(message), MessageLimit.MAX_TEXT_LENGTH):
        await update.message.reply_text(message[start:start + MessageLimit.MAX_TEXT_LENGTH])



if __name__ == '__main__':
    logging.basicConfig(level=logging.WARNING)
    asyncio.run(run())
