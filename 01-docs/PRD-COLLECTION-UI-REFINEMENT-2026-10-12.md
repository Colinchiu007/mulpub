# PRD — 采集页 UI/UE 精致化（collection-ui-refinement，2026-10-12）

- 关联模块：`apps/desktop/src/views/Collection.vue`、`apps/desktop/src/features/collection/`（新增 BatchCollectPanel / CollectedResultsList / ColProgressBlock）、`apps/desktop/src/styles/tokens.css`、`apps/desktop/src/locales/{zh,en}.js`
- 关联 change：`openspec/changes/collection-ui-refinement/`（五件套）
- 决策来源：grill 会话 Q1–Q11 定案（范围 B：页头/页签/采集+文案库；行为边界 B：收敛重复不删功能；Q7 大粒度拆分；Q8 基线本 PR 重建；Q10 采纳 a/b/c/e，d 保留）

## 1. 背景与问题定性

| # | 问题 | 证据（file:line） |
|---|---|---|
| P1 | 五种采集入口平铺一屏，信息密度失衡 | Collection.vue:21–309 |
| P2 | 两套进度机制重复（批量进度条 vs 知乎进度卡），DOM/视觉不同构 | :294–305 vs :272–291 |
| P3 | 知乎收藏夹区块 20+ 处内联样式（T1-3d 收编漏网） | :172–269 |
| P4 | 「精致化主题」style 块亮色硬编码，暗色模式破损 | :2626–2699（rgba/gradient/hex） |
| P5 | 结果卡信息层级未分主次，操作按钮同权重 | :362–391 |
| P6 | 行数零容差文件，无法原地增强 | max-lines 基线 2920，容忍 200 |

## 2. 范围

**做**：批量区折叠分组、进度统一、结果卡/文案库卡层级重排、结果空态、token 收编 + 暗色走查、文件拆分（净降行数）。
**不做**：底部平台快捷卡（微博/知乎/头条）不动（既有 PRD-REMOVE-MONITOR 契约与行为测试）；URL 单条采集工具条不折叠；不改任何 IPC 契约/数据模型/采集-改写-发布业务逻辑；博主监控页签不动。

## 3. 信息架构（改造后）

```
采集页
├─ 页头：页签（采集/快捷采集/文案库/博主监控）+ 副标题 + 剪贴板导入/新建草稿
├─ [采集页签]
│  ├─ ① URL 单条采集面板（常驻）：来源选择 + 输入 + 采集/一键改写/重试 + 错误横幅 + 视频阶段条 + 结果卡（策略选择→创建草稿/加爆款库/结合开关/字数区间/改写→对比双栏）
│  ├─ ② 批量采集面板（BatchCollectPanel，互斥手风琴）
│  │   ├─ RSS 批量（默认展开）：输入 + 开始
│  │   ├─ URL 列表批量：textarea（非空才可点）+ 提示
│  │   ├─ 知乎收藏夹：secret → 范围/收藏夹/数量/全量/含已采 → 清单直选 → 采集并改写/取消 + 旧整夹直采兼容行
│  │   └─ 统一进度块（ColProgressBlock）：批量进度与知乎进度共用同构 DOM
│  ├─ ③ 采集结果列表（CollectedResultsList）：勾选批量操作条（平台/账号/图文发布/生成视频/发布视频）+ 卡片网格 + 空态
│  ├─ ④ 快捷操作卡（不动）
│  └─ ⑤ 草稿箱（不动）
└─ [文案库/快捷采集/博主监控页签]（不动，样式随 token 收编受益）
```

## 4. 交互逻辑（详细）

### 4.1 折叠分组
- 状态：`expandedBatch: 'rss'|'urlList'|'zhihu'`（单值，互斥；默认 `'rss'`）。点击组标题 = 切换到该组；再点当前展开组标题不收起（保持「总有一组展开」，避免空白区）。
- 标题元素：`<button type="button" :aria-expanded="expandedBatch===X" :aria-controls="'batch-panel-'+X">`，Enter/Space 原生可触发。
- 折叠态摘要：RSS 组显示已填链接 host（有则）；URL 列表组显示行数（非空则）；知乎组显示「已选 N 条」或收藏夹名。折叠不丢上下文。
- testid：组标题 `batch-group-title-{rss|urlList|zhihu}`，面板 `batch-panel-{...}`；既有 `zhihu-fav-*` 全部原样保留。

