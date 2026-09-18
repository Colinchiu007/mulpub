# BUGFIX — 视频创作·历史记录「生成 AI 视频」报「当前模型账号的 AI 视频生成失败」：Agnes 视频 taskId 提取漏掉 video_id

- **状态**：已修复（待 CI 合并）
- **分支**：`codex/fix-agnes-video-taskid`
- **worktree**：`D:\Data\projects\mp-worktrees\mp-fix-agnes-video-taskid`
- **发现日期**：2026-09-18
- **关联 PRD**：`01-docs/PRD-AGNES-AI-MULTIMODAL-2026-09-16.md`（§4 视频生成流程 taskId 字段约定）
- **严重级别**：P1（历史记录详情页「生成 AI 视频」功能完全不可用）

---

## 0. 现象（用户原话）

> 在当前启动的应用中，进入视频创作，历史记录，项目 ID: mtfyfj6g_hl5l，这个视频任务的详情编辑页中，点击第 1 个分段的【生成AI视频】按钮，报错提示：当前模型账号的 AI 视频生成失败，请检查视频模型设置后重试。

可观测缺陷：

| # | 现象 | 用户影响 |
|---|------|----------|
| D1 | 历史记录详情编辑页点击第 1 个分段【生成 AI 视频】，弹窗报「当前模型账号的 AI 视频生成失败，请检查视频模型设置后重试」 | 该分段的 AI 视频无法生成，功能不可用 |
| D2 | 分段状态被回写为 failed，error 字段为 task not found (request id: ...) | 用户看不到真实原因，只能按通用提示去检查模型设置（但模型设置本身没问题） |

---

## 1. ① 根因溯源（不修表面，追到第一性引入点）

### 1.1 现象链路

用户点击【生成 AI 视频】→ 前端 ResultView.vue generateSceneAiVideo() → IPC story2video:generate-scene-ai-video → 主进程 Story2VideoProjectService.generateSceneAiVideo() → generateSceneVideoStage()（即 story2video-stages.js generateSceneVideo()）→ manager.callAdapter('agnes-video', 'generateVideo', ...) 提交成功拿到 taskId → 轮询 getVideoStatus → **Agnes 网关返回 task not found (request id: 20260918114159341263320Ov4GH5ty)** → 抛错 → 前端归一化成 scene_ai_video_generate_failed 模板。

### 1.2 第一性根因

**apps/desktop/electron/services/adapters/agnes-video.js 的 generateVideo() 提取 taskId 时漏掉了 video_id 字段。**

```js
// 修复前（agnes-video.js 第 185 行）
const taskId = data.id || data.task_id
```

Agnes 网关 POST /videos 实际返回结构为 { video_id: '<任务ID>', id: '<请求ID>' }：
- video_id = **任务 ID**，用于 GET /agnesapi?video_id=<ID> 查询任务状态；
- id = **请求 ID**，不能用于查询。

agnes-video.js 用 data.id || data.task_id 提取到的是 id（请求 ID），随后用请求 ID 去 /agnesapi?video_id= 查询 → Agnes 返回 task not found。

**对照证据**：agnes-multimodal.js（Agnes-AI 多模态，v2.5 Flash）第 309 行正确实现了 data.video_id || data.id || data.task_id，且其测试（agnes-multimodal.test.js 第 119 行 createFetchResponse({ video_id: 'vid-123', id: 'task-1' })）明确锁定了「video_id 优先于 id」的契约。agnes-video.js（国际站 v2.0）是唯一一个漏掉 video_id 的 adapter。

### 1.3 为什么写成这样

agnes-video.js 是早期（2026-08-11）接入国际站 v2.0 时写的，当时只兼容了 OpenAI 协议的 id / task_id 两种命名，未覆盖 Agnes 网关实际返回的 video_id。而 agnes-multimodal.js 是 2026-09-16 新增的，实现时参考了官方文档「id 和 task_id 是任务 ID，video_id 用于查询任务；三种命名都兼容」，正确实现了三字段兼容。两个 adapter 的字段提取逻辑不一致，且没有跨 adapter 一致性审查。

---

## 2. ② 测试逃逸分析（按测试层级列出逃逸链）

| 层级 | 是否存在该场景测试 | 为什么没拦住 |
|------|-------------------|--------------|
| 单元测试 | ❌ 覆盖不完整 | agnes-video.test.js 的 generateVideo 测试只覆盖了 id（第 143 行）和 task_id（第 183 行）两种返回，**没有覆盖 video_id 字段**；而 agnes-multimodal.test.js 覆盖了 video_id（第 119 行）。两个 adapter 的测试覆盖不对称 |
| 集成测试 | ❌ 无 | story2video-stages.test.js / videogen-stages.test.js 用 mock adapter，不涉及真实 Agnes 返回结构，无法暴露 taskId 字段提取问题 |
| E2E | ❌ 未执行 | 无真实 Agnes 视频生成 E2E（需真实 API Key + 额度） |
| 代码审查 | ❌ 未发现 | agnes-video.js 与 agnes-multimodal.js 的 taskId 提取逻辑差异未被审查发现；PRD-AGNES-AI-MULTIMODAL §4 明确写了「video_id > id > task_id」，但只约束了新增的 multimodal adapter，未回查既有 v2.0 adapter |

