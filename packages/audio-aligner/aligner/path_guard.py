"""audio-aligner 音频路径约束（体检报告 P2 安全小项：`audio_path` 无目录约束）。

风险：``POST /align`` 直接把调用方给的绝对路径交给 ffmpeg / faster-whisper，
等价于「任意本地文件读取原语」——把 ``C:/Users/<u>/Documents/合同.docx`` 或
``~/.ssh/id_rsa`` 传进来，服务会尽力解码并把可读出内容以转写结果/错误信息形式回传。
服务监听 127.0.0.1:8004 且无鉴权，任何本机进程（含渲染出去的网页）都能命中它。

口径（与 desktop 侧 ``core/ipc-security.js`` 的 file:// 目录边界保持一致）：
- 绝对路径 + 无空字节 + 非空，否则 ``invalid_path``(400)；
- 先 ``realpath`` 再判定包含关系 ⇒ 符号链接/junction 指向外部照样拦；
- 目录包含用 ``commonpath``，不用字符串前缀（``/a/dist`` 与 ``/a/dist-evil`` 前缀相同）；
- **先判目录再判存在性**：反序会把 403 变成 404，给调用方一个「外部文件是否存在」的探测 oracle；
- 允许目录来自 ``AUDIO_ALIGNER_ALLOWED_DIRS``（``os.pathsep`` 分隔）；未设置时**默认只允许系统临时目录**
  （fail-closed 而非 fail-open）。桌面端 ``AlignerBridge`` 启动子进程时会显式注入
  ``tmp + userData``，真实 TTS 产物均落在 ``os.tmpdir()/story2video`` 下，因此默认策略不破坏现有链路。
"""
from __future__ import annotations

import logging
import os
import tempfile
from typing import List, Optional

logger = logging.getLogger("audio-aligner")

ENV_ALLOWED_DIRS = "AUDIO_ALIGNER_ALLOWED_DIRS"

# code → HTTP 语义（api 层映射，core 层保持纯逻辑不依赖 FastAPI）
INVALID_PATH = "invalid_path"
NOT_ALLOWED = "not_allowed"
NOT_FOUND = "not_found"
NOT_A_FILE = "not_a_file"

_STATUS_BY_CODE = {INVALID_PATH: 400, NOT_ALLOWED: 403, NOT_FOUND: 404, NOT_A_FILE: 400}


class AudioPathError(ValueError):
    """音频路径不合规。``code`` 决定 HTTP 状态码，``message`` 面向调用方可执行。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    @property
    def status_code(self) -> int:
        return _STATUS_BY_CODE.get(self.code, 400)


def allowed_roots(env: Optional[dict] = None) -> List[str]:
    """解析允许目录（已 realpath 去重，保持配置顺序）。未配置 ⇒ 仅系统临时目录。"""
    source = os.environ if env is None else env
    raw = source.get(ENV_ALLOWED_DIRS) or ""
    configured = [item.strip() for item in raw.split(os.pathsep) if item.strip()]
    roots = configured or [tempfile.gettempdir()]
    resolved: List[str] = []
    for root in roots:
        try:
            real = os.path.realpath(os.path.abspath(root))
        except OSError:  # 不可解析的配置项跳过，不让它把整个服务拖崩
            logger.warning("忽略不可解析的 %s 配置项: %r", ENV_ALLOWED_DIRS, root)
            continue
        if real not in resolved:
            resolved.append(real)
    return resolved


def is_inside(root: str, candidate: str) -> bool:
    """candidate 是否位于 root 内（含 root 自身）。用 commonpath 而非 startswith 防兄弟目录前缀。"""
    try:
        return os.path.commonpath([root, candidate]) == root
    except ValueError:
        # 不同盘符（Windows 的 C: 与 D:）/ UNC 与本地盘混用 ⇒ 必然不包含
        return False


def resolve_audio_path(audio_path: str, roots: Optional[List[str]] = None) -> str:
    """校验并返回规范化后的音频绝对路径；不合规抛 AudioPathError。"""
    if not isinstance(audio_path, str) or not audio_path.strip():
        raise AudioPathError(INVALID_PATH, "audio_path 必须是非空字符串")
    if "\x00" in audio_path:
        raise AudioPathError(INVALID_PATH, "audio_path 含非法空字节")
    if not os.path.isabs(audio_path):
        raise AudioPathError(
            INVALID_PATH,
            f"audio_path 必须是绝对路径（收到: {audio_path!r}）",
        )

    real = os.path.realpath(os.path.abspath(audio_path))
    allowed = roots if roots is not None else allowed_roots()

    # 目录边界先于存在性检查：否则外部路径可用 403/404 差异枚举文件是否存在
    if not any(is_inside(root, real) for root in allowed):
        raise AudioPathError(
            NOT_ALLOWED,
            "audio_path 越出允许目录: {}；允许目录: {}（如需放开，追加到环境变量 {}）".format(
                audio_path, allowed, ENV_ALLOWED_DIRS
            ),
        )

    if not os.path.exists(real):
        raise AudioPathError(NOT_FOUND, f"音频文件不存在: {real}")
    if not os.path.isfile(real):
        raise AudioPathError(NOT_A_FILE, f"audio_path 不是文件（目录被拒绝）: {real}")
    return real
