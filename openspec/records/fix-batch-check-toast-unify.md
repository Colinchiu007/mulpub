---
record: fix-batch-check-toast-unify
task: 一键检测提示统一为一条汇总 + 卡片登录态刷新兜底（4 条互相矛盾的 toast 收敛为 1 条；loginStatus 缺失时按三态结论兜底刷新卡片徽章）
date: 2026-10-22
branch: fix-batch-check-toast-unify
---

# 执行记录：一键检测提示统一 + 卡片刷新兜底（fix-batch-check-toast-unify，2026-10-22）

## 0. 动因（用户实测反馈，附截图）

账号页点「一键检测」，**先后弹出约 4 条文字提示，且几条内容互相矛盾**：

> ① 检测完成：4 个正常，0 个失效，6 个未取到定论（保持原状态）
> ② 5 个账号需要重新登录；1 个账号请稍后重试
> ③ 检测完成，但有 1 个账号的登录状态未能保存到服务端，请重试或检查后端服务

以及：**进行完一键检测后，账号卡片的登录状态没有任何刷新和变化**，还是老的不准确的状态。

用户同时要求：修改代码以独立分支/worktree 隔离（非 C 盘）；有价值内容落内置记忆、外部记忆与 EverOS；
更新补进 PRD 与相关文档；跑质量节拍；推送 GitHub、开 PR、CI 通过后自动合并。

## 1. 第一性原因（QM-5 ①）

**两个现象同一根：检测结论有了，但"怎么告诉用户"与"怎么让用户看见"两条链路都断在最后一米。**

**现象 A（4 条矛盾提示）**——`Accounts.vue` 的 `batchCheckAllLogins()` 依次弹 4 条 toast：

| # | 原位置 | 级别 | 问题 |
|---|---|---|---|
| ① | `notifyInfo('batchCheckAllStarted')` | info | 进度噪音；已由同一 `v-if` 的全屏遮罩 `batch-check-overlay`（45% 深色 + blur，z-index 300）承载，toast 在遮罩底层**被盖住不可读** |
| ② | `notifyWarning('batchCheckAllDone')` | warning | 只报数，不说该做什么 |
| ③ | `notifyInfo('checkHintsSummary')` | info | 与 ② **同源数据**（都来自 `item.hint.action` 聚合）却分两条；文案读不出它与 ② 的关系 |
| ④ | `notifyError('batchCheckAllPersistFailed')` | **error** | 红色 error 把「部分账号结论没落库」渲染成「整个检测失败」 |

用户读到的"矛盾"精确来自 **② 说「0 个失效」而 ③ 说「5 个账号需要重新登录」**。两句其实在说**同一批账号**：6 个未取到定论里 5 个的 `reason` 是 `no-cookie`/`credential-file-only`/`no-positive-evidence` 这类负向倾向证据，被 `login-status-hints.js` 映射成 `action: 'relogin'`。但两句各自独立成 toast，用户无法看出指代关系，只能读成"检测说没问题，又让我重登 5 个"。

**现象 B（卡片不刷新）**——原实现 `Accounts.vue:1090` 只有一个条件：

```js
if (item.loginStatus) account.status = item.loginStatus
```

`loginStatus` = `outcome.status || outcome.keptStatus`（`account.js:722`）。当主进程 `readAccountSnapshot()`（`GET /api/accounts/{id}`）**读不到真源现状**时 `keptStatus` 为 `null` ⇒ `loginStatus` 为 `null` ⇒ **整段跳过** ⇒ 卡片徽章一动不动。而本轮检测自己的三态结论此刻是唯一可得证据，却被丢掉。

## 2. 逃逸分析（QM-5 ②）

