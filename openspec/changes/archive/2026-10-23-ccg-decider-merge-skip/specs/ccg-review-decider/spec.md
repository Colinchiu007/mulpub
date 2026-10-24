## ADDED Requirements

### Requirement: 判定器 MUST 识别「合并收尾提交」并收敛变更集

`scripts/ccg-review-decider.js` 在 pre-commit 阶段（无 `--input` / `--base`）SHALL
先判定当前是否处于 `git merge` 的收尾阶段。判定 MUST 通过 git 自身的 ref 解析
（`git rev-parse --verify MERGE_HEAD`），MUST NOT 依赖 `<repo>/.git/MERGE_HEAD` 这类路径拼接
——本仓运行时代码任务一律在 `git worktree` 内执行，那里 `.git` 是文件而非目录，
路径拼接在本仓唯一允许的工作方式下恒为「不是合并」。

判为合并态时，本次判定的变更集 SHALL 收敛为**两侧都改过的文件交集**：

```
base   = git merge-base HEAD MERGE_HEAD
ours   = git diff --name-only --no-renames <base> HEAD
theirs = git diff --name-only --no-renames <base> MERGE_HEAD
scope  = ours ∩ theirs
```

`ours ∪ theirs`、`diff(base..HEAD)` 单独一侧、以及「仅冲突文件」三种口径 MUST NOT 使用。

#### Scenario: 交集为空的合并提交判 skip 且不落盘
- **WHEN** 在合并收尾阶段运行判定器，且两侧改动文件交集为空
- **THEN** `judge()` MUST 返回 `mode === "skip"`
- **AND** 理由文案 MUST 点明「两侧改动文件交集为空」，MUST NOT 复用「≤10 行且无敏感命中」这类
  看起来像真的量过的措辞
- **AND** 判定器 MUST NOT 在 `.ccg/reviews/` 下新建任何文件
- **AND** MUST 在 stdout 打印「为什么没有写记录」的一行说明

#### Scenario: 交集非空的合并提交按交集判定并标注范围
- **WHEN** 交集非空
- **THEN** `files` / `changedLines` / `codeFiles` MUST 由**只针对交集路径**的
  `git diff --cached` 派生（含 numstat 与逐行 diff 的同一次调用）
- **AND** 判定结果 MUST 携带 `mergeScope`，含
  `mergeHead` / `base` / `oursFileCount` / `theirsFileCount` / `intersectionFileCount`
- **AND** `stats.fileCount` MUST 等于交集文件数，MUST NOT 等于整侧导入的文件数

#### Scenario: 交集路径不得被 glob 放大
- **WHEN** 交集里有文件名含 `*` / `?` / `[` 等 pathspec 元字符
- **THEN** 传给 git 的路径集 MUST 使用 `:(literal)` magic
- **AND** 实际读到的文件集 MUST 与交集逐项相等

#### Scenario: 自身产物只能在消费面排除，MUST NOT 在观测面用 pathspec 排除
- **WHEN** 两侧都改过 `.ccg/` 下的同一个文件
- **THEN** 该文件 MUST 出现在交集里（观测面读得到它）
- **AND** `files` / `changedLines` MUST NOT 计入它（消费面由 `isSelfArtifact` 排除）
- **AND** `ccgChangedLines` MUST 大于 0（既有字段确实观测到自产物行数）
- **AND** 记录名（`stagedDiffHash` 的 pathspec）MAY 继续排除 `.ccg`——命名面与观测面是两个
  问题：前者要的是「同一份变更 ⇒ 同名」，后者要的是「读得到才有得判」

#### Scenario: 非合并态行为零变化
- **WHEN** 未处于合并收尾阶段
- **THEN** 变更集 MUST 仍由 `collectStaged()` 产出
- **AND** 判定字段、理由文案、记录文件名与本次改动之前逐字节一致

### Requirement: 记录的内容寻址键 MUST 与判定范围同源

`saveRecord` SHALL 接受 `opts.diffPaths`，让内部 `stagedDiffHash` 使用的 pathspec
与本次判定实际读取的路径集是同一个。

默认值 MUST 逐字节等于历史配方 `["--", ".", ":(exclude).ccg"]`，
以保证非合并态产出的记录文件名不漂移。

