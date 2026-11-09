from telegram import Bot
from telegram.error import TelegramError

from app.core.config import settings
from app.core.logging import get_logger
from app.db.models.permission_ask import PermissionAsk

logger = get_logger(__name__)


def telegram_chat_id(user_id: str) -> int | None:
    """Telegram-linked users are identified by their Telegram user id, which
    doubles as their private chat id. Web-only users (e.g. "web_...") have no
    chat to message."""
    return int(user_id) if user_id.isdigit() else None


async def send_telegram_message(chat_id: int, text: str) -> bool:
    if not settings.TELEGRAM_BOT_TOKEN or str(chat_id) != settings.TELEGRAM_OWNER_ID:
        return False
    try:
        async with Bot(token=settings.TELEGRAM_BOT_TOKEN) as bot:
            await bot.send_message(chat_id=chat_id, text=text)
        return True
    except TelegramError:
        logger.warning("telegram_delivery_failed")
        return False


async def send_permission_ask(chat_id: int, ask: PermissionAsk) -> bool:
    """Legacy Boat approvals stay in the app; the owner channel sends runtime cards."""
    return False
