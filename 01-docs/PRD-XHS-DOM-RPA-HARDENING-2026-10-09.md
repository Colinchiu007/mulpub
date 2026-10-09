# PRD-小红书 DOM/RPA 轨加固（真实草稿箱验收）

> **立项日期**: 2026-10-04 | **最后更新**: 2026-10-09 | **状态**: PR-1 已合并，PR-2 端点回填进行中
> **归属 change**: `openspec/changes/rpa-xiaohongshu-dom-hardening/`
> **关联 PR**: #2885（PR-1，squash `e413cbc7`）· #3183（PR-2 端点回填）

## 1. 验收目标（用户拍板）

**存入小红书创作者中心的真实草稿箱**，不做真实公开发布。

这一目标把「成功」的定义从"页面看起来提交了"收紧为"草稿箱里确实出现了这一条"，
因此确认机制是本需求的主体，而非收尾装饰。

## 2. 为什么不走 API 直发链

小红书 API 直发链已判 not-go（签名外包 + 传输层墙，见 `PRD-API-PUBLISH-ENGINE.md`
与 api-publish-engine-w3 §6.3）。本需求只加固 **DOM/RPA 轨**：用应用内受控浏览器
驱动创作者中心页面，与真人操作同形。

**合规红线**：运行时严禁请求任何外包签名/求签农场域名。本需求不新增任何外部端点，
所有导航目标均为小红书官方域名。

## 3. 已交付（PR-1，#2885）

| 能力 | 行为 |
|------|------|
| 草稿 fail-closed | `draft=true` 时没有任何正面确认 → `XHS_UNCONFIRMED` 并**阻止任何公开发布点击**（修旧代码"草稿误公开发布"）。原口径"找不到草稿入口即报 `XHS_DRAFT_ENTRY_MISSING`"已被 §4o 活体取证推翻：图文编辑器根本没有该按钮 |
| 确认才成功 | 三级回退：XHR 响应 `code==0` → 显式 success URL 跳转 → 草稿箱回查（计数增长优先，标题匹配兜底）；均无 → `XHS_UNCONFIRMED` 失败，**不伪造 success、不伪造 url** |
| 选择器回退链 | 标题/正文/草稿按钮/发布按钮/上传完成/标签 均配多候选，命中即停，抗小改版 |
| 富文本写入 | `contenteditable` 上 `fill()` 抛错时回退 `dispatchEvent(input/change)` |
| 标签处理 | 逐个 `type` + 选下拉/回车，替换覆盖式 `fill`（旧行为只留最后一个标签） |
| 错误归一 | `[XHS:<CODE>]` 前缀编码 outcome，登录过期与风控**绝不降级换号** |
| 可桩 seam | `_execute_flow(page, monitor, ...)` 接收注入对象，零真实浏览器即可单测核心分支 |
| 文件规模 | 拆为 `xiaohongshu.py` / `xiaohongshu_selectors.py` / `xiaohongshu_auth.py`，均 <500 行（债务熔断面） |

## 4. 端点回填与确认通道武装（PR-2，#3183）

PR-1 合并后，`DRAFT_SAVE_RESPONSE_PATTERNS` 仍是空占位，导致
`xiaohongshu.py` 中 `if DRAFT_SAVE_RESPONSE_PATTERNS:` 守卫恒假 ——
**最稳的 XHR 主确认通道从未注册**，实际只剩占位选择器的草稿箱回查在兜底，
页面即便成功提交笔记也只能报 `XHS_UNCONFIRMED`。

**证据源（本仓内，非外部）**：`packages/api-publish-engine/src/publish/platforms/xiaohongshu-draft.js`
的三步草稿链终步

```
POST https://edith.xiaohongshu.com/web_api/sns/v2/note   → { code: 0, data: { note_id, draft_id } }
```

其配套测试明确断言真实端点即此、`/api/publish` 不存在。创作者中心页面点「存草稿」
打的是同一端点，故 DOM/RPA 轨据此武装：

```python
DRAFT_SAVE_RESPONSE_PATTERNS: list[str] = ["/web_api/sns/v2/note"]
```

**关键边界（假阳性红线）**：上传链的 `…/api/media/v1/upload/web/permit` 与
`ros-upload.xiaohongshu.com` 同样返回 `code==0`。若把它们纳入确认模式，
草稿尚未真正提交就会被判成功 —— 比"漏报"更危险。因此确认模式**只含笔记提交终步**，
并有回归测试固化（仅 permit 成功 ⇒ 必须仍判未确认）。

现有 `_resp_success`（判 `code==0`）与 `_extract_url`（读嵌套 `data` 的
`draft_id/note_id/id/url`）本就与真实响应形状匹配，故本次只补数据、不改逻辑。

## 4b. 调用链现状（2026-10-09 取证，直接影响验收方式）

本次加固的是 **python Playwright 发布器**，但它在今天的桌面端不可达：

- `server.py:736` 把 `draft` 透传给 `publisher_mgr`，桌面端唯一调用 `/api/publish` 的地方是
  `publisher-router.js:683` 的 `BackendPublisher`；而 `publisher-router.js:44` 的
  `ROUTE_TABLE.xiaohongshu = { mode: 'rpa_vm' }` ⇒ **桌面发布队列走 Electron WebContents RPA，不经过 python 发布器**。
- 用户实际触达的草稿能力在 `rpa-view-platforms.js:_publish_xiaohongshu`（L1309）：图文模式自
  2026-09-29 起**硬编码 `draftOnly: true`**（L1328，用户当时指定"只落草稿箱不点发布"），
  视频模式保持原发布链路。该分支 2026-10-07 已加两道守卫：标题/正文写入失败 ⇒
  `PUBLISH_DRAFT_CONTENT_NOT_FILLED` 拒绝报成功；草稿落库判据从含裸「草稿」的正则
  （常驻文案恒真、等于没有判据）收紧为「已保存/保存成功/编辑于+时间量词」。
- 两条路径的**确认强度不同**：桌面路径是 DOM 文案正则；python 路径经本次 #3183 才具备
  XHR 端点主确认（`/web_api/sns/v2/note` + `code==0`）+ 草稿箱回查兜底。

结论与口径修正：

1. "存进小红书真实草稿箱"这条验收目标，**在桌面路径上已存在并有防假成功守卫**；
   本次 change 交付的是同一目标在 python RPA 轨上的等价能力与更强的确认通道。
2. 因此 2.4 活体验收要**双路覆盖**：(a) 用探针验 python 轨（本 change 的加固对象）；
   (b) 用桌面真实队列发一条图文，确认草稿箱出现本次条目（用户实际路径）。
3. 遗留决策（**不在本 change 范围，需用户拍板**）：是否把 `ROUTE_TABLE.xiaohongshu`
   切到 `backend`（或 `api-then-dom`）让桌面吃到本次加固。切换前提是 2.4 活体证据到手，
   否则等于把已验证的桌面路径换成未验证路径。

## 4c. 风控归一武装（文本轨，2026-10-09 追加）

同一类静默失效的第二处：`RISK_OVERLAY_SELECTOR` 为空占位时
`_risk_present()` 直接 `return False` ⇒ PR-1 能力表里"风控归一 `XHS_RISK_BLOCKED`、
且不降级换号"这条**实际从不触发**。

- 修法：`_risk_present` 改为双轨——占位选择器（仍待 2.2 活体回填）**或**
  "浮层容器 + 容器内风控文案"。文案口径取自本仓桌面轨已实战使用的风控词表
  （`publish-risk.js` 的 `RISK_RE`），属源证据非活体取证。
- **双条件是刻意的**：只在 `modal/dialog/overlay/verify/captcha` 容器内匹配，
  避免页面常驻文案（侧栏「草稿箱」「验证封面」之类）误判成风控而阻断正常发布。
  误判风控比漏判更有害——它会直接中止用户的草稿保存。
- 默认常量非空由测试钉死（`test_text_track_constants_arming`），与 2.3a 的
  "默认模式非空"断言同一思路：把静默失效变成红。
- 新增 4 项用例：风控文案 → `XHS_RISK_BLOCKED` 且不点发布；无常驻浮层不判风控；
  浮层内良性文案不判风控；常量默认值非空。

## 4c-b. 文本轨的可见性前提（CCG 双审 i1/i2，2026-10-09 修正）

上面 4c 的初版实现有一个 Critical 缺陷，被 CCG 深评抓出（`.adversarial/ccg-deep-320e8f2b/`）：
它只查 `count() > 0` 然后读 `.first.inner_text()`，**从不查可见性**。

- 失败场景（不是理论风险）：创作者中心是 SPA，未打开的 modal/verify 容器以
  `v-show` 形式常驻 DOM，默认文案正是「请完成验证」。按初版实现，用户**每次**
  草稿保存都会在流程入口被判 `XHS_RISK_BLOCKED` 而中止——本功能的验收口径是
  "内容进真实草稿箱"，误判等于整个功能不可用。
