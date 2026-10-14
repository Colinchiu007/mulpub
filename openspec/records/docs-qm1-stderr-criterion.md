---
record: docs-qm1-stderr-criterion
task: AGENTS.md QM-1 stderr 判据与脚本同源修正（黑名单 → 三层分层）
date: 2026-10-14
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：AGENTS.md QM-1 判据同源修正（docs-qm1-stderr-criterion，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见下
  —— 本 PR 只改 `AGENTS.md` ⇒ 预期 `docs-only=true`。

## 变更内容

`AGENTS.md` L421 的 QM-1 启动判据从**单条黑名单**改写为**三层分层表**。

## 为什么必须同改

同一条判据写在两处：

| 位置 | 修正 PR |
| --- | --- |
| `scripts/qm1-scheduled-publish-verify.cjs`（脚本侧） | **#3558** |
| `AGENTS.md` L421（文档侧） | **本 PR** |

**只改一处会漂移** —— 文档说黑名单、脚本说分层，下一个人照文档做就又变回黑名单。
故本 PR 在文档里显式写下「脚本侧同源实现见 …；改一处必须同改另一处」。

## 判据（三层）

| 层 | 条件 | 判定 |
| --- | --- | --- |
| ① | 命中已知红线（`Failed to load platform config` / `PluginLoader.*mkdir failed` / `ENOTDIR.*app.asar` / `Cannot find module`）或配置/插件路径指向 ASAR 内部 | **QM-1 失败** |
| ② | stderr **非空但未命中①** | **不得判通过**，判 `NEEDS_REVIEW` 并把 stderr 全文交人工判断 |
| ③ | stderr 为空 | 才可判通过 |

## 缺陷背景

2026-10-14 实测：stderr 里躺着 `bad option: --user-data-dir=...`（隔离实例参数被应用拒绝），
它不在原黑名单里，判据便打印「未命中红线」⇒ **把未知故障判成通过**。

**黑名单的宽度 = 已知故障的枚举，枚举之外一律放行。**

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 行尾对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol` 两口径一致（12/1） |
| 品牌残留 | PASS | `check-no-brand-residue.js` exit=0 |
| 文档同步 | PASS | `classify-docs-only.js` → `docs-only=true` |
| 执行记录 | PASS | 本文件即按出路①新增 |
| 远程同步 | PENDING | 本 PR 未合并，merge SHA 尚不存在 |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING

## 备注

- 与 #3558 是**同源两处**，但分成两个 PR：一个改脚本、一个改文档。
  #3558 若被回退，本 PR 的文档会立刻与脚本不一致 —— 这正是「两处必须同改」要防的。
- AGENTS.md 属共享根放行的流程文档（`.agent_context/` 同级），但按分层纪律**仍须经 PR 落地**。
