---
record: quick-collect-cn-sources-s3
task: 快捷采集·中文素材源扩展 S3——政策/合规类源实测收口（7 个候选全实测，无可用源 ⇒ 以证据收口，不硬做）
date: 2026-10-11
---

## 本次执行记录：快捷采集·中文素材源扩展 S3——政策/合规源实测收口（quick-collect-cn-sources-s3，2026-10-11）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true`（files=3：`01-docs/PRD-QUICK-COLLECT-CN-SOURCES-2026-10-11.md`、`01-docs/learnings.md`、`openspec/changes/quick-collect-cn-sources/tasks.md`；本记录与 `.quality-gates.md` 记录同在这一个 PR 里）。
- 变更类型与隔离：📝 纯文档（结论性文档，无运行时代码）⇒ 按分层策略在共享根/隔离 worktree 就地编辑 + PR 落地，未改任何运行时代码。

### 一、S3 做了什么（以及为什么**没有**写代码）

S3 的目标是「政策/合规类源（平台规则中心公告、网信办/工信部等）」。本会话按「**未实测通过不得入册**」的既有纪律，
先做端点实测（本机 `Invoke-WebRequest`，UA 伪装 Chrome，12s 超时；判据 = 能否稳定拿到**条目级标题 + 链接 + 发布时间**），
结论是**当期没有可用源**：

| 候选 | 实测结果 | 判定 |
| --- | --- | --- |
| 微信公众平台公告 | 200，13.8KB，**条目/日期命中 0**（JS 渲染 + 需 token） | ❌ |
| B站 社区规则黑板报 | 200，3.6KB，**0 条目 0 链接**（空壳） | ❌ |
| 小红书 社区公约 | 200，9.3KB，**0 条目**（登录墙 + `__ERROR_TRACKER`） | ❌ |
| 抖音 规则中心 | 200，**1.0KB**（纯壳） | ❌ |
| 中央网信办 首页 | 200，59KB，139 处日期/358 链接，但**无「`<li>` 标题+日期」可解析列表** | ⚠️ 需逐条抓详情页 |
| 工信部 新闻列表 | 200，19KB，41 条带文字链接（标题可解析），**列表页无条目级时间** | ⚠️ 同上 |
| 网信办子栏目（`/xxgk/tzgg/` 等） | 逐个 404 | ❌ |

**不硬做的三条理由**（产品判断，已写进 PRD §4.3）：① 「逐条抓详情页」把一次点击变成 N+1 次外呼，与限频纪律冲突；
② 半坏的 HTML 源会**静默空列表**，用户读成"近期没有新规"——比显式缺失严重得多；③ 政策信息正确率权重最高，宁缺毋假。

### 二、门禁

| 门禁 | 状态 | Fresh 证据 |
| ---- | ---- | ---- |
| docs-only 判定 | PASS | `classify-docs-only.js` → `docs-only=true`（files=3） |
| 行尾/编码对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐文件一致 |
| 品牌残留 | PASS | `check-no-brand-residue.js`（扫描 8006 tracked 文件，无残留；实测点名的平台名一律按「参考产品」口径书写） |
| doc-gate 文档同步 | PASS | CI `文档同步检查`（本 PR 只动文档） |
| 执行记录取证 | PASS | `check-pr-exec-record.js --mode=enforce` → 新增记录 1 篇 |
| 欠账门禁 | PASS | `check-gate-record-debt.js` → 顶部记录带行、两源未收口行均已登记 |
| 绝对路径门禁 | PASS | `check-doc-abs-paths.js` |
| QM-1 / QM-4 / TDD | N/A | 纯文档，无运行时代码改动（docs-only 通道豁免，且已实测无源可接） |

### 三、留给后续的三条路径（需用户拍板，tasks.md S3 已登记）

- **A. 监管站点逐条抓取**：只取政府站点（无反爬、无需登录），接受 N+1 次外呼与 HTML 易碎性；必须带「结构变更 ⇒ 明确失败」判据与夹具。
- **B. 用户自填 RSS / 公告页 URL**：把政策源做成**用户可配置订阅输入**（复用 S2 的 feed 抓取层），合规与稳定性责任在用户侧。
- **C. 付费中文检索 API（= S4）**：一次覆盖"中文全网（含公众号/社区）"，代价是 Key 与费用。

### 四、远程同步

| 项目 | 状态 | 取证与回填要求 |
| ---- | ---- | ---- |
| 远程同步 | PASS | PR #3334 已 squash 合并为 `4004df02dd019ae9cce9a2408f25ac4dcaed4f51`（2026-10-11T19:20:56+08:00）；取证：`git log origin/main --grep="(#3334)$" --format=%H|%cI` 恰好 1 行且 SHA 相同、`git ls-remote --heads origin docs-s3-closure` = 0 行。本行、`.quality-gates.md` 同名记录两处、frontmatter 三字段与 ledger 登记项在同一次提交收口 |

### 五、记忆沉淀（四处，判据一律取产物）

| 载体 | 状态 | 取证 |
| ---- | ---- | ---- |
| 仓库文档（外部记忆） | PASS | 本记录 + `.quality-gates.md` 同名记录 + `01-docs/PRD-QUICK-COLLECT-CN-SOURCES-2026-10-11.md`（§4.2 实现状态、§4.3 S3 证据表、§4.4 S4 口径更正）+ `openspec/changes/quick-collect-cn-sources/tasks.md` + `CHANGELOG.md`（S1/S2 两条条目） |
| `01-docs/learnings.md` | PASS | 新增章节「快捷采集中文源扩展 S1/S2 的三条可复用教训」（时间语义必须显式两态 / 域名判据作用域要与数据来源对齐 / 跨模块字段拼写要有对侧契约测试）+ 一条流程观察（QG Autonomous 是 LLM 抖动的全局 PRD 审计） |
| 外机记忆 `~/.gstack/projects/Colinchiu007-Multi-Publish/learnings.jsonl` | PASS | 追加 **4 条**（143 → **147 行**，逐行 `JSON.parse` 合法）：`external-source-time-semantics-must-be-explicit-two-states`、`domain-guard-scope-must-match-data-producer-not-field-name`、`cross-plane-field-spelling-needs-contract-test-on-both-sides`、`llm-judged-global-prd-coverage-gate-is-flaky-not-a-verdict-on-your-pr` |
| EverOS | PASS | `POST /api/v1/memory/add` ×2（session `mp-quick-collect-s1s2-20261011`，两条分别覆盖 S1/S2 与 S3/S4）→ `status:"accumulated"`；随后 `POST /api/v1/memory/flush` 回 **`status:"extracted"`**；落盘产物 `~/.everos/default_app/default_project/users/agent/episodes/episode-2026-10-11.md`（**8476 B**，19:25:37）中 grep 到哨兵词 `quick-collect-trend-sources`、`MAX_BYTES`、`emptyBySchedule`、`b8af126a5`、`4004df02d` 各命中 ⇒ 判据取产物，不取接口应答 |
| 内置记忆 | 如实说明 | 本会话的 DSH 会话档由 harness 自动落盘（无对外写 API），**未**手工伪造文件；故"内置记忆"这一档的产物即本会话本身 |

> 附一条现场教训（已同步进 learnings）：EverOS 的 `add` 回 `accumulated` **不等于已落盘可检索**，必须 `flush` 且以 `extracted` + 落盘文件 grep 为准 —— 本轮按此取证，未据"接口回显成功"宣告。

