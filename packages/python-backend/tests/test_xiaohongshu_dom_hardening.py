"""小红书 DOM/RPA 轨加固单测（rpa-xiaohongshu-dom-hardening PR-1）。

用注入的假 page + 假 monitor 覆盖发布编排的核心分支，零真实浏览器：
- 草稿 fail-closed：找不到草稿入口绝不 fallthrough 点发布。
- 确认才成功：XHR 响应命中才成功且带真实 url；无正面确认绝不报成功。
- 选择器多候选回退；contenteditable 走 dispatch；标签逐个 type 不覆盖。
- 登录过期 / 风控弹层归一到对应错误码。
"""

from __future__ import annotations

import re

import pytest
from loguru import logger

from multi_publish.models import PlatformType
from multi_publish.publishers import xiaohongshu as xhs
from multi_publish.publishers import xiaohongshu_dom as dom
from multi_publish.publishers.base import PublisherConfig
from multi_publish.publishers.xiaohongshu import XiaoHongShuPublisher


class FakeLocator:
    def __init__(self, page, sel, index=None):
        self._page = page
        self._sel = sel
        self._index = index

    @property
    def first(self):
        return self

    async def is_visible(self):
        calls = self._page.visibility_calls
        calls[self._sel] = calls.get(self._sel, 0) + 1
        if self._sel in self._page.visible_after:
            return calls[self._sel] > self._page.visible_after[self._sel]
        if self._index is not None and self._index in self._page.hidden_items.get(self._sel, set()):
            return False
        return self._sel in self._page.visible

    async def count(self):
        return self._page.count_for(self._sel)

    def nth(self, i):
        return FakeLocator(self._page, self._sel, i)

    async def inner_text(self):
        texts = self._page.item_texts.get(self._sel, [])
        if self._index is not None and self._index < len(texts):
            return texts[self._index]
        return texts[0] if texts else ""

    async def click(self, *a, **k):
        self._page.clicked.append(self._sel)

    async def fill(self, text):
        if self._sel in self._page.not_fillable:
            raise AssertionError("Element is not an <input> (simulate contenteditable)")
        self._page.filled.setdefault(self._sel, []).append(text)

    async def type(self, text, delay=0):
        self._page.typed.append((self._sel, text))

    async def press(self, key):
        self._page.pressed.append(key)

    async def set_input_files(self, paths):
        self._page.uploaded.append(paths)

    async def evaluate(self, js, arg=None):
        self._page.evaluated.append((self._sel, arg))


class FakePage:
    def __init__(self):
        self.visible: set[str] = set()
        # 延迟挂载：selector -> 需要前 N 次可见性查询返回 False（模拟 SPA 控件晚到）
        self.visible_after: dict[str, int] = {}
        self.visibility_calls: dict[str, int] = {}  # 每个 selector 被查询可见性的次数
        self.counts: dict[str, int] = {}
        # 逐元素可见性：selector -> 该 selector 命中集合里**不可见**的下标
        # （模拟 SPA 常驻隐藏模板占满 DOM 前部、portal 把真实弹层挂到尾部）
        self.hidden_items: dict[str, set[int]] = {}
        self.not_fillable: set[str] = set()
        self.item_texts: dict[str, list[str]] = {}
        self.url = "https://creator.xiaohongshu.com/publish/publish"
        self.navigations: list[str] = []
        self.clicked: list[str] = []
        self.filled: dict[str, list[str]] = {}
        self.typed: list[tuple[str, str]] = []
        self.pressed: list[str] = []
        self.uploaded: list = []
        self.evaluated: list[tuple[str, str]] = []

    async def goto(self, url, **k):
        self.navigations.append(url)

    def locator(self, sel):
        return FakeLocator(self, sel)

    def count_for(self, sel):
        if sel in self.item_texts:
            return len(self.item_texts[sel])
        if sel in self.counts:
            return self.counts[sel]
        return 1 if sel in self.visible else 0


class FakeMonitor:
    def __init__(self, responses=None):
        self.responses = responses or []
        self.watched: list[str] = []

    def watch_patterns(self, patterns):
        self.watched = list(patterns)

    async def wait_for_response(self, timeout=30.0, predicate=None):
        for r in self.responses:
            data = r.get("data")
            if predicate is None or predicate(data):
                return data
        return None

    def stop(self):
        pass


TITLE_SEL = '[placeholder*="标题"]'  # title_input 回退链首个候选
DRAFT_SEL = 'button:has-text("存草稿")'  # draft_button 回退链首个候选
PUBLISH_SEL = 'button:has-text("发布")'


@pytest.fixture
def publisher(tmp_path) -> XiaoHongShuPublisher:
    return XiaoHongShuPublisher(
        PublisherConfig(platform=PlatformType.XIAOHONGSHU, data_dir=str(tmp_path), headless=True)
    )


def _base_page():
    p = FakePage()
    p.visible.add(TITLE_SEL)  # 标题可解析可填
    return p


async def _flow(pub, page, monitor, **kw):
    params = dict(title="测试标题", content="正文", media_paths=[], cover_path=None, tags=[], draft=True)
    params.update(kw)
    return await pub._execute_flow(page, monitor, **params)


