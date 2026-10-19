# PRD：改写引擎字数上限 50000 + 输出截断可见化（rewrite-limits-50000，2026-10-19）

## 1. 背景与目标

改写引擎原上限：输入 6000 码点（`TOO_LONG` 硬拒）、输出默认 3000（`_postProcess` 静默砍尾）。
两个真实问题：

1. **输入侧**：知乎回答 / 公众号长文 / 视频转写 > 6000 字是常态；上一刀（#3979）用「截取前 6000 字」缓解，但尾部丢失仍是体验降级。
2. **输出侧**：引擎按字数区间 / 策略上限砍尾时**无任何用户可见提示**——比 `TOO_LONG` 更隐蔽的静默缺陷。

本刀把两层上限放开到 **50000 码点**，并把输出截断从「静默」改为「可见」。

## 2. 限额体系（改后全貌）

| 层 | 真源 | 改后值 | 行为 |
|---|---|---|---|
| 输入上限 | `rewrite-engine-core.js` `MAX_INPUT_CHARS` | **50000** 码点 | 超出 → `TOO_LONG`（errorCode 不变）；渲染层漏斗 `prepareRewriteInput` 同值截断并提示 |
| 输出上限（显式区间） | `MAX_OUTPUT_CHARS` | **50000** 码点 | `wordCountRange` 合法域：min 0-49999、max 1-50000、max ≥ min；非法区间不注入 prompt |
| 输出兜底（无显式区间） | `DEFAULT_MAX_OUTPUT_LENGTH` | **3000**（不变） | 用户没给任何字数意图时的保守兜底，防止无约束场景失控 |
| 策略级上限 | 各策略 `postProcess.maxLength`（800/1500/2000/3000） | **不变** | 平台形态语义（抖音口播 800 等）；用户显式 `wordCountRange.max` 优先级始终高于它 |
| 模型输出 token | 主进程桥接 `max_tokens` | **64000** | 见 §4 |

## 3. 数据校验（全链路口径）

| 位置 | 校验 | 失败表现 |
|---|---|---|
| 渲染层字数区间输入（`useWordCountValidation`） | min 为 0-49999 整数；max 为 1-50000 整数；max ≥ min | 表单错误文案 `rewritePage.wordCountMinInvalid` / `wordCountMaxInvalid` / `wordCountMaxLtMin` |
| 引擎 `_getWordCountInstruction` | 同一合法域；非法区间**不注入** prompt（静默降级为默认 3000 兜底） | 无可见错误，按无字数意图处理 |
| 引擎 `_validate` | `[...content].length > 50000` | `{success:false, errorCode:'TOO_LONG'}` |
| 渲染层一键改写漏斗（`prepareRewriteInput`） | 输入 > 50000 截断到 50000 + warning toast | toast「正文共 N 字，超过单次改写上限 50000 字，已截取前 50000 字进行改写」 |
| 错误文案归一化 | `TOO_LONG` → `REWRITE_CONTENT_TOO_LONG`，params `{max:50000}` | zh「正文超过单次改写上限 50000 字，未能改写。请精简正文后重试，或分多次改写。」

上限数字**不得在任何一处写死**：渲染层 `rewrite-engine-limits.js` 声明同值常量，`rewrite-engine-limits.test.js` 结构锁读引擎源码比对（`MAX_INPUT_CHARS` / `MAX_OUTPUT_CHARS` 两把锁，判据必须消费常量、禁止 `len > 6000` / `range.max <= 6000` 字面量回潮）。

## 4. 输出 token（max_tokens）透传

- 主进程 `rewrite-engine.js` 的 `llmClient.chat` 增加 `max_tokens: 64000`。
- 理由：大多数 adapter 不传 `max_tokens` 走服务商默认（OpenAI 4096）；输出会在模型默认值处被截断，且与引擎自身截断混淆无法归因。50000 字 ≈ 75K tokens 输入、最高 50000 字 ≈ 75K tokens 输出，64K 是「尽量大」与「单请求成本可控」的折中。
- Anthropic adapter 的 `max_tokens` 是必填字段（原默认 4096），透传后同样受益；OpenAI 兼容 adapter（openai/deepseek/doubao/gemini/openrouter/ollama/agnes/sensenova/minimax）已有 `if (params.max_tokens !== undefined) body.max_tokens = ...` 条件透传，无需改 adapter。
- MiMo 注释声称用 `max_completion_tokens`，但 adapter 实际是纯薄包装（无重命名逻辑），`max_tokens` 直接兼容。

## 5. 功能逻辑（输出截断可见化）

1. 引擎 `_postProcess` 返回值从 `string` 改为 `{ text, truncatedAt }`：`truncatedAt` = 因超限被砍尾后的码点长度；未截断为 `null`。
2. `rewrite()` 结果新增两个字段：
   - `outputTruncated: boolean` —— 截断事实；
   - `outputLength: number` —— 截断后实际输出码点数。
