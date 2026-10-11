---
record: quick-collect-cn-sources-s2
task: 快捷采集·中文素材源扩展（S2：带发布时间的免费中文/技术时间线源 + 抓取层字节/条数上限 + 节流缓存 + 计划性空榜）
date: 2026-10-11
---

## 本次执行记录：快捷采集·中文素材源扩展 S2（quick-collect-cn-sources-s2，2026-10-11）

> 分支 `quick-collect-cn-sources-s2`，隔离 worktree `D:\Data\projects\mp-worktrees\mp-quick-collect-cn-sources`（**非 C 盘**）。
> 承接 S1（中文热榜接线，PR #3318 → `0aac19868e427602450ef9c67c8f4c07314c32ed` @ 2026-10-11T17:28:00+08:00，已合并）：
> S1 解决「榜单没有发布时间」，S2 解决「**要有发布时间**的时间线源」。
> 本分支从 S1 分支分出，S1 合并后用 `git rebase --onto origin/main <S1-提交> quick-collect-cn-sources-s2`
> 把 S2 单个提交重放到主干（CHANGELOG 冲突按「两侧条目都保留」解决，未产生重复标题）。

### 一、这一笔在做什么

新增 `quick-collect-trend-sources.js`（RSS/Atom/JSON 解析 + 抓取 + 节流 + 缓存）与注册表里 9 个 `provider: 'feed'` 的源：

| 源 | 形态 | 时间字段 | 关键实现点 |
| --- | --- | --- | --- |
| Solidot / 少数派 / OSCHINA / IT之家 / 量子位 / InfoQ 中文 | RSS | `<pubDate>` | 通用 RSS 解析（CDATA、实体、四种时间标签） |
| arXiv cs.AI | Atom(RSS) | `<pubDate>` | **`<skipDays>` ⇒ 周末空榜记 `emptyBySchedule`**（与故障区分） |
| V2EX 热榜 | JSON | `created`（unix 秒） | 榜单形态但**有原生时间** ⇒ 标 `published` 而非 `observed` |
| HuggingFace 每日论文 | JSON | `publishedAt`（**`MM/DD/YYYY HH:mm:ss`**） | 美式格式单独解析；用 `paper.id` 组装链接 |

三条工程约束：**字节上限 512KB**（实测存在 1.3MB 级 feed）、**单源 20 条**、**解析不出时间返回 null 而不退化 now**。
抓取层自带**按源节流**（仅放行的请求消耗 interval）与**按源缓存**（TTL 10 分钟，键 = namespace + 排序源 id）。
IPC 把 `hot-topics`（observed）与 `feed`（published）两个 provider 合成 `trendFn`，`emptyBySchedule` 随元数据回传。

### 二、门禁表

| 门禁 | 状态 | Fresh 证据 |
| ---- | ---- | ---------- |
| TDD | PASS | 特性域 **272 passed / 0 failed**（14 个文件）：主进程+共享 10 个文件 126 例（含 S2 新增 `quick-collect-trend-sources.test.js` 12 例与跨模块 3 例）、渲染端 4 个文件 146 例 |
| 变异反证（5 条） | PASS（逐条实测指名变红后回滚） | ① HF 美式时间月/日写反 ⇒ **2 红**；② 摘字节上限 ⇒ **1 红**；③ 不过滤无标题/无链接条目 ⇒ **1 红**；④ 计划性空榜识别恒 false ⇒ **1 红**；⑤ 摘按源节流 ⇒ **1 红**；回滚后 12 绿 |
| 静态门禁 | PASS | `check-max-lines`（无新增超大文件）、`check-font-size-scale`、`check-locale-sync --pair-base/--cjk/--keys`（1817）、`check-ipc-bridge`、`check-frontend-consistency`、`check-no-brand-residue`（7989 文件）、ESLint（改动 5 文件零报错） |
| QM-1 打包 | PASS | `verify-worktree-deps` OK → `pnpm run build:dir` **rc=0**；asar 内 `quick-collect-trend-sources.js`（12126 B）解包后 `require`：注册表 20 源（feed 9）、`MAX_BYTES=524288`、`createFeedTrendFetcher` 可调用；`builtin-ai-trends` 的 sources 已含 `arxiv_cs_ai/hf_papers/qbitai/solidot` |
| QM-4 视觉 | 待 CI 判定 | 本切片改动只落在对话框提示文案（弹窗不在页面截图内）与主进程逻辑，预期 0 px；以 PR 的 `QG Visual` 为准 |
| 渲染端一致性 | PASS | 镜像清单补 9 源 + `TECH_SOURCES` 子集；「前后端闭集对账」用例逐项相等；locale zh/en 同 key 成对 |
| 未闭合（诚实记录） | — | ① 抓取层只有注入式单测（零出网），真实网络可达性靠运行期 `sourceStats` 归因，未做每日可达性监控；② 若某 feed 大量外链条目，会体现为 `dropped.domain_mismatch` 上升（本轮选定源均为自家域名）；③ S3/S4 未实现 |

### 三、与 S1 的口径调整（同一 change 内的显式更正）

- 不变量从「`sourceType==='hottest'` ⇒ `timeKind='observed'`」改为**按 provider 判**：
  `provider==='hot-topics'` ⇒ `observed`（中文榜单确实没有发布时间），
  `provider==='feed'` ⇒ `published`（时间线/JSON 源确实有发布时间）。
  触发点是 V2EX 热榜：**榜单形态但每条自带 `created`** —— 有原生时间就必须用原生时间，把它的真实时间丢掉换成抓取时刻是**降级**。
- S1 的一条测试期望随之更正：未注入热榜服务时，`trendFn` 现在恒存在（feed provider 仍可工作），
  故不再是「整体 skipped」，而是**逐源 `skipped` 归因 + `retrieval='empty'`**（更准确）。
- PRD §4.2 已就地补「实现状态」与上述不变量说明（含 `v2ex` 采用 `hot.json` 而非 `index.xml` 的更正）。

### 四、远程同步

| 项目 | 状态 | 取证与回填要求 |
| ---- | ---- | ---- |
| 远程同步 | PASS | PR #3322 已 squash 合并为 `b8af126a55074915e3b416a94614c7b4cf0b7947`（2026-10-11T18:52:25+08:00）；取证：`git log origin/main --grep="(#3322)$" --format=%H|%cI` 恰好 1 行且 SHA 相同、`git ls-remote --heads origin quick-collect-cn-sources-s2` = 0 行。本行、`.quality-gates.md` 同名记录两处、frontmatter 三字段与 ledger 登记项在同一次提交收口 |
