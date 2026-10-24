"""SQLAlchemy models for credit cost accounting (价格卡 / 事件级用量 / 积分单价配置).

为什么单独成文件：`models.py` 已有 804 行，把这三张表内联进去会继续推高仓库
`filesOver500` 债务基线。抬高基线掩盖自己引入的债务是明确禁止的，
所以按既有拆分习惯单独立文件；`database.init_db()` 里 import 本模块完成 ORM 注册。

与 `models.py` 的既有表的关系（**不改动既有表结构**）：
  · `model_usage_daily` 是**日聚合**，唯一键 `(usage_date, client_id, provider_id, action)`，
    粒度太粗且**不含 user_id** —— 一人多设备散成多行、一机多账号混在一行，
    成本无法归到用户头上。本模块新增 `model_usage_events` 承载 user_id 粒度明细，
    日聚合保持原样（看板与历史数据零影响），后续再考虑从事件汇总。
  · `official_keys.cost_per_1k_tokens` 是**单一混合单价**，不分 input/output/cache/reasoning，
    且改价即改写历史口径（不可复算）。本模块用版本化 `model_price_cards` 取代它。
"""
import datetime

import sqlalchemy as sa
from sqlalchemy import Column, String, Integer, Text, Float, UniqueConstraint, Index

from database import Base

# 计费单位（口径对齐 10-08 §4.1 的 unit 命名；单价单位是「**微元** / 1K unit」或「**微元** / unit」）
# ⚠️ 单价列 `unit_price_micros` 的单位是**微元**（1e-6 元）—— 运营填「0.3 分/1K tokens」
#   要写成 **3000 微元**；写成 0 会被回算当「缺价」（不是免费），写成 300 会放大 10000 倍。
UNIT_1K_TOKENS_IN = "1k_tokens_in"
UNIT_1K_TOKENS_OUT = "1k_tokens_out"
UNIT_1K_TOKENS_CACHE_READ = "1k_tokens_cache_read"
UNIT_1K_TOKENS_CACHE_WRITE = "1k_tokens_cache_write"
UNIT_1K_TOKENS_REASONING = "1k_tokens_reasoning"
UNIT_PER_IMAGE = "per_image"
UNIT_PER_SECOND = "per_second"
UNIT_PER_CHAR = "per_char"
UNIT_PER_SECOND_AUDIO = "per_second_audio"

# token 维度：单价按"每 1K token"计
TOKEN_UNITS = (
    UNIT_1K_TOKENS_IN,
    UNIT_1K_TOKENS_OUT,
    UNIT_1K_TOKENS_CACHE_READ,
    UNIT_1K_TOKENS_CACHE_WRITE,
    UNIT_1K_TOKENS_REASONING,
)

# 非 token 维度：单价按"每个"计
NON_TOKEN_UNITS = (
    UNIT_PER_IMAGE,
    UNIT_PER_SECOND,
    UNIT_PER_CHAR,
    UNIT_PER_SECOND_AUDIO,
)

# 采购形状（10-11 §4）：决定该价格能否作定价基准
BILLED_BY_USAGE = "billed_by_usage"   # B 类按量付费 —— 首选基准
BILLED_BY_QUOTA = "billed_by_quota"   # A 类有总额度的套餐 —— 次选
BILLED_BY_WINDOW = "billed_by_window"  # C 类窗口配额 —— 仅作参考，不入基准

# 「1 积分值多少微元」的**单一真源**。
# ⚠️ 1 积分 = 1 分 = ¥0.01 = **10000 微元**。
# ⚠️ 这三个值（default / 读不到时的兜底 / 建默认行）必须同源 ——
#    漂移一个就是积分换算差 10000 倍（曾因 default 无测试覆盖而漏网）。
CREDIT_UNIT_MICROS = 10000

# 定价基准来源优先级（10-11 §6）：B > A > C
BILLING_BASELINE_PRIORITY = (BILLED_BY_USAGE, BILLED_BY_QUOTA)


