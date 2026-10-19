---
record: debt-baseline-resync
task: 债务熔断基线 re-sync 到主干现状（CreateView.vue 5239→5359、>1000 行文件 28→29），并开立拆分跟进项
date: 2026-10-19
---

## 本次执行记录：debt-baseline re-sync（debt-baseline-resync，2026-10-19）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与判定 | ✅ | `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ `docs-only=false files=1 (scripts/debt-baseline.json)`。判据文件所在目录属工具面，不借 docs-only 快速通道 |
| 隔离 | ✅ | `session-init.sh debt-baseline-resync` 创建隔离 worktree（`<仓库父目录>/mp-worktrees/mp-debt-baseline-resync`，本机盘符按 Gate 12c 不写进受管文档）+ 裸分支同名 |
| **这是"接受漂移"不是"清理"** | ✅ 明示 | 只把两个数改成**当场实测的主干现状**，没有删除/拆分任何长文件，也没有调判据口径：`git diff` 全文只有 `maxFileLines 5239→5359`、`filesOver1000 28→29`、`scannedAt` 三行。`maxFilePath` 仍是 `apps/desktop/src/views/CreateView.vue`（**没有换文件来绕开上涨**） |
| 归因（判据取产物，两条并列） | ✅ | ① 在一个**刚由 `session-init.sh` 从主干创建、未做任何改动**的 worktree 里跑同一条判据，现场读数与 CI 逐字相同：`MAX_FILE_LINES: 5359 > baseline 5239` / `FILES_OVER_1000: 29 > baseline 28` ⇒ 缺陷在主干，不在任何本会话分支；② `git show origin/main:apps/desktop/src/views/CreateView.vue \| wc -l` = 5358，而 `git show origin/main:scripts/debt-baseline.json` 里 `maxFileLines=5239` ⇒ **主干自己的树违反自己的基线**。增量大户：当日已合并的 `#3969`（数字人流水线接 HeyGen）、`#3946`（移除语音模型下拉）、`#3936`（声音区拆三子分区卡片化） |
| 影响面（为什么必须现在做） | ✅ | `debt-guard.yml` 的「债务熔断检查」在每个 PR 上按**该 PR 自己的树**跑 ⇒ 任何 rebase/merge 到今天主干的分支都会红。实测同时卡住本会话的 #3898、#3992、#4010（后者是它的下游锁 `scripts/lib/git-domain.test.js` ⑩「消费者套件必须整份真的跑了」把 `check-debt-budget` 的失败原样抬成红），#3996/#3986/#4011 只是还在排队。**这不是"先合了再说"的口子，而是将他人已合并的结果如实记账**——不记账，后续每个 PR 都要各自撞同一堵墙并各自"重新归因"一次 |
| 回归锁 | ✅ | `node --test scripts/check-debt-budget.test.js` ⇒ **15 pass / 0 fail**（含"基线形状不许变：`toPersisted` 键集必须逐字等于受管 JSON 键集"与"域口径必须与 `git status` 一致"两条，本次没动形状也没动域） |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（2 增 2 删 + 时间戳行）；`git ls-files --eol` 的 `i/` 字段未变 |
| QM-1 打包 / QM-4 视觉 / TDD | N/A | 未触碰 `apps/desktop/electron/`、`packages/rpa-engine/`、任何 `.vue`/样式/locale；本 PR 无代码行为变更，测试是既有判据自测 |
| QM-6 CCG 双模型外部评审 | 未执行 | pre-commit 打印 `[CCG] 未找到 CCG（run_skill.js），已跳过 CCG 门禁`；本机无可用外部评审通道 ⇒ 如实记未执行 |
| 远程同步 | 由门禁推导 | 本行不事后改写；合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导 |

- 保留门禁：docs-only=false 完整节拍 | 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件 | 远程同步 PR #（合并后由门禁推导）

## 随本次 re-sync 一起开的跟进项（不接受"记完就忘"）

1. **拆 `apps/desktop/src/views/CreateView.vue`（5359 行）**。本次**没有**顺手拆：它今天有三个并发会话在改（`#3969`/`#3946`/`#3936` 都落在这条链上），在别人的热文件上做结构搬迁会把三批的归因搅在一起，且视觉面（`create-*` 像素基线）需要重取与人工审核。**判据**：拆完必须让 `maxFileLines` 与 `filesOver1000` **同时下降**，否则等于白搬。
2. **给这个基线加一条"只可缩小"的机械约束**（下一批做）：现在 `--update` 是"重算即接受"，缺一道"调大必须与一次真实清理同 PR"的锁。本仓已有同型判据可抄：`check-doc-abs-paths.js` 的 `judgeLedgerDrift`（为容忍自己的新增而调大账本 ⇒ 当场判「账本被放宽」红）。差别在于 debt 基线**确实存在"如实记录主干现状"的正当场景**，所以正解不是禁掉调大，而是**要求调大时点名是哪条真实清理没做**——这一条留给门禁批次实现，本次只登记。
