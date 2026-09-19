"""ASR 引擎抽象层 — 视频采集语音转写。

统一接口：transcribe(audio_path) / is_available() / install_hint()。
引擎选择：环境变量 ASR_ENGINE（faster_whisper | sensevoice | siliconflow），默认 faster_whisper。
Phase 1 实现 FasterWhisperEngine；sensevoice/siliconflow 为 Phase 2 预留。
"""

from __future__ import annotations

import os
import logging
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# faster-whisper base 模型 repo（faster_whisper.utils._MODELS["base"]）
_MODEL_REPO = "Systran/faster-whisper-base"
# 下载源优先级列表（国内镜像优先 + 备用自动切换，2026-09-19）：
# 1. hf-mirror.com（国内社区镜像，长期稳定，实测 ~724KB/s）
# 2. huggingface.co 直连（官方源，国内间歇可达）
# 用户显式设置 HF_ENDPOINT 时跳过全部探测直接使用（尊重配置不覆盖）。
_HF_ENDPOINT_CANDIDATES = [
    "https://hf-mirror.com",
    "https://huggingface.co",
]


def _snapshot_download(**kwargs):
    """huggingface_hub.snapshot_download 的可注入包装（测试 mock 点）。"""
    import huggingface_hub
    return huggingface_hub.snapshot_download(**kwargs)


def _probe_endpoint(url: str, timeout: float = 5.0) -> bool:
    """HEAD 探测下载源可达性（默认 5 秒超时）。非 2xx/3xx 或异常均视为不可达。"""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Multi-Publish-ASR/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 400
    except Exception:
        return False


def _resolve_download_endpoint() -> str:
    """按优先级选择下载源：用户显式 HF_ENDPOINT > 逐个探测镜像列表 > 第一个可达源。"""
    explicit = os.environ.get("HF_ENDPOINT", "").strip()
    if explicit:
        logger.info(f"[asr] 使用用户显式设置的 HF_ENDPOINT: {explicit}")
        return explicit
    for endpoint in _HF_ENDPOINT_CANDIDATES:
        if _probe_endpoint(endpoint):
            logger.info(f"[asr] 下载源可达，使用 {endpoint} 下载模型")
            return endpoint
        logger.warning(f"[asr] 下载源不可达: {endpoint}，尝试下一个")
    logger.warning(f"[asr] 全部下载源探测失败，回退 {_HF_ENDPOINT_CANDIDATES[0]}")
    return _HF_ENDPOINT_CANDIDATES[0]


def _get_model_cache_dir() -> str:
    """模型缓存目录（huggingface_hub 默认缓存，供手动下载指引展示）。"""
    try:
        from huggingface_hub import constants as hf_constants
        return str(hf_constants.HF_HUB_CACHE)
    except Exception:
        return os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")


def _classify_download_error(e: Exception, model_size: str = "base") -> str:
    """把模型下载异常映射为含可操作建议的中文提示（含手动下载兜底指引）。"""
    repo = _MODEL_REPO if model_size == "base" else model_size
    cache_dir = _get_model_cache_dir()
    manual = (f"手动下载：访问 https://huggingface.co/{repo}/tree/main（或镜像 https://hf-mirror.com/{repo}/tree/main），"
              f"下载 config.json / model.bin / tokenizer.json / vocabulary.txt 四个文件后放入缓存目录 {cache_dir} 下")
    msg_str = str(e)

    # 磁盘不足（errno 28）
    if isinstance(e, OSError) and getattr(e, "errno", None) == 28:
        return f"模型下载失败：磁盘空间不足。请清理磁盘后重试（模型约 141MB，缓存目录 {cache_dir}）。{manual}"
    # 离线模式冲突
    try:
        from huggingface_hub.errors import OfflineModeIsEnabled
        if isinstance(e, OfflineModeIsEnabled):
            return f"模型下载失败：HuggingFace 处于离线模式（HF_HUB_OFFLINE=1）但本地无模型缓存。请取消该环境变量后重试。{manual}"
    except ImportError:
        pass
    # 网络类（含 requests/urllib3 异常——huggingface_hub 底层用 requests，其异常不继承内建类型）
    import socket
    network_types = [ConnectionError, socket.timeout, TimeoutError]
    try:
        import requests.exceptions as req_exc
        network_types.extend([req_exc.ConnectionError, req_exc.Timeout])
    except ImportError:
        pass
    if isinstance(e, tuple(network_types)) or "connection" in msg_str.lower() or "timed out" in msg_str.lower() or "max retries exceeded" in msg_str.lower():
        return f"模型下载失败：网络无法连接下载源。请检查网络连接（国内推荐设置 HF_ENDPOINT=https://hf-mirror.com）或配置代理后重试。{manual}"
    # 仓库不存在 / HTTP 错误
    try:
        from huggingface_hub.errors import RepositoryNotFoundError
        if isinstance(e, RepositoryNotFoundError):
            return f"模型下载失败：模型仓库不存在（{repo}）。{manual}"
    except ImportError:
        pass
    # 兜底：未知异常仍给手动下载路径
    return f"模型下载失败：{msg_str[:200]}。{manual}"


