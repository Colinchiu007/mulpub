---
record: rewrite-cancel-collection
task: 取消通道接到采集页（4 个改写入口）+ 取消结果不当失败处理
date: 2026-10-20
---

## 本次执行记录：采集页改写取消通道（rewrite-cancel-collection，2026-10-20）

> 上游：`rewrite-cancel-and-truncation-summary`（PR #4078，merge `dae37652a`）。
> 该 PR 建好了 `ai:rewrite-cancel` 通道，但**只接到了改写页**（`RewriteView.vue`）。
> 采集页恰恰是长文最常出现的入口（知乎回答 / 公众号长文 / 视频转写），也是最初报错（#3979）的页面 ——
> 通道建好却没接上最需要的入口，属半成品状态，本 PR 补齐。

| 门禁 | 状态 | 证据 |
|------|------|------|
| 变更类型与隔离 | ✅ | 隔离 worktree `mp-rewrites/mp-rewrite-cancel-collection` + 裸分支同名；`pre-code-edit-guard` 共享根只读、Write Guard Running |
| 前置阻塞（如实记录） | ✅ | `start-mp-task.ps1` 首次失败：health 报 2 条**其他会话**陈旧白名单（路径已不存在、不在 git 注册表）+ 2 个**其他会话**在非规范根的真实 worktree。处置：① `register-allowed-worktree.ps1 -Clean` 清掉 2 条死记录；② 对 2 个真实 worktree 用 `-Register` 记录为已知（**不删不改**它们的 worktree，不写共享根，走审计日志）。health 转 `ok: true` 后建 worktree |
| 第一性原因（QM-5 ①） | ✅ | #4078 的验收标准只覆盖 `RewriteView`（「改写中显示取消按钮」），通道可用性以「IPC 存在」为准 ⇒ 其余 3 个 `aiRewrite` 消费点（`Collection.vue`、`AiWriterPanel.vue`、`HotTopics`/`useHotTopicsGenVideo`）没有接。**机制存在 ≠ 能力可用** |
| 逃逸分析（QM-5 ②） | ✅ | #4078 的测试文件是 `RewriteView.cancel.test.js`，只挂载 RewriteView；采集页测试文件（`Collection.*.test.js`）全部只断言改写结果与错误文案，没有一条断言「能否取消」。跨页面能力必须有跨页面锁 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 `Collection.cancel.test.js` 5 例：runId 随参数下发 / 改写中出按钮且点击调 `aiRewriteCancel`+info / CANCELLED 不写 `rewriteError` 不弹错误 / 一键改写流程中按钮可见 / 完成后按钮消失 |
| 防止再次发生（QM-5 ⑤） | ✅ | learnings 2 条 + 本记录 + CHANGELOG；learnings 明确「通道类能力的验收标准必须按**消费点清单**写，不能按页面写」 |
| 行尾与 diff 对账 | ✅ | 提交后取证 |
| 接线棘轮 | ✅ | `check-unwired-tests` → OK |
| QM-1 打包 | ✅ | `build:vue` rc=0；`electron-builder --dir` rc=0；**产物级断言**：66 个 dist chunk 中命中 `collection-rewrite-cancel-btn`、`aiRewriteCancel` 桥、`cancellingHint` 文案各为 true |
| QM-2 代码必检项 | ✅ | 取消为协作式标记（无同步阻塞原语）；`endRun()` 在 `finally`（runId 不残留）；4 个调用点用 `else if (!cancelled)` 而非复制整段错误处理；无 v-html / 无硬编码等待 |
| QM-4 视觉回归 | N/A（有据） | 取消按钮复用既有 `col-btn col-btn--secondary`，仅在 `rewriting || oneClickRewriting` 时出现；不新增全局样式 |
| QM-6 CCG 双模型外部评审 | 由 pre-commit 判定 | 见提交后判定记录 |
| 远程同步 | 由门禁推导 | 合并后由 merge-ledger 推导 |

## 设计要点

### 1. 取消接在唯一漏斗里（不是 4 个调用点各接一次）

`rewriteViaEngine(content)` 是采集页四个改写入口的**唯一收口**（视频转写 / stealth 自动 / 普通采集 / 手动改写，
空正文守卫与分段提示都已在此处）。因此：

- `beginRun()` 在本函数内生成 runId 并注入 `params.runId`；
- `finally { endRun() }` —— 成功/失败/取消都释放，避免下一次改写拿旧 id 取消到上一次；
- 收到 `data.cancelled === true` ⇒ `notifyInfo('rewritePage.rewriteCancelled')` 并返回 `{ __cancelled: true }`。

### 2. 「取消不是失败」要在调用点显式表达

四个调用点原本是 `if (result.result_content) {成功} else {错误}`。取消会让 `result_content` 为空 ⇒ 落进
错误分支弹「AI 改写失败」。改法是把 `else` 收紧为 `else if (!(result && result.__cancelled))` ——
**一行**改动 ×4，而不是复制四份错误处理（复制必然漂移）。

### 3. i18n 键复用而非新增（行数硬限）

`locales/collection/zh.js` 已 498 行，紧贴 `>= 500` 硬限。取消相关文案**复用 `rewritePage.*`**
（`cancelRewriteBtn` / `cancellingBtn` / `rewriteCancelled` / `cancellingHint`）——同一 locale 树内跨命名空间引用，
两页措辞天然一致，且不撑大已临界文件。实测：`check-max-lines` ✅。

### 4. 一键改写阶段的语义

`oneClickRewriting`（采集 + 自动改写）期间按钮可见，但 `collecting` 为真时按钮禁用 ——
**采集阶段不可取消**（采集走 stealth 浏览器/HTTP，没有取消通道），只在改写阶段生效。这点写在模板注释里。

## 自测块（提交前当场跑）

```
cd apps/desktop && node ../../node_modules/vitest/vitest.mjs run \
  src/views/Collection.cancel.test.js src/views/Collection.test.js \
  src/views/Collection.rewrite-input-limit.test.js src/views/RewriteView.cancel.test.js \
  src/utils/rewrite-truncation.test.js
→ Test Files 5 passed / Tests 147 passed

eslint（Collection.vue + 新测试）→ rc=0
check-unwired-tests → OK；locale keys → PASS(2180)；locale CJK → PASS；max-lines → ✅；brand-residue → PASS
pnpm run build:vue → rc=0；electron-builder --dir → rc=0
产物级断言：66 chunk 命中按钮 / 取消桥 / 取消文案
```

## 遗留（不假装已闭合）

- **`AiWriterPanel.vue` 仍未接取消**：它也是 `aiRewrite` 消费点（侧边 AI 写作面板，正文可能较长）。本轮未做，
  理由是本 PR 聚焦「长文最常出现的采集页」；如需要可同法接入（复用 `useRewriteCancel`）。
- **`HotTopics.vue` / `useHotTopicsGenVideo.js` 不做**：`mode: 'create'` 的输入是短主题种子，不会触发分段改写，
  取消价值接近零。
- **采集阶段不可取消**：采集（stealth 浏览器 / HTTP）没有取消通道，属另一条链路。
- **单次改写（<50000 字）取消价值低**：引擎侧只在调用前检查，等价于不可中断（与 #4078 同语义）。
