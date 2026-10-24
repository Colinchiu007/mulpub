# design — qm6-tier-watermark

## D1 水位的落点：派生测量，不是状态文件

三条候选：

| 选法 | 说明 | 裁决 |
|---|---|---|
| A 每轮往一个 jsonl 追加一行 | 最直觉 | **拒**。这是本仓刚拆掉的东西：`.quality-gates.md`、`gate-record-debt-ledger.json` 因"所有会话往同一处追加"被冻结（#3672/#3694），`CHANGELOG.md`/`learnings.md` 因顶插必撞（2026-10-20 对 4 个 CONFLICTING PR 跑 `git merge-tree`，冲突文件只有这两个）改成只由聚合器写。新开一个每轮追加的载体 = 第三次造同一个循环 |
| B 把数写进 CI 日志，人工去捞 | 无仓内落点，且"捞"不可重取 | **拒**（作为唯一落点）。作为**留痕**保留：CI 打印档确实要跑，日志是它的现场 |
| C 按需派生：一条命令从主干历史算出来 | 与 `scripts/lib/merge-ledger.js` 推导远程同步收口同族 | **选** |

C 的前提是它必须便宜到"有人会真的去跑"。实测 <6 秒（proposal §二），成立。
A/B 的失败模式不是"错"，而是**没人再量**——覆盖面的数字一旦写进注释就冻结，这正是本仓
"量过一次没人再量"那条老病。所以本 change 反过来要求：**数字必须在仓库里一句话重取**，
并把这条重取命令写进脚本自己的输出。

## D2 扫描域由判据持有，且必须自报域外

判据看什么，水位计就看什么：`AUDIT_ARTIFACT_RE`（导出的那条），对象集来自
`git ls-tree -r <ref> -- .ccg/reviews`。实测 `2041 文件 / 1964 命中 / 77 域外`。

读数行必须同时打印**域外条数**。理由不是装饰：本刀自己的第一版探针就是按目录扫的，
于是把 77 个 `brief-*.md` 任务书当成"该解析却解析失败"的对象，产出 `parseFail=66`
这个完全是探针口径错的数（真产物一个都没坏）。如果没有"域外=77"这一格，
下一次读这个数的人会去找 66 份坏文件。

推论（同一条 MUST 的反向形态）：**按目录里有什么迭代**的探针会把域外对象算进分母；
**只按判据正则迭代**而不报域外，又会把"命名又变了一次"这件事藏起来。两个都要，缺一即盲。

## D3 tier 分类只允许有一份实现

水位计 `require('./check-pr-exec-record.js')` 取 `classifyEvidenceTier` 与
`summarizeTierCoverage`，**不得**自己写"看 tier 字段像不像 external"。

回归锁必须按本仓那条口径来：**"是否复用某实现"的锁必须取一个两版实现答案不同的输入**。
现成的那一格是 `{mode:"dual", deepReview:{status:"cleared", tier:"external", evidence:"x"}}`：
- 自写的一份（只看字段值）会数成 `external`；
- 判据的这份（还查 evidence 形状）数成 `external-unverified`。
锁断言水位行里 `external-unverified=1 external=0`。写不出这条输入，就说明这把锁是装饰。

同理，`external` + `evidence` 是仓内路径形态时，水位计必须传 `existsAt` 探针
（`makeEvidenceProbe`，绑到被测 revision），否则"路径不存在"这一档会被读成已核实。
不传探针时水位计必须**自己出声**（打印 `probe=off`），不得静默按已核判。

## D4 取对象只能单进程批量，且帧必须按字节长度切

实测两种取法：

| 取法 | 读数 |
|---|---|
| 逐文件 `git show <ref>:<path>`（2041 次 spawn） | >5 分钟未完成，被中止 |
| 单进程 `git cat-file --batch`（1964 个 oid 一次喂入） | 1.5 秒，4.07 MB |

第二条还是唯一能给出**逐对象字节长度**的取法，所以帧切法必须是：
读一行头 `<sha> blob <size>` → 按 `size` **字节**切 body → 跳过一个分隔换行。
**禁止**"按行读到下一个头"——判定产物是多行 JSON（`JSON.stringify(…, null, 2)`），
按行切会把一条记录劈成十几帧，然后把一份好 JSON 读成解析失败。
本刀的 v2 探针就是这么错的（改 v3 才修好），这条不是设想。

判据形态：水位计的取数函数必须**只用一次** batch。锁是结构锁 + 行为锁两条：
结构锁断言源码里出现 `cat-file` 且 `--batch`，且不出现按路径循环 `git show` 的形态
（禁令按语义位置切，注释里提这个词不算命中——本仓 2026-10-19 一天内三次栽在"按字符串是否存在切"上）；
行为锁用一份**多行 JSON** 的真产物夹具，断言它被分类成一条记录而不是 N 条。

## D5 趋势的来源与它的失效形态

趋势 = 每份产物"哪笔提交把它带进主干"，取 `git log --diff-filter=A --format=%H\x1f%cI --name-only <ref> -- .ccg/reviews`
（实测 2.0 秒，2041 条文件行 / 665 条提交行）。按提交日期分桶，输出
`WATERMARK-TREND 月=YYYY-MM added=N external=N` 若干行。

三条必须写进输出的边界（不写就会被过度解读）：
1. `--diff-filter=A` 只认**加入**。改名、原地重写不改变"加入"这一格，所以趋势统计的是
   "当前主干上这批对象各自何时首次出现"，**不是**"历史上一共产出过多少份"。
2. 产物名是**内容寻址**（40/64 位十六进制）。`git commit --amend` / rebase 会改哈希 ⇒ 换名，
   于是同一份评审在历史里可能以两个名字各计一次（本仓实测：钩子产物数随每笔提交自增）。
   趋势行因此**不得**被读成"外部评审的绝对发生次数"。
3. 分桶键取提交的 **committer 日期**，不是 author 日期：squash 合并会把 author 日期留在
   原始编写时间上，分桶就会错位（这条与 D-未做第 5 条同族，都是"历史事实快照"的读法问题）。

## D6 假想 enforce 的注入点：复用合成合并，不写第二份

`mergedTreeEvidence({repo, baseSha, headSha, inspect})` 已经把
`merge-tree → 归因（不 ok 就回 reason）→ commit-tree（自带身份，缺身份时 rc=128 那条实测已写在源码头注释）
→ worktree add --detach → inspect(dir) → finally worktree remove` 全链持有。
本刀传 `inspect = (dir) => spawnSync(node, [dir/scripts/check-pr-exec-record.js, '--base=<baseSha>', '--head=HEAD', '--mode=enforce', '--no-remote'], {cwd: dir})`。

`--no-remote` 是必须的：默认路径会去查远端分支集合（`remoteBranchSet`），那是网络动作，
而预览工具的定位是"本地一条命令"。这一格必须显式写出来并锁住——静默联网的"只读预览"
会在无凭据的机器上报一串归因不到的失败。

同时**不得**用它替代 CI：脚本首行与末行都要打印
`PREVIEW-NOT-GATE：本读数不替代 CI 的 QG Changes；enforce 的真判决只发生在 CI`。

## D7 预算、上限与信号卫生

- `--max=<n>`（默认 40）硬上限；非法值回落默认并出声（与 `MP_RPA_POOL_SIZE`、
  `MP_QUEUE_MAX_CONCURRENT` 同口径）。
- 每条 PR 打印 `pr=<n> 归因=<verdict> ms=<实测>`。**首次真跑必须打印每笔实测耗时再回填本文件**，
  不得预先估一个数写这里（这条是 `windows-lock-budget` 那族的直接教训：本文件当前耗时段落
  就是**空着待回填**的状态，因为还没跑）。
- 单实例锁：写 `<tmp>/qm6-enforce-preview.lock`，内容为 `PID + 命令行`；已存在且进程仍活 ⇒ 拒绝运行。
  动因是本仓实测过 TaskStop 报"已停止"而进程树仍在跑、并与下一次运行同时改同一批文件
  （那条记忆在 `mutation-driver-restore-baseline-trap`）。本工具**不改任何仓库文件**，
  但会在 `os.tmpdir()` 下建 worktree 目录，两个实例并存会互相删对方的目录。
