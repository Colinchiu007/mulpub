# Bug 反思报告 — 热门选题【生成视频】后台运行后按钮全部失效（2026-09-13）

- 文档编号：BUGFIX-HOT-TOPICS-GEN-VIDEO-PARALLEL-2026-09-13
- 严重程度：P1（核心入口被永久锁死，用户需重启应用才能恢复）
- 影响范围：`apps/desktop/src/views/HotTopics.vue`（热门选题页一键生成视频）
- 关联 PRD：`01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md` §3.10 / §5.6 / §6.6 / §6.7 / §8 / §9
- 关联模块：视频创作页流水线（`apps/desktop/src/views/CreateView.vue`）——并行语义的对齐基准
- 修复分支：`codex/hot-topics-gen-video-parallel`

---

## 1. 现象与复现

**用户报障（原文）**：

> 在热门选题页，点击了某个选题的【生成视频】按钮，在弹出的流水线弹窗点击了【后台运行】按钮后，弹窗消失。此时再次点击另一个选题的【生成视频】按钮，没有任何反应。是不是因为已经有运行中的任务？但是任务是可以多个并行的……同视频创作模块的逻辑是一样的，同时可以有多个流水线任务并行运行。

**复现步骤（修复前 100% 复现）**：

1. 进入 `/hot-topics`，点击任一条选题的【生成视频】→ 弹窗出现，改写完成，进入 `running`；
2. 点击弹窗 footer 的【后台运行】（或右上角 ×）→ 弹窗关闭，顶部提示「任务已转入后台」；
3. 点击**任意另一条**选题的【生成视频】→ **无任何反应**（按钮呈禁用态，点击无效）；
4. 不重启应用则永久无法再发起视频任务（即使后台那条 run 早已跑完）。

**修复后**：步骤 3 立即打开新弹窗并对该选题独立完成 改写 → 启动流水线，与第 1 条 run 并行执行（两条 runId 各自跟踪、互不干扰）。

---

## 2. ① 第一性原因溯源

**引入点（git blame 精确追溯）**：

| commit | 日期 | 内容 | 与本次 Bug 的关系 |
|--------|------|------|------------------|
| `0c21d9561` | 2026-09-12 | `feat(hot-topics): 热门选题一键生成视频——改写引擎+故事讲述流水线+进度弹窗 (#1726)` | **原始引入**：`handleGenVideoClose()` 后台分支只置 `genVideoPhase='background'`，并附带注释「后台态：按钮保持禁用直到用户开新任务」——**但按钮依赖的正是 busy 而非 phase，注释描述的状态机与实现不一致** |
| `d895eada8` | 2026-09-13 | 新增显式【后台运行】按钮（复用同一 `handleGenVideoClose`） | 把同一个缺陷暴露为「显式按钮」路径，扩大了触发面 |

**缺陷代码（修复前）**：

```js
function handleGenVideoClose() {
  if (!genVideoTerminal.value) {
    stopGenVideoTracking()
    genVideoModalOpen.value = false
    genVideoPhase.value = 'background' // 后台态：按钮保持禁用直到用户开新任务（run 由主进程继续）
    notifyInfo('hotTopics.genVideoBackgroundHint')
```

**为什么会写成这样（第一性原因）**：

1. **状态归属混乱**：把「是否忙碌」这个**跨任务级别的并发闸门**（`genVideoBusy`）与「当前弹窗任务的阶段」`genVideoPhase` 混用。脱离只改了后者，前者从未复位；
2. **双保险变成双锁**：入口同时用了模板禁用（`:disabled="genVideoBusy"`）与方法内守卫（`if (genVideoBusy.value ...) return`），两处都依赖同一个永不复位的标志 → 无路可走；
3. **错误的产品假设**：把"同一页面同时只跟一个流水线"误当成"同一页面同时只能运行一个流水线"。实际主进程 `PipelineEngine` 本就支持多 run 并行（`maxConcurrentRuns` + `PIPELINE_CONCURRENCY_LIMIT`），视频创作页也一直是「脱离即复位、可再开新任务」（`resetPipelineToNewTaskState` → `resetPipelineUiState`）。热门选题页**重复实现了并发闸门**，且实现方式比权威闸门更严格；
4. **注释掩盖实现**：「按钮保持禁用直到用户开新任务」在逻辑上自相矛盾（按钮禁用时用户根本无法开新任务），但代码审查时容易被当成有意设计而放过。

