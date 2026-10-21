---
record: rewrite-view-decompose
task: 改写页视图解耦 —— RewriteView.vue 拆 3 个 composable + 外置样式，从 1430 行降到 977 行
date: 2026-10-21
---

## 本次执行记录：改写页视图解耦（rewrite-view-decompose，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 运行时代码 | worktree：`<仓库父目录>/mp-worktrees/mp-rewrite-view-decompose`（非 C 盘）；裸分支 `rewrite-view-decompose`；经 PR 落地 |
| 第一性原因（QM-5 ①） | 记录 | `RewriteView.vue` 实测 **1430 行 = 行数门禁登记值**；`growthAllowance=200` ⇒ 天花板 1630 ⇒ **余量为零**，下一次改写页迭代必然撞 `LEDGER_GREW` |
| 逃逸分析（QM-5 ②） | 记录 | 逃逸形态：①「先合了再说」把 201 行塞进同一文件 ⇒ 门禁在 PR 侧红；② `--update --rewrite` 整份重生成基线 ⇒ 把别人十几个文件的漂移登记成新基线（门禁自述已点名此为第二次开门）；③ `--prune` 清账 ⇒ 要求文件 <500 行，本仓视图达不到 ⇒ **只能用「把文件写短」这一条路** |
| 修复 + 回归保护（QM-5 ④） | 记录 | 样式 321 行外置 `rewrite-view.css`（320 行）；字数区间 → `useRewriteWordCount`（67 行）；策略 → `useRewriteStrategy`（120 行）；文案库回写 → `useRewriteLibrarySync`（94 行）。**1430 → 977 行**（余量 200 → **653 行**）。新增 3 个测试文件共 **29 例**（字数区间 7 + 策略 14 + 文案库回写 8）；既有 `RewriteView.test.js` 视觉契约块改读 CSS 文件（**4 条契约一条不减**）+ 新增 2 条（视图必须仍引用该 CSS / 不得再有内联 `<style scoped>`）防孤儿与防两份真相 |
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
| `npx vitest run`（**全量** desktop 单测，本机单片不分片） | **未取得读数** | 本机跑到 60 分钟被 harness 的单任务上限截断（**不是测试失败**，是超时中断）。本仓 CI 把 desktop 单测分 2 片（`QG Desktop Shards 1/2` / `2/2`，各 65 分钟预算）⇒ 全量读数以 CI 的分片结果为准（见 §五末注与 PR 读数） |
| `npx vite build`（QM-1 打包） | **0** | 36.53s；`RewriteView-DT8qrhLx.css` 作为独立 chunk 产出（6510 字节）；编译后 scope id `data-v-42669c5d`；`:deep()` 编译成后代选择器形态；该 CSS 资产被入口 chunk `index-DSr5b1Py.js` 引用 |
| `node scripts/check-doc-abs-paths.js --base=origin/main --head=HEAD`（Gate 12c） | **0** | 「无新增本机绝对路径」。（首跑红过一次：执行记录里写了 worktree 的**本机绝对路径** `D:/Data/...`，被「存量基线」判为新增本机路径。已按本仓既有约定改成占位形态 `<仓库父目录>/mp-worktrees/mp-rewrite-view-decompose` —— 与 `openspec/records/partition-cookie-encrypted.md` 等同款写法。） |
| `node --test .github/scripts/check-max-lines.test.js` | **1（存量）** | 36 例中 35 过、1 挂。挂的是 #36「system 档的 `core.excludesFile` 真能改域」，**与本次变更无关** —— 在**未改动的共享主工作区**跑同一条命令，读数完全相同（35 过 / 1 挂），属本机全局 git 配置相关的**环境态**失败 |

### 六、CCG 外部双家族评审

**后端**：`scripts/ccg-review-backends.list` 的两份名单 = critic=`claude` / proposer=`opencode`。
`scripts/ccg-review.ps1 -Mode Deep -CheckDeps` 体检通过（两个后端裸名自检均解析到真实 exe：
`/c/Users/邱领/.local/bin/claude.exe` 与 `/d/Program Files/npm-global/opencode.cmd`）。

