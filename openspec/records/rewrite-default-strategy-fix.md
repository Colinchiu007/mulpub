---
title: 默认改写策略修复
slug: rewrite-default-strategy-fix
date: 2026-10-19
---

# 执行记录：默认改写策略修复（rewrite-default-strategy-fix）

> 分支 `rewrite-default-strategy-fix`；worktree `D:\Data\projects\mp-worktrees\mp-rewrite-default-strategy-fix`
> （`git worktree add -b ... origin/main`，`origin/main` = `131c0fff6`；`start-mp-task.ps1` 因 GitHub 443 不可达在 fetch 步失败，改用本地 origin ref 建区，其余流程一致）。
> PRD：`01-docs/PRD-REWRITE-DEFAULT-STRATEGY-FIX-2026-10-19.md`

## 变更类型与隔离

| 项 | 值 |
|---|---|
| 变更类型 | 🐛 Bug 修复（用户报告「默认改写把深度报道改成带货腔」） |
| 变更规模 | 🌿 中等（2 源文件 + 2 测试文件 + 1 新增 utils 模块及测试 + 3 处接线 + PRD） |
| 会话隔离 | ✅ worktree 内编辑；`pre-code-edit-guard` 共享根 BLOCKED（exit 1，预期）/ worktree 内 exit 0；`rev-parse --abbrev-ref HEAD` = `rewrite-default-strategy-fix` |
| 依赖就绪 | ✅ `pnpm install --frozen-lockfile` + `verify-worktree-deps.js` OK 11 项 |

| 远程同步 | PENDING | PR #3980 开启中，合并后由门禁按主干历史推导收口 |

## CCG 深度审查（QM-6 双模型，DUAL 档）

变更 661 行 > 200 行阈值 ⇒ DUAL；`sh scripts/deep-review.sh`（critic=claude，proposer=opencode，Git Bash 经 `C:\Program Files\Git\bin\bash.exe` 调用，裸 bash 解析到 WSL 被脚本环境闸拦截）。
轮 1 产出 7 条发现 → 5 条进入自扮演裁决，**5/5 upheld**，逐条处置：

| id | 严重度 | 处置 |
|---|---|---|
| i1 | Critical | id 字典序破平**收窄到无信号组**；有信号组新增 `_hits`（真命中维度数）+ `_specificity`（平台专精度）破平。修复后 douyin→douyin-viral / xiaohongshu→种草 / bilibili·zhihu→knowledge-dry 全部命中。变异 M3（去专精度）实测 3 红 |
| i2 | Warning | PRD「warnings 告知用户」承诺**如实修订为 Out of Scope**（改返回契约波及三处消费方），登记为后续项 |
| i3 | Warning | 预览 `watch` 补 `content`（预览与实际命中一致性）；回归锁验证预览请求携带原文 |
| i4 | Warning | 保真兜底 id 改为 `DEFAULT_FIDELITY_STRATEGY_IDS` 常量 + `fidelityStrategyIds` 注入，非法注入回退默认；3 条锁 |
| i5 | Warning | 形态判据改**长度优先三档**：≥80 draft / ≤12 topic（阈值取自实测样本：种子 7-11 字、最短成稿 16-18 字）/ 灰色带靠结构（多段或 ≥2 句末标点）；5 条锁 + 4 条既有断言按新语义修正 |

裁决明细：`.adversarial/ccg-deep-279050fa/adjudication.json`（5/5 upheld + 逐条 prosecution/defense/rationale）；`deepReview.status` → `self_play_resolved`，`check-pr-exec-record --mode=enforce` PASS。

## 根因（实测，非推断）

三层默认值叠加涌现，**不存在任何显式默认策略常量**：

1. **R1 匹配器全体同分**：`strategy-matcher.js:104-114` 维度为空给 `weight*0.3` 基础分，`_historyScore` 同样 30% ⇒ 空输入下五策略**全部 30 分** ⇒ `sort` 稳定 + `Map` 插入序 ⇒ 恒取 `BUILTIN_STRATEGIES[0]` = `strategy-viral-storytelling`。
2. **R2 mode 默认 create**：`RewriteView.vue:334` 原为 `ref('create')`（选题创作 = 重新写一篇），而成稿应走 `imitate`。
3. **R3 字数写死 800-2000**：`_postProcess` 只截 max、从不校验 min ⇒ 5000 字硬压 2000（60%），且写短了无补救。

