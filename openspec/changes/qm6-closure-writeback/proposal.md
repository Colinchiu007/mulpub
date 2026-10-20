# Proposal: 闭环值的写入方收敛到仓内驱动（qm6-closure-writeback）

> 本 change 是 `ccg-review-degradation-ladder` **tasks 8.1b** 的落地片，但**换了 8.1b 原来假设的落点**：
> 8.1b 写的是「落点在仓外引擎」，本片取证后证明仓外那条路会把本仓门禁变成跨仓依赖，
> 因此改落在**仓内驱动侧写回**。偏差的完整理由与实测见 design §1，不是偷偷改范围。

## Why

收口矩阵（PR #3987 + #4071）已经在要求 `deepReview.tier=external` + 可核 `evidence`，
但**全仓没有任何生产方会写这两个字段**。后果不是"有人绕过门禁"，是**诚实的评审也只能手写**——
本片之前的每一片（含 #3987、#4071 自己）收口时写的 `tier` 都是会话手写的。三条当场核实的机械成因：

1. **驱动跑到最后一句就"人没了"**。`scripts/deep-review.sh` 的出口是 4 条
   `exec node "$DRIVER" --sha "$SHA"`（`:850`、`:852`、`:859`、`:861`）。`exec` 替换进程镜像，
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
各机器版本可以不同、且已有未入库本机改动**的文件；而 mulpub 内对它**没有任何字节/哈希锚点**
（`git ls-files | grep ccg-deep-review` 为空）。CI runner 上该文件干脆不存在
（`deep-review.sh:536-544` 那段 2026-10-17 的修复就是为此而写）。这正是本仓反复定性的
「装饰性门禁」成因：**判据看起来在守，实际守的是某台机器上的一个巧合版本**。

## What Changes

- **D1 驱动侧有了写回点**：`deep-review.sh` 的 4 条 `exec` 尾巴改为「调用 → 捕获 rc → 跑仓内写回器 → `exit` 原 rc」。
  rc 语义必须逐字保持（既有依赖：`--dry-run` 的预览出口、缺引擎时的 `DRY_NO_DRIVER` 分支、`exit 2` 档）。
- **D2 新增仓内唯一写回器 `scripts/ccg-review-writeback.js`**：它是本仓**第一个**会写 `tier` 的生产方。
  只在**四件事同时成立**时才写 `tier:"external"`：① `status` 在闭环白名单内；② `findings` 是数组且条数 > 0；
  ③ `performedBy` 逐字等于判定记录 `reviewBackends.critic`；④ 该记录是本次驱动刚写的（不是翻旧产物）。
  任一不成立 ⇒ **不写、不猜、不改状态**，只出声点名"驱动未能写回，因为缺 X"。
- **D3 `evidence` 用「可就地重算的交付摘要」，不用自述字符串**：新增第 6 种可核形态
  `delivery@<sha256>`，值 = 对记录里 `findings` 数组做**规范化后**的 sha256。
  判据侧 `evidenceForm` 加这一档，并像已有的 `path` 档一样**真的验证**（重算比对），而不是只看形状。
  ⇒ 手写者现在必须伪造**一份自洽的评审正文**才能收口，而不是写一个词。
- **D4 强度边界写进代码与文档，不吹成签名**：这是**自洽性**判据，不是密码学绑定。
  它把造假成本从「什么都不用做」抬到「必须造出条数、内容、后端名三者互相对得上的产物」。
  引擎自己那套 `externalReviewSatisfied` 的注释已经把这个边界写清楚了（`:431-433`），本片沿用同一口径。
- **D5 两份形状判据必须对账**：高危面「外部复核成立」的形状规则引擎已有一份（`EXTERNAL_EVIDENCE_RE`），
  本仓必须有另一份——**因为引擎在 CI 上根本不存在，无法 require**。两之间加一把逐字 parity 锁，
  沿用本仓「各存一份 + parity 锁」的既有先例（`publish-capabilities.json`、`article-body-format`、`safe-http-url`）。
- **D6 消掉「跑完真评审反而丢字段」这一格**：写回器读到 `rec.deepReview` 缺 `tier` 键时，
  按 `buildDeepReviewInit` 的同一初始化口径补齐再判定，禁止让"跑了评审"这件事在结构上比"什么都没做"更差。
- **AGENTS.md 同步**：QM-6 段那句「`tier=external` 此刻仍由会话手写进产物」改写为指向本片的新事实；
  同时把 #4087 里那句「在飞的候选 `scripts/lib/ccg-review-`」收成现状（该前缀已随 #4071 进常量）。

## 不做什么（明确排除）

- **不 patch 仓外引擎**（跨仓依赖 + 无锚点，理由见上）。若日后要动，前提是先把引擎按字节锚点 vendoring 进本仓，
  那是一条独立决策（属"谁来守门"，人工过目），不在本片。
- **不联网核验** PR 评论 / 会话 id 是否真实存在。这会把判据变成需要网络与凭据的门禁，
  与本仓「判据一律可离线复现」的既有取向冲突，单独立片；本片只做**能在仓内重算**的那一档。
- **不放宽任何既有判据**：`unknown` 在非高危面不转拦、`mode=single` 继续绕开矩阵、
  CI 侧继续 `--mode=advisory`——三条残余原样保留，本片一条都不顺手动。
- **不改 required check 清单、不改 `CI_IGNORED_PATHS`**（两者按 AGENTS 必须人工过目）。
- **不做提交级归因**（产物写"本次改动文件清单"仍挂在 8.1b 范围①，本片不冒充它已闭合）。
