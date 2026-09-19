"""视频作品采集（抖音/小红书 + ASR 转写）测试。

覆盖：模型扩展向后兼容、平台检测、错误分类、管线各阶段（mock yt-dlp/ffmpeg/ASR）。
"""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ── 1. CollectResult 模型扩展（向后兼容） ──────────────────────────────

def test_collect_result_old_data_backward_compatible():
    """旧 JSON（无新字段）反序列化 → media_type=article，新字段为默认值。"""
    from multi_publish.aggregation.models import CollectResult

    old = CollectResult(title="t", content="c", source_url="https://example.com")
    assert old.media_type == "article"
    assert old.video_url == ""
    assert old.duration == 0.0
    assert old.transcript == ""


def test_collect_result_video_fields():
    from multi_publish.aggregation.models import CollectResult

    r = CollectResult(title="t", content="文案", media_type="video", video_url="https://v.douyin.com/x/",
                      duration=125.0, transcript="文案")
    assert r.media_type == "video"
    assert r.duration == 125.0


def test_collect_result_rejects_invalid_media_type():
    from multi_publish.aggregation.models import CollectResult
    import pydantic

    with pytest.raises(pydantic.ValidationError):
        CollectResult(media_type="audio")


def test_collect_video_request_validation():
    from multi_publish.aggregation.models import CollectVideoRequest
    import pydantic

    req = CollectVideoRequest(url="https://v.douyin.com/abc/")
    assert req.asr_engine is None

    with pytest.raises(pydantic.ValidationError):
        CollectVideoRequest(url="not-a-url")
    with pytest.raises(pydantic.ValidationError):
        CollectVideoRequest(url="https://v.douyin.com/abc/", asr_engine="bad_engine")


# ── 2. 平台检测 ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("url,expected", [
    ("https://v.douyin.com/abc123/", "douyin"),
    ("https://www.douyin.com/video/730123", "douyin"),
    ("https://www.xiaohongshu.com/explore/abc", "xiaohongshu"),
    ("https://xhslink.com/xyz", "xiaohongshu"),
    # 2026-09-19 平台扩展：B站/知乎/视频号进入视频通道（yt-dlp 原生支持 B站/知乎）
    ("https://www.zhihu.com/question/123", "zhihu"),
    ("https://www.bilibili.com/video/BV1xx411c7mD", "bilibili"),
    ("https://b23.tv/abc123", "bilibili"),
    ("https://channels.weixin.qq.com/web/x", "channels"),
    ("https://example.com", None),
])
def test_detect_platform(url, expected):
    from multi_publish.aggregation.video_service import detect_platform
    assert detect_platform(url) == expected


# ── 3. 下载错误分类 ─────────────────────────────────────────────────────

def test_classify_download_error_categories():
    from multi_publish.aggregation.video_service import classify_download_error

    assert classify_download_error("This video is private")[0] == "VIDEOCLONE_LINK_PRIVATE"
    assert classify_download_error("captcha required")[0] == "VIDEOCLONE_LINK_ANTI_BOT"
    assert classify_download_error("video not found")[0] == "VIDEOCLONE_LINK_UNAVAILABLE"


# ── 4. ASR 引擎抽象 ─────────────────────────────────────────────────────

def test_get_asr_engine_default():
    from multi_publish.aggregation.asr_engine import FasterWhisperEngine, get_asr_engine
    engine = get_asr_engine(None)
    assert isinstance(engine, FasterWhisperEngine)


def test_get_asr_engine_unknown():
    from multi_publish.aggregation.asr_engine import AsrEngineError, get_asr_engine
    with pytest.raises(AsrEngineError):
        get_asr_engine("nonexistent")


def test_faster_whisper_engine_missing_dependency():
    from multi_publish.aggregation.asr_engine import AsrEngineError, FasterWhisperEngine

    engine = FasterWhisperEngine()
    with patch("builtins.__import__", side_effect=ImportError("no faster_whisper")):
        assert engine.is_available() is False
        with pytest.raises(AsrEngineError) as exc_info:
            engine.transcribe("/nonexistent/audio.wav")
        assert exc_info.value.code in ("no_audio", "engine_unavailable")


