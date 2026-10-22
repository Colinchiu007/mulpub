# Proposal: 闭环值的写入方收敛到仓内驱动（qm6-closure-writeback）

> 本 change 是 `ccg-review-degradation-ladder` **tasks 8.1b** 的落地片，但**换了 8.1b 原来假设的落点**：
> 8.1b 写的是「落点在仓外引擎」，本片取证后证明仓外那条路会把本仓门禁变成跨仓依赖，
> 因此改落在**仓内驱动侧写回**。偏差的完整理由与实测见 design §1，不是偷偷改范围。

## Why

> **读法提示（实现片落地后补）**：本节与 design §1/§2 写的是**改动前**的事实与当时的读数。
> 落地后 `tier`/`evidence` 由 `scripts/ccg-review-writeback.js` 在驱动返回之后写，
> "没有任何生产方写 tier"这句不再成立；引用任何数字请**现跑**（`node scripts/ccg-artifact-shape-survey.js --ref=origin/main`），
> 不要把本文当现状——这正是本片要把读数收进工具的原因。

收口矩阵（PR #3987 + #4071）已经在要求 `deepReview.tier=external` + 可核 `evidence`，
但**全仓没有任何生产方会写这两个字段**。后果不是"有人绕过门禁"，是**诚实的评审也只能手写**——
本片之前的每一片（含 #3987、#4071 自己）收口时写的 `tier` 都是会话手写的。三条当场核实的机械成因：

1. **驱动跑到最后一句就"人没了"**。`scripts/deep-review.sh` 的出口是 4 条
   `exec node "$DRIVER" --sha "$SHA"`（现位于 `:855`、`:857`、`:876`、`:878`；2026-10-21 重取——
   **上一版写的 `:850/:852/:859/:861` 隔 3 笔合并漂了 5 行**，行号只能现取：
   `grep -n 'exec node "$DRIVER"' scripts/deep-review.sh`）。`exec` 替换进程镜像，
   于是**本仓代码在评审完成后没有任何执行点**——想补写结构，物理上无处可补。
2. **引擎的写回是整体替换，会把仓侧初始化的两个键直接吃掉**。
   引擎 `ccg-deep-review.js::writeBack()`（`:503`）做的是 `rec.deepReview = deepReview`；
   而成功收口处写进去的对象（`:1252-1256`）是
   `{required, status, performedBy, findings, minScore, at}`——**没有 `tier`、没有 `evidence`**。
   `ccg-review-decider.js::buildDeepReviewInit()`（`:641-650`）明明初始化了 `tier:"unknown"` 与
   `evidence:null`，被这一句整体替换抹掉。⇒ 现场读数的形状是：**跑完真评审的记录里 `tier` 键根本不存在**，
   判据读成 `unknown`，高危面 A 状态判红，人于是去手写。**这条就是"逼会话手写"的机制本身。**
3. **引擎侧此刻没有任何可当"外部指针"的机器产物**。当场 grep 引擎全文：
   `tier` **0** 次、`sessionId` / `ses_` / `durationMs` / `exitCode` **0** 次。
   也就是说，即使让引擎写 `evidence`，它手上也没有一个"只有真跑过才知道"的值可写。

### 为什么"改引擎"这条原路不能走（这是本片换落点的直接原因）

引擎的真实路径不是本仓文件：`~/.claude/skills/adversarial-review-loop` 是符号链接 →
`~/.nacos-cli/skill-sync/profiles/default/skill-repo/adversarial-review-loop/` →
解析到 `E:/BaiduSyncdisk/100-Agent-data/skill-repo/adversarial-review-loop`（**另一个 git 仓 + 网盘同步**）。
而且它**今天已经被打过一次本机补丁**（`mtime 2026-10-20 18:00`，新增
`module.exports = { blockingFromAdjudication, externalReviewSatisfied, EXTERNAL_EVIDENCE_RE }`
与 `require.main` 守卫，见其 `:1261-1264`）。

