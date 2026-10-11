---
record: fix-stale-repo-paths
task: 清理共享仓库根由 Multi-Publish 改名为 mulpub 后，运维文档中照抄即失败的旧绝对路径
date: 2026-10-07
---

## 本次执行记录：仓库目录改名后旧路径残留清理（fix-stale-repo-paths，2026-10-07）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | **纯文档**：就地编辑共享主工作区 `D:\Data\projects\mulpub`（未进 worktree），经 PR 落地、**未直推 main**。全程未触碰 `apps/`/`packages/`/`.github/`；`mp-worktree-health.ps1 -RequireWriteGuard` → `writeGuard.taskRegistered=true`、`running=true`、`ok=true` |
| 第一性原因（QM-5 ①） | N/A | 非 Bug 修复，是目录改名（2026-10-06，`Multi-Publish` → `mulpub`）后的**文档漂移**：文档里的绝对路径是复制粘贴产物，不随目录改名自动跟随 |
| 逃逸分析（QM-5 ②） | — | 改名当天的会话在 `v2/sessions/**` 与 `background-tasks/**` 留下了大量 `multi-publish` 命中，但**没有任何门禁把「文档里的绝对路径是否仍指向存在的目录」纳入检查**；`check-no-brand-residue.js` 只管品牌词、不管路径有效性，因此 3 处失效路径长期无人发现 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 3 处路径改指 `mulpub`；其中 `ops-manual-2026-07-14.md:289` 原行 `Multi-Publishapps\desktop` 还叠加了**缺失反斜杠**的既有 typo，一并修正。回归保护＝本文档 + `.quality-gates.md` 记录的证据链；**未新增自动化门禁**（见「防止再次发生」） |
| 防止再次发生（QM-5 ⑤） | ⚠️ 部分 | 已落地：docs-only 通道的「行尾对账」门禁在本轮**真抓到一处缺陷**（见下）。**未落地**：路径有效性仍无自动检查，属已知缺口 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` **两口径逐行一致**。删除数归因：`ledger` 的 1 处删除 = 末条登记行末尾补 `,`；`ops-manual`/`runbook` 的删除均为**同名行替换**（1:1 / 3:3），无内容净减 |
| 接线棘轮 | N/A | 未新增 `*.test.js`，不涉及 vitest include 接线 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 或 `packages/rpa-engine/`，无运行面变更；无模板/样式/组件结构变更 |
| QM-6 CCG 双模型外部评审 | ❌ **未执行（如实登记）** | 本机 `codeagent-wrapper` 通道此前实测不干净。**不以自审冒充通过**。本轮机械门禁能证明「路径已改对、行尾无污染、品牌未误伤」，**不能替代**对文档可执行性的多视角复核 |
| 远程同步 | PASS | PR #3000 squash 合并 `e577dfa08d19fcdf543d71b180733228c52a0862`（2026-10-07T01:31:17+08:00，取证 `git log origin/main --grep='(#3000)$' --format=%H\|%cI`）；`git ls-remote --heads origin fix-stale-repo-paths` 返回 0 行，证远端分支已删；本文 frontmatter 的三个 `sync_*` 字段与 ledger 登记项已在同一次提交删除 |

### 保留门禁明细（docs-only 通道）

| 门禁 | 状态 | 命令与结果 |
|------|------|-----------|
| 变更类型与隔离声明 | ✅ | 全部文件命中 `CI_IGNORED_PATHS`（`01-docs/**`、`*.md`、`openspec/**`、`scripts/gate-record-debt-ledger.json`）；`pre-code-edit-guard.ps1` 在共享根对**运行时代码路径**返回 exit=1，据此确认 `packages/` 必须另走 worktree（见「遗留」） |
| 行尾/编码对账 | ✅ | 两口径一致；涉及文件均为纯 CRLF、无 BOM |
| 品牌残留 | ✅ | `node scripts/check-no-brand-residue.js` → `PASS`（扫 6959 个 tracked 文件） |
| docs-only 判定 | ✅ | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → `docs-only=true` |
| doc-gate 文档同步 | ✅ | `bash scripts/check-docs-sync.sh --base=main --head=HEAD` → `✅ 仅文档/流程变更，无需额外同步` |
| 执行记录取证 | ✅ | `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` → OK（本文即其要求的载体，走合法出路①） |
| 欠账登记 | ✅ | `node scripts/check-gate-record-debt.js` → `OK`（登记 20 条，无陈旧项、无重复标题） |
| CHANGELOG 收口 | N/A | 纯文档路径勘误，无用户可见行为变化 |

### 门禁在本轮真抓到的缺陷（如实记录，不粉饰）

改写 `scripts/gate-record-debt-ledger.json` 时，我用 `$text.Substring(0, LastIndexOf('}')) + ... + CRLF + '}'` 拼接，**丢掉了文件末尾原有的 CRLF**。行尾对账立刻判红：两口径 numstat 为 `3/2` vs `2/1`，且 diff 尾部出现 `\ No newline at end of file`。回补末尾 CRLF 后复跑一致。

**这条正是「行尾对账」门禁存在的意义**——若只看 `git diff` 肉眼扫，末尾换行丢失极易漏过。

### 边界：为什么不把 `Multi-Publish` 全仓清干净

本次只替换**文件系统路径**。以下属**产品品牌名**，与目录改名无关，按品牌一致性保持原样：

- 文档标题「Multi-Publish 多平台发布运维手册」、仓库名 `Multi-Publish (GitHub)`
- Linux systemd 部署路径 `/opt/multi-publish/`
- npm scope `@multi-publish/*`、`Multi-Publish.exe` 产物名

以下属**归档快照**，记录的是当时事实，改写即篡改历史：`.plan/`、`.ci-forensics/`、`openspec/changes/archive/`、各类 CI 报告、`01-docs/evidence/`、`.hermes/plans/`。

### 遗留（不假装已闭合）

1. **`packages/python-backend/scripts/update_account_isolation.py` 是死代码，未在本 PR 删除。** 该文件硬编码云端 Linux 沙箱路径 `/sessions/sleepy-determined-dijkstra/mnt/projects/Multi-Publish/...`，本机不可运行；其唯一作用（给 `douyin.py` 注入 `_get_browser_data_dir`）**早已完成**——方法正式定义在 `publishers/base.py:405`，`douyin.py:567,774` 已在调用。删除它落在 `packages/**` → 触发**混合 PR**，docs-only 通道不适用，须走隔离 worktree + 完整质量节拍，另开 PR。

2. **文档绝对路径无自动校验。** 本轮根因（逃逸分析②）未被根治：改名/搬移目录后，文档里的绝对路径仍会静默失效。可行的低成本棘轮是给 `check-docs-sync.sh` 增加一条「命中文档的绝对路径必须能在本机 `Test-Path`」的抽样检查。**本 PR 不做**——改 `scripts/` 工具脚本自身属混合 PR。

3. **大小写不一致（2026-10-07 记为无害未改；2026-10-11 已执行翻转）**：2026-10-07 当时仓库脚本里写 `D:\Data\projects\Mulpub`（大写 M 小写 u），实际目录为全小写 `mulpub`；`guard-shared-root-writes.ps1:21` 走 `Resolve-Path -LiteralPath` 后做相对路径比较，`install-session-isolation-task.ps1:46` 的 `$TaskPath -eq '\Mulpub\'` 为 PowerShell 大小写不敏感字符串比较，故当时判定无害、仅作记录、**未改**。2026-10-11 全仓路径大小写重命名（repopath-case-* 双 PR）已将脚本引用一并列改为全小写 `mulpub`，与原目录一致，原「未改」结论被该次重命名执行/翻转；归档说明见 `openspec/records/repopath-case-docs.md` 记录。