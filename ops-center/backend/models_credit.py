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


class ModelPriceCard(Base):
    """模型单价卡 — 版本化价格。

    同一个 (provider_id, model, category, unit) 可以有多条记录，按
    [effective_from, effective_to) 区间切分。**改价 = 插入新行 + 给旧行补 effective_to**，
    不得 UPDATE 单价 —— 否则历史 cost_cents 不可复算，账目失去审计能力。

    unit 取值（与 OTel GenAI 的 token 分类对齐）：
      token_in / token_out / token_cache_read / token_cache_write / token_reasoning
      request / second / image / second_audio
    前五个是 token 维度（可独立计价），后四个是非 token 维度
    （开源生态暂无现成 per-unit 价格模型，见 01-docs/PRD-CREDIT-COST-ACCOUNTING-2026-10-23.md §7.2）。
    """

    __tablename__ = "model_price_cards"
    __table_args__ = (
        UniqueConstraint(
            "provider_id", "model", "category", "unit", "effective_from",
            name="uq_model_price_card",
        ),
        Index("idx_model_price_cards_lookup", "provider_id", "model", "category", "unit"),
    )

    id = Column(String, primary_key=True)  # 例：'minimax-M2.7-2026Q4'
    provider_id = Column(String, nullable=False)
    model = Column(String, nullable=False, default="")  # 空串 = 该 provider 该分类通用价
    category = Column(String, nullable=False, default="llm")
    unit = Column(String, nullable=False)
    unit_price_cents = Column(Integer, nullable=False, default=0)  # 分 / unit
    effective_from = Column(String, nullable=False)  # ISO8601
    effective_to = Column(String, default="")  # 空串 = 当前生效
    credit_multiplier = Column(Float, nullable=False, default=1.0)  # 积分倍率：贵模型可多扣
    source = Column(String, nullable=False, default="manual")  # manual | models_dev | vendor_doc
    note = Column(String, nullable=False, default="")
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class CreditPriceConfig(Base):
    """积分单价配置 —— 全局单例，决定 1 积分值多少分。

    与 `model_price_cards.credit_multiplier` 的分工：
      · 这里定**基准**（1 积分 = N 分，N 通常为 1）；
      · 价格卡的 multiplier 定**该模型相对基准的倍率**（贵模型多扣积分）。

    积分与成本的换算：`credit_cost = ceil(cost_cents / credit_unit_price_cents * multiplier)`。
    向上取整是刻意的 —— 宁可少收 1 积分，不可多付 1 分成本。
    """

    __tablename__ = "credit_price_config"

    id = Column(Integer, primary_key=True, default=1)  # 单例
    credit_unit_price_cents = Column(Integer, nullable=False, default=1)  # 1 积分 = 1 分
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
    category = Column(String, nullable=False, default="llm")
    model = Column(String, nullable=False, default="")
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
    cost_cents = Column(Integer, nullable=False, default=0)  # 服务端算的成本（分）
    credit_cost = Column(Integer, nullable=False, default=0)  # 服务端算的积分消耗
    client_reported_cost_cents = Column(Integer)  # 客户端透传值，仅用于对拍
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
