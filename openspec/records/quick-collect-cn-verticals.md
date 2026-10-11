---
record: quick-collect-cn-verticals
task: 快捷采集补齐 hot-topics 垂类信道（S1 补遗：sina_finance + ithome_tech 入册，并写清「5 个垂类」的真实归属）
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个动这些文档的会话（回填时**同一次**改：本文件表格行 + `.quality-gates.md` 同名记录的表格行与 bullet，并整段删除本 frontmatter 的三个 sync_* 字段，同时删 `scripts/gate-record-debt-ledger.json` 的本标题登记项）
---

## 本次执行记录：快捷采集补齐 hot-topics 垂类信道（quick-collect-cn-verticals，2026-10-11）

> 分支 `quick-collect-cn-verticals`，隔离 worktree `D:\Data\projects\mp-worktrees\mp-quick-collect-cn-verticals`（**非 C 盘**）。
> 承接 S1（PR #3318 → `0aac19868`）：S1 落了 8 个中文主榜，**垂类没落**。

### 一、问题：用户要的是「8 主榜 + 5 垂类」，S1 只落了主榜

用户原话里的 S1 范围是「复用仓库既有 hot-topics 中文榜单（**8 主榜 + 5 垂类**）」。
S1 交付后 registry 里只有 8 个主榜 ⇒ `sina_finance`（新浪财经滚动）与 `ithome_tech`（IT之家热榜）
这两个**有独立信道**的垂类在 UI 上**根本选不到**（源不在闭集里，命令校验会直接拒绝）。

复核 `hot-topics-service.js` 的 `CATEGORY_BOOSTS` 后确认「5 个垂类」的真实结构：

| 垂类 | 信道 | 能否独立选 | 处置 |
| --- | --- | --- | --- |
| 新浪财经滚动 | `sina_finance`（独立） | ✅ | **入册**（本切片） |
| IT之家热榜 | `ithome_tech`（独立） | ✅ | **入册**（本切片） |
| 百度财经榜 | `baidu` + board `finance` | ❌ 与主榜同信道 | 随主榜到达，**不另立源** |
| 微博情感垂类 | `weibo` + board `emotion` | ❌ 同上 | 同上 |
| 微博健康垂类 | `weibo` + board `health` | ❌ 同上 | 同上 |

依据（读源码，不猜）：`hot-topics-service.js` 的 `_collectBoostChannel` 给补拉条目写的是
`channel: source.channel`（即主榜信道）＋ `id: '<channel>:<board>:<rank>'`（board 段防撞号）＋
`category: boostCategory`。因此那 3 个垂类的条目**本来就随主榜一起进入 `topics`**；
给它们各立一个同名源，只会让同一份条目在两个源下出现两次（且 provider 只按 `channel` 过滤，立了也拿不到独立条目）。

### 二、这一笔改了什么

- **注册表**：新增 `sina_finance`、`ithome_tech` 两条（`kind:'trend'`、`provider:'hot-topics'`、
  `sourceType:'hottest'`、`timeKind:'observed'`、`group:'cn-hot'`，含 `homeUrl` 与 `expectedDomains`）。
  `timeKind` 必须是 `observed`：榜单条目没有发布时间，用抓取时刻并让提示词说「抓取时刻」。
- **内置词条**：`builtin-hot-topics` = 8 主榜 + 2 垂类（中文榜单全量）；`builtin-dev-tools` 增补 `ithome_tech`。
- **渲染端**：`ALLOWED_SOURCES` / `CN_TREND_SOURCES` 镜像同步；对话框「素材来源」提示补两个垂类（locale zh/en 成对）。
- **文档**：PRD §4.1 补两行源表 + 「5 个垂类的口径」说明；`ipc-handlers/quick-collect.js` 的注释从
  「8 中文主榜 + 5 垂类」改成精确口径（2 独立 + 3 board 级随主榜）；change `tasks.md` 增 S1.10/S1.11。

### 三、门禁表

| 门禁 | 状态 | Fresh 证据 |
| ---- | ---- | ---- |
| TDD | PASS | 特性域 **14 文件 274 passed / 0 failed**（改动影响面 9 文件 116 例）；新增/加强断言三处：注册表**闭集**锁死 `hot-topics` 恰好 10 个 id、IPC 断言垂类素材同为 `observed` 且清单写「抓取时刻」而非「发布」、词条覆盖断言（含反例：`builtin-risk-alert` 不得混入 `sina_finance`） |
| 变异反证（2 条） | PASS（逐条实测指名变红后回滚） | ① 摘掉 `sina_finance` ⇒ 闭集断言 1 红；② `ithome_tech.timeKind` 改 `published` ⇒ provider 时间语义不变量 1 红；回滚后 8 绿 |
| 静态门禁 | PASS | `check-max-lines` / `check-font-size-scale` / `check-locale-sync`（pair+cjk+keys）/ `check-ipc-bridge` / `check-frontend-consistency` / `check-no-brand-residue` / ESLint（改动文件零报错） |
| QM-1 打包 | PASS | `verify-worktree-deps` OK → `pnpm run build:dir` **rc=0**；asar 解包 require 后 `ALL_SOURCE_IDS`=22、`provider:'hot-topics'` 源=10 |
| QM-4 视觉 | 待 CI 判定 | 只改注册表/词条/对话框提示文案，页面截图预期 0 px；以 PR 的 `QG Visual` 为准 |
| 渲染端一致性 | PASS | 跨平面 parity 用例（渲染端镜像 == 主进程注册表）；locale zh/en 成对 |
| 未闭合（诚实记录） | — | 3 个 board 级垂类**仍无法作为独立源选择**：这需要给 registry 与 provider 引入 `board` 维度（属独立设计变更，不在本次范围）；本轮选择显式写清理由而非硬造 3 个拿不到独立条目的源 |

### 四、远程同步

| 项目 | 状态 | 取证与回填要求 |
| ---- | ---- | ---- |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后同一次回填本行、`.quality-gates.md` 同名记录的表格行与 bullet、本文件 frontmatter 的 `sync_*` 三字段，并删除 `scripts/gate-record-debt-ledger.json` 的本标题登记项 |

### 五、记忆沉淀

| 载体 | 状态 | 取证 |
| ---- | ---- | ---- |
| 仓库文档 | PASS | 本记录 + `.quality-gates.md` 同名记录 + PRD §4.1 + change `tasks.md` + `CHANGELOG.md` 新条目 |
| `01-docs/learnings.md` | PASS | 新增「复用既有聚合服务时，源清单要以**信道**为单位核对」小节（把「5 个垂类」的真实结构与本条可复用判据写清） |
| 外机 gstack learnings.jsonl | PASS | 追加 1 条：`aggregated-service-source-list-must-be-counted-by-channel-not-by-doc` |
| EverOS | PASS | 同一 session `mp-quick-collect-s1s2-20261011` 再 add 1 条并 flush（判据取 flush=extracted + 落盘 episode grep 哨兵词 `sina_finance`） |

