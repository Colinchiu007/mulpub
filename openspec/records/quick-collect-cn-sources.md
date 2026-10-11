---
record: quick-collect-cn-sources
task: 快捷采集·中文素材源扩展（S1：中文热榜接入 + 榜单时间语义 + 域名判据 + 检索分流）
date: 2026-10-11
---

## 本次执行记录：快捷采集·中文素材源扩展 S1（quick-collect-cn-sources，2026-10-11）

> 分支 `quick-collect-cn-sources`，隔离 worktree `D:\Data\projects\mp-worktrees\mp-quick-collect-cn-sources`（**非 C 盘**）；
> 基底 `origin/main@bc209b000`，**推送前为解 PR 冲突 rebase 到 `origin/main@47e3f9160`**（尾部追加型文件 `.quality-gates.md` 冲突按「两侧记录都保留」解决，未覆盖上游记录）。
> 上游需求：用户「按顺序实现」→ 本切片 = S1（中文热榜接线），S2/S3/S4 见 `openspec/changes/quick-collect-cn-sources/tasks.md`。

### 一、这一笔在做什么

快捷采集（PR #3303）此前只有 Reddit / HN / GitHub 三个英文源。S1 把**仓库既有**的中文热榜（`hot-topics-service` 的 8 主榜：
微博/知乎/抖音/B站/百度/头条/腾讯/tophub）接进快捷采集，并解决接进来后**必然遇到的两个语义问题**：

1. **榜单类源没有发布时间** ⇒ 新增 `timeKind: published | observed` 与 `observedAt`，窗口按「有效时间」判定，
   素材与提示词一律标注「抓取时刻 vs 发布」，system 提示词加硬约束**禁止把抓取时刻写成发布时间**；
2. **source 语义有两种** ⇒ 新增声明式源注册表（`kind: search|trend`），引擎按 kind 分流：
   search 走既有关键词检索（行为逐字不变），trend 走新增 `trendFn`（一次调用、无需关键词）。

另加一条**域名判据**（借鉴 TrendRadar `expected_domain` 的整条丢弃语义，**只对 trend 源生效**——search 源的条目
本来就外链第三方站点），以及 `sourceStats` 逐源归因（单源失败不逐条污染其他源）。

### 二、门禁表

| 门禁 | 状态 | Fresh 证据 |
| ---- | ---- | ---------- |
| TDD | PASS | 特性域 **257 passed / 0 failed**（13 个文件）；S1 新增两份测试：`quick-collect-sources.test.js`（8 例）+ `quick-collect-cn-sources.test.js`（15 例） |
| 被既有测试拦下的回归 | 已修（**真实缺陷**） | 改造素材层时把时间字段读成 `createdUtc`，而 content-intelligence 检索结果用 `created_utc`（snake_case）⇒ 既有 9 例素材测试当场变红（英文素材会被**静默全丢**）。改为两种拼写都认，并新增防回归用例 |
| 变异反证（6 条，逐条实测指名变红后回滚） | PASS | ① 时间语义退化只用 `createdUtc` ⇒ **6 红**；② 摘域名判据 ⇒ **1 红**；③ trend 入口条件放宽成「有任何源就调 trendFn」⇒ **1 红**；④ 删 system 第 6 条硬约束 ⇒ **1 红**；⑤ 渲染端镜像删一个源 ⇒ **1 红**（跨平面 parity）；⑥ `trendFn` 缺席改抛错 ⇒ **2 红**。回滚后复跑 111 绿 |
| 静态门禁 | PASS | `check-max-lines`（无新增超大文件）、`check-font-size-scale`（34/基线 790）、`check-locale-sync --pair-base/--cjk/--keys`（1817 项使用中 key 均在 zh/en）、`check-ipc-bridge`（所有 handler 均有桥接）、`check-frontend-consistency`、`check-no-brand-residue`（7979 文件无残留） |
| QM-1 打包 | PASS | `node scripts/verify-worktree-deps.js` OK（11 项解析到本 worktree）→ `pnpm run build:dir` **rc=0**；asar 核对：`\electron\services\quick-collect-sources.js` 在包内（9030 B）；解包后 `require` 该模块 ⇒ `ALL_SOURCE_IDS=11`（search 3 / trend 8）；`createQuickCollectEngine({})` 可构造 |
| QM-4 视觉 | 待 CI 判定 | 本切片只改对话框内提示文案（弹窗不在页面截图内）与主进程逻辑，预期 0 px；以 PR 的 `QG Visual` 为准，若基线漂移则按 QM-4 第 7 条取**同一次 run** 的 artifact 重取 |
| 渲染端一致性 | PASS | 源清单镜像 + 「前后端闭集对账」用例（`ALLOWED_SOURCES` 与主进程注册表逐项相等）；locale zh/en 成对新增/改写同一 key |
| 未闭合（诚实记录） | — | ① 跨会话「名次跃迁/在榜时长」需落盘名次历史（TrendRadar 用 `rank_history`），本期不做；② 中文榜单源稳定性弱于 RSS，单源失败为常态（已按整源丢弃 + `sourceStats` 归因）；③ 真机点击端到端未在本机实测（依赖用户已配默认大模型与可达的中文源）；④ S2/S3 尚未实现（本 change 的 tasks 已列），S4 阻塞于用户提供付费 Key |

### 三、关键取舍（写清楚为什么不那样做）

- **不把中文榜单塞进现有 `sources` 语义**：那会把「按关键词查」的相关性门禁语义搅浑（AGENTS.md 明令该门禁挂在共用出口），
  也会让「榜单没有发布时间」在窗口过滤里被一刀切丢掉。
- **域名判据只对 trend 源生效**：对 search 源判域名会把 HN/Reddit 的真实外链结果全部丢掉（这是本次实现中一次差点犯的错，
  已在代码注释与测试里锁死）。
- **`trendFn` 缺席算 `empty` 而非 `skipped`**：指令确实要求了趋势源，只是本进程暂时没能力；报「没配关键词」会误导用户去改指令。
- **内置词条不重复写「榜单素材没有发布时间」**：该约束只在 system 提示词里写一次（单实现才守得住），已在 PRD §11 更正。

### 四、远程同步

| 项目 | 状态 | 取证与回填要求 |
| ---- | ---- | ---- |
| 远程同步 | PASS | PR #3318 已 squash 合并为 `0aac19868e427602450ef9c67c8f4c07314c32ed`（2026-10-11T17:28:00+08:00）；取证：`git log origin/main --grep="(#3318)$" --format=%H|%cI` 恰好 1 行且 SHA 相同、`git ls-remote --heads origin quick-collect-cn-sources` = 0 行。本行、`.quality-gates.md` 同名记录两处、frontmatter 三字段与 ledger 登记项在同一次提交收口 |
