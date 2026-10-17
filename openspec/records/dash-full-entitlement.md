---

sync_reason: PR 刚开、尚未合并，远程同步状态待回填
sync_backfill_owner: Colinchiu007（本分支作者，合并后同一次提交内删除本两字段）

record: dash-full-entitlement
task: 数据看板套餐分级（dashboard_full 落地）+ 撤下误导横幅 + 三个新内容区块
date: 2026-10-17
---

# 数据看板：撤误导横幅、让 dashboard_full 真正落地、补三个内容区块（dash-full-entitlement，2026-10-17）

> 分支 `dash-full-entitlement`（隔离 worktree，本机路径按 `mp-worktrees/<任务名>` 约定，**不在记录里写绝对路径** —— CI runner 无该盘符，会被 Gate 12c 判「超出存量基线」）。PRD：`01-docs/PRD-DASHBOARD-FULL-ENTITLEMENT-2026-10-17.md`。

## 起因：两个真实缺陷

**缺陷 A — 文案说谎。** 看板页顶部横幅写「当前为免费版，部分功能受限」，但本页三个数据源（`dashboard:stats` / `history:list` / `performance:overview`）的门禁**都是登录而非套餐**；未登录走的是另一条独立的登录引导条。本页没有任何一项内容因套餐受限。用户选**方案 C**：撤下横幅。

**缺陷 B — 权益定义了没人接。** `plan-matrix.js` 里 free 档 `dashboard:'basic'`、standard/pro 档 `dashboard:'full'` → 派生 feature `dashboard_full`，而它**全仓零消费方**（只在定义处与被断言处出现）。于是三档用户看到完全一样的东西。本次让它落地为可见差异。

## 关键设计决策（三条，都不是默认选择）

### 1. 判据一律走服务端 entitlement，禁用 licenseStore.isPro

渲染层此前**没有**按 feature 门控 UI 的工具函数，只有两套范式：`entitlement.plan !== 'pro'`（按档位名硬判）与 `licenseStore.isPro`（本地二值）。后者**不认三档**：standard 档会被判成「非 Pro」而看不到付费内容 —— 这是本次要消灭的误判。

新增单一真源 `views/member-center/entitlement-gate.js`（落在该文件是因为 `labels.js` 已是全仓既有的「权益判定纯函数」约定位置）。`entitlement` 未登录/未取到时是 **`null`**（不是空对象），所有函数先判空。

### 2. 「锁」只做渲染层门控，主进程不设防 —— 且如实写明

跨家族评审（claude）挑出的 **Critical i1** 直接推翻了初稿：初稿把 `performance:overview` 列为 🔒 full-only，又在非目标里写「不改返回形状」，**两条互斥** —— 该 handler 只判 `resolveIpcOwnerSubject`，完全不读套餐，主进程侧拦不住。

修正后的口径写进 PRD §3.2.1：

| 层 | 做什么 |
| --- | --- |
| 渲染层（唯一落点） | 权益不含 `dashboard_full` → **不发**该 IPC + **不渲染**真实内容，改渲染占位 |
| 主进程 | 不动 |

**这是体验分级，不是访问控制** —— 这句话必须留在文档里。把它写成「权益门禁」是谎；写成「体验分级 + 明确边界」才是可交付的事实。真正的访问控制需改 `CHANNEL_FEATURE_MAP`，是独立任务。

### 3. 锁区块用「占位 + 说明解锁什么」，不是隐藏、不是假数据

整块隐藏 → 用户不知道还有这个功能；骨架假数据 → 欺骗。占位 + 「升级后查看 X」是唯一诚实且有转化价值的形态。

⚠️ **已知失效**：`UpgradeModal` 的购买/激活入口全是 `import.meta.env.DEV` 构建期常量，**正式包恒关**（Critical i2）。CTA 保留，但文案只用中性的「升级解锁」，**不承诺**「立即开通」—— 承诺会落空。

## 新增三个内容区块（零新增 IPC，全部走已存在但未使用的通道）

| 区块 | 通道 | 归属 |
| --- | --- | --- |
| 账号健康度 | `accounts:batch-check-login` → `accountBatchCheckLogin()` | free 可见（运营必需） |
| 发布队列状态 | `queue:status` + `queue:history` | free 可见 |
| 题材表现榜 | `performance:list-pattern-performance` | full 专属 |

**三态纪律**：`empty`（合法无数据）/ `error`（取数失败）/ `auth`（不认识我）必须分开。前两种界面上都表现为空，含义相反 —— 渲染成同一个空态，用户会把「功能坏了」读成「我还没发过东西」（本项目 `performance-loop.js` 注释里已写过这个教训）。转换层 `dashboard-panels-model.js` 是纯函数，22 条单测锁死。

**刻意不接的三个源**（PRD §七写明理由）：`analytics:*`（与 `sync:cached` 同源不同路，会引入第二套口径）、`usage:daily`（JSON 功能使用量 vs SQLite 发布量，**存储层与语义层双双不同源**）、失败原因分布（无聚合通道，前端自行 group-by 等于发明统计口径）。

## 证据