#### Scenario: 判定范围与记录名不同源会被发现
- **WHEN** 同一份变更分别以默认 pathspec 与交集 pathspec 调 `saveRecord`
- **THEN** 产出的记录文件名 MUST 不同（键确实跟随范围）
- **AND** 默认档文件名 MUST 与历史配方算出的名字相同

### Requirement: 判定记录文件 MUST 以换行结尾

`saveRecord` 的两处写盘点（主分支与 alt 去重分支）SHALL 都以 `"\n"` 结尾。
两处 MUST 分开断言，MUST NOT 只覆盖其中一处——走到 alt 的恰是「同名记录已闭环」的变更，
那类文件最需要被 append。

#### Scenario: 两个写盘分支各自产出尾换行
- **WHEN** 一次 `saveRecord` 落在主分支
- **THEN** 该文件末字节 MUST 为 `\n`
- **WHEN** 一次 `saveRecord` 因同名已闭环而落在 alt 分支
- **THEN** 该 alt 文件末字节 MUST 为 `\n`

### Requirement: 合并态的读取失败 MUST 走既有「未判定」口径

当判为合并态但读不到两侧交集（git 调用失败）时，判定器 SHALL 返回 0 并打印
「未判定」及可执行的补救命令，MUST NOT 回落到整侧导入口径（那正是本条要消除的形态），
也 MUST NOT 阻断开发者的提交。

#### Scenario: 合并态读不到交集时打印「未判定」且不落盘
- **WHEN** `MERGE_HEAD` 存在（判为合并态），但 `git merge-base HEAD MERGE_HEAD` 失败、
  两份无关历史导致无共同祖先，或任一侧的 `git diff <base>..<rev>` 读不到
- **THEN** 判定器 MUST 以退出码 0 结束，MUST NOT 阻断这次提交
- **AND** stdout MUST 打印「未判定」，并点明「在合并中（MERGE_HEAD 存在），
  但读不到 merge-base / 任一侧文件集」
- **AND** MUST 打印可执行的补救指引（`补跑请带 --base <rev>`）
- **AND** MUST NOT 回落到 `collectStaged()` 的整侧口径
- **AND** MUST NOT 在 `.ccg/reviews/` 下新建任何文件

### Requirement: 合并态探测的「失明」MUST 与「真的不在合并中」分开

`detectMergeState()` SHALL 把合并态探测分成三档，三档 MUST NOT 同形：

```
合并中     MERGE_HEAD 可解析且非空                      -> merging=true,  probeError=null
不在合并中 git rev-parse 以 128/1 退出（该 ref 不存在）  -> merging=false, probeError=null
探测失明   spawn 失败（取不到退出码）或退出码为其它值    -> merging=false, probeError=<detail>
```

`<detail>` SHALL 是错误码（如 `ENOENT` / `EACCES`），取不到时回落 `exit=<n|unknown>`。

探测失明时判定方向 MUST 保持 fail-open（回落非合并口径，MUST NOT 因读不到就整体 skip
或整体 dual）——但该状态 MUST 可见：只在成功分支打印，等于把「git 起不来」静默吞成
「不在合并中」，那正是本条要消除的形态。

#### Scenario: 探测失明必须出声，且不得被读成「不在合并中」
- **WHEN** `git rev-parse --verify MERGE_HEAD` 因 spawn 失败或非 128/1 的退出码而失败
- **THEN** `detectMergeState()` MUST 返回 `merging === false` 且 `probeError` 非空
- **AND** CLI MUST 在回落非合并口径之前打印
  `合并态探测失败（<detail>）⇒ 回落非合并口径（按暂存区判定）`
- **AND** 该文案 MUST 明确「这不等于当前不在合并中」，并点明本次判定可能把对方整侧
  当成本次改动
- **AND** 判定模式 MUST 仍按暂存区口径给出，MUST NOT 因探测失明而整体 skip 或整体 dual

#### Scenario: 真的不在合并中不得告警
- **WHEN** `git rev-parse --verify MERGE_HEAD` 以 128 或 1 退出（该 ref 不存在）
- **THEN** `probeError` MUST 为 `null`，CLI MUST NOT 打印任何探测失败告警
- **AND** 判定结果 MUST 与本次改动之前逐字节一致（含记录文件名）
