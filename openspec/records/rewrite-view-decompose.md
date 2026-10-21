---
record: rewrite-view-decompose
task: 改写页视图解耦 —— RewriteView.vue 拆 3 个 composable + 外置样式，从 1430 行降到 977 行
date: 2026-10-21
---

## 本次执行记录：改写页视图解耦（rewrite-view-decompose，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 运行时代码 | worktree：`D:/Data/projects/mp-worktrees/mp-rewrite-view-decompose`（非 C 盘）；裸分支 `rewrite-view-decompose`；经 PR 落地 |
| 第一性原因（QM-5 ①） | 记录 | `RewriteView.vue` 实测 **1430 行 = 行数门禁登记值**；`growthAllowance=200` ⇒ 天花板 1630 ⇒ **余量为零**，下一次改写页迭代必然撞 `LEDGER_GREW` |
| 逃逸分析（QM-5 ②） | 记录 | 逃逸形态：①「先合了再说」把 201 行塞进同一文件 ⇒ 门禁在 PR 侧红；② `--update --rewrite` 整份重生成基线 ⇒ 把别人十几个文件的漂移登记成新基线（门禁自述已点名此为第二次开门）；③ `--prune` 清账 ⇒ 要求文件 <500 行，本仓视图达不到 ⇒ **只能用「把文件写短」这一条路** |
| 修复 + 回归保护（QM-5 ④） | 记录 | 样式 321 行外置 `rewrite-view.css`（320 行）；字数区间 → `useRewriteWordCount`（67 行）；策略 → `useRewriteStrategy`（120 行）；文案库回写 → `useRewriteLibrarySync`（94 行）。**1430 → 977 行**（余量 200 → **653 行**）。新增 3 个测试文件共 **27 例**；既有 `RewriteView.test.js` 视觉契约块改读 CSS 文件（**4 条契约一条不减**）+ 新增 2 条（视图必须仍引用该 CSS / 不得再有内联 `<style scoped>`）防孤儿与防两份真相 |
| 防止再次发生（QM-5 ⑤） | 记录 | 三个 composable 各自带**契约注释**（校验与下发同源 / 手动值优先于自适应 / 竞态守卫 + 防抖缺一不可 / 两条回写路径互斥 / djb2 key 算法不得改）；PRD §13 列「明确不做」清单（含 N6「不下调登记值」与 N9「不全局抬 timeout」两条纪律） |
| 行尾与 diff 对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；新文件按仓库惯例写 CRLF（工作树），提交时由 `.gitattributes` 的 `* text=auto` 归一为 LF |
| 接线棘轮 | PASS | 3 个新 `*.test.js` 落在 `apps/desktop/src/composables/`，被 `apps/desktop/vitest.config.js` 的 `include: ['src/**/*.test.{js,ts}', …]` 覆盖 ⇒ **被 `pnpm test` 自动收集**（不是需要额外接线的 `scripts/` 侧文件） |
| QM-1 打包 / QM-4 视觉 | N/A（未触运行面） | 本次是纯重构：模板一行未改 ⇒ DOM 按定义不变；样式仅换宿主位置，选择器/属性值/注释逐字保留。未改渲染逻辑，故不需重跑视觉基线（CI 的 `QG Visual` 仍会跑，作为读数留证） |
| QM-6 CCG 双模型外部评审 | 见下「六、CCG 外部双家族评审」 | critic=claude / proposer=opencode（`scripts/ccg-review-backends.list` 的两份名单）；`scripts/ccg-review.ps1 -Mode Deep -CheckDeps` 体检通过（两个后端裸名自检均解析到真实 exe） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 一、为什么这次是「架构级变更」而不是「顺手清理」

`RewriteView.vue` 的 1430 行里，`<style scoped>` 占 321 行（22%），与逻辑零耦合；`<script setup>`
占 739 行，里面混装四类职责（字数区间 / 策略 / 文案库回写 / 改写执行与结果解析）。本次只动前三类
的归属，**改写执行、结果解析、归因链、目的地跳转全部留在视图** —— 因为仓里有两条结构锁要求这些
内容继续留在 `RewriteView.vue` 源码里可读（见下「三」）。

### 二、行数账目的前后读数

| 指标 | 变更前 | 变更后 | 读数来源 |
|---|---|---|---|
| `RewriteView.vue` 行数 | 1430 | **977** | `node -e "…split('\n').length"` |
| 距天花板余量（天花板 1630） | 200 行 | **653 行** | 同上 |
| `max-lines-baseline.json` 的 `files` 登记值 | 1430 | 1430（**未动**，见 PRD §1.2 与 N6） | 工具不支持下调 |
| `debt-baseline.json` 的 `filesOver1000` | 29 | **28** | `node scripts/check-debt-budget.js` 输出 |
| 新增文件行数 | — | 67 / 120 / 94 / 320（全部 < 500） | 不触发 `NEW_OVER_LIMIT` |

**`filesOver1000` 由 29 降到 28** —— 这是聚合债务账目实打实降了一格（该门禁棘轮式，只挡增长、改善不报错）。