**读数**：判定 `DUAL`（变更 1180 行 > 200 行阈值）；critic=claude 产出 **8 条问题 / 4 个维度
（correctness / security / performance / maintainability）/ 最低分 5**；proposer=opencode 跨家族校验通过；
收敛 `status=self_play`（置信权重 0.6），裁决模板落 `.adversarial/ccg-deep-d743b8f3/adjudication.json`。
6 条争议逐条填毕（prosecution / defense / verdict / rationale），裁决结果：

| id | 严重度 | 裁决 | 处置 |
|---|---|---|---|
| i1 | Critical | **upheld（成立）** | 已修（commit `8fdbf0bb`）：watch 与定时器收进本 composable 自建 `effectScope`；组件内随组件 scope 自动回收，组件外用新增的 `dispose()` 显式停掉。新增 2 例回归锁（dispose 后设置项变化不再触发预览、dispose 后防抖定时器被取消） |
| i2 | Critical（高危域 datamigration） | **dismissed（不成立）** | 高危域按引擎规则走**外部复核**：后端 `claude` 独立判定不成立，可核证据写在 PR 评论 <https://github.com/Colinchiu007/mulpub/pull/4196#issuecomment-6319834427>（`scripts/check-pr-exec-record.js:43-63` 的 `AUDIT_ARTIFACT_RE` 白名单与 #3396 注释、`:342-347`、`scripts/hooks/pre-commit:148-167` 的刻意 stage + 契约 + scenario16 回归锁）。`externalReview` 三格已填（performedBy=claude / evidenceRef=该 URL / reviewedAt） |
| i3 | Warning | **dismissed（不成立）** | 证据：① A/B —— 隔离本机全局 git 配置后该文件 **36/36 全绿**，不隔离则 35/36（根因是本机 `core.excludesFile`）；② 改动前后同命令读数相同 ⇒ 非本次引入；③ CI 侧承载该测试的 `债务熔断门禁` 作业在 main push（run 39602066073）**success**，本次 PR 同一作业实测 **pass** ⇒「CI 会持续失败」不成立。「无 .skip 标记」按本仓设计不采用 skip 掩盖环境态，改由本记录 §五/§七 落 A/B 与 CI 读数 |
| i4 | Warning | **upheld（成立）** | 已补产物级证据（探针跑完即删，经 `scripts/safe-delete.js` 走可恢复删除）：`vite build` rc=0（36.53s）；外置样式作为独立 chunk 产出（`RewriteView-DT8qrhLx.css`，6510 字节）；编译后 scope id = `data-v-42669c5d` 且落在正确选择器位置；`:deep()` 编译成 `.rewrite-config-card[data-v-42669c5d] .cohere-form-label{…}`；该 CSS 资产被入口 chunk `index-DSr5b1Py.js` 引用 ⇒ 生产运行时不会 404 |
| i5 | Warning | **upheld（成立）** | 已修（commit `8fdbf0bb`）：判据从否定式匹配（`not.toMatch(/<style scoped>\s*\n/)`，写法一变就漏判）改为「`<style>` 标签**恰好 1 个**且就是那一个」，与写法/空白无关，顺带挡住「两份真相」 |
| i6 | Warning | **dismissed（不成立）** | 事实前提与指控相反：现网 CHANGELOG.md 里 `# [未发布] refactor` 形态条目共 **16 条** ⇒「纯重构进 CHANGELOG」是本仓既有约定；`check-changelog-growth.js` 只管「条目不许消失」；`draft-changelog.sh` 同形态。发布筛选靠条目类型标注结构化，不靠人工再判断 |

**判据自身故障**：无。

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

## CHANGELOG 条目

# refactor(改写): 改写页视图解耦 —— RewriteView.vue 拆 3 个 composable + 外置样式（1430 → 977 行）（rewrite-view-decompose）