class TestDraftFailClosed:
    @pytest.mark.asyncio
    async def test_missing_draft_entry_blocks_public_publish(self, publisher, monkeypatch):
        monkeypatch.setattr(xhs, "DRAFT_SAVE_RESPONSE_PATTERNS", [], raising=False)
        page = _base_page()
        page.visible.add(PUBLISH_SEL)  # 发布按钮存在，但草稿入口缺失
        result = await _flow(publisher, page, FakeMonitor(), draft=True)
        assert result.success is False
        assert xhs.CODE_DRAFT_ENTRY_MISSING in (result.error or "")
        # 关键红线：绝不能点击公开发布按钮
        assert PUBLISH_SEL not in page.clicked


class TestConfirmBeforeSuccess:
    @pytest.mark.asyncio
    async def test_response_confirms_and_sets_real_url(self, publisher, monkeypatch):
        monkeypatch.setattr(xhs, "DRAFT_SAVE_RESPONSE_PATTERNS", ["/draft/save"], raising=False)
        page = _base_page()
        page.visible.add(DRAFT_SEL)
        monitor = FakeMonitor(responses=[{"url": "/draft/save", "data": {"code": 0, "data": {"draft_id": "D123"}}}])
        result = await _flow(publisher, page, monitor, draft=True)
        assert result.success is True
        assert "D123" in (result.url or "")
        assert DRAFT_SEL in page.clicked

    @pytest.mark.asyncio
    async def test_no_confirmation_reports_failure_not_blind_success(self, publisher, monkeypatch):
        monkeypatch.setattr(xhs, "DRAFT_SAVE_RESPONSE_PATTERNS", [], raising=False)
        page = _base_page()
        page.visible.add(DRAFT_SEL)
        page.item_texts[xhs.DRAFT_BOX_ITEM_SELECTOR] = []  # 草稿箱回查无命中
        result = await _flow(publisher, page, FakeMonitor(), draft=True)
        assert result.success is False
        assert xhs.CODE_UNCONFIRMED in (result.error or "")


class TestSelectorFallbackAndRichFill:
    @pytest.mark.asyncio
    async def test_fallback_hits_later_candidate(self, publisher):
        page = FakePage()
        second = 'input[placeholder*="输入标题"]'  # title_input 回退链第 2 候选
        page.visible.add(second)
        ok = await publisher._set_field(page, "title_input", "内容标题")
        assert ok is True
        assert page.filled.get(second) == ["内容标题"]

    @pytest.mark.asyncio
    async def test_contenteditable_uses_dispatch_path(self, publisher):
        page = FakePage()
        ce = '[class*="editor"] [contenteditable="true"]'  # content_textarea 首候选
        page.visible.add(ce)
        page.not_fillable.add(ce)  # 模拟 contenteditable：fill 抛错
        ok = await publisher._set_field(page, "content_textarea", "富文本正文")
        assert ok is True
        assert (ce, "富文本正文") in page.evaluated

    @pytest.mark.asyncio
    async def test_tags_use_type_not_overwrite_fill(self, publisher):
        page = _base_page()
        tag_sel = publisher._candidates_for("tag_input")[0]
        page.visible.add(tag_sel)
        await publisher._add_tags(page, ["标签A", "标签B"])
        typed_tags = [t for _, t in page.typed]
        assert typed_tags == ["标签A", "标签B"]
        assert tag_sel not in page.filled  # 未用覆盖式 fill


