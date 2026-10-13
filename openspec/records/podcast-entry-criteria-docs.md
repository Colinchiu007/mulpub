---
slug: podcast-entry-criteria-docs
branch: podcast-entry-criteria-docs
date: 2026-10-13
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 后续 docs PR（回填链）
sync_pr: pending
---

# 一键发布入口判据清点（podcast-entry-criteria-docs）

## 变更类型与隔离

- **docs-only**：只改 `01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md`（新增 §15）与本仓流程载体（`.quality-gates.md`、`CHANGELOG.md`、`scripts/gate-record-debt-ledger.json`、`openspec/changes/podcast-oneclick-publish/tasks.md` 的 5.1 勾位）；不动 `scripts/` 工具脚本自身、不动 `.github/workflows/`、不动分支保护与 `CI_IGNORED_PATHS` ⇒ 非混合 PR。
- 隔离：docs-only 按 AGENTS 无需独立 worktree，但因共享根 `D:/Data/projects/mulpub` 当时被并发会话占着 26 条脏文件（不得替他处置），本片落在 `D:/Data/projects/mp-worktrees/mp-podcast-script-entries`，分支裸名 `podcast-entry-criteria-docs`。

## 内容要点（数据校验 / 流程 / 交互 / 显示项）

- 三条判据同时成立才放入口：① 当场持有可发布产物；② 能确定归属频道；③ 重复点击不产生覆盖或重复 item。
- 两张表全量清点「放」与「不放」，每条不给理由不许进表；`PublishHistory` 的不放理由写成**覆盖已上线一期**的具体后果，而不是「不合适」。
- 验收条款：新增一页必须追加一行；4.3② 落地时同 PR 改状态列与 tasks 勾位（防文档与代码状态差）。

## 门禁

| 远程同步 | PENDING | 本 PR（podcast-entry-criteria-docs）合并后由后续 docs PR 回填 PASS + merge SHA，并在同一次提交删除 ledger 本条登记项 |

- 行尾对账：见 `.quality-gates.md` 记录块。
- 品牌残留 `check-no-brand-residue.js`：本 PR 文案只写本仓页面名与中性称谓，无竞品品牌词。
- 判据本体不是代码，无 QM-1/QM-2/QM-4/TDD/QM-6 适用面（docs-only 快速通道）。