于是"把闭环值写进引擎"实际意味着：本仓门禁的正确性依赖一个**不在本仓、由 nacos 技能同步分发、
各机器版本可以不同、且已有未入库本机改动**的文件。2026-10-21 重量后，这一句的准确形态比原来更糟：
**锚点其实存在**——`adversarial-review-loop` 是 `skill-repo` 的 submodule（gitlink，mode 160000，
外层记录 `fe8a518…`、内层 HEAD 同值），**但被消费的字节不等于锚点字节**（工作树那份相对其 HEAD
是 +49/−3 未提交，blob `57ef9590…` → `a2842b93…`），而这两个 id **没有任何本仓产物记下**。
CI runner 上该文件干脆不存在（`deep-review.sh:536-544` 那段 2026-10-17 的修复就是为此而写）。
这正是本仓反复定性的「装饰性门禁」成因：**判据看起来在守，实际守的是某台机器上的一个巧合版本**——
而且那次实测还顺带否证了本段原来的"没有任何字节/哈希锚点"措辞，完整命令与读数见 design §1。

## What Changes

- **D1 驱动侧有了写回点**：`deep-review.sh` 的 4 条 `exec` 尾巴改为「调用 → 捕获 rc → 跑仓内写回器 → `exit` 原 rc」。
  rc 语义必须逐字保持（既有依赖：`--dry-run` 的预览出口、缺引擎时的 `DRY_NO_DRIVER` 分支、`exit 2` 档）。
- **D2 新增仓内唯一写回器 `scripts/ccg-review-writeback.js`**：它是本仓**第一个**会写 `tier` 的生产方。
  **本文不复述判据**（QM-6 i5）：条件正文的唯一真源是 `specs/qm6-closure-writeback/spec.md` 的
  「写入 MUST 同时满足五条」。本文只声明三件事：**条件条数是 5**；**任一不成立时的动作是「不写、不猜、
  不改 `status`、只点名缺哪一条」**；**引用者必须先读 spec**。把五条再抄一遍就是造第三份事实——
  本切片自己就复发过一次（spec 改成五条时 proposal 与 design 各漏改一处，见执行记录的一致性自检行），
  所以这条不是预防性洁癖。口径核对命令（改任一侧都要跑）：
  `grep -c 'MUST 同时满足五条' openspec/changes/qm6-closure-writeback/specs/qm6-closure-writeback/spec.md` 与
  **口径自检命令要防自指，而「打散正则就能自免」这个想法当场被实测否证**：第一版把被禁词写成「四 + 任意字符 + 件 + 任意字符 + 事」
  这种不匹配自身的正则形式放进说明里，结果该说明行**照样被自己的正则命中**（`grep -E` 当场数到 1）。所以可执行口径只有一条：
  **被禁的词法不得整段出现在文档任何一处，包括出现在描述这条命令的文字里**；要指涉它就用中文引号把两段拆开写
  （「四」+「件事」、「四」+「条件」），判据于是可以干净地要求命中 0。本仓在 Gate 12c 上踩过同一形状——
  记录判据的那一行里引用了被禁字面量，于是自己把自己的红造出来，而红文案读起来像「还有遗漏没改完」。
- **D3 `evidence` 用「可就地重算的交付摘要」，不用自述字符串**：新增第 6 种可核形态
  `delivery@<sha256>`，值 = 对记录里 `findings` 数组做**规范化后**的 sha256。
  判据侧 `evidenceForm` 加这一档，并像已有的 `path` 档一样**真的验证**（重算比对），而不是只看形状。
  ⇒ 它是继 `path` 之后**第二个可就地验证的形态**；仅此而已。