- 信号卫生：`SIGINT/SIGTERM/SIGHUP/uncaughtException` 一律先 `worktree remove` 再退出。
  合成合并的 worktree 残留在 `os.tmpdir()`，不会污染仓库工作树，但会占住注册表条目
  （本仓有"busy holders 挡住 worktree 清理"的既有事故）。

## D8 输出契约（固定判据串只写一份）

实现与测试**共用同一字面量**，各写一份"同族词"必然漂移。约定三条锚串：

| 锚串 | 出处 | 锁 |
|---|---|---|
| `TIER-WATERMARK main=` | 水位行首 | 水位计与扫描器共用，测试按它取行 |
| `PREVIEW-NOT-GATE` | 扫描器首末行 | 断言两行都在，且**首行位置早于任何 pr= 行** |
| `域外=` | 水位行的域外段 | 断言该数 > 0 时行内同时出现 `AUDIT_ARTIFACT_RE` 字样，提示"域是被正则划的，不是目录" |

锚点唯一性教训（上一刀实测）：位置类判据的锚串若在文件里出现两次，`indexOf` 会命中注释那一处，
导致 M-E4 假通过。本刀的锁一律**先断言锚串在文件里唯一**，再判顺序。

## D9 退出码

| 码 | 水位计 | 扫描器 |
|---|---|---|
| 0 | 取到读数（哪怕 external=0） | 全部条目都被判定（含判成"会红"） |
| 1 | — | 至少一条 `WOULD-BE-RED`（这是产出，不是故障，故与 2 分开） |
| 2 | 取不到主干 ref / git 自身失败 ⇒ `WATERMARK-SELF-FAULT` | 取不到 open PR 列表 / 单实例锁被占 / 工具自身故障 |

**"零条在飞"不得与"取不到列表"同形**：前者打 `prs=0 (none-open)` 退 0，后者退 2。
把工具的失明读成"没有欠账"是本仓「装饰性门禁」的同型。

## D10 变异反证清单（写实现前先定，逐条必须指名红）

| 编号 | 变异 | 必须变红的锁 |
|---|---|---|
| M-F1 | 把 tier 分类从"复用判据"改回自写的一份（只认字段值） | D3 那条 external-unverified 锁 |
| M-F2 | 扫描域从 `AUDIT_ARTIFACT_RE` 改成"目录 readdir" | 域外=77 那条（读数变 0 或缺失即红） |
| M-F3 | `cat-file --batch` 的切帧改成按行读 | D4 的多行 JSON 行为锁 |
| M-F4 | 把 `--no-remote` 摘掉 | 结构锁（预览不得联网） |
| M-F5 | `PREVIEW-NOT-GATE` 只留末行不留首行 | 首行位置锁 |
| M-F6 | 零条在飞时改走"退 2 取不到列表" | D9 的同形区分锁 |
| M-F7 | 把锁本身改成 no-op（整体 return 空结果） | 每条锁的"锁在跑"前提锁 |

## D11 设计轴评审处置（轮 1 critic=claude，7 条：Critical 2 / Warning 3 / Info 2；最低维分 4=security）

> proposer=opencode 轴在轮 1 的修订步**同步拒绝**：输入 9919 字符 > 该后端上限 7800
> （实测边界 (8125, 8145]，非文档承诺），exit 1 且无任何错误信息。
> 所以本轮处置由本会话逐条给证据，缺 proposer 轴 —— 按既有裁决「认单轴，合并并把缺轴登记为欠账」，
> 欠账内容见 §未闭合。critic 交付本身完整（7 条带 dimension 与 suggestion）。

| # | 级别 | 处置 | 证据 / 落点 |
|---|---|---|---|
| i1 | Critical | **采纳** | 意见说的是事实：proposal 只写了"纯 40/64 位十六进制 + .json"这句**转述**，没给正则本体也没给出处文件，评审者无从核对 1964/77 这个划分。已在 proposal §三补出 `AUDIT_ARTIFACT_RE` 的字面量与其所在文件；同时水位行的 `域由=AUDIT_ARTIFACT_RE` 与 `域外=N` 由测试 1.1.3 钉住（行为面，不靠文档转述）。 |
| i2 | Critical | **采纳** | 意见成立且我原来的处理（"只在文案里点明这一格合并"）不够——24.9% 与 57.7% 要拿去拍裁决，"历史没这字段"与"有人显式声明不保证"是两种成因，不能糊在一个桶里。落点：水位行新增 `unknown-字段缺席=` / `unknown-字面值=` 两个子读数，并锁死 **子1+子2 == 判据给的 unknown**（测试 1.1.10）。这样既没改判据语义（明确不做 3 保持），又让"改了会被发现"。真实读数：139 / 7，合计 146。 |
| i3 | Warning | **采纳一半，另一半否证** | 采纳的那半：合成失败必须有归因——已由 `mergedTreeEvidence` 的 `reason`/`stage` 承载并被测试 C 锁住（`merge-conflicting` 等），`finally` 内移除 worktree 是那份实现自带的。**否证的那半**：它要求"给 preview 定 CI 运行预算"——本刀**不给 preview 新增 CI 打印档**（决策与否证见 D12），所以不存在该档的 CI 预算可言。另：它质疑"<6 s 是单机单次快照"，这条**完全正确**，见 D1 的读数修正。 |
| i4 | Warning | **采纳一半，拒绝一半** | 采纳：输出形态必须机器可读。已定死 `pr=<n> 归因=<WOULD-BE-RED\|WOULD-BE-OK\|UNJUDGEABLE>[ reason=<r>][ stage=<s>] ms=<t>` + 汇总行 `WOULD-BE-RED=x WOULD-BE-OK=y UNJUDGEABLE=z`，测试 C/E/F 分别锁三档，且"没判的条目不得出现 WOULD-BE-OK"是负向锁。拒绝："每条 pr= 行都重复免责句"。理由：免责性由**位置**保证（首行早于任何 pr= 行、末行再打一次，测试 A 锁的就是位置），逐行重复会把"整段免责被删"与"某一轮少打一行"在 diff 里做成同形，40 行噪声只会诱导维护者把整段当装饰删掉。 |
| i5 | Warning | **采纳措施，否证定性** | 否证的定性：不存在命令注入面——所有子进程走 `spawnSync` 的**数组参数**（无 shell 解析，`gitRunner` 与默认 `gh` 都是这个形状），且 PR 号必须先过 `validPrNumber`（整数且 >0，进 refspec 之前收口），head sha 必须过 `isOid`（`not-an-oid` 那一格由测试 C 走成 `reason=head-shape`，不得进入合成合并）。采纳的措施：把这三条写成显式合同并各配一条锁（C 已含 head-shape；pr-number 另在实现里出声）。 |
| i6 | Info | **采纳** | proposal 补一句归属声明：两脚本是**交付物**不是日志载体，每次跑现算、不写仓库；并由测试 K 机械钉住（禁 `appendFileSync`、禁以仓库根/`__dirname` 为前缀的写目标；tmp 下的锁文件不在禁令内——反向自证那条防的就是把锁自己焊死）。 |
| i7 | Info | **采纳** | D5 补确切调用、分桶键与 dedup 规则。并补一条它没能预见的现场事实：`git log --diff-filter=A --format=%cI --name-only origin/main -- .ccg/reviews` 的 667 笔加入**全部落在 2026-10**（该目录 2026-10 才开始存在），所以趋势今天只有一格。这把尺的价值在往后长，不在今天——写出来防止下一个会话把"只有一格"读成实现坏了。 |

## D12 不新增 CI 打印档（对 D1 里"作为留痕保留"那句的自我否证）

D1 初稿写着"CI 打印档确实要跑，日志是它的现场"。落地前量了两件事，结论是**不接**：

1. 候选落点是 `debt-baseline-recheck.yml`，而它的触发是**按路径过滤**的（只在两份守门输入变化时跑，
   实测近 30 天 12 次）。把一个"随时可重取的派生测量"挂到一个罕见触发的作业上，
   得到的不是趋势留痕，而是一串按季度才更新一次的日志——比现在没有更误导。
2. 挂到高频作业（每次 main push）则要为一笔 <20 秒的读付整份 job 的成本（含 `fetch-depth: 0` 检出）。

