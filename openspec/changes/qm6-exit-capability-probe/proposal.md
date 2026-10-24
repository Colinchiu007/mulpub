# Proposal: 收口出口的可达性必须是读数，而且这个读数被删掉要能发现（qm6-exit-capability-probe）

> 本刀是**探测器**，不是拆闸。用户 2026-10-23 裁决：按 `qm6-zero-human-closure`（PR #4304，OPEN、只交付规格）
> 写的顺序走 —— **探测器先于拆闸**。所以本 change 一行都不改"谁来守门"的判据，
> 只把三格出口的可达性变成常驻读数，并补上"这份读数被人删掉"的检出能力。

## Why：一次已经发生的静默撤销，加两格今天量到的墙

### ① 主干现在**打印假结论**，而它自己报 AS_EXPECTED

2026-10-20 有两笔相邻的合并：

| 提交 | 时间(+08) | 内容 |
| --- | --- | --- |
| `4d7c32535`（PR **#4067**） | 14:36 | 把收敛出口探针改成**现读** vendor 能否表达外部复核，旧「不可达」结论不再写死 |
| `8fdd617b2`（PR **#4062**） | 19:47 | 一个 s2v 错误码修复（`fix(s2v): 历史记录失败卡片直出英文技术原文`），**同时删掉了 #4067 在三个文件里的全部改动** |

`git show --stat 8fdd617b2` 当场读数：`scripts/ccg-convergence-probe.js 22 +-------`、
`scripts/ccg-convergence-probe.test.js 25 -----`、`openspec/changes/ccg-convergence-exit/tasks.md 31 ---`。
根因不是"改坏了"，是**叠片携带评审前的旧副本**：那条 s2v 分支的基线早于 #4067，squash 落地时把旧副本整份带进去，
上游那一刀被逐字撤销，而**两层判据都没有响**——因为撤销同时删掉了"发现它"的那条测试（P9），
剩下的探针照旧打印被撤销前的结论。

今天的现场（全部当场跑）：

```
$ node scripts/ccg-convergence-probe.js --json | jq .verdict   → AS_EXPECTED   problems=[]
$ 探针 stdout 结论行 → "self-play 对 crypto 项无条件计阻断 ⇒ 深度审查闭环在含 crypto 发现的 diff 上不可达"
$ vendor ccg-deep-review.js 里 /function externalReviewSatisfied/ → true
```

三行放在一起就是矛盾：**vendor 已经能表达"外部复核三格齐备即解除阻断"，而常驻探针仍断言"无条件计阻断"，并且判"符合预期"**。
这不是"结论旧了"，是判据在**主动生产一条假话**，而没有任何东西能发现 —— 正是本仓定性的「装饰性门禁」的完成形态。

### ② 两格真实存在的墙，现在只存在于会话记忆里

- **upheld 那一格**（用户点名的 `blockingFromAdjudication`）：vendor 里 `if (i.verdict === 'upheld') blocking.push(...)`
  没有任何解除臂（当场正则读数：`/verdict === 'upheld'[\s\S]{0,220}?resolved/` → **false**）。
  ⇒ 一条评审意见被判成立且当场修好，机制上**永久**读成阻断。
- **工具署名那一格**（本刀新量到的）：`scripts/ccg-review-writeback.js` 的合取 ③ 原文是 `dr.performedBy === expected`，
  仓内**没有**任何第二条路（正则 `findingsBy|externalDelivery` → false）。而 `performedBy` 在自扮演出口下恒为 `self-play`。
  ⇒ 2026-10-23 的 PR **#4305** 现场：四条裁决**全部 dismissed**、`blocking=[]`、`status=self_play_resolved`，
  写回工具仍当场拒签并出声 `reason=backend-mismatch detail=performedBy="self-play" 期望 "claude"`。
  这条读数**否证**了此前对这条链的描述（"`tier=external` 在**有任何一条被判成立**时拿不到"）——
  触发条件不是"有没有 upheld"，而是"**收口来自哪条出口**"。它现在只活在 #4305 的执行记录里。

## 打算做什么（Details）

1. **恢复** #4067 被撤销的那一半（探针的现读能力 + 它当时那条唯一会红的用例 + `ccg-convergence-exit/tasks.md` 那 31 行），
   —— 注意编号歧义：那一格在 #4067 里叫 P9，而今天的 P9 是本刀的新用例（第三方 require 的反向夹具），两回事，见 tasks §10.7。
   并把它**扩成三格出口**，每格都是读数不是散文：
   - `externalReviewCapable`（vendor 驱动）：解除谓词被**定义**且驱动把期望后端写进裁决模板 ⇒ 在位。
   - `upheldExitCapable`（vendor 驱动）：`upheld` 臂有没有解除路。
   - `toolSignatureCapable`（**仓内** `ccg-review-writeback.js`）：合取 ③ 除了 `performedBy === expected` 还有没有别的路。
     这一格刻意不依赖 vendor —— CI runner 上跑得动，是**可复现**读数。
   三条都住在独立模块 `scripts/qm6-exit-capabilities.js`，探针只 `require` 它（谓词与探针同文件 ⇒ 撤销一次同时带走实现和"发现实现丢失"的断言）。
