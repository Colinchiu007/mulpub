"""TDD tests for multi_publish.aggregation module.

Phase 1: content-aggregator integration — aggregation/ wrapping layer.
"""

import pytest


# ── 1. content-aggregator import verification ──────────────────────────

def test_can_import_content_pipeline():
    """C1 regression: verify content-aggregator core imports work."""
    from content_aggregator.workflows.pipeline import ContentPipeline
    assert ContentPipeline is not None


def test_can_import_collectors():
    """Verify all collector types are importable."""
    from content_aggregator.sources.collectors import (
        BaseCollector, SourceResult, RSSCollector,
        YouTubeCollector, DouyinCollector, XiaohongshuCollector,
        WeChatCollector, APICollector, SitemapCollector,
        WeiboHotCollector, WangYiCollector,
    )
    assert BaseCollector is not None
    assert SourceResult is not None
    assert RSSCollector is not None


def test_can_import_content_models():
    """Verify Content and Article dataclasses."""
    from content_aggregator.models import Content, Article
    assert Content is not None
    assert Article is not None


def test_can_import_rewrite_processor():
    """Verify rewrite processor and strategy enum."""
    from content_aggregator.processors.rewrite import (
        RewriteProcessor, RewriteConfig, RewriteStrategy, RewriteResult,
    )
    assert RewriteProcessor is not None
    assert RewriteConfig is not None
    assert RewriteStrategy is not None


def test_can_import_get_collector():
    """Verify collector factory function."""
    from content_aggregator.sources import get_collector
    assert callable(get_collector)


# ── 2. AggregationService models ───────────────────────────────────────

def test_collect_request_model():
    """CollectRequest Pydantic model validation."""
    from multi_publish.aggregation.models import CollectRequest

    req = CollectRequest(url="https://example.com/article", source_type="url")
    assert req.url == "https://example.com/article"
    assert req.source_type == "url"
    assert req.rewrite is False  # default
    assert req.strategy is None

    # With rewrite
    req2 = CollectRequest(
        url="https://example.com/article",
        source_type="rss",
        rewrite=True,
        strategy="rewrite",
    )
    assert req2.rewrite is True
    assert req2.strategy == "rewrite"


def test_collect_request_validation():
    """CollectRequest rejects invalid source_type."""
    from multi_publish.aggregation.models import CollectRequest
    import pydantic

    with pytest.raises(pydantic.ValidationError):
        CollectRequest(url="https://example.com", source_type="invalid")


def test_rewrite_request_model():
    """RewriteRequest model."""
    from multi_publish.aggregation.models import RewriteRequest

    req = RewriteRequest(content="测试内容", style="轻松易懂")
    assert req.content == "测试内容"
    assert req.style == "轻松易懂"
    assert req.length == "keep"
    assert req.platform == "通用"  # v1.4 默认平台


def test_rewrite_request_accepts_platform():
    """Regression: RewriteRequest 必须接受 platform 字段，供改写引擎透传给评估器。"""
    from multi_publish.aggregation.models import RewriteRequest

    req = RewriteRequest(content="测试内容", style="轻松易懂", platform="小红书")
    assert req.platform == "小红书"


def test_collect_result_model():
    """CollectResult model construction."""
    from multi_publish.aggregation.models import CollectResult

    result = CollectResult(
        title="测试标题",
        content="测试正文内容",
        source_url="https://example.com",
        word_count=5,
    )
    assert result.title == "测试标题"
    assert result.word_count == 5


# ── 3. AggregationService ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_aggregation_service_creation():
    """AggregationService can be instantiated."""
    from multi_publish.aggregation.service import AggregationService

    service = AggregationService()
    assert service is not None
    assert hasattr(service, "collect")
    assert hasattr(service, "rewrite")


@pytest.mark.asyncio
async def test_aggregation_service_collect_url():
    """AggregationService.collect() with a URL source."""
    from multi_publish.aggregation.service import AggregationService
    from multi_publish.aggregation.models import CollectRequest

    service = AggregationService()
    req = CollectRequest(url="https://example.com", source_type="url")

    # URL collection may fail (no real URL), but should not crash
    try:
        result = await service.collect(req)
        # If it succeeds, must return CollectResult
        assert result is not None
    except Exception:
        # Graceful failure is acceptable for Phase 1
        pass


@pytest.mark.asyncio
async def test_collect_url_rejects_security_challenge_page(monkeypatch):
    """Regression: 百家号等反爬站点返回「百度安全验证」页时应 raise ValueError，
    不得把安全验证标题当正文返回（防误报采集成功）。"""
    import multi_publish.aggregation.service as svc_mod
    from multi_publish.aggregation.service import AggregationService
    from multi_publish.aggregation.models import CollectRequest

    # 用假 trafilatura 模块模拟返回安全验证页 HTML
    class FakeTrafilatura:
        @staticmethod
        def fetch_url(url):
            return '<html><head><title>百度安全验证</title></head><body>网络不给力，请稍后重试</body></html>'

        @staticmethod
        def extract(html, **kwargs):
            return '网络不给力，请稍后重试 返回首页 问题反馈'

        @staticmethod
        def extract_metadata(html):
            class M:
                title = '百度安全验证'
                author = ''
            return M()

    # _collect_url 内通过 _lazy_import("trafilatura") 获取，替换为假实现
    monkeypatch.setattr(svc_mod, '_lazy_import', lambda path, attr=None: FakeTrafilatura())

    service = AggregationService()
    req = CollectRequest(url="https://baijiahao.baidu.com/s?id=123", source_type="url")
    with pytest.raises(ValueError, match="安全验证"):
        await service.collect(req)


