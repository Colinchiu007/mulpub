---
record: p25-cards-entry
task: P2-5 第三批 —— CardsRenderPanel.vue + 模板层合同测试
date: 2026-10-14
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：P2-5 第三批 CardsRenderPanel（p25-cards-entry，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见 CI
  —— 含 `apps/desktop/src/` ⇒ **混合 PR**，走完整质量节拍。

## 变更内容

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `apps/desktop/src/features/cards/CardsRenderPanel.vue` | 新增 | 面板组件 |
| `apps/desktop/src/features/cards/CardsRenderPanel.test.js` | 新增 | 8 条模板层合同测试 |

## 三条硬契约在**模板层**的落点

| 规格判据 | 模板落点 | 测试 |
| --- | --- | --- |
| ① 入口可点、进度可见、失败有明确文案 | 按钮 + `v-if="rendering"` 进度条 + `v-if="failed"` 错误条 | 3 条 |
| ② warnings 非空时有可见提示 | `v-if="hasWarnings"` 区块 + `v-for` 逐条 | **3 条** |
| ③ 结果展示 | `v-if="hasResult"` 张数 + 提示 | 2 条 |

### ★ 测试锁住的两个非显然行为

**① 渲染中按钮禁用** —— 防重复点击（防重复触发主进程渲染）

```js
expect(w.find('[data-testid="cards-render-run"]').attributes('disabled')).toBeDefined()
```

**② 未知 warning 如实回显其标识** —— 不伪装成已知文案，也不丢弃

```js
mockCardsRender.mockResolvedValue({ code: 0, data: [...], warnings: ['some-new-warning'] })
expect(w.find('[data-testid="cards-warning-some-new-warning"]').text()).toBe('some-new-warning')
```

**⇒ 若 `WARNING_KEYS` 缺项就静默丢一条，用户会漏看真实告警。**

## ★ 途中修掉一个 Vue SFC 陷阱（8 条全红的根因）

`:data-testid="cards-render-run"` 渲染出 `data-testid="NaN"`。

**⇒ Vue 的 `:attr` 是 JS 表达式**，裸连字符字符串不是合法标识符 ⇒ 求值为 `NaN`。

**⇒ 修**：`:data-testid="'cards-render-run'"`（加引号）。
**⇒ 先例** `QuickCollectPanel.vue` 正是 `:data-testid="'quick-collect-run-' + c.id"`。

**★ 教训（第三例同型）**：先例就在旁边（同一个目录、同一个模式），
我凭印象写了 `:data-testid` 的裸串形态。**「读先例」必须逐字符对齐，不是对齐大意。**

## 调试方法（值得记住）

`Cannot call trigger on an empty DOMWrapper` 时：

1. `console.log(w.html())` 看**实际渲染了什么** ⇒ 发现根 div 有、按钮没有
2. 看 Vue warn ⇒ `Property "cards" was accessed` / `Property "run"`（误导，真正问题是 `NaN`）
3. **看 HTML 里的属性值** ⇒ `data-testid="NaN"` 一语中的

**⇒ 第 3 步才是决定性的：属性值本身就说出了根因。**

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| vitest（cards 全量）| PASS | **17 passed**（9 composable + 8 组件）|
| Gate 11 ESLint | PASS | `eslint src/features/cards/ --quiet` exit=0 |
| 未接线测试 | PASS | `check-unwired-tests.js` exit=0 |
| 行尾对账 | PASS | 两口径一致 |
| 远程同步 | PENDING | 本 PR 未合并 |

- 保留门禁：vitest ✅ | Gate 11 ✅ | 未接线测试 ✅ | 行尾对账 ✅ | 远程同步 PENDING

## 未含（下一批）

- 面板挂到选题/发布页（父组件传入 `pages`）
- QM-1 打包 + 手动验证四问（启动/核心功能/非法输入/错误提示）
