---
record: feat-delta-removed-scenario-declaration
task: 补上 openspec delta 的表达力缺口——「有意删除某条 Scenario」此前无任何声明方式，导致主规格基线零覆盖门禁把合法删除误判为丢失
date: 2026-10-24
branch: feat-delta-removed-scenario-declaration
---

## 本次执行记录：delta 删除意图的声明方式（feat-delta-removed-scenario-declaration，2026-10-24）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 规范文档 + 门禁判据（4 份 SKILL.md + 1 份主 spec + 1 份 vendored 镜像 + 1 个门禁脚本 + 1 个测试文件）。分支 `feat-delta-removed-scenario-declaration`（**裸 task 名，无斜杠**），经 PR 落地，未直推 main |
| 第一性原因（QM-5 ①） | PASS | openspec 工具侧的约定只覆盖 Requirement 级删除（`## REMOVED Requirements`），**Scenario 级删除无任何声明方式**。而 `openspec validate` / `openspec archive` 会拒绝「丢了主规格仍有的 Scenario」的 MODIFIED 块 ⇒ 表达力缺口是**真实的**，不是想象 |
| 逃逸分析（QM-5 ②） | PASS | 见下「逃逸分析：两次自我修正」 |
| 修复 + 回归保护（QM-5 ④） | PASS | 声明方式 = **标记式**：被删的 Scenario **仍列在** delta 的 `## MODIFIED Requirements` 段内，正文首行写 `**REMOVED**: <理由>`。门禁按 `Requirement::Scenario` **复合键**豁免。测试 **26 例全绿**（新增 5 条：2 单元 + 3 端到端） |
| 防止再次发生（QM-5 ⑤） | PASS | ① 复合键作用域：同名 Scenario 在不同 Requirement 下是**两回事**（有端到端负控）；② 标记只在 MODIFIED 段内生效（单元测试锁住）；③ 声明必须**自洽** —— 写在别的 Requirement 下不豁免（端到端负控）；④ 门禁红时给出的修法文案**逐字包含**声明方式（端到端断言 `REMOVED`） |
| 行尾与 diff 对账 | PASS | 两口径 numstat 相等（225 / 225） |
| 编码完整性 | PASS | 改动文件 U+FFFD 命中 **0** 处（中文经手必查） |
| 接线棘轮 | N/A | 未新增 `*.test.js` 到棘轮清单；新增测试文件已由 `check-unwired-tests.js` 覆盖（rc=0） |
| QM-1 打包 | PASS | 运行时代码变更 ⇒ 适用，证据取自 CI `build` job |
| QM-4 视觉 | N/A（已确认非跳过） | **未触碰任何 `.vue` / `.css`**；纯 Markdown 规范 + Node 脚本 |
| QM-6 CCG 双模型外部评审 | **未执行（环境不具备）** | 本仓 REST API 对当前 token 全 404（git 通 ≠ API 通），`claude` / `opencode` / `codeagent-wrapper` 三后端均不可用。如实记录 |
| 远程同步 | 由门禁推导 | 合并后由门禁按主干历史推导，不手工回填 |

## 逃逸分析：两次自我修正（QM-5 ②）

**第一次修正（上一轮做门禁时）**：我此前认定「openspec 的 delta 是增量补丁语义，delta 不自包含是合法写法」，
并据此写下**事前**判据。实测该判据误报 3 处。

**第二次修正（本次）**：读 openspec 的 **Key Principle** 一节才发现更准确的说法是：

> A MODIFIED block carries the whole requirement - body plus **every scenario that survives the change**.
> `openspec validate` and `openspec archive` both **reject one that drops a scenario the main spec still has**.

⇒ MODIFIED 块**必须**携带全部**存活**的 Scenario，且**工具会拒绝**丢场景的块。
⇒ 真缺口不是「delta 不自包含」，而是「**要删一条 Scenario 时它就不算存活了，但怎么声明『有意删除』没说**」。

