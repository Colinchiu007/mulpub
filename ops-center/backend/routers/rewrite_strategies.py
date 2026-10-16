"""Rewrite strategies API — 改写策略模板管理（admin）。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import get_current_user, require_admin
from services import rewrite_strategy_service

router = APIRouter(prefix="/api/v1/rewrite-strategies", tags=["rewrite-strategies"])


@router.get("")
async def list_strategies(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    items = await rewrite_strategy_service.list_rewrite_strategies(db)
    return {"items": items, "count": len(items)}


@router.get("/runtime")
async def list_runtime_strategies(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """运行时策略全量（含未启用项）；鉴权同本资源列表端点（``get_current_user``）。

    本条曾以「供 bootstrap 内部组装使用」为由免鉴权，2026-10-16 收紧。失效证据、设计决策
    与残留**单一真源**在 ``openspec/records/harden-runtime-endpoints-auth.md``（勿在此复制背景
    叙述，避免多源漂移）；契约锁见 ``tests/test_runtime_endpoints_require_auth.py``。
    """
    items = await rewrite_strategy_service.list_runtime_rewrite_strategies(db)
    return {"items": items, "count": len(items)}


@router.post("")
async def create_strategy(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    try:
        return await rewrite_strategy_service.create_rewrite_strategy(db, body, user.get("username", "unknown"))
    except rewrite_strategy_service.RewriteStrategyExists as e:
        raise HTTPException(409, str(e))
    except rewrite_strategy_service.RewriteStrategyError as e:
        raise HTTPException(400, str(e))


@router.put("/{strategy_id}")
async def update_strategy(
    strategy_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    try:
        return await rewrite_strategy_service.update_rewrite_strategy(db, strategy_id, body, user.get("username", "unknown"))
    except KeyError:
        raise HTTPException(404, "策略不存在")
    except rewrite_strategy_service.RewriteStrategyError as e:
        raise HTTPException(400, str(e))


@router.delete("/{strategy_id}")
async def delete_strategy(
    strategy_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    ok = await rewrite_strategy_service.delete_rewrite_strategy(db, strategy_id)
    if not ok:
        raise HTTPException(404, "策略不存在")
    return {"ok": True}


@router.post("/{strategy_id}/toggle")
async def toggle_strategy(
    strategy_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    try:
        enabled = bool(body.get("enabled", True))
        return await rewrite_strategy_service.toggle_rewrite_strategy(db, strategy_id, enabled, user.get("username", "unknown"))
    except KeyError:
        raise HTTPException(404, "策略不存在")
