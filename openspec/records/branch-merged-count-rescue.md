---
record: branch-merged-count-rescue
task: 修 scripts/check-branch-merged.js 的三类假阳性 LOST（重复行份数 / 落地后被具名提交删除 / 我删的文件两侧同缺席），并把判据换成「份数 + 可解释容量」
date: 2026-10-17
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 合并后的回填提交（同一会话或下一个会话）
---

## 本次执行记录：落地判据 v3——份数与可解释容量（branch-merged-count-rescue，2026-10-17）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（CI 门禁脚本本身，属混合 PR，不走 docs-only 通道）：worktree `mp-worktrees/mp-branch-merged-count-rescue` + 裸分支 `branch-merged-count-rescue`，依赖由 `session-init.sh` 就绪并过 `verify-worktree-deps`（11 项解析通过）|
| 第一性原因（QM-5 ①） | ✅ | 判据的删除侧写成「我删过的文本在主干**出现过**即违规」（`compareRemovedLines`，2026-10-16 `f7bb7d0f4` 引入的 v1/v2 同一形状）。同名行有 N 份、只删 1 份、且逐字落地时，主干剩的那一份照样命中 ⇒ LOST。另有两处同源短路：`fileAbsentOnMain` 不做任何归因；首道判据要求 `tipBlob !== null` 使「两侧同为缺席」绕过 IDENTICAL。三类的实测现场与杀伤面见 PRD §9 表（`CHANGELOG.md` 3348 个重复行键 / 单键最多 286 份；真实卡死样本分支 `backfill-2767-2768-records`）|
| 逃逸分析（QM-5 ②） | ✅ | 逃过了 unit 层 18→23 条锁、9 道变异、真实仓 A/B 三道。**为什么全漏**：既有夹具的每一行文本都**互不相同**（`line1/line2/line3`、`MY NEW LINE`…），多重集维度对它们退化成集合维度 ⇒ "份数"这一整类缺陷在测试面**结构性不可表示**；变异反证改的也是"集合级"逻辑。更糟的一条是**反向固化**：`check-branch-merged.test.js` 里原本写着 `compareRemovedLines(['k','k','k'],['k']) ⇒ ['k']`，注释「主干出现一次即算复现，**不看次数**」——把错误口径钉成了契约（AGENTS「测试断言不得反向固化错误行为」的又一落点）|
| 修复 + 回归保护（QM-5 ④） | ✅ | 判据本体换为「份数 + 可解释容量」（`reconcileCounts` / `capacityCounts` / `mergedCopiesOf`），逐键输出 `base/tip/main/capacity/landedWithMerge`；文件级缺席允许由 `--diff-filter=D` 的具名删除解释；两侧同为缺席 ⇒ IDENTICAL；二进制单列回退；`--json` 出口纳入 UTF-8 还原并补 `counts`。回归锁 23→**36 条**（T19-T27 + 3 条单元锁 + 2 条出口锁 + 结构锁），新增夹具**必须含重复行**并由 `T27` 等真实 git 形态驱动；红→绿→变异三态都留档 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① AGENTS.md「收尾链上的已知假失败」② 段就地补写"出现过即违规自己就是假阳性源"+ 热写面重复行实测数，并给"零假阳性"那句补上**测量域限定**；② PRD §9 全文（含我自己被真实仓否证的那次推断）；③ 新增**恒等式自检** `assertChainCloses`（链上求和 ≠ main−base ⇒ 退出码 2），它本轮当场抓到我两处解析错（段落头吞 `----`、合并提交无补丁），并配正/负控 + 调用点结构锁；④ CI 已有 Gate 2b4 点名本测试文件（12 条变异逐条实跑）|
| 行尾与 diff 对账 | ✅ | 四个改动文件 `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 逐档相等：`AGENTS.md 6/0`、PRD `106/0`、判据 `347/119`、测试 `339/14`；工作副本每行都带 CR（1178/1178 等），无混行尾 |
| 接线棘轮 | ✅ | 未新增测试文件（沿用 `scripts/check-branch-merged.test.js`，已在 `quality-gate.yml` Gate 2b4 点名）；`check-unwired-tests.js` 本地实跑 rc=0 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/`、`packages/rpa-engine/` 与任何渲染面，仅 CI 门禁脚本与其文档 |
| QM-6 CCG 双模型外部评审 | PENDING | 见下方「QM-6」节，跑完如实回填（含未跑成的轴与原因）|
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#NNNN)$' --format=%H|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin <branch>` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

### 判据本体的最终形状（一句话可复核）

```
缺口  tip(k) − main(k) > 0  ← 他人对 k 的净删除容量解释；若 tip>base 还须"随本次合并落地过"
超出  main(k) − tip(k) > 0  ← 他人对 k 的净新增容量解释；解释不了：我净删除 ⇒ LOST，我没写过它 ⇒ UNATTRIBUTED
```

### 一次被真实仓否证的自我错判（这一段是本片最有价值的产出）

v3 第一版把上面写成了**加法等式** `main = tip + Σ他人净增减`，并用真实仓 A/B 检验。它把 `bf520a13c` 的
`CHANGELOG.md` 与 `scripts/dep-audit-baseline.json` 从 DRIFT 判成 LOST（比 v2 更严），我当时给出的机制解释是
"两条分支交出逐字相同的一行时主干只会出现一份"，并把它写进了文件头 —— **那是没量过的推断**。
换 `git grep -na` 这条与判据无关的取法复核，现场读数是 `base=2 / tip=2 / main=0 / landedWithMerge=0`：
那两行是 **fork 时就存在的存量**（`tip == base`，不是我带来的），主干后来把行里的 BEL 控制字节改掉了。
⇒ 真机制是**血统前提被无条件套用**，把他人删除容量压成 0。修法：血统前提收窄为只对 `tip > base` 的键生效；
等式降级为**自检**（不再产出结论）。文件头与 PRD §9 里那句 dedup 解释已按实测改写。
口径入档：**"比上一版更严格"不是"更正确"的证据**；判据方向变化必须逐条用无关取法独立复核。

