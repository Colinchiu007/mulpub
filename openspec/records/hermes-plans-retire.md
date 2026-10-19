---
record: hermes-plans-retire
task: 退役 .hermes/plans/ 计划存档目录——会员中心 P1 迁 openspec/changes/archive，其余三份并入 openspec/records 同名记录
date: 2026-10-18
---

## 本次执行记录：.hermes/plans/ 退役（hermes-plans-retire，2026-10-18）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|-----------|
| 变更类型与隔离 | ✅ | 隔离 worktree `<hermes-plans-retire-worktree>`，裸分支 `hermes-plans-retire`，基线 `origin/main` = `c4f140419`；`git worktree list` 实证该行存在、`git rev-parse --abbrev-ref HEAD` → `hermes-plans-retire`；worktree 内 `pre-code-edit-guard.ps1` **rc=0** 放行（共享根那次 rc=1 已按铁律改用 worktree）。共享根保持 main 且 `git status --porcelain` 空；动手前先 `git merge --ff-only origin/main` 吸收 #3928/#3930 两笔 |
| 第一性原因（QM-5 ①） | ✅ | `.hermes/` 这个目录名源自 Hermes `professional-ai-coding-workflow` 技能转换生成 AGENTS.md 时留下的上游印记（AGENTS.md 原文自述），**不是本项目的概念**；且实际写入方是 CCG Workflow 编排系统（`scripts/ccg-review-decider.js` → `scripts/ccg-gate.js` → `.ccg/reviews/`），与目录名所暗示的 Hermes 无对应关系。三者叠加构成缺陷：① 名字指错工具；② 归属记错账；③ 该目录在 `classify-docs-only.js` 白名单里被显式声明为「内容不做机器判定」（`classify-docs-only.test.js` 原 line 199），即**一条无人守门的入库通道** |
| 逃逸分析（QM-5 ②） | ✅ | 无门禁消费该目录（全仓 grep：除「把它加进各类白名单」外零个读取者）⇒ 无人能发现它冗余；命名层：`.hermes` 与用户 `~/.hermes/`（NousResearch/hermes-agent 安装目录）同名，任何检索都会先被引到无关目标 ⇒ 认知噪音长期无人纠正；内容层：四份文件三份自述「动手后补写」，与 `openspec/records/` 同名记录长期并存而无人比对，直到本次做数字级覆盖取证才暴露冗余 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 会员中心 P1 计划（124677 B / 2280 行）迁入 `openspec/changes/archive/2026-09-23-member-center-p1/proposal.md` 并补 `.openspec.yaml`，另按用户要求在 `01-docs/PLAN-MEMBER-CENTER-P1-SERVER-2026-09-23.md` 保留并列副本；② 三份 10 月文件 `git rm`（内容已被 `openspec/records/` 同名记录覆盖，见下方判据）；③ `.hermes/` 两处 `.gitkeep` 一并删除，目录整体退役；④ 八处机械耦合同步改（详见「机械耦合清单」） |
| 内容冗余的实测判据 | ✅ | 数字级覆盖取证（本次新增，非推断）：`2026-10-15-fix-newtab-home-slow` 计划 51 个数字 / 记录 93 个 → 33 个已在记录里；`2026-10-14-fix-sidebar-nav-slow` 35 / 67 → 30 个；`2026-10-14-publish-history-thumb-portrait` 32 / 62 → 25 个。未覆盖的差值经逐条核对是**方案期预估自评数**（如计划写「≤1400 KB（实测 1334）」）而记录里是**最终 CI 实测值**（「1 841 → 1 334 KB（−27%）」）⇒ 同事实、记录版本更权威，保留计划只会制造两个数不一致的歧义（与 openspec 记录 i4 那条 finding 同型） |
| 防止再次发生（QM-5 ⑤） | ✅ | AGENTS.md 目录树那一行不再指向某个工具目录，改为写明规则：动手前的方案 → `openspec/changes/<slug>/proposal.md`；动手后的执行记录 → `openspec/records/<分支名>.md`（唯一强制载体）。同时写入退役说明，使下一个会话不会再建同名目录 |
| 行尾与 diff 对账 | ✅ | 迁出的三个新文件实测：BOM=False、纯 CRLF（2295 / 2 / 2286）、**裸 LF = 0**；源文件 BOM=False / CRLF=2280 / 裸 LF=0 ⇒ 行尾保真。`scripts/doc-abs-paths-baseline.json` 改后 CRLF=572 / 裸 LF=0，与该改前读数逐值相等 |
| 接线棘轮 | ✅ | 改动未新增 `*.test.js`；改的是既有测试的白名单断言（`classify-docs-only.test.js` 三处、`ccg-review-decider.test.js` 夹具路径一处），均属门禁本体而非新增锁 |
| QM-1 打包 | **N/A** | 零运行时代码改动（无 `apps/` `packages/` 变更）；本次动的 `scripts/` 是门禁工具脚本自身，非打包触发路径，**不为凑证据跑无关打包** |
| QM-4 视觉 | **N/A** | 无渲染层改动 |
| QM-6 CCG 双模型外部评审 | ➖ 未执行（如实登记） | 本机 `codeagent-wrapper` 两路后端不可用（`~/.claude/.ccg/config.toml` 实测 backend=codex / frontend=claude，两路均无结构化结论产出，属既有已知形态，非本变更引入）。按 AGENTS.md「子代理降级」由主代理自审：上表「内容冗余判据」「机械耦合清单」「自证读数」三栏即降级后的替代承重，**不声称已评审** |
| 远程同步 | 由门禁推导 | 本行不需要事后改写：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前本文件不在基线上，判 byDesign 不红 |

