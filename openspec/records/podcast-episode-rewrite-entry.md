---
record: podcast-episode-rewrite-entry
task: 闭合 tasks 4.3②-b 的收尾缺口（给已合并的文案库入口补三条渲染层锁）并落地 ②-b②（RewriteView 改写结果区入口，PRD §7.10.3.4）
date: 2026-10-17
sync_reason: 本 PR 合并后由同线程回填远程同步行（回填与销账同一次提交，并删除本 frontmatter 两个登记字段）
sync_backfill_owner: 本会话（podcast-episode-rewrite-entry 线程）
---

# 本次执行记录：②-b 收尾锁 + ②-b② 改写区入口（podcast-episode-rewrite-entry，2026-10-17）【完整流程】

> 分支 `podcast-episode-rewrite-entry`，worktree `<仓库父目录>/mp-worktrees/mp-podcast-episode-rewrite-entry`（非 C 盘），起点 `origin/main` `4e20042a0`。
> 载体冻结已生效 ⇒ **未写** `.quality-gates.md`、**未加** ledger 键；本篇是本 PR 记录的唯一载体。
> 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 PENDING | 远程同步 PENDING

| 门禁 | 状态 | Fresh 证据（当场实测，非记忆） |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 独立 worktree + 裸分支，入口是 `scripts/start-mp-task.ps1 -TaskName podcast-episode-rewrite-entry`（本次实跑通过：`pnpm install --frozen-lockfile` Done in 43.3s → `[ensure-electron] electron dist 已就绪：v43.7.7` → `[verify-worktree-deps] worktree: <仓库父目录>/mp-worktrees/mp-podcast-episode-rewrite-entry` + `消费方解析通过 11 项` + `OK`）。共享根 `<仓库根>` 在本次开工前 `git status --porcelain` 为 **0 行**（上一轮挡路的他人 `M 01-docs/learnings.md` 已由 #3795 代为提交入库），`git merge --ff-only origin/main` 后停在 `076f3df53`，未在其上落任何运行时改动 |
| 第 0 步：②-b 收尾缺口的定性 | ✅ | 合并后只读审计的结论先复量一遍再动手：`origin/main` 的 `CopyLibraryView.test.js` 只有 9 条 `it()`，全文 `grep usePodcastChannel\|PodcastScriptEntry\|activeChannelId` **命中 0** ⇒ 那段入口代码可以整块坏掉而 CI 照绿（PRD §7.10.3.2「没有消费者的通道属装饰性链路」的镜像形态：**没有锁的消费者是隐形链路**） |
| 测试（TDD，第 0 步三条新锁） | ✅ | `CopyLibraryView.test.js` 9 → **12 passed**（夹具新增 `draft:d-empty` 空正文条目；`usePodcastChannel` / `@/api/podcast-channel` / `useEmbeddedViewSuspension` 三处 mock 让频道值可从用例拨动，默认 `''` 以保持原 9 条行为不变）。变异反证三条**各自指名红、`escaped=0`**：摘按钮 `v-if` ⇒ 只红「无默认频道：动作根本不出现」；摘正文空白早退 ⇒ 只红「正文取不到：浮层一次都不挂载」；摘 `@click.stop` ⇒ 只红「有默认频道：动作出现，点击只挂浮层」。驱动 变异驱动（落盘于本机临时目录，形如 `<临时目录>/mutate-entry-locks.cjs`） 跑完按字节还原生产文件（`file_restored_bytes_identical=true`），基线非绿即 `exit 2` 不认领 |
| ②-b② 实现（数据校验 / 流程 / 交互 / 显示项 / 提示文字） | ✅ | **正文**＝`rewriteResult.value` 当前串，不回查草稿、不另取全文（§7.10.3.4 表第 1 行）；**标题**＝把 `saveToDraft` 内联的 `rewriteTitle \|\| content.slice(0,64) \|\| t('rewritePage.title')` 提出为 `resolveRewriteTitle()`，入口与存草稿**共用这一份**（原表达式留两份即「一件事两处写」）；**频道**＝`usePodcastChannel().activeChannelId` / `ensureChannel()`，本视图不解析第二份、不放下拉；**浮层**＝复用 `PodcastScriptEntry.vue` 与 owner `podcast-script-entry-overlay`，未新建组件；**locale 键新增 0 把**（七把已落键原样复用，故 Gate 7 locale 成对检查无新面）；提示文字复用 §7.10.5，改写稿过短同样落 `PODCAST_TTS_COPY_TOO_SHORT`（其文案自带下限 80） |
| 测试（TDD，②-b② 四条锁） | ✅ | `RewriteView.test.js` 88 → **92 passed**，新增 describe `RewriteView — 文本出期入口的合同（§7.10.3.4 ②-b②）`：①有频道+有正文 ⇒ 动作出现、浮层挂载、**预览入参逐字带出含哨兵串的那份正文**（判据 4 的入口侧落点）；②标题与存草稿共用提取点（两边相等 **且** 正控 `draftTitle === '这是改写后的标题'`，否则「两边都空」也算相等）；③无默认频道 ⇒ 动作根本不出现（反向正控：同一动作行里 `btn-video-create` 在位，排除「整行没渲染」）；④正文空白 ⇒ 动作不出现、浮层实例 0、预览 0 次 |
| 变异反证（②-b②，六条） | ✅ | 变异驱动（本机临时目录，下同）实跑：`RW-M1` 摘频道门控 ⇒ 指名红 1；`RW-M2` 摘空白正文门控 ⇒ 指名红 1；`RW-M3` `script: body`→`''` ⇒ 指名红 1；`RW-M4` 入口侧标题发散 ⇒ 指名红 1；`RW-M5` **存草稿侧**标题发散 ⇒ 红 2（指名那条 + 既有「存入草稿携带改写结果标题」），多出的那条是**防御重叠**而非逃逸：两条锁在看同一个提取点，恰是「共用一份」应有的样子；`RW-M6` 往 `src/` 里放一个自算块数的文件 ⇒ 结构锁指名红 1。全部 `escaped=0`（除 M5 的重叠条），`vue_restored=true probe_left=false` |
| 结构锁（§7.10.3.4 验收判据 3） | ✅ | 原判据只在 PRD 里写了一句 `git grep` 口径、**没有任何东西在跑它**。本 PR 落成机械锁：`PodcastScriptEntry.test.js` 新增 `渲染层不得出现第二份分块/音色实现`，对 `apps/desktop/src/**` 的非测试 `.vue/.js` 逐个扫 `planChunks` / `resolveEpisodeVoice`，另配一条**扫描域规模下界**（`> 200` 文件）——域塌成空集合时「零命中」读起来完全像通过，这条是反失明而不是装饰。当场读数：本 PR 前 `src` 非测试文件命中 **0**（已实跑核对），锁随之绿；`RW-M6` 证明它有牙 |
| QM-1 打包 | N/A（**判据不触发，不是跳过**） | QM-1 的触发面是 `apps/desktop/electron/` 与 `packages/rpa-engine/`；本次改动集四个文件全在 `apps/desktop/src/`（两枚视图/浮层的测试 + `RewriteView.vue`），未动主进程、preload、IPC 通道与任何 bundle ⇒ 按 AGENTS 的口径记 N/A，**未**跑 `electron-builder`，也**不**借上一片（#3776）的打包读数顶替本片 |
| QM-4 视觉 | N/A（**已当场量，不是转述**） | 本片的可见改动落在 `rewrite` 视图。实测：它**在采集注册表**（`views/all-views.visual.test.js:68` 的 `routeView('rewrite', …)`）但**不在像素比对域**（`tests/visual-testing/scripts/run-pixel-tests.js` 的 `pixelTests` 里 `grep -n rewrite` 命中 0），且 `base-screenshots/` 内 `grep -i rewrite` 命中 0 ⇒ `QG Visual` 既不比对它、也没有基线可漂移。「注册即判定域」棘轮**改动前后各读一次、逐字相同**：`判定域 112 / 基线 43 / 缺 69（已登记 69，上界 69）/ 无主基线 0`（`node scripts/check-visual-coverage.js` rc=0）⇒ 新增按钮没有把缺口顶过上界，也未新增注册视图 |
| 行尾与 diff 对账 | ✅ | 两口径逐行相同：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 输出四行完全一致（`PodcastScriptEntry.test.js 43/0`、`CopyLibraryView.test.js 76/0`、`RewriteView.test.js 114/0`、`RewriteView.vue 40/1`）。工作副本是 `i/lf w/crlf attr/text=auto`，编辑后当场用 行尾量测脚本（本机临时目录） 量得 `bareLF=0 loneCR=0`（编辑工具按文件既有行尾写回），并加了一条**规模上界**核对：改动行数 ≪ 插入行数×3，没有把整份文件刷成幽灵行 |
| 既有红不认领（控制对照） | ✅ | 首轮跑登记面时 `overlay-view-suspension.test.js` 报 1 红：`preload index.bundle.js 已重打包` ENOENT。按「既有失败不认领」的姿势做对照跑（对照驱动，本机临时目录）：备份我改的四个文件 → `git checkout HEAD -- <精确路径>`（禁宽目录、禁 stash）→ 跑同一条命令 → 还原 → 两侧 md5 唯一值各 1。读数：未改动 HEAD 上 `total=22 failed=["…preload index.bundle.js 已重打包…"]`，带我改动**同一失败集** ⇒ `SAME_FAILURE_SET=true`，属新 worktree 缺构建产物（`index.bundle.js` 已在 #3782 移出版本控制，`.gitignore:403`）而非本 PR 引入。随后 `pnpm run build:preload` 生成产物，该文件 **22 passed**；五个受影响文件合跑 **143 passed / 5 files** |
| 品牌残留 / 文档同步 | ✅ / PENDING | `node scripts/check-no-brand-residue.js` 实跑 `PASS（扫描 9727 个 tracked 文件，无品牌残留…）` rc=0；openspec 同步检查本机不冒认，由 CI 的 `openspec-sync-check` 出结果后随回填改写本格 |
| QM-6 CCG 双模型外部评审 | PENDING（本行由后续提交就地改写） | 本片改动集 >200 行 ⇒ `scripts/ccg-review-decider.js` 判 `mode=dual`，按 AGENTS 必须等后端轴结论、前端轴最多重试 2 次。产物粒度陷阱已在 #3776 记录过（判定产物按**父提交**入库、`deep-review.sh` 只服务**当前 HEAD**）⇒ 本片把顺序摆正：**先提交、再在 HEAD 上跑双轴**，让评审范围与判定记录同源，不回补历史产物 |
| 远程同步 | PENDING | 待本 PR 合并后由同线程回填 |