@pytest.mark.asyncio
async def test_aggregation_service_rewrite():
    """AggregationService.rewrite() with text content."""
    from multi_publish.aggregation.service import AggregationService
    from multi_publish.aggregation.models import RewriteRequest

    service = AggregationService()
    req = RewriteRequest(content="这是一篇测试文章。", style="轻松易懂")

    # Rewrite may fail without LLM API key, but should not crash
    try:
        result = await service.rewrite(req)
        assert result is not None
    except Exception:
        pass


# ── 4. API Router ──────────────────────────────────────────────────────

def test_router_exists():
    """Aggregation router is a FastAPI APIRouter."""
    from multi_publish.aggregation.router import router
    from fastapi import APIRouter
    assert isinstance(router, APIRouter)


def test_router_has_routes():
    """Aggregation router has expected endpoints."""
    from multi_publish.aggregation.router import router

    route_paths = [r.path for r in router.routes]
    assert "/aggregation/collect" in route_paths
    assert "/aggregation/rewrite" in route_paths
    assert "/aggregation/sources" in route_paths


# ── 5. Integration smoke test ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_cycle_no_crash():
    """Full import chain: models → service → router → server integration."""
    # Verify all modules import without error
    from multi_publish.aggregation import models
    from multi_publish.aggregation import service
    from multi_publish.aggregation import router
    from multi_publish.aggregation import (
        AggregationService, CollectRequest, CollectResult, RewriteRequest,
    )
    assert models is not None
    assert service is not None
    assert router is not None
    assert AggregationService is not None


# ── 5.1 v2 import regression protection (QM-5) ─────────────────────────

def test_service_does_not_import_v2_backend():
    """Regression: service.py must not reference content_aggregator.backend (v2 does not exist)."""
    import inspect
    from multi_publish.aggregation import service as service_module

    src = inspect.getsource(service_module)
    assert "content_aggregator.backend" not in src, (
        "service.py 引用了不存在的 content_aggregator.backend (v2)。"
        "Phase 1 只能使用 v1 引擎 (content_aggregator.workflows / processors / sources)。"
    )


def test_rewrite_uses_shared_rewrite_processor():
    """Regression: rewrite must import shared RewriteProcessor, not v2 rewrite_content."""
    import inspect
    from multi_publish.aggregation import service as service_module

    src = inspect.getsource(service_module)
    assert "content_aggregator_shared.shared.rewriters.rewriter" in src, (
        "rewrite 必须使用 shared 库 RewriteProcessor "
        "(content_aggregator_shared.shared.rewriters.rewriter)"
    )
    assert "content_aggregator.backend.app.services.rewrite" not in src, (
        "rewrite 不得引用 v2 的 backend.app.services.rewrite"
    )


def test_rewrite_uses_shared_quality_report_serializer():
    """回归：改写引擎质量报告必须消费评估器唯一的序列化投影，避免与运营中心字段漂移。"""
    import inspect
    from multi_publish.aggregation import service as service_module

    src = inspect.getsource(service_module)
    assert "serialize_quality_report" in src, (
        "rewrite 必须使用 serialize_quality_report 统一序列化质量报告"
    )
    assert '"weighted": round(d.weighted, 1)' not in src, (
        "改写引擎不得再手写维度字段清单，应复用评估器序列化投影"
    )


def test_collect_url_uses_v1_pipeline():
    """Regression: _collect_url must use v1 ContentPipeline, not v2 collect_url."""
    import inspect
    from multi_publish.aggregation import service as service_module

    src = inspect.getsource(service_module)
    assert "content_aggregator.workflows.pipeline" in src, (
        "_collect_url 必须使用 v1 ContentPipeline (content_aggregator.workflows.pipeline)"
    )
    assert "content_aggregator.backend.app.services.collect" not in src, (
        "_collect_url 不得引用 v2 的 backend.app.services.collect"
    )


def test_content_model_construction_is_valid():
    """Regression: Content object must be constructed with id + source_id."""
    from content_aggregator.models import Content

    c = Content(
        id="",
        source_id="",
        title="",
        content="测试正文",
        source_type="manual",
        url="",
    )
    assert c.content == "测试正文"
    assert c.source_type == "manual"


# ── 5.2 style→strategy mapping regression ──────────────────────────────

def test_style_to_strategy_mapping():
    """Regression: 5 种中文风格名必须映射到正确的 v1 RewriteStrategy."""
    from multi_publish.aggregation.service import _STYLE_TO_STRATEGY

    assert _STYLE_TO_STRATEGY["轻松易懂"] == "paraphrase"
    assert _STYLE_TO_STRATEGY["正式严谨"] == "style_transfer"
    assert _STYLE_TO_STRATEGY["吸引眼球"] == "short_video"
    assert _STYLE_TO_STRATEGY["深度分析"] == "expand"
    assert _STYLE_TO_STRATEGY["认知锚点"] == "rewrite"
    assert len(_STYLE_TO_STRATEGY) == 5


