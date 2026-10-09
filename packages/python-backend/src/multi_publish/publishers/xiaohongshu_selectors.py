"""小红书 DOM 轨配置常量（选择器回退链 / 确认端点 / 错误码 / 超时）。

从 xiaohongshu.py 拆出，满足新代码单文件行数门禁（check-debt-budget.js）。
xiaohongshu.py 通过 import 复用这些名字；因导入名即模块属性，
测试对 xiaohongshu 模块全局的 monkeypatch 仍能覆盖运行时读取。
"""

from __future__ import annotations

DEFAULT_SELECTORS = {
    "login_qrcode": '[class*="qrcode"]',
    "login_success_indicator": '[class*="creator-home"]',
    "upload_page_url": "https://creator.xiaohongshu.com/publish/publish",
    "upload_input": 'input[type="file"]',
    "title_input": '[class*="title"] input, [placeholder*="标题"]',
    "content_textarea": '[class*="content"] textarea, [class*="desc"] textarea, [placeholder*="正文"]',
    "publish_button": 'button:has-text("发布"), button:has-text("发布笔记")',
    "tag_input": '[class*="tag"] input, [placeholder*="标签"]',
    "cover_upload": '[class*="cover"]',
    "cover_input": 'input[type="file"]',
    "upload_progress": '[class*="progress"]',
    "upload_complete": '[class*="upload-success"]',
    "draft_button": 'button:has-text("草稿")',
}

# 逻辑控件 → 多候选回退链（Tier2 取证后回填更稳的具体值）。命中即停止。
# 与 DEFAULT_SELECTORS 并存：解析时先取回退链，无回退链则回退 DEFAULT_SELECTORS 单值。
SELECTOR_FALLBACKS: dict[str, list[str]] = {
    "title_input": [
        '[placeholder*="标题"]',
        'input[placeholder*="输入标题"]',
        '[class*="title"] input',
        '[class*="title"] [contenteditable="true"]',
    ],
    "content_textarea": [
        '[class*="editor"] [contenteditable="true"]',
        '[contenteditable="true"][class*="desc"]',
        '[class*="content"] textarea',
        '[class*="content"] [contenteditable="true"]',
        '[placeholder*="正文"]',
    ],
    "draft_button": [
        'button:has-text("存草稿")',
        'button:has-text("保存草稿")',
        '[class*="draft"]',
        'button:has-text("草稿")',
    ],
    "publish_button": [
        'button:has-text("发布笔记")',
        'div[role="button"]:has-text("发布")',
        'button:has-text("发布")',
    ],
    "upload_complete": [
        '[class*="upload-success"]',
        '[class*="upload"] [class*="success"]',
        '[class*="preview"] img',
    ],
    "tag_input": ['[placeholder*="标签"]', '[class*="tag"] input'],
    "tag_suggestion": ['[class*="tag-suggestion"]', '[class*="suggest"] li'],
}

# Tier2 端点回填：证据来自本仓 api-publish-engine/src/publish/platforms/xiaohongshu-draft.js
# 的三步草稿链终步 POST https://edith.xiaohongshu.com/web_api/sns/v2/note
# （其测试断言真实端点即此，/api/publish 不存在），成功体为 {code:0,data:{note_id,draft_id}}。
# 创作者中心页面点「存草稿」打的是同一端点，故 DOM/RPA 轨据此武装 XHR 主确认通道。
# 仅 watch 笔记提交终步：上传 permit 与 ros-upload 同样返回 code==0，
# 若纳入会在笔记真正提交前误判草稿已保存（假阳性）。
DRAFT_SAVE_RESPONSE_PATTERNS: list[str] = ["/web_api/sns/v2/note"]
CONFIRM_TIMEOUT_S = 20.0
# 草稿箱回查兜底（活体取证 2026-10-08，账号分区图文编辑器，见 PRD §5 第六轮）：
# 1) 图文编辑器**没有**「存草稿/保存草稿/暂存离开」按钮——草稿由平台自动保存，页面右下角
#    只显示「编辑于 …」。所以"找到草稿按钮"不是成功条件，"重载后「草稿箱(N)」计数 +1"才是。
# 2) 草稿箱入口就是发布页自身（左侧 header-draft 面板），取证过的地址带 from=menu&target=image；
#    原先的 ?draft=true 从未在活体中出现，按证据改为你真正会重载到图文面板的地址。
# 3) 计数节点实测 class=draft-title，文本形如「草稿箱(1)」。
DRAFT_BOX_URL = "https://creator.xiaohongshu.com/publish/publish?from=menu&target=image"
DRAFT_BOX_COUNTER_SELECTOR = ".draft-title"
DRAFT_BOX_ITEM_SELECTOR = '[class*="draft"] [class*="title"]'  # 条目标题：仍未取证，仅作次级兜底
# 计数节点探测上限：成本闸（不是判据口径）。实测该节点在页面顶部，个位数命中；
# 触顶且读不到计数时由 visible_texts 留痕，漏判可查。
DRAFT_BOX_COUNTER_PROBE_CAP = 8
# 计数节点的挂载等待与增量等待：SPA 的草稿面板在 domcontentloaded 之后才出现，且自动保存
# 落库有延迟，两次都用单次读会把"还没挂上/还在写"读成"没写"（CCG 六轮 i1/i2，Critical）。
# 上限沿用本轨既有的 30s 容忍度口径（§4k：轮询的收益是命中即返回，砍上限只会把慢首屏
# 推向下游误诊），间隔沿用编辑器就绪的同族取值；两个等待喂同一对常量由哨兵值用例钉住。
DRAFT_BOX_WAIT_TIMEOUT_S = 30.0
DRAFT_BOX_POLL_INTERVAL_S = 0.5
# 兜底标题扫描的节点上限：同样是成本闸而非判据口径。DRAFT_BOX_ITEM_SELECTOR 是跨层级通配
# 形态且**未经活体取证**，SPA 模板页命中数十上百个节点完全正常，不设上限就是把一次整页
# goto 之后的往返成本交给未取证选择器的命中数（CCG 七轮 i1）。触顶且未命中时留痕。
DRAFT_BOX_ITEM_SCAN_CAP = 12
# 风控/验证弹层选择器（Tier2 取证回填），命中即判 risk_blocked 并停止。
RISK_OVERLAY_SELECTOR = ""

