# PRD：发布结果「查看文章」改为应用内新标签打开

> 分支 `publish-article-inapp-tab`｜日期 2026-10-15｜变更类型：运行时代码（renderer 层）
> 关联：`PRD-PUBLISH-HISTORY-CARD-OPEN-LINK-2026-10-03.md`（同族先例）、`PRD-HREF-SCHEME-GUARD-2026-09-29`（协议门禁）

## 1. 背景与问题

发布成功后，「发布进度」结果区显示「查看文章 →」。该链接是原生 `<a target="_blank">`，
点击由主进程 `webContents.setWindowOpenHandler` 接管并调用 `shell.openExternal()`，
**跳到系统默认浏览器**（`apps/desktop/electron/window.js` 的 `openExternalUrl`）。

用户视角的问题：正在应用内工作，点一下就被弹出到系统浏览器；且系统浏览器与应用内账号
体系无关，打开需要登录的页面时同样是登录墙，来回切换成本高。

发布记录详情（`PublishHistory.vue`）的「公开链接」是同一语义的另一处，行为一致。

## 2. 目标 / 非目标

**目标**：左键单击「查看文章」→ 在应用内**新开一个标签页**加载该 URL，并自动切到该标签。

**非目标（明确不做）**：
- 不改结果区的显示项、文案、位置、样式。
- 不改 URL 的生成与清洗（`sanitizePublishResultUrl` 的既有职责）。
- 不把账号登录态注入该标签（见 §5.1）。
- 不改「复制链接」按钮行为。
- 不改其它外链点位（热门选题、影视工程来源链接、播客端点等）——只覆盖发布结果区与发布记录详情两处「查看作品」语义。
- 不改主进程 `openExternalUrl` / `isAllowedExternalUrl` 的判据。

## 3. 功能逻辑

### 3.1 主路径（左键单击）
1. 用户在结果区左键单击「查看文章」。
2. `isPlainLeftClick(event)` 判定：左键 ∧ 无 Ctrl/⌘/Shift/Alt。
3. `safeHttpUrl(result.url)` 清洗目标 URL；为 `null` 则**不接管**（交给默认行为，与既有「降级纯文本」的安全边界一致）。
4. `event.preventDefault()` 阻止默认外跳。
5. `tabStore.createTab({ url })`（IPC `page-manager:create-new-tab-page`）。
6. 返回非空 `tabId` → `tabStore.switchToTab(tabId)` 切到新标签。

### 3.2 覆盖点位
| 点位 | 文件 | 说明 |
|---|---|---|
| 发布结果区「查看文章 →」 | `src/views/Publish.vue`（`.result-link`） | 本 PR 主目标 |
| 发布记录详情「公开链接」 | `src/views/PublishHistory.vue`（`.detail-link`） | 同一「查看作品」语义，同步改造 |

两处共用 `src/composables/useInAppLink.js`，行为不漂移。

### 3.3 交互逻辑（点击修饰键语义）
| 点击方式 | 行为 | 理由 |
|---|---|---|
| 左键单击（无修饰键） | 应用内新标签打开并切换 | 主路径 |
| Ctrl / ⌘ / Shift / Alt + 单击 | **不拦截**，保持浏览器默认（最终仍是系统浏览器） | 修饰键是用户明确的「另开/新窗口」意图，应用不得改写 |
| 中键单击 | 不触发 click 事件，天然不干预 | — |
| 右键 | 不拦截，「复制链接地址」等原生菜单可用 | 保留原生可访问性 |
| 键盘激活（Enter/Space） | `button` 为 0 且无修饰键 → 视同普通左键 | 与其它按钮的可访问性行为一致 |

### 3.4 降级与失败处理（必须显式，不得静默）
| 失败点 | 处理 |
|---|---|
| 桥不可用 / store 未初始化 | `createTab` 抛错或返回 `null` → 降级 `window.open(url,'_blank','noopener')` → 主进程 `setWindowOpenHandler` → `openExternalUrl` 系统浏览器（＝改造前行为） |
| `switchToTab` 抛异常 | 标签**已建成**，返回成功（不回退成 false——那会造成「应用内 + 系统浏览器」双开） |
| `safeHttpUrl` 返回 `null` | 不接管、不降级，交给默认行为（纯文本分支既有形态） |

**顺序约束**：必须先 `preventDefault()` 再尝试应用内打开。反过来会在降级路径出现
「系统浏览器 + 应用内标签」双开。