## 一、这一片交付的是什么

两件事，一条是**还债**、一条是**推进**：

1. **②-b 的收尾缺口**（合并后只读审计发现）：文案库那枚入口的行为合同在主干上没有任何东西在看。补三条锁，每条对应一个可被摘掉的守卫（`v-if` 门控、正文空白早退、`@click.stop`），并各做一次「摘掉它必须指名变红」的变异。
2. **tasks 4.3②-b②**：改写结果区那枚入口。合同早已在主干 PRD §7.10.3.4（#3784/#3785 那批 docs-only 切片）里钉死逐字段来源，本片按合同落地，不重新裁决任何一件事——这正是「合同先行」的价值：开工时不需要再问「正文从哪取、频道从哪来」。

## 二、三处值得留给下一个人的判断

- **「空白即无正文」落在哪一层，取决于正文在哪**。文案库那枚必须先异步取文，所以判据落在「取到才挂浮层」（点击后早退）；改写区这枚的正文就在内存里，同一件事的正解是**动作根本不出现**（渲染层就判掉）。两枚形态不同但合同同源，PRD 里把这条差异写明了，否则下一个会话会把它当「两枚实现不一致」。
- **负向断言必须配正控**。「动作不出现」在旧夹具里之所以能被 9 条用例一起漏过，是因为夹具的频道值从未被置过 ⇒ 那一块 DOM 从来就不存在 ⇒ 「不存在」恒真。本片每条负向锁都带一条同源正控（按钮在位 / 浮层挂载 / 预览被调 / `draftTitle` 等于那个具体值），否则把守卫改成 no-op 也不会变红。
- **提标题表达式为函数不是「顺手重构」**。`resolveRewriteTitle()` 是 §7.10.3.4 那行「与去发布共用同一个提取点」的直接要求：入口写一份、草稿写一份，下次改标题规则就会只改一处。`RW-M5`（在存草稿那侧让它发散）就是为了让「共用」这件事不能靠注释维持。

## 三、故意没做

- 不给 `Publish.vue` 那枚（②-b③）顺路接线：它的前置问题是「`article.content` 是在途状态，出期要不要固化一版草稿」，答它需要发布链的幂等判据，属另一个切片。
- 不在改写页放频道下拉（§7.10.3.2 已裁定），不新增 locale 键，不在前端算块数/码点/音色。
- 不改 `check-visual-coverage` 的任何登记项：缺口上界只能缩小，本片没有资格为「新按钮」新增登记。
