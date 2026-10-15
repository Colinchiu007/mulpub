"""Model usage API — 桌面端用量上报 + 运营看板汇总。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import require_admin, require_catalog_key
from services import usage_service

router = APIRouter(tags=["usage"])


@router.post("/api/v1/usage/ingest")
async def ingest_usage(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _key: None = Depends(require_catalog_key),
):
    """桌面端脱敏聚合用量上报（X-Catalog-Key 鉴权，无需登录）。

    2026-10-15：鉴权由函数体内的私有守卫改为依赖声明 `Depends(require_catalog_key)`。
    注意**仅接受静态 key**（非 Bearer 双通道）—— 桌面端 `usage-reporter.js` 发的就是
    `X-Catalog-Key`；PRD 里此前写的「Bearer(Logto JWT) 优先」与本实现不符，已随本 PR 修正。
    """
    try:
        return await usage_service.ingest_usage(db, body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/api/v1/usage/summary")
async def get_usage_summary(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await usage_service.usage_summary(db, days=days)