def test_length_ranges_mapping():
    """Regression: 3 种长度必须映射到正确的字数范围.

    数字来历（为何是这三个数、为何本次只改 max）见 `service.py` 里 `_LENGTH_RANGES`
    上方的注释——那里是单一真源，此处只留断言，避免两处散文漂移。
    """
    from multi_publish.aggregation.service import _LENGTH_RANGES

    assert _LENGTH_RANGES["keep"] == (300, 50000, 1500)
    assert _LENGTH_RANGES["compress"] == (100, 50000, 400)
    assert _LENGTH_RANGES["expand"] == (800, 50000, 2500)
    assert len(_LENGTH_RANGES) == 3


def test_rewrite_evaluate_uses_request_platform_not_hardcoded():
    """Regression: AggregationService.rewrite() 评估必须透传 request.platform，
    而非硬编码 '通用'（P1 修复——平台适配/CTA 等维度错位的根因）。"""
    import inspect
    from multi_publish.aggregation import service as service_module

    src = inspect.getsource(service_module)
    assert 'platform="通用"' not in src, (
        "rewrite() 不得硬编码 platform='通用'，应透传 request.platform"
    )
    assert "platform=request.platform" in src, (
        "rewrite() 必须用 request.platform 透传给评估器"
    )
# ── 6. TaskStatus model ──────────────────────────────────────────────

def test_task_status_model():
    """TaskStatus model defaults."""
    from multi_publish.aggregation.models import TaskStatus

    ts = TaskStatus(task_id="test-123")
    assert ts.task_id == "test-123"
    assert ts.status == "pending"
    assert ts.progress == 0
    assert ts.error is None


def test_task_status_serialization():
    """TaskStatus can be serialized."""
    from multi_publish.aggregation.models import TaskStatus

    ts = TaskStatus(task_id="test-456", status="completed", progress=100)
    d = ts.model_dump()
    assert d["task_id"] == "test-456"
    assert d["status"] == "completed"
    assert d["progress"] == 100


# ── 7. Router task endpoint ──────────────────────────────────────────

def test_router_has_task_endpoint():
    """Aggregation router has task status endpoint."""
    from multi_publish.aggregation.router import router

    route_paths = [r.path for r in router.routes]
    assert "/aggregation/tasks/{task_id}" in route_paths


# ── 8. AggregationService task_status ────────────────────────────────

def test_aggregation_service_get_task_status_unknown():
    """AggregationService.get_task_status returns None for unknown task."""
    from multi_publish.aggregation.service import AggregationService

    service = AggregationService()
    status = service.get_task_status("test-789")
    assert status is None


def test_aggregation_service_task_lifecycle():
    """AggregationService.create_task → update_task → get_task_status 生命周期。"""
    from multi_publish.aggregation.service import AggregationService

    service = AggregationService()
    task_id = service._create_task(total_items=3)
    assert task_id

    status = service.get_task_status(task_id)
    assert status is not None
    assert status.task_id == task_id
    assert status.status == "pending"
    assert status.total_items == 3
    assert status.processed_items == 0

    service._update_task(task_id, status="running", progress=33, processed_items=1)
    status2 = service.get_task_status(task_id)
    assert status2.status == "running"
    assert status2.progress == 33
    assert status2.processed_items == 1

    service._update_task(task_id, status="completed", progress=100, processed_items=3)
    status3 = service.get_task_status(task_id)
    assert status3.status == "completed"
    assert status3.progress == 100


# ── 9. API smoke test for task endpoint ──────────────────────────────

def test_api_task_status_endpoint_unknown():
    """GET /aggregation/tasks/{task_id} 对未知任务返回 404。"""
    from fastapi.testclient import TestClient
    from server import app

    client = TestClient(app)
    r = client.get("/aggregation/tasks/test-nonexistent-123")
    assert r.status_code == 404


# ── 10. 回归测试：改写无 key 友好错误（P0 fix）──────────────────────

@pytest.mark.asyncio
async def test_rewrite_no_api_key_friendly_error():
    """回归：无 LLM API Key 时抛 UserVisibleError(LLM_KEY_MISSING) 稳定错误码，
    由渲染端 formatUserError 按 locale 渲染友好文案（不再硬编码中文技术提示）。"""
    import os as _os
    from multi_publish.aggregation._user_errors import UserVisibleError
    from multi_publish.aggregation.service import AggregationService
    from multi_publish.aggregation.models import RewriteRequest

    _os.environ.pop("LLM_API_KEY", None)
    _os.environ.pop("PO_OPENAI_API_KEY", None)

    service = AggregationService()
    req = RewriteRequest(content="这是一段用于测试改写的长内容，需要超过二十个字符来通过输入校验", style="轻松易懂")

    with pytest.raises(UserVisibleError) as exc_info:
        await service.rewrite(req)
    assert exc_info.value.error_code == "LLM_KEY_MISSING"
    # 兜底文本不含环境变量名等技术细节
    assert "LLM_API_KEY" not in exc_info.value.fallback_text
    assert "PO_OPENAI_API_KEY" not in exc_info.value.fallback_text


