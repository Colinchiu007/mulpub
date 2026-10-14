---
record: p25-cards-entry
task: P2-5 渲染层桥接 + cards 域文案（warnings 必须透出）
date: 2026-10-14
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（按三形态同改纪律：表格行 + bullet + 删除本段三字段，同一次提交）
---

## 本次执行记录：P2-5 渲染层入口（第一批）（p25-cards-entry，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → 见 CI
  —— 含 `apps/desktop/src/` ⇒ **混合 PR**，走完整质量节拍。

## 变更内容

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `apps/desktop/src/api/cards.js` | 新增 | 渲染端桥接层（唯一接触 IPC 的入口）|
| `apps/desktop/src/locales/cards/zh.js` | 新增 | cards 域中文文案 |
| `apps/desktop/src/locales/cards/en.js` | 新增 | cards 域英文文案（成对）|
| `apps/desktop/src/locales/zh.js` | 改 | import + `cards: { ...cardsZh }` 展开 |
| `apps/desktop/src/locales/en.js` | 改 | import + `cards: { ...cardsEn }` 展开 |

## ★ 本批的核心契约：warnings 必须透出

P2-5 规格「失败面」条：**必须展示 `warnings`（尤其 `item-exceeds-page` /
`page-limit-reached`）—— 用户的文本超出一页时必须知情，不得静默。**

⇒ 桥接层的返回值不只是 `{ code, data }`，还带 `warnings`（主进程侧由 card-capture 给出）。
⇒ `CARDS_FALLBACK` 也带 `warnings: []`，让调用方能区分「暂不可用」与「渲染成功但无告警」。

## 形态来源（全部读先例，不凭想象）

| 决策 | 先例 |
| --- | --- |
| 桥接层放 `src/api/` 而非 view 内 | 37 个文件里只有 `src/api/*.js` 与 composables 调 `electronAPI`；三个视图（Publish/HotTopics/Collection）**都是 0 处** |
| `invokeWithFallback(method, fallback, ...args)` | `src/api/quick-collect.js`（最近新增的域）|
| 扁平方法名 `cardsRender` | preload 侧 `createCardsApi` 暴露的扁平名（check-ipc-bridge 按字面量对账）|
| locales 按域拆文件 + 主文件 import/展开 | `locales/hot-topics/{zh,en}.js` + `zh.js`/`en.js` 的 `hotTopics: { ...hotTopicsZh }` |

## 与 P2-4 的关系

P2-4（#3549）建了 `render:cards` 通道 + `cards` preload 域，但**尚无消费方**。
本批是第一次接线。这与第 12 轮教训第 3 条（「尚无消费方的配置」）是同一形态，
故连 locales 成对一起改，不留半截。

## 未含（下一批）

- Vue 入口按钮 + 进度 + 结果/失败展示 + warnings 可见提示（判据①②④）
- QM-1 打包 + 手动验证四问

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 行尾对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol` 两口径一致 |
| Gate 11 ESLint | PASS | `pnpm exec eslint src/api/cards.js src/locales/ --quiet` exit=0 |
| locales 成对（Gate 7） | PASS | `check-locale-sync.js --keys` exit=0（2004 个使用中的 key 均存在于 zh/en）|
| 未接线测试 | PASS | `check-unwired-tests.js` exit=0 |
| 远程同步 | PENDING | 本 PR 未合并，merge SHA 尚不存在 |

- 保留门禁：行尾对账 ✅ | Gate 11 ✅ | locales 成对 ✅ | 未接线测试 ✅ | 远程同步 PENDING

## 备注

- 本批文件原先在共享根直接创建，被 `Session Isolation Write Guard` 移入 quarantine；
  已按正规入口 `start-mp-task.ps1 -TaskName p25-cards-entry` 建隔离 worktree，
  并从 quarantine 完整恢复（5 个文件逐字节核对大小一致）。