### 机械耦合清单（八处，漏一处即红）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `scripts/classify-docs-only.js` | `CI_IGNORED_PATHS` 删 `'.hermes/**'` |
| 2 | `scripts/classify-docs-only.test.js` | 三处：白名单钉死清单、docs-only 用例样本、对账表 `noGate` 条目 |
| 3 | `scripts/check-doc-abs-paths.js` | `SCAN_ROOTS` 删 `'.hermes'` |
| 4 | `scripts/doc-abs-paths-baseline.json` | 删 `.hermes/plans/2026-09-23-member-center-p1-server.md: 22` 条目 |
| 5 | `scripts/guard-shared-root-writes.ps1` | `$allowedTop` 删 `'.hermes'` |
| 6 | `scripts/ccg-review-decider.test.js` | 夹具 `.hermes/plans/plan.md` → `openspec/changes/x/proposal.md` |
| 7 | `.github/workflows/{build,electron-ci,quality-gate}.yml` | 三处 `paths-ignore` 删 `- '.hermes/**'` |
| 8 | `AGENTS.md` | 写保护放行名单删 `.hermes/`；目录树那行改为规则说明 + 退役说明 |

另：`01-docs/PROJECT-003-FILE-INVENTORY.md` 第 351 行 `.hermes/` 条目标注退役（该文件是存量清单，按归档快照纪律**不删行、只标注**）。

### 自证读数（判据取产物）

- `node --test scripts/classify-docs-only.test.js` → **27 pass / 0 fail**
- 迁出产物编码：三个新文件 BOM=False、CRLF 2295 / 2 / 2286、裸 LF 0
- `scripts/doc-abs-paths-baseline.json`：`json.load` 通过，files=563（原 564，删 1）、metric=`all_abs_paths_v2` 未变、CRLF=572 裸 LF=0
- 全仓 `git grep -n '\.hermes'` → 仅剩归档快照类历史引用（openspec/records/fix-stale-repo-paths.md、.adversarial 历史评审、openspec/changes/archive 旧 change、CHANGELOG.md:9457），按「归档快照记录当时事实、改写即篡改历史」一律**未改**

### 遗留（不假装已闭合）

- **共享根 `pre-code-edit-guard.ps1` 与 docs-only 快速通道存在规则张力**：guard 只按「git-dir 是否等于 git-common-dir」判定并 BLOCK，**没有任何 docs-only 例外**（`pre-code-edit-guard.ps1` line 28 注释写死）；而 AGENTS.md docs-only 通道明说纯流程/规格/文档变更「不需要独立 worktree，可在共享主工作区就地编辑」。本次改动因含 `scripts/` 与 `.github/workflows/` 而实际属混合 PR，走 worktree 是正确解；但**单看 AGENTS.md 文字，两条规则对「能否在共享根编辑」给出了相反指令**。本次未改该脚本（扩它的判据属另一处「改谁来守门」）。
- `.agent_context/write-guard-alert.json` **没有自动清理机制**：它只会随下次违规被覆盖。本次按用户授权处理，方式是「归档原文 + 写回处置说明」而非删除（见下节）。
- 被隔离的 `window.js` / `view-bounds.js` 改动**未在本次恢复**（属侧边栏折叠议题，超出本 PR 范围），仅做字节级留证。