**提示文字**：主路径不弹提示（开标签本身就是反馈）；降级路径与改造前行为完全一致，
故不加提示，避免噪声。**未新增任何 i18n key。**

## 4. 数据校验与显示项

- **数据面**：只有一个已清洗的 URL 字符串。`safeHttpUrl` 只按前缀放行 `http://` / `https://`
  （大小写不敏感），不做归一化；不通过即 `null`（沿用 `PRD-HREF-SCHEME-GUARD` 三条口径）。
- **凭据面**：不读取、不写入、不转发任何 Cookie / 账号凭据。普通标签使用
  `persist:browse-<tabId>` 一次性分区（`tab-lifecycle.js` 既有行为）。
- **显示项**：无新增/无改动。链接文本仍为 `publishPage.viewArticle`（zh「查看文章 →」／en「View Article →」）。
- **标签标题**：**不向** `createNewTabPage` 传 `title`——让标签标题随后由页面标题自然回填，
  避免被固定成无信息量的字面量。

## 5. 关键取舍（含被否方案）

### 5.1 不注入账号登录态
`createNewTabPage` 在**不传 accountId** 时使用 `persist:browse-<tabId>` 一次性分区；传
accountId 会用持久账号分区并恢复该账号凭据。发布结果目前**不携带 accountId**（只有
`url` / `platform` / `postId`），且「把账号凭据注入一个由平台响应决定的任意 URL」会显著
扩大凭据暴露面。

**决策：普通标签打开。** 代价：需要登录的页面（如小红书创作者页）在标签里会显示登录页
——与现状（系统浏览器）一致，不构成回归。
被否方案：为拿 accountId 而改动发布结果形状与进度通道（收益小、面更大）。

### 5.2 保留 `<a>` 元素，只拦截点击
`src/href-scheme-contract.test.js` 有两条**规模下界**锁：带 `:href` 的锚点 ≥6、
`target="_blank"` 的锚点 ≥6（注释明写其存在意义是「防解析退化后判据恒真」）。删除或改写
锚点会击穿既有护栏，属「削弱门禁换实现便利」。

**决策：保留锚点形状**（`:href` / `target="_blank"` / `rel="noopener"` 全部不动），
仅在 `@click` 上接线；且**不用** `@click.prevent`（无条件修饰符会劫持 Ctrl/⌘ 点击），
由函数内部 `isPlainLeftClick` 决定是否接管。接线锁
`src/views/publish-article-link-inapp-wiring.test.js` 钉住这两点。

### 5.3 降级用 `window.open` 而非 `shell.openExternal`
降级走 `window.open(url,'_blank','noopener')`，由主进程 `setWindowOpenHandler` 统一接管：
主进程侧的 `isAllowedExternalUrl` 判据比渲染层更严，天然形成纵深防御；同时与既有
同族先例 `usePublishHistoryContentLink.js` 完全同构（后者已在
`OPEN_SITES_GUARDED_IN_MAIN` 在册，本 PR 同样登记）。

## 6. 回归保护

| 测试 | 锁什么 |
|---|---|
| `src/composables/useInAppLink.test.js`（14 例） | C1 修饰键/非左键不接管；C2 成功路径 createTab→switchToTab；C3 失败一律返回 false 且不抛（含非 http(s) 不建标签）；C4 handleLinkClick 的接管/降级/顺序 |
| `src/views/publish-article-link-inapp-wiring.test.js`（8 例） | 两处锚点形状保持、接线经组合式函数、无 `@click.prevent` |
| `src/href-scheme-contract.test.js`（既有 16 例） | 新增 `window.open` 站点已登记；锚点规模下界与 noopener 锁不被击穿 |

## 7. 影响面

- 修改：`src/views/Publish.vue`、`src/views/PublishHistory.vue`、`src/href-scheme-contract.test.js`（登记项）
- 新增：`src/composables/useInAppLink.js`、`src/composables/useInAppLink.test.js`、`src/views/publish-article-link-inapp-wiring.test.js`
- 不触：主进程、平台协议、凭据体系、i18n（无新 key）

## 8. 遗留与后续（登记，不假装闭合）

- 若后续希望「查看文章」直接进入**已登录的账号会话**，需先在发布结果里补 `accountId`
  并单独评估凭据注入面；属独立决策，不在本刀。
- `persist:browse-<tabId>` 为一次性分区：在应用内标签里登录的站点，关闭标签后登录态不保留。
  是否改为「共享浏览分区」是既有架构议题，不在本刀。
- 本刀的「应用内打开」只覆盖发布结果区与发布记录详情；其它外链点位维持系统浏览器。
