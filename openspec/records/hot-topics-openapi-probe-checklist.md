---
record: hot-topics-openapi-probe-checklist
task: 起草抖音开放平台「热门视频榜」OpenAPI 取证清单，用于关闭 hot-topics-viral-items 的 OPEN 项 O-1（附带 O-3）
date: 2026-10-18
---

## 本次执行记录：热门选题爆款源的 OpenAPI 取证清单（hot-topics-openapi-probe-checklist，2026-10-18）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=<本分支 tip>` → **docs-only=true（files=2）**：`01-docs/research/hot-topics-douyin-hot-video-openapi.md`、本记录。差量全落文档白名单目录。
- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | Gate 12c 绝对路径 ✅ | 文档同步 由 CI | 执行记录取证 由 CI | 远程同步 由门禁推导

## 0. 变更类型与隔离声明

| 项 | 内容 |
|---|---|
| 变更类型 | **纯文档**（取证程序 + 本记录）。零运行时代码、零平台请求、**未取得任何资质账号**，故清单里的字段表全部留空为"待填" |
| 分层判定 | 按 AGENTS.md「分层判定只看是否影响运行行为」⇒ 不影响，属 docs-only 通道；QM-1 / QM-2 代码项 / QM-4 / TDD / QM-6 因与运行行为无关而跳过 |
| 隔离方式 | **plumbing**：文件写在仓库外 `%TEMP%`，`hash-object -w` → `GIT_INDEX_FILE=<临时> read-tree origin/main` → `update-index --cacheinfo` → `write-tree` → `commit-tree -p origin/main` → `update-ref`。共享根工作树、`main` 与他人 ref 零接触（共享根此刻正被另一会话活跃写入） |
| 记录形态 | 按**新协议**写：frontmatter **不含** `sync_status` / `sync_reason` / `sync_backfill_owner`，「远程同步」状态列写「由门禁推导」，**合并后不需要、也不允许另开 PR 改写这一行**。形态对齐 `openspec/records/archive-gate-record-derived.md`（新机制上线后第一篇） |
| 与上一轮的自我纠正 | 本轮早前我为 #3866 开过回填 PR（`hot-topics-viral-item-sources` → #3872），那是 `gate-record-sync-derived-status` 已明文禁止的动作。根因与规避手法（动手前先读**主干那份** `AGENTS.md`，以及"我的计划里出现『回填 PR』这个词本身就是触发器"）已写进项目记忆 [[remote-sync-closure-derived-no-backfill-pr]]。本篇是该纠正后的第一篇，形态按新协议执行 |
| CCG 判定产物 | 变更集内不含 `.ccg/reviews/*.json`（未走 pre-commit）。docs-only 判定为 SKIP，`evaluateDeepReviewDebt` 只收口 `mode=dual` 产物 ⇒ 不构成欠账（先例：#3894 同走 plumbing，`Gate Result` 与 `QG Changes` 全绿后合入） |
| 决策来源 | 用户 2026-10-18 在「起草取证清单」与「先做不依赖资质的 2.2」之间选定前者 |

## 1. 门禁结果

| 门禁项 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离声明 | PASS | 见 §0 |
| 行尾两口径对账 | PASS | `git diff --numstat origin/main <分支>` 与 `--ignore-cr-at-eol --numstat` 两口径读数一致；两份文件 `hash-object` 前逐个 `tr -cd '\r' \| wc -c` = **0**（避免把 CRLF 存进 blob，`git add` 才会走 `text=auto` 归一） |
| 品牌残留 | PASS | 对两份 blob 逐字面量计数受禁竞品词 → **0**（本行刻意不复述禁词本身：把竞品名写进"我检查了它"这句话同样会被 Gate 12 打红，这是本仓记录在案的自指形态）。文中出现的 GitHub 项目名属开源参照系；付费数据服务只写能力名与用途，不构成品牌兜底 |
| Gate 12c 受管文档绝对路径 | PASS | 两份文件盘符绝对路径计数 → **0**；文中只用仓库相对路径与 `<日期>` / `<临时>` 占位符 |
| 锚点与路径自证（引用不得悬空） | PASS | `openspec/changes/hot-topics-viral-items/tasks.md` 的 2.1/2.3、`design.md` 的 O-1/O-3、`packages/shared-utils/src/safe-http-url.js`、`01-docs/PRD-HOT-TOPICS-SHORTVID-VIRAL-ITEMS-2026-10-17.md` §5、以及许可证结论（MediaCrawler 非商业学习许可 1.1 / DTK Apache-2.0 20,724★ / TrendRadar GPL-3.0 62,975★ / Spider_XHS·creatorhub `.license` 为 null）全部当场核实。**新落盘目录 `01-docs/research/raw/` 经 `git check-ignore --no-index -v` 实测未被忽略** ⇒ 下一个会话把取证响应放进去不会被 git 静默吞掉（该坑本仓踩过：`.gitignore` 的 `scripts/*.js` 默认忽略新建脚本） |
| 不凭想象写规格（Requirement 8） | PASS | 清单里**没有一个预填的字段名**；文档站 SPA 已当场否证（抓取只拿到样式与路由脚本），故把"必须登录实做 + 真实响应原文"设成唯一关闭路径，并给出资质拿不到时的四条替代与四条禁止 |
| 文档同步（doc-gate）/ `check-pr-exec-record` / `check-gate-record-debt` | 由 CI | 落点为 `quality-gate.yml` 的 `changes`（docs-only 不被短路的唯一 job）与 `Gate Result`；本仓纪律是判据一律取 CI 产物读数，不拿本地印象代答 |
| CHANGELOG 收口 | N/A（如实登记） | 只新增一份取证程序，用户可见行为零变化；适用时机是 `tasks.md` §2 的实现片 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导（判据首行 `MERGE-LEDGER prs=<n> … 派生收口=<n>`；2026-10-18 本地实跑读数 `prs=2002 / 归属可解析记录=458 / 派生收口=442 / byDesign=0`，rc=0） |

## 2. 这份清单交付什么

- **关闭对象**：O-1（抖音官方热门视频榜的权限项 / 返回字段 / 配额 / 计费）与 O-3（`interaction` 是否含播放量）。二者是 `tasks.md` 2.3「首个内容条目源」的**阻塞前置**。
- **结构**：§1 为什么读文档不够（SPA 现场否证 + 两处页面口径不同 + 公开空榜互证）；§2 六条前置 P-1…P-6（其中 **P-4 凭证形态最关键**——它决定"用户没登录抖音时能否出榜单"，不落实就选不了实现方案）；§3 六条必取证据 E-1…E-6，逐条写明取什么、从哪取、关闭哪个 OPEN、落哪个文件、脱敏要求；§4 一张 11 行的关闭判据表（每条直接映射到一个规格位，空格即未关闭）；§5 资质拿不到时的四条出路（含四条许可证禁止）；§6 六条红线（凭证明文不落盘、样例 ≤3 条、不猜字段、判据取产物、结论带出处、结论否证规格时**改规格而不是改事实**）。
- **留给下一个会话的关键提示**：文档与真实响应不一致时**以响应为准**并把差异写进清单——那正是下一个会话最需要、也最容易凭记忆写错的信息。
