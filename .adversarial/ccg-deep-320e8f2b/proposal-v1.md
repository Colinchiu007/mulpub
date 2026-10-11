# 变更提案（自动生成，待对抗评审）

- base: `HEAD~1`
- head: `320e8f2b18e558da376b1d884c1d3e2005f8019e`
- 采集模式: `diff`
- 变更规模: 405 行

## 变更内容

```diff
diff --git a/01-docs/PRD-XHS-DOM-RPA-HARDENING-2026-10-09.md b/01-docs/PRD-XHS-DOM-RPA-HARDENING-2026-10-09.md
index d59023c93..26cabe4c3 100644
--- a/01-docs/PRD-XHS-DOM-RPA-HARDENING-2026-10-09.md
+++ b/01-docs/PRD-XHS-DOM-RPA-HARDENING-2026-10-09.md
@@ -87,6 +87,91 @@ DRAFT_SAVE_RESPONSE_PATTERNS: list[str] = ["/web_api/sns/v2/note"]
    切到 `backend`（或 `api-then-dom`）让桌面吃到本次加固。切换前提是 2.4 活体证据到手，
    否则等于把已验证的桌面路径换成未验证路径。
 
+## 4c. 风控归一武装（文本轨，2026-10-09 追加）
+
+同一类静默失效的第二处：`RISK_OVERLAY_SELECTOR` 为空占位时
+`_risk_present()` 直接 `return False` ⇒ PR-1 能力表里"风控归一 `XHS_RISK_BLOCKED`、
+且不降级换号"这条**实际从不触发**。
+
+- 修法：`_risk_present` 改为双轨——占位选择器（仍待 2.2 活体回填）**或**
+  "浮层容器 + 容器内风控文案"。文案口径取自本仓桌面轨已实战使用的风控词表
+  （`publish-risk.js` 的 `RISK_RE`），属源证据非活体取证。
+- **双条件是刻意的**：只在 `modal/dialog/overlay/verify/captcha` 容器内匹配，
+  避免页面常驻文案（侧栏「草稿箱」「验证封面」之类）误判成风控而阻断正常发布。
+  误判风控比漏判更有害——它会直接中止用户的草稿保存。
+- 默认常量非空由测试钉死（`test_text_track_constants_arming`），与 2.3a 的
+  "默认模式非空"断言同一思路：把静默失效变成红。
+- 新增 4 项用例：风控文案 → `XHS_RISK_BLOCKED` 且不点发布；无常驻浮层不判风控；
+  浮层内良性文案不判风控；常量默认值非空。
+
+## 4d. Python 轨认证已被策略硬阻（2026-10-09 用户实跑暴露）
+
+用户按 §6 运行探针，崩溃于 `legacy_auth_policy.require_legacy_plaintext_auth()`：
+`RuntimeError: 旧 Python 明文认证持久化已停用，请使用桌面端加密账号存储`。
+
+调用链是 `XiaoHongShuPublisher._ensure_browser()` →
+`xiaohongshu_auth._restore_auth_data()`（第 1 行）→ 策略守卫。该守卫除非同时满足
+两个 `MULTI_PUBLISH_*` 迁移环境变量 **且** 非生产环境，否则无条件抛错；
+`_save_auth_data()` 与 `_restore_cookies_legacy()` 同样受此门。
+
+结论与影响口径：
+
+- **这不是探针 bug，是仓库既定策略**（Python 明文认证持久化已停用，登录态归桌面加密
+  账号存储）。我们不应为了跑取证而放宽这两个环境变量——那等于在验收脚本里绕过一条
+  安全红线。
+- 因此 §4b 的判断要再加一层：Python 轨不仅**无生产调用方**（桌面发布被 `ROUTE_TABLE`
+  派到 `rpa_vm`），在正常构建下也**无法恢复登录态**。它的 DOM 链只能通过"探针自持
+  persistent profile + headed 扫码"这种方式被验证。
+- 修法：新增 `open_probe_browser()`，直接 `launch_persistent_context` 到账号 profile
+  目录，绕开 `_ensure_browser` 的认证恢复；结束后也不调 `_save_auth_data`
+  （登录态由 profile 目录自身留存）。gitignored，不入库。
+- 验收含义：**2.4 活体验收的正面证据必须来自桌面轨**（`rpa-view-platforms.js`
+  的 `draftOnly:true` 路径 → 草稿箱可见）。Python 轨的活体取证只用于回填选择器/端点，
+  不代表用户实际使用的链路。
+
+## 4e. PR-1 引入的回归：上传控件轮询被删 ⇒ 无媒体草稿（Bug 反哺，2026-10-09）
+
+发现方式不是功能测试，而是**静态守卫变红**：`test_p4_wait_until.py` 断言
+`xiaohongshu.py` 里 `wait_until(` 出现 ≥ 2 次，PR-1 合并后只剩 1 次。
+
+**① 根因**：PR-1 把"导航后轮询上传控件可见"（`upload_input_ready = await wait_until(...)`）
+替换成一次性 `_resolve_visible(page, "upload_input")`。`_resolve_visible` 不等待，
+SPA 首屏未挂载时返回 `(None, None)`，而调用处是
+`if file_input is not None: await set_input_files(...)` —— 条件不满足就**什么都不做且不报错**。
+
+**② 逃逸链**：这条静默跳过逃过了所有测试。PR-1 的单测用 `_base_page()`（控件恒可见）
+且 `media_paths=[]`，从未构造"延迟挂载"场景；后面的 `_await_editor_ready` 轮询会让页面
+最终看起来"就绪"，于是流程继续填标题、点存草稿 —— 产出**没有媒体的草稿**。
+用户的验收口径是草稿箱里内容完整，这属于缺陷交付而非失败交付，因此连错误码都不会出现。
+
+**③ 系统性漏洞**（两条，都已处理）：
+- `packages/python-backend` 的 pytest **不在任何 CI workflow 里**（`gui-test.yml` 只跑
+  `test_video_provider_imports.py`），所以守卫变红不阻断 PR —— tasks 1.9 的
+  "全量回归通过"是在本地未复跑该文件的前提下勾掉的。
+- 守卫自身用**源码字面量**断言（`"UPLOAD_FALLBACK_WAIT_TIMEOUT_S = 30.0" in src`、
+  `"改为轮询编辑器就绪" in src`）。PR-1 把常量定义移到 `xiaohongshu_selectors.py`、
+  日志措辞也改了，于是同一个守卫又出现两处**假红**，掩盖了它抓到的真红。
+
+**④ 修复 + 回归保护**：`_await_upload_input()` 恢复条件轮询（沿用
+`NAVIGATE_READY_TIMEOUT_S`/`NAVIGATE_READY_POLL_INTERVAL_S`），且把"有媒体但控件始终不挂载"
+从静默跳过改为 `CODE_UPLOAD_FAILED` **fail-closed**（不完整的草稿不进草稿箱）；纯文本草稿
+路径不等待、不受影响。上传控件与编辑器两处轮询收敛到共用 `_await_control()`（也顺带把
+`xiaohongshu.py` 压回 499 行，不触债务熔断的 ≥500 行文件数基线）。
+新增 4 项用例：延迟挂载必须等到并真正上传、始终不挂载必须 fail-closed 且不点存草稿、
+无媒体不白等、等待常量必须真的被发布器引用。
+守卫本身也被修：`wait_until(` 出现次数改成**调用图断言**（`_await_control` 存在且被
+`await` ≥ 2 次 + 两个 label 存在），因为把两处重复轮询收敛成一个共享 helper 是改进，
+按次数断言会把它误判成回退；`UPLOAD_FALLBACK_WAIT_TIMEOUT_S = 30.0` 的字面量子串改为
+断言**生效常量值**（常量已被 PR-1 移到 selectors 模块）。
+破坏-恢复验证（两种破坏都跑过）：
+① 删掉轮询只留一次性解析 → 行为用例 `test_late_mount_...` 变红；
+② 回退成"两处各自 wait_until"的旧形状 → 守卫变红。恢复后发布轨 51 项全绿。
+
+**⑤ 防止再发**：把"一次性解析 = 静默跳过"记为本轨的反模式；`_resolve_visible` 的返回值
+在**必须发生**的动作（上传媒体、点存草稿）上不允许 `if ... is not None` 直接吞掉，
+必须显式给出失败码。本条同时说明：验收前必须在本地实跑
+`cd packages/python-backend && pytest`，不能依赖 CI 兜底。
+
 ## 5. 剩余工作（必须完成才算验收）
 
 | 项 | 状态 | 阻塞 |
diff --git a/openspec/changes/rpa-xiaohongshu-dom-hardening/tasks.md b/openspec/changes/rpa-xiaohongshu-dom-hardening/tasks.md
index da57b0c8b..bef85d753 100644
--- a/openspec/changes/rpa-xiaohongshu-dom-hardening/tasks.md
+++ b/openspec/changes/rpa-xiaohongshu-dom-hardening/tasks.md
@@ -8,8 +8,10 @@
 - [x] 1.6 标签逐个 type + 选下拉，替换覆盖式 fill（红→绿：多标签全保留）
 - [x] 1.7 错误归一 login_expired / risk_blocked / transient（对齐 outcomeOfResult，risk/login 不降级不换号）（红→绿）
 - [x] 1.8 确认才成功骨架：ResponseMonitor.watch_patterns(<草稿端点占位>) + 草稿箱回查兜底；无确认→failure，删除盲 sleep success + 假 url（红→绿）
-- [x] 1.9 全量回归 `cd packages/python-backend && pytest`（含既有 test_new_publishers/test_douyin 不破）
+- [x] 1.9 全量回归 `cd packages/python-backend && pytest`（含既有 test_new_publishers/test_douyin 不破）— **此项原判定不成立**：`test_p4_wait_until.py` 的静态守卫在 PR-1 合并后即为红，而 python-backend pytest 不在任何 CI workflow（`gui-test.yml` 只跑 `test_video_provider_imports.py`），故未阻断；1.12 修复后重跑全量 = 2762 passed / 3 failed，3 项（`test_frame_html`、`test_llm_service`、`test_pipeline_loader`）与 `test_aggregation_video` 均属本分支未触碰的既有/环境依赖失败（`git diff origin/main --name-only` 验证），发布轨 0 失败
 - [x] 1.10 代码审查（对照 AGENTS.md 阶段 6：require 路径/错误处理/无外部端点）+ commit + PR + CI + autoMerge（已完成：PR #2885 squash 合并 e413cbc7，CI 全绿含 Gate 12/债务熔断/lint）
+- [x] 1.11 补 1.7 的静默失效：`RISK_OVERLAY_SELECTOR` 空占位使 risk 归一从不触发 ⇒ `_risk_present` 加"浮层容器 + 容器内风控文案"双条件文本轨（口径取本仓 `publish-risk.js` RISK_RE，源证据），默认常量非空由测试钉死；新增 4 项用例（红→绿）
+- [x] 1.12 修 PR-1 引入的回归（静态守卫抓出）：上传控件的一次性 `_resolve_visible` 在 SPA 晚挂载下**静默跳过媒体**并照样存草稿 ⇒ 产出无媒体草稿。`_await_upload_input()` 恢复条件轮询并把"有媒体却等不到控件"改为 `CODE_UPLOAD_FAILED` fail-closed；两处轮询收敛到共用 `_await_control()`（`xiaohongshu.py` 保持 499 行，不触 ≥500 行债务熔断基线）；新增 4 项用例（延迟挂载必须等到并上传、等不到必须 fail-closed 且不点草稿、无媒体不白等、常量必须被发布器引用）；守卫 `test_p4_wait_until` 由"字面量/次数"改为调用图 + 生效常量值断言（旧断言在 PR-1 把常量移入 selectors 模块后产生两处假红）；两种破坏（删轮询 / 拆掉共用 helper）均验证变红，恢复后发布轨 51 项全绿
 
 ## 2. PR-2 · Tier2 活体取证回填（需用户登录小红书）
 
diff --git a/packages/python-backend/src/multi_publish/publishers/xiaohongshu.py b/packages/python-backend/src/multi_publish/publishers/xiaohongshu.py
index 9aeba0d21..61fd500da 100644
--- a/packages/python-backend/src/multi_publish/publishers/xiaohongshu.py
+++ b/packages/python-backend/src/multi_publish/publishers/xiaohongshu.py
@@ -18,6 +18,7 @@ from __future__ import annotations
 
 import asyncio
 import os
+import re
 
 from loguru import logger
 
@@ -37,7 +38,11 @@ from multi_publish.publishers.xiaohongshu_selectors import (
     DRAFT_BOX_ITEM_SELECTOR,
     DRAFT_BOX_URL,
     DRAFT_SAVE_RESPONSE_PATTERNS,
+    NAVIGATE_READY_POLL_INTERVAL_S,
+    NAVIGATE_READY_TIMEOUT_S,
     RISK_OVERLAY_SELECTOR,
+    RISK_TEXT_HOSTS,
+    RISK_TEXT_PATTERN,
     SELECTOR_FALLBACKS,
     UPLOAD_FALLBACK_POLL_INTERVAL_S,
     UPLOAD_FALLBACK_WAIT_TIMEOUT_S,
@@ -216,10 +221,17 @@ class XiaoHongShuPublisher(BasePublisher, XiaohongshuAuthMixin):
 
         await self._report_progress(PublishPhase.UPLOADING, "上传媒体文件...", 30)
         if media_paths:
+            file_input = await self._await_upload_input(page)
+            if file_input is None:
+                return PublishResult(
+                    success=False, platform="xiaohongshu",
+                    error=_coded(
+                        CODE_UPLOAD_FAILED,
+                        f"上传控件在 {NAVIGATE_READY_TIMEOUT_S}s 内未挂载，已停止而非静默跳过媒体",
+                    ),
+                )
             try:
-                file_input, _ = await self._resolve_visible(page, "upload_input")
-                if file_input is not None:
-                    await file_input.set_input_files(media_paths)
+                await file_input.set_input_files(media_paths)
             except Exception as e:
                 return PublishResult(
                     success=False, platform="xiaohongshu",
@@ -416,29 +428,55 @@ class XiaoHongShuPublisher(BasePublisher, XiaohongshuAuthMixin):
         except Exception as e:
             logger.warning(f"封面上传失败（不影响发布）: {e}")
 
-    async def _await_editor_ready(self, page) -> None:
-        """上传完成标志未命中时，轮询编辑器就绪（标题框可见），上限沿用原 30s。"""
-        ready = await wait_until(
-            lambda: self._title_visible(page),
-            timeout_s=UPLOAD_FALLBACK_WAIT_TIMEOUT_S,
-            interval_s=UPLOAD_FALLBACK_POLL_INTERVAL_S,
+    async def _await_control(self, page, key: str, *, label: str, timeout_s: float, interval_s: float):
+        """轮询候选链中首个可见控件，返回 locator 或 None；超时留痕但不臆断失败。"""
+        async def visible() -> bool:
+            loc, _ = await self._resolve_visible(page, key)
+            return loc is not None
+
+        if not await wait_until(visible, timeout_s=timeout_s, interval_s=interval_s):
+            logger.warning(f"{label}在 {timeout_s}s 内未就绪（站点结构变化或首屏未完成）")
+            return None
+        loc, _ = await self._resolve_visible(page, key)
+        return loc
+
+    async def _await_upload_input(self, page):
+        """上传控件必须真等：一次性解析在 SPA 晚挂载下返回 None，会静默跳过媒体照存草稿。"""
+        return await self._await_control(
+            page, "upload_input", label="上传控件",
+            timeout_s=NAVIGATE_READY_TIMEOUT_S, interval_s=NAVIGATE_READY_POLL_INTERVAL_S,
         )
-        if not ready:
-            logger.warning(
-                f"编辑器在 {UPLOAD_FALLBACK_WAIT_TIMEOUT_S}s 内未就绪（站点结构变化或上传未完成），继续尝试填写"
-            )
 
-    async def _title_visible(self, page) -> bool:
-        loc, _ = await self._resolve_visible(page, "title_input")
-        return loc is not None
+    async def _await_editor_ready(self, page) -> None:
+        await self._await_control(
+            page, "title_input", label="编辑器",
+            timeout_s=UPLOAD_FALLBACK_WAIT_TIMEOUT_S, interval_s=UPLOAD_FALLBACK_POLL_INTERVAL_S,
+        )
 
     async def _risk_present(self, page) -> bool:
-        if not RISK_OVERLAY_SELECTOR:
-            return False
-        try:
-            return await page.locator(RISK_OVERLAY_SELECTOR).count() > 0
-        except Exception:
-            return False
+        """风控判定双轨：占位选择器（Tier2 待回填）+ 浮层内文案（本仓已实战口径）。
+
+        占位选择器为空时文本轨仍生效——否则 PR-1 声称的 risk_blocked 归一恒不触发。
+        双条件是刻意的：只有浮层/弹窗/验证容器内的风控文案才算，避免页面常驻文案误判。
+        """
+        if RISK_OVERLAY_SELECTOR:
+            try:
+                if await page.locator(RISK_OVERLAY_SELECTOR).count() > 0:
+                    return True
+            except Exception:
+                pass
+        for host in RISK_TEXT_HOSTS:
+            try:
+                loc = page.locator(host)
+                if not await loc.count():
+                    continue
+                text = await loc.first.inner_text() or ""
+            except Exception:
+                continue
+            if re.search(RISK_TEXT_PATTERN, text, re.I):
+                logger.warning(f"[小红书] 浮层文案命中风控口径: {text[:60]!r}")  # noqa: E501
+                return True
+        return False
 
     @staticmethod
     def _is_login_redirect(url: str) -> bool:
diff --git a/packages/python-backend/src/multi_publish/publishers/xiaohongshu_selectors.py b/packages/python-backend/src/multi_publish/publishers/xiaohongshu_selectors.py
index f41bc8aee..3f6a720a9 100644
--- a/packages/python-backend/src/multi_publish/publishers/xiaohongshu_selectors.py
+++ b/packages/python-backend/src/multi_publish/publishers/xiaohongshu_selectors.py
@@ -73,6 +73,22 @@ DRAFT_BOX_ITEM_SELECTOR = '[class*="draft"] [class*="title"]'
 # 风控/验证弹层选择器（Tier2 取证回填），命中即判 risk_blocked 并停止。
 RISK_OVERLAY_SELECTOR = ""
 
+# 风控文本轨（与上面的占位选择器并行）：占位为空时 `if not RISK_OVERLAY_SELECTOR`
+# 会让 risk 归一恒假——即 PR-1 声称交付的 risk_blocked 实际从不触发。本轨用"浮层容器
+# + 浮层内文案"双条件判定，文案口径取自本仓桌面轨已实战使用的风控词表
+# （apps/desktop/electron/services/publish-risk.js 的 RISK_RE），属源证据非活体取证。
+# 只在浮层/弹窗/验证容器内匹配，避免页面常驻文案（如侧栏「草稿箱」「验证封面」）误判。
+RISK_TEXT_HOSTS: list[str] = [
+    '[class*="modal"]',
+    '[class*="dialog"]',
+    '[class*="overlay"]',
+    '[class*="verify"]',
+    '[class*="captcha"]',
+]
+RISK_TEXT_PATTERN = (
+    r"安全验证|请完成验证|拖动滑块|滑块|验证码|操作频繁|账号存在风险|风控|risk control"
+)
+
 CREATOR_URL = "https://creator.xiaohongshu.com/"
 
 # 机器可读错误码前缀，便于上层 outcomeOfResult 归一（risk/login 绝不降级换号）。
diff --git a/packages/python-backend/tests/test_p4_wait_until.py b/packages/python-backend/tests/test_p4_wait_until.py
index efa99c836..5d069db36 100644
--- a/packages/python-backend/tests/test_p4_wait_until.py
+++ b/packages/python-backend/tests/test_p4_wait_until.py
@@ -84,8 +84,19 @@ def test_xiaohongshu_publisher_no_longer_blind_sleeps():
     src = io.open(os.path.join(PUBLISHERS_DIR, "xiaohongshu.py"), encoding="utf-8").read()
     assert "await asyncio.sleep(30)" not in src, "上传兜底仍是无条件 sleep(30)"
     assert "await asyncio.sleep(3)" not in src, "导航后仍是无条件 sleep(3)"
-    assert src.count("wait_until(") >= 2
-    # 上限沿用原时长，只收紧快路径，不放宽容忍度
-    assert "UPLOAD_FALLBACK_WAIT_TIMEOUT_S = 30.0" in src
-    # 超时必须有原因留痕
-    assert "改为轮询编辑器就绪" in src and "编辑器在" in src
+    # 两处控件必须各自真等：上传控件 + 编辑器（标题框）。少一处就会退化成静默跳过媒体。
+    # 断言调用图而非 `wait_until(` 出现次数：两处轮询共用一个 _await_control 是改进，
+    # 按次数断言会把这种收敛误判成回退。
+    assert "wait_until(" in src, "小红书发布器回退为脆弱等待"
+    assert src.count("await self._await_control(") >= 2, "上传控件与编辑器就绪各自须有一处轮询调用"
+    for helper in ("_await_upload_input", "_await_editor_ready", "_await_control"):
+        assert f"async def {helper}(" in src, f"就绪轮询 {helper} 被删除"
+    # 上限沿用原时长，只收紧快路径，不放宽容忍度。
+    # 断言生效值而非常量子串：常量定义已由 xiaohongshu.py 移到 xiaohongshu_selectors.py，
+    # 依赖文件内字面量会让守卫在纯重构后假红（值对、位置变）。
+    from multi_publish.publishers import xiaohongshu as xhs
+
+    assert xhs.UPLOAD_FALLBACK_WAIT_TIMEOUT_S == 30.0
+    assert xhs.NAVIGATE_READY_TIMEOUT_S == 10.0
+    # 超时必须有原因留痕：等待对象（label）与"未就绪"必须出现在源码里
+    assert 'label="编辑器"' in src and 'label="上传控件"' in src and "未就绪" in src
diff --git a/packages/python-backend/tests/test_xiaohongshu_dom_hardening.py b/packages/python-backend/tests/test_xiaohongshu_dom_hardening.py
index 0d28b5421..24fc4fc31 100644
--- a/packages/python-backend/tests/test_xiaohongshu_dom_hardening.py
+++ b/packages/python-backend/tests/test_xiaohongshu_dom_hardening.py
@@ -28,6 +28,9 @@ class FakeLocator:
         return self
 
     async def is_visible(self):
+        if self._sel in self._page.visible_after:
+            self._page.queries[self._sel] = self._page.queries.get(self._sel, 0) + 1
+            return self._page.queries[self._sel] > self._page.visible_after[self._sel]
         return self._sel in self._page.visible
 
     async def count(self):
@@ -66,6 +69,9 @@ class FakeLocator:
 class FakePage:
     def __init__(self):
         self.visible: set[str] = set()
+        # 延迟挂载：selector -> 需要前 N 次可见性查询返回 False（模拟 SPA 控件晚到）
+        self.visible_after: dict[str, int] = {}
+        self.queries: dict[str, int] = {}
         self.counts: dict[str, int] = {}
         self.not_fillable: set[str] = set()
         self.item_texts: dict[str, list[str]] = {}
@@ -315,3 +321,91 @@ class TestTier2EndpointArming:
         result = await _flow(publisher, page, monitor, draft=True)
         assert result.success is False
         assert xhs.CODE_UNCONFIRMED in (result.error or "")
+
+
+class TestRiskTextTrack:
+    """风控文本轨：占位选择器为空时，risk 归一不得静默失效（与端点空占位同一类缺陷）。"""
+
+    @pytest.mark.asyncio
+    async def test_modal_with_risk_wording_maps_risk_blocked(self, publisher):
+        page = _base_page()
+        host = xhs.RISK_TEXT_HOSTS[0]
+        page.visible.add(host)
+        page.item_texts[host] = ["请完成安全验证，拖动滑块完成下方拼图"]
+        result = await _flow(publisher, page, FakeMonitor(), draft=True)
+        assert result.success is False
+        assert xhs.CODE_RISK_BLOCKED in (result.error or "")
+        assert PUBLISH_SEL not in page.clicked  # 风控下不得继续动作
+
+    @pytest.mark.asyncio
+    async def test_risk_wording_without_overlay_host_is_not_risk(self, publisher):
+        # 无常驻浮层时，标题/正文里出现「验证」二字不得误判风控
+        page = _base_page()
+        result = await _flow(publisher, page, FakeMonitor(), draft=True)
+        assert xhs.CODE_RISK_BLOCKED not in (result.error or "")
+
+    @pytest.mark.asyncio
+    async def test_benign_modal_text_is_not_risk(self, publisher):
+        page = _base_page()
+        host = xhs.RISK_TEXT_HOSTS[0]
+        page.visible.add(host)
+        page.item_texts[host] = ["笔记标题", "草稿箱", "封面"]
+        assert await publisher._risk_present(page) is False
+
+    def test_text_track_constants_arming(self):
+        # 默认值必须非空：否则本轨与 2.3a 的空占位同样恒假
+        assert xhs.RISK_TEXT_HOSTS
+        assert xhs.RISK_TEXT_PATTERN
+
+
+class TestUploadReadinessPoll:
+    """PR-1 回归保护：上传控件晚挂载时绝不静默跳过媒体。
+
+    静态守卫 test_p4_wait_until 要求 xiaohongshu.py 里保留两处条件等待
+    （上传控件 + 编辑器），PR-1 把上传控件那一处换成了一次性 `_resolve_visible`，
+    守卫变红——而它是对的：SPA 下首屏没挂载就解析 ⇒ file_input 为 None ⇒
+    `if file_input is not None` 静默不传图，随后照样填标题存草稿，
+    产出的是"无媒体草稿"。用户验收口径是草稿箱里内容完整，这属于缺陷交付。
+    """
+
+    @pytest.mark.asyncio
+    async def test_late_mount_upload_input_is_awaited_then_used(self, publisher, monkeypatch):
+        monkeypatch.setattr(xhs, "NAVIGATE_READY_TIMEOUT_S", 2.0, raising=False)
+        monkeypatch.setattr(xhs, "NAVIGATE_READY_POLL_INTERVAL_S", 0.01, raising=False)
+        sel = publisher._candidates_for("upload_input")[0]
+        page = _base_page()
+        page.visible_after[sel] = 2  # 前两次查询不可见，第三次起可见
+        page.visible.add(DRAFT_SEL)
+        result = await _flow(publisher, page, FakeMonitor(), media_paths=["a.jpg"])
+        assert page.uploaded == [["a.jpg"]], f"延迟挂载的上传控件未被等待，媒体被静默跳过: {result.error}"
+
+    @pytest.mark.asyncio
+    async def test_media_requested_but_upload_input_never_appears_fails_closed(
+        self, publisher, monkeypatch
+    ):
+        monkeypatch.setattr(xhs, "NAVIGATE_READY_TIMEOUT_S", 0.05, raising=False)
+        monkeypatch.setattr(xhs, "NAVIGATE_READY_POLL_INTERVAL_S", 0.01, raising=False)
+        page = _base_page()
+        page.visible.add(DRAFT_SEL)
+        result = await _flow(publisher, page, FakeMonitor(), media_paths=["a.jpg"])
+        assert result.success is False
+        assert xhs.CODE_UPLOAD_FAILED in (result.error or "")
+        assert page.uploaded == []
+        # 红线：传不上图就不该继续把空媒体草稿存进草稿箱
+        assert DRAFT_SEL not in page.clicked
+
+    @pytest.mark.asyncio
+    async def test_text_only_draft_skips_upload_wait(self, publisher, monkeypatch):
+        # 无媒体时不该为上传控件白等（纯图文/正文草稿仍是合法路径）
+        monkeypatch.setattr(xhs, "NAVIGATE_READY_TIMEOUT_S", 30.0, raising=False)
+        monkeypatch.setattr(xhs, "NAVIGATE_READY_POLL_INTERVAL_S", 0.01, raising=False)
+        page = _base_page()
+        page.visible.add(DRAFT_SEL)
+        result = await _flow(publisher, page, FakeMonitor(), media_paths=[])
+        assert page.uploaded == []
+        assert xhs.CODE_UPLOAD_FAILED not in (result.error or "")
+
+    def test_upload_poll_constant_is_imported_in_publisher(self):
+        # 静默失效守卫：等待时长常量必须真的被发布器引用，而不是只存在于选择器表里
+        assert hasattr(xhs, "NAVIGATE_READY_TIMEOUT_S")
+        assert hasattr(xhs, "NAVIGATE_READY_POLL_INTERVAL_S")

```

> 这是机械生成的变更提案，不代表任何设计意图。评审方请只针对上述内容挑刺。