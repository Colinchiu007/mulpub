"""Credit cost backfill service — 按价格卡对已上报用量回算成本.

**为什么需要回算而不是只等新数据**：`model_usage_daily` 已经有 tokens_in/tokens_out
（桌面端一直在报），只是**没有价格**所以 cost 恒为 0。回算把这两者接起来——
运营在后台配好价格卡，就能立刻看到历史用量的成本分布，不必等桌面端改造上线。

**回算的粒度与口径**：
  · 按 (usage_date, provider_id) 聚合的日桶回算 ⇒ 成本精确到「该日该 provider 的总量」，
    但**无法区分模型**（日桶唯一键里没有 model）。
  · 命中的是**通用价格卡**（model 为空串）。若运营只配了 model 精确价，
    该 provider 会被判为「缺价格」并告警——这是**有意的**：宁可显式告警，
    也不拿通用价冒充精确价。
  · 回算是**幂等**的：同一张价格卡重复回算，结果相同（成本由 tokens 纯函数算出，
    不做累加）。因此可以安全重跑。

**不改既有表结构**：`model_usage_daily.cost` 已经是 Float（元），直接更新该列。
"""
from __future__ import annotations

import datetime
import logging
from typing import Dict, List, Optional, Tuple

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from models import ModelUsageDaily
from models_credit import ModelPriceCard
from services.credit_price_service import (
    compute_cost_micros,
    compute_credit_cost,
    get_credit_unit_price_micros,
    is_pricing_baseline_usable,
    load_effective_cards,
    token_counts_from_event,
)

logger = logging.getLogger("ops-center.credit-cost")


class BackfillResult:
    """一次回算的结果。"""

    __slots__ = ("rows_scanned", "rows_updated", "cost_micros_total", "credit_total",
                 "missing_price_providers", "window_quota_only_providers")

    def __init__(self):
        self.rows_scanned = 0
        self.rows_updated = 0
        self.cost_micros_total = 0
        self.credit_total = 0
        self.missing_price_providers: List[str] = []
        self.window_quota_only_providers: List[str] = []

    def as_dict(self) -> dict:
        return {
            "rows_scanned": self.rows_scanned,
            "rows_updated": self.rows_updated,
            "cost_micros_total": self.cost_micros_total,
            "cost_yuan_total": round(self.cost_micros_total / 1_000_000, 4),
            "credit_total": self.credit_total,
            "missing_price_providers": sorted(set(self.missing_price_providers)),
            "window_quota_only_providers": sorted(set(self.window_quota_only_providers)),
        }


def _tokens_of(row) -> Dict[str, int]:
    """把日桶的 token 列折成 unit → 数量。

    ⚠️ **必须复用 `token_counts_from_event`**（它按 `TOKEN_FIELD_TO_UNIT` 映射到
    价格卡的 unit 字面量）。早期这里手写 `"token_in"` / `"token_out"`，
    而价格卡的 unit 是 `1k_tokens_in` / `1k_tokens_out`
    ⇒ `compute_cost_micros` 里 `cards.get("token_in")` **恒为 None**
    ⇒ 每一行都落进 `missing_units` ⇒ **回算成本恒为 0 且全量报「缺价格」**。

    为什么当时没被发现：事件级路径 `token_counts_from_event` 是**对的**，
    而既有单测 `test_token_counts_mapping` 测的正是那条对的路径
    ⇒ 测的是「映射表自洽」，没测「日桶行 ⇒ unit」这条转换 ⇒ 恒真自检。
    ⇒ 现在日桶级与事件级共用同一个映射函数，两条路径不可能再漂移。
    """
    return token_counts_from_event({
        "tokens_in": row.tokens_in,
        "tokens_out": row.tokens_out,
    })