- 修正后的三条硬规则：
  1. **必须可见**：`_visible_texts()` 只收 `is_visible()` 为真的元素文案；
     选择器轨（占位 `RISK_OVERLAY_SELECTOR`）同样走可见性，不再是 `count()>0`。
  2. **必须逐个扫描，且有上限**：`[class*="modal"]` 真实会命中多个节点，
     风控层不在 DOM 首位时读 `.first` 必漏判（i2）；改为按序扫描可见元素，
     上限 `RISK_HOST_SCAN_LIMIT = 8`，防止整页模板把 `inner_text` 成本放大到拖垮发布链。
  3. **词表只收强指认短语**：删掉裸「滑块」与「拖动滑块」——封面裁剪弹窗的
     「拖动滑块调整比例」是控件说明，不是风控；真实滑块验证必然同容器共现
     「安全验证/验证码」，收紧不损失召回。
     注：这是对源证据（`publish-risk.js` 的 `RISK_RE`）的**有意收窄**，理由与
     双面用例已写进 `xiaohongshu_selectors.py` 注释，不是无意识漂移。
- 用例（先红后绿）：隐藏模板不判风控 `test_hidden_risk_template_is_not_risk`；
  第 2 位可见容器仍被抓到 `test_risk_wording_in_second_visible_host_is_caught`；
  裁剪文案不判风控 + 真验证判风控；扫描截断到上限
  `test_visible_hosts_beyond_scan_limit_are_not_read`。
- 判定记录：i1、i2 均 `upheld`（含 prosecution/defense/rationale 三列，可复核）。

=======
>>>>>>> fef47eb7e (fix(xhs-dom): 落地 CCG 深评五项（风控可见性硬前提 / 等待上限回归 / 守卫解耦 / CI 纳管）)
## 4d. Python 轨认证已被策略硬阻（2026-10-09 用户实跑暴露）

用户按 §6 运行探针，崩溃于 `legacy_auth_policy.require_legacy_plaintext_auth()`：
`RuntimeError: 旧 Python 明文认证持久化已停用，请使用桌面端加密账号存储`。

调用链是 `XiaoHongShuPublisher._ensure_browser()` →
`xiaohongshu_auth._restore_auth_data()`（第 1 行）→ 策略守卫。该守卫除非同时满足
两个 `MULTI_PUBLISH_*` 迁移环境变量 **且** 非生产环境，否则无条件抛错；
`_save_auth_data()` 与 `_restore_cookies_legacy()` 同样受此门。

结论与影响口径：

- **这不是探针 bug，是仓库既定策略**（Python 明文认证持久化已停用，登录态归桌面加密
  账号存储）。我们不应为了跑取证而放宽这两个环境变量——那等于在验收脚本里绕过一条
  安全红线。
- 因此 §4b 的判断要再加一层：Python 轨不仅**无生产调用方**（桌面发布被 `ROUTE_TABLE`
  派到 `rpa_vm`），在正常构建下也**无法恢复登录态**。它的 DOM 链只能通过"探针自持
  persistent profile + headed 扫码"这种方式被验证。
- 修法：新增 `open_probe_browser()`，直接 `launch_persistent_context` 到账号 profile
  目录，绕开 `_ensure_browser` 的认证恢复；结束后也不调 `_save_auth_data`
  （登录态由 profile 目录自身留存）。gitignored，不入库。
- 验收含义：**2.4 活体验收的正面证据必须来自桌面轨**（`rpa-view-platforms.js`
  的 `draftOnly:true` 路径 → 草稿箱可见）。Python 轨的活体取证只用于回填选择器/端点，
  不代表用户实际使用的链路。

## 4e. PR-1 引入的回归：上传控件轮询被删 ⇒ 无媒体草稿（Bug 反哺，2026-10-09）

发现方式不是功能测试，而是**静态守卫变红**：`test_p4_wait_until.py` 断言
`xiaohongshu.py` 里 `wait_until(` 出现 ≥ 2 次，PR-1 合并后只剩 1 次。

**① 根因**：PR-1 把"导航后轮询上传控件可见"（`upload_input_ready = await wait_until(...)`）
替换成一次性 `_resolve_visible(page, "upload_input")`。`_resolve_visible` 不等待，
SPA 首屏未挂载时返回 `(None, None)`，而调用处是
`if file_input is not None: await set_input_files(...)` —— 条件不满足就**什么都不做且不报错**。

**② 逃逸链**：这条静默跳过逃过了所有测试。PR-1 的单测用 `_base_page()`（控件恒可见）
且 `media_paths=[]`，从未构造"延迟挂载"场景；后面的 `_await_editor_ready` 轮询会让页面
最终看起来"就绪"，于是流程继续填标题、点存草稿 —— 产出**没有媒体的草稿**。
用户的验收口径是草稿箱里内容完整，这属于缺陷交付而非失败交付，因此连错误码都不会出现。

**③ 系统性漏洞**（两条，都已处理）：
- `packages/python-backend` 的 pytest **不在任何 CI workflow 里**（`gui-test.yml` 只跑
  `test_video_provider_imports.py`），所以守卫变红不阻断 PR —— tasks 1.9 的
  "全量回归通过"是在本地未复跑该文件的前提下勾掉的。
- 守卫自身用**源码字面量**断言（`"UPLOAD_FALLBACK_WAIT_TIMEOUT_S = 30.0" in src`、
  `"改为轮询编辑器就绪" in src`）。PR-1 把常量定义移到 `xiaohongshu_selectors.py`、
  日志措辞也改了，于是同一个守卫又出现两处**假红**，掩盖了它抓到的真红。

**④ 修复 + 回归保护**：`_await_upload_input()` 恢复条件轮询（沿用
`NAVIGATE_READY_TIMEOUT_S`/`NAVIGATE_READY_POLL_INTERVAL_S`），且把"有媒体但控件始终不挂载"
从静默跳过改为 `CODE_UPLOAD_FAILED` **fail-closed**（不完整的草稿不进草稿箱）；纯文本草稿
路径不等待、不受影响。上传控件与编辑器两处轮询收敛到共用 `_await_control()`（也顺带把
`xiaohongshu.py` 压回 499 行，不触债务熔断的 ≥500 行文件数基线）。
新增 4 项用例：延迟挂载必须等到并真正上传、始终不挂载必须 fail-closed 且不点存草稿、
无媒体不白等、等待常量必须真的被发布器引用。
守卫本身也被修：`wait_until(` 出现次数改成**调用图断言**（`_await_control` 存在且被
`await` ≥ 2 次 + 两个 label 存在），因为把两处重复轮询收敛成一个共享 helper 是改进，
按次数断言会把它误判成回退；`UPLOAD_FALLBACK_WAIT_TIMEOUT_S = 30.0` 的字面量子串改为
断言**生效常量值**（常量已被 PR-1 移到 selectors 模块）。
破坏-恢复验证（两种破坏都跑过）：
① 删掉轮询只留一次性解析 → 行为用例 `test_late_mount_...` 变红；
② 回退成"两处各自 wait_until"的旧形状 → 守卫变红。恢复后发布轨 51 项全绿。

**⑤ 防止再发**：把"一次性解析 = 静默跳过"记为本轨的反模式；`_resolve_visible` 的返回值
在**必须发生**的动作（上传媒体、点存草稿）上不允许 `if ... is not None` 直接吞掉，
必须显式给出失败码。本条同时说明：验收前必须在本地实跑
`cd packages/python-backend && pytest`，不能依赖 CI 兜底。

## 4f. CCG 双审其余三项（i3/i4/i5，2026-10-09）

i1/i2 见 §4c-b。另外三条同样全部 `upheld`，且各自有可验证的落点：

**i3（等待上限被顺手收紧）—— 成立，已修。**
改造前是 `sleep(30)` 后解析一次，等效容忍度 30s；PR-1 把上传控件那一处换成轮询时
用了 `NAVIGATE_READY_TIMEOUT_S = 10s`，等于**同时**改了"怎么等"和"最多等多久"。
更糟的是常量被错配：`UPLOAD_FALLBACK_WAIT_TIMEOUT_S`（名字就是"上传兜底"）当时被
喂给了编辑器就绪，而上传路径拿到 10s。这与 4e 自己声明的准则"上限沿用原时长，
只收紧快路径"直接矛盾。
修法：两个等待的常量对调回来——上传控件 30s（原容忍度）+ 编辑器就绪 10s，
`fail-closed` 与"命中即返回"的快路径收益全部保留。
> **⚠ 本条结论已被 §4k 部分推翻（同日第二轮深评 i1）**：对调只纠正了上传那一侧，
> 编辑器就绪留在 10s 同样违背「上限沿用原时长」（改造前它也是 30s），且它的超时并不软
> ——下游 `_set_field` 会直接把慢首屏报成 `XHS_TITLE_FAILED`。现行口径：**两个等待都是 30s**，
> 常量仍分开命名。保留本节原文是为了留下"修复自身被重审"的取证轨迹，不要照抄这段结论。
验证：`test_upload_ceiling_keeps_the_original_tolerance` 钉住 30s；
`test_upload_path_uses_the_upload_fallback_ceiling` 给两个常量传不同哨兵值
（0.05 / 9.99），看失败留痕里出现哪个，从而证明**映射**归属，而不是抠 `timeout_s=` 源码字面量。

