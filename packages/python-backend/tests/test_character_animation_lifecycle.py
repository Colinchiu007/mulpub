"""P1-12 回归保护：_render_preview_mp4 的 Playwright 生命周期必须 try/finally。

体检报告问题 12（P1）：`browser = p.chromium.launch()` 之后若 `page.goto` / `page.screenshot`
抛异常（页面渲染失败、超时、磁盘写入失败），`browser.close()` 被整段跳过 —— 每次失败泄漏一个
Chromium 进程组。跑批生成角色预览时，连续失败会把机器内存/句柄吃满，且症状（越跑越慢）与根因
（异常路径未释放）相距很远，排查成本极高。

同仓 `browser_fetcher.py` 已是正确范式，本次把该范式固化成回归用例。
"""
import sys
import types
from pathlib import Path

import pytest

from multi_publish.video_creation.character import character_animation_utils as cau


class FakePage:
    def __init__(self, fail_at=None):
        self.fail_at = fail_at
        self.screenshots = 0

    def goto(self, *args, **kwargs):
        if self.fail_at == "goto":
            raise RuntimeError("goto boom")

    def wait_for_timeout(self, ms):
        pass

    def screenshot(self, **kwargs):
        self.screenshots += 1
        if self.fail_at == "screenshot":
            raise RuntimeError("screenshot boom")


class FakeBrowser:
    def __init__(self, page):
        self._page = page
        self.closed = False
        self.close_calls = 0

    def new_page(self, **kwargs):
        return self._page

    def close(self):
        self.close_calls += 1
        self.closed = True


class FakePlaywright:
    def __init__(self, browser):
        self.chromium = types.SimpleNamespace(launch=lambda *a, **k: browser)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _install_fake_playwright(monkeypatch, browser):
    sync_api = types.ModuleType("playwright.sync_api")
    sync_api.sync_playwright = lambda: FakePlaywright(browser)
    pkg = types.ModuleType("playwright")
    pkg.sync_api = sync_api
    monkeypatch.setitem(sys.modules, "playwright", pkg)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", sync_api)


@pytest.fixture()
def paths(tmp_path):
    preview = tmp_path / "preview.html"
    preview.write_text("<html><body>ok</body></html>", encoding="utf-8")
    return preview, tmp_path / "preview.mp4"


@pytest.mark.parametrize("fail_at", ["goto", "screenshot"])
def test_browser_closed_when_render_fails(monkeypatch, paths, fail_at):
    """P1-12: 任一阶段抛异常，浏览器仍须 close()，且原异常照常上抛（不吞错）。"""
    preview, video = paths
    monkeypatch.setattr(cau.shutil, "which", lambda exe: "/usr/bin/ffmpeg")
    browser = FakeBrowser(FakePage(fail_at=fail_at))
    _install_fake_playwright(monkeypatch, browser)

    with pytest.raises(RuntimeError, match=fail_at):
        cau._render_preview_mp4(preview, video, 0.5, 2)

    assert browser.closed, f"P1-12: {fail_at} 抛异常时浏览器未关闭（Chromium 进程泄漏）"
    assert browser.close_calls == 1, "P1-12: browser.close() 必须恰好调用一次"


def test_browser_closed_on_happy_path(monkeypatch, paths):
    """正常路径也必须关闭浏览器（避免 try/finally 改成双重关闭）。"""
    preview, video = paths
    monkeypatch.setattr(cau.shutil, "which", lambda exe: "/usr/bin/ffmpeg")
    page = FakePage()
    browser = FakeBrowser(page)
    _install_fake_playwright(monkeypatch, browser)

    called = {}

    def fake_run(cmd, **kwargs):
        called["cmd"] = cmd
        return types.SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(cau.subprocess, "run", fake_run)
    cau._render_preview_mp4(preview, video, 1.0, 2)

    assert browser.closed and browser.close_calls == 1
    assert page.screenshots == 2, "1s@2fps 应截 2 帧"
    assert called["cmd"][0] == "ffmpeg"


def test_source_has_finally_guard():
    """静态兜底：browser.close() 必须在 finally 块内（防止后续重构又改回去）。"""
    import inspect

    src = inspect.getsource(cau._render_preview_mp4)
    assert "finally:" in src, "P1-12: _render_preview_mp4 缺少 try/finally 生命周期保护"
    tail = src.split("finally:")[-1]
    assert "browser.close()" in tail, "P1-12: browser.close() 不在 finally 块内"


def test_preview_dir_helper_still_importable():
    """烟雾：模块未因改动破坏公开符号。"""
    assert callable(cau._render_preview_mp4)
    assert Path(__file__).exists()
