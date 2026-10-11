---
record: repopath-case-docs
task: 回填仓库目录改名大小写不一致项的归档翻转说明（repo-path-case-reversal）
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA、删除本文件 sync_* 三字段与 ledger 登记项
sync_backfill_owner: 下一个会话（回填 PR）
---

## 本次执行记录：仓库目录改名大小写不一致项回填（repo-path-case-reversal，2026-10-11）【docs-only】

- 判定：node scripts/classify-docs-only.js --base=origin/main → docs-only=true（files=32：含本文件 + 对 fix-stale-repo-paths.md 的引用修订及 repopath-case-* 双 PR 的其余 30 个文档路径翻转）
- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PENDING
- 备注：2026-10-07 的 fix-stale-repo-paths 记录 item-3 将 `D:\Data\projects\Mulpub` 大小写不一致记为「已核实无害，未改」；2026-10-11 全仓路径大小写重命名（repopath-case-* 双 PR）已将该脚本引用一并列改，原「未改」结论已被执行/翻转。本记录从 fix-stale-repo-paths.md 迁出为独立载体（check-pr-exec-record.js 要求的 openspec/records/<分支名>.md），仅作归档翻转说明，并补登门禁账目；待本 PR 合并后回填 PASS + merge SHA、删除 ledger 登记项。

| 门禁 | 状态 | 证据 |
|------|------|------|
| 变更类型与隔离 | ✅ | 纯文档：仅新增本记录文件并修订 fix-stale-repo-paths.md 的引用，未进 worktree，经 PR 落地不直推 main |
| 行尾/编码对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；文件为 CRLF、无 BOM |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → PASS |
| docs-only 判定 | ✅ | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → docs-only=true |
| 远程同步 | PENDING | PR 待开（本文件即 check-pr-exec-record.js 要求的 openspec/records/<分支名>.md 载体）；合并后由回填 PR 改写 PASS + merge SHA 并删除 ledger 登记项 |