### 4.2 进度统一（ColProgressBlock）
- props：`title:string`、`percent:number(0-100)`、`text:string`、`cancelable:boolean`、`detailLines?:string[]`、`summary?:string`、`testid?:string`。
- emit：`cancel`。
- 显示项：标题（font-size-sm 加粗）→ 进度轨道（8px，`--color-progress-track` 底 / `--color-primary` 填充，width 过渡 0.3s）→ `text` → summary（如有）→ 明细展开按钮（仅 detailLines 非空）→ 明细区（max-height 200px 滚动）→ 取消按钮（仅 cancelable）。
- 两个消费方：RSS/URL 批量（percent=batchProgress，cancelable=batchCollecting）；知乎（percent=zhihuFavProgressPercent，detailLines=zhihuFavProgressLines，summary=zhihuFavSummary，testid=`zhihu-fav-batch-progress`）。

### 4.3 结果卡层级
- 一级（card-top）：勾选框 → 图标（视频/图文）→ 标题（单行 ellipsis + title 提示）→ 元信息行（source · 字数 [· 时长 · 平台]）。
- 二级（徽标区，条件渲染）：改写失败（`--color-warning`，badge 文案 locale `zhihuFav.rewriteFailedBadge`）→ 已改写预览（40 字截断 + title 全文）→ 图片降级计数。
- 三级（card-actions，主次分级）：

| 按钮 | 样式 | 位置序 |
|---|---|---|
| 创建草稿 | primary | 1 |
| 发布 | primary | 2 |
| 查看 | secondary | 3 |
| 视频创作 | secondary | 4 |
| 改写（文案库卡） | secondary | 5 |
| 删除 | danger | 末位 |

### 4.4 结果空态
- 条件：`collectedItems.length === 0`。
- 显示：`EmptyState`，icon=Link，标题 `$t('collection.resultsEmptyTitle')`，描述 `$t('collection.resultsEmptyDesc')`，动作 `$t('collection.resultsEmptyAction')`；点击动作 → 聚焦 URL 输入框（`document.querySelector` 经 ref，不用全局查询）。
- 替换原 `v-if="collectedItems.length > 0"` 整块跳过渲染的旧行为（旧行为：空时不渲染任何东西）。

### 4.5 错误与提示文字（全部 locale，zh/en 成对）

| 场景 | key（新增） | zh 文案 |
|---|---|---|
| 折叠组 aria | collection.batchGroupLabel | 批量采集方式 |
| 结果空态标题 | collection.resultsEmptyTitle | 还没有采集结果 |
| 结果空态描述 | collection.resultsEmptyDesc | 粘贴一条链接开始采集，或展开下方批量方式 |
| 结果空态动作 | collection.resultsEmptyAction | 去采集 |
| 进度标题（复用既有 batchProgress/zhihuFavlist.progressTitle） | — | 不变 |

- 既有文案一律不动 key 不改文案（避免 locale 基线与既有测试漂移）；新增仅上述 4 key × 2 语言。

## 5. 视觉规范（token 收编映射）

| 现值（位置） | 目标槽 | 备注 |
|---|---|---|
| `.cohere-content` 渐变 `#f8fafc→#f1f5f9`（:2629） | `--color-bg-page`（新增） | 暗色 #14141b 系 |
| 卡底 `rgba(255,255,255,.98)`（:2635） | `--color-bg-card`（已有） | 删 backdrop-filter（暗色下无意义且耗性能） |
| 卡边 `rgba(229,231,235,.8/.6)`（:2637/2653） | `--color-border`（已有） | |
| hover 阴影 rgba 黑系（:2644） | `--shadow-card-hover`（新增，完整 box-shadow 值槽） | 暗色加深 |
| 饰带渐变 `#ea580c→#fb923c→#fdba74`（:2666） | `--color-ribbon`（新增 gradient 槽） | 暗色降饱和 |
| 知乎错误底/字 `#fff3f3/#d32f2f`（:263/264） | `--color-error-banner-bg/-text`（已有） | 随内联类化迁走 |
| 改写失败 `#e6a23c`（:380） | `--color-warning`（新增） | 亮 #b45309（WCAG on card ≥4.5）/ 暗 #fbbf24 |
| 未知标签 `#ececee/#a8a8b3`（:2748） | `--soft-stone` / `--color-text-secondary` | |
| 标签边 `#dcdee3`（:2750 等） | `--color-border` | |
| 徽标底 `#fef2f2`（:2798） | `--color-ribbon-soft`（新增） | 暗色 #3b2417 系 |