3. 截断优先级不变：`wordCountRange.max` > 策略 `postProcess.maxLength` > 默认 3000。
4. 敏感词后置检测、质量评估、标题提炼均在截断后的文本上进行（与旧行为一致）。

## 6. 交互逻辑与显示项

**改写页（RewriteView）**：

- 引擎返回 `outputTruncated === true` 时，结果卡顶部渲染暖橙横幅（`data-testid="rewrite-output-truncated"`）：
  zh「改写结果已按字数上限截断：实际输出 {length} 字（上限 {max} 字），原文后半部分未包含在结果中。如需完整改写，请调大『字数控制』上限。」
  `{length}` = `data.outputLength`；`{max}` = 当前 UI 字数上限（`wordCountMax`，缺省回退 50000）。
- 未截断 / 信封缺省该字段 ⇒ 不渲染横幅。
- 字数区间输入框 placeholder/错误文案同步为 50000 口径；输入框 placeholder「最多 50000 字」。

**采集页（Collection 一键改写）**：

- 输入 > 50000 才触发截断 toast（原 6000 行为对 6766 字知乎文不再触发）。
- `rewriteTruncated` toast 文案参数化不变（`{original}` / `{max}`）。

## 7. 提示文字（locale，zh/en 成对）

| key | zh | en |
|---|---|---|
| `rewritePage.inputPlaceholder` | 输入或粘贴需要改写的文案内容（最多 50000 字）... | Enter or paste content to rewrite (up to 50000 characters)... |
| `rewritePage.wordCountMinInvalid` | 最小字数需为 0-49999 的整数 | Min must be an integer between 0 and 49999 |
| `rewritePage.wordCountMaxInvalid` | 最大字数需为 1-50000 的整数 | Max must be an integer between 1 and 50000 |
| `rewritePage.outputTruncated` | 改写结果已按字数上限截断：实际输出 {length} 字（上限 {max} 字）... | The rewrite was trimmed to the output limit... |
| `collection.rewriteTruncated` | 正文共 {original} 字，超过单次改写上限 {max} 字，已截取前 {max} 字进行改写（不变） | 同左（不变） |
| `userErrors.REWRITE_CONTENT_TOO_LONG` | 正文超过单次改写上限 {max} 字，未能改写...（不变，params 由归一化注入 50000） | 同左 |

## 8. 流程（一键改写全链路，改后）

```
用户点「一键改写」
  → 采集（stealth / 聚合 / 视频转写）
  → rewriteViaEngine(content)
      ├─ 空守卫 → AGGREGATION_CONTENT_EMPTY
      ├─ prepareRewriteInput：>50000 码点截断 + toast 提示（原文不变）
      └─ aiRewrite({ content: ≤50000, wordCountRange, ... })
            → 主进程引擎 rewrite()
                ├─ _validate：>50000 → TOO_LONG
                ├─ prompt 注入【字数要求】（区间合法时）
                ├─ LLM 调用（max_tokens=64000）
                └─ _postProcess：按 区间.max > 策略.max > 3000 砍尾
                    → 返回 { result, outputTruncated, outputLength, ... }
            → RewriteView：outputTruncated=true ⇒ 结果卡横幅
            → Collection 页内改写：同引擎返回，后续接 result_content
```

## 9. 回归锁

| 用例 | 文件 |
|---|---|
| 输入 6001 不截（旧上限回归）/ 50001 截到 50000 / emoji 边界 | `rewrite-engine-limits.test.js`、`Collection.rewrite-input-limit.test.js` |
| 引擎 W3 重写：6001 走通 + 50001 TOO_LONG | `rewrite-engine-core.test.js` |
| W8 越界上界 50001 不注入 prompt | `rewrite-engine-core.test.js` |
| L1/L2/L3 截断可见化（默认兜底 / 未截断 / 区间截断） | `rewrite-engine-core.test.js` |
| 结构锁 ×2（输入 + 输出常量与引擎源码比对，判据消费常量） | `rewrite-engine-limits.test.js` |
| 截断横幅出现 / 缺省不出现 | `RewriteView.test.js` |
| 字数校验越界 50001 报错 | `RewriteView.test.js` |
| 自适应区间 12000 字 → max 14400（不再压回 6000） | `rewrite-defaults.test.js` |

## 10. 遗留（不假装已闭合）

- **>50000 的长文**：走分段改写（分段改写 + 合并 + 风格一致性约束），需独立 PRD 评估成本（LLM 调用 ×N）与前后文一致性。
- **输出 50000 的实际可达性**：受 provider 端 max output token 上限约束（部分模型上限 8K/16K/32K）；达到 provider 上限时输出在模型侧被截断，引擎 `outputTruncated` 检测不到（引擎只见完整返回）。后续可读 `finish_reason: 'length'` 识别。
- Python 聚合链路（`/aggregation/rewrite`）的字数上限独立于 JS 引擎，本刀未动（桌面端主链路已切 Node 引擎）。
