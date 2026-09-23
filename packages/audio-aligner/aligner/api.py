"""audio-aligner REST API（FastAPI，端口默认 8004，PORT 环境变量优先）。"""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .core import transcribe
from .path_guard import AudioPathError, allowed_roots, resolve_audio_path

# 显式配置 root logger：audio-aligner 无 uvicorn/basicConfig 时，INFO 级日志会被
# logging lastResort 静默丢弃（仅 WARNING+ 落 stderr）——跨进程 request_id 必须可见（logging-contract R4）。
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s:%(funcName)s:%(lineno)d | %(message)s",
)

logger = logging.getLogger("audio-aligner")
app = FastAPI(title="Audio Aligner", version="0.1.0")


class AlignRequest(BaseModel):
    audio_path: str = Field(
        ...,
        description="音频文件绝对路径（wav/mp3/m4a 等 ffmpeg 可解码格式），" 
        "必须位于 AUDIO_ALIGNER_ALLOWED_DIRS 允许目录内，越界返回 403",
    )
    options: dict = Field(default_factory=dict, description="model/language/beam_size/vad_filter/initial_prompt/max_seconds")


@app.get("/health")
def health():
    # allowed_roots 出现在 health 里：403 排障时第一件事就是确认「当前允许哪些目录」
    return {"status": "ok", "service": "audio-aligner", "model_ready": True, "allowed_roots": allowed_roots()}


@app.post("/align")
def align(req: AlignRequest, x_request_id: Optional[str] = Header(default=None)):
    """音频 → ASR 词级时间（供 Node 聚合器对齐分句块）。

    - 仅做 ASR（words/segments）；文本块聚合在 Node 侧（story2video-engine subtitle-aligner）；
    - initial_prompt 可传分句块拼接文本提升中文识别准确率；
    - X-Request-Id：桌面端跨进程 traceId（pipeline runId），写入日志便于桌面↔Python 日志关联。
      注意：此头为关联 id 而非安全边界，不做白名单校验（runId 含 `_`，与 server.py 白名单不同）。
    """
    request_id = (x_request_id or "").strip() or "-"
    # 目录边界先于任何解码动作：否则 /align 等价于「任意本地文件读取原语」（体检报告 P2 安全小项）。
    try:
        audio_path = resolve_audio_path(req.audio_path)
    except AudioPathError as e:
        logger.warning("align request_id=%s rejected=%s audio_path=%s", request_id, e.code, req.audio_path)
        raise HTTPException(status_code=e.status_code, detail=e.message) from e
    try:
        opts = dict(req.options or {})
        if "model" in opts:  # 公开参数名 model → core.model_size
            opts["model_size"] = opts.pop("model")
        result = transcribe(audio_path, **opts)
    except FileNotFoundError as e:
        logger.warning("align request_id=%s audio_path=%s failed=not_found", request_id, audio_path)
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("align failed request_id=%s audio_path=%s", request_id, audio_path)
        raise HTTPException(status_code=500, detail=f"align failed: {e}") from e
    words = result.get("words") if isinstance(result, dict) else None
    segments = result.get("segments") if isinstance(result, dict) else None
    duration = result.get("duration") if isinstance(result, dict) else 0
    logger.info(
        "align request_id=%s audio_path=%s words=%d segments=%d duration=%.2f",
        request_id,
        audio_path,
        len(words) if isinstance(words, list) else 0,
        len(segments) if isinstance(segments, list) else 0,
        float(duration or 0),
    )
    return result
