# PRD — 改写策略 UI 补齐与入口提级（Rewrite Strategy UI）

> 日期：2026-09-15
> 分支：`rewrite-strategy-ui`（worktree 隔离）
> 类型：前端功能补齐 + 入口调整 + 文案统一（中风险，前端 UI 变更）
> 关联文档：`01-docs/DESIGN-REWRITE-ENGINE.md`（引擎与策略契约）、`01-docs/PRD-REWRITE-FRONTEND-ENTRY.md`（前端入口）、`01-docs/PRD-REWRITE-WORD-COUNT-CONTROL-2026-09-12.md`（字数区间）

---

## 1. 背景与问题

改写策略选择器组件 `RewriteStrategyPicker.vue`（自动匹配/手动选择 radio + 策略下拉 + 自动模式匹配预览）此前已接入三处（`/rewrite` 独立页、文案库弹窗 `CopyRewriteModal`、发布页 `AiWriterPanel`），但实际排查（2026-09-15，只读调查）发现三个叠加问题导致用户「看不到改写策略」：

1. **采集页缺策略入口（P0）**：内容采集页 `Collection.vue` 的「改写 / 一键改写」按钮走 `rewriteViaEngine()`，其请求参数完全没有 `strategyId` 字段，页面也没有任何策略 UI —— 用户从最常用的采集入口发起改写时无法指定策略，永远走引擎自动匹配 Top1。
2. **默认自动模式隐藏下拉（P1）**：`/rewrite` 页默认 `strategyMode='auto'`，此时策略下拉是 `v-if strategyMode==='manual'` 不渲染，只显示一行静态预览「将匹配策略：X」，用户易误判为「没有策略选项」。
3. **入口不显眼 + 命名错位（P1）**：`/rewrite` 页归在侧边栏「更多」折叠菜单；UI 文案为「策略选择」而非「改写策略」，与用户心智搜索词不一致。

## 2. 目标与非目标

**目标**
- G1：采集页改写（含单篇改写与一键改写/视频转写通道）可指定改写策略，与 `/rewrite` 页契约完全一致。
- G2：`/rewrite` 独立页默认展开策略下拉（默认手动模式），降低发现成本。
- G3：「文案改写」菜单从「更多」折叠组提级到一级导航（primary），运营中心种子同步。
- G4：策略区块 UI 文案统一为「改写策略」（zh），en 同步为「Rewrite strategy」。

**非目标**
- 不改动改写引擎（`rewriteEngineService`）的策略解析逻辑 `_resolveStrategy`。
- 不改动 `CopyRewriteModal` / 发布页 `AiWriterPanel` 的默认模式（保持 auto）。
- 不新增 IPC 通道（复用既有 `listRewriteStrategies` / `getRecommendedStrategies` / `aiRewrite`，无 preload 契约变化，无需重打包 bundle）。

## 3. 方案（A/B/C）

### A. 采集页接入策略选择器（P0）

**文件**：`apps/desktop/src/views/Collection.vue`

**模板**：在采集结果卡（`collectedResult` 面板）内、操作按钮行之前插入 `RewriteStrategyPicker`（与 `/rewrite` 页同组件、同 props 契约）：

- `v-model:strategy-mode="strategyMode"` / `v-model:strategy-id="rewriteStrategyId"`
- `:strategies="rewriteStrategies"`（onMounted 时经 `aiListRewriteStrategies()` 加载，失败静默降级为空列表，不阻塞改写）
- `:preview-name="previewStrategyName"`（经 `aiGetRecommendedStrategies({})` 取推荐第一名，失败降级 `--`；序列号 `strategyPreviewSeq` 防竞态，与 RewriteView 同模式）
- `:disabled="rewriting || oneClickRewriting"`（改写进行中禁用交互，与同面板其他控件一致）
- `:labels` 全部走 i18n key（`rewritePage.strategyLabel` 等 6 个 key，见 §5）

**脚本**：新增 4 个状态（`strategyMode='auto'` 默认、`rewriteStrategyId=''`、`rewriteStrategies=[]`、`previewStrategyName='--'`）+ `loadRewriteStrategies()` / `refreshStrategyPreview()`；onMounted 追加两个 void 调用。

**传参契约**（`rewriteViaEngine` 内，与 RewriteView/AiWriterPanel 三处一致）：

```js
strategyId: strategyMode.value === 'manual' ? (rewriteStrategyId.value || null) : null
```

- 手动 + 已选 → 传所选策略 id；手动 + 未选（空串）→ 降级 null；自动 → null（引擎 `_resolveStrategy` 自动匹配 Top1，见 DESIGN-REWRITE-ENGINE.md）。
- 该参数同时覆盖采集页三条改写链路：结果面板「改写」按钮（`rewriteCollected`）、一键改写图文通道、一键改写视频转写通道 —— 因为它们统一经过 `rewriteViaEngine`。

### B. /rewrite 默认手动模式 + 入口提级（P1）

**文件 1**：`apps/desktop/src/views/RewriteView.vue` — `strategyMode` 默认值 `'auto'` → `'manual'`：
- 页面加载即展开策略下拉；用户未选策略时契约仍是 `null`（走自动匹配），**无行为回归**。
- 仅此页改默认值；`CopyRewriteModal` / `AiWriterPanel` / 采集页保持 `auto`（弹窗/面板空间有限，默认收起）。
- 自动模式预览逻辑（`refreshStrategyPreview`、平台 watch、改写后刷新）不变 —— 用户切回自动时预览正常显示。

