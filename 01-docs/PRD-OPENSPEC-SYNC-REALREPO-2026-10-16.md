# PRD：`openspec-sync-check` 从未对真实仓库跑过 —— 现场 14 条违规与接线收口（openspec-sync-realrepo，2026-10-16）

## 1. 问题（第一性原因）

`scripts/openspec-sync-check.js` 是 CCG 任务 ↔ OpenSpec change 关联完整性的**审计器**，退出码分四档
（`0` 合规 / `1` VIOLATION / `2` ERROR / `3` 自身 IO 故障，实测见 `scripts/openspec-sync-check.js:291,342,351`）。

它对**当前真实仓库**当场报 `rc=2 / 14 条`。但：

- `quality-gate.yml` 里**没有任何一步调用它**。第 389 行只有 `node --test scripts/openspec-sync-check.test.js`，
  而那份测试**全部**在 `os.tmpdir()` 下自建夹具仓库（`mkdtemp('openspec-sync-check-')`，第 13 行），
  断言的是判据本身，**从不对真实仓库调用一次**。
- 于是真实仓库的 14 条违规**没有任何东西在看**：不红、不出声、不拦合并。
- 这笔欠账**早就被写过**：`openspec/records/film-production-artifact-identity.md:151`（2026-10-14）
  原文「`scripts/openspec-sync-check.js` 当前报 14 条错误……**归档前需先清理这些历史欠账**」。
  写了，但没有任何东西消费这句话 ⇒ 与本轮 Gate 12c 的「判据在无盘符 runner 上恒 0」是同一族缺陷的
  另一种落点：**测试存在且全绿 ≠ 它测量了真实对象**（「注册≠注入≠生效」家族）。

## 2. 判据到底怎么说（先读代码，不按直觉修数据）

三条实测规则，决定了 14 条各自该往哪边修：

| 规则 | 出处 | 后果 |
| --- | --- | --- |
| `CHANGE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/` | `openspec-sync-check.js:7` | `openspecChange` 写成 `openspec/changes/<id>` **整路径**不合法 ⇒ 属数据坏 |
| `DATED_ARCHIVE_RE = /^(\d{4}-\d{2}-\d{2})-(.+)$/` | `:8`，建 `archives` 索引时**剥掉日期**再用裸 id 作键（`:64-76`） | `openspecChange` 写成带日期的目录名 ⇒ 查不到 ⇒ 报 `CHANGE_NOT_FOUND`，**也是数据坏，不是探针瞎** |
| `completed !== terminalPhase` 即 `TASK_STATE_INCONSISTENT`，`TERMINAL_PHASES = {completed, archived}` | `:9`、`:241-254` | `status` 与 `currentPhase` 必须**同真同假**；缺 `currentPhase` 也算不终端 |
| `hasSupersessionEvidence = openspecState === "superseded" && supersededBy 非空` | `:91-95`，并在 `:277` 作为 `CHANGE_NOT_FOUND` 的豁免出口 | 「这个任务确实没有对应 change」有**专用合法表达**，不需要删引用或造假 |

## 3. 14 条的逐条归因与修法（全部当场取证，不含推测）

