"""Credit cost accounting 单元测试 —— 成本换算与积分换算的纯函数口径.

这些是**纯函数**，不依赖 DB 与网络：成本换算错了就是直接亏钱，
必须在最底层锁死口径。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models_credit import (  # noqa: E402
    CREDIT_UNIT_MICROS,
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
    compute_cost_micros,
    compute_credit_cost,
    compute_period_bounds,
    is_pricing_baseline_usable,
    token_counts_from_event,
)


def test_cost_is_computed_per_1k_tokens():
    """单价口径是「分 / 1000 unit」，与 official_keys.cost_per_1k_tokens 一致。"""
    cards = {
        UNIT_1K_TOKENS_IN: PriceCard("p1", UNIT_1K_TOKENS_IN, 200_000, 1.0),   # 200000 微元/1K = 20 分/1K
        UNIT_1K_TOKENS_OUT: PriceCard("p1", UNIT_1K_TOKENS_OUT, 600_000, 1.0),  # 600000 微元/1K = 60 分/1K
    }
    result = compute_cost_micros(cards, {UNIT_1K_TOKENS_IN: 1000, UNIT_1K_TOKENS_OUT: 500})
    # 1000 输入 = 200000 微元（¥0.20）；500 输出 = 300000 微元（¥0.30）
    # ⇒ 500000 微元 = ¥0.50（= 50 分，与旧「分」口径同值）
    assert result.cost_micros == 500_000
    assert result.price_id == "p1+p1"
    assert not result.has_missing_price


def test_cost_uses_integer_micros_no_float_drift():
    """小数 token 数不能产生浮点误差（成本必须整数微元）。"""
    cards = {UNIT_1K_TOKENS_IN: PriceCard("p1", UNIT_1K_TOKENS_IN, 200_000, 1.0)}
    result = compute_cost_micros(cards, {UNIT_1K_TOKENS_IN: 333})
    assert isinstance(result.cost_micros, int)
    assert result.cost_micros == 66_600  # 333 * 200000 / 1000 = 66600 微元（= ¥0.666）


def test_missing_price_is_reported_not_silently_zeroed():
    """缺价格卡必须显式上报（missing_units），不能静默按 0。"""
    cards = {UNIT_1K_TOKENS_IN: PriceCard("p1", UNIT_1K_TOKENS_IN, 200_000, 1.0)}
    result = compute_cost_micros(cards, {UNIT_1K_TOKENS_IN: 1000, UNIT_1K_TOKENS_OUT: 1000})
    assert result.has_missing_price
    assert result.missing_units == [UNIT_1K_TOKENS_OUT]
    # 已命中的部分仍计成本
    assert result.cost_micros == 200_000


def test_zero_count_units_are_skipped():
    cards = {UNIT_1K_TOKENS_IN: PriceCard("p1", UNIT_1K_TOKENS_IN, 200_000, 1.0)}
    result = compute_cost_micros(cards, {UNIT_1K_TOKENS_IN: 0, UNIT_1K_TOKENS_OUT: 0})
    assert result.cost_micros == 0
    assert not result.has_missing_price


def test_credit_cost_rounds_up():
    """积分向上取整：宁可少收 1 积分，不可多付 1 分成本。"""
    # 1 积分 = 1 分 = 10000 微元
    assert compute_credit_cost(500_000, 10_000) == 50
    assert compute_credit_cost(500_001, 10_000) == 51
    assert compute_credit_cost(10_000, 10_000) == 1
    assert compute_credit_cost(0, 10_000) == 0


def test_credit_cost_applies_multiplier():
    """贵模型用 credit_multiplier 多扣积分。"""
    assert compute_credit_cost(1_000_000, 10_000, 2.0) == 200
    assert compute_credit_cost(1_000_000, 10_000, 0.5) == 50
    assert compute_credit_cost(30_000, 10_000, 2.0) == 6


def test_credit_cost_guards_zero_unit_price():
    """积分单价配 0 会除零 —— 必须兜底为 1。"""
    assert compute_credit_cost(1_000_000, 0) == 1_000_000
    assert compute_credit_cost(1_000_000, -5) == 1_000_000


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
        UNIT_PER_IMAGE: PriceCard("p-img", UNIT_PER_IMAGE, 3_000_000, 1.0),   # 3000000 微元/张 = 300 分/张
        UNIT_PER_SECOND: PriceCard("p-sec", UNIT_PER_SECOND, 500_000, 1.0),  # 500000 微元/秒 = 50 分/秒
    }
    result = compute_cost_micros(cards, {UNIT_PER_IMAGE: 3, UNIT_PER_SECOND: 10})
    # 3 张 = 9000000 微元；10 秒 = 5000000 微元 ⇒ 合计 14000000 微元 = ¥140（= 1400 分）
    assert result.cost_micros == 14_000_000
    # 反向对照：同样数量放进 1K token 维度会走 /1000 ⇒ 1000 token = 3000000/1000 = 3000 微元
    token_cards = {UNIT_1K_TOKENS_IN: PriceCard("p-tok", UNIT_1K_TOKENS_IN, 3_000_000, 1.0)}
    assert compute_cost_micros(token_cards, {UNIT_1K_TOKENS_IN: 1000}).cost_micros == 3_000_000


def test_price_card_unique_constraint_includes_unit():
    """⚠️ 防复发锁：价格卡唯一约束**必须含 unit**。

    早期版本漏了 unit ⇒ 同一 provider 的 `1k_tokens_in` / `1k_tokens_out` 两张卡
    在其余维度上完全相同 ⇒ 撞唯一约束 ⇒ **LLM 的输入/输出/缓存三张卡根本存不下**
    （实测：灌种子时插第二张就 UNIQUE constraint failed）。

    这条锁的是**约束的列集合**（结构断言），不是某个字面量：
    改约束的列 ⇒ 立刻红；改约束名 ⇒ 也红（名字变了说明有人重写了这条约束）。
    """
    from models_credit import ModelPriceCard
    constraints = {c.name: c for c in ModelPriceCard.__table__.constraints if c.name}
    assert "uq_model_price_active" in constraints, "价格卡唯一约束被改名或删除"
    cols = {c.name for c in constraints["uq_model_price_active"].columns}
    assert cols == {
        "provider_id", "model_id", "action_type", "unit",
        "spec", "quality_tier", "effective_from",
    }, f"唯一约束列集合不对：{sorted(cols)}"


def test_credit_unit_micros_is_the_single_source_of_truth():
    """⚠️ 防复发锁：「1 积分 = 10000 微元」是**单一真源**，三处必须同值。

    三处 = `CreditPriceConfig.credit_unit_price_micros` 的 default /
    读不到配置时的兜底 / 建默认行时写入的值。
    ⚠️ 曾出现过「default 改成 1 但测试全绿」—— 因为测试都显式传参，
    **default 根本没有被覆盖** ⇒ 漂移无人发现 ⇒ 积分换算差 10000 倍。
    ⇒ 这条断言把 default 钉死：改 default 必红。
    """
    assert CREDIT_UNIT_MICROS == 10_000
    from models_credit import CreditPriceConfig
    default = CreditPriceConfig.__table__.c.credit_unit_price_micros.default
    assert default is not None and default.arg == CREDIT_UNIT_MICROS


def test_micros_unit_can_express_sub_cent_unit_price():
    """⚠️ 防复发锁：**为什么成本最小单位是「微元」而不是「分」**。

    LLM 的每千 token 单价天然是**亚分**（DeepSeek V4.1-Flash 国内高峰价
    输入 ¥3 / 百万 tokens ⇒ 0.3 分 / 1K tokens）。
    若单价列是整数「分」⇒ 真实值只能落成 **0**（⇒ 回算成本恒 0 且 0 价卡会静默命中、
    不产生「缺价格」告警）或 **1**（⇒ 成本被放大 3.3 倍）。
    ⇒ 改成「微元」后 3000 微元/1K 精确可存。

    同一条判据顺带验了积分换算：¥0.003 的成本向上取整到 **1 积分**（1 积分 = ¥0.01），
    与 10-08 §3.3「宁可少收 1 积分，不可多付 1 分成本」一致。
    """
    deepseek_in = PriceCard("ds-in", UNIT_1K_TOKENS_IN, 3_000, 1.0)   # 3000 微元/1K = 0.3 分/1K
    result = compute_cost_micros({UNIT_1K_TOKENS_IN: deepseek_in}, {UNIT_1K_TOKENS_IN: 1000})
    assert result.cost_micros == 3_000          # 1000 tokens × 3000 微元/1K ÷ 1000 = 3000 微元 = ¥0.003
    assert not result.has_missing_price
    # ¥0.003 ⇒ 1 积分（1 积分 = 1 分 = 10000 微元，向上取整）
    assert compute_credit_cost(result.cost_micros, 10_000) == 1


def test_zero_price_card_is_treated_as_missing_not_free():
    """⚠️ **0 价卡按「缺价」处理，绝不当「免费」**。

    0 价卡一旦入库，回算会静默命中它 ⇒ 成本算成 0 ⇒ 既不告警、又被当成免费
    ⇒ 成本统计系统性偏低且无信号（口径：缺价必须告警 / 绝不插 0 价卡）。
    ⇒ 写入侧有守卫（管理端 API + 种子脚本都拒 0），这里是**第二道防线**。
    """
    cards = {
        UNIT_1K_TOKENS_IN: PriceCard("p-zero", UNIT_1K_TOKENS_IN, 0, 1.0),
        UNIT_1K_TOKENS_OUT: PriceCard("p-ok", UNIT_1K_TOKENS_OUT, 200_000, 1.0),
    }
    result = compute_cost_micros(cards, {UNIT_1K_TOKENS_IN: 1000, UNIT_1K_TOKENS_OUT: 500})
    assert result.has_missing_price
    assert result.missing_units == [UNIT_1K_TOKENS_IN], result.missing_units
    # 0 价那一路**不计入成本**（而不是按 0 计进去）
    assert result.cost_micros == 100_000, result.cost_micros   # 500 × 200000 / 1000


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