| 层 | 为什么没拦住 |
|---|---|
| 单元测试 | 既有测试只锁"`ElMessage.warning` 被调用过"这类存在性断言，**没有任何测试数 toast 条数**，所以 4 条与 1 条测起来一样绿 |
| 集成测试 | `account-login-state-tristate.js` 的 E2E 用 `/1\s*个失效/` + `/2\s*个未取到定论（保持原状态）/` 两条独立正则匹配 `body.innerText`，**对条数不敏感**（多条 toast 文本都堆在 body 里） |
| 代码审查 | 4 次 notify 分散在函数尾部 4 个独立 `if` 里，每次看都像"各自负责一件事"；没人把它们当成"一次用户操作的反馈总和"来审 |
| 流程 | 「一次操作一条提示」从未被写成需求条目，所以没有判据可依 |

## 3. 系统性漏洞定位（QM-5 ③）

分类：**测试场景缺失**（结果提示无条数契约）+ **审查盲区**（多 notify 被逐个看而非整体看）+ **流程缺失**（无"一次操作一条提示"的需求条目）。
具体落点：`apps/desktop/src/views/Accounts.test.js` 全文无数 toast 条数的断言；`01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` §4.3 只写"汇总提示正常/失效数量"，未规定条数与段序。

## 4. 修复 + 回归保护（QM-5 ④）

### 4.1 修复内容

| 文件 | 变更 |
|---|---|
| `apps/desktop/src/views/batch-check-summary.js` | **新增装配器**（87 行）。纯函数 `buildBatchCheckSummary({六项计数, t})` → `{level, message}\|null`。段序恒定 计数 → 下一步 → 固化失败；空段 `filter(Boolean)` 消除；级别只由三态结论决定 |
| `apps/desktop/src/views/Accounts.vue` | 删「开始检测」toast；4 条 notify 收敛为 1 条（调装配器）；卡片刷新加三态兜底（`loginStatus` → `valid===true/false` → 不动）。净增 5 行内，靠压缩历史注释回到 1577 ≤ 登记值 1578 |
| `apps/desktop/src/locales/accounts-page/{zh,en}.js` | 新增 `checkHintsSummaryInline`、`checkHintsPersistFailedInline` 两个键（zh/en 成对）；5 个不再使用的键逐条标注「一键检测不再使用」 |
| `apps/desktop/src/views/AccountsBatchCheck.test.js` | **新增**（831 行）：一键检测 19 例整体迁出 `Accounts.test.js` + 本次新增 8 例 |
| `apps/desktop/src/views/batch-check-summary.test.js` | **新增**（17 例）：装配器单测 |
| `apps/desktop/src/locales/accounts-batch-check-copy.test.js` | 4 → 14 例：两个新键的 zh/en 逐字面量 + 三段条件形态 + 空串契约 |
| `01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` | 新增 §20（数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文案表 / 回归保护 / 边界），版本 2.3 → 2.5 |

### 4.2 卡片刷新兜底的优先级（本次核心逻辑）

```
主进程 loginStatus（真源现状）  →  最高
        │ null 时降级
        ▼
item.valid（检测三态结论）      →  中间级（本次新增）
        │ undefined 时
        ▼
什么都不做                      →  最低
```

第一级保留是为了锁住「检测有效、但另一写者刚把真源改成 `unverified`」时展示层不得反超真源；第二级只在严格 `true`/`false` 时动，**不绕过单向证据规则**（规则只禁"把无定论伪造成结论"）。

### 4.3 回归保护测试落点

| 模式 | 文件 | 例数 | 锁什么 |
|---|---|---|---|
| 单元 | `src/views/batch-check-summary.test.js` | 17 | 单对象不数组 / 段序不可交换 / 空段不泄漏分隔符（5 组合穷举）/ 定级只由三态决定 / 永不产出 error 级 |
| 组件 | `src/views/AccountsBatchCheck.test.js` | 19 | 最坏形态只 1 条 / 开始检测不弹 info / 全正常 1 条 success / IPC 整体失败仍独立 error / 卡片兜底 3 例 |
| 文案结构 | `src/locales/accounts-batch-check-copy.test.js` | 14 | 新键 zh/en 逐字面量 + 「其中」前缀存在性 + 不复用红色错误措辞 |