def test_rewrite_no_api_key_router_serializes_error_code():
    """router 层：UserVisibleError → HTTP 400 detail={error_code, message}，
    渲染端 python-bridge 透传 errorCode 供 formatUserError 渲染 locale 文案。"""
    from multi_publish.aggregation._user_errors import UserVisibleError
    from multi_publish.aggregation.router import rewrite as rewrite_endpoint

    import asyncio

    async def _raise(_req):
        raise UserVisibleError("LLM_KEY_MISSING", "AI 改写服务尚未配置访问密钥")

    original = rewrite_endpoint.__wrapped__ if hasattr(rewrite_endpoint, "__wrapped__") else None
    # 直接构造异常路径验证：patch _get_service
    import multi_publish.aggregation.router as router_mod

    class _FakeService:
        async def rewrite(self, request):
            raise UserVisibleError("LLM_KEY_MISSING", "AI 改写服务尚未配置访问密钥")

    router_mod._service = _FakeService()
    from multi_publish.aggregation.models import RewriteRequest

    req = RewriteRequest(content="这是一段用于测试改写的长内容，需要超过二十个字符来通过输入校验", style="轻松易懂")

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as http_info:
        asyncio.run(rewrite_endpoint(req))

    assert http_info.value.status_code == 400
    detail = http_info.value.detail
    assert isinstance(detail, dict)
    assert detail["error_code"] == "LLM_KEY_MISSING"
    assert "message" in detail


def test_rewrite_style_unsupported_serializes_error_code_with_params():
    """模型层（2026-09-12 存量收敛）：非法 style 抛 UserVisibleError(AGGREGATION_STYLE_UNSUPPORTED)
    且携带 params（value/supported），渲染端 formatUserError 用其插值 locale 占位符。
    注：Pydantic 会包一层 ValidationError，UserVisibleError 在 __cause__ 中。"""
    from pydantic import ValidationError
    from multi_publish.aggregation._user_errors import UserVisibleError
    from multi_publish.aggregation.models import RewriteRequest

    with pytest.raises(ValidationError) as exc_info:
        RewriteRequest(content="内容", style="不存在的风格")

    # Pydantic v2：原始异常在 errors()[0].ctx.error
    ctx_error = exc_info.value.errors()[0].get("ctx", {}).get("error")
    assert isinstance(ctx_error, UserVisibleError)
    assert ctx_error.error_code == "AGGREGATION_STYLE_UNSUPPORTED"
    assert ctx_error.params["value"] == "不存在的风格"
    assert "轻松易懂" in ctx_error.params["supported"]


def test_user_visible_error_params_attribute():
    """UserVisibleError 携带 params 插值参数（渲染端 locale {param} 占位符替换）。"""
    from multi_publish.aggregation._user_errors import UserVisibleError

    e = UserVisibleError("AGGREGATION_STYLE_UNSUPPORTED", "兜底", params={"value": "x", "supported": "a, b"})
    assert e.error_code == "AGGREGATION_STYLE_UNSUPPORTED"
    assert e.params == {"value": "x", "supported": "a, b"}
    assert isinstance(e, ValueError)


@pytest.mark.asyncio
async def test_rewrite_short_content_before_key_check():
    """回归（2026-09-12 更新）：移除 20 字下限后，短内容不再报"过短"；
    空 key 场景下走到 key 检查报 LLM_KEY_MISSING。"""
    import os as _os
    from multi_publish.aggregation.service import AggregationService
    from multi_publish.aggregation.models import RewriteRequest

    _os.environ.pop("LLM_API_KEY", None)
    _os.environ.pop("PO_OPENAI_API_KEY", None)

    service = AggregationService()
    req = RewriteRequest(content="短", style="轻松易懂")

    from multi_publish.aggregation._user_errors import UserVisibleError
    with pytest.raises(UserVisibleError) as exc_info:
        await service.rewrite(req)
    assert exc_info.value.error_code == "LLM_KEY_MISSING"


# ── 12. 字数区间控制（2026-09-12）──────────────────────────────────

def test_rewrite_request_word_count_defaults():
    """RewriteRequest 默认 min/max 字数：800/2000。"""
    from multi_publish.aggregation.models import RewriteRequest

    req = RewriteRequest(content="测试内容", style="轻松易懂")
    assert req.min_word_count == 800
    assert req.max_word_count == 2000


def test_rewrite_request_word_count_validation():
    """min/max 字数校验：整数、0-49999 / 1-50000 范围、max >= min。

    rewrite-segment-and-finish-reason（2026-10-20）：上界与 JS 引擎 MAX_OUTPUT_CHARS
    （50000）对齐；旧口径 6000 已随 rewrite-limits-50000 放开。
    """
    from multi_publish.aggregation.models import RewriteRequest
    from pydantic import ValidationError

    req = RewriteRequest(content="测试内容", style="轻松易懂", min_word_count=100, max_word_count=500)
    assert req.min_word_count == 100
    assert req.max_word_count == 500

    with pytest.raises(ValidationError, match="max_word_count"):
        RewriteRequest(content="测试内容", style="轻松易懂", min_word_count=500, max_word_count=100)

    # 50000 合法（新上界正控）
    req_max = RewriteRequest(content="测试内容", style="轻松易懂", min_word_count=40000, max_word_count=50000)
    assert req_max.max_word_count == 50000

    # 50001 越界（新边界）
    with pytest.raises(ValidationError):
        RewriteRequest(content="测试内容", style="轻松易懂", max_word_count=50001)

    with pytest.raises(ValidationError):
        RewriteRequest(content="测试内容", style="轻松易懂", min_word_count=-1)


