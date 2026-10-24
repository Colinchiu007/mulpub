---
record: explainer-schema-contracts
task: 把上游 OpenMontage 的 13 个 artifact schema 逐字搬进本仓并自研零依赖校验器，为后续阶段产物 1:1 对齐提供机械判据
date: 2026-10-24
---

## 本次执行记录：上游 artifact schema 契约与零依赖校验器（explainer-schema-contracts，2026-10-24）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **零行为变更**（只新增 schema 资产 + 校验器 + 脚本 + 文档，**不改任何既有文件的行为**）⇒ 隔离 worktree `/workspace/mp-worktrees/mp-explainer-schema-contracts`、裸分支 `explainer-schema-contracts`（`git branch --show-current` 实证），基线 `origin/main = c46be738`；共享根保持 main + clean |
| 第一性原因（QM-5 ①） | ✅ | 本片不是「加个校验器」，而是**给「上游设计补齐」这条 7 个 PR 的主线铺唯一可信的判据底座**：上游 OpenMontage 的 `animated-explainer` 每个阶段都声明了 `produces`（9 个 artifact）与 `success_criteria`（计数型硬指标）⇒ 若没有**机械校验**，P2a/P2b 的「产物 1:1 对齐」只能靠人眼比对 JSON ⇒ 而「结构上像」与「满足上游契约」是两件事。**第一性判据**：契约必须**可机械判定**，否则整条补齐路线没有验收标尺 |
| 逃逸分析（QM-5 ②） | ✅ | ① **无现成校验器**：全仓 `ajv` / `json-schema` **零命中** ⇒ 只能自研或引依赖。② **「引依赖」本身的代价**：本仓依赖漏洞门禁对**所有** PR 全量扫描（`dep-audit.yml` 无 paths 过滤，且 `paths-ignore` 被契约测试禁止）⇒ 新增依赖 = 新增审计面 + 打包体积 + 与「pnpm 唯一包管理器」的锁文件耦合。③ **假绿面（最关键）**：若本校验器不认识上游新增的关键字 ⇒ **静默跳过**该约束 ⇒ 产物「校验通过」而那个约束**根本没被检查** ⇒ 这是「解析失败型假绿」的同族（见记忆：校验器压根没在验 ⇒ 绿得毫无意义）。④ **「声明支持」≠「真被实现」**：只做「schema 用到的 ⊆ 支持集」这一条，会放过「我声明支持但从没写实现」⇒ 还需要**触达自检**（每个违规类关键字必须被至少一个用例真正触发过）。⑤ **容器类关键字的统计口径**：`properties`/`items`/`$ref` 违规时冒出来的是**内层**关键字 ⇒ 它们不会出现在 `errors[].keyword` 里 ⇒ 若不区分，触达自检会**永远假红**（第一版就踩了） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 13 个 schema **逐字 1:1** 落地（sha256 与上游 **13/13** 一致，实测比对）⇒ 不是「按记忆重写」。② 校验器**零新依赖**：手写 draft 2020-12 子集，34 个断言性关键字 + 10 个元数据关键字，**不抛错**（返回 `{ok, errors[{path, keyword, message}]}`，path 精确到 `scenes[0].description`）。③ **`format` 真正校验**（`date`/`date-time`/`uri`/`url`/`email`）—— 上游确实用它 ⇒ 不登记就会静默放过 URL 格式。④ **三条锁并存**：触达自检（违规类关键字必须真被触发）+ 结构锁（声明支持的必须有实现痕迹）+ 未知关键字检查（schema 用到的 ⊆ 已实现 ∪ 元数据）⇒ 上游加关键字时**当场红**，而不是静默不校验。⑤ **正例即「可满足性证明」**：对 13 个 schema 各生成「最小合法实例」并断言通过 ⇒ 若某 required 字段无法构造合法值 ⇒ schema 与实现矛盾，当场红。⑥ 同步脚本 `scripts/sync-openmontage-schemas.js`：**默认离线**（比对内联 sha256 清单，可进 CI）+ `--refresh` 刷新（重写清单段 ⇒ 留痕）⇒ 上游漂移可被发现。⑦ 30 个用例全绿 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **期望值与判据同源**：sha256 清单**内联在同步脚本里**（不另存 JSON）⇒ 不会漂移成两份真源。② **「已声明支持」与「真被实现」分成两条锁**（结构锁 + 触达自检）⇒ 任一单独存在都会放过一半的假绿。③ **区分违规类 / 容器类关键字**（触达自检只管违规类，容器类由结构锁 + 负例 path 断言覆盖）⇒ 口径明确写进代码注释，不留给下一个人猜。④ **测试与实现同文件邻**（`artifact-schema-validator.test.js` 紧邻被测模块）⇒ 改实现时看得见锁。⑤ **未登记的 format 名不报错**（JSON Schema 规定 format 默认是提示）⇒ 但「新增 format 值」需要人工补 ⇒ 已登记在 PRD §15.4（改实现要同步改 PRD）。⑥ 同步脚本的漂移报错**直接提示「刷新后必须跑关键字覆盖自检」** ⇒ 把「刷新」与「补实现」绑成一步
⑦ **顺手堵住一个会反复发生的提交污染源**：`packages/remotion-composer/package.json` 的 `build` 脚本
   默认输出到 `out/`，而仓内**没有任何 ignore 规则覆盖它** ⇒ 跑一次官方构建就会把成片带进提交
   （本次我自己的渲染探测产物就被 `git add -A` 带进去了）⇒ 就近加 `packages/remotion-composer/.gitignore`
   忽略 `out/`（**就近治理，不改根 .gitignore** ⇒ 不扩大全局忽略面） |
