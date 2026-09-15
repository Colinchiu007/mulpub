"""应用菜单配置 API（2026-09-15）— 应用端左侧边栏菜单的显示/隐藏与排序。

- 管理接口：GET 走登录鉴权（与既有 pipeline-options 同口径），写操作走 require_admin
- 下发接口：GET /api/v1/runtime/bootstrap（X-Catalog-Key 鉴权 + Ed25519 签名，见 routers/runtime.py）
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import get_current_user, require_admin
from services import app_menu_service

router = APIRouter(prefix="/api/v1/app-menu", tags=["app-menu"])


@router.get("")
async def list_app_menu(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    items = await app_menu_service.list_items(db)
    return {
        "items": items,
        "count": len(items),
        # 前端据此对强制显示项的开关做灰显；服务端仍会二次强制纠正
        "forced_visible_keys": list(app_menu_service.FORCED_VISIBLE_KEYS),
        "max_items": app_menu_service.MAX_MENU_ITEMS,
    }


@router.put("")
async def upsert_app_menu(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    try:
        items = body.get("items", [])
        result = await app_menu_service.upsert_items(
            db, items, updated_by=user.get("username", "")
        )
        return {**result, "count": len(result["items"])}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/reset")
async def reset_app_menu(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    result = await app_menu_service.reset_items(db, updated_by=user.get("username", ""))
    return {**result, "count": len(result["items"])}
