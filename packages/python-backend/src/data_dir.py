"""数据目录解析（独立轻量模块，便于无副作用测试）。

背景：Electron 侧曾把带尾随空格的 ELECTRON_USER_DATA_DIR 透传下来，
path.join 后空格落在路径中间（'shared-user-data \\backend-data'），
mkdir(parents=True) 抛 WinError 3 且报错隐晦。这里 strip + fail-fast，
把不可见的空白问题变成可读的启动错误。
"""
from __future__ import annotations

from pathlib import Path


def ensure_data_dir(raw_value, default_dir: Path) -> Path:
    """解析并创建数据目录。

    - raw_value 首尾空白一律 strip；为空时回退 default_dir
    - 路径中间残留非法空白（mkdir 失败）时 SystemExit 并打印 repr，便于定位
    """
    value = (raw_value or "").strip()
    data_dir = Path(value).expanduser() if value else Path(default_dir)
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise SystemExit(
            "FATAL: cannot create data directory "
            + repr(str(data_dir))
            + "; check ELECTRON_USER_DATA_DIR / MULTI_PUBLISH_DATA_DIR "
            + "for stray whitespace (original error: "
            + str(exc)
            + ")"
        ) from exc
    return data_dir
