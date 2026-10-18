---
record: fix-collect-antibot-rewrite
task: 百家号采集把「百度安全验证」页当正文返回（并随去发布进入发布页正文），且采集页 stealth 分支自动改写误报 LLM 未配置；修复为 HTTP 优先 + 验证页 fail-closed + 有界重试，改写改走桌面引擎并新增 LLM_NOT_CONFIGURED
date: 2026-10-18
---

## 本次执行记录：百家号采集反爬验证页 + AI 改写误报 LLM 未配置（fix-collect-antibot-rewrite，2026-10-18）

> 本文件是执行记录的唯一强制载体。状态列不手写远程同步状态词：合并一旦发生，
> 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导（只认 squash 尾注 `(#NNNN)`）。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 隔离 worktree `mp-worktrees/mp-fix-collect-antibot-rewrite` + 裸分支 `fix-collect-antibot-rewrite`；共享根仅承载 docs（本记录/PRD/CHANGELOG/learnings/PRD.md 追加）。改动面：桌面主进程 + 渲染层 + Python 后端 + locales（4 个）+ 文档 |
| 第一性原因（QM-5 ①） | ✅ | 见下「① 根因溯源」：守卫 `d67952676`（2026-09-10）引入时挂在 Python 聚合分支；`6cbfa728a`（2026-09-13，PR #1751）把百家号改成 stealth 优先 ⇒ 守卫当天起不可达；`709658cb7`（2026-09-29）再把百家号先送视频通道，使该分支更不可能被走到。改写侧：同一提交 `6cbfa728a` 把 stealth 分支的改写接到 Python `/aggregation/rewrite`，而该后端自 `9d4bc3858`（2026-09-07）起只读 env |
| 逃逸分析（QM-5 ②） | ✅ | 见下「② 逃逸链」：既有回归用例守的是聚合路径（`Collection.test.js:351-376`，同文件 `:352-353` 注释自陈百家号已改走视频→stealth）；渲染层用例喂假 result；改写侧只测「错误文案渲染得好不好」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 见下「④ 修复 + 回归保护」与 PRD §10/§11：新增 3 个纯函数模块 + 2 个编排/守卫改动 + 错误码；桌面定向 9 文件 **366 passed**、Python `51 passed` |
| 防止再次发生（QM-5 ⑤） | ✅ | 见下「⑤ 预防措施」：判据单一真源 + 两端同判锁 + 结构化 reason 白名单 + 日志事件 + 债务门禁发现并修掉一处 500 行跨线 |
| 行尾与 diff 对账 | ✅ | 文档侧：`CHANGELOG.md`、`01-docs/learnings.md`、`01-docs/PRD.md` 三份工作副本均保持纯 CRLF（LF-only=0）；代码侧：`git diff --cached --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径**逐档完全相同**（32 文件，全量读数见 PR #PENDING 正文；代表性读数 `PRD 524/0`、`PRD.md 28/0`、`learnings 57/0`、`CHANGELOG 21/0`、`record 126/0`，新增文件删除数 0） |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → `检查域内测试文件 101 个 / OK: 全部测试均已接线或按欠账登记`（rc=0）；新增 3 个 `*.test.js` 均被桌面分片测试域覆盖 |
| QM-1 打包 + 启动三层判据 | ✅ | `pnpm run build:vue` rc=0（Vite 产物 46.48s）；`pnpm exec electron-builder --win --dir --publish never` rc=0（win-unpacked 产出）；asar 清单含 3 个新主进程模块（`url-collector-antibot.js` / `url-collector-browser.js` / `llm-runtime-config.js`），`check-asar-test-files` rc=0；启动实测：`aliveAfter12000ms=true`、`userDataCreated=true`、`stderrLen=0` ⇒ 三层判据 PASS；父环境 `ELECTRON_RUN_AS_NODE=1` 已按 `scripts/lib/qm1-child-env.js` 剔除并出声告警（未被静默吞掉） |
| QM-4 视觉回归 | N/A（有据） | 本片**未改任何模板/样式/DOM 结构**：`Collection.vue` 仅改 JS 逻辑；locale 变更只影响错误态文案（`security_challenge`/`draftBlockedSecurityChallenge`），默认视图不渲染这些键。像素基线对「默认视图」测不出差异，跑全量属空转；文案层由 `Collection.test.js` 的 `collectErrorDetail` 断言锁住。 |
| QM-6 CCG 双模型外部评审 | ✅ | 两轴均基于 `git diff --cached` 只读审查（无写操作）：**轴 A** `codex exec review --uncommitted`（codex-cli 0.144.6）→ 0 CRITICAL/0 MAJOR、2 条 P3，**采纳 2/2**：① `collectErrorDetail/collectErrorRetryable` 把错误对象解包成 message 字符串，结构化 `reason` 从未被消费（en 文案会退化为 unknown）→ 改为 `collectErrorSource()` 传对象 + IPC 失败信封透传 `data.reason`；② `security_challenge` 失败计入熔断 → 用户按提示重试 3 次即触发 15 分钟熔断 → 改为不记熔断（健康度/审计保留）。**轴 B** `claude -p`（Claude Code 2.1.301）→ 0 CRITICAL/0 MAJOR、7 条 MINOR，**采纳 0/7**：6 条明确"现状可接受/无修复需求"（判据与 PRD 取舍一致），1 条「英文兜底常量缺失」不影响行为（用户可见文案走 zh/en locale）。两条 P3 修复后由新增/扩展现有回归锁覆盖（见 ④）。CCG 判定记录（`.ccg/reviews/*.json`）以 `self_play_resolved` 闭环并写入两轴 findings——**未跑** `deep-review.sh` 编排（两轴 CLI 直接执行，等同 QM-6 语义）；`check-pr-exec-record --mode=enforce` 已 OK。 |
| 远程同步 | 由门禁推导 | `PR #PENDING`；本行不手写状态词、不为收口另开回填 PR |

## QM-5 五步（详细）

### ① 根因溯源（每条都有 commit 坐标）

| 序 | 提交 | 日期 | 干了什么 | 与缺陷的关系 |
|---|---|---|---|---|
| 1 | `d67952676` | 2026-09-10 | `fix(desktop+backend): 百家号反爬安全验证页拦截 — 防误报采集成功` | 引入 `isSecurityChallenge`，**唯一调用点放在 Python 聚合分支内**（main 基线 `Collection.vue:1251`）。此时它确实能拦住百家号当时的路径 |
| 2 | `6cbfa728a` | 2026-09-13 | `fix(collection): 知乎/百家号反爬站点直连 stealth 通道 — 消除先裸连触发风控的封 IP 风险 (#1751)` | 把 `baijiahao.baidu.com` 加进 `ANTI_CRAWL_HOSTNAMES`，渲染层对百家号**直接走 stealth 分支**，跳过它自己挂在聚合分支的守卫 ⇒ 守卫自本提交起对百家号**不可达**；同一提交还把 stealth 分支的自动改写接到 `api.aggregationRewrite`（Python） |
| 3 | `709658cb7` | 2026-09-29 | 视频通道扩到百家号 `/s`（`VIDEO_PATH_RULES`） | 百家号链接先进入视频采集通道，无视频再回退 stealth ⇒ 聚合分支被绕两层，守卫更不可能被走到 |
| 4 | `9d4bc3858` + `73c897ac6` | 2026-09-07 / 09-12 | Python 改写只读 `LLM_API_KEY`/`PO_OPENAI_API_KEY`，缺 Key 抛 `LLM_KEY_MISSING` | 与桌面「模型设置」构成**双份真源**；桌面配置从未进入请求 ⇒ 已配置仍误报 |

第一性原因一句话：**守卫被放在了「当时会走的路径」上，而不是「数据成型的出口」上；下一条提交改了路由，守卫就变成了摆设。**
改写侧的第一性原因：**配置来自两处，而报错文案只可能指向其中一处（用户看得见的那处）**。

### ② 逃逸链（按测试层级）

| 层级 | 为什么没拦住 | 证据 |
|---|---|---|
| 单元（渲染层） | 安全验证用例喂的是假 `result`，且测的是聚合分支；stealth 分支根本没有守卫可测 | `Collection.test.js:351-376`；同文件 `:352-353` 注释「百家号链接先走视频通道（无视频回退 stealth），不再经聚合层」 |
| 单元（主进程） | 没有「真实 CHALLENGE HTML → 生产解析器输出」的断言；`_parseHtml` 的 `success` 语义从未被当判据检验 | 本片现场：旧解析器对 3 份 CHALLENGE 页 `success=true / contentLen=101` |
| 集成 | 没有「采集结果 → 草稿 → 发布页正文」端到端断言 | 用户报障 P2（验证文字进发布页正文）只能在真机发现 |
| 审查 | 已有守卫造成「这里已处理」的错觉；分支覆盖缺口不看调用点数看不出来 | 守卫存在 3 天后即对目标站点失效，期间无人发现 |
| 改写侧 | 既有测试只验证「`LLM_KEY_MISSING` 能否渲染成友好文案」，即把误报渲染得更友好 | `user-facing-error.test.js:111-136` |

### ③ 系统性漏洞定位

| 类别 | 结论 |
|---|---|
| 测试场景缺失 | 缺少「同一份失败页产物过生产解析器」与「采集→发布正文来源」两类用例；前者本片补成纯函数 + 真实产物输入 |
| 测试与实现路径漂移 | 回归用例绑在具体分支上，路由一改就守空 —— 需要「判据单点 + 两端同判」这种与分支无关的锁 |
| 审查盲区 | 「有守卫」被当成「有覆盖」；审查清单里没有「守卫调用点数 vs 该输入实际分支数」这一项 |
| 流程缺失 | 平台改版/路由调整没有「守卫搬家」的检查项；本次由用户真机发现而非门禁发现 |

### ④ 修复 + 回归保护

| 修复项 | 落点 | 回归锁 |
|---|---|---|
| 验证页判据（结构性 URL/`title` + 强标记阈值 + 短正文边界） | `url-collector-antibot.js:149/168/176` | `url-collector-antibot.test.js` 24 例（含误杀反例、噪声隔离、边界 300 字） |
| 渲染层同源判据 | `collected-content-guard.js:63` | `collected-content-guard.test.js` 8 例（含**常量逐项相等**与**同一输入两端同判**两条锁） |
| 采集通道编排（浏览器有界重试 / HTTP 优先回退） | `url-collector-browser.js:63/95` | `url-collector.test.js` 89 例（含「HTTP+浏览器都命中 → 失败且不写缓存」） |
| 主进程解析 fail-closed（解析前 + 解析后双判） | `url-collector.js:254/340` | 同上（含「HTML 实体编码的强标记在解析后仍判」） |
| 路由三分支 + `mode` 返回 | `url-collector.js:177-180/477` | `url-collector.test.js`（`needsStealth+mode` 三例） |
| 渲染层第二道守卫 + 落库拦截 | `Collection.vue:920/1121/1136/1272/1326/1462` | `Collection.test.js` 114 例（含「验证页不入库、不触发改写」「persistDraft 拦截不建草稿」） |
| **QM-6-P3-①** 结构化 reason 必须被消费（en 文案不经中文 pattern 匹配） | `Collection.vue` `collectErrorSource()` / `toCollectErrorFromIpc()`（错误对象整体交给 `classifyCollectError`，IPC 失败信封透传 `data.reason`） | `Collection.test.js` 2 例：`collectErrorDetail 优先采信结构化 reason` / `urlCollectFetch 失败信封的 data.reason 会进入 collectError` |
| **QM-6-P3-②** 安全验证页失败不计入熔断（避免「重试 3 次锁 15 分钟」与提示文案自相矛盾） | `url-collector.js:191-207`（`antibot` 分支跳过 `recordFailure`/冷却封禁，健康度与审计保留） | `url-collector.test.js` 1 例：`security_challenge 失败不计入熔断（避免重试 3 次被锁 15 分钟）` |
| 结构化 `reason` 优先 | `collect-error.js:32/83` | `collect-error.test.js` 50 例（含「未知 reason 不采信」「reason 优先于 message」） |
| 桌面默认 llm 解析/注入 | `llm-runtime-config.js:96/186/227` | `llm-runtime-config.test.js` 12 例（含「显式 llm 不覆盖」「无 manager 降级不短路」「失败不含 Key 明文」） |
| IPC 注入与短路 | `aggregation.js:126/129`、`zhihu-favlist.js:147/155/288/382` | `aggregation.test.js` 23 例、`zhihu-favlist.test.js` 17 例 |
| Python 逐字段回退 | `models.py:152/177`、`service.py:212/254/341/428` | `tests/test_aggregation.py` 51 passed（+8） |
| 稳定错误码 + 文案 | `user-facing-error.js:39`、locales（collection / user-errors 各 zh+en） | `user-facing-error.test.js` 29 例（含 zh/en 成对前置锁） |

### ⑤ 预防措施（全部落到文件）

1. **判据单一真源**：常量与判定只在 `url-collector-antibot.js`，渲染层经 `collected-content-guard.js` 转发；「改一端不改另一端」由测试逐项比对判红。
2. **失败结构带 `reason`**：`security_challenge` 走 `classifyCollectError` 白名单，不再依赖本地化文案匹配（文案一改就会漂移）。
3. **可诊断日志**：`url-collect` 事件序列新增 `collect-start-http-first` / `collect-challenge`（WARN，带 attempt/maxAttempts） / `collect-challenge-exhausted`（ERROR）/ `collect-http-first-fallback`（WARN，带原因）。
4. **配置单源下发**：`applyLlmToBody` 统一注入，Python 逐字段回退；未配置与未注入在日志层用 `RESOLVE_REASON` 四值区分。
5. **规模门禁的一次实战拦截**：本片新增代码使 `zhihu-favlist.js` 一度到 506 行（split 口径），跨 `check-debt-budget.js` 的 500 行红线（`filesOver500` 101→102 会判红）；抽出 `applyLlmToBody` helper 后回落 499 行，最终 `filesOver500=95 ≤ baseline 101`、rc=0。**这条不是事后润色，是门禁在执行中拦下并逼出的重构。**
6. **learnings**：`01-docs/learnings.md` 顶部 5 条（守卫挂在退役路径 / 探针必须留可复算产物 / `success` 只代表解析完成 / 双份配置源使「未配置」不可信 / 反爬结论需要两个独立批次）。

## 任务勾账

| 任务 | 状态 | 证据 |
|---|---|---|
| 采集路由：百家号 HTTP 优先 + 浏览器兜底 | ✅ | `url-collector.js:177-180`、`url-collector-browser.js:95`；`url-collector.test.js` 路由/回退 4 例 |
| 验证页判据（主进程 + 渲染层同源） | ✅ | `url-collector-antibot.js`、`collected-content-guard.js`；两端同判锁 8 例 |
| 采集失败结构带 `reason=security_challenge` 且不入库 | ✅ | `collect-error.js:83`；`Collection.vue:1255/1309/1445`；`Collection.test.js` 3 例 |
| 去发布/存草稿拦截验证文字 | ✅ | `Collection.vue:920-921`；`Collection.test.js`「persistDraft 守卫」 |
| stealth 分支改写改走桌面 `aiRewrite` | ✅ | `Collection.vue:1459`；`Collection.test.js`「改写走桌面引擎」 |
| 桌面默认 llm 注入 Python `/aggregation/rewrite` | ✅ | `llm-runtime-config.js:227`、`aggregation.js:129`、`service.py:212` |
| 稳定错误码 `LLM_NOT_CONFIGURED` + zh/en 文案 | ✅ | `user-facing-error.js:39`、`locales/user-errors/zh.js:24` & `en.js:24` |
| PRD / CHANGELOG / learnings / PRD.md 追加 | ✅ | `01-docs/PRD-FIX-COLLECT-ANTIBOT-REWRITE-LLM-2026-10-18.md`、`CHANGELOG.md` 顶部、`01-docs/learnings.md` 顶部、`01-docs/PRD.md` 末尾附录 |

## 自测块（提交前当场跑；数字取自命令输出）

```
cd apps/desktop && pnpm vitest run electron/services/url-collector.test.js \
  electron/services/url-collector-antibot.test.js src/utils/collected-content-guard.test.js \
  electron/services/llm-runtime-config.test.js electron/ipc-handlers/aggregation.test.js \
  electron/ipc-handlers/zhihu-favlist.test.js src/views/Collection.test.js \
  src/utils/collect-error.test.js src/utils/user-facing-error.test.js
→ Test Files 9 passed (9) / Tests 366 passed (366)

cd packages/python-backend && python -m pytest tests/test_aggregation.py -q
→ 51 passed in 23.09s（基线 43，+8）

node scripts/check-debt-budget.js
→ rc=0：maxFileLines 5098≤5657 / filesOver1000 28≤32 / filesOver500 95≤101 /
        modelProviderRequireFanOut 65≤65 / circularDeps 0
```

真机与独立复核见 PRD §12.1 / §12.2（真机 2 次采集 `contentLen=3521` 且验证标记为空；
3 份 CHALLENGE 页 × 两种 URL 入参 = 6/6 `security_challenge`；3 份 OK 页零误杀）。

CI 首跑（PR #3915）shard 1/2 红过 1 例：`src/utils/rewrite-lineage.test.js` 的结构锁
「Collection 的 Python 改写分支必须显式清掉引擎残留 id」——它的前提是 Collection 存在 Python
改写分支，而本片正是把该分支整体改走桌面引擎 ⇒ 锁已过时（不是实现回归）。已把锁改为
正向不变量：「Collection 不得再调用 `api.aggregationRewrite(`（无 id 链路），且
`collectRewriteLineageId` 必须由共享 `extractRewriteHistoryId` 赋值」，本地
`rewrite-lineage.test.js` 11 passed；这是 CI 首跑暴露的**测试前提过期**，修复后重跑。

### 遗留（不假装已闭合）

- HTTP 直连仍可能被挑战（百度风控概率性）：修复只保证「失败不被当成功」，不承诺「永不触发」。
- stealth 浏览器兜底仍可能连续命中验证页：有界重试后返回 `security_challenge`，用户需重试或换链接。
- Cookie / 登录态复用未做（隐私与合规成本高，本片不引入）。
- 内容缓存无 TTL（仅 LRU，进程内）：本片只保证失败不写入，不扩范围。
- 历史采集条目/草稿中的验证文字不迁移，只在「创建草稿 / 去发布」入口拦截。
- 文本判据依赖百度现行文案（「拖动左侧滑块」「请完成下方验证后继续操作」等）；平台改文案会漏，靠结构性判据与日志事后校准。
- 批量采集链路只做了 llm 注入，采集侧同类守卫未逐一审计。
- `zhihu-favlist.js` 已到 499 行（split 口径），下一片改该文件前必须先抽函数，否则会再撞 500 红线。
