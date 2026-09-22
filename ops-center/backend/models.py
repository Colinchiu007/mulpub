"""SQLAlchemy models for OpsCenter config management."""
import datetime
import sqlalchemy as sa
from sqlalchemy import Column, String, Integer, Text, Float, ForeignKey
from sqlalchemy.orm import relationship

from database import Base


class Project(Base):
    __tablename__ = "projects"

    code = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(String, default="")
    config_file_path = Column(String, default="")
    config_format = Column(String, default="yaml")
    enabled = Column(Integer, default=1)

    config_items = relationship("ConfigItem", back_populates="project")


class ConfigItem(Base):
    __tablename__ = "config_items"

    id = Column(String, primary_key=True)
    project_code = Column(String, ForeignKey("projects.code"), nullable=False)
    category = Column(String, nullable=False)
    key = Column(String, nullable=False)
    value = Column(Text, nullable=False, default="")
    value_type = Column(String, default="string")
    description = Column(Text, default="")
    is_secret = Column(Integer, default=0)
    is_required = Column(Integer, default=0)
    default_value = Column(Text, default="")
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_by = Column(String, default="")

    project = relationship("Project", back_populates="config_items")


class ConfigAuditLog(Base):
    __tablename__ = "config_audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    config_id = Column(String, nullable=False)
    old_value = Column(Text, default="")
    new_value = Column(Text, default="")
    changed_by = Column(String, nullable=False)
    changed_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    change_type = Column(String, nullable=False)
    source_ip = Column(String, default="")


class ModelPreset(Base):
    """模型预设目录 — 运营端维护前端【模型设置】的预设服务商与多模态能力。

    字段说明：
      - is_visible: 是否在前端【模型设置】中显示（运营可开关）
      - doc_links: 模型技术文档网页链接（JSON 数组，最多 10 条）
      - is_multimodal: 是否多模态模型
      - capabilities: 多模态模型支持的能力 ID（JSON 数组，如 ["llm","tts","image","video"]）
      - capability_models: 每个能力对应的默认模型 ID（JSON 对象，如 {"llm":"MiniMax-M2.7"})
      - capability_doc_links: 每个能力的技术文档网页链接（JSON 对象，capability -> 链接数组，最多 10 条）
    """

    __tablename__ = "model_presets"

    id = Column(String, primary_key=True)  # 如 minimax-multimodal
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)  # llm/tts/speech_recognition/image/video/audio/multimodal
    base_url = Column(String, default="")  # 端口URL（接口 Base URL）
    models_url = Column(String, default="")  # 获取模型ID URL（允许为空）
    models = Column(Text, default="[]")  # JSON array
    default_model = Column(String, default="")  # 平台预设默认 Model ID（运营可填写/修改）
    rate_per_minute = Column(Integer, nullable=True)  # 每分钟连接次数（允许为空）
    limit_per_5h = Column(Integer, nullable=True)  # 5小时限额次数（允许为空）
    is_multimodal = Column(Integer, default=0)
    capabilities = Column(Text, default="[]")  # JSON array
    capability_models = Column(Text, default="{}")  # JSON object
    doc_links = Column(Text, default="[]")  # JSON array, <= 10
    capability_doc_links = Column(Text, default="{}")  # JSON object
    is_visible = Column(Integer, default=1)
    sort_order = Column(Integer, nullable=True)  # 桌面端【全部】列表自定义排序（NULL=未排序，拼音序兜底；reorder 后归一化 0..n-1）
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class SchedulerVerificationRun(Base):
    """限流/调度验证记录 — 运营后台调度模拟（simulated=1）与桌面端真实自检上报（simulated=0）。"""

    __tablename__ = "scheduler_verification_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    preset_id = Column(String, nullable=True)
    rpm = Column(Integer, nullable=False)
    max_concurrent = Column(Integer, nullable=False)
    limit_per_5h = Column(Integer, nullable=True)
    request_count = Column(Integer, nullable=False)
    request_duration_ms = Column(Integer, default=0)
    arrival_interval_ms = Column(Integer, default=0)
    inject_429_at = Column(Integer, nullable=True)
    exceed_5h = Column(Integer, default=0)
    simulated = Column(Integer, default=1)
    engine = Column(String, default="python-simulator")
    client_id = Column(String, default="")
    metrics_json = Column(Text, default="{}")
    assertions_json = Column(Text, default="[]")
    timeline_json = Column(Text, default="[]")
    status = Column(String, default="completed")
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    created_by = Column(String, default="")