## 5. 变异反证（QM-5 ④ 的必要组成）

| 探针 | 改动 | 结果 |
|---|---|---|
| A | 把卡片兜底摘掉，回到 `if (item.loginStatus) account.status = …` 单条件 | **1 failed**（`loginStatus 缺失但检测有明确结论时…`） |
| B | 从汇总句删掉下一步段（`[summary, persistSeg]`） | **1 failed**（`最坏形态…只弹 1 条结果 toast`） |
| C | 把固化失败恢复成独立红色 error toast | **1 failed**（同上，`t.error` 不再为空） |

三次均当场红；全部还原后 164/164 绿。⚠️ 探针 A 的还原**第一次没生效**（PowerShell 正则锚点与实际缩进不匹配，`Select-String` 显示已还原但文件仍是探针形态），是全量复跑时发现的——**"以为还原了"不等于"还原了"，必须复跑全量才算数**。

## 6. 质量门禁自检

| 门 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | ✅ | 混合 PR（renderer + locales + 文档）。worktree `D:\Data\projects\mp-worktrees\mp-fix-batch-check-toast-unify`（**D 盘**）+ 裸分支 `fix-batch-check-toast-unify`；共享根全程零 git 写 |
| 会话隔离前置 | ✅ | `pre-code-edit-guard.ps1` 先以 rc=1 拒绝（当时在共享根），清理后 rc=0；`start-mp-task.ps1` 健康检查全绿（writeGuard running、hooks match、outsideWorktrees 0） |
| TDD | ✅ | 先写 10 例失败（`fn is not a function`，键不存在）→ 补 locales 键 → 14/14；组件测试先红后绿 |
| 变异反证 | ✅ | 见 §5，三探针均红、还原后全绿 |
| 既有回归 | ✅ | 账号域 5 文件 **235/235**（Accounts 133 + AccountsBatchCheck 19 + useExpiredAccountsBanner 5 + accounts store + 文案结构 14 + 装配器 17） |
| locale 成对 | ✅ | `check-locale-sync.js --keys` PASS（2207 key）；`--cjk` PASS（基线 1330、当前 1124，**无新增硬编码**） |
| 行数闸 | ✅ | `Accounts.vue` 1577 ≤ 登记 1578（压缩 3 处历史注释，**未抬登记值**）；`Accounts.test.js` 2374 → 1848 ≤ 登记 2029（一键检测块迁出） |
| 行尾对账 | ✅ | 普通 numstat 与 `--ignore-cr-at-eol` 两口径逐文件一致；无裸 CR |
| 品牌残留 | ✅ | `check-no-brand-residue.js` PASS（11627 tracked） |
| ESLint | ✅ | `eslint electron/ src/ --quiet` error 级 **0** |
| QM-2 代码必检项 | ✅ | 未改 preload / IPC 签名；未新增全局组件或顶层 CSS；未引入同步 CPU 密集原语；`buildBatchCheckSummary` 只在终态调用一次 |
| QM-4 视觉 | N/A | 无新增视觉组件；遮罩/徽章/按钮显隐全部不变（仅 toast 条数与文案变） |
| QM-1 打包 | 见下 | — |
| QM-6 CCG 双模型评审 | 见下 | — |

## 7. 测试文件拆分的理由（行数闸正解，不是为拆而拆）

`Accounts.test.js` 登记值 2029 行、零增长容差，而本次要在其中新增 8 例（约 194 行）。按门禁给出的正解**按被测模块分文件**：一键检测是账号页最重的单一特性域（进度可见性 / 三态契约 / 提示统一 / 卡片刷新兜底 / 事件订阅与定时器生命周期），整体 19 例迁至 `AccountsBatchCheck.test.js`，共享 mock 头部（`vi.mock` + `vi.hoisted` fixtures + `mountView`）原样复制以保证行为一致。迁移后两文件各自独立全绿，证明零丢失。

