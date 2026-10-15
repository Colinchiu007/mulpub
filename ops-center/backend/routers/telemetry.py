"""Telemetry API — 客户端断连降级遥测（2026-10-08 ops-center-resilience）

断连期间客户端物理上无法上报，因此这些事件是**恢复后补报**写入的
（design.md §3.4）。这带来一条不可违背的红线：

    运营中心自身宕机时，告警 MUST 由独立于运营中心的外部探针产生，
    绝不能依赖运营中心自己对外报警——它自己都挂了。

所以本模块只负责「客户端侧断连的影响面统计」，不承担「服务端自身可用性告警」。
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from middleware.auth import require_admin
from services import resilience_service
from services.logto_verifier import verify_bearer_or_catalog_key

router = APIRouter(tags=["telemetry"])


@router.post("/api/v1/telemetry/degradation")
async def post_degradation(
    body: dict,
    db: AsyncSession = Depends(get_db),
    _key: None = Depends(verify_bearer_or_catalog_key),
):
    """客户端上报一轮断连降级事件。

    2026-10-15（auth-single-source）：鉴权由本模块私有的 `_require_client_key(request)`
    改为依赖声明 `Depends(verify_bearer_or_catalog_key)`（原包装只是它的同义转发，
    且名字与别处的 `_require_catalog_key` 近名不同义）。语义不变：Bearer 优先，或静态 key。
    """
    try:
        return await resilience_service.record_degradation_event(db, body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/api/v1/telemetry/degradation/summary")
async def get_degradation_summary(
    days: int = Query(30, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
):
    """断连影响面统计（仅管理员）。"""
    return await resilience_service.degradation_summary(db, days=days)