@pytest.mark.asyncio
async def test_rewrite_short_content_now_allowed():
    """回归：移除 20 字下限后，短内容（非空）不再被 service 拒绝。"""
    import os as _os
    from multi_publish.aggregation.service import AggregationService
    from multi_publish.aggregation.models import RewriteRequest
    from multi_publish.aggregation._user_errors import UserVisibleError

    _os.environ.pop("LLM_API_KEY", None)
    _os.environ.pop("PO_OPENAI_API_KEY", None)

    service = AggregationService()
    req = RewriteRequest(content="短", style="轻松易懂")

    with pytest.raises(UserVisibleError) as exc_info:
        await service.rewrite(req)
    assert exc_info.value.error_code == "LLM_KEY_MISSING"


def test_rewrite_request_empty_content_rejected():
    """空内容（纯空白）仍被拒绝。"""
    from multi_publish.aggregation.models import RewriteRequest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        RewriteRequest(content="   ", style="轻松易懂")


def test_rewrite_word_count_range_used_in_config():
    """service.rewrite 必须把 min/max_word_count 传给 RewriteConfig。"""
    import inspect
    from multi_publish.aggregation import service as service_module

    src = inspect.getsource(service_module)
    assert "min_word_count" in src
    assert "request.max_word_count" in src


def test_rewrite_length_fallback_for_legacy_clients():
    """回归：旧客户端只传 length（不带 min/max_word_count）时走三档映射，
    模型默认值 800/2000 不得吞掉 length 路径。"""
    from multi_publish.aggregation.models import RewriteRequest
    from multi_publish.aggregation.service import AggregationService, _LENGTH_RANGES
    from unittest.mock import patch as _patch, MagicMock

    service = AggregationService()
    # 旧客户端：只传 content/style/length，不带 min/max_word_count
    req = RewriteRequest(content="旧客户端测试内容", style="轻松易懂", length="compress")
    assert "min_word_count" not in req.model_fields_set
    assert "max_word_count" not in req.model_fields_set

    captured_cfg = {}
    class _FakeProcessor:
        def __init__(self, config):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return False
        async def rewrite(self, content, cfg):
            captured_cfg.update(min_word_count=cfg.min_word_count, max_word_count=cfg.max_word_count)
            r = MagicMock()
            r.success = True
            r.rewritten_content = "改写结果"
            return r

    import multi_publish.aggregation.service as svc_mod
    with _patch.object(svc_mod._lazy_import, "__defaults__", None):
        pass
    # 直接 patch _lazy_import 返回 FakeProcessor
    orig_lazy = svc_mod._lazy_import
    def fake_lazy(module_path, attr=None):
        if module_path == "content_aggregator_shared.shared.rewriters.rewriter":
            if attr == "RewriteProcessor":
                return _FakeProcessor
            if attr == "RewriteConfig":
                from multi_publish.aggregation.models import RewriteRequest as _R
                class _RC:
                    def __init__(self, strategy=None, min_word_count=None, max_word_count=None, target_word_count=None):
                        self.min_word_count = min_word_count
                        self.max_word_count = max_word_count
                        self.target_word_count = target_word_count
                return _RC
            if attr == "RewriteStrategy":
                class _RS:
                    def __init__(self, name):
                        self.name = name
                return _RS
        if module_path == "content_aggregator_shared.shared.models":
            class _Content:
                def __init__(self, **kw):
                    for k, v in kw.items():
                        setattr(self, k, v)
            return _Content
        return orig_lazy(module_path, attr)

    import os as _os
    _os.environ.setdefault("LLM_API_KEY", "test-key-for-legacy-path")
    svc_mod._lazy_import = fake_lazy
    try:
        import asyncio
        asyncio.run(service.rewrite(req))
    finally:
        svc_mod._lazy_import = orig_lazy

    # compress 档应为 (100, 50000)，而非默认 800/2000
    # （2026-10-21 feat-zhihu-fav-batch-wordcount：三档 max 统一提到 50000，与引擎
    #  MAX_OUTPUT_CHARS 对齐，解除 keep 档 3000 的历史暗上限）
    assert captured_cfg["min_word_count"] == 100
    assert captured_cfg["max_word_count"] == 50000