代价如实记：**水位在 CI 侧没有历史读数和今天的读数一样不可回看**。承担方式是
(a) 每次要做裁决时本地跑一次（20 秒级），(b) 读数写进 PR 评论（不写回仓库文件，
这条是 AGENTS「回读的读数写在 PR 评论里」那格的直接沿用）。要真想留时间序列，
那是另一刀（且要先解决"派生数不该有落点"这条前提本身）。

## D13 实测读数修正（不得把分段读数当整轮读数；单次读数不得当定律）

| 取法 | 分段读数（初版探针） | 整轮真实读数（多次） |
|---|---|---|
| 全量水位 `--ref=origin/main` | ls-tree 1.4 s / batch 1.5 s / log 2.0 s | **n=7：4316 / 4989 / 10498 / 11184 / 11914 / 12504 / 16202 ms**
（同机同 ref；中位 11.2 s，最好 4.3 s，最差 16.2 s ⇒ 极差 3.8 倍） |

分段那三个数各自只测一次进程往返，不含 1964 次 `JSON.parse`、不含 node 启动、也不含
判据模块 require；把它们加总当成整轮成本是**把探针的形状当成工具的形状**。
第二重错是把单次读数当定律：本表 4 个样本都出自**同一条命令**，最大最小差 3.8 倍，
差异维度就是当时机器上有多少并发会话在跑。所以引用时必须给样本数与区间，
且**不得**写成常数（本仓那条"贴脸就是要重测"的口径同样适用：读数逼近任何预算时先重测）。
结论不变：秒级到中十几秒，可重取。

## D15 本机首跑打出来的两条（都是实现面真缺陷，不是文档问题）

**① 合成合并的返回值形状：`inspect` 的结果在 `baseline` 键下，不在顶层。**

首跑（`--max=1`）每条 PR 都归成 `UNJUDGEABLE reason=unexpected-exit-undefined`。
根因：`mergedTreeEvidence` 实际返回 `{built, dir, baseline: inspect(dir), aTxt: …}`，
而我的替身把 `inspect(dir)` **摊平到了顶层**。于是 13 条锁全绿、真跑全废。
这是本仓「契约夹具不得替对方剥壳」的**第 4 种落点**（前三种：替对方剥壳、替对方算数、替对方改签名；
这一种是"替对方决定返回值放在哪个键"）。修法不是把注释补上，而是：

- 替身改成与真实现逐字同形（`{built, dir, baseline, aTxt}`）；
- 加两条**用真 `mergedTreeEvidence`** 的锁：§N 直接断言返回键集里 `baseline` 承载 inspect 的结果
  （形状一变先红），§O 让 preview 经真实现（只假 git）跑通 `rc=1 ⇒ WOULD-BE-RED`。
  单测夹具从此不再为该形状负责。

顺带记一条：`§O` 第一版也是红的，但红因是**替身没答 `rev-parse`**，于是 preview 在
"没有 base"这一档就收口，那条"真实现契约锁"根本没走到合成合并。夹具的失效面与生产的失效面
要分开判——这条区分本身就是本 change 的内容之一。

**② 每笔 PR 的实测成本：`ms=74693`（一笔，含 fetch / merge-tree / 合成提交 / 检出 / 跑判据 / 移除）。**

30 笔在飞 ⇒ 本机整轮约 37 分钟。这**否证了 D12 里"preview 属本地按需工具"那半截**：
本地跑得动，但跑到十几分钟时它对操作者就退化成"挂着的东西"，而它的产出（红线名单）恰好是
裁决要当场用的。同时它也**部分否证了我对 i3 的否证**——"CI 预算"不是虚构问题，只是我把它
误记成了不存在。修正后的落点：

- 整轮扫描交给既有**非 required** 的 `debt-baseline-recheck.yml`（ubuntu、`fetch-depth: 0`、
  与重算同一条链），`timeout-minutes: 15` 下按 `--max=8` 分批（每轮点名"还有 N 条未判"，
  由下一轮接着走），并把每笔 `ms=` 实测留在日志里；
- 本地仍可 `--max=N` 按需跑小批，用于临时裁决。

这一条是**待办**，不是本 change 已交付的内容：接线到那作业要动那份 workflow 的步骤，
与 #4238 无文件交集，但与 `blockingGateInputs` 的"阻断步清单派生"有耦合，必须先读那条判据
再把新步骤归到"非阻断"档，否则会把一个测量步写成阻断步。

## D14 未闭合（登记，不装作已闭合）

1. **proposer 轴缺**：opencode 7800 字符上限挡住了轮 1 的修订步。修法要么拆小方案分轮评审，
   要么本刀自带"评审载荷截断"的对策——两者都不属于本 change 的范围（那是评审链的通用问题，
   已有 `qm6-review-backend-config` / `ccg-review-degradation-ladder` 在管）。
2. 趋势今天只有一格（D5/D11-i7），要到 2026-11 之后才真正有意义。
3. preview 的每笔实测耗时由首跑回填（D7 的耗时段落），回填前不要把任何时长写进预算注释。
   本机首跑已回填一笔：`ms=74693`（见 D15-②）；CI 侧读数仍**未测**。
4. **preview 接进 `debt-baseline-recheck.yml` 未做**（D15-② 的结论）。做之前必须先读
   `scripts/lib/debt-recheck-core.js` 的 `blockingGateInputs` —— 它按"非 continue-on-error 的 step"
   派生那份作业的阻断面清单并与触发路径对账；新步骤若被它认成阻断步，会连带把触发面拉长。
5. 那 3 条闭集外野值（`dual` / `docs-false-positive` / `superseded`）与 13 条
   `external-unverified` 不在本刀处置范围：它们不在任何在飞变更集里，判据按设计不追溯。
   要清是另一刀（且只能靠"下一次该 PR 有改动时自然重判"或人工逐条核对）。


## D16 实现轴轮 1 的处置（critic=claude 真跑，7 条：Critical 3 / Warning 3 / Info 1；最低维分 maintainability=3）

引擎因 minScore=3 未收敛 ⇒ 落自扮演档，产出 6 条待裁决模板，状态记 `self_play_pending`，
写回器按合同拒绝（`reason=not-closed detail=status="self_play_pending"`）—— 这一串**本身就是证据**：
未闭环时工具不给署名。逐条先取证再处置：

| # | 级别 | 处置 | 取证 |
|---|---|---|---|
| i1 | Critical | **否证（指控读的是设计本身）** | 它说"判定记录的 sha 是 `2a0635ee` 而 PR head 是 `8738852a0` ⇒ 数据完整性失效"。实测：`git rev-parse HEAD`=8738852a0，记录内 `sha` 字段=父提交 —— 这是入口**当场打印**的既有设计（「pre-commit 时新 commit 尚未生成，判定记录写在父 sha 上——这是预期行为」），且记录**按 `stagedDiffHash` 内容寻址**命中（同一行输出可证）。它把"记录晚于提交一步生成"读成"记录指错提交"。 |
| i2 | Critical | **否证（指控已过时）** | 它说"替身把返回值摊平到顶层，15 条锁抓不到真实形状错"。这正是**本 diff 已经修掉的那一条**：`readVerdict` 读 `baseline` 键，§N 断言真实现返回键集含 `baseline`，§O 经**真 `mergedTreeEvidence`**（只假 git）跑通 `rc=1 ⇒ WOULD-BE-RED`；变异 M-F8（把读数改回顶层取）实测让 3 条红、其中一条就是 §O。critic 读到的是 D15 里"我们曾错过"的自述，没读到同一份 diff 里的修法。 |
| i3 | Critical | **采纳前提、否证结论** | 它说"`.gitignore` 注释引用第 106/261 行未经验证"。当场核对：`awk 'NR==106\|\|NR==261'` → `scripts/*.js` 与 `!scripts/*.test.js`，两个行号都对；且"引用行号"是本仓既有惯例（该文件里同款说法 24 处，最早可追到 #3011 家族）。结论不采纳（行号已验证且可 grep），**它担心的漂移**采纳：新增一条锁 `§1.1.11`，直接断言"被 CI 点名的测试其实现必须在 `.gitignore` 里有 negation"，从此不依赖注释与行号的准确性。 |
| i4 | Warning | **采纳** | 见上：`§1.1.11` 就是它的落点，且它把"改名/漏登记"从"CI 上才发现"提前到本地一条测试。 |
| i5 | Warning | **采纳** | 它说"16.2 秒与 74693 ms 是单次快照，没有多次统计"。成立。已重取：水位 n=4（4316 / 4989 / 11184 / 16202 ms，同机同 ref）；预览 n=41（min 6745 = 冲突提前返回，median 74158，max 140830，mean 68510 ms）。D13/D15 已改为**带样本数的区间**并写明差异维度是并发负载。 |
| i6 | Warning | **否证** | 它说"proposal 引用 `check-max-lines.js` 的 rc=0 而该文件不在 diff 内，外部读者无法核实"。所有 rc 类证据在本刀一律以**可重跑的命令原文**给出（record 的 Fresh 证据列第一格就是命令本身），核实方式是执行而不是读源码；把"我跑过的判据"要求成"必须在 diff 里"会推出不可能满足的形式。 |
| i7 | Info | **否证** | 它说 `required=true` 与 `status=pending`、`performedBy=null` 并存是"状态机不一致"。这三格是判定器落盘的**初值**（AGENTS QM-6 第 1 条：`deepReview.required = (mode !== "skip")`），pending→闭环值正是评审链要做的事；"应设 required=false"恰恰是要防的自证清白。 |

