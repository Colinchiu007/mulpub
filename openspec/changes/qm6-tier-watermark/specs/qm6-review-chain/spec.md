## ADDED Requirements

### Requirement: 外部出处覆盖率必须可一句话重取，且不得为此新增追加型载体

系统 SHALL 提供一条命令，从主干历史**派生**出 QM-6 外部出处的全量覆盖率
（`external` / `external-unverified` / `self-play` / `none` / `unknown` / `unrecognized`），
并在同一次输出里给出按提交日期分桶的趋势。该读数 SHALL NOT 依赖任何"每轮往文件追加一行"的载体
——本仓已因追加型共享写面（`.quality-gates.md`、`gate-record-debt-ledger.json`、
`CHANGELOG.md`、`01-docs/learnings.md`）的并发撞车把前两者冻结、把后两者收给聚合器，
再开第三个同形状写面等于把同一循环再造一遍。

趋势必须来自 `git log --diff-filter=A` 的**派生**，且输出必须同时打印这条边界：
产物名是内容寻址的，`amend`/rebase 会换名，因此趋势表达"当前主干上这批对象各自何时首次出现"，
**不得**被读成"外部评审的绝对发生次数"。

判据成本 MUST 实测：全量派生读数的可重取性以"秒级"为前提——分钟级的工具事实上不会被任何人重跑，
它退化成一次性的量测（本仓把它记作"量过一次没人再量"）。

#### Scenario: 一条命令重取全量水位

- **WHEN** 在仓库任意工作区执行 `node scripts/qm6-tier-watermark.js`
- **THEN** 必须打印以 `TIER-WATERMARK main=` 开头的读数行，六个档全部出现（空集也必须出行）
- **AND** 同一次运行必须打印可重取的取数耗时，供后来者判断"这条命令值不值得跑"

#### Scenario: 取不到主干 ref 时不得打空读数

- **WHEN** 主干 ref 解析失败（浅克隆、ref 不存在、git 自身故障）
- **THEN** 打印 `WATERMARK-SELF-FAULT` 并以 `2` 退出
- **AND** 不得打印 `total=0` 后以 `0` 退出——"零份产物"与"探针取不到东西"必须可区分

### Requirement: 水位读数的扫描域必须由判据的正则持有，并自报域外条数

水位计的扫描域 SHALL 是判据自己的 `AUDIT_ARTIFACT_RE` 所命中的对象集，
取对象列表用 `git ls-tree`，SHALL NOT 用目录 `readdir` 的结果当分母；
读数行 MUST 打印 `域外=N`。

取 blob 只能经**单进程** `git cat-file --batch`，并按帧头声明的**字节长度**切 body：
判定产物是多行 JSON，按行切会把一条记录劈成若干帧，进而把完好的产物读成解析失败。
逐文件 `git show`（2041 次进程创建，实测超 5 分钟不完成）SHALL NOT 用于全量取数。

tier 的分类判据 MUST 只有一份实现：水位计 SHALL `require` 判据本体的分类函数，
SHALL NOT 自行判断"字段值像不像 external"。

#### Scenario: 自称 external 但出处不可核，必须降档而不是计入 external

- **WHEN** 一份 `mode=dual`、`status=cleared` 的产物写着 `tier="external"` 且 `evidence` 是不可核的形状（例如单个字符）
- **THEN** 水位行必须是 `external=0 external-unverified=1`
- **AND** 这条输入是"复用判据 vs 自写一份"两版实现答案不同的那一格；写不出这条输入，说明该锁测不到它声称的东西

#### Scenario: 域外对象不得进入分母，但必须被看见

- **WHEN** `.ccg/reviews/` 里混有非判定产物形态的文件（实测主干上有 77 份别的工作会话提交的 `brief-*.md` 任务书）
- **THEN** 它们 MUST NOT 计入 `total`
- **AND** 读数行 MUST 打印 `域外=77` 这样的实际条数，并提示域由正则划、不由目录划
- **AND** 多行 JSON 的产物 MUST 被计为一条记录

#### Scenario: 存在性探针缺省必须出声

- **WHEN** 调用方未注入 `existsAt`（`evidence` 为仓内路径形态时无人能验它是否真的存在）
- **THEN** 水位行 MUST 打印 `probe=off`
- **AND** 不得把"没验"读成"验过了"

### Requirement: 假想 enforce 的读数必须自称不是门禁，并区分「没红」与「没判」