**i4（守卫的格式化耦合）—— 半成立，按两半分别裁。**
`'label="编辑器"' in src`、`"未就绪" in src` 这类断言确实是同一失效类：日志措辞从
"未就绪"改成"尚未就绪"就假红，而产品行为毫无变化。4e 已承认本 PR 因字面量假红过两次，
却仍留着第三处。已从 `test_p4_wait_until` 移除，改由行为用例承担
（`test_editor_ready_timeout_leaves_a_reason_in_logs` 挂 loguru sink 断言警告里点名等待对象；
本仓日志是 loguru，`caplog` 抓不到，这一点也写进了测试注释）。
`==30.0`/`==10.0` 的值棘轮则**不成立**：断的是生效值而非源码位置，搬文件不会假红，
删掉反而失去"上限被悄悄改掉"的防线——保留，并由上面的哨兵值用例补上"映射"这一维。

**i5（§4e③ 声明的系统洞未修）—— 成立，已修。**
`.github/workflows/gui-test.yml` 此前只跑 `test_video_provider_imports.py` 一个文件，
"python-backend 回归不参与合并阻断"正是 PR-1 漏检的根因；4e 把它写成"待办"却没动 workflow。
现在新增 `Verify publisher RPA/DOM regressions` 步骤，显式纳入 5 个发布器测试文件
（xiaohongshu DOM 加固 / p4 等待守卫 / new_publishers / douyin publisher / douyin rpa_fields）。
同时补装 `pytest-asyncio`：本地依赖树里有、workflow 里从未声明，
不装则 CI 会**静默跳过全部 async 用例**——那会比没有门禁更危险（绿色但恒真）。
全量套件暂不纳入：本环境有 2 项既有失败（ASR 下载、story2video manifest），已在
`origin/main` 基线 worktree 复现，与本轨无关；另有 2 项（frame_html 模板路径、
llm_service ollama dummy key）单独跑为绿、全量跑为红，属同进程用例串扰。
把它们混进本域门禁只会让流水线长期红、降低门禁可信度，故留待各自域处理。

**本域门禁实测**：上述 5 文件在本地 90 passed；发布器 + 邻近套件全绿；
`node scripts/check-debt-budget.js` 通过（`filesOver500` 99 < 基线 101）。
**这句当时就无效**：它参照的是总数棘轮，而真正逐文件判定的是
`.github/scripts/check-max-lines.js`（见 4g ①），当时 511 行已越闸，CI 直接红。
5 种破坏（删可见性 / 词表放回裸「滑块」/ 只读首个元素 / 上传 `timeout_s` 误用 10s 常量 /
超时留痕改名或删除）各自跑红，恢复后全绿——其中第 ④ 种是补强：只断错误文案里数字的
旧写法会**假绿**（文案与 `timeout_s` 可以各用各的常量），因此加了轮询次数断言。

## 4g. 合并前 CI 抓出的两处"本地验错门禁"（PR-3，2026-10-09）

PR #3192 的 CI 有两项红，都不是发布逻辑错，而是**我本地参照了错的闸**：

**① `债务熔断检查`：`NEW_OVER_LIMIT: xiaohongshu.py 511 行 >= 500`。**
- 4e 里我引的是 `scripts/check-debt-budget.js`（`filesOver500` 总数棘轮，基线 101、允许回落），
  据此写下"xiaohongshu.py 保持 499 行不触闸"。真正阻断的是
  `.github/scripts/check-max-lines.js`：**逐文件**判定——不在挂账清单里的超限文件直接红，
  与总数无关。两把闸名字都像"债务熔断"、语义不同，取错一把等于没验。
  这也是本轨第 N 次撞上同一失效类：**判据看着在，实际不作用**。
- 处置：按本仓既有范式拆分（先例 `xiaohongshu_auth.py`），新增 `xiaohongshu_dom.py`
  承载底层控件操作（纯函数），发布器降至 446 行。
- **拆法约束（不能改成 mixin 的原因）**：风控选择器/词表/扫描上限与上传等待上限必须由
  发布器在调用处读取后**传参**。若 mixin 在自己模块里 `import` 这些常量，
  `monkeypatch.setattr(xhs, "RISK_OVERLAY_SELECTOR", ...)` 与 `xhs.UPLOAD_FALLBACK_WAIT_TIMEOUT_S`
  就只改到发布器的命名空间，被测代码读的仍是 mixin 模块那份——测试照跑、patch 照失效，
  配上"能力声称存在"的文档就是假绿的完美形态。守卫里加了一条结构断言钉死它：
  `xiaohongshu_dom.py` 不得出现 `xiaohongshu_selectors` 的 import。
- 守卫同步改口径：`wait_until(` 的实现现在在 DOM 模块，"实现在哪"与"谁在调用"必须
  **两头分别断言**；只断 union 会在任一头被删时假绿。

**② `QG Static`：`STEP_NOT_FAIL_FAST gui-test.yml::Verify publisher RPA/DOM regressions`。**
- `scripts/check-step-failfast.js` 只看步骤级 `shell:` 行，读不到 workflow 级
  `defaults.run.shell: bash`，于是按最严口径判我不 fail-fast；另外我把
  `pip install pytest-asyncio` 和 `pytest` 写在同一 run 块里，`pytest-asyncio` 这个字面量
  正好命中它的"测试命令"正则，被算作第 2 条。
- 处置不是放宽门禁，而是按仓内惯例（其余 4 个多命令步骤都显式声明）补
  `shell: bash`，并把依赖声明收进 `pyproject.toml` 的新 `[test]` extra，run 块只留一条
  pytest。顺带关掉另一个洞：`pytest-asyncio` 此前只活在 workflow 文本里，仓库不声明，
  本地缺它时 `@pytest.mark.asyncio` 用例是**静默不收集**（0 收集 = 绿），比没有门禁更危险。

**破坏-恢复验证（6 种，全部跑过并恢复）**：
① DOM 模块自带常量 import → 守卫红；② 删掉 `wait_until` 轮询 → 守卫红；
③ 发布器不再经由 DOM 轮询 → 守卫红；④ 抹掉编辑器等待 label → 日志留痕行为用例红；
⑤ overlay 常量写死空占位 → 新增的"overlay 轨独立成立"用例红；⑥ 整条 overlay 轨删除 → 同一用例红。
其中 ⑤⑥ 是补出来的：破坏验证发现原有 risk 用例同时给了「安全验证」文案，文本轨会顺手兜住，
把 overlay 轨整条删掉**照样绿**——占位轨（Tier2 回填后要承担纯图形验证码这类无文案的层）
此前没有任何独立保护。新用例 `test_overlay_selector_alone_blocks_without_risk_wording`
只放可见容器、文案刻意避开词表，并反向自证该文案匹配不到文本轨。

**回归**：发布轨 5 文件 91 passed（较拆分前 +1 为新增用例）；全量
`packages/python-backend` 2822 passed / 4 failed，4 项仍是 4e/1.13 已归因的本分支未触碰的
既有/环境失败（`test_aggregation_video`、`test_frame_html`、`test_llm_service`、
`test_pipeline_loader`，已在 `origin/main` 基线 worktree 复现）；
`check-max-lines.js` ✅、`check-step-failfast.js` ✅（含其 `.test.js` 6/6）。
拆分本身是行为保持改动：90 项既有行为用例在改动后一次未变地全绿，只有静态守卫按新契约重订。

## 4h. 运行态取证（tab CDP，免扫码）：API 草稿链在 permit 步就断（2026-10-09）

按用户口径「后面用 tab 的 CDP 真实运行态验证」，对**正在运行的桌面实例**做了零依赖
CDP 驱动（`GET /json/list` 取 renderer target → Node 原生 `WebSocket` 连
`webSocketDebuggerUrl` → `Runtime.evaluate`）。没有新装依赖、没有 `pnpm exec`（它会
隐式装包、破坏 worktree 依赖），也没有启动第二个应用。

可达性事实：renderer 上挂了 431 个 `electronAPI` 键，含
`probeXiaohongshuDraftChain` / `draftSave` / `draftList` / 风控挂起一族；小红书账号
`has_cookies: true`、`status: active`、`last_validated` 为当日（凭证在桌面加密存储里，
Python 明文轨仍被策略硬阻，见 4d）。注意 preload 是**位置参数**
`probeXiaohongshuDraftChain(accountId, opts)`，传对象会被判"accountId 非法"。

探针两次调用（均只走草稿链，绝不点公开发布）：
- 不带媒体 → `XHS_NO_IMAGE`「至少需要 1 张图片：小红书不支持纯文字笔记」。分派正确。
- 带一张本地临时图 → `XHS_PERMIT_NO_FILE_ID`「permit: 响应缺 file_id」，且
  `chainDetail` 给出平台真实回包骨架：`topKeys=[success, data, code]`，
  `dataKeys=[result, uploadTempPermits]`。

