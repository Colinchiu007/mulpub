---
slug: prd-copy-table-generator
branch: prd-copy-table-generator
date: 2026-10-13
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 后续 docs PR（回填链）
sync_pr: pending
---

# PRD 逐字表生成器与漂移门禁（prd-copy-table-generator）

## 变更类型与隔离

- **混合 PR**（动 `scripts/` 工具脚本自身 + `.github/workflows/quality-gate.yml` 新增步骤）⇒ 走完整门禁，不走 docs-only 快速通道。
- 隔离：worktree `D:/Data/projects/mp-worktrees/mp-podcast-script-entries`（D 盘），分支裸名 `prd-copy-table-generator`。

## 落地内容

- `scripts/gen-prd-copy-table.js`：PRD「提示文字逐字表」的唯一生成器。`--apply` 重写两节（RSS PRD §11.5 与一键发布 PRD §6.4.3），`--check` 漂移即 rc=1。
- 键路径统一补 `podcast.` 前缀（仓内约定：locale 文件的根**就是** podcast 命名空间，渲染层取用才带前缀）；`podcast.errors.*` 两条链都会 surface ⇒ 两份 PRD 都列，且都由同一份 locale 生成，不构成第二份真源。
- `scripts/gen-prd-copy-table.test.js` 10 条：drift 判得出、apply 幂等（第二次逐字节不变）、表外行不丢、小节边界按标题层级收口、CRLF 基线保住、zh/en 不成对抛错、空文案抛错、前缀取错拒绝生成空表、locale 形状不认识抛错、真仓两节锚点在位且收键 >50。
- 接线：`quality-gate.yml` 的 **changes job**（无条件执行）新增「Gate 2c-copy」，`shell: bash` 两条命令 fail-fast。判据输入是 `01-docs/**`（docs-only 白名单内），若放在 static-gates 就会被 `docs-only != 'true'` 门控，而纯文档 PR 恰是最容易让表旧的类型（#2718/#2745 同形教训）。

## 实测

- 真仓 `--check` 首次即报两节 DRIFT（RSS 232 行 / 一键发布 135 行）⇒ 表确实旧了，判据有牙；`--apply` 后 `--check` 两节 OK、rc=0。
- 本机：`node --test scripts/gen-prd-copy-table.test.js` 10 passed；`check-unwired-tests`（81 个测试文件全接线）、`check-step-failfast`（33 个多命令步骤）与 `workflow-contract.test.js`（37 passed）均 rc=0。
- 行尾对账：两口径 numstat 逐文件相同。

## 门禁

| 远程同步 | PENDING | 本 PR（prd-copy-table-generator）合并后由后续 docs PR 回填 PASS + merge SHA，并在同一次提交删除 ledger 本条登记项 |

- QM-1：不适用（不改 `apps/desktop/electron/`，产物不受影响）。QM-4：不适用（无 UI 文件变更）。
- QM-6：判据脚本 + CI 步骤属 M 级单文件面；且本会话后端评审 4 次未落地（形态见 [[podcast-episode-tts-entry]] 记录），如实记为未执行，不自扮演豁免。
