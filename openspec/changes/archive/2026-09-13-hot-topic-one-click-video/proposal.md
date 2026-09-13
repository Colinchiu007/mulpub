# 热门选题一键生成视频

## Why

热门选题页目前只有「创作文案」（跳改写页）与「一键发布」（批量改写存草稿）两条路径。用户想从选题直接得到成品视频，必须手动串联：改写 → 存草稿 → 跳创作页 → 选故事讲述流水线 → 配置选项 → 启动。链路长、易断、且无法在一个界面看到「改写+视频生成」的整体进度。

用户目标：在热门选题页为单条选题新增【生成视频】按钮，点击后自动完成「改写引擎生成文案 → 按用户已保存默认选项启动故事讲述（story2video-compose）流水线」，并弹出与视频创作流水线进度状态同样 UI 的进度弹窗（增加文案改写环节）。

## What Changes

- HotTopics.vue 每条选题新增【生成视频】按钮（与【创作文案】并列）。
- 新增一键生成视频编排：点击 → 弹出进度弹窗（UiModal + StageProgress，与 CreateView 同款 UI）→ 「文案改写」阶段（aiRewrite mode=create）→ 自动启动 story2video-compose 流水线（读取 story2video.lastOptions.v1 构建配置）→ 阶段进度实时更新 → 完成跳结果页 / 失败可重试。
- 进度弹窗 stages = [文案改写] + STORY2VIDEO_STAGE_NAMES，复用 StageProgress 泛化渲染；新增 stage 名 rewrite_copy 在 pipeline-labels.js STAGES 与 zh/en locales 注册。
- 改写产物同时存入草稿箱（draftSave，source='hot-topics'），保证用户可回溯文案。
- 取消语义：改写阶段取消 = 中止后续启动；流水线阶段取消 = pipelineCancelRun（若不可用则提示后台运行）。
- locales zh/en 成对新增全部文案（按钮、弹窗标题、阶段名、错误提示、成功提示）。

## Scope

- 覆盖：HotTopics.vue（按钮+编排+弹窗）、pipeline-labels.js（stage 注册）、locales zh/en、PRD 文档、测试。
- 不覆盖：批量生成视频（多选）、改写引擎内部逻辑、story2video-compose stageDefs 变更（改写在 renderer 编排，不侵入流水线定义）、发布阶段行为。