**文件 2**：`apps/desktop/src/config/sidebar-menu.js` — `rewrite` 菜单项 `group` 从 `SIDEBAR_GROUP_MORE` 提级到 `SIDEBAR_GROUP_PRIMARY`（排在 `collection` 之后）。

**文件 3（同步约束）**：`ops-center/backend/services/app_menu_service.py` — CATALOG 种子中 `("rewrite", ...)` 同步移到 `MENU_GROUP_PRIMARY` 段（两处 key 与分组顺序必须一致，运营中心以 JS 文件为种子来源）。

**兼容性说明**：运营中心已下发的菜单配置以 key 为主键、含分组信息。提级后，若运营中心已有存量配置把 rewrite 归入 more 组，则以**下发配置优先**（merge 逻辑见 `sidebar-menu-merge.js`）；未配置过的环境直接用本地定义（primary）。此为既有契约，无迁移需求。

### C. 文案统一「改写策略」（P2）

| key | zh（旧→新） | en（旧→新） | 消费方 |
|-----|------------|------------|--------|
| `rewritePage.strategyLabel` | 策略选择 → **改写策略** | Strategy → **Rewrite strategy** | RewriteView、CopyRewriteModal、Collection（新增）、AiWriterPanel（本次 i18n 化） |
| `rewriteEngine.strategyLabel` | 策略选择 → **改写策略** | Strategy → **Rewrite strategy** | 保留命名空间一致性 |

- `AiWriterPanel.vue` 的硬编码「策略选择」标签改为 `t('rewritePage.strategyLabel')`（**消存量 CJK 债务一笔**：该字面量从 locale-cjk-baseline.json 基线中自然消失，符合「债务只降不升」；组件补 `useI18n` 引入）。
- zh/en 成对修改，同 commit 提交（CI Gate 7 `check-locale-sync.js` 校验通过）。

## 4. 数据校验

| 校验点 | 规则 | 失败处理 |
|--------|------|---------|
| 策略列表加载 | `res.code === 0` 且 `res.data` 为数组 | 静默降级空列表；下拉仅剩占位项；改写仍可发起（自动匹配） |
| 推荐预览 | `res.code === 0`、`data` 非空数组、取 `[0].name` | 降级显示 `--`；序列号防竞态丢弃过期响应 |
| strategyId 传参 | 手动+非空 id → 原样传；手动+空串 → null；自动 → null | 引擎侧对 null 走自动匹配（既有逻辑） |
| 改写进行中 | `rewriting || oneClickRewriting` | Picker 整体 disabled；radio 与下拉均不可交互 |
| 字数区间 | 沿用既有 `useWordCountValidation` | 不变 |

## 5. 显示项与提示文字（i18n 清单）

| key | zh | en | 出现位置 |
|-----|----|----|---------|
| `rewritePage.strategyLabel` | 改写策略 | Rewrite strategy | 四处策略区块标题 |
| `rewritePage.strategyAuto` | 自动匹配 | Auto match | radio |
| `rewritePage.strategyManual` | 手动选择 | Manual select | radio |
| `rewritePage.strategyPreview` / `strategyPreviewColon` | 将匹配策略： | Will match strategy: | auto 模式预览行 |
| `rewritePage.strategySelectPlaceholder` | -- 选择策略 -- | -- Select strategy -- | manual 下拉占位项 |

（本次无新增 key —— 全部复用既有 key，仅改 zh/en 值；新增硬编码中文为零，CJK 门禁通过。）

## 6. 交互逻辑

1. 进入采集页 → 完成一次采集出现结果面板 → 面板内展示「改写策略」区块（默认自动模式 + 匹配预览行）。
2. 切「手动选择」→ 出现策略下拉（占位项 + 内置 5 套 + 远程下发策略）；点「改写」→ 请求携带所选 `strategyId`。
3. 「一键改写」在采集输入行发起（此时结果面板尚未渲染）→ 按当前策略区块状态传参：默认 auto → null（自动匹配）；若上一轮已切手动并选了策略，则携带该 id。
4. 改写进行中 → Picker disabled；结束后恢复。
5. `/rewrite` 页加载 → 默认手动模式、下拉直接展开；切「自动匹配」→ 显示预览行；发起改写后按最终模式传参。

## 7. 测试与门禁

- **新增用例**：`Collection.test.js` —「rewriteViaEngine 策略传参契约：手动传所选 id，自动/未选传 null」（3 断言覆盖契约三分支）。
- **更新用例**：`RewriteView.test.js` — 默认模式断言反转为 manual + 下拉可见；4 个预览用例先切 auto 再断言（预览块仅在 auto 渲染）；新增「shows auto preview after switching to auto mode」。
- **更新用例**：`AiWriterPanel.test.js` — 全部 mount 注入 `global.plugins=[i18n]`（与 CopyRewriteModal.test.js 同模式）；「策略选择」断言改「改写策略」。
- **门禁**：债务熔断（Collection.vue 1480± 行 < maxFileLines 6497 基线，filesOver500/1000 计数不增）；CJK 基线只降不升；locale-sync zh/en 成对；无 IPC 契约变化（preload.test.js 键数不变）。

## 8. 验收标准

- [ ] 采集页结果面板可见「改写策略」区块；手动选策略后改写请求携带对应 `strategyId`
- [ ] 一键改写（图文/视频转写）同样携带 `strategyId`
- [ ] `/rewrite` 页默认展开策略下拉，不选策略直接改写仍走自动匹配
- [ ] 侧边栏一级导航出现「文案改写」，运营中心种子同步
- [ ] 四处策略区块标题均显示「改写策略」（en: Rewrite strategy）
- [ ] desktop 全量单测通过；CI 13 项 required 全绿
