# 变更提案（自动生成，待对抗评审）

- base: `origin/main`
- head: `0b4988a70`
- 采集模式: `diff`
- 变更规模: 648 行

## 变更内容

```diff
diff --git a/.ccg/reviews/8e9109a556630fb4d0ad0cb714f737191a4914cd.json b/.ccg/reviews/8e9109a556630fb4d0ad0cb714f737191a4914cd.json
new file mode 100644
index 000000000..991840a21
--- /dev/null
+++ b/.ccg/reviews/8e9109a556630fb4d0ad0cb714f737191a4914cd.json
@@ -0,0 +1,23 @@
+{
+  "sha": "8e9109a556630fb4d0ad0cb714f737191a4914cd",
+  "layer": "diff",
+  "mode": "dual",
+  "reason": "变更 383 行 > 200 行阈值（对齐 §12.6 Red Team）",
+  "stats": {
+    "changedLines": 383,
+    "fileCount": 9,
+    "codeFileCount": 7,
+    "sensitivePathHits": [],
+    "plannedPathHits": [],
+    "sensitiveContentHits": 8
+  },
+  "stagedDiffHash": "0ebbef042154a38d917e0e3721ad1399e5261c46b32ef8204ce0212b90c38e4b",
+  "decidedAt": "2026-10-15T05:27:41.017Z",
+  "decidedBy": "ccg-review-decider",
+  "deepReview": {
+    "required": true,
+    "status": "pending",
+    "performedBy": null,
+    "findings": null
+  }
+}
\ No newline at end of file
diff --git a/01-docs/PRD-PUBLISH-RESULT-LINK-INAPP-TAB-2026-10-15.md b/01-docs/PRD-PUBLISH-RESULT-LINK-INAPP-TAB-2026-10-15.md
new file mode 100644
index 000000000..3d9880c76
--- /dev/null
+++ b/01-docs/PRD-PUBLISH-RESULT-LINK-INAPP-TAB-2026-10-15.md
@@ -0,0 +1,127 @@
+# PRD：发布结果「查看文章」改为应用内新标签打开
+
+> 分支 `publish-article-inapp-tab`｜日期 2026-10-15｜变更类型：运行时代码（renderer 层）
+> 关联：`PRD-PUBLISH-HISTORY-CARD-OPEN-LINK-2026-10-03.md`（同族先例）、`PRD-HREF-SCHEME-GUARD-2026-09-29`（协议门禁）
+
+## 1. 背景与问题
+
+发布成功后，「发布进度」结果区显示「查看文章 →」。该链接是原生 `<a target="_blank">`，
+点击由主进程 `webContents.setWindowOpenHandler` 接管并调用 `shell.openExternal()`，
+**跳到系统默认浏览器**（`apps/desktop/electron/window.js` 的 `openExternalUrl`）。
+
+用户视角的问题：正在应用内工作，点一下就被弹出到系统浏览器；且系统浏览器与应用内账号
+体系无关，打开需要登录的页面时同样是登录墙，来回切换成本高。
+
+发布记录详情（`PublishHistory.vue`）的「公开链接」是同一语义的另一处，行为一致。
+
+## 2. 目标 / 非目标
+
+**目标**：左键单击「查看文章」→ 在应用内**新开一个标签页**加载该 URL，并自动切到该标签。
+
+**非目标（明确不做）**：
+- 不改结果区的显示项、文案、位置、样式。
+- 不改 URL 的生成与清洗（`sanitizePublishResultUrl` 的既有职责）。
+- 不把账号登录态注入该标签（见 §5.1）。
+- 不改「复制链接」按钮行为。
+- 不改其它外链点位（热门选题、影视工程来源链接、播客端点等）——只覆盖发布结果区与发布记录详情两处「查看作品」语义。
+- 不改主进程 `openExternalUrl` / `isAllowedExternalUrl` 的判据。
+
+## 3. 功能逻辑
+
+### 3.1 主路径（左键单击）
+1. 用户在结果区左键单击「查看文章」。
+2. `isPlainLeftClick(event)` 判定：左键 ∧ 无 Ctrl/⌘/Shift/Alt。
+3. `safeHttpUrl(result.url)` 清洗目标 URL；为 `null` 则**不接管**（交给默认行为，与既有「降级纯文本」的安全边界一致）。
+4. `event.preventDefault()` 阻止默认外跳。
+5. `tabStore.createTab({ url })`（IPC `page-manager:create-new-tab-page`）。
+6. 返回非空 `tabId` → `tabStore.switchToTab(tabId)` 切到新标签。
+
+### 3.2 覆盖点位
+| 点位 | 文件 | 说明 |
+|---|---|---|
+| 发布结果区「查看文章 →」 | `src/views/Publish.vue`（`.result-link`） | 本 PR 主目标 |
+| 发布记录详情「公开链接」 | `src/views/PublishHistory.vue`（`.detail-link`） | 同一「查看作品」语义，同步改造 |
+
+两处共用 `src/composables/useInAppLink.js`，行为不漂移。
+
+### 3.3 交互逻辑（点击修饰键语义）
+| 点击方式 | 行为 | 理由 |
+|---|---|---|
+| 左键单击（无修饰键） | 应用内新标签打开并切换 | 主路径 |
+| Ctrl / ⌘ / Shift / Alt + 单击 | **不拦截**，保持浏览器默认（最终仍是系统浏览器） | 修饰键是用户明确的「另开/新窗口」意图，应用不得改写 |
+| 中键单击 | 不触发 click 事件，天然不干预 | — |
+| 右键 | 不拦截，「复制链接地址」等原生菜单可用 | 保留原生可访问性 |
+| 键盘激活（Enter/Space） | `button` 为 0 且无修饰键 → 视同普通左键 | 与其它按钮的可访问性行为一致 |
+
+### 3.4 降级与失败处理（必须显式，不得静默）
+| 失败点 | 处理 |
+|---|---|
+| 桥不可用 / store 未初始化 | `createTab` 抛错或返回 `null` → 降级 `window.open(url,'_blank','noopener')` → 主进程 `setWindowOpenHandler` → `openExternalUrl` 系统浏览器（＝改造前行为） |
+| `switchToTab` 抛异常 | 标签**已建成**，返回成功（不回退成 false——那会造成「应用内 + 系统浏览器」双开） |
+| `safeHttpUrl` 返回 `null` | 不接管、不降级，交给默认行为（纯文本分支既有形态） |
+
+**顺序约束**：必须先 `preventDefault()` 再尝试应用内打开。反过来会在降级路径出现
+「系统浏览器 + 应用内标签」双开。
+
+**提示文字**：主路径不弹提示（开标签本身就是反馈）；降级路径与改造前行为完全一致，
+故不加提示，避免噪声。**未新增任何 i18n key。**
+
+## 4. 数据校验与显示项
+
+- **数据面**：只有一个已清洗的 URL 字符串。`safeHttpUrl` 只按前缀放行 `http://` / `https://`
+  （大小写不敏感），不做归一化；不通过即 `null`（沿用 `PRD-HREF-SCHEME-GUARD` 三条口径）。
+- **凭据面**：不读取、不写入、不转发任何 Cookie / 账号凭据。普通标签使用
+  `persist:browse-<tabId>` 一次性分区（`tab-lifecycle.js` 既有行为）。
+- **显示项**：无新增/无改动。链接文本仍为 `publishPage.viewArticle`（zh「查看文章 →」／en「View Article →」）。
+- **标签标题**：**不向** `createNewTabPage` 传 `title`——让标签标题随后由页面标题自然回填，
+  避免被固定成无信息量的字面量。
+
+## 5. 关键取舍（含被否方案）
+
+### 5.1 不注入账号登录态
+`createNewTabPage` 在**不传 accountId** 时使用 `persist:browse-<tabId>` 一次性分区；传
+accountId 会用持久账号分区并恢复该账号凭据。发布结果目前**不携带 accountId**（只有
+`url` / `platform` / `postId`），且「把账号凭据注入一个由平台响应决定的任意 URL」会显著
+扩大凭据暴露面。
+
+**决策：普通标签打开。** 代价：需要登录的页面（如小红书创作者页）在标签里会显示登录页
+——与现状（系统浏览器）一致，不构成回归。
+被否方案：为拿 accountId 而改动发布结果形状与进度通道（收益小、面更大）。
+
+### 5.2 保留 `<a>` 元素，只拦截点击
+`src/href-scheme-contract.test.js` 有两条**规模下界**锁：带 `:href` 的锚点 ≥6、
+`target="_blank"` 的锚点 ≥6（注释明写其存在意义是「防解析退化后判据恒真」）。删除或改写
+锚点会击穿既有护栏，属「削弱门禁换实现便利」。
+
+**决策：保留锚点形状**（`:href` / `target="_blank"` / `rel="noopener"` 全部不动），
+仅在 `@click` 上接线；且**不用** `@click.prevent`（无条件修饰符会劫持 Ctrl/⌘ 点击），
+由函数内部 `isPlainLeftClick` 决定是否接管。接线锁
+`src/views/publish-article-link-inapp-wiring.test.js` 钉住这两点。
+
+### 5.3 降级用 `window.open` 而非 `shell.openExternal`
+降级走 `window.open(url,'_blank','noopener')`，由主进程 `setWindowOpenHandler` 统一接管：
+主进程侧的 `isAllowedExternalUrl` 判据比渲染层更严，天然形成纵深防御；同时与既有
+同族先例 `usePublishHistoryContentLink.js` 完全同构（后者已在
+`OPEN_SITES_GUARDED_IN_MAIN` 在册，本 PR 同样登记）。
+
+## 6. 回归保护
+
+| 测试 | 锁什么 |
+|---|---|
+| `src/composables/useInAppLink.test.js`（14 例） | C1 修饰键/非左键不接管；C2 成功路径 createTab→switchToTab；C3 失败一律返回 false 且不抛（含非 http(s) 不建标签）；C4 handleLinkClick 的接管/降级/顺序 |
+| `src/views/publish-article-link-inapp-wiring.test.js`（8 例） | 两处锚点形状保持、接线经组合式函数、无 `@click.prevent` |
+| `src/href-scheme-contract.test.js`（既有 16 例） | 新增 `window.open` 站点已登记；锚点规模下界与 noopener 锁不被击穿 |
+
+## 7. 影响面
+
+- 修改：`src/views/Publish.vue`、`src/views/PublishHistory.vue`、`src/href-scheme-contract.test.js`（登记项）
+- 新增：`src/composables/useInAppLink.js`、`src/composables/useInAppLink.test.js`、`src/views/publish-article-link-inapp-wiring.test.js`
+- 不触：主进程、平台协议、凭据体系、i18n（无新 key）
+
+## 8. 遗留与后续（登记，不假装闭合）
+
+- 若后续希望「查看文章」直接进入**已登录的账号会话**，需先在发布结果里补 `accountId`
+  并单独评估凭据注入面；属独立决策，不在本刀。
+- `persist:browse-<tabId>` 为一次性分区：在应用内标签里登录的站点，关闭标签后登录态不保留。
+  是否改为「共享浏览分区」是既有架构议题，不在本刀。
+- 本刀的「应用内打开」只覆盖发布结果区与发布记录详情；其它外链点位维持系统浏览器。
diff --git a/apps/desktop/src/composables/useInAppLink.js b/apps/desktop/src/composables/useInAppLink.js
new file mode 100644
index 000000000..113f4070b
--- /dev/null
+++ b/apps/desktop/src/composables/useInAppLink.js
@@ -0,0 +1,106 @@
+// @ts-check
+/**
+ * useInAppLink —— 让「查看文章」这类外链在**应用内新标签**打开，而不是弹到系统浏览器。
+ *
+ * 背景（2026-10-15）：发布成功后的结果区「查看文章 →」是原生 `<a target="_blank">`，
+ * 点击由主进程 `webContents.setWindowOpenHandler` 接管并 `shell.openExternal()` 打开
+ * 系统浏览器（apps/desktop/electron/window.js:265）。用户在应用内工作，一点就被弹出，
+ * 上下文断裂。
+ *
+ * 口径（四条，缺一不可）：
+ *  1. **只接管「最普通的那一次点击」**（左键 + 无修饰键）。Ctrl/⌘/Shift/Alt 点击与中/右键
+ *     保持浏览器默认语义 —— 那是用户明确的「另开/新窗口」意图，不该被应用改写。
+ *  2. **URL 必须过 `safeHttpUrl`**（只放行 http/https）。不通过就**不接管**：交给默认行为，
+ *     与既有的「不产出锚点 ⇒ 降级纯文本」安全边界一致，绝不在这一层放宽协议。
+ *  3. **先阻止默认，再尝试应用内打开**。顺序不可交换：若先尝试、失败后才阻止默认，降级
+ *     路径会出现「系统浏览器 + 应用内标签」双开。
+ *  4. **失败必须降级且不抛**：桥不可用 / 建标签返回 null / 抛异常 —— 一律回落到改造前的
+ *     行为（系统浏览器），绝不出现「点了没反应」的静默失败。
+ *
+ * 非目标：不注入账号登录态（见 PRD「关键取舍」）；不改 URL 的生成与清洗。
+ */
+import { useTabStore } from '@/stores/tab'
+import { safeHttpUrl } from '@multi-publish/shared-utils/src/safe-http-url'
+
+/**
+ * 是否「最普通的左键点击」：左键、且没有任何修饰键。
+ * 中键/右键不触发 click 事件；键盘激活（Enter）时 button 为 0 且无修饰键，
+ * 视同普通点击（与应用内其它按钮的可访问性行为一致）。
+ * @param {{ button?: number, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean, altKey?: boolean }|null|undefined} event
+ * @returns {boolean}
+ */
+export function isPlainLeftClick (event) {
+  if (!event || typeof event !== 'object') return false
+  if (event.button !== 0) return false
+  return !(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
+}
+
+/**
+ * 降级：交给主进程 `setWindowOpenHandler` → `openExternalUrl` 开系统浏览器。
+ * 这正是改造前的行为，保证失败路径不比改造前更差。
+ * @param {string} url
+ */
+function defaultOpenExternal (url) {
+  try {
+    window.open(url, '_blank', 'noopener')
+  } catch (_e) {
+    // 极端环境下没有 window（非浏览器宿主）：静默放弃，绝不因降级路径自身再抛
+  }
+}
+
+/**
+ * @param {{ openExternal?: (url: string) => void }} [options] — 仅测试注入用；生产走默认实现
+ */
+export function useInAppLink (options = {}) {
+  const tabStore = useTabStore()
+  const openExternal = (options && typeof options.openExternal === 'function')
+    ? options.openExternal
+    : defaultOpenExternal
+
+  /**
+   * 在应用内新标签打开（不切换语义之外的副作用）。
+   * @param {unknown} url
+   * @returns {Promise<boolean>} 是否成功在应用内打开
+   */
+  async function openInAppTab (url) {
+    const safe = safeHttpUrl(url)
+    if (!safe) return false
+
+    let tabId = null
+    try {
+      tabId = await tabStore.createTab({ url: safe })
+    } catch (_e) {
+      // 桥异常（IPC 失败 / store 未初始化）：交给调用方降级，不向上抛
+      return false
+    }
+    if (!tabId) return false
+
+    try {
+      await tabStore.switchToTab(tabId)
+    } catch (_e) {
+      // 标签已建成，仅切换失败：对用户而言「已打开」，让他自己点那个标签即可。
+      // 不在这里回退成 false —— 那会触发外开，变成「应用内 + 系统浏览器」双开。
+    }
+    return true
+  }
+
+  /**
+   * 锚点 click 处理器：普通左键接管为应用内打开，其余情形一律不干预。
+   * @param {any} event
+   * @param {unknown} url
+   * @returns {Promise<boolean>} 是否走了应用内打开
+   */
+  async function handleLinkClick (event, url) {
+    if (!isPlainLeftClick(event)) return false
+    const safe = safeHttpUrl(url)
+    if (!safe) return false
+
+    if (typeof event.preventDefault === 'function') event.preventDefault()
+
+    const opened = await openInAppTab(safe)
+    if (!opened) openExternal(safe)
+    return opened
+  }
+
+  return { openInAppTab, handleLinkClick }
+}
diff --git a/apps/desktop/src/composables/useInAppLink.test.js b/apps/desktop/src/composables/useInAppLink.test.js
new file mode 100644
index 000000000..9d43db170
--- /dev/null
+++ b/apps/desktop/src/composables/useInAppLink.test.js
@@ -0,0 +1,172 @@
+// @ts-check
+/**
+ * 发布结果「查看文章」改为应用内标签打开 —— 行为契约（TDD 红灯先行）。
+ *
+ * 背景：发布成功后结果区的「查看文章 →」是原生 <a target="_blank">；点击由主进程
+ * webContents.setWindowOpenHandler 接管并 shell.openExternal() 跳到**系统浏览器**
+ * （apps/desktop/electron/window.js:265）。用户希望留在应用内。
+ *
+ * 本文件锁四类不变量：
+ *   C1 isPlainLeftClick 只认「左键 + 无修饰键」——修饰键/中右键必须保留浏览器默认语义
+ *   C2 openInAppTab 成功路径：createTab → switchToTab，返回 true
+ *   C3 openInAppTab 失败路径一律返回 false 且**不抛**（失败要能被调用方降级，不得静默也不得炸）
+ *   C4 handleLinkClick：普通左键 → 阻止默认 + 应用内打开；降级只在应用内失败时发生；
+ *      非 http(s) 一律不拦截（安全边界沿用 safeHttpUrl）
+ */
+import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
+
+const h = vi.hoisted(() => ({
+  tabs: { createTab: vi.fn(), switchToTab: vi.fn() },
+}))
+
+vi.mock('@/stores/tab', () => ({ useTabStore: () => h.tabs }))
+
+import { isPlainLeftClick, useInAppLink } from './useInAppLink'
+
+const URL_OK = 'https://weibo.com/detail/1'
+
+beforeEach(() => {
+  h.tabs.createTab.mockReset()
+  h.tabs.switchToTab.mockReset()
+})
+
+describe('C1 isPlainLeftClick —— 只认「最普通的那一次点击」', () => {
+  it('左键且无修饰键 → true', () => {
+    expect(isPlainLeftClick({ button: 0 })).toBe(true)
+  })
+
+  it('任一修饰键 → false（保留浏览器默认，交由主进程外开）', () => {
+    for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
+      expect(isPlainLeftClick({ button: 0, [key]: true })).toBe(false)
+    }
+  })
+
+  it('非左键 / 缺 button / 空事件 → false', () => {
+    expect(isPlainLeftClick({ button: 1 })).toBe(false)
+    expect(isPlainLeftClick({ button: 2 })).toBe(false)
+    expect(isPlainLeftClick({})).toBe(false)
+    expect(isPlainLeftClick(null)).toBe(false)
+    expect(isPlainLeftClick(undefined)).toBe(false)
+  })
+})
+
+describe('C2/C3 openInAppTab —— 建标签并切换，失败一律返回 false', () => {
+  it('成功：createTab(url) → switchToTab(tabId)，返回 true', async () => {
+    h.tabs.createTab.mockResolvedValue('btab-7')
+    h.tabs.switchToTab.mockResolvedValue(undefined)
+    const { openInAppTab } = useInAppLink()
+
+    await expect(openInAppTab(URL_OK)).resolves.toBe(true)
+    expect(h.tabs.createTab).toHaveBeenCalledWith({ url: URL_OK })
+    expect(h.tabs.switchToTab).toHaveBeenCalledWith('btab-7')
+  })
+
+  it('createTab 返回 null（桥不可用）→ false，且不 switch', async () => {
+    h.tabs.createTab.mockResolvedValue(null)
+    const { openInAppTab } = useInAppLink()
+
+    await expect(openInAppTab(URL_OK)).resolves.toBe(false)
+    expect(h.tabs.switchToTab).not.toHaveBeenCalled()
+  })
+
+  it('createTab 抛异常 → false，且不向调用方抛', async () => {
+    h.tabs.createTab.mockRejectedValue(new Error('bridge down'))
+    const { openInAppTab } = useInAppLink()
+
+    await expect(openInAppTab(URL_OK)).resolves.toBe(false)
+  })
+
+  it('switchToTab 抛异常 → 标签已建，仍返回 true（成功切换失败不算没打开）', async () => {
+    h.tabs.createTab.mockResolvedValue('btab-8')
+    h.tabs.switchToTab.mockRejectedValue(new Error('switch failed'))
+    const { openInAppTab } = useInAppLink()
+
+    await expect(openInAppTab(URL_OK)).resolves.toBe(true)
+  })
+
+  it('非 http(s) URL → 既不建标签也不切换，返回 false', async () => {
+    const { openInAppTab } = useInAppLink()
+    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x/y', '', '   ', 'not-a-url']) {
+      await expect(openInAppTab(bad)).resolves.toBe(false)
+    }
+    expect(h.tabs.createTab).not.toHaveBeenCalled()
+    expect(h.tabs.switchToTab).not.toHaveBeenCalled()
+  })
+})
+
+describe('C4 handleLinkClick —— 拦截语义与降级', () => {
+  let openExternal
+
+  beforeEach(() => {
+    openExternal = vi.fn()
+  })
+
+  afterEach(() => {
+    vi.restoreAllMocks()
+  })
+
+  function makeEvent (overrides = {}) {
+    return { button: 0, preventDefault: vi.fn(), ...overrides }
+  }
+
+  it('普通左键 + http：阻止默认 + 应用内打开，且**不**调用外开降级', async () => {
+    h.tabs.createTab.mockResolvedValue('btab-9')
+    h.tabs.switchToTab.mockResolvedValue(undefined)
+    const { handleLinkClick } = useInAppLink({ openExternal })
+    const event = makeEvent()
+
+    await expect(handleLinkClick(event, URL_OK)).resolves.toBe(true)
+    expect(event.preventDefault).toHaveBeenCalledTimes(1)
+    expect(h.tabs.createTab).toHaveBeenCalledWith({ url: URL_OK })
+    expect(openExternal).not.toHaveBeenCalled()
+  })
+
+  it('Ctrl 点击：不阻止默认、不建标签、不降级（交给浏览器默认与主进程）', async () => {
+    const { handleLinkClick } = useInAppLink({ openExternal })
+    const event = makeEvent({ ctrlKey: true })
+
+    await expect(handleLinkClick(event, URL_OK)).resolves.toBe(false)
+    expect(event.preventDefault).not.toHaveBeenCalled()
+    expect(h.tabs.createTab).not.toHaveBeenCalled()
+    expect(openExternal).not.toHaveBeenCalled()
+  })
+
+  it('应用内打开失败：仍阻止默认（避免「外开 + 应用内」双开），并降级为外开', async () => {
+    h.tabs.createTab.mockRejectedValue(new Error('boom'))
+    const { handleLinkClick } = useInAppLink({ openExternal })
+    const event = makeEvent()
+
+    await expect(handleLinkClick(event, URL_OK)).resolves.toBe(false)
+    expect(event.preventDefault).toHaveBeenCalledTimes(1)
+    expect(openExternal).toHaveBeenCalledWith(URL_OK)
+  })
+
+  it('非 http(s)：不拦截、不建标签、不降级（沿用纯文本分支的安全边界）', async () => {
+    const { handleLinkClick } = useInAppLink({ openExternal })
+    const event = makeEvent()
+
+    await expect(handleLinkClick(event, 'javascript:alert(1)')).resolves.toBe(false)
+    expect(event.preventDefault).not.toHaveBeenCalled()
+    expect(h.tabs.createTab).not.toHaveBeenCalled()
+    expect(openExternal).not.toHaveBeenCalled()
+  })
+
+  it('事件缺少 preventDefault 时不得抛异常（防御性）', async () => {
+    h.tabs.createTab.mockResolvedValue('btab-10')
+    h.tabs.switchToTab.mockResolvedValue(undefined)
+    const { handleLinkClick } = useInAppLink({ openExternal })
+
+    await expect(handleLinkClick({ button: 0 }, URL_OK)).resolves.toBe(true)
+  })
+
+  it('默认 openExternal 走 window.open（主进程 setWindowOpenHandler 会接住并开系统浏览器）', async () => {
+    const openSpy = vi.fn()
+    vi.stubGlobal('open', openSpy)
+    h.tabs.createTab.mockResolvedValue(null)
+    const { handleLinkClick } = useInAppLink()
+
+    await expect(handleLinkClick(makeEvent(), URL_OK)).resolves.toBe(false)
+    expect(openSpy).toHaveBeenCalledWith(URL_OK, '_blank', 'noopener')
+    vi.unstubAllGlobals()
+  })
+})
diff --git a/apps/desktop/src/href-scheme-contract.test.js b/apps/desktop/src/href-scheme-contract.test.js
index 25d59c01d..39fa424a0 100644
--- a/apps/desktop/src/href-scheme-contract.test.js
+++ b/apps/desktop/src/href-scheme-contract.test.js
@@ -134,6 +134,11 @@ const OPEN_SITES_GUARDED_IN_MAIN = [
   'src/composables/usePublishHistoryContentLink.js', // 发布记录卡片点击打开平台链接：首选 tabStore.createTab 应用内新标签；
   // createTab 失败降级 window.open(url,'_blank')，URL 已过渲染端 safeHttpUrl，
   // window.open 再由主进程 setWindowOpenHandler → isAllowedExternalUrl 更严判据兜底（PRD-PUBLISH-HISTORY-CARD-OPEN-LINK-2026-10-03）
+  // 2026-10-15 随 PRD-PUBLISH-RESULT-LINK-INAPP-TAB 登记：发布结果/发布记录「查看文章」的
+  // 应用内新标签通道。与上一条同构——普通左键先 createTab（URL 已过渲染端 safeHttpUrl），
+  // 建标签失败才降级 window.open(url,'_blank','noopener')，最终仍由主进程
+  // setWindowOpenHandler → isAllowedExternalUrl 兜底。改这里必须同步 PRD §5 降级表。
+  'src/composables/useInAppLink.js',
 ]
 
 /**
diff --git a/apps/desktop/src/views/Publish.vue b/apps/desktop/src/views/Publish.vue
index 0317df177..631c53bc8 100755
--- a/apps/desktop/src/views/Publish.vue
+++ b/apps/desktop/src/views/Publish.vue
@@ -619,7 +619,7 @@
               {{ t('publishPage.scheduleViewHistory') }}
             </UiButton>
             <div v-if="result.url" class="result-link-row">
-              <a v-if="safeHttpUrl(result.url)" :href="safeHttpUrl(result.url)" target="_blank" rel="noopener" class="result-link">{{ t('publishPage.viewArticle') }}</a>
+              <a v-if="safeHttpUrl(result.url)" :href="safeHttpUrl(result.url)" target="_blank" rel="noopener" class="result-link" data-testid="result-link" @click="openArticleLinkInApp($event, result.url)">{{ t('publishPage.viewArticle') }}</a>
               <span v-else class="result-link">{{ result.url }}</span>
               <button @click="copyUrl(result.url)" class="copy-url-button" :class="{ 'is-copied': copied }">
                 {{ copied ? t('publishPage.copied') : t('publishPage.copyLink') }}
@@ -704,6 +704,7 @@ import UiInput from "../components/UiInput.vue";
 import { ref, reactive, computed, onMounted, onActivated, onBeforeUnmount, watch } from 'vue'
 import { safeHttpUrl } from '@multi-publish/shared-utils/src/safe-http-url'
 import { getApi } from '@/api/electron-bridge'
+import { useInAppLink } from '@/composables/useInAppLink'
 import { useNotify } from '@/composables/useNotify'
 import { useRoute, useRouter } from 'vue-router'
 import { useI18n } from 'vue-i18n'
@@ -1231,6 +1232,9 @@ const {
 
 const { copyDetailMeta, showCopyDetailBanner, applyCopyDetailHandoff, syncCopyDetailToLibrary, handleCreateVideo, onSaveDraft } = useCopyDetailMode({ article, activeMode, route, t, notifyInfo, saveDraft, router })
 
+// 发布结果「查看文章」：应用内新标签打开（普通左键），其余点击方式与失败降级保持原浏览器行为
+const { handleLinkClick: openArticleLinkInApp } = useInAppLink()
+
 const precheckEnabled = ref(false)
 
 const {
diff --git a/apps/desktop/src/views/PublishHistory.vue b/apps/desktop/src/views/PublishHistory.vue
index 21c93bab4..22e31764f 100644
--- a/apps/desktop/src/views/PublishHistory.vue
+++ b/apps/desktop/src/views/PublishHistory.vue
@@ -387,6 +387,7 @@
                 rel="noopener"
                 class="detail-link"
                 data-testid="detail-link"
+                @click="openArticleLinkInApp($event, publicLinkHref(selectedRecord))"
               >{{ publicLinkHref(selectedRecord) }}</a>
               <span v-if="linkSourceHint(linkRenderState(selectedRecord))" class="detail-link-hint" data-testid="detail-link-derived-hint">{{ linkSourceHint(linkRenderState(selectedRecord)) }}</span>
               <template v-if="linkRenderState(selectedRecord).kind === 'plain'">
@@ -449,6 +450,7 @@ import { usePlatformStore } from '@/stores/platforms'
 import { usePublishHistoryContentLink, CARD_INTERACTIVE_SELECTOR } from '@/composables/usePublishHistoryContentLink'
 // 2026-10-12 发布记录真实封面缩略图（本地 cover_path → cover:read-data；远程 → safeHttpUrl）
 import { useHistoryCoverThumbnails } from '@/composables/useHistoryCoverThumbnails'
+import { useInAppLink } from '@/composables/useInAppLink'
 import { useIdentity } from '@/composables/useIdentity'
 import { isAuthGateResult } from '@/utils/auth-gate'
 import { formatUserError } from '@/utils/user-facing-error'
@@ -523,6 +525,9 @@ const filteredRecords = computed(() => {
 })
 // 2026-10-12：缩略图 = 本次实际使用的封面；拿不到即回退平台图标
 const { coverUrlFor: thumbnailUrl } = useHistoryCoverThumbnails(filteredRecords)
+
+// 发布记录详情「公开链接」：与发布结果区同一套「应用内新标签」语义（普通左键接管）
+const { handleLinkClick: openArticleLinkInApp } = useInAppLink()
 const allSelected = computed(() => (
   filteredRecords.value.length > 0
   && filteredRecords.value.every(record => selectedIds.value.includes(record.id))
diff --git a/apps/desktop/src/views/publish-article-link-inapp-wiring.test.js b/apps/desktop/src/views/publish-article-link-inapp-wiring.test.js
new file mode 100644
index 000000000..6923d9ea9
--- /dev/null
+++ b/apps/desktop/src/views/publish-article-link-inapp-wiring.test.js
@@ -0,0 +1,66 @@
+// @ts-check
+/**
+ * 发布结果/发布记录「查看文章」的应用内打开 —— 接线与形状锁（TDD 红灯先行）。
+ *
+ * 为什么需要这把锁（而不是只测行为）：
+ *  1. 最省事的改法是把 `<a>` 换成 `<button>` 或干脆删掉锚点——但那会击穿
+ *     `src/href-scheme-contract.test.js` 的两条**规模下界**锁（带 `:href` 的锚点 ≥6、
+ *     `target="_blank"` 的锚点 ≥6，注释明写其存在意义是「防解析退化后判据恒真」）。
+ *     所以形状必须保持：仍是锚点、仍有 `:href`、仍有 `target="_blank" rel="noopener"`。
+ *  2. 若用 `@click.prevent` 这类无条件拦截，Ctrl/⌘ 点击会被劫持，破坏浏览器语义。
+ *     故本锁要求：拦截必须经由组合式函数（`handleLinkClick`）而**不是** `.prevent` 修饰符，
+ *     由函数内部的 isPlainLeftClick 决定要不要接管。
+ */
+import { describe, it, expect } from 'vitest'
+import { readFileSync } from 'node:fs'
+import path from 'node:path'
+
+const SRC = path.resolve(__dirname, '..')
+
+function readSource (rel) {
+  return readFileSync(path.join(SRC, rel), 'utf8')
+}
+
+/** 取出含指定 class 的那个 <a ...> 起始标签（跨行） */
+function anchorTagWithClass (source, className) {
+  const re = new RegExp('<a\\b[^>]*\\b' + className + '\\b[^>]*>', 'm')
+  const m = source.match(re)
+  return m ? m[0] : null
+}
+
+const CASES = [
+  { file: 'views/Publish.vue', className: 'result-link', label: '发布结果区「查看文章」' },
+  { file: 'views/PublishHistory.vue', className: 'detail-link', label: '发布记录详情「公开链接」' },
+]
+
+describe('应用内打开「查看文章」—— 锚点形状与拦截接线', () => {
+  for (const c of CASES) {
+    describe(`${c.label}（${c.file}）`, () => {
+      it('仍是锚点且保留 :href / target=_blank / rel=noopener（不得为省事删掉锚点）', () => {
+        const tag = anchorTagWithClass(readSource(c.file), c.className)
+        expect(tag, `未找到含 .${c.className} 的锚点起始标签`).toBeTruthy()
+        expect(tag).toMatch(/:href\s*=\s*"safeHttpUrl\(/)
+        expect(tag).toMatch(/target\s*=\s*"_blank"/)
+        expect(tag).toMatch(/rel\s*=\s*"noopener"/)
+      })
+
+      it('点击经由组合式函数接线（而不是裸 @click.prevent）', () => {
+        const tag = anchorTagWithClass(readSource(c.file), c.className)
+        expect(tag).toMatch(/@click\s*=\s*"[^"]*InApp\(/)
+        // `.prevent` 修饰符是无条件拦截，会劫持 Ctrl/⌘ 点击 ⇒ 禁止
+        expect(tag).not.toMatch(/@click\.prevent/)
+      })
+
+      it('接线目标是 useInAppLink 导出的处理器（而非就地内联实现）', () => {
+        const source = readSource(c.file)
+        expect(source).toMatch(/useInAppLink\(\)/)
+        // 处理器必须从组合式函数解构出来（允许别名，但必须同源于同一 import）
+        expect(source).toMatch(/\{\s*handleLinkClick[^}]*\}\s*=\s*useInAppLink\(\)/)
+      })
+
+      it('用组合式函数而非就地重写（单一实现，两处行为不漂移）', () => {
+        const source = readSource(c.file)
+        expect(source).toMatch(/useInAppLink/)
+      })    })
+  }
+})
diff --git a/openspec/records/publish-article-inapp-tab.md b/openspec/records/publish-article-inapp-tab.md
new file mode 100644
index 000000000..a0f49597b
--- /dev/null
+++ b/openspec/records/publish-article-inapp-tab.md
@@ -0,0 +1,39 @@
+---
+record: publish-article-inapp-tab
+task: 发布结果「查看文章」改为应用内新标签打开（普通左键），修饰键与降级保持原浏览器行为
+date: 2026-10-15
+---
+
+## 本次执行记录：发布结果链接应用内打开（publish-article-inapp-tab，2026-10-15）
+
+| 门禁 | 状态 | Fresh 证据 |
+|------|------|-----------|
+| 变更类型与隔离 | ✅ | 运行时代码（renderer 层）：worktree `D:\Data\projects\mp-worktrees\mp-publish-article-inapp-tab`，裸分支 `publish-article-inapp-tab`，建刀基线 `8e9109a55`＝当时 origin/main |
+| 第一性原因（QM-5 ①） | ✅ | 用户被弹到系统浏览器：`Publish.vue` 的 `<a target="_blank">` 经主进程 `window.js` 的 `setWindowOpenHandler` → `openExternalUrl()`（shell.openExternal）。根因是「外链一律外开」这一默认策略没有「应用内优先」的通道，而非某处写错 |
+| 逃逸分析（QM-5 ②） | ✅ | 该行为此前无测试覆盖：`Publish.test.js` 只断言锚点属性（href/rel/降级纯文本），从未断言「点击后会发生什么」——即点击行为是测试盲区。同理 `href-scheme-contract.test.js` 只管形状与协议，不管点击去向 |
+| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `src/composables/useInAppLink.js`（单一实现，两处视图共用）；接线 `Publish.vue` + `PublishHistory.vue`；回归保护三件套：`useInAppLink.test.js`（14 例，C1-C4 行为契约）、`publish-article-link-inapp-wiring.test.js`（8 例，形状+接线锁）、`href-scheme-contract.test.js` 既有 16 例（含新登记项） |
+| 防止再次发生（QM-5 ⑤） | ✅ | ①形状锁防「为省事删锚点/换 button」：显式断言 `:href`/`target=_blank`/`rel=noopener` 三属性在位；②禁 `@click.prevent` 无条件修饰符（会劫持 Ctrl/⌘），必须经 `isPlainLeftClick` 分流；③新 `window.open` 站点按既有契约登记到 `OPEN_SITES_GUARDED_IN_MAIN`，与同族先例 `usePublishHistoryContentLink.js` 同构 |
+| 行尾与 diff 对账 | ✅ | 两口径 `numstat` 相等；`href-scheme-contract.test.js` 的登记注释改写未触碰行尾（该文件既有 CRLF 保持一致） |
+| 接线棘轮 | ✅ | 新增两个测试文件均在 vitest.config.js 的既有 include（`src/**/*.test.{js,ts}`）内，无需改 workflow |
+| QM-1 打包 / QM-4 视觉 | N/A | 未触打包配置与视觉面；无新增/改动样式与文案 |
+| QM-6 CCG 双模型外部评审 | 见下 | 按本机后端可用性实测后执行/如实登记 |
+| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间；`git ls-remote --heads origin publish-article-inapp-tab` 返回 0 行证远端分支已删；回填后删除本段三个 sync_* 字段 |
+
+### 设计取舍（PRD §5 展开）
+
+- **不注入账号登录态**：`createNewTabPage` 不传 accountId 时用 `persist:browse-<tabId>` 一次性分区；传 accountId 会恢复该账号凭据。发布结果当前不携带 accountId，且「把账号凭据注入一个由平台响应决定的任意 URL」会扩大凭据暴露面。代价：需登录页面在标签内显示登录页（与系统浏览器现状一致，不构成回归）。
+- **保留锚点**：`href-scheme-contract.test.js` 有两条规模下界锁（`:href` 锚点 ≥6、`target=_blank` 锚点 ≥6），删/改锚点即击穿既有护栏。
+- **降级走 `window.open`**：由主进程 `setWindowOpenHandler` 统一接管，`isAllowedExternalUrl` 比渲染层更严，形成纵深防御；与既有同族先例同构。
+
+### 测试读数（当场实跑，不做换算）
+
+- `useInAppLink.test.js`：14/14 通过（TDD 红灯先行——模块不存在时报 transform 失败，实现后转绿）
+- `publish-article-link-inapp-wiring.test.js`：8/8 通过（首跑 2 红：别名导致判据过严，修正判据为「经组合式函数 + 禁 `.prevent`」后转绿）
+- `href-scheme-contract.test.js`：16/16 通过（首跑 1 红：新增 `window.open` 站点未登记——该契约按设计工作，登记后转绿）
+- `Publish.test.js`：126 通过；`PublishHistory.test.js`：83 通过；`usePublishHistoryContentLink.test.js`：8 通过
+
+### 遗留（不假装已闭合）
+
+- 「查看文章」若要进入已登录账号会话，需先给发布结果补 accountId 并单独评估凭据注入面（独立决策）。
+- `persist:browse-<tabId>` 一次性分区：应用内标签里登录的站点，关闭标签后登录态不保留；是否改「共享浏览分区」属既有架构议题。
+- 手动验证（真机点一次发布结果链接）待用户侧确认；本刀自动化证据为行为契约 + 接线锁 + 既有回归。

```

> 这是机械生成的变更提案，不代表任何设计意图。评审方请只针对上述内容挑刺。