实测选中结果（修复前）：全空 ⇒ `strategy-viral-storytelling`；`tone=casual` ⇒ `strategy-ecommerce-convert`（带货腔直接来源）。
改写稿逐句对应 `strategy-ecommerce-convert` 的 prompt：「第一/第二/第三」←`突出3个核心卖点`；「窗口期极短」←`制造限时紧迫感`；「去申请 API Key」←`行动号召`。

## 修复

| 优先级 | 位置 | 动作 |
|---|---|---|
| P0-1 | `strategy-matcher.js` | 新增 `content` 入参 + `_heuristicScore` / `_isNoSignalGroup` / `_isFidelityPreferred`；三级排序 ①score ②启发式 ③id 字典序（**不再依赖数组顺序**） |
| P0-2 | `RewriteView.vue` + 新增 `utils/rewrite-defaults.js` | mode 按输入形态推导（成稿→imitate，选题→create）；用户手动点选优先（`modeManuallySet`） |
| P1-1 | `RewriteView.vue` | 新增行业/目的/语气三个下拉，`userSettings` 真实下发；默认空串=未指定，**不猜测用户行业** |
| P1-2 | `utils/rewrite-defaults.js` | 字数区间随原文长度自适应（≥2000 字启用，夹在 [200,6000]） |
| 接线 | `rewrite-engine-core.js` / `services/rewrite-engine.js` / `ipc-handlers/ai.js` / `preload/system.js` | `content` 透传（老调用方不传 ⇒ 回落空串，行为不变） |
| 顺手 | `rewrite-engine-core.js:544` | 修注释漂移（「默认 2500」→ 实际 `DEFAULT_MAX_OUTPUT_LENGTH = 3000`） |

## 测试（TDD，先红后绿）

- 基线：rewrite-engine **194 passed** / RewriteView **93 passed**。
- 红灯：新增用例首跑 **4 failed**（确认缺陷形态）→ 补实现后转绿。
- 最终：**rewrite-engine 204 passed**（14 文件）；**桌面端 143 passed**（RewriteView 97 / rewrite-defaults 13 / AiWriterPanel / ai IPC）。

## 变异反证（逐条实跑）

| 变异 | 结果 |
|---|---|
| M1 去掉启发式破平 `(b._heuristic - a._heuristic)` | **2 条红** ✅ |
| M2 把 `_isNoSignalGroup` 守卫改成 `if(false)` | 首轮**全绿 = 无锁** → 已补 3 条行为锁 → 重跑 **1 条红** ✅ |

> M2 首轮全绿是本次自评抓到的真缺口：写了守卫却没配锁。已补 `_isNoSignalGroup` 的四组行为锁（行业/目的/平台/语气任一有值 ⇒ 归零）+ 历史评分/偏好两组。

## 端到端验证

5557 字真实原文（`D:\Temp\rewrite-eval\orig.txt`，用户贴的那篇）：

```
[修复前] 选中: strategy-viral-storytelling | 故事化爆款策略
[修复后] 选中: strategy-knowledge-dry       | 干货知识策略
```

## 门禁

| 门禁 | 结果 |
|---|---|
| locale `--keys` | PASS（2146 key 均存在于 zh/en；**未新增键**，全部复用既有 `rewriteEngine.*`） |
| locale `--cjk` | PASS（基线 1331 / 当前 1188，无新增硬编码） |
| 品牌残留 | PASS（10498 tracked 文件） |
| 行尾两口径对账 | PASS（`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` **逐文件同值**） |
| `node --check` 语法 | PASS（5 文件） |

## 已知边界（如实记录）

1. **preload 测试 375 条全红属预存环境问题**，非本次引入：`Error: Electron failed to install correctly`；已用 `git stash` A/B 反证——撤掉本次 `preload/system.js` 改动后**仍 375/375 全红**。
2. **桌面端全量 `vitest run src/` 未在本次跑完**（600+ 文件，35 分钟无输出后中止）；已改跑定向范围（消费方 4 文件 143 passed）+ 包内全量 204 passed 覆盖。**完整全量由 CI 承担**。
3. **未做真机/真实 LLM 复现**：本次验证到「策略选中正确 + 参数下发正确」为止，实际文案质量需真实模型调用确认。
4. **P1-1 三个下拉为新增 UI**，视觉基线未采集；若 CI 视觉门禁报红需人工核对基线。
5. `_stripStructureHeadings`（行首结构词 + ≤30 字整行丢弃）是另一处潜在信息损失点，**本次未动**，登记为后续项。
