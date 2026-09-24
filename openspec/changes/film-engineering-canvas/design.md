## Context

底层引擎已交付且稳定（`film-engineering` IPC：`adaptScript` / `generateSelected` / `productionRunBatch` / `onProductionUpdate` / 六阶段流水线 / 成本 checkpoint / 合成），本次**只换前端交互壳并补一条参考图入口**，不动引擎逻辑。约束：

- 桌面端技术栈为 Vue 3.5 + Element Plus + Vite 6 + Pinia + vue-i18n；当前 `apps/desktop/package.json` **无任何节点图库**。
- 所有能力锁定在 Electron 桌面端（用户已明确不改运营中心），引擎在主进程经 IPC 暴露，渲染进程无 Node 能力——参考图"喂给生成"必须经 IPC 落盘后由主进程随生成请求提交。
- 开源同类产品的许可证阻断整包复用（见 Decisions D4）。

## Goals / Non-Goals

**Goals:**
- 用最小新增依赖搭出可拖拽连线的节点画布，把既有引擎能力映射成"剧本→分镜→出图/出片→成片"的可视化流水线。
- 新增"本地参考图落盘 + 作为 provider 参考输入"的受控 IPC 通道，安全边界与既有通道一致。
- 平滑废弃旧三栏页，路由与 i18n 无破坏。

**Non-Goals:**
- 不重写引擎、不改既有 IPC 通道签名与数据契约（只新增/扩展）。
- 不引入服务端画布存储/任务队列（huobao 的 server run queue 模式不移植；桌面端画布状态本地持久化即可）。
- 不做多浏览器协同、不做浏览器直连 provider 架构。
- 不在本次改运营中心菜单。

## Decisions

### D1 — 画布底座选 Vue Flow（`@vue-flow/core`，MIT）
- **选择**：Vue Flow + `@vue-flow/background` + `@vue-flow/controls` + `@vue-flow/minimap`。
- **理由**：唯一同时满足"Vue 3 原生 + MIT 可闭源商用 + 数据驱动 nodes/edges + 自定义节点/边组件 + 开箱拖拽/连线/缩放/小地图/撤销"的库；省掉画布引擎层（拖拽、连线命中、平移缩放、布局、minimap）约 2-3 周的从零开发。
- **备选**：AntV X6（更重、偏图编辑 DSL，与 Vue 组合式集成不如 Vue Flow 顺）、LogicFlow（Vue3 集成接缝多）、手绘 canvas/konva（成本最高，放弃）。React Flow（@xyflow，MIT）仅适配 React，不用。

### D2 — 引擎零改动，画布是既有 IPC 的新视图层
- 新增 `useFilmCanvas` composable 组合复用 `useFilmEngineering`/`useFilmVideoGen`/`useFilmProduction`，把 IPC 返回映射为 Vue Flow 的 `nodes[]`/`edges[]`；发起生成沿用 `generateSelected`/`productionRunBatch` + `onProductionUpdate` 事件回显到产物节点。
- **理由**：引擎合同（原文直送、成本 checkpoint、断点续跑）已在 spec 固化并测试覆盖，视图层不得旁路。

### D3 — 新增"参考图上传落盘"IPC 通道 + 扩展生成入参携带本地参考
- preload `film-engineering` 新增 `uploadReference({ name, dataUrl })`（或 buffer），主进程经 withSenderCheck + 入参校验（图片类型白名单 png/jpg/webp、单文件大小上限）落盘到 film-engineering 受控媒体根下 `references/` 子目录，返回规范化路径（越界 fail-closed，复用既有受控媒体根校验范式）。
- 扩展 `generateSelected`/视频生成 opts 入参：新增 `localReferences: [{ shotId, paths[] }]`（脱 Vue 响应式代理后随负载传递），主进程在提交 provider 前把落盘参考图转成 provider 的图生图/一致性参考输入。
- **兼容**：`localReferences` 缺省为空数组，不影响既有纯文本直送路径；provider 不支持参考输入时按能力降级并提示，不阻断生成。
- **理由**：用户明确要"参考图喂给生成（图生图/一致性）"，而渲染进程无文件系统能力，落盘必经主进程。

