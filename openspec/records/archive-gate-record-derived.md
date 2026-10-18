---
record: archive-gate-record-derived
task: 归档 change gate-record-sync-derived-status 并把 delta 落进 openspec/specs 基线
date: 2026-10-18
---

## 本次执行记录：归档 gate-record-sync-derived-status（archive-gate-record-derived，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯规格/文档变更（只动 `openspec/` 与 `CHANGELOG.md`，零运行时代码）。做法取**新 worktree** 而非共享根就地编辑：`<仓库父目录>/mp-worktrees/mp-archive-gate-record-derived`，裸分支 `archive-gate-record-derived`，基线 = 当时 `origin/main`（`b979bd8a8`）。原因是共享根当场测到**别的会话留下的未提交改动**（13 个 `.ccg/reviews/*.json` 的 D/M + `01-docs/learnings.md` 的 M），在脏共享根上做目录级移动会撞上 R1/R2/R4 那三条禁区分界 |
| 归档动作本身 | ✅ | `openspec archive gate-record-sync-derived-status -y --json` ⇒ `specsUpdated=true, totals.added=3, modified=0`，落为 `openspec/changes/archive/2026-10-18-gate-record-sync-derived-status/`。**与片 0 的 spike 预测逐字一致**（S2 档：改 ADDED 归档 ⇒ added=3 并创建基线文件），这条一致性是片 0 必须先做 spike 的全部理由 |
| 移动必须是移动 | ✅ | CLI 做的是"删 + 写新文件"（文件系统层面），git 侧一律 staged 后按 `-M` 核：**13 个 R100**（逐字节相同的重命名）+ 1 个 M（`openspec/specs/openspec-integration/spec.md`，+21 −0，纯插入）+ 1 个 A（新主规格）。删除集与新增集同源，不存在"内容被删只剩路径" |
| 归档必须补齐 CLI 留下的占位 | ✅ | `openspec archive` 会往新主规格写 `TBD - created by archiving change <name>. Update Purpose after archive.`，而 CHANGELOG 第 3870 行记着这条账**历史上没人还**（2026-10-07 清点 151 份主规格里 43 份如此）。本次当场把 Purpose 写实；全仓现存 `created by archiving change` 字样 2 处（本 PR 已清 1 处，余 1 处属他人在飞规格，不在本 PR 认领范围） |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 对 `openspec/specs/openspec-integration/spec.md` 一致（+21 −0）。`check-doc-abs-paths` rc=0（受管文档零新增本机绝对路径；worktree 路径写成占位形态） |
| 既有失败不认领 | ✅ | `openspec validate --all --strict` 前后各 17 条失败，**失败集逐字相同**（`diff` 两个清单为空），且不含 `gate-record*` / `quality-gate-execution-record` ⇒ 17 条全是既有，非本 PR 引入。对照跑在合并后的另一份工作树上做，不靠"应该不是我改的" |
| 归档顺序的连带核验 | ✅ | 三份未归档件 `enforce-gate-record-presence` / `freeze-legacy-gate-carrier` / `hot-carrier-atomic-landing` 在本 change 归档后**仍各自 validate 通过**。片 0 的 S3 曾实测到一条 `delta Purpose ignored` warning，本轮按同一口径复核并如实记在下面第 3 条遗留 |
| 归档把 Requirement 落进主规格 ⇒ **vendored 契约镜像必须同 PR 同步** | ✅（第一跑被 CI 拦下才补） | CI 当场红：`QG Changes` 的 **Gate 2b2 `Spec mirror contract`**，红在 `scripts/quality-rhythm-spec-mirror.test.js:66` 的 test 2「镜像不得自行发明或漏掉 Requirement」，读数原文差一条 `'远程同步的收口证据由主干历史推导，squash 尾注是本仓契约'`。**根因不是判据过严**：归档把 delta 落进 `openspec/specs/openspec-integration/spec.md`（+21 行那条 Requirement），而 `.quality-rhythm/integrations/openspec/spec-contract.md` 是它的镜像副本——副本不会自己长出新块。已把该块按真源**逐行全等**追加进镜像（test 3 正是这条的锁），镜像 Requirement 数 12→13；本机**先复现同一条 `not ok 2` 再修**，修后 8/8 全绿，所以这不是"只在 CI 红"。口径：**改主规格 = 改两份**；这条比常规漂移更隐蔽的地方在于 #3879 那次**不会**红——当时主规格还没有这条 Requirement，只有归档之后才红 |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | 未触 `apps/desktop/`、`packages/`、`ops-center/`、`.github/`，无打包面、无 UI 变更 |
| QM-6 CCG 双模型外部评审 | N/A | 纯规格归档动作（把已评审、已合并的 delta 落到基线），不新增判据语义；本仓口径是文档/规格类不强制外部评审，且被归档的那份 change 自身已走过 3 轴评审（见其归档件 `tasks.md` §8/§10） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导。本篇是**新机制上线后第一篇按新形态收口的归档记录**——上一个 change 的执行记录已实测 `byDesign=1 → 合并后 0` 的自动转档 |

### 遗留（不假装已闭合）

1. **本 PR 不往旧载体插块、不往 ledger 加键**（`carrierDrift` 会拦）。`.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json` 仍是存档面，其中 ledger 里那 23 条历史欠账本 PR 原样不动。
2. **`_TEMPLATE.md` 注释里的"存量 21 篇"是活数**。本次实测同一档位已到 22（期间他人合入）。模板那句不焊死某次读数，但也不自动刷新——谁下次动模板谁顺手按当场 `measure` 值改，不要单独为此开一个 PR。
3. **Purpose 只认第一份**：片 0 的 S3 实测过，随后归档 `enforce-gate-record-presence` 时它的 delta Purpose 会被忽略（同一能力目录已有主规格）。也就是说 `quality-gate-execution-record` 这份主规格的 Purpose 现在由本 PR 说了算，`enforce-gate-record-presence` 归档时**不会**再改它——那件归档时若它的 Purpose 文本更合适，需要人工决定是替换还是合并，不由 CLI 代劳。
