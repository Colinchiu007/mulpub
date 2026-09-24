## 1. 隔离环境与依赖基座

- [x] 1.1 D 盘建隔离 worktree（基于 origin/main，实际分支 `codex/film-engineering-canvas`），`pnpm install --frozen-lockfile` + `ensure-electron.js` + 依赖校验（≤1h）
- [x] 1.2 `apps/desktop` 新增 Vue Flow 四件套依赖（core/background/controls/minimap），验证 Vite 构建与 bundle 体积无异常（≤1h）
- [ ] 1.3 「基线 vs 现状」差异审计：列出旧三栏页已交付能力清单（复制四模式/导出/生成/合成/回收下载）作为画布功能对齐基线表，写入 change（≤2h）

## 2. 画布底座与节点组件

- [x] 2.1 新建画布视图 `FilmCanvasView.vue`，挂 VueFlow + background/controls/minimap，路由 `/film-engineering` 切画布、`/film-engineering/classic` 指向经典页并存回退（≤3h）
- [x] 2.2 实现自定义节点组件（剧本输入/人物参考/场景参考/分镜 4 类已挂载；产物以成片提示条表示，独立产物节点后置），渲染与选中态（≤4h）
- [x] 2.3 边合法性规则：按节点类型定义可连/不可连矩阵，非法连线拒绝并提示（TDD：连线校验单测 film-canvas-model 11 用例）（≤3h）

## 3. 引擎桥接（复用既有 IPC）

- [x] 3.1 `useFilmCanvas` 组合复用 useFilmEngineering/VideoGen/Production，把 status/scenes/shots 映射为 nodes/edges（≤4h）
- [x] 3.2 起始面板：收集剧本/选项（画幅/时长/角色映射/LLM 开关），接 `adaptScript`，把 adaptedShots 铺为分镜节点并按场景聚组（TDD：非法剧本禁用与校验提示）（≤4h）
- [ ] 3.3 LLM 降级路径回显 llmEnhanced=false 非阻断提示（复用既有引擎返回）（≤1h）

## 4. 参考图喂给生成（新增 IPC，安全边界）

- [x] 4.1 TDD 先写 `uploadReference` 主进程 handler 用例：类型白名单/大小上限/路径越界 fail-closed/sender 校验（≤3h）
- [x] 4.2 实现 `uploadReference` 落盘到受控媒体根 `references/` + preload 暴露，返回规范化路径（≤2h）
- [ ] 4.3 【剩余】主进程把 `localReferences` 转 provider 参考输入 + 不支持参考的 provider 能力降级并提示（前端侧 `initialContext.localReferences` 透传已完成，引擎消费未接线）（≤4h）
- [x] 4.4 参考图节点连到分镜/生成节点即注入上游本地图（`buildGeneratePayload` → `localReferences`），无参考走纯文本路径（≤2h）

## 5. 全链路驱动到成片

- [x] 5.1 画布内发起逐镜出片：走 `useFilmVideoGen` pipeline 通道（start/confirmCost），成本确认 checkpoint 卡先行，`shotResults` 回显到分镜节点状态徽标（≤4h）
- [ ] 5.2 【剩余】失败单镜就地重试（复用 retryShot 通道，画布暂无逐镜重试按钮），产物完成态以磁盘实际文件为准回显（≤2h）
- [ ] 5.3 【剩余】合成入口：完成态在画布内提供打开所在文件夹/另存（当前跳转经典视图承载），报告实测时长与清单规模（≤2h）

## 6. 画布持久化

- [x] 6.1 图状态（节点位置/连线拓扑/节点数据/关联 run）序列化存用户数据目录工程文件，重启复原（TDD：存取往返一致，useFilmCanvas 持久化用例）（≤4h）

## 7. 迁移收尾与门禁

- [x] 7.1 i18n：画布所有可见文案进 locales（zh/en 成对，Gate7 keys/cjk/pair 本地全绿），产品名词复用既有映射未新增（≤2h）
- [x] 7.2 路由正式切画布，旧页保留于 `/film-engineering/classic` 作回退（deprecated 代码注释待补，暂不删码）（≤2h）
- [ ] 7.3 【进行中】更新 `docs/features/` 影视工程 PRD：画布交互、初始拆分镜、参考图喂生成、数据校验/流程/提示文字细则（≤3h）
- [ ] 7.4 【剩余】视觉回归基线更新 + E2E `test:e2e:film-engineering` 适配画布；本地 `check:all` 绿（≤4h）
- [ ] 7.5 【部分】推分支 + 创建 PR #2342 + 启用 squash auto-merge（已做）；CI 通过后自动合并、openspec sync/archive 与质量节拍复盘三同步（待 CI 绿后收尾）（≤2h）
