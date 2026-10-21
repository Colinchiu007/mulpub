---
record: chore-dep-audit-prune-resolved
task: 清掉依赖审计基线里已被 #4111 升级「付清」的 5 条公告登记（follow-up）
date: 2026-10-21
---

## 本次执行记录：依赖审计基线清账（chore-dep-audit-prune-resolved，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 通过 | 纯台账数据变更（`scripts/dep-audit-baseline.json` 一个文件 + 本篇记录）；走正规入口 `scripts/start-mp-task.ps1` 建的隔离 worktree（`<仓库父目录>/mp-worktrees/mp-fix-collect-rewrite-wordcount`）+ 独立分支 `chore-dep-audit-prune-resolved`（基于合并后的 `origin/main` = `b69ab93c7`）；共享主目录始终留在 main 且 clean |
| 第一性原因（QM-5 ①） | 通过 | #4111 把 `follow-redirects` 1.16.0→1.16.1、`vite` 6.4.3→6.4.4（两个 lock 域）**已升级**，于是这 5 条公告**不再命中**；而 #4117 随后把同样这 5 条登记进基线（`decision=upgrade-tracked`）⇒ 门禁的 `RESOLVED_STILL_BASELINED` 判红（「基线里的公告已不再命中 ⇒ 阻断（清账，防基线腐化）」）。两条 PR 的顺序造成了这笔交叉：升级在前、登记在后，登记把已还的债又写了一遍 |
| 逃逸分析（QM-5 ②） | 通过 | ① 这笔红**不在 #4111 的 PR 面上**：#4111 的 required check 全绿（24 项 pass），红只出现在**合并之后** main 的 push 上 ⇒ 靠「PR 绿了」看不出这笔账；② 门禁本身是 fail-closed 的（基线腐化必须阻断），所以它不会自己消；③ 容易被误判成「#4111 把依赖升级搞坏了」——实际是**#4117 的登记覆盖了 #4111 的升级**，两者都正确，只是顺序撞了；④ 盲跑 `node scripts/check-dep-audit.js --update` 会引出**另一种红**（见下） |
| 修复 + 回归保护（QM-5 ④） | 通过 | **外科式清账**：以 `origin/main` 的基线为底，**只删掉门禁点名「已不再命中」的条目**，其余条目逐字保持所有者登记的 `patched` / `targetVersion` / `decision` / `note` 不动。门禁复跑：命中 28 = 挂账 28，「无新增已知漏洞公告，基线与现实一致且结论完整」，rc=0 |
| 防止再次发生（QM-5 ⑤） | 通过 | ① **没有**用 `--update` 整份重写：实测 `--update` 会顺手把 5 条既有条目的 `patched` 从「>=1.1.x」改写成「>=5.0.x」（npm 公告的多段 vulnerable 区间被解析成另一段），而它们的 `targetVersion` 仍是 1.1.x ⇒ 立刻触发 `DECISION_CONTRADICTS_PATCHED`（「目标版本低于修复下界」）——**用一个红换另一个红**；外科式删除避开了它。② 本刀只删「已不命中」的条目，不碰任何仍命中的条目的结论字段 ⇒ 账本的其余条目不受影响。③ **清账清单不靠人记**：用门禁自己的读数驱动（跑一次判据 → 解析 `RESOLVED_STILL_BASELINED` 行 → 精确删那几条），因此新增公告导致的清单变化**自动跟上**，不需要每次人工重数一遍 |
| 行尾与 diff 对账 | 通过 | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径相等（本次只有删除，无新增行，无行尾噪声）；`scripts/dep-audit-baseline.json` 的行尾随仓库约定（`attr=text=auto`） |
| 接线棘轮 | 通过 | 本次**未新增任何测试文件**（纯台账数据变更），不触发接线棘轮；`scripts/check-unwired-tests.js` rc=0 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面：只改一个 JSON 台账，无打包配置、无 UI 变更 |
| QM-6 CCG 双模型外部评审 | N/A | 变更仅 1 个 JSON 台账文件、删除 69 行、无敏感路径命中 ⇒ pre-commit 判 `mode=single`（变更 < 200 行），不触发双家族深审。**不冒充**：#4111 那侧的完整双家族评审（opencode proposer + claude critic，三轮 13 条争议逐条裁定，2 条高危域由外部 claude 复核并公开取证）已在其执行记录与 PR #4111 评论里，不因本刀而失效 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 遗留（不假装已闭合）