## 8. CCG 深度双模型评审（QM-6，claude 评审 × opencode 出方案）

触发：变更 1639 行 > 200 行阈值（`ccg-review-decider` 判 `mode=dual`）。
跑法：`sh scripts/deep-review.sh`（Git Bash，`--check-deps` 先体检后端：claude / opencode 均就绪，跨家族校验通过）。

**原始读数**：评审提出 **8 条**问题；维度分 `correctness 5 / security 8 / performance 8 / maintainability 4`（最低 4）。
引擎判 `self_play`（置信权重 0.6，低于真跨家族 1），进入自扮演裁决，其中 **4 条属 auth/datamigration 高危域，不允许自扮演豁免**。

### 8.1 逐条处置

| id | 级别 | 裁决 | 处置 |
|----|------|------|------|
| i1 | Critical（auth） | **upheld** | 指控成立。`loginStatus` 为 null 有两种含义（真的没有现状 / 读取失败），渲染层无法区分，我原来的兜底把 null 当成了"可以兜底"的信号 ⇒ 可能用本轮 `valid` 覆盖另一写者刚落盘的真源。**已收窄修复**：兜底门控从「loginStatus 为 null」改为 **`statusChanged === true`**（主进程 `persistCheckOutcome` 的 `changed` 位，表示本轮真源确被改写）。只有"真源确实被改成某结论而回传 loginStatus 却缺失"时兜底才等价。同步新增回归锁 2 条（`statusChanged=false` 两个方向都锁 + 空串形态锁），修复前该用例红、修复后 135/135 绿。⚠️ auth 高危域，按裁决单要求仍需 claude 外部复核，`externalReview` 三格留空、不计入自扮演闭环 |
| i2 | Warning（auth） | **upheld** | 「5 个失效 locales 键无机械闸门」成立。已落地：源码内逐条标注保留理由（哪条仍被谁读、删它破哪道门）+ PRD §20.7 与 records §8.4 登记。**不采纳本 PR 内删除**：删 `batchCheckAllPersistFailed` 会实时破坏首页失效横幅（`useExpiredAccountsBanner.js:63`），属本主题之外的回归。后续 change 建议：建 `deprecated-keys` 登记 + 「locales 零引用键」CI 判据 |
| i3 | Warning（datamigration） | **dismissed** | 指控的担忧（vitest 白名单漏登记导致测试不执行）在本仓不成立：`vitest.config.js` include 首条就是 `src/**/*.test.{js,ts}`，`src/views/` 下新文件自动纳入；且本次是**显式指定文件路径**跑的，19 例全部真实执行（非 skipped）。三条被点名的断言（busy 复位 / 取消订阅 / 定时器清理）逐条核对均在且通过。行数账也对得上：迁出块 526 行（1-based 1066..1591）+ 共享 mock 头部 246 行 + 新增 8 例 ≈ 831 |
| i4 | Warning（auth） | **upheld** | 空字符串 `''` 是 falsy，会落进 valid 兜底分支。已修为严格判定 `item.loginStatus != null && item.loginStatus !== ''`，并新增回归锁「空串 loginStatus + statusChanged=false ⇒ 不碰卡片」。与 i1 同源：把「loginStatus 的形态」与「是否兜底」解耦 |
| i5 | Warning | **dismissed** | 「已在编辑该文件所以应顺手删 §19 副本」不构成必须本轮删的理由：删哪一份是权威版需要历史 PR 语义，属独立 change 范围。已满足的部分：债务被精确定位（行号区间 + 根因）并登记在两处（PRD §20.9 第 4 条、records §8.5），维持「一个 PR 一个主题」 |
| i6 | Info | **upheld** | 「缺可执行验证命令」成立。已在 §6 门禁表与 §4.3 回归表逐行补**可复跑命令 + 退出码 + 关键读数**（如 `--cjk` 基线 1330/当前 1124、Accounts.vue 1577 ≤ 登记 1578、235/235、135/135）。不贴 console 全文（体量代价高，命令 + 读数已可复跑复现） |
| i7 | Info | **dismissed** | 共享 mock 头部重复是真实风险，但抽 `tests/fixtures/accounts-fixtures.js` 要同时改两个文件的 `vi.mock`/`vi.hoisted` 提升结构并验证行为，属独立重构。已登记为后续 change（§8.6），并注明迁移时头部是**原样复制**，把漂移起点钉在当前这一版 |
| i8 | Info | **upheld** | 已在 §5 为每条探针补明「红了哪一条具体用例名」，使红的原因可定位；§4.3/§6 补可复跑命令与读数。不附 CI URL：深度评审本身**不进 CI**（AGENTS.md：单次 >15 分钟，挂 required check 会锁死仓库），它本地跑、结果落盘进 PR，可核形态是「命令 + 用例名 + 读数」 |

