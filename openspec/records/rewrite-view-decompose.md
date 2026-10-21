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