async def backfill_costs(
    db: AsyncSession,
    days: int = 90,
    providers: Optional[List[str]] = None,
    at: Optional[str] = None,
) -> BackfillResult:
    """按价格卡回算 `model_usage_daily.cost`（元）并返回汇总。

    :param days: 回算最近 N 天的用量
    :param providers: 只回算指定 provider；None = 全部
    :param at: 价格卡生效时刻（ISO8601）；None = 当前
    """
    result = BackfillResult()
    window = max(1, min(365, int(days)))
    cutoff = (datetime.datetime.utcnow() - datetime.timedelta(days=window)).strftime("%Y-%m-%d")
    moment = at or datetime.datetime.utcnow().isoformat()

    query = sa.select(ModelUsageDaily).where(ModelUsageDaily.usage_date >= cutoff)
    if providers:
        query = query.where(ModelUsageDaily.provider_id.in_(list(providers)))
    rows = (await db.execute(query)).scalars().all()
    result.rows_scanned = len(rows)
    if not rows:
        return result

    unit_price_micros = await get_credit_unit_price_micros(db)

    # 价格卡按 (provider, category) 预载一次，避免逐行查库
    provider_categories: Dict[Tuple[str, str], List[ModelPriceCard]] = {}
    for card in (await db.execute(sa.select(ModelPriceCard))).scalars().all():
        provider_categories.setdefault((card.provider_id, card.action_type), []).append(card)

    card_cache: Dict[Tuple[str, str], Dict[str, PriceCard]] = {}
    updates: List[dict] = []
    for row in rows:
        key = (row.provider_id, row.category or "llm")
        if key not in card_cache:
            # 日桶无 model 维度 ⇒ 只用通用价格卡（model 为空串）
            card_cache[key] = await load_effective_cards(
                db, row.provider_id, "", row.category or "llm", at=moment
            )
        cards = card_cache[key]
        tokens = _tokens_of(row)
        if not tokens:
            continue
        cost = compute_cost_micros(cards, tokens)
        if cost.has_missing_price:
            result.missing_price_providers.append(row.provider_id)
            continue
        # 10-11 §6：窗口配额（C 类）只能估算、依赖使用强度 ⇒ **仅作参考、不入定价基准**。
        # 这里不阻断回算（成本账仍要记），但必须显式告警，避免它被当成定价依据。
        if not is_pricing_baseline_usable(cards):
            result.window_quota_only_providers.append(row.provider_id)
        if cost.cost_micros <= 0:
            continue
        credit = compute_credit_cost(cost.cost_micros, unit_price_micros, cost.multiplier)
        result.cost_micros_total += cost.cost_micros
        result.credit_total += credit
        updates.append({
            "usage_date": row.usage_date,
            "client_id": row.client_id,
            "provider_id": row.provider_id,
            "action": row.action,
            "cost_yuan": round(cost.cost_micros / 1_000_000, 6),
            "credit_cost": credit,
            "price_id": cost.price_id,
        })

    for update in updates:
        await db.execute(
            sa.update(ModelUsageDaily)
            .where(
                ModelUsageDaily.usage_date == update["usage_date"],
                ModelUsageDaily.client_id == update["client_id"],
                ModelUsageDaily.provider_id == update["provider_id"],
                ModelUsageDaily.action == update["action"],
            )
            .values(cost=update["cost_yuan"], updated_at=datetime.datetime.utcnow().isoformat())
        )
        result.rows_updated += 1

    if result.missing_price_providers:
        logger.warning(
            "credit-cost-backfill: 缺价格卡的 provider=%s（该部分成本未计入，请先配价格卡）",
            sorted(set(result.missing_price_providers)),
        )
    if result.window_quota_only_providers:
        logger.warning(
            "credit-cost-backfill: provider=%s 命中的只有窗口配额类价格（C 类）——"
            "仅可作参考、不得入定价基准（10-11 §6）",
            sorted(set(result.window_quota_only_providers)),
        )
    logger.info(
        "credit-cost-backfill: scanned=%s updated=%s cost_yuan=%.4f credit=%s",
        result.rows_scanned, result.rows_updated,
        result.cost_micros_total / 1_000_000, result.credit_total,
    )
    # ⚠️ **必须在这里 commit**。
    # 早期版本没有 commit，而 `async_session()` 退出时**不会自动提交**
    #（`expire_on_commit=False` 只影响 expire，不开 autocommit）
    # ⇒ router 调完回算，所有 UPDATE 随 session 关闭被丢弃
    # ⇒ **回算从来没有落过库**（单元测试全绿，因为它不走 DB）。
    # 放在函数内而不是调用方：这是「有副作用的操作」，
    # 调用方不该需要知道要 commit（否则换个调用点就又忘了 ⇒ 同一处数据两种语义）。
    await db.commit()
    return result


async def summarize_by_provider(
    db: AsyncSession,
    days: int = 30,
) -> List[dict]:
    """按 provider 汇总已回算的成本（看板用）。"""
    window = max(1, min(365, int(days)))
    cutoff = (datetime.datetime.utcnow() - datetime.timedelta(days=window)).strftime("%Y-%m-%d")
    rows = (
        await db.execute(
            sa.select(
                ModelUsageDaily.provider_id,
                sa.func.sum(ModelUsageDaily.cost).label("cost_total"),
                sa.func.sum(ModelUsageDaily.tokens_in).label("tokens_in"),
                sa.func.sum(ModelUsageDaily.tokens_out).label("tokens_out"),
                sa.func.sum(ModelUsageDaily.calls).label("calls"),
            )
            .where(ModelUsageDaily.usage_date >= cutoff)
            .group_by(ModelUsageDaily.provider_id)
        )
    ).all()
    return [
        {
            "provider_id": row.provider_id,
            "cost_yuan": round(float(row.cost_total or 0), 4),
            "tokens_in": int(row.tokens_in or 0),
            "tokens_out": int(row.tokens_out or 0),
            "calls": int(row.calls or 0),
        }
        for row in rows
    ]