def test_faster_whisper_engine_transcribe_mock(tmp_path):
    from multi_publish.aggregation.asr_engine import FasterWhisperEngine

    audio = tmp_path / "a.wav"
    audio.write_bytes(b"RIFF")

    seg1 = MagicMock(); seg1.id = 0; seg1.start = 0.0; seg1.end = 2.0; seg1.text = " 你好 "
    seg2 = MagicMock(); seg2.id = 1; seg2.start = 2.0; seg2.end = 4.0; seg2.text = "世界 "
    info = MagicMock(); info.language = "zh"; info.duration = 4.0

    fake_model = MagicMock()
    fake_model.transcribe.return_value = (iter([seg1, seg2]), info)

    engine = FasterWhisperEngine()
    with patch("multi_publish.aggregation.asr_engine.Path.exists", return_value=True):
        with patch.dict("sys.modules", {"faster_whisper": MagicMock(WhisperModel=MagicMock(return_value=fake_model)), "torch": MagicMock()}):
            import sys
            torch_mock = sys.modules["torch"]
            torch_mock.cuda.is_available.return_value = False
            result = engine.transcribe(str(audio))

    assert result.text == "你好世界"
    assert result.language == "zh"
    assert result.duration_seconds == 4.0
    assert len(result.segments) == 2


# ── 5. VideoCollectService 管线（mock 子进程） ──────────────────────────

def _make_completed(returncode=0, stdout="", stderr=""):
    proc = MagicMock()
    proc.returncode = returncode
    proc.stdout = stdout
    proc.stderr = stderr
    return proc


def test_collect_video_success(tmp_path, monkeypatch):
    from multi_publish.aggregation import video_service
    from multi_publish.aggregation.models import CollectVideoRequest
    from multi_publish.aggregation.asr_engine import AsrResult

    svc = video_service.VideoCollectService()

    meta_json = json.dumps({"title": "测试视频", "duration": 60, "uploader": "作者", "thumbnail": "https://t.example/c.jpg"})

    def fake_run(cmd, timeout=None, **kwargs):
        if "--dump-json" in cmd:
            return _make_completed(0, stdout=meta_json)
        if cmd[0] == "yt-dlp":
            return _make_completed(0)
        if "-select_streams" in cmd:
            return _make_completed(0, stdout=json.dumps({"streams": [{"codec_type": "audio"}]}))
        return _make_completed(0)  # ffmpeg

    def fake_stat(self, *a, **kw):
        st = MagicMock(); st.st_size = 1024; return st

    fake_engine = MagicMock()
    fake_engine.is_available.return_value = True
    fake_engine.transcribe.return_value = AsrResult(
        text="这是转写文案", language="zh", duration_seconds=60.0,
        segments=[{"id": 0, "start": 0, "end": 60, "text": "这是转写文案"}], engine="faster_whisper",
    )

    monkeypatch.setattr(video_service, "_run_subprocess", fake_run)
    monkeypatch.setattr(Path, "stat", fake_stat)
    monkeypatch.setattr(video_service, "get_asr_engine", lambda name=None: fake_engine)
    monkeypatch.setattr(video_service.VideoCollectService, "_transcribe_with_timeout",
                        lambda self, eng, p: fake_engine.transcribe(p))

    result = svc.collect_video(CollectVideoRequest(url="https://v.douyin.com/abc/"))

    assert result.media_type == "video"
    assert result.title == "测试视频"
    assert result.content == "这是转写文案"
    assert result.transcript == "这是转写文案"
    assert result.word_count == len("这是转写文案")
    assert result.metadata["platform"] == "douyin"
    assert result.metadata["asr_engine"] == "faster_whisper"


def test_collect_video_rejects_non_video_platform():
    from multi_publish.aggregation import video_service
    from multi_publish.aggregation.models import CollectVideoRequest

    svc = video_service.VideoCollectService()
    with pytest.raises(video_service.VideoCollectError) as exc_info:
        svc.collect_video(CollectVideoRequest(url="https://example.com/video"))
    assert exc_info.value.code == "VIDEOCLONE_INVALID_PLATFORM"


def test_collect_video_probe_anti_bot(tmp_path, monkeypatch):
    from multi_publish.aggregation import video_service
    from multi_publish.aggregation.models import CollectVideoRequest

    svc = video_service.VideoCollectService()
    monkeypatch.setattr(video_service, "_run_subprocess",
                        lambda *a, **kw: _make_completed(1, stderr="captcha required"))
    # 浏览器降级通道也失败（模拟无 Playwright 环境）→ 最终报 ANTI_BOT
    from multi_publish.aggregation import browser_fetcher
    monkeypatch.setattr(browser_fetcher, "fetch_video_via_browser",
                        lambda platform, url: (_ for _ in ()).throw(
                            browser_fetcher.BrowserFetchError("no_browser", "playwright 未安装")))

    with pytest.raises(video_service.VideoCollectError) as exc_info:
        svc.collect_video(CollectVideoRequest(url="https://v.douyin.com/abc/"))
    assert exc_info.value.code == "VIDEOCLONE_LINK_ANTI_BOT"
    assert "登录态" in exc_info.value.message or "风控" in exc_info.value.message


