---
record: fix-qm1-stderr-criterion
task: QM-1 stderr 判据从黑名单改为分层（非空即需判断）
date: 2026-10-14
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：QM-1 stderr 判据修正（fix-qm1-stderr-criterion，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=false`（files=2）**
  —— 含 `scripts/` ⇒ 按**混合 PR** 走完整质量节拍。

## 变更内容

`scripts/qm1-scheduled-publish-verify.cjs` 的 stderr 判据（L125-141）从「黑名单全不中即 PASS」
改为三层分层判据。

## 缺陷背景（本会话第 66 轮实测）

QM-1 启动判据跑出：

    stderr 里躺着 `bad option: --user-data-dir=...`（隔离实例参数被应用拒绝）
    判据却打印「未命中任何禁用模式」

**黑名单只能检出「已知」故障。** 未知故障不在名单里 ⇒ 判据答「没问题」⇒ 假绿。

## 修法

| 层 | 条件 | 判定 |
| --- | --- | --- |
| ① | 命中黑名单 | **必然 FAIL**（已知必败，保留为加速通道）|
| ② | stderr 非空但未命中 | **不判 PASS**，判 `NEEDS_REVIEW` + 打印全文 |
| ③ | stderr 为空 | 才可判 PASS |

② 不置 exitCode（脚本无法替人判断未知内容），但**绝不报 PASS** ——
原实现的假绿正是「把无法判断伪装成已通过」。

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 行尾对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol` 两口径一致 |
| 品牌残留 | PASS | `check-no-brand-residue.js` exit=0 |
| 文档同步 | N/A | 混合 PR，不走 docs-only 通道 |
| 未接线测试 | PASS | `check-unwired-tests.js` exit=0 |
| Gate 11 ESLint | PASS | `cd apps/desktop && pnpm exec eslint electron/ src/ --quiet` exit=0 |
| 远程同步 | PENDING | 本 PR 未合并，merge SHA 尚不存在 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 未接线测试 ✅ | Gate 11 ✅ | 远程同步 PENDING

## 备注

- 本脚本**不在 Gate 11 扫描范围内**（Gate 11 只扫 `electron/` 与 `src/`），
  故 Gate 11 通过不代表本脚本被 lint 过；已单独 `node --check` 验证语法。
- AGENTS.md QM-1 段（L421）是**同型黑名单判据**，文档侧待下一笔修
  （同一判据写在两处，只改一处会漂移）。
