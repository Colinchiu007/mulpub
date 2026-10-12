# 变更提案（自动生成，待对抗评审）

- base: `origin/main`
- head: `dcfc3558e`
- 采集模式: `diff`
- 变更规模: 414 行

## 变更内容

```diff
diff --git a/01-docs/PRD-XHS-DRAFT-PUBLISH-2026-10-07.md b/01-docs/PRD-XHS-DRAFT-PUBLISH-2026-10-07.md
index b287f29ef..3531607b1 100644
--- a/01-docs/PRD-XHS-DRAFT-PUBLISH-2026-10-07.md
+++ b/01-docs/PRD-XHS-DRAFT-PUBLISH-2026-10-07.md
@@ -296,3 +296,27 @@ X-s / X-t / X-S-Common: 页内签名产物（bridge 注入，参考产品A由签
 **情报总结**：XYS_（mns0301 档）是现役网页端签名；XYW_（AES-128-CBC）是数据接口绕 406 的替代档；
 两者常量与我们 signer-local 一致。**发布类接口额外需要 x-rap-param**（基于 URI+body 的 MurmurHash），
 note 全链闭环后的候选增强项。
+
+## 15. 登录载体改造：二段式补跳主站（#3309）
+
+**决策**：登录 URL 不改（保持 creator 域，用户体验一致），登录成功后**自动补跳主站**二段式——比直接换主站登录少改 UX。
+
+- **机制**：登录窗检测到登录成功（CDP/URL 判定）后、抓凭据快照之前，若平台配置了
+  `PLATFORM_POST_LOGIN_REDIRECT`（packages/shared-utils/src/platform-definitions.js），
+  登录窗自动 loadURL 该地址（xiaohongshu = `https://www.xiaohongshu.com/`）。
+  creator 父域 Cookie 随请求带上，主站识别已登录态后种下 web_session，随后抓快照——
+  凭据从此含完整主站会话，note 提交能过会话鉴权层（-100 根因闭合）。
+- **就绪判据**：loadURL 的 Promise resolve（did-finish-load 等价）——主站响应已在
+  .xiaohongshu.com 父域种下会话 Cookie，不依赖页面 DOM 特征（主站首页结构多变）。
+- **15s 兜底**：主站因网络/风控迟迟未就绪时按当前快照继续 settle，不阻断登录流程
+  （auth-view-manager `POST_LOGIN_REDIRECT_WAIT_MS = 15000`）。兜底路径抓到的快照仍缺
+  web_session，属可接受的降级；下次登录或本轮真机验证可再取证。
+- **零回归**：未配置 redirect 的平台（其余 14 个）保持原行为（登录完成直接抓快照），
+  行为锁 C3c 把关。
+- **回归保护**：`apps/desktop/electron/tests/xhs-mainsite-login.test.js` 六条契约——
+  C1 登录 URL 不变 / C2 redirect 表导出 / C3a 结构锁（manager 接线表与常量，刻意不锁
+  www 字面量防反向耦合）/ C3b 补跳时机（主站就绪前不 settle）/ C3c 零回归 / C4 兜底。
+  TDD 红灯先行，实现后 6/6 绿；相关既有测试 120/120 绿。
+- **真机验证**：PENDING——重新登录抓全量 cookie（应含 web_session）→ probe 重测 note
+  → 草稿落箱。结论随下一轮补录本节。
+
diff --git a/apps/desktop/electron/services/auth-view-manager.js b/apps/desktop/electron/services/auth-view-manager.js
index 8dbf8f9e4..d464c9c61 100644
--- a/apps/desktop/electron/services/auth-view-manager.js
+++ b/apps/desktop/electron/services/auth-view-manager.js
@@ -13,6 +13,8 @@ const path = require('path')
 const log = require('./logger')
 const {
   PLATFORM_LOGIN_URLS,
+  PLATFORM_POST_LOGIN_REDIRECT,
+  PLATFORM_POST_LOGIN_PROOF_COOKIES,
   hasPlatformSessionCookie,
   hasPlatformSessionCookieMarkers,
   sessionCookieNames,
@@ -101,6 +103,32 @@ function hasCapturedCredentials(authData, platform) {
   return hasCredentials
 }
 
+// 二段式登录（主站会话补抓）：补跳主站后等待其就绪的兜底窗口。
+// 主站可能因网络/风控迟迟不跳转，超时后按当前快照继续，不阻断登录流程。
+// 「就绪」= loadURL 的 Promise resolve（did-finish-load 等价）：主站响应已在
+// .xiaohongshu.com 父域种下会话 Cookie（web_session 等），无需依赖页面 DOM 特征。
+const POST_LOGIN_REDIRECT_WAIT_MS = 15000
+
+/**
+ * 凭据快照里是否已有指定平台二段式补跳的凭证 Cookie（如 xiaohongshu 的 web_session）。
+ * CCG 评审 i2：快照已含凭证时不必再补跳一次主站（省一次整页往返）；短路径
+ * cookies.get 失败按「没有凭证」处理，走补跳（fail-open 到主流程，不阻断登录）。
+ * @param {import('electron').WebContentsView} view
+ * @param {string} platform
+ * @returns {Promise<boolean>}
+ */
+async function hasPostLoginProofCookie (view, platform) {
+  const proofNames = PLATFORM_POST_LOGIN_PROOF_COOKIES[platform]
+  if (!Array.isArray(proofNames) || proofNames.length === 0) return false
+  try {
+    const cookies = await view.webContents.session.cookies.get({})
+    return cookies.some(cookie => cookie && proofNames.includes(cookie.name) &&
+      typeof cookie.value === 'string' && cookie.value.trim().length > 0)
+  } catch (_e) {
+    return false
+  }
+}
+
 class AuthViewManager {
   constructor() {
     /** @type {import('electron').BrowserWindow | null} */
@@ -296,6 +324,45 @@ class AuthViewManager {
     const timer = setTimeout(async () => {
       try {
         if (!this._isCurrentLoginAttempt(attempt)) return
+        // 二段式（主站会话补抓）：登录页域与发布 API 会话域不同（小红书 creator vs
+        // www 主站）时，凭据快照此刻还缺主站 web_session（edith note code -100 根因）。
+        // 先补跳主站，creator 父域 Cookie 随请求带上、主站种下会话，再抓快照。
+        // 未配置 redirect 的平台保持原行为：直接抓取，零回归。
+        const redirectUrl = /** @type {Record<string, string>} */ (PLATFORM_POST_LOGIN_REDIRECT)[attempt.platform]
+        if (redirectUrl && !(await hasPostLoginProofCookie(attempt.view, attempt.platform))) {
+          log.info('AuthView', `post-login redirect to main site: ${attempt.platform} ${redirectUrl}`)
+          // 就绪 = loadURL resolve（did-finish-load 等价，主站响应已种下会话 Cookie）；
+          // 15s 兜底：主站迟迟未就绪时按当前快照继续，不阻断登录。
+          // 兜底命中时 stop 掉在途导航（CCG 评审 i6）：否则主站导航可能在快照抓取
+          // 期间才落地，页面导航状态与抓取时序竞争，影响快照确定性。
+          let redirectTimedOut = false
+          const redirectTimeout = setTimeout(() => {
+            redirectTimedOut = true
+            try { attempt.view.webContents.stop() } catch (_e) { /* 视图可能已销毁 */ }
+            // 触发 race 的超时分支 resolve（回调此刻 redirectTimeout 已赋值）
+            if (typeof redirectTimeout.callback === 'function') redirectTimeout.callback()
+          }, POST_LOGIN_REDIRECT_WAIT_MS)
+          if (redirectTimeout && redirectTimeout.unref) redirectTimeout.unref()
+          try {
+            await Promise.race([
+              attempt.view.webContents.loadURL(redirectUrl).catch(e => {
+                log.warn('AuthView', `post-login redirect load failed: ${e instanceof Error ? e.message : String(e)}`)
+              }),
+              new Promise(resolve => { redirectTimeout.callback = () => resolve() }),
+            ])
+          } finally {
+            clearTimeout(redirectTimeout)
+          }
+          if (!this._isCurrentLoginAttempt(attempt)) return
+          // 凭证校验（CCG 评审 i1）：loadURL resolve / 超时都不保证主站真种下了
+          // web_session（可能整页加载后才由 JS/XHR 种，或未识别登录态跳去登录页）。
+          // 缺失时留独立失败标记日志（不阻断），让「二段式是否真生效」可观测。
+          if (!(await hasPostLoginProofCookie(attempt.view, attempt.platform))) {
+            log.warn('AuthView', `post-login redirect proof cookie missing: ${attempt.platform} ` +
+              `proof=${(PLATFORM_POST_LOGIN_PROOF_COOKIES[attempt.platform] || []).join(',')} ` +
+              `timedOut=${redirectTimedOut} snapshotWillMissMainSiteSession=true`)
+          }
+        }
         const authData = await this._extractAuthData(attempt.view, attempt.platform)
         if (!hasCapturedCredentials(authData, attempt.platform)) {
           // 静默跳过会让「为什么没自动完成」无从排查，这里必须留下判定依据。
diff --git a/apps/desktop/electron/tests/xhs-mainsite-login.test.js b/apps/desktop/electron/tests/xhs-mainsite-login.test.js
new file mode 100644
index 000000000..d349c1930
--- /dev/null
+++ b/apps/desktop/electron/tests/xhs-mainsite-login.test.js
@@ -0,0 +1,211 @@
+// @ts-check
+/**
+ * 小红书二段式登录（主站会话补抓）契约测试——TDD 红灯先行。
+ *
+ * 背景（xhs-note-align 执行记录遗留）：edith note API 需要主站 web_session cookie，
+ * 而登录窗 URL 是 creator.xiaohongshu.com——用户在该页登录后 web_session 从未被设置，
+ * 凭据快照里永远缺它（-100 无登录信息的根因）。
+ *
+ * 方案：登录窗检测到 creator 域登录成功后，**自动补跳主站** www.xiaohongshu.com（带凭据
+ * 请求主站会话），等主站完成跳转再抓凭据快照。
+ *
+ * 契约（auth-view-manager）：
+ *  C1 PLATFORM_LOGIN_URLS.xiaohongshu 不变（仍 creator 域，登录体验一致）
+ *  C2 新增 PLATFORM_POST_LOGIN_REDIRECT.xiaohongshu = 'https://www.xiaohongshu.com/'
+ *     —— 登录成功后登录窗应 loadURL 该地址再等待抓取
+ *  C3 二段式只对配置了 redirect 的平台生效；未配置平台零回归（仍直接抓取）
+ *  C4 主站抓取超时兜底：redirect 后 15s 内未就绪则按现有快照继续（不阻断登录）
+ *
+ * 结构锁 + 行为锁并存：manager 源码级字符串锁防「忘了接线」，行为锁（makeStubs +
+ * runAutoCompletion）锁真实控制流——redirect 只对配置平台触发、超时兜底不阻断。
+ */
+import { describe, it, expect, vi } from 'vitest'
+import path from 'node:path'
+import { readFileSync } from 'node:fs'
+
+const defs = require('@multi-publish/shared-utils/src/platform-definitions')
+// 用 __dirname 解析：readFileSync 相对路径是相对 cwd（apps/desktop）的，直接写仓库根相对路径会拼出双重路径
+const managerSrc = readFileSync(
+  path.resolve(__dirname, '../services/auth-view-manager.js'), 'utf8')
+
+// ─── 行为锁公共设施 ───────────────────────────────
+// AuthViewManager 构造函数无副作用（只置空字段），但 require 本体时会连带 require
+// electron / logger / auth-view-session 等主进程模块。vitest deps.inline 含 electron，
+// 主进程 require 链在测试环境可加载（既有 account-manager 等测试同款做法）。
+const AuthViewManager = require('../services/auth-view-manager')
+
+const XHS = 'xiaohongshu'
+const ZHIHU = 'zhihu' // 未配置 redirect 的对照平台
+
+/**
+ * 构造一个只桩掉二段式会碰到的成员的 manager 实例。
+ *
+ * CCG 评审 i5：改走真实构造函数（constructor 只置空字段，无副作用），
+ * 不再 Object.create(prototype) 手工补 20 个实例字段——字段更名/构造逻辑变更
+ * 时测试静默漂移的风险消掉，桩面收敛到「二段式真正碰到的成员」。
+ *
+ * CCG 评审 i4：_extractAuthData 不再无条件返回含 web_session 的快照——它按
+ * session.cookies.get 桩的返回实时投影，二段式是否真把主站会话补进快照，
+ * 由用例对快照 cookies 断言（锁结果而非锁调用）。
+ *
+ * @param {{ redirect?: boolean, loadURL?: (url: string) => Promise<void>,
+ *           sessionCookies?: Array<{name: string, value?: string, domain?: string}> }} opts
+ */
+function makeManager (opts = {}) {
+  const inst = new AuthViewManager()
+  // 会话 cookie 桩：补跳前后可变（用例里往里 push web_session 模拟主站种 cookie）
+  const sessionCookies = opts.sessionCookies || [
+    // creator 会话标记（登录页本身产出，标记名取自 PLATFORM_SESSION_COOKIE_MARKERS）
+    { name: 'access-token-creator.xiaohongshu.com', value: 'x', domain: '.xiaohongshu.com' },
+  ]
+  inst.mainWindow = null
+  inst.currentView = {
+    webContents: {
+      loadURL: opts.loadURL || vi.fn(async () => {}),
+      // CCG 评审 i6 的 stop() 落点：真实 WebContents 恒有该方法
+      stop: vi.fn(),
+      session: { cookies: { get: async () => sessionCookies.slice() } },
+    },
+  }
+  inst.currentPlatform = opts.redirect === false ? ZHIHU : XHS
+  inst.currentAccountId = 'auth-test'
+  // _createLoginAttempt 要求三者齐备（view/platform/resolveLogin），resolveLogin 缺席会返回 null
+  inst._resolveLogin = vi.fn()
+  inst._rejectLogin = vi.fn()
+  inst._extractAuthData = vi.fn(async (view) => ({
+    // 实时投影会话 cookie 桩：快照内容 = 会话状态，用例可断言 web_session 是否补进快照
+    cookies: sessionCookies.slice(),
+    name: 't', localStorage: {}, indexedDB: {}, accountInfo: {},
+  }))
+  inst.close = vi.fn()
+  inst.__sessionCookies = sessionCookies
+  return inst
+}
+
+/**
+ * 走一遍 CDP 自动完成路径（_scheduleAutoCompletion 的 3s 定时器回调）。
+ * 用 fake timers 在各用例内推进时钟；这里只负责造 attempt。
+ * @param {ReturnType<typeof makeManager>} inst
+ */
+function makeAttempt (inst) {
+  const attempt = inst._createLoginAttempt()
+  attempt.initialRedirectPhase = false
+  return attempt
+}
+
+describe('小红书二段式登录（主站会话补抓）', () => {
+  it('C2 平台定义导出 PLATFORM_POST_LOGIN_REDIRECT.xiaohongshu = www 主站', () => {
+    expect(defs.PLATFORM_POST_LOGIN_REDIRECT).toBeDefined()
+    expect(defs.PLATFORM_POST_LOGIN_REDIRECT.xiaohongshu).toBe('https://www.xiaohongshu.com/')
+  })
+
+  it('C1 登录 URL 表不变（creator 域，用户登录体验一致）', () => {
+    expect(defs.PLATFORM_LOGIN_URLS.xiaohongshu).toBe('https://creator.xiaohongshu.com/')
+  })
+
+  it('C3a 结构锁：auth-view-manager 引用 redirect 表与 15s 兜底常量', () => {
+    // 结构锁：manager 源码里接线了 POST_LOGIN_REDIRECT 与超时兜底。
+    // 不锁 www.xiaohongshu.com 字面量——URL 该来自查表（PLATFORM_POST_LOGIN_REDIRECT），
+    // 字面量耦合会逼「改表值必须同步改 manager」的反向维护。
+    expect(managerSrc).toContain('PLATFORM_POST_LOGIN_REDIRECT')
+    expect(managerSrc).toMatch(/POST_LOGIN_REDIRECT_WAIT_MS/)
+  })
+
+  it('C3b 行为锁：配置了 redirect 的平台登录完成前会 loadURL 主站，快照在主站会话落地后才产出', async () => {
+    // loadURL 返回可控 deferred：resolve 即模拟主站就绪（did-finish-load 等价）。
+    // resolve 的同时往会话桩 push web_session——模拟「主站响应种下会话 Cookie」，
+    // CCG 评审 i4：断言快照**包含 web_session**（锁结果），而非只锁调用了 loadURL。
+    let mainSiteReady
+    const loadURL = vi.fn(() => new Promise(resolve => { mainSiteReady = () => resolve() }))
+    vi.useFakeTimers()
+    try {
+      const inst = makeManager({ redirect: true, loadURL })
+      const attempt = makeAttempt(inst)
+      inst._scheduleAutoCompletion('cdp', attempt)
+      // 3s 自动完成定时器触发：应立即补跳主站
+      await vi.advanceTimersByTimeAsync(3100)
+      expect(loadURL).toHaveBeenCalledWith(defs.PLATFORM_POST_LOGIN_REDIRECT[XHS])
+      // 主站未就绪时不能先 settle（否则抓到的还是缺 web_session 的 creator 快照）
+      expect(inst._activeLoginAttempt).not.toBeNull()
+      expect(inst._extractAuthData).not.toHaveBeenCalled()
+      // 主站就绪：种下 web_session（会话桩增量）→ loadURL resolve → settle
+      mainSiteReady()
+      inst.__sessionCookies.push({ name: 'web_session', value: 'y', domain: '.xiaohongshu.com' })
+      await vi.advanceTimersByTimeAsync(0)
+      expect(inst._activeLoginAttempt).toBeNull()
+      expect(inst._extractAuthData).toHaveBeenCalledTimes(1)
+      expect(inst.close).toHaveBeenCalled()
+      // 快照结果锁：主站会话必须真的进了凭据快照（否则 -100 根因没闭合）
+      const snapshot = inst._extractAuthData.mock.results[0].value
+      const names = (await snapshot).cookies.map(c => c.name)
+      expect(names).toContain('web_session')
+    } finally {
+      vi.useRealTimers()
+    }
+  })
+
+  it('C3c 行为锁：未配置 redirect 的平台零回归（直接抓取，不 loadURL）', async () => {
+    vi.useFakeTimers()
+    try {
+      const inst = makeManager({ redirect: false })
+      const loadURL = vi.fn(async () => {})
+      inst.currentView.webContents.loadURL = loadURL
+      const attempt = makeAttempt(inst)
+      inst._scheduleAutoCompletion('cdp', attempt)
+      await vi.advanceTimersByTimeAsync(3100)
+      expect(loadURL).not.toHaveBeenCalled()
+      // 直接 settle：快照照常产出
+      expect(inst._activeLoginAttempt).toBeNull()
+      expect(inst._extractAuthData).toHaveBeenCalledTimes(1)
+    } finally {
+      vi.useRealTimers()
+    }
+  })
+
+  it('C3d 行为锁：会话已含 web_session 时短路补跳（省一次主站整页往返）', async () => {
+    // CCG 评审 i2：早前登录已种下主站会话 → 不再补跳，直接抓快照 settle
+    vi.useFakeTimers()
+    try {
+      const inst = makeManager({
+        redirect: true,
+        sessionCookies: [
+          { name: 'access-token-creator.xiaohongshu.com', value: 'x', domain: '.xiaohongshu.com' },
+          { name: 'web_session', value: 'already-here', domain: '.xiaohongshu.com' },
+        ],
+      })
+      const loadURL = vi.fn(async () => {})
+      inst.currentView.webContents.loadURL = loadURL
+      const attempt = makeAttempt(inst)
+      inst._scheduleAutoCompletion('cdp', attempt)
+      await vi.advanceTimersByTimeAsync(3100)
+      expect(loadURL).not.toHaveBeenCalled()
+      expect(inst._activeLoginAttempt).toBeNull()
+      expect(inst._extractAuthData).toHaveBeenCalledTimes(1)
+    } finally {
+      vi.useRealTimers()
+    }
+  })
+
+  it('C4 行为锁：主站 15s 兜底——超时后 stop 在途导航、按现有快照继续 settle，不阻断登录', async () => {
+    // loadURL 永不 resolve：主站挂死/风控迟滞，兜底必须生效
+    const loadURL = vi.fn(() => new Promise(() => {}))
+    vi.useFakeTimers()
+    try {
+      const inst = makeManager({ redirect: true, loadURL })
+      const stop = inst.currentView.webContents.stop
+      const attempt = makeAttempt(inst)
+      inst._scheduleAutoCompletion('cdp', attempt)
+      await vi.advanceTimersByTimeAsync(3100)
+      expect(inst._activeLoginAttempt).not.toBeNull()
+      // 兜底窗口（15s）耗尽：即使主站没「就绪」也要 settle（按现有快照继续）
+      await vi.advanceTimersByTimeAsync(16000)
+      // CCG 评审 i6：超时先 stop 在途导航再抓快照（导航/抓取时序竞争防护）
+      expect(stop).toHaveBeenCalled()
+      expect(inst._activeLoginAttempt).toBeNull()
+      expect(inst._extractAuthData).toHaveBeenCalledTimes(1)
+      expect(inst.close).toHaveBeenCalled()
+    } finally {
+      vi.useRealTimers()
+    }
+  })
+})
diff --git a/openspec/records/xhs-login-mainsite.md b/openspec/records/xhs-login-mainsite.md
new file mode 100644
index 000000000..813c2151a
--- /dev/null
+++ b/openspec/records/xhs-login-mainsite.md
@@ -0,0 +1,28 @@
+---
+record: xhs-login-mainsite
+task: 小红书登录二段式补跳主站补抓 web_session（修 code -100「无登录信息」根因）
+date: 2026-10-11
+sync_status: PENDING
+sync_reason: 本 PR #3309 尚未合并，merge SHA 还不存在
+sync_backfill_owner: 下一个会话（合并后回填 PASS + merge SHA，删除本段三字段）
+---
+
+## 本次执行记录：小红书登录二段式补跳主站（xhs-login-mainsite，2026-10-11）
+
+| 门禁 | 状态 | Fresh 证据 |
+|------|------|-----------|
+| 变更类型与隔离 | ✅ | 运行时代码：worktree `D:\Data\projects\mp-worktrees\mp-xhs-login-mainsite`，裸分支 `xhs-login-mainsite`，基线 main f931ce4e8 |
+| 第一性原因（QM-5 ①） | ✅ | note code -100 根因：登录窗 URL=creator.xiaohongshu.com，登录后主站 web_session 从未被设置，凭据快照缺主站会话（xhs-note-align 执行记录遗留结论，三轮真机 406→-1→-100 递进取证） |
+| 逃逸分析（QM-5 ②） | ✅ | 既有测试从未覆盖「登录载体与会话域不一致」场景：单元层全过、真机层才发现。登录快照判据（hasPlatformSessionCookie）只认 creator 标记键，主站会话缺失完全不可见 |
+| 修复 + 回归保护（QM-5 ④） | ✅ | `PLATFORM_POST_LOGIN_REDIRECT` 表 + auth-view-manager 二段式接入（Promise.race 15s 兜底）；回归保护 `apps/desktop/electron/tests/xhs-mainsite-login.test.js` 六条契约（表锁/结构锁/行为锁），TDD 红灯先行（C2/C3a/C3b/C4 先红后绿），实现后 6/6 绿；相关既有测试 5 文件 120/120 绿 |
+| 防止再次发生（QM-5 ⑤） | ✅ | 未配置 redirect 的平台零回归由 C3c 行为锁把关；redirect URL 查表而非字面量（C3a 刻意不锁 www 字面量，防「改表必须同步改 manager」反向耦合）；15s 兜底不阻断登录由 C4 锁定 |
+| 行尾与 diff 对账 | ✅ | `git diff --numstat` 207 增 0 删（A=1 M=2），`--ignore-cr-at-eol --numstat` 同值，无行尾噪声；新文件 LF 由 git autocrlf 正常化 |
+| 接线棘轮 | ✅ | 新增 `electron/tests/xhs-mainsite-login.test.js` 命中 vitest.config.js include 通配 `electron/tests/**/*.test.{js,ts}`（既有接线，非新增 workflow） |
+| QM-1 打包 / QM-4 视觉 | N/A | 未触打包配置与视觉面 |
+| QM-6 CCG 双模型外部评审 | ✅ | pre-commit CCG 判定 DUAL（207 行 > 200 阈值），后端就绪（claude + opencode）；决策层提示「范围漂移」系 TDD 流程自声明（方案文件未建，改动即方案），验证层 diff 审查已落盘 `.ccg/reviews/f931ce4e8*.json` |
+| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#3309)$' --format=%H|%cI` 回填 merge SHA 与时间；`git ls-remote --heads origin xhs-login-mainsite` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |
+
+### 遗留（不假装已闭合）
+
+- 真机验证未做：重新登录抓全量 cookie（应含 web_session）→ probe 重测 note → 草稿落箱。验证结论与 PRD §15 / learnings 随下一轮补录
+- 主站补跳的用户可见性（登录窗短暂跳到主站首页再关闭）未做 UX 确认，如用户反馈突兀可加提示文案
diff --git a/packages/shared-utils/src/platform-definitions.js b/packages/shared-utils/src/platform-definitions.js
index c3c19f3c5..aabf6c824 100755
--- a/packages/shared-utils/src/platform-definitions.js
+++ b/packages/shared-utils/src/platform-definitions.js
@@ -138,6 +138,24 @@ const PLATFORM_COOKIE_DOMAINS = {
   facebook: ['facebook.com'],
 }
 
+// ─── 登录成功后补跳 URL（二段式会话补抓）──────
+// 部分平台登录页域与发布 API 所需会话域不同：小红书登录窗是 creator.xiaohongshu.com，
+// 登录成功只种 creator 会话，主站 web_session 从未被设置，edith note API 因此判
+// 「无登录信息」（code -100）。配置了该表的平台，登录完成抓凭据快照前，登录窗会自动
+// loadURL 到此地址——creator 父域 Cookie 随请求带上，主站识别登录态后种下 web_session，
+// 快照里才有完整会话。未配置的平台保持原行为（登录完成直接抓取，零回归）。
+const PLATFORM_POST_LOGIN_REDIRECT = {
+  xiaohongshu: 'https://www.xiaohongshu.com/',
+}
+
+// 二段式补跳「生效」的凭证 Cookie 名：补跳结束后用它校验主站是否真的种下会话
+//（loadURL resolve 或 15s 超时都不保证——主站可能整页加载后才由 JS/XHR 种 cookie，
+// 或因未识别登录态跳去登录页）。缺失时输出独立失败标记日志（不阻断登录），让
+// 「二段式是否真生效」可观测；未声明的平台跳过校验（保持旧行为）。
+const PLATFORM_POST_LOGIN_PROOF_COOKIES = {
+  xiaohongshu: ['web_session'],
+}
+
 // 平台 localStorage 会话标记：部分平台（如视频号）登录态依赖 localStorage 而非仅 Cookie。
 // 供 checkLocalCredentials 判定 cookies=0 的快照是否仍能构成有效凭证；值为非空即视为会话证据。
 // 未列入的平台视为不依赖 localStorage 登录态。新增标记键必须以 CDP 实测取证为准，
@@ -398,6 +416,8 @@ module.exports = {
   PLATFORM_LOGIN_SUCCESS_PATTERNS,
   PLATFORM_AUTH_HOSTS,
   PLATFORM_COOKIE_DOMAINS,
+  PLATFORM_POST_LOGIN_REDIRECT,
+  PLATFORM_POST_LOGIN_PROOF_COOKIES,
   PLATFORM_LS_SESSION_MARKERS,
   PLATFORM_SESSION_COOKIE_MARKERS,
   isPlatformAuthHost,

```

> 这是机械生成的变更提案，不代表任何设计意图。评审方请只针对上述内容挑刺。