class ModelPriceCard(Base):
    """模型单价卡 — 版本化价格。

    字段口径对齐 `01-docs/DEEP-ANALYSIS-CREDIT-PRICING-2026-10-08.md` §4.1 的
    `ModelPriceCard` 设计（含 `model_id` / `action_type` / `spec` / `quality_tier` /
    `proc_discount`），另按 `01-docs/DESIGN-COMPUTE-BILLING-MODEL-2026-10-11.md`
    §4/§6 补齐**采购形状**与**定价基准来源优先级**。

    ⚠️ 两处与 §4.1 的刻意偏离（都是"更严谨"方向，不是简化）：
    ① §4.1 的 `unit_price NUMERIC(12,6)` 单位是**元**；本表用
       `unit_price_micros INTEGER`（**微元**，1e-6 元）—— 成本计算全程整数，避免浮点误差在
       累加中放大。读 §4.1 的值时 **×100**。
    ② §4.1 的 `unit` 命名是 `1k_tokens_in` / `per_image` / `per_second` /
       `per_char` / `per_second_audio`；本表用同一套字面量（见 `UNIT_*` 常量），
       **不再用 `token_in` 之类自造名**——两套口径并存会让回算悄悄算错。

    **采购形状与基准优先级**（10-11 §4/§6）：
      · `billed_by_usage` —— B 类按量付费：有单价表、实付可反算、无窗口黑箱 ⇒ **首选基准**
      · `billed_by_quota`  —— A 类有总额度的套餐：实付 ÷ 总额度，口径清楚 ⇒ 次选
      · `billed_by_window` —— C 类窗口配额：只能估算且依赖使用强度 ⇒ **仅作参考，不入基准**
    ⇒ `source` 记录**基准来源**（manual / vendor_doc / bill_sync / models_dev），
      `billed_by_*` 记录**采购形状**，两者独立。

    **「未知值记 UNKNOWN + fail-closed，不填暂定数字」**（10-11 §13 原则 3）：
      缺价 ⇒ `cost_micros = 0` **且**必须产生告警（见 `credit_price_service`），
      绝不允许"暂定一个数"混进成本统计。
    """

    __tablename__ = "model_price_cards"
    __table_args__ = (
        # ⚠️ 唯一约束**必须含 unit**。
        # 早期版本漏了 unit ⇒ 同一 provider 的 `1k_tokens_in` / `1k_tokens_out` 两张卡
        # 在其余维度（provider/model/action/spec/tier/effective_from）上完全相同
        # ⇒ 撞唯一约束 ⇒ **LLM 的输入/输出/缓存三张卡根本存不下**。
        # 这也与 `load_effective_cards` 的 `by_unit` 分组口径一致（本来就按 unit 分组）。
        UniqueConstraint(
            "provider_id", "model_id", "action_type", "unit", "spec", "quality_tier", "effective_from",
            name="uq_model_price_active",
        ),
        Index("idx_model_price_cards_lookup", "provider_id", "model_id", "action_type"),
    )

    id = Column(String, primary_key=True)  # 例：'minimax-M2.7-2026Q4'
    provider_id = Column(String, nullable=False)  # 'kling' / 'minimax' / 'seedream' / 'deepseek'
    model_id = Column(String, nullable=False, default="")  # 'kling-v3' / 'hailuo-2.3'；空串=该 provider 通用价
    action_type = Column(String, nullable=False, default="llm")  # llm|image|video|tts|asr|embedding
    unit = Column(String, nullable=False)  # 见 UNIT_* 常量
    spec = Column(String, nullable=False, default="")  # '720p' / '1080p' / '4k'（LLM 留空）
    quality_tier = Column(String, nullable=False, default="std")  # std|pro|hd|fast（对应 10-08 §4.4 的质量档）
    unit_price_micros = Column(Integer, nullable=False, default=0)  # **微元** / unit（1e-6 元）
    currency = Column(String, nullable=False, default="CNY")
    proc_discount = Column(Float, nullable=False, default=1.0)  # 采购折扣系数（可配）
    effective_from = Column(String, nullable=False)  # ISO8601
    effective_to = Column(String, default="")  # 空串 = 当前生效
    credit_multiplier = Column(Float, nullable=False, default=1.0)  # 积分倍率：贵模型可多扣
    billed_by = Column(String, nullable=False, default="billed_by_usage")  # 采购形状（10-11 §4）
    source = Column(String, nullable=False, default="manual")  # manual|vendor_doc|bill_sync|models_dev
    note = Column(String, nullable=False, default="")
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class CreditPriceConfig(Base):
    """积分单价配置 —— 全局单例，决定 1 积分值多少**微元**。

    与 `model_price_cards.credit_multiplier` 的分工：
      · 这里定**基准**（1 积分 = N 微元，N 通常为 10000，即 1 积分 = 1 分）；
      · 价格卡的 multiplier 定**该模型相对基准的倍率**（贵模型多扣积分）。

    积分与成本的换算：`credit_cost = ceil(cost_micros / credit_unit_price_micros * multiplier)`。
    向上取整是刻意的 —— 宁可少收 1 积分，不可多付 1 分成本。
    """

    __tablename__ = "credit_price_config"

    id = Column(Integer, primary_key=True, default=1)  # 单例
    credit_unit_price_micros = Column(Integer, nullable=False, default=CREDIT_UNIT_MICROS)  # 1 积分 = 1 分 = 10000 微元
    target_margin_pct = Column(Float, nullable=False, default=72.90)  # 目标毛利率（仅提示用）
    grant_multiplier_default = Column(Float, nullable=False, default=1.0)
    effective_from = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    note = Column(String, nullable=False, default="")


