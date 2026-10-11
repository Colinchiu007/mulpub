审查一个混合 PR（改了 changelog 门禁的输出与可测性，**未改判据**）。工作区根＝当前目录（worktree，分支 changelog-gate-selfreport，head 5f5e88e50，base 3a4c70311）。

被审改动（用 `git diff 3a4c70311...HEAD` 或 `git show` 取，逐文件读原文）：
- scripts/check-changelog-growth.js（collect 的 retired 出声 + evaluateAuthorization 收 root + 祖先探测 cwd 不再写死）
- scripts/changelog-dedup-regen.js（reason 指向归档后路径）
- scripts/changelog-dedup-reconcile.js（OK 自述补 A6）
- scripts/check-changelog-growth.test.js、scripts/check-changelog-duplicate-entries.test.js（三条新锁）
- openspec/specs/changelog-ledger-integrity/spec.md（R2 祖先场景两处措辞）
- openspec/records/changelog-gate-selfreport.md

轴：**正确性与「规格/自述 vs 实现」一致性**。重点找：
1. 退休路径现在是否真的可达且只放行它该放行的（`retired` 是否可能把「形状/额度不符」也洗白）；
   root 注入的默认值会不会改变 CI 现有行为（`--base` 由 merge-base 推导，root 是仓库根）。
2. 新锁是否**恒真**或**测错对象**：M1–M5 的反证结论有无站不住的（尤其 M5 的规模下界、以及"implemented 从源码取集合"的脆弱锚点）。
3. 主规格改后有没有仍然与代码不符的句子。
4. 任何"改了判据"的迹象（本 PR 声称一字未动 ⇒ 若你发现动了，那是 Critical）。

输出：把发现写成 JSON 数组到 `.ccg/reviews/selfreport-logic.json`，每项
{severity:"Critical|Warning|Info", file, line, issue, fix}，最多 8 条，无发现写 []。stdout 可空，**文件是唯一验收物**。
