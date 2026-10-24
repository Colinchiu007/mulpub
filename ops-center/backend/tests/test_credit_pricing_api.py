"""价格卡管理端点的**接线**契约测试 —— 端点能被真的调通。

为什么单独成文件：`test_credit_price_service.py` 测的是**纯函数口径**
（`compute_cost_micros` / `token_counts_from_event`），
`test_credit_cost_backfill_service.py` 测的是**回算链路**（日桶行 ⇒ unit ⇒ 成本）。
两者都**不经过 router** ⇒ 管理端三个价格卡端点（list / create / close）
此前**一条断言都没有** ⇒ 列名写错时 CI 全绿、手工一调就 500。

本次实测到的两处（#4322 引入、本 PR 收尾修掉）：
  · `list_price_cards` 读 `c.model` —— `ModelPriceCard` 的列名是 `model_id`
    ⇒ AttributeError ⇒ **整个列表端点 500**；
  · `create_price_card` 构造 `ModelPriceCard(model=…, category=…)`
    ⇒ SQLAlchemy 声明式构造器报 TypeError ⇒ **建卡端点 500**。

⚠️ 本文件刻意**不**以「没抛异常」算通过：断言落在**返回体的值**与**落库后的行**上
⇒ 「读错列」与「写错列」都能被抓住（只断言不抛异常的话，断言一个空 items 也算绿）。

⚠️ 本文件**不走 ASGI**：直接调端点函数并显式传 `_admin`（绕过 `require_admin` 依赖），
焦点在「端点与 ORM 列名对不对得上」，不在鉴权链上。
"""
import os
import sys

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import Base  # noqa: E402
from models_credit import (  # noqa: E402
    CREDIT_UNIT_MICROS,
    UNIT_1K_TOKENS_IN,
    ModelPriceCard,
)
import models_credit  # noqa: F401  (注册 ORM)

from routers import credit_pricing  # noqa: E402


ADMIN = {"id": "test-admin", "role": "admin"}


@pytest_asyncio.fixture
async def db_env(monkeypatch):
    """内存库 + 把 router 模块里的 `async_session` 换成本次测试的 sessionmaker。"""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import StaticPool

    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,          # 内存库必须同一连接，否则换个连接就没表了
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 端点内部是 `async with async_session() as db:` ⇒ 必须替换**模块属性**
    monkeypatch.setattr(credit_pricing, "async_session", session_factory)
    yield session_factory
    await engine.dispose()


async def _seed(session_factory, **overrides):
    """灌一张价格卡，返回它的 id。"""
    row = dict(
        id="probe-card",
        provider_id="deepseek",
        model_id="kling-v3",            # 非空：才能区分「读了 model_id」与「读错列」
        action_type="llm",
        unit=UNIT_1K_TOKENS_IN,
        spec="",
        quality_tier="std",
        unit_price_micros=3000,
        currency="CNY",
        proc_discount=1.0,
        credit_multiplier=1.0,
        billed_by="billed_by_usage",
        source="vendor_doc",
        effective_from="2026-10-01T00:00:00",
        effective_to="",
    )
    row.update(overrides)
    async with session_factory() as s:
        s.add(ModelPriceCard(**row))
        await s.commit()
    return row["id"]


@pytest.mark.asyncio
async def test_list_price_cards_returns_stored_values(db_env):
    """列表端点必须**真的返回这张卡的值**。

    ⚠️ 回归点：`c.model`（列名实为 `model_id`）⇒ AttributeError ⇒ 500。
    修复前本用例直接抛异常；修复后断言的是**读回来的值**，
    所以「读错列但没炸」也照样红。
    """
    await _seed(db_env)

    result = await credit_pricing.list_price_cards(_admin=ADMIN)

    assert len(result["items"]) == 1, result
    item = result["items"][0]
    assert item["id"] == "probe-card"
    assert item["provider_id"] == "deepseek"
    assert item["model"] == "kling-v3", item          # ← 这一条锁的是 `model_id`
    assert item["category"] == "llm", item
    assert item["unit"] == UNIT_1K_TOKENS_IN, item
    assert item["unit_price_micros"] == 3000, item    # 微元口径
    assert item["effective_from"] == "2026-10-01T00:00:00"
    assert item["effective_to"] == ""


