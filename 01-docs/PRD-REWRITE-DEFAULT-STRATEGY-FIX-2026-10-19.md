# PRD：默认改写策略修复（rewrite-default-strategy-fix）

> 分支 `rewrite-default-strategy-fix`；worktree `D:\Data\projects\mp-worktrees\mp-rewrite-default-strategy-fix`；基线 origin/main `131c0fff6`。

## 1. 背景与问题

用户把一篇约 5000 字科技行业深度报道（新智元风格 Mind Lab Macaron-V1 发布稿）交给默认改写，得到一篇约 800 字的电商带货腔营销文案：三段「第一/第二/第三」卖点、「窗口期极短」「别等…门槛就高了」的紧迫感话术、结尾「现在去申请 API Key」的行动号召。

**这不是模型发挥失常，而是「默认策略」这个环节从未真正做过选择。**

### 1.1 实测证据（非推断）

空 `userSettings` + 空 `userHistory` 下跑 `StrategyMatcher`：

```
30 strategy-viral-storytelling
30 strategy-ecommerce-convert
30 strategy-douyin-viral
30 strategy-xiaohongshu-种草
30 strategy-knowledge-dry
```

五个策略得分完全相同（9+7.5+6+4.5+3=30，每个维度都拿了「无匹配时 30% 基础分」）。`rank()` 用 `Array.sort((a,b)=>b.score-a.score)`；ES2019 起 sort 稳定，`listEnabled()` 走 `Array.from(Map.values())` 保插入序 ⇒ **恒取内置表第一条** `strategy-viral-storytelling`。

带默认值时的选中结果：

| 输入 | 选中 | 分 |
|---|---|---|
| 全空（RewriteView 默认） | strategy-viral-storytelling | 30 |
| tone=casual（Collection 默认） | **strategy-ecommerce-convert** | 40.5 |
| platform=douyin | strategy-viral-storytelling | 44 |
| platform=wechat_mp | strategy-viral-storytelling | 44 |
| platform=douyin+tone=casual | **strategy-ecommerce-convert** | 54.5 |
| industry=technology | strategy-knowledge-dry | 51 |

改写稿里的每句话都能在 `strategy-ecommerce-convert` 的 prompt 里逐条对上：

| 改写结果 | 策略 prompt |
|---|---|
| 「第一…第二…第三」 | `2. 突出3个核心卖点，每个卖点配合使用场景` |
| 「窗口期极短」「别等…门槛就高了」 | `3. 制造限时/限量紧迫感` |
| 「现在，去申请 API Key」 | `4. 结尾明确行动号召` |
| 整体语气 | systemPrompt：`卖点描述和情感驱动让用户下单` |

## 2. 根因（三层默认值叠加涌现，无显式默认策略）

### R1 自动匹配器在默认输入下全体同分（主因）
`packages/rewrite-engine/src/strategy-matcher.js:104-114` 维度为空时给 `weight * 0.3` 基础分；`_historyScore:133` 同样 30%。全空 ⇒ 五维全拿基础分 ⇒ 同分 ⇒ 稳定排序取首项。

### R2 改写模式默认 `create`，与「改写」语义相反
`apps/desktop/src/views/RewriteView.vue:334` 是 `ref('create')`。`create` 定义为「基于选题创作一篇**全新的完整文案**」（`rewrite-engine-core.js:473-481`）——模型被授权重新创作而非保留原文。这是 975B 参数、SWE-bench 85.6 分、198 个 adapter 投票等事实密度几乎全消失的直接原因。

另两个入口（AiWriterPanel.vue:240、Collection.vue:671）默认才是 `imitate`。

### R3 字数下限无任何机械保证
`RewriteView.vue:337-338` 默认 min=800 / max=2000。`_postProcess:545-551` 只做 `codePoints.length > maxLength → slice`，**只截 max、从不校验 min**。实测 300 字输入原样返回。5000 字 ⇒ 硬截 2000 字，压缩比 60%。引擎除 6000 字上限外**无任何长文保护**（无分段改写、无长文自动切模式）。

