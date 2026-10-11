---
record: gate4-desktop-exclusion
task: 修 Gate 4 的 desktop 排除断链（独立 `--` 让 nx 把 --exclude 当成任务转发参数），并补"nx 到底收到什么"的判据与超时点名能力
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个动这些文档的会话（PR 号必须回读：`gh pr list --repo Colinchiu007/Multi-Publish --head gate4-desktop-exclusion --json number,state,headRefOid`，不得凭印象；合并后按 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 取 merge SHA，把下表「远程同步」行**与下面「保留门禁」那句 bullet 一起**改写为 PASS + SHA + 时间，并同一次整段删除 frontmatter 的三个 sync_* 字段 —— 本仓有 Gate 2c 的同篇对账判据，两处不一致会当场判红）
---

## 本次执行记录：Gate 4 的 desktop 排除断链（gate4-desktop-exclusion，2026-10-11）

- 变更类型与隔离声明：**混合 PR**（`.github/workflows` + `package.json` + `scripts/` 门禁本体 + 文档）⇒ 走隔离 worktree `mp-gate4-desktop-exclusion`（分支 `gate4-desktop-exclusion`），`classify-docs-only` 判 `docs-only=false`，重型门禁不得短路。
- 规格与方案：`01-docs/PRD-GATE4-DESKTOP-EXCLUSION-2026-10-11.md`（§1 症状五 run 对照表、§2 第一性原因 + 四种形态实测表、§4 逃逸链、§5 系统性漏洞与修法、§7 不在范围登记）。
- 保留门禁：品牌残留 ✅ | 编码完整性 ✅ | 行尾两口径对账 ✅ | 文档同步 PENDING（随 CI） | 接线/fail-fast ✅ | 远程同步 PENDING（本条自己的欠账）

### QM-5 五步

1. **第一性原因**：`bb6aab5b8`（2026-08-09，桌面套件跨 runner 分片）。同一次提交给 `desktop-shards` 写了**正确**的 `"--"`（那些实参的消费者是 vitest），并把它抄进 Gate 4 —— 那里消费者是 nx，`--` 之后的内容被 nx 当成"转发给每个任务命令"的参数，选择集不受影响。存续 63 天。
2. **逃逸分析**：`.github/scripts/workflow-contract.test.js:202-203` **逐字钉住了这个错误 argv**，且与缺陷同源同次提交 ⇒ 锁从未质疑过自己钉的形态。#1897（2026-09-17）在同一步骤内 14 行之外（本 PR 落地后 30 行）写了正确的 `nx show projects --affected --exclude=...`（旗标直给 nx），两份用法并存却无人对照——我原先写它"上方 8 行"是没量过的观感描述，已由 QM-6 前端轴实读纠正。观测层：超时打印的 `Format-Table` 默认列不含 CommandLine ⇒ 13 个存活 `node.exe` 点不出归属。逐层逃逸链见 PRD §4。
3. **系统性漏洞**：① 没有任何判据测量「nx 实际收到了什么」（结构锁只匹配文本形状）；② 排除靠 workflow 转发，因此存在"转发到错误一层"这个可写错的位置；③ 超时分支无归属能力。
4. **修复 + 回归保护**：
   - `package.json`：新增 `test:all:no-desktop` / `test:affected:no-desktop`（exclude 作为 nx 旗标写进脚本），Gate 4 调用它们且不再传任何实参；`test:all` / `test:affected` 原样保留。
   - `scripts/check-gate4-selection.js`（新增，单一实现）：结构层组装最终命令行并判 exclude 落在独立 `--` 之前/之后/缺失；live 层真跑 A/B 读 **nx 自己打印的选择声明**，A 臂必须无 desktop 且 ≥11 个包、B 臂（负控）**必须有** desktop，否则判"探针失明"；缺证据、计数不一致、输出形态变更一律 fail-closed。刻意无 `--offline` 开关。
   - `scripts/check-gate4-selection.test.js`：21 例（含「合规形态必须绿」T1/T8、「两种模式都必须判」T9、「负控不成立即失明」T12、「runLine 必须是 pnpm 调用形态」T20、「A/B 只差那个旗标」T21、真实文件臂 T16/T17）。
   - `scripts/get-test-process-tree.ps1`：新增 `Format-TestProcessTreeLine` / `Write-TestProcessTreeDetail`（取不到命令行打 `<unreadable>`、空表打 `rows=0`）；`Get-TestProcessTree` 输出形状未动（它同时被 `.Count` 与 `taskkill` 消费）。Gate 4 与 desktop-shards 的超时/非零/残留分支逐个补点名。
   - `.github/scripts/workflow-contract.test.js`：把两条反向固化的断言改为钉新形态，并新增 `doesNotMatch /"run",\s*"test:(affected|all)",\s*"--"/` 反向锁 + 自检接线锁 + 点名接线锁。
5. **防止再次发生**：AGENTS.md 新增 MUST「`--` 之后的参数属于**被调用命令**，不属于调用它的那一层」；learnings 记录"锁与缺陷同源同次提交"这一形态；判据本体接进 CI 两处（Gate 2b 跑单测层、Gate 4 在 `Start-Process` 之前跑含 live A/B 的完整判据）。

