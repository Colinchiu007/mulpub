# qm6-tier-watermark — 给 QM-6 外部出处覆盖率装一把可重取的水位计

> 用户裁决（2026-10-23）：`check-pr-exec-record` 在 CI 侧的 `--mode=advisory` **暂不转阻断**，
> 等水位。本 change 就是把"水位"从一句感觉变成一个数——并且顺手把"翻上去会红几条"量出来，
> 让那次裁决有据可依。本 change **不做**转阻断本身（那属"谁来守门"）。

## 一、问题

`scripts/check-pr-exec-record.js` 已经会打印 `TIER-COVERAGE dual-closed total=… external=…`，
但它统计的是**本次变更集**里的产物。一条 PR 通常只带 1 份判定产物，于是这行的分母恒是个位数，
且**只在跑的那一瞬间存在于 stdout**——跑完就没了，不进任何地方。

后果是"什么时候可以转 enforce"这个问题**无法回答**：

- 没有一个仓内文件写着"当前外部出处覆盖率是多少"；
- 想回答就得自己临时写探针，而临时探针写完即弃，下一次又要重抄一遍（本仓把它记作"量过一次没人再量"）；
- 分母口径没人钉：随手写的那版探针把整个 `.ccg/reviews/` 目录当分母，读数就错了（下面 §三 有实测）。

## 二、现状实测（2026-10-23 本机，主干 `2a0635ee`）

用判据自己的 `classifyEvidenceTier` / `summarizeTierCoverage` 对**主干全量**跑一次：

| 读数 | 值 |
|---|---|
| `.ccg/reviews/` 下文件总数 | 2041 |
| 命中 `AUDIT_ARTIFACT_RE`（= 判据真正会看的域） | **1964** |
| 域外（不进判据，多数是别的工作会话提交的 `brief-*.md` 任务书） | **77** |
| `mode=dual` 且 `deepReview.status` 已闭环 | **253** |
| └ `external`（工具产出的可核出处） | **63（24.9%）** |
| └ `external-unverified`（自称外部但形状不可核 / delivery 重算不符） | 13 |
| └ `self-play` | 28 |
| └ `none` | 0 |
| └ `unknown`（字段缺席 **或** 字面写成 `unknown`） | **146（57.7%）** |
| └ `unrecognized`（值在闭集外） | 3 |

3 条野值的具体字面量：`dual`、`docs-false-positive`、`superseded`——都是手写出来的。
按现行判据，`unrecognized` **任何面都拦**；它们今天不红只是因为不在各自 PR 的变更集里。

成本实测（同一把探针分三段计时）：`ls-tree` 1.4 s、单进程 `cat-file --batch` 取 1964 个 blob
（4.07 MB）1.5 s、`git log --diff-filter=A` 2.0 s。**但整轮真实读数是 n=7 的区间 4.3–16.2 秒（中位 11.2 秒）**
（tip `a12f6051` 起算，本机带并发会话负载；极差 3.8 倍 ⇒ 差异维度就是当场有多少会话在跑）——分段那三个数各自只测一次进程往返，
不含 1964 次 `JSON.parse`、不含 node 启动、不含判据模块 require；把它们加总当整轮成本
是**把探针的形状当成工具的形状**（设计轴 i3 命中，修正见 design D13）。
结论不变：秒级到十几秒级，可重取。
对照：第一版探针按文件逐条取 blob（2041 次进程创建）跑过 5 分钟仍未完成而被中止
——**逐 blob spawn 的取法在这台机器上不可用**，这条直接决定实现形态。

## 三、探针自己错过的样子（写在这里，因为它就是本 change 的一条判据）

第一版把扫描域写成"目录里有什么"，于是那 77 个 `.md` 进了视野、`JSON.parse` 抛 66 次，
读数被打成"66 份产物坏掉"。真相是产物没坏，**是探针把域划错了**：判据看的是
`AUDIT_ARTIFACT_RE`（纯 40/64 位十六进制 + `.json`），不是目录。
这正是本仓反复记的那条：**凡按"目录里有什么"迭代的门禁，永远看不见"该有什么"**——
反向同样成立：按目录迭代的探针会把不该进分母的东西算进分母。

所以本 change 的硬约束之一：**水位计的扫描域必须由判据的 `AUDIT_ARTIFACT_RE` 持有**，
并把 `域外=N` 打进读数行，让"域被划错"这件事在输出里自己显形。

正则本体与出处（设计轴 i1：只写转述就等于让评审者无从核对这个划分）——定义在
`scripts/check-pr-exec-record.js`，常量名 `AUDIT_ARTIFACT_RE`：

```
^\.ccg/reviews/(?:[0-9a-f]{40}|[0-9a-f]{64})(?:-again-[0-9a-f]{40}-(?:\d{8}T\d{6}(?:\.\d{1,3})?Z|\d{4}-\d{2}-\d{2}T\d{9}Z))?\.json$
```

即 `.ccg/reviews/` 下、名字是 40 或 64 位小写十六进制（可带一段 `-again-<40hex>-<时间戳>`
重赛后缀）、扩展名 `.json`。所以 `brief-*.md`（别的工作会话的任务书）与
`notes.json`（名字不是十六进制）都不在域内。77 个域外对象里有 66 份连 JSON 都不是——
这正是"按目录扫"会把它们算成"该解析却解析失败"的原因。水位计复用这一份，不得另划一次。

## 四、交付两半

### 半片 1：水位计（派生测量，不落任何状态文件）