**结论（直接影响验收）**：小红书 **API 轨**的草稿链**今天走不通**，断点在第 1 步取 permit，
根本走不到存草稿。代码读的是 `info.file_id`
（`packages/api-publish-engine/src/publish/platforms/xiaohongshu-draft.js`），平台回的是
`uploadTempPermits`；全仓 grep `uploadTempPermits` **零命中**，说明这是刚取到的新契约
证据，不是既有已知项。

**这条断裂不影响 2.4 的验收路径（差点写错）**：我一度把它写成"桌面队列存草稿被阻塞"，
据代码核对后撤回——`apps/desktop/electron/services/publisher-router.js` 的
`ROUTE_TABLE.xiaohongshu = {mode:'rpa_vm'}`，桌面发布队列走 `RpaViewManager`
（WebContents `executeJavaScript` DOM 轨，上传/点草稿都在页面里做），
**不经过** `api-publish-engine` 的草稿链；后者今天只被诊断探针 IPC
（`ipc-handlers/xiaohongshu-draft-probe.js`）和引擎适配器注册表
（`src/adapters/xiaohongshu.js` ← `src/index.js`）触达。所以 permit 断裂的实际影响面是
"将来把路由切成 API 轨"这一选项，而不是本 change 的验收路径。把它当成验收阻塞，
就会得出"必须先把草稿箱验收改成修 permit"这个错误结论。

**为什么不在本轮直接修**：探针为安全只回传白名单字段（键名，不含值），我据此只知道
`uploadTempPermits` 这个键存在，不知道它是数组还是对象、项内有无 `file_id`。
按键名猜形状写出来的解析器，就是本轨一直在清的"能力声称存在、实际从不触发"的第二种
形态。2.7 的正确顺序：先在本地（gitignored，不入库）扩一处完整回包 dump 取到结构，
再按结构 TDD 解析器与它自己的 PR——且该修复属 API 轨范围，需用户确认是否纳入。

红线复核：探针未点击任何公开发布入口；回包只落本地；账号与 cookie 名称不入库、不入 PR。

## 4i. 第二轮运行态取证（桌面实例 + tab CDP）：登录态实测有效，取证被实例生命周期挡住（2026-10-09 深夜）

**正面证据（免扫码，来自真实实例日志）**：小红书账号凭据可用且被判活三次一致——
`checkLocalCredentials: OK encrypted … cookies=20 lsKeys=12` →
`checkLoginStatus … → persistLoginState 固化登录态 status=active … code=CHECK_LOGIN_SUCCESS`
（18:57 / 19:01 / 19:09 三轮）。⇒ **2.4 不需要用户重新扫码**；此前把"等用户登录"当硬阻塞
已经过期，真正的前置条件只剩一条：**桌面实例要能稳定运行几分钟**。

**阻塞（可复现，非偶发）**：连续 5 次启动（18:56:47 / 19:00:38 / 19:08:53 / 19:12:32 /
19:18:58），实例存活 7s～3.5min 不等，日志一律在 `accounts:batch-check-login` 之后**截断且
无崩溃栈**；CDP 端口间歇 `ECONNREFUSED`（即使端口显示 LISTENING）。取证驱动因此连
`listAccounts()` 都没跑到，证据文件里只留下 `fatal: connect ECONNREFUSED`
（`.agent_context/tier2/live/verify-*.json`，本地不入库）。
这不是本 change 引入的问题，但它决定了 2.2/2.4 只能**在用户在场、应用稳定时**执行。

**疑似关联点（未证实，留给后续调查，属本 change 范围外）**：三次死亡的最后一行都落在
启动期批量登录检测里。`electron/publishers/account-manager.js:604` 的
`RENDER_CRASH_PRONE_OPEN_PLATFORMS = {toutiao, wechat_mp, baijiahao}` **不含 douyin**，
而 douyin 的 HTTP 检查实测为 inconclusive ⇒ 会继续走隐藏浏览器检查（19:19:04 的最后一行正是
`checkLoginStatus: start douyin:…`）。但另一次死亡前是 wechat_mp 的"skip hidden browser"行
（并未开浏览器），所以**不能把因果下结论**，只记录相关性；真需修复应另开 change 用
崩溃栈/`render-process-gone` 事件取证，而不是照这条推断直接改名单。

**已就绪的取证驱动**（本地 `.agent_context/tier2/tier2_live_verify.js`，零依赖 raw CDP）：
走真实发布队列 `publish:batch` + 图文模式（引擎内 `draftOnly=true`，该分支**早于**发布按钮
点击即 `return`，已逐行核对 ⇒ 绝不公开发布），随后轮询 `queue:status/history`，并在任务
进行中抓取创作者中心 tab 的选择器证据：存草稿钮候选、发布钮候选、toast/成功态、
风控层、草稿箱入口、标题/正文/文件输入控件计数。下次一条命令即可同时产出 2.2 与 2.4。

**顺带取证（与本轨同源的漂移问题）**：登录态选择器 `[class*="avatar"],[class*="userInfo"],`
`.user-avatar` 在该页超时未命中，靠 dashboard-host 兜底才判活——和 2.3b 要回填的选择器是
同一类"候选已过期"缺陷，活体取证时应一并采集。

**免扫码的边界（两条路别混成一条）**：上述有效登录态属于**桌面加密账号存储**。
2.4(a) 的 python 探针用的是 `launch_persistent_context` 的 profile 目录，实测
`data/accounts/xiaohongshu/*` 不存在（没有任何可复用的 python 侧 profile）⇒ 探针路线
**仍需用户扫码**，只有 (b) 桌面路线免扫码。两路登录态来源不同，不能互相替代。

## 4j. CCG 深评（`1476985bd` 批次）四项裁决与两处落地（2026-10-09）

触发：doc-only 提交命中敏感内容 3 处 ⇒ 判定需深评（`.ccg/reviews/1476985bd….json`
`deepReview.required=true`）。双模型第 1 轮出 8 条 findings（minScore 6），其中 4 条
Warning 进入对抗裁决，裁决全文见 `.adversarial/ccg-deep-1476985b/adjudication.json`
（逐条 prosecution / defense / verdict / rationale）。

| 争议 | 裁决 | 可验证依据 | 处置 |
|------|------|-----------|------|
| i1 词表仍含裸「验证码」「风控」，良性弹窗误判即中止草稿 | **dismissed** | 本轨口径是桌面实战表 `publish-risk.js:14`（含 `风控\|verify\|验证\|captcha\|滑块`）的**收紧版**；注释排除的是控件说明类裸词（「滑块」「验证」），不是验证产物名；唯一调用点 `xiaohongshu.py:218` 在任何填写/点击之前，误判与正确路径都会停在同一条线，且产出是带错误码可重试的 `XHS_RISK_BLOCKED` 而非静默损失 | 不动词表。收紧只把「请输入验证码」换成「请完成安全验证」照样命中，而放宽召回会放过真实拼图层——两侧代价不对称。精化等 2.3b 活体回传真实风控层文案后再做 |
| i2 纯文本草稿被当合法路径，平台拒收（A 轨已写明 ≥1 图） | **dismissed** | `_confirm_saved`（`xiaohongshu.py:290-316`）是 fail-closed：需 XHR 成功码 / URL 跳 success / 草稿箱回查命中标题三者之一，全无则 `CODE_UNCONFIRMED` 并留痕「不伪造成功」。所谓静默放行不成立；`test_text_only_draft_skips_upload_wait` 钉的是「无媒体不白等 30s」且断言 `uploaded == []` 与不含 `CODE_UPLOAD_FAILED` | 不动。网页草稿箱是否同 API 一样拒收纯文字，属 2.4 待取的活体证据；在此之前按「不凭想象改契约面」不加前置校验 |
| i3 日志用例钉死显示 label「编辑器」，改名即假红 | **upheld** | 日志由 `label` 插值生成，实参是给用户看的措辞（`xiaohongshu.py:409`），与上一轮 i4 刚移除的字面量耦合同类；辩护端要的「必须钉内容」与指控端无分歧，分歧只在锚点 | 已修：`dom.await_control` 新增 `key` 形参并写进日志前缀（`[title_input] 编辑器在 …内未就绪…`），调用点透传，测试改断言机器可读键名 `title_input`。措辞与断言解耦 |
| i4 占位轨靠 `[""]` 恒真碰巧命中，过滤空串即静默漏判；武装后绕过词表 | **upheld** | `visible_texts` 用 `… or ""` 保留空串（`xiaohongshu_dom.py:39`），占位轨判的是**列表真值**（:51）——把「存在」压在「文案列表非空」这个副作用上，任何按文案语义的正当清理都会静默废掉这条轨 | 已修：新增 `dom.visible_count(page, sel, *, limit)` 返回可见元素个数，占位轨改为 `visible_count(...) > 0`，`visible_texts` 不再保留空串（空串对文案轨永远匹配不到正则，零行为变化）。存在性语义写进两处 docstring，并明确「占位轨准确性完全押在选择器精度上，回填须由活体取证把关」 |