@pytest.mark.asyncio
async def test_list_price_cards_filters_by_provider_and_category(db_env):
    """筛选必须按 `action_type`（列名实为 action_type，不是 category）过滤。"""
    await _seed(db_env)
    await _seed(db_env, id="other-card", provider_id="doubao-llm", action_type="image")

    only = await credit_pricing.list_price_cards(provider_id="deepseek", _admin=ADMIN)
    assert [i["id"] for i in only["items"]] == ["probe-card"], only

    by_cat = await credit_pricing.list_price_cards(category="image", _admin=ADMIN)
    assert [i["id"] for i in by_cat["items"]] == ["other-card"], by_cat


@pytest.mark.asyncio
async def test_create_price_card_persists_with_orm_column_names(db_env):
    """建卡端点必须能落库，且**落进正确的列**。

    ⚠️ 回归点：`ModelPriceCard(model=…, category=…)` ⇒ TypeError（列名是
    `model_id` / `action_type`）⇒ 建卡端点 500。
    对外入参仍叫 model / category（运营侧一个口径），落库列名才是 ORM 的。
    """
    body = {
        "id": "new-card",
        "provider_id": "minimax",
        "model": "minimax-M2.7",
        "category": "llm",
        "unit": UNIT_1K_TOKENS_IN,
        "unit_price_micros": 2500,
        "effective_from": "2026-10-24T00:00:00",
        "note": "probe",
    }

    result = await credit_pricing.create_price_card(body, _admin=ADMIN)
    assert result == {"id": "new-card", "created": True}, result

    async with db_env() as s:
        row = (await s.execute(
            select(ModelPriceCard).where(ModelPriceCard.id == "new-card")
        )).scalars().first()
    assert row is not None
    assert row.model_id == "minimax-M2.7", row.model_id
    assert row.action_type == "llm", row.action_type
    assert row.unit_price_micros == 2500, row.unit_price_micros
    assert row.unit == UNIT_1K_TOKENS_IN, row.unit


@pytest.mark.asyncio
async def test_create_price_card_rejects_duplicate_id(db_env):
    """改价必须走「插新行 + 旧行补 effective_to」⇒ 同 id 直接拒。"""
    await _seed(db_env)
    body = {
        "id": "probe-card",
        "provider_id": "deepseek",
        "model": "",
        "category": "llm",
        "unit": UNIT_1K_TOKENS_IN,
        "unit_price_micros": 999,
        "effective_from": "2026-10-24T00:00:00",
    }
    with pytest.raises(HTTPException) as exc:
        await credit_pricing.create_price_card(body, _admin=ADMIN)
    assert exc.value.status_code == 409, exc.value


@pytest.mark.asyncio
async def test_close_price_card_sets_effective_to(db_env):
    """close 是「给旧卡补生效区间」，不是改价 ⇒ 单价必须保持不变。"""
    await _seed(db_env)

    result = await credit_pricing.close_price_card(
        "probe-card", {"effective_to": "2026-11-01T00:00:00"}, _admin=ADMIN
    )
    assert result == {"id": "probe-card", "effective_to": "2026-11-01T00:00:00"}, result

    async with db_env() as s:
        row = (await s.execute(
            select(ModelPriceCard).where(ModelPriceCard.id == "probe-card")
        )).scalars().first()
    assert row.effective_to == "2026-11-01T00:00:00", row.effective_to
    assert row.unit_price_micros == 3000, row.unit_price_micros   # 单价没被动过


@pytest.mark.asyncio
async def test_close_price_card_rejects_already_closed(db_env):
    await _seed(db_env, effective_to="2026-10-10T00:00:00")
    with pytest.raises(HTTPException) as exc:
        await credit_pricing.close_price_card(
            "probe-card", {"effective_to": "2026-11-01T00:00:00"}, _admin=ADMIN
        )
    assert exc.value.status_code == 409, exc.value


