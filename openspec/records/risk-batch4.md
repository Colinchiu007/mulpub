---
record: risk-batch4
task: 第四批：R5 visible 面 8 条逐条人工复核（含 1 处判据缺陷修复 + 1 处真实脆弱点加固）+ R8 侦察定论（不可机械化）+ derived 清单更新
date: 2026-10-18
branch: risk-batch4
---

## 本次执行记录：R5 复核 + R8 定论（risk-batch4，2026-10-18）【混合 PR】

- 保留门禁：QM-1 打包 **N/A**（未改 `apps/desktop/electron/`；改动为 `apps/desktop/src/views/CreateView.vue` 一行加固 + 判据库 + 测试）｜ 行数门禁 ✅ ｜ 品牌残留 ✅ ｜ 远程同步 由门禁推导

### ① R5 visible 面 8 条逐条人工复核（读码，非 grep）

| 条目 | 判定 | 依据 |
| --- | --- | --- |
| `identity-auth-window.js` ×2 | ✅ 正确（豁免登记属实）| 跨方法状态机：`openLoading()` 置位、`open()` L222-229 复位（复用/重建两分支）|
| `tab-lifecycle.js:390` | ✅ 正确 | Electron 官方**成对事件** `did-start-loading`/`did-stop-loading`（L402），比 try/finally 更完备（导航失败也触发）|
| `CreateView.vue:2106` | ⛔ **判据缺陷** | L2112 明明有 `finally { this.pipelineLoading = false }` —— **单行 finally** 被词序判据漏判（见 ②）|
| `CreateView.vue:4890` | ⚠️ **真实脆弱点** | L4897 复位在 catch 后、**无 finally**；当前无 return/throw ⇒ 行为正确，但未来 try 里加一句 `return` 就永久置灰 ⇒ **加固**（见 ③）|
| `useTtsVoices.js:86/128` | ✅ 正确（**有意的竞态设计**）| L97/L133 `if (!isCurrent) return` 提前退出是 requestId 竞态防护：旧请求不复位，避免关掉新请求的 loading。与 `tts-voices-clone.js` 的 `if (isCurrent) X = false` 守卫同模式 |
| `tts-voices-clone.js`（outside-fn）| ✅ 正确 | composable 顶层赋值，函数体内 finally 复位（L55/L114/L170/L215 均有 `finally { if (isCurrent) … }`）|
| `Home.test.js`（outside-fn）| ✅ 正确 | 测试 mock 赋值，非 UI 状态 |

**结论：8 条无一是缺陷**；其中 1 条暴露判据缺陷、1 条暴露真实脆弱点。

### ② 判据缺陷：单行 finally 漏判（已修）

原判据「复位下标 > `finally` 词的下标」对 `finally { X = false }` **必然失败**（finally 词在复位之前），实测 `CreateView.vue:2106` 被误列入可见面。

**修法**：改为**块范围判定** —— `finally` 词后第一个 `{` 到配对 `}`，复位落在区间内即算 finally 复位（单行/多行统一）。新增 `finallyBlockRanges()` helper 并导出。

**实证**：`finallyReset 3→4`（CreateView 从可见面消失）、`manualResetNoFinally 2→1`；夹具级验证单行/多行 finally 均正确判定。

### ③ 真实脆弱点加固（已修）

`CreateView.vue` `aiWrite()`：`} catch (e) { … }` 后的裸 `this.aiLoading = false` → `finally { this.aiLoading = false }`。
行为等价（该函数无提前退出），但把「靠语句顺序保证」变成「靠语法保证」—— 未来任何人在 try 里加 `return` 都不会永久置灰。**实证**：`finallyReset 4→5`，CreateView 完全退出可见面。

### ④ R8（await 无兜底）侦察定论：**不可机械化**

- 宽形态侦察：**2,855** 处「await 赋值后取属性」
- 收缩到「完全无保护」：**2,527** 处，抽样 12 个文件全是**误报**：
  - `if (res && res.code === 0 && res.data && typeof res.data === …)` —— 层层有守卫，只是守卫在窗口更前
  - `results.forEach(...)` —— `results` 根本不是 await 赋值（正则窗口内混入无关变量）
- 真正的竞品形态 `if (result._ruleList.length)` 需要**语义级判断**（该变量是否可能为 `{}`），文本级判据无法区分
- ⇒ 与本仓「宽判据假阳比真阳性多」的纪律一致：R8 **不加锁**，登记为未闭合 + 审视觉（Q4 review 清单）

### ⑤ 测试与文档

- `same-type-risk-locks-r2.test.js`：新增 **2 例**（单行 finally 判红夹具 / 多行 finally 判绿夹具），14→16 例
- `derived/竞品缺陷同型风险清单.md`：R5 行更新为「✅ 已复核（8/8，含 2 处缺陷修复）」；R8 行更新为「⛔ 不可机械化（2,527 处抽样全误报）」

### QM 记录

| 门禁 | 状态 | 说明 |
| --- | --- | --- |
| QM-1 打包验证 | **N/A** | 未改 `apps/desktop/electron/`；改动为渲染端一行加固（`finally` 语义等价替换）|
| QM-2 代码必检项 | ✅ | 无同步 CPU 密集、无网络、无写盘；`CreateView.vue` 有既有测试覆盖（`CreateView.test.js`）|
| QM-4 视觉 | **N/A** | 无视觉变化（行为等价重构）|
| QM-6 双模型评审 | 见下 | diff > 200 行 ⇒ dual，走引擎 |
| 远程同步 | 由门禁推导 | 按 change `gate-record-sync-derived-status`：不再手写状态词、不开回填 PR |

### 未闭合（不假装已闭合）

| # | 项 |
| --- | --- |
| 1 | R8 不可机械化：需语义级判断（变量是否可能为 `{}`）⇒ 维持 review 清单，未加锁 |
| 2 | R5 的 `useTtsVoices` requestId 竞态防护形态，判据仍会出声（正确但每次 CI 都提示）⇒ 未登记豁免（形态多样，逐条豁免会膨胀登记表）|
| 3 | R7 数组构造形态 / R11「有 clear 但不调用」/ api-publish-engine 豁免回迁 / code-mask 正则字面量 —— 均沿用上批登记，无新增 |
