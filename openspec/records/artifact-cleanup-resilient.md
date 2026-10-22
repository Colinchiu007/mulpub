---
record: artifact-cleanup-resilient
task: 修 `cleanup` 定时作业连续红（GitHub artifacts 列举间歇 500 × 无重试的 --paginate）
date: 2026-10-21
---

## 本次执行记录：artifact 清理作业改为逐页列举 + 每页重试 + 失败不静默（artifact-cleanup-resilient，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 混合档（`.github/workflows/` ×2 + `scripts/` 新判据本体）。入口 `scripts/session-init.sh artifact-cleanup-resilient`（`start-mp-task.ps1` 被共享根 `clean:false` 的 heath 检查 fail-closed 挡住 —— 那两个未跟踪 `.ccg` 文件属他人在飞会话，不动它们）；`rev-parse --abbrev-ref HEAD` == 分支名、起点 `HEAD == origin/main == 2f5c0a32f`、`verify-worktree-deps` OK |
| 第一性原因（QM-5 ①） | ✅ | 不是脚本逻辑写错，是**把它绑成一次成败的形状**错了：`gh api --paginate` 把 54 页列举串成一条管道，任意一页 5xx ⇒ `set -euo pipefail` 整步退出。取证：`GET /repos/…/actions/artifacts` 现读 **HTTP 500 + `Content-Length: 0`**（gh 因此报 `unexpected end of JSON input`，读起来像"我们的解析坏了"）；同一 URL 隔几秒再请求 ⇒ 200；`per_page=1` 500 而 `per_page=100&page=3` 200 ⇒ **间歇性**，不是某个坏记录。`total_count=5350`（≈54 页）⇒ 每天必撞一次 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：逻辑内联在 `run:` 块里，**没有任何测试载体**；集成/CI 层：它只在 schedule 上跑，PR 侧根本不触发；审查层：不是 required check，`check-main-red` 按检查名对齐时才第一次把它显形。红自 **2026-10-14** 起连续 8 天（窗口内 8/8 `completed failure`），期间没有任何东西在看它 |
| 系统性漏洞（QM-5 ③） | ✅ | 两类：① 「承载 CI 行为的 `run:` 块」没有可测载体（同仓先例已要求把逻辑抽成脚本 + 接进 PR 侧作业）；② **schedule 作业的健康度无人监控** —— 这条本片只做了"让它自己能红得有意义"，监控本身是另一刀（见遗留） |
| 修复 + 回归保护（QM-5 ④） | ✅ | 逻辑搬进 `scripts/cleanup-artifacts.js`（只依赖 node 内置；注入 `api`/`del`）：逐页列举 + 每页重试、首页失败判 `UNPROVEN` 且一条都不删、半途失败判 `DEGRADED` 但仍如实处理已列举部分、`--write` 才删、DELETE 带 `--silent`、**进 DELETE 路径段的 id 必须按形状收口**（非纯正整数计入 `rejected=` 出声）。行为锁 `scripts/cleanup-artifacts.test.js` **14 条**（A1-A14）；接进 `quality-gate.yml` 的 `changes` 作业 `Gate 2b10`（只跑锁、不跑真删），`check-unwired-tests` 现读 `检查域内测试文件 118 个 → OK` |
| 变异反证 | ✅ | 驱动**已入仓** `scripts/cleanup-artifacts.mutation.js`（QM-6 i3：取证工具只留在临时目录，等于"7/7 CAUGHT"是别人复跑不了的一句话）。复跑：`node scripts/cleanup-artifacts.mutation.js`（干净工作树；脏态须显式 `--allow-dirty`，它自己会拒）。实跑读数 **9/9 CAUGHT、红集互不相同、每条 `tests=14`、还原 md5 一致、还原后被测锁 rc=0**：n1 首页失败当"无待删"→A4；n2 去重试→A3；n3 expired 也删→A1；n4 cutoff 退成当天零点→A2；n5 dry-run 也删→A7；n6 去掉 `--silent`→A9；n7 半途失败仍判 OK→A5；n8 id 不校验形状原样拼 URL→A13；n9 首行不再打印 `rejected=`→A14 |
| 夹具自己的一课（不写成实现缺陷） | ✅ | 首版 7 条红的根因是夹具取页码用了 `/page=(\d+)/` —— 它先匹配到同一 URL 里的 **`per_page=3`** ⇒ 每页都读成第 3 页 ⇒ 全体"空页"。判据：`[?&]page=`。写进注释当永久提醒 |
| 行尾与 diff 对账 | ✅ | 三处 CRLF 面改动（`.gitignore`、`quality-gate.yml`、`cleanup-artifacts.yml`）均用"按当场 eol 逐行写回"的脚本插入，未统一回写；两口径 numstat 对账由提交前检查留证 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何 UI 文件 |
| QM-6 CCG 双模型外部评审 | 第一轮已跑并逐条处置（见下节）；第二轮在补齐 i3/i4/i5 后重跑 | `sh scripts/deep-review.sh`（critic=claude / proposer=opencode，跨家族校验通过，判定 DUAL）。`.github/workflows/` 命中**高危面**前缀 ⇒ 闭合只认 `deepReview.tier=external` + 可核 `evidence`，`closureNote` 在那一侧不够格。`evidence` 取本轮 critique 与逐条裁决的**公开 PR 评论 URL**；`tier` 字段此刻全仓无生产方写入（tasks 8.1b 未落），所以那一格由会话写、并在本节如实标注为手写，不得说成工具产物 |
| 远程同步 | 由门禁推导 | 不手写状态词、不为收口另开 PR |