### D4 — 开源复用边界：抄设计不抄码
- **可复用（MIT）**：Vue Flow 作为 npm 依赖直接安装。`yunji-canvas`（MIT，同为 Vue Flow + 文/图/视频节点）作为参考实现，允许在**核对代码质量与许可**后借鉴/vendored 其自定义节点结构范式。
- **仅设计参考（禁码）**：huobao-canvas（CC BY-NC-SA 4.0 禁商用）、open-ai-canvas/影策（AGPL-3.0 传染）——借鉴"连线即上游自动注入下游""Prompt Dock 参考条 + @提及""节点分组/撤销/自动布局/小地图"交互语义，**不复制其任何源码**。
- **不用**：ComfyUI（Python 扩散引擎，架构不符），仅其工作流 JSON schema 作数据模型思路参考。
- **理由**：我们是闭源商用桌面产品，许可证必须逐层核对，避免 copyleft 传染与非商用条款风险。

### D5 — 旧三栏页废弃策略
- 路由 `/film-engineering` 改指向新画布视图；`FilmEngineeringView.vue` 保留一个过渡版本供视觉回归基线，稳定后移除。迁移前跑「基线 vs 现状」差异审计，确保三栏页里已交付的能力（复制四模式、导出、生成、合成、回收下载）在画布上都有对应入口，不丢功能。
- **回退**：新画布视图与旧页并存期间，若画布出现阻断级缺陷，可临时把路由切回旧页（旧页代码在彻底删除前不删）。

### D6 — 画布状态持久化
- 图状态（节点位置、连线拓扑、每节点数据、关联 run/工程 id）序列化存到用户数据目录下的工程文件（复用既有 film-engineering 数据锚点），重启可复原；产物节点完成态以磁盘实际 `shot_NNN.mp4`/`final.mp4` 扫描为准回显，不信内存缓存（对齐既有 `film_render 以磁盘产物为准` 合同）。

## Risks / Trade-offs

- [Vue Flow 新增依赖与 bundle 体积] → 仅装 core+三插件（~30KB gzipped 级），无连锁重依赖；在 CI 体积门禁内评估。
- [本地参考图落盘扩大文件写入面，潜在路径穿越] → 强制规范化 + 受控媒体根越界 fail-closed + sender 校验，复用既有 `renderManifest` 同类校验范式，回归测试覆盖 `..`/junction 逃逸。
- [provider 参考输入能力不一（有的不支持图生图/一致性）] → 主进程按 provider 能力探测，不支持时降级纯文本并明确提示，不静默失败、不阻断。
- [废弃旧页可能回退用户习惯/丢已交付功能] → D5 差异审计 + 过渡并存 + 路由可切回，功能对齐后才删旧码。
- [huobao/影策交互复杂，全量移植拖工期] → 首版锁定"初始拆分镜 + 连线注入参考 + 逐镜生成 + 成片"最小闭环，@提及/Prompt Dock 高级交互列后续增量，不阻塞主链路。
- [yunji-canvas 代码质量未知] → vendored 前必须先审码 + 核可 LICENSE 实为 MIT；不通过则退回纯自研节点组件（不依赖它）。

## Migration Plan

1. D 盘隔离 worktree（`git worktree add -b local/film-engineering-canvas`），依赖就绪。
2. 装 Vue Flow 四件套；搭空画布视图 + 五类自定义节点组件（先 mock 数据）。
3. `useFilmCanvas` 桥接既有 IPC，跑通"拆分镜铺节点 → 逐镜生成回显 → 合成"。
4. 新增 `uploadReference` IPC（主进程 handler + preload + sender/入参校验 + 落盘）+ 扩展生成入参 `localReferences`，TDD 先写校验/落盘/降级用例。
5. 画布状态持久化 + 复原。
6. 路由切画布、i18n（zh/en）补齐、旧页差异审计。
7. 视觉回归 + E2E（`test:e2e:film-engineering`）更新；PR → CI 绿 → 自动合并。
- **回退**：任一步阻断级缺陷，路由切回旧页，画布代码保留在分支不上主干。

## Open Questions

- 参考图与分镜的角色绑定映射细节（哪张图对应哪个 roleBinding）在 apply 时按现有 `roleBindings` 结构落地，不影响 spec 与任务拆分。
- 首版画布工程文件格式（单工程单文件 vs 目录）在实现时定，向后兼容持久化接口即可。
