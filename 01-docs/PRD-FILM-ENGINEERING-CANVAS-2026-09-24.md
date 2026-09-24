# PRD：影视工程画布式实操流水线（film-engineering-canvas）

- 日期：2026-09-24
- 状态：规划完成，待 CEO 签字后进入实现（本文档为需求/交互/校验的详细规格，与 OpenSpec change 逐条对应）
- 关联 change：`openspec/changes/film-engineering-canvas/`（proposal / design / specs delta / tasks）
- 关联文档：`ARCH-FILM-ENGINEERING-2026-08-14.md`（架构基线）、`PRD-FILM-FULL-CORPUS-PRODUCTION-2026-09-23.md`（全量出片，本 PRD 建立在其引擎之上）、`ipc-manifest.md`（通道清单）、`DESIGN.md`（UI 规范）

---

## 1. 背景与目标

### 1.1 问题

当前影视工程桌面页 `apps/desktop/src/views/FilmEngineeringView.vue` 是**三栏浏览器式界面**（左：场景树 / 中：分镜列表 / 右：详情面板）。它把底层已经建好、且经过可观测性加固的引擎能力（剧本套用 `adaptScript`、六阶段流水线、逐镜出片、断点续跑、成片合成）摊成了一堆需要用户**手动理解 Hell Grind 工程方法、手动勾选分镜、手动逐阶段推进**的控件。结果是：核心价值"给我一个剧本，我帮你按工业方法拆到分镜、出图出片、合成成片"被界面彻底埋没，实操门槛极高。

### 1.2 目标

把交互范式整体切换到行业中成熟的**短剧节点连线画布**：用户只投喂**剧本文本 + 人物/场景参考图 + 选项**，一步自动拆出分镜，连线即把上游产物注入下游生成，在一张画布上就地驱动**从剧本到成片**的全链路。底层引擎**零改动**，本次只换前端交互壳 + 补一条参考图喂生成入口。

| 层 | 目标 | 交付 |
|----|------|------|
| **A 画布底座** | 可拖拽连线的节点图，五类节点 + 连线 + 撤销/自动布局/小地图 | Vue Flow 底座 + 自定义节点/边组件 |
| **B 初始拆分镜** | 剧本一步自动拆成分镜节点铺到画布 | 复用 `adaptScript`，新增起始面板 + 节点映射 |
| **C 参考图喂生成** | 本地上传人物/场景图作为图生图/一致性参考 | 新增 `uploadReference` IPC + 扩展生成入参 `localReferences` |
| **D 全链路到成片** | 画布内发起逐镜出图/出片/合成，成本闸先行 | 复用六阶段流水线 + `productionRunBatch` + `onProductionUpdate` |

### 1.3 非目标（明确排除）

- **不改运营中心**（`ops-center/`）：本能力全部在 Electron 桌面端实现，不加菜单入口。
- 不重写引擎、不改既有 IPC 通道签名与数据契约（只新增/扩展，字段只增不改）。
- 不引入服务端画布存储/任务队列（不抄 huobao 的 server run queue）；画布状态本地持久化。
- 首版不做多浏览器协同、@提及语法、Prompt Dock 高级交互（列后续增量）。

---

## 2. 用户主流程（Happy Path）

```
进入 /film-engineering（画布）
   │
   ├─ 起始面板：粘贴剧本文本 + 上传人物参考图/场景参考图 + 选选项
   │        （画幅 / 全局时长 / 角色映射 / LLM 润色开关）
   │
   ├─ [下一步：自动拆分镜]  ──► adaptScript(script, characterMap, llmEnabled)
   │        返回 adaptedShots[]，按场景聚组铺为分镜节点（零计费调用）
   │
   ├─ 用户把参考图节点连线到目标分镜节点（连线即注入参考）
   │
   ├─ 逐镜/批量发起生成 ──► 成本确认 checkpoint 卡（用户 advance 前零 provider 调用）
   │        确认后 productionRunBatch，onProductionUpdate 实时回显到产物节点
   │
   └─ 全部镜头产物齐备 ──► 合成 final.mp4 ──► 成片完成态（打开所在文件夹 / 另存）
```

---

## 3. 画布节点模型（显示项 + 交互逻辑）