---

## 3. ② 测试逃逸分析（逃逸链）

| 层级 | 是否有覆盖 | 为什么没拦住 |
|------|-----------|-------------|
| 单元测试 | ⚠️ 有覆盖，但**断言写反了** | `HotTopics.test.js` 用例 `generate-video close during running moves to background and keeps busy guard` 明确断言 `expect(wrapper.vm.genVideoBusy).toBe(true)` 并断言再次 `startGenerateVideo` 时 `pipelineStartOrchestrated` 只被调用 1 次 —— **测试把缺陷固化为"预期行为"**，修复必须先改测试 |
| 集成测试 | ❌ 无 | `pipeline-background-toast` / `PipelineBackgroundToast` 只验证全局提示状态机，不覆盖「脱离后入口可用性」这一跨组件交互 |
| E2E（浏览器/Electron） | ❌ 无 | `tests/e2e/**` 无热门选题一键生成视频用例；该流程还依赖真实模型与流水线，E2E 未覆盖 |
| 视觉回归 | ❌ 无 | `hot-topics` 视图虽注册于 `all-views.visual.test.js`，但像素对比只能看出「按钮变灰」，无法判定"灰得合理还是灰错了" |
| 代码审查 | ❌ 漏过 | 注释「按钮保持禁用直到用户开新任务」自相矛盾；且 PRD 同步写了「防止并发第二个流水线任务」（见下），审查者按"符合 PRD"通过 |

**逃逸原因分类**：`无测试`（集成/E2E 层）+ `断言不精确`（单测断言了错误行为）+ **`需求层缺陷`**（PRD 把错误行为写成需求，形成"文档—代码—测试"三者自洽的错误闭环）。

---

## 4. ③ 系统性漏洞定位

| 缺陷类型 | 具体文件 | 系统性缺陷 |
|----------|---------|-----------|
| 需求缺口 | `01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md` §3.10 / §6.6（修复前） | 「并发约束」被写成"所有选题按钮禁用"，与视频创作页既有语义（可并行）**直接冲突**，且未与主进程并发门禁对齐——文档成为缺陷的保护伞 |
| 测试缺口 | `apps/desktop/src/views/HotTopics.test.js` | 用例名/断言固化了缺陷行为（`keeps busy guard`）；缺少「脱离 → 入口恢复可用 → 可并行启动第二条」的端到端断言 |
| 复用缺口 | `apps/desktop/src/views/HotTopics.vue` vs `CreateView.vue` | 同类能力（流水线脱离）在两个视图**各自实现**，语义漂移无契约约束：CreateView 脱离 = 全量复位，HotTopics 脱离 = 半复位 |
| 门禁缺口 | CI（`.github/workflows/quality-gate.yml`） | 静态门禁无法发现"禁用态未释放"这类**状态机不闭环**问题；无「前端状态机复位完整性」检查项 |

---

## 5. ④ 修复 + 回归保护测试

### 5.1 修复方案（最小改动、单一公共路径）

**核心**：抽出唯一公共复位方法 `resetGenVideoFrontendState()`，并让「后台脱离 / 终态关闭」共用；把「是否可脱离」与「复位」拆开，避免状态判据与复位动作互相污染。

```text
handleGenVideoClose()            // 右上角 × / 遮罩 / ESC
  ├─ genVideoTerminal         → resetGenVideoFrontendState()（终态直接复位关闭）
  ├─ genVideoCanBackground    → resetGenVideoFrontendState() + notifyInfo(genVideoBackgroundHint)
  └─ 其它（rewriting/starting）→ resetGenVideoFrontendState()（中止前端编排，无误报后台提示）

detachGenVideoToBackground()     // footer【后台运行】
  └─ 重校验 genVideoCanBackground → handleGenVideoClose() → showPipelineBackgroundToast()

closeGenVideoModal()             // footer【关闭】（仅终态）
  └─ resetGenVideoFrontendState()

resetGenVideoFrontendState()     // 唯一复位路径
  genVideoSeq++ / stopGenVideoTracking() / 弹窗关闭 / phase='idle'
  topic·stages·runId·progress·startedAt·errorText·rewrittenContent·draftId 清空
  genVideoBusy = false           ← 本次 Bug 的修复点
```