### 三、既有结构锁一条未削弱

| 锁 | 出处 | 要求 | 本次如何满足 |
|---|---|---|---|
| 单一实现结构锁 | `apps/desktop/src/utils/rewrite-lineage.test.js` | 四个改写入口文件里能读到 `aiRewrite(` 与 `utils/rewrite-lineage` 引用 | `aiRewrite` 调用与 `extractRewriteHistoryId` / `attachRewriteLineage` **全部留在视图** |
| 入口结构合同 | `apps/desktop/src/views/CopyLibraryView.test.js` | `RewriteView.vue` 里能读到 `podcast.activeChannelId.value`，且不得有 `\|\| await ensureChannel()` 死分支 | 文本出期入口**留在视图** |
| 图标 emoji 守卫 | `apps/desktop/src/icon-usage.test.js` | 功能图标位禁 emoji | **模板一行未改** ⇒ 不受影响 |

### 四、顺带修掉的一处脚手架脆弱点（`RewriteView.sensitive-warning.test.js`）

**现象**：7 个相关测试文件同场**冷跑**时该文件首测**超时**（10s）失败；单独跑则通过。

**实测分段计时**（本机 jsdom + vitest；探针文件跑完即删，已用 `scripts/safe-delete.js` 走可恢复删除）：

| 段 | 原始代码 | 本次拆出后 |
|---|---|---|
| `await import('./RewriteView.vue')`（一次性编译整张依赖图） | **3706ms** | **4190ms** |
| `mount()` 本体 | 92ms | 75ms |
| 首个 `nextTick` | 0ms | 0ms |

⇒ 首测那 5.8s 里**绝大部分不是产品行为慢，是 Vite 把 SFC 及其整张依赖图编译一遍的一次性成本**。
默认 `testTimeout = 10000` 在冷缓存 + 同片并发编译时会被它吃光。

**处置（不靠全局抬 timeout 糊过去）**：加
`beforeAll(async () => { await import('./RewriteView.vue') }, 60_000)` ——
把一次性编译挪进 setup 阶段并给这一段一份**显式**预算；**每条用例的断言窗口仍是默认 10s**，
产品行为变慢照样 10s 内报错。实测首测 **6235ms → 159ms**（39 倍），整个文件 **12.53s → 6.75s**。

⚠️ **为什么不做全局抬高 `testTimeout`**：那会让**真正挂死**的用例也跟着放宽，把缺陷藏进更长的
等待里。正解是把脚手架成本挪出断言窗口，而不是把断言窗口拉长（PRD N9）。

### 五、门禁读数（本机实测）

| 门禁 | rc | 读数 |
|---|---|---|
| `node .github/scripts/check-max-lines.js` | **0** | 「无新增超大文件，挂账清单与现实一致」；limit=500 growthAllowance=200 超限=95 挂账=95 墓碑=5 点名=20；测试超限=13 测试挂账=12 |
| `node scripts/check-debt-budget.js` | **0** | `maxFileLines: 5356 (baseline: 5359)`、`filesOver1000: **28** (baseline: 29)`、`filesOver500: 95 (=)`、`circularDeps: 0 (=)` |
| `npx eslint <9 个改动文件> --quiet` | **0** | 无告警 |
| `npx vitest run`（3 个新 composable 测试 + 4 个既有改写页测试 + 2 条结构锁 + `useWordCountValidation` + `src/components` 全部） | **0** | **77 个测试文件 / 946 例全绿** |
| `node --test .github/scripts/check-max-lines.test.js` | **1（存量）** | 36 例中 35 过、1 挂。挂的是 #36「system 档的 `core.excludesFile` 真能改域」，**与本次变更无关** —— 在**未改动的共享主工作区**跑同一条命令，读数完全相同（35 过 / 1 挂），属本机全局 git 配置相关的**环境态**失败 |

### 六、CCG 外部双家族评审

（见本文件提交时的最终读数；两个后端 `claude` / `opencode` 的依赖体检均通过。）

### 七、遗留（不假装已闭合）

- **`filesOver1000` 仍有 28 个**：本次只解决 `RewriteView.vue` 一个，其余 27 个 ≥1000 行的文件
  （含 `CreateView.vue` 5356 行）**未动**。PRD §13 第 8 条已把这条列为明确不做。
- **`max-lines-baseline.json` 的登记值仍是 1430**：工具不支持下调（`--update` 不降已有值、
  `--prune` 要求 <500 行），手工改基线属「改谁来守门」，需人工过目。本次靠「把文件写短」
  拿到 653 行余量，效果等价且不动门禁数据。若将来要把余量收到更紧（例如把登记值降到 977），
  那是另一次「改守门人」的决策，需人工过目。
- **`.github/scripts/check-max-lines.test.js` 的 #36 存量红**：本机环境态（全局 git 配置），
  非本次引入，但它会让**本 PR 的 CI 在那条 step 上红** —— 需在 PR 里如实登记，不得读成
  「本 PR 引入的新红」。已在 §五 记下 A/B 两档读数（改动前 / 改动后同一条命令同一条挂）。