### 由这一轮显形、但不属本刀能修的一格

三条 Critical 全被否证并不等于能拿到工具署名：合取③ 要求记录级 `performedBy` 逐字等于清单里的 critic，
而引擎只要走自扮演收口就把 `performedBy` 写成 `self-play` ⇒ **高危面上经自扮演收口的记录永远拿不到
`tier=external`**（本 PR 命中 `.github/workflows/` 前缀，即高危面）。这是已登记的
`qm6-closure-writeback` tasks 11.5 那一格，不是本刀新造的洞。本刀的处置是：先按 i4/i5 改，
再重跑一轮**真外部**评审（head 变了 ⇒ 存档不再命中 ⇒ 会真调模型），零 Critical 才可能出
`status=cleared` + 工具署名；若那轮仍给 Critical，则按 11.5 的既有口径报人工，不自造闭环值、不手写 `tier`。

## D17 实现轴轮 2 的处置（critic=claude 真跑，head=bc6bc89e，交付 8 条 / 待裁决 7 条：Critical 3 / Warning 4；最低维分 maintainability=3）

轮 1 的改动（§N/§O 真实现锁、流式、`--only`、`START=` 锁龄）落成新提交后重跑了一轮真外部调用。
交付 8 条、待裁决 7 条、其中高危域须外部复核 1 条（i5，域标签 `crypto` 来自指控自身措辞里的
「凭据」二字 —— 本 diff 不含任何加解密代码，这是已登记的散文触发面，不是新洞）。逐条先读码再处置：

| # | 级别 | 处置 | 取证 |
|---|---|---|---|
| i1 | Critical | **否证** | 它说"预览 require 的 `lib/debt-recheck-live.js` 不在 diff 内 ⇒ 接口变动会静默失效或假通过"。三把锁正是为这一格建的：§H 断言 `defaultsFor().materialize === LIVE.mergedTreeEvidence`（身份，改名/搬家当场红）、§N 用**真** `mergedTreeEvidence` 配假 git 断言返回值键集含 `baseline`、§O 用 `materialize: LIVE.mergedTreeEvidence` 端到端跑出 `rc=1 ⇒ WOULD-BE-RED`。"静默"这一半不成立：导出被改名时 `d.materialize(...)` 直接 TypeError，不是无声返回 OK。 |
| i2 | Critical | **否证（读的是判定记录格式，不属本 diff）** | 它说"`.ccg/reviews/*.json` 的 `sha` 字段是父提交而文件名是差异哈希，两者未显式关联 ⇒ 追溯链易断"。实测本刀两个工具都不读 `sha`：水位计按路径取内容再分类（`git log --name-only` 提供"哪个提交把这条记录带进主干"），预览只看 `deepReview.*` 与判据退出码。该"未关联"是判定器落盘格式的既有事实（入口当场打印"pre-commit 时新 commit 尚未生成，判定记录写在父 sha 上——预期行为"），要改它属另一刀。 |
| i3 | Critical | **否证（把"未完成"读成"不一致"）** | 它说 tasks 里 2.11b/2.12/5.1–5.7 未勾 ⇒ 交付阶段仍有缺口。逐项核对：这些行**本来就是**"记录回填 → 合并取证 → main push 回读 → 清理 → 记忆收敛"这条收尾链，勾选与证据一致（AGENTS 自动合并判据第 5 条防的是"勾选与证据不符"，不是"不许有未完成项"）。2.12 另在 §D14 登记为未闭合，含"做之前先读 `blockingGateInputs`"的前置。 |
| i4 | Warning | **采纳** | 成立的一半：本刀另两处仍在引行号——`qm6-tier-watermark.test.js` 的注释与红文案、「record 的根因句」。已改为按**模式名**描述（`scripts/*.js` 那条默认忽略），并把可复现的取证命令 `git check-ignore -v scripts/<名>.js` 写进注释（它自己会回显命中位置，行号不必由人抄）。`gitignore` 里我自己那一段本就不写行号；仓内既有的 23 处同款引用（`git grep -c '第 106 行' -- .gitignore` 现读）不属本刀差量，已记入未闭合清单。 |
| i5 | Warning（高危域 `crypto`） | **否证 + 按合同填三格** | 它说"gh 取不到列表时没有显式降级"。实测有：`preview` 在 `listed.rc!==0` 或非数组时打 `PREVIEW-SELF-FAULT gh pr list 取不到（rc=…）` + 「这**不是**"没有在飞 PR"」+ `exit 2`，与"零条 open"的 `prs=0 (none-open)` 退 0 是两条不同档（§D/§E 两条锁分别钉住）。域标签来自措辞，判 `dismissed` 仍须按 `externalReview` 三格解除：`performedBy=claude`、`evidenceRef=` 本轮公开评论 URL、`reviewedAt=` 该轮 critique 落盘 mtime。 |
| i6 | Warning | **采纳（它低估了后果）** | 它说"硬编码 `check-pr-exec-record.js` 路径 ⇒ 改名后预览无法运行"。真后果更糟：`node <不存在的路径>` 退 **1**，而 1 在本工具里就是"这条会红"——"工具读不到判据"会被记成一条修不动的债。已加存在性前置：缺席直接 `rc=2` + `stderr=checker-missing: <路径>`，归 `UNJUDGEABLE/self-check-fault`；`cmd` 仍带回**完整**命令行（只给两词会让人以为是拼错命令——这一格是写锁当场被 §H 抓出来的）。新锁 §V，变异 M-F12 实测只让 §V 一条红。 |
| i7 | Warning | **否证** | 它说"锁只看 PID + 命令行，PID 复用时可能错误接管或拒跑"。`acquireLock` 现读三条同时判：`mine`（锁内容含 `qm6-enforce-preview`）、`ageMs`（由锁里 `START=` 算，缺则记 `no-start`）、`ageLimitMs` 上限；接管原因**进返回值**（`not-mine`/`no-start`/`age=…s`）且活着时出声。§U 四条形态各自断言，"命令行不像就抢"与"只看 PID 就拒跑"两档都锁住。 |

三条 Critical 再次全部落在"格式既有事实 / 已有锁覆盖 / 收尾链的未完成项"上——这与轮 1、轮 2 同形，
所以本刀的结论仍是：**能不能出 `tier=external` 不取决于本片写得多干净，而取决于某一轮真跑是否零 Critical**
（合取③ 要 `performedBy` 逐字等于清单里的 critic，而只要进自扮演裁决就把 `performedBy` 写成 `self-play`）。
按 §D16 那条口径继续：修完 i4/i6 重投一笔，再跑一轮真外部（即 §D18 那一轮）；若仍给 Critical，按 `qm6-closure-writeback`
tasks 11.5 报人工，不自造闭环值、不手写 `tier`。