`scripts/qm6-enforce-preview.js` SHALL 对每条在飞 PR 在**合成合并态**里运行
`check-pr-exec-record.js --mode=enforce`，用来回答"今天真把 CI 那一步转成阻断，会红哪几条"。
它 MUST 复用既有的合成合并装配（`merge-tree → commit-tree → worktree add → 跑判据 → 移除`），
SHALL NOT 出现第二份该链条的实现。

该工具的每条读数 MUST 在**任何 per-PR 行之前**打印它不是门禁判决
（真实拦截只发生在 CI 的 `QG Changes`），并在末尾再打印一次。
取不到 PR ref、merge-tree 不可判、合成提交或 worktree 建不起来，一律落 `UNJUDGEABLE` 并点名缺哪一段，
SHALL NOT 被计入"这条 PR 不会红"。

它 MUST 以 `--no-remote` 运行：本工具的定位是本地一条命令，默认路径会去查远端分支集合（网络动作），
在无凭据的机器上会产出一串归因不到的失败。

#### Scenario: 命令行必须逐字带 enforce 与 no-remote

- **WHEN** 注入假 git / 假 gh 跑一次预览
- **THEN** 在合成 worktree 里被调起的命令行 MUST 同时包含 `--mode=enforce` 与 `--no-remote`
- **AND** 摘掉 `--no-remote` 必须让该锁变红

#### Scenario: 零条在飞与取不到列表不得同形

- **WHEN** 仓库确实没有 open PR
- **THEN** 打印 `prs=0 (none-open)` 并以 `0` 退出
- **AND** 而"列不出来"（gh 失败 / 解析失败）MUST 以 `2` 退出并打印归因
- **AND** 至少一条 `WOULD-BE-RED` 时以 `1` 退出——那是产出，不是故障

#### Scenario: 单实例与信号卫生

- **WHEN** 已有另一个预览实例在跑（锁文件存在且其 PID 仍存活）
- **THEN** 后来者 MUST 拒绝运行（`2`）并点名持有者 PID
- **AND** 收到 `SIGINT`/`SIGTERM`/`SIGHUP` 或抛未捕获异常时，MUST 先移除自己创建的 worktree 再退出
      （残留在 `os.tmpdir()` 的登记条目会让后续 worktree 清理被 busy holders 挡住，本仓有先例）

#### Scenario: 跨模块返回值形状不得由夹具代定

- **WHEN** 预览从合成合并的返回值里取判据读数
- **THEN** 该形状（真实实现把 `inspect` 的结果挂在 `baseline` 键下，与它自带的 `aTxt` 并列）
  MUST 由**调用真实现**的锁钉住，SHALL NOT 只靠替身的形状保证——本刀实测：替身把返回值
  摊平到顶层，15 条锁全绿，而本机真跑时每条 PR 都归成 `unexpected-exit-undefined`
- **AND** 至少一条端到端锁必须用真的合成合并实现（只假 git）跑通"判据 rc=1 ⇒ `WOULD-BE-RED`"
- **AND** 逐行流式交付 MUST 被锁住（`onLine` 序列与最终 stdout 逐行相等）：
  跑几十条时全程无输出，与"工具坏了"在操作者眼里同形

#### Scenario: 圈定面遇到非法项必须拒跑，不得"少判一条却报判完"

- **WHEN** `--only=` 含非数字项（实测手误形态：`4334，4335` 用中文逗号，整串变成一个非法项，
  圈定集退化成空集）
- **THEN** 预览 MUST 以「自身故障」档结束（退出码 `2`），输出 `PREVIEW-SELF-FAULT --only 含非数字项（…）`
  并给出不含被禁字面量的正解，且**一条 PR 都不得被判定**（输出里不得出现 `pr=` 行）
- **AND** 该行为与 `--max` 的非法值处理**刻意不对称**，且不对称必须被写下来而不是被"统一"掉：
  `--max` 非法 ⇒ 回落默认（多判，方向安全）；`--only` 非法 ⇒ 拒跑（少判一条而汇总行读起来像判完，
  方向不安全）。回归锁 §K 同时断言两者，任一方被改成与另一方同形即红
- **AND** 拒绝档仍须首尾各打一次 `PREVIEW-NOT-GATE`，否则这份输出被贴进 PR 时没人知道它不是判决

### Requirement: 自扮演收口只有在「本轮真调用过清单里的 critic 且带公开可核复核」时才可作为 `tier=external` 的第二条出口，且这一档必须与直签档分开可见