class ModelUsageEvent(Base):
    """事件级用量明细 —— 成本归到用户与按次扣积分的载体。

    日聚合 `model_usage_daily` 回答不了「这个用户这次调用花了多少钱」，
    而扣积分必须知道单次消耗 ⇒ 事件粒度是必需的。

    去重键 `event_id` 由桌面端生成（客户端本地序号 + 时间桶 + 关键字段的哈希），
    重试场景下稳定不变，服务端靠唯一约束拦重复上报。
    """

    __tablename__ = "model_usage_events"
    __table_args__ = (
        UniqueConstraint("event_id", name="uq_model_usage_event_id"),
        Index("idx_model_usage_events_user_date", "user_id", "usage_date"),
        Index("idx_model_usage_events_provider_date", "provider_id", "usage_date"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_id = Column(String, nullable=False)
    usage_date = Column(String, nullable=False)  # YYYY-MM-DD
    user_id = Column(String, nullable=False, default="")  # Logto subject；未登录为空串
    client_id = Column(String, nullable=False, default="")  # 设备稳定哈希（脱敏）
    provider_id = Column(String, nullable=False)
    category = Column(String, nullable=False, default="llm")  # 保留旧名（= action_type 语义）
    action_type = Column(String, nullable=False, default="llm")  # 10-08 §4.2 口径：llm|image|video|tts|asr
    model = Column(String, nullable=False, default="")
    spec = Column(String, nullable=False, default="")  # 请求侧分辨率（视频/图像才有）
    quality_tier = Column(String, nullable=False, default="")  # 质量档（对应 10-08 §4.4）
    action = Column(String, nullable=False, default="")
    byok = Column(Integer, nullable=False, default=0)  # 1 = 用户自带 Key（不扣积分）
    status = Column(String, nullable=False, default="success")
    latency_ms = Column(Integer, nullable=False, default=0)

    # 五类 token 独立计价（OTel GenAI 口径：prompt_tokens/completion_tokens 已 deprecated）
    tokens_in = Column(Integer, nullable=False, default=0)
    tokens_out = Column(Integer, nullable=False, default=0)
    tokens_cache_read = Column(Integer, nullable=False, default=0)
    tokens_cache_write = Column(Integer, nullable=False, default=0)
    tokens_reasoning = Column(Integer, nullable=False, default=0)

    price_id = Column(String, nullable=False, default="")  # 命中的价格卡（可复算）
    cost_micros = Column(Integer, nullable=False, default=0)  # 服务端算的成本（微元）
    credit_cost = Column(Integer, nullable=False, default=0)  # 服务端算的积分消耗
    client_reported_cost_micros = Column(Integer)  # 客户端透传值，仅用于对拍
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