## D18 实现轴轮 3 的处置（critic=claude 真跑，head=8e6fe3c3，交付 8 条 / 待裁决 7 条：Critical 4 / Warning 3；最低维分 3）

本轮**高危域须外部复核 0 条**（`requiresExternalReview: []`）——轮 3 那格 `crypto` 标签来自指控
自身措辞里的「凭据」二字，本轮散文没踩到那个词。这印证了已登记的口径：**域标签是评审散文的函数，
不是被审代码的函数**，所以"这一轮要不要外部复核"不可预先规划。逐条先读码再处置：

| # | 级别 | 处置 | 取证 |
|---|---|---|---|
| i1 | Critical | **否证（指控已被本 diff 修掉）** | 它说"夹具把返回值摊平到顶层 ⇒ 15 条锁全绿而真跑每条都 unexpected-exit-undefined"。那是 §D15-① 记的**过去**：本轮 diff 里 `qm6-enforce-preview.test.js:70` 的夹具就是 `{ built, dir, baseline: inspect(dir), aTxt: null }`，§N（:246）用真实现断言键集含 `baseline`，§O（:259）经真 `mergedTreeEvidence` 跑通 `rc=1 ⇒ WOULD-BE-RED`。critic 把"文档承认错过"读成"代码还在错"。 |
| i2 | Critical | **采纳前提、落点不属本刀** | 7800 字符上限真实（实测边界 (8125,8145]），proposer 半轴确被静默切断。但本刀不产出后端合同，修法宿主是 `qm6-review-degradation-ladder`；已登记于 §D14-1 与记录遗留第 1 条，且那里明写"本刀的处置方式（认单轴）不是修法"。 |
| i3 | Critical | **采纳（本刀能修的那一半当场修掉）** | 它说"只给两个脚本加 negation、未重构规则 ⇒ 下一新文件仍会复现"。成立：§1.1.11 的判据面只有我自己两个配对。已新增 **§1.1.12**——从 workflow **可执行正文**抽出全部被 `node --test` 点名的 `scripts/*.test.js`（当场 98 个），同名实现在盘（56 个）即必须是**受跟踪文件**。判据取"跟踪"而非"有 negation"：实测 origin/main 有 3 个被跟踪却无 negation 的本体工作正常（被跟踪后默认忽略对其无效），若写成"必须有 negation"，这条锁会在合入当天红在三条与本次无关的历史文件上。两条规模下界（98 / 56）防"抽取退化成空集合 ⇒ 零违规看着像通过"。变异 **M-F13**（把抽取正则换成永不命中）只有下界那条红；**M-F14**（摘掉"未跟踪即红"那一格）让现场负控从红转绿——那个负控是一个在盘、未跟踪的同名实现，且它对 `git status --porcelain` **完全不可见**，正是本坑的现场形态。把默认忽略本身改成显式包含列表属"改谁来守门"，**未做**，仍留 §D14。 |
| i4 | Critical | **否证（把两种历史混成一种）** | 它说"D1 要派生测量、D12 拒 CI 打印档 ⇒ 无历史读数落点 ⇒ 无法做趋势对比，矛盾于提案自身目标"。趋势（§D5）量的是**被测量对象**的历史：`buildTrend` 从 `git log --diff-filter=A -- .ccg/reviews` 取每条记录最早加入的 committer 月份，与"我的读数有没有被存下来"无关，重取时它自然变长。确实没有落点的是"水位这个数随时间的变化"，而那正是 §D12 明写的取舍（本地重取 + 读数进 PR 评论），不是与提案矛盾。 |
| i5 | Warning | **采纳前提、缓存未做** | 中位 74.7 秒、30 条 ≈37 分钟、每条重建 worktree 都成立。已交付的缓解是 `--max` / `--only`（可手工分片，含"圈不到的号必须点名"）+ 逐行流式 + 单实例锁；**缓存与自动分批没做**，落点即 §D14-4 / tasks 2.12。本刀不谎称已解决。 |
| i6 | Warning | **否证** | 它说"交付记录写入 CHANGELOG 并标记'已落点'，与完成度不符"。本刀 CHANGELOG 条目四条里没有一条声称 2.12 / 5.x 完成；未闭合项在 §D14 与记录"遗留"里逐条点名，tasks 的 5.1–5.7 保持未勾。 |
| i7 | Warning | **否证（它读到的正是本轮刚修的那格）** | 它把 `checker-missing` 读成"把文件缺失伪装成判决失败"。归因方向相反：该档落 `UNJUDGEABLE/self-check-fault`（**不进**会红名单），而 `rc=1 ⇒ WOULD-BE-RED` 那条通道留给真债；§V + 变异 M-F12 就是为此。硬编码路径这一半它说得对，但改名时"整批改判不了"是可接受降级——判不了会在现场点名，不是判错。 |

**三轮同形这件事本身是证据**：实现轴轮 1/2/3 的 Critical 全部落在三类上——文档自述的已修事项、不属本刀的
既有事实、收尾链的未完成项。⇒ "每一轮都含 Critical"不是本片质量的函数，而是**验证层评分口径 +
把设计文档一起喂进 diff 载荷**的函数。这条要带给 11.5 的裁决：只要走自扮演，记录级 `performedBy`
就是 `self-play`，合取③ 永不满足 ⇒ 高危面拿不到工具署名；而"某一轮是否零 Critical"由评审模型
打分决定，不由被审内容决定。

## D19 实现轴轮 4 的处置（critic=claude 真跑，head=9cac5b08，交付 8 条 / 待裁决 6 条：Critical 2 / Warning 4；最低维分 3）

本轮高危域须外部复核仍是 **0 条**。两条采纳当场落成实码，四条否证，逐条先读码再写：

| # | 级别 | 处置 | 取证 |
|---|---|---|---|
| i1 | Critical | **否证（把"登记欠账"读成"谎报交付"）** | 它列 2.11b/2.12/5.1–5.7 与 §D14-1/§D14-4 未勾 ⇒ "本 PR 声称交付但实际为部分落地"。逐项核对：CHANGELOG 条目四条里没有一条声称这些完成；tasks 里它们保持未勾且各自写明前置与落点；§D14 的标题就是"未闭合（登记，不装作已闭合）"。AGENTS 自动合并判据第 5 条防的是**勾选与证据不符**，不是"不许有未完成项"。 |
| i2 | Critical | **否证（指控落在 hunk 上下文上，不是落在我的行上）** | 它说"`.gitignore` 新增的两条 negation 注释引用行号（第 106/261 行）"。当场量：`git diff HEAD^ HEAD -- .gitignore \| grep '^+' \| grep -c '第 106 行\|第 261 行'` = **0**；我这一段写的正是「刻意不写行号…判据在 §1.1.11 那条锁里」。它读到的是同一个 hunk 里**上游的 3 行上下文**（那 23 处同款引用属别人已合并的记录）。⇒ 由此得一条可复用判据：**"diff 里出现某串"不等于"本次新增了某串"**，归因必须按 `^+` 侧取，与 `check-branch-merged.js` 的"我的新增行/删除行"同一口径。 |
| i3 | Warning | **否证（两种成本混成一种）** | 它拿"预览单笔中位 74.7 秒、30 条 ≈37 分钟"去否证"派生测量/秒级可重取"。那句话的适用对象是**水位计**（当场重测 elapsed_ms=11993，n=3 同 ref 读数一致）；预览从未被承诺秒级，它的成本与"为什么不接每个 PR"写在 §D12/§D14-4。"本地重取不可替代历史趋势"同样不成立：§D5 的趋势取的是**被测量对象**在主干上的加入历史，与我的读数有没有被存下来无关（同 §D18-i4）。 |
| i4 | Warning | **否证（失效形态是响的，不是静的）** | 它说"若 `mergedTreeEvidence` 重构返回形状，预览会静默产生全 UNJUDGEABLE，而 §N/§O 只覆盖当前形状"。正是 §N 把"当前形状"钉成了契约：`res.baseline` 键不存在 ⇒ §N 当场红；运行期 `readVerdict` 取不到 ⇒ 归 `unexpected-exit-undefined` 并把实读 stdout 打进红文案（本机首跑就是这条路把形状错暴露出来的）。**改名/搬家会变响**，这条锁测的就是它声称的那一格。 |
| i5 | Warning | **采纳** | `--only` 此前对非法项是"点名 + 继续判剩下的"。它担心的手误成立且更具体：`--only=4334，4335`（中文逗号）会让整串变成一个非法项 ⇒ `only` 退化成空集，汇总行 `prs=0` 读起来完全像"圈定的都判完了"。现改为**拒绝运行**（`PREVIEW-SELF-FAULT --only 含非数字项` ⇒ `exit 2`，一条都不判），并与 `--max` 的"回落默认"刻意不对称——回落 max 是**多判**，丢弃 only 项是**少判一条却报判完**。变异 M-F15 实测只让 §K 那条红。 |
| i8 | Warning | **采纳（它指的机制用一条锁来收）** | 它说本 change 的文档高度自指（§D11…§D18 交叉引用密集），改一节其余易漂。成立，且"注释/文档会不会漂"在本仓从不由自觉保证，只由判据保证。新增 §1.1.13：扫本 change 的 proposal/design/tasks/spec 与执行记录，凡出现 `D<n>` 引用就要求 design.md 有对应的 `## D<n>` 小节；两条反失明下界（小节 ≥12、引用 ≥30）。变异 M-F16 用**造一个悬空引用**的方式做 A/B：造出来指名红（红文案打印那个不存在的小节号），摘掉判据后转绿。**这条锁上线后第一件事就是红在我自己的解释文字里**——我为了描述这次变异，把那个不存在的小节号原样写进了三处文档，被自己的判据当场抓到；正解按既有口径是改写转述，而不是给判据开豁免（开了豁免等于把「注释里可以写」变成「引用可以悬空」）。 |