| # | 文件（`.ccg/tasks/archive/…`） | 违规码 | 现场证据 | 修法 |
| --- | --- | --- | --- | --- |
| 1 | `2026-08/smart-tag-suggest-v2` | TASK_JSON_INVALID | 两个 JSON 对象**直接拼接**：位置 386 处 `}\r\n{`，且两段 `id` 相同（1045 B / 25 行） | 合并为一份：以第二段为基底，把第一段中**第二段没有的键**并回去；逐键差集写进改动说明，不得整文件重写 |
| 2 | `2026-08/video-history-card-enhance` | TASK_JSON_INVALID | 同一形状（位置 360 处 `}\r\n{`，924 B / 26 行），第二段含 `supersededBy: video-history-card-detail` | 同上 |
| 3 | `2026-09/fix-voice-clone-fallback-model-mismatch` | TASK_JSON_INVALID | 整份文件是**被转义过一次的 JSON 字符串**（227 B / 2 行，首字节 `{\\\\" id\\:\\…`） | 反向解一层转义 → 解析 → 按对象重写；字段一个不许少 |
| 4 | `2026-09/start-app-restart-win` | TASK_JSON_INVALID | 第 22 行 JSON 串里写了未转义的盘符路径（形如 `D:\<repo>\…` 与 `D:\<tmp>\…`；这里用占位符是刻意的——本仓规则不允许在受管文档里写真实本机绝对路径）⇒ `\D` `\p` 非法，而 **`\t` 会被静默吃成 TAB** | 只把反斜杠补成 `\\`，其余字节逐字不动 |
| 5 | `2026-09/start-app-restart-win-1309` | TASK_JSON_INVALID | 同第 4 条（第 23 行同一 `startCommand`） | 同第 4 条 |
| 6 | `2026-08/merge-paused-interrupted-history` | TASK_STATE_INCONSISTENT | `status=completed` 但**没有** `currentPhase`；文件位于 `archive/` 下，正文引用 `#1252` | 补 `currentPhase: "archived"`（归档位置是结构证据，不是猜测） |
| 7 | `2026-08/user-feedback-log-upload` | TASK_STATE_INCONSISTENT | `status=in_progress` + `currentPhase=completed`，且 `nextAction="归档任务"` | `status` → `completed`（同文件自陈 + 已在 archive/） |
| 8 | `2026-09/review-login-state-oscillation` | TASK_STATE_INCONSISTENT | `status=in_progress` + `currentPhase=completed`，`nextAction="审查完成，待归档"` | `status` → `completed` |
| 9 | `2026-09/segment-nav-scroll-highlight` | TASK_STATE_INCONSISTENT | `nextAction="等待 CI 全绿后合并 PR #1970"` ⇒ **完成与否本来无证据**。当场查 `gh pr view 1970`：`state=MERGED`、`mergedAt=2026-09-18T12:46:55Z`、`mergeCommit=3ed9a6f2b`、主题与该任务一致 | `status` → `completed`，并把这条 PR 证据写进 `nextAction` 之外的注释字段（不留"等待合并"的过期陈述） |
| 10 | `2026-08/fix-watermark-drift-center` | INVALID_CHANGE_ID | `openspecChange="openspec/changes/archive/2026-08-27-fix-watermark-drift-start-center"`（整路径） | 改为裸 id `fix-watermark-drift-start-center`；该归档目录实测存在 |
| 11 | `2026-08/watermark-cross-segment-continuous-drift` | INVALID_CHANGE_ID | `openspecChange="openspec/changes/watermark-cross-segment-continuous-drift"` | 改为裸 id；`archive/2026-08-28-watermark-cross-segment-continuous-drift` 实测存在 |
| 12 | `2026-08/ops-center-provider-default-mark` | CHANGE_NOT_FOUND | 值是**带日期目录名** `2026-08-16-ops-center-provider-default-mark`，而索引剥日期后按裸 id 查 | 改为 `ops-center-provider-default-mark`（目录实测存在） |
| 13 | `2026-08/s2v-pipeline-always-background` | CHANGE_NOT_FOUND | 同上：`2026-08-19-s2v-pipeline-always-background-run` | 改为 `s2v-pipeline-always-background-run`（目录实测存在） |
| 14 | `2026-08/investigate-subtitle-splitter-runtime` | CHANGE_NOT_FOUND | `openspecChange` 是裸 id，但**active 与 archive 里都没有这个 change**。当场取证：`git log --all -S` 命中 `accb3c8ac 2026-08-15 chore: 归档字幕分句调查任务 + 新建 subtitle-split-quality 实现任务与 OpenSpec change`，且文件自身 `nextAction` 写「已归档：调查结论移入 subtitle-split-quality 实现任务」，`archive/2026-08-22-subtitle-split-quality` 实测存在 | **不删引用、不造假**：改用检查器自带的合法出口——`openspecState: "superseded"` + `supersededBy: "subtitle-split-quality"`（`:277` 正是这样豁免的） |