**回归保护与破坏-恢复自证**（防静态守卫假绿，沿用本仓既有做法）：
新增 `test_overlay_track_uses_presence_not_text_list`——形状是「有可见容器、零文案」
（`counts[sel]=1` 且不设 `item_texts`），先断言 `_visible_texts(...) == []` 证明文案轨
确实拿不到东西，再断言 `_risk_present(...) is True`。把占位轨退回 `visible_texts` 真值
⇒ 该用例红（`assert False is True`，`test_xiaohongshu_dom_hardening.py:269`）；恢复 ⇒ 绿。
即这条用例同时钉住「存在性成立」与「不再依赖空串保留」两个语义。

**验证口径**：`packages/python-backend` 下 `pytest tests/test_xiaohongshu_dom_hardening.py`
`tests/test_p4_wait_until.py` ⇒ 43 passed；`ruff check` 三个改动文件 ⇒ All checks passed
（同目录另有 3 处既有 `I001/F401` 位于 `account_paths.py` 等未触碰文件，属存量，不在本批范围）；
四道门禁全部通过：`check-max-lines.js`（无新增超大文件、挂账与现实一致）、
`check-debt-budget.js`（filesOver500 98 ≤ 基线 101）、`check-step-failfast.js`（6 个多测试
步骤全 fail-fast）、`check-no-brand-residue.js`（PASS）。

## 4k. CCG 深评第二轮（`0436f91c8` 批次）：上一轮的修复自身被推翻两项（2026-10-09）

深评基线是 `origin/main`（1134 行，即整条分支的累计改动），所以这一轮挑出的是
**上一轮修复引入或遗留的问题**，不是本轮新写的代码。两条 Warning 全部 `upheld`，
裁决全文见 `.adversarial/ccg-deep-0436f91c/adjudication.json`。

**i3 的修复过度纠正：编辑器就绪的上限被留在 10s（i1）**

- 事实核对：改造前 `origin/main` 的 `_await_editor_ready` 用的就是
  `UPLOAD_FALLBACK_WAIT_TIMEOUT_S = 30s`，它自己的 docstring 写着「上限沿用原 30s」。
  本分支改为 `NAVIGATE_READY_TIMEOUT_S = 10s`，等于在同一条「上限沿用原时长，
  只收紧快路径」的准则下，把两个等待做成 30/10 的分配——§4f 逐字写的修法就是这个，
  而 `test_p4_wait_until.py:106` 的注释抄了原则、下一行断言的却是 `== 10.0`，
  守卫自身与它声明的原则同段矛盾。
- 真实失效路径（关键：编辑器就绪**不是**软失败）：`_await_editor_ready` 超时只留痕、
  返回 None 不中止，流程紧接着 `_set_field(page, "title_input", …)`；标题控件此时
  仍未挂载 ⇒ `_set_field` 返回 False ⇒ 草稿以 `XHS_TITLE_FAILED`「填写标题失败
  （选择器未命中或控件不可写）」中止。也就是说早失败并没有换来早成功，只是把
  慢首屏换成了一个**指错方向**的错误码（与 4e 的 SPA 晚挂载同源，换了出口）。
- 收益核对：`wait_until`（`base.py:220`）是**先查再睡**，命中即返回——轮询改造已经
  拿走了快路径的收益，砍上限只在「控件确实不出现」时才多付 20s，而那一类本来就是失败。
  代价不对称 ⇒ 恢复 30s。
- 落地：`xiaohongshu_selectors.py` 的 `NAVIGATE_READY_TIMEOUT_S = 30.0`，常量处写明
  「两个等待都沿用改造前 30s 容忍度；收益在命中即返回而非砍上限」。两个常量**仍分开命名**
  （不合并成一个），因为「哪个常量喂给哪个等待」是由哨兵值用例证明的归属关系，
  合并就等于放弃这条可验证性。同步把静态守卫的断言改成 30.0。

**轮询命中后的二次解析把抖动报成从未挂载（i2）**

- 事实核对：`await_control` 在 `wait_until` 返回 True 之后**再** `resolve_visible` 一次取返回值；
  两次解析之间无原子性。SPA 重渲染/节点回收把控件摘掉时第二次拿到 None，
  `_await_upload_input` 一律 fail-closed 报 `XHS_UPLOAD_FAILED`，文案是
  「上传控件在 30s 内未挂载」——而事实是它挂载过且被轮询确认过，归因错误。
- 为什么复用 locator 安全：Playwright 的 locator 是惰性句柄而不是 `ElementHandle`，
  复用不会 pin 住脱离文档的旧节点；元素真消失了会在 `set_input_files` 上抛原始异常，
  而调用方本来就有 except 分支给出准确文案（媒体上传失败 + 原始异常）。
- 落地：轮询谓词内用 `nonlocal` 缓存命中的 locator，超时才返回 None，命中直接返回缓存值，
  去掉第二次解析。

**验证与自证**：新增 `test_editor_ceiling_keeps_the_original_tolerance`（钉 30s）与
`test_control_vanishing_after_hit_is_not_reported_as_never_mounted`（用「只让首查可见」的
`VanishingLocator` 造抖动，断言上传确实发生且结果不含 `XHS_UPLOAD_FAILED`）。
破坏-恢复实测：把上限改回 10s 且退回二次解析 ⇒ 恰好三条红
（两条新用例 + `test_xiaohongshu_publisher_no_longer_blind_sleeps`），恢复 ⇒
`test_xiaohongshu_dom_hardening.py` + `test_p4_wait_until.py` 45 passed。
`ruff check` 四个改动文件 All checks passed。

**方法论留痕**：深评的变更基线是 `origin/main` 而非上一个提交，因此**每轮都会重审
整条分支**，上一轮的修复结论也在重审范围内。这暴露出本仓此前的一次性写法风险：
当一条修复的结论被写进文档（§4f「编辑器就绪 10s」）而没有同时写下它所依据的准则
（「上限沿用原时长」适用于**每一个**被改造的等待），下一轮就会在文档内部产生自相矛盾，
而这矛盾直到跨模型评审才被抓住。后续所有「把固定等待换成轮询」的改动，落笔时必须逐条
回答：改造前上限是多少？快路径收益是否已经由轮询本身提供？

## 4l. CCG 深评第三轮（`44799e73` 批次）：两条都是"守卫的覆盖范围没跟着代码搬家"（2026-10-09）

第三轮由 4k 的提交触发（深评基线仍是 `origin/main`，因此 4j/4k 的修复也在重审范围内）。
critic 出 7 条问题、维度最低分 6，收敛判定 `self_play`，待裁决 2 条、高危域 0 条。
**两条均 upheld**，且本轮**没有任何生产代码改动**——两条都落在测试/守卫侧。

| 项 | 争议 | 裁决 | 可验证依据 |
|----|------|------|-----------|
| i1 | 风控文本轨的**外层宿主循环零覆盖**：改动前 6 条风控用例全部把文案塞进 `RISK_TEXT_HOSTS[0]`，连名字声称覆盖"第二个宿主"的那条实测的是同一宿主的第二个元素 | **upheld** | 把 `for host in hosts:` 改成 `hosts[:1]` ⇒ 恰好 1 条红（新增的 `test_risk_wording_in_a_later_host_is_caught`，`assert False is True` 于 :438）；恢复 ⇒ 46 passed。失效方向是**漏判风控**（红线），不是误判 |
| i2 | 盲 sleep 守卫**只扫旧文件**：为守 500 行门禁把实现搬进 `xiaohongshu_dom.py` 后，禁止断言仍只对发布器源码做字面串匹配 | **upheld** | 往 dom 的 `set_cover` 插入 `asyncio.sleep(30)` ⇒ 新守卫红于 `30.0 = float('30')`，而**同一改动在旧守卫下全绿**（即指控本身的证据）；删回 ⇒ 66 passed |

**落地**：
- i1：原用例保留（它测的是内层元素顺序，有效）并如实改名为
  `test_risk_wording_in_second_element_of_one_host_is_caught`；新增
  `test_risk_wording_in_a_later_host_is_caught`，先断言 `len(RISK_TEXT_HOSTS) >= 2`
  （清单若被缩到一条，用例自证"无从可测"而不是静默绿），再把风控文案放进第二个宿主。
- i2：禁令改为**跨两个文件按数值判**——正则抽出所有 `asyncio.sleep(<数值字面量>)`，
  逐个断言 `< 3.0`。字面串判在这里是错的口径：`set_cover` 的 `sleep(2)` 是合法收尾等待，
  扩范围就会假红，不扩又挡不住 `sleep(3.5)` 这类同义写法。

**第三类失效模式（与前两类并列）**：4j 提炼了"存在性压在文案列表真值上"，4k 提炼了
"行为留痕的锚点选了显示措辞"，本轮提炼的是——**重构搬动代码时，守卫的作用域必须跟着搬**。
本仓的行数门禁强制把实现从发布器搬到 `_dom` 模块，于是任何"读源码字面量"的守卫都在搬迁
那一刻静默降级为只看一半。后续凡按 500 行门禁做拆分，落笔时必须逐条回答：哪些守卫读的是
旧文件的路径？它们的新语义是否仍然成立？