**净结果**：8 条中 4 条 upheld（i1/i4 已修 + 2 条回归锁；i2/i6/i8 已补登记与可核证据），4 条 dismissed（i3 有反证、i5/i7 属独立 change 范围、i8 部分不成立）。

### 8.2 这条评审改变了什么（最重要的产出）

i1 让本次修复的**兜底契约**从"loginStatus 缺失就用 valid"收窄为"`statusChanged === true` 才用 valid"。差别是可构造的失败场景：

> 账号真源此刻是 `active`（另一写者刚写入）；本轮检测返回 `valid=false`（Cookie 已过期），但主进程走无定论分支 ⇒ `statusChanged=false`、`loginStatus=null`。
> **收窄前**：卡片被刷成 `expired`，用户看到的是一个本轮未被采纳的结论。
> **收窄后**：卡片保持 `active`，与真源一致。

对称方向（真源 `expired` + 本轮 `valid=true`）同理。**"证据缺席"与"证据存在但没被采纳"是两件事，展示层不能把前者当后者用。**

### 8.3 一个如实记录的教训

探针 A 的还原**第一次没生效**：PowerShell 正则的锚点与实际缩进不匹配，`Select-String` 显示"已还原"但文件里仍是探针形态；是全量复跑（164/164 期望值）时才发现少了 1 条绿。
**"以为还原了"不等于"还原了"** —— 变异反证的还原步骤必须由全量复跑确认，不能由局部 grep 确认。

### 8.3 自扮演闭环的出处（`self_play_resolved` 为什么可以算闭环）

引擎第三档出口把状态写成 `self_play_pending`（5/5 条无 verdict），那是**公开承认未闭环**。
本 PR 在 `.adversarial/ccg-deep-497ffb45/adjudication.json`（gitignore 的工作产物，不进主干）
逐条填齐 prosecution / defense / verdict / rationale 后，把判定记录
`.ccg/reviews/bef9b956….json` 的 `deepReview` 推进为：

- `status = self_play_resolved`（`check-pr-exec-record.js` 的 `CLOSED_DEEP_REVIEW_STATUSES` 显式承认的第三档出口）
- `performedBy = self-play`
- `tier = self_play`（**不是** `external`——本轮没有真跨家族复核）
- `closureNote` = 轮次标记 + 8 条逐条处置结论（upheld 已修 / 已补登记 / dismissed 的理由与反证）

**为什么这不算冒充闭环**：`self_play_resolved` 的语义是"自扮演已裁决"，不是"外部已确认"。
i1 属 auth 高危域，按裁决单要求仍需 claude 外部复核并填 `externalReview` 三格，本记录**如实留空**；
PR 评论（#4236）也已单列说明这一格未取得。代码侧已修 + 有 2 条回归锁，与"评审已被外部确认解除"
是两件事，记录里分开写。