语义变化（详见 PRD §6.7）：

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 运行中点【后台运行】/ × | `phase='background'`、busy 保持 true、入口永久锁死 | `phase='idle'`、busy 释放、入口立即可用、可并行 |
| 运行中点【后台运行】 | 同上 + 全局居中提示 | 保留全局居中提示，且前端态复位 |
| 改写/启动中点 × | `phase='background'` + 误报「任务已转入后台」，且后端改写成功后仍会静默启动流水线 | 中止前端编排（seq 递增使在途响应失效），不启动流水线、无后台任务、不误报 |
| 弹窗在途时点其它选题【生成视频】 | 被 busy 拦截 | **仍被 busy 拦截**（保留，避免同一弹窗内双编排丢失 UI） |
| 并行上限 | 前端一次只允许 1 条 | 前端不设限；由主进程 `PIPELINE_CONCURRENCY_LIMIT` 判定，超限落到「启动失败 + 重试」 |

### 5.2 回归保护测试（已落地）

**文件**：`apps/desktop/src/views/HotTopics.test.js`（与实现同目录，Vitest 组件级集成测试，使用真实组件 + mock IPC 边界）

| # | 用例名 | 断言要点 |
|---|--------|---------|
| 1 | `generate-video close during running detaches to background and releases frontend tracking state` | 弹窗关闭；`phase==='idle'`；`busy===false`；`runId===null`；`stages.length===0`；**未调用** `pipelineCancelRun`；随后可再次 `startGenerateVideo` 并触发第 2 次 `pipelineStartOrchestrated` |
| 2 | `generate-video close during rewrite aborts frontend orchestration without starting pipeline` | 用永不 resolve 的 `aiRewrite` 卡在 `rewriting`；点 × 后弹窗关闭、`phase==='idle'`、`busy===false`、**未调用** `pipelineStartOrchestrated` / `pipelineCancelRun` |
| 3 | `generate-video busy guard still blocks a second orchestration while rewrite is in flight` | 弹窗在途时另一选题按钮 `disabled` 且 `startGenerateVideo` 被拦截（`aiRewrite` 仍只调用 1 次，`genVideoTopic` 仍为第一条选题）——防止修复过界 |
| 4 | `after background-run detach, another topic can start a parallel pipeline immediately` | 端到端复现用户路径：选题 A 运行中 → 点【后台运行】（弹窗关闭、busy 释放、run 未取消、全局提示可见）→ 选题 B 按钮 `disabled` 属性不存在 → 点击后第二次 `pipelineStartOrchestrated` 的 `params.text` 为**选题 B 的改写产物**、`genVideoRunId` 切换为 `run-parallel-2`，且 `aiRewrite` 共 2 次 |

**运行**：`cd apps/desktop && pnpm exec vitest run src/views/HotTopics.test.js` → 26 passed（含上述 4 例）。

---

## 6. ⑤ 预防措施（已落地）

1. **PRD 修正（需求层闭环）**：`01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md`
   - §3.10「并发约束」改为「前端不设单任务锁 + 主进程门禁为权威闸门」；
   - §5.6 流程图补「前端态复位 → 可并行」与「改写阶段关闭即中止」分支；
   - §6.6 按钮矩阵删除 `background` 滞留态、改为「弹窗已关 + 复位为 idle」；
   - **新增 §6.7「并发任务与前端态复位规格」**：状态机表、复位清单（逐字段）、busy 守卫作用域表、数据校验与 6 条竞态守卫、提示文字表、6 条边界情况；
   - §8 验收标准新增第 12/13 条（并行可发起、改写阶段关闭即中止）。
2. **测试固化（代码层闭环）**：上述 4 条回归用例进 CI（`HotTopics.test.js` 随 desktop shards 跑），并把原先断言缺陷行为的用例改为断言正确行为。
3. **对齐既有语义（复用层闭环）**：明确热门选题的脱离语义以视频创作页 `resetPipelineToNewTaskState` 为基准；后续同类视图新增流水线入口时必须对齐「脱离 = 全量复位 + 释放 busy」契约（本 PRD §6.7 为该契约的书面载体）。
4. **经验沉淀**：`01-docs/learnings.md` 新增 pitfall 条目（"前端自设并发闸门"与"注释掩盖实现"两类模式），供 `/learn` 与后续代码审查复用。