采纳的两条都不是"文档级"缓解，各自有一条能红的锁（§K 扩展、§1.1.13）。
`--only` 的语义变更同步改了规格增量（`specs/qm6-review-chain/spec.md`），因为"非法值怎么办"
本身就是被验收的行为。

## D20 实现轴轮 5 的处置 + 11.5 那一格的机械证据（critic=claude 真跑，head=64ed6f26，交付 8 条 / 待裁决 7 条：Critical 4 / Warning 3；最低维分 2）

轮 5 的 7 条**全部**逐条填 `dismissed` 并给出现场判据，重跑入口走的是复用档
（`♻ 复用存档 critique（8 条）+ 已填完的裁决 —— 跳过模型调用`），零模型成本；引擎打出
`✅ 自扮演裁决未发现阻断项`，随后写回器打出这一行：

```
[ccg-review-writeback] 未写回 reason=backend-mismatch
  spoke=closed-status|findings-present|nonempty-findings
  detail=performedBy="self-play" 期望 "claude"
```

**这就是 `qm6-closure-writeback` tasks 11.5 缺的那一格的可复制证据**：五条合取里前三条当场点亮，
唯一不成立的是 `backend-matches`，而它不成立的原因不是"没跑外部评审"（本轮 critic 就是 claude 真跑），
是引擎只要走自扮演收口就把记录级 `performedBy` 无条件写成 `self-play`。读码现场（本机 vendor 副本，
行号随技能升级漂移，故只记形态不记位置）：`finalizeAdjudication` 里写 `performedBy: "self-play"`，
而验证层"零 Critical 直接出终态"那条出口写的是 `performedBy: cfg.critic` —— 五轮真跑一次都没走到那条。

随后 `check-pr-exec-record.js --mode=enforce` 的红因逐字是：

```
CCG 收口不成立 1 条 … tier 整段缺席 —— 无 base 可比、转变检测抓不到，高危面上按"凭空收口"拦
本次变更集命中高危面前缀 .github/workflows/ ⇒ 本集内所有收口只认 tier=external + 可核 evidence
```

| # | 级别 | 处置 | 判据 |
|---|---|---|---|
| i1 | Critical | 否证 | 它把 §D2 里"按目录划域 2041 文件 / 1964 命中"与 proposal 的"253 条 dual-closed"当成同一指标的两种分母。前者是**域划法对比**（且已被否证、正解是 `AUDIT_ARTIFACT_RE`），后者是 closed 集规模；而该指标的分母**当场打印**在 `total=` 字段里（本次 262）。 |
| i2 | Critical | **先否证、重读后改判采纳**（本刀唯一一次把自己的处置写窄了） | 它说预览会在合成合并里执行 `node <worktree>/scripts/check-pr-exec-record.js`，恶意 PR 可往该路径塞脚本，"无沙箱"。属性成立，但本刀的形态是**操作者按需本地调用** + 首末行 `PREVIEW-NOT-GATE` + 每条读数带实际 `cmd`，所以"跑了谁的代码"在现场可见。真正会踩这一格的是把它接进无人值守作业那一步 ⇒ 已写进 tasks 2.12 的前置条件（这三条在 CI 档都不成立，接之前必须先定执行面归属）。**重读之后追加采纳的那半**：`gitSafeEnv` 只剥 `GIT_*` 那一族（防的是测量对象被污染，不是防凭证外泄），而 `spawnSync` 不传 `env` 就是把**整份父环境**交进一段尚未评审的 PR 自带代码 ⇒ 操作者 shell 里的令牌直接进入别人的爆炸半径。这一格不必等 CI 接线，当场就能收：新增 `subjectEnv()` 在 `gitSafeEnv()` 之上再按**键名形态**剥一轮（`TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|KEY|COOKIE|SESSION`），保留 `PATH`（裁了它 node 自己就找不到，红会伪装成被测代码坏了）与后端选择器 `MP_QM6_CRITIC`。两条锁：`subjectEnv` 的纯函数档 + **接线档**（造一份真的会被执行的桩判据，让它自己回吐看见的键）。变异 M-F17（把 `env:` 退回默认继承）实测只让接线锁一条红，且桩回吐 `SECRET=leak`—— 证明摘掉那一格真的重开了口子。测试侧还自错一次：第一版 canary 取名 `MP_PREVIEW_CANARY` 不含凭证词⇒「它通过了」根本不是判据，红的其实是断言本身，与「夹具不得替被测方决定语义」同族。 |
| i3 | Critical | 否证（**这是新机制，不是新缺陷**） | 它指控本 commit 的 `.gitignore` 引用行号。实测 `git diff HEAD^ HEAD -- .gitignore \| grep '^+' \| grep -c '第 106 行\|第 261 行'` = **0**。它读到的是同一 hunk 的**上游上下文行**与本刀执行记录里那句**取证现场引文**。⇒ 由此显形一条必须上报的机制：**处置表本身在下一轮进了评审载荷**——我如实写下的每一条"已修/已否证"都会被重新报成新发现。轮 4/5 的 i2/i3 是同一形态。 |
| i4 | Critical | 否证 | 它说 proposal 的"unknown 桶刻意合并"与 §D11-i2 的"拆两个子读数"互斥。两句同时成立：合并的是**判据本体的桶语义**（字段缺席与字面值等效，水位计不得另起口径），拆开的是**水位计自己的构成展示**，且 §1.1.10 断言 `缺席 + 字面值 == 判据那一格`（本次 141 + 8 = 149）。 |
| i5 | Warning | 否证 | 未勾项 = "没做"的如实表达，各自带落点；AGENTS 第 5 条防的是勾选与证据**不符**。 |
| i6 | Warning | 采纳前提、宿主不属本刀 | proposer 轴被 7800 字符上限切断是事实，修法在 `qm6-review-degradation-ladder`；本刀按既有裁决"认单轴 + 登记缺轴"，并在遗留里明写那不是修法。 |
| i7 | Warning | 采纳为事实、不构成本刀可修项 | 它复述的正是 §D18/§D19 的结构性结论（五轮均自扮演 ⇒ 高危面拿不到工具署名）。处置就是把它量化并交给 11.5。 |

### 本刀由此交给下一刀的两句

1. **零 Critical 不由被审内容决定**：五轮 minScore = 3/3/3/3/2，而每轮的 Critical 至少有两条是
   "上一轮我自己写下的处置记录"。⇒ 若把"文档如实登记欠账"当成载荷的一部分，评审循环在结构上
   不可能收敛；要收敛必须先让判据把**新增侧**与**上下文/既有记录**分开（本轮 i3 的实测口径）。
