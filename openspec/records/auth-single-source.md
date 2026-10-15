---
record: auth-single-source
task: 端点鉴权上收为 FastAPI 依赖声明，并以反射为真源建 PRD 对账锁
date: 2026-10-15
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；远程同步这一行的证据只能在合并后取
sync_backfill_owner: 下一个会话（按 AGENTS.md「合并后收尾清单」回填并删除本段三个字段）
---

## 本次执行记录：端点鉴权上收为 FastAPI 依赖声明，并以反射为真源建 PRD 对账锁（auth-single-source，2026-10-15）【混合 PR】

| 门禁项 | 状态 | 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 运行时代码变更（`ops-center/backend/routers/`、`middleware/`）+ 文档（`01-docs/PRD.md`）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-auth-single-source`（分支 `auth-single-source`，基线 `c5b523228`） |
| 第一性原因（QM-5 ①） | PASS | ops-center 的鉴权有**两种挂法**：①路由依赖声明 `Depends(...)`（`route.dependant` 可反射）；②**函数体内调用**（反射读不到）。选定的口径是「以 FastAPI 路由的依赖声明为唯一真源」，而该真源**当时并不成立** —— 实测 **153 个端点里有 8 个的鉴权只存在于函数体内**（AST 抽到 9 个调用点，其中 1 个是包装函数自身的转发），且同一段静态 key 校验逻辑在 4 个文件里**各有一份逐字重复**实现。**第一性缺陷**：鉴权强度靠「读的是哪个文件的私有函数」来区分 |
| 逃逸分析（QM-5 ②） | PASS | 逃逸链：①**单元层**——既有 57 个测试文件只验证各端点行为，无一条断言「鉴权以什么形式声明」；②**集成层**——`test_security_config.py` / `test_logto_verifier.py` 验证的是 guard 函数本身的语义，不验证它被挂在哪；③**审查层**——同名不同语义是**最容易被读过去**的形态：`routers/runtime.py` 的 `_require_catalog_key` 与 `routers/diagnostics.py` 的同名函数**行为不同**（前者 Bearer 双通道、后者仅静态 key），而 `routers/feedback.py` 还从 `diagnostics` **跨模块 import 私有名**。系统性漏洞分类：**审查盲区**（缺少「鉴权面」的机器可读清单，只能靠人逐个文件读） |
| 修复 + 回归保护（QM-5 ④） | PASS | ①`middleware/auth.py` 新增 `require_catalog_key`（**仅**静态 key，唯一实现，错误语义与原 3 份重复实现逐一保持）；②8 个端点全部改为 `Depends(...)` 声明；③删除 5 个私有包装（`diagnostics`/`publish_metrics`/`usage` 各 1 个 + `runtime._require_catalog_key` + `telemetry._require_client_key`），并解除 `feedback → diagnostics` 的跨模块私有 import；④新增 `scripts/auth_surface.py`（反射真源 + `--emit`/`--check`）与 `tests/test_auth_surface.py`（**6 条锁**）；⑤修正发现的两处文档不符：客户端/实现只说静态 key 而文档声称 Bearer 优先、以及 `model_presets.py` docstring 漏写 Bearer 通道 |
| 防止再次发生（QM-5 ⑤） | PASS | 六条锁，各挡一类回归：**①规模下界锁**（反射结果 < 100 条即红 ⇒ 「解析退化成空集合」一眼可辨）；**②清单漂移锁**（鉴权改动必须同步 `tests/fixtures/auth-surface.json`）；**③公开端点白名单锁**（无鉴权依赖的路由必须逐条登记 ⇒ 新端点忘挂鉴权立刻红）；**④AST 结构锁**（router 函数体内不得再出现鉴权原语 ⇒ 防退回反射读不到的形态）；**⑤依赖词表锁**（不得出现未登记依赖名，清单的 `other_deps` 字段专为此设）；**⑥PRD 对账锁**（实现是唯一真源，PRD 的鉴权描述被判）。载体是**既有**的 `ops-center-ci.yml`（`python -m pytest tests/`）⇒ **未新增 workflow/job，未改「谁来守门」** |
| 变异反证 | PASS | **五处**，均在 **fastapi 0.143.1（= CI 版本）** 下实测改坏立刻变红 + **字节级还原**：①把 diagnostics ingest 退回函数体内守卫 ⇒ **6 红**；②新增忘挂鉴权的端点 ⇒ **2 红**；③把 usage/ingest 的 PRD 描述改回「Bearer 优先」⇒ **1 红**；④换成未登记的自定义守卫 ⇒ **5 红**；⑤退回「不递归的朴素反射」⇒ **5 红**（复现下面那条 CI 失败形态）。脚本 `D:\Temp\mutate-auth-surface.py`（锚点兼容 CRLF，可经 `MP_MUTATE_PYTHON` 指定解释器），每次还原后 `read_bytes()` 自证 |
| ⚠️ **CI 抓出的真源版本陷阱（本笔最重要的发现）** | 已修 | 本地 615 全绿、CI 却红在 `ops-center 后端测试`。根因：**`requirements.txt` 只约束 `fastapi>=0.115.0,<1.0.0`，本机装 0.133.1、CI 装 0.143.1**；而 **0.143 把 `app.include_router()` 改成了惰性** —— `app.routes` 里是 **`_IncludedRouter` 占位对象**（实测 37 项、仅 1 项带 `dependant`），真实路由挂在 `placeholder.original_router.routes`、前缀在 `placeholder.include_context.prefix`；0.133 则是**展平**成 153 个 `APIRoute`。于是**同一份反射代码本地得 153 条、CI 得 0 条** ⇒ 「唯一真源」在 CI 上根本不存在，门禁只在本地有效 = **假绿**。修法：`_iter_api_routes()` 递归展开两种形态。**验证**：两版分别 `--check` **都得到 153 条且与同一份已提交清单逐字节一致**，6 条锁在两版下全绿 |
| ⚠️ 失败信息的**误导性**（如实登记） | 已修 | CI 上的实际报错是「`KNOWN_AUTH_DEPS` 中登记但无人使用的依赖：5 个全中」——**指向登记表**（看起来像人手写错了表），而真因是**反射退化成空集**。这条下界锁（①）就是为此加的：把「解析退化」从「下游断言说胡话」变成「一眼可辨的规模化失败」。纪律出处：AGENTS.md「对解析结果加规模下界断言，否则解析退化成空集合会让通配锁假绿」 |
| ⚠️ 自查发现并修掉的**锁自身缺陷** | 已修 | 初版「依赖词表锁」是 **no-op**：`used` 取自已按词表**过滤过**的 `auth` 字段，故 `used - KNOWN_AUTH_DEPS` **恒为空**。靠准备变异反证（M4）时才发现。修法：清单新增 `other_deps`（既非 `get_db` 也不在词表里的依赖名），锁改为断言它为空 —— **未登记的守卫从此可见**。这条如实登记，因为「锁是 no-op 却登记为已生效」正是本仓 AGENTS.md 点名的失守形态 |
| ⚠️ 判据两次收敛（如实登记） | 已修 | 初版 PRD 对账判据有 22 条报错，逐条核对后**绝大多数是误报**，两次修正：①**只判「做了鉴权声称」的行**（原判据要求每处提及都满足关键词，而 PRD 里同一路径会出现在配置来源行、下发通道行等非鉴权语境）；②**按提及窗口判而非整行判** —— `01-docs/PRD.md` 是追加式文档，存在**巨型行**（实测单行 11494 字符），按行判会把同行无关段落的 `Bearer` 算成该端点的声称，导致修完真实描述后仍报红。另修一处**判据语义 bug**：`forbid=["Bearer"]` 会把 PRD 里的「**不接受 Bearer**」读成"声称接受"⇒ 增加否定前缀感知（`claims_keyword`） |
| ⚠️ CCG 安全扫描拦下的「路径遍历」 | 已修 | `.ccg` 的 `verify-security` 把 `scripts/auth_surface.py` 的 **`--fixture <path>` 参数**读成 2 处路径遍历高危，拦下 pre-commit。**未用 `SKIP_CCG_GATE=1`**（本仓禁止绕过门禁），而是**删掉那个多余参数** —— 清单路径本就固定，开放为命令行参数属无必要自由度。修后该文件扫描 `✓ 通过（0 高危）` |
| 测试通过 | PASS | **两版各跑一次全量 pytest `tests/`，均 615 passed**（含新增的 6 条锁），零破坏 —— 8 个端点的鉴权形态改变未打破任何既有用例。`scripts/auth_surface.py --check` 在 **fastapi 0.133.1 与 0.143.1** 下均 rc=0 且指向同一份清单 |
| QM-1 打包 | N/A | 未触及 `apps/desktop/electron/` 与 `packages/rpa-engine/`；本笔为 ops-center 后端 + 文档 |
| QM-2 代码必检项 | PASS | require 路径全部存在；未改 preload / IPC / 渲染端；Python 侧无硬编码密钥；改动使**鉴权收紧路径不变**（8 个端点的接受凭据集合逐一保持：3 个仅静态 key、5 个双通道），未扩大任何端点的可接受凭据 |
| 行数门禁 | N/A | `.github/scripts/check-max-lines.js` 只覆盖 JS/TS；ops-center 无 Python lint 门禁（实测 `git grep flake8\|ruff\|pylint\|black` 命中 0） |
| locale 成对 | N/A | 未改用户可见文案 |
| 视觉回归 | N/A | 无渲染端改动 |
| QM-6 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PENDING | 开 PR 时登记；合并后就地改写为 `PASS` + merge SHA（回填 PR 完成，含销账） |

### 交付内容（12 文件）

**鉴权上收（8 个生产文件）**
1. `middleware/auth.py`：新增 `require_catalog_key`（唯一实现，含收敛动因说明）
2. `routers/diagnostics.py`：删本地重复守卫 + 内联调用 → `Depends`
3. `routers/usage.py`：同上（并注明「仅静态 key」与 PRD 修正原因）
4. `routers/publish_metrics.py`：同上
5. `routers/feedback.py`：解除跨模块私有 import（`from routers.diagnostics import _require_catalog_key`）→ `Depends`
6. `routers/runtime.py`：删私有包装，2 个端点 → `Depends(verify_bearer_or_catalog_key)`
7. `routers/telemetry.py`：删 `_require_client_key` 包装 → `Depends`
8. `routers/model_presets.py`：内联调用 → `Depends`；**docstring 补回遗漏的 Bearer 通道**

**真源与锁（3 个新文件）**
9. `scripts/auth_surface.py`：反射真源（`--emit` / `--check`）+ **版本无关的路由枚举**（`_iter_api_routes` 递归展开 0.133 的扁平形态与 0.143 的 `_IncludedRouter` 惰性形态）+ 词表 + 公开白名单 + PRD 对账表
10. `tests/fixtures/auth-surface.json`：153 路由的鉴权清单（机器可读快照；**两版 FastAPI 下 `--check` 均与此文件逐字节一致**）
11. `tests/test_auth_surface.py`：**6 条锁**

**文档（1 文件）**
12. `01-docs/PRD.md`：修正 **8 处**鉴权过度声称（4 × `usage/ingest`、4 × `publish/ingest`，PRD 因追加式写入而重复）。**未误伤** runtime/bootstrap 与 model-presets/catalog 的 12 处正确双通道描述（替换脚本带计数断言）

### 本笔刻意不带 `.quality-gates.md` 与 ledger 登记项

这两个文件是全体并发会话的共同追加热点，带它们会让本 PR 每 ~13 分钟 `CONFLICTING`（本笔 CI 需 ~40 分钟）⇒ 结构性活锁。本记录自带 `sync_*` 三字段即满足登记判据。载体写入由随后的 **docs-only 回填 PR** 完成。

### 残留风险（不假装已闭合）

1. **3 个免鉴权端点无任何消费者**（实测证据）：`GET /api/v1/rewrite-ai-taste/runtime`、`GET /api/v1/rewrite-hard-constraints/runtime`、`GET /api/v1/rewrite-strategies/runtime` —— 桌面端 `git grep` 命中 **0**，而 `services/runtime_service.py:394-396` 是**直接 import service 函数**（不走 HTTP）组装 bootstrap，即它们 docstring 自称的用途（「供 bootstrap 内部组装」）由内部调用满足。**未移除**：删除公开端点是暴露面变更，需人工过目；已逐条登记进 `PUBLIC_ALLOWLIST` 并在测试的注释里点名。
2. **PRD 对账表是人工维护的白名单**（8 个端点）。未被登记的端点即使 PRD 描述有误也不会被抓到。这是刻意的：把「PRD 提到某路径就必须对账」放宽会引入大量误报（实测 22 条报错里绝大多数是误报）。扩表的成本是每次新增一个端点一行。
3. **`require_mention=False` 的端点**（`runtime/ack`、`telemetry/degradation`、`diagnostics/ingest`、`feedback`）只做「若 PRD 有鉴权声称则必须一致」，不强制 PRD 覆盖 —— 因为 PRD 不是端点清单，强求覆盖会退化成「为过门禁往 PRD 灌水」。
4. **`other_deps` 断言为空**这一条对**非鉴权**的新依赖也会变红（实测当前 153 路由全为空）。这是刻意从严：新增依赖时人需显式确认它是否属于鉴权面。
5. **递归展开依赖 FastAPI 的私有属性**（`original_router` / `include_context.prefix`）。0.143 的 `_IncludedRouter` 是**下划线开头的内部类**，下个小版本若改名，`_iter_api_routes` 会**静默少收集**而不是报错 —— 缓解靠新增的**规模下界锁**（< 100 条即红），但它只保证「不退化到极小」，不保证「一条不漏」。**彻底的修法**是把 `fastapi` 的版本在 `requirements.txt` 里收紧到实测过的区间（本笔未做：改依赖约束属「谁来守门」类变更，需人工过目）。
6. **本机 fastapi(0.133.1) 与 CI(0.143.1) 不同版本**是这次假绿的根因，且**该系统性问题仍然存在**：`requirements.txt` 的区间 `>=0.115.0,<1.0.0` 意味着任何一次 `pip install` 都可能换到行为不同的版本。本笔只修了「反射」这一处受影响面；同类风险（其它依赖反射/内部属性的代码）未见排查。

### 保留门禁

行尾对账 ✅ | 品牌残留 ✅ | locale 成对 N/A | 视觉回归 N/A | 行数门禁 N/A（无 Python lint）| QM-1 N/A | 远程同步 PENDING

### 保留门禁

行尾对账 ✅ | 品牌残留 ✅ | locale 成对 N/A | 视觉回归 N/A | 行数门禁 N/A（无 Python lint）| QM-1 N/A | 远程同步 PENDING
