---
record: publish-article-inapp-tab
task: 发布结果「查看文章」改为应用内新标签打开（普通左键），修饰键与降级保持原浏览器行为
date: 2026-10-15
---

## 本次执行记录：发布结果链接应用内打开（publish-article-inapp-tab，2026-10-15）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（renderer 层）：隔离 worktree `mp-publish-article-inapp-tab`（worktree 根不在本记录里落绝对路径——本机路径会随机器变，落进记录就等于给 Gate 12c 添一条新命中），裸分支 `publish-article-inapp-tab`，建刀基线 `8e9109a55`＝当时 origin/main |
| 第一性原因（QM-5 ①） | ✅ | 用户被弹到系统浏览器：`Publish.vue` 的 `<a target="_blank">` 经主进程 `window.js` 的 `setWindowOpenHandler` → `openExternalUrl()`（shell.openExternal）。根因是「外链一律外开」这一默认策略没有「应用内优先」的通道，而非某处写错 |
| 逃逸分析（QM-5 ②） | ✅ | 该行为此前无测试覆盖：`Publish.test.js` 只断言锚点属性（href/rel/降级纯文本），从未断言「点击后会发生什么」——即点击行为是测试盲区。同理 `href-scheme-contract.test.js` 只管形状与协议，不管点击去向 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `src/composables/useInAppLink.js`（单一实现，两处视图共用）；接线 `Publish.vue` + `PublishHistory.vue`；回归保护三件套：`useInAppLink.test.js`（14 例，C1-C4 行为契约）、`publish-article-link-inapp-wiring.test.js`（8 例，形状+接线锁）、`href-scheme-contract.test.js` 既有 16 例（含新登记项） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①形状锁防「为省事删锚点/换 button」：显式断言 `:href`/`target=_blank`/`rel=noopener` 三属性在位；②禁 `@click.prevent` 无条件修饰符（会劫持 Ctrl/⌘），必须经 `isPlainLeftClick` 分流；③新 `window.open` 站点按既有契约登记到 `OPEN_SITES_GUARDED_IN_MAIN`，与同族先例 `usePublishHistoryContentLink.js` 同构 |
| 行尾与 diff 对账 | ✅ | 两口径 `numstat` 相等；`href-scheme-contract.test.js` 的登记注释改写未触碰行尾（该文件既有 CRLF 保持一致） |
| 接线棘轮 | ✅ | 新增两个测试文件均在 vitest.config.js 的既有 include（`src/**/*.test.{js,ts}`）内，无需改 workflow |
| QM-1 打包 / QM-4 视觉 | N/A | 未触打包配置与视觉面；无新增/改动样式与文案 |
| QM-6 CCG 双模型外部评审 | 见下 | 按本机后端可用性实测后执行/如实登记 |
| 远程同步 | 由门禁推导 | 合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；**本行不需要事后改写**——把 merge SHA 回填进仓库文件会造出「必须为改写这一行另开一次 PR」的循环。合并后的读数写在 PR 评论里 |

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
- **首轮 8 条里 4 条 Info 的处置（首轮裁决表只收了 4 条争议项，Info 项在此补齐，审计链不留空档）**：
  - **i5（PublishHistory 卡片已有 `usePublishHistoryContentLink` 的开标签逻辑）**——**不采纳为缺陷**：
    两者是**不同的点击入口**（卡片交互 vs 详情里的「公开链接」锚点），且首轮 i1 的实测已证明接线锁
    对该锚点逐条断言全部真实通过（详见 r1-i1 的驳回证据）。「卡片已能开标签 ⇒ 详情链接不该开标签」
    反而会让详情链接**退回系统浏览器**，与本片目标相反。
  - **i6（`switchToTab` 失败时「标签已建但未聚焦」无埋点，事后难诊断）**——**认领为遗留，不在本片修**：
    该路径的**用户可见行为**已在实现里写死（标签已建 ⇒ 用户自己点那个标签即可；**不降级**，否则变
    「应用内 + 系统浏览器」双开），但**缺少可观测性**；补埋点属跨切片的观测面改动（要定事件名与
    上报通道），本片不夹带。已登记为遗留项（见下）。
  - **i7（`safeHttpUrl` 每渲染调 2 次；`@click` 传原始 `result.url` 而 `:href` 用清洗值）**——**实证驳回**：
    `handleLinkClick` 内部**自己再调一次** `safeHttpUrl(url)` 才建标签（`useInAppLink.js` 的
    `handleLinkClick` → `const safe = safeHttpUrl(url)`），所以**应用内打开的 URL 与 `:href` 用的是同一个
    清洗值**，「未来若 `safeHttpUrl` 做归一化则两处不一致」不成立（两处走的是同一个函数）。
    渲染期的两次调用是**同一表达式求值两次**，属可优化项、非正确性缺陷。
  - **i8（一次性分区标签加载第三方 http/https URL，无浏览器边界标识，明文 http 可被中间人篡改）**——
    **认领为安全遗留并记明缓解边界**（本片不改，见下「遗留」与「高危域处置」）：
    本片的缓解是**不注入任何账号凭据**（`persist:browse-<tabId>` 一次性分区，无会话）⇒ 中间人看到的
    也只是「无会话的第三方页面」；且 `safeHttpUrl` 只放行 http/https，协议层不放宽。
    「强制 https-only」会**直接掐断平台返回 http 链接的发布结果**（行为变更，需独立评估）；
    「标签页可见来源标识」属标签栏的 UI 面改动（刀 4 之外）。两条都不在本片夹带，如实登记。
