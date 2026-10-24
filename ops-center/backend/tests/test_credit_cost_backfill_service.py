"""回算链路的**接线**契约测试 —— 日桶行 ⇒ unit ⇒ 成本。

为什么单独成文件：`test_credit_price_service.py` 测的是**纯函数口径**
（`token_counts_from_event` 走的是**事件级**路径）。
而回算走的是**日桶级**路径（`credit_cost_backfill_service._tokens_of`）——
两条路径曾经各写各的，日桶那条把 unit 写成 `"token_in"`，
与价格卡的 `1k_tokens_in` 不匹配 ⇒ 回算成本恒 0 且全量报「缺价格」。

⚠️ 既有单测全绿却没抓到，正是因为它测的是**另一条**路径
⇒ 恒真自检的典型形态。**要判据看着生产路径，别看着自造的样本。**

这里刻意**不走 DB**（回算是 async + DB 的，但缺陷在纯函数边界上），
用 `SimpleNamespace` 造一个最小日桶行即可覆盖到真实转换点。
"""
import os
import sys
import types

import pytest
from sqlalchemy import select

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import Base  # noqa: E402
from models_credit import UNIT_1K_TOKENS_IN, UNIT_1K_TOKENS_OUT  # noqa: E402
from services.credit_cost_backfill_service import _tokens_of  # noqa: E402
from services.credit_price_service import PriceCard, compute_cost_micros  # noqa: E402


def _row(tokens_in=0, tokens_out=0):
    """最小日桶行 —— 只暴露 `_tokens_of` 实际读取的列。"""
    return types.SimpleNamespace(tokens_in=tokens_in, tokens_out=tokens_out)


def test_daily_bucket_row_maps_to_price_card_unit():
    """日桶行 ⇒ unit 的**键**必须是价格卡的 unit 字面量。

    ⚠️ 断言用 `UNIT_1K_TOKENS_IN` 常量而不是字面量 `"1k_tokens_in"`：
    写死字面量的话，两边一起漂移就发现不了（相对断言恒真）。
    """
    counts = _tokens_of(_row(tokens_in=2000, tokens_out=500))
    assert counts == {UNIT_1K_TOKENS_IN: 2000, UNIT_1K_TOKENS_OUT: 500}


def test_zero_token_columns_are_omitted():
    assert _tokens_of(_row(tokens_in=0, tokens_out=0)) == {}
    assert _tokens_of(_row(tokens_in=10, tokens_out=0)) == {UNIT_1K_TOKENS_IN: 10}


def test_daily_bucket_row_produces_nonzero_cost_against_a_price_card():
    """端到端接线：日桶行 + 价格卡 ⇒ **成本 > 0 且不报缺价格**。

    ⚠️ 这条是防复发的真断言：若 unit 键再漂一次，
    `cards.get(unit)` 恒 None ⇒ 成本 0 + `missing_units` 非空 ⇒ 立刻红。
    """
    cards = {
        UNIT_1K_TOKENS_IN: PriceCard("p-in", UNIT_1K_TOKENS_IN, 300_000, 1.0),   # 300000 微元/1K = 30 分/1K
        UNIT_1K_TOKENS_OUT: PriceCard("p-out", UNIT_1K_TOKENS_OUT, 900_000, 1.0),  # 900000 微元/1K = 90 分/1K
    }
    result = compute_cost_micros(cards, _tokens_of(_row(tokens_in=2000, tokens_out=1000)))
    # 2000/1000×300000 + 1000/1000×900000 = 600000 + 900000 = 1500000 微元 = ¥1.5
    assert result.cost_micros == 1_500_000
    assert not result.has_missing_price
    assert result.missing_units == []


def test_mismatched_unit_key_would_be_reported_as_missing_price():
    """反向对照：把 unit 换成旧的错误字面量，**必须**表现为缺价格。

    ⚠️ 这条让测试不依赖「我改对了」这件事本身：
    它锁住的是「键不匹配 ⇒ 显式告警且成本为 0」这个**必须存在的行为**，
    于是上一条的失败会指向真正的原因（键），而不是一个笼统的「成本不对」。
    """
    cards = {UNIT_1K_TOKENS_IN: PriceCard("p-in", UNIT_1K_TOKENS_IN, 300_000, 1.0)}
    wrong = {"token_in": 2000}
    result = compute_cost_micros(cards, wrong)
    assert result.cost_micros == 0
    assert result.has_missing_price
    assert "token_in" in result.missing_units