2. **结论行由读数生成**：探针最后那句「…不可达」必须按三格读数改写；三格任一在位而结论仍写"不可达"，
   用例直接红（把"写死结论"这条路本身钉掉）。
3. **撤销检出**：谓词与契约锁各住一个**新文件**（`scripts/qm6-exit-capabilities.js` / `scripts/qm6-exit-capabilities.test.js`）。
   为什么必须换文件：#4067 的那条检测与探针**同批被删**，所以"同一批文件里的锁"对这类撤销结构性无效。
   契约锁只 `require` 谓词模块，断言三条谓词在**两版实现给出不同答案的输入**上确实不同（#4261 的口径），
   于是"删掉能力/删掉谓词/把结论写死"三种动作都会让它红，而它不在任何叠片会携带的旧副本里。
4. **双路读数（结构 + 行为）**：`upheld` 那格除了结构谓词，还在 vendor 在位时 `require` 真驱动、
   喂"无凭证 / 带齐凭证"两份合成裁决各调一次 `blockingFromAdjudication`；两路答案不一致 ⇒ 探针 rc=1 并点名
   "结构读法失效"（不自动采用任何一路）。这道交叉是本刀把"出口有没有"从**被声明量**变成**被测量量**的关键动作。
5. **接线**：`quality-gate.yml` 的 `Gate 2b6` 已经跑 `ccg-convergence-probe.test.js` —— 同一步点名新契约锁；
   本机档额外要求 vendor 在位时结论行必须含三格读数。
6. **不做**（写清楚以免被读成半个拆闸）：
   - 不改 `blockingFromAdjudication` 的语义、不改 `ccg-review-writeback.js` 的合取、不改 `HIGH_RISK_SURFACES`、
     不扩闭环词表 —— 这四条都在 #4304 的 D1/拆闸范围里，顺序上必须在探测器之后。
   - 不把 #4062 那笔撤销"改回来"成一次 revert PR：那是重写已合并历史；本刀直接前滚（恢复 + 扩展 + 加检出）。
   - 不新增跨调用状态账（计数不得挂在内容寻址的记录名上 —— #4297 已实测，本刀结构性不引用记录名）。
7. **第 4 条的落地方式在实施中被现场否证后改过两次**（`vm` → `require` → `require` 前置可加载性判据），
   最终口径与理由写在 design §1.2 / §1.4：探针**不得**在 require 期执行一份顶层裸调 `main()` 的驱动，
   且行为档那三条锁的前提必须是仓库内的东西（自建夹具），不得是本机那份未提交的 vendor 补丁。

## 改动文件面（供决策层范围比对）

- `scripts/qm6-exit-capabilities.js` —— 三条纯谓词 + 行为档 + 正控 + 交叉比较 + 结论生成 + `driverLoadability`（判据本体）
- `scripts/qm6-exit-capabilities.test.js` —— 契约锁（住在第三个文件里的那一份）
- `scripts/qm6-exit-capabilities.mutation.js` —— 变异反证驱动（含驱动自身的单实例锁与基线卫生）
- `scripts/ccg-convergence-probe.js` —— 探针：接读数器、接双路交叉、接可加载性判据
- `scripts/ccg-convergence-probe.test.js` —— 探针既有锁 + 自建 vendor 夹具的行为档/交叉/不执行三条锁
- `.github/workflows/quality-gate.yml` —— `Gate 2b6` 点名新契约锁（高危面只有这一格）
- `.gitignore` —— 三个新脚本的放行 negation
- `openspec/changes/qm6-exit-capability-probe/**` —— 本 change 四件套
- `openspec/changes/ccg-convergence-exit/tasks.md` —— 前滚恢复被撤销的那 31 行 + §10.7 现状补记

## 现场读数（2026-10-23，重取命令逐条附）

| 量 | 读数 | 重取 |
| --- | --- | --- |
| #4067 落地版本有谓词、现版没有 | `true` / `false` | `git show 4d7c32535:scripts/ccg-convergence-probe.js \| grep -c externalReviewCapable` 对照现文件 |
| #4062 撤销的规模 | 探针 −21/+1、测试 −25/±0、tasks −31 | `git show --stat 8fdd617b2` |
| vendor 能表达外部复核 | `true` | 现读驱动源码里的 `function externalReviewSatisfied(` |
| vendor 对 upheld 有解除臂 | **`false`** | `blockingFromAdjudication` 函数体 |
| 仓内写回器有第二条署名路 | **`false`** | `scripts/ccg-review-writeback.js` 的 `dr.performedBy === expected` 一处，无 `findingsBy`/`externalDelivery` |
| PR #4305 的实测拒签 | `reason=backend-mismatch`，`blocking=[]`、`status=self_play_resolved` 时仍发生 | 该 PR 的深审终跑日志与执行记录 QM-6 节 |
| 探针当前自证 | `verdict=AS_EXPECTED problems=[]` 而结论行是假话 | `node scripts/ccg-convergence-probe.js --json` |