**逃逸链一句话**：agnes-video.js 测试只覆盖 id/task_id → 未覆盖 Agnes 实际返回的 video_id → 无跨 adapter 字段契约 → 审查未发现两 adapter 不一致，四道关口全部失效。

---

## 3. ③ 系统性漏洞定位

| 分类 | 具体漏洞 | 说明 |
|------|---------|------|
| 测试覆盖漏洞 | agnes-video.test.js 的 generateVideo 未覆盖 video_id 字段 | adapter 测试应覆盖 provider 实际返回的字段命名，不能只按「OpenAI 兼容」假设覆盖 id/task_id |
| 跨 adapter 一致性缺失 | agnes-video.js 与 agnes-multimodal.js 的 taskId 提取逻辑不一致 | 同一 Agnes 网关的两个 adapter 对同一字段命名处理不同，缺少统一约定或交叉审查 |
| 文档-代码脱节 | PRD-AGNES-AI-MULTIMODAL §4 写了「video_id > id > task_id」，但只约束新增 adapter，未回查既有 v2.0 adapter | 文档契约未反向校验既有实现 |

---

## 4. ④ 修复 + 回归保护测试

### 4.1 修复（apps/desktop/electron/services/adapters/agnes-video.js）

```js
// 兼容 OpenAI 协议字段命名。Agnes 网关实际返回 { video_id, id }：
// video_id 是任务 ID（用于 /agnesapi?video_id= 查询），id 是请求 ID（不能用于查询）。
// 若漏取 video_id 而用 id 去查询，会得到 task not found（2026-09-18 修复，与 agnes-multimodal 同源）。
const taskId = data.video_id || data.id || data.task_id
```

### 4.2 回归保护测试（agnes-video.test.js，generateVideo describe 内新增 2 例）

| # | 用例 | 断言要点 | 模式 |
|---|------|---------|------|
| 1 | video_id 字段优先于 id（Agnes 网关实际返回 video_id 为任务 ID，id 为请求 ID） | mock { video_id: 'vid-123', id: 'req-456' } → result.taskId === 'vid-123'（不能取 req-456） | 单元 |
| 2 | 仅返回 video_id 字段时也能提取任务 ID | mock { video_id: 'vid-only' } → result.taskId === 'vid-only' | 单元 |

**RED → GREEN 证据**：

- RED（修复前）：Tests 2 failed | 40 passed (42) — 新增 2 例全部失败：
  - 用例 1：expected 'req-456' to be 'vid-123'（当前代码取 id）
  - 用例 2：ProviderError: Missing task id in response（当前代码不识别 video_id）
- GREEN（应用修复）：Tests 43 passed (43)。
- 回归：agnes-multimodal.test.js（30）+ story2video-stages.test.js（149）+ videogen-stages.test.js（37）共 216 例全绿。

---

## 5. ⑤ 预防措施（已落地的具体文件变更）

1. **回归测试进 CI**：agnes-video.test.js 新增 2 例随 apps/desktop 测试集在 CI 全量执行，锁定 video_id 字段提取。
2. **learnings 沉淀**（01-docs/learnings.md）：新增 pitfall「adapter 的 taskId 提取必须覆盖 provider 实际返回的字段命名（video_id/id/task_id），不能只按 OpenAI 兼容假设覆盖 id/task_id；同一网关的多个 adapter 字段提取逻辑必须一致」。
3. **CHANGELOG**（01-docs/CHANGELOG.md）：追加本次修复条目。
4. **审查清单建议（后续可落地）**：审查新增 adapter 时，强制核对同一 provider 的既有 adapter 是否已覆盖其实际返回字段；PRD 中写明的字段契约（如 video_id > id > task_id）应反向校验既有实现。

---

## 6. 数据校验与流程（修复后）

### 6.1 数据校验

generateVideo() 对 Agnes POST /videos 响应的 taskId 提取校验：

| 校验项 | 规则 | 失败行为 |
|--------|------|---------|
| taskId 提取优先级 | video_id > id > task_id（三字段兼容） | 三者皆空 → 抛 ProviderError(PROVIDER_ERROR, 'Missing task id in response') |
| taskId 非空 | 提取结果必须非空字符串 | 空 → 抛 Missing task id in response |
| 提交重试 | 503（队列满载）/ 429（限流）/ 500 / 超时 / 网络错误视为瞬时，最多 6 次递增退避（20s/30s/45s/60s/60s） | 非重试错误（401/403/402/400）立即抛出；重试耗尽抛最后一次错误 |