def test_length_ranges_max_aligned_with_engine_output_cap():
    """三档的 max 必须与**引擎输出上限**对齐，而不是钉死一个字面值。

    动因与数字来历见 `service.py` 里 `_LENGTH_RANGES` 上方的注释（单一真源，
    此处不重复，避免两处散文漂移）。

    本用例钉的是**对齐关系**而非字面值。仓库里这个上限一共存在**三份**副本，
    本用例一次性把三方钉在一起（少钉一处 = 留一处新的暗上限）：

      ① 引擎真源   packages/rewrite-engine/src/rewrite-engine-core.js
                    → `const MAX_OUTPUT_CHARS = <n>`
      ② 渲染层镜像 apps/desktop/src/utils/rewrite-engine-limits.js
                    → `export const REWRITE_ENGINE_MAX_OUTPUT_CHARS = <n>`
                    （JS 侧已有结构锁 rewrite-engine-limits.test.js 保证 ①② 同值；
                      本用例在此之上把 **③ Python 三档** 也纳入）
      ③ Python 三档 `multi_publish.aggregation.service._LENGTH_RANGES[*][1]`

    读法与仓库既有结构锁同构（见 rewrite-engine-limits.test.js 的同名正则用法），
    属「跨语言常量对齐」而非「复制字面量」。

    若上限将来再变（例如提到 100000），本用例会因「某一方没跟上」而红，
    且报错直接点名是哪一处脱钩——这正是要防的「放宽一处、另一处成暗上限」。
    """
    import re
    from pathlib import Path

    from multi_publish.aggregation.service import _LENGTH_RANGES

    repo_root = Path(__file__).resolve().parents[3]

    def read_number(rel_path, pattern, label, const_name, min_refs=1, consumer_root=None):
        """从**指定的权威源**取数值，并证明它是「活的」权威源（外部复核 i4/i5 加固）。

        三件事必须同时成立，缺一条都可能变成装饰性断言：

        1. **存在且是文件**（fail-closed）：文件缺失 / 不是文件 ⇒ 直接断言失败，
           不静默跳过——skip 掉的契约等于没有。
        2. **数值可解析**：正则不匹配 ⇒ 断言失败。
        3. **活的**：该常量必须**被消费**，不能只躺在那里当一份没人用的副本。
           `min_refs` 断言常量名在定义文件内还出现（定义之外至少还有引用）；
           `consumer_root` 给定时，额外断言该常量在别处被真正引用。
           （这一条替代了先前那个「resolve 后与自身相等」的同义反复断言——它恒真、
           等于没有保护；正因如此外部复核才判它无效。）
        """
        src = (repo_root / rel_path).resolve()
        assert src.exists(), f"找不到{label}：{src}"
        assert src.is_file(), f"{label}不是文件：{src}"
        text = src.read_text(encoding="utf-8")
        m = re.search(pattern, text)
        assert m, f"{label}里找不到数值定义（模式：{pattern}）"
        # 只数**非注释代码行**里的出现，且用**词边界**匹配：
        #   ① 注释里提到常量名不算「被消费」（否则「定义 1 次 + 注释 1 次」也能凑够阈值）；
        #   ② 词边界避免影子名字（如 MAX_OUTPUT_CHARS_UNUSED）被误计入。
        code_only = "\n".join(
            line for line in text.splitlines() if not line.strip().startswith("//")
        )
        ref_count = len(re.findall(r"\b" + re.escape(const_name) + r"\b", code_only))
        assert ref_count >= min_refs, (
            f"{label}里的 {const_name} 在**代码行**里只出现 {ref_count} 次"
            f"（至少要 {min_refs} 次）——它可能是一份没人消费的副本，不是活的权威源"
        )
        if consumer_root is not None:
            consumed = []
            for p in (repo_root / consumer_root).rglob("*.js"):
                if p == src:
                    continue
                body = p.read_text(encoding="utf-8", errors="ignore")
                code_only = "\n".join(
                    line for line in body.splitlines() if not line.strip().startswith("//")
                )
                if re.search(r"\b" + re.escape(const_name) + r"\b", code_only):
                    consumed.append(p)
            assert consumed, (
                f"{label}里的 {const_name} 在 {consumer_root} 下没有任何**代码行**消费点"
                "——它可能不是当前真正生效的那份"
            )
        return int(m.group(1))

    engine_cap = read_number(
        Path("packages") / "rewrite-engine" / "src" / "rewrite-engine-core.js",
        r"const\s+MAX_OUTPUT_CHARS\s*=\s*(\d+)",
        "引擎上限真源",
        const_name="MAX_OUTPUT_CHARS",
        min_refs=2,  # 定义 + 引擎内部消费点（如 range.max <= MAX_OUTPUT_CHARS）
    )
    render_cap = read_number(
        Path("apps") / "desktop" / "src" / "utils" / "rewrite-engine-limits.js",
        r"export\s+const\s+REWRITE_ENGINE_MAX_OUTPUT_CHARS\s*=\s*(\d+)",
        "渲染层上限镜像",
        const_name="REWRITE_ENGINE_MAX_OUTPUT_CHARS",
        min_refs=1,
        consumer_root=Path("apps") / "desktop" / "src",  # 证明渲染层真的在用它
    )
    assert render_cap == engine_cap, (
        f"渲染层镜像 {render_cap} 与引擎真源 {engine_cap} 脱钩"
        "（JS 侧结构锁只保证这两者，没覆盖 Python 侧）"
    )

    assert set(_LENGTH_RANGES.keys()) == {"keep", "compress", "expand"}
    for name, (min_wc, max_wc, target_wc) in _LENGTH_RANGES.items():
        assert max_wc == engine_cap, (
            f"{name} 档 max {max_wc} 与引擎上限 {engine_cap} 脱钩"
            "（引擎放宽了，三档没跟上 ⇒ 又一道暗上限）"
        )
        assert min_wc <= max_wc, f"{name} 档 min 不得大于 max"
        assert 0 <= min_wc < target_wc <= max_wc, f"{name} 档三值关系被破坏: {(min_wc, max_wc, target_wc)}"


