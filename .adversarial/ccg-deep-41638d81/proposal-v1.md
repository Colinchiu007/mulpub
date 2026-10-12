# 变更提案（自动生成，待对抗评审）

- base: `origin/main`
- head: `41638d81cc6a06c6f8ae616a87c55ae5fb44de05`
- 采集模式: `diff`
- 变更规模: 257 行

## 变更内容

```diff
diff --git a/apps/desktop/electron/services/auth-view-manager.js b/apps/desktop/electron/services/auth-view-manager.js
index 8dbf8f9e4..23d750512 100644
--- a/apps/desktop/electron/services/auth-view-manager.js
+++ b/apps/desktop/electron/services/auth-view-manager.js
@@ -13,6 +13,7 @@ const path = require('path')
 const log = require('./logger')
 const {
   PLATFORM_LOGIN_URLS,
+  PLATFORM_POST_LOGIN_REDIRECT,
   hasPlatformSessionCookie,
   hasPlatformSessionCookieMarkers,
   sessionCookieNames,
@@ -101,6 +102,12 @@ function hasCapturedCredentials(authData, platform) {
   return hasCredentials
 }
 
+// 二段式登录（主站会话补抓）：补跳主站后等待其就绪的兜底窗口。
+// 主站可能因网络/风控迟迟不跳转，超时后按当前快照继续，不阻断登录流程。
+// 「就绪」= loadURL 的 Promise resolve（did-finish-load 等价）：主站响应已在
+// .xiaohongshu.com 父域种下会话 Cookie（web_session 等），无需依赖页面 DOM 特征。
+const POST_LOGIN_REDIRECT_WAIT_MS = 15000
+
 class AuthViewManager {
   constructor() {
     /** @type {import('electron').BrowserWindow | null} */
@@ -296,6 +303,23 @@ class AuthViewManager {
     const timer = setTimeout(async () => {
       try {
         if (!this._isCurrentLoginAttempt(attempt)) return
+        // 二段式（主站会话补抓）：登录页域与发布 API 会话域不同（小红书 creator vs
+        // www 主站）时，凭据快照此刻还缺主站 web_session（edith note code -100 根因）。
+        // 先补跳主站，creator 父域 Cookie 随请求带上、主站种下会话，再抓快照。
+        // 未配置 redirect 的平台保持原行为：直接抓取，零回归。
+        const redirectUrl = /** @type {Record<string, string>} */ (PLATFORM_POST_LOGIN_REDIRECT)[attempt.platform]
+        if (redirectUrl) {
+          log.info('AuthView', `post-login redirect to main site: ${attempt.platform} ${redirectUrl}`)
+          // 就绪 = loadURL resolve（did-finish-load 等价，主站响应已种下会话 Cookie）；
+          // 15s 兜底：主站迟迟未就绪时按当前快照继续，不阻断登录。
+          await Promise.race([
+            attempt.view.webContents.loadURL(redirectUrl).catch(e => {
+              log.warn('AuthView', `post-login redirect load failed: ${e instanceof Error ? e.message : String(e)}`)
+            }),
+            new Promise(resolve => setTimeout(resolve, POST_LOGIN_REDIRECT_WAIT_MS)),
+          ])
+          if (!this._isCurrentLoginAttempt(attempt)) return
+        }
         const authData = await this._extractAuthData(attempt.view, attempt.platform)
         if (!hasCapturedCredentials(authData, attempt.platform)) {
           // 静默跳过会让「为什么没自动完成」无从排查，这里必须留下判定依据。
diff --git a/apps/desktop/electron/tests/xhs-mainsite-login.test.js b/apps/desktop/electron/tests/xhs-mainsite-login.test.js
new file mode 100644
index 000000000..e8dbc57a1
--- /dev/null
+++ b/apps/desktop/electron/tests/xhs-mainsite-login.test.js
@@ -0,0 +1,172 @@
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
+ * _extractAuthData / close 全桩：前者返回可断言的快照，后者避免真拆 Electron 视图。
+ * cookie 用平台声明的真实会话标记名（PLATFORM_SESSION_COOKIE_MARKERS.xiaohongshu
+ * 的 creator 键）——用 web_session 之类会被 hasCapturedCredentials 判 false、
+ * 走 skipped 分支，测试就测不到 settle 路径了。
+ * @param {{ redirect?: boolean, loadURL?: (url: string) => Promise<void> }} opts
+ */
+function makeManager (opts = {}) {
+  const inst = Object.create(AuthViewManager.prototype)
+  // 直接桩掉实例字段与方法（绕过 constructor：避免触碰真实窗口）
+  inst.mainWindow = null
+  inst.currentView = {
+    webContents: {
+      loadURL: opts.loadURL || vi.fn(async () => {}),
+      session: { cookies: { get: async () => [] } },
+    },
+  }
+  inst.currentPlatform = opts.redirect === false ? ZHIHU : XHS
+  inst.currentAccountId = 'auth-test'
+  // _createLoginAttempt 要求三者齐备（view/platform/resolveLogin），resolveLogin 缺席会返回 null
+  inst._resolveLogin = vi.fn()
+  inst._rejectLogin = vi.fn()
+  inst._activeLoginAttempt = null
+  inst._autoCompletionAttemptId = null
+  inst._loginAttemptSequence = 0
+  inst._sidebarWidth = 200
+  inst._extractAuthData = vi.fn(async () => ({
+    cookies: [
+      // creator 会话标记（登录页本身产出）
+      { name: 'access-token-creator.xiaohongshu.com', value: 'x', domain: '.xiaohongshu.com' },
+      // 主站会话（二段式补跳后才有的增量）
+      { name: 'web_session', value: 'y', domain: '.xiaohongshu.com' },
+    ],
+    name: 't', localStorage: {}, indexedDB: {}, accountInfo: {},
+  }))
+  inst.close = vi.fn()
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
+  it('C3b 行为锁：配置了 redirect 的平台登录完成前会 loadURL 主站', async () => {
+    // loadURL 返回永不 resolve 的 deferred：模拟主站迟迟未跳——
+    // 此刻 settle 必须被 15s 兜底挡住（等主站，而不是立刻抓 creator 快照）
+    let neverResolve
+    const loadURL = vi.fn(() => new Promise(resolve => { neverResolve = resolve }))
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
+      // 主站 loadURL resolve（did-finish-load 等价）→ 主站已种下会话 → 立即 settle
+      neverResolve()
+      await vi.advanceTimersByTimeAsync(0)
+      expect(inst._activeLoginAttempt).toBeNull()
+      expect(inst._extractAuthData).toHaveBeenCalledTimes(1)
+      expect(inst.close).toHaveBeenCalled()
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
+  it('C4 行为锁：主站 15s 兜底——超时后按现有快照继续 settle，不阻断登录', async () => {
+    // loadURL 永不 resolve：主站挂死/风控迟滞，兜底必须生效
+    const loadURL = vi.fn(() => new Promise(() => {}))
+    vi.useFakeTimers()
+    try {
+      const inst = makeManager({ redirect: true, loadURL })
+      const attempt = makeAttempt(inst)
+      inst._scheduleAutoCompletion('cdp', attempt)
+      await vi.advanceTimersByTimeAsync(3100)
+      expect(inst._activeLoginAttempt).not.toBeNull()
+      // 兜底窗口（15s）耗尽：即使主站没「就绪」也要 settle（按现有快照继续）
+      await vi.advanceTimersByTimeAsync(16000)
+      expect(inst._activeLoginAttempt).toBeNull()
+      expect(inst._extractAuthData).toHaveBeenCalledTimes(1)
+      expect(inst.close).toHaveBeenCalled()
+    } finally {
+      vi.useRealTimers()
+    }
+  })
+})
diff --git a/packages/shared-utils/src/platform-definitions.js b/packages/shared-utils/src/platform-definitions.js
index c3c19f3c5..4fc868a62 100755
--- a/packages/shared-utils/src/platform-definitions.js
+++ b/packages/shared-utils/src/platform-definitions.js
@@ -138,6 +138,16 @@ const PLATFORM_COOKIE_DOMAINS = {
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
 // 平台 localStorage 会话标记：部分平台（如视频号）登录态依赖 localStorage 而非仅 Cookie。
 // 供 checkLocalCredentials 判定 cookies=0 的快照是否仍能构成有效凭证；值为非空即视为会话证据。
 // 未列入的平台视为不依赖 localStorage 登录态。新增标记键必须以 CDP 实测取证为准，
@@ -398,6 +408,7 @@ module.exports = {
   PLATFORM_LOGIN_SUCCESS_PATTERNS,
   PLATFORM_AUTH_HOSTS,
   PLATFORM_COOKIE_DOMAINS,
+  PLATFORM_POST_LOGIN_REDIRECT,
   PLATFORM_LS_SESSION_MARKERS,
   PLATFORM_SESSION_COOKIE_MARKERS,
   isPlatformAuthHost,

```

> 这是机械生成的变更提案，不代表任何设计意图。评审方请只针对上述内容挑刺。