根本走不到存草稿。代码读的是 `info.file_id`
（`packages/api-publish-engine/src/publish/platforms/xiaohongshu-draft.js`），平台回的是
`uploadTempPermits`；全仓 grep `uploadTempPermits` **零命中**，说明这是刚取到的新契约
证据，不是既有已知项。

**这条断裂不影响 2.4 的验收路径（差点写错）**：我一度把它写成"桌面队列存草稿被阻塞"，
据代码核对后撤回——`apps/desktop/electron/services/publisher-router.js` 的
`ROUTE_TABLE.xiaohongshu = {mode:'rpa_vm'}`，桌面发布队列走 `RpaViewManager`
（WebContents `executeJavaScript` DOM 轨，上传/点草稿都在页面里做），
**不经过** `api-publish-engine` 的草稿链；后者今天只被诊断探针 IPC
（`ipc-handlers/xiaohongshu-draft-probe.js`）和引擎适配器注册表
（`src/adapters/xiaohongshu.js` ← `src/index.js`）触达。所以 permit 断裂的实际影响面是
"将来把路由切成 API 轨"这一选项，而不是本 change 的验收路径。把它当成验收阻塞，
就会得出"必须先把草稿箱验收改成修 permit"这个错误结论。

**为什么不在本轮直接修**：探针为安全只回传白名单字段（键名，不含值），我据此只知道
`uploadTempPermits` 这个键存在，不知道它是数组还是对象、项内有无 `file_id`。
按键名猜形状写出来的解析器，就是本轨一直在清的"能力声称存在、实际从不触发"的第二种
形态。2.7 的正确顺序：先在本地（gitignored，不入库）扩一处完整回包 dump 取到结构，
再按结构 TDD 解析器与它自己的 PR——且该修复属 API 轨范围，需用户确认是否纳入。

红线复核：探针未点击任何公开发布入口；回包只落本地；账号与 cookie 名称不入库、不入 PR。

=======
## 4m. CCG 深评第四轮（`e2170329` 批次）：一个常量不许兼任判据与成本闸（2026-10-09）

第四轮 critic 出 7 条、最低分 6，收敛仍走 `self_play`，待裁决 3 条、高危域 0 条。
**i1 upheld（生产代码）、i3 upheld（测试加固）、i2 dismissed（仅补按语）**。

| 项 | 争议 | 裁决 | 可验证依据 |
|----|------|------|-----------|
| i1 | `visible_texts`/`visible_count` 用 `total = min(count(), limit)` **在 DOM 序上截断、且先于可见性过滤**；portal 把真实风控弹层 append 到 body 尾部，前 8 个节点若多为常驻隐藏模板，可见风控层下标 ≥8 就永不被扫 ⇒ 文案轨与占位轨同时漏判、流程继续走向发布。原注释还写着「真实风控层是页面上最靠前的可见容器之一」——**零活体证据的假设** | **upheld** | 破坏-恢复：把 `total` 改回 `min(count(), limit)` ⇒ 恰好 1 条红（`test_visible_risk_layer_after_hidden_templates_is_caught`，:460 `assert False is True`）；恢复 ⇒ 39 passed，相关全量 68 passed |
| i2 | 静态守卫仍按源码字面量断结构（helper 名、调用形式、`count(...)>=2`），指控为 §4f-i4 声称已除的格式耦合类复发 | **dismissed** | 区分口径可核对：§4f-i4 移除的是**给用户看的显示措辞**锚点，第三轮 i3 的修复方向恰是**把锚点换成机器可读 key**；本守卫钉的正是机器可读标识符与调用图，改名/收敛调用形式属有意重构，此时红一次是设计目标。行为面另有不依赖字面量的用例（哨兵值归属、超时留痕、本轮新增实参 spy）。处置为在锚点补按语，不改断言 |
| i3 | `test_upload_wait_poll_count_matches_its_own_ceiling` 的 `1<=calls<50` 是魔数区间：interval 归属**结构上不可分辨**（同一用例把两条 interval 都 patch 成 0.01），超时误用只能靠时序越界抓 | **upheld** | 双向变异：仅换 interval ⇒ 旧区间绿、新 spy 用例红（即零判别力的直接证据）；仅换 timeout ⇒ spy 与区间两条同时红；恢复 ⇒ 68 passed |

**落地**：
- i1：`limit` 的语义改为「收集满 limit 条**可见**项即停」，探测次数另由新常量
  `RISK_HOST_PROBE_LIMIT = 32` 设硬闸，并由发布器传参（dom 模块仍不得 import 选择器常量，
  守卫已有该断言）。最坏成本从「整页 `count()` 次 `inner_text`」变成「至多 32 次
  `is_visible` + 至多 8 次 `inner_text`」。同时删除那句未验证假设。
  测试侧为此给 `FakePage/FakeLocator` 增加逐元素可见性 `hidden_items`——原假 page 只能表达
  「整个 selector 可见/不可见」，**结构上无法表达**这条场景，这本身就是覆盖面被夹具能力限制的证据。
- i3：区间上界改由被 patch 的常量推导（`timeout/interval + 3`，下界保持 1 并写明 Windows
  sleep 粒度 ~15ms 的抖动理由）；新增 `test_upload_wait_is_fed_the_upload_constants`，
  桩住 `dom.wait_until` 捕获实参 `(timeout_s, interval_s)`，四条常量各取唯一值，
  直接断言配对不被拆开——确定性的归属判据，不受时序影响。

**第四类失效模式（与前三种并列）**：一个参数/常量同时兼任**判据口径**与**成本上限**。
这两者的语义相反（判据要"扫全"、成本要"截断"），兼任时必然有一侧被牺牲，且被牺牲的一侧
通常写在注释里用一句未验证假设自我合理化。凡遇到 `min(x, N)` 型截断，落笔时必须回答：
N 是成本闸还是判据？若是成本闸，判据侧的截断口径按什么计数？

=======
## 4n. CCG 深评第五轮（`9237e6ce` 批次）：成本闸消灭的是无界，不是悬崖（2026-10-09）

第五轮 critic 出 7 条、最低分 6，收敛仍走 `self_play`，待裁决 3 条、高危域 0 条。
**三条全部 upheld**（`.adversarial/ccg-deep-9237e6ce/adjudication.json`），且都是上一轮
修复自身留下的缺口——这轮的价值在于证明"修好一条失效模式"不等于"修好这条模式的所有实例"。

| 项 | 争议 | 裁决 | 可验证依据 |
|----|------|------|-----------|
| i1 | 实参 spy 只在**媒体路径**上跑，而该路径上传先 fail-closed 中止，`_await_editor_ready` 从未执行 ⇒ 编辑器等待的常量配对零保护；日志用例只断 `title_input` 不断哨兵值 | **upheld** | 变异：编辑器改喂 `UPLOAD_*` ⇒ 改动前 0 条红（指控成立）；补 `test_editor_ready_is_fed_the_navigate_constants`（走无媒体路径，四个常量各取唯一值）⇒ 同一改动恰好 1 条红且红在新用例 |
| i2 | `RISK_HOST_PROBE_LIMIT=32` 仍是按 DOM 序的截断，只是把悬崖从 8 移到 32；新常量无生效值断言 | **upheld**（子指控"删接线不红"不成立：`probe_cap` 是必填关键字参数，删之即 TypeError） | 变异：`probe_cap` 接成 `RISK_HOST_SCAN_LIMIT`(8) ⇒ 3 条红；落地为**截断留痕**而非换更大的数——`visible_texts`（命中数超上限且未集满可见文案）与 `visible_count`（超上限且一个可见都没数到）各打一条含选择器与两个计数的告警 |
| i3 | `RISK_TEXT_PATTERN` 含单词级「验证码」「风控」，与注释自称"只收强指认短语、不收裸词"直接矛盾 | **upheld**（只认"注释与实现互相打脸"这半；行为面不改词表） | 不改词表的理由固化为设计而非偶然：新增 `test_verification_code_dialog_is_risk_by_design`，变异（去掉「验证码」）⇒ 恰好 1 条红；注释改写为两条明确口径，并写明改判前提是 2.2 活体取证取到不含核验语义的该文案 |

**留痕之外还补了一道对照实验**：占位轨的截断留痕最初无人看守——删掉那段告警后
`43 passed` 全绿（这正是 i2 指控的同型实例）。据此补
`test_placeholder_track_truncation_leaves_a_trace`，删除该段即恰好 1 条红。
五道变异（A 编辑器错配 / B 去文案轨留痕 / C probe_cap 接成 8 / D 去占位轨留痕 / E 收窄词表）
逐条红于且只红于对应新用例，恢复后 `44 passed`。

**第五类失效模式**：**同一机制的多个调用点，保护只做了一半**。上传与编辑器两条等待共用
`dom.wait_until`，spy 只钉了其一；文案轨与占位轨共用同一道成本闸，留痕只写了一处。
补保护时必须先问"这个机制还有几个入口"，并让每个入口都能独立被变异抓出来——
上游 fail-closed 会把下游路径整条屏蔽，只测上游等于没测。

