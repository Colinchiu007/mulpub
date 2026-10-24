"""Credit cost accounting 单元测试 —— 成本换算与积分换算的纯函数口径.

这些是**纯函数**，不依赖 DB 与网络：成本换算错了就是直接亏钱，
必须在最底层锁死口径。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models_credit import (  # noqa: E402
    BILLED_BY_QUOTA,
    BILLED_BY_USAGE,
    BILLED_BY_WINDOW,
    UNIT_1K_TOKENS_IN,
    UNIT_1K_TOKENS_OUT,
    UNIT_PER_IMAGE,
    UNIT_PER_SECOND,
)
from services.credit_price_service import (  # noqa: E402
    PriceCard,
    compute_cost_cents,
    compute_credit_cost,
    compute_period_bounds,
    is_pricing_baseline_usable,
    token_counts_from_event,
)


def test_cost_is_computed_per_1k_tokens():
    """单价口径是「分 / 1000 unit」，与 official_keys.cost_per_1k_tokens 一致。"""
    cards = {
        UNIT_1K_TOKENS_IN: PriceCard("p1", UNIT_1K_TOKENS_IN, 20, 1.0),   # 20 分 / 1K
        UNIT_1K_TOKENS_OUT: PriceCard("p1", UNIT_1K_TOKENS_OUT, 60, 1.0),  # 60 分 / 1K
    }
    result = compute_cost_cents(cards, {UNIT_1K_TOKENS_IN: 1000, UNIT_1K_TOKENS_OUT: 500})
    # 1000 输入 = 20 分；500 输出 = 30 分 ⇒ 50 分 = ¥0.50
    assert result.cost_cents == 50
    assert result.price_id == "p1+p1"
    assert not result.has_missing_price


def test_cost_uses_integer_cents_no_float_drift():
    """小数 token 数不能产生浮点误差（成本必须整数分）。"""
    cards = {UNIT_1K_TOKENS_IN: PriceCard("p1", UNIT_1K_TOKENS_IN, 20, 1.0)}
    result = compute_cost_cents(cards, {UNIT_1K_TOKENS_IN: 333})
    assert isinstance(result.cost_cents, int)
    assert result.cost_cents == 6  # 333 * 20 / 1000 = 6.66 → 取 6


def test_missing_price_is_reported_not_silently_zeroed():
    """缺价格卡必须显式上报（missing_units），不能静默按 0。"""
    cards = {UNIT_1K_TOKENS_IN: PriceCard("p1", UNIT_1K_TOKENS_IN, 20, 1.0)}
    result = compute_cost_cents(cards, {UNIT_1K_TOKENS_IN: 1000, UNIT_1K_TOKENS_OUT: 1000})
    assert result.has_missing_price
    assert result.missing_units == [UNIT_1K_TOKENS_OUT]
    # 已命中的部分仍计成本
    assert result.cost_cents == 20


def test_zero_count_units_are_skipped():
    cards = {UNIT_1K_TOKENS_IN: PriceCard("p1", UNIT_1K_TOKENS_IN, 20, 1.0)}
    result = compute_cost_cents(cards, {UNIT_1K_TOKENS_IN: 0, UNIT_1K_TOKENS_OUT: 0})
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
        UNIT_1K_TOKENS_IN: 10, UNIT_1K_TOKENS_OUT: 20,
        "1k_tokens_cache_read": 5, "1k_tokens_cache_write": 1, "1k_tokens_reasoning": 3,
    }
    # 缺字段不产生零值项
    assert token_counts_from_event({}) == {}


def test_per_unit_dimensions_are_not_divided_by_1000():
    """⚠️ 回归锁：单价语义按 unit 区分（10-08 §4.1）。

    `1k_tokens_*` 的单价是「分 / 1K token」⇒ 除以 1000；
    `per_image` / `per_second` 的单价是「分 / 个」⇒ **不除**。

    早期实现对所有 unit 一律 /1000 ⇒ 非 token 维度会算错 1000 倍
    （一张图的单价 300 分会被算成 0.3 分）。这条锁住它不再复发。
    """
    cards = {
        UNIT_PER_IMAGE: PriceCard("p-img", UNIT_PER_IMAGE, 300, 1.0),   # 300 分/张
        UNIT_PER_SECOND: PriceCard("p-sec", UNIT_PER_SECOND, 50, 1.0),  # 50 分/秒
    }
    result = compute_cost_cents(cards, {UNIT_PER_IMAGE: 3, UNIT_PER_SECOND: 10})
    # 3 张 = 900 分；10 秒 = 500 分 ⇒ 合计 1400 分 = ¥14
    assert result.cost_cents == 1400
    # 反向对照：同样数量放进 1K token 维度会走 /1000
    token_cards = {UNIT_1K_TOKENS_IN: PriceCard("p-tok", UNIT_1K_TOKENS_IN, 300, 1.0)}
    assert compute_cost_cents(token_cards, {UNIT_1K_TOKENS_IN: 3}).cost_cents == 0  # 3/1000 → 0 分


def test_window_quota_price_is_not_a_pricing_baseline():
    """10-11 §6：定价基准来源优先级 B > A，C（窗口配额）只作参考、不入基准。

    ⇒ 只要命中的卡里有一张是 C 类，整组**不可入基准**（保守侧）。
    """
    usage = {UNIT_1K_TOKENS_IN: PriceCard("p-b", UNIT_1K_TOKENS_IN, 20, 1.0, BILLED_BY_USAGE)}
    quota = {UNIT_1K_TOKENS_IN: PriceCard("p-a", UNIT_1K_TOKENS_IN, 20, 1.0, BILLED_BY_QUOTA)}
    window = {UNIT_1K_TOKENS_IN: PriceCard("p-c", UNIT_1K_TOKENS_IN, 20, 1.0, BILLED_BY_WINDOW)}

    assert is_pricing_baseline_usable(usage) is True
    assert is_pricing_baseline_usable(quota) is True
    assert is_pricing_baseline_usable(window) is False
    assert is_pricing_baseline_usable({}) is False
    # 混用时以最弱的一档为准（保守侧：宁可判不可用）
    mixed = dict(usage)
    mixed.update(window)
    assert is_pricing_baseline_usable(mixed) is False
