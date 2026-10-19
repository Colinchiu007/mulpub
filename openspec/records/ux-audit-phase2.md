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