- **D4 强度边界写进代码与文档，不吹成签名**：这是**自洽性**判据，不是密码学绑定。
  ⚠ **摘要任何填写方都能一条命令自算**（它只哈希本记录的 `findings`，不含任何外部秘密），
  所以**不得**把它表述成"抬高造假成本"或"防伪造"——原提案那样写过，已被跨家族评审打掉并删除（见 design §7 i4）。
  强度边界统一口径为「形状 + 一致性，摘要可被任何填写方自算」；引擎自己那套 `externalReviewSatisfied`
  的注释也是这个边界（`:431-433`）。
- **D5 两份形状判据必须对账（**本片不做，2026-10-22 由实现片标注**）**：设计目标不变——高危面「外部复核成立」的形状规则引擎已有一份（`EXTERNAL_EVIDENCE_RE`），本仓必须有另一份（引擎在 CI 上根本不存在，无法 require），两之间加一把逐字 parity 锁，沿用本仓「各存一份 + parity 锁」的既有先例（`publish-capabilities.json`、`article-body-format`、`safe-http-url`）。
  **但本片没做**：对账对象只活在引擎那份未提交的本机补丁里（锚点 commit 命中 0），先决条件不在本仓手里；三条理由在 `tasks.md` §5 段首，且 spec delta 里那条 Requirement **已整条移出**（规格不写没实现的要求）。本条留在 proposal 里作为**设计意图的连续体**，不是交付声明——读到这里请去看 tasks §5 与 PR 正文的"刻意不做"。
- **D6 消掉「跑完真评审反而丢字段」这一格**：写回器读到 `rec.deepReview` 缺 `tier` 键时，
  按 `buildDeepReviewInit` 的同一初始化口径补齐再判定，禁止让"跑了评审"这件事在结构上比"什么都没做"更差。
- **AGENTS.md 同步**：QM-6 段那句「`tier=external` 此刻仍由会话手写进产物」改写为指向本片的新事实；
- **D0 前置片（已落）：立项读数改由仓内工具产出**：`scripts/ccg-artifact-shape-survey.js` 现产出
  「闭环 × tier」交叉表并自报所量 commit；`scripts/ccg-artifact-shape-survey.test.js`（10 条）接在
  `quality-gate.yml` 的 **Gate 2b10**。这一项是 tasks 0.1b 的原文要求（"实现片必须先落这把工具、
  再用它重跑并把 design §2 的数改写"）。**它进 What Changes 是为了让规格声明与实际落点对得上，
  不是为了消掉钩子的「范围漂移」告警**——那条告警比的是最近一条 `layer=plan` 产物的 `plannedFiles`
  （`ccg-gate.js:205-245`），与本文无关；要消它得**重跑决策层**（`sh scripts/plan-review.sh`），
  要消它得**重跑决策层**（`sh scripts/plan-review.sh`）。**该项在本 change 的 tasks 里是未勾选状态（0.1c）**，
  本 change 不声称它已完成；执行记录里那条「范围漂移」行同样标为未消解。
  同时把 #4087 里那句「在飞的候选 `scripts/lib/ccg-review-`」收成现状（该前缀已随 #4071 进常量）。

## 不做什么（明确排除）

- **不 patch 仓外引擎**（跨仓依赖；且 2026-10-21 实测本机那份是「锚点之外的未提交字节」，理由见上）。若日后要动，前提是先把引擎按字节锚点 vendoring 进本仓，
  那是一条独立决策（属"谁来守门"，人工过目），不在本片。
- **不联网核验** PR 评论 / 会话 id 是否真实存在。这会把判据变成需要网络与凭据的门禁，
  与本仓「判据一律可离线复现」的既有取向冲突，单独立片；本片只做**能在仓内重算**的那一档。
- **不放宽任何既有判据**：`unknown` 在非高危面不转拦、`mode=single` 继续绕开矩阵、
  CI 侧继续 `--mode=advisory`——三条残余原样保留，本片一条都不顺手动。
- **不改 required check 清单、不改 `CI_IGNORED_PATHS`**（两者按 AGENTS 必须人工过目）。
- **不做提交级归因**（产物写"本次改动文件清单"仍挂在 8.1b 范围①，本片不冒充它已闭合）。
