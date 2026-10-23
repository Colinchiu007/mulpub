"""Credit cost accounting 单元测试 —— 成本换算与积分换算的纯函数口径.

这些是**纯函数**，不依赖 DB 与网络：成本换算错了就是直接亏钱，
必须在最底层锁死口径。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.credit_price_service import (  # noqa: E402
    PriceCard,
    compute_cost_cents,
    compute_credit_cost,
    compute_period_bounds,
    token_counts_from_event,
)


def test_cost_is_computed_per_1k_tokens():
    """单价口径是「分 / 1000 unit」，与 official_keys.cost_per_1k_tokens 一致。"""
    cards = {
        "token_in": PriceCard("p1", "token_in", 20, 1.0),   # 20 分 / 1K
        "token_out": PriceCard("p1", "token_out", 60, 1.0),  # 60 分 / 1K
    }
    result = compute_cost_cents(cards, {"token_in": 1000, "token_out": 500})
    # 1000 输入 = 20 分；500 输出 = 30 分 ⇒ 50 分 = ¥0.50
    assert result.cost_cents == 50
    assert result.price_id == "p1+p1"
    assert not result.has_missing_price


def test_cost_uses_integer_cents_no_float_drift():
    """小数 token 数不能产生浮点误差（成本必须整数分）。"""
    cards = {"token_in": PriceCard("p1", "token_in", 20, 1.0)}
    result = compute_cost_cents(cards, {"token_in": 333})
    assert isinstance(result.cost_cents, int)
    assert result.cost_cents == 6  # 333 * 20 / 1000 = 6.66 → 取 6


def test_missing_price_is_reported_not_silently_zeroed():
    """缺价格卡必须显式上报（missing_units），不能静默按 0。"""
    cards = {"token_in": PriceCard("p1", "token_in", 20, 1.0)}
    result = compute_cost_cents(cards, {"token_in": 1000, "token_out": 1000})
    assert result.has_missing_price
    assert result.missing_units == ["token_out"]
    # 已命中的部分仍计成本
    assert result.cost_cents == 20


def test_zero_count_units_are_skipped():
    cards = {"token_in": PriceCard("p1", "token_in", 20, 1.0)}
    result = compute_cost_cents(cards, {"token_in": 0, "token_out": 0})
    assert result.cost_cents == 0
    assert not result.has_missing_price


def test_credit_cost_rounds_up():
    """积分向上取整：宁可少收 1 积分，不可多付 1 分成本。"""
    assert compute_credit_cost(50, 1) == 50
    assert compute_credit_cost(51, 1) == 51
    assert compute_credit_cost(1, 1) == 1
    assert compute_credit_cost(0, 1) == 0


def test_credit_cost_applies_multiplier():
    """贵模型用 credit_multiplier 多扣积分。"""
    assert compute_credit_cost(100, 1, 2.0) == 200
    assert compute_credit_cost(100, 1, 0.5) == 50
    assert compute_credit_cost(3, 1, 2.0) == 6


def test_credit_cost_guards_zero_unit_price():
    """积分单价配 0 会除零 —— 必须兜底为 1。"""
    assert compute_credit_cost(100, 0) == 100
    assert compute_credit_cost(100, -5) == 100


def test_period_bounds_are_month_aligned():
    start, end = compute_period_bounds()
    assert start.endswith("-01T00:00:00")
    assert end > start
    # 12 月跨年不能崩
    import datetime
    start, end = compute_period_bounds(datetime.datetime(2026, 12, 15))
    assert start.startswith("2026-12-01")
    assert end.startswith("2027-01-01")


def test_token_counts_mapping():
    event = {
        "tokens_in": 10, "tokens_out": 20,
        "tokens_cache_read": 5, "tokens_cache_write": 1, "tokens_reasoning": 3,
    }
    counts = token_counts_from_event(event)
    assert counts == {
        "token_in": 10, "token_out": 20,
        "token_cache_read": 5, "token_cache_write": 1, "token_reasoning": 3,
    }
    # 缺字段不产生零值项
    assert token_counts_from_event({}) == {}