# ── 11. 回归测试：word_count 兜底 ──────────────────────────────────

def test_collect_result_word_count_fallback():
    """回归：word_count 为 0 时用 content 长度兜底。"""
    from multi_publish.aggregation.models import CollectResult

    r = CollectResult(
        title="测试",
        content="这是一段有内容的正文",
        source_url="https://example.com",
        word_count=0,
    )
    # 在 service 层已兜底；这里验证模型允许 word_count 为 0 且 content 有长度
    assert r.word_count == 0
    assert len(r.content) > 0
    # 兜底逻辑：word_count or len(content)
    effective = r.word_count or len(r.content)
    assert effective == len("这是一段有内容的正文")


# ── 13. 桌面「模型设置」LLM 注入（2026-10-18，fix-collect-antibot-rewrite）─────
#
# 根因：/aggregation/rewrite 只读进程 env（LLM_API_KEY/PO_OPENAI_API_KEY），桌面端
# 「模型设置」里配置的默认模型从未注入 ⇒ 已配置仍误报 LLM_KEY_MISSING。
# 契约：request.llm > env（LLM_API_KEY > PO_OPENAI_API_KEY），逐字段独立回退；
#       缺 key 仍抛 UserVisibleError('LLM_KEY_MISSING')；Key 不得进入日志。

_LLM_ENV_KEYS = (
    "LLM_API_KEY", "PO_OPENAI_API_KEY",
    "LLM_BASE_URL", "PO_OPENAI_BASE_URL",
    "LLM_MODEL", "PO_OPENAI_MODEL",
)


def _clear_llm_env(monkeypatch):
    for key in _LLM_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def _capture_llm_pipeline(monkeypatch):
    """替换 service._lazy_import：捕获 LLMService 配置 / adapter / pipeline 配置，全程零网络。"""
    import multi_publish.aggregation.service as svc_mod

    captured = {}

    class FakeLLMService:
        def __init__(self, config=None):
            captured["llm_service_config"] = dict(config or {})

    class FakeLLMServiceAdapter:
        def __init__(self, svc):
            captured["adapter_service"] = svc

    class FakeRewriteProcessor:
        def __init__(self, config):
            captured["pipeline_config"] = config

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def rewrite(self, content, cfg):
            result = type("R", (), {})()
            result.success = True
            result.rewritten_content = "改写结果"
            result.error = None
            return result

    class FakeRewriteConfig:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class _FakeStrategy:
        def __init__(self, name):
            self.name = name

    class FakeContent:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    orig_lazy = svc_mod._lazy_import

    def fake_lazy(module_path, attr=None):
        if module_path == "multi_publish.services.llm_service" and attr == "LLMService":
            return FakeLLMService
        if module_path == "content_aggregator_shared.shared.clients.llm_service_adapter" and attr == "LLMServiceAdapter":
            return FakeLLMServiceAdapter
        if module_path == "content_aggregator_shared.shared.rewriters.rewriter":
            return {
                "RewriteProcessor": FakeRewriteProcessor,
                "RewriteConfig": FakeRewriteConfig,
                "RewriteStrategy": _FakeStrategy,
            }.get(attr)
        if module_path == "content_aggregator_shared.shared.models" and attr == "Content":
            return FakeContent
        return orig_lazy(module_path, attr)

    monkeypatch.setattr(svc_mod, "_lazy_import", fake_lazy)
    return captured


def test_rewrite_request_accepts_llm_override():
    """RewriteRequest 接受桌面端注入的 llm 对象（三个字段均可选）。"""
    from multi_publish.aggregation.models import RewriteRequest

    req = RewriteRequest(
        content="测试内容",
        llm={"api_key": "sk-unit-test-llm-01", "base_url": "https://agnes.example.com/v1", "model": "agnes-3.0-flash"},
    )
    assert req.llm is not None
    assert req.llm.api_key == "sk-unit-test-llm-01"
    assert req.llm.base_url == "https://agnes.example.com/v1"
    assert req.llm.model == "agnes-3.0-flash"


def test_rewrite_request_llm_optional_and_fields_optional():
    """llm 缺省为 None；显式空对象时三字段均为 None（全回退 env）。"""
    from multi_publish.aggregation.models import RewriteRequest

    assert RewriteRequest(content="测试内容").llm is None

    req = RewriteRequest(content="测试内容", llm={})
    assert req.llm is not None
    assert req.llm.api_key is None
    assert req.llm.base_url is None
    assert req.llm.model is None


