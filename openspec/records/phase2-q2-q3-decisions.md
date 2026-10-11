---
record: phase2-q2-q3-decisions
task: 第二阶段开工前置 Q2/Q3 定案（加密路线 + 上游账单交接口径）并更新 PRD 前置条件与套餐字段
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后回填 PASS + merge SHA，并在同一次提交删除三个 sync_* 字段与 ledger 登记项。
sync_backfill_owner: 本 PR 作者（phase2-q2-q3-decisions 会话）
---

## 本次执行记录：Q2/Q3 定案与上游账单交接口径（phase2-q2-q3-decisions，2026-10-11）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true（files=6：`01-docs/HANDOFF-OFFICIAL-COMPUTE-2026-10-09.md`、`01-docs/PRD-OFFICIAL-COMPUTE-STOPGAP-2026-10-09.md`、`01-docs/HANDOFF-UPSTREAM-BILLING-INTAKE-2026-10-11.md`、`openspec/records/phase2-q2-q3-decisions.md`、`.quality-gates.md`、`scripts/gate-record-debt-ledger.json`）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档/规格变更（`01-docs/` + `openspec/records/` + 流程载体）⇒ 就地编辑共享主工作区（**未进 worktree**），开头先 `git merge --ff-only origin/main` 同步到 `62ef3344c`；经 PR 落地，不直推 main |
| 决策落盘（核心产出） | ✅ | 运营方 2026-10-11 答复：**Q2＝选项 2**（迁库时重加密进已有 AES-256-GCM 信封体系，复用 `cloud-accounts/envelope-crypto.js`，不引新依赖）；**Q3＝能导出**，上游为多供应商且**混合计费**（订阅套餐 + 按量付费中转站），可提供全量数据或只读接口。三问至此 Q1/Q2 定案、Q3 数据待到位（口径已定） |
| 交接口径文档 | ✅ | 新增 `01-docs/HANDOFF-UPSTREAM-BILLING-INTAKE-2026-10-11.md`：两类计费方式的字段清单、等效单价算法差异、数据落点（`provider_plans` 两种形状）、三种安全交付方式（凭证不进 git/日志/记忆）、八个常见坑（含税、汇率、结转、赠送额度、倍率与实际扣费不一致、阶梯价、速率限制）、验收与回报方式 |
| PRD 同步 | ✅ | `§4.4` 前置条件 1/2 改为已拍板/进行中并给出剩余待办，新增第 6 条「计费口径归一化」；`§4.2 F1` 补两种计费形状的分别落库字段与余额红标校验（因上游混合计费，这是表结构设计前必须定的点） |
| 行尾与编码对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；改动文件字节扫描无 U+FFFD |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` PASS |
| 记录欠账门禁 | ✅ | `node scripts/check-gate-record-debt.js` OK（顶部记录带行、两形态一致、无陈旧登记项） |
| 文档同步（doc-gate） | ✅ | 本次为既有交接文档/PRD 的事实增补 + 新增交接文档，`Doc Sync Gate` 在 CI 复核 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（无代码/样式变更） |
| QM-6 CCG 双模型外部评审 | N/A（docs-only 通道豁免） | 本文档为决策记录与需求清单，非设计裁决；无争议留存 |
| 远程同步 | PENDING | 本 PR 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin phase2-q2-q3-decisions` 返回 0 行证远端分支已删；回填后删除上方三个 `sync_*` 字段与 ledger 登记项 |

### 遗留（不假装已闭合）

- **Q3 数据本身尚未到位**：口径已定，等运营方按 §4 方式交付（导出文件或只读接口路径）。数据到手前，PRD §4 的单价与赠送量测算仍停留在「挂牌价估算」层。
- **`provider_plans` 单表 vs 拆两表未定案**：PRD §4.4-6 只提出判据与影响面，最终选择留待第二阶段 `/opsx:propose`（写迁移前必须定，否则返工）。
- **Q2 的剩余待办未开工**：迁移脚本、存量 Key 重加密、两端互操作测试（Node 解 Python 密文）均属第二阶段实现，本 PR 只落决策。
- **上游供应商名单与实际计费明细未经核验**：本 PR 依运营方口述记录「多供应商 + 混合计费」，具体家数与单价以 §5 清单到手后为准。