### 恒等式自检抓到的两处我自己写的解析错（它的位置就是这里）

| 缺陷 | 现场读数 | 修法 |
|---|---|---|
| 段落头按 `startsWith('---')` 判定 | 删除一行 `---` 在补丁里长成 `----`，被当文件头吃掉 ⇒ 删除侧净数少算 | 只在本文件段落第一个 `@@` 之前认段落头；hunk 内 `+`/`-` 一律是内容行；`\ No newline` 单列 |
| `git log -p` 对合并提交不给补丁 | `fix-toutiao-submit-chain` 区间 1050 笔含 **27** 个合并提交 ⇒ 求和少算，`---` 被演成 `short=1885` | `--first-parent --diff-merges=first-parent`；修后同键缺口 **0** |

自检在真实仓上总是闭合 ⇒ 没有现场夹具能反证它 ⇒ 已抽成独立函数并配**直接的正/负控锁** +
"classifyFile 必须调用它"的**结构锁**（否则它就是一段只会在出事时响、却没人证明过它会响的装饰代码）。

### 变异反证（12 条逐条实跑，红集互不相同；首轮 9 CAUGHT / M3·M4 锚点未命中 / M8 MISSED，补夹具与锚点后 12/12 CAUGHT）

| 变异 | 形态 | 实测红 |
|---|---|---|
| M1 | 删除侧退回"出现过即违规"（v2 形状） | 7 条：单元容量锁、T2/T11/T14/T17/T19、合并闭合锁 |
| M2 | 新增侧退回"存在即可" | 单元容量锁、T14/T17、T23 |
| M3 | 血统前提无条件适用 | 单元容量锁 |
| M4 | 摘掉血统前提（QM-6 洗白路径复活） | 单元容量锁、T18 |
| M5 | 文件级具名删除归因短路 | T21 |
| M6 | 两侧同为缺席不再算落地（v2 前置） | T26 |
| M7 | 段落头退回 `startsWith('---')` | 补丁解析锁 |
| M8 | 摘掉 `--first-parent/--diff-merges` | T27（evil merge）|
| M9 | 自检断言变 no-op | 自检负控锁 |
| M10 | `--json` 不做 latin1→UTF-8 还原 | T24 |
| M11 | `--json` 少掉 `counts` | T25 |
| M12 | 删掉 classifyFile 里的自检调用 | 结构锁 |

**M8 首轮 MISSED 的读法要记住**：原合并夹具里旁支提交本身就在区间内，两种口径都闭合 ⇒ 那条锁测不到本族缺陷。
"锁存在"与"锁能抓这一族"是两件事；补 T27（解冲时凭空加一行，只有合并提交自己的第一父差量看得见）才有牙。

### 真实仓 A/B（同一 root、同 ref、同 merge 清单；v2 = main 上的实现）

9 个样本里只有两类假阳性被修掉，其余**逐文件判定一字未变**：

| 样本 | v2 → v3 |
|---|---|
| `0ec118832`（假阳性 B）| `lost=1 rc=1` → `drift=1 lost=0 rc=0`，`_exempt/…` LOST→DRIFT(后被具名提交删除) |
| `e8a4749fc`（假阳性 A）| `lost=1 rc=1` → `drift=10 lost=0 rc=0`，`learnings.md` LOST→DRIFT |
| `bf520a13c`（含 4 个真丢失）| `drift=2 lost=4 rc=1` → **完全相同**（v3 没有借机洗白它） |
| 其余 6 个（新鲜 PR / re-sync 7-PR / 双 PR / 干净老分支）| 一字未变 |

### 遗留（不假装已闭合）

- `mergedCopiesOf` 在多 merge 场景取**跨 merge 最大份数**（与 v2 的 `absentInAny` 同型偏宽松）。本轮真实仓未出现由此造成的读数差，未单独造锁。
- 控制字节类差异现在靠"他人删除容量"解释成 DRIFT。若哪天某行被改掉而**没有任何具名提交**能解释，仍会报 LOST——那是正确行为，但会表现为"文案被工具改动引发的清理阻塞"，遇到时先按第 9 节那两条取法复核，别直接调宽判据。
- `--merge` 仍是必填，尽管 v2 起它只做归因排除；改成可选要先决定"没传时如何排除本次合并自身"。
- 本片落地后 `backfill-2767-2768-records`、`gate4-desktop-exclusion` 两条分支转为可删。**清理必须等 v3 进 main 之后用 main 上的判据跑**，不用本片 worktree 里的实现自证（自证 = 让被检查看着自己的实现打分）。
- 上一条工作（#3836）欠的两条收尾读数在本 PR 一并写进 `openspec/records/branch-merged-against-main.md` 的「遗留」：
  其 main push `39037127191` 结论是 **cancelled**（`QG Coverage` 撞自己的 `timeout-minutes: 40`，实测 main 近期该 job 39.0/39.3/39.6/39.7 分钟贴脸同一天花板），
  但 `QG Changes` 步骤级证据在：step 19 `Gate 2b4 - Branch-merged criterion` = success；回填 PR #3846 的 push 为 `NO_RUN(by design)`（`quality-gate.yml` push `paths-ignore` 含 `openspec/**`，实测该 sha 上只有 `债务熔断门禁`）。