> 标题末尾按合同写 **record 名（= 分支名）**，本条即 `rewrite-view-decompose`。
> 按 `changelog-record-carrier` 的合同，本条写在执行记录里，`CHANGELOG.md` 与
> `01-docs/learnings.md` **零改动**（那两个是聚合器专属的归档写面，由
> `node scripts/aggregate-changelog.js --write` 在发版时统一搬运，幂等键是 record 名）。

- **问题**：`apps/desktop/src/views/RewriteView.vue` 实测 **1430 行**，正好等于行数门禁的**登记值**（`.github/scripts/max-lines-baseline.json` 的 `files` 表）。门禁 `growthAllowance = 200` ⇒ 硬天花板 **1630 行** ⇒ **这个文件此刻一点余量都没有**：下一次给改写页加功能（哪怕只加 201 行）就会撞 `LEDGER_GREW` 阻断。PR #4141 的 CHANGELOG 已把这条记进仓库（「解法是**拆 composable**……但 PR 未落地」），本次把那把刀补上。
- **拆法**（**用户可见行为零变化，模板一行未改**）：① 全部 `<style scoped>`（321 行）外置为 `apps/desktop/src/views/rewrite-view.css`，视图改用 `<style scoped src="./rewrite-view.css">`（`scoped` + `src` 由 Vue SFC 编译器施加同一 scope id，`:deep()` 语义相同；仓库已有 5 处同型用法）；② 字数区间（状态 + 校验接线 + 自适应推导）→ `composables/useRewriteWordCount.js`；③ 策略（列表加载 + 预览 + 竞态守卫 + 300ms 防抖）→ `composables/useRewriteStrategy.js`；④ 文案库回写（两条互斥写入路径 + djb2 哈希）→ `composables/useRewriteLibrarySync.js`。
- **结果**：`RewriteView.vue` **1430 → 977 行**，距天花板余量 200 → **653 行**；顺带把聚合债务账 `filesOver1000` 由 **29 降到 28**（`scripts/check-debt-budget.js` 实测读数）。
- **回归保护**：3 个新测试文件共 **29 例**。其中「手动置位后自适应不得覆盖用户值」「竞态守卫」「300ms 正文防抖」三条是**搬出视图后第一次有独立测试锁住**的契约 —— 它们在视图里只是「一个 `let previewSeq` 加一个定时器」「一行 `if (!wordCountManuallySet)`」，此前没有任何测试守过。
- **既有结构锁一条未削弱**：`utils/rewrite-lineage.test.js`（要求 `RewriteView.vue` 源码里能读到 `aiRewrite(` 与 `utils/rewrite-lineage` 引用）与 `views/CopyLibraryView.test.js`（要求能读到 `podcast.activeChannelId.value`、不得有 `|| await ensureChannel()` 死分支）—— 这正是「`aiRewrite` 调用 / 归因链 / 文本出期入口**不搬走**」的原因。
- **顺带修掉一处脚手架脆弱点**：`RewriteView.sensitive-warning.test.js` 首测的 10s 预算被「Vite 一次性编译整张依赖图」（实测 3706ms → 4190ms）吃光，冷缓存同片并发时超时。改法：把一次性编译挪进 `beforeAll` 并给显式预算，**每条用例的断言窗口仍是 10s**（首测 6235ms → **159ms**）。**不全局抬 `testTimeout`** —— 那会让真正挂死的用例也一起放宽。
- **CCG 外部双家族评审**：critic=claude（8 条问题 / 4 个维度 / 最低分 5）+ proposer=opencode（跨家族校验通过）。6 条争议逐条裁决：**i1 / i4 / i5 成立并已修**（策略监听收进 effectScope、补构建产物级证据、视觉契约断言改判据）；**i2 高危域**走外部复核（claude 独立判定不成立，证据在 PR 评论）；**i3 / i6 不成立**（i3 有 A/B 与 CI 两档读数，i6 有现网 16 条同类条目为证）。
- **明确不做**（各自需另开 PRD）：改任何用户可见行为；拆**模板**成子组件（父组件 `scoped` 样式不作用于子组件内部元素）；下调 `max-lines-baseline` 登记值（属「改谁来守门」，需人工过目）；改 djb2 回写 key 算法（会让既有文案库记录失联）；全局抬高 `testTimeout`；处理其它 28 个 ≥1000 行的文件。
- **文档**：新增 `01-docs/PRD-REWRITE-VIEW-DECOMPOSITION-2026-10-21.md`（逐模块写清数据校验判据与阈值、流程、功能逻辑、交互逻辑、显示项、提示文字原文）；`PRD-REWRITE-PAGE-UI-2026-09-16.md` / `PRD-REWRITE-WORD-COUNT-CONTROL-2026-09-12.md` / `PRD-REWRITE-STRATEGY-UI-2026-09-15.md` 各补一节「归属变更」附注。

