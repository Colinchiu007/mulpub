# Proposal — 热门选题「生成视频 → 去发布」标题改为 AI 爆款标题

## Why

用户在热门选题页对某条选题执行【生成视频】，run 成功后点【去发布】，发布页带入的标题是**改写正文的前 100 字**（`truncateTitle` 按百家号上限截断的 `sourceText`），而不是一个可用的标题。用户在发布页每次都要手工重写标题，「一键生成视频 → 一键发布」的自动化承诺在最后一跳断裂。

第二形态：非 `story2video-compose` 流水线（animated-explainer / documentary-montage / animation / avatar-spokesperson / character-animation / hybrid）不产出 `story2videoProject`，【去发布】走 run-only 分支只带 `video_path`，**标题为空**。

### 根因（追溯至引入点）

标题来源是一个四级静默回退链，其中前三級在「热门选题 → 生成视频」这条链路上**恒为空**：

1. `buildGenVideoStartParams`（`apps/desktop/src/features/hot-topics/gen-video-pipelines.js:186`）构造的启动参数不含 `title`；
2. `buildStory2VideoTextConfigFromSnapshot`（`apps/desktop/src/story2video/s2v-config-snapshot.js:175`）的 `publish.title = config.title || ''`，而 `S2V_CONFIG_DEFAULTS.title = ''` 且热门选题链路从不写该字段；
3. 主进程 `story2video-project-service.js:1010`：`project.title = safeText(run.params?.title || publish.title || sourceText, 160)` ⇒ 落到 `sourceText`（= 改写全文）；
4. `buildPublishFromProject`（`apps/desktop/src/features/publish/publish-from-project.js:60`）取 `project.title`，再被 `truncateTitle(rawTitle, 100)` 截断。

即：**标题从来不是一个独立生成物，它只是正文的一个切片。**

### 测试为什么没拦住（逃逸分析）

`publish-from-project.test.js` 的夹具让 `project.title` 与 `sourceText` **取同值且都只有 38 字**，「title 回退到 sourceText」这条生产缺陷路径在测试中表现为「正确行为」；`HotTopics.test.js` 的【去发布】夹具则直接给定 `story2videoTextConfig.config.publish.title = '发布标题'`，而真实链路该字段恒为空串。**夹具把前几级回退填满，使「前几级全空」的生产形态从未被断言。**

## What Changes

- 新增纯函数模块 `apps/desktop/src/features/publish/gen-video-title.js`：爆款标题 prompt 构造、LLM 输出清洗、降级链决策（单一真源）。
- 新增主进程 IPC `ai:generate-gen-video-title`：复用 `aiGenerator.generateWithDefault('llm', …)`（与 `videogen-stages.callDefaultLlm` / `explainer-stages.callDefaultLlm` 同一通道），无默认文字推理模型时返回 `reason:'no-model'` 而非抛错。
- 改 `useHotTopicsGenVideo.publishGenVideoResult()` 为 async：点击时按需生成标题，按降级链决策后注入 query；`genVideoBusy` 守卫保证重复点击不产生第二次 LLM 调用。
- 【去发布】query 新增可选字段 `title` / `title_source`（`ai`|`topic`）/ `title_reason`（`no-model`|`failed`）；run-only 分支同样带标题，`content`/`tags` 仍不注入（既有语义不变）。
- 发布页在视频模式且 `title_source` 存在时，于标题输入框下方渲染三态来源提示。
- 热门选题弹窗完成态新增一行静态说明（标题将由 AI 生成，失败则用原始选题）。

## Impact

- **Affected specs**：`hot-topics-gen-video`（新增 Requirement「去发布标题生成与降级」）。
- **Affected code**：
  - `apps/desktop/src/features/publish/gen-video-title.js`（新增）
  - `apps/desktop/electron/ipc-handlers/gen-video-title.js`（新增 + 注册接线）
  - `apps/desktop/src/api/publisher.js`（新增封装）
  - `apps/desktop/src/composables/useHotTopicsGenVideo.js`（改 `publishGenVideoResult`）
  - `apps/desktop/src/views/HotTopics.vue`（完成态提示行）
  - `apps/desktop/src/views/Publish.vue`（标题来源提示行）
  - `apps/desktop/src/locales/hot-topics/{zh,en}.js`、`apps/desktop/src/locales/publish-page/{zh,en}.js`（成对新增）
- **不改**：`buildPublishFromProject` 通用回退链（历史记录/结果页/播客三条入口语义不变）、主进程 `story2videoProject.title` 落库、发布页标题助手面板。
- **风险**：多一次 LLM 调用（无模型时不调用）；`publishGenVideoResult` 改 async 需同步既有组件测试。