class OfficialKey(Base):
    __tablename__ = "official_keys"

    id = Column(String, primary_key=True)  # "openai-gpt4o"
    provider = Column(String, nullable=False)  # openai / doubao / minimax / ...
    name = Column(String, nullable=False)  # "OpenAI GPT-4o"
    api_key = Column(Text, nullable=False)  # Fernet encrypted
    base_url = Column(String, default="")
    models = Column(Text, default="[]")  # JSON array
    priority = Column(Integer, default=1)
    is_active = Column(Integer, default=1)
    tier_access = Column(Integer, default=1)  # 1=all tiers, 2=standard+, 3=pro only
    cost_per_1k_tokens = Column(Float, default=0.0)
    expires_at = Column(String, default="")
    # 配额与告警（2026-08-10 P0-1 第三批）：每分钟配额 / 每日调用上限 / 成本告警阈值(¥) / 备注
    rate_per_minute = Column(Integer, nullable=True)
    daily_limit = Column(Integer, nullable=True)
    alert_threshold_cost = Column(Float, nullable=True)
    note = Column(String, default="")
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class License(Base):
    """官方许可证 — 运营后台签发/吊销，桌面端 Pro 激活凭证（管理面先行，服务端验签待商业模式确认）。"""

    __tablename__ = "licenses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    license_key = Column(String, nullable=False, unique=True)
    plan = Column(String, nullable=False)  # free/trial/pro
    device_limit = Column(Integer, default=1)
    expires_at = Column(String, default="")  # ISO 或空（永久）
    status = Column(String, default="active")  # active/disabled
    note = Column(String, default="")
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class AdminUser(Base):
    """运营后台本地管理员（自包含登录，替代 orchestrator 认证依赖）。"""

    __tablename__ = "admins"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=False)  # pbkdf2_sha256$iterations$salt_hex$hash_hex
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class Announcement(Base):
    """运营公告 — 桌面端启动时经 runtime/bootstrap 拉取展示。

    severity: info=普通提示 / warning=重要提醒（可关闭） / maintenance=维护通知（常驻强提示）
    active_from/active_until: ISO 时间串，空=不设界；活动条件 enabled=1 且窗口命中。
    """

    __tablename__ = "announcements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String, nullable=False)
    content = Column(Text, nullable=False, default="")
    severity = Column(String, default="info")  # info | warning | maintenance
    active_from = Column(String, default="")  # ISO 或空
    active_until = Column(String, default="")  # ISO 或空
    enabled = Column(Integer, default=1)
    sort_order = Column(Integer, default=0)
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class UpdatePolicy(Base):
    """版本发布策略 — 桌面端自动更新消费（强制版本/灰度比例/最低版本提示）。单条有效行 id=1。"""

    __tablename__ = "update_policy"

    id = Column(Integer, primary_key=True, autoincrement=True)
    min_version = Column(String, default="")  # 低于此版本时提示升级（可空）
    force_version = Column(String, default="")  # 低于此版本时强制升级（可空）
    gray_ratio = Column(Integer, default=100)  # 0-100 灰度比例
    enabled = Column(Integer, default=1)
    note = Column(String, default="")
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class ContentPolicy(Base):
    """内容安全策略 — 敏感词库 + 替换串，桌面端 SensitiveFilter 远程词源。单条有效行 id=1。"""

    __tablename__ = "content_policy"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, default="默认内容安全策略")
    word_list = Column(Text, default="[]")  # JSON array of strings
    replacement = Column(String, default="***")  # 替换串，<=16 字符
    enabled = Column(Integer, default=1)
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class ModelUsageDaily(Base):
    """模型调用用量日聚合 — 桌面端脱敏上报，运营后台看板数据源。

    唯一键 (usage_date, client_id, provider_id, action)：同桶多次上报累加（幂等）。
    latency_buckets: JSON，如 {"lt1s": n, "1to3s": n, "3to10s": n, "gt10s": n}
    """

    __tablename__ = "model_usage_daily"
    __table_args__ = (
        sa.UniqueConstraint("usage_date", "client_id", "provider_id", "action", name="uq_model_usage_daily_bucket"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    usage_date = Column(String, nullable=False)  # YYYY-MM-DD
    client_id = Column(String, default="")  # 桌面端设备稳定哈希（脱敏）
    provider_id = Column(String, nullable=False)
    category = Column(String, default="llm")
    action = Column(String, nullable=False)
    calls = Column(Integer, default=0)
    ok_count = Column(Integer, default=0)
    fail_count = Column(Integer, default=0)
    ratelimit_count = Column(Integer, default=0)
    latency_ms = Column(Integer, default=0)  # 总耗时
    tokens_in = Column(Integer, default=0)
    tokens_out = Column(Integer, default=0)
    cost = Column(Float, default=0.0)
    latency_buckets = Column(Text, default="{}")  # JSON
    # 调度健康度（2026-08-12 P1）：桌面端 governor 排队/冷却观测，可选字段（旧客户端按 0）
    queued_count = Column(Integer, default=0)
    cooldown_count = Column(Integer, default=0)
    queue_wait_ms = Column(Integer, default=0)
    cooldown_wait_ms = Column(Integer, default=0)
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class ModelUsageBatch(Base):
    """用量上报批次去重 — 客户端携带 batch_id（lastId-maxId），服务端唯一约束防超时重试翻倍。"""

    __tablename__ = "model_usage_batches"
    __table_args__ = (
        sa.UniqueConstraint("client_id", "batch_id", name="uq_model_usage_batch"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String, default="")
    batch_id = Column(String, nullable=False)
    ingested_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class FeatureFlag(Base):
    """功能开关（桌面端运行时下发）— 运营后台维护，bootstrap 下发 typed value。"""

    __tablename__ = "feature_flags"

    key = Column(String(128), primary_key=True)
    value_type = Column(String(20), default="string")  # string | boolean | number
    value = Column(String, default="")
    description = Column(String(200), default="")
    enabled = Column(Integer, default=1)
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_by = Column(String(100), default="")


class UserFeedback(Base):
    """用户反馈正文与安全元数据；附件独立存储，避免把路径暴露给 API。"""

    __tablename__ = "user_feedback"

    id = Column(String(36), primary_key=True)
    message = Column(Text, nullable=False)
    client_id_hash = Column(String(64), default="")
    app_version = Column(String(64), default="")
    platform = Column(String(32), default="")
    status = Column(String(16), default="new")
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class FeedbackAttachment(Base):
    """反馈日志归档元数据；stored_name 是由服务端生成的 basename。"""

    __tablename__ = "feedback_attachments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    feedback_id = Column(String(36), ForeignKey("user_feedback.id", ondelete="CASCADE"), nullable=False, unique=True)
    stored_name = Column(String(128), nullable=False, unique=True)
    extension = Column(String(8), default="zip")
    size_bytes = Column(Integer, nullable=False)
    sha256 = Column(String(64), nullable=False)
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    expires_at = Column(String, nullable=True)
class PlatformDef(Base):
    """平台发布元数据 — 运营后台管理，桌面端启动拉取覆盖（临时下线/字段上限即时生效）。"""

    __tablename__ = "platform_defs"

    id = Column(String(64), primary_key=True)  # 平台 id（如 wechat_mp）
    name = Column(String(100), nullable=False)
    category = Column(String(20), default="中文")  # 中文 | 海外
    content_category = Column(String(20), default="MIXED")  # VIDEO | IMAGE_TEXT | MIXED
    type = Column(String(20), default="mixed")  # article | mixed 兼容
    max_title = Column(Integer, nullable=True)
    max_content = Column(Integer, nullable=True)
    has_api = Column(Integer, default=0)
    enabled = Column(Integer, default=1)  # 0=临时下线（不下发桌面端）
    note = Column(String(200), default="")
    deleted_at = Column(String, nullable=True)  # 软删除时间（非空=已删除，种子不复活）
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class PublishMetricDaily(Base):
    """发布指标日聚合 — 桌面端上报，运营看板展示。"""

    __tablename__ = "publish_metrics_daily"
    __table_args__ = (
        sa.UniqueConstraint("usage_date", "client_id", "platform", name="uq_publish_metric_day"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    usage_date = Column(String, nullable=False)  # YYYY-MM-DD
    client_id = Column(String, default="")  # 桌面端设备稳定哈希（脱敏）
    platform = Column(String, default="")  # 平台 id（如 wechat_mp）
    publish_count = Column(Integer, default=0)
    ok_count = Column(Integer, default=0)
    fail_count = Column(Integer, default=0)
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class PublishReportBatch(Base):
    """发布指标上报批次去重 — 客户端携带 report_id（minTs-maxTs），服务端唯一约束防网络模糊失败重复计数。"""

    __tablename__ = "publish_report_batches"
    __table_args__ = (
        sa.UniqueConstraint("client_id", "report_id", name="uq_publish_report_batch"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String, default="")
    report_id = Column(String, nullable=False)
    ingested_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
class ContentTemplate(Base):
    """官方内容模板库（桌面端运行时下发）— 运营后台维护，bootstrap 下发内置模板。"""

    __tablename__ = "content_templates"

    id = Column(String(64), primary_key=True)  # 如 preset-weekly
    name = Column(String(100), nullable=False)
    category = Column(String(40), default="marketing")  # report | marketing | tutorial | event | daily ...
    title = Column(String(200), default="")
    content = Column(Text, default="")  # Markdown 正文
    platforms = Column(Text, default="[]")  # JSON 数组
    tags = Column(Text, default="[]")  # JSON 数组
    enabled = Column(Integer, default=1)
    sort_order = Column(Integer, default=0)
    deleted_at = Column(String, nullable=True)  # 软删除时间（非空=已删除，种子不复活）
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_by = Column(String(100), default="")


class KeywordWatchlist(Base):
    """关键词监测目录（桌面端运行时下发）— 运营后台维护，桌面端按条目监测热度与飙升告警。"""

    __tablename__ = "keyword_watchlist"

    id = Column(Integer, primary_key=True, autoincrement=True)
    keyword = Column(String(100), unique=True, nullable=False)
    category = Column(String(40), default="topic")
    threshold = Column(Float, default=2.0)  # 飙升检测倍数
    interval_minutes = Column(Integer, default=360)  # 轮询间隔（分钟）
    enabled = Column(Integer, default=1)
    sort_order = Column(Integer, default=0)
    deleted_at = Column(String, nullable=True)  # 软删（不复活）
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_by = Column(String(100), default="")
class RedemptionCode(Base):
    """兑换码管理 — 运营后台签发（与桌面端 redemption-codes.js HMAC 格式一致），吊销/查询。"""

    __tablename__ = "redemption_codes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(32), unique=True, nullable=False)  # MP-XXXX-XXXX-XXXX-SIG（列表掩码，操作按 id）
    plan = Column(String(20), default="pro")  # free | trial | pro
    batch_id = Column(String(32), default="")
    status = Column(String(20), default="active")  # active | revoked
    expires_at = Column(String, nullable=True)  # ISO 或空
    note = Column(String(200), default="")
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_by = Column(String(100), default="")


class PipelineDependency(Base):
    """流水线所需依赖 — 视频创作流水线 → 模型类型 + 候选供应商（运营后台维护）。"""

    __tablename__ = "pipeline_dependencies"
    __table_args__ = (
        sa.UniqueConstraint("pipeline_id", "model_type", name="uq_pipeline_dep_type"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    pipeline_id = Column(String(64), nullable=False)  # 如 story2video-compose
    pipeline_name = Column(String(100), default="")
    model_type = Column(String(30), nullable=False)  # llm | tts | speech_recognition | image | video | audio | multimodal
    required = Column(Integer, default=1)  # 0=可选
    provider_candidates = Column(Text, default="[]")  # JSON 数组（供应商 id）
    default_provider = Column(String(64), default="")
    description = Column(String(200), default="")
    enabled = Column(Integer, default=1)
    sort_order = Column(Integer, default=0)
    deleted_at = Column(String, nullable=True)  # 软删（不复活，可重建）
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_by = Column(String(100), default="")



class DiagnosticsDaily(Base):
    """视频创作失败诊断日聚合 — 桌面端脱敏上报，运营后台看板数据源。

    唯一键 (diag_date, client_id, pipeline)：同桶多次上报累加（幂等）。
    """

    __tablename__ = "diagnostics_daily"
    __table_args__ = (
        sa.UniqueConstraint("diag_date", "client_id", "pipeline", name="uq_diagnostics_daily_bucket"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    diag_date = Column(String, nullable=False)  # YYYY-MM-DD（桌面端本地日期）
    client_id = Column(String, default="")  # 桌面端设备稳定哈希（脱敏）
    pipeline = Column(String, default="")
    total_runs = Column(Integer, default=0)
    failed_runs = Column(Integer, default=0)
    success_runs = Column(Integer, default=0)
    cancelled_runs = Column(Integer, default=0)
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class DiagnosticsSample(Base):
    """失败诊断白名单样本（默认 30 天滚动保留）— 供运营查看明细与根因。

    env_json 仅含白名单键（disk_free_bytes / python_backend），服务端再校验丢弃未知键。
    """

    __tablename__ = "diagnostics_samples"
    __table_args__ = (
        sa.UniqueConstraint("client_id", "run_id", name="uq_diagnostics_sample_run"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    diag_date = Column(String, nullable=False)
    client_id = Column(String, default="")
    run_id = Column(String, nullable=False)
    pipeline = Column(String, default="")
    status = Column(String, default="failed")
    stage = Column(String, default="unknown")
    failure_type = Column(String, default="unknown")
    severity = Column(String, default="unknown")
    recoverability = Column(String, default="unknown")
    cause_id = Column(String, default="")
    duration_ms = Column(Integer, default=0)
    env_json = Column(Text, default="{}")
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class DiagnosticsBatch(Base):
    """诊断上报批次去重 — 客户端携带 batch_id，服务端唯一约束防超时重试翻倍。"""

    __tablename__ = "diagnostics_batches"
    __table_args__ = (
        sa.UniqueConstraint("client_id", "batch_id", name="uq_diagnostics_batch"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(String, default="")
    batch_id = Column(String, nullable=False)
    max_id = Column(Integer, default=0)  # 该批次覆盖的客户端队列最大 id（超时重试判重回传用）
    ingested_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class SceneContextRules(Base):
    """Story2Video 场景上下文规则（运营后台管理，导出后随桌面发布/配置覆盖）。"""

    __tablename__ = "scene_context_rules"

    key = Column(String(64), primary_key=True)  # 固定 'default'
    version = Column(Integer, default=1)
    content = Column(Text, default="")  # 规则 JSON 文本
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_by = Column(String(100), default="")

class PromptEvalCase(Base):
    """提示词评测 case（运营后台评测工作台）— 原文 + 优化后提示词（中英对照）。"""

    __tablename__ = "prompt_eval_cases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), default="")
    source_mode = Column(String(16), default="manual")  # manual / scene
    source_text = Column(Text, nullable=False)
    context = Column(Text, nullable=True)
    prompt_zh = Column(Text, nullable=False)
    prompt_en = Column(Text, nullable=True)
    prompt_en_source = Column(String(32), nullable=True)  # machine_translation / manual
    prompt_en_translated_at = Column(String, nullable=True)
    prompt_en_cache_zh = Column(Text, nullable=True)  # 幂等缓存键（prompt_zh 快照）
    media_type = Column(String(16), default="image", nullable=False)  # image / video（v2）
    provider = Column(String(64), nullable=False)
    model = Column(String(128), nullable=False)
    image_count = Column(Integer, default=1)
    aspect_ratio = Column(String(16), default="1:1")
    compare_mode = Column(String(16), default="single")  # single / dual（双路对比：人工 vs 引擎优化）
    engine_params = Column(Text, nullable=True)  # JSON：{creative_level, num_candidates, excluded_characters, no_swap_pairs}（dual 用，v1 默认空）
    created_by = Column(String(100), default="")
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    deleted_at = Column(String, nullable=True)  # 软删


class PromptEvalRun(Base):
    """提示词评测 run（生成 + 评估 状态机）。"""

    __tablename__ = "prompt_eval_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(Integer, ForeignKey("prompt_eval_cases.id"), nullable=False, index=True)
    scene_id = Column(Integer, ForeignKey("prompt_eval_scenes.id"), nullable=True, index=True)
    provider = Column(String(64), nullable=False)
    model = Column(String(128), nullable=False)
    status = Column(String(16), default="queued")  # queued/processing/succeeded/failed
    image_paths = Column(Text, nullable=True)  # JSON 数组（落盘/COS URL）
    video_path = Column(String(512), nullable=True)  # 视频文件相对路径（video case）
    video_frames = Column(Text, nullable=True)  # JSON 数组（首/中/尾 3 帧文件名）
    eval_status = Column(String(16), default="pending")  # pending/succeeded/failed
    overall_score = Column(Float, nullable=True)
    grade = Column(String(16), nullable=True)
    dimensions = Column(Text, nullable=True)  # JSON
    problems = Column(Text, nullable=True)  # JSON
    optimization_points = Column(Text, nullable=True)  # JSON
    error = Column(Text, nullable=True)  # 阶段 + 原因
    prompt_variant = Column(String(16), default="manual")  # manual / engine（双路对比变体）
    prompt_source_zh = Column(Text, nullable=True)  # A 路（manual 原版 prompt_zh）快照，对比用
    engine_meta = Column(Text, nullable=True)  # JSON：pair_id/creative_level/num_candidates/max_length/模型/耗时
    prompt_zh = Column(Text, nullable=True)  # 变体 prompt_zh 快照（engine 变体填充；manual 为空则回退 case）
    prompt_en = Column(Text, nullable=True)  # 变体 prompt_en 快照（engine 变体填充）
    created_by = Column(String(100), default="")
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    completed_at = Column(String, nullable=True)


class PromptEvalProviderKey(Base):
    """评测生成/评估 provider 密钥（admin 维护，加密存储，不返回明文）。"""

    __tablename__ = "prompt_eval_provider_keys"
    __table_args__ = (sa.UniqueConstraint("provider", "model", name="uq_prompt_eval_provider_key"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    provider = Column(String(64), nullable=False)
    model = Column(String(128), nullable=False)
    key_enc = Column(Text, nullable=False)
    base_url = Column(String(255), default="")
    enabled = Column(Integer, default=1)
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_by = Column(String(100), default="")
    is_default = Column(Integer, default=0)  # LLM/视觉/生图用途分组唯一默认标记

class PromptEvalScene(Base):
    """提示词评测场景层（scene 模式）：场景文字 + 字幕二次分句 + 场景上下文 + 中英优化提示词。"""

    __tablename__ = "prompt_eval_scenes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(Integer, ForeignKey("prompt_eval_cases.id"), nullable=False, index=True)
    index = Column(Integer, nullable=False)
    scene_text = Column(Text, nullable=False)
    subtitle_blocks = Column(Text, nullable=True)  # JSON [{text, displayOrder, startTime, duration}]
    scene_context = Column(Text, nullable=True)  # JSON（白名单键）
    prompt_zh = Column(Text, nullable=True)
    prompt_en = Column(Text, nullable=True)
    prompt_en_source = Column(String(32), nullable=True)
    prompt_en_translated_at = Column(String, nullable=True)
    prompt_en_cache_zh = Column(Text, nullable=True)  # 幂等缓存键（prompt_zh 快照）
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())


class PipelineOption(Base):
    __tablename__ = "pipeline_options"
    id = Column(Integer, primary_key=True, autoincrement=True)
    option_key = Column(String(128), unique=True, nullable=False)
    group = Column(String(32), nullable=False)
    field = Column(String(64), nullable=False)
    label = Column(String(100), default="")
    visible = Column(Integer, default=1)
    default_value = Column(Text, default="")
    description = Column(String(200), default="")
    sort_order = Column(Integer, default=0)
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_by = Column(String(100), default="")


class AppMenuItem(Base):
    """应用端左侧边栏菜单项 — 运营中心「应用菜单」页管理显示/隐藏与排序（2026-09-15）。

    item_key 与桌面端 apps/desktop/src/config/sidebar-menu.js 的 key 一一对应，
    是跨端唯一契约；一旦发布不得改名（改名会导致旧配置失效并被应用端忽略）。
    """

    __tablename__ = "app_menu_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    item_key = Column(String(64), unique=True, nullable=False)
    label = Column(String(100), default="")
    group = Column(String(16), nullable=False)  # primary（一级导航）| more（「更多」折叠菜单）
    visible = Column(Integer, default=1)
    forced_visible = Column(Integer, default=0)  # 1 = 强制显示（运营端开关灰显不可关闭）
    sort_order = Column(Integer, default=0)
    description = Column(String(200), default="")
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_by = Column(String(100), default="")


class RewriteStrategy(Base):
    """改写策略模板 — 运营端管理桌面端改写引擎的策略配置。"""

    __tablename__ = "rewrite_strategies"

    id = Column(String(100), primary_key=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, default="")
    version = Column(String(20), default="1.0.0")
    category = Column(String(40), default="viral")
    industry = Column(Text, default="[]")
    purpose = Column(Text, default="[]")
    tone = Column(Text, default="[]")
    platforms = Column(Text, default="[]")
    system_prompt = Column(Text, nullable=False, default="")
    user_prompt_template = Column(Text, nullable=False, default="")
    post_process_config = Column(Text, default="{}")
    extra_metadata = Column(Text, default="{}")
    enabled = Column(Integer, default=1)
    sort_order = Column(Integer, default=0)
    deleted_at = Column(String, nullable=True)
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_by = Column(String(100), default="")


class RewriteHardConstraint(Base):
    """改写硬约束 — 最高优先级的改写规则，无论模式/策略如何选择都强制生效。

    多版本管理，唯一默认（is_default=1 的记录至多一条，由 service 层事务保证）。
    桌面端经 runtime/bootstrap 下发默认版本，注入引擎 systemPrompt 最前置。
    """

    __tablename__ = "rewrite_hard_constraints"

    id = Column(String(100), primary_key=True)
    title = Column(String(200), nullable=False, default="")
    content = Column(Text, nullable=False, default="")
    description = Column(Text, default="")
    is_default = Column(Integer, default=0)
    enabled = Column(Integer, default=1)
    deleted_at = Column(String, nullable=True)
    created_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_at = Column(String, default=lambda: datetime.datetime.utcnow().isoformat())
    updated_by = Column(String(100), default="")
