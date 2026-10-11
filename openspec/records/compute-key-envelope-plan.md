---
record: compute-key-envelope-plan
task: 官方 Key 信封迁移的 OpenSpec change 规划（proposal/design/specs/tasks）+ CCG 决策层对抗评审 3 轮
date: 2026-10-11
---

## 本次执行记录：官方 Key 信封迁移 OpenSpec change 规划 + CCG 对抗评审（compute-key-envelope-plan，2026-10-11）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true（**files=14**：`openspec/changes/compute-key-envelope-migration/{.openspec.yaml,proposal.md,design.md,tasks.md,review-responses.md,reviews/round1-critique.json,reviews/round2-critique.json,reviews/round3-critique.json,specs/official-key-envelope/spec.md,specs/ops-center/keypool-license/spec.md}`、`openspec/records/compute-key-envelope-plan.md`、`.ccg/reviews/d72cd2bd8bc9f789f73cc4aaccf5edcbadf03481.json`、`.quality-gates.md`、`scripts/gate-record-debt-ledger.json`）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS
- **本 PR 只交付规划工件，不含任何运行时代码**；实现须另开分支/worktree（M+ 任务）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯规格/文档变更（`openspec/changes/**` + `openspec/records/**` + 流程载体）⇒ 共享主工作区就地编辑，经 PR 落地；**未进 worktree**（运行时代码尚未动） |
| OpenSpec change 完整度 | ✅ | `openspec status --change compute-key-envelope-migration` → **4/4 artifacts complete**；`openspec validate compute-key-envelope-migration --strict` → **valid**（exit 0） |
| 基线差异审计（规格化前置） | ✅ | proposal 内含「已交付 / 待办 / 待确认」三栏：已交付项均为**已合并 PR + SHA**（#3217 `2a330fc2`、#3178、#3342 `8cb884f8`、#3347 `5fc2cecdf34b…`、#3350 `ea85b6e0`）；本 change 只承载未交付的加密迁移 |
| 事实取证 | ✅ | 逐条带 file:line：`official_keys.api_key` Fernet + `NOT NULL`（`ops-center/backend/models.py:116-136`）、唯一加密写入点（`services/key_service.py:269`）、三条需明文的 Python 读路径（`key_service.py:159,332-333`、`model_preset_service.py:1122`）、信封实现（`packages/api-publish-engine/src/cloud-accounts/envelope-crypto.js`）、**生产 KMS 与唯一选择口径**（`cloud-accounts/index.js:41-48`、`keyring-kms.js`）、迁移台账口径（`postgres-migrations.js:5-6,61-63,104-106,121-122`）+ `allowPending:false`（K4） |
| QM-6 CCG 双模型外部评审 | ⚠️ **critic-only（1 个外部模型）+ 主代理处置；不得记为"双模型评审通过"** | 通道真源 `~/.claude/.ccg/config.toml`（`[routing.backend].primary=claude`、`[routing.frontend].primary=opencode`、`review.strategy=parallel`）。`scripts/ccg-review.ps1 -Mode Plan -CheckDeps` → **体检通过**（wrapper + claude + opencode 均在位）。三轮实况：<br>**轮 1**：判定 DUAL（139 行，敏感命中 22）→ **critic=claude 跑完：8 条（3 Critical / 3 Warning / 2 Info）**，维度分 5/5/7/4/7；**proposer=opencode 失败**（输入 13499 字符 > 该后端**实测**上限 7800，实测边界 (8125, 8145]，非文档承诺；静默拒绝 ~120ms/exit 1）⇒ 无自动收敛轮<br>**轮 2**（修订后复评）：DUAL（203 行）→ **critic 6 条（3 Critical / 2 Warning / 1 Info）**，维度分 7/5/8/7/7（**feasibility 4→7**）；proposer 再次失败（19484 字符）<br>**轮 3**：见下方「轮 3」<br>**逐条处置**：3 轮全部采纳、**未采纳 0 条**，逐条落点见 `openspec/changes/compute-key-envelope-migration/review-responses.md`；批评原文固化于该 change 的 `reviews/round{1,2}-critique.json`（评审目录每轮被覆盖，故另存以保证可二次复核）。**偏差如实声明**：修订腿（proposer）因后端输入上限全程不可用，**修订与逐条回应由主代理完成、不是外部模型**；双模型并行未达成，不冒充 |
| 轮 3 | 见下方「轮 3 结果」小节 | — |
| 行尾与编码对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；改动文件字节扫描无 U+FFFD |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` PASS |
| 记录欠账门禁 | ✅ | `node scripts/check-gate-record-debt.js` OK（两形态一致、无陈旧登记项） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（无代码/样式变更） |
| 远程同步 | PASS | 已合并 #3356 = `86d57e18dd9ef24065500f2ae416588db3016b0b`，committer 2026-10-11T23:43:52+08:00。取证：`git log origin/main --grep="(#3356)" --format="%H %cI"` 唯一命中，`git ls-remote --heads origin compute-key-envelope-plan` 返回 **0 行**（远端分支已删）；本行与记录文件远程同步行、frontmatter 三 `sync_*` 字段删除、`scripts/gate-record-debt-ledger.json` 登记项删除已在**同一次提交**完成 |

### 轮 3 结果（**收敛**）

- **第 1 次尝试**：critic 腿 `spawnSync C:/Users/邱领/.claude/bin/codeagent-wrapper.exe ETIMEDOUT` ⇒ **无结论**，按纪律**不计为一次评审**（失败的不算数）。
- **第 2 次尝试（成功）**：critic 首次输出解析失败（2688 字符，引擎判为模型中断）→ **引擎自动重试一次** → 得到完整结论：**8 条（Critical 0 / Warning 5 / Info 3）**，维度分 completeness 7 / consistency 6 / clarity 7 / feasibility 6 / security 6；停止原因 **`converged`**；裁决 **`cleared`**（"无 Critical、无未解决的 High 级问题，方案可执行"）。
- **Critical 轨迹：3 → 3 → 0。**
- **8 条全部采纳、0 驳回**（含 3 条我漏掉的安全语义：KMS 选择语义未纳入对拍、迁移 CLI 默认拒绝 `local` provider、写路径 KMS 故障语义与孤儿信封）。逐条落点见 change 内 `review-responses.md`；原文固化于 `reviews/round3-critique.json`。

**三轮合计：22 条发现，全部采纳、0 驳回；其中 Critical 6 条全部落地。**

### 本 PR 交付清单

| 文件 | 作用 |
|---|---|
| `openspec/changes/compute-key-envelope-migration/proposal.md` | Why / What / 基线差异审计 / Capabilities / Impact |
| `openspec/changes/compute-key-envelope-migration/design.md` | Context / Goals / **D1-D12 决策**（含替代方案）/ R1-R12 风险 / 8 步迁移计划 + 编号台账口径 / Open Questions |
| `openspec/changes/compute-key-envelope-migration/specs/official-key-envelope/spec.md` | 新能力：信封格式与归属绑定、fail-closed、双格式过渡、迁移幂等与失败语义、巡检四判据、两侧读取与明文处置分档、跨语言等价、删列前置 |
| `openspec/changes/compute-key-envelope-migration/specs/ops-center/keypool-license/spec.md` | 既有能力 delta：官方 Key 凭据的存储格式要求 |
| `openspec/changes/compute-key-envelope-migration/tasks.md` | 10 组任务（含 Non-Goals 防扩大）；进度唯一来源 |
| `openspec/changes/compute-key-envelope-migration/review-responses.md` | 三轮逐条处置表 + 方法论教训 |
| `openspec/changes/compute-key-envelope-migration/reviews/round{1,2,3}-critique.json` | 三轮批评原文固化（评审目录每轮被覆盖，故另存以保证可二次复核） |
| `.ccg/reviews/d72cd2bd8bc9f789f73cc4aaccf5edcbadf03481.json` | CCG 判定与深度评审记录（含 proposer 失败原因原文） |

### 遗留（不假装已闭合）

- **规划不等于实现**：本 change 的 L1 表、两侧信封模块、迁移 CLI、巡检脚本、删列步骤**全部未实现**。实现属 M+ 任务，须按 tasks.md 另开隔离 worktree 推进，并重跑 QM-1 打包与 QM-6 评审（届时评审对象是 diff 而非方案）。
- **三处 UNKNOWN 仍待运营方**：环文件托管与轮转流程（OQ1）、官方 Key 面是否要求生产必须 keyring（OQ2）。OQ2 未定案前，迁移计划第 7 步**不作为必走上线步骤**（已在计划中标注，避免"计划含未决门"）。
- **CCG 修订腿全程不可用**：opencode 后端的 7800 字符实测上限使"出方案→挑刺→逐条回应→收敛"的自动循环在**较大方案上无法闭环**。本轮的"逐条回应"由主代理完成，**属降级通道**；若要把该门禁按字面补齐，需在具备可用 proposer 后端的通道重放（把 design 拆到 7800 字符以内分轮）。
- **评审只覆盖方案，不覆盖实现**：三轮批评均针对设计文本；实现期可能出现设计未预见的问题（届时以 diff 评审承接）。
- **未验证项**：`keyring-kms.js` 的环文件在真实生产形态（权限位、托管位置）未取证——OQ1 依赖部署环境事实，本会话无该环境。
