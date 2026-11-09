"""User profile endpoints (display name, avatar, bio, email)."""

from typing import Optional
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.auth.middleware import principal_of
from app.services import user_profile
from app.services.local_access_policy import require_local_access

router = APIRouter(prefix="/profile", tags=["Profile"], dependencies=[Depends(require_local_access)])


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, max_length=120)
    avatar_url: Optional[str] = Field(default=None, max_length=1_000_000)  # Support data URLs or http URLs
    bio: Optional[str] = Field(default=None, max_length=500)


@router.get("")
async def get_profile(request: Request):
    """Read only the display identity chosen by this person."""
    saved = user_profile.read_profile()

    principal = principal_of(request.scope)
    user_id = str(principal.session_id) if (principal and principal.session_id) else (principal.label if principal and principal.label else "local")
    is_admin = principal.is_admin if principal else True

    return {
        "name": saved.get("name") or "You",
        "avatar_url": saved.get("avatar_url"),
        "bio": saved.get("bio"),
        "email": None,
        "user_id": user_id,
        "is_admin": is_admin,
        "updated_at": saved.get("updated_at"),
    }


@router.put("")
async def update_profile(data: ProfileUpdate, request: Request):
    """Update profile display name, avatar, and/or bio."""
    saved = user_profile.write_profile(
        name=data.name,
        avatar_url=data.avatar_url,
        bio=data.bio,
    )
    return {
        "ok": True,
        **saved,
    }
