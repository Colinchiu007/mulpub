"""Diagnostics API — 桌面端失败诊断上报 + 运营看板汇总/样本查询。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import require_admin, require_catalog_key
from services import diagnostics_service

router = APIRouter(tags=["diagnostics"])


@router.post("/api/v1/diagnostics/ingest")
async def ingest_diagnostics(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _key: None = Depends(require_catalog_key),
):
    """桌面端脱敏诊断上报（X-Catalog-Key 鉴权，无需登录）。

    2026-10-15：鉴权由函数体内的 `_require_catalog_key(request)` 改为依赖声明
    `Depends(require_catalog_key)`（唯一实现见 `middleware/auth.py`），
    使 `route.dependant` 反射即可读到本端点的鉴权要求。
    """
    try:
        return await diagnostics_service.ingest_diagnostics(db, body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/api/v1/diagnostics/summary")
async def get_diagnostics_summary(
    days: int = Query(30, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await diagnostics_service.diagnostics_summary(db, days=days)


@router.get("/api/v1/diagnostics/samples")
async def get_diagnostics_samples(
    days: int = Query(30, ge=1, le=90),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    stage: str = "",
    failure_type: str = "",
    cause_id: str = "",
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await diagnostics_service.list_diagnostics_samples(
        db, days=days, limit=limit, offset=offset, stage=stage, failure_type=failure_type, cause_id=cause_id
    )