授权来源：用户在 2026-10-24 就 PR #4308 的三选一裁决中明确选择「在本片里放宽合取③」。
本要求把那次授权**收窄成一条可判据化的路径**，而不是把合取③整体删掉——原五格合取在验证层
直签档逐字保持不变，本条只新增一档，并强制该档**在覆盖率读数里单独显形**（否则"改宽"不可见，
正是零人工收口立项点名的第二条病根）。

`scripts/ccg-review-writeback.js` SHALL NOT 因为 `deepReview.performedBy` 不等于清单里的 critic
就一律拒写；当且仅当下列全部成立时，MUST 以 `tierBasis="adjudicated-self-play"` 写入
`tier="external"`：`performedBy` 逐字等于 `self-play`；本轮请求的后端（`reviewBackends.critic`）
逐字等于上层透传的期望 critic；`blocking` 是空数组；`findings` 每一条都带 `verdict` 与非空 `rationale`；
`confidenceWeight` 存在且小于 1；上层显式透传一条**公开可核的 PR 评论 URL**
（`https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id>`，即判据既有 `url` 档）。
任一不成立 ⇒ 不写，且红因必须点名缺的是上面哪一格（不得合并成一句"条件不满足"）。

写入时 `evidence` MUST 是该 URL（复用判据既有 `url` 形态，不新增第二套形态判据），并 MUST 同时落一条
`adjudicationDigest = "adjudicated@<sha256(deliveryEvidence(findings) + NUL + url)>"` 作为**就地重算**的绑定：
判据侧用同一实现重算，不等即降 `external-unverified`。把 URL 绑进哈希的理由是——只判形态时，
「换一条别的公开评论 URL」与「这条记录真的对应那次公开复核」在字节上无法区分。

`summarizeTierCoverage` MUST 把 `external` 拆成 `external(直签)` 与 `external(自扮演+公开复核)` 两个子读数，
且两子读数之和 MUST 等于 `external`（同 `unknown` 那一对子读数的口径）。派生工具（水位计）
SHALL 打印同样的分档，SHALL NOT 用新的 `tier` 值去表达这一档——那会把矩阵的闭集撑开，
把"哪些产物是工具直签、哪些是带公开复核的自扮演收口"这个区分抹平。

#### Scenario: 五格齐备的自扮演收口 + 公开复核 URL ⇒ 写入，且来源被显式声明

- **WHEN** 记录 `status=self_play_resolved`、`performedBy="self-play"`、`reviewBackends.critic` 等于期望后端、
  `blocking=[]`、每条 finding 都有 `verdict` 与非空 `rationale`、`confidenceWeight=0.6`，
  且上层透传 `--adjudication-evidence=<一条合法 PR 评论 URL>`
- **THEN** 写入 `tier="external"` 与 `tierBasis="adjudicated-self-play"`，`evidence` 逐字等于那条 URL
- **AND** 同时落 `adjudicationDigest`；判据侧用真实现重算必须相等（换 URL 或换 findings 即降档，不得仍判 `external`）
- **AND** 覆盖率读数里这一格计入 `external(自扮演+公开复核)`，**不**混进 `external(直签)`

#### Scenario: 缺公开复核就退回拒写，且红因点名是哪一格

- **WHEN** 同样的记录但不带 `--adjudication-evidence=`
- **THEN** 不写，`reason=no-adjudication-evidence`（不得复用 `backend-mismatch` 那句文案——
  它会把"忘了传 URL"读成"根本没跑外部评审"，而这两件事的修法完全相反）
- **AND** `evidence` 传了但不是合法 PR 评论 URL ⇒ `reason=adjudication-evidence-form`
- **AND** `blocking` 非空 ⇒ `reason=blocking-not-empty`；有 finding 缺 `verdict`/`rationale`
  ⇒ `reason=verdicts-incomplete`；`reviewBackends.critic` 与期望后端不一致 ⇒ `reason=backend-request-mismatch`
- **AND** `performedBy` 既不是期望后端也不是 `self-play`（例如写成别的模型名）⇒ 仍走 `backend-mismatch`，
  新档**不**为它开门

#### Scenario: 直签档一字不动

- **WHEN** 验证层零 Critical 直接出终态（`performedBy` 逐字等于 critic）
- **THEN** 走原五格合取，`tierBasis` 缺席，`evidence` 仍是 `delivery@` 摘要
- **AND** 任何把直签档也改成本条形态的改动 MUST 让既有回归锁变红（那等于把已交付的签名链换掉）
