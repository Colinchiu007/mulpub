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
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增/扩展锁共 9 个文件：`PublishHistory.test.js`（+3：回显/防抖、上限提示正负两条）、`PublishHistory.rowContract.test.js`（新建 9：接线、死键、封面输入、装配、TDZ 顺序、可见区接线）、`usePublishHistoryRowFormat.test.js`（新建 16，含导出完整性与"两形态键解析"）、`useHistoryCoverThumbnails.test.js`（+3 可见区行为）、`AutomationView.test.js`（+2）、`firstPaintParallel.contract.test.js`（新建 8）、`publish-progress-aggregate.test.js`（新建 9）、`publishProgress.test.js`（+7）、`cover-cropper.test.js`（+5 含结构锁）。变异反证 M1–M16 逐条实跑变红且还原后 md5 与基线一致（`RESTORE_OK=true`） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①口径写进规格：`openspec/changes/ux-audit-implement-phase2/specs/desktop-publish-certainty/spec.md` 新增 5 条 Requirement；②契约与实测基线写进 `01-docs/PRD-UX-AUDIT-PHASE2-PUBLISH-FLOW-2026-10-19.md`（含 §6 十六条反证表、§4 基线表、§7 剩余项契约）；③"探针能不能区分两种状态"作为方法论写入本记录与 learnings；④`check-max-lines` 的教训落成惯例：给被点名还账的文件加内容时**先抽模块**，不动阈值 |
| TDD | ✅ | 行为锁与实现同批；对"结构收益"（查表、并行、可见区）一律补源码/装配锁，并做**行为不变的变异**（M5/M9/M13）证明只有锁能红——这是这类改动唯一的证明手段 |
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
