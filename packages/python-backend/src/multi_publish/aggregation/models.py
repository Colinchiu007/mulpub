"""Pydantic models for aggregation API."""

from __future__ import annotations

from typing import Optional, Literal
from pydantic import BaseModel, Field, field_validator, model_validator
from ._user_errors import UserVisibleError


# Supported source types (Phase 1: headless-only sources)
SUPPORTED_SOURCE_TYPES = {
    "url",      # URL 正文提取 (trafilatura)
    "rss",      # RSS feed
    "sitemap",  # Sitemap
    "api",      # Custom API
}

# Source types requiring Playwright (Phase 1 deferred)
PLAYWRIGHT_SOURCE_TYPES = {
    "youtube", "tiktok", "douyin", "xiaohongshu", "wechat",
    "twitter", "douyin_hot", "weibo_hot", "wangyi",
}

# Rewrite styles (from content-aggregator v2 rewrite.py)
REWRITE_STYLES = {
    "轻松易懂", "正式严谨", "吸引眼球", "深度分析", "认知锚点",
}

# Rewrite strategies (from content-aggregator v1)
REWRITE_STRATEGIES = {
    "summarize", "style_transfer", "paraphrase", "rewrite", "expand", "short_video",
}


class CollectRequest(BaseModel):
    """单篇采集请求"""
    url: str = Field(..., description="目标 URL")
    source_type: str = Field(default="url", description="采集源类型")
    rewrite: bool = Field(default=False, description="是否同时改写")
    strategy: Optional[str] = Field(default=None, description="改写策略")
    seo: bool = Field(default=False, description="是否 SEO 优化")

    @field_validator("source_type")
    @classmethod
    def validate_source_type(cls, v: str) -> str:
        valid = SUPPORTED_SOURCE_TYPES | PLAYWRIGHT_SOURCE_TYPES
        if v not in valid:
            raise UserVisibleError(
                "AGGREGATION_SOURCE_TYPE_UNSUPPORTED",
                f"不支持的 source_type: {v}，支持: {', '.join(sorted(valid))}",
                params={"value": v, "supported": ", ".join(sorted(valid))},
            )
        if v in PLAYWRIGHT_SOURCE_TYPES:
            raise ValueError(
                f"source_type '{v}' 需要 Playwright 浏览器支持，Phase 1 暂不支持。"
                f"支持的无头源: {', '.join(sorted(SUPPORTED_SOURCE_TYPES))}"
            )
        return v

    @field_validator("strategy")
    @classmethod
    def validate_strategy(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in REWRITE_STRATEGIES:
            raise UserVisibleError(
                "AGGREGATION_SOURCE_TYPE_UNSUPPORTED",
                f"不支持的 strategy: {v}，支持: {', '.join(sorted(REWRITE_STRATEGIES))}",
                params={"value": v, "supported": ", ".join(sorted(REWRITE_STRATEGIES))},
            )
        return v


class BatchCollectRequest(BaseModel):
    """批量采集请求"""
    source_type: str = Field(..., description="采集源类型")
    rewrite: bool = Field(default=True, description="是否改写")
    strategy: Optional[str] = Field(default=None, description="改写策略")
    limit: Optional[int] = Field(default=20, ge=1, le=100, description="每源最大采集数")

    @field_validator("source_type")
    @classmethod
    def validate_source_type(cls, v: str) -> str:
        valid = SUPPORTED_SOURCE_TYPES | PLAYWRIGHT_SOURCE_TYPES
        if v not in valid:
            raise UserVisibleError(
                "AGGREGATION_SOURCE_TYPE_UNSUPPORTED",
                f"不支持的 source_type: {v}",
                params={"value": v, "supported": ", ".join(sorted(SUPPORTED_SOURCE_TYPES))},
            )
        if v in PLAYWRIGHT_SOURCE_TYPES:
            raise ValueError(
                f"source_type '{v}' 需要 Playwright 浏览器支持，Phase 1 暂不支持。"
            )
        return v


class CollectResult(BaseModel):
    """采集结果"""
    title: str = ""
    content: str = ""
    original_title: str = ""
    source_url: str = ""
    author: str = ""
    word_count: int = 0
    summary: str = ""
    tags: list[str] = Field(default_factory=list)
    metadata: dict = Field(default_factory=dict)
    # 视频采集扩展字段（可选，默认值保证旧数据/旧客户端兼容）
    media_type: str = Field(default="article", description="媒体类型: article(图文)/video(视频)")
    video_url: str = Field(default="", description="视频原始链接（仅视频采集）")
    duration: float = Field(default=0.0, description="视频时长（秒，仅视频采集）")
    transcript: str = Field(default="", description="ASR 转写文案（仅视频采集，与 content 同值）")

    @field_validator("media_type")
    @classmethod
    def validate_media_type(cls, v: str) -> str:
        if v not in ("article", "video"):
            raise UserVisibleError(
                "AGGREGATION_SOURCE_TYPE_UNSUPPORTED",
                f"不支持的 media_type: {v}，支持: article, video",
                params={"value": v, "supported": "article, video"},
            )
        return v


class CollectVideoRequest(BaseModel):
    """视频作品采集请求（抖音/小红书）"""
    url: str = Field(..., description="视频作品链接")
    asr_engine: Optional[str] = Field(default=None, description="ASR 引擎覆盖: faster_whisper/sensevoice/siliconflow（默认走 ASR_ENGINE 环境变量）")

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise UserVisibleError("AGGREGATION_URL_EMPTY", "URL 不能为空")
        if not (v.startswith("http://") or v.startswith("https://")):
            raise UserVisibleError("AGGREGATION_URL_INVALID", "URL 必须以 http:// 或 https:// 开头")
        return v

    @field_validator("asr_engine")
    @classmethod
    def validate_asr_engine(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("faster_whisper", "sensevoice", "siliconflow"):
            raise UserVisibleError(
                "AGGREGATION_SOURCE_TYPE_UNSUPPORTED",
                f"不支持的 asr_engine: {v}，支持: faster_whisper, sensevoice, siliconflow",
                params={"value": v, "supported": "faster_whisper, sensevoice, siliconflow"},
            )
        return v


class LlmOverride(BaseModel):
    """请求级 LLM 运行时覆盖（桌面「模型设置」默认模型注入，2026-10-18）。

    三字段均可选，缺省按字段回退进程环境变量（LLM_* > PO_OPENAI_*）。
    ⚠️ api_key 是凭据：只允许用于构造适配器，**不得**写入任何日志/异常文案。
    """
    api_key: Optional[str] = Field(default=None, description="LLM API Key（仅用于调用适配器，禁止落日志）")
    base_url: Optional[str] = Field(default=None, description="OpenAI 兼容 base_url")
    model: Optional[str] = Field(default=None, description="文字推理模型 ID")


class RewriteRequest(BaseModel):
    """改写请求"""
    content: str = Field(..., min_length=1, description="待改写内容（非空即可，无最小字数限制）")
    style: str = Field(default="轻松易懂", description="改写风格")
    length: str = Field(default="keep", description="长度控制: keep/compress/expand")
    # 字数区间控制（2026-09-12）：默认 800-2000；显式传入时优先于 length 三档。
    # rewrite-segment-and-finish-reason（2026-10-20）：上界与 JS 引擎 MAX_OUTPUT_CHARS
    # 对齐（6000 → 50000，随 rewrite-limits-50000 放开）；真源在
    # packages/rewrite-engine/src/rewrite-engine-core.js。
    min_word_count: int = Field(default=800, ge=0, le=49999, description="改写结果最小字数")
    max_word_count: int = Field(default=2000, ge=1, le=50000, description="改写结果最大字数")
    seo_optimize: bool = Field(default=False, description="SEO 优化")
    # v1.4：目标发布平台，透传给质量评估器做平台适配/CTA 等维度评分。
    # 取值与 ContentQualityEvaluator._PLATFORM_KEYWORDS 键一致：
    # 微信 / 抖音 / 小红书 / 知乎 / 微博 / B站 / 通用。
    platform: str = Field(default="通用", description="目标平台（微信/抖音/小红书/知乎/微博/B站/通用）")
    # 桌面「模型设置」注入的默认文字推理模型（可选）：优先级 request.llm > env。
    llm: Optional[LlmOverride] = Field(
        default=None,
        description="请求级 LLM 覆盖（桌面模型设置注入）；缺省字段回退环境变量",
    )

    @field_validator("style")
    @classmethod
    def validate_style(cls, v: str) -> str:
        if v not in REWRITE_STYLES:
            raise UserVisibleError(
                "AGGREGATION_STYLE_UNSUPPORTED",
                f"不支持的 style: {v}，支持: {', '.join(sorted(REWRITE_STYLES))}",
                params={"value": v, "supported": ", ".join(sorted(REWRITE_STYLES))},
            )
        return v

    @field_validator("length")
    @classmethod
    def validate_length(cls, v: str) -> str:
        if v not in {"keep", "compress", "expand"}:
            raise UserVisibleError(
                "AGGREGATION_LENGTH_UNSUPPORTED",
                f"不支持的 length: {v}，支持: keep, compress, expand",
                params={"value": v, "supported": "keep, compress, expand"},
            )
        return v

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        if not v.strip():
            raise UserVisibleError("AGGREGATION_CONTENT_EMPTY", "内容不能为空")
        return v

    @model_validator(mode="after")
    def validate_word_count_range(self) -> "RewriteRequest":
        if self.max_word_count < self.min_word_count:
            raise UserVisibleError(
                "AGGREGATION_WORD_COUNT_RANGE_INVALID",
                f"max_word_count ({self.max_word_count}) 必须大于等于 min_word_count ({self.min_word_count})",
                params={"max": str(self.max_word_count), "min": str(self.min_word_count)},
            )
        return self


class RewriteResult(BaseModel):
    """改写结果"""
    result_content: str = ""
    word_count: int = 0
    style: str = ""
    length: str = ""
    platform: str = "通用"
    quality_report: Optional[dict] = None


class SourceInfo(BaseModel):
    """采集源信息"""
    type: str
    name: str
    description: str
    requires_auth: bool = False
    phase1_available: bool = True


class TaskStatus(BaseModel):
    """采集任务状态"""
    task_id: str
    status: str = "pending"  # pending / running / completed / failed / cancelled
    progress: int = 0
    total_items: int = 0
    processed_items: int = 0
    error: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