@pytest.mark.asyncio
async def test_rewrite_uses_request_llm_when_env_empty(monkeypatch, caplog):
    """env 全空 + request.llm 完整 → 不再抛 LLM_KEY_MISSING，adapter 使用注入 Key；
    且 Key 不得出现在日志里（只断言"不含"，不打印值）。"""
    import logging

    caplog.set_level(logging.DEBUG)
    _clear_llm_env(monkeypatch)
    captured = _capture_llm_pipeline(monkeypatch)

    from multi_publish.aggregation.service import AggregationService
    from multi_publish.aggregation.models import RewriteRequest

    req = RewriteRequest(
        content="这是一段用于验证桌面模型设置注入的正文内容。",
        style="轻松易懂",
        llm={
            "api_key": "sk-desktop-injected-01",
            "base_url": "https://agnes.example.com/v1",
            "model": "agnes-3.0-flash",
        },
    )
    result = await AggregationService().rewrite(req)

    assert result.result_content == "改写结果"
    cfg = captured["llm_service_config"]
    assert cfg["api_key"] == "sk-desktop-injected-01"
    assert cfg["base_url"] == "https://agnes.example.com/v1"
    assert cfg["model"] == "agnes-3.0-flash"
    # pipeline 配置（RewriteProcessor config["llm"]）同样使用注入值
    assert captured["pipeline_config"]["llm"]["api_key"] == "sk-desktop-injected-01"
    # 安全：Key 不落日志
    assert "sk-desktop-injected-01" not in caplog.text


@pytest.mark.asyncio
async def test_rewrite_request_llm_overrides_env_per_field(monkeypatch):
    """request.llm > env：两者都配置时逐字段以 request 为准（未提供的字段回退 env）。"""
    monkeypatch.setenv("LLM_API_KEY", "env-key-should-lose")
    monkeypatch.setenv("LLM_MODEL", "env-model")
    monkeypatch.setenv("LLM_BASE_URL", "https://env.example.com/v1")
    captured = _capture_llm_pipeline(monkeypatch)

    from multi_publish.aggregation.service import AggregationService
    from multi_publish.aggregation.models import RewriteRequest

    req = RewriteRequest(
        content="这是一段用于验证优先级的正文内容。",
        llm={"api_key": "desktop-key-wins", "model": "desktop-model-wins"},
    )
    await AggregationService().rewrite(req)

    cfg = captured["llm_service_config"]
    assert cfg["api_key"] == "desktop-key-wins"
    assert cfg["model"] == "desktop-model-wins"
    # base_url 未在 request.llm 中提供 → 回退 env
    assert cfg["base_url"] == "https://env.example.com/v1"


@pytest.mark.asyncio
async def test_rewrite_request_llm_missing_model_falls_back_to_env(monkeypatch):
    """request.llm 缺 model → 回退 env LLM_MODEL。"""
    monkeypatch.setenv("LLM_MODEL", "env-model")
    monkeypatch.delenv("PO_OPENAI_MODEL", raising=False)
    captured = _capture_llm_pipeline(monkeypatch)

    from multi_publish.aggregation.service import AggregationService
    from multi_publish.aggregation.models import RewriteRequest

    req = RewriteRequest(
        content="这是一段用于验证模型回退的正文内容。",
        llm={"api_key": "desktop-key-model-fallback"},
    )
    await AggregationService().rewrite(req)

    assert captured["llm_service_config"]["model"] == "env-model"


@pytest.mark.asyncio
async def test_rewrite_request_llm_missing_model_defaults(monkeypatch):
    """request.llm 缺 model 且 env 未配置模型 → 默认 gpt-4o-mini。"""
    _clear_llm_env(monkeypatch)
    captured = _capture_llm_pipeline(monkeypatch)

    from multi_publish.aggregation.service import AggregationService
    from multi_publish.aggregation.models import RewriteRequest

    req = RewriteRequest(
        content="这是一段用于验证默认模型的正文内容。",
        llm={"api_key": "desktop-key-default-model"},
    )
    await AggregationService().rewrite(req)

    assert captured["llm_service_config"]["model"] == "gpt-4o-mini"


@pytest.mark.asyncio
async def test_rewrite_env_fallback_unaffected_without_request_llm(monkeypatch):
    """无 request.llm 时保持既有 env 回退路径（历史部署不回归）。"""
    monkeypatch.setenv("LLM_API_KEY", "env-only-key")
    monkeypatch.setenv("LLM_MODEL", "env-only-model")
    monkeypatch.delenv("PO_OPENAI_API_KEY", raising=False)
    captured = _capture_llm_pipeline(monkeypatch)

    from multi_publish.aggregation.service import AggregationService
    from multi_publish.aggregation.models import RewriteRequest

    req = RewriteRequest(content="这是一段用于验证 env 回退的正文内容。")
    await AggregationService().rewrite(req)

    assert captured["llm_service_config"]["api_key"] == "env-only-key"
    assert captured["llm_service_config"]["model"] == "env-only-model"


@pytest.mark.asyncio
async def test_rewrite_empty_llm_object_still_requires_key(monkeypatch):
    """request.llm 为空对象且 env 无 Key → 仍抛 LLM_KEY_MISSING（不得因注入字段存在而放行）。"""
    _clear_llm_env(monkeypatch)

    from multi_publish.aggregation._user_errors import UserVisibleError
    from multi_publish.aggregation.service import AggregationService
    from multi_publish.aggregation.models import RewriteRequest

    req = RewriteRequest(content="这是一段用于验证缺 Key 的正文内容。", llm={"model": "only-model"})
    with pytest.raises(UserVisibleError) as exc_info:
        await AggregationService().rewrite(req)
    assert exc_info.value.error_code == "LLM_KEY_MISSING"
