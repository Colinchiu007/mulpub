---
record: remove-dead-redemption-codes
task: 删除 desktop 端已死的兑换码孤儿模块（redemption-codes.js + 其专属测试），用同机同命令 A/B 实测证明 QG Coverage 门禁不红，且不为凑比率写测试
date: 2026-10-14
---

## 本次执行记录：删除已失效的兑换码孤儿模块（remove-dead-redemption-codes，2026-10-14）

> 分支：`chore/remove-dead-redemption-codes`（基线 `0c255d3d4`，2026-10-13 晚间创建时的 origin/main 尖端）；
> 规模：2 文件删除 + 1 记录新增 ⇒ 微小（单模块）⇒ 轻量模式
> 背景链：A1（`consolidate-redeem-codes`，PR #3457）把桌面侧删除**撤回成 0**并留到 A2；
> A2（`engine-redeem-codes-complete`，PR #3479）将其登记为已知债务第 1 条（D5 决策「仍不做」，理由：删除会拉低
> desktop 全局覆盖率门禁，「解法只能是盲写测试」）。**本 PR 用实测数据清零这笔债务，并复核其机制归因。**

### 变更类型与隔离

运时代码变更，在隔离 worktree 完成。特殊之处：共享主目录当时被**其他会话的 WIP 占用**
（24 个 tracked + 2 个 untracked，横跨 10-05~10-13 多个任务），官方入口
（`start-mp-task.ps1` / `gwm-task.sh`）按设计拒绝建 worktree。经用户拍板走**手工等价路径**：
PowerShell 原生 `D:\` 路径执行 `git worktree add -b chore/remove-dead-redemption-codes <path> origin/main`
（不用 Git Bash 的 `/d/` 路径——2026-08-26 事故根因）；未 stash / 未 checkout / 未 reset / 未碰共享根任何文件；
共享根 R1 基线快照存于 `D:\Temp\opencode\shared-root-baseline-20261013-220355.txt`（61 条 status 记录）。
创建后三重产物验证：`rev-parse --abbrev-ref HEAD` = 分支名、`rev-parse HEAD` == `origin/main`、
toplevel 指向新 worktree、工作区 clean。依赖就绪：`pnpm install --frozen-lockfile` + `ensure-electron`
（v43.7.7）+ `verify-worktree-deps`（11 项消费方解析通过）。

### 为什么它是死代码（全部一手证据，非推测）

1. **零生产调用方**。全仓 grep（`redemption-codes|generateRedeemCode|RedemptionCodes`，
   js/ts/vue/json）39 处命中**全部**为交接列明的噪音并已逐类核实：
   ops-center 自身功能（`api/redemptionCodes.js` 的 URL 字符串、router、views）、
   engine 的同名函数（`subscription-service.js` 的另一个 `generateRedeemCode`）、
   `.github/scripts/font-size-baseline.json` 的ops 路径串——加上本模块与待删测试自身，无第四类。
   另查 Markdown：命中均在 CHANGELOG 历史条目 / `.trae` 计划稿 / `01-docs/archive` /
   ops PRD 旧描述 / openspec 归档中，**无任何生产接线**。
2. **兑换路径已断**。`electron/ipc-handlers/license.js:44-49`：#3085 P0 修复后，
   `app.isPackaged !== false` 一律拒收本地激活码（「激活码已迁移至账号核销，本地激活在正式版停用」）。
   本模块签发的 `MP-RAND-RAND-SIG`（HMAC-SHA256）在正式构建里**兑不了**——
   签发得出来、兑不了，能力本身即负债（A1 记录同款论证）。
3. **兑换真源已收敛**。engine `identity_redeem_codes`（`XXXX-XXXX-XXXX`，PR #3457 + #3479），与本模块无关。
4. **无动态接线**。另查 `require(.*services[$/'])` / 目录扫描形态：services 目录无插件式遍历加载，
   不存在「静态 grep 零命中但运行期命中」的路径。

### 覆盖率实测（本任务核心，同机同命令 A/B）

命令与 CI `QG Coverage`（quality-gate.yml:1073）完全一致：
`pnpm --filter @multi-publish/desktop test:coverage -- --coverage.reporter=text-summary`。
基线为同基线 commit（`0c255d3d4`）上的**全量实测**；删除后数字由被删模块自身覆盖率的
**定向实测精确扣减**得到（零引用 ⇒ 其余文件的覆盖与它在否无关，扣减是精确而非估计）。
本机原计划的第二次全量复跑被毁（见下「测试结果 A/B」），这正是改用扣减法的原因。

| 指标 | 阈值 | main 基线（`0c255d3d4`，全量实测） | 删除后（同基线下精确扣减） | Δ | 判定 |
|---|---|---|---|---|---|
| statements | 55 | 64163/82783（77.51%） | 64112/82729（77.50%） | −0.011pp | PASS |
| branches | 40 | 53578/78018（68.67%） | 53561/77998（68.67%） | −0.004pp | PASS |
| functions | 60 | 10713/14397（74.41%） | 10707/14391（74.40%） | −0.011pp | PASS |
| lines | 55 | 56311/70399（79.99%） | 56262/70347（79.98%） | −0.011pp | PASS |

测试结果 A/B：基线全量 `16354 passed | 3 skipped | 0 failed`（3677s，`0c255d3d4`）。
删除后**未能在本机复跑全量**——本机在任务窗口内被其他会话重载拖垮（Run B 跑约 12 小时后
进程消失、日志无收尾段；单文件 setup+environment 固定开销从 ~15s 恶化到 40s+）。
这不是「删坏了」的证据，三条替代证据合起来等价：
① 被删模块**零引用**（含 rebase 前对最新 `origin/main` 的复核查）⇒ 无任何其他测试的执行路径经过它；
② 删除前该模块自己的 8 个用例定向全绿（59s，见「机制复核」的测量）；
③ 语义上最近的邻居 `electron/ipc-handlers/license.test.js`（#3085 packaged 拒收的测试锁）
本地 17/17 全绿（14s）。
全量回归由 CI 的 `QG Desktop Shards` + `QG Coverage` 在 PR 上出具——本记录不臆造本地全量数字，
也不把不可得的证据写成通过。

#### 机制复核：A1 的「拉低全局比率」归因在当前 main 上不成立

A1 记录（2026-10-13）的归因是「删除一个有专属测试、覆盖率高于均值的模块 ⇒ 移出分母 ⇒ 全局比率跌破阈值」。
**当前 main 的实测否证了这个机制**：

- **实测该模块自身覆盖率**（定向跑它自己那 8 个用例，`--coverage.include` 只锁该文件）：
  statements 94.44%（51/54）、branches 85%（17/20）、functions 100%（6/6）、lines 94.23%（49/52）
  ——**「高于均值」这个前提为真**（全局 77.51%）。但结论为假：54 个 statements 的绝对体量，
  决定影响上限约 0.04pp。
- 全局余量是 **+22.5 / +28.7 / +14.4 / +25.0 个百分点**（statements/branches/functions/lines）。
  被删模块 141 行，**即使它 100% 覆盖**，删除对 statements 全局比率的影响上限也只有
  约 0.04 个百分点——距阈值 22 个百分点，算术上不可能跌破。
- A1 当时的红更可能是**同一 job 里的测试失败**（thresholds 与测试成败都会让该 job 非零退出）：
  本机实测 `story2video-compose-engine.test.js` 的「混合输入真实合成」用例在机器负载下
  **10s 超时红过一次、复跑即绿**（三次全量运行：红/绿/绿）——它与本改动无关，
  但足以让 `QG Coverage` 转红而比率其实健康。A1 记录只做了「近四个 PR 绿 ⇒ main 绿」的排除法，
  **没有量过比率数字**，把非零退出归因到了阈值机制上。

**结论**：本次删除对全局覆盖率的影响在噪声范围内（见上表 Δ 列），门禁不红，
**不补任何测试**。按仓库规范（禁恒真断言/条件性跳过/为百分比水测试）与本任务约束，
「真实结论是这次删除不违反门禁」，不为「看起来做了点什么」硬造用例。
已按「不代其他会话改写其执行记录」纪律**不动** A1 记录；其债务登记（D5 + 已知债务 #1）的机制归因
建议由记录作者后续更正（本 PR 的实测数据即更正面证据）。

### 门禁

| 门禁 | 状态 | Fresh 证据 |
|---|---|---|
| 变更类型与隔离 | PASS | 见上；`git diff --cached <base>` 恰为 2 个 D，index 无夹带 |
| 覆盖率 QG Coverage | PASS（精确算术） | 基线 64163/82783=77.51%；删除后 64112/82729=77.50%（Δ −0.011pp）。四项指标距阈值 14~29pp，见上表 |
| desktop 全量测试 | 部分本地 + CI 出具 | 本地：被删模块 8/8 定向绿 + license.test.js 17/17 绿；全量因本机被其他会话重载拖垮无法复跑（12h 后被 Kill），诚实委托 CI |
| check-debt-budget | PASS | filesOver1000 30/32、filesOver500 97/101、fanOut 65/65、circular 0/0 |
| check-gate-record-debt | PASS | 340 行/250 记录文件/15 登记，无未登记欠账、无陈旧项 |
| check-text-encoding-integrity | PASS | 无新增 U+FFFD（存量 2 个已登记文件不变） |
| check-no-brand-residue | PASS | 8601 个 tracked 文件无品牌残留 |
| check-unwired-tests | PASS | 检查域 80 个测试文件全部已接线或登记 |
| check-dep-audit | PASS | 28 条公告全部在基线内，无新增 |
| check-docs-sync（CI doc-gate） | PASS（预期） | 代码变更（2 删除）+ `openspec/` 记录 ⇒ DOCS_CHANGED=true |
| check-pr-exec-record | PASS | `--mode=enforce` rc=0：「OK: 本 PR 携带执行记录」；变更 4 个（A=2 M=0 D=2），新增记录 1 篇满足 RECORDS_RE（文件名不带斜杠） |
| QM-1 打包 | PASS（含层②人工判定） | electron-builder --win --dir rc=0（asar 144MB / exe 228MB）。验证①asar 清单：`redemption-codes` **0 命中**（文件名 + 内容双口径，解压树复验 0），`logger.js`/`license.js` 在场；②extract 后 `require('@multi-publish/rpa-engine')` OK；③8s 启动：进程存活、stdout 启动日志正常（UA 净化/SplitterBridge/StageExecutor 注册）；stderr 唯一一行 `DEP0180 fs.Stats constructor is deprecated` ⇒ 按三层判据判 **NEEDS_REVIEW → 人工判定良性**（Node 依赖链既有弃用告警；被删模块零引用 ⇒ 运行期根本不加载，无因果关系） |
| QM-4 视觉 | N/A | 未触任何 UI 文件 |
| QM-6 CCG 双模型 | 未执行（降级 SELF-REVIEW） | 本机无 `codeagent-wrapper`（已实测不存在） |

注：交接单门禁清单里的 `scripts/check-max-lines.js` 在 origin/main 上**已不存在**
（由 `check-debt-budget.js` 的 `maxFileLines` 指标棘轮取代），按现存脚本执行。

### 边界（刻意不做）

- **不连带改文档**：CHANGELOG 历史条目、`.trae` 计划稿、`01-docs/archive`、ops PRD 中
  「格式与桌面端 `redemption-codes.js` 完全兼容」等表述均为历史/他方记述，按「历史不改写」
  与「这两个文件之外零改动」约束不动。
- 不抬任何阈值、不加 exclude/prune、不为比率写测试。

### 遗留（不假装已闭合）

- A1 记录的机制归因更正（见上「机制复核」）——属该记录作者的后续 docs PR。
- 本 PR 之后若 `origin/main` 继续大幅前进，CI 的 `QG Coverage` 数字以合并时的 main 为准；
  本 A/B 的效力范围是「同基线下删除 vs 不删」这一对。
- **观察（未处置，超范围）**：`scripts/qm1-scheduled-publish-verify.cjs`（#2985 引入）位于仓库根
  scripts/，但 `DESKTOP = path.resolve(__dirname)` 使其在 `scripts/dist-electron/...` 下找 asar——
  该脚本自引入起就跑不起来（本次实测 `Cannot find module`）。AGENTS.md 三层判据的「脚本侧同源
  实现」因此实际不存在；本次 QM-1 按 AGENTS.md 判据手工执行（探针在仓库外）。修它属其他 PR。

| 远程同步 | PASS —— PR #3565 squash 合并，merge SHA `0c1bf541e36ee3bb9736dcea2c64036bd0890615`（2026-10-14T15:01:29+08:00）；CI 20/20 全绿（含 `QG Coverage` 36m14s 与 Desktop Shards 两份全量；`release` 按 PR 设计 skipping）；远端分支已删除 |
|---|---|