底座：**Vue Flow**（`@vue-flow/core` + `@vue-flow/background` + `@vue-flow/controls` + `@vue-flow/minimap`，均 MIT）。

### 3.1 五类节点

| 节点类型 | 显示项 | 可编辑 | 输入 handle | 输出 handle |
|---|---|---|---|---|
| **剧本输入节点** | 剧本文本摘要、字数计数（x/10000） | 是 | — | ✅（文本→分镜） |
| **人物参考图节点** | 缩略图、角色名标签、绑定状态 | 替换图 | — | ✅（图→分镜/生成） |
| **场景参考图节点** | 缩略图、场景名标签 | 替换图 | — | ✅（图→分镜/生成） |
| **分镜节点** | 提示词全文（可折叠展开）、模型标签、来源标签、ref 引用解析、所连参考缩略、复制按钮组、生成态 | 是（编辑提示词） | ✅（剧本/参考） | ✅（分镜→产物） |
| **产物节点** | 图片/视频缩略 + 完成态（成功/失败/生成中）+ 单镜重试按钮 | 否 | ✅（分镜） | —（可再连下游合成） |

### 3.2 画布全局交互

- **拖拽**新建节点、**连线**（从输出 handle 拖到目标输入 handle）、**选中/删除**。
- **缩放/平移**（controls 插件）、**小地图导航**（minimap 插件）、**自动布局**（按场景 DAG 重排）。
- **撤销/重做**（图操作历史栈）。
- 所有用户可见文案进 `locales`（zh/en 成对）；产品名词（Hell Grind、影视工程、分镜、剧本套用、画布）进 `i18n-glossary`。

### 3.3 复制按钮组（复用既有四模式）

分镜节点保留既有 `copyText`/`copyTexts` 四模式：`full`（完整提示词）/ `blocks`（分块说明）/ `characters`（角色描述符）/ `geo`（GEO 布局块）。
- 复制成功提示：**「已复制到剪贴板」**。
- 剪贴板不可用（`navigator.clipboard` 写失败）降级：显示可选中文本域 + 提示**「复制失败，请手动选择文本」**，不静默失败。

---

## 4. 数据校验（核心）

### 4.1 起始面板输入

| 字段 | 规则 | 违反时提示文字 |
|---|---|---|
| `script`（剧本文本） | 非空、`<= 10000` 字符 | 「剧本不能为空」/「剧本不能超过 10000 字」 |
| `characterMap`（角色映射） | `<= 10` 键、每个值为非空字符串 | 「角色映射最多 10 个」/「角色 {k} 名称不能为空」 |
| `aspectRatio`（画幅） | 枚举 `16:9`（默认）/ `9:16` / `保持源` | 非法枚举拒绝进入生成 |
| `durationSec`（全局时长） | 枚举 `5`（默认）/ `8` / `10` 秒 | 非法枚举拒绝进入生成 |
| `llmEnabled`（LLM 润色） | 布尔开关 | — |
| 参考图文件 | 类型白名单 `png/jpg/webp`、单文件 `<= 10MB`（常量待定，见 §9） | 「仅支持 png/jpg/webp」/「图片超过 10MB」 |

**校验时序**：前端起始面板对 `script`/`characterMap`/`durationSec`/`aspectRatio` 做即时校验，非法时**禁用**「下一步：自动拆分镜」按钮并显示具体原因；主进程 IPC 侧再独立做二次运行时校验（不信任 renderer）。

### 4.2 拆分镜输出合同

`adaptScript({ script, characterMap, llmEnabled })` → `{ adaptedShots[], warnings[] }`，每 `adaptedShot` 与 kit 分镜同构：`shotId / sceneId / prompt / model / refTokens[] / roleBindings`。
- **剧情全部来自用户剧本，块结构/模型类型/参考图约定复刻自工程模板。**
- `warnings[]`（如 LLM 降级）以**非阻断**提示呈现，拆分镜仍成功。
- `llmEnhanced=false` 时提示：**「已使用本地模板润色」**。
- 拆分镜阶段 **MUST NOT 触发任何计费 provider 调用**。

---

## 5. 参考图喂给生成（新增 IPC）

### 5.1 通道 `uploadReference`

