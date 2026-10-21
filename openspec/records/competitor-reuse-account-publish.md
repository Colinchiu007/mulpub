---
record: competitor-reuse-account-publish
task: 立项：复用竞品逆向成果，对账号管理与内容发布做全方面升级优化（含 E2E 契约化改造）
date: 2026-10-21
delivered_by_pr: 4108
---

## 本次执行记录：competitor-reuse-account-publish（2026-10-21）【docs-only】

判定：`node scripts/classify-docs-only.js --base=origin/main --head=<PR head>` → **docs-only=true**（files=7，全部命中文档白名单）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯文档/流程变更，未进 worktree；在共享根就地编辑（`openspec/` 为 Write Guard 放行路径），已跑 `scripts/session-guard.ps1` 声明分支，经 PR 落地 |
| 第一性原因（QM-5 ①） | ✅ | 逆向产出 114 项，但只落地了 1 项（#4090 快手 sig3）；其余停留文档层。根因是缺一个「把成果映射到缺口」的定位机制，以及缺「成果分级使用边界」的机械约束 |
| 逃逸分析（QM-5 ②） | ✅ | 若无本 change，典型失效形态：① 把 C 级情报当 A 级实现依据；② B 级被代码级复制；③ "有 adapter"被当成"已支持"（与 #4090 修掉的根因同型）；④ E2E 失败被归因为环境而非契约不符 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 8 条 Requirement + 对应 Scenario 落入 `specs/api-publish-competitor-reuse/spec.md`；tasks.md 每项可核对 |
| 防止再次发生（QM-5 ⑤） | ✅ | 三档判据机械化为 design §2.2；「矩阵完成必须停下」写入 tasks §2.4；红线 5 条含「不改门禁让自己过」 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐文件一致（6 个新增文件，删除数 0，无删除归因问题） |
| 接线棘轮 | N/A | 本 PR 不新增 `*.test.js`（纯文档立项）；后续每个落地项各自独立 PR，届时按此判据核对 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触运行面（零代码改动） |
| QM-6 CCG 双模型外部评审 | N/A | docs-only 通道明确跳过 QM-6（与运行时无关）；CCG 判定记录见本次 pre-commit 产物 |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`） |

保留门禁：行尾对账 ✅ | 品牌残留 ✅（PASS，扫描 11202 个 tracked 文件）| 文档同步 ✅（`check-docs-sync.sh` → 仅文档/流程变更，无需额外同步）| 远程同步 由门禁推导

跳过（与运行时无关）：QM-1 打包 / QM-2 代码必检项 / QM-4 视觉 / TDD（无代码）/ QM-6 双模型评审

### 过程中修掉的一个真问题

首版 `proposal.md` 的必读材料写了 6 处 `D:\...` 绝对路径，`check-doc-abs-paths`（Gate 12c）当场红。
`openspec/changes/<非 archive>/` **不在** `ARCHIVE_DIR_PATTERNS` 豁免列表内，所以不能靠豁免绕过。

已改为仓相对路径 + `<REVERSE-REPO>` 占位符形态（脚本认可的三种形态之一），复跑 PASS。

> 这与 #4090 踩的是同一个坑（那次是执行记录里写了 `C:\hermes-home\...`）。
> 两处的共同点：**知道有这条门禁，但写文档时没当回事**。

### 另一个过程问题（记录在案）

判据④ `check-pr-exec-record.js` 首次在共享根以 `--base=origin/main`（无 `--head`）跑，报「变更集为空」rc=1。
这是**取证域错误**——共享根此时 HEAD=main， diff 天然为空。改用 PR head ref 后正常。
与 AGENTS.md「`classify-docs-only.js` 必须在 commit 之后取证」同源：**判据的 head 必须是 PR 的 head，不是当前所在分支**。

### 遗留（不假装已闭合）

- 覆盖度矩阵尚未产出（tasks §2），需执行方按 design §2.2 三档判据逐平台比对；完成后**必须停下等人指定第一个落地项**。
- E2E 契约化改造（tasks §3）未开始；需先定位当前失败链路并区分「代码错」与「环境/真机依赖」两类原因。
- 三条范围裁定（账号+发布 / 发布先行 / UI 不参考 / 敏感词库不做）为人工裁定，执行方发现冲突应停下报告。
- `check-docs-sync.sh` 的 `--base` 不接受分支名以外的形态（它无条件拼 `origin/$BASE` 再 fetch），传 SHA 会 rc=128。本次用 `--base=main` 绕过（L41 命中已存在的 `origin/main` 即跳过 fetch，L47 用 merge-base 保证精确）。这是脚本的一个小缺陷，未修。
