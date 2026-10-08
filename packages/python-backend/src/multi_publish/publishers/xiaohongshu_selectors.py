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
# 草稿箱回查兜底：导航地址 + 条目匹配选择器（Tier2 取证回填）。
DRAFT_BOX_URL = "https://creator.xiaohongshu.com/publish/publish?draft=true"
DRAFT_BOX_ITEM_SELECTOR = '[class*="draft"] [class*="title"]'
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
# 词表只收"风控语境的强指认短语"，不收裸「滑块」「验证」这类单词：封面裁剪、图片旋转
# 等良性可见弹窗同样含「拖动滑块调整比例」，裸词会误判风控并中止用户的草稿保存（误判
# 比漏判更有害）。真实滑块验证必然同时出现「安全验证/验证码」，不会因收紧词表而漏判。
RISK_TEXT_PATTERN = (
    r"安全验证|请完成验证|验证码|操作频繁|账号存在风险|风控|risk control"
)
# 单个宿主容器内最多收集的**可见**元素文案数，防止整页模板逐元素 inner_text 拖垮发布链路。
RISK_HOST_SCAN_LIMIT = 8
# 单宿主最多探测多少个命中节点的可见性。这是成本闸，不是判据闸：`limit` 数的是可见项，
# 所以隐藏模板再多了也只是多几次 is_visible round-trip。风控层由 portal 挂到 body 尾部时
# DOM 序天然靠后，按 limit 截断 DOM 序就会永久扫不到它——成本与判据必须分成两个常量。
RISK_HOST_PROBE_LIMIT = 32

CREATOR_URL = "https://creator.xiaohongshu.com/"

# 机器可读错误码前缀，便于上层 outcomeOfResult 归一（risk/login 绝不降级换号）。
CODE_LOGIN_EXPIRED = "XHS_LOGIN_EXPIRED"
CODE_RISK_BLOCKED = "XHS_RISK_BLOCKED"
CODE_DRAFT_ENTRY_MISSING = "XHS_DRAFT_ENTRY_MISSING"
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
