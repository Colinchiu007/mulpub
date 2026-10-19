---
record: fix-collect-rewrite-empty-content
task: 采集成功但正文为空（缓存空壳 cache_hit）时，「一键改写」把空串发往改写引擎（旧链路 Python 422、新链路无意义）；修复为改写漏斗 rewriteViaEngine 入口 trim 判空，复用稳定错误码 AGGREGATION_CONTENT_EMPTY
date: 2026-10-18
---

## 本次执行记录：缓存空壳 + 一键改写空正文守卫（fix-collect-rewrite-empty-content，2026-10-18）

> 本文件为执行记录（唯一强制载体，见 `openspec/records/` 新形态）。
> 状态列不手写远程同步状态词：合并一旦发生，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更 ⇒ 隔离 worktree `mp-worktrees/mp-fix-collect-rewrite-empty-content` + 裸分支 `fix-collect-rewrite-empty-content`（基于 `origin/main` `c29ef1acf`，即上一刀 #3915 合并点）；共享根未做任何代码写入 |
| 第一性原因（QM-5 ①） | ✅ | `rewriteViaEngine(stealthItem.content \|\| stealthItem.description \|\| '')`：`cache_hit` 空壳（`url-collector.js:165-167` 有意返回 `title:'' / content:''`）经 `\|\|` 兜底成空串直送改写引擎；旧后端 `RewriteRequest.content` `min_length=1` ⇒ FastAPI 422。引入点即上一刀 #3915（改写调用从 Python 改引擎时未同时搬运「空内容」守卫）；`cache_hit` 空壳形态为既有设计，非本刀引入 |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：`Collection.test.js` 的 `collectAndRewrite` 用例全部使用非空 content 的 stealth result，无「content 为空」场景；集成层：无「缓存命中 → 一键改写」端到端断言；审查层：上一刀 QM-6 Claude 轴曾提「renderer guard 依赖已提取 {title,content}」但判为无修复需求，未追问空 content 分支 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 修复在漏斗入口（`rewriteViaEngine`，`Collection.vue:649-663`）：`!content \|\| !String(content).trim()` ⇒ 返回 `{__error:{code:-400, errorCode:'AGGREGATION_CONTENT_EMPTY', message}}`，不调 `aiRewrite`。回归锁 `Collection.test.js` 新增 4 例（空串 / 纯空白 / 缓存空壳一键改写 / 正常内容不误杀）；**变异反证**：把守卫条件改为 `if (false)` ⇒ 3 例当场红（守卫非装饰） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① `01-docs/learnings.md` 顶部新增 3 条教训（success-shape-is-not-content-shape / guard-at-the-funnel-not-at-each-call-site / reuse-the-error-code-table-before-adding-one）；② 本执行记录；③ CHANGELOG 顶部条目；④ 复用既有稳定错误码 `AGGREGATION_CONTENT_EMPTY` 而非新增（避免双套说辞） |
| 行尾与 diff 对账 | ✅ | 见「自测块」：`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐档相等 |
| 接线棘轮 | ✅ | 未新增测试文件（扩展现有 `Collection.test.js`，已在桌面分片测试域内），`node scripts/check-unwired-tests.js` 需在提交后取证 |
| QM-1 打包 | ✅ | 本刀**只改渲染层**（`apps/desktop/src/views/Collection.vue` + 测试），未触碰 `apps/desktop/electron/**`。按 QM-1 字面口径「修改 electron 主进程代码后才必须打包」，本刀不触发打包义务；渲染层由 `pnpm vitest` + eslint + CI `QG Unit Tests` / `QG Desktop Shards` 覆盖。此判定如实记录，不冒充打包证据 |
| QM-2 代码必检项 | ✅ | 改动为渲染层纯函数守卫：无同步阻塞原语、无新增 IPC、无 `v-html`、无硬编码等待；错误信封形状与既有 `__error` 消费方（`formatUserError`）一致 |
| QM-4 视觉回归 | N/A（有据） | 未改模板/样式/DOM；仅在已有 `rewriteError` 展示位上多出一条可达状态（空内容），提示文案由既有 locale key 提供，默认视图不渲染该状态 |
| QM-6 CCG 双模型外部评审 | ✅ | 两轴只读审查（`git diff --cached`）：`codex exec review --uncommitted` + `claude -p`。轴 A（codex-cli 0.144.6）：0 CRITICAL/0 MAJOR；轴 B（Claude Code 2.1.301）：0 CRITICAL/0 MAJOR、2 MINOR（均为「现状可接受」，见下）。CCG 判定记录以 `self_play_resolved` 闭环并写入两轴 findings |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口，不手写状态词、不为收口另开 PR |

## QM-5 五步（详细）

### ① 根因溯源

| 序 | 事实 | 证据 |
|---|---|---|
| 1 | 用户操作：百家号文章点「一键改写」，先「内容采集成功」，再弹「Python backend request failed (422)」 | 用户报障（2026-10-18 17:01）+ 应用日志 `shared-user-data/logs/app-2026-10-18.log:20732-20740` |
| 2 | 日志链完整还原：`collect-video` 422（无视频）→ `fallbackToArticle` → `collect-cache-hit`（提示采集成功）→ `/aggregation/rewrite` 422 → `rewriteFailed` | 同上日志行（16:59:56Z 时刻） |
| 3 | 空壳来源：`url-collector.js:165-167` cache_hit 分支有意返回 `{success:true, reason:'cache_hit', title:'', content:''}` | 源码直读；注释自陈「缓存空壳会被上层判 unsubstantive 失败」 |
| 4 | 改写入参：`rewriteViaEngine(stealthItem.content \|\| stealthItem.description \|\| '')` —— 空壳经 `\|\|` 兜底为空串 | `Collection.vue`（本刀修复前） |
| 5 | 422 复现（本地实测，非推测）：对运行中的旧后端（pid 36852 / 端口 18357）直发 `{"content":"",...}` ⇒ `HTTP 422 {"detail":[{"type":"string_too_short","loc":["body","content"],"msg":"String should have at least 1 character"}]}`；同 payload 填非空 content ⇒ `HTTP 400 LLM_KEY_MISSING`（证明 422 与 payload 字段无关、专由空 content 触发） | curl 实测 |
| 6 | 运行环境核实：用户所跑的 Electron 来自旧 worktree `mp-app-live2`（主进程启动于 2026-10-17 23:26），其 Python 后端 pid 36852 同时旧 ⇒ 用户**尚未用上**上一刀（#3915，16:10 合并）的代码。本刀修的是「新代码下同样存在的空正文路径」 | `Get-CimInstance Win32_Process` + `/openapi.json`（`RewriteRequest` 无 `llm` 字段）+ 进程启动时间 |

第一性原因一句话：**把「信封成功」当成「内容就绪」——`cache_hit` 是有意的空壳成功形态，而改写链路没有任何一道判空。**

### ② 逃逸链（按测试层级）

| 层级 | 为什么没拦住 | 证据 |
|---|---|---|
| 单元（渲染层） | `Collection.test.js` 的 `collectAndRewrite` 用例全部构造非空 content 的 stealth result；「采集成功但 content 为空」这个中间态从未被建模为测试场景 | 修复前测试文件通览（无空 content 用例） |
| 集成 | 无「缓存命中 → 一键改写」端到端断言；缓存空壳与改写链路在两个模块，中间无契约测试 | 无对应用例 |
| 代码审查 | 上一刀 QM-6 外部评审（Claude 轴）曾指出「renderer guard 依赖已提取 {title,content}，历史缓存若仅含正文无标题则标题命中信号丢失」，判为「当前设计合理，无修复需求」——方向对但没继续追问「content 也为空」这一支 | QM-6 评审记录（#3915 PR 正文） |

### ③ 系统性漏洞定位

| 分类 | 具体漏洞 |
|---|---|
| 测试场景缺失 | 「成功信封 ≠ 内容就绪」这一类中间态（cache_hit / 降级 / 回退）从未进入采集→改写链路的测试建模；测试只覆盖「有正文的成功」 |
| 守卫分散风险 | 改写调用点有 4 个（视频转写 / stealth 自动 / 聚合回退 / 手动），参数校验若按调用点各写一遍必然漏；本刀改为漏斗单点，正是把「分散」这个系统性风险本身修掉 |

### ④ 修复 + 回归保护

| 修复项 | 落点 | 回归锁 |
|---|---|---|
| 改写漏斗入口判空（trim） | `Collection.vue:649-663`（`rewriteViaEngine`） | `Collection.test.js`「空正文改写守卫」4 例：空串不调 aiRewrite 且回 `AGGREGATION_CONTENT_EMPTY`；纯空白（空格/换行/制表）同样拦截；`collectAndRewrite` + cache_hit 空壳 ⇒ 不改写、`rewriteError` 带可操作文案；正常内容不误杀 |
| 错误码复用 | `user-facing-error.js` 既有 `AGGREGATION_CONTENT_EMPTY`（zh/en） | `user-facing-error.test.js` 既有 zh/en 渲染用例（29 例全绿） |

变异反证（防装饰性测试）：将守卫条件 `if (!content || !String(content).trim())` 改为 `if (false)` ⇒ 守卫 3 例当场红（4/4 → 1/4），恢复后复绿。

### ⑤ 预防措施（全部落到文件）

1. `01-docs/learnings.md` 顶部 3 条教训：`success-shape-is-not-content-shape`（信封成功≠内容就绪）、`guard-at-the-funnel-not-at-each-call-site`（守卫放漏斗）、`reuse-the-error-code-table-before-adding-one`（错误码先搜后用）。
2. `CHANGELOG.md` 顶部条目（问题 / 改动 / 验证 三段，验证段为实跑数字）。
3. 本执行记录。
4. 机制层面：把「成功信封 → 下一步」列入评审提问（写入 learnings 判据，供后续 QM-6 评审清单参考）。

## 任务勾账

| 任务 | 状态 | 证据 |
|---|---|---|
| QM-5 ① 根因溯源（含日志 + 后端 422 复现 + 运行环境核实） | ✅ | 本记录 §QM-5①；`app-2026-10-18.log:20732-20740`；curl 复现 422/400 |
| QM-5 ② 逃逸链 | ✅ | §QM-5② |
| QM-5 ③ 系统性漏洞定位 | ✅ | §QM-5③ |
| QM-5 ④ 修复 + 回归保护（含变异反证） | ✅ | §QM-5④；4 例守卫 + 变异 3 红 |
| QM-5 ⑤ 预防措施 | ✅ | §QM-5⑤ |
| TDD（先红后绿） | ✅ | RED：3 failed / 1 passed（守卫不存在时空串仍发往 aiRewrite）；GREEN：118 passed |
| 相邻回归 | ✅ | user-facing-error 29 + rewrite-lineage 11 + collected-content-guard 8 + llm-runtime-config 12 = 60 passed |
| eslint | ✅ | `Collection.vue` / `Collection.test.js` exit 0 |
| QM-6 双模型外部评审 | ✅ | codex 0C/0M + claude 0C/0M/2MINOR（MINOR：① 建议顺带把 `cache_hit` 空壳在采集层就分级为「空内容」提示——判定为不做，缓存契约属既有设计、改它影响面超出本刀；② 建议补一条「手动改写入口同样受保护」的独立用例——已被漏斗测试覆盖，判定为不新增） |
| 文档（learnings / CHANGELOG / 记录） | ✅ | 三处均已落盘 |
| 三路记忆沉淀 | ✅ | 内置记忆（`~/.dsh/memory/Mulpub/`）+ 外部记忆（`01-docs/learnings.md`，随本 PR 落地）+ EverOS（session `mp-fix-collect-rewrite-empty-content-20261018`） |

## 自测块（提交前当场跑，禁止预填结论）

```
cd apps/desktop && pnpm vitest run src/views/Collection.test.js
→ Test Files 1 passed (1) / Tests 118 passed (118)

cd apps/desktop && pnpm vitest run src/utils/user-facing-error.test.js src/utils/rewrite-lineage.test.js \
   src/utils/collected-content-guard.test.js electron/services/llm-runtime-config.test.js
→ Test Files 4 passed (4) / Tests 60 passed (60)

变异反证：守卫条件改为 if (false) → 守卫 3 例红；恢复 → 4 例绿
eslint（Collection.vue / Collection.test.js）→ exit 0
行尾两口径：git diff --numstat 与 --ignore-cr-at-eol --numstat 逐档相等
```

### 遗留（不假装已闭合）

- `cache_hit` 空壳仍是「成功」形态：采集层不区分「有正文的成功」与「空壳成功」（本刀只保证空内容不进改写；要在采集提示上就分级，需动缓存契约，影响面超出本刀）。
- 用户当前运行的应用是旧 worktree（`mp-app-live2`）实例：本刀合并后仍需**完全退出并重启**应用才能生效（Electron 主进程 + Python 后端子进程都不热更新）。
- 视频通道 `collect-video` 对百家号 `/s` 返回 422 表达「无视频」是既有的形态（渲染层已正确处理为回落图文），本刀未动。
