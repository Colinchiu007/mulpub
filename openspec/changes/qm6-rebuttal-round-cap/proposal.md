# 提案：外部深审的「已否证清单」与「轮次上限」

> **状态（2026-10-23 更新）：§1 轮次上限已落地；§2 已否证清单未开工。**
> 本篇最初只落合同（proposal / spec delta / tasks / 记录），实现从 tasks §1 起——那一刀现在落了，
> 所以这一行从"没有实现"改成上面这句。**决策层曾按旧措辞点名 7 个文件"范围漂移"**，那不是钩子误报，
> 是这句话没跟着差量走（QM-6 第一轮 i3，Critical，已采纳）。
>
> ### §1 落点（实现片的声明范围，供决策层比对）
> - `scripts/lib/ccg-review-rounds.js`（新增，唯一实现）
> - `scripts/ccg-review-rounds.test.js`（新增，库侧 R1–R10）
> - `scripts/deep-review.sh`（改：上限检查在驱动之前、落账在驱动返回之后）
> - `scripts/deep-review-entry-rc.test.js`（改：入口级 ⓬⓭⓮ + 夹具 require 闭包补一项）
> - `.github/workflows/quality-gate.yml`（改：Gate 2b11 登记新测试 + 纠正耗时口径注释）
> - `openspec/changes/qm6-rebuttal-round-cap/{proposal,tasks}.md`、`specs/qm6-rebuttal-round-cap/spec.md`、
>   `openspec/records/qm6-rebuttal-round-cap.md`（改：落账与状态）
> - `openspec/changes/qm6-rebuttal-round-cap/external-rounds.json`（新增，轮次账本本体 = 受管可见文件）
>
> ### §2 未落的落点（写在这里是为了让下一个会话不必猜）
> `rebuttals[]` 的渲染与注入**没有**任何仓内实现：前读取数 tasks §0.2 实测注入点不存在，
> critic 的任务文本由仓外引擎 `mc.callCritic({ proposalText })` 自己拼，仓内无参数化入口
> ⇒ 开工前提是**一次仓外引擎改动的人工授权**，并与 PR #4304 那份规格对齐（不得各建一份否证登记）。

## Why

`qm6-closure-writeback` 第三刀（PR #4148）在**同一份变更集**上连跑八轮外部深审（`scripts/deep-review.sh`），
读数都是本机实测、可重跑：

| 轮 | 载荷 | Critical | security 分 |
| --- | --- | --- | --- |
| 3 | `083599b94` | 2 | — |
| 4 | `ebe10ff8e` | 3 | 未达线 |
| 5 | `95d13f431` | 3 | 3 |
| 6 | `b4f2cf99c` | 3 | **2** |
| 7 | `30f93fa0c` | 3 | 6 |
| 8 | `3d997f45f` | 4 | 4 |

两件事同时成立，而现有机制只能看见第一件：

1. **闸在工作**：八轮抓到 **6 条真属于我的缺陷**，且每条都是上一轮刚写进去的那一格——
   拒写名散在 11 个 return 里（第 5 轮）、复核只查驱动不查引擎（第 5 轮）、
   `dry-run` 这个非缺件出口游离在两张表之间（第 6 轮）、被信号打断时动手前快照永久漏盘（第 8 轮）、
   "约 30 处夹具"这个数从没量过（第 7 轮）、还有一条**成因写反**（第 7 轮：
   「要区分补过初值与字段整段消失就得落盘」——其实 `classifyEvidenceTier` 对两种形态一律回 `unknown`）。
   **所以本 change 不放松任何阈值**，也不动"零 Critical"这条收口判据本身（那属第 1 条，另议）。
2. **循环没有出口**：其余 Critical 是**同一件事重复提出**——"把 realpath／路径白名单当安全边界"
   在五轮里各出现一次、"判定记录 `sha` 指向父提交"三次、"design 混排历史与活规格"三次。
   每遇到一次都要重新取证、重新反驳，而机制里**没有任何地方记住"这条已经用行号证据否证过"**。
   更糟的是**轮次也没有上限**：引擎内部那个 `[轮 1/3]` 管的是**单次调用内**的收敛，
   而我这种"改完重投一次提交、再跑一遍入口"每次都是全新的调用，计数器归零。
   八轮之后我仍在跑，最后只能靠人喊停——这不是设计意图，是缺一条封顶判据。

还有一条**会静默坑掉任何计数器实现**的约束，本轮实测确立：判定记录名是内容寻址
（`git diff HEAD^ HEAD -- . ':(exclude).ccg' | sha256sum` 逐字等于记录名），
八轮里换过 6 个名字——**只要重投提交，记录名就变**。所以轮次状态 MUST NOT 挂在记录名上，
否则计数器每次归零、上限永远触发不了，而且**看起来完全正常**（这正是本仓定性过的"装饰性门禁"形状）。

## What Changes

- **新增 `rebuttals[]`（已否证清单）**：一条被 `dismissed` 的争议，MUST 携带可核证据
  （`文件:行号` 或 `命令 + 输出摘要`）才能进清单；无证据的"我觉得不是问题"MUST NOT 算否证。
- **下一轮送审 MUST 带上这份清单**，并明确要求：重复提出同一 `finding` 指纹而**不给新证据** ⇒
  标 `duplicate_rebutted`、不计入阻断项，但 MUST 原样出现在判定记录里供人工回看。
  这条依赖仓外评审引擎配合（prompt 在 vendor 侧拼），因此本 change 显式规定：**注入不成功必须出声成独立一档**
  （`rebuttal-injection=absent`），MUST NOT 把"引擎不支持注入"读成"已注入且无重复"。
- **新增跨调用轮次上限**：按 **change 维度**（不是记录名）累计真外部调用次数，默认 3、可用环境变量覆盖、
  非法值回落默认并出声告警。超限时入口以 `escalated` 收场并点名"交人工"，
  MUST NOT 把超限实现成"自动放行"或"自动收口"。
- **状态落点受管可见**：轮次账与清单写在 `openspec/changes/<change>/external-rounds.json`（随 PR 走、可 diff），
  MUST NOT 放 `.ccg/reviews/` 子目录——那里不被 pre-commit 的记录暂存 glob 收走
  （钩子用的是 `:(glob).ccg/reviews/*.json`，`*` 不跨 `/`），会变成"只有本机看得见"的第二份事实。

## 不做什么（明确排除）

- **不改收口判据本身**：不把"零 Critical"换成"每条 Critical 都有可核处置"——那是第 1 条，需单独裁决，
  且它动的是"什么算闭合"，比本 change 大得多。
- **不引入严重度标尺**、不改 severity 枚举、不改 `CLOSED_DEEP_REVIEW_STATUSES` 闭集。
- **不碰 `HIGH_RISK_SURFACES` 与收口矩阵**（谁算高危面与本片无关）。
- **不做 tasks 8.2（引擎 vendoring / 字节锚点）**：第 8 轮那两条"许可根可投毒"的 Critical 真解在那里，
  另开一刀；本 change MUST NOT 被读成"已解决安全边界问题"，它只让重复指控不再消耗轮次。
- **不自动合并**：本 change 改的是"评审如何算数"，属"谁来守门"，一律人工过目。

## 授权与顺序

2026-10-23 用户裁决「要，按你的建议来」——采纳我提的拆刀顺序：先做第 2 条（本 change），
第 1 条（收口从"没有 Critical"改成"每条都有可核处置"）与第 3 条（严重度标尺）留作后续单独讨论。
同一次裁决里确认：PR #4148 的 QM-6 收口**保持未闭合交人工**，不手写 `tier`/`evidence`、不借道 `closureNote`。