# 风控文本轨（与上面的占位选择器并行）：占位为空时 `if not RISK_OVERLAY_SELECTOR`
# 会让 risk 归一恒假——即 PR-1 声称交付的 risk_blocked 实际从不触发。本轨用"浮层容器
# + 浮层内文案"双条件判定，文案口径取自本仓桌面轨已实战使用的风控词表
# （apps/desktop/electron/services/publish-risk.js 的 RISK_RE），属源证据非活体取证。
# 只在浮层/弹窗/验证容器内匹配，避免页面常驻文案（如侧栏「草稿箱」「验证封面」）误判。
RISK_TEXT_HOSTS: list[str] = [
    '[class*="modal"]',
    '[class*="dialog"]',
    '[class*="overlay"]',
    '[class*="verify"]',
    '[class*="captcha"]',
]
# 词表口径（如实描述，不夸大成"只收强指认短语"）：
# 1) 不收裸「滑块」「验证」——封面裁剪、图片旋转等良性可见弹窗同样含「拖动滑块调整比例」，
#    裸词会误判风控并中止用户的草稿保存（误判比漏判更有害）；已有两条行为用例钉住这个边界。
# 2) 收单词级的「验证码」「风控」，这是**有意接受的误判面**：发布链路里弹出要求输入验证码
#    的层，本身就是平台在要求人工核验（重登录/绑定/二次验证），此时中止自动发布正是想要的
#    行为，不算假阳性。若将来活体取证（tasks 2.2）证明创作者中心发布页存在不含核验语义的
#    「验证码」文案，再按证据收窄，而不是先猜。
RISK_TEXT_PATTERN = (
    r"安全验证|请完成验证|验证码|操作频繁|账号存在风险|风控|risk control"
)
# 单个宿主容器内最多收集的**可见**元素文案数，防止整页模板逐元素 inner_text 拖垮发布链路。
RISK_HOST_SCAN_LIMIT = 8
# 单宿主最多探测多少个命中节点的可见性。这是成本闸，不是判据闸：`limit` 数的是可见项，
# 所以隐藏模板再多了也只是多几次 is_visible round-trip。风控层由 portal 挂到 body 尾部时
# DOM 序天然靠后，按 limit 截断 DOM 序就会永久扫不到它——成本与判据必须分成两个常量。
# 注意它仍是一道按 DOM 序的悬崖（只是比 8 深）：本仓没有活体证据说明风控层的实际位置，
# 所以不用"反向扫尾部"这类同样未验证的假设去替换它，改由 visible_texts/visible_count 在
# 探测被截断且一无所获时打告警留痕——漏判可能无法避免，但必须可查。
RISK_HOST_PROBE_LIMIT = 32

CREATOR_URL = "https://creator.xiaohongshu.com/"

# 机器可读错误码前缀，便于上层 outcomeOfResult 归一（risk/login 绝不降级换号）。
CODE_LOGIN_EXPIRED = "XHS_LOGIN_EXPIRED"
CODE_RISK_BLOCKED = "XHS_RISK_BLOCKED"
CODE_UPLOAD_FAILED = "XHS_UPLOAD_FAILED"
CODE_TITLE_FAILED = "XHS_TITLE_FAILED"
CODE_UNCONFIRMED = "XHS_UNCONFIRMED"

# 脆弱等待改造：固定 sleep 换成条件轮询 + 具名上限。
# 上限口径（CCG 二轮 i1）：**两个等待都沿用改造前的 30s 容忍度**。上一轮把常量对调
# 修好了上传那一处，却让编辑器就绪停在 10s——那是同一条准则的违背：轮询的收益是
# "命中即返回"（快路径），砍上限只会把慢首屏推向下游的 XHS_TITLE_FAILED 误诊。
# 两个常量仍分开命名：喂给哪个等待由行为用例用哨兵值证明，而不是靠值相等来混用。
NAVIGATE_READY_TIMEOUT_S = 30.0
NAVIGATE_READY_POLL_INTERVAL_S = 0.5
UPLOAD_FALLBACK_WAIT_TIMEOUT_S = 30.0
UPLOAD_FALLBACK_POLL_INTERVAL_S = 0.5


def coded(code: str, message: str) -> str:
    """把机器可读码拼进 error 字符串，保留人类可读信息。"""
    return f"[{code}] {message}"