def test_collect_video_too_long_at_probe(monkeypatch):
    from multi_publish.aggregation import video_service
    from multi_publish.aggregation.models import CollectVideoRequest

    svc = video_service.VideoCollectService()
    meta = json.dumps({"title": "长视频", "duration": 15 * 60})
    def fake_run_long(cmd, timeout=None, **kwargs):
        if "--dump-json" in cmd:
            return _make_completed(0, stdout=meta)
        return _make_completed(0)  # 下载等其他子进程调用
    monkeypatch.setattr(video_service, "_run_subprocess", fake_run_long)
    # yt-dlp 探测成功但超时长限制（不触发浏览器降级——探测已拿到时长）

    with pytest.raises(video_service.VideoCollectError) as exc_info:
        svc.collect_video(CollectVideoRequest(url="https://www.xiaohongshu.com/explore/x"))
    assert exc_info.value.code == "VIDEOCLONE_FILE_TOO_LARGE"


def test_collect_video_no_audio_stream(tmp_path, monkeypatch):
    from multi_publish.aggregation import video_service
    from multi_publish.aggregation.models import CollectVideoRequest

    svc = video_service.VideoCollectService()
    meta = json.dumps({"title": "t", "duration": 30})

    def fake_run(cmd, timeout=None, **kwargs):
        if "--dump-json" in cmd:
            return _make_completed(0, stdout=meta)
        if "-select_streams" in cmd:
            return _make_completed(0, stdout=json.dumps({"streams": []}))
        return _make_completed(0)

    def fake_stat(self, *a, **kw):
        st = MagicMock(); st.st_size = 1024; return st

    monkeypatch.setattr(video_service, "_run_subprocess", fake_run)
    monkeypatch.setattr(Path, "stat", fake_stat)

    with pytest.raises(video_service.VideoCollectError) as exc_info:
        svc.collect_video(CollectVideoRequest(url="https://v.douyin.com/abc/"))
    assert exc_info.value.code == "-8"
    assert "无音轨" in exc_info.value.message


def test_collect_video_engine_unavailable(monkeypatch):
    from multi_publish.aggregation import video_service
    from multi_publish.aggregation.models import CollectVideoRequest

    svc = video_service.VideoCollectService()
    fake_engine = MagicMock()
    fake_engine.is_available.return_value = False
    fake_engine.install_hint.return_value = "请安装 faster-whisper"
    monkeypatch.setattr(video_service, "get_asr_engine", lambda name=None: fake_engine)

    with pytest.raises(video_service.VideoCollectError) as exc_info:
        svc.collect_video(CollectVideoRequest(url="https://v.douyin.com/abc/"))
    assert exc_info.value.code == "-6"


def test_collect_video_transcribe_timeout(monkeypatch):
    from multi_publish.aggregation import video_service
    from multi_publish.aggregation.models import CollectVideoRequest

    svc = video_service.VideoCollectService()
    meta = json.dumps({"title": "t", "duration": 30})

    def fake_run(cmd, timeout=None, **kwargs):
        if "--dump-json" in cmd:
            return _make_completed(0, stdout=meta)
        if "-select_streams" in cmd:
            return _make_completed(0, stdout=json.dumps({"streams": [{"codec_type": "audio"}]}))
        return _make_completed(0)

    def fake_stat(self, *a, **kw):
        st = MagicMock(); st.st_size = 1024; return st

    def fake_transcribe_timeout(self, engine, path):
        raise asyncio.TimeoutError()

    import asyncio
    monkeypatch.setattr(video_service, "_run_subprocess", fake_run)
    monkeypatch.setattr(Path, "stat", fake_stat)
    monkeypatch.setattr(video_service.VideoCollectService, "_transcribe_with_timeout", fake_transcribe_timeout)

    fake_engine = MagicMock()
    fake_engine.is_available.return_value = True
    monkeypatch.setattr(video_service, "get_asr_engine", lambda name=None: fake_engine)

    with pytest.raises(video_service.VideoCollectError) as exc_info:
        svc.collect_video(CollectVideoRequest(url="https://v.douyin.com/abc/"))
    assert exc_info.value.code == "-7"