### 6.2 流程（历史记录「生成 AI 视频」→ Agnes 视频生成）

```
历史记录详情编辑页 → 点击分段【生成 AI 视频】
  └─ ResultView.generateSceneAiVideo(segmentId)
       ├─ 校验：分段存在、有可用 videoPrompt、非 busy、先落盘本地编辑（segmentsDirty → saveSegments）
       └─ IPC story2video:generate-scene-ai-video
            └─ Story2VideoProjectService.generateSceneAiVideo
                 ├─ 校验：manager 可用、_defaultVideoGenerator 非空（未配置视频供应商则报可读错误）
                 ├─ prompt = videoPrompt || prompt || text（safeText 截断 20000）
                 └─ generateSceneVideoStage（story2video-stages.generateSceneVideo）
                      ├─ callAdapter('agnes-video', 'generateVideo', { prompt, model, width, height, numFrames, frameRate, ... })
                      │    └─ POST /videos → 解析 taskId = video_id || id || task_id（修复点）
                      ├─ 轮询（每 10s，最长 10 分钟）callAdapter('agnes-video', 'getVideoStatus', { videoId, taskId })
                      │    └─ GET /agnesapi?video_id=<taskId>&model_name=agnes-video-v2.0
                      │         ├─ status: queued/in_progress → processing
                      │         ├─ status: completed → videoUrl = metadata.url（兼容顶层 url）
                      │         └─ status: failed → 终止
                      ├─ 下载视频 → ffprobe 校验可解码
                      └─ 成功 → 替换 videoPath；失败 → 保留旧视频、清理本次产物、回写 failed
```

### 6.3 功能逻辑要点

- _defaultVideoGenerator 解析默认视频供应商：manager.getDefault('video') → 用户默认 > 运营默认 > capability_models.video > models[0]（与流水线同源）。
- 提交与查询使用**同一个 taskId**（修复后 video_id 优先），确保 /agnesapi 能查到任务。
- 查询端点 /agnesapi 位于域名根（base_url 之外），必须用绝对 URL（apiRoot = baseUrl 去掉 /v1），否则拼成 /v1/agnesapi 会 task not found。
- 失败保留旧视频、清理本次产物（attemptFiles）、分段状态回写 failed + error。

---

## 7. 交互逻辑与显示项

### 7.1 交互逻辑

- 点击【生成 AI 视频】：分段进入 busy 态（segmentBusy[segmentId] = 'aiVideo'），按钮禁用/loading；成功后刷新分段素材 URL 并提示成功；失败弹错误提示。
- 重新生成前先落盘本地编辑（segmentsDirty → saveSegments），避免基于旧优化词生成或服务端响应覆盖未保存修改。
- 失败后分段状态回写 failed，error 字段记录真实错误（如 task not found），供后续排查。

### 7.2 显示项

| 显示项 | 说明 |
|--------|------|
| 分段状态 | processing（生成中）/ completed（成功）/ failed（失败） |
| 分段 error | 失败时记录真实错误 message（如 task not found (request id: ...)） |
| 分段 videoPath / videoMeta | 成功后写入本地视频路径 + { provider, model, source: 'ai-video', sceneVideoPath } |

### 7.3 提示文字

本次修复**未新增/未修改**任何用户可见文案（zh.js / en.js 无变更，无 i18n 成对改动）。失败提示仍走既有 scene_ai_video_generate_failed 模板（{provider}模型账号的 AI 视频生成失败，请检查视频模型设置后重试），但**根因已消除**——修复后不再因 taskId 提取错误触发此提示。

---

## 8. 边界情况

- POST /videos 返回只有 video_id（无 id/task_id）：修复后能正确提取（新增回归用例 2）。
- POST /videos 返回 { video_id, id } 并存：修复后取 video_id（新增回归用例 1）。
- POST /videos 返回只有 id 或 task_id（旧网关/兼容场景）：修复后仍兼容（既有测试覆盖）。
- 三者皆空：抛 Missing task id in response，不发起无效查询。
- 查询 task not found（任务真不存在/过期）：仍会报错，但这是 Agnes 网关侧真实状态，非本 bug 导致；分段回写 failed + error 供排查。

---

## 9. 验收标准

- [x] agnes-video.js generateVideo() 提取 taskId 时 video_id 优先于 id/task_id。
- [x] agnes-video.test.js 新增 2 例回归测试（video_id 优先 + 仅 video_id），RED→GREEN 证据完整。
- [x] 相关测试全绿：agnes-video（43）+ agnes-multimodal（30）+ story2video-stages（149）+ videogen-stages（37）= 259 例。
- [x] 用户场景（历史记录详情编辑页点击【生成 AI 视频】）不再因 taskId 提取错误报「task not found」。