**第六类失效模式**：**不可消除的漏判面必须变成可观测面**。任何有限上限都留悬崖，在没有
活体证据说明风控层 DOM 位置之前，把它换成"反向扫尾部"只是再猜一层未验证假设。正确处置是
承认代价并留痕（截断即记录选择器 + 命中数 + 探测数），让下一次静默失效可查、并让取证数据
自己说话。同时注释不许夸大实现口径：注释与代码不一致时，注释会变成误导后续审查的产物。

=======
## 4o. 第三轮运行态取证（tab CDP · 账号分区）：图文草稿是自动保存 + 浏览器本地态（2026-10-08 定案）

### 取证方式
用**运行中的桌面实例**（已带 `--remote-debugging-port`）经零依赖 CDP 驱动渲染端：免扫码、免新实例。
标签页必须经 `window.electronAPI.pageManager.createNewTabPage({url, accountId, platform})` 打开，
才会落到 `persist:account-<id>` 已登录分区（`tab-lifecycle.js:24-38`）；不带 `accountId` 时走临时
`persist:browse-<tabId>`，进发布页即 401 弹回登录页。探针只做只读枚举、`location.reload()` 和
点「草稿箱(N)」这个**导航**入口；绝不点发布、绝不点删除。账号 id/名称等活体产物只落 gitignored
的 `.agent_context/tier2/live/`，不入库、不入 PR 描述。

### 四条结论（推翻本仓此前四条假设）
1. **图文编辑器没有「存草稿/保存草稿/暂存离开」按钮。** 按钮与叶子文本全量枚举（关键词含
   「草稿」「暂存」，探测放宽到 12 次）无一命中；页面右下角显示「编辑于 刚刚」，即草稿由平台
   **自动保存**。⇒ PR-1 把一条页面上根本不存在的控件当成了成功前置条件，`XHS_DRAFT_ENTRY_MISSING`
   在真实页面上永不成立；该常量与它的归一已删除。
2. **草稿箱入口就是发布页自身**（左侧 `header-draft` 面板），取证地址为
   `.../publish/publish?from=menu&target=image`；此前的 `?draft=true` 是从未在活体出现过的猜测值。
   ⇒ `DRAFT_BOX_URL` 已按证据改为真正会重载到图文面板的地址。
3. **计数节点实测 `SPAN.draft-title`，文本形如「草稿箱(1)」**；条目标题选择器
   （`[class*="draft"] [class*="title"]`）仍未取证，只保留为次级兜底。
4. **图文草稿是浏览器本地态，跨分区不可见。** RPA 窗口用 `persist:rpa-<platform>-<accountId>`
   （`rpa-view-session.js:130-143`），与账号标签页的 `persist:account-<id>` **不是同一分区**。
   ⇒ 账号标签页里读到「草稿箱(0)」并不证明 RPA 没写进去，只证明**证据介质口径错配**。本段最重要
   的自我纠错就在这里：先前把「队列 success + 草稿箱 0」判成假成功，实质是拿 A 分区的可见性去判
   B 分区的写入，判据本身无效。

### 2.4 活体验收（通过）
账号分区内人工复现存草稿：进发布页读到「草稿箱(0)」→ 填标题/正文并上传图片（`ros-upload` 实测
5242880 bytes）→ `location.reload()` → **「草稿箱(1)」**，点开草稿箱可见本次标记标题条目与
「编辑于 …」。证据：`live/after-20261008T213745.json`。
⇒ 验收口径固化为：**以重载后「草稿箱(N)」计数增长作为图文草稿的正面确认信号**。

**证据强度按语（CCG 六轮 i5，如实登记不加码）**：这条判据只由**一次**人工观测（0→1）支撑，
且「同一次编辑复用既有草稿槽」「多标签并发写入」两种形态**没有观测面**。因此本节固化的是
"在该形态下计数 +1 是正证据"，不是"计数不涨就一定没写"。代码侧对应的处置是：不涨时仍保留
标题回查这一条**未取证**的兜底通道（可命中确认，不因不命中判失败），并把 `baseline → now`
的实际转移值打进日志，让"看着没涨"成为可核对的线索而非结论。

### 代码落地（同批）
- `xiaohongshu_selectors.py`：`DRAFT_BOX_URL` 改为取证地址；新增 `DRAFT_BOX_COUNTER_SELECTOR`
  与 `DRAFT_BOX_COUNTER_PROBE_CAP = 8`（成本闸，不是判据口径，沿 §4m 的分离原则）；删除
  `CODE_DRAFT_ENTRY_MISSING`。
- `xiaohongshu_dom.py`：新增 `draft_box_count()`，读不到节点或节点文本不含计数一律返回 `None`
  ——「看着像 0」不得被当成基线。
- `xiaohongshu.py`：`_execute_flow` 在**写入任何内容之前**读基线（平台自动保存，读晚了基线就被
  本次草稿污染，增量判据永不成立）；`_save_as_draft` 无按钮时不再报错，改为转入以计数为判据的
  确认；`_recheck_draft_box(page, title, baseline)` 主判据改为重载后计数增长，标题匹配退为兜底。
- fail-closed 红线一条没松：无 XHR 成功码、无 success URL、无计数增长、无标题命中 ⇒
  `XHS_UNCONFIRMED`，且绝不点击任何公开发布按钮。

### 测试保护（破坏-恢复变异取证全部 CAUGHT）
7 条变异各自把一处保护改成失效形态、确认对应新用例变红后即时还原：① 计数持平即视为确认；
② 删掉增量判据；③ 基线挪到写入之后；④ `probe_cap` 硬编码不走常量；⑤ 读不到计数当 0；
⑥ 恢复「无按钮即失败」的旧口径；⑦ 夹具拿掉计数节点的可见性闸门（证明夹具真的经过可见性判）。
还原后本文件 52 条全绿。

=======
> 本节记录 `9df5bf3a` 提交时的状态。其中"单次读计数"这个判据实现本身被 CCG 第六轮判为
> 同类复发缺陷（§4e/§4k 的第三次），修正与新增保护见 §4p。

## 4p. CCG 深评第六轮（`9df5bf3a` 批次）：单次读取压在晚挂载节点上，第三次复发（2026-10-09）

五项争议全部裁决完毕（`.adversarial/ccg-deep-9df5bf3a/adjudication.json`，
fingerprint `39998342e0d286a6`）：**i1 Critical upheld、i2 upheld、i4 upheld、i3 dismissed
（仍自愿加固）、i5 dismissed（附证据强度按语）**。

### i1（Critical）：确认链的两处一次性读，等于把唯一判据挂在运气上
本轨已经两次承认创作者中心是 SPA（§4e 上传控件晚挂载、§4k 编辑器就绪），却在同一前提下
把**基线读取**和**回查增量读取**都写成一次性。失败场景具体：慢网下面板还没挂上 ⇒ 基线读成
`None` ⇒ `recheck` 因无基线直接放弃增量判据，退到那条**从未被活体证实**的
`DRAFT_BOX_ITEM_SELECTOR` ⇒ 真实保存成功的草稿被报成 `XHS_UNCONFIRMED`，而且降级过程只在
日志里留一句"退到标题回查"，看不出"判据本身不可用"。

辩护只守住了"不会假成功"，没否证"真成功被判失败"——后者正是本次验收口径的失败面，故指控
成立。

### 落地
- `xiaohongshu_dom.py` 新增 `await_draft_box_count()`（等节点挂载，命中即返回，**无固定
  sleep**；等不到时 `logger.warning` 留痕）与 `await_draft_box_increment()`（等待条件写成
  **增量本身**而不是"节点出现了"——节点常驻而值没变时仍须轮询到超时才判未确认）。
- `xiaohongshu_selectors.py` 新增 `DRAFT_BOX_WAIT_TIMEOUT_S = 30.0` / `DRAFT_BOX_POLL_INTERVAL_S
  = 0.5`：上限沿用本轨既有的 30s 容忍度口径，间隔沿用编辑器就绪的同族取值。
- `xiaohongshu.py` 基线读取改走 `await_draft_box_count`；`_confirm_saved` 新增 `box_first`
  与 `box_checked`（见 i4）；`_recheck_draft_box` 下沉为**纯函数** `dom.recheck_draft_box`
  （发布器只保留常量接线的薄包装）。下沉的直接动因是 500 行门禁，但它同时修好了一件本来就
  不对的事：判据逻辑留在发布器里时，`xiaohongshu_dom.py` 的纯函数约定（常量一律由调用方
  传入，以保证 `monkeypatch` 生效）对确认链不适用。
- `draft_box_count` 的解析放宽为兼容全角/半角括号与空格（i3 的自愿加固），docstring 写明
  **括号是显示格式不是协议**：平台改版一个括号的代价应当只是"少一条证据"。

