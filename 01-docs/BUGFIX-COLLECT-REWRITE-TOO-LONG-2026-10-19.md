# BUGFIX：采集页一键改写对超长正文报「AI 改写失败」（2026-10-19）

## 症状

采集页输入知乎回答链接
`https://www.zhihu.com/question/715577762/answer/2095239383058329672`，点「一键改写」：
采集成功，随后弹出 `AI 改写失败`（无任何具体原因）。

## 证据链

| 序 | 事实 | 证据 |
|---|---|---|
| 1 | 23:33:23 走知乎 stealth 浏览器采集；23:33:54 `collect-ok`，`contentLen: 6766` | `shared-user-data/logs/app-2026-10-19.log`（采集开始 / collect-ok 行） |
| 2 | 采集条目正文 6766 码点（UTF-16 同值） | 应用 SQLite `settings` 表 `collected_items` 中该 URL 条目 |
| 3 | 23:26 同链路 5899 字文章改写成功（`model_provider_logs` id 9953，LLM 8010ms） | 对照样本：模型与鉴权正常，差距在输入长度 |
| 4 | 23:34:32 弹 `collection.rewriteFailed`；该时段 `model_provider_logs` **无记录** | LLM 未被调用 ⇒ 失败发生在引擎入口校验 |
| 5 | 引擎 `_validate`：`[...content].length > 6000` ⇒ `{success:false, errorCode:'TOO_LONG'}` | `packages/rewrite-engine/src/rewrite-engine-core.js` |
| 6 | 本地实跑：6766 字 → `TOO_LONG`；5899 字 → `success:true` | 定向探针（依赖真实引擎源码） |

## 根因（两层）

1. **数据层**：一键改写把采集正文原样送引擎，6766 > 6000 码点硬上限，引擎入口拒绝。
2. **表达层**：引擎业务错误是 `{success:false, error, errorCode}`，IPC 包成
   `{code:0, data:{...}}`；采集页漏斗把整个信封透传给 `formatUserError`，而后者只读
   **顶层** `errorCode/message` ⇒ 具体原因全部丢失，只剩兜底「AI 改写失败」。

第一性引入点：PR #3915 把采集页 stealth 分支的改写从 Python 聚合层切到桌面引擎时，
错误字段位置从「平铺」变成「嵌在 data 里」，消费点没有同步归一化（注释写着「透传原始
res（含 errorCode/message）」，但字段实际在 `data` 内）。

## 修复

1. **超长自动截取**（采集页漏斗 `rewriteViaEngine`）：
   - 新增 `apps/desktop/src/utils/rewrite-engine-limits.js`：
     `REWRITE_ENGINE_MAX_INPUT_CHARS = 6000`、按 Unicode 码点计数的
     `countRewriteChars` / `prepareRewriteInput`（截断不劈开代理对）；
   - 超长时截取前 6000 码点继续改写，并以 `collection.rewriteTruncated` 明确提示
     「正文共 N 字，已截取前 6000 字」；采集原文保持不变。
2. **引擎业务错误归一化**：
   - 新增 `apps/desktop/src/utils/rewrite-engine-error.js`：把
     `{code:0,data:{success:false,error,errorCode}}` 归一化为
     `{code, errorCode, message, params}`，并把引擎码映射到稳定文案码
     （`TOO_LONG → REWRITE_CONTENT_TOO_LONG`、`SENSITIVE_CONTENT → REWRITE_CONTENT_SENSITIVE`、
     `EMPTY_RESULT/LLM_ERROR → AGGREGATION_REWRITE_FAILED`、`NO_LLM_CLIENT → LLM_NOT_CONFIGURED`、
     `EMPTY_CONTENT → AGGREGATION_CONTENT_EMPTY`）；
   - 新增 zh/en 文案（`user-errors`），`TOO_LONG` 文案带 `{max}` 插值。
3. 引擎侧把 6000 提为具名常量 `MAX_INPUT_CHARS`（行为不变），供渲染层结构锁对齐。

## 回归保护

- `apps/desktop/src/utils/rewrite-engine-limits.test.js`：与引擎常量的结构锁、
  码点计数（emoji）、5999/6000/6001 边界、代理对不劈开。
- `apps/desktop/src/utils/rewrite-engine-error.test.js`：各引擎错误码映射、
  未知码透传自然语言、`formatUserError` 端到端 zh/en 文案。
- `apps/desktop/src/views/Collection.rewrite-input-limit.test.js`：6766 字一键改写
  → 送引擎 6000 码点 + 截断提示 + 原文不变；6000 字不截断；引擎 `TOO_LONG`
  → 具体文案而非「AI 改写失败」；IPC 层错误形态不误伤。
- 变异反证：禁用截断 ⇒ 1 例红；回退「原样透传信封」⇒ 2 例红。

## 遗留（不假装已闭合）

- 其它 `aiRewrite` 消费方（改写页、热门选题、AiWriterPanel）仍各自解释错误字段；
  本次只修采集页漏斗。后续应收敛到同一个归一化出口（本模块可直接复用）。
- 截断策略是产品取舍：一键改写对超长正文可用，但只覆盖前 6000 码点；若需要全文
  改写，应走「分段改写后合并」方案（需单独 PRD 评估成本与一致性风险）。