2. **11.5 的修法候选**（都属改"谁来守门"，须人工过目）：① 写回器在 `externallyReviewed`/`blocking=0`
   且**本轮 critic 真跑过**时接受 `performedBy=self-play`；② 引擎在自扮演收口时把当轮 critic 名
   记进另一个字段（如 `adjudicatedAgainst`），写回器认它；③ 保持现状，高危面一律转人工。
   本刀不实现任何一条，只把"前三格已点亮、只差第三格"这个现场固化下来。

## D21 实现轴轮 6 的处置（critic=claude 真跑，head=eb57b405，交付 8 条 / 待裁决 8 条：Critical 4 / Warning 4；最低维分 3）

终轮。8 条全部逐条填 `dismissed` 并给现场判据，重跑入口走复用档，终值与轮 5 逐字同形：
`✅ 自扮演裁决未发现阻断项` + `reason=backend-mismatch spoke=closed-status|findings-present|nonempty-findings`。

本轮新出现的、值得留在文档里的两条（其余是 §D17–§D20 已处置过的同形指控）：

| # | 级别 | 处置 | 判据 |
|---|---|---|---|
| i5 | Warning | **否证（两个数都算全了，分母不同，且这是判定器自己的既有口径）** | 它怀疑"评审报变更 1422 行，但新增文件总行数明显超过 1422"。当场逐文件相加：全量增删 2411；非文档 1491；非文档且非 `.ccg` **1430**；判定器报 1422 —— 差额恰为 `.gitignore` 那 8 行（无扩展名，按 `isCodeFile` 不计入源码面）。判定器源码注释原文写着「把文档纳入 mode 判定会造成原来的假阳性 ⇒ 文档单列只报告、不改判定」。载荷侧 2507 行则是含文档的完整 diff。 |
| i1 | Critical | **否证（它说的是边界，不是漏做）** | 它指出 `subjectEnv` 只剥凭证形态的键，`PATH`/`MP_QM6_CRITIC` 仍下发、文件系统权限不受限。三条都成立，但结论不成立：这正是"本工具不是沙箱"那条边界的三个面，而该边界已写成 tasks 2.12 的**硬前置**（接进任何无人值守作业之前必须先定执行面归属与隔离）。本刀把**能被机械剥掉的那部分**剥掉并有两条锁（纯函数档 + 让桩判据自己回吐看见哪些键的接线档，变异 M-F17 摘掉 `env:` 时桩回吐 `SECRET=leak`）；把**需要架构决策的那部分**留在前置条件上。随手加一层假沙箱比不加更危险——它会让人以为已隔离。 |

其余 i2/i8（文档自指、四载体混装）是本仓 openspec 的约定形态，自指风险由 §1.1.13 的锁收；
i3（worktree/锁/时长）逐条对应 §H、§6、§2.5、§U 四条锁与 §D13/§D15 的实测成本；
i4（行号引用）第六次同形，`+` 侧命中数仍为 0；i6（negation 通配）本刀两条都是精确文件名；
i7（缓存未交付）留在 §D14-4 与记录遗留。

### 六轮汇总（这是本刀交给 11.5 的数据，不是牢骚）

| 轮 | head | 交付 | 待裁决 | Critical | 最低维分 | 高危域须外部复核 |
|---|---|---|---|---|---|---|
| 1 | 8738852a | 7 | 7 | 3 | 3 | — |
| 2 | bc6bc89e | 8 | 7 | 3 | 3 | 1（`crypto`，由"凭据"二字触发） |
| 3 | 8e6fe3c3 | 8 | 7 | 4 | 3 | 0 |
| 4 | 9cac5b08 | 8 | 6 | 2 | 3 | 0 |
| 5 | 64ed6f26 | 8 | 7 | 4 | 2 | 0 |
| 6 | eb57b405 | 8 | 8 | 4 | 3 | 0 |

六轮里被采纳并落成**能红的锁**的一共六条（§1.1.11、§V、§1.1.12、§1.1.13、`--only` 拒跑、`subjectEnv`），
每一轮都还有新的 Critical 出现 —— 且轮 3 之后**没有一条**是"实现里有洞"，全部落在
"文档自述的已修事项 / 既有格式事实 / 收尾链未完成项 / 边界与约定形态"这四类上。
⇒ **"零 Critical"不是本片质量的函数**；把它当成拿到 `tier=external` 的唯一入口，等于把机械收口
交给评审模型第 1 轮的打分分布。这就是 11.5 必须被裁决的理由，也是本刀把 `backend-mismatch`
这一行原样固化进记录的原因。

## D22 把 §D20 那三候选里的第 ② 种做掉：合取③ 的第二条出口（用户 2026-10-24 裁决授权）

裁决原文是「授权我在本片里直接放宽合取③」。落地时**不收成"performedBy 什么都行"**，
理由写进判据本身：合取③ 存在的目的不是"署名字符串相等"，而是"高危面不得由自扮演豁免"。
所以这一档的准入条件全部围绕"外部性是否真发生过 + 第三方能否核"来写：

| 条件 | 判的是哪一件 | 缺件时的红因 |
|---|---|---|
| `performedBy === "self-play"`（只认这一个值） | 声明自己是自扮演收口，而不是伪装直签 | `backend-mismatch` |
| `reviewBackends.critic === 清单 critic` | **本轮真调用过哪个后端**有落点，不由填写方自述 | `backend-request-mismatch` |
| `confidenceWeight < 1` | 这确实是一条自扮演记录（引擎只在自扮演档写 0.6），来历不明的记录不放行 | `confidence-weight-absent` |
| `blocking` 为空数组 | 没有未解除的阻断项 | `blocking-not-empty` |
| 每条 finding 有 `verdict` + 非空 `rationale` | "全部指控不成立"这句话有逐条证据 | `verdicts-incomplete` |
| 入口透传一条合法 PR 评论 URL | **第三方点得开**：critique 原文与逐条处置都在那条评论里 | `no-adjudication-evidence` / `adjudication-evidence-form` |

三条设计决定，写下来以免下个会话"顺手统一"：

1. **④ 与 ⑤ 一字不动，且对新档同样适用。** 否则一份手工写好的 self-play 闭环记录（字节与语义指纹
   都没在本题里动过）就能绕开"本次驱动刚产出"这一格被签上章——那比原洞更糟：原洞是"产不出章"，
   这样改会变成"谁能写文件谁就有章"。
2. **`evidence` 直接复用 URL，不新增第二套形态判据。** 判据早就认 `github.com/<o>/<r>/pull/<n>#issuecomment-<id>`
   （那是引擎裁决模板要求的形状，#4158/#4199/#4234 都走它），再造一种只会多一处漂移点。
   另加 `adjudicationDigest = adjudicated@sha256(deliveryEvidence(findings) ‖ NUL ‖ url)`：
   只判形态时"挂了另一条也长得像评论的 URL"与"这次真公开复核过"逐字同形，绑进哈希后任换其一即降档。
3. **不引入新的 `tier` 值。** 表达"哪条出口"的是新字段 `tierBasis`，矩阵侧闭集不变；
   未知 `tierBasis` 一律 `unrecognized`（新字段同样进闭集，别让它长成自由文本）。
   分档在 `TIER-COVERAGE` 行里以 `[external(直签)=a external(自扮演+公开复核)=b]` 打印，
   `a + b == external` 由判据侧构造保证、由两套锁各钉一次（判据自己的测试 + 本片的 §1.1.14），
   水位侧还有一条"不等式破了就出声"的检查——它上线时自己先错了一次（拿 `sum.external` 而不是
   `sum.by.external` 比，恒真地喊 defect），被 §1.1.14 当场抓回。

**本刀自己就是第一个用户**：#4308 命中 `.github/workflows/`，六轮真跑全部 self-play 收口。
因此这条出口被使用的现场，就是本 PR 把自己的 critique + 逐条处置贴成公开评论、
再由 `sh scripts/deep-review.sh --evidence=<该评论 URL>` 让工具自己写 `tier=external`。
这是刻意选的自证路径，也是它必须分档可见的原因：**同一把刀给自己盖的章，只有那条链接能被别人点开**。