- preload `window.electronAPI.filmEngineering.uploadReference({ name, dataUrl })` → 统一信封 `{ code, data, message }`（`code===0` 成功）。
- 主进程：经 `withSenderCheck`（仅受信窗口）+ 入参校验（类型白名单、大小上限）。
- 落盘：film-engineering **受控媒体根**下 `references/` 子目录，返回**规范化路径**。
- 越界防护：路径规范化后逃逸（`..`/junction）受控媒体根 → **fail-closed 拒绝**并指出非法项，复用既有 `renderManifest` 同类校验范式。
- **不外发**：上传动作仅在本地落盘，MUST NOT 在上传时调用 provider；仅用户发起生成时随请求提交。

### 5.2 扩展生成入参

`generateSelected` / 视频生成 opts 新增 `localReferences: [{ shotId, paths[] }]`（传 IPC 前 `JSON.parse(JSON.stringify(...))` 脱 Vue 响应式代理，保证可 structuredClone）。
- 主进程在提交 provider 前，把落盘参考图转成 provider 的**图生图/角色一致性**参考输入。
- **兼容**：`localReferences` 缺省为空数组 → 既有纯文本原文直送路径不变。
- **能力降级**：provider 不支持参考输入时，按能力探测降级为纯文本 + 明确提示，不静默失败、不阻断生成。
- 既有约束不变：视频 provider 统一解析默认视频能力（`getDefault('video')`），单批选中 `<= MAX_VIDEO_BATCH`（10 镜）。

### 5.3 连线注入语义（详见 §6）

参考图节点连线到分镜/生成节点 = 该本地图作为该镜的参考输入；一个镜可连多张参考（人物 + 场景）。未连任何参考的镜走纯文本生成，不因缺参考失败。

---

## 6. 连线即数据流（边合法性规则）

每条边表达"上游产物 → 下游输入"的注入关系。建边时按**类型矩阵**校验：

| 上游＼下游 | 分镜 | 产物（图/视频） | 剧本输入 | 参考图 |
|---|---|---|---|---|
| 剧本/文本 | ✅ 提供剧情 | ❌ | ❌ | ❌ |
| 参考图（人物/场景） | ✅ 提供视觉参考 | ✅ | ❌ | ❌ |
| 分镜 | ❌ | ✅ 生成目标 | ❌ | ❌ |
| 产物 | ❌ | ❌ | ❌（禁止回连） | ❌ |

- 非法连线（如产物节点回连剧本节点、文本直连产物）→ **拒绝并提示不合法原因**，图状态不变。
- 下游生成发起时**自动收集所有直连上游产物**作为输入，用户无需手动上传或复制。

---

## 7. 全链路到成片（复用引擎，不旁路）

### 7.1 成本确认 checkpoint（硬闸）

- 发起逐镜出图/出片 → 先弹**成本确认卡**，展示：逐镜 `shotId`、标题、所选画幅与时长、预计镜数。
- 用户 **advance 前零 provider 调用**；任何恢复路径（含应用重启 `resumeFromCheckpoint`）都重新经过该确认点，不存在绕过路径。
- provider 未配置时：提示配置并给跳转模型设置页入口，**不启动流水线**（`VIDEO_MODEL_NOT_CONFIGURED`）。

### 7.2 逐镜回显与重试

- `productionRunBatch` 提交，`onProductionUpdate` 事件实时回显到对应产物节点（成功/失败/生成中）。
- 每镜按提交→轮询（上限 10 分钟）→下载 `shot_NNN.mp4` 执行；部分失败标 partialFailure，失败镜可就地**单镜重试**（复用 `retryShot` 通道，不改阶段状态机）。
- 产物完成态**以磁盘实际文件为准**回显，不信内存缓存（对齐 `film_render 以磁盘产物为准` 合同）。

### 7.3 合成成片

- 全部可用镜头产物齐备 → 合成 `final.mp4`（规格一致零重编码直拷拼接；不一致仅最小 scale+pad 归一；缺镜 fail-closed 列出缺失清单，不出缺镜假片）。
- 完成态提示 + 提供**「打开所在文件夹」「另存」**入口，报告含实测时长（ffprobe）与清单规模。

---

## 8. 画布状态持久化

