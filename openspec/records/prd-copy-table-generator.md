---
slug: prd-copy-table-generator
branch: prd-copy-table-generator
date: 2026-10-13
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

| 远程同步 | PASS | merge SHA 8303a3713 · 2026-10-14T02:38:08Z · 远端分支已删（ls-remote 0 行）· 同次提交删除 ledger 登记项 |

### 收口被撤销过一次（2026-10-14 二次收口，PR gate-backfill-3495-regression）

本篇 #3550 回填后，`.quality-gates.md` 顶部块与 `scripts/gate-record-debt-ledger.json` 又回到 `PENDING` + 登记键复活的形状（记录本体当时已是 PASS，merge SHA `8303a3713`）。成因不是回填没做，而是**并发会话的一次 PR 重放整取了旧载体副本**，把上游已收口的两形态与已删键一起倒带——与「叠片携带评审前旧副本 ⇒ 静默撤销上游那一刀」同源，只是这次被吞掉的是**回填本身**。

为什么全绿通过：`check-gate-record-debt.js` 只判**单源自洽**（PENDING 行 + 已登记键 = OK），不校验跨源不变式「记录=PASS ⇒ 载体不得 PENDING」。把该不变式升级为阻断属**改谁来守门**（实测全仓另有 2 篇同形状：`hot-topics-multi-source`、`hot-topics-throttle-url`，会当场判红并落到他人会话头上），故只登记影响面、由使用者定夺。

操作口径的三条结论：① 回填后要在**主干 blob** 上再断言一次两形态与键的现值，而不是只信自己那次提交；② 两条 docs-only 链不要交错推同一批顶部载体，串行比并行便宜；③ 载体行内注明「第二次收口」，不静默改写——静默改掉会让这段"被撤销"的历史在仓库里消失。

- QM-1：不适用（不改 `apps/desktop/electron/`，产物不受影响）。QM-4：不适用（无 UI 文件变更）。
- QM-6：判据脚本 + CI 步骤属 M 级单文件面；且本会话后端评审 4 次未落地（形态见 [[podcast-episode-tts-entry]] 记录），如实记为未执行，不自扮演豁免。
