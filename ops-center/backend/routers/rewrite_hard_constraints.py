"""Rewrite hard constraints API — 改写硬约束管理（多版本，唯一默认，admin）。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import get_current_user, require_admin
from services import rewrite_hard_constraint_service

router = APIRouter(prefix="/api/v1/rewrite-hard-constraints", tags=["rewrite-hard-constraints"])


@router.get("")
async def list_constraints(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    items = await rewrite_hard_constraint_service.list_constraints(db)
    return {"items": items, "count": len(items)}


@router.get("/runtime")
async def get_runtime_default(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """运行时默认版本；鉴权同本资源列表端点（``get_current_user``）。

    本条曾以「供 bootstrap 内部组装使用」为由免鉴权，2026-10-16 收紧。失效证据、设计决策
    与残留**单一真源**在 ``openspec/records/harden-runtime-endpoints-auth.md``（勿在此复制背景
    叙述，避免多源漂移）；契约锁见 ``tests/test_runtime_endpoints_require_auth.py``。
    """
    item = await rewrite_hard_constraint_service.get_default_runtime(db)
    return {"item": item}


@router.post("")
async def create_constraint(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    item, err = await rewrite_hard_constraint_service.create_constraint(db, body, user.get("username", "unknown"))
    if err:
        raise HTTPException(409 if "已存在" in err else 400, err)
    return item


@router.put("/{constraint_id}")
async def update_constraint(
    constraint_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    item, err = await rewrite_hard_constraint_service.update_constraint(db, constraint_id, body, user.get("username", "unknown"))
    if err:
        raise HTTPException(404 if "不存在" in err else 400, err)
    return item


@router.delete("/{constraint_id}")
async def delete_constraint(
    constraint_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    ok, err = await rewrite_hard_constraint_service.delete_constraint(db, constraint_id, user.get("username", "unknown"))
    if not ok:
        raise HTTPException(404 if "不存在" in err else 400, err)
    return {"ok": True}


@router.post("/{constraint_id}/set-default")
async def set_default(
    constraint_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    item, err = await rewrite_hard_constraint_service.set_default(db, constraint_id, user.get("username", "unknown"))
    if err:
        raise HTTPException(404 if "不存在" in err else 400, err)
    return item
