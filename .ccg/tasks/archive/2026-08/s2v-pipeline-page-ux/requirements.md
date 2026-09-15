# 需求规格：Story2Video 流水线页面 UX 统一与交互改造

> 状态：v1（2026-08-16）· 域：frontend（+少量主进程 IPC）· 复杂度 L · 风险 medium
> 双模型分析：antigravity 因地域不可用（eligibility check failed），已降级 claude 单模型（记录见 review.md）

## 1. 名词统一（全局）

| 新名词 | 定义 | 对应页面/组件 |
|--------|------|----------------|
| 流水线启动页 | 进入「视频创作」→ 选择一个流水线后显示的配置页 | `CreateView.vue` 的 `view==='pipelines' && selectedPipeline` 分支 |
| 视频任务详情页 | 流水线任务的内容编辑页（= 原「任务详情」弹窗的替代目标） | `ResultView.vue`（`/create/result`） |
| 历史记录页 | 「视频创作」内的历史记录标签页 | `CreateView.vue` 的 `view==='history'` 分支（`CreateViewHistory.vue` 富卡片） |

- 所有「点击详情」的流转一律进入视频任务详情页（编辑界面），删除原详情弹窗。
- 代码注释、PRD、多语言文案中的「任务详情页/详情页/流水线详情页」按上表统一。

## 2. 流水线启动页（CreateView）

### 2.1 底部固定操作条
- `action-bar`（含「启动流水线」「批量创作」「恢复默认选项」「▶ 继续」「⏸ 暂停」「✅ 确认并继续」「Run in background」「✕ 取消」等）固定显示在视口底部，不随页面滚动。
- 实现：`position: fixed; bottom: 0`（滚动容器 `main.mp-workspace` 无 transform，fixed 相对视口生效）+ 页面内容底部预留等高校度 padding（避免内容被遮挡）。若 fixed 实测异常，回退 `position: sticky; bottom: 0`。
- 窄屏（<=720px）下保持可用：操作条允许换行，高度自适应，padding 同步。

### 2.2 运行进度区固定
- 流水线运行中，`StageProgress` 进度区固定在页面内容顶部，不随滚动消失。
- 实现：`position: sticky; top: 0; z-index: 10`（依赖滚动容器 `main`，sticky 在 overflow:auto 容器内可靠）。
- 场景素材选择面板（`s2v-scene-asset-panel`）不受影响，正常随内容滚动。

### 2.3 状态文案 Bug 修复
- 状态映射 `{ completed:'已完成', failed:'已暂停', ... }` 中 `failed` 显示为「已暂停」是错误，改为「生成失败/已失败」。
- 历史记录/详情相关状态文案（CreateView 内嵌历史、CreateHistory、ResultView 分段状态）一并核对统一。

### 2.4 暂停/继续
- 已存在：运行中显示「⏸ 暂停」、暂停中显示「▶ 继续」、检查点显示「✅ 确认并继续」。保持不变。
- 「已暂停」状态的产生来源（文档说明，不改逻辑）：
  1. 用户在流水线启动页点击【暂停】；
  2. 分镜素材自选检查点等待（scene_asset_selection）；
  3. 应用重启后，持久化快照中 running 任务归一化为 paused；
  4. 前端 stale-running 检测：updatedAt 超过 30 分钟仍为 running 的 run 记录显示为 paused（客户端展示层标记，不写库）。
- 决策：视频任务详情页（ResultView）不新增【暂停】按钮——它是项目内容编辑页而非 run 控制页；暂停/继续/取消是 run 级操作，保留在流水线启动页。

## 3. 历史记录页（CreateView 内嵌历史 / CreateViewHistory）

### 3.1 卡片统一
- 所有状态标签共用同一套卡片模板与样式（现有 history-item 富卡片即唯一模板）。
- 卡片通用信息块（所有状态都显示，缺字段时隐藏该项但布局一致）：
  - 任务标题：item.title（发布标题），为空回退 item.params?.title，再回退原文案（segments[0].text）前 60 字，再回退流水线名；
  - 文案预览：第一分段文案前 120 字（现有 firstSegmentPreview）；
  - 更新时间、创建时间；
  - 耗时（duration，分钟/秒多语言）；
  - 任务 ID / 项目 ID（缩短显示，title 属性完整值）；
  - 流水线名词 tag；状态标签。
- 状态特定附加项：
  - running：进度提示行；
  - paused：暂停环节 + 暂停环境；
  - failed：失败环节 + 失败原因（多语言自然语言）+ 政策拦截提示（保留）。
- 卡片宽度/布局统一：同一 history-list 列布局，状态差异只影响数据项内容与状态色，不影响结构。

### 3.2 失败原因（原「错误摘要」）
- label 由「错误摘要」改为「失败原因」。
- 展示内容由原始 error 文本改为 formatError(item)（formatPipelineError 多语言归一化：402 配额不足 → quota_exceeded 等；未命中回退通用失败文案）。

### 3.3 删除按钮
- 所有状态标签下的任务卡片都显示【删除】按钮。
- 有 projectId：走现有确认弹窗 → story2videoDeleteProject（不变）。
- 无 projectId（纯 run 记录）：新增 pipeline:delete-run IPC → pipelineEngine.deleteRun(runId)：从 _runs（含 _<name> 索引）与 _history 移除；runStateStore.remove(runId) 清理持久化快照。
- 删除确认弹窗文案区分两类（项目 / 运行记录）；失败弹通知（新增 RUN_DELETE_FAILED）。