- 判定：混合 PR（含 workflow 与 `scripts/` 判据本体），不走 docs-only 快速通道
- 保留门禁：品牌残留 ✅（11503 tracked 文件）| 绝对路径账本未放宽 ✅ | `check-step-failfast` ✅ | `check-workflow-structure` 16 文件 0 违规 | `check-no-hot-carrier-edit --mode=enforce` 对本 PR 判定 PASS

### QM-6 第一轮深审（critic=claude，7 条）逐条处置

产物 `.ccg/reviews/67e602c3…json`，存档 `.adversarial/ccg-deep-d3895698/`。最低维度分 maintainability=5，收敛落 `self_play`，待裁决 5 条、**高危域需外部复核 0 条**。

| 条目 | 指控 | 处置 | 证据 |
| --- | --- | --- | --- |
| i1 | `.ccg` 产物引用 SHA 是父提交 `2f5c0a32f` 而非 head，`changedLines=305` 与"方案 474 行"不符 ⇒ 背书与 PR 头错位 | **不成立**（两个坐标各有定义，且都不是本改动集的性质） | 判定产物由 pre-commit 写、按 **stagedDiffHash 内容寻址**，那时新提交尚未存在 ⇒ `sha` 恒为父提交，入口自己也打印"（pre-commit 时新 commit 尚未生成，判定记录写在父 sha 上——这是预期行为）"。`305` 是**暂存差量 vs 父提交**，`487` 是**深审载荷 vs origin/main**（引擎首行 `变更基线: origin/main（487 行）`）； critique 写的"474"在本 PR 的正文、记录、产物里都取不到（`grep -rn 474 openspec/ scripts/` 无命中），属把两个坐标之差读成一个不一致。本条已把"两坐标"写进本记录，免得下一轮再被同样读法命中 |
| i2 | 方案自认 QM-6 未跑、产物 `status=pending` ⇒ 未完成闭合 | **成立但非改动集缺陷**，且它正是本轮在消的那笔账 | 上一版记录确实标 PENDING 并据此**拒绝合并**（PR 正文"已知未闭合"第 1 条）。出口就是补跑深审 + 逐条裁决；`.github/workflows/` 命中高危面 ⇒ 闭合只认 `tier=external` + 可核 `evidence`，本轮把 critique 与裁决发布为公开 PR 评论作为 evidenceRef |
| i3 | 变异反证依赖临时目录里的一次性驱动（不在 diff、未被 git 追踪），7/7 结果无法由他人复现 | **成立 ⇒ 已修** | 驱动入仓 `scripts/cleanup-artifacts.mutation.js`，并把临时版缺的三条前置一并实现：动手前断言工作树==HEAD（脏态须显式 `--allow-dirty`，否则**拒绝**并把差异行数报出来）、读写同编码 utf8、跑完**再跑一次被测锁**证明还原态 rc=0。变异从 7 条扩到 9 条（新增 n8/n9 各钉住本轮 i4/i5 的修法），实跑 9/9 CAUGHT |
| i4 | `cleanup-artifacts.yml` 声明 `env.REPO`，但脚本只读 `GITHUB_REPOSITORY` ⇒ `REPO` 是死配置 | **成立 ⇒ 已修** | 这条是本仓「判据正确、传参错位」的同型：脚本本体对、装配面错，今天靠 runner 自带的 `GITHUB_REPOSITORY` 恰好兜住，读起来却像"坐标已接线"，而只测脚本本体的锁永远看不见。修法取"调用点显式给坐标"而不是"再读第三个环境变量"：workflow 删掉 `REPO:`，命令行改成显式带仓库坐标；A12 加两条接线锁（`--repo=` 必须在命令行、`env` 里不得留脚本不消费的 `REPO` 键） |
| i5 | `defaultDel` 把 API 返回的 `id` 直接拼进 `repos/…/artifacts/${id}`，未校验形状 | **成立 ⇒ 已修** | id 是**外部可控值**且进的是**路径段**，按本仓 QM-2 口径必须在边界收口。改为只接受正整数（`Number.isInteger && > 0`），其余计入 `rejected` 并**进首行读数**（`ARTIFACT-CLEAN … rejected=N …`）—— 计了数却不出声等于把坏形状静默吞掉。A13 用四种坏形状（路径穿越 `../9` / 小数 / `0` / id 缺席）断言"一条都不发删除"，A14 锁首行必须含 `rejected=`；n8/n9 两条变异分别指名把它们钉回原样 |
| i6 | `.gitignore` 的本条 negation 与其他 `!scripts/*` 分开放、依赖隐式顺序 | **不成立** | 现读 `.gitignore`：`!scripts/*` 的例外集中在尾部一段连续的「3-4 行原因注释 + 一条 negation」块（第 445-468 行，逐条为 445/449/454/459/463/468）。本 PR 两条分别落在 454（`cleanup-artifacts.js`）与 459（`cleanup-artifacts.mutation.js`），夹在 449 `aggregate-changelog.js` 与 463 `check-no-hot-carrier-edit.js` 之间 —— 不存在"另放一处"。这个惯例本身是因为 `.gitignore:106 scripts/*.js` 会静默吞掉新建脚本 |
| i7 | `quality-gate.yml` 新增 `node --test` 而无 node 版本守卫；runner < v18 则该命令不可用 | **不成立**（不引入新前提） | `changes` 作业自始不装 `actions/setup-node`，现读该作业内 `node --test` **105 条（含本 PR 这一条）** —— 本 PR 只是给既有假设多一个使用者，没有新增"runner 必须有 node 18+"这条前提。真要治那 104 条，属另一刀（给作业补 setup-node 会改变它的安装面与预算，且不在本 PR 差量内） |

