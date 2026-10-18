---
record: podcast-publish-entry
task: 落最后一枚文本出期入口（Publish.vue 文本类分支），把 PRD §7.10.3.4 ②-b③ 的合同变成有验收的实现
date: 2026-10-18
---

## 本次执行记录：发布页文本出期入口（podcast-publish-entry，2026-10-18）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/src/views/Publish.vue` + 新增渲染层测试）⇒ 隔离 worktree `D:/Data/projects/mp-worktrees/mp-podcast-publish-entry`、裸分支 `podcast-publish-entry`；`git rev-parse --abbrev-ref HEAD` 实证，`node scripts/verify-worktree-deps.js` 通过（11 项解析到本工作树），`ensure-electron` 报 v43.7.7 就绪 |
| 第一性原因（QM-5 ①） | ✅ | 这枚入口未落的第一性原因不是漏写代码，而是**前置问题没被回答**：`article.content` 同时被发布动作与改写面板（`Publish.vue` 的 `@apply-content`，会写正文并挂 `rewriteHistoryId`）双向改写，是**在途状态**；上一片（②-b②，PR #3807）把两枚入口的逐字段合同写进 §7.10.3.4，但 ②-b③ 留了「出期要不要顺手固化一版草稿」这一问未答。本片的答案：**不固化**，入口全程只读——要固化必须另立切片并先补发布链幂等判据。这一条由变异 M6 钉住，不是靠注释自觉 |
| 逃逸分析（QM-5 ②） | ✅ | ①单测层：主干上这枚入口**零验收**——`src/views/Publish.test.js` 1900+ 行没有一条用例引用过 `activeChannelId` / `PodcastScriptEntry`，「入口不存在」与「入口存在但坏了」在既有测试里完全同形；②执行层：新文件在不在收集域是这类逃逸的主因，本仓 `vitest.config.js:24` 的 include 含 `'src/**/*.test.{js,ts}'` glob（无需逐个登记），实跑 `vitest run src/views/PublishPodcastEntry.test.js` 收集到 7 条即现场自证；③夹具层：首版夹具只 mock `$route` 未装 router 插件 ⇒ `useRoute()` 返回 undefined，七条一起挂在 setup 的 computed 上——那是**整片 LOADFAIL 级的无归因红**，补 `createRouter` 后红才指到具体缺陷；④视觉/审查层：入口在 `Publish.vue` 属既有像素域视图，交由 CI `QG Visual` 承担（本机缺 dev server，不冒充跑过，见 QM-4 行） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 实现 3 处插入（模板动作 9 行 / 根级浮层 9 行 / script 接线 17 行 + import 2 行），判据复用同一个谓词 `podcastEntryAvailable`（模板门控与 `openScriptEntry` 早退**一处定义两处用**，不出现第二套 trim 口径）。回归保护 `src/views/PublishPodcastEntry.test.js` **7 条全绿**：判据 1（无默认频道 ⇒ DOM 不存在）+ 反向正控、判据 2（正文全空白 ⇒ 动作不出现且 `findComponent(PodcastScriptEntry)` 为 false、预览 0 次）、判据 4 前半（预览入参逐字带出含首尾空白的哨兵正文）、判据 4 后半（出期载荷 `copy.content` 逐字相等 + `billingConfirmed === true` + `runId` 形态 + `channelId`）、只读副作用（打开并确认后 `article.content` 逐字未变）、常驻不卸载（关闭后实例仍在树里且不发第二次出期请求） |
| 变异反证 | ✅ | **10 道变异里 9 道指名红、红集互不相同**：M1 摘模板闸 ⇒ 判据 1+2；M2 正文判据退回「非空串」⇒ 判据 2；M3 入口顺手 trim ⇒ 4 前半+后半+只读+常驻四条；M4 标题写死空串 ⇒ 4 后半；M5 浮层常驻不按需 ⇒ 判据 2；M6 把归一化正文写回在途状态 ⇒ 只读那条。**M7 实测 NOT_CAUGHT**，第一动作是归因而非加断言：摘掉 `openScriptEntry` 里复用谓词的早退之所以红不出来，是因为点击路径已被同一个谓词在模板层挡死，夹具构造不出「按钮存在但谓词为假」的现场——属**防御重叠不可分辨**，不是锁失效；承重的三把闸是 M1/M2/M5。跑法 `D:/Temp/mutate-publish-entry.cjs`：每条先断言锚点命中=1、直跑 `node <hoisted>/vitest.mjs`（经 pnpm/shell 会把「跑了 0 条」读成全绿）、规模下界 `numTotalTests ≥ 7` 否则 `DOMAIN_COLLAPSED` 不认领、跑完按字节还原并核 md5 相等（末次读数 `restored ... equals_baseline=true`）。**第二轮（v2）在 QM-6 之后扩到 10 道**：新增 `M2b`（把 L1 收口出来的单一取源 computed 写成归一化值 ⇒ 判据 4 前后两条红）、`M8`（在 setup 里就去 `ensureChannel` ⇒ 判据 1 与判据 4 共三条红，证明 L4 那条"不得偷偷解析频道"的断言有牙）、`M9`（改浮层本体的 `onCancel` 让它补发一次出期 ⇒ 只有强化后的常驻/关闭那条红，证明 L3 改名不是修文案而是补上了前置条件）；`M2` 因 L1 收口换了落点，重打到新行后仍指名红。**驱动自身在这一轮又暴露两处**：① `--apply` 前 `| tail -N` 只看栈尾会错过真红因，报错一律先取 head；② 多重集自检的键是 `trim()` 后的，`dropped` 集合必须同域，否则合法的替换会被读成「原行丢失」。 |
| 行尾与 diff 对账 | ✅ | 两口径 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐文件相同（提交前现取）。`Publish.vue` 工作副本是 CRLF（`i/lf w/crlf attr/text=auto`），插入一律走「按该文件自身 eol 档逐行 splice 再 join」的驱动，写盘前断言 **CR 增量 == 插入行数**（当场读数 `before=1750 after=1787 delta=37 expected=37 inserted=37`）；新建的测试文件与本篇记录是 LF，同样要求 `cr==lf`。本篇记录自身的行数属**自引用数**（每编辑一次就自增），故不钉常量、按现值重取 |
| 接线棘轮 | ✅ | 新增文件落在 `vitest.config.js` 的 `src/**/*.test.{js,ts}` include glob 内（非 electron 子目录那种逐个登记的白名单），无需改配置；本仓 `scripts/check-unwired-tests.js` 的扫描域把 `apps/` 记为 `WORKSPACE_COVERED`，因此这条的现场证据是**不带任何位置参数的 `vitest list` 里这份文件的用例名命中 7 条**，不是「文件存在」、也不是"我点名跑过一次" |
| QM-1 打包 / QM-4 视觉 | N/A / 交 CI | QM-1 不触发：改动集实测零 `apps/desktop/electron/**`、零 `packages/rpa-engine/**`（`git diff --name-only` 现取），未触主进程与打包资源面。QM-4：`Publish.vue` 属视觉面，本机像素门禁需要 dev server 与本工作树自己的 Chromium，**不在本机冒充跑过**，证据责任点名交给 CI `QG Visual`（Gate 7 / 7b） |
| QM-6 CCG 双模型外部评审 | ⛔ 未闭环（交人裁决，不自己盖章） | 判定产物 `.ccg/reviews/a80fe068….json`，`mode=dual`（238 行 > 200 阈值，跨家族 proposer=opencode / critic=claude 校验通过）。**两轴都没拿到正式 findings 清单**，实况逐条：引擎 `deep-review.sh` 第 1 轮 `spawnSync codeagent-wrapper ETIMEDOUT`（引擎 `timeoutMs=600000` 到点），产物被回写为 `status=error / performedBy=claude`；后端轴手动 2 次，每次 `api_retry` 打满 10/10 全 `502 server_error` 后 `exit 1`，零 verdict（服务商态，非模型拒绝）；前端轴手动 5 次——第 1/3/5 次交付形态是**会话状态快照**（`Work State / Next Move`，零 verdict 清单），第 2 次是我的引号 bug（prompt 里的 `\|` 被 cmd 当管道，opencode exit 255），第 4 次 `permission requested: external_directory (D:\Temp\*)` 被自动拒后读不到简报。**第 5 次那份快照里带出 4 条线索，我逐条拿已提交 blob 验真，四条全部成立并当场落地**：L1 `String(article.content \|\| '')` 在谓词与 `openScriptEntry` 各推一遍（第二套口径）⇒ 收成单一 `episodeSourceText` computed；L2 我的浮层块被插在 `<!-- P2-2：AI 封面生成对话框 -->` 与它所注释的 div 之间，令那条注释给别人的块作注 ⇒ 整块前移；L3 那条「不发第二次出期请求」的用例从没点过确认，`not.toHaveBeenCalled()` 量的其实是"关闭本身不发起出期"，名与实不符 ⇒ 改为「先确认（断言恰好 1 次）再关闭（仍恰好 1 次）」；L4 夹具里 `ensureChannel` 出现 4 次却无一条断言它不该被调用 ⇒ 判据 1 补 `not.toHaveBeenCalled()`。三条新变异 `M2b`/`M8`/`M9` 各让对应红指名（见上一行），说明这不是改文案而是补上了牙齿。**因此本片不写 `cleared`/`needs_revision`**：单轴未成立就盖双模型 PASS 正是本仓反复记的「装饰性门禁」；处置方式是把三条出口交人选择（等 502 恢复后重跑后端 / 指定另一个外部后端顶上 / 明确批准按单轴闭包并留痕）。 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 同期被这条链暴露、但不在本片改的两件事

