---
record: ux-viral-external-id
task: viral_library 迁移预检查询了本次迁移才创建的列 ⇒ 新库首次启动留下一条假 ERROR
date: 2026-10-20
branch: ux-viral-external-id
---

# 执行记录：viral_library 建表列与查询列同源（ux-viral-external-id）

## 0. 现象与来源

QM-1 打包态启动现场：`[ERROR] sqlite-wrapper all() error: no such column: external_id | SQL: SELECT platform, external_id, COUNT(*) AS n FROM viral_library`。
仓内日志实证：`%APPDATA%/@multi-publish/desktop/logs/app-2026-10-17.log` 有该原文一行（时间戳 `[2026-10-16T16:10:54.080Z]`），任务清单另记 2026-10-18 打包态复现两次。

## 1. QM-5 第 1 步：第一性原因（不是报错那一行）

`creator-schema.js::findViralLibraryConflicts` 是**迁移前的重复预检**，它查的 `external_id` 由它自己所在那次迁移（`migrateCreatorLinkageSchema`）的 `ALTER TABLE ADD COLUMN` 才加上；而 `store-schema.js` 的新库建表 DDL **没有这两列**（列只由迁移提供）。于是顺序是「建表（无列）→ 预检（查该列）→ ALTER」，**每个新库首次启动都必然发一条结构上注定失败的查询**。

兜底 `catch (_) { return [] }` 的位置在 `sqlite-wrapper.js:93` 的 `Statement.all()`：它先 `log.error(...)` 再返回空数组 —— 所以"用 catch 吞掉"并不等于无声，它在运行日志里留下一条 ERROR，把正常未升级状态记成故障。`git log -S` 追溯到引入该预检的提交属博主监控批次（同批同时写了 ALTER 迁移与预检，两者对"列何时存在"的假设不一致）。

## 2. QM-5 第 2 步：测试逃逸链

- **单元测试**：`creator-schema.test.js` 的夹具 `makeDb()` 对**任意 SQL** 的 `prepare().all()` 都返回同一份预置数组 ⇒「列不存在 ⇒ 查询抛错」这类事实**在该夹具里根本无法表示**。全绿。
- **e2e/装配测试**：`creator-wiring.e2e.test.js` 自建表时**手写**了带 `external_id/creator_id` 的 DDL（与仓内真 DDL 不同源）⇒ 它测的是"理想表"，测不到真建表缺列。
- **集成/视觉/审查**：错误只体现在日志文件里，无任何门禁在看守启日志中的 `[ERROR]` ⇒ 四层同时漏过。
- 逃逸原因分类：**Mock 过度 + 测试不执行真形态**（夹具对所有输入同答）＋ 审查盲区（没人问"预检查的列是谁建的"）。

## 3. QM-5 第 3 步：系统性漏洞（具体到文件与机制）

`apps/desktop/electron/services/creator-schema.js` 的预检把「缺列」与「查询失败」合并成同一条静默出口，且缺列判据不在该函数内（由 ALTER 侧的 PRAGMA 持有）——**同一个"列在不在"的判断散在两处**。`store-schema.js` 的建表 DDL 与 `creator-schema.js` 的查询列不同源，属于"一个决策的两端写在两个文件"。

## 4. QM-5 第 4 步：修复 + 回归保护

- `creator-schema.js`：新增 `viralLibraryColumns(db)` 作为探列唯一实现；预检改三档（缺列直接返回空且**不发查询**／有列有重复照旧中止／有列但查询失败 `console.warn` 出声）；迁移侧 PRAGMA 读法改为复用同一实现。
- `store-schema.js`：viral_library 建表 DDL 补 `external_id` / `creator_id`（`ALTER` 仍保留给存量库，`CREATE TABLE IF NOT EXISTS` 不给已存在的表补列）。**两列写在 `source` 那一行、且不附解释注释**：该文件原 499 行，`check-max-lines` 对未挂账文件是「>= 500 即 NEW_OVER_LIMIT」⇒ 任何净增行都会造出一颗新红（零增长容差只给已挂账的文件）。来路与判据写在 PRD 本节与本篇，不塞进源码注释。

- 新增 `creator-schema-upgrade.test.js` 8 条，**真 `node:sqlite` 文件库 + `os.tmpdir()` 唯一路径**（AGENTS 文件系统测试隔离）：旧库形态预检不抛错／一次迁移后两列与 partial 索引齐备／列在位且有真重复必须查出并中止迁移／表不存在返回空／真故障必须 warn／缺列时那条查询一次都没被发出／按仓内真 DDL 建新库一次都不失败。
- 三条旧夹具改为自洽输入（`viralLibraryCols` 声明该列存在）；断言一字未放宽。

## 5. QM-5 第 5 步：防再犯（有落点的措施）

- PRD 新增《本地库 schema 与迁移的顺序合同》一节：数据校验（列存在性只一个来源）、三档流程语义、显示项与提示文字、四条验收锚点，含"夹具对所有输入同答 ⇒ 该类缺陷结构性免疫"的口径。
- learnings 置顶一条方法论（迁移/预检的顺序自反 + 兜底位置决定"静默"是否真的静默）。

## 6. 门禁读数（本机在最终基线重取）