**这一条直接推翻了我上一条消息提的方案**：
独立 `## REMOVED Scenarios` 段 ⇒ 被删的 Scenario 不在 MODIFIED 块里 ⇒ **`openspec validate` 当场判红** ⇒ 方案不可行。

⇒ **正确方案（本次落地）**：**标记式** —— 被删的 Scenario **仍列在** MODIFIED 块里，
正文首行写 `**REMOVED**: <理由>`。这样：
- `openspec validate` 的「丢」判据**不触发**（它还在块里）；
- 同步方（agent 按 SKILL.md 指引）读到标记 ⇒ 从主规格删掉它；
- 零覆盖门禁读到标记 ⇒ 豁免该 Scenario。
**三方（validate / 同步方 / 门禁）语义一致。**

**判据**：规范类改动的正确性取决于**上游工具的真实约定**，不是取决于直觉。
⇒ 动手前先把「工具怎么判」读清楚（本次是 `openspec-sync-specs/SKILL.md` 的 Key Principle 一节），
否则会写出一份「规范说了、工具不做」的空文 —— 那正是本仓反复出现的「注册≠注入≠生效」家族。

## 落点：同一份规则的四处同源

| 落点 | 改了什么 | 为什么是它 |
|---|---|---|
| `.opencode/skills/openspec-sync-specs/SKILL.md` | Key Principle 补「如何声明删除」 | **agent 实际照做的那份** |
| `ops-center/.agents/.claude/.cursor` 下同名 SKILL.md（3 份） | 同上 | 其它平台的同一份分发件（实测 4 份的差异**只是平台公告语一行**） |
| `openspec/specs/openspec-integration/spec.md` | 新增第 13 条 Requirement「delta 删除意图的声明方式」 | **本仓的合同**，不被工具升级覆盖 |
| `.quality-rhythm/integrations/openspec/spec-contract.md` | 镜像逐字同步 | `quality-rhythm-spec-mirror.test.js` 要求每个 Requirement 块**逐行全等** |
| `scripts/check-spec-delta-coverage.js` | 认标记并豁免 | 可执行断言（散文约定必须有消费者） |

**并在 4 份 SKILL.md 里标明了真源关系**：该标记是**本仓**对工具表达力缺口的补充约定，
真源是 `openspec-integration` spec 第 13 条；SKILL.md 是**生成的分发件**，
工具升级覆盖它时应从 spec 重新应用，而不是把文件当真源。

## 验证

- 门禁测试 **26/26 绿**（新增 5 条：2 单元 + 3 端到端）
- **真实 delta 端到端**（临时 git 仓库，真实 change delta 文件）：
  带 `**REMOVED**:` 标记 ⇒ rc=0；去掉标记 ⇒ rc=1，且错误信息**逐字给出声明方式**
- **门禁首次真实自测**：本 PR 改了主规格 ⇒ 扫描域非空 ⇒ 对账 1 份主规格，基线内容无丢失 ✅
- `quality-rhythm-spec-mirror.test.js` 8/8 绿（镜像逐行全等）
- `check-max-lines` / `check-debt-budget` / `check-gate-record-debt` / `check-unwired-tests` /
  `check-spec-purpose` / `openspec-sync-check` 全部 rc=0

## 遗留

- **openspec 工具侧本身仍无 Scenario 级删除语义**：本仓用标记补上了，但工具的 `validate` 并不理解
  `**REMOVED**:`（它只是看到 Scenario 还在块里所以放行）。若将来工具原生支持 Scenario 级删除，
  应改用工具的机制并撤掉本约定。
- **标记格式是本仓自定的**，工具升级或别的仓采用时需各自对齐；本仓的唯一真源是主 spec 第 13 条。
- 主 spec 的**镜像的 Purpose 仍是 TBD**（存量，本次未动 —— `check-spec-purpose.js` 只扫
  `openspec/specs/**`，镜像在 `.quality-rhythm/` 下不属其扫描域）。