- 本刀**只清已被升级付清的那 5 条**。其余 28 条仍命中的公告（含 `tar` 系多条 `patched` 跨大版本区间的）**原样保留**，其 `patched` 字段与 npm 当前公告数据可能已经不一致——本刀**刻意不去改写**：一改就会撞 `DECISION_CONTRADICTS_PATCHED`。这批「patched 跨段」条目的正确处置是**各自升级对应依赖**（或由所有者逐条复核 `patched` 语义），属独立排期，不在本刀范围。
- 本刀与 #4117 的**顺序耦合**本身还在：今后若再有「先升级、后登记」或「先登记、后升级」发生在同一批公告上，同样的交叉会复现。本刀没有改门禁逻辑去防它（改门禁属"改谁来守门"，须人工过目），只把处置路径与理由留档。

## CHANGELOG 条目

# fix(deps): 清掉依赖审计基线里已被 #4111 升级付清的 5 条公告登记（chore-dep-audit-prune-resolved）

> 标题末尾按合同写 **record 名（= 分支名）**。本条按 `changelog-record-carrier` 的新合同写在执行记录里，`CHANGELOG.md` 与 `01-docs/learnings.md` **零改动**（那两个是聚合器专属的归档写面）。

- **起因**：#4111 升级了 `follow-redirects`（1.16.0→1.16.1，两个 lock 域）与 `vite`（6.4.3→6.4.4），这 5 条公告**已不再命中**；#4117 随后把同样这 5 条登记进 `scripts/dep-audit-baseline.json`（`decision=upgrade-tracked`）⇒ main 的依赖审计按 `RESOLVED_STILL_BASELINED`（基线腐化）判红。**这笔红不在 #4111 的 PR 面上**（它的 required check 全绿），只出现在合并后的 main push 上。
- **修法**：外科式清账——以 `origin/main` 的基线为底，**只删门禁点名「已不再命中」的条目**（本次 7 条：`follow-redirects` ×4 = `GHSA-8R9P-F939-6H3C` / `GHSA-Q3JH-WRC6-JGQ8` / `GHSA-8r9p-f939-6h3c` / `GHSA-q3jh-wrc6-jgq8`，`vite` ×3 = `GHSA-698v-4r3x-3vcv` / `GHSA-587h-7wmj-h5pm` / `GHSA-r825-w8mm-5pxw`），其余条目**逐字不动**。
  其中 `vite` 的后两条是合并期间主干 #4120 新补登的（advisory 库持续增补）——**同一笔 `vite` 6.4.4 升级一并把它们也付清了**，所以它们同样属于「已不命中」。
- **冲突处置**：rebase 到含 #4120 的主干时基线文件冲突。按「两侧记录都保留」处理：取**主干**版本为底，再由**门禁自己的读数**点名要清哪几条（不靠人记清单）⇒ 主干新补的条目、以及所有仍命中的条目都完整保留，只删真正失效的那 7 条。
- **刻意不做**：不跑 `node scripts/check-dep-audit.js --update` 整份重写。实测它会把 5 条既有条目的 `patched` 从「>=1.1.x」改写成「>=5.0.x」（npm 公告的多段 vulnerable 区间被解析成另一段），而 `targetVersion` 仍是 1.1.x ⇒ 立刻触发 `DECISION_CONTRADICTS_PATCHED`——**用一个红换另一个红**。
- **门禁读数**：`node scripts/check-dep-audit.js` → 命中 28 = 挂账 28，「无新增已知漏洞公告，基线与现实一致且结论完整」，rc=0。

## learnings

### lesson: 清账清单不靠人记——用门禁自己的读数驱动（chore-dep-audit-prune-resolved）

**现场**：本刀先按「5 条」清了一轮，rebase 到含 #4120 的主干后又变成 7 条——因为 advisory 库在**持续增补**，而 #4120 补登的 2 条 `vite` 公告**恰好也被同一笔 vite 6.4.4 升级付清了**。若按人手记的清单做，第二轮就会漏掉 2 条，合并后 main 继续红。

**根因**：清账清单与「现实是否还命中」之间存在时间差。凡是**靠人枚举条目**的账本，在公告库持续变动时都会漂。

**可复用的三条**：
1. 清账清单**从门禁的输出里取**，不自己数：跑一次判据 → 解析 `RESOLVED_STILL_BASELINED` 行 → 精确删那几条。清单因此**自动跟随**现实。
2. 合并冲突落在**台账**上时，处置顺序是「取主干版本为底 → 用门禁读数点名要删的 → 精确删」，而不是「合并两侧再逐条判断」——前者保住主干所有仍有效的登记，后者要重新审一遍。
3. 仍然**不要**用 `--update` 整份重写：它的改写粒度是「全部条目」，会把仍命中条目的 `patched` 一起改掉，与 `targetVersion` 打架 ⇒ 换一个红。