## learnings

### lesson: 门禁的「登记值 + 容差」型天花板降不下去，杠杆只有把文件写短（rewrite-view-decompose）

**现场**：`RewriteView.vue` 1430 行 = `max-lines-baseline.json` 的登记值，`growthAllowance=200` ⇒ 天花板 1630 ⇒ **余量为零**。想「降天花板」时发现：登记值**降不下去** —— `--update` 只做增量登记不动已有值（且 `--update --rewrite` 整份重写会顺手把别人十几个文件的漂移登记成新基线），`--prune` 要求文件已降到 limit 以下（视图不可能到 500 行）。

**根因**：这类门禁把「历史欠账的位置」记在**登记值**上，欠账**位置**不随实际行数下降而下降 ⇒ 能动的只有实际行数。

**可复用的三条**：
1. 动手前先算**余量 = 登记值 + 容差 − 实际行数**，而不是看「这次要加几行」。余量小于本次改动量 ⇒ 先拆分再改。
2. 余量的正确提法是「把文件写短」，不是「把基线调大」—— 后者是用一次便利换掉所有人的门禁。
3. 拆完要**顺带核聚合账**：逐文件门禁降了不代表全仓聚合账降了。本次 `debt-budget` 的 `filesOver1000` 由 29 → 28（跨过 1000 线才会降），这才是「真降了一格」的读数。

### lesson: 机械搬迁几百行要用带唯一匹配断言的脚本，搬完再扫残留符号（rewrite-view-decompose）

**现场**：把 321 行样式 + 4 段逻辑从视图搬走。手改 400+ 行的风险不在「改错」，在**漏改** —— 而漏改在 Vue 里往往不报错，只表现为「行为悄悄变了」。

**根因**：没有断言的文本替换，漏改是**静默**的。

**可复用的三条**：
1. 每处替换都断言**恰好命中 1 处**（0 处或 >1 处立刻退出非 0），把搬迁写成脚本；先支持只读演练模式看行数变化，再真跑。
2. 搬完跑一次**残留符号扫描**：列出「搬走了的符号」逐个确认已不存在，「搬进来的符号」逐个确认能找到。这能挡住「搬走一半」。
3. 同一批里顺手查**结构锁**：仓里常有「直接读某文件源文字符串」的测试在约束哪些内容必须留在原处（如 `rewrite-lineage.test.js` 要求改写入口文件里能读到 `aiRewrite(`）。先看锁，再决定搬什么。

### lesson: 冷缓存下 vitest 首测超时的根因常是「一次性模块编译」，不是产品变慢（rewrite-view-decompose）

**现场**：7 个相关测试文件同场冷跑时首测超时（10s），单独跑则通过。分段计时显示：`await import('./RewriteView.vue')` **3706ms**（拆出 composable 后 4190ms），而 `mount()` 只有 92ms、首个 `nextTick` 0ms。

**根因**：首测那 5.8s 里绝大部分是 **Vite 把 SFC 及其整张依赖图编译一遍的一次性成本**，被默认 `testTimeout=10000` 吃光 ⇒ 冷缓存 + 同片并发编译时必超时。