@pytest.mark.asyncio
async def test_price_config_round_trip_uses_micros(db_env):
    """积分单价配置的读写都以**微元**为准（默认 10000 = 1 积分 = 1 分）。"""
    got = await credit_pricing.get_price_config(_admin=ADMIN)
    assert got["credit_unit_price_micros"] == CREDIT_UNIT_MICROS, got

    updated = await credit_pricing.update_price_config(
        {"credit_unit_price_micros": 20000, "note": "probe"}, _admin=ADMIN
    )
    assert updated == {"credit_unit_price_micros": 20000}, updated

    again = await credit_pricing.get_price_config(_admin=ADMIN)
    assert again["credit_unit_price_micros"] == 20000, again
    assert again["note"] == "probe", again


@pytest.mark.asyncio
async def test_create_price_card_rejects_zero_price(db_env):
    """⚠️ **0 价卡必须拒**。

    0 价卡会被回算静默命中 ⇒ 成本算成 0 ⇒ 既不告警、又被当成「免费」
    ⇒ 成本统计系统性偏低且无信号（口径：绝不插 unit_price_micros=0 的行）。
    """
    body = {
        "id": "zero-card",
        "provider_id": "minimax",
        "model": "",
        "category": "llm",
        "unit": UNIT_1K_TOKENS_IN,
        "unit_price_micros": 0,
        "effective_from": "2026-10-24T00:00:00",
    }
    with pytest.raises(HTTPException) as exc:
        await credit_pricing.create_price_card(body, _admin=ADMIN)
    assert exc.value.status_code == 400, exc.value


@pytest.mark.asyncio
async def test_price_config_rejects_value_below_baseline(db_env):
    """⚠️ 写接口**不允许**把积分单价配到基准以下。

    引擎侧 `get_credit_unit_price_micros` 会把 < 10000 的配置**静默抬回 10000**
    （`max(CREDIT_UNIT_MICROS, …)`）⇒ 若写接口放行 1..9999，
    接口会回显运营填的值、引擎却按 10000 算 ⇒ **回显 ≠ 实际**，且无任何告警。
    ⇒ 口径必须一致：调价只能调高（抬高毛利），调低一律 400。
    """
    with pytest.raises(HTTPException) as exc:
        await credit_pricing.update_price_config(
            {"credit_unit_price_micros": 5000}, _admin=ADMIN
        )
    assert exc.value.status_code == 400, exc.value
    assert str(CREDIT_UNIT_MICROS) in str(exc.value.detail), exc.value.detail

    # 调高是允许的（抬高毛利），且回显 = 引擎实际值
    ok = await credit_pricing.update_price_config(
        {"credit_unit_price_micros": 20000}, _admin=ADMIN
    )
    assert ok == {"credit_unit_price_micros": 20000}, ok
    again = await credit_pricing.get_price_config(_admin=ADMIN)
    assert again["credit_unit_price_micros"] == 20000, again


@pytest.mark.asyncio
async def test_load_effective_cards_prefers_exact_model_over_generic(db_env):
    """查价侧：同一 provider/action/unit 下，**精确 model 卡优先于通用卡**。

    ⚠️ 回归点：`load_effective_cards` 里判断「精确」时读的是 `card.model`
    —— `ModelPriceCard` 没有这个属性（列名是 `model_id`）⇒ AttributeError。
    修复前它**潜伏**着：唯一的调用点（回算）传 `model=""` ⇒ `and` 短路 ⇒
    右边根本不求值 ⇒ CI 全绿。一旦按 model 计价（传真实 model）就炸。
    ⇒ 这条用例**必须传非空 model**，否则它自己也会被短路掩盖。

    同时锁住优先级语义：通用卡与精确卡同时命中时，精确卡的价格必须生效。
    """
    from services.credit_price_service import load_effective_cards

    await _seed(db_env, id="generic-card", model_id="", unit_price_micros=3000)
    await _seed(db_env, id="exact-card", model_id="kling-v3", unit_price_micros=5000)

    async with db_env() as s:
        cards = await load_effective_cards(s, "deepseek", "kling-v3", "llm")

    assert UNIT_1K_TOKENS_IN in cards, cards
    assert cards[UNIT_1K_TOKENS_IN].unit_price_micros == 5000, cards
    assert cards[UNIT_1K_TOKENS_IN].id == "exact-card", cards
