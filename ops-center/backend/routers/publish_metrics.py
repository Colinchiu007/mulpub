"""Publish metrics API — 发布指标上报（X-Catalog-Key）与运营看板（admin）。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import get_current_user, require_admin, require_catalog_key
from services import publish_metric_service

router = APIRouter(prefix="/api/v1/publish", tags=["publish-metrics"])


@router.post("/ingest")
async def ingest_publish_metrics(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _key: None = Depends(require_catalog_key),
):
    """桌面端发布计数上报（X-Catalog-Key 鉴权，无需登录）。

    2026-10-15：鉴权由函数体内的私有守卫改为依赖声明 `Depends(require_catalog_key)`。
    **仅接受静态 key**（非 Bearer 双通道）—— 桌面端 `publish-reporter.js` 发的就是
    `X-Catalog-Key`；PRD 里此前写的「Bearer(Logto JWT) 优先」已随本 PR 修正。
    """
    try:
        return await publish_metric_service.ingest_publish_metrics(db, body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/summary")
async def get_publish_summary(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    return await publish_metric_service.publish_summary(db, days=days)
