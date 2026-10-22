# Tasks: main-red-run-baseline

> 纪律：每条任务勾选前必须有**当场证据**（命令 + 输出）；「写了代码」不算证据。

## T1 · 提案与规格增量（本片先文档再代码）

- [x] T1.1 写 `proposal.md`（含实测证据表：噪声 81/102、排队 51.5 分、真实执行 44 分 28 秒）
- [x] T1.2 写 `specs/ci-main-red-gate/spec.md`（新增能力：主干基准来源 + 稳定窗重试 + 档位契约）
- [x] T1.3 写 `specs/ci/spec.md`（新增 Requirement：CI Failure Handler 必须跑 ubuntu）

## T2 · 判据本体（`scripts/lib/main-red.js`）

- [ ] T2.1 `judge()` 增加 `mainMoved` 输入：tip 在读数期间移动 ⇒ 判 `INCOMPLETE`(3)，
      reason 必须点名两个 sha + PR 侧已失败的检查名（不判新增红：基准已作废，差集不可归因）
- [ ] T2.2 位置纪律：`mainMoved` 档必须排在「新增红」判定**之前**——基准作废时差集不可归因，
      不得把不可归因的红报成「本 PR 新增红」
- [ ] T2.3 `readout()` 形状不变（既有锁与外部解析依赖它）；`mainMoved` 信息只进 `reason`

## T3 · 采集层与稳定窗（`scripts/check-main-red.js`）

- [ ] T3.1 采集层新增 `mainRowsAt(sha)`：读 `actions/runs?head_sha=<sha>`（**必须分页**，
      实测单页 20 条装不下 30+ 个 handler run），只取 `event != 'workflow_run'` 的 run
- [ ] T3.2 每个 workflow 取**最新**一次 run（`run_number` + `run_attempt` 双重最大），
      再取该 run 的 job 级终态 → 行 `{name, status, conclusion}`
- [ ] T3.3 稳定窗：取数前后各读一次 tip；不一致 ⇒ 读数作废 ⇒ 有界重试
      （`--attempts`，默认 3；`--retry-seconds`，默认 90）
- [ ] T3.4 重试耗尽 ⇒ 判 `INCOMPLETE`(3)，reason 含两个 sha
- [ ] T3.5 采集层缺 `mainRowsAt` ⇒ 判 `SELF_FAULT`(4)（**不得**静默回落到 `checksAt`）
- [ ] T3.6 `parseArgs` 对新参数做校验（attempts ≥ 1、retry-seconds ≥ 0），非法值抛错
- [ ] T3.7 PR 侧仍读 check-runs（`checksAt`），两端口径都落在 job 名这一层

## T4 · 合并入口

- [ ] T4.1 `scripts/merge-when-green.ps1` 透传 `MAIN_RED_ATTEMPTS` / `MAIN_RED_RETRY_SECONDS`
- [ ] T4.2 `scripts/merge-when-green.sh` 同上
- [ ] T4.3 两个入口**仍然只调 `scripts/check-main-red.js`**、仍然排在 REST 合并之前（既有接线锁守）

## T5 · CI Failure Handler 让出 Windows 并发

- [ ] T5.1 `.github/workflows/ci-failure-handler.yml` 的 `runs-on` 改 `ubuntu-latest`
- [ ] T5.2 核实 `classify-ci-failure.js` 无平台依赖（实测：无 win32/windows/powershell 命中）
- [ ] T5.3 契约锁：`.github/scripts/workflow-contract.test.js` 增加「handler 必须 ubuntu-latest」
- [ ] T5.4 核实该 workflow 的步骤在 ubuntu 上可用（`bash` / `gh` / `node` / `setup-python` 均就绪）

## T6 · 测试（TDD：先红后绿）

- [ ] T6.1 主干侧来自 run 集合：`workflow_run` 触发的 run 不进基准
- [ ] T6.2 同一 workflow 的多次 run 取最新一次
- [ ] T6.3 读数期间 tip 移动 ⇒ 重试 ⇒ 第二次稳定 ⇒ 判绿
- [ ] T6.4 重试耗尽 ⇒ rc=3 且 reason 含两个 sha
- [ ] T6.5 采集层缺 `mainRowsAt` ⇒ rc=4
- [ ] T6.6 `judge()` 的 `mainMoved` 档：rc=3、点名 PR 侧失败、**不**报新增红
- [ ] T6.7 结构锁：入口必须调 `c.mainRowsAt(`，且不得对主干调 `c.checksAt(`
- [ ] T6.8 反失明对控：主干侧零行 ⇒ 仍按未证实处理（不得读成「主干绿」）
- [ ] T6.9 `node --test scripts/check-main-red.test.js` 全绿
- [ ] T6.10 `node --test .github/scripts/workflow-contract.test.js` 全绿

## T7 · 质量节拍与评审

