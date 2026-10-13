---
slug: gate-backfill-3492-3494
branch: gate-backfill-3492-3494
date: 2026-10-13
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 后续 docs PR（回填链）
sync_pr: pending
---
# 两笔远程同步回填与销账（gate-backfill-3492-3494）

## 变更类型与隔离

- **docs-only**：只改流程载体——`.quality-gates.md`（就地改写两条已收口记录的「远程同步」两形态）、`scripts/gate-record-debt-ledger.json`（删两条登记项 + 自登记一条）、本记录文件、以及 pre-commit 自动入库的 `.ccg/reviews/<父SHA>.json` 判定记录。不动 `scripts/` 工具脚本自身、不动 `.github/workflows/`、不动分支保护与 `CI_IGNORED_PATHS`。
- 隔离：共享根 `D:/Data/projects/mulpub` 当时被并发会话占着脏文件，故沿用既有回填 worktree `D:/Data/projects/mp-worktrees/mp-hook-installer-test`，分支裸名 `gate-backfill-3492-3494`，以最新 `origin/main` 为底重跑工具（不做顶部追加重放——就地改写型 PR 用前插会复活已销账项）。

## 收口的两笔

| 目标 PR | merge SHA | 取证 |
| --- | --- | --- |
| #3492（回填 #3480） | `a67f6495f1176811663a22cf07d50d65c0c37b1` | `git log origin/main --grep='(#3492)$' --format=%H\|%cI` |
| #3494（tasks 5.1 入口判据） | `38bef9765fcba21efbff7ad877e574d31562b657` | `git log origin/main --grep='(#3494)$' --format=%H\|%cI` |

- 每笔都**两形态同改**：`| 远程同步 | PASS |` 表格行 + `- 保留门禁：… | 远程同步 PASS` bullet（缺任一形态会被 Gate 2c 的「同篇两形态矛盾/缺形」判红）。
- 同一次提交删除 ledger 的两条登记项（`gate-backfill-3480`、`podcast-entry-criteria-docs`），并新增本回填 PR 自己的登记项——回填与销账必须同一次发生。

## 为什么 #3492 没有记录文件

`#3492` 那一片的执行记录载体在 `.quality-gates.md`（旧载体），本仓历史上回填型 PR 常无 `openspec/records/*.md`；工具因此打了一行 `SKIP 记录文件不存在：gate-backfill-3480`，这不是遗漏。**但回填链正在将记录载体迁到 `openspec/records/`**：本片自己就按出路①写了本篇，避免依赖旧载体的登记键漂移。

## 门禁

| 远程同步 | PENDING | 本 PR（gate-backfill-3492-3494）合并后由后续 docs PR 回填 PASS + merge SHA，并在同一次提交删除 ledger 本条登记项 |

- 行尾对账：两口径 numstat 相同（11/11）。
- 品牌残留：本文件只写本仓页面名与中性称谓。
- docs-only 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 于 commit 后取证。
- QM-1 / QM-4 / TDD / QM-6：docs-only 快速通道下不适用。
