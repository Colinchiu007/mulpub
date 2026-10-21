# Proposal: QM-6 评审后端对的可配置化与追责（qm6-review-backend-config）

## Why

2026-10-18 为了让 PR #3904 的 QM-6 深度审查换一个可用的 critic 后端（claude 后端当时不可用），
依次试了三种"旋钮"，**全部静默失效**，而失败症状不是报错，是"评审照跑、结论照出、什么都不记得"：

| 试过的旋钮 | 实测结果 | 根因 |
|---|---|---|
| 改 `~/.claude/.ccg/config.toml` 的 `[routing]` | 驱动输出仍是 `proposer=opencode critic=claude` | 该文件由 `codeagent-wrapper` 消费，`ccg-deep-review.js` 从不读它 |
| `sh scripts/deep-review.sh --critic codex` | 旗标被丢弃 | 入口是 `for a in "$@"` 只认无值旗标，且 `exec node "$DRIVER" --sha "$SHA"` 不转发任何后端参数 |
| 直连驱动 `node …/ccg-deep-review.js --critic codex` | 仍按 claude 跑 | 覆盖块（`--proposer/--critic` → `cfg`）只挂在**决策层** `objectType:"plan"` 分支；验证层是裸 `const cfg = cfgForMode(mode)` |

同时发现仓内把"用哪两个后端"抄成**六份字面量**：`ccg-review-decider.js` 的可用性表与
目标文案各一份、`deep-review.sh` 的体检循环与裸名自检各一份、`plan-review.sh` 一份，
加上驱动自己的 `cfgForMode`。于是判定器说的"后端就绪"与入口体检查的名字可以互相矛盾，
而**没有任何东西记录"这次评审到底是谁跑的"**——`deepReview.status` 是一个手写的词，
`performedBy` 才是产物，但两者从未被对过账。

## What Changes

1. **单一真源**：新增 `scripts/ccg-review-backends.list`（第一行 critic、第二行 proposer）
   + 两个读取方：`scripts/lib/ccg-review-backends.js`（node）与
   `scripts/lib/ccg-backends.sh`（纯 shell，被两个入口 source）。
   解析优先级 **CLI 旗标 > 环境变量（`MP_QM6_CRITIC`/`MP_QM6_PROPOSER`）> 清单文件**。
   之所以要有 shell 版：`--check-deps` 是"node 本身可能就是坏的"时的第一手诊断入口。
   两个读取方由一把**逐字对账**的锁钉住（不写"各自等于一个常量"）。
2. **判定器不再自带名单**：`detectBackends()` 按解析出的名字逐个探测 PATH；
   文案由真源派生；并把**请求值**写进判定记录的新字段 `reviewBackends`。
3. **入口转发**：`deep-review.sh` / `plan-review.sh` 接受 `--critic <名>` / `--proposer <名>`，
   体检/裸名自检按解析结果遍历，并在覆盖生效时把参数转给驱动。默认路径保持逐字不变。
4. **追责判据**：`check-pr-exec-record.js` 新增 `judgeBackendMismatch` ——
   记录显式覆盖过（`reviewBackends.overridden === true`）而 `deepReview.performedBy`
   里没有任何被请求的后端名 ⇒ 该条深度审查判**未闭合**，点名两侧值。
5. **顺带修掉两个被掩盖的真缺陷**（见 design.md D7/D8）：入口在 `$0` 为 Windows 绝对路径时
   `ROOT` 落到仓库**父目录**；`--help` 用写死行号区间，加用法行就静默截断最新几行。

## Impact

- Affected spec capabilities: `openspec-integration`（QM-6 执行方式段）
- Affected code: `scripts/ccg-review-decider.js`、`scripts/check-pr-exec-record.js`、
  `scripts/deep-review.sh`、`scripts/plan-review.sh`、新增 `scripts/lib/ccg-review-backends.js`、
  `scripts/lib/ccg-backends.sh`、`scripts/ccg-review-backends.list`
- Affected CI: `quality-gate.yml` 新增 Gate 2c6（changes 作业，判据本体无 job 级 `if`）
- **不改动**：分支保护、`CI_IGNORED_PATHS`、自扮演豁免政策 —— 本刀不碰"谁来守门"的那三处
- 向后兼容：`reviewBackends` 字段缺失的历史产物按"不适用"跳过，**不会追溯变红**

## Out of scope（如实登记，不当已完成）

驱动（`~/.claude/skills/adversarial-review-loop/scripts/ccg-deep-review.js`）验证层不应用覆盖参数
这件事**在仓外**，本 change 修不了。两条出口留给后续决策（都在 design.md 里）：
修上游驱动那一分支；或按驱动自己的注释把引擎 vendor 进本仓 `scripts/`。
在两者落地之前，`--critic` 对 diff 评审的实际效果就是"被对账判红"，而不是"换成功"。


## Follow-up（2026-10-19 追加，同一 change 范围内的缺陷闭合）

本 change 合并后（PR #3927，merge `d65f0b76`）留下一处**自己造出的假红**：
proposal 与 AGENTS 都写了"请求过的后端会进判定记录 `reviewBackends`"，但实现只在
**pre-commit 的 decider** 那一跳落盘 —— 写的是提交那天清单里的值；评审时通过
`--critic` / `MP_QM6_CRITIC` 发起的覆盖**没有任何一跳**写进记录。
于是 `judgeBackendMismatch` 两侧读的是两个时刻，每一次合法覆盖都被判"该条深度审查未闭合"。

追加的变更：

- `scripts/lib/ccg-review-backends.js`：新增纯函数 `applyReviewRequestToRecord` 与 CLI 动作模式
  `--record-request <path>`（提交时那份挪进 `commitRequest` 留档，不销毁审计链；未覆盖一律拒写）
- `scripts/deep-review.sh`：覆盖分支在把控制权交给驱动**之前**回写；失败 `exit 2` 且驱动一次都不起来；
  dry-run 不回写但必须出声
- 锁：`ccg-review-backends.test.js` 17 → 26、`deep-review-deps.test.js` 35 → 40
  （新 5 条里 4 条是真跑 bash + 桩驱动的行为锁，"回写早于 exec"编进产物而非源码位置）
- 不新增测试文件 ⇒ 不动 `quality-gate.yml`、不动"谁来守门"

Affected code（追加）：`scripts/lib/ccg-review-backends.js`、`scripts/deep-review.sh`、
`scripts/lib/ccg-review-backends.test.js`、`scripts/deep-review-deps.test.js`、AGENTS.md、CHANGELOG.md

Out of scope 不变：驱动验证层是否应用覆盖（D-R1/D-R2）仍在仓外，需人工裁决。
本刀只让**记录说真话** —— 它不改变"谁在评审"，只改变"记录是否声称了错误的评审者"。
`plan-review.sh` 刻意不回写：决策链路没有该字段的消费者（见 design.md D13）。
