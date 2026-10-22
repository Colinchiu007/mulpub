"""AggregationService — 热文采集和改写服务。

Phase 2: 改写已切换至 content-aggregator-shared（shared 库），
通过 LLMServiceAdapter 注入 Multi-Publish 的 LLMService，
消除两套 LLM 调用逻辑并存。
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import importlib as _importlib


def _lazy_import(module_path: str, attr: str = None):
    """Lazy import with graceful degradation for optional dependencies."""
    try:
        mod = _importlib.import_module(module_path)
        if attr:
            return getattr(mod, attr)
        return mod
    except ImportError:
        return None


from ._user_errors import UserVisibleError
from .models import (
    TaskStatus,
    CollectRequest,
    CollectResult,
    BatchCollectRequest,
    RewriteRequest,
    RewriteResult as RewriteResultModel,
    SourceInfo,
    SUPPORTED_SOURCE_TYPES,
    PLAYWRIGHT_SOURCE_TYPES,
)

logger = logging.getLogger(__name__)

# style→strategy 映射（中文风格名 → v1 RewriteStrategy）
_STYLE_TO_STRATEGY = {
    "轻松易懂": "paraphrase",
    "正式严谨": "style_transfer",
    "吸引眼球": "short_video",
    "深度分析": "expand",
    "认知锚点": "rewrite",
}

# length→字数范围映射：(min, max, target)
#
# 数字的来历（2026-10-21 现场取证）：
#   · keep 的 (300, 3000, 1500) = 外部引擎 `content_aggregator_shared` 的
#     `RewriteConfig` **默认值逐字**（rewriter.py: min=300 / max=3000 / target=1500）
#     ⇒ keep 档的语义就是「用引擎默认配置」。
#   · compress(100,800,400) / expand(800,5000,2500) 是 2026-09-06 `d0a9b00ba`
#     （Phase 1.4，随「长度下拉：保持/精简/扩写」一起进）里人工挑的相对档，
#     以 keep 为轴约缩 1/4 / 放大约 5/3；该提交**没有记录推导过程**。
#   · 它们的时代背景：2026-09 全局输出上限还是 6000 字；后来 `rewrite-limits-50000`
#     （2026-10-19）把引擎上限放到 50000，这三档**没跟着放大** ⇒ keep 的 3000
#     反而成了整套体系里最紧的一道「暗上限」。
#
# 2026-10-21（feat-zhihu-fav-batch-wordcount 的 follow-up）：三档的 **max 统一提到
# 50000**，与引擎输出上限对齐，解除上面那道历史暗上限。
# ⚠️ **target 保持原值**：它才是模型实际落点的锚（prompt 写的是「目标 N 字」），
# max 只是硬上界。改 max = 解除人为上限；改 target 才会改变实际篇幅（那是另一件事）。
#
# 运行时消费链（改 max 不是空操作）：max → `RewriteConfig.max_word_count` →
# 外部引擎把它写进 prompt 的字数区间（「字数要求:{min}-{max}字,目标{target}字」），
# 引擎**不按 max 截断**、只回真实产出字数 ⇒ 放宽 max 的效果是「模型不再被告知
# 一个偏小的上限」，实际篇幅仍由 target 锚定。
_LENGTH_RANGES = {
    "keep": (300, 50000, 1500),
    "compress": (100, 50000, 400),
    "expand": (800, 50000, 2500),
}


def _resolve_target_word_count(min_wc: int, max_wc: int, original_length: int) -> int:
    """推导改写的**目标篇幅**（写进 prompt 的「目标 N 字」）。

    动因（feat-zhihu-fav-batch-wordcount，2026-10-21）：原先显式区间一律用
    **区间中点**当目标（``(min + max) // 2``）。用户把区间设成 0-6000 时目标变成 3000 字：
    对一篇 300 字的知乎回答是「要求写 3000 字」（离谱膨胀），对 5000 字的长文则是「砍掉四成」。
    中点语义对**宽区间**天然失真。

    改法（与 Node 引擎 ``word-count-instruction.js`` 的 min=0 语义对齐）：

    - ``min > 0``：仍是区间中点——用户给了窄区间，中点就是他要的（既有语义不动）；
    - ``min == 0``（**不设下限**）：目标 = ``min(原文长度, 上限)``——与原文篇幅相当且不超上限。
      原文长度未知时取上限。

    注意 ``min == 0`` 只能由**显式传入**走到这里；``length`` 三档路径完全不受影响。
    """
    if min_wc > 0:
        return (min_wc + max_wc) // 2
    if original_length > 0:
        return min(original_length, max_wc)
    return max_wc


class AggregationService:
    """热文采集和改写服务。

    封装 content-aggregator v1 引擎的能力：
    - 单篇 URL 采集（ContentPipeline.process_url）
    - 批量源采集（ContentPipeline.process_all_sources）
    - LLM 改写（shared 库 RewriteProcessor + LLMServiceAdapter）
    """

    def __init__(self, config: dict | None = None):
        self._config = config or {}
        # P1: 内存任务追踪器（task_id → 状态）
        self._tasks: dict[str, dict] = {}

    # ── 采集 ──────────────────────────────────────────────────────────

    async def collect(self, request: CollectRequest) -> CollectResult:
        logger.info(f"[AggregationService] collect: url={request.url}, type={request.source_type}")
        if request.source_type == "url":
            return await self._collect_url(request)
        elif request.source_type == "rss":
            return await self._collect_rss(request)
        elif request.source_type in ("sitemap", "api"):
            return await self._collect_via_pipeline(request)
        else:
            raise ValueError(f"Phase 1 不支持的 source_type: {request.source_type}")

    async def _collect_url(self, request: CollectRequest) -> CollectResult:
        logger.info(f"[AggregationService] _collect_url: url={request.url}")
        url = str(request.url).strip()
        if not url:
            raise ValueError("URL 不能为空")
        # 使用 trafilatura 直接做正文提取（原 pipeline.process_url 对所有 URL 走 RSS 路径导致普通网页提取失败）
        import asyncio
        from urllib.parse import urlparse
        trafilatura = _lazy_import("trafilatura")
        if trafilatura is None:
            raise ImportError("trafilatura 未安装。请运行: pip install trafilatura")
        try:
            html = await asyncio.to_thread(trafilatura.fetch_url, url)
        except Exception as fetch_err:
            raise ValueError(f"URL 无法访问: {fetch_err}") from fetch_err
        if not html:
            raise ValueError(f"URL 无法访问: {url}")
        # 检测反爬安全验证页面（百度家号等返回标题"百度安全验证"但无正文）
        if len(html) < 3000 and ("安全验证" in html or "百度安全" in html or "网络不给力" in html):
            raise ValueError(f"URL 触发安全验证，请尝试在浏览器环境采集: {url}")
        text = await asyncio.to_thread(
            trafilatura.extract,
            html,
            include_links=False,
            include_images=False,
            include_tables=False,
        )
        if not text:
            raise ValueError(f"URL 采集无结果: {url}")
        metadata = trafilatura.extract_metadata(html)
        title = ""
        if metadata and metadata.title:
            title = str(metadata.title).strip()
        if not title:
            parsed = urlparse(url)
            title = parsed.netloc or parsed.path or url
        return CollectResult(
            title=title,
            content=text.strip(),
            source_url=url,
            author=str(metadata.author).strip() if metadata and metadata.author else "",
            word_count=len(text.strip()),
        )

    async def _collect_rss(self, request: CollectRequest) -> CollectResult:
        ContentPipeline = _lazy_import("content_aggregator.workflows.pipeline", "ContentPipeline")
        config = self._build_pipeline_config()
        if ContentPipeline is None:
            raise ImportError("content-aggregator 未安装")
        async with ContentPipeline(config) as pipeline:
            articles = await pipeline.process_url(
                url=str(request.url),
                rewrite=request.rewrite,
                strategy=request.strategy,
                seo=request.seo,
                limit=1,
            )
        if not articles:
            raise ValueError(f"RSS 采集无结果: {request.url}")
        article = articles[0]
        return CollectResult(
            title=article.title,
            content=article.content,
            original_title=article.original_title,
            source_url=article.source_url,
            author=article.author,
            word_count=article.word_count or len(article.content or ""),
            summary=article.summary,
            tags=article.tags,
            metadata=article.metadata,
        )

    async def _collect_via_pipeline(self, request: CollectRequest) -> CollectResult:
        get_collector = _lazy_import("content_aggregator.sources", "get_collector")
        source_config = {"url": str(request.url), "name": request.source_type}
        if get_collector is None:
            raise ImportError("content-aggregator 未安装")
        collector = get_collector(request.source_type, config=source_config)
        result = await collector.collect()
        if not result.data:
            raise ValueError(f"{request.source_type} 采集无结果: {request.url}")
        item = result.data[0]
        content_str = item.get("content", "") or item.get("summary", "") or ""
        title_str = item.get("title", "") or ""
        return CollectResult(
            title=title_str,
            content=content_str,
            source_url=item.get("url", str(request.url)),
            author=item.get("author", ""),
            word_count=len(content_str),
            summary=item.get("summary", ""),
            metadata=item.get("metadata", {}),
        )

    async def collect_batch(self, request: BatchCollectRequest) -> list[CollectResult]:
        logger.info(f"[AggregationService] collect_batch: type={request.source_type}")
        ContentPipeline = _lazy_import("content_aggregator.workflows.pipeline", "ContentPipeline")
        config = self._build_pipeline_config()
        if ContentPipeline is None:
            raise ImportError("content-aggregator 未安装")
        async with ContentPipeline(config) as pipeline:
            result = await pipeline.process_all_sources(
                rewrite=request.rewrite,
                limit_per_source=request.limit,
            )
        articles = result.get("articles", [])
        return [
            CollectResult(
                title=a.title,
                content=a.content,
                original_title=a.original_title,
                source_url=a.source_url,
                author=a.author,
                word_count=a.word_count,
                summary=a.summary,
                tags=a.tags,
                metadata=a.metadata,
            )
            for a in articles
        ]

    # ── 改写（P1: 使用 shared 库 + LLMServiceAdapter） ─────────────

    def _resolve_llm_settings(self, request: Optional[RewriteRequest] = None) -> dict:
        """解析 LLM 运行时配置：优先级 request.llm > env（LLM_* > PO_OPENAI_*）。

        逐字段独立回退（api_key / base_url / model 各自判定），与桌面端
        `electron/services/llm-runtime-config.js` 的注入契约一致：
          - 桌面「模型设置」里的默认模型随请求下发的字段优先；
          - 缺失字段回退进程环境变量，保持历史部署（只配 env）可用。

        安全：返回的 api_key 只用于构造适配器；本方法及其调用方**不得**把密钥写日志。
        """
        override = getattr(request, "llm", None) if request is not None else None

        def _override(name: str) -> Optional[str]:
            value = getattr(override, name, None) if override is not None else None
            if isinstance(value, str) and value.strip():
                return value.strip()
            return None

        api_key = (
            _override("api_key")
            or os.environ.get("LLM_API_KEY")
            or os.environ.get("PO_OPENAI_API_KEY", "")
        )
        base_url = (
            _override("base_url")
            or os.environ.get("LLM_BASE_URL")
            or os.environ.get("PO_OPENAI_BASE_URL", "")
        )
        model = (
            _override("model")
            or os.environ.get("LLM_MODEL")
            or os.environ.get("PO_OPENAI_MODEL", "gpt-4o-mini")
        )
        return {"api_key": api_key, "base_url": base_url, "model": model}

    async def rewrite(self, request: RewriteRequest) -> RewriteResultModel:
        logger.info(f"[AggregationService] rewrite: style={request.style}, length={request.length}")
        # 输入校验：仅拦截空内容（2026-09-12 移除 20 字下限，非空即可改写）
        if not (request.content or "").strip():
            raise UserVisibleError("AGGREGATION_CONTENT_EMPTY", "输入内容不能为空")
        # 前置校验：未配置 LLM API Key 时返回稳定错误码，由前端 locale 渲染友好文案。
        # 2026-10-18：请求可携带桌面「模型设置」解析出的 llm（request.llm > env）。
        llm_settings = self._resolve_llm_settings(request)
        if not llm_settings["api_key"]:
            raise UserVisibleError("LLM_KEY_MISSING", "AI 改写服务尚未配置访问密钥")
        # 从 shared 库导入（替代旧 content_aggregator.xxx 路径）
        RewriteProcessor = _lazy_import("content_aggregator_shared.shared.rewriters.rewriter", "RewriteProcessor")
        RewriteConfig = _lazy_import("content_aggregator_shared.shared.rewriters.rewriter", "RewriteConfig")
        RewriteStrategy = _lazy_import("content_aggregator_shared.shared.rewriters.rewriter", "RewriteStrategy")
        Content = _lazy_import("content_aggregator_shared.shared.models", "Content")

        if RewriteProcessor is None or RewriteConfig is None or Content is None:
            raise ImportError("content-aggregator-shared 未安装。请运行: pip install content-aggregator-shared")

        # P1: 使用 LLMServiceAdapter 注入 Multi-Publish 的 LLMService
        # 2026-10-18：request.llm（桌面模型设置）优先于 env，见 _resolve_llm_settings
        llm_client = self._build_llm_adapter(request)

        config = self._build_pipeline_config(request)
        config["_llm_client"] = llm_client

        content_obj = Content(
            id="",
            source_id="",
            title="",
            content=request.content,
            source_type="manual",
            url="",
        )
        strategy_name = _STYLE_TO_STRATEGY.get(request.style, "rewrite")
        # 字数区间优先级：显式传入的 min/max_word_count > length 三档映射
        # （前端始终传 min/max_word_count；旧客户端只传 length 时走三档映射，
        #   用 model_fields_set 区分"显式提供"与"模型默认值"，避免默认值吞掉 length 路径）
        fields_set = request.model_fields_set
        if "min_word_count" in fields_set and "max_word_count" in fields_set:
            min_wc = request.min_word_count
            max_wc = request.max_word_count
            # 目标篇幅不再用区间中点（宽区间下中点会把内容砍一半/撑爆短文），
            # 语义见 _resolve_target_word_count 的注释。
            target_wc = _resolve_target_word_count(min_wc, max_wc, len(request.content or ""))
        else:
            min_wc, max_wc, target_wc = _LENGTH_RANGES.get(request.length, (300, 3000, 1500))
        rewrite_cfg = RewriteConfig(
            strategy=RewriteStrategy(strategy_name),
            min_word_count=min_wc,
            max_word_count=max_wc,
            target_word_count=target_wc,
        )
        async with RewriteProcessor(config) as proc:
            result = await proc.rewrite(content_obj, rewrite_cfg)
        if not result.success:
            # 改写引擎失败兜底：错误码化（原始 error 进日志，不直出 UI）
            logger.warning(f"[AggregationService] rewrite engine failed: {result.error}")
            raise UserVisibleError("AGGREGATION_REWRITE_FAILED", "AI 改写未能完成，请稍后重试")
        result_model = RewriteResultModel(
            result_content=result.rewritten_content,
            word_count=len(result.rewritten_content),
            style=request.style,
            length=request.length,
            platform=request.platform,
        )
        try:
            from .quality import ContentQualityEvaluator
            evaluator = ContentQualityEvaluator()
            report = evaluator.evaluate(
                result.rewritten_content,
                original_content=request.content,
                platform=request.platform,
            )
            from .quality import serialize_quality_report

            result_model.quality_report = serialize_quality_report(report)
        except Exception as e:
            logger.warning(f"[AggregationService] quality evaluation failed: {e}")
        return result_model

    def _build_llm_adapter(self, request: Optional[RewriteRequest] = None):
        """构造 LLMServiceAdapter，将 Multi-Publish LLMService 注入改写器。

        优先级：request.llm（桌面「模型设置」注入）> LLM_* > PO_OPENAI_*（向下兼容），
        逐字段回退，见 _resolve_llm_settings。
        无 API key 时返回 None，让 RewriteProcessor 使用默认 LLMClient。
        """
        LLMService = _lazy_import("multi_publish.services.llm_service", "LLMService")
        LLMServiceAdapter = _lazy_import("content_aggregator_shared.shared.clients.llm_service_adapter", "LLMServiceAdapter")

        if LLMService is None or LLMServiceAdapter is None:
            logger.warning("[AggregationService] LLMService 或 LLMServiceAdapter 不可用，"
                           "RewriteProcessor 将使用默认 LLMClient")
            return None

        settings = self._resolve_llm_settings(request)
        api_key = settings["api_key"]
        if not api_key:
            logger.warning("[AggregationService] 未配置 LLM API Key，"
                           "RewriteProcessor 将使用默认 LLMClient")
            return None

        # 注意：仅 api_key 进入适配器配置，不写任何日志（避免凭据进日志）
        svc = LLMService(config={
            "api_key": api_key,
            "base_url": settings["base_url"],
            "model": settings["model"],
        })
        return LLMServiceAdapter(svc)

    # ── 源管理 ────────────────────────────────────────────────────────

    def get_available_sources(self) -> list[SourceInfo]:
        sources = [
            SourceInfo(type="url", name="URL 正文提取", description="输入任意 URL，自动提取正文内容（基于 trafilatura）", requires_auth=False, phase1_available=True),
            SourceInfo(type="rss", name="RSS 订阅源", description="输入 RSS 地址，采集订阅源中的文章", requires_auth=False, phase1_available=True),
            SourceInfo(type="sitemap", name="Sitemap", description="从网站 Sitemap 中提取文章列表", requires_auth=False, phase1_available=True),
            SourceInfo(type="api", name="自定义 API", description="从自定义 API 端点采集内容", requires_auth=False, phase1_available=True),
        ]
        phase2 = [
            ("youtube", "YouTube", "YouTube 视频字幕提取（需要 API Key）"),
            ("douyin", "抖音", "抖音视频采集（需要 Cookie）"),
            ("xiaohongshu", "小红书", "小红书笔记采集（需要 Cookie）"),
            ("wechat", "微信公众号", "微信公众号文章采集（需要 API Key）"),
            ("weibo_hot", "微博热点", "微博热榜采集（免登录）"),
            ("wangyi", "网易新闻", "网易新闻频道采集（免登录）"),
            ("twitter", "Twitter/X", "Twitter 推文采集（需要 Bearer Token）"),
            ("tiktok", "TikTok", "TikTok 视频采集（需要 Session Cookie）"),
        ]
        for st, nm, ds in phase2:
            sources.append(SourceInfo(type=st, name=nm, description=ds, requires_auth=True, phase1_available=False))
        return sources

    # ── 任务状态追踪（P1: 内存任务追踪器，替代占位实现） ────────────

    def get_task_status(self, task_id: str) -> TaskStatus | None:
        """获取采集任务状态。"""
        entry = self._tasks.get(task_id)
        if entry is None:
            return None
        return TaskStatus(
            task_id=task_id,
            status=entry["status"],
            progress=entry.get("progress", 0),
            total_items=entry.get("total_items", 0),
            processed_items=entry.get("processed_items", 0),
            error=entry.get("error"),
            created_at=entry.get("created_at"),
            updated_at=entry.get("updated_at"),
        )

    def _create_task(self, total_items: int = 0) -> str:
        """创建采集任务并返回 task_id。"""
        task_id = str(uuid.uuid4())[:8]
        now = datetime.now(timezone.utc).isoformat()
        self._tasks[task_id] = {
            "status": "pending",
            "progress": 0,
            "total_items": total_items,
            "processed_items": 0,
            "error": None,
            "created_at": now,
            "updated_at": now,
        }
        return task_id

    def _update_task(self, task_id: str, **kwargs):
        """更新任务状态。"""
        entry = self._tasks.get(task_id)
        if entry is None:
            return
        entry.update(kwargs)
        entry["updated_at"] = datetime.now(timezone.utc).isoformat()

    # ── 配置 ──────────────────────────────────────────────────────────

    def _build_pipeline_config(self, request: Optional[RewriteRequest] = None) -> dict:
        """构建 ContentPipeline 配置。

        LLM 配置优先级：request.llm（桌面「模型设置」注入）> Multi-Publish 标准环境变量
        (LLM_*) > PO_OPENAI_*（旧 content-aggregator 约定），逐字段回退。
        """
        settings = self._resolve_llm_settings(request)
        return {
            "llm": {
                "api_key": settings["api_key"],
                "model": settings["model"],
                "base_url": settings["base_url"] or "https://api.openai.com/v1",
            },
            "export": {"output_dir": "./output/aggregation"},
            "http": {
                "timeout": 30,
                "proxy": os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY"),
            },
            "filter": {
                "sensitive": {"enabled": True, "strict_mode": False},
                "dedup": {"enabled": True, "similarity_threshold": 0.8},
            },
            "sources": {},
        }
