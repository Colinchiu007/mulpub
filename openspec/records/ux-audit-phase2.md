---
record: ux-audit-phase2
task: 按 UX-AUDIT-2026-10-17 §5 落地阶段 2「发布主流程确定性」批次 E（2.2 历史列表三项 + 2.4 通知前置）、批次 F（2.3 首屏并行化）、批次 G（2.1 ①③ 封面取数 + 2.5 聚合进度软权重）；2.1 ② 与 2.6/2.7/2.8 待后续批次
date: 2026-10-19
sync_status: PENDING
sync_reason: 本片为混合 PR（运行时代码 + 文档），合并后收口由 merge-ledger 按主干历史推导，不另开回填 PR（2026-10-17 起回填通道已取消）
sync_backfill_owner: none-derived-from-trunk
---

## 本次执行记录：UX 审计落地 · 阶段 2 批次 E/F/G（ux-audit-phase2，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR（运行时代码），走隔离 worktree | `scripts/start-mp-task.ps1 -TaskName ux-audit-phase2` ⇒ 非系统盘 `mp-worktrees/mp-ux-audit-phase2` + 裸分支 `ux-audit-phase2`，基线 `6335ffdb4`（当日 `origin/main`）；`pnpm install --frozen-lockfile` + `ensure-electron.js` + `node scripts/verify-worktree-deps.js` ⇒ `消费方解析通过 11 项 … OK`（本批含 electron 改动与打包，必须先过这条） |
| 第一性原因（QM-5 ①） | ✅ | 五条 finding 的共同第一性原因是**"机制在、最后一公里没接"**与**"乘法推导被当成实测结论"**两类。逐条落点：`filteredRecords` 读原始 ref（防抖只挂在加载上）、模板逐行调用无缓存且无 slice、`onMounted` 一串独占 await、监听注册排在 `await load()` 之后、`readImageAsDataUrl` 用 `readFileSync`+`existsSync` 且渲染侧对整列表扇出 |
| 逃逸分析（QM-5 ②） | ✅ | ①**测试场景缺失**：无「渲染结果相同但性能收益消失」这一格的锁 ⇒ 补源码契约锁与装配锁（M5/M9 实测：改回坏形态**只有锁红、行为用例全绿**）；②**Mock 过度/陈旧**：面板 store 夹具停在 5 字段，新组件读的 `progressPercent/running` 恒 undefined ⇒ 70 条用例一条不红，已补「夹具字段集 == 真 `reduceAggregate` 返回键集」对偶锁（改为**跑一次真实现**，不再解析源码——第一版解析器漏认 ES6 简写与赋值形态，两次都被自己的下界断言当场判红）；③**探针失明**：测"主进程冻结"用 `setInterval` 自计间隔，同步档报 0.0ms —— 那是探针没被执行（已 resolve 的 promise 让 await 只在微任务续体，定时器相位从未轮到），换 `monitorEventLoopDelay` 才拿到 397ms/1947ms |
| 系统性漏洞定位（QM-5 ③） | ✅ | 具体到机制：(a) 渲染上限/可见区这类**性能类修复没有可达的判据面**（jsdom 无 IO），既有测试对"是否只为可见行取数"结构性失明；(b) `check-max-lines` 的点名还账文件零增长容差把"顺手加注释"也判红，实测两次（`PublishHistory.vue` +73、`Publish.vue` +2），正解是抽模块而非调阈值；(c) `store` 超 500 行由本批抽出 `publish-progress-aggregate.js` 消除，而不是抬 `debt-baseline` |
| 修复 + 回归保护（QM-5 ④） | ✅ | 跨批次 E/F/G 新增/扩展锁共 **11 个测试文件 / 312 条用例**（数量见下方 TDD 行的逐文件回读）。批次 E：`PublishHistory.test.js`（+3：回显/防抖、上限提示正负两条）、`PublishHistory.rowContract.test.js`（新建，接线、死键、封面输入、装配、TDZ 顺序、可见区接线）、`usePublishHistoryRowFormat.test.js`（新建 16，含导出完整性与"两形态键解析"）、`AutomationView.test.js`（+2）。批次 F：`firstPaintParallel.contract.test.js`（新建 8）、`PodcastChannelView.test.js`（+2 行为级并行锁）。批次 G：`cover-cropper.test.js`（+5 含结构锁）、`useHistoryCoverThumbnails.test.js`（+3 可见区行为）、`publish-progress-aggregate.test.js`（新建 8，含权重表逐档精确断言与"调用方不得缩集"的已知耦合锁 + 装配锁）、`publishProgress.test.js`（+7）、`PublishProgressPanel.test.js`（+4 含夹具字段对偶锁）。变异反证 M1–M16 逐条实跑变红且还原后 md5 与基线一致（`RESTORE_OK=true`） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①口径写进规格：`openspec/changes/ux-audit-implement-phase2/specs/desktop-publish-certainty/spec.md` 新增 5 条 Requirement；②契约与实测基线写进 `01-docs/PRD-UX-AUDIT-PHASE2-PUBLISH-FLOW-2026-10-19.md`（含 §6 十六条反证表、§4 基线表、§7 剩余项契约）；③"探针能不能区分两种状态"作为方法论写入本记录与 learnings；④`check-max-lines` 的教训落成惯例：给被点名还账的文件加内容时**先抽模块**，不动阈值 |
| TDD | ✅ | 行为锁与实现同批；对"结构收益"（查表、并行、可见区）一律补源码/装配锁，并做**行为不变的变异**（M5/M9/M13）证明只有锁能红——这是这类改动唯一的证明手段。当场以 `--reporter=json` 逐文件回读的用例数（合计 **312**，11 个文件，全绿）：`PublishHistory.test.js` 93、`PublishHistory.rowContract.test.js` 9、`usePublishHistoryRowFormat.test.js` 16、`AutomationView.test.js` 15、`firstPaintParallel.contract.test.js` 8、`PodcastChannelView.test.js` 45、`useHistoryCoverThumbnails.test.js` 17、`publishProgress.test.js` 45、`publish-progress-aggregate.test.js` 8、`PublishProgressPanel.test.js` 37、`cover-cropper.test.js` 19（上一行写"9 个文件"是按提交批次数的，跨 E/F/G 实为 11 个，以本行为准） |
| 行尾与 diff 对账 | ✅ | 每批提交前对账 `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat`；批次 E `728/155`、批次 F `189/18` 两口径一致。新建文件均 LF，`git` 的 `LF will be replaced by CRLF` 警告属 checkout 转换。**注意**：`Collection.vue` 实测是 CRLF 文件，脚本锚点用 `\n` 写会报 ANCHOR_NOT_FOUND（那是探针坐标系错，不是锚点不存在）——变异驱动已改为按目标文件行尾归一 |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → `PASS（扫描 10261 个 tracked 文件，无品牌残留）`。审计对照产品在本片文档里一律写「参考产品」 |
| 受管文档绝对路径 | ✅ | `node scripts/check-doc-abs-paths.js` → `PASS（全量审计 4077 个受管文件，无新增本机绝对路径；基线内 564 文件 / 现场存量 1185 处已按文件对齐）`。本片新增文档（PRD/openspec/本记录）路径全部相对仓库根书写 |
| 文档同步 | ✅ | `node scripts/openspec-sync-check.js` → `OK: 387 tasks, 64 active changes, 233 archives`；`check-locale-sync.js --keys` → `PASS（2124 个使用中的 key 均存在于 zh/en）`（本批新增 `historyPage.renderLimitHint`、`publishPage.publishProgressPanel.summaryStep` 各成对） |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → `检查域内测试文件 105 个 / OK`。本批新增 4 个测试文件均属 `apps/desktop` vitest workspace 自动收集面，无需点名接线；未新增 `scripts/` 门禁 |
| QM-1 打包 | ✅ | `pnpm run build:dir` rc=0；产物判据按**键原样打印后 `slice(1)`** 读取（本仓第 4 次踩键形态：`listPackage` 给带前导 `\` 的键，`extractFile` 只认无前导分隔符）：`electron\services\cover-cropper.js`（10915B）`async_fs_read=true / sync_read_left=false`，`electron\ipc-handlers\publish.js`（27854B）`await_handler=true` |
| QM-1 启动 | ✅ | 隔离 profile 启动 9s：`ALIVE_IN_WINDOW=true`、`STDERR_BYTES=0`、`REDLINE_HITS=[]` ⇒ 三层判据第③层（stderr 为空）才判通过；`Multi-Publish.exe` 进程数 0 → 0（只 kill 自己 spawn 的 PID，未批量 kill）；子 env 经 `scripts/lib/qm1-child-env.js` 的 `buildChildEnv()` 剔除 `ELECTRON_RUN_AS_NODE` |
| QM-4 视觉 | PENDING | 本批改动 `PublishHistory.vue` / `PublishProgressPanel.vue` 的展示面，`npm run test:visual:pixel` 需本 worktree 自己的 dev server；尚未跑，**不预写结论**。基线一律取 CI 渲染，禁止 `--update-baseline` |
| QM-6 双模型评审 | PENDING | 本机无 CCG：pre-commit 实测打印 `[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁`。本片不谎称已跑；替代评审通道另行登记 |
| 发现的既有缺陷（不在本批修） | 登记 | `cover:crop` 自引入提交 `f9d1343bd`（PR #1174）起恒返回「图片尺寸无效」：`cropImageFile` 取 `read.width/height`，而 `readImageAsDataUrl` 从不返回这两个字段（已在 `git show f9d1343bd:` 的原始 blob 上核实"从未提供"，非后被删除）。既有测试只有「文件不存在」一条负例，正向路径零覆盖 ⇒ 该缺陷在全绿下存活。本批在 `cropImageFile` 留注释指向它并单列任务，**没有**顺手改：混进本批会让 M13（异步化）的归因失效 |

## 关联

- 上游审计：`01-docs/UX-AUDIT-2026-10-17.md` §5 阶段 2 表行 2.1 / 2.2 / 2.3 / 2.4 / 2.5
- 本片 PRD：`01-docs/PRD-UX-AUDIT-PHASE2-PUBLISH-FLOW-2026-10-19.md`（显示项 / 校验 / 逻辑 / 文案 / 实测基线 / 反证表）
- 规格增量：`openspec/changes/ux-audit-implement-phase2/specs/desktop-publish-certainty/spec.md`（5 条 Requirement）
- 任务清单：`openspec/changes/ux-audit-implement-phase2/tasks.md`
- 与阶段 1 的关系：`ux-audit-impl`（PR #3898）与本分支相互独立，均基于同一份审计；本分支不引用那个尚未合并的 PRD 文件

## 批次 H：发布前摘要确认闸门（2.6 / audit-1，同日续做）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 同一 worktree/分支续做 | `ux-audit-phase2`（无 electron/ 改动 ⇒ 本批不触发 QM-1；上一批次 G 已跑满三层判据） |
| 第一性原因（QM-5 ①） | ✅ | 审计 w1 复核后 audit-1 已由 blocker 降为 major：批量路径确有确认，缺的是**单篇通用路径**没有可否决的摘要 ⇒ 用户只能在"发完之后"才知道发去了几台、会不会被截断 |
| 逃逸分析（QM-5 ②） | ✅ | 既有锁「敏感词接口缺少 data 时按无敏感词处理」写作 `expect(ElMessageBox.confirm).not.toHaveBeenCalled()` ⇒ 它把"没有敏感词弹窗"过宽地写成"一次确认都没有"，闸门上线必然撞红。这是**断言不精确**的现场：改动落地后它既可能被人放宽成"允许一次"（吃掉敏感词回归），也可能被误读成"闸门错了" |
| 系统性漏洞定位（QM-5 ③） | ✅ | (a) 渲染端 CJK 门禁此前从未在本分支跑过（我批次 F 写的 `console.warn('[publish] 首屏数据源失败：…')` 已经违规，直到批次 H 跑 `--cjk` 才暴露）；(b) 摘要这类"文案由代码拼接"的改动没有 locale 归属约束 ⇒ 顿号/中文字面量极易混进 src |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `src/utils/publish-confirm-summary.js`（纯函数）+ `publish-confirm-summary.test.js`（7 条）；`usePublishFlow.test.js` +4 条（文案内容、`invocationCallOrder` 顺序、取消即不派发且解锁、无截断不出截断行、接线锁）；敏感词那条改为按弹窗文案**指名**过滤。变异 M17（删闸门）/ M18（取消后仍派发）/ M19（解析失败改 fail-closed）/ M20（截断行无条件输出）逐条实测变红，还原 md5 一致 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①口径写进规格（本 change 新增 Requirement「发布前必须给出可否决的摘要确认」）；②PRD §9 写明位置不可挪的理由、计数口径、失败取向；③本记录登记"CJK 门禁必须在每个含渲染改动的批次当场跑"，已同步进 tasks.md 5.5 |
| 门禁 | ✅ | `check-locale-sync --keys` PASS(2125) / `--cjk` PASS（基线 1331、当前 1189、无新增硬编码）/ `check-max-lines` ✅ / eslint --quiet 0 违规 / vite build 通过（本批无 electron/ 改动 ⇒ QM-1 不适用） |
| 未覆盖 | 登记 | 闸门是新增模态弹窗，像素门禁不覆盖模态内层（既有失明，见视觉基线记忆）；`audit-1` 提到的"日配额/频控窗口预警"未并入本闸门（属 2.5 之外的另一份数据源，未验证可得的字段前不写文案） |

## 第 2 轮 re-sync（落后 1 个提交 `9fffea446`，PRD-UI-FLOW-CLARITY S1b/S1c/S1d）

冲突 2 个文件、3 个 hunk，全部是**「本 PR 抽走的旧形态」与「main 就地删除的宿主特性」抢同一处**：

| hunk | 现场 | 解法与理由 |
|---|---|---|
| `PublishHistory.vue` import 行 | 本 PR 加了 `FolderOpened`（草稿标签图标），main 的 S1c **删掉整个草稿标签** | 取 main 的图标清单（不含 `FolderOpened`）。它在本 PR 里已无消费者，跟着合并进来就是死导入。audit 三函数的 import 也不取：本 PR 早已把它们抽进 `usePublishHistoryRowFormat`，页面再直接 import 等于两份真源 |
| `PublishHistory.vue` 函数块（89 行） | HEAD 侧为空（函数已抽出），main 侧仍是旧的内联形态并新加一条 `contentPreview 已删除` 说明 | 取 HEAD 的空侧 + **只保留 main 那条缺席说明**，并把它的理由改写成本分支的真实收口：`contentPreview` 的唯一调用点是草稿卡片正文摘要，卡片随 S1c 下线 ⇒ 连 composable 里的那份一并删除 |
| `Publish.vue` onMounted | 本 PR 把首屏改成 `Promise.allSettled` 三源并行；main 的 S1c 删了 `showDraftList`（页内浮层开关），并把「草稿页签才加载列表」改成整页判据 | **保留并行版**，但必须删掉 `if (draftsTab) showDraftList.value = true` —— `usePublishDrafts` 已不再导出该状态，这行两侧文本都"合法"、合起来是 `showDraftList is undefined` 的运行期崩溃，而它落在冲突块里恰好被看见 |

**`contentPreview` 的删除不是"顺手清理"**：`git grep` 在合并后的树上只剩 composable 的导出与两处测试引用，
模板零调用。按 AGENTS「确定未被使用即可完全删除」执行，并把测试侧改法写成**墓碑断言**而不是删掉了事：
`usePublishHistoryRowFormat.test.js` 的导出清单从 17 → 16，原 `contentPreview` 用例替换为
「api 上没有它 + composable 源里不得再出现 `function contentPreview(` + 不得出现裸 `contentPreview` 导出项」三条，
这样它复活时会红。

**`check-max-lines` 的 TARGET_GREW 与不放宽口径**：`Publish.vue` 是**点名还账**文件（目标 1773，零增长容差），
合并后 1777 ⇒ 红。处置**没有**上调 target，而是把本 PR 的注释从 4 行压到 1 行、并把
`const draftsTab` 与 `const sources` 合成一条声明（两个声明符），回到 1772 行。
关键约束是 `firstPaintParallel.contract.test.js` 的源码锁**逐字要求**
`if (draftsTab) sources.push(['loadDrafts', loadDrafts()])` 这种形态，
所以"改成条件展开（`...(cond ? [[...]] : [])`）以省一行"是**被锁否决**的方案 ——
这条锁在此处的作用不是碍事，而是防止性能改动退化成条件 await。压完 8 条契约锁仍全绿。

**取证（当场实跑，非引用）**：9 项静态门禁全 rc=0（`check-max-lines` 无新增超限且点名还账文件回到 1772、
locale `--keys` 2125 成对、`--cjk` 1164 < 基线 1331、css-var、font-size、brand-residue 10582 文件、
doc-abs-paths、unwired-tests、no-conflict-markers 标记行 8 全带登记）；
`vitest run` 交汇面 9 个文件 → **419 passed**（PublishHistory 90 / rowContract 9 / rowFormat 16 /
coverThumbnails 17 / Publish / usePublishFlow / publishProgress 45 / PublishProgressPanel /
publish-confirm-summary 4），另压行后复跑 `firstPaintParallel`(8) + Publish + PublishHistory + rowFormat
→ **227 passed / 4 files**；
行尾对账 `git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐文件相等
（`Publish.vue` 37/37、`PublishHistory.vue` 20/114）。
**QM-1 本轮不重跑**：入站 59 个文件里 `apps/desktop/electron/**` 与 `packages/rpa-engine/**` 命中 **0**，
electron 树与批次 G 已实测 PASS 的产物逐字相同。

## 第 3 轮 re-sync（落后 8 个提交，merge 后 push 前取证）

- **为什么走 merge**：本分支 9 个提交、主干 8 个新提交，且 `CHANGELOG.md` 顶部必撞 ——
  与 impl 分支同一判据（同一处冲突不付 9 遍）。
- **唯一冲突 `CHANGELOG.md`**：一个 hunk，`mine=34 / theirs=7`，两侧都非空；并集解法逐行保留各自 EOL；
  对账 **vs HEAD `34 0` 且 vs origin/main `34 0`，两种 `--numstat` 口径逐字相同**（双向纯插入，零删除）。
- **验证面按「变更集交集」取**（交集 4 个文件：`CHANGELOG.md`、`locales/publish-page/{zh,en}.js`、`stores/publishProgress.js`）
  ⇒ `stores/publishProgress.test.js` + `components/PublishProgressPanel.test.js` + `views/Publish.test.js` +
  `views/PublishHistory.test.js` + `composables/usePublishHistoryRowFormat.test.js` = **301 passed / 5 files**；
  `check-locale-sync --pair-base origin/main` / `--cjk` / `check-max-lines` 全 PASS。
- **自动合上 ≠ 合对，三条不变式逐条回读**：① `showDraftList` 在源码里只剩注释与一条
  「断言它为 undefined」的负向测试（S1c 删掉的东西没有被合并带回来）；② `contentPreview` 在
  `usePublishHistoryRowFormat.js` 里仍为 0 次（主干 #3951 大改 PublishHistory，这块必须重验）；
  ③ `FolderOpened` 在 `PublishHistory.vue` 只出现在**解释为什么不导入它的注释**里（死导入未复活）。
- **一条需要如实说明的重叠风险**：主干 `9fffea446`（PR #3951「S1 导航收敛 + S2 披露明示」）与本批的
  PRD §10（S1b/S1c/S1d 浮层与草稿箱收敛）**是同一族改动的两个来源**。合并没报冲突不等于两边做了同一件事：
  后续若在 PRD/审计里读到同一要求的两套表述，收敛方向是**以主干已落地的实现为准**、把我这边的规格文字并过去，
  而不是留两份。本轮没有替主干改任何一行。
- **上一次 CI 红的归因仍未结清**：#3986 的 `QG Browser E2E` 红在 Flow1.7（`publishBatch` IPC 0 次调用）、
  Flow5.2/5.3（离线合同：`offlineCacheCalls=0`、恢复在线后按钮仍 disabled）、Flow6.2（错误提示不可达）。
  这些都不在本批 diff 的语义面上（本批只改首屏并行批次门控与历史行格式化），且 main push 的同一 job 是
  **success**（run `39192099035`）⇒ 最可能的解释是**检查跑在落后的 base 上**（PR 处于 CONFLICTING 时
  GitHub 只对 head 单侧跑）。本次合并把 base 抬到当前 main，若重跑仍红，就必须按本仓口径逐条查，
  不得以「不是我改的」放行。

## 远程同步

| 远程同步 | 由门禁推导 | 本行**不事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导归属（只认 squash 尾注 `(#3986)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇还不在基线上 ⇒ 判 `byDesign` 不红；把状态列预写成 `PASS` 会被 `prematureClaims` 判红（change: `ban-record-closure-backfill-pr` / `gate-record-sync-derived-status`）。main push 回读证据写在 PR 评论里，不写回本文件。 |

## CI 抓到的一条真实回归：阶段 2.6 改了「一键发布」的语义，却没同步集成流（2026-10-19，QG Browser E2E 三条红）

| 维度 | 内容 |
|------|------|
| 现象 | `QG Browser E2E` 判红三条集成流：flow-1「创建→发布→看板」`Flow1.7 publishBatch IPC 被调用` false（details `{"publishBatch":0,"publishWechat":0}`）；flow-5「设置变更级联」`Flow5.2` false（`offlineCalls=2, offlineCacheCalls=0, response.data.offline=true`）+ `Flow5.3` false；flow-6「错误路径」`Flow6.2 IPC 失败后错误提示可达` false。三条全部 `consoleErrors=0 pageErrors=0` ⇒ 不是页面崩，是**那条 IPC 从未被发起**。 |
| 归因（不是猜） | 同一时段 #3992 / #4010 / #3996 三个 PR 的 `QG Browser E2E` 都是 pass（它们都含同一个 main tip）⇒ 不是基础设施；失败面恰好是阶段 2 改到的三条发布相关流。`usePublishFlow.js` 本批新增 `const confirmed = await notifyConfirm(...); if (!confirmed) return`，而 `apps/desktop/tests/e2e/helpers/integration-flows.js` 在本 PR 的改动集里**不存在**（`git diff --name-only` 无该文件）⇒ 实现变了、锁没跟着变。 |
| 第一性原因（QM-5 ①） | 「一键发布」的产品语义由"点下去就发"变成"点下去先看清去哪发、确认后才发"。这条变更只改了生产代码与本批的单元测试，**没有把"谁在按旧语义断言"列进改动集**。集成流的断言形状是 `click → waitForIpcIncrement`，中间多出一次模态交互它就必然红。 |
| 逃逸分析（QM-5 ②） | ① 单元测试层：`usePublishFlow.test.js` 直接把 `notifyConfirm` mock 成 resolve(true) ⇒ 新闸门在单测里**永远被确认**，测不出真实交互链上没人点确认；② 视觉层：像素基线是发布页默认态，模态框未出现 ⇒ 0 差异；③ E2E 层：**唯一能抓到的地方，而它按旧语义写**；④ 审查层：本 PR 的 diff 里没有测试文件以外的发布链读者清单。归类为"测试场景缺失 + 实现迁移未同步锁"。 |
| 修复 + 回归保护（QM-5 ④） | `integration-flows.js` 新增 `acceptPublishSummaryConfirm(r, timeout)`：等 `.el-message-box` 可见 → 取其文本 → 点 `.el-message-box__btns button.el-button--primary`；取不到一律如实返回 false，**不抛错**（抛错会把整条流判成基础设施故障，掩盖真实原因）。三条流各接一处，并新增三条**正向**检查：`Flow1.6b 发布前摘要确认出现并可确认`、`Flow5.1b 离线发布同样经过摘要确认`、`Flow6.1b 失败路径同样经过摘要确认`；随后的 IPC 等待判据从 `publishClicked` 改为 `confirm.clicked` —— 让"没确认"与"确认了但 IPC 没来"在报告里是可区分的两件事。 |
| 防止再次发生（QM-5 ⑤） | ① 三条 `*b` 检查把新契约钉成**必须出现**：确认闸门若被无声去掉（反向回归），`dialogFound=false` 当场红，而不是"少测一项"；② 本记录把这条写进 QM-2 同族清单：改任何"用户点一下之后会发生什么"的语义时，改动集必须包含 `grep -rla <该入口文案或 testid> apps/desktop/tests/e2e` 的读者清单；③ 离线路径也被显式覆盖（`Flow5.1b`），避免"确认只在在线路径"这种半覆盖被误当成全覆盖。 |
| 未闭合（不假装） | 本机未跑 QG Browser E2E（需 dev server + Playwright，且历史预算 30 分钟），本判断的最终裁决在 CI 的这一次运行。若 `Flow1.6b` 反而红（例如 E2E 现场 `buildPublishSummaryMessage` 取不到篇数走了"跳过确认"分支），那是**新信息**：说明摘要在某些合法现场会 unresolved，需要按那条分支重新设计确认契约，不得回头把检查删掉。 |

## 七、与主干的语义冲突怎么合（2026-10-19 re-sync，merge commit e311e9295）

`origin/main` 前进到含 #4000（S3 交接参数收敛）与 #4019（头条封面五步链）之后，
`Publish.vue` 的 `onMounted` 与本分支阶段 2.3（audit-63 三源并行）**撞在同一段代码上**。
这是**代码文件的冲突，一律不许 union** —— 先 `git merge --abort` 回到干净态，再按语义合并。

### 7.1 两个意图其实不矛盾，矛盾的是文本

| 侧 | 它要什么 | 它的实现长在哪 |
|---|---|---|
| 主干 #4000 | 入口裁定只有**一个**出口：批量 / 单篇 / 再次发布 / `?video_path=` 预填的优先级与互斥 | `composables/useRouteHandoff.js` 的 `applyRouteHandoff()`（内部含 `applyHistoryVideoQuery` / `handoffIdsFromQuery` / `loadDrafts` + `loadDraft` / republish） |
| 本分支 2.3 | 首屏三个互不依赖的数据源不得串行 await（串行 ⇒ 耗时是三者之和） | `Promise.allSettled([loadAccounts, loadPrecheckPreference, (+loadDrafts)])` + 逐源 `rejected` 只 warn |

**合并结果**：`applyCopyDetailHandoff()` 仍在最前（copy-detail 契约锁要求"挂载即消费载荷"，它依赖这一点所以**不能**并进 `applyRouteHandoff`）→ 三源并行块 → 默认选中账号循环（必须在 `loadAccounts` 落地之后）→ `await routeHandoff.applyRouteHandoff()`。**本分支原先内联的那 16 行 handoff 优先级判据被删掉**，因为它正是 #4000 要消灭的"第二份各自判"——留着它就是把主干的重构回滚一次。

### 7.2 为什么"跑通测试"不等于"合对了"

合并后跑的不是"整包一遍"，而是**按被改区域的承重锁逐个点名**：`src/views/Publish.test.js` + `src/composables/useRouteHandoff.test.js`（120 passed）、`src/views/firstPaintParallel.contract.test.js` + `usePublishFlow.test.js` + `usePublishFlow.m1-reentry.test.js`（96 passed）、`copy-detail-handoff` / `copy-library-truncation` / `CopyLibraryView`（27 passed）。其中 `firstPaintParallel.contract.test.js` 是**本分支自己写的并行契约**：如果合并时把并行块顺手退成串行，红的是它，而不是任何一条主干测试 —— 这就是"按谁读这段代码去选验证域"的具体用处。

### 7.3 一次差点留在仓库里的损坏（自我抓住，必须记）

CHANGELOG 的 union 我第一遍写成 `readFileSync(p, 'latin1')` + `writeFileSync(p, out.join('\n'))`（**写的时候没成对声明 latin1**）⇒ 每个中文被按 latin1 解出再以 UTF-8 编码写回，`未`（`e6 9c aa`）变成 `c3 a6 c2 9c c2 aa`，**整份 CHANGELOG 变成 mojibake**。
危险的是它**不报任何错**，而且 git diff 只看行内容时看起来"只是中文乱了"，真正暴露它的是我自己的**字节级对账探针**：它对 CHANGELOG 报 `lost=47 且全部是非 ASCII 行`（ASCII 行 0 丢失）。"只有非 ASCII 行全丢"这种分布根本不是"内容丢了"的形状，而是编码被换了形状。
正解与验证：`git checkout --conflict=merge -- CHANGELOG.md` 从 index 的三个 stage 把冲突态还原（注意它写的标签是 `<<<<<<< ours / >>>>>>> theirs`，不是 `<<<<<<< HEAD`——按 HEAD 找锚点会得到 0 个块，这是"探针 0 命中先怀疑坐标"的又一次现场），再以 latin1 读 + latin1 写重做 union，最后断言**文件头 12 字节的 hex** 回到 `23 20 5b e6 9c aa e5 8f 91 e5 b8 83`（`# [未发布`）+ lost=0 + markers=0。
**口径**：① 字节保真的读写必须**成对**声明编码，且收尾断言用"文件头 hex + 双向行多重集"，不用"看起来对"；② 同一批里凡用了 latin1 读，就要把该次所有写回都过一遍同样的头字节检查（本会话另两处 union 已核：首字节均为合法 UTF-8，未受影响）；③ 判"丢了 N 行"之前先看**丢失集合的形状**：全非 ASCII ⇒ 先怀疑仪器，不是先改文件。
