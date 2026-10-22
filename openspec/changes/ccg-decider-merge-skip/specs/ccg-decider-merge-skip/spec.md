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