def test_collect_video_empty_transcript(monkeypatch):
    from multi_publish.aggregation import video_service
    from multi_publish.aggregation.models import CollectVideoRequest
    from multi_publish.aggregation.asr_engine import AsrResult

    svc = video_service.VideoCollectService()
    meta = json.dumps({"title": "t", "duration": 30})

    def fake_run(cmd, timeout=None, **kwargs):
        if "--dump-json" in cmd:
            return _make_completed(0, stdout=meta)
        if "-select_streams" in cmd:
            return _make_completed(0, stdout=json.dumps({"streams": [{"codec_type": "audio"}]}))
        return _make_completed(0)

    def fake_stat(self, *a, **kw):
        st = MagicMock(); st.st_size = 1024; return st

    monkeypatch.setattr(video_service, "_run_subprocess", fake_run)
    monkeypatch.setattr(Path, "stat", fake_stat)
    monkeypatch.setattr(video_service.VideoCollectService, "_transcribe_with_timeout",
                        lambda self, e, p: AsrResult(text="", language="zh", duration_seconds=30.0, engine="faster_whisper"))

    fake_engine = MagicMock()
    fake_engine.is_available.return_value = True
    monkeypatch.setattr(video_service, "get_asr_engine", lambda name=None: fake_engine)

    with pytest.raises(video_service.VideoCollectError) as exc_info:
        svc.collect_video(CollectVideoRequest(url="https://v.douyin.com/abc/"))
    assert exc_info.value.code == "ASR_EMPTY"


# ── 6. 模型下载管理（asr-model-download） ────────────────────────────────

def test_resolve_download_endpoint_user_explicit(monkeypatch):
    """用户显式设置 HF_ENDPOINT 时直接使用，不探测不覆盖。"""
    from multi_publish.aggregation import asr_engine
    monkeypatch.setenv("HF_ENDPOINT", "https://my-custom-hf.example.com")
    probe_calls = []
    monkeypatch.setattr(asr_engine, "_probe_endpoint", lambda url: probe_calls.append(url) or True)
    assert asr_engine._resolve_download_endpoint() == "https://my-custom-hf.example.com"
    assert probe_calls == []  # 未触发探测


def test_resolve_download_endpoint_mirror_reachable(monkeypatch):
    """未设置 HF_ENDPOINT 且镜像可达 → 用镜像。"""
    from multi_publish.aggregation import asr_engine
    monkeypatch.delenv("HF_ENDPOINT", raising=False)
    monkeypatch.setattr(asr_engine, "_probe_endpoint", lambda url: url == "https://hf-mirror.com")
    assert asr_engine._resolve_download_endpoint() == "https://hf-mirror.com"


def test_resolve_download_endpoint_mirror_down_fallback(monkeypatch):
    """全部镜像不可达 → 回退列表首个（hf-mirror）重试。2026-09-19 多镜像改造后的语义。"""
    from multi_publish.aggregation import asr_engine
    monkeypatch.delenv("HF_ENDPOINT", raising=False)
    monkeypatch.setattr(asr_engine, "_probe_endpoint", lambda url: False)
    assert asr_engine._resolve_download_endpoint() == "https://hf-mirror.com"


def test_resolve_download_endpoint_first_mirror_down_second_up(monkeypatch):
    """首个镜像不可达 → 自动切换到第二个可用源（huggingface.co）。"""
    from multi_publish.aggregation import asr_engine
    monkeypatch.delenv("HF_ENDPOINT", raising=False)
    monkeypatch.setattr(asr_engine, "_probe_endpoint", lambda url: url == "https://huggingface.co")
    assert asr_engine._resolve_download_endpoint() == "https://huggingface.co"


def test_classify_download_error_network(monkeypatch):
    """网络不可达 → 提示含网络检查建议与镜像推荐。"""
    from multi_publish.aggregation.asr_engine import _classify_download_error, _MODEL_REPO
    msg = _classify_download_error(ConnectionError("connection refused"), "base")
    assert "网络" in msg
    assert "hf-mirror.com" in msg
    assert "huggingface.co" in msg or _MODEL_REPO in msg  # 含手动下载指引


def test_classify_download_error_timeout(monkeypatch):
    """超时 → 提示含重试建议。"""
    import socket
    from multi_publish.aggregation.asr_engine import _classify_download_error
    msg = _classify_download_error(socket.timeout("timed out"), "base")
    assert "超时" in msg or "重试" in msg