`scripts/qm6-tier-watermark.js`：一条命令重取主干全量的 tier 分布 + 按"哪笔提交把这份产物带进主干"
的日期分桶趋势。**不新增任何 append 型载体**——`.quality-gates.md` / ledger 是冻结的存档面，
`CHANGELOG.md` / `learnings.md` 只由聚合器写；再开一个每轮追加的 jsonl 等于把上两刀拆掉的
"热点写面"重新造回来。趋势由 `git log` 推导，与 `scripts/lib/merge-ledger.js` 推导远程同步收口同源。

`unknown` 桶必须拆两个子读数（设计轴 i2）。判据按语义把"字段缺席"与"字面写成 `unknown`"
合并成一档（那是刻意的，本刀不改），但两档成因不同——历史产物 vs 有人显式声明不作保证——
拿 57.7% 去拍"能不能翻 enforce"时混在一起就会误导。落点：水位行同时打
`unknown-字段缺席=` 与 `unknown-字面值=`，并锁死 **两子读数之和 == 判据给的 `unknown`**；
判据以后改了这档语义，等式会先红，而不是悄悄换个解释。真实拆法：139 / 7，合计 146。

两个工具都是**交付物**而不是日志载体（设计轴 i6）：每次跑现算、不往仓库写任何东西。
这条不由自觉保证——`qm6-enforce-preview.test.js` §K 机械禁掉 `appendFileSync` 与
"以仓库根 / `__dirname` 为前缀的写目标"，并反向自证"写在 tmp 下的单实例锁文件"不在禁令内
（否则这条锁会把自己需要的锁机制焊死）。

### 半片 2：假想 enforce 扫描（只读，出红线名单）

`scripts/qm6-enforce-preview.js`：对每条在飞 open PR，在**合成合并态**里跑一次
`node scripts/check-pr-exec-record.js --mode=enforce`，输出"今天真翻上去会红哪几条、红在哪个面"。

它不新写 per-PR 装配：`git merge-tree → commit-tree → worktree add → 跑判据 → worktree remove`
这条链已由 `scripts/lib/debt-recheck-live.js` 的 `mergedTreeEvidence({repo, baseSha, headSha, inspect})`
持有，`inspect` 正是注入点。本刀只把注入的 checker 从 `check-debt-budget.js` 换成
`check-pr-exec-record.js --mode=enforce`。**不允许出现第二份合成合并实现**——那正是本仓
"两份必然漂移"的那类错法。

读数的免责标注是合同的一部分：它**不是**门禁判决（真实拦截发生在 CI 的 `QG Changes`），
且取不到 PR ref、merge-tree 不可判、worktree 建不起来时一律落 `UNJUDGEABLE` 并点名缺哪一段，
**不得**把"这一条没红"读成"这一条会绿"。

## 五、并行预检（AGENTS「开 worktree 前先查同模块活跃 worktree」）

| 在飞项 | 改哪些文件 | 与本刀关系 |
|---|---|---|
| PR #4238 `fix-main-red-too-stale`（OPEN，最后提交 2026-10-22T09:32:54Z） | `scripts/check-main-red.js`、`scripts/lib/main-red.js`、`scripts/main-red-baseline.test.js`、`openspec/records/` | **零文件交集**。同属"门禁判据"大类但不同面；本刀不碰 main-red |
| PR #4221 `main-red-run-baseline` | 同上 | 已合并 `a55df4509` |
| `openspec/changes/main-red-liveness/` | proposal/tasks/record | 已合 #4228（**只落提案**）；其阶段 1 实现由 #4238 承接，本刀不接手 |
| `scripts/lib/debt-recheck-live.js` / `-core.js` | — | **只消费不修改**（`mergedTreeEvidence`、`classifyMergeTree`、`evaluatePr` 均已导出） |
| `scripts/check-pr-exec-record.js` | — | **只 require 其导出，不改判据本体** |

结论：本刀写面收敛在 `scripts/qm6-tier-watermark.js`、`scripts/qm6-enforce-preview.js`、
两者同名 `.test.js`、`openspec/changes/qm6-tier-watermark/`、`openspec/records/` 一份、
以及一条 CI 打印档（非 required）。
> **落地时修正（design D12）**：CI 打印档**没有接**——派生数挂到路径过滤作业上等于罕见触发，
> 挂到高频作业则要为一笔十几秒的读付整份 job 的成本。实际接进 CI 的只有两条回归锁
> （`changes` job 内、`shell: bash` 的 fail-fast 步骤），代价与承担方式记在 D12；
> preview 接进 recheck 作业被列为 D14-4 欠账（做前必须先读 `blockingGateInputs`）。

## 六、明确不做

1. **不转 enforce**。改那一步的 `--mode=` 属"谁来守门"，且现水位 24.9% 下转上去会大面积红。
2. **不新增 required status check**（AGENTS「matrix 与 required 结构性冲突」那条未解）。
3. **不改 `EVIDENCE_TIERS` / 收口矩阵的判定语义**。`unknown` 桶把"字段缺席"与"字面 unknown"合并，
   是判据**刻意**的选择（写 `"unknown"` 与不写等效），水位计照原样复用，只在文案里点明这一格合并；
   要拆是另一刀（那会改变豁免语义）。
4. **不清理那 77 个 `.md`**——它们是别人会话的现场材料，属另一个归属问题；本刀只让读数**承认**它们在场。
5. **不做 3 条野值的存量处置**：它们不在任何在飞变更集里，判据按设计不追溯。
