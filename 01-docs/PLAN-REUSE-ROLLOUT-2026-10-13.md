# PLAN-REUSE-ROLLOUT-2026-10-13 — 竞品可复用项分阶段实施计划

> **日期**：2026-10-13 ｜ **Worktree**：`mp-reuse-rollout`（分支 `reuse-rollout-2026-10`）
> **配套设计文档**：[ARCH-REUSE-INTEGRATION-2026-10-13.md](./ARCH-REUSE-INTEGRATION-2026-10-13.md)（下称「设计文」）
> **依据**：`D:\Data\projects\rea\analysis\`（22 份逆向报告 + 25 个取证脚本）、`01-docs/MP-REUSABLE-ACTUAL-PLAN.md`、`01-docs/PRD-PUBLISH-CAPABILITY-REGISTRY-2026-10-08.md`、`01-docs/PRD-API-PUBLISH-ENGINE.md`
> **性质**：实施计划。**本文不含代码改动**；每个任务的验收判据均可机械核验。

## 目录

§0 [核实范围说明](#0-核实范围说明) ｜ §1 [阶段划分与总览](#1-阶段划分与总览) ｜ §2 [P0 基础设施](#2-p0基础设施分类体系可热更) ｜ §3 [P1 核心能力](#3-p1核心能力指标矩阵--纯函数) ｜ §4 [P2 扩展能力](#4-p2扩展能力卡片分页引擎--搜索跳转) ｜ §5 [P3 长期](#5-p3长期平台覆盖前置) ｜ §6 [依赖图](#6-依赖图) ｜ §7 [里程碑与验收判据](#7-里程碑与验收判据) ｜ §8 [风险与缓解](#8-风险与缓解含合规) ｜ §9 [工时估算](#9-工时估算) ｜ §10 [明确不做的](#10-明确不做的) ｜ §11 [术语与交叉引用](#11-术语与交叉引用)

---

## 0. 核实范围说明

**本文继承设计文的核实纪律**：凡「新增 X」的任务，其文件路径与缺口结论**均已在设计文中
附检索证据**（`git grep` / `git ls-files` 命中或零命中）。本文不重复贴证据，改为指向设计文小节。

**核实范围的三条界定**：

1. **已核实** —— 任务的**目标文件路径存在性**、**缺口真实性**、**既有先例**均已取证。
   本文所有任务的文件路径均属此类（设计文 §10.1 的 V-1 ~ V-21）。
2. **待确认** —— 影响任务**排期顺序或范围**但未取证的事项（设计文 §10.2 的 U-1 ~ U-7）。
   本文在相应阶段标注 `【阻塞 U-n】`，并给出**解除方式**与**不解阻时的降级**。
3. **本次核查已闭合的项** —— U-2（`esbuild` 依赖归属）已由设计文 V-20 闭合：
   `apps/desktop/package.json` 的 `dependencies.esbuild` 为空、`devDependencies.esbuild = ^0.25.12`。
   **对排期的影响**：P2 的注入策略**必须走构建期产物**，不可改成运行时打包。

**本文与设计文的编号对照**：设计文用 **R-1 … R-7** 标记可复用项；本文用 **P0-1 … P3-2** 标记任务，
两者的映射见 §11.1。**R 编号与 P 编号不得混用**。

**两个基线（可用于排期，无需重复验证）**：

- ✅ `apps/desktop/electron/services/rpa-view-manager.js:24-25,39,153` **已桥接**
  `api-publish-engine` 的 `CancelToken` ⇒ `MP-REUSABLE-ACTUAL-PLAN.md` 的 **Task 1 已完成，不排期**。
- ❌ `apps/desktop/electron/ipc-handlers/validate.js` **不存在** ⇒ 旧计划 Task 2 的载体缺失，
  但**本计划决定不做**（理由见 §10 X-1）。

---

## 1. 阶段划分与总览

**划分原则**：① **P0 必须先行** —— 它产出「数据 + 读取层」，后续三项都依赖它；
② 每个阶段结束时**必须有可机械验证的交付物**，不允许「做了一半留到下阶段」；
③ 阶段内的任务尽量**可并行**，串行点显式标注。

| 阶段 | 目标 | 交付物 | 任务数 | 预估工时 | 依赖 |
|---|---|---|---|---:|---|
| **P0** | 分类体系可热更 | `config/platform-taxonomy.json` + 读取层 + 发布链接入 | 5 | 14–20 h | 无 |
| **P1** | 指标矩阵 + 两个纯函数 | 指标矩阵读取层、素材组合、时间轴拍平 | 4 | 12–18 h | P1-1/P1-2 需 P0 的 `config/` 模式已确立（软依赖）；P1-3/P1-4 **零依赖** |
| **P2** | 卡片分页引擎 + 搜索跳转 | 分页纯逻辑 + offscreen 渲染 + 跳转清单 | 7 | 26–38 h | P2-1..P2-6 需 P0（承载形态归一复用 `formatArticleBody`）；P2-7 **零依赖** |
| **P3** | 平台覆盖前置 | 接入顺序定稿 + **1 个**平台试点 | 2 | 12–18 h | 需 P0（分类表 `variant` 判定） |

**总计 18 个任务 / 64–94 h**。按每天 4–6 有效工时计，约 **11–23 个工作日**（单人串行）；
并行度足够时（P1 的两个纯函数可与 P0 并行）可压到 **8–15 个工作日**。

**每阶段的门禁要求（统一，不逐任务重复）**：

1. **TDD**：测试先于实现，提交前全绿（AGENTS.md 核心原则）。
2. **`.quality-gates.md`** 自检清单完成；纯文档改动可走 docs-only 快速通道
   （`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` 判定），
   但**本计划全部任务含代码**，属混合 PR，**不得走该通道**。
3. **QM-1 打包验证**：凡改 `apps/desktop/electron/` 或 `packages/rpa-engine/` 的任务，
   必须本地跑 `cd apps/desktop && pnpm exec electron-builder --win --x64` 并通过（P2-2/P2-3/P2-6 涉及）。
4. **QM-2 代码审查必检项**：`require` 路径、preload sandbox 兼容、IPC 参数序列化安全、
   路径层级用 `path-utils`、模块导出无多余逗号。
5. **locale 成对**：改 `apps/desktop/src/locales/zh.js` 必须同次改 `en.js`
   （CI Gate 7 `.github/scripts/check-locale-sync.js` 拦截）。
6. **品牌残留**：`node scripts/check-no-brand-residue.js` 必须通过 ——
   **两份文档与所有新增代码/数据一律写「参考产品」**，不写竞品品牌名。
7. **PR 落地**：经 PR 合并（禁止直推 `main`）；PR 侧门禁全绿后按 AGENTS.md「PR 自动合并」判据自动 squash 合并。

---

## 2. P0：基础设施（分类体系可热更）

**阶段目标**：让「平台侧分类 ID」成为**可热更的数据**而非硬编码，并在发布链上打通取用路径。
**为什么先做**：它是唯一一项**改动面横跨 `config/` + `packages/` + `apps/desktop/` 三层**的工作，
且 P1-1/P1-2 与 P2-1 都要复用它的 `config/` 落地模式与 `validate*()` 校验风格。
**阶段门禁**：P0-1..P0-5 全部完成 + §7 的 M0 判据全通过。

### P0-1 平台分类转换器（离线工序）

| 项 | 内容 |
|---|---|
| **文件** | `scripts/import-platform-taxonomy.js`（**新增**）+ `scripts/import-platform-taxonomy.test.js`（**新增**） |
| **依据** | 设计文 §3.4 |
| **输入/输出** | 读**只读**目录 `rea\analysis\wemedia-data-zip\data\`（**绝不复制进本仓**）；写 `config/platform-taxonomy.json` |
| **做什么** | ① 逐文件**双解码试探**（`utf8bad === 0 → UTF-8`，否则 `gbkbad === 0 → GBK`，两者皆非 0 ⇒ 记 `unreadable[]`，**不猜**）；② **6 种形态**无关递归遍历；③ **fail-loud**（非空文件解析出 0 节点 ⇒ 记 `unreadable[]` + **exit 1**）；④ 形态 F 的 `ids` 与 `id` 一致性自检；⑤ slug 映射表（未映射**一律跳过**并记 `unmappedPlatforms[]`，**禁止猜 slug**）；⑥ 6 条对账断言 |
| **验收判据** | ① 退出码 0；② **连跑两次产物 SHA-256 相同**；③ `nodeCount === 11623` 且 `platformCount >= 20`；④ `variant:'id'` 平台全部节点有非空 `id`、`variant:'name-only'` 平台全部节点 `id === null`；⑤ `path` 与 `parentId` 链自洽 |
| **依赖** | 无 |
| **工时** | 4–6 h（形态遍历 3–4 h + 对账与编码试探 1–2 h） |
| **【阻塞 U-5】** | 若出现第 7 种形态，`unreadable[]` 非空 ⇒ **停下补遍历器**，不得放行。**解除方式**：把该文件加入遍历器后再跑，直到 `unreadable[]` 为空 |

### P0-2 分类读取层（纯函数 + 缓存）

| 项 | 内容 |
|---|---|
| **文件** | `packages/shared-utils/src/platform-taxonomy.js`（**新增**）；`packages/shared-utils/src/index.js`（**改** 2 行）；`packages/shared-utils/src/__tests__/platform-taxonomy.test.js`（**新增**） |
| **依据** | 设计文 §3.3 |
| **做什么** | 实现 7 个导出：`UNKNOWN_ID`、`loadTaxonomy`（mtime+size 缓存，**不认识的 `schemaVersion` fail-closed**）、`getCategories`（返回副本，未收录平台返回**空数组**）、`resolveCategoryId`（**4 种 null 成因**，歧义**必须返回 null 不择一**）、`hasPlatformCategories`、`searchCategories`、`validateTaxonomy` |
| **验收判据** | ① `validateTaxonomy().length === 0`；② `resolveCategoryId('douyin','动植物').id === '117'`；③ `resolveCategoryId('kuaishou','三农/种植业') === null`（`name-only`）；④ `resolveCategoryId('douyin','不存在的分类') === null`；⑤ 同名歧义用例返回 `null`；⑥ 6 种形态**精确节点数**断言全过；⑦ `loadTaxonomy` 对 `schemaVersion: 999` **抛错** |
| **依赖** | **P0-1**（需要产物文件） |
| **工时** | 3–4 h |

### P0-3 发布链路由接线

| 项 | 内容 |
|---|---|
| **文件** | `apps/desktop/electron/services/publisher-router.js`（**改**）；`apps/desktop/electron/services/publisher-router.test.js`（**追加** 3 条用例） |
| **依据** | 设计文 §3.6(a) |
| **做什么** | 在既有 `if (platform === 'bilibili') … else if (platform === 'youtube') …` 分支**之前**插入通用分类解析：仅当 `hasPlatformCategories(platform) && override.categoryName !== undefined` 时调 `resolveCategoryId`，命中则写 `resolved.category`，**未命中不写字段**（fail-closed） |
| **★ 顺序不变量** | 通用层**必须在前**、精确层**在后** —— 否则通用层会用分类名解析结果**覆盖调用方显式给的 bilibili 分区 tid**，即破坏既有合同 |
| **验收判据** | ① `publisher-router.test.js` **既有用例全绿**；② 新用例：`category` + `categoryName` 同给 ⇒ 结果是 `category`（精确层胜出）；③ 未知平台给 `categoryName` ⇒ `resolved.category` **未定义**；④ 解析不到 ⇒ 字段不出现 |
| **依赖** | **P0-2** |
| **工时** | 1.5–2 h |
| **风险** | 破坏 bilibili/youtube 合同 ⇒ 回滚 = 摘掉通用层那段（单文件、单 hunk） |

### P0-4 能力注册表登记分类字段

| 项 | 内容 |
|---|---|
| **文件** | `packages/shared-utils/src/publish-capabilities.json`（**改**）；`packages/shared-utils/src/__tests__/publish-capabilities.test.js`（**追加**快照断言） |
| **依据** | 设计文 §3.6(c)；`PRD-PUBLISH-CAPABILITY-REGISTRY-2026-10-08.md` §1.1 |
| **做什么** | 为有分类能力的平台加一条 `{key:'categoryName', semantic:'category', uiExposed:true, status:'implemented', …}`。**禁止**新增 `v-if` 硬编码 —— 那会反向加重该 PRD 要修的债 |
| **验收判据** | ① `validateRegistry()` 返回空数组；② `getPlatformOverrideFields('<slug>', {uiOnly:true})` 含 `categoryName`；③ `classifyPublishFields()` 把 `semantic:'category'` 归类为 `common`（≥3 平台）且**快照断言通过** |
| **依赖** | **P0-2**（需要 `hasPlatformCategories` 的清单） |
| **工时** | 1.5–2 h |

### P0-5 适配器分类消费（每个平台 ≤1 h）

| 项 | 内容 |
|---|---|
| **文件** | `packages/api-publish-engine/src/adapters/<slug>.js`（**改**，逐个平台） |
| **依据** | 设计文 §3.6(b) —— **已核实** `task-data.js:33` 与 `publish-request.js:39` 的字段白名单**已含** `category`/`categoryId`，**无需改白名单** |
| **做什么** | 让适配器读 `taskData.category`（当前只有 `adapters/youtube.js:85` 读 `taskData.categoryId`）。**每个平台一次提交，不做批量改造** |
| **验收判据** | 每个接入的平台有一条请求体形状断言（该平台 chain 测试内）：分类 ID 出现在请求体的正确字段位 |
| **依赖** | **P0-3** |
| **工时** | 1 h / 平台（**本轮只做 P0 平台**：`baijiahao` + `toutiao` 两个，共 2 h）；其余随 P3-2 逐个补 |
| **不做** | 不为 `name-only` 平台接入（无 ID 可提交） |

---

## 3. P1：核心能力（指标矩阵 + 纯函数）

**阶段目标**：① 把参考产品的指标能力矩阵变成**可交叉校验的参考数据**（不新增真源）；
② 交付两个**零依赖纯函数**（素材组合、时间轴拍平），为后续视频链提供地基。
**阶段门禁**：M1 判据全通过。**P1-3 / P1-4 零依赖，可与 P0 完全并行**。

### P1-1 指标矩阵转换器 + 读取层

| 项 | 内容 |
|---|---|
| **文件** | `scripts/import-platform-metric-matrix.js`（**新增**）、`config/platform-metric-matrix.json`（**新增**）、`packages/shared-utils/src/platform-metric-matrix.js`（**新增**）、`packages/shared-utils/src/index.js`（**改** 2 行）、`packages/shared-utils/src/__tests__/platform-metric-matrix.test.js`（**新增**） |
| **依据** | 设计文 §4.2 / §4.3 |
| **做什么** | ① 解析矩阵（**UTF-8**，见设计文 §2.2）；② **二维结构** `groups`（组 → 平台 → 指标）—— 因为 `[1]` 内容数据段与 `[2]` 趋势数据段**不同名不同义**，不能压成一维；③ 读取层 5 个导出：`loadMatrix`、`getPlatformMetricCapabilities`、`getMetricSupport`（**三态**，含 `unknown-platform` 与 `unknown-metric` 的**区分**）、`reconcileObservation`（4 种 verdict）、`validateMatrix` |
| **★ 实现纪律** | `undeclared-but-present` **不是错误**（厂商矩阵是他们的能力边界，不是本仓的，实测优先）；**不得**把矩阵用于**请求门控**（只用于 UI 文案 + 测试交叉校验） |
| **验收判据** | ① `validateMatrix().length === 0`；② `getMetricSupport('wechat_mp','readTotal') === 'declared-unavailable'`（微信不含 `3`）；③ `getMetricSupport('baijiahao','income') === 'declared-available'`；④ `getMetricSupport('not-a-platform','income') === 'unknown-platform'`（**不是** `'declared-unavailable'`）；⑤ 未收录平台 `getPlatformMetricCapabilities` 返回 `[]` 而非 `null`；⑥ **变体反证**：把 `unknown-platform` 分支改成返回 `'declared-unavailable'` ⇒ 测试**必红** |
| **依赖** | 无（`config/` 落地模式与 P0-1 同构，但**不阻塞**） |
| **工时** | 3–4 h |

### P1-2 账号快照能力字段接入

| 项 | 内容 |
|---|---|
| **文件** | `apps/desktop/electron/services/account-metrics/index.js`（**改，极小**）；`account-metrics/index.test.js` + `account-metrics/adapters.test.js`（**追加**） |
| **依据** | 设计文 §4.5 |
| **做什么** | 编排层把 `getMetricSupport()` 结果并入账号快照的 `capability` 字段，供 UI 显示「该平台无此指标」而非 `-`。**每个适配器各加一条 `reconcileObservation` 交叉校验** |
| **★ 实现纪律** | 适配器**不得**改成「先查矩阵再决定要不要请求」—— 用它做请求门控会让「厂商矩阵不全」变成「本仓拿不到数」，是方向错误的依赖 |
| **验收判据** | ① `capability` 字段进入账号快照；② 缺指标显示为「平台不支持」而非 `-`；③ 每平台一条 `reconcileObservation`，声明有而实测 `null` 时**必须**被 `declared-but-null` 命中（防适配器悄悄漏解析） |
| **依赖** | **P1-1** |
| **工时** | 2–3 h |

### P1-3 素材组合三级降级算法（纯函数）

| 项 | 内容 |
|---|---|
| **文件** | `packages/shared-utils/src/media-combination.js`（**新增**）；`packages/shared-utils/src/index.js`（**改** 2 行）；`packages/shared-utils/src/__tests__/media-combination.test.js`（**新增**） |
| **依据** | 设计文 §5.3 / §5.4 / §5.5 |
| **做什么** | ① 四级顺序**固定**：`noRepetition`（循环移位，**保序**）→ `lowRepetition` → `ordinary` → `insufficient`；② **「够 max 即停」**（不许算完再截断 —— N=20 全排列是 20! 级）；③ 按 `join(separator)` 去重，**去重后不足如实回报 `insufficient`**（不重复填充凑数） |
| **★ 两处刻意修正** | ① 只返回**下标排列** `number[]`（不 clone 素材对象）；② 分隔符用 `\u0001` 而非 `''` —— 原实现下 `[1,23]` 与 `[12,3]` 连接后都是 `"123"`，去重会把**不同**排列误判为重复（`n > 9` 必然发生） |
| **验收判据** | ① `combineMedia(new Array(20).fill(0), {max:100}).combinations.length === 100` 且**耗时 < 50 ms**；② `combineMedia([1,2], {max:10}).reachedLevel === 'insufficient'`（长度恰为 2）；③ `combineMedia([], {max:1}).combinations.length === 0`；④ 性质测试：100 组随机参数下**无重复**、每条形如 `[0..n-1]` 的排列、级 1 的 n 条中**每段素材都出现**；⑤ **反证**：`separator: ''` 在 `n=12` 下**产生重复**（显式断言）；把实现改回 `join('')` ⇒ 主测试必红 |
| **依赖** | **无**（纯函数、零依赖、无消费者） |
| **工时** | 3–4 h |
| **本次不接线** | 消费者（`story2video-engine` / `remotion-composer`）**本次不改** —— 接线需决定「组合结果如何进入 `ScenePlan`」，与 P1-4 耦合。【阻塞 U-7】 |

### P1-4 时间轴绝对时间拍平模型（纯函数）

| 项 | 内容 |
|---|---|
| **文件** | `packages/shared-utils/src/timeline-flatten.js`（**新增**）；`packages/shared-utils/src/index.js`（**改** 2 行）；`packages/shared-utils/src/__tests__/timeline-flatten.test.js`（**新增**） |
| **依据** | 设计文 §6.2 / §6.3 |
| **做什么** | ① `flattenTimeline`（带冗余 `durationSeconds` 与 **累计最大值** `stopSeconds`）；② `entryAt`（**二分查找 `stopSeconds`**，半开区间 `[start,end)`）；③ `locate`；④ `toMilliseconds` / `fromMilliseconds`（**唯一**的 ×1000 / ÷1000 发生地）；⑤ `validateTimeline` |
| **★ 单位约定（不可协商）** | 内部一切时间字段是**秒**；毫秒只出现在**边界**；边界转换**只经两个函数**。**依据**：参考产品把「秒为主、出参 ×1000」散落在 6 处调用点，任何新增出参都可能漏乘 |
| **★ 一处既有行为不得改** | `scene-builder` 的 `durationInFrames` 是 `ceil((lastOut + 1) * FPS)` —— **末尾多加 1 秒**；`flattenTimeline` **不加**这 1 秒。收敛时由调用方决定是否 +1 |
| **验收判据** | ① `flattenTimeline([{id:'a',durationSeconds:5},{id:'b',durationSeconds:5}], {transitionOverlapSeconds:0.5})` ⇒ `entries[1].startSeconds === 4.5`、`totalSeconds === 9.5`；② `validateTimeline(...)` 返回 `[]`；③ `fromMilliseconds(toMilliseconds(x)) === x` 对 1000 组随机值**精确相等**（用 `toBe` 而非 `toBeCloseTo`）；④ `entryAt(t, 某条 endSeconds)` 返回**后一条**；⑤ `durationSeconds: 0` ⇒ **抛 `TypeError`**；⑥ **跨语言契约锁**：与 `scene-builder.test.ts` 同参数逐值对齐（除末尾 +1 秒） |
| **依赖** | **无**（纯新增；`scene-builder.ts` / `segment.ts` **本次不改**） |
| **工时** | 4–5 h |

---

## 4. P2：扩展能力（卡片分页引擎 + 搜索跳转）

**阶段目标**：① 补齐「长文 → N 张固定尺寸卡片」这一**已核实的能力空白**（设计文 N-2）；
② 提供中文搜索源的**跳转**能力（**不做抓取**）。
**阶段门禁**：M2 判据全通过。**P2-1..P2-6 为主线（强串行）；P2-7 独立，可全程并行。**

### P2-1 分页纯逻辑层（决策，无 DOM）

| 项 | 内容 |
|---|---|
| **文件** | `packages/shared-utils/src/card-paginator-core.js`（**新增**）；`packages/shared-utils/src/index.js`（**改** 2 行）；`packages/shared-utils/src/__tests__/card-paginator-core.test.js`（**新增**） |
| **依据** | 设计文 §7.2 / §7.3 / §7.4 |
| **做什么** | `paginate(items, options)` 注入式测量（**假 measure 可完整覆盖算法**）；**三情况 + 情况 0**（单条超页**独占一页**，原主循环缺这条 ⇒ 死循环）；二分切分 + **标点吸附**；**单份循环**（合并原实现两套重复实现） |
| **★ 4 个必修缺陷** | ① 测量**必须计入 icon 高度**（`PaginateItem.iconHeight`）；② `noMarginTop` **渲染侧同样消费**；③ **`CLAUSE_ENDERS` 非空**（原实现是空数组）；④ **合并两套装箱循环** |
| **验收判据** | ① 注入确定性假 measure：三情况分支各一例、二分产出的 `part1` 恰好不超预算、5 级标点吸附**逐级**各一例、`noMarginTop` 只标 `part2`、单条超页、退化切分拒绝、非法参数抛错；② `CLAUSE_ENDERS.length === 4` 且 `snapToPunctuation('aaa，bbb', 6) === 4`；③ `maxPages = 3` 时 `measure` 调用次数 **< 全量 40%**（证明**提前退出**非事后截断）；④ **反证**：把 `CLAUSE_ENDERS` 改成 `[]` ⇒ 第 ② 条必红 |
| **依赖** | 无（纯逻辑，零依赖） |
| **工时** | 4–6 h |

### P2-2 构建接线（esbuild 打包分页器为 IIFE）

| 项 | 内容 |
|---|---|
| **文件** | `apps/desktop/package.json`（**改** `scripts`，加 `"build:paginator"` 并串进 `build`）；产物 `apps/desktop/electron/services/generated/card-paginator.iife.js` |
| **依据** | 设计文 §7.7「注入策略 A」 |
| **做什么** | 用 **esbuild** 把 `card-paginator-core.js` 打成 IIFE 字符串产物，运行时用 `buildEvalScript` 注入 ⇒ **算法只有一份实现**（构建期打包，不是复制源码） |
| **★ 已核实约束（V-20）** | `esbuild` 在 `apps/desktop` 是 **devDependency**（`^0.25.12`）⇒ **必须构建期打包**，**不可**改成运行时 `require('esbuild')` |
| **★ 已核实** | 产物落在 `electron/**/*`，`files` 数组**已覆盖该 glob，无需改 `files`** |
| **验收判据** | ① `pnpm run build:paginator` 退出码 0 且产物存在；② 产物是**合法 IIFE**（`node --check` 或 esbuild 自校验）；③ 产物**含** `paginate` 与 `CLAUSE_ENDERS`（`grep` 断言）；④ 在 `apps/desktop` 跑一次构建，产物随包进 `app.asar`（QM-1 打包后 `asar list` 命中该路径） |
| **依赖** | **P2-1** |
| **工时** | 2–3 h |

### P2-3 offscreen 渲染层

| 项 | 内容 |
|---|---|
| **文件** | `apps/desktop/electron/services/card-capture.js`（**新增**）；`apps/desktop/electron/services/card-capture.test.js`（**新增**） |
| **依据** | 设计文 §7.2(2) / §7.7 |
| **做什么** | 复用本仓既有形态：**offscreen `BrowserWindow`（`show:false`）+ 注入脚本 + `capturePage()`**（先例 `cover-cropper.js` / `rpa-view-platforms.js:602,926`）；安全传值走 `core/js-eval-payload.js` 的 `buildEvalScript` |
| **★ 失败纪律** | 窗口创建失败 / 脚本注入失败 / **任一步截图失败** ⇒ **抛错**；**已成功的页丢弃**（部分产物比没有更危险 —— 用户会以为发全了）；超时 ⇒ 销毁窗口 + 抛 `TimeoutError` |
| **验收判据** | ① `buildMeasurementScript({widthPx:1006})` 产物含 `left:-10000px` 与 `1006px`，**不含** `display:none`；② `buildPageScript(1,{noMarginTop:true})` 产物含 `margin-top:0`；③ 集成：2000 字输入 `pageCount >= 2` 且 `pages.every(b => b.length > 0)`；④ **回归锁**：带 icon 模板 + 刚好填满的文本 ⇒ 渲染后正文容器 `scrollHeight <= clientHeight`（不溢出）；⑤ 性能：2000 字 / 20 段 **< 1.6 s**（超时上限 8 s） |
| **依赖** | **P2-1 + P2-2** |
| **工时** | 6–8 h |
| **QM-1** | 本任务改 `apps/desktop/electron/` ⇒ **必须本地打包验证** |

### P2-4 IPC 通道 + preload 暴露

| 项 | 内容 |
|---|---|
| **文件** | `apps/desktop/electron/ipc-handlers/render.js`（**改**，加 1 个通道）；`apps/desktop/electron/preload/*.js`（**改**）；`apps/desktop/src/locales/zh.js` + `en.js`（**改，成对**） |
| **依据** | 设计文 §7.7 |
| **做什么** | 通道 `render:cards`（按既有命名惯例）→ `card-capture.renderCardsToPng()` → 写临时 PNG → 返回路径数组 |
| **★ 三条硬约束** | ① **该通道自己的入参校验不可省**（§10 X-1 说明了为何不引入统一中间件）；② 入参必须是**纯 JSON 对象**（Vue ref/reactive 要 `JSON.parse(JSON.stringify())` 脱壳，否则报 "An object could not be cloned"）；③ **改 preload 必须重打包 `index.bundle.js`**（AGENTS.md QM-2，preload 只在窗口创建时加载，HMR 不热更新） |
| **验收判据** | ① 通道入参非法时返回**稳定错误合同**而非 crash；② 在**真实 Electron 窗口**内调用成功（浏览器打开 Vite 无 `window.electronAPI`，必须用 Electron）；③ `sandbox:true` 与 `sandbox:false` 两种模式都验证 `window.electronAPI` 可用；④ `node scripts/check-locale-sync.js` 退出码 0 |
| **依赖** | **P2-3** |
| **工时** | 3–4 h |

### P2-5 渲染层入口与文案

| 项 | 内容 |
|---|---|
| **文件** | 选题/发布页的 Vue 组件（**改**，加「生成图文卡片」入口）；`apps/desktop/src/locales/zh.js` + `en.js`（**改，成对**） |
| **依据** | 设计文 §7.7 调用链 |
| **做什么** | 用户点按钮 → `window.electronAPI.render.cards({content, templateId, widthPx, heightPx})` → 进度提示 → 展示结果路径/失败原因 |
| **★ 失败面** | 必须展示 `warnings`（尤其 `item-exceeds-page` / `page-limit-reached`）—— 用户的文本超出一页时**必须知情**，不得静默 |
| **验收判据** | ① 入口可点、进度可见、失败有明确文案；② `warnings` 非空时有可见提示；③ locales 成对；④ 手动验证：启动 ✅ / 核心功能 ✅ / 非法输入不崩溃 ✅ / 错误提示友好 ✅（AGENTS.md 阶段 5 要求） |
| **依赖** | **P2-4** |
| **工时** | 3–5 h |
| **【阻塞 U-6】** | 若无现成「卡片模板几何」数据，`contentCss` 无来源。**降级**：先内置**单模板**（一个 1242×1660 的正文卡片），把模板供给列为后续 |

### P2-6 卡片分页端到端验收

| 项 | 内容 |
|---|---|
| **文件** | `apps/desktop/electron/services/card-capture.integration.test.js`（**新增**，若 P2-3 未含则在此补齐） |
| **依据** | 设计文 §7.8 |
| **做什么** | 建**真实 offscreen 窗口**跑端到端：真实字体、真实排版、真实截图 |
| **验收判据** | ① 页数符合预期；② 每页 PNG 尺寸 == 期望；③ **无 `warnings`**（带 icon 模板必须无 `item-exceeds-page`）；④ **核心回归**：带 icon 模板下 `scrollHeight <= clientHeight`（这是缺陷 ① 的原始事故形态）；⑤ **QM-1 完整打包**并通过启动测试（8 秒不崩溃 + stderr 无 `Failed to load platform config` 等） |
| **依赖** | **P2-5** |
| **工时** | 3–4 h |

### P2-7 中文搜索源跳转清单（**不做抓取**）

| 项 | 内容 |
|---|---|
| **文件** | `apps/desktop/electron/services/search-jump-sources.js`（**新增**）+ `.test.js`（**新增**）；既有内容域 IPC handler（**改**，加**并列**通道）；`preload/*.js`（**改**）；`locales/zh.js` + `en.js`（**改，成对**）；选题调研页（**改**，加「外部搜索」入口） |
| **依据** | 设计文 §8.2「第一段」 |
| **做什么** | 4 个导出：`listJumpSources`、`filterJumpSources`、`buildSearchUrl`（**唯一**的拼 URL 处）、`validateJumpSources`（自检：每个模板**恰含一个** `%s`；host 在白名单；id 唯一） |
| **★ 三条硬纪律** | ① `%s` 必须 `encodeURIComponent` 且**只替换一次**（用 `replace` 而非 `replaceAll`）；② 返回值**必须过 `safeHttpUrl()`**（AGENTS.md 明确「外部可控 URL 绑定可点击锚点前必须过共享协议判据」）；③ 跳转走**受控内嵌视图**，**不得** `shell.openExternal` |
| **★ 消费方纪律** | `content-intelligence` **不新增方法** —— 加**并列 IPC 通道**。跳转源**没有结果**，混进 `search()` 的返回会污染 `total`/`relevanceOn` 门禁语义 |
| **验收判据** | ① `validateJumpSources().length === 0`；② `buildSearchUrl('baidu','中文 测试') === 'https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87%20%E6%B5%8B%E8%AF%95'`；③ `buildSearchUrl('baidu','x&y=z#frag')` **不含裸 `&` 与 `#`**；④ 空查询 → `null`、未知 id → `null`；⑤ 全部源模板各含**恰好一个** `%s`；⑥ **反证**：去掉 `encodeURIComponent` ⇒ ②③ 必红；⑦ **抓取禁令机械判据**：`search-jump-sources.js` **不含** `axios` / `fetch` / `http.request`（源码扫描测试锁定） |
| **依赖** | **无**（可全程并行） |
| **工时** | 4–6 h |
| **【阻塞 U-3】** | 加源前**必须**先读 `PRD-QUICK-COLLECT-CN-SOURCES-2026-10-11.md` 与 `PRD-HOT-TOPICS-MULTI-SOURCE-AI-CATEGORY-2026-10-12.md` 正文，确认未与既有规划重复。**降级**：若已有规划覆盖，则本任务并入既有 PRD 的范围，**不另起** |

---

## 5. P3：长期（平台覆盖前置）

**阶段目标**：把 38 个平台缺口从「清单」变成**可执行的排序 + 已验证的标准动作**，
并用**一个**平台试点证明标准动作可行。**本周期不批量扩平台**（理由见 §10 X-7）。

### P3-1 扩平台标准动作脚本化

| 项 | 内容 |
|---|---|
| **文件** | `scripts/verify-platform-onboarding.js`（**新增**） |
| **依据** | 设计文 §9.3 的 **11 步清单**（全部路径已核实） |
| **做什么** | 把 11 步判据做成**一条命令**：`node scripts/verify-platform-onboarding.js <slug>`，逐条输出 PASS/FAIL。覆盖：①~③ `platform-definitions.js` 三张表命中；④ `platforms.yaml` 字段完整；⑤ `publish-capabilities.json` 元数据 + `validateRegistry()`；⑥ `getArticleBodyKind()` 符合预期；⑦ 三张上限表**且与注册表一致**；⑧ `TAG_STYLES` 命中；⑨ `has_api:true` ⇒ 链文件存在且被 `platform-entries.js` 登记；⑩ 适配器含 `formatArticleBody`；⑪ locales 成对 + `.github/scripts/check-locale-sync.js` 通过 |
| **★ 额外判据** | ⑫ 新平台正文链**不含**自己写的 `<p>` 包装或 HTML 剥离（源码扫描）；⑬ **顺序不变量**：话题转换必须先于 `<p>` 包装 |
| **验收判据** | ① 对**已有平台**（如 `baijiahao`）跑 ⇒ 全 PASS；② 对**不存在的 slug** 跑 ⇒ 退出码非 0 且逐条报 FAIL（**不静默通过**）；③ 脚本自身有测试（`scripts/verify-platform-onboarding.test.js`），含「故意漏一步 ⇒ 该步 FAIL」的反证 |
| **依赖** | **P0**（分类表的 `variant` 判定是选平台的前置） |
| **工时** | 5–7 h |

### P3-2 单平台试点（推荐 `dayu` 或 `qie`）

| 项 | 内容 |
|---|---|
| **依据** | 设计文 §9.1 优先级表（P1 组：企鹅号 / 大鱼号 / 网易号 / 搜狐号） |
| **选哪个** | 建议先做**大鱼号（`dayu`）或企鹅号（`qie`）** —— 二者在参考产品数据中**带 ID 分类表**（R-1 就绪），且指标能力相对完整 |
| **做什么** | 严格按设计文 §9.3 的 11 步走一遍，全程用 P3-1 的脚本自检 |
| **验收判据** | ① `node scripts/verify-platform-onboarding.js <slug>` **全 PASS**；② 真机发布一条内容成功（含分类 ID 被平台接受）；③ `publishMode` 从 `dom-only` 提到 `api-then-dom` 前，**API 轨必须先跑通**（不得只改配置）；④ QM-1 打包 + 手动验证四问（启动/核心功能/非法输入/错误提示） |
| **依赖** | **P0 + P3-1** |
| **工时** | 8–12 h（有 API + 带 ID 分类表的平台，按设计文 §9.3 估算） |
| **【阻塞 U-1】** | 分类 ID 是否仍有效**只能真机验证**。**降级**：若平台拒收分类 ID，则该平台的接入**退化为不带分类**（`variant` 视为 `name-only`），并把结论回写 `config/platform-taxonomy.json` 的注释性元数据（不改 ID 本身） |

---

## 6. 依赖图

### 6.1 串行链（必须按序）

```
P0-1 ──> P0-2 ──┬──> P0-3 ──> P0-5
                └──> P0-4
                        （P0-4 只需 P0-2，可与 P0-3 并行）

P1-1 ──> P1-2

P2-1 ──> P2-2 ──> P2-3 ──> P2-4 ──> P2-5 ──> P2-6

P0 ──┬──> P3-1 ──> P3-2
     └──> (P3-2 的 variant 判定)
```

### 6.2 可并行项（无相互依赖）

| 并行组 | 任务 | 说明 |
|---|---|---|
| **A** | **P0-1→P0-2** 与 **P1-3** 与 **P1-4** | P1 的两个纯函数**零依赖、纯新增、无消费者** ⇒ 可与 P0 全程并行 |
| **B** | **P1-1** 与 **P0-3/P0-4** | P1-1 只需自建 `config/` 落地模式，不等 P0-2 |
| **C** | **P2-7** 与 P2 主线 | 搜索跳转与卡片分页**无任何文件交集** |
| **D** | **P2-1** 与 **P1-1/P1-2** | 分页纯逻辑只依赖 P2-2 的构建接线，不依赖 P1 |
| **E** | **P3-1** 与 P2 主线 | 脚本化任务不触碰 `apps/desktop/electron/services/` |

### 6.3 关键路径

**最长链 = `P0-1 → P0-2 → P0-3 → P0-5 → P3-1 → P3-2`**（4–6 + 3–4 + 1.5–2 + 2 + 5–7 + 8–12 ≈ **24–33 h**）。
**次长链 = `P2-1 → P2-2 → P2-3 → P2-4 → P2-5 → P2-6`**（4–6 + 2–3 + 6–8 + 3–4 + 3–5 + 3–4 ≈ **21–30 h**）。
**两条链无交集，可双线并行** ⇒ 整体工期由较长的 P3 链决定。

### 6.4 冲突预检（并发写同一文件的风险）

| 文件 | 被哪些任务改 | 冲突处置 |
|---|---|---|
| `packages/shared-utils/src/index.js` | P0-2、P1-1、P1-3、P1-4、P2-1 | **5 个任务都只加 2 行** ⇒ 冲突必然。**处置**：合计只在**最后一个任务**里改一次，或每个任务用**不同 diff 位置**并及时 rebase |
| `apps/desktop/electron/preload/*.js` | P2-4、P2-7 | 两者都加通道 ⇒ 串行合并，**改完必须各重打包一次 `index.bundle.js`** |
| `apps/desktop/src/locales/zh.js` + `en.js` | P2-4、P2-5、P2-7 | 三处都加文案 ⇒ 成对提交，**每个 PR 必须自带 zh+en 两处改动**（CI Gate 7） |
| `config/` | P0-1、P1-1 | 新增**不同文件**，无冲突 |

**并发铁律（AGENTS.md）**：运行时代码任务**必须**在独立 worktree 中做
（`scripts/session-init.sh <task-name>`），共享根 `D:/Data/projects/mulpub` **只允许 main**。
并发会话改同一文件前，先 `git worktree list` + 扫 `.git/worktrees` 做冲突预检。

---

## 7. 里程碑与验收判据

**全部判据均为「可机械验证」**：能写成一条命令或有明确布尔结论的，才列在这里。

### M0 —— P0 完成（分类体系可热更）

| # | 判据（命令 / 断言） | 通过条件 |
|---|---|---|
| M0-1 | `node scripts/import-platform-taxonomy.js <src> <out>` 连跑两次 | 退出码 0 且**两次产物 SHA-256 相同** |
| M0-2 | 读产物 | `source.nodeCount === 11623` 且 `platformCount >= 20` |
| M0-3 | `validateTaxonomy().length` | `=== 0` |
| M0-4 | `resolveCategoryId('douyin','动植物').id` | `=== '117'` |
| M0-5 | `resolveCategoryId('kuaishou','三农/种植业')` | `=== null`（`name-only` 平台恒 null） |
| M0-6 | `publisher-router.test.js` **既有用例** | 全绿（未破坏 bilibili/youtube 合同） |
| M0-7 | `validateRegistry().length` | `=== 0` |
| M0-8 | `getPlatformOverrideFields('<slug>',{uiOnly:true})` | 含 `categoryName` |

### M1 —— P1 完成（指标矩阵 + 两个纯函数）

| # | 判据 | 通过条件 |
|---|---|---|
| M1-1 | `validateMatrix().length` | `=== 0` |
| M1-2 | `getMetricSupport('wechat_mp','readTotal')` | `=== 'declared-unavailable'` |
| M1-3 | `getMetricSupport('not-a-platform','income')` | `=== 'unknown-platform'`（**区分于** `declared-unavailable`） |
| M1-4 | 变体反证：`unknown-platform` 分支改返 `'declared-unavailable'` | 测试**必红** |
| M1-5 | `combineMedia(new Array(20).fill(0),{max:100}).combinations.length` | `=== 100` 且耗时 `< 50 ms` |
| M1-6 | `combineMedia([1,2],{max:10}).reachedLevel` | `=== 'insufficient'` |
| M1-7 | `flattenTimeline([{id:'a',durationSeconds:5},{id:'b',durationSeconds:5}],{transitionOverlapSeconds:0.5})` | `entries[1].startSeconds === 4.5`、`totalSeconds === 9.5` |
| M1-8 | 跨语言契约：与 `scene-builder.test.ts` 同参数 | `(start,end)` **逐值相等**（除末尾 +1 秒） |
| M1-9 | `separator: ''` 在 `n=12` 下 | **产生重复**（反证断言成立） |

### M2 —— P2 完成（卡片分页 + 搜索跳转）

| # | 判据 | 通过条件 |
|---|---|---|
| M2-1 | `pnpm run build:paginator` | 退出码 0 且产物存在且 `grep` 到 `CLAUSE_ENDERS` |
| M2-2 | `CLAUSE_ENDERS.length` 且 `snapToPunctuation('aaa，bbb',6)` | `=== 4` 且 `=== 4`（缺陷 ③ 已修） |
| M2-3 | `maxPages = 3` 时 `measure` 调用次数 | `< 全量的 40%`（证明**提前退出**） |
| M2-4 | 集成：2000 字输入 | `pageCount >= 2` 且 `pages.every(b => b.length > 0)` |
| M2-5 | **溢出回归锁**：带 icon 模板 + 刚好填满的文本 | `scrollHeight <= clientHeight`（缺陷 ① 已修） |
| M2-6 | 性能：2000 字 / 20 段 | `< 1.6 s` |
| M2-7 | **QM-1 完整打包** + 启动 8 秒 | 退出码 0；stderr **无** `Failed to load platform config` / `PluginLoader.*mkdir failed` / `ENOTDIR.*app.asar` |
| M2-8 | 真实 Electron 窗口调用 `render:cards` | 成功返回路径数组；`sandbox:true` 与 `false` 均可用 |
| M2-9 | `validateJumpSources().length` | `=== 0` |
| M2-10 | `buildSearchUrl('baidu','中文 测试')` | `=== 'https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87%20%E6%B5%8B%E8%AF%95'` |
| M2-11 | `buildSearchUrl('baidu','x&y=z#frag')` | **不含裸 `&` 与 `#`** |
| M2-12 | `search-jump-sources.js` 源码扫描 | **不含** `axios` / `fetch` / `http.request` |

### M3 —— P3 完成（平台覆盖前置）

| # | 判据 | 通过条件 |
|---|---|---|
| M3-1 | `node scripts/verify-platform-onboarding.js baijiahao` | 逐条 **PASS** |
| M3-2 | 同上，传**不存在的 slug** | 退出码非 0 且逐条 FAIL（**不静默通过**） |
| M3-3 | 试点平台真机发布一条含分类的内容 | 平台接受（**唯一需要真机的判据**，见 §8 合规） |
| M3-4 | `verify-platform-onboarding` 的反证测试 | 故意漏一步 ⇒ 该步 FAIL |

### 全阶段通用门禁（每个 PR 都要过）

`node scripts/classify-docs-only.js --base=origin/main --head=HEAD`（**本计划全部 PR 应为 `docs-only=false`**）
｜ `.quality-gates.md` 自检 ｜ `node scripts/check-no-brand-residue.js` ｜
`.github/scripts/check-locale-sync.js` ｜ QM-1 打包（涉及 electron 时）｜ QM-2 必检项 ｜
TDD（测试先于实现）｜ PR 合并 + 回填远程同步（`PENDING` → `PASS` + merge SHA，**同一次提交销账**）。

---

## 8. 风险与缓解（含合规）

### 8.1 技术风险

| # | 风险 | 概率 | 影响 | 缓解 | 回滚 |
|---|---|---|---|---|---|
| T-1 | **测量口径 ≠ 渲染口径**（重演原实现缺陷 ①②） | **中高** | 内容溢出卡片，用户可见 | ① 同一个 `measure` 契约**同时**服务测量与渲染；② 集成测试**直接断言** `scrollHeight <= clientHeight`；③ `noMarginTop`/`iconHeight` 进 `PaginateItem` 而非散在两侧 | 从模板清单移除该模板 |
| T-2 | 分页**性能不达预期**（大文档） | 中 | 用户等待 | `maxPages` 在**循环内**判定（提前退出）；页数上限产品侧明示；耗时可测（设计文 §7.4） | 降低默认 `maxPages` |
| T-3 | 注入策略需**构建接线** | 中 | 构建复杂度上升 | 产物进 `electron/**/*`（**已核实** `files` 已覆盖）；构建失败即红灯 | 删新通道（功能整体下线） |
| T-4 | **preload 改动未重打包** | 中 | 功能**静默不可用** | AGENTS.md QM-2 强制 + bundle 断言 | 重打包 |
| T-5 | **分类数据过期**（2026-07-14 冻结快照） | **高** | 提交的分类 ID 被平台拒 | ① 失败**如实上报不重试**；② UI 显示「数据可能过期」（>`MP_TAXONOMY_STALE_DAYS`）；③ 分类是**可选字段**，无值走平台默认 | 清空该平台 `nodes` ⇒ 退化为「无分类能力」 |
| T-6 | 转换器**静默少算**（上轮 v1 少 67%） | 中 | 分类不全且**不报错** | **fail-loud**：0 节点 ⇒ exit 1；`unreadable[]`；nodeCount 对账；两次产物 SHA-256 一致 | 重跑转换器 |
| T-7 | `index.js` / `locales` / `preload` **多方并发改** | 中 | 合并冲突、zh/en 不成对 | §6.4 冲突预检表；**每个 PR 自带 zh+en**；worktree 隔离 | 及时 rebase；冲突按「两侧都保留」解决 |
| T-8 | 指标矩阵被**误当真源**用于请求门控 | 中 | 「厂商矩阵不全」变成「本仓拿不到数」 | 文件头 + 接口文档**双处**声明「参考数据」；测试锁 `reconcileObservation` 语义 | 删 require 与 export |
| T-9 | 分页引擎**第三套**时间轴/几何实现加剧分裂 | 低 | 维护成本 | 文件头显式声明与 `scene-builder` 的关系；**跨语言契约锁**钉住一致性；收敛路径写入后续计划 | 删导出（无消费者） |

### 8.2 合规与法务风险（**本计划最需要显式声明的部分**）

| # | 风险 | 处置（硬约束，写入任务验收） |
|---|---|---|
| **C-1** | **参考产品数据的可用性边界** | ① 输入目录（`rea\analysis\...`）**绝不可复制进本仓** —— 转换器读**仓外绝对路径**；② 产物**只保留事实性数据**（平台 + 分类名 + 平台公开的类目 ID），**不含**参考产品的树形组织方式、注释文案、文件命名（含其拼写错误 `categort`）；③ **不复制代码** —— 本文所有纯函数均为**重写**（含 5 处刻意修正与 4 处缺陷修复），不是搬运；④ 报告与设计文档中**一律写「参考产品」**（品牌门禁 `scripts/check-no-brand-residue.js`）；⑤ 参考产品名仅出现在**只读引用的绝对路径**里，不入库 |
| **C-2** | **反爬**（不得对第三方站点做自动化抓取） | **P2-7 明确只做跳转、不做抓取**，并有**机械判据**：`search-jump-sources.js` 不含 `axios` / `fetch` / `http.request`（源码扫描测试）。R-6 第二段（HTML 抓取）列入 §10 X-5 不做 |
| **C-3** | **平台 ToS** | ① 跳转**不复制对方内容** ⇒ 规避版权与 ToS 争议；② 发布链全部走**平台官方创作者后台接口 + 用户自己的账号 Cookie**（本仓既有形态），不做绕过风控的行为；③ **不引入**参考产品的 RPA 看板 URL 表 / 采集注入规则 / DOM 类名指纹（§10 X-3）—— 那类数据既过期又逼近「规避平台技术措施」 |
| **C-4** | **敏感词库** | 参考产品的词库**加密不可直读**且**不尝试破解**（§10 X-4）。本仓沿用既有 `sensitive-filter.js` 与 `compliance-blocklist.json`；合规词库应走**正版来源** |
| **C-5** | **用户数据外发** | `buildSearchUrl` 把用户查询拼进第三方 URL ⇒ ① 必须 `encodeURIComponent`；② 必须过 `safeHttpUrl()`；③ 加 host 白名单；④ **跳转是用户主动点**，不做后台预取 |
| **C-6** | **品牌残留** | 全部 PR 必须过 `node scripts/check-no-brand-residue.js`。**注意**：本计划与设计文的文件名与引用的报告名中含参考产品字样（属**已存在**的 `rea/` 仓外文件），**新产物不含** |
| **C-7** | **门禁数据文件前提锁** | 若将来把新数据文件加进 `CI_IGNORED_PATHS`，**它的校验必须先接线到不被 docs-only 短路的 job**（AGENTS.md 明确的前提锁）。**本计划不新增任何白名单路径** |

---

## 9. 工时估算

**按任务给出区间**（单人、熟悉本仓、含测试与自检）。单位：小时。

| 任务 | 内容 | 估算 | 备注 |
|---|---|---:|---|
| **P0-1** | 分类转换器 | 4–6 | 形态遍历 3–4 + 编码试探与对账 1–2 |
| **P0-2** | 分类读取层 | 3–4 | 7 个导出 + 6 形态单测 |
| **P0-3** | 路由接线 | 1.5–2 | 单文件单 hunk + 3 条契约锁 |
| **P0-4** | 注册表登记 | 1.5–2 | JSON + 快照断言 |
| **P0-5** | 适配器分类消费 | 1 / 平台（本轮 2） | 本轮仅 `baijiahao` + `toutiao` |
| | **P0 小计** | **12–16** | |
| **P1-1** | 指标矩阵（转换器 + 读取层） | 3–4 | 二维结构 + 三态查询 |
| **P1-2** | 账号快照 capacity 接入 | 2–3 | 交叉校验 |
| **P1-3** | 素材组合纯函数 | 3–4 | 含两处修正 + 反证测试 |
| **P1-4** | 时间轴拍平纯函数 | 4–5 | 含跨语言契约锁 |
| | **P1 小计** | **12–16** | |
| **P2-1** | 分页纯逻辑 | 4–6 | 含 4 个缺陷修复 |
| **P2-2** | esbuild 构建接线 | 2–3 | 产物进 asar 验证 |
| **P2-3** | offscreen 渲染层 | 6–8 | 真实 DOM + 溢出回归锁 |
| **P2-4** | IPC + preload | 3–4 | 含 sandbox 双档验证 |
| **P2-5** | 渲染层入口与文案 | 3–5 | 含 warnings 可见性 |
| **P2-6** | 端到端验收 | 3–4 | 含 QM-1 完整打包 |
| **P2-7** | 搜索跳转清单 | 4–6 | 含抓取禁令扫描测试 |
| | **P2 小计** | **25–36** | |
| **P3-1** | 扩平台脚本化 | 5–7 | 11+2 条判据 + 自身测试 |
| **P3-2** | 单平台试点 | 8–12 | 含真机发布（唯一需真机的任务） |
| | **P3 小计** | **13–19** | |
| | **总计** | **62–87** | 18 个任务 |

**工期换算**：按每天 **4–6** 有效工时（含评审、打包、门禁）⇒ **11–22 个工作日**；
双线并行（P0/P1 链 与 P2 链 无交集）⇒ **8–15 个工作日**。

**估算的不确定性来源（诚实声明）**：

1. **P2-3 区间最宽（6–8 h）** —— 「测量口径 == 渲染口径」是本项最大的未知，真实 DOM 排版问题
   往往在集成阶段才暴露，历史上原实现正是**三处独立成因**叠加。
2. **P3-2 区间最宽（8–12 h）** —— 取决于目标平台 API 是否真的可用（【阻塞 U-1】只能真机验证）。
3. **未计入**：跨 worktree 的依赖安装与 `verify-worktree-deps.js`（首次约 1 分钟）、
   PR 评审与回填流程（按 AGENTS.md 每 PR 约 0.5–1 h）。

---

## 10. 明确不做的

**每一项都写明理由**（与设计文 §10.3 一一对应，**同一编号不得两处写不同内容**）。

| # | 不做的事 | 理由 |
|---|---|---|
| **X-1** | **IPC 参数校验中间件**（`MP-REUSABLE-ACTUAL-PLAN.md` Task 2） | ① 真实缺口是 **52+ 个 handler 逐个接线**，中间件本身（约 20 行）不是瓶颈；② 逐改是**侵入性改造**，会触碰账号/发布/许可证等已稳定链路，回归风险高；③ 本仓已有 `ipc-handlers/helpers.js` 的 `withSenderCheck`，**按需在新通道里用**即可；④ 收益（防非法参数 crash）远低于成本（改 130+ 文件）。**替代方案**：P2-4/P2-7 的**新通道各自带入参校验**，存量不批量改 |
| **X-2** | **删/改 `tag-suggest-data/platform-taxonomy.json`** | 它是**孤儿文件**（零读取点）但**内容与 `platform-rules.js` 重复且不完全一致**，删除会牵动 `PRD-SMART-TAG-SUGGEST-2026-08-31.md` 的 4 处引用。**本计划不动它**，改在 P0-2 的读取层文件头声明「同名不同物」；长期收敛单独立项 |
| **X-3** | **RPA 看板 URL 表 / 采集注入规则 / DOM 类名指纹** | ① 属参考产品的 **RPA 数据回收**路线，与本仓「API 优先」的 `publishMode` 三态总闸不同向；② **必然过期**（URL 随改版失效、类名带随机后缀且平台持续换）；③ 报告已明确「不建议照搬类名指纹」；④ **合规**：逼近「规避平台技术措施」。**本仓应走语义特征** |
| **X-4** | **敏感词库**（`sensitivelibrary.txt`，793 KB 加密） | ① 加密不可直读，报告明确「不尝试破解」；② 本仓已有 `sensitive-filter.js` 与 `compliance-blocklist.json`；③ 合规词库应走**正版来源** |
| **X-5** | **中文搜索源 HTML 抓取**（R-6 第二段） | ① **反爬**：中文主流搜索引擎对无头浏览器有 UA + 行为 + 频率特征识别，成本远高于收益且需**持续维护**；② **合规**：抓取搜索结果页并展示属**复制对方内容**，多数 ToS 禁止自动化查询；③ **门禁不可靠**：`content-intelligence` 的核心纪律是「标题级相关性门禁」，HTML 路径下 `title` 靠选择器抽取，**抽取质量即门禁质量**，对方 DOM 一改就**静默降级**而不报错 —— 这是「更坏的失败」形态。**若将来要做**，前置三条（写入独立 PRD）：明确的反爬处置方案与预算 + ToS 合规结论 + 抽取层 fail-loud |
| **X-6** | **参考产品的假进度条模式**（定时器 1→90） | 报告自己把它列为**反面教材**（用户看到 90% 后长时间无变化、实际失败却显示成功、刷新丢状态）。本仓 `task-queue` 与发布链**已有真实状态**（`rpa-progress-throttle.js` / `ProgressEmitter`），抄它等于倒退 |
| **X-7** | **38 个缺口中除 §2 P1 组之外的平台** | ① 参考产品对多数平台只提供 `name-only` 分类表（**无 ID ⇒ API 发布不可行**），R-1 的 `variant` 可直接判定；② 与已有平台用户重合度高，边际收益低；③ 单平台 **8–24 h**，38 个 = **300–600 h**，远超本周期。**本周期只做 P3-2 的 1 个试点**，验证标准动作后再批量排期 |
| **X-8** | **把 6 种分类形态的解析器写进运行时** | 形态解析是**离线工序**（转换器），运行时只读**归一后的** `config/platform-taxonomy.json`。把形态判断带进运行时会永久背上这段复杂度并每次启动重跑。**运行时接口只认归一后的 `nodes[]`** |
| **X-9** | **`publish-capabilities.json` 与 `platform-metric-matrix.json` 合并** | 二者**同构但不同向**（发布能力 vs 数据指标能力），合并会让注册表承担两种正交语义。刻意**对齐风格而不合并**（`validate*()` 返回问题清单、`load*()` 带缓存、`get*()` 返回冻结副本） |
| **X-10** | **远端 CDN 下发分类数据** | ① 增量收益（热更）已由「替换本地文件 + 重启」覆盖；② 引入联网依赖与失效面（CDN 不可达时的降级逻辑、签名/完整性校验）；③ 数据本身**已知会过期**，远端下发**不解决**「ID 是否仍然有效」这个真问题（U-1） |
| **X-11** | **把素材组合接线到 `story2video-engine` / `remotion-composer`** | 接线需要决定「组合结果如何进入 `ScenePlan`」，与 P1-4 的时间轴模型**耦合**。分开做可各自独立验收，且纯函数**无接线也能被测试完全覆盖**。【阻塞 U-7】 |

---

## 11. 术语与交叉引用

### 11.1 与设计文档的 R↔P 编号对照

| 设计文（R 编号） | 本文（P 编号） | 内容 |
|---|---|---|
| §3 **R-1** 平台分类体系接入 | **P0-1 ~ P0-5** | 数据 + 读取层 + 路由 + 注册表 + 适配器 |
| §4 **R-2** 平台指标能力矩阵 | **P1-1 ~ P1-2** | 矩阵读取层 + 账号快照接入 |
| §5 **R-3** 素材组合三级降级算法 | **P1-3** | 纯函数（不接线，见 X-11） |
| §6 **R-4** 时间轴绝对时间拍平 | **P1-4** | 纯函数（不收敛既有实现） |
| §7 **R-5** 卡片分页引擎 | **P2-1 ~ P2-6** | 纯逻辑 + 构建 + 渲染 + IPC + UI + 验收 |
| §8 **R-6** 多源搜索（跳转） | **P2-7** | 只做跳转，不做抓取（X-5） |
| §9 **R-7** 平台覆盖扩展 | **P3-1 ~ P3-2** | 脚本化标准动作 + 单平台试点 |
| §10.2 待确认 U-1 ~ U-7 | 本文 `【阻塞 U-n】` 标注 | 见 §11.2 |
| §10.3 不做 X-1 ~ X-10 | 本文 §10 X-1 ~ X-11 | **X-11 为本文新增**（设计文未列，因它属「本次不做但非永不做」） |

### 11.2 待确认项对排期的影响（逐条）

| U | 事项 | 影响的任务 | 解除方式 | 不解阻时的降级 |
|---|---|---|---|---|
| **U-1** | 分类 ID 在当前平台侧是否仍有效（2026-07-14 快照） | **P3-2** | 真机发布一条带分类的内容 | 该平台接入退化为不带分类（`variant` 视为 `name-only`） |
| ~~U-2~~ | ~~esbuild 依赖归属~~ | — | **已闭合**（`devDependencies.esbuild = ^0.25.12`） | — |
| **U-3** | 两份 CN 源 PRD 是否已覆盖中文源需求 | **P2-7**（**前置必读**） | 读 `PRD-QUICK-COLLECT-CN-SOURCES-2026-10-11.md` 与 `PRD-HOT-TOPICS-MULTI-SOURCE-AI-CATEGORY-2026-10-12.md` 正文 | 并入既有 PRD 范围，**不另起** |
| **U-4** | `config/platform-taxonomy.json` 实际体量（预估 ≤1.5 MB） | **P0-1**（影响打包体积与加载耗时） | 跑一次转换器 | 若远超预期 ⇒ 按 `channel` 拆分为多文件 |
| **U-5** | 第 7 种分类形态是否存在 | **P0-1**（**阻塞门禁**） | 转换器 fail-loud 后看 `unreadable[]` | **不放行** —— 补遍历器直到 `unreadable[]` 为空 |
| **U-6** | 本仓是否已有「卡片模板几何」数据 | **P2-5** | `git grep -n "templateId\|cardTemplate"` | 先内置**单模板**（1242×1660 正文卡片） |
| **U-7** | 参考产品「一键成片」的素材组合与我们的口径是否一致（视频段 vs 图片） | **P1-3 的消费者接线**（本次不接线，故不阻塞） | 读 `01-docs/PRD-video-creation.md` | 保持纯函数交付，接线另行排期 |

### 11.3 术语表

**术语表以设计文 §11.2 为唯一真源，本文不重复**（R-N / P-N / slug / variant / name-only 平台 /
拍平 / stopSeconds / fillRatio / minRemainderPx / 退化切分 / 抓取型源 / 跳转型源 /
参考数据 vs 运行时真源 / fail-closed / fail-loud / 承载形态 / 三态总闸 / 孤儿文件 / 参考产品）。

**本文新增两个术语（回写设计文 §11.2 时一并登记）**：

| 术语 | 定义 |
|---|---|
| **M0 / M1 / M2 / M3** | 四个阶段的**里程碑判据集**（§7）。每个 M 是一组**可机械验证**的断言，全通过才算该阶段完成 |
| **【阻塞 U-n】** | 该任务在**不解阻就不能开工或不能放行**的标注。与「受影响但不阻塞」区分：前者是门禁，后者只影响范围 |

### 11.4 与其他文档的引用关系

| 文档 | 本文如何引用 |
|---|---|
| [ARCH-REUSE-INTEGRATION-2026-10-13.md](./ARCH-REUSE-INTEGRATION-2026-10-13.md) | **唯一设计真源** —— 本文每个任务的「依据」都指向它的小节；接口签名、算法、缺陷修复、验收数值全部在那边，本文不重复 |
| `MP-REUSABLE-ACTUAL-PLAN.md` | §0 复核其两条基线；§10 X-1 解释为何**不采纳**其 Task 2；其 Task 1 已完成**不排期** |
| `PRD-PUBLISH-CAPABILITY-REGISTRY-2026-10-08.md` | P0-4 必须复用其 `overrideFields` 声明式注册表（**禁止**新增 `v-if`） |
| `PRD-API-PUBLISH-ENGINE.md` | P0-5 引擎侧取用点（适配器读 `taskData.category`）；P2-3 承载形态归一复用 `formatArticleBody()` |
| `PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12.md` | P1-2 的运行时真源（`account-metrics`）出自该 PRD，**不替换**它 |
| `AGENTS.md` | §1 门禁要求、§6.4 并发铁律、§8.2 合规、P2-4 的 QM-2 约束均出自该文件 |
| `平台覆盖差距分析.md` | P3 的优先级依据；设计文 §9.2 纠正其对视频号的误读（**该条缺口作废**） |

---

**文档结束。** 全部 18 个任务的文件路径、验收判据、依赖与工时均已给出；
所有「不做」项附理由；所有未取证事项登记为 U-1…U-7 并标注对排期的影响与降级路径。