未做的两件事（不是遗漏）：① 不改仓外引擎的 `finalizeAdjudication` 署名（候选②的另一半）——
那属 vendor 制品，本仓惯例是不私改副本；② 不把 `needs_revision` 之类人工状态词纳入新档的准入条件，
那会让"人工放宽"与"工具署名"混在同一格里，正是要分开的两件事。

## D23 rebase 之后复跑抓到的第三种落点：夹具那份手抄复制清单会腐烂

**现场**：把分支从 `33104c8ac` rebase 到 `c2c0bb085` 后重跑消费者并集，
`deep-review-entry-rc.test.js` 红 6 条。红文案是
`⚠ 写回器自身未能运行 … Error: Cannot find module './lib/exec-record-statuses'`，
读起来像我把写回器改坏了，实际实现一行没动。

**归因取证**（两条都要，缺一条就写不成结论）：
`git show 33104c8ac:scripts/check-pr-exec-record.js | grep -c exec-record-statuses` = **0**，
`git show c2c0bb085:… | grep -c` = **2**，`git log 33104c8ac..c2c0bb085 -- <该文件>` 唯一命中
`40e1fb1ba (#4093)`。⇒ 主干把本地状态词字面量换成了共享模块 require，而本测试的
`SCRIPT_CLOSURE`（临时仓库里要复制哪些文件）是**手抄清单**，没人跟着改。

**为什么这条值得写进设计而不只是改一行**：AGENTS 的「门禁断言随平台/实现迁移同步」列了
一批必须同改的文件，那份清单是**语义级**的（谁断言了 workflow 结构、谁钉了 step 名），
而 `SCRIPT_CLOSURE` 是**结构级**的依赖边——它不写在任何规格里，只在"某文件恰好 require 了某文件"
这个事实里。这类边一旦上游新增，任何只跑**我自己那两个文件**的验证都看不见，
而真跑锁的失败点又在**子进程**里：错误经过一层 shell 包装，指不到"清单少一行"。

**处置口径：补一件不够，必须补两件。**
① 清单补两项。**其中第二项 `lib/exec-record-audit.js` 是懒 require**（只在 `--audit` 档加载），
所以它压根没让那 6 条真跑红——只补第一项就是把同一颗雷原地留下，等下一个会话在审计档踩。
② 把"清单是否覆盖 require 闭包"变成**指名判据**：本文件第一条锁扫描 `SCRIPT_CLOSURE` 里每个
`.js` 的静态 `require('./…')`，逐个要求在清单内，缺哪个就点哪个文件。它当场又抓到一次
（就是 ① 里那条懒 require），也就是说这条锁**先于任何真跑**给出了同一个答案，代价从
"6 条红 + 一层误导性文案"降到"1 条红 + 直接点名"。

**如实记录的边界**：锁只认引号形态的静态 require，模板串与动态 `require(expr)` 扫不到；
另有一条反失明下界（命中数必须 > 0），否则"清单全覆盖"和"扫描器什么都没看见"逐字同形。

**结局（写在同一节里，不留到下一个会话去猜）**：#4347 先落地，带同一断链的修复与一把同用途守卫 ⑫，
且解析面比我那版宽（`../` / `.js` / `index.js` 三种还原，"仓内找不到该文件"单列出）。
本刀因此**撤回自己那一版**：rebase 时该测试文件整取主干 blob，只把本刀真正需要的 ④ 加宽重放上去
（两个被拒原因各测一格：`Claude` 与清单不符 ⇒ `backend-mismatch`；`self-play` 未带公开复核 ⇒
`no-adjudication-evidence`）。两把守卫防的格子不同，差异如实记在这里而不是"已被覆盖"：
主干那把在**整表命中 0 条**时照样通过（`missing` 为空即断言成立），我那半的 `hits > 0`
防的正是"扫描正则退化 ⇒ 一条也没扫到"。这一格**未合入**，登记为未做。

## D24 实现轴轮 7 的处置 + **第二条出口第一次真实自用**（critic=claude 真跑，head=b4cf66e4，交付 8 条 / 待裁决 6 条：Critical 3 / Warning 3；最低维分 4）

这一轮是本 PR 的**验收轮**：前六轮全部 exit 到 `reason=backend-mismatch`，本轮要回答的是
§D22 那条出口在真实链路上到底能不能让工具自己写出 `tier=external`。现场读数（入口原文）：

```
♻ 复用存档 critique（8 条）+ 已填完的裁决 —— 跳过模型调用
✅ 自扮演裁决未发现阻断项
[ccg-review-writeback] 已写回 tier=external basis=adjudicated-self-play
  evidence=https://github.com/Colinchiu007/mulpub/pull/4308#issuecomment-6378271670
  spoke=closed-status|findings-present|nonempty-findings|adjudication-conditions|delivery-changed
```

**五格全亮**，包括 ④ `delivery-changed`——这条是刻意留的：出口只能把「第三格」换成「六件前置」，
**不得**顺手把「本次驱动刚产出」这一格一起免掉。逐条处置（全文与 critique 原文在公开评论里）：

| 条 | 级别 | 裁决 | 判据（可复跑，不写结论） |
|---|---|---|---|
| i1 | Critical | dismissed | 它复述的是设计**已声明并拒绝冒充**的边界（`grep -n "这不是签名" AGENTS.md` 命中本 PR 新写那句）；可检性由两件事承担：`adjudicationDigest` 绑 findings+URL（失配降 `external-unverified`）、分档可见（水位 `external-自扮演复核=` 从 0 起算，用了就显出来） |
| i2 | Critical | dismissed | `git diff HEAD^ HEAD -- .gitignore \| grep "^+" \| grep -cE "第 [0-9]+ 行"` = **0**；`grep -cF "第 261 行" .gitignore` = **0**（该字面量本仓不存在）。"第 106 行" 23 处全是同一 hunk 的上游上下文行——与本 PR 轮 4 的 i2 同型 |
| i3 | Critical | dismissed | `grep -rn "qm6-enforce-preview\.js" .github/workflows/ \| grep -v test.js \| wc -l` = **0** ⇒ 它指控的"已接入 CI 因而烧预算"这个前提不存在；接线本体是 tasks 2.12 的**未勾欠账**，且带两条前置 |
| i4 | Warning | dismissed（登记为未做） | 实现侧行为由三个测试文件指名钉住（29 / 142 / §1.1.14）；「给 AGENTS 文字加机械同步」是把文档纳入机器判定域，属 #4261 那一族独立一刀，本刀不夹带 |
| i5 | Warning（高危域 crypto） | dismissed + **externalReview 三格齐填** | 它描述的是轮 1–6 的历史（那六轮跑在出口存在之前）。本轮交付确实来自 critic=claude（入口日志原文），故按模板填 `performedBy=claude` / `evidenceRef=<本轮公开评论>` / `reviewedAt`——高危面不得自扮演豁免这条纪律**没有被放宽**，它要的是外部后端的真实交付 + 公开可核出处，二者本轮实际具备 |
| i6 | Warning | dismissed | 清单完整性锁在主干 `ff1d09cfb(#4347)` 的 ⑫ 里（认 `../`/`.js`/`index.js`，"仓内找不到该文件"单列）；本刀整取该 blob、不并存第二把同用途锁。残余如实记：⑫ 在"整表命中 0 条"时照样通过，本刀撤回那版的 `hits > 0` 防的正是这一格，**未合入** |

**一处必须点名的运行现实**：本轮第一次调用 critic 时 `输出解析失败且内容很短（3582 字符）`，
引擎按"模型中断"重试一次才拿到 8 条。这不是缺陷（重试档存在且生效），但它再次证明
**按交付条数判死活**（本仓既有纪律）是对的——若按"调用返回了"判，这一轮会被记成零交付。

**六条全部 dismissed 而 blocking=0**，且这个 0 不是自扮演的施舍：`blocking` 由引擎在裁决表填齐、
高危域三格齐备之后自己写；写回器只读它、不改它。判据最终读数：
`check-pr-exec-record.js --base=origin/main --mode=enforce --no-remote` **rc=0**，同一次跑打印
`TIER-COVERAGE dual-closed total=1 external=1 [external(直签)=0 external(自扮演+公开复核)=1]`。