## 3. 已排除的嫌疑（防止误修）

- **去 AI 味 Pass 3**：`ai-taste-remover.js:829-837` 已按段处理（`split('\n').map(...)`），注释明确结构不变量「任何 pass 不得改变换行/分段结构」。实测 871 字→871 字，仅逗号并句不删信息。**不是压平段落的元凶。**
- **硬约束两端不一致**：引擎 `BUILTIN_DEFAULT_HARD_CONSTRAINTS`（`core:22-26`）与运营中心种子 `hard-constraint-default-v1`（`rewrite_hard_constraint_service.py:24-37`）**逐字节相等，均 168 字符**。不存在出厂不一致。真实风险是运营人员可在 ops-center 改这条默认约束导致**可运营漂移**（`core:353` 下发值优先于内置）——不在本次范围。

## 4. 需求

### P0-1 匹配器：全并列/无有效信号时不得静默取首项
- 新增「无有效信号」判定：所有候选得分极差 < 阈值（或无任何维度真正命中）时，视为匹配器未产生有效区分。
- 该情形下降级到**内容特征启发式**：依据原文长度、是否含代码/数据/评测基准、题材特征，选择一个「保真型」策略；无把握时降级到显式兜底策略。
- 不得再依赖「数组顺序」隐式决定结果。
- ⚠ CCG 深度审查 i2 修订：本节初稿承诺「在 warnings 中告知用户」，实际未落地——
  加 warnings 需改引擎返回契约，波及三处消费方与既有测试，超出本 PR 评审面。
  「兜底告知用户」登记为后续项（见 Out of Scope），不在本 PR 兑现。

### P0-2 改写模式：默认按输入形态判定
- RewriteView 默认 mode 由 `create` 改为**按输入形态自动判定**：输入是成稿（长、有完整段落/标点）⇒ `imitate`；输入是短选题种子 ⇒ `create`。
- 保留显式覆盖：文案库交接（`:369`）与 topic 带入（`:543`）两条既有路径语义不变。

### P1-1 补发 userSettings
- RewriteView 除 `platform` 外补发 `industry`/`purpose`/`tone`（允许为空，但需让匹配器拿到真实输入而非 `undefined`）。

### P1-2 字数随原文长度自适应
- 默认区间随原文长度自适应，避免长文被硬压 60%。
- 顺手修正 `rewrite-engine-core.js:544` 注释漂移（写「默认 2500」而实际常量 `DEFAULT_MAX_OUTPUT_LENGTH = 3000`，见 `:17`）。

## 5. 验收标准

1. 空 userSettings + 空 history 时，对**长文成稿**不再恒定选中 `strategy-viral-storytelling`。
2. 对科技/数据密集型长文（含 SWE-bench、参数量、评测分数等特征），启发式应选中保真型策略（`strategy-knowledge-dry` 或显式兜底）。
3. RewriteView 粘贴成稿后默认 mode 为 `imitate`（非 `create`）。
4. 字数默认区间随原文长度自适应；5000 字原文的 max 显著大于 2000。
5. 既有测试全绿；`strategy-matcher.test.js`、`rewrite-engine-core.test.js`、`RewriteView.test.js` 新增用例覆盖上述行为。

## 6. Out of Scope

- 运营中心硬约束可运营漂移（仅记录，不改）。
- 长文分段改写（本次只做字数自适应，不引入 chunk/split）。
- ai-taste-remover 逻辑调整。
- **兜底告知用户**（CCG 深度审查 i2）：在引擎返回中新增 warnings 字段告知「本次默认策略由兜底产生」。需改返回契约并波及 RewriteView / Collection / AiWriterPanel 三处消费方，与 _stripStructureHeadings 一并登记为后续项。
- `_stripStructureHeadings`（行首结构词 + ≤30 字整行丢弃）是另一处潜在信息损失点，本次未动。