- 图状态（节点位置、连线拓扑、每节点数据、关联 run/工程 id）序列化存**用户数据目录**下的工程文件（复用既有 film-engineering 数据锚点）。
- 应用重启后同一工程画布可复原；产物节点完成态按磁盘 `shot_NNN.mp4`/`final.mp4` 扫描回显。

---

## 9. 旧三栏页废弃与迁移

| 步骤 | 动作 |
|---|---|
| 1 | 路由 `/film-engineering` 改指向画布视图；`FilmEngineeringView.vue` 暂保留（deprecated 标记，不立即删码，保留回退） |
| 2 | 迁移前跑「基线 vs 现状」差异审计：确保三栏页已交付能力（复制四模式、导出 JSON/Markdown、勾选生成、合成、回收下载 `downloadRecycled`）在画布都有对应入口，**不丢功能** |
| 3 | 画布稳定 + E2E/视觉回归通过后，下个清理 PR 移除旧页代码 |
| 回退 | 画布出现阻断级缺陷时，可临时把路由切回旧页 |

> 参考图大小上限具体取值在 apply 时定（建议 `10MB`，随 §4.1 常量集中管理）。

---

## 10. 开源复用与许可证合规

| 来源 | 许可 | 用法 |
|---|---|---|
| **Vue Flow** | MIT | ✅ 直接 npm 安装作底座 |
| **yunji-canvas** | MIT | ⚠️ 参考实现，vendored 前先审码 + 核实 LICENSE |
| huobao-canvas | CC BY-NC-SA 4.0（禁商用） | ❌ 仅抄交互设计（连线注入/Prompt Dock/@提及），不复制码 |
| open-ai-canvas（影策） | AGPL-3.0（传染） | ❌ 仅设计参考，不复制码 |
| ComfyUI | GPL/Apache（Python 扩散引擎） | ❌ 架构不符，仅借鉴 workflow JSON schema 思路 |

**红线**：闭源商用产品，禁止引入 copyleft 传染码或非商用条款码；仅 MIT/Apache 且架构相符者可复用。

---

## 11. 影响面清单

- **前端**：新增 `FilmCanvasView.vue` + 五类节点组件 + `useFilmCanvas`（组合复用 useFilmEngineering/VideoGen/Production）；改路由；改 i18n（zh/en）。
- **依赖**：`apps/desktop/package.json` 新增 Vue Flow 四件套。
- **IPC/preload**：`electron/preload/film-engineering.js` + 主进程 handler 新增 `uploadReference`、扩展 generate 入参 `localReferences`（sender + 入参校验）。
- **测试**：`uploadReference` 校验/落盘/越界单测、`localReferences` 向后兼容 + 降级用例、边合法性矩阵单测、拆分镜非法输入用例、画布存取往返测试、E2E `test:e2e:film-engineering` 适配、视觉回归基线更新。
- **文档**：本 PRD + `ipc-manifest.md` 补 `uploadReference` 通道 + `ARCH-FILM-ENGINEERING` 追加画布节 + `openspec/specs/film-engineering/spec.md` 经 sync 吸收增量。

---

## 12. v1 实现状态（apply 交付回写，2026-09-24，分支 `codex/film-engineering-canvas` / PR #2342）

### 12.1 交付切片清单

| 切片 | 落点 | 测试 |
|---|---|---|
| `uploadReference` IPC | `electron/ipc-handlers/film-engineering.js` + `services/film-engineering/reference-store.js` + `preload/film-engineering.js` | 类型白名单/魔数校验/10MB 上限/路径越界 fail-closed/sender 校验 |
| 画布纯模型 | `src/composables/film-canvas-model.js`（ESM 命名导出） | 边矩阵/铺节点/注入收集/序列化往返 11 用例 |
| 画布状态组合 | `src/composables/useFilmCanvas.js`（refreshStatus/restore/runAdapt/uploadReference/addEdge/persist 等） | IPC 信封、非法剧本拒绝、存取往返 |
| 生成入参扩展 | `src/composables/useFilmVideoGen.js` `start(shots, {aspect, seconds, localReferences})` | 非空注入/未传不携带/空数组归一化 3 回归 |
| 画布视图 | `src/views/FilmCanvasView.vue` + `src/components/film-canvas/{ScriptInputNode,ReferenceNode,ShotNode}.vue` | 冒烟 3 用例（挂载/拆分镜铺节点/非法连线拒绝） |
| i18n | `locales/zh.js`/`en.js` 成对新增 `filmEngineering.canvas.*`（约 40 key） | Gate7 keys/cjk/pair 本地全绿 |
| 路由 | `/film-engineering` → 画布；`/film-engineering/classic` → 旧三栏页（回退） | — |