@dataclass
class AsrResult:
    """转写结果"""
    text: str = ""
    language: str = ""
    duration_seconds: float = 0.0
    segments: list[dict] = field(default_factory=list)
    engine: str = ""


class AsrEngineError(Exception):
    """ASR 引擎错误（code: engine_unavailable / download_failed / timeout / no_audio / failed）"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class AsrEngine(ABC):
    """ASR 引擎抽象基类"""

    name: str = "abstract"

    @abstractmethod
    def transcribe(self, audio_path: str, *, language: str | None = None) -> AsrResult:
        """转写音频文件（16kHz 单声道 WAV 最佳）。失败抛 AsrEngineError。"""

    @abstractmethod
    def is_available(self) -> bool:
        """引擎依赖是否可用（库已装/二进制存在/API Key 已配）。"""

    @abstractmethod
    def install_hint(self) -> str:
        """依赖缺失时的中文安装指引。"""


class FasterWhisperEngine(AsrEngine):
    """faster-whisper 本地引擎（Phase 1 默认）。

    核心逻辑与 video_creation/analysis/transcriber.py 一致：
    model_size=base、CPU int8（CUDA 可用时 float16）、VAD 过滤、segments 拼接全文。
    """

    name = "faster_whisper"

    def __init__(self, model_size: str = "base"):
        self._model_size = model_size
        self._model = None  # 懒加载 + 缓存：WhisperModel 冷启动 5-10s，重复转写必须复用

    def is_available(self) -> bool:
        try:
            import faster_whisper  # noqa: F401
            return True
        except ImportError:
            return False

    def install_hint(self) -> str:
        return "语音转写引擎不可用，请安装 faster-whisper：pip install faster-whisper（模型首次使用时自动下载，国内可设 HF_ENDPOINT=https://hf-mirror.com）"

    def _get_model_cache_dir(self) -> str:
        return _get_model_cache_dir()

    def is_model_ready(self) -> bool:
        """模型是否已缓存（纯本地查询，local_files_only 不发网络请求）。"""
        try:
            _snapshot_download(
                repo_id=_MODEL_REPO,
                local_files_only=True,
                allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"],
                cache_dir=self._get_model_cache_dir(),
            )
            return True
        except Exception:
            return False

    def ensure_model(self) -> None:
        """确保模型就绪：已缓存直接返回；未缓存走下载管理（源选择 + 下载 + 失败分类）。

        失败抛 AsrEngineError(code="download_failed")，message 含可操作建议与手动下载指引。
        """
        if self.is_model_ready():
            logger.info(f"[asr] 模型已缓存（{_MODEL_REPO}），跳过下载")
            return
        endpoint = _resolve_download_endpoint()
        try:
            logger.info(f"[asr] 开始下载模型 {_MODEL_REPO}（约 141MB，源 {endpoint}）...")
            # 经 HfApi(endpoint=...) 传参指定下载源，不修改 os.environ（多线程安全，用户显式设置不被覆盖）
            import huggingface_hub
            api = huggingface_hub.HfApi(endpoint=endpoint)
            api.snapshot_download(
                repo_id=_MODEL_REPO,
                allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"],
                cache_dir=self._get_model_cache_dir(),
                max_workers=2,
            )
            logger.info(f"[asr] 模型下载完成: {_MODEL_REPO}")
        except Exception as e:
            logger.error(f"[asr] 模型下载失败（源 {endpoint}）: {e}")
            raise AsrEngineError("download_failed", _classify_download_error(e, self._model_size)) from e

    def transcribe(self, audio_path: str, *, language: str | None = None) -> AsrResult:
        if not Path(audio_path).exists():
            raise AsrEngineError("no_audio", f"音频文件不存在: {audio_path}")
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise AsrEngineError("engine_unavailable", self.install_hint())

        # 模型预检 + 下载管理：未就绪且下载失败时给出专属错误码与可操作提示
        try:
            self.ensure_model()
        except AsrEngineError:
            raise

        try:
            segments_iter, info = self._get_model().transcribe(
                str(audio_path),
                language=language,
                word_timestamps=False,
                vad_filter=True,
            )
        except Exception as e:
            raise AsrEngineError("failed", f"faster-whisper 转写失败: {e}")

        segments = []
        texts = []
        for seg in segments_iter:
            text = seg.text.strip()
            if text:
                texts.append(text)
            segments.append({"id": seg.id, "start": round(seg.start, 3), "end": round(seg.end, 3), "text": text})

        return AsrResult(
            text="".join(texts),
            language=language or info.language,
            duration_seconds=round(info.duration, 3),
            segments=segments,
            engine=self.name,
        )

    def _get_model(self):
        """懒加载并缓存 WhisperModel 实例（线程安全：CPython GIL 下竞态只导致重复加载，结果一致）。"""
        if self._model is not None:
            return self._model
        from faster_whisper import WhisperModel
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
            compute_type = "float16" if device == "cuda" else "int8"
        except ImportError:
            device = "cpu"
            compute_type = "int8"
        self._model = WhisperModel(self._model_size, device=device, compute_type=compute_type)
        return self._model


class SenseVoiceEngine(AsrEngine):
    """SenseVoice 本地引擎（Phase 2 预留）— llama.cpp GGUF 单二进制。"""

    name = "sensevoice"

    def is_available(self) -> bool:
        return bool(os.environ.get("ASR_SENSEVOICE_BIN")) and bool(os.environ.get("ASR_SENSEVOICE_MODEL"))

    def install_hint(self) -> str:
        return "SenseVoice 引擎未配置：请从 FunASR GitHub Releases 下载 funasr-llamacpp-windows-x64-avx2.zip 并设置 ASR_SENSEVOICE_BIN 与 ASR_SENSEVOICE_MODEL 环境变量"

    def transcribe(self, audio_path: str, *, language: str | None = None) -> AsrResult:
        raise AsrEngineError("engine_unavailable", "SenseVoice 引擎将在 Phase 2 提供，当前请使用 faster_whisper 或 siliconflow")


class SiliconFlowEngine(AsrEngine):
    """SiliconFlow SenseVoice 在线引擎（Phase 2 预留）— FunAudioLLM/SenseVoiceSmall 免费 API。"""

    name = "siliconflow"

    def is_available(self) -> bool:
        return bool(os.environ.get("SILICONFLOW_API_KEY"))

    def install_hint(self) -> str:
        return "SiliconFlow 引擎未配置：请注册 SiliconFlow（https://siliconflow.cn）并设置 SILICONFLOW_API_KEY 环境变量"

    def transcribe(self, audio_path: str, *, language: str | None = None) -> AsrResult:
        raise AsrEngineError("engine_unavailable", "SiliconFlow 引擎将在 Phase 2 提供，当前请使用 faster_whisper")


_ENGINES: dict[str, type[AsrEngine]] = {
    "faster_whisper": FasterWhisperEngine,
    "sensevoice": SenseVoiceEngine,
    "siliconflow": SiliconFlowEngine,
}


def get_asr_engine(engine_name: str | None = None) -> AsrEngine:
    """按名称或环境变量获取引擎实例。未知名称抛 AsrEngineError。"""
    name = (engine_name or os.environ.get("ASR_ENGINE") or "faster_whisper").strip()
    cls = _ENGINES.get(name)
    if cls is None:
        raise AsrEngineError(
            "engine_unavailable",
            f"不支持的 ASR 引擎: {name}，支持: {', '.join(sorted(_ENGINES))}",
        )
    return cls()