| 项 | 值 |
| --- | --- |
| 受影响测试 | 123 passed / 0 failed（Dashboard 28 + style-guard + member-center + features/dashboard 63 + TrialBanner + more-tests） |
| 新增测试 | entitlement-gate 8 + feature-key 3 + panels-model 22 + Dashboard 分级 11 = 44 条 |
| **变异反证（3 条全做）** | M1 改用 `licenseStore.isPro` ⇒ 红；M2 反转 `v-if="!hasDashboardFull"` ⇒ **精确红 8 条**；M3 去掉题材榜门控 ⇒ **精确红 1 条**。还原后 28/28 |
| i18n 四道 | `--keys` PASS（2076 key 均成对）/ `--pair-base` PASS / `--cjk` PASS（无新增硬编码）/ `--py-cjk` — |
| locale 结构锁 | zh/en 键对称（新域走严格断言，未加进 `KNOWN_KEY_ASYMMETRY` 欠账表） |
| 构建 | `pnpm run build` exit 0（含 electron-builder nsis 打包） |
| 解析门禁 | `verify-worktree-deps.js` OK |
| 决策层评审 | `ccg-review-decider` 判 **DUAL** ⇒ 跑 `plan-review.sh`；claude 出 6 条（Critical 2），**均已回应并落进 PRD**；opencode 因输入超长（11929 > 7800 上限）未完成第 1 轮修订 |

## 实现过程中修掉的两个自身缺陷（都不是测试报的，是实测发现的）

1. **题材榜 IPC 被调 5 次**：`onMounted` + `watch(identityAuthenticated)` + `watch(hasDashboardFull)` 三个入口叠加，且权益异步到位会连开两轮。修法：把题材榜从 `loadNewPanels` 拆出成 `loadPatternBoard`（只有它受门控），并加 seq 防乱序写回。
2. **`toAccountHealthModel(null)` 判成 error**：IPC 不可用（浏览器环境/preload 未就绪）是合法降级，不是取数失败。判成 error 会让用户在降级场景看到「账号状态暂时无法获取」—— 那是谎。改为 empty。

## CI 抓出的两个真实缺陷（合并前修掉）

### 1. Gate 7c 暗色文本对比度：两处不达标

CI 精确报出 `fg`/`bg`/`ratio`，两处都在 `DashboardLockedPanel.vue`：

| 元素 | fg | bg | ratio | 根因与修法 |
| --- | --- | --- | --- | --- |
| `.dash-locked-title` | `#1e1b4b` | `#26262d` | **1.06** | 用了 `var(--deep-purple)` —— 它是 Dashboard.vue 在 `:global(:root)` 里写死的**亮色值**，暗色下不切换 ⇒ 标题几乎隐形。改语义 token `var(--color-text-primary)`（tokens.css 亮 `#1e1b4b` / 暗 `#e8e8ed` 双档都有） |
| `.dash-locked-cta` | `#7c5cbf` | `#26262d` | **2.96** | 描边式（透明底 + 彩字）差 0.04。改**实底 + 白字**，色值固定 `#7c5cbf` ⇒ 对比度恒 5.07，与主题无关（同 TrialBanner 第 3 轮的结论：白字对「主题是否覆盖了某 token」免疫） |

顺手排查了 CI 未报但同类的隐患：`.dash-health-chip`（基础 + `.run`/`.pending`）也用了 `--lavender-light`/`--deep-purple`，暗色下会放出浅紫亮斑。改「半透明主色叠色 + 语义文字色」，无需主题分支。

本地按 WCAG 公式逐项核验（全部 ≥3:1）：锁区块标题 亮 14.92 / 暗 12.30；CTA 5.07（两档恒定）；chip 亮 13.54 / 暗 11.23；说明文字 亮 4.86 / 暗 7.24。CI 实测值（2.96）与本地算式吻合，证明底色取值正确。

### 2. 债务熔断 LEDGER_GREW：Dashboard.vue 膨胀超容差

```
❌ Dashboard.vue 较登记值 796 膨胀 222 行（容差 200），请拆分或经审阅后 --update
```

正解是**拆分**而不是 `--update` 抬高上限（后者违反「债务只能缩小」纪律）。抽成 `features/dashboard/DashboardExtraPanels.vue`（三个附加区块 + 自包含样式），Dashboard.vue 926 → 802 行，门禁 exit 0。

两处踩坑记下：
- **`.dash-panel` / `.dash-panel-title` 是 Dashboard.vue 的 scoped 类**，子组件拿不到 ⇒ 新组件样式必须自包含（`.dash-extra-*`），只依赖全局的 `.cohere-card`。
- **`--color-bg-surface` 在本仓根本不存在**：照猜写 `var(--color-bg-surface, #fff)` 会让暗色主题 fallback 成白卡片。正解是直接复用全局 `.cohere-card`（背景走 `var(--canvas)`），组件只补 `padding`/`margin`。教训：**写 `var(--x, fallback)` 前必须先查该 token 是否真实存在**，否则 fallback 会变成暗色主题下的显性 bug。

## 远程同步

| 远程同步 | PENDING |
