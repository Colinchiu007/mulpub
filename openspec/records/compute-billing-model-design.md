---
record: compute-billing-model-design
task: 算力计费模型分层设计（Design Note）——三层分离、三类采购形状、C 类窗口配额、fail-closed 未知值纪律
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后回填 PASS + merge SHA，并在同一次提交删除三个 sync_* 字段与 ledger 登记项。
sync_backfill_owner: 本 PR 作者（compute-billing-model-design 会话）
---

## 本次执行记录：算力计费模型分层设计（compute-billing-model-design，2026-10-11）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true（files=6：`01-docs/DESIGN-COMPUTE-BILLING-MODEL-2026-10-11.md`、`01-docs/PRD-OFFICIAL-COMPUTE-STOPGAP-2026-10-09.md`、`01-docs/HANDOFF-UPSTREAM-BILLING-INTAKE-2026-10-11.md`、`openspec/records/compute-billing-model-design.md`、`.quality-gates.md`、`scripts/gate-record-debt-ledger.json`）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING
- **质量节拍门禁（触发方式 D）**：变更类型＝📝 纯文档 + 🏗️ 架构设计文档（**不触运行面**）⇒ docs-only 通道；规模＝🌿 中等（3 内容文件 + 载体）；路由＝**Phase 1.1 架构设计**，产出按 Skill §10.2 **Design Note 格式**；隔离＝就地编辑 + PR 落地（不进 worktree）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档/规格变更 ⇒ 共享主工作区就地编辑（**未进 worktree**），经 PR 落地，不直推 main |
| DN §1 问题与需求 | ✅ | 上游实况按维度列表（供应商/形状/计量家族/口径/速率/条款），标注各自「已定 or UNKNOWN」；并说明若照"多套模型"直觉做会在用户侧产生 3 套余额语义、用户无法跨品类比较 |
| DN §2 方案对比（≥2 案） | ✅ | A 多套计费模型并列（Completeness 4/10）/ **B 三层分离（9/10，选此）** / C 只支持按量付费（6/10，与上游实况不符且浪费已购额度）。含各案优缺点与取舍 |
| DN §3–§4 设计主体 | ✅ | 三层表（L1 `provider_plans` / L2 `model_price_cards` / L3 `identity_entitlement_usage` 形状不变）+ **三类采购形状**（A 总额度 / B 按量 / **C 窗口配额**）+ 判别规则（新增形状的唯一理由＝**约束性质不同**，非供应商不同）⇒ **形状数量有界为 3 类** |
| DN §5–§7 | ✅ | C 类估算流程与置信度（单价是**使用强度的函数**，10% vs 90% 差 9 倍）；定价基准优先级 **B > A > C**；**未知值 fail-closed 不编造**（含 `source=ASSUMED` 妥协方案，须与实测值分开渲染） |
| DN §8–§9 影响范围与风险 | ✅ | 影响表（两张新表 + 形状不变项 + 迁移编号 006 约束 + 前端两种表单）；6 条风险与缓解（C 类误当基准 / 形状误判 / 第 4 类 / 口径未知 / 宽表 / 用户侧泄漏） |
| DN §10–§12 | ✅ | 4 个待决策点留给 `/opsx:propose`；测试策略（单元/数据校验/契约/变异反证三条）；Completeness 评分表 **9/10 ≥ 7 阈值** |
| 运营方确认留痕 | ✅ | 三项原则（用户侧单一积分模型 / C 类不入基准 / 未知值 fail-closed）由运营方 2026-10-11 明确确认，写入 DN §13 |
| PRD 同步 | ✅ | §4.2 F1：「两种计费形状」→ **三种**（A/B/**C 窗口配额**），各形状字段分别列出，新增「定价基准来源优先级」与「形状数量有界」；§4.4 新增第 7 条（三种形状 + 未知值表达方式定案），并修正第 6 条原先「两种形状」的过时表述 |
| 交接口径文档同步 | ✅ | §2.1 拆为 **2.1a 有总额度** / **2.1b 窗口配额**两个字段表（含窗口结构、每窗口限额、已过窗口数、估算等效单价 + 置信度）；新增 §8.5「运营方补充答复」四行表 |
| Step ④ 自审（发现并修正自己引入的矛盾） | ✅ | 增补第三类形状后，PRD §4.4-6 仍写「两种形状」⇒ 判为自相矛盾并就地修正为三种；另修正一处笔误（「段位：」→ 条目标题） |
| 行尾与编码对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；改动文件字节扫描无 U+FFFD |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` PASS |
| 记录欠账门禁 | ✅ | `node scripts/check-gate-record-debt.js` OK（顶部记录带行、两形态一致、无陈旧登记项） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（无代码/样式变更） |
| QM-6 CCG 双模型外部评审 | N/A（docs-only 通道豁免） | 本文档为设计提案，已获运营方对三项原则的明确确认；DN 内含方案对比、影响范围、风险与测试策略，属设计审查材料本身 |
| 远程同步 | PENDING | 本 PR 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin compute-billing-model-design` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段与 ledger 登记项 |

### 遗留（不假装已闭合）

- **DN 是提案，不是已批准的设计**：三项原则获运营方确认，但 §10 的四个决策点（单表 vs 拆表、枚举落库形式、积分换算口径、`ASSUMED` 表达方式）**均未定**，必须在写迁移前定案。
- **无代码落地**：本 PR 只产出设计；L1/L2 两张表、供给资格判据的落库、`reference_only` 状态的引入**都还没实现**。按仓库口径属 M+ 任务，须经 `/opsx:propose` 建 change 后再进隔离 worktree。
- **上游 UNKNOWN 仍未消除**：C 类每窗口限额、MiniMax 计量口径、后续供应商清单三项待运营方补充；在补齐前 C 类不得参与定价。
- **形状体系仍可能被现实推翻**：三类判别规则是从**两家供应商 + 一份样本**推出的。若后续供应商的约束无法归入三类，须按 §4.1 新增第 4 类并补写本质差异。
- **Completeness 自评分是自评**：9/10 由本会话给出，未经外部评审。