### 8.4 登记给后续 change 的事项（由评审 i2/i5/i7 触发）

1. **locales 失效键的机械判据**（i2）：建 `deprecated-keys` 登记表 + 一个「locales 中零引用键」的 CI 判据。当前 5 个键只有注释标注，无机械闸门。删键须先处理 `batchCheckAllPersistFailed`（仍被首页横幅 `useExpiredAccountsBanner.js:63` 读取）。
2. **PRD §19 三份重复副本的去重**（i5）：`01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` 第 502-601、602-706、707-806 行三份逐字相同，需先确认权威版再单开 change 删除另两份。
3. **共享测试夹具抽取**（i7）：把 `Accounts.test.js` 与 `AccountsBatchCheck.test.js` 重复的 mock 头部（`vi.mock` + `vi.hoisted` fixtures + `mountView`）抽到 `tests/fixtures/accounts-fixtures.js`。需同时验证 vitest 对「从外部模块 import 的 hoisted 夹具」的提升语义，抽错会让两个文件同时挂。

## 9. 已知边界（不假装闭合）

1. **`toPublicAccount` 的 `hasCred=false → expired` 规则本轮未动**：它是多年存在的安全兜底，改动影响**所有**账号列表显示而不只是一键检测，需独立证据链（凭证文件损坏 vs session 分区 Cookie 的判定边界）。已与用户确认本轮不碰，登记为后续 change。
2. **`loginStatus` 为 null 的根因未消**：主进程 `readAccountSnapshot` 读不到真源时仍返回 null，本次只在展示层加兜底。更彻底的做法是让 `persistCheckOutcome` 区分"真的没有现状"与"读取失败"。
3. **`unconfirmed` 计数与 `hint.action` 不是同一维度**：一个账号可既"未取到定论"又带 `retry` 提示，也可"未取到定论"却无 hint。文案用「其中」弱耦合，不做逐账号明细（那会变成第 5 条 toast）。
4. **5 个失效 locales 键保留未删**：`batchCheckAllStarted` / `checkHintsSummary` / `checkHintsSummaryRelogin` / `checkHintsSummaryRetry` / `batchCheckAllPersistFailed`。其中 `batchCheckAllPersistFailed` 仍被首页横幅 `useExpiredAccountsBanner.js` 的 `reportError` 标题读取，删键会破 CI Gate 7 `--keys` 与横幅告警；其余删键需单独评估 `--keys`/`--cjk` 双重基线影响。已在源码逐条标注。
5. **`01-docs/PRD-ACCOUNT-LOGIN-STATUS-CHECK.md` §19 存在三份逐字重复副本**（第 502-601、602-706、707-806 行，均以 `## 19. 2026-10-17 变更…` 开头）——**本次修复之前就存在的结构性债务**，历史 PR 重复追加所致。本次不改（删副本需先确认哪份是权威版，且与"只做本主题改动"冲突），已在 PRD §20.9 第 4 条登记。
6. **CCG 评审 i1（Critical，auth 域）的外部复核未完成**：兜底契约已按指控收窄（`statusChanged === true` 门控 + 2 条回归锁），但按裁决单要求，auth 高危域的争议解除需 claude 外部复核并填 `externalReview` 三格（performedBy / evidenceRef / reviewedAt）。本记录如实留空，不冒充闭环；PR 评论中会说明这一点。
7. **共享测试夹具重复**（i7）：`Accounts.test.js` 与 `AccountsBatchCheck.test.js` 的 mock 头部逐字相同，迁移时是原样复制（把漂移起点钉在当前版本）。抽取到 `tests/fixtures/` 属独立重构，见 §8.4 第 3 条。
8. **locales 5 个失效键无机械判据**（i2）：只有源码注释标注，见 §8.4 第 1 条。

## CHANGELOG 条目