### 12.2 数据校验细则（已落地）

- **剧本**：非空才可点「拆分镜」；长度 ≤ 10000 字，超限提示 `canvas.adapt.scriptTooLong`；空剧本提示 `canvas.adapt.emptyScript`。适配失败（IPC code≠0 / 无桌面端 / 引擎不可用）分别提示 `adapt.failed` / `noDesktop` / `engineUnavailable`，不静默。
- **参考图**：仅 PNG/JPEG/WEBP（扩展名 + 文件魔数双重校验）；≤ 10MB；非文件/超类型/超体积/落盘失败分别提示 `canvas.ref.{invalidFile,badType,tooLarge,uploadFailed}`；成功后在受控媒体根 `references/` 返回规范化路径并铺为参考节点。
- **IPC 序列化**：所有传给 `ipcRenderer.invoke` 的对象一律 `JSON.parse(JSON.stringify(...))` 脱 Vue 响应式代理；信封合同 `{code,data,message}`，`code===0` 成功。
- **连线门禁**：按 §6 类型矩阵校验，拒绝原因码 `sameNode/duplicate/unknownType/unsupportedPair`，映射 `canvas.edgeRule.*` 文案以 warning 提示，图状态不变。

### 12.3 交互流程（v1 主路径）

1. 进入 `/film-engineering`：`refreshStatus()` 探测引擎可用性，`restore()` 复原上次画布（localStorage 工程快照，schemaVersion 校验，脏数据丢弃）。
2. 左侧输入剧本 → 选画幅（16:9 / 9:16 / 源）与单镜时长（5/8/10s，可开关 LLM 增强）→ 点「拆分镜」→ `adaptScript` 返回后自动铺分镜节点并按场景布局。
3. 上传人物/场景参考图 → 拖线到目标分镜节点 = 注入该镜参考；一镜可连多张；节点徽标显示「参考已注入」。
4. 点「生成成片」：`buildGeneratePayload()` 收集选中分镜 + `localReferences` → 成本确认卡（弹 `canvas.cost.*`，advance 前零 provider 调用）→ 确认后逐镜生成，`shotResults` 实时回写节点状态徽标（idle/生成中/完成/失败）。
5. 全部完成 → 顶部出现成片 banner，可「打开所在文件夹」；拖拽节点位置自动 persist。

### 12.4 显示项与提示文字（`filmEngineering.canvas.*`）

- 顶栏：`title`/`subtitle`、画幅/时长下拉、`adapt.btn`、`upload.character/scene`、`generate.btn`（无选中镜时 `generate.none` 拦截）、`toolbar.clear/classic`。
- 节点：`scriptNode`（含 `noTitle`/`scriptChars`）、`refCharacter`/`refScene`（删除 `deleteNode`）、`shot`（状态 `statusIdle/statusGenerating/statusDone/statusFailed`、`refInjected`）。
- 弹层：`cost.title/hint` + `toolbar.confirmCost/cancel`；`final.title/open`；错误/提示均走对应 `adapt.*`、`ref.*`、`edgeRule.*` key，无中文硬编码字面量。

### 12.5 已知边界（后续切片）

- **4.3 引擎侧消费未接线**：`localReferences` 已透传进 `initialContext`，但 pipeline provider 层图生图/角色一致性输入映射与能力降级提示未完成，端到端一致性下一切片接入。
- **5.2 逐镜重试**：失败镜暂无画布内重试按钮（retryShot 通道已有，UI 未挂）。
- **5.3 合成入口**：成片当前跳经典视图承载合成/另存；画布内直合成后置。
- **1.3 / 3.3 / 7.4**：基线功能对齐表、LLM 降级非阻断回显、视觉回归 + E2E 适配未完成。
- **实现约定**：`src/` 渲染端模块必须用 ESM 命名导出（`module.exports` 在 vitest 可过但 Rollup `vite build` 会报 "not exported"，CI build/electron-tests/gui-test 三门禁拦截）。
