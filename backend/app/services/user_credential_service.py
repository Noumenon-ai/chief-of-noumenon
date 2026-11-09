from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import crypto
from app.db.models.user_credential import UserCredential
from app.db.transactions import begin_write, release_snapshot
from app.services.box_operations import ascii_box_service


async def _get_row(
    db: AsyncSession, user_id: str, provider: str
) -> UserCredential | None:
    result = await db.execute(
        select(UserCredential).where(
            UserCredential.user_id == user_id,
            UserCredential.provider == provider,
        )
    )
    return result.scalar_one_or_none()


async def save_token(
    db: AsyncSession,
    *,
    user_id: str,
    provider: str,
    file_path: str,
    plaintext: str,
) -> UserCredential:
    if provider == "claude":
        raise ValueError("Claude credentials are managed only by the official CLI. Sign in in its terminal flow.")
    ciphertext = crypto.encrypt(plaintext)

    await begin_write(db)  # read-then-write: lock first so two saves cannot interleave
    record = await _get_row(db, user_id, provider)
    if record is None:
        record = UserCredential(
            user_id=user_id,
            provider=provider,
            file_path=file_path,
            ciphertext=ciphertext,
        )
        db.add(record)
    else:
        record.file_path = file_path
        record.ciphertext = ciphertext

    await db.commit()
    await db.refresh(record)
    return record


async def get_decrypted(
    db: AsyncSession, user_id: str, provider: str
) -> tuple[str, str] | None:
    if provider == "claude":
        return None  # Never decrypt or copy credentials saved by the removed sign-in flow.
    record = await _get_row(db, user_id, provider)
    if record is None:
        return None

    decrypted = crypto.decrypt(record.ciphertext), record.file_path
    # Every caller goes on to talk to a sandbox; do not hold a snapshot meanwhile.
    await release_snapshot(db)
    return decrypted


class CredentialNotFoundError(Exception):
    pass


async def inject_credential_into_box(
    db: AsyncSession, *, box_id: str, user_id: str, provider: str
) -> None:
    decrypted = await get_decrypted(db, user_id, provider)
    if decrypted is None:
        raise CredentialNotFoundError(
            f"No credential found for user {user_id} and provider {provider}"
        )

    plaintext, file_path = decrypted
    
    await run_in_threadpool(ascii_box_service.write_file, box_id, file_path, plaintext)