- [ ] T7.1 QM-1 打包：N/A（不触 `apps/`、`packages/`；依据写进执行记录）
- [ ] T7.2 QM-2 代码必检项：本地跑相关门禁（`node --test` 全绿 + 分类器 + 契约锁）
- [ ] T7.3 QM-4 视觉：N/A（无界面改动）
- [ ] T7.4 QM-6 双家族外部评审：claude + opencode 各自产出实质评审，CRITICAL 全部处置
- [ ] T7.5 执行记录写进 `openspec/records/main-red-run-baseline.md`
- [ ] T7.6 `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` 为 OK
- [ ] T7.7 `node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 混合 PR（不得借道 docs-only 通道）

## T9 · 决策层评审意见处置（2026-10-22 第一轮，critic=claude，7 条 / Critical 2）

> 产物：`.adversarial/ccg-plan-proposal-claude/critique-v1.md`；判定记录
> `.ccg/reviews/62431b3bdb33c9df75185f7b70b24e217e308c6a.json`。
> 第一轮 **修订环节失败**（不是评审失败）：critic 已产出 7 条实质意见，但 proposer=opencode
> 因该后端单次输入上限 7800 字节被**同步拒绝**（exit 1、无错误信息）⇒ 停在「挑完刺但没人回应」。
> 对策：把现场读数拆到 `evidence.md`（方案正文 6865 字节 < 7800）后重跑。

| # | 严重度 | 意见 | 处置 |
|---|--------|------|------|
| i1 | Critical | 「四档退出码（0/1/2/3/4）」自相矛盾（0–4 是五档） | **已改**：统一表述为「五档（0/1/2/3/4）」，并写明 AGENTS 口语的「四档」指**不可合**的 1/2/3/4；落到 `proposal.md` / `specs/ci-main-red-gate/spec.md` / `scripts/check-main-red.js` 头注释 |
| i2 | Critical | 「两端口径完全一致」与「主干换 API、PR 不换」矛盾 | **已改**：改述为「两侧的**行粒度**一致（都落在作业名这一层），**取数端点不同**（主干 `actions/runs`、PR `check-runs`）」；落到 proposal / spec / 代码注释 |
| i3 | Warning | C4 只释放并发额度，不减少噪声行数，作用被混为一体 | **已改**：proposal 新增「C1 与 C4 不混为一体」小节，写明迁移后 handler **仍挂在主干 tip 上**（那是 C1 在读数侧隔离的） |
| i4 | Warning | 稳定窗「重试时追新 tip 还是钉旧 sha」未定义 | **已改**：写明「每次尝试都重新 fetch 取当前 tip，下一次从新的当前 tip 开始；不得钉在旧 sha 上继续判绿」；落到 proposal / spec |
| i5 | Warning | Impact 列了 doc 文件却没说内容与行为锁的关系 | **已改**：Impact 段补「文档只声明判据、不装判据；可执行证据在 `scripts/check-main-red.test.js` 与 `.github/scripts/workflow-contract.test.js`」 |
| i6 | Info | `mainRowsAt` 未提分页 | **已改**：proposal 与 spec 均写明 `--paginate` + `per_page=100`（实测单页装不下 30+ run 的 tip） |
| i7 | Info | 契约锁只在测试层生效 | **已改**：写明 `.github/scripts/workflow-contract.test.js` 由 `quality-gate.yml` 的 **Gate 2b** 接入 CI（PR 与 main push 都跑），并加进 `specs/ci/spec.md` 的 Scenario |

## T10 · 验证层深度评审处置（2026-10-22 第一轮，critic=claude，7 条 / Critical 3）

> 产物：`.adversarial/ccg-deep-25739c94/`（gitignored，不入库）；**可入库留档**：
> `openspec/changes/main-red-run-baseline/ccg-review-record.md`。
> 判定记录：`.ccg/reviews/b198c599d23619f2f81224d36fd84ac7bf12f7755a413f9983ed7d2355bb0c95.json`
> （`deepReview.status` 已由 `self_play_pending` 收口为 `needs_revision`，`tier=external`，
> `evidence` 指向可入库留档，`closureNote` 含轮次与逐条处置）。

| # | 严重度 | 裁决 | 处置 |
|---|--------|------|------|
| i1 | Critical | **upheld（已修）** | `mainMoved` 档新增 `prFailNames`（PR 侧已证实的失败名，机器可读）+ `newRedComputed=false`（明示「未计算」而非零）；回归锁 1 例 |
| i2 | Critical | **dismissed（登记遗留 1）** | 指控对象是 CCG 引擎的输入协议（opencode 7800 字节上限 + 静默拒绝），不在本片判据内；本片已用「拆 `evidence.md`」绕开。引擎侧缺失登记为遗留，本片不动（改谁来守门的邻域） |
| i3 | Critical | **upheld（已修）** | 6 条争议项逐条填裁决 + `status` 收口为闭环值 + `tier=external` + 可核 `evidence` + `closureNote`；即本片自身的收口动作 |
| i4 | Warning | **upheld（已修）** | 新增 `--max-wait-seconds`（默认 300）总等待上限：`--attempts 100 --retry-seconds 3600` 这类无界参数不再可能；超限即停手并判未证实(3)；参数校验 + 回归锁 + spec 新增 Requirement |
| i5 | Warning | **dismissed（补注释）** | 指控建议的「默认跳过未知形状」违反本仓失明纪律（把「没读到事件类型」读成「它是主干自己的验证」）；「未知事件类型自动进基准」本已是安全侧。注释补足两类情形的区分 |
| i6 | Warning | **dismissed（登记遗留 2）** | `openspec validate --strict` 实测 valid + quality-gate Gate 2b2 + 「Scenario ↔ 行为锁用例逐条对应」；缺通用自动门禁，登记为遗留，本片不加新 CI 门禁（属「改谁来守门」） |
| i7 | Info | 已满足 | workflow 顶部已写「⛔ 必须 ubuntu-latest」及实测依据；契约锁已直接断言 `runs-on` |

## T8 · PR 与合并

- [ ] T8.1 开 PR（squash 惯例），正文写清「改了什么」与证据
- [ ] T8.2 `gh pr checks` 零 pending 零 fail；`node scripts/check-main-red.js --pr <n>` 判 OK
- [ ] T8.3 合并后：取 merge SHA、确认远端分支已删、回读该 merge SHA 的 main push 读数