class TestErrorNormalization:
    @pytest.mark.asyncio
    async def test_login_redirect_maps_login_expired(self, publisher):
        page = _base_page()
        page.url = "https://creator.xiaohongshu.com/login"
        result = await _flow(publisher, page, FakeMonitor(), draft=True)
        assert result.success is False
        assert xhs.CODE_LOGIN_EXPIRED in (result.error or "")

    @pytest.mark.asyncio
    async def test_risk_overlay_maps_risk_blocked(self, publisher, monkeypatch):
        monkeypatch.setattr(xhs, "RISK_OVERLAY_SELECTOR", '[class*="verify"]', raising=False)
        page = _base_page()
        # 选择器轨同样要求可见：仅存在于 DOM 的验证容器不算风控
        page.visible.add('[class*="verify"]')
        page.item_texts['[class*="verify"]'] = ["请完成安全验证"]
        result = await _flow(publisher, page, FakeMonitor(), draft=True)
        assert result.success is False
        assert xhs.CODE_RISK_BLOCKED in (result.error or "")

    @pytest.mark.asyncio
    async def test_overlay_selector_alone_blocks_without_risk_wording(self, publisher, monkeypatch):
        """overlay 占位轨必须独立成立，而不是被文本轨顺手兜住。

        与上一条的分工：上一条同时给了「安全验证」文案，文本轨也能判真，所以把
        overlay 轨整条删掉它照样绿（本轮破坏验证实测到的假绿）。占位轨的本职是
        Tier2 回填后那些**没有可匹配文案**的风控层（纯图形/拼图验证码），
        所以这里只放一个可见容器、文案刻意避开词表。
        """
        monkeypatch.setattr(xhs, "RISK_OVERLAY_SELECTOR", '[class*="verify"]', raising=False)
        page = _base_page()
        page.visible.add('[class*="verify"]')
        page.item_texts['[class*="verify"]'] = ["请按提示操作"]
        # 反向自证：这条文案必须匹配不到文本轨，否则本用例并没有单独钉住 overlay 轨
        assert not re.search(xhs.RISK_TEXT_PATTERN, "请按提示操作", re.I)
        result = await _flow(publisher, page, FakeMonitor(), draft=True)
        assert result.success is False
        assert xhs.CODE_RISK_BLOCKED in (result.error or "")

    @pytest.mark.asyncio
    async def test_overlay_track_uses_presence_not_text_list(self, publisher, monkeypatch):
        """CCG i4：占位轨判的是"有可见容器"，不是"文案列表非空"。

        原实现靠 visible_texts 把空 inner_text 也塞进列表、再看列表真值 —— 哪天有人
        过滤空串（那是文案轨的正确清理），纯图形/拼图验证层就静默漏判。改用显式存在性
        计数后，本用例不再依赖"空串被保留"这个实现细节。
        """
        monkeypatch.setattr(xhs, "RISK_OVERLAY_SELECTOR", '[class*="verify"]', raising=False)
        page = _base_page()
        sel = '[class*="verify"]'
        page.visible.add(sel)
        page.counts[sel] = 1  # 有容器、零文案：真实拼图验证层的形状
        assert sel not in page.item_texts
        assert await publisher._visible_texts(page, sel) == []  # 文案轨确实拿不到东西
        assert await publisher._risk_present(page) is True


class TestRegression:
    @pytest.mark.asyncio
    async def test_empty_title_short_circuit(self, publisher):
        result = await publisher.publish("", "")
        assert result.success is False
        assert "标题不能为空" in result.error


class PatternAwareMonitor:
    """按真实 ResponseMonitor 语义：子串匹配响应 URL，再用 predicate 过滤 body。

    用于验证确认模式列表的语义精确性——只有命中被 watch 的端点才可能被确认。
    """

    def __init__(self, responses=None):
        self.responses = responses or []
        self.watched: list[str] = []

    def watch_patterns(self, patterns):
        self.watched = list(patterns)

    async def wait_for_response(self, timeout=30.0, predicate=None):
        for r in self.responses:
            if not any(p in r.get("url", "") for p in self.watched):
                continue
            data = r.get("data")
            if predicate is None or predicate(data):
                return data
        return None

    def stop(self):
        pass


NOTE_URL = "https://edith.xiaohongshu.com/web_api/sns/v2/note"
PERMIT_URL = "https://creator.xiaohongshu.com/api/media/v1/upload/web/permit"


class TestTier2EndpointArming:
    """Tier2 端点回填：默认模式下 XHR 主确认通道必须真实生效，且语义精确不误判。"""

    def test_default_patterns_arm_the_xhr_channel(self):
        patterns = list(xhs.DRAFT_SAVE_RESPONSE_PATTERNS)
        assert patterns, "默认确认模式不得为空，否则 XHR 主确认通道永不注册"
        assert any("/web_api/sns/v2/note" in p for p in patterns)

    def test_confirm_patterns_exclude_upload_stages(self):
        # 假阳性红线：上传 permit / ros-upload 也会返回 code==0，
        # 若被 watch 会在笔记真正提交前误判草稿已保存。
        patterns = list(xhs.DRAFT_SAVE_RESPONSE_PATTERNS)
        assert not any("permit" in p for p in patterns)
        assert not any("ros-upload" in p for p in patterns)
        assert not any("upload" in p for p in patterns)

    @pytest.mark.asyncio
    async def test_watches_default_patterns_on_flow_start(self, publisher):
        page, monitor = _base_page(), PatternAwareMonitor()
        page.visible.add(DRAFT_SEL)
        await _flow(publisher, page, monitor, draft=True)
        assert monitor.watched == list(xhs.DRAFT_SAVE_RESPONSE_PATTERNS)

    @pytest.mark.asyncio
    async def test_real_note_response_confirms_draft(self, publisher):
        page = _base_page()
        page.visible.add(DRAFT_SEL)
        monitor = PatternAwareMonitor(
            responses=[{"url": NOTE_URL, "data": {"code": 0, "data": {"note_id": "N1", "draft_id": "D9"}}}]
        )
        result = await _flow(publisher, page, monitor, draft=True)
        assert result.success is True
        assert "D9" in (result.url or "")

    @pytest.mark.asyncio
    async def test_permit_success_alone_does_not_confirm(self, publisher):
        # 只出现上传 permit 成功（code==0），未出现笔记提交 ⇒ 必须保持未确认失败。
        page = _base_page()
        page.visible.add(DRAFT_SEL)
        page.item_texts[xhs.DRAFT_BOX_ITEM_SELECTOR] = []
        monitor = PatternAwareMonitor(responses=[{"url": PERMIT_URL, "data": {"code": 0, "data": {"file_id": "F1"}}}])
        result = await _flow(publisher, page, monitor, draft=True)
        assert result.success is False
        assert xhs.CODE_UNCONFIRMED in (result.error or "")

    @pytest.mark.asyncio
    async def test_note_response_with_error_code_does_not_confirm(self, publisher):
        page = _base_page()
        page.visible.add(DRAFT_SEL)
        page.item_texts[xhs.DRAFT_BOX_ITEM_SELECTOR] = []
        monitor = PatternAwareMonitor(
            responses=[{"url": NOTE_URL, "data": {"code": -1, "success": False, "msg": "risk"}}]
        )
        result = await _flow(publisher, page, monitor, draft=True)
        assert result.success is False
        assert xhs.CODE_UNCONFIRMED in (result.error or "")


