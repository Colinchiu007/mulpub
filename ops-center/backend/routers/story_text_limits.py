"""字数控制 API（2026-10-18）— 视频创作「故事讲述」文案字数上限与预警阈值。

- 管理接口：GET 走登录鉴权；写操作（PUT / POST reset）走 require_admin
- 下发接口：GET /api/v1/runtime/bootstrap（Ed25519 签名，见 routers/runtime.py）

响应形状（运营中心前端按此渲染）::

    {
      "items": [{"scope": "story2video", "label": "故事讲述", "max_chars": 10000,
                 "warn_percent": 90, "enabled": true, "note": "",
                 "updated_at": "...", "updated_by": "admin"}],
      "count": 1,
      "defaults": {"max_chars": 10000, "warn_percent": 90},
      "ranges": {"max_chars": {"min": 1000, "max": 50000},
                 "warn_percent": {"min": 50, "max": 99}, "note_max_len": 200}
    }

``defaults`` / ``ranges`` 直接取自服务层常量，前端据此渲染「默认 10000 字 / 90%」
与逐字段区间校验，避免把同一组数字在前端再抄一份（抄的那份必然先漂移）。
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import get_current_user, require_admin
from services import story_text_limit_service

router = APIRouter(prefix="/api/v1/story-text-limits", tags=["story-text-limits"])


def _envelope(items: list[dict]) -> dict:
    """统一响应外壳：items + 默认值 + 合法区间（单一真源在服务层常量）。"""
    return {
        "items": items,
        "count": len(items),
        "defaults": {
            "max_chars": story_text_limit_service.DEFAULT_MAX_CHARS,
            "warn_percent": story_text_limit_service.DEFAULT_WARN_PERCENT,
        },
        "ranges": {
            "max_chars": {
                "min": story_text_limit_service.MIN_MAX_CHARS,
                "max": story_text_limit_service.MAX_MAX_CHARS,
            },
            "warn_percent": {
                "min": story_text_limit_service.MIN_WARN_PERCENT,
                "max": story_text_limit_service.MAX_WARN_PERCENT,
            },
            "note_max_len": story_text_limit_service.MAX_NOTE_LEN,
        },
    }


@router.get("")
async def list_story_text_limits(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """列出可配置作用域（目录欠账在此补齐，运营者无需手工新增）。"""
    return _envelope(await story_text_limit_service.list_scopes(db))


@router.put("")
async def upsert_story_text_limits(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """批量保存；任一条非法即整体 400（不做部分写入）。"""
    try:
        items = body.get("items", [])
        if not isinstance(items, list):
            raise HTTPException(400, "items must be a list")
        result = await story_text_limit_service.upsert_scopes(
            db, items, updated_by=user.get("username", "")
        )
        return _envelope(result)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/reset")
async def reset_story_text_limits(
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """恢复目录默认（10000 字 / 90% / 启用）；body 可带 ``{"scope": "story2video"}`` 只重置单项。"""
    scope = str((body or {}).get("scope") or "").strip() or None
    try:
        items = await story_text_limit_service.reset_scopes(
            db, updated_by=user.get("username", ""), scope=scope
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except KeyError:
        raise HTTPException(404, f"作用域不存在: {scope}")
    return _envelope(items)
