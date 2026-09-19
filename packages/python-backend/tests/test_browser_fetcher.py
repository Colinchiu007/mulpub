"""browser_fetcher 单元测试 — 抖音浏览器降级通道（2026-09-19）。

覆盖：视频 ID 提取（多 URL 形态）、短链解析、_dig 嵌套取值、错误分类。
不测真实网络（Playwright 集成由 collect_video 全链路验证）。
"""

import pytest

from multi_publish.aggregation.browser_fetcher import (
    BrowserFetchError,
    _dig,
    extract_video_id,
)


class TestExtractVideoId:
    def test_video_url(self):
        assert extract_video_id("https://www.douyin.com/video/7686432847778982833", "douyin") == "7686432847778982833"

    def test_share_video_url(self):
        assert extract_video_id("https://www.iesdouyin.com/share/video/7686432847778982833/?region=CN", "douyin") == "7686432847778982833"

    def test_modal_id_url(self):
        assert extract_video_id("https://www.douyin.com/?modal_id=7686432847778982833", "douyin") == "7686432847778982833"

    def test_short_link_no_id(self):
        # 短链（v.douyin.com/xxx）本身不含数字 ID，需先经 resolve_short_link
        assert extract_video_id("https://v.douyin.com/vknKdeN_naU/", "douyin") is None

    def test_unknown_platform(self):
        assert extract_video_id("https://www.douyin.com/video/123", "kuaishou") is None


class TestDig:
    def test_nested_path(self):
        data = {"aweme_detail": {"video": {"play_addr": {"url_list": ["https://a", "https://b"]}}}}
        urls = _dig(data, ("aweme_detail", "video", "play_addr", "url_list"))
        assert urls[0] == "https://a"

    def test_missing_path_returns_none(self):
        assert _dig({}, ("a", "b", "c")) is None

    def test_non_dict_returns_none(self):
        assert _dig([1, 2], ("a",)) is None


class TestBrowserFetchError:
    def test_error_structure(self):
        e = BrowserFetchError("no_browser", "playwright 未安装")
        assert e.code == "no_browser"
        assert e.message == "playwright 未安装"