**新槽清单（6 个）**：`--color-bg-page`、`--shadow-card-hover`、`--color-ribbon`、`--color-ribbon-soft`、`--color-warning`、`--color-progress-track`（后者 T1-3d 已有则复用）。全部同步登记 `tokens.slots.test.js`（亮暗两档 + 暗色真覆盖 + WCAG 断言）。

**内联样式类化**：知乎区块 20+ 处 `style="…"` 全部迁为 BatchCollectPanel scoped class（`zb-*` 前缀），颜色一律 var(--*)。

**动效**：`col-panel-ribbon` 3s 无限动画保留（已有 learnings 记录其与视觉基线的关系，重建基线时以 `reducedMotion` 同参取证），hover 抬升/扫光时长缓动不改值。

## 6. 数据校验（显式不变声明）

- 知乎数量 `1–100`、全量模式 ≤200、URL/secret 非空校验、`collect-error.js` 错误分类、改写字数区间联动 disabled —— 全部保留原实现随组件迁移；`BatchCollectPanel` 迁移后 IPC 入参（`aggregationCollectBatch` / `zhihu-fav-batch:run` / `zhihuFavlist*`）逐字段与迁移前一致。
- 结果列表批量操作（平台 scope、账号勾选、视频池）状态仍在父级 composable（`useBatchCollect`），子组件纯受控。

## 7. 文件拆分与行数预算

| 文件 | 动作 | 预算 |
|---|---|---|
| `features/collection/ColProgressBlock.vue` | 新增 | ~50 行 |
| `features/collection/BatchCollectPanel.vue` | 新增（模板 135–309 + batch/zhihu script ~600 行迁出） | ~700 行 |
| `features/collection/CollectedResultsList.vue` | 新增（模板 311–393 + 渲染辅助） | ~220 行 |
| `Collection.vue` | 模板替换为 3 个组件标签；script 删除迁出段；style 收编 | 2920 → ≤2400 |

每文件新写配套 `.test.js`（源码契约 + 挂载行为锁）。

## 8. 回归保护

- 既有 `Collection.test.js` 全量必须绿（testid/DOM 角色/交互契约不变是迁移红线）。
- 新增 3 个组件测试（tasks §2）。
- 视觉基线：`test:visual:pixel` collection 视图归因后重建；前后截图入 `openspec/records/collection-ui-refinement.md`。
- QM-1 打包 + 8s 启动 stderr 干净。

## 9. 验收标准

1. 折叠分组：默认仅一组展开、互斥、aria 完整、testid 契约通过。
2. 进度同构：两种批量进度 DOM 同构、语义槽上色。
3. 卡片分级：primary/secondary/danger 断言通过。
4. 硬编码门禁：采集相关渲染层文件 hex 字面量 = 0；新槽亮暗两档齐备。
5. Collection.vue ≤2400 行且 check-max-lines PASS。
6. locale 成对 + CJK 基线零新增。
7. 视觉基线归因+重建完成，前后对照截图入档。
8. QM-1 打包启动干净。
9. PR CI 全绿 → 自动 squash 合并 → 回填销账。

## 10. 记忆与文档收尾

- 内置记忆（`.agent_context/collection-ui-refinement.md`）：拆分契约 + token 收编清单。
- 外部记忆：`01-docs/learnings.md` 置顶追加（可复用教训）。
- EverOS：episode + atomic_facts（`POST /api/v1/memory/add` → `flush` → 落盘 episode grep 哨兵词 `collection-ui-refinement`），接口回显成功不作数。
