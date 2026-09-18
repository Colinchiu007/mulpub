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
):
    """运行时默认版本（免鉴权，供 bootstrap 内部组装使用）。"""
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