| 门禁 | 状态 | 证据 |
|---|---|---|
| TDD 红→绿 | PASS | 新文件首跑 `5 failed / 2 passed`（其中"重复检测"一条先经真库否证：迁移后的库带 partial UNIQUE 索引，第二条 INSERT 当场被拒 ⇒ 夹具改为"有列无索引"形态才可表示重复）；实现后 `8 passed` |
| 既有套件 | PASS | `creator-schema.test.js` 14/14；`check-locale-sync --cjk` PASS；`check-max-lines` 无新增超限；品牌残留 / 受管文档绝对路径 PASS |
| 消费者并集 | PASS | `npx vitest run electron` 全量 `8 failed / 617 passed / 1 skipped (626)` → 其中 7 个文件死在 gitignored 的 `electron/preload/index.bundle.js`（`node scripts/build-preload.js` 后这 7 文件全绿）；余 1 个 `services/feedback.test.js` 经**控制对照**（备份我的改动 → `git checkout HEAD -- 两个精确路径` → 同一条命令复跑）在 HEAD 上同样失败 ⇒ 既有失败，不认领；还原后 md5 与备份逐字节相同 |
| QM-1 打包 | PASS | `pnpm run build:dir` rc=0；`asar` 解包读 `electron/services/store-schema.js` / `creator-schema.js` 确认修复落进产物；以**产物代码**跑"新库首次启动"路径：`fresh_cols_have_external_id=true`、`migrate_threw=null`、`warn_count=0`、`VERDICT=CLEAN` |
| QM-1 启动 | PASS（第③层） | 打包实例 15 秒存活，`REDLINE_HITS=0`、`TARGET_ERROR=false`、**stderr 为空** ⇒ 判 PASS 而非 NEEDS_REVIEW。（第一次跑曾因 `--dir` 未先建 renderer 出现 `ERR_FILE_NOT_FOUND dist/index.html` ⇒ NEEDS_REVIEW；那条是构建顺序问题，非代码问题） |
| QM-4 视觉 | N/A | 未触任何 UI 文件 |
| QM-6 | 见 §7 |
| 行尾两口径对账 | PASS | 改动文件 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 读数一致 |
| 旧载体冻结 | PASS | 只写本篇 `openspec/records/`，未碰 `.quality-gates.md` / ledger |
| 远程同步 | 由门禁推导 | 不写状态词、不做回填提交 |

## 7. QM-6

变更规模由 `ccg-review-decider.js` 判定；若判 `mode=dual` 且落到 `self_play_blocked`（引擎口径：`verdict=upheld` 一律计阻断，与本条是否已修完无关），按本仓既有口径**转人工、不手写 status**。外部 critic 本轮若有交付，原件与裁决一律复制进 `.ccg/reviews/` 留证。

## 8. 遗留（不假装闭合）

1. 「预检/探测类 SQL 必须先探 schema」目前靠代码约定 + 单测，没有静态门禁禁止"未探列就查新列"的写法；要机械化属新门禁，需人工批准。
2. 启日志里的 `[ERROR]` 行没有任何门禁在看守（本条正是因此躺了 4 天才被打包验证顺手抓到）。可选方案：QM-1 的 stderr/日志红线清单加一条"sqlite-wrapper all() error 不得出现"，但那是把判据加宽，需先量存量有多少库文件处于未迁移态。
3. `01-docs/PRD-UX-AUDIT-IMPLEMENT-2026-10-18.md §12.9` 被任务描述指为落点，实测该文件**不在 git 索引也不在共享根**（未跟踪/已不存在）⇒ 本条规格改落 `01-docs/PRD.md` 新节 + 本记录，不另造该文件名。


## 9. CI 腿差异：本测试文件在 Desktop Shards 的 client 腿加载期失败（2026-10-21 补）

- **现象**：PR #4083 的 `QG Desktop Shards (2/2)` 与 `QG Coverage` 红，红因不是断言失败而是**套件加载期**报错：`Error: Cannot bundle built-in module "node:sqlite" imported from "electronservicescreator-schema-upgrade.test.js". Consider disabling environments.client.noExternal`（`vite:import-analysis`，落在 `import { readFileSync, rmSync } from 'node:fs'` 那行的位置）。同一片日志里 `Failed Suites 1` —— 唯一红的那个套件就是本文件。
- **判据（对照组而非推测）**：同目录三个静态 `import … from 'node:sqlite'` 的兄弟文件（`activate-viral-schema.upgrade.test.js` / `diagnostics-reporter.test.js` / `pattern-attribution-service.test.js`）**第一行都是** `// @vitest-environment node`，且它们在 CI 上是绿的；本文件是这四个里唯一没有那行的 ⇒ 差异只有一维。
- **修法**：① 补第一行 `// @vitest-environment node`；② 把这条惯例变成判据 —— 本文件末尾新增 `describe(环境前提…)` 两条：「扫描域非空（且必须覆盖到本文件自己）」与「每个静态 import node:sqlite 的测试文件首行必须是该声明」。锁放在**本文件内**是刻意的：它随本文件一起被两条腿各跑一次，将来任何同族文件漏声明会在 CI 现场被点名，而不是等加载期报错。
- **证据边界（不写成已证）**：本机用 `--environment=jsdom` 强制档 A/B 过 —— 摘掉声明那档 **10 条里只红新增的那条结构锁**，并没有复现 `Cannot bundle`。所以这次 A/B 证明的是「锁能抓到缺失」，**不是**「补上声明 CI 必绿」。后者的支撑只有两条：兄弟文件的现场对照，以及本次重跑的那条 CI 腿本身。差异维度既然在本机不可复现，就**不能**把它归成 AGENTS 说的「可本机配置的一维必须先本机复现」那类，只能按「既有惯例对齐 + CI 当终审」处理，并在此如实登记。
- **顺带记一条读日志的坑**：抓 `FAIL  <file>` 时按 `FAIL  electron/…` 双空格原文匹配会 **0 命中** —— Actions 日志里 `FAIL` 两侧夹着 ANSI 转义序列。先剥 ANSI 再定位文件名，否则「日志里没有这条 FAIL」会被读成「这个套件没红」（本文件上方 §8 的第 2 条遗留正是「启动日志无人看守」这一族）。