- **高危域处置（2026-10-23 收口轮）**：收口轮的外部评审把 i8 同类问题标为 **highRiskDomains=['crypto']**
  （一次性分区标签加载第三方 URL 的明文/中间人风险）。按门禁口径，高危域争议项**不允许自扮演豁免**，
  必须有外部复核证据。处置：① 外部 critic（claude）**确实评审了这一条**（本片第 1 轮的 i8 与收口轮的
  高危项是同一条风险）；② 外部复核结论与逐条处置写在 **PR #3624 评论**（可公开点开核对），
  判定记录 `deepReview.findings[].externalReview` 里回填该评论 URL、复核后端与时间；
  ③ 风险与缓解边界如实登记为遗留（不注入凭据 / 协议不放宽 / 强制 https-only 与来源标识两条的处置理由）。

### 遗留（不假装已闭合）

- 「查看文章」若要进入已登录账号会话，需先给发布结果补 accountId 并单独评估凭据注入面（独立决策）。
- `persist:browse-<tabId>` 一次性分区：应用内标签里登录的站点，关闭标签后登录态不保留；是否改「共享浏览分区」属既有架构议题。
- 手动验证（真机点一次发布结果链接）待用户侧确认；本刀自动化证据为行为契约 + 接线锁 + 既有回归。
- **可观测性欠账（首轮 i6）**：`switchToTab` 失败时「标签已建但未聚焦」这条路径**没有埋点**，
  事后难以区分「用户没点」与「点了没切过去」。用户可见行为已写死（不降级，避免双开），缺的是可观测性。
  补埋点要定事件名与上报通道，属跨切片的观测面改动 ⇒ 另案，不在本片夹带。
- **安全遗留（首轮 i8 / 收口轮高危项）**：应用内标签加载的是**平台返回的第三方 URL**（http/https），
  标签页**没有可见的来源标识**，明文 http 可被中间人篡改。本片的缓解是**不注入任何账号凭据**
  （一次性分区、无会话）⇒ 中间人看到的也只是无会话页面；`safeHttpUrl` 不放宽协议。
  两条候选处置**都不在本片夹带**：① 强制 https-only 会直接掐断平台返回 http 链接的发布结果（行为变更，
  需独立评估）；② 标签栏可见来源标识属标签栏 UI 面（刀 4 之外）。外部复核结论见 PR #3624 评论。

### 2026-10-23 收口：rebase 到当前主干 + 一处「点名还账」目标值上调（已写明理由）

- **rebase**：本分支原基线是 `8e9109a55`（2026-10-15 的主干），落后当前主干数百个提交，且带一条
  已被主干吸收的同名判定记录（`8e9109a5…`）。收口时把两个提交压成一次正常提交（让 pre-commit 的
  判定器为**最终差量**重新生成记录），并把那条与主干逐字节相同的记录恢复成主干版本（**不删**：
  「删除产物不等于完成评审」，删了反而是门禁判定的违规项）。rebase 后复跑：`useInAppLink` + 接线锁 +
  `href-scheme-contract` 共 **43/43 绿**；`Publish.test.js` / `PublishHistory.test.js` / 同族 composable
  一并复跑 **61 文件 / 1258 例全绿**。
- **一处目标值上调（已写明理由，量 = 实际增量，不给余量）**：CI 的「逐文件行数门禁」把
  `apps/desktop/src/views/Publish.vue` 列在**点名还账**（容差 0）清单里，目标值 1773 行，而该文件在
  当前主干上**正好 1773 行**（顶格）⇒ 本 PR 只要给它加一行就判红（实测：CI 报「现 1777 行已超过点名
  目标 1773 行（超 4）」）。
  - **为什么压不到 0 行**：本 PR 自己的接线锁
    `apps/desktop/src/views/publish-article-link-inapp-wiring.test.js` 明文要求视图**必须调用
    `useInAppLink()` 并从它解构 `handleLinkClick`**（锁的理由是「单一实现、两处视图行为不漂移」，
    并禁止 `@click.prevent` 无条件拦截）。⇒ 视图侧最小成本 = 1 行 import + 1 行解构 = **+2 行**；
    唯一能做到 0 行的形态是「handler 改成模块级导出」，而那会让**接线锁判红**（它要求 source 里出现
    `useInAppLink()` 的解构形态）。两把锁在此**机制性冲突**，0 行不可达。
  - **处置**：按该门禁**自述的出口**「降到目标以下，或在 review 中说明理由后一并上调 targets」处理，
    把 `max-lines-baseline.json` 的 `targets["apps/desktop/src/views/Publish.vue"]` 由 1773 上调为
    **1775（= 实际增量 +2，零余量）**，理由全文写进 baseline 的 `//` 字段（与前次上调同一体例）。
  - **边界如实写明**：该文件**仍整体超 500 行上限、仍挂账待还**，本次只解决「这次接线必需的那 2 行」，
    没有借机扩大任何余量；后续要把它降回目标值，正确做法仍是把发布页逻辑拆到 `features/publish/**`
    的独立模块，而不是回退本次契约。
- **本 PR 的深度评审记录**（`status=cleared`，`tier=external`，写回成功）：评审对象是**压平后、rebase 到
  当前主干的最终差量**；前一轮（.adversarial/ccg-deep-0b4988a7/）的 4 条指控里 2 条成立、已在压平前
  的第二个提交里修掉（i2/i4：应用内链接失败不变式、降级下沉到 `openInAppTab`），2 条驳回，裁决表随
  本 PR 入库作为证据。
