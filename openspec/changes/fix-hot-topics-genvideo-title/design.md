## Context

热门选题「生成视频」链路在 run 成功后有两个出口：【查看】（历史）与【去发布】（发布页视频模式预填充）。【去发布】的数据契约在 `unify-video-pipeline-progress-modal`（2026-10-17）被统一为「`buildPublishFromProject` + `publishDataToQuery`，run-only 退化为只带 `video_path`，不伪造标题正文」。

该口径解决了「不得注入空标题」的问题，但**没有回答「标题应该是什么」**。实际结果是标题落到四级静默回退链的末端（`sourceText` 截断 100 字），即正文切片。

同时，热门选题链路**天然拥有两个独立的文本源**，此前的实现一个都没用上：

| 文本源 | 位置 | 当前用途 |
| --- | --- | --- |
| 原始选题 | `genVideoTopic.topic` | 弹窗标题、草稿 title（`topic.slice(0,64)`） |
| 改写正文 | `genVideoRewrittenContent` | 流水线启动参数 `text`、草稿 content |

## Goals / Non-Goals

**Goals**

- 标题由 AI 按爆款元素独立生成（不是正文切片，也不是改写 prompt 的副产物）。
- 三级降级，任一环缺失都落到**原始选题**，最终必有标题（选题为空除外）。
- 降级对用户可见（发布页来源提示），并区分「未配置模型」与「生成失败」。
- 不碰 `buildPublishFromProject` 共享真源，避免影响历史记录/结果页/播客三条入口。

**Non-Goals**

- 标题候选多选交互。
- 改主进程 `story2videoProject.title` 落库语义。
- 改发布页「标题助手」面板。

## Decisions

### D1：标题生成放在「点击【去发布】时」而不是「改写时」或「run 完成时」

| 候选 | 评估 |
| --- | --- |
| 改写阶段顺手产出 | ❌ 改写与标题是两种任务，混在一个 prompt 会互相污染。改写引擎 2026-09-18 已因「create 模式注入爆款要素诱导模型把要素名写成小节标题」踩过坑（learnings:16522），同类风险不重复引入 |
| run completed 时自动生成 | ❌ 用户可能只想【查看】；浪费一次 LLM 调用 |
| **点击【去发布】时按需生成** | ✅ 用户意图明确；失败只影响标题不影响跳转；`genVideoBusy` 守卫保证幂等 |

### D2：独立 IPC 通道而不是复用 `ai:generate`

`ai:generate` 需要调用方传 `provider`，且返回的是通用 `result`（含 `content`）。本链路需要：

- **默认模型解析放在主进程**（`aiGenerator._modelProviderManager.getDefault('llm')` + `resolveProviderDefaultModel`），渲染层不接触 provider/key；
- **区分「无模型」与「调用失败」**两种语义，让渲染层走不同降级提示；
- 复用 `videogen-stages.callDefaultLlm` 已验证的通道（`generateWithDefault('llm', …)` + 推理模型预算放大），不新写模型解析。

### D3：降级链决策做成纯函数（单一真源）

`resolveGenVideoTitle({ topicText, aiTitle, aiAvailable, max })` 是唯一决策点，渲染层只负责「取上下文 → 调用 IPC → 调纯函数 → 拼 query」。这样：

- 降级的每一格都能在无 IPC、无 Vue 的环境下穷举测试；
- 后续若加「标题候选」交互，决策逻辑不用重写。

### D4：LLM 输出清洗按「防御性白名单」而不是「信任模型」

10 条规则（见 PRD §5.2）：思维链剥离（闭合 + 未闭合）、markdown 围栏、取首行、成对引号、列表编号、「标题：」前缀、尾部标点、控制字符、码点截断、空结果。

依据：MiniMax-M3 等推理模型会把 `意识和` 块混进 `content`（ops-center `prompt_eval_evaluation_service._strip_think` 已实现同款；learnings:3347-3352 记录了两个服务的同类教训——「修复一处必须全局检索同类解析点」）。

### D5：标题上限用「prompt 约束 30 字 + 硬截断 100 字」双保险

- 30 字是中文短视频标题可用区间，写进 system prompt；
- 100 字是百家号 `DEFAULT_CONTENT_LIMITS.titleMax`，作为硬截断兜底（复用 `truncateTitle` 的码点语义）。

### D6：来源提示放发布页，不放弹窗

弹窗完成态只显示**静态说明**（「标题将由 AI 生成；失败则用原始选题」），因为 AI 标题在点击前还没生成。真实来源只能在发布页标题旁显示——那里也是用户接下来要编辑标题的地方，提示与字段相邻。

## Risks / Trade-offs

| 风险 | 缓解 |
| --- | --- |
| 多一次 LLM 调用增加点击延迟 | 先查默认模型（`modelProviderGetDefault('llm')`），无模型**不调用**；有模型时一次 chat completion（秒级） |
| LLM 输出不可控 | 10 条 normalize + prompt 约束 + 硬截断 |
| `publishGenVideoResult` 改 async | `genVideoBusy` 守卫 + 既有 3 例组件测试补 `flushPromises` |
| 发布页新增提示行触发像素门禁 | 提示行**条件渲染**（无 `title_source` 不渲染 DOM），需跑 `test:visual:pixel` 复核 |
| IPC 不可用（handler 注册失败） | 渲染层 `invokeWithFallback` 兜底 → 走 `title_source='topic'` |

## Migration Plan

无数据迁移。新增 query 字段为可选，旧链接（不含 `title_source`）行为完全不变。

## Open Questions

1. **标题是否要写入草稿库？** 本期不写（草稿 title 保持原始选题切片语义，见 `useHotTopicsGenVideo.runGenVideoRewrite` 的 `topic.topic.slice(0,64)`）。理由：草稿是「改写产物」的记录，标题是「发布决策」的产物，混在一起会让草稿箱标题语义漂移。后续切片若要做「草稿箱也能一键发布带 AI 标题」，再单独设计。
2. **是否给「无模型」场景加一键跳转模型设置？** 本期不加（发布页已有模型设置入口）。发布页提示文案明确说「未配置文字推理模型」，用户可自行前往。