# ══════════════════════════════════════════════════════════════════════
# 端到端：回算链路真跑通（自建内存 SQLite，不依赖 conftest 的 DB 隔离）
# ══════════════════════════════════════════════════════════════════════
#
# ⚠️ 为什么必须端到端：这条链路出过三个**只有真跑才会暴露**的缺陷，
#    而单元测试全绿：
#   ① `_tokens_of` 的 unit 键写成 "token_in"（与价格卡的 `1k_tokens_in` 不匹配）
#   ② 价格卡唯一约束漏了 `unit` ⇒ LLM 的 in/out 两张卡存不下
#   ③ 回算里用 `card.category`，但表里那一列叫 `action_type`
#      ⇒ **AttributeError，回算从来没跑通过**
# ⇒ 纯函数单测再全绿也证明不了链路通不通；必须有这条。


@pytest.mark.asyncio
async def test_backfill_end_to_end_computes_cost_and_flags_missing_price():
    """灌卡 ⇒ 报用量 ⇒ 回算 ⇒ **成本 > 0**，且缺价 provider 被点名。"""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import StaticPool
    from models import ModelUsageDaily
    from models_credit import ModelPriceCard
    from services.credit_cost_backfill_service import backfill_costs
    import models_credit  # noqa: F401  (注册 ORM)

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,          # 内存库必须同一连接，否则换个连接就没表了
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_factory() as s:
        s.add(ModelPriceCard(
            id="probe-in", provider_id="deepseek", model_id="", action_type="llm",
            unit=UNIT_1K_TOKENS_IN, spec="", quality_tier="std",
            unit_price_micros=3000, currency="CNY", proc_discount=1.0,
            credit_multiplier=1.0, billed_by="billed_by_usage", source="vendor_doc",
            effective_from="2026-10-01T00:00:00", effective_to="",
        ))
        s.add(ModelPriceCard(
            id="probe-out", provider_id="deepseek", model_id="", action_type="llm",
            unit=UNIT_1K_TOKENS_OUT, spec="", quality_tier="std",
            unit_price_micros=9000, currency="CNY", proc_discount=1.0,
            credit_multiplier=1.0, billed_by="billed_by_usage", source="vendor_doc",
            effective_from="2026-10-01T00:00:00", effective_to="",
        ))
        s.add(ModelUsageDaily(
            usage_date="2026-10-20", client_id="probe", provider_id="deepseek",
            category="llm", action="chat", calls=1, tokens_in=1000, tokens_out=1000, cost=0.0,
        ))
        s.add(ModelUsageDaily(
            usage_date="2026-10-20", client_id="probe", provider_id="no-price-card",
            category="llm", action="chat", calls=1, tokens_in=1000, tokens_out=1000, cost=0.0,
        ))
        await s.commit()

    async with session_factory() as s:
        result = await backfill_costs(s, days=90)
        payload = result.as_dict()

    # 有卡的那行：**成本必须 > 0**（修复前恒为 0 —— 这正是本次改造要证明的）
    assert payload["rows_updated"] == 1, payload
    assert payload["cost_micros_total"] == 12_000, payload      # 1000×3000/1000 + 1000×9000/1000
    assert payload["cost_yuan_total"] == 0.012, payload          # 12000 微元 = ¥0.012
    assert payload["credit_total"] == 2, payload                  # ceil(12000/10000) = 2 积分
    # 缺卡的那行：**必须被点名**，不能静默按 0（10-11 §13 原则 3）
    assert "no-price-card" in payload["missing_price_providers"], payload

    async with session_factory() as s:
        rows = (await s.execute(select(ModelUsageDaily))).scalars().all()
    by_provider = {r.provider_id: r.cost for r in rows}
    assert by_provider["deepseek"] == 0.012, by_provider          # 已回算
    assert by_provider["no-price-card"] == 0.0, by_provider       # 缺价 ⇒ 不改、但被点名

    await engine.dispose()
