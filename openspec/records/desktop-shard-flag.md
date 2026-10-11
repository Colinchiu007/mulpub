---
record: desktop-shard-flag
task: 桌面分片从来没有分过文件——删掉 -ArgumentList 里的裸 "--"，并用"真跑一次读被调用方实收"的三层锁守住
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账 → 按修复后分布重跑 node scripts/gate-budget-probe.js --check）
---

## 本次执行记录：桌面分片旗标送达 vitest（desktop-shard-flag，2026-10-11）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 🔧 配置/工具 + 🧪 测试变更，且**改的是 CI 步骤正文** ⇒ 混合 PR，必须隔离。worktree `D:/Data/projects/mp-worktrees/mp-desktop-shard-flag`、裸分支 `desktop-shard-flag`（`git worktree list` 命中 + `rev-parse --abbrev-ref HEAD` 实证）。基线取 `origin/main`，本轮 re-sync 一次：`git rebase origin/main`（落后 1 个提交 `78447a75d`，**零冲突**，因为那笔只动 `apps/**`、`openspec/**`、CHANGELOG 与 ledger，未触 workflow）⇒ 当前 tip `351701d92` 直接落在 main tip 之上 |
| 第一性原因（QM-5 ①） | PASS | `.github/workflows/quality-gate.yml` 的 `Desktop tests shard` 步骤把七个 vitest 选项写在一个**裸 `"--"`** 之后。pnpm 会把 `--` 原样交给脚本（实测被调用方 argv：`["--","--shard=1/2",…]`），而 vitest 在 `--` 处停止解析选项 ⇒ 七个旗标全部退化成位置参数。`--shard` 因此从未生效 |
| CI 活体证据（不转述，按 job 日志自取） | PASS | run `38143550282`（head `1c40cbe4`，conclusion=success）的两个作业：`114482227951` = `QG Desktop Shards (1/2)`，`114482227997` = `(2/2)`。两腿日志尾部汇总**逐字相同**：`Test Files  872 passed \| 1 skipped (873)` 与 `Tests  15555 passed \| 3 skipped (15558)` ⇒ 两个 matrix 腿各跑了全量 873 个文件，桌面套件每次 CI 被完整跑两遍。两腿耗时 30 分 58 秒 / 19 分 29 秒（13:32:33→14:03:31、13:32:35→13:52:04），差的是机器抖动不是工作量差 |
| 逃逸链（QM-5 ②） | PASS | ①单元/结构层——仓库里**没有任何测试读过这一步的 argv**；②#3315 那条反向锁只按文本匹配 `test:(affected\|all)` 命令里的 `"--"`，作用域是 **Gate 4**，shard 步骤天然不在其内（本 PR 新增一条"不重复造判据"锁，把它还在这件事也钉住，防两边都以为对方在守）；③作业结论层——两腿都 success，"分片失效"在 CI 语义里**不产生任何失败信号**；④汇总层——没有人比对两腿的 `Test Files` 总数，两个一模一样的 873 就摆在同一 run 里；⑤配置兜底层——其余六个旗标在 `apps/desktop/vitest.config.js` 里有第二份等价配置（maxWorkers/fileParallelism/testTimeout/hookTimeout/teardownTimeout/reporters），掉了看不出来，**只有 `--shard` 没有兜底**，而它恰好是"没生效也不报错"的那种。**结论：测试场景缺失 + 审查盲区（判据只覆盖了一个落点）** |
| 系统性漏洞（QM-5 ③） | PASS | 具体到文件：判据缺位在 `.github/workflows/quality-gate.yml` 的 `desktop-shards` job；同时本轮暴露第二条同族漏洞——**结构锁用原始文本起锚**，注释里的代码字样能把它劫持（见"锚点劫持"行），这类锁在 `.github/scripts/*.test.js` 与 `scripts/*.test.js` 里是通用形态 |
| 修复 + 回归保护（QM-5 ④） | PASS | ①从 `-ArgumentList` 里删掉那个裸 `"--"`；②新建单一判据 `scripts/check-desktop-shard-forwarding.js`：结构层（解析真实 argv，**注释行先抹空**）+ 行为层（临时 pnpm workspace 照 argv 真跑一次，被调用方自己打印收到什么）+ 负控（把坏形态喂进去必须真的送达 `--`）+ 第二落点（续行完整性扫描）；③锁 `scripts/check-desktop-shard-forwarding.test.js` 共 **10 条**，终态 `tests 10 / pass 10 / fail 0`（re-sync 后复跑） |
| TDD 红→绿 | PASS | 红侧**不凭记忆**：由变异 A 逐字复现——把 `              "--",` 原样塞回 `-ArgumentList` 后跑同一份锁，实测 `pass=8/10 fail=2`，且点名的正是「结构层」与「行为层」两条（说明两处判据彼此独立）。绿侧即上行的 10/10。另注：判据与锁先落在文件里、workflow 的后删 `--` 属同一笔提交，所以"先红后绿"这条序列的可复核形态就是变异 A，而不是某个已丢失的历史终端输出 |
| 变异反证（9 条，原件已入库） | PASS | `.ccg/reviews/shardflag-mutate.driver.js`（仓库内可直接重跑）+ 产物 `.ccg/reviews/shardflag-mutations.txt`：8 条 want=red 全部**点名**让预期的那条变红、1 条 want=green 照绿、FINAL 未变异 10/10，`MUTATION_BAD=0`，每条 `restored=bytes_equal`。要点：A/B/G 都是**把规则明文禁止的形态本身**写回实现，不是"摘掉守卫"；C/E 锁的是"负控自身失效"与"注入缝被当后门"；D 锁探针退化成空 argv；H/I 锁第二落点的判据本身。**电池当场抓到两处**：① 首版 C 报 `fail=0` ⇒ 说明那条负控只是恒真陈述，于是把 `check()` 的探针改成可注入并补「负控失效必须出声」一条；② 首版 G 的锚点命中 2 处被 ABORTED（`Gate 4` 也有 `$testProcess = Start-Process -FilePath "pnpm.cmd" `）⇒ 锚点扩成两行才唯一，这是"anchor 命中数下界"在起作用而不是运气 |
| 第二落点（本轮自己踩到的，附三态实测） | PASS | 我给 workflow 加"位置纪律"注释时，把注释插在 `Start-Process … pnpm.cmd \`` 这条**反引号续行之后**。用 PowerShell 自己的解析器做三态对照（原件 `.ccg/reviews/shardflag-ps3state.driver.js` + `.ccg/reviews/shardflag-ps-parse.ps1`，产物 `.ccg/reviews/shardflag-ps3state.txt`，实测 pwsh 7.6.6）：**A 基线 / B 注释插在续行后 / C 注释移到命令之前，三态 PARSE_ERRORS 全为 0**——所以"语法没报错"根本不是证据；真正的信号是 `Start-Process` 那条命令的 extent：A=334 字符且含 `-ArgumentList`、**B 塌成 34 字符且不含**（`-ArgumentList @(...)` 被静默重新分组，pnpm 会带着 0 个实参被拉起来）、C=324 且含。修复：注释整块移到命令之前，并新增文本级相邻性判据 `findContinuationSevers`（行尾反引号的下一行是注释即红；**注释行自身的行尾反引号是散文里的行内代码闭合，必须排除**，否则本仓大量写法会被误伤——已用"合规形态必须为绿"那条锁住）。全仓实测：13 个 workflow、**0 命中**，故不设例外清单 |
| 锚点劫持（同轮的第三条自纠） | PASS | 我加的那句注释里**原样写了** `-ArgumentList @(...)` 这种代码字样，惰性正则立刻从注释起锚，把 `-FilePath "pnpm.cmd"` 也当成分片旗标收进 argv ⇒ 「合规形态必须为绿」当场报 `旗标 pnpm.cmd 没送达`。这不是测试写错，是**锁开始测错的东西却不报警**。修法：`parseShardArgv` 先把注释行整行抹空再起锚，并新增一条对照锁（同一份 workflow，多插一行含同样字样的注释后解析结果必须逐字不变）。反证 = 变异 H（把抹空改成直通，两条点名红） |
| 行尾与 diff 对账 | PASS | 两口径 `git show --numstat` 与 `git show --ignore-cr-at-eol --numstat` **逐文件同数**（workflow 7/2、`.gitignore` 2/0、七个新建文件全为纯新增）。`git ls-files --eol` 现场：workflow 与 `.gitignore` 索引 LF / 工作树 CRLF（`* text=auto` 的 checkout 转换，非内容差异），新建脚本为 LF。commit 输出里那批 `LF will be replaced by CRLF` 警告按 AGENTS.md 属即时告警，已逐条确认落点是索引 blob 而非内容改写 |
| 接线棘轮 | PASS | 新锁已逐个显式点名进 `.github/workflows/quality-gate.yml` 的 **Gate 3**（`node --test … scripts/gate-budget.test.js scripts/check-desktop-shard-forwarding.test.js`）；`node scripts/check-desktop-shard-forwarding.js` 本体同 PR 接线。`node scripts/check-unwired-tests.js` ⇒ OK（检查域内测试文件 **74** 个）；`node scripts/check-step-failfast.js` ⇒ OK（含 ≥2 条测试命令的 run 步骤 6 个全部 fail-fast） |
| 其余门禁 | PASS | `check-gate-record-debt` OK（远程同步行 294 条 / 执行记录 503 篇 / 已登记欠账 9 条；本记录走新载体三字段，**未**往 ledger 加键）；`check-no-brand-residue` PASS（扫描 8041 个 tracked 文件，0 残留）；`classify-docs-only --base=origin/main --head=HEAD` ⇒ **docs-only=false（files=9）**，混合 PR 走全量门禁；`check-changelog-growth` PASS（base 397 条标题全部在 head 里，字节 2312367 → 2312367） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/**`、`packages/rpa-engine/**` 与任何前端文件；变更集只有 workflow、`.gitignore`、两个新建 `scripts/` 判据与 `.ccg/reviews/` 原件 |
| QM-6 CCG 双模型外部评审 | PENDING（本 PR 合并前必须完成） | 计划按既有判据走替代通道（`~/.claude/.ccg/config.toml` 的两个 primary 绑 CC Switch `:15721`，先 `-Port 15721 -Quiet` 判活；不可用则 `opencode run --model opencode/nemotron-3-ultra-free`（逻辑轴）/ `opencode/ling-3.1-flash-free`（可维护性轴），任务书显式写"只读 + 结论进 stdout"）。**必须与写型变异串行**（本 PR 的电池与三态原件都会写盘），故顺序固定为：电池已跑完并还原 → 才发评审。此处**不以自审冒充通过**，处置结果将在下一行补记 |
| 为什么建议人工过目（而不是自动合并） | 已按规则停在这里 | 本 PR 改的是**CI 的实际行为**：两个 matrix 腿从"各跑全量 873 个文件"变为真正各跑一半，`QG Desktop Shards` 的耗时分布随之改变，进而使 #3313 那组 `PROVENANCE.shardMaxSuccessMin`（29.77 分，来自"分片失效 + 全量两遍"的形态）在合并后**立即过期**。判据第 5 条（agent 自查争议）在这里成立的点是：合并后 main 上的 shard 侧样本口径会换一代，而 45/55 这档预算是按旧口径定的；我不希望这件事在无人过目的情况下自动落地 |

### 遗留（不假装已闭合）

- **加速幅度是预测，不是实测**。修好后每腿理论上只跑约一半文件，但两腿仍各自承担同量级的环境/安装前置——#3313 记录里那句"环境开销不是测试时长"仍然成立：真正的账在 setup/checkout/依赖解析那一截，本 PR 没动它。合并后必须用
  `node scripts/gate-budget-probe.js --check` 与两腿 `Test Files` 汇总各看一眼，确认（a）两腿总数不再相同、（b）shard 侧新分布是否仍贴着预算。
- **`PROVENANCE.shardMaxSuccessMin` 需要按新口径重采**：29.77 分是在"两腿各跑全量"的形态下测得的。本 PR **不**据此收紧预算（一次低值不构成收紧理由，长尾只会因窗口变窄而漏看），也**不**为显得闭合去改数字；等修复后样本攒够（`MIN_SAMPLE_GATE4_SUCCESS` 同族下限 20）再决定是否分档拆预算。
- **矩阵仍是 2 片**，且 `--maxWorkers=1` + `--no-file-parallelism` 让单腿内部完全串行。要不要切更多片、以及每片是否放开文件级并行，是容量调优，与本 PR 的"旗标到底送没送到"是两件事，不叠。
- **`.quality-rhythm` vendored 模板仍带旧字面量**（`quality-gate.yml.tpl`、`shard-matrix.yml.tpl` 的 `1800000`），沿 #3313 的登记：属上游技能制品，不在本 PR 动 vendored 镜像。
- 本 PR 未触 `.github/scripts/workflow-contract.test.js`。若后续有人把 shard 步骤改名，`SHARD_STEP_NOT_FOUND` 会当场抛错而不是静默放行——这是有意设计（改名要连着改判据），但也意味着**改名那一刻必须同 PR 更新本锁**，属 AGENTS.md「门禁断言随实现迁移同步」的同族。