### i4：已知的死信号不该排在活信号前面
自动保存不打 `/note`（§4o），所以草稿路径先等 20s XHR 是**必然空等**，而真正能确认的计数
回查被排在它后面；未确认时末尾的兜底分支还会把整页 `goto` 重载做第二遍。改为：无显式草稿
按钮 ⇒ `box_first=True`，回查置前、命中即返回；`box_checked` 守卫保证单次确认里整页重载
最多一次。公开发布路径顺序不变（`baseline=None`、`box_first` 默认 False）。

### i2 的未修部分（登记为开放边界，不留成隐式假设）
"自动保存复用既有草稿槽 ⇒ 计数不增量 ⇒ 重试恒假失败"这半条指控成立，但它是"唯一可见证据"
这一取证前提的固有边界，不是实现缺陷。处置：保留 fail-closed（错向是失败而非假成功），把
`baseline → now` 实际值打进日志，并记入 §5 的待取证项——**要拿到"已有草稿再存一条"的真实
形态**才能判断该判据要不要换成"条目级证据"。

### 测试保护（14 道变异全部 CAUGHT，还原后 57 passed）
本轮新增 6 条用例：晚挂载仍须拿到基线、增量必须轮询、两处等待各取自己那对常量（哨兵值）、
括号形状容忍、`box_first` 不烧 XHR 且不重载两次、以及给既有用例补"回查只做一次"的断言。
变异 M1–M14 逐条红于对应保护（M4/M5/M6/M10/M11/M12 各恰好红一条；M8 同时红晚挂载与配对
用例；M13/M14 属覆盖面红多条）。RESTORE_CHECK CLEAN。

**顺带暴露的测试基建缺口**：`_fast_draft_box_wait` 夹具原先把草稿箱等待收紧为
`(0.05, 0.01)`，而 `test_upload_wait_is_fed_the_upload_constants` 是按 **timeout 数值**筛
`wait_until` 调用的（筛 `t == 0.05`）——草稿箱等待一旦也走 `wait_until`，两个机制就串进同
一个筛子，误喂的 interval 反而被对方的正确值掩护。夹具取值改为与上传/导航哨兵对**互不相交**
的 `(0.041, 0.011)` 并写明原因。教训：**按数值筛的配对断言，要求所有哨兵值全局唯一**，否则
新增一个走同一 `wait_until` 的机制就会静默改变既有断言的判别力。

>>>>>>> 770040d7a (fix(xhs-rpa): 草稿箱计数判据改条件轮询，并把回查置前省掉必然空等)
## 5. 剩余工作（必须完成才算验收）

| 项 | 状态 | 阻塞 |
|----|------|------|
| 2.3a 端点模式常量回填 | 已完成（源证据） | — |
| PR-3 行数门禁拆分 + CI fail-fast 修正 | 已完成（4g） | — |
| 2.1 活体取证 runbook 脚本 | 已完成（改走 tab CDP，免扫码，见 4o） | python 探针路线（扫码）已弃用：运行中桌面实例即可提供账号分区 |
| 2.2 真实选择器取证 | 已完成（4o） | 取到 `header-draft`/`draft-title`/`SPAN.draft-title` 计数文本、无草稿按钮、自动保存「编辑于」 |
| 2.3b `DRAFT_BOX_URL` / 计数选择器回填 | 已完成（4o） | `RISK_OVERLAY_SELECTOR` 仍为占位（风控轨继续走文本判据），`DRAFT_BOX_ITEM_SELECTOR` 仍未取证，仅作次级兜底 |
| 2.4 真实草稿箱活体验收 | 已完成（4o，`草稿箱(0)` → 重载 → `草稿箱(1)`） | 验收口径已固化进确认链 |
| 桌面 Node 轨 `draftOnly` 无正面确认即报 success | 待办（新发现，另开任务） | `rpa-view-platforms.js::_publish_generic` 实测 14s 返回、`url` 恒为发布页 URL，无确认信号；且 RPA 分区与账号分区不同，判据需按 4o 结论重设 |
| `rpa-rpa-*` 双前缀分区漂移与孤儿分区目录 | 待办（新发现，另开任务） | 需先定位拼接点，改动不在本分支范围 |
| 2.6 运行态取证（tab CDP，免扫码） | 已完成 | 取到 API 轨 permit 契约断裂证据（4h） |
| CCG 深评（`1476985bd`）四项裁决 + i3/i4 落地 | 已完成（4j） | 深评第 1 轮即达 stall 出口，改走 self-play 裁决（`confidenceWeight 0.6`），无高危域项 |
| CCG 深评第二轮（`0436f91c8`）两项裁决 + 落地 | 已完成（4k） | 上一轮修复自身被重审推翻：编辑器就绪上限恢复 30s、去掉命中后的二次解析 |
| CCG 深评第三轮（`44799e73`）两项裁决 + 落地 | 已完成（4l） | 两条均落在守卫侧、无生产代码改动：跨宿主轮询补用例、盲等禁令改跨文件按数值判 |
| CCG 深评第四轮（`e2170329`）三项裁决 + 落地 | 已完成（4m） | i1 为本批唯一生产代码改动（`limit`/`probe_cap` 口径分离）；i2 dismissed 仅补按语；i3 测试加固 |
| CCG 深评第五轮（`9237e6ce`）三项裁决 + 落地 | 已完成（4n） | 三项全 upheld；生产改动为截断留痕（可观测性），其余为测试保护补全与注释如实化 |
| CCG 深评第六轮（`9df5bf3a`）五项裁决 + 落地 | 已完成（4p） | i1 Critical upheld（两处一次性读改条件轮询）；i2 前半（草稿槽复用不增量）**登记为开放边界**见下行；i4 upheld（回查置前且不重载两次）；i3/i5 dismissed |
| 计数判据的"已有草稿/复用槽"形态取证 | 待办（需活体，本地无法判定） | i2 前半：需在**已有草稿**的账号上再存一条，观测计数是否 +1；若不增量则判据要换成条目级证据（需先取证 `DRAFT_BOX_ITEM_SELECTOR` 的真实节点） |
| 2.7 API 轨 permit 契约修正 | 待办（范围外，待用户确认） | 需先取 permit 完整回包结构，禁止按键名猜 |
| 3.2 change 归档 | 待办 | 两 PR 合并 + 活体验收通过 |

2.4 的活体验收已通过，但验收信号是**「草稿箱(N)」计数增长**（4o），不是 `/web_api/sns/v2/note`
响应：自动保存链路上未捕获到该端点的活体 XHR，所以 `DRAFT_SAVE_RESPONSE_PATTERNS` 仍是
**源证据**而非活体证据。它作为 XHR 主确认通道继续保留（命中即确认，且已在 §4 里排除了
permit/ros-upload 的假阳性），但"本能力已活体验收"这句话只对计数判据成立，不对端点成立。

## 6. 取证 runbook（2.1/2.2/2.4 已按此执行完毕）

**实际执行路线（免扫码，本节下方 python 探针路线已弃用）**：驱动**运行中的桌面实例**
（`--remote-debugging-port`）→ `http://127.0.0.1:<port>/json/list` 找 target → Node 自带的全局
`WebSocket` 直连（该环境**无 `ws` 模块**）→ `Runtime.evaluate{awaitPromise:true,returnByValue:true}`
执行页内表达式；文件上传用 `DOM.getDocument`→`DOM.querySelector`→`DOM.setFileInputFiles`。
开页只走 `pageManager.createNewTabPage({url, accountId, platform})` 以落到账号分区。
一次性脚本与产物全部落在 gitignored 的 `.agent_context/tier2/`（含账号信息，绝不入库）。

<details><summary>备用的 python 探针路线（需要扫码，未采用）</summary>

探针脚本落在 gitignored 的 `.agent_context/tier2/`（不入库，产物含账号信息）：
`xhs_tier2_probe.py` + `RUNBOOK.md` + `_smoke.py`（零浏览器自检，已 PASS）。

流程：headed `launch_persistent_context`（与 `server.py` 同 `MULTI_PUBLISH_DATA_DIR`
解析口径，可 `--account-id` 复用已登录 profile）→ 扫码登录 → 发布页逐候选统计
`count/visible` → 人工「存草稿」（`--mode manual`，脚本只观察不代点）→ 捕获 note
端点 `code==0` → 草稿箱列表逐候选取证 → 落 `EVIDENCE.md` / `evidence.json` /
`network.json`。

内置守卫：只 watch 笔记提交终步，`permit` 的 `code==0` 在探针侧同样**不**算命中
（防"草稿未提交即判成功"）；`publish_button` 仅取证、脚本绝不点击，守住"只存草稿
不公开发布"的验收红线。若 `--mode drive` 命中，则说明现有回退链可用，但该模式会
真实存一条草稿，用完需人工删除。

该路线原计划用实测值替换 2.3b 的选择器占位并把 `DRAFT_SAVE_RESPONSE_PATTERNS` 升级为活体证据；
实际由上面的 tab CDP 路线拿到了同样的取证与验收（4o），扫码路线因此未执行。若日后需要复核
自动保存链路是否真的打 `note` 端点，再走这条路线补 `network.json`。

</details>