def test_classify_download_error_disk_full():
    """磁盘不足 → 提示含磁盘清理建议。"""
    from multi_publish.aggregation.asr_engine import _classify_download_error
    msg = _classify_download_error(OSError(28, "No space left on device"), "base")
    assert "磁盘" in msg


def test_classify_download_error_offline_mode():
    """HF_HUB_OFFLINE 冲突 → 提示关闭离线模式。"""
    from huggingface_hub.errors import OfflineModeIsEnabled
    from multi_publish.aggregation.asr_engine import _classify_download_error
    msg = _classify_download_error(OfflineModeIsEnabled("offline"), "base")
    assert "HF_HUB_OFFLINE" in msg


def test_classify_download_error_repo_not_found():
    """仓库不存在（isinstance 分支）→ 提示含仓库不存在。"""
    from multi_publish.aggregation.asr_engine import _classify_download_error
    # RepositoryNotFoundError 构造需真实 response 对象（HfHubHTTPError 内部访问 response 属性），
    # 单测中用 mock response 构造真实实例以命中 isinstance 分支
    from unittest.mock import MagicMock
    from huggingface_hub.errors import RepositoryNotFoundError
    resp = MagicMock()
    resp.status_code = 404
    resp.headers = {}
    err = RepositoryNotFoundError("Repository not found", response=resp)
    msg = _classify_download_error(err, "base")
    assert "不存在" in msg


def test_classify_download_error_requests_connection_error():
    """requests.ConnectionError（huggingface_hub 实际网络异常类型）→ 网络类提示。"""
    import requests.exceptions as req_exc
    from multi_publish.aggregation.asr_engine import _classify_download_error
    msg = _classify_download_error(req_exc.ConnectionError("Max retries exceeded with url"), "base")
    assert "网络" in msg


def test_classify_download_error_unknown_includes_manual_url():
    """未知失败 → 提示含手动下载 URL 与缓存目录（兜底路径）。"""
    from multi_publish.aggregation.asr_engine import _classify_download_error, _MODEL_REPO
    msg = _classify_download_error(RuntimeError("something odd"), "base")
    assert "手动" in msg or _MODEL_REPO in msg
    assert "缓存" in msg or "cache" in msg.lower()


def test_engine_is_model_ready_cached(monkeypatch, tmp_path):
    """模型已缓存 → is_model_ready True（纯本地查询，无网络）。"""
    from multi_publish.aggregation.asr_engine import FasterWhisperEngine
    eng = FasterWhisperEngine()
    monkeypatch.setattr(eng, "_get_model_cache_dir", lambda: str(tmp_path))
    # 模拟 snapshot_download local_files_only=True 成功返回路径
    import multi_publish.aggregation.asr_engine as mod
    monkeypatch.setattr(mod, "_snapshot_download", lambda **kw: str(tmp_path / "model.bin"))
    assert eng.is_model_ready() is True


def test_engine_is_model_ready_not_cached(monkeypatch, tmp_path):
    """模型未缓存 → is_model_ready False。"""
    from multi_publish.aggregation.asr_engine import FasterWhisperEngine
    from huggingface_hub.errors import LocalEntryNotFoundError
    import multi_publish.aggregation.asr_engine as mod
    eng = FasterWhisperEngine()
    monkeypatch.setattr(eng, "_get_model_cache_dir", lambda: str(tmp_path))
    def raise_not_found(**kw):
        raise LocalEntryNotFoundError("not cached")
    monkeypatch.setattr(mod, "_snapshot_download", raise_not_found)
    assert eng.is_model_ready() is False


def test_engine_ensure_model_download_failure(monkeypatch, tmp_path):
    """模型未缓存且下载失败 → AsrEngineError code=download_failed，提示含可操作建议。"""
    from multi_publish.aggregation.asr_engine import AsrEngineError, FasterWhisperEngine
    import multi_publish.aggregation.asr_engine as mod
    eng = FasterWhisperEngine()
    monkeypatch.setattr(eng, "_get_model_cache_dir", lambda: str(tmp_path))
    calls = {"local_only": []}
    def fake_download(**kw):
        calls["local_only"].append(kw.get("local_files_only"))
        if kw.get("local_files_only"):
            from huggingface_hub.errors import LocalEntryNotFoundError
            raise LocalEntryNotFoundError("not cached")
        raise ConnectionError("network unreachable")
    monkeypatch.setattr(mod, "_snapshot_download", fake_download)
    monkeypatch.setattr(mod, "_resolve_download_endpoint", lambda: "https://hf-mirror.com")
    with pytest.raises(AsrEngineError) as exc_info:
        eng.ensure_model()
    assert exc_info.value.code == "download_failed"
    assert "hf-mirror.com" in exc_info.value.message or "网络" in exc_info.value.message