### 验证（本机实跑数字）

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 新判据单测 | `node --test scripts/check-gate4-selection.test.js` | `tests 25 / pass 25 / fail 0`；**修复前** T16/T17 对真实仓文件判红（`actual:'task'`），修复后全绿 |
| 新判据 live A/B | `node scripts/check-gate4-selection.js` | rc=0，9.3s：`full A 臂：nx 自己声明 12 个包，不含 @multi-publish/desktop` / `full B 臂（负控）：… 13 个包含它` / `B 臂来源 twin:test:all：pnpm.cmd run test:all`；affected 侧确证 `No tasks were run` |
| 负控孪生前提 | 在**未改动**的 worktree 里 `pnpm run test:all` | nx 声明 `13 projects`、清单 13 条、desktop 在内（QM-6 C1 采纳的依据） |
| 进程树锁 | `pwsh` 与 `powershell` 各跑 `scripts/get-test-process-tree.test.ps1` | 两档均 `OK: 18 checks passed`（改前 8 条），rc=0 |
| workflow 结构锁 | `node --test .github/scripts/workflow-contract.test.js` | `35 pass / 0 fail` |
| 接线 / fail-fast | `check-unwired-tests.js`、`check-step-failfast.js` | 均 OK |
| 变异反证 | `node D:/Data/projects/.tools/tmp/vt-gate4/mutate_g4.cjs`（rc 为准，还原后 `Buffer.compare` 逐字节相同；驱动未入库，可原样复跑） | `red=12/12 notRed=0`：M1 workflow 退回历史形态 / M2 摘掉脚本里的 exclude / M3 把 exclude 写进脚本自身的 `--` 之后 / M4 `liveRequired` 恒 false / M5 live 臂改回裸 spawn 脚本正文 / M6 摘掉 Gate 4 自检调用 / M7 摘掉超时点名 / M8 空命令行留空 / M9 空表不打印 / **M10 废掉孪生查找（C1 复活）** / **M11 live 臂继承出站台账变量** / **M12 B 臂与 A 臂同脚本** |
| 孤儿进程 | 采集后按创建时间复查 `node.exe/esbuild.exe` | `recent-node-esbuild=0`（采集只杀自己 spawn 的树） |

### QM-6 双模型外部评审（替代通道，标准通道本机不可用）

`ccg-deep-review.js` 缺失且 CC Switch `:15721` 探针 DOWN（当场 `Test-NetConnection` 实测），两路都走
`opencode run --agent plan --auto --model opencode/<free>`。评审产物**留在仓库外**
（`D:/Data/projects/.tools/tmp/vt-gate4/qm6-artifacts/`）——前端轴指出写进 `openspec/…` 的那批 untracked
评审件会让后续 `git merge --ff-only` 变成 "untracked working tree files would be overwritten"，
与本仓已登记的那条坑同源。两路运行期间该 worktree **零写入**（变异电池在评审启动前已跑完并逐字节还原）。

- **后端轴 `opencode/nemotron-3-ultra-free`**：0 Critical / 3 Warning / 4 Info，结论 Approve。
  B1 不采纳（已被 T13 fail-closed：声明头计数与清单条数不符即判红）；**B2 采纳** → 新增 T25
  （下界 ≤ 夹具规模 = 12、夹具不得含 desktop、下界不得为 0）；B3 部分纠正（CLI 对 affected 臂也采集，
  只有 `No tasks were run` 才降级为结构层且会打证据行）；**C1 采纳** → 负控改走同入口孪生脚本
  `pnpm run test:all`（T22；孪生缺失时的退回形式由 T23 出声锁定）。
- **前端轴 `opencode/ling-3.1-flash-free`**：第一次 rc=0 但零结论（被 Plan 模式的写文件限制卡住），
  按"最多重试 2 次"收窄任务书重跑一次，全程只读，并**自己实跑**了 25 例 / 两档 shell 各 18 条 / 35 条锁 / live A/B。
  恒真断言审查 NO FINDINGS。两处命中我文档里的不实：① PRD §4「上方一行 / 相隔 8 行」——实测
  origin/main 现为 757 ↔ 787/789（30 行）、`bdabd7745` 当时 198 ↔ 212（14 行），三个文件已改并写明
  「那个数当时是按 diff 观感写的、没量过」；② 「100 秒」不在入库文档里——核对成立，但它把自检耗时 8.8s
  与 CI 里 12 个非桌面包的完成时长混为一谈，已把带时间戳的原始坐标补进 PRD §2。
  **主动给的 Info 采纳**：workflow 里 4 份逐字相同的注释是纯文案漂移面 → 收敛成一行指针；4 个调用点保留
  （YAML 无局部函数机制，强收敛要动 treeLib，属本 PR 范围外）。
- **我自己查出、两路都没提的一条假红风险**：Gate 4 带 `MP_TEST_EGRESS_LEDGER` 且末尾按「基线之外的新键
  即红」判定，而自检 A/B 会真起测试进程再杀掉 ⇒ 继承即污染被判定对象。加 `childEnv()` 摘掉两个键
  （保留 `PATH`/`NX_SKIP_NX_CACHE`，返回副本不改父对象），T24 锁住；并核实
  `check-test-egress-ledger.js` 对 `staleKeys` 只提示不判红 ⇒ 风险面只剩「新键」这一条。

### CI 现场证据（合并后由回填轮补）

本 PR 合并后，main push 的 `QG Unit Tests` 里 Gate 4 必须出现 `[gate4-selection] full A 臂：nx 自己声明 12 个包，不含 @multi-publish/desktop` 与 `B 臂（负控）… 含 @multi-publish/desktop` 两行，且该步骤耗时应从 1173–1801s 档跌到「12 个非桌面包」的量级（失败前三条红的 run 恰好 1801s = 预算到点）。

| 门禁 | 结果 |
| --- | --- |
| 远程同步 | PENDING（本条自己的欠账） |
