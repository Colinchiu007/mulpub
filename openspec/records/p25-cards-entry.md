---
record: p25-cards-entry
task: P2-5 第二批 —— useCardsRender 交互状态机 + 合同测试
date: 2026-10-14
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：P2-5 第二批 useCardsRender（p25-cards-entry，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见 CI
  —— 含 `apps/desktop/src/` ⇒ **混合 PR**，走完整质量节拍。

## 变更内容

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `apps/desktop/src/features/cards/useCardsRender.js` | 新增 | 交互状态机（composable）|
| `apps/desktop/src/features/cards/useCardsRender.test.js` | 新增 | 9 条合同测试 |

## 形态来源

照 `useQuickCollectCommands.js`（`src/features/collection/`）：`ref` 状态 + `computed`
+ `async function` + `try/catch/finally` + `res.code === 0` 判成功。

## ★ 三条硬契约（P2-5 规格「失败面」条）

1. **warnings 非空即必须保留** —— 不得在主进程给了之后丢掉。
   测试锁：成功带 warnings ⇒ `hasWarnings === true` 且数组**逐元素相等**。
2. **失败必须点名原因** —— 「暂不可用」「入参非法」「页数不符」三种必须可区分，
   且**不返回部分产物**（页数不符时 `resultFiles` 必须为空）。
3. **「暂不可用」≠「渲染失败」** —— 桥接层 fallback 是 `CARDS_IPC_UNAVAILABLE`，
   混成一句「生成失败」会让用户无法判断该重试还是该报障。

## 测试锁住的具体行为

| 用例 | 锁什么 |
| --- | --- |
| 成功 ⇒ resultFiles 有值、failure 空 | 基本路径 |
| **warnings 非空必须保留** | 规格「失败面」 |
| **warnings 缺省不留脏值** | 上次的 warnings 不得带到下次（跨调用污染）|
| `CARDS_IPC_UNAVAILABLE` ⇒ `failedService` | 暂不可用可区分 |
| `VALIDATION_ERROR(-2)` ⇒ `failedValidation` + 原文进 vars | 入参非法可定位 |
| **页数不符 ⇒ `failedCount` + resultFiles 空** | 不返回部分产物 |
| 未知领域码 ⇒ `failedUnknown` + **原文进 vars** | 不得吞掉原因 |
| 桥接层抛错 ⇒ 被接住，不变成 unhandled rejection | 异常不外泄 |
| `reset()` 清空四项 | 入口可重来 |

## 为什么文案不写在 composable 里

`mapFailure()` 只决定「用哪条 locale 键 + 代入哪些变量」，**不拼中文句子**。
文案集中在 `locales/cards/{zh,en}.js`（第一批已建），由 `t()` 取。
⇒ 新增一种失败模式只改 `CODE_TO_KEY` 和 locale，不动交互逻辑。

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| vitest（`useCardsRender.test.js`）| PASS | **9 passed** |
| Gate 11 ESLint | PASS | `eslint src/features/cards/ --quiet` exit=0 |
| 未接线测试 | PASS | `check-unwired-tests.js` exit=0；`vitest.config.js` include 首条即 `src/**/*.test.{js,ts}` ⇒ 自动收集，无需 workflow 点名 |
| 行尾对账 | PASS | 两口径一致 |
| 远程同步 | PENDING | 本 PR 未合并 |

- 保留门禁：vitest ✅ | Gate 11 ✅ | 未接线测试 ✅ | 行尾对账 ✅ | 远程同步 PENDING

## 未含（下一批）

- Vue 组件（按钮 + 进度 + 结果/失败 + warnings 展示）
- QM-1 打包 + 手动验证四问