**可复用的三条**：
1. 先量再判：把耗时拆成 import / mount / 首个 tick 三段打印出来。若大头在 import，那是**脚手架成本**，不是产品变慢。
2. 修法是把一次性编译挪进 `beforeAll(async () => { await import(...) }, 显式预算)`，**每条用例的断言窗口仍是 10s**（产品行为变慢照样 10s 内报错）。实测首测 6235ms → 159ms。
3. ⛔ **不要全局抬高 `testTimeout`**：那会让真正挂死的用例也跟着放宽，把缺陷藏进更长的等待里。正解是把脚手架成本挪出断言窗口，而不是把断言窗口拉长。

### lesson: composable 里的 watch 必须有主人（rewrite-view-decompose）

**现场**：外部评审（claude）判 i1：composable 无条件注册两个 `watch`，而 `onUnmounted` 只在 `getCurrentInstance()` 为真时注册 ⇒ 组件外调用时 watch 落在无主作用域，永不停止（每份实例都会真的发请求）。

**根因**：组件 setup 里的 watch 归组件 scope，Vue 会自动停；**组件外调用**时没有任何东西负责。

**可复用的三条**：
1. 把 watch 与定时器清理都注册进**自建的 `effectScope()`** —— 组件内它挂当前 scope（组件 scope 的子 scope），卸载时随 scope 树被停；组件外它归 composable 所有，调用方用返回的 `dispose()`（= `scope.stop()`）显式停掉。
2. ⛔ `if (getCurrentInstance()) onUnmounted(...)` 这类守卫**只清定时器**，watch 仍是无主的 —— 它看起来解决了问题，实际只解决了一半。
3. 拆出去的 composable 应当**自带回归锁**：本例新增 2 例（`dispose()` 后设置项变化不再触发预览；`dispose()` 后防抖定时器被取消）。

### lesson: 否定式匹配当存在性判据会漏判（rewrite-view-decompose）

**现场**：视觉契约里写 `expect(src).not.toMatch(/<style scoped>\s*\n/)` 来表达「视图里不得再有内联 scoped 样式」。外部评审（claude）判 i5：换个写法（`<style scoped >`、换行位置不同、双空格）就能绕过。

**根因**：「不要某个写法」与「只要那一个」不是一回事 —— 前者依赖写法细节，后者依赖语义。

**可复用的三条**：
1. 判据要陈述**要什么**：`const tags = src.match(/<style\b[^>]*>/g) || []; expect(tags).toHaveLength(1); expect(tags[0]).toBe('<具体那个>')` —— 与写法/空白无关。
2. 顺带把「两份真相」也挡住：原判据只挡「内联 scoped」这一种形态，新判据挡的是**style 标签数量 ≠ 1**。
3. 凡是「不想要 X」的断言，先问一句「我真正想要的那个是什么」—— 往往存在式 + 唯一性比否定式更短也更稳。

### lesson: 判「测试红了是环境态还是自己引入」要先 A/B 证伪，再看 CI 的真实结论（rewrite-view-decompose）

**现场**：`check-max-lines.test.js` 本机 35 过 1 挂。提案标成「环境态」并说「CI 会持续失败」。

**根因（两条硬证据）**：① **A/B**：把全局 git 配置隔离（`GIT_CONFIG_GLOBAL` 指向空文件）后同一条命令 **36/36 全绿**；不隔离则 35/36 ⇒ 那一条挂的是**本机全局 git 配置**（`core.excludesFile`）造成的环境态。② **CI 读数**：承载该测试的 `债务熔断门禁` 作业在 main 的 push run（39602066073）**success**；本次 PR 同一作业也 **pass** ⇒ 「CI 会持续失败」不成立。

**可复用的三条**：
1. 写「环境态」之前先做 **A/B**：隔离掉可疑的环境变量（全局 git 配置、PATH、语言环境）再跑一遍。读数相同的才叫环境态。
2. 再去查**承载该判据的 CI 作业在 main 上的真实结论**（`gh run list --workflow=…` + `gh api …/jobs` 看具体 step），而不是凭「这类测试通常红」推断。
3. 环境态**不要用 skip 掩盖**（本仓门禁脚本本身不接受 skip，且 skip 会让真缺陷也一起消失）；正确落点是**执行记录里写下 A/B 两档读数与 CI run 号**，让下一个会话直接读到。