### fix(accounts): 一键检测 4 条互相矛盾的提示收敛为 1 条汇总，并补卡片登录态刷新兜底（2026-10-22，fix-batch-check-toast-unify）

**用户报告**：账号页点「一键检测」后先后弹出约 4 条文字提示，内容互相矛盾（「0 个失效」与「5 个账号需要重新登录」同屏）；且检测后账号卡片的登录状态没有任何刷新，还是老的不准确状态。

**第一性原因**：检测结论有了，但"怎么告诉用户"与"怎么让用户看见"两条链路都断在最后一米。① 4 条 toast 分散在函数尾部 4 个独立 `if` 里，其中"汇总"与"后续操作建议"**同源数据**（都来自 `item.hint.action` 聚合）却分成两条，且后者文案读不出它与前者的指代关系；② 卡片刷新只有一个条件 `if (item.loginStatus)`，而主进程 `readAccountSnapshot` 读不到真源现状时 `loginStatus` 为 `null` ⇒ **整段跳过** ⇒ 徽章一动不动，本轮检测自己的三态结论被丢掉。

**修复**：新增装配器 `src/views/batch-check-summary.js`（纯函数，段序恒定 计数 → 下一步 → 固化失败，空段自动消除，级别只由三态结论决定）。`Accounts.vue` 删「开始检测」toast（进度已由全屏遮罩承载，它在遮罩底层不可读），4 条 notify 收敛为 1 条；卡片刷新加三态兜底，**门控为 `statusChanged === true`**（CCG 评审 i1 收窄后的契约：只有主进程确实改写了真源、而回传的 `loginStatus` 却缺失时，用 `valid` 兜底才等价；`statusChanged` 为 false 时一律不碰卡片）。固化失败从独立红色 error 降级为汇总尾段——它的真实语义只是「部分账号结论没落库」，不是「整个检测失败」。

**文案（zh/en 成对，新增 2 键）**：下一步段改为「其中 N 个建议重新登录；M 个建议稍后重试」（"其中"把指代关系写明，是消解"矛盾感"的关键）；固化失败段「另有 N 个账号的检测结论未能保存到服务端，请重试或检查后端服务」。用户截图场景现在是一条：

> 检测完成：4 个正常，0 个失效，6 个未取到定论（保持原状态）；其中 5 个建议重新登录；1 个建议稍后重试；另有 1 个账号的检测结论未能保存到服务端，请重试或检查后端服务

**回归保护**：装配器单测 17 例（单对象不数组 / 段序不可交换 / 空段不泄漏分隔符 / 永不产出 error 级）；一键检测测试整体迁出为 `AccountsBatchCheck.test.js`（19 例，含新增 8 例：最坏形态只 1 条 toast、开始检测不弹 info、卡片兜底 3 例）；文案结构断言 4 → 14 例。变异反证三探针均当场红（摘卡片兜底 / 删下一步段 / 恢复独立红色 error）。账号域 5 文件 235 例全绿。

**行数闸还账**：`Accounts.vue` 靠压缩 3 处历史注释回到 1577 ≤ 登记 1578（未抬登记值）；`Accounts.test.js` 2374 → 1848 ≤ 登记 2029（一键检测块迁出，按被测模块分文件）。

**本轮明确不改**：`toPublicAccount` 的「本地无凭证一律降 expired」规则（影响所有账号列表显示，需独立证据链）；PRD §19 的三份重复副本（历史债务，已登记）。详见 PRD §20.9。

## 门禁记录（双形态，按 AGENTS.md「旧载体冻结」后新 PR 口径）

| 项 | 状态 |
| --- | --- |
| 远程同步 | 由门禁推导 |
| 保留门禁 | 行尾对账 ✅ ｜ 品牌残留 ✅ ｜ 文档同步 ✅ ｜ locale 成对 ✅ ｜ 行数闸 ✅ |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | locale 成对 ✅ | 行数闸 ✅ | 远程同步 PR #NNNN
