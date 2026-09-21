# 多语言术语词典（i18n-glossary）

> i18n-content-sync L3：产品名词的 zh/en 翻译集中维护。修改任一术语时，zh/en 两侧文案必须同步更新，
> 由 `apps/desktop/src/i18n/glossary.test.js` 自动校验（术语在 zh/en locale 文案中的出现状态必须一致，
> 防止「只改了中文没改英文」）。机器 ID 为稳定标识，**不得改名**。

| zh | en | 机器 ID（稳定，不改名） |
|----|----|--------------------------|
| 历史状态筛选 | History status filter | history.statusFilter |
| 全部 | All | history.status.all |
| 进行中 | Running | history.status.running |
| 已暂停 | Paused | history.status.paused |
| 执行失败 | Failed | history.status.failed |
| 已完成 | Completed | history.status.completed |
| 已取消 | Cancelled | history.status.cancelled |
| 更新时间 | Updated | history.updated |
| 创建时间 | Created | history.created |
| 耗时 | Duration | history.duration |
| 视频时长 | Video duration | history.videoDuration |
| 文案预览 | Content preview | history.contentPreview |
| 未生成 | Not generated | history.notGenerated |
| 视频任务编辑页 | Video task editor | story2video.history.editor |
| 查看文案 | View Script | story2video.view_script |
| 全部文案 | Full Script | story2video.script_modal_title |
| 文案已复制到剪贴板 | Script copied to clipboard | story2video.script_copied |
| 复制 | Copy | story2video.script_copy_button |
| 已复制 | Copied | story2video.script_copied_button |
| 已取消任务可编辑 | Cancelled task is editable | story2video.history.cancelledEditable |
| 暂停环节 | Paused stage | history.pausedStage |
| 暂停环境/检查点 | Pause environment/checkpoint | history.pauseEnvironment |
| 失败环节 | Failed stage | history.failedStage |
| 失败原因 | Failure reason | history.errorSummary |
| 查看任务详情 | View task details | history.viewDetails |
| 从断点继续 | Resume from breakpoint | history.resume |
| 继续生成 | Continue generation | history.continue |
| 打开结果 | Open result | history.openResult |
| 故事讲述 | Story Telling | `story2video-compose` |
| 启动流水线 | Start pipeline | — |
| 启动即前台跟踪 | Start & foreground tracking | create.story2video.startForegroundToast |
| 后台运行 | Run in background | create.story2video.backgroundResumeToast |
| 关闭进度并转入后台运行 | Close progress and run in background | create.story2video.progressCloseLabel |
| 任务已转入后台运行，在历史记录中可查看 | The task is now running in the background. You can view it in History. | create.story2video.backgroundDetachedToast |
| 已中断 | Interrupted | create.history.tabs.interrupted / create.history.statuses.interrupted / stageProgress.interruptedStage / stageProgress.interruptedHint |
| 口播视频 | Talking Head | `talking-head` |
| 数字人口播 | Avatar Spokesperson | `avatar-spokesperson` |
| 旁白 | Narration | — |
| 旁白式 | Voice-over | — |
| 口播式 | Talking-head mode | — |
| 图片轮播 | Image Carousel | — |
| 视频克隆 | Video Clone | `video-clone` |
| 运营后台 | Ops Center | — |
| 模型设置 | Model Settings | — |
| 历史记录 | History | — |
| 发布历史 | Publish History | — |
| 提示词 | Prompt | — |
| 草稿箱 | Drafts | — |
| 流水线 | Pipeline | — |
| 流水线启动页 | Pipeline launch page | create.story2video |
| 视频任务编辑页 | Video task editor | story2video.sceneMaterial |
| 失败原因 | Failure reason | create.history.errorSummary |
| 音色 | Voice | story2video.sceneMaterial.voiceIdLabel |
| 返回 | Back | story2video.sceneMaterial.backToHistory |
| 保存配置 | Save configuration | create.story2video.configProfile.saveButton |
| 我的配置 | My configurations | create.story2video.configProfile.manageButton |
| 应用配置 | Apply configuration | create.story2video.configProfile.applyTitle |
| 配置已保存 | Configuration saved | create.story2video.configProfile.saved |
| 已应用配置 | Configuration applied | create.story2video.configProfile.applied |
| 配置已重命名 | Configuration renamed | create.story2video.configProfile.renamed |
| 配置已删除 | Configuration deleted | create.story2video.configProfile.deleted |
| 分镜视频生成 | Shot video generation | filmEngineering.video.title |
| 成本确认 | Cost confirmation | filmEngineering.video.confirmTitle |
| 成片 | Final video | filmEngineering.video.doneTitle |

## 维护规则

1. 新术语：先在本表登记，再在 `apps/desktop/src/locales/zh.js` 与 `en.js` 成对加入文案。
2. 改术语：只改本表 + locales 两侧；glossary.test.js 会在 zh/en 出现状态不一致时失败。
3. 术语出现状态 = 该词是否出现在对应 locale 文件的任一字符串值中（子串匹配）。
4. 机器 ID 只作为内部标识（IPC/配置/历史数据），外显名称一律走 locale。

## 视频生成模式术语边界（2026-08-13）

> 用于区分「旁白式」与「口播式」，避免 UI/文案混用。
> 登记纪律：分析性术语只有在 zh/en locales 成对出现文案后才能登记（登记即触发 glossary.test.js 状态校验）；
> 「旁白式 / 口播式 / 图片轮播」已于 2026-08-13 随 `locales.pipelines.modes` 成对落地并登记。

- **旁白式**（对应流水线 `story2video-compose`，外显「故事讲述」）：画面无说话人，TTS 人声为画外解说（Narration），文案角色 = 解说词。
- **口播式**（`talking_head` 类别，外显「口播视频」/「数字人口播」）：画面有说话人（真人视频或数字人），文案角色 = 口播台词。
- 两者共享 TTS 人声能力，但成片语义不同：旁白 = voice-over；口播 = 人物出镜说话。
- 若需新增「旁白式」「口播式」「图片轮播」等 UI 文案：先在本表登记，并同步 `zh.js` / `en.js` 成对加入。