def test_engine_ensure_model_already_cached_skips_download(monkeypatch, tmp_path):
    """模型已缓存 → ensure_model 不触发下载（第二次调用 local_files_only=False 不出现）。"""
    from multi_publish.aggregation.asr_engine import FasterWhisperEngine
    import multi_publish.aggregation.asr_engine as mod
    eng = FasterWhisperEngine()
    monkeypatch.setattr(eng, "_get_model_cache_dir", lambda: str(tmp_path))
    monkeypatch.setattr(mod, "_snapshot_download", lambda **kw: str(tmp_path / "model.bin"))
    eng.ensure_model()
    # 已缓存时不应调用下载源选择
    resolve_calls = []
    monkeypatch.setattr(mod, "_resolve_download_endpoint", lambda: resolve_calls.append(1) or "https://x")
    eng.ensure_model()
    assert resolve_calls == []


def test_engine_ensure_model_no_env_mutation(monkeypatch, tmp_path):
    """下载全程不修改 HF_ENDPOINT 环境变量（多线程安全，用户显式设置不被覆盖）。"""
    import os
    from multi_publish.aggregation.asr_engine import FasterWhisperEngine
    import multi_publish.aggregation.asr_engine as mod
    eng = FasterWhisperEngine()
    monkeypatch.setattr(eng, "_get_model_cache_dir", lambda: str(tmp_path))
    monkeypatch.setenv("HF_ENDPOINT", "https://user-explicit.example.com")

    class FakeApi:
        def __init__(self, endpoint=None):
            self.endpoint = endpoint
        def snapshot_download(self, **kw):
            assert self.endpoint == "https://user-explicit.example.com"  # 源选择尊重用户显式设置
            return str(tmp_path / "model.bin")
    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "HfApi", FakeApi)
    # 预检未缓存
    from huggingface_hub.errors import LocalEntryNotFoundError
    def fake_snapshot(**kw):
        if kw.get("local_files_only"):
            raise LocalEntryNotFoundError("not cached")
        return str(tmp_path / "model.bin")
    monkeypatch.setattr(mod, "_snapshot_download", fake_snapshot)
    eng.ensure_model()
    assert os.environ.get("HF_ENDPOINT") == "https://user-explicit.example.com"


def test_collect_video_download_failed_error_code(monkeypatch, tmp_path):
    """端到端：download_failed → VideoCollectError code=ASR_DOWNLOAD_FAILED（前端可匹配）。"""
    from multi_publish.aggregation import video_service
    from multi_publish.aggregation.models import CollectVideoRequest
    from multi_publish.aggregation.asr_engine import AsrEngineError

    svc = video_service.VideoCollectService()
    meta = json.dumps({"title": "t", "duration": 30})

    def fake_run(cmd, timeout=None, **kwargs):
        if "--dump-json" in cmd:
            return _make_completed(0, stdout=meta)
        if "-select_streams" in cmd:
            return _make_completed(0, stdout=json.dumps({"streams": [{"codec_type": "audio"}]}))
        return _make_completed(0)

    def fake_stat(self, *a, **kw):
        st = MagicMock(); st.st_size = 1024; return st

    def fake_transcribe_with_timeout(self, engine, path):
        raise AsrEngineError("download_failed", "模型下载失败：网络无法连接下载源")

    monkeypatch.setattr(video_service, "_run_subprocess", fake_run)
    monkeypatch.setattr(Path, "stat", fake_stat)
    monkeypatch.setattr(video_service.VideoCollectService, "_transcribe_with_timeout", fake_transcribe_with_timeout)

    fake_engine = MagicMock()
    fake_engine.is_available.return_value = True
    monkeypatch.setattr(video_service, "get_asr_engine", lambda name=None: fake_engine)

    with pytest.raises(video_service.VideoCollectError) as exc_info:
        svc.collect_video(CollectVideoRequest(url="https://v.douyin.com/abc/"))
    assert exc_info.value.code == "ASR_DOWNLOAD_FAILED"
    assert "模型下载失败" in exc_info.value.message
