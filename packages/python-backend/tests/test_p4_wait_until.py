"""P2 技术债（audit-batch-4）：条件轮询工具 ``wait_until`` 与小红书发布器脆弱等待改造。

原实现两处固定 sleep：
  * 导航后 ``await asyncio.sleep(3)``——SPA 上传页控件未挂载时 3s 不够，挂载快时白等；
  * 上传完成标志缺失时 ``await asyncio.sleep(30)``——不论是否已完成都硬等半分钟。
改为条件轮询（判据 + 具名上限 + 超时原因），上限沿用原时长，只让快路径提前返回。
"""
import asyncio
import io
import os
import time

from multi_publish.publishers.base import wait_until

PUBLISHERS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "src", "multi_publish", "publishers",
)


def test_returns_true_as_soon_as_condition_holds():
    calls = {"n": 0}

    def pred():
        calls["n"] += 1
        return calls["n"] >= 3

    start = time.monotonic()
    assert asyncio.run(wait_until(pred, timeout_s=5.0, interval_s=0.05)) is True
    assert calls["n"] == 3
    # 快路径提前返回：不应当等到上限
    assert time.monotonic() - start < 1.0


def test_first_check_is_immediate_no_blind_sleep():
    """条件已成立时不得先睡一轮（这正是固定 sleep 的病灶）。"""
    start = time.monotonic()
    assert asyncio.run(wait_until(lambda: True, timeout_s=30.0, interval_s=1.0)) is True
    assert time.monotonic() - start < 0.2


def test_times_out_and_reports_false_without_raising():
    start = time.monotonic()
    assert asyncio.run(wait_until(lambda: False, timeout_s=0.3, interval_s=0.05)) is False
    elapsed = time.monotonic() - start
    assert 0.25 <= elapsed < 1.0, f"等待窗口不对：{elapsed:.3f}s"


def test_predicate_exception_is_treated_as_not_ready():
    """页面导航中等瞬时错误不该终止等待，也不该把异常抛给调用方。"""
    calls = {"n": 0}

    def pred():
        calls["n"] += 1
        if calls["n"] < 2:
            raise RuntimeError("page is navigating")
        return True

    assert asyncio.run(wait_until(pred, timeout_s=2.0, interval_s=0.05)) is True


def test_async_predicate_supported():
    async def pred():
        await asyncio.sleep(0)
        return "ok"

    assert asyncio.run(wait_until(pred, timeout_s=1.0, interval_s=0.05)) is True


def test_zero_timeout_still_checks_once():
    """上限为 0 也要先判一次：条件已成立时不该直接判失败。"""
    assert asyncio.run(wait_until(lambda: True, timeout_s=0.0, interval_s=0.5)) is True
    assert asyncio.run(wait_until(lambda: False, timeout_s=0.0, interval_s=0.5)) is False


def test_sleep_never_crosses_deadline():
    """末次等待被裁剪到上限时刻，不会超出 timeout_s。"""
    start = time.monotonic()
    asyncio.run(wait_until(lambda: False, timeout_s=0.4, interval_s=1.0))
    assert time.monotonic() - start < 0.8


def test_xiaohongshu_publisher_no_longer_blind_sleeps():
    src = io.open(os.path.join(PUBLISHERS_DIR, "xiaohongshu.py"), encoding="utf-8").read()
    assert "await asyncio.sleep(30)" not in src, "上传兜底仍是无条件 sleep(30)"
    assert "await asyncio.sleep(3)" not in src, "导航后仍是无条件 sleep(3)"
    assert src.count("wait_until(") >= 2
    # 上限沿用原时长，只收紧快路径，不放宽容忍度
    assert "UPLOAD_FALLBACK_WAIT_TIMEOUT_S = 30.0" in src
    # 超时必须有原因留痕
    assert "改为轮询编辑器就绪" in src and "编辑器在" in src