- **共享根的 `CHANGELOG.md` 曾被一次坏重定向截断**：现场只剩 31 行、尾部是字面量 `fatal: Not a valid object name .md`（`git cat-file blob … > file` 形态被 MSYS 改形，与 #3873 记录过的第 2 版事故同源），而真文件是 2.7 MB / 500+ 条。另有一份 `01-docs/learnings.md` 带 **1 行主干任何版本都不存在**的 pitfall（「共享根被并发会话占用时不在其上 commit」）。处置：按精确路径逐项备份到 `D:/Temp/shared-root-dirt-20261018/`，再从 HEAD 还原、`git merge --ff-only origin/main` 解锁 worktree 入口——**那 1 行未落地内容只存在于备份里，需要由它的作者（或下一个会话）自己落成 PR**，我没有代它入库。
- `session-init.sh` 的并发保护按设计生效两次：先是 `-RequireClean` 拒绝（共享根有他人脏项），后是 `ccg-worktree-bootstrap.lock` 串行锁（rc=5）。两者都不该被绕过——手搓 `git worktree add` 造不出 `node_modules` 与 workspace 解析，属 AGENTS 明禁。

### 遗留（不假装已闭合）

- `tasks 4.3②-b 收尾②`（文案库空正文死按钮，按来源分档判可见性）与 `QM6-2`（摘掉 `RewriteView.vue` / `CopyLibraryView.vue` 两处不可达的 `|| await ensureChannel()` 兜底）本片未做，另片落地；本片刻意**没有**顺手改这两个文件，避免把三件事捆成一个审查面。
- 本机像素门禁未跑（缺 dev server），`QG Visual` 是这一格的唯一现场来源；若它因基线新鲜度报红，按上一轮口径分离「本 PR 引入」与「上游传染」两类记账。
- 「入口全程只读」这一条目前只有**渲染层**锁。若将来真要「出期即固化一版草稿」，前置是发布链的幂等判据（同一份内容重复出期不得产出多个 item），那是另一片。