三条要写下来的取舍：

- **第 12/13 条不往判据那边修**。让索引同时接受"带日期目录名"看似省事，但会把
  "change id" 与"归档目录名"两个概念永久混成一个（判据已经明确用剥日期后的裸 id 作键），
  下一个会话就再也分不清哪一个是契约。
- **第 14 条不新建一个同名 change 目录**来"消红"。那是为了给审计器一个交代而伪造规格工件，
  比悬空引用更坏。
- **第 9 条先取证再改**。四条状态矛盾里只有它缺当场证据；查到 PR 已合并才敢判 `completed`。
  若查出来是 OPEN，正解就是反向的：把 `currentPhase` 改成非终端值，而不是把 `status` 抬成 `completed`。

## 4. 机制收口（只修数据不算收口）

数据修完只是把数清成 0；**下一次还会再坏**，因为仍然没有任何东西在跑它。所以同一次 PR 里：

1. **接线**：把 `node scripts/openspec-sync-check.js` 接进 `quality-gate.yml` 的 **`changes` job**
   （与 Gate 12c 同一落点）。不接 `static-gates`：那个 job 整体被 `if: docs-only != 'true'` 门控，
   接进去等于"门禁的数据文件却只在会被短路面里校验"（AGENTS 的**前提锁**，#2718 先例）。
2. **真实仓库锁**：新增一条对**真实仓库**跑审计器的用例（不是夹具），断言退出码 0，
   并打印 `tasks_files=… changes_active=… changes_archived=… errors=… violations=…` 机读行。
   这条锁存在的全部意义就是"它对真实对象跑过一次"——它自己必须**不能被静默跳过**：
   仓库根取不到、或 `.ccg/tasks` 不存在 ⇒ **当场红**，不许 `return`/`skip`
   （AGENTS：宿主 API/解析退化会把锁读成恒真）。
3. **反证**：① 把接线从 workflow 摘掉 ⇒ 接线锁必须红；② 往任一 `task.json` 注入一条违规（例如把
   `status` 改成与 `currentPhase` 矛盾）⇒ 真实仓库锁必须红并**点名那个文件**；③ 把真实仓库锁的
   root 写死成临时夹具 ⇒ 必须红（否则它又变回"只测夹具"的装饰门禁，就是本轮要修的那个洞的形状）。

## 5. 不修（登记）

- `.ccg/tasks/archive/**` 的**语义真实性**（这些任务当年到底做没做完）不在本 PR 范围。本 PR 只让
  "自相矛盾"变得不可表示；`completed` 是不是名副其实仍靠归档时的一次性判断，第 9 条是其中唯一有
  PR 证据可查的一条。
- 审计器对 `openspec/changes/<active>` 的 `COMPLETED_TASK_ACTIVE_CHANGE` 判据本轮不动（现场 0 命中）。
- `.ccg` 整目录在 `CI_IGNORED_PATHS`/`paths-ignore` 里（push 侧），所以这类改动**不会**由 main push 触发，
  但 `pull_request` 侧无过滤 ⇒ PR 照常跑全量。本 PR 不碰 `CI_IGNORED_PATHS`（改白名单须人工过目）。

## 6. 验收

- `node scripts/openspec-sync-check.js` 真实仓库跑：**rc=0**，且机读行报出本次扫描的
  task.json 数、active/archived change 数。
- `node --test scripts/openspec-sync-check.test.js` 全绿（含新增的真实仓库锁）。
- 三条反证各自红过，红因互不相同；驱动收尾断言还原后与备份逐字节相同。
- CI：`QG Changes` 与 `Gate Result` 绿；PR 说明里带"清理 14 条存量 + 接线"的出处与逐条归因表（本文件即出处）。
