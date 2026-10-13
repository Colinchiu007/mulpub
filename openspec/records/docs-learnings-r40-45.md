---
record: docs-learnings-r40-45
task: 沉淀第 40–45 轮三条教训（单测≠门禁 / 判据同值不可区分第 6–8 例 / .ccg 评审凭证冲突）
date: 2026-10-14
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：Learnings 第 40–45 轮沉淀（docs-learnings-r40-45，2026-10-14）【docs-only】

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=true`**
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING
- 备注：仅改 `01-docs/learnings.md`（+168 行）+ `.ccg/reviews/*.json`（A）。

| 门禁 | 状态 | Fresh 证据 |
| --- | --- | --- |
| 变更类型与隔离 | ✅ | 纯文档：就地编辑 + 经 PR 落地（`docs-learnings-r40-45`）|
| 行尾对账 | ✅ | `--numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（`168 0`）|
| 品牌残留 | ✅ | 全文写「参考产品」，无竞品品牌名 |
| 文档同步 | ✅ | 追加到 `learnings.md` 末尾，不破坏既有章节 |
| 远程同步 | PENDING | 本 PR 未合并 |

| 项 | 值 |
| --- | --- |
| 远程同步 | PENDING |

## 沉淀了哪三条

1. **单测全绿 ≠ 门禁全绿**（`no-useless-assignment` 照不到行为测试的盲区）
2. **同一字段在两种情形下取同一个值**（第 6–8 例，其中第 8 例是**新类型：理由错但结论对**）
3. **`.ccg/reviews/<commit-SHA>.json` 是并发会话的固定冲突点**

第 2 条的第 8 例特别值得留：`git rebase` 的 `--ours`/`--theirs` 与 `git merge` **语义相反**。
我写了「取主干版」却执行了 `--theirs`（在 rebase 下 = 自己的版本）。
**结论侥幸正确，理由是错的** —— 而这一类**没有任何信号提示**，是八类缺陷中最难自查的一种。