class TestRiskTextTrack:
    """风控文本轨：占位选择器为空时，risk 归一不得静默失效（与端点空占位同一类缺陷）。"""

    @pytest.mark.asyncio
    async def test_modal_with_risk_wording_maps_risk_blocked(self, publisher):
        page = _base_page()
        host = xhs.RISK_TEXT_HOSTS[0]
        page.visible.add(host)
        page.item_texts[host] = ["请完成安全验证，拖动滑块完成下方拼图"]
        result = await _flow(publisher, page, FakeMonitor(), draft=True)
        assert result.success is False
        assert xhs.CODE_RISK_BLOCKED in (result.error or "")
        assert PUBLISH_SEL not in page.clicked  # 风控下不得继续动作

    @pytest.mark.asyncio
    async def test_risk_wording_without_overlay_host_is_not_risk(self, publisher):
        # 无常驻浮层时，标题/正文里出现「验证」二字不得误判风控
        page = _base_page()
        result = await _flow(publisher, page, FakeMonitor(), draft=True)
        assert xhs.CODE_RISK_BLOCKED not in (result.error or "")

    @pytest.mark.asyncio
    async def test_benign_modal_text_is_not_risk(self, publisher):
        page = _base_page()
        host = xhs.RISK_TEXT_HOSTS[0]
        page.visible.add(host)
        page.item_texts[host] = ["笔记标题", "草稿箱", "封面"]
        assert await publisher._risk_present(page) is False

    def test_text_track_constants_arming(self):
        # 默认值必须非空：否则本轨与 2.3a 的空占位同样恒假
        assert xhs.RISK_TEXT_HOSTS
        assert xhs.RISK_TEXT_PATTERN

    @pytest.mark.asyncio
    async def test_hidden_risk_template_is_not_risk(self, publisher):
        """CCG i1（Critical）：SPA 常驻的隐藏 modal 模板带默认风控文案，不得误判风控。

        误判风控会直接中止用户草稿保存，比漏判更有害 —— 可见性是文本轨的硬前提。
        """
        page = _base_page()
        host = xhs.RISK_TEXT_HOSTS[0]
        page.counts[host] = 1  # 在 DOM 里，但不可见
        page.item_texts[host] = ["请完成验证，拖动滑块继续"]
        assert await publisher._risk_present(page) is False

    @pytest.mark.asyncio
    async def test_risk_wording_in_second_element_of_one_host_is_caught(self, publisher):
        """CCG i2：`[class*="modal"]` 命中多个容器时，风控层不在 DOM 首位也必须抓到。"""
        page = _base_page()
        host = xhs.RISK_TEXT_HOSTS[0]
        page.visible.add(host)
        page.item_texts[host] = ["笔记封面", "账号存在风险，请完成安全验证"]
        assert await publisher._risk_present(page) is True

    @pytest.mark.asyncio
    async def test_risk_wording_in_a_later_host_is_caught(self, publisher):
        """宿主轨必须真跨宿主，而不是只测 hosts[0]。

        风控层常挂在 dialog/overlay 而非 modal 宿主；若轮询退化成"只查首宿主"，
        漏判风控会让流程继续走向发布——比误判更违反红线。全部用例都塞进
        hosts[0] 时，删掉 `for host in hosts[1:]` 仍全绿，即本条覆盖的缺口。
        """
        assert len(xhs.RISK_TEXT_HOSTS) >= 2, "宿主常量不足两条，跨宿主轮询无从可测"
        first, second = xhs.RISK_TEXT_HOSTS[0], xhs.RISK_TEXT_HOSTS[1]
        page = _base_page()
        page.visible.add(first)
        page.item_texts[first] = ["笔记封面"]
        page.visible.add(second)
        page.item_texts[second] = ["安全验证"]
        assert await publisher._risk_present(page) is True

    @pytest.mark.asyncio
    async def test_visible_risk_layer_after_hidden_templates_is_caught(self, publisher):
        """截断口径必须是「可见元素数」，不是「DOM 序前 N 个节点」。

        portal 把风控弹层 append 到 body 尾部，前面全是 SPA 常驻的隐藏模板；旧实现
        `total = min(count(), limit)` 先截断再过滤可见性，于是风控层下标 ≥ limit 就
        永不被扫 —— 文案轨与占位轨同时漏判后流程继续走向发布，违反风控绝不降级的红线。
        """
        host = xhs.RISK_TEXT_HOSTS[0]
        page = _base_page()
        hidden = list(range(xhs.RISK_HOST_SCAN_LIMIT))  # 隐藏模板刚好占满旧口径的额度
        page.item_texts[host] = [f"隐藏模板{i}" for i in hidden] + ["请完成安全验证"]
        page.hidden_items[host] = set(hidden)
        page.visible.add(host)
        assert await publisher._risk_present(page) is True

    @pytest.mark.asyncio
    async def test_probe_cap_truncation_leaves_an_observable_trace(self, publisher, monkeypatch):
        """漏判可能无法完全避免，但必须可查：探测被成本闸截断且一无所获时要留痕。

        把上限从 8 抬到 32 只是把 DOM 序悬崖推深，并没有消除它。本仓没有活体证据说明
        风控层落在 DOM 的哪个位置，所以不拿"反向扫尾部"这类同样未验证的假设去替换成本闸；
        换成可观测性：截断发生时发布链路日志里必须查得到「哪条选择器、命中多少、只探测了多少」，
        这同时是 2.2 活体取证能拿到的第一个量化观测量。
        """
        monkeypatch.setattr(xhs, "RISK_HOST_PROBE_LIMIT", 4, raising=False)
        host = xhs.RISK_TEXT_HOSTS[0]
        page = _base_page()
        hidden = list(range(4))
        page.item_texts[host] = [f"隐藏模板{i}" for i in hidden] + ["请完成安全验证"]
        page.hidden_items[host] = set(hidden)
        page.visible.add(host)  # 若被探测到就会判风控——但它落在上限之外
        messages: list[str] = []
        sink_id = logger.add(lambda m: messages.append(str(m)), level="WARNING")
        try:
            assert await publisher._risk_present(page) is False  # 已知代价，不是遗漏
        finally:
            logger.remove(sink_id)
        trace = [m for m in messages if host in m]
        assert trace, f"探测被截断却未留痕: {messages}"
        assert "5" in trace[0] and "4" in trace[0], f"留痕未给出命中数与探测上限: {trace[0]}"

    @pytest.mark.asyncio
    async def test_placeholder_track_truncation_leaves_a_trace(self, publisher, monkeypatch):
        """占位轨的截断同样必须留痕——两条轨都可能被成本闸截断，只给一条留痕等于另一半静默。

        文案轨的用例抓不到这里：`visible_count` 是另一个函数。变异取证见 §4n（删掉这段
        留痕时其余用例全绿），所以这条用例是这段告警唯一的看守。
        """
        monkeypatch.setattr(xhs, "RISK_HOST_PROBE_LIMIT", 4, raising=False)
        overlay = '[class*="xhs-verify-layer"]'
        monkeypatch.setattr(xhs, "RISK_OVERLAY_SELECTOR", overlay, raising=False)
        page = _base_page()
        page.counts[overlay] = 5  # 命中 5 个，前 4 个都不可见 ⇒ 判为无风控，但可能被截断
        messages: list[str] = []
        sink_id = logger.add(lambda m: messages.append(str(m)), level="WARNING")
        try:
            assert await publisher._risk_present(page) is False
        finally:
            logger.remove(sink_id)
        trace = [m for m in messages if overlay in m]
        assert trace, f"占位轨探测被截断却未留痕: {messages}"
        assert "5" in trace[0] and "4" in trace[0], f"留痕未给出命中数与探测上限: {trace[0]}"

    @pytest.mark.asyncio
    async def test_bare_slider_crop_wording_is_not_risk(self, publisher):
        """CCG i1 另一半：可见裁剪弹窗里的「拖动滑块」是控件说明，不是风控。

        词表曾含裸「滑块」与「拖动滑块」，封面裁剪等良性容器会误判风控并中止草稿
        保存；收紧为强指认短语后，真实滑块验证仍靠同容器内的「安全验证」命中。
        """
        page = _base_page()
        host = xhs.RISK_TEXT_HOSTS[0]
        page.visible.add(host)
        page.item_texts[host] = ["裁剪封面：拖动滑块调整比例"]
        assert await publisher._risk_present(page) is False

    @pytest.mark.asyncio
    async def test_verification_code_dialog_is_risk_by_design(self, publisher):
        """词表含单词级「验证码」是**有意接受的误判面**，不是疏漏——本用例把这个代价钉住。

        发布链路里弹出要求输入验证码的层，等价于平台在要求人工核验（重登录/绑定/二次验证），
        此时中止自动发布正是想要的行为。收窄词表会扩大"带着验证层继续发布"的漏判面，方向
        上更违反红线。若将来活体取证（tasks 2.2）证明创作者中心发布页存在不含核验语义的
        「验证码」文案，再凭证据改判这条，而不是先猜。
        """
        page = _base_page()
        host = xhs.RISK_TEXT_HOSTS[0]
        page.visible.add(host)
        page.item_texts[host] = ["绑定手机号：请输入短信验证码"]
        assert await publisher._risk_present(page) is True

    @pytest.mark.asyncio
    async def test_real_slider_verify_still_caught(self, publisher):
        page = _base_page()
        host = xhs.RISK_TEXT_HOSTS[0]
        page.visible.add(host)
        page.item_texts[host] = ["安全验证：拖动滑块完成拼图"]
        assert await publisher._risk_present(page) is True

    def test_host_scan_limit_is_imported_and_bounded(self):
        """CCG i1 衍生：整页 modal 模板下扫描必须有上限，否则 inner_text 拖垮发布链路。"""
        assert hasattr(xhs, "RISK_HOST_SCAN_LIMIT")
        assert 0 < xhs.RISK_HOST_SCAN_LIMIT <= 16

    @pytest.mark.asyncio
    async def test_visible_hosts_beyond_scan_limit_are_not_read(self, publisher):
        page = _base_page()
        host = xhs.RISK_TEXT_HOSTS[0]
        page.visible.add(host)
        page.item_texts[host] = [f"文案{i}" for i in range(xhs.RISK_HOST_SCAN_LIMIT + 5)]
        assert await publisher._visible_texts(page, host) == [
            f"文案{i}" for i in range(xhs.RISK_HOST_SCAN_LIMIT)
        ]


