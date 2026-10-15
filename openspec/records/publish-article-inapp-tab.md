---
record: publish-article-inapp-tab
task: 发布结果「查看文章」改为应用内新标签打开（普通左键），修饰键与降级保持原浏览器行为
date: 2026-10-15
---

## 本次执行记录：发布结果链接应用内打开（publish-article-inapp-tab，2026-10-15）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（renderer 层）：worktree `D:\Data\projects\mp-worktrees\mp-publish-article-inapp-tab`，裸分支 `publish-article-inapp-tab`，建刀基线 `8e9109a55`＝当时 origin/main |
| 第一性原因（QM-5 ①） | ✅ | 用户被弹到系统浏览器：`Publish.vue` 的 `<a target="_blank">` 经主进程 `window.js` 的 `setWindowOpenHandler` → `openExternalUrl()`（shell.openExternal）。根因是「外链一律外开」这一默认策略没有「应用内优先」的通道，而非某处写错 |
| 逃逸分析（QM-5 ②） | ✅ | 该行为此前无测试覆盖：`Publish.test.js` 只断言锚点属性（href/rel/降级纯文本），从未断言「点击后会发生什么」——即点击行为是测试盲区。同理 `href-scheme-contract.test.js` 只管形状与协议，不管点击去向 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `src/composables/useInAppLink.js`（单一实现，两处视图共用）；接线 `Publish.vue` + `PublishHistory.vue`；回归保护三件套：`useInAppLink.test.js`（14 例，C1-C4 行为契约）、`publish-article-link-inapp-wiring.test.js`（8 例，形状+接线锁）、`href-scheme-contract.test.js` 既有 16 例（含新登记项） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①形状锁防「为省事删锚点/换 button」：显式断言 `:href`/`target=_blank`/`rel=noopener` 三属性在位；②禁 `@click.prevent` 无条件修饰符（会劫持 Ctrl/⌘），必须经 `isPlainLeftClick` 分流；③新 `window.open` 站点按既有契约登记到 `OPEN_SITES_GUARDED_IN_MAIN`，与同族先例 `usePublishHistoryContentLink.js` 同构 |
| 行尾与 diff 对账 | ✅ | 两口径 `numstat` 相等；`href-scheme-contract.test.js` 的登记注释改写未触碰行尾（该文件既有 CRLF 保持一致） |
| 接线棘轮 | ✅ | 新增两个测试文件均在 vitest.config.js 的既有 include（`src/**/*.test.{js,ts}`）内，无需改 workflow |
| QM-1 打包 / QM-4 视觉 | N/A | 未触打包配置与视觉面；无新增/改动样式与文案 |
| QM-6 CCG 双模型外部评审 | 见下 | 按本机后端可用性实测后执行/如实登记 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H\|%cI` 回填 merge SHA 与时间；`git ls-remote --heads origin publish-article-inapp-tab` 返回 0 行证远端分支已删；回填后删除本段三个 sync_* 字段 |

### 设计取舍（PRD §5 展开）

- **不注入账号登录态**：`createNewTabPage` 不传 accountId 时用 `persist:browse-<tabId>` 一次性分区；传 accountId 会恢复该账号凭据。发布结果当前不携带 accountId，且「把账号凭据注入一个由平台响应决定的任意 URL」会扩大凭据暴露面。代价：需登录页面在标签内显示登录页（与系统浏览器现状一致，不构成回归）。
- **保留锚点**：`href-scheme-contract.test.js` 有两条规模下界锁（`:href` 锚点 ≥6、`target=_blank` 锚点 ≥6），删/改锚点即击穿既有护栏。
- **降级走 `window.open`**：由主进程 `setWindowOpenHandler` 统一接管，`isAllowedExternalUrl` 比渲染层更严，形成纵深防御；与既有同族先例同构。

### 测试读数（当场实跑，不做换算）

- `useInAppLink.test.js`：19/19 通过（TDD 红灯先行——模块不存在时报 transform 失败，实现后转绿；CCG 评审后补 C5 失败不变式 5 例，其中 2 例先红后绿）
- `publish-article-link-inapp-wiring.test.js`：8/8 通过（首跑 2 红：别名导致判据过严，修正判据为「经组合式函数 + 禁 `.prevent`」后转绿）
- `href-scheme-contract.test.js`：16/16 通过（首跑 1 红：新增 `window.open` 站点未登记——该契约按设计工作，登记后转绿）
- `Publish.test.js`：126 通过；`PublishHistory.test.js`：83 通过；`usePublishHistoryContentLink.test.js`：8 通过

### CCG 双模型外部评审（QM-6）

- **执行**：跨家族校验通过（proposer=opencode / critic=claude）；claude critic 提出 4 条 findings，**0 条高危域**（无需外部复核）。
- **裁决**（`.adversarial/ccg-deep-0b4988a7/adjudication.json`）：
  - **r1-i2 upheld+fixed**：`await openInAppTab(safe)` 未纳 try、且 `safeHttpUrl` 也在 try 外——未预期抛错会导致「无默认、无应用内、无降级」的静默死点击，违背自身口径。修复：降级下沉到 `openInAppTab` 内部闭环。
  - **r1-i4 upheld+fixed**：`openInAppTab` 公开导出但失败不兜底，将来直接调用者会静默失败。与 i2 同一次修复解决（失败不变式成为单一函数契约）。
  - **r1-i1 dismissed（实证驳回）**：指控接线锁对 `PublishHistory` 锚点失明（其 href 多包一层 `publicLinkHref`）。实测：用同款正则在该锚点上逐条跑，五条断言（href/click/blank/noopener/no-prevent）**全部真实通过**——正则不要求括号后紧跟 `result.url`。
  - **r1-i3 dismissed（实证驳回）**：指控 `.ccg/reviews/<基线sha>.json` 与深度评审产物互相矛盾。实际两者用途不同（前者是 pre-commit ccg-gate 判定器写在父 sha 上的门禁记录，后者是深度评审产物，sha 与 head 一致），changedLines 383 与 648 也是不同口径。
- **修复过程的自曝缺陷**：C5 首版实现把 `switchToTab` 失败也扫进降级，被既有用例当场抓住（会造成双开）——已修正为「标签已建成则不降级」。

### 遗留（不假装已闭合）

- 「查看文章」若要进入已登录账号会话，需先给发布结果补 accountId 并单独评估凭据注入面（独立决策）。
- `persist:browse-<tabId>` 一次性分区：应用内标签里登录的站点，关闭标签后登录态不保留；是否改「共享浏览分区」属既有架构议题。
- 手动验证（真机点一次发布结果链接）待用户侧确认；本刀自动化证据为行为契约 + 接线锁 + 既有回归。