| 行尾与 diff 对账 | ✅ | 见提交前两口径 numstat 实测（下详） |
| 接线棘轮 | ✅ | 新增 `apps/desktop/electron/services/explainer/artifact-schema-validator.test.js` 落在 vitest include 的 `electron/services/**/*.test.js` 白名单内（**无需改 vitest.config.js**）；`scripts/check-unwired-tests.js` 的判定域不含 `scripts/` 与 `apps/` 之外的路径 ⇒ 无新增欠账；同步脚本是**仓内脚本**（`node scripts/…`），不新增 npm script |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | QM-1：**未触碰 `apps/desktop/electron/` 的既有运行时代码**（只新增 `services/explainer/` 下的新文件 + schema 资产）⇒ 既有 require 图不变；且本片**零 UI 变化** ⇒ 无视觉面。⚠ 但如实说明：**新增的 `services/explainer/` 目录会进 `app.asar`**（`files` 含 `electron/**/*`）⇒ 打包面有变化 ⇒ 由 CI 的 `build` job（windows-latest + `electron-builder --win --x64`）兜底 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未见可用的外部评审通道（`codeagent-wrapper` 类工具未探测到）；**如实记为未执行，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`） |

### 新增/修改清单（供评审逐条对照）

| 文件 | 动作 | 行数影响 |
|---|---|---|
| `apps/desktop/electron/services/explainer/schemas/**` | **新增**（13 个上游逐字副本） | 13 文件 / 约 2,900 行 JSON（资产，不计代码行数） |
| `apps/desktop/electron/services/explainer/artifact-schema-validator.js` | **新增** | +440 行（< 500 行债务阈值） |
| `apps/desktop/electron/services/explainer/artifact-schema-validator.test.js` | **新增** | +365 行（30 例） |
| `scripts/sync-openmontage-schemas.js` | **新增** | +186 行 |
| `packages/remotion-composer/.gitignore` | **新增**：忽略 `out/` | +3 |
| `01-docs/PRD-video-creation.md` | 改：新增 §15（15.1~15.10） | +184 |

### 关键事实（供后续 PR 直接用，不必重新摸索）

- **13 个 schema 的 required 与关键字段**见 PRD §15.3；全部 draft 2020-12，`version` 是 `const: "1.0"`。
- **schema 里实际用到的关键字**（实测全集）：`$defs $id $ref $schema additionalProperties const default description enum exclusiveMinimum format items maximum minItems minimum oneOf pattern properties required title type`
  ⇒ 校验器的**已实现集比这更大**（34 个）⇒ 上游演进时由触达自检/结构锁**逼着补实现**，而不是静默放过。
- **上游 9 个阶段产物**：`research_brief` / `proposal_packet` / `script` / `scene_plan` / `asset_manifest` /
  `edit_decisions` / `render_report` / `final_review` / `publish_log` + `decision_log`（EP 门决策留痕）。
- ⚠ **`edit_decisions` 的 required 含 `render_runtime`** ⇒ 渲染运行时锁定是**schema 级**治理，不是口头约定。
- ⚠ **`proposal_packet.approval.status`** ∈ {approved, approved_with_changes, rejected} ⇒ 「未 approved 不得越过 proposal」可做成机械闸。
- ⚠ **`research_brief.sources[].url` 是 `format: uri`** ⇒ 「≥5 条带 URL」在 schema 层可验；
  但**桌面端没有通用 web search**（实测 adapters 全 60 个零 search 类）⇒ sources 只能标 `retrieval: 'model_knowledge'`（**非实时检索**），不得让 LLM 编 URL。

## CHANGELOG 条目

# feat(视频创作): 上游 OpenMontage 的 13 个 artifact schema 逐字落地 + 零依赖校验器，为「讲解视频」对齐补齐铺判据底座（explainer-schema-contracts）

- feat(视频创作): 把 OpenMontage「AI 讲解视频」的阶段产物契约（`research_brief` / `proposal_packet` / `script` / `scene_plan` / `asset_manifest` / `edit_decisions` / `render_report` / `final_review` / `publish_log` / `decision_log` + `checkpoint` / `pipeline_manifest` / `playbook`）**逐字 1:1** 搬进本仓，并提供**零外部依赖**的校验器（手写 JSON Schema 子集，不引 ajv）。
- feat(视频创作): 校验器的错误信息带**字段路径**（如 `concept_options[0].cost_estimate.line_items[2].tool`）与**被违反的关键字** ⇒ 阶段失败时能定位到「哪个字段的哪条约束」，而不是只说一句「产物不合法」。
- fix(视频创作): 堵住「校验器不认识新关键字 ⇒ 静默跳过 ⇒ 假绿」这条路 —— 关键字**触达自检**（schema 用到的每个违规类关键字必须被至少一个用例真正触发过）+ **结构锁**（声明支持的必须有实现痕迹）+ **未知关键字检查**三条并存；上游 schema 一旦演进，当场红而不是安静放过。
- feat(视频创作): 新增 `node scripts/sync-openmontage-schemas.js`（默认**离线**比对 sha256 清单，可进 CI；`--refresh` 从上游刷新并留痕）⇒ 上游 schema 漂移可被机械发现。
- test(视频创作): 13 个 schema 的「最小合法实例」全部校验通过 —— 这同时是**可满足性证明**（若某必填字段无法构造合法值，schema 与实现矛盾会当场红）；另含 11 类负例（缺必填 / 枚举非法 / 常量不符 / 类型不符 / 嵌套缺字段 / 多余字段 / `$ref` 免检区 / 格式不符 / 越界 / `oneOf` 多命中 / 最小实例）。
- docs(视频创作): PRD 增补 §15，写清 13 个 schema 的字段合同、校验器行为合同、关键字覆盖自检的三条锁、上游同步流程、错误信息形态（显示项与提示文字）、验收矩阵与已知限制。

## learnings

### lesson: a-validator-that-does-not-know-a-keyword-is-not-a-validator

**现场**：把上游 13 个 schema 搬进本仓后，我第一版校验器只实现了「当前 schema 用到的关键字」。
自审时意识到：**上游一旦新增关键字，本校验器会静默跳过它** ⇒ 产物「校验通过」而那个约束**根本没被检查**
⇒ 这就是「解析失败型假绿」的同族（校验器压根没在验，绿得毫无意义）。

**正解（三条锁并存，缺一条都放过一半）**：
① **触达自检**：跑完全部用例，统计 `errors[].keyword` 的**实际**集合 ⇒ 与「schema 用到的违规类关键字」求差 ⇒ 差集非空即红。
   ⚠ 关键：**统计的是「实际触发过的」**，不是「声明实现了的」⇒ 否则「实现了但从没被触发」会漏。
② **结构锁**：声明支持的每个关键字，源码里必须有实现痕迹。
③ **未知关键字检查**：schema 用到的关键字 ⊆ (已实现 ∪ 元数据) ⇒ 新关键字当场红。

**配套的一个口径坑**：容器类关键字（`properties` / `items` / `$ref` / `$defs`）违规时冒出来的是**内层**关键字
（如 `required` / `type`）⇒ 它们**不会**出现在 `errors[].keyword` 里 ⇒ 若不区分，触达自检会永远假红
（我第一版就踩了，表现为「覆盖缺口: properties, items, $ref, $defs」）。
⇒ 口径必须写进注释：违规类用触达自检，容器类用结构锁 + 负例的 path 断言。

### lesson: 抄上游的契约要抄「逐字副本 + 漂移检测」，不是抄一份「看起来一样」

**现场**：上游 OpenMontage 的 13 个 schema 是「AI 讲解视频」各阶段产物的**权威契约**。
若我按理解重写一份 JSON，**结构上像**但与上游**逐字不同** ⇒ 下一个人拿上游的产物来比对会处处对不上。

**正解**：
① **逐字副本** + **sha256 与上游一致**（实测 13/13）⇒ 落地后当场证明「没抄错」；
② 期望值**内联在同步脚本里**（不另存 JSON）⇒ 期望值与判据同源，不会漂移成两份真源；
③ 同步脚本**默认离线**（可进 CI，不依赖 GitHub 可用性）+ `--refresh` 留痕（重写清单段 ⇒ git diff 可见）；
④ 上游地址是**常量**（不接受任意 URL）⇒ 避免脚本被当成下载器。

**泛化**：凡是「上游/参考实现是权威契约」的场景（API 契约、schema、协议定义），
落地物应该是**逐字副本 + 机械漂移检测**，而不是「按理解重写 + 靠人眼比对」。

### lesson: 正例也可以是「可满足性证明」

**现场**：为 13 个 schema 写「最小合法实例」构造器（按 type/enum/const/required 递归生成）时，
第一版给 `format: 'date'` 的字段填了 `'example'` ⇒ 校验失败。

⚠ **这次失败反而证明了校验器是对的**（format 真的在生效）⇒ 我把构造器改成「按 format 生成合法值」
（`date` → `2026-01-01`、`uri` → `https://example.com`）⇒ 13 个 schema 全部通过。

**判据**：一个「按 schema 递归生成合法实例」的用例，**同时是三件事**：
① schema 可满足（若某 required 字段无法构造合法值 ⇒ schema 与实现矛盾，当场红）；
② 校验器不会误杀合法值（假红比假绿更贵）；
③ 每个 schema 至少有一个**正例**样本（否则「只测负例」的校验器可能把一切判为不合法）。