### 本轮处置后新增的两条口径（写进脚本头，供下一轮读）

1. 仓库坐标必须由**调用点**显式给，禁止只在 workflow 的 `env:` 里声明一个脚本不读的键。
2. 上游返回值进请求**路径段**前必须按形状收口并计数出声，不得以"GitHub 当然返回整数"代劳。

## 遗留（不假装已闭合）

1. **QM-6 高危面闭合仍未落**：第一轮 7 条已逐条处置（i3/i4/i5 已修并入仓，i1/i6/i7 否证带证据，i2 由本轮出口消解），第二轮评审与 `tier=external` + `evidence` 那一格要在补齐后的 head 上重新取。**未闭合前不合并**。
2. **schedule 作业的健康度仍无人监控**：本片让 `cleanup` 自己"红得有信息量"（`ARTIFACT-CLEAN … verdict=` 首行 + 非零退出），但仍然没有任何东西在**看**它 —— 连续 8 天全红就是这条缺口的现场。正解是一刀独立的"定时作业健康巡检"（读 `gh run list --event schedule` 的近 N 天结论并出声），属新增常驻判据、须人工过目落点与预算。
3. **500 是上游的，重试只是把可恢复故障挡掉**：若 GitHub 的列举接口退化到重试也救不动，本脚本会判 `UNPROVEN`/`DEGRADED` 并非零退出（不会静默），但**清理仍会停摆**。artifact 存量现读 5350；GitHub 自身 90 天过期是兜底，所以停摆的后果是额度压力而非数据丢失。

## CHANGELOG 条目

# fix(ci): artifact 清理定时作业改为逐页列举 + 重试，首页失败不再被读成"没有待删条目"（artifact-cleanup-resilient）

- 症状：`Cleanup Artifacts` 自 2026-10-21 回溯连续 8 天 `completed failure`，日志只有一句 `unexpected end of JSON input`，看着像脚本坏了。
- 真因：GitHub 的 artifacts 列举接口对本仓（`total_count=5350`，约 54 页）返回**间歇性 500 空体**（实测同一 URL 一次 500 一次 200），而 `gh api --paginate` 把全部页绑成一条管道、无重试，`set -euo pipefail` 于是每天必退出。
- 修法：逻辑从 `run:` 块搬进 `scripts/cleanup-artifacts.js` —— 逐页列举 + 每页重试；首页彻底失败判 `UNPROVEN` 且一条都不删，半途失败判 `DEGRADED`（已列举部分照常处理、结论不得是 OK）；默认 dry-run，真删要显式 `--write`；DELETE 带 `--silent`（204 空体与上面的 500 同形，属潜伏的第二颗雷）。
- 两条边界口径（外部双模型评审命中后补）：**仓库坐标由调用点在命令行上显式给**，禁止只在 workflow 的 `env:` 里声明一个脚本不读的键；**上游返回的 id 进 DELETE 路径段前按形状收口**（只接受正整数），其余计入首行的 `rejected=` 出声，不得以"GitHub 当然返回整数"代劳。
- 新增行为锁 14 条 + 变异反证 9 条全指名，**变异驱动本体也入仓**（`scripts/cleanup-artifacts.mutation.js`，自带"脏树拒绝 + 锚点命中恰为 1 + 还原后再跑一次被测锁"三条前置），接进 `quality-gate.yml` 的 `changes` 作业（`Gate 2b10`），使这段逻辑从此在每次 PR 上被执行过。