### 3.4 编辑按钮
- 「编辑并重新合成」文字改为「编辑」。
- 可见条件保持：completed && projectId 或政策失败 policyEditTarget。
- 点击后 emit open-result → 跳 /create/result?project=<projectId>。

### 3.5 详情弹窗移除
- 删除 history-detail-modal（UiModal 及相关 detail 展示）。
- openDetail(item) 改为：item.status !== 'cancelled' && item.projectId 时直接 emit open-result；cancelled 或无 projectId 时不可点击。
- 配套测试重写：弹窗相关断言改为「点击卡片 emit open-result」。

### 3.6 独立路由 /create/history（CreateHistory.vue）
- 旧式两 tab UI（渲染记录/流水线记录），卡片样式与富卡片不一致。
- 统一方案：/create/history 路由重定向到 /create?view=history（CreateView 支持 query view=history 初始化并 watch 变化）。
- 渲染记录 tab 能力不丢失：检查入口与使用方，若仅 CreateHistory 使用则随页面废弃，不迁移。

## 4. 视频任务详情页（ResultView）

### 4.1 返回与标题
- 「← 返回流水线列表」改为「← 返回」，点击跳转历史记录（/create?view=history）。
- 「视频预览」标题下方增加任务标题行（project.title），title 为空时显示 projectId 或隐藏。

### 4.2 底部固定操作条
- 【保存分段】【重新合成】【再次合成视频】三个按钮移入页面底部固定操作条，不随滚动。
- 操作条含：未保存修改提示、三个按钮、保存/合成中进度文案。
- 页面内容底部预留 padding 防遮挡。
- section-heading 保留「分段编辑」标题与 hint。

### 4.3 分段快捷跳转
- 分段列表提供：分段数字快捷跳转（点击数字滚动到对应分段卡片）+【上一条】【下一条】按钮（首/尾禁用）。
- 实现：segment-item 加 ref，scrollIntoView({ behavior:'smooth', block:'start' })；当前分段高亮。

### 4.4 分段卡片结构
- 「分段 N」标题（含状态、失败原因、政策标记、上移/下移/删除）移动到分段卡片最顶部（图片之上）。
- 顺序：标题 → 图片 → 场景素材 → 提示词 → 语音设置 → 操作区。

### 4.5 场景素材
- 场景素材区【生成视频】按钮改为调用 generateSceneAiVideo（用视频提示词生成 AI 视频）；文案「生成 AI 视频」；无 videoPrompt 时禁用并显示 hint。
- 视频提示词下方独立【生成 AI 视频】按钮删除。
- 「当前使用」选中回显保持 effectiveSelectedMaterial（服务端 selectedMaterial 持久化），回归测试覆盖。

### 4.6 语音设置
- 「音色 ID」文本框改为「音色」下拉选择：数据源 window.electronAPI.ttsVoice.catalog（参考 CreateView 加载方式），选中值写回 segment.voiceId + segmentsDirty；保存链路已支持 voiceId。
- catalog 加载失败时回退文本框输入，不阻断编辑。
- 「语速」number 改为 range 滑条：min 0.5 / max 2 / step 0.1，右侧显示当前值（与启动页一致）。
- voicePitch / voiceEmotion 保持。

### 4.7 旁白操作区
- 【替换旁白】保留；【重试图片】【重试视频】删除。
- 下载图片/下载音频/下载视频保留。

### 4.8 无成片视频的任务可编辑
- 修复 v-else-if="!videoPath" 空态拦截：projectId 存在且有 segments 时，即使无 videoPath（failed/paused/未合成）也渲染分段编辑区，仅隐藏视频预览/裁剪/旁白区。
- 空态仅用于既无 projectId 也无 path 的场景。

## 5. 导航
- 顶部地址栏左右箭头（go-back/go-forward）已支持前后页，本次不新增代码，仅在文档中说明。

## 6. 数据校验与契约（新增 IPC：pipeline:delete-run）
- 入参 { runId: string }（非空，trim 校验）。
- 返回 { code: 0, data: { deleted: true, runId } } 或 { code: 1, message }。
- 校验：runId 必须存在（内存或持久化快照）；运行中（status==='running'）拒绝删除。
- 前端分流：item.projectId ? 删除项目 : 删除 run；删除后本地列表移除。
- 错误通知：新增 RUN_DELETE_FAILED key（zh/en 成对）。

## 7. 多语言（zh/en 成对，CI Gate 7）
新增/修改 keys：
- create.history.errorSummary：「错误摘要」→「失败原因」/ 'Failure reason'
- create.history.editAndRecompose：「编辑并重新合成」→「编辑」/ 'Edit'
- create.history.deleteRunTitle/deleteRunMessage（run 型删除确认）
- story2video.sceneMaterial.voiceLabel：「音色」/ 'Voice'（替换 voiceIdLabel 文案值或新增）
- story2video.sceneMaterial.generateAiVideo 复用
- story2video.sceneMaterial.segmentJumpPrev/Next（可选）：「上一条/下一条」
- 删除无用 keys 时同步 zh/en 两边。

## 8. 显示项与交互验收清单（UI 验收）
- [ ] 启动页：底部操作条固定；进度区 sticky 顶部；failed 状态显示「生成失败」
- [ ] 历史页：所有状态卡片有删除；编辑按钮文字「编辑」；失败原因自然语言；点卡片直接进编辑页
- [ ] 详情页：返回跳历史；标题显示；分段标题在图片上方；底部操作条；快捷跳转；生成 AI 视频；音色下拉；语速滑条；无重试按钮
- [ ] 无成片任务可进编辑页
- [ ] 中英文切换无缺 key、无硬编码新增中文（CI Gate 7）