---

## 7. 详细交互与显示规格（本次补充的完整口径）

### 7.1 入口与可用性

| 元素 | data-testid | 可用条件 | 禁用表现 |
|------|-------------|---------|---------|
| 每行【生成视频】 | `hot-topic-generate-video-{id}` | `genVideoBusy===false` 且 `topic.topic` 非空 | 原生 `disabled`（灰显、点击无效） |
| footer【重试】 | `hot-topics-gen-video-retry` | `phase==='failed'` | 不渲染 |
| footer【后台运行】 | `hot-topics-gen-video-background` | `phase==='running'` 且持有 runId | 不渲染 |
| footer【取消】 | `hot-topics-gen-video-cancel` | `phase ∈ {rewriting, starting, running}` | 不渲染 |
| footer【关闭】 | `hot-topics-gen-video-close` | `phase ∈ {completed, failed, cancelled}` | 不渲染 |
| 弹窗右上角 × | `ui-modal-close` | 始终可点（overlay/ESC 均关闭，仅 × 生效） | — |

### 7.2 交互时序（并行任务，修复后）

```
t0  选题A【生成视频】→ 弹窗打开（8 阶段）→ rewrite_copy running → aiRewrite(A)
t1  改写成功 → 存草稿(失败不阻断) → 读取 story2video.lastOptions.v1 → pipelineStartOrchestrated(A)
t2  返回 runId=run-A → phase=running → 双通道跟踪（onPipelineUpdate + 3s 轮询）
t3  点【后台运行】→ 停跟踪 + 复位（busy=false, runId=null, phase=idle）+ 顶部 toast + 全局居中提示
t4  主进程 run-A 继续执行（前端不再跟踪；完成后在视频创作页「历史记录」可见）
t5  选题B【生成视频】按钮可用 → 点击 → 弹窗打开 → aiRewrite(B) → pipelineStartOrchestrated(B) → runId=run-B
t6  run-A 与 run-B 并行；前端只跟踪 run-B（runId 守卫丢弃一切非 run-B 的推送）
t7  并发超限（达到 maxConcurrentRuns）→ 启动失败 → 弹窗错误摘要「视频流水线启动失败，请点击重试」+【重试】
```

### 7.3 显示项与提示文字

| 位置 | 内容 | 来源 |
|------|------|------|
| 弹窗标题 | 一键生成视频 · {选题名截断 30 字} | `hotTopics.genVideoTitle` |
| 顶部 toast（脱离） | 任务已转入后台，可在视频创作页「历史记录」中查看进度 | `hotTopics.genVideoBackgroundHint` |
| 全局居中（脱离按钮，4s） | 如果想查看该任务，请进入视频创作的历史记录 | `common.pipelineBackgroundToast` |
| 弹窗错误摘要 | 文案改写失败，请点击重试 / 视频流水线启动失败，请点击重试 / 已取消生成视频 | `hotTopics.genVideoRewriteFailed` / `genVideoPipelineFailed` / `genVideoCancelled` |

> 本次修复**未新增 i18n key**，文案与 zh/en 成对性保持不变（CI Gate 7 无需变更）。

---

## 8. 验证记录

| 项 | 命令 | 结果 |
|----|------|------|
| 目标用例（RED→GREEN） | `cd apps/desktop && pnpm exec vitest run src/views/HotTopics.test.js` | 修复前 5 failed / 21 passed → 修复后 **26 passed** |
| 相关提示组件 | `pnpm exec vitest run src/components/PipelineBackgroundToast.test.js src/stores/pipeline-background-toast.test.js` | 见 PR CI 记录 |
| 类型检查 | `cd apps/desktop && pnpm exec tsc --noEmit` | 见 PR CI 记录 |
| 债务预算 | `node scripts/check-debt-budget.js` | filesOver500 计数不变（HotTopics.vue 已在基线内） |
| CI | GitHub Actions `quality-gate.yml` | 见 PR |
