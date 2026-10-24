"""Credit pricing API — 版本化价格卡、积分单价配置与成本回算.

鉴权沿用 `middleware.auth.require_admin`（与 member_grant 同款）：这些是
**直接影响钱**的端点（改价 = 改毛利率），必须 admin-only。

改价语义（**刻意不支持 UPDATE 单价**）：
一次改价 = 插入一条新价格卡 + 给旧行补 `effective_to`。
理由：价格卡被引用于 `model_usage_events.price_id` 与 `model_usage_daily.cost`，
UPDATE 单价会让**历史成本不可复算**，账目失去审计能力。
"""
from fastapi import APIRouter, Depends, HTTPException

from middleware.auth import require_admin
from services import credit_cost_backfill_service
from services.credit_price_service import ensure_credit_price_config, get_credit_unit_price_micros
from models_credit import CreditPriceConfig, ModelPriceCard
from database import async_session
import sqlalchemy as sa

router = APIRouter(prefix="/api/v1/credit", tags=["credit"])


def _require_int(value, field: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise HTTPException(400, f"{field} 必须是整数")
    if value < minimum:
        raise HTTPException(400, f"{field} 不能小于 {minimum}")
    return value


@router.get("/price-cards")
async def list_price_cards(
    provider_id: str = "",
    category: str = "",
    _admin: dict = Depends(require_admin),
):
    """列出价格卡。"""
    async with async_session() as db:
        query = sa.select(ModelPriceCard)
        if provider_id:
            query = query.where(ModelPriceCard.provider_id == provider_id)
        if category:
            query = query.where(ModelPriceCard.action_type == category)
        rows = (await db.execute(query)).scalars().all()
        return {
            "items": [
                {
                    "id": c.id,
                    "provider_id": c.provider_id,
                    "model": c.model,
                    "category": c.action_type,
                    "unit": c.unit,
                    "unit_price_micros": c.unit_price_micros,
                    "effective_from": c.effective_from,
                    "effective_to": c.effective_to,
                    "credit_multiplier": c.credit_multiplier,
                    "source": c.source,
                    "note": c.note,
                }
                for c in rows
            ]
        }


@router.post("/price-cards")
async def create_price_card(body: dict, _admin: dict = Depends(require_admin)):
    """新增一张价格卡（改价 = 加新卡，不是改旧卡）。"""
    card_id = str(body.get("id") or "").strip()
    provider_id = str(body.get("provider_id") or "").strip()
    unit = str(body.get("unit") or "").strip()
    if not card_id or not provider_id or not unit:
        raise HTTPException(400, "id / provider_id / unit 不能为空")
    unit_price_micros = _require_int(body.get("unit_price_micros"), "unit_price_micros")
    effective_from = str(body.get("effective_from") or "").strip()
    if not effective_from:
        raise HTTPException(400, "effective_from 不能为空")

    async with async_session() as db:
        existing = (
            await db.execute(
                sa.select(ModelPriceCard).where(ModelPriceCard.id == card_id)
            )
        ).scalars().first()
        if existing is not None:
            raise HTTPException(409, "价格卡 ID 已存在（改价请新建一张并给旧卡补 effective_to）")
        db.add(ModelPriceCard(
            id=card_id,
            provider_id=provider_id,
            model=str(body.get("model") or ""),
            category=str(body.get("category") or "llm"),
            unit=unit,
            unit_price_micros=unit_price_micros,
            effective_from=effective_from,
            effective_to=str(body.get("effective_to") or ""),
            credit_multiplier=float(body.get("credit_multiplier") or 1.0),
            source=str(body.get("source") or "manual"),
            note=str(body.get("note") or ""),
        ))
        await db.commit()
        return {"id": card_id, "created": True}


@router.post("/price-cards/{card_id}/close")
async def close_price_card(card_id: str, body: dict, _admin: dict = Depends(require_admin)):
    """给一张价格卡补 effective_to（= 停用它的当前生效区间）。

    这是「改价」的第二步；刻意不提供 UPDATE unit_price_micros 的端点。
    """
    effective_to = str(body.get("effective_to") or "").strip()
    if not effective_to:
        raise HTTPException(400, "effective_to 不能为空")
    async with async_session() as db:
        card = (
            await db.execute(
                sa.select(ModelPriceCard).where(ModelPriceCard.id == card_id)
            )
        ).scalars().first()
        if card is None:
            raise HTTPException(404, "价格卡不存在")
        if card.effective_to:
            raise HTTPException(409, "该价格卡已有关闭区间")
        card.effective_to = effective_to
        await db.commit()
        return {"id": card_id, "effective_to": effective_to}


@router.get("/price-config")
async def get_price_config(_admin: dict = Depends(require_admin)):
    """读积分单价配置（1 积分值多少分）。"""
    async with async_session() as db:
        await ensure_credit_price_config(db)
        await db.commit()
        unit_price = await get_credit_unit_price_micros(db)
        row = (
            await db.execute(
                sa.select(CreditPriceConfig).where(CreditPriceConfig.id == 1)
            )
        ).scalars().first()
        return {
            "credit_unit_price_micros": unit_price,
            "target_margin_pct": float(row.target_margin_pct) if row else None,
            "note": row.note if row else "",
        }


@router.put("/price-config")
async def update_price_config(body: dict, _admin: dict = Depends(require_admin)):
    """改积分单价（1 积分 = N 分）。

    改的是**换算基准**，不改历史账：已入账的积分消耗由账本的 cost_micros 固定，
    不受此后改价影响。
    """
    unit_price = _require_int(body.get("credit_unit_price_micros"), "credit_unit_price_micros", minimum=1)
    async with async_session() as db:
        await ensure_credit_price_config(db)
        row = (
            await db.execute(
                sa.select(CreditPriceConfig).where(CreditPriceConfig.id == 1)
            )
        ).scalars().first()
        row.credit_unit_price_micros = unit_price
        if body.get("target_margin_pct") is not None:
            row.target_margin_pct = float(body["target_margin_pct"])
        if body.get("note") is not None:
            row.note = str(body["note"])
        await db.commit()
        return {"credit_unit_price_micros": unit_price}


@router.post("/backfill")
async def trigger_backfill(body: dict, _admin: dict = Depends(require_admin)):
    """按价格卡回算历史用量的成本。"""
    days = body.get("days", 90)
    providers = body.get("providers")
    if providers is not None and not isinstance(providers, list):
        raise HTTPException(400, "providers 必须是数组")
    async with async_session() as db:
        result = await credit_cost_backfill_service.backfill_costs(
            db, days=int(days), providers=providers
        )
        await db.commit()
        return result.as_dict()


@router.get("/summary")
async def cost_summary(days: int = 30, _admin: dict = Depends(require_admin)):
    """按 provider 汇总成本（看板用）。"""
    async with async_session() as db:
        rows = await credit_cost_backfill_service.summarize_by_provider(db, days=days)
        return {"days": days, "items": rows}