class TestUploadReadinessPoll:
    """PR-1 回归保护：上传控件晚挂载时绝不静默跳过媒体。

    静态守卫 test_p4_wait_until 要求 xiaohongshu.py 里保留两处条件等待
    （上传控件 + 编辑器），PR-1 把上传控件那一处换成了一次性 `_resolve_visible`，
    守卫变红——而它是对的：SPA 下首屏没挂载就解析 ⇒ file_input 为 None ⇒
    `if file_input is not None` 静默不传图，随后照样填标题存草稿，
    产出的是"无媒体草稿"。用户验收口径是草稿箱里内容完整，这属于缺陷交付。
    """

    @pytest.mark.asyncio
    async def test_late_mount_upload_input_is_awaited_then_used(self, publisher, monkeypatch):
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_WAIT_TIMEOUT_S", 2.0, raising=False)
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_POLL_INTERVAL_S", 0.01, raising=False)
        sel = publisher._candidates_for("upload_input")[0]
        page = _base_page()
        page.visible_after[sel] = 2  # 前两次查询不可见，第三次起可见
        page.visible.add(DRAFT_SEL)
        result = await _flow(publisher, page, FakeMonitor(), media_paths=["a.jpg"])
        assert page.uploaded == [["a.jpg"]], f"延迟挂载的上传控件未被等待，媒体被静默跳过: {result.error}"

    @pytest.mark.asyncio
    async def test_media_requested_but_upload_input_never_appears_fails_closed(
        self, publisher, monkeypatch
    ):
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_WAIT_TIMEOUT_S", 0.05, raising=False)
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_POLL_INTERVAL_S", 0.01, raising=False)
        page = _base_page()
        page.visible.add(DRAFT_SEL)
        result = await _flow(publisher, page, FakeMonitor(), media_paths=["a.jpg"])
        assert result.success is False
        assert xhs.CODE_UPLOAD_FAILED in (result.error or "")
        assert page.uploaded == []
        # 红线：传不上图就不该继续把空媒体草稿存进草稿箱
        assert DRAFT_SEL not in page.clicked

    def test_upload_ceiling_keeps_the_original_tolerance(self):
        """CCG i3：等待改为条件轮询后，上限必须沿用改造前的 30s 上传兜底时长。

        只收紧快路径（命中即返回），不放宽容忍度也不额外收紧——把 30s 换成 10s
        会把慢网首屏判成上传失败，属于另一种常态化误伤。
        """
        assert xhs.UPLOAD_FALLBACK_WAIT_TIMEOUT_S == 30.0

    def test_editor_ceiling_keeps_the_original_tolerance(self):
        """CCG 二轮 i1：上一条准则同样管编辑器就绪，上一轮却把它留在了 10s。

        改造前 `_await_editor_ready` 用的就是 30s 上限；轮询改造的收益在"命中即返回"，
        砍上限买不到任何东西，只会让慢首屏更早掉进下游的 XHS_TITLE_FAILED 误诊
        （标题其实只是还没挂载）。两个常量仍分开命名：归属由哨兵值用例证明。
        """
        assert xhs.NAVIGATE_READY_TIMEOUT_S == 30.0

    @pytest.mark.asyncio
    async def test_control_vanishing_after_hit_is_not_reported_as_never_mounted(self, publisher, monkeypatch):
        """CCG 二轮 i2：轮询命中后控件被摘掉，不得当成"从未挂载"。

        旧实现在 wait_until 返回 True 之后又 `resolve_visible` 一次，抖动窗口里第二次
        解析拿到 None ⇒ 报 CODE_UPLOAD_FAILED「上传控件在 30s 内未挂载」，把一次瞬时
        重渲染说成站点结构问题。改为复用轮询中拿到的 locator 后，locator 是惰性的：
        元素真不在会在 set_input_files 上抛错，由调用方给出准确文案。
        """
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_POLL_INTERVAL_S", 0.01, raising=False)
        monkeypatch.setattr(xhs, "NAVIGATE_READY_TIMEOUT_S", 0.05, raising=False)
        monkeypatch.setattr(xhs, "NAVIGATE_READY_POLL_INTERVAL_S", 0.01, raising=False)

        class VanishingLocator(FakeLocator):
            async def is_visible(self):
                calls = self._page.visibility_calls
                calls[self._sel] = calls.get(self._sel, 0) + 1
                return calls[self._sel] == 1 and self._sel in self._page.visible

        page = _base_page()
        sel = publisher._candidates_for("upload_input")[0]
        page.visible.add(sel)
        page.visible.add(DRAFT_SEL)
        page.locator = lambda s: VanishingLocator(page, s)  # 首查可见，之后一律不可见

        result = await _flow(publisher, page, FakeMonitor(), media_paths=["a.jpg"])
        assert page.uploaded == [["a.jpg"]], f"命中后二次解析把控件抖动吞掉了: {result.error}"
        assert xhs.CODE_UPLOAD_FAILED not in (result.error or "")

    @pytest.mark.asyncio
    async def test_upload_path_uses_the_upload_fallback_ceiling(self, publisher, monkeypatch):
        """CCG i3 的可验证面：失败留痕里的上限就是上传路径实际生效的那个常量。

        两个等待常量取不同哨兵值，谁出现在错误文案里就证明映射归谁——比在源码里
        抠 `timeout_s=...` 字面量稳（重排参数/换调用形式都不会假红，也不会假绿）。
        """
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_WAIT_TIMEOUT_S", 0.05, raising=False)
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_POLL_INTERVAL_S", 0.01, raising=False)
        monkeypatch.setattr(xhs, "NAVIGATE_READY_TIMEOUT_S", 9.99, raising=False)
        page = _base_page()
        page.visible.add(DRAFT_SEL)
        result = await _flow(publisher, page, FakeMonitor(), media_paths=["a.jpg"])
        assert "0.05" in (result.error or ""), f"上传等待未使用 UPLOAD_FALLBACK_* 上限: {result.error}"
        assert "9.99" not in (result.error or "")

    @pytest.mark.asyncio
    async def test_upload_wait_poll_count_matches_its_own_ceiling(self, publisher, monkeypatch):
        """i3 的第二道：轮询次数证"真正生效的上限"归属，只盯错误文案会被骗过。

        若 `timeout_s=` 与消息各用各的常量（消息对、等待错），上一条仍会绿。
        0.05s / 0.01s ≈ 6 次查询；误用 9.99s 上限则是 ~1000 次。
        """
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_WAIT_TIMEOUT_S", 0.05, raising=False)
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_POLL_INTERVAL_S", 0.01, raising=False)
        monkeypatch.setattr(xhs, "NAVIGATE_READY_TIMEOUT_S", 9.99, raising=False)
        monkeypatch.setattr(xhs, "NAVIGATE_READY_POLL_INTERVAL_S", 0.01, raising=False)
        page = _base_page()
        page.visible.add(DRAFT_SEL)
        await _flow(publisher, page, FakeMonitor(), media_paths=["a.jpg"])
        sel = publisher._candidates_for("upload_input")[0]
        calls = page.visibility_calls.get(sel, 0)
        # 上限从"魔数 50"改成由被 patch 的常量推导：误用 9.99s 上限会得到 ~1000 次，
        # 落在带外即红。下界刻意保持为 1：Windows 的 sleep 粒度约 15ms，实测次数会在
        # 3~7 之间漂，卡下界就是把用例挂在机器时序上（跨宿主归属由下一条 spy 用例精确钉死）。
        assert 1 <= calls <= xhs.UPLOAD_FALLBACK_WAIT_TIMEOUT_S / xhs.UPLOAD_FALLBACK_POLL_INTERVAL_S + 3, (
            f"上传轮询 {calls} 次与 0.05s/0.01s 不符（疑似用错等待常量）"
        )

    @pytest.mark.asyncio
    async def test_upload_wait_is_fed_the_upload_constants(self, publisher, monkeypatch):
        """常量归属用实参哨兵值钉死，而不是靠轮询次数反推。

        次数是时序量：Windows sleep 粒度 ~15ms 让 0.01s 间隔实际变成 ~15ms，
        区间只能判出"上限级"错误，判不出 interval 用错哪一条（本仓两条等待的
        interval 默认同为 0.5，混用不改变次数）。这里把四个常量各取唯一值，
        直接断言 `wait_until` 收到的实参，两种混用方向都无处可藏。
        """
        seen: list[tuple[float, float]] = []
        real_wait = dom.wait_until

        async def spy(predicate, *, timeout_s, interval_s):
            seen.append((timeout_s, interval_s))
            return await real_wait(predicate, timeout_s=timeout_s, interval_s=interval_s)

        monkeypatch.setattr(dom, "wait_until", spy)
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_WAIT_TIMEOUT_S", 0.05, raising=False)
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_POLL_INTERVAL_S", 0.017, raising=False)
        monkeypatch.setattr(xhs, "NAVIGATE_READY_TIMEOUT_S", 9.99, raising=False)
        monkeypatch.setattr(xhs, "NAVIGATE_READY_POLL_INTERVAL_S", 0.023, raising=False)
        page = _base_page()
        page.visible.add(DRAFT_SEL)
        await _flow(publisher, page, FakeMonitor(), media_paths=["a.jpg"])

        upload_waits = [(t, i) for t, i in seen if t == 0.05]
        assert upload_waits, f"上传等待没有出现 0.05s 上限: {seen}"
        assert all(i == 0.017 for _, i in upload_waits), f"上传等待误用了别的 interval: {seen}"
        assert (9.99, 0.017) not in seen and (0.05, 0.023) not in seen, f"常量配对被拆开: {seen}"

    @pytest.mark.asyncio
    async def test_editor_ready_is_fed_the_navigate_constants(self, publisher, monkeypatch):
        """编辑器等待的常量归属同样要有行为保护——上传路径先 fail-closed，上一条 spy 用例根本走不到这里。

        无媒体路径不为上传控件白等，所以 `seen` 里只应出现编辑器那一对。四个常量各取
        唯一值：编辑器若错配到 UPLOAD_*（只是变慢、不留错误），这里必须红。
        """
        seen: list[tuple[float, float]] = []
        real_wait = dom.wait_until

        async def spy(predicate, *, timeout_s, interval_s):
            seen.append((timeout_s, interval_s))
            return await real_wait(predicate, timeout_s=timeout_s, interval_s=interval_s)

        monkeypatch.setattr(dom, "wait_until", spy)
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_WAIT_TIMEOUT_S", 0.05, raising=False)
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_POLL_INTERVAL_S", 0.017, raising=False)
        monkeypatch.setattr(xhs, "NAVIGATE_READY_TIMEOUT_S", 0.03, raising=False)
        monkeypatch.setattr(xhs, "NAVIGATE_READY_POLL_INTERVAL_S", 0.023, raising=False)
        page = _base_page()
        page.visible.add(DRAFT_SEL)
        await _flow(publisher, page, FakeMonitor(), media_paths=[])

        assert seen, "编辑器等待没把常量交给 wait_until（改走别的路径即失去保护）"
        assert (0.05, 0.017) not in seen, f"编辑器等待误用了上传常量: {seen}"
        assert any(t == 0.03 and i == 0.023 for t, i in seen), f"编辑器等待未使用 NAVIGATE_READY_*: {seen}"

    @pytest.mark.asyncio
    async def test_editor_ready_timeout_leaves_a_reason_in_logs(self, publisher, monkeypatch):
        """CCG i4：超时留痕用行为断言，且钉在机器可读控件名上，而非给用户看的措辞。

        本仓日志走 loguru（非 stdlib logging），caplog 抓不到，故挂一个临时 sink。
        断言「编辑器」会把显示 label 钉死（改名即假红，正是上一轮 CCG i4 移除的耦合类）；
        断言 `title_input` 钉的是选择器候选链的键名，措辞怎么改都不会假红。
        """
        monkeypatch.setattr(xhs, "NAVIGATE_READY_TIMEOUT_S", 0.05, raising=False)
        monkeypatch.setattr(xhs, "NAVIGATE_READY_POLL_INTERVAL_S", 0.01, raising=False)
        page = FakePage()  # 标题控件始终不可见 ⇒ 编辑器就绪轮询必然超时
        page.visible.add(DRAFT_SEL)
        messages: list[str] = []
        sink_id = logger.add(lambda m: messages.append(str(m)), level="WARNING")
        try:
            await _flow(publisher, page, FakeMonitor(), media_paths=[])
        finally:
            logger.remove(sink_id)
        assert any("title_input" in m for m in messages), f"编辑器超时未留可归因的原因: {messages}"

    @pytest.mark.asyncio
    async def test_text_only_draft_skips_upload_wait(self, publisher, monkeypatch):
        # 无媒体时不该为上传控件白等（纯图文/正文草稿仍是合法路径）
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_WAIT_TIMEOUT_S", 30.0, raising=False)
        monkeypatch.setattr(xhs, "UPLOAD_FALLBACK_POLL_INTERVAL_S", 0.01, raising=False)
        monkeypatch.setattr(xhs, "NAVIGATE_READY_TIMEOUT_S", 0.05, raising=False)
        monkeypatch.setattr(xhs, "NAVIGATE_READY_POLL_INTERVAL_S", 0.01, raising=False)
        page = _base_page()
        page.visible.add(DRAFT_SEL)
        result = await _flow(publisher, page, FakeMonitor(), media_paths=[])
        assert page.uploaded == []
        assert xhs.CODE_UPLOAD_FAILED not in (result.error or "")

    def test_upload_poll_constant_is_imported_in_publisher(self):
        # 静默失效守卫：等待时长常量必须真的被发布器引用，而不是只存在于选择器表里
        assert hasattr(xhs, "NAVIGATE_READY_TIMEOUT_S")
        assert hasattr(xhs, "NAVIGATE_READY_POLL_INTERVAL_S")
