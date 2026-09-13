# 设计决策

## 决策 1：改写环节放 renderer 编排，不进 story2video stageDefs

**选 X**：HotTopics 页内先 aiRewrite → 再 pipelineStartOrchestrated，弹窗 stages 手工拼接 [rewrite_copy, ...STORY2VIDEO_STAGE_NAMES]。

**为什么**：改写只属于热门选题入口的增强流程。/create 页手动跑 story2video 的用户不应被强插改写阶段；stageDefs 是所有入口共享的单一事实来源，侵入会污染手动路径。finalize_assets 先例（运行时动态插入）适用于「同一流水线内的可选阶段」，而改写是「入口级前置动作」，语义不同。

**备选 Y（否决）**：在 stageDefs split 前插 rewrite 阶段 + story2video-stages.js 注册执行器。否决理由：所有 story2video 启动（含手动、批量创作、历史续跑）都会经过 stageDefs，改写会被错误触发；且改写输入是「选题标题」而非「完整文案」，参数语义不符。

## 决策 2：弹窗复用 UiModal + StageProgress，不抽独立组件

StageProgress 按 stages 数组泛化渲染（stageName/status/progress 均数据驱动），新阶段只需带 name/status 即可显示。CreateView 的弹窗也是内联 UiModal 而非独立组件，保持一致。

## 决策 3：默认选项从 story2video.lastOptions.v1 读取

用户已保存的默认选项存于 owner-scoped SQLite（settings 表，key='story2video.lastOptions.v1'）。HotTopics 通过 storeGetSetting 读取快照 {s2vConfig, s2vOutputConfig}，用共享的 buildStory2VideoTextConfigFromSnapshot 纯函数构建 story2videoTextConfig。快照缺失/非法时回退 CreateView data() 默认值（与 /create 页首次使用一致）。

## 决策 4：进度推送复用双通道

启动成功后订阅 onPipelineUpdate（500ms 节流推送）+ 3s 轮询 pipelineGetRunContext 兜底，与 CreateView startOrchestrationForeground 语义一致。runId 快照守卫防竞态。

## 风险与回退

- 风险：HotTopics 页与 CreateView 并发启动流水线 → 主进程并发门禁会拒绝第二个，弹窗显示失败可重试。
- 风险：lastOptions 快照含陈旧枚举 → 构建函数做与 normalizeS2VRestoredEnums 同源的类型守卫，非法值回退默认。
- 回退：整个功能是 HotTopics 页增量代码，不触碰 CreateView/流水线引擎，revert 单文件即可。
