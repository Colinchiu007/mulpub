---
record: s2v-result-model-info
task: 视频创作·历史记录·任务详情页视频信息区展示本次生成的模型信息（文本/语音/图片/视频）
date: 2026-10-18
---

## 本次执行记录：历史记录任务详情页模型信息展示（s2v-result-model-info，2026-10-18）

> 分支：`s2v-result-model-info`；worktree：`D:/Data/projects/mp-worktrees/mp-s2v-result-model-info`（由 `scripts/start-mp-task.ps1 -TaskName s2v-result-model-info` 创建）；基线 = `origin/main`（worktree 建后实测对齐）
> 范围：🎨 UI/UX（渲染端 `ResultView.vue`）+ 🔧 主进程服务（`story2video-stages.js` meta 透传）+ 🧪 回归测试 + 📝 PRD/CHANGELOG
> 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **docs-only=false**（含 `apps/desktop/**` 代码）⇒ 不走 docs-only 快速通道，按完整质量节拍执行日常循环 ⓪→⑦

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 动手前实测共享根 `git rev-parse --abbrev-ref HEAD` = `main` 且 `git status --porcelain` = 0 行，才建 worktree；建后按实证口径核对：`git worktree list` 列出该路径 + `rev-parse --abbrev-ref HEAD` = `s2v-result-model-info`。`pre-code-edit-guard.ps1` 在 worktree 内 EXIT=0。依赖 `pnpm install --frozen-lockfile` + `ensure-electron.js`（v43.7.7）+ `verify-worktree-deps.js` OK（11 个 `@multi-publish/*` 全部解析到本 worktree） |
| 上下文与根因（Step ①） | PASS | 不是"照着需求摆四个字段"。先逐段核实**模型信息是否已落盘**：语音/图片/视频三类在 `project.options`（`_safeOptions` 白名单）与 `segments[].*Meta`（provider 实际返回）都有；**文本模型没有**——`story2video-stages.js` 的 `pairedScenes` 构造处不携带 `promptOptimizationMeta`，`Story2VideoProjectService._persistComposeArtifacts:949` 虽已定义该白名单字段却从不被填值。据此把「补文本模型落盘」列为需求成立的前置条件，而非交付 3/4 的残缺功能 |
| 测试先行（Step ② / QM-3） | PASS | `ResultView.test.js` 新增「模型信息展示」**17 例先红**（首跑 16 failed / 1 passed，那 1 条是"四项全空"——恰证零视觉回归契约）；`story2video-stages.test.js` 新增 **6 例**。红因经原始输出核对为 `modelsText(w)` 返回 `null`（`data-testid="video-models"` 尚不存在）与 `modelSummaryText` 为 `undefined`，不是夹具自坏 |
| 实现（Step ③） | PASS | 渲染端：模板把「格式」与模型摘要并入同一个 `<p data-testid="video-format-models">`（天然同行，容器不足时浏览器自然折行，无需 JS 测宽或 CSS 断点）；`modelSummaryParts`/`modelSummaryText` 两个 computed。主进程：`generate_assets` 增加 `PROMPT_OPTIMIZATION_META_KEYS` 白名单 + `promptOptimizationMetaOf(i)`，挂到 scene；service 侧**零改动**（既有 `safePromptOptimizationMeta` 即收口） |
| 取值口径的裁决 | PASS | 两条易错口径在实现里显式定死并有测试锁：① **segments meta 优先于 options**（provider 真实执行 > 用户提交意图，多模态 provider 内部路由到别的模型时两者会不一致）；② **model 优先于 provider**（用户问的是"用了什么模型"），provider 仅在 model 缺失时兜底。反向边界：segments 有 provider 而 options 有 model 时，仍取 segments 的 provider |
| 视频模型门控 | PASS | 需求原文「如果使用了视频模型则显示，没有则不显示」实现为**双重门控**：`videoMode` 仅 `fixed`/`ai-judged` 视为启用（与 `pipeline-model-preflight.js` 的 video 能力需求判定同源），且解析值非空。只按 `videoProvider` 有无判断会把「用户曾选过 provider 后又把 mode 切回 off」误显示成启用 |
| 审查（Step ④） | PASS | 无新增依赖、无 `console.log`、无 `waitForTimeout`、无 `v-html`。所有读取路径对 `null`/非对象/非数组/空白串防御（`project`/`options`/`segments`/`*Meta` 五层）。i18n：`create.story2video.modelInfo.{textModel,voiceModel,imageModel,videoModel}` zh/en 成对，`ResultView.vue` 无新增中文字面量。IPC 序列化：未新增 IPC，只读既有 `story2video:get-project` 返回值 |
| QM-1 打包 | ➖ N/A | 虽触 `apps/desktop/electron/services/story2video-stages.js`，但该文件属 `electron/services/`（非 `electron/` 主进程入口/preload/IPC handler 层），未改 `electron/main.js`/preload/`ipc-handlers/**`。仍以完整单测套件（160 passed）覆盖；本地不冒充跑 electron-builder |
| QM-4 视觉回归 | PASS（附失明声明） | 本机不跑像素门禁（缺 dev server），证据责任点名交 CI `QG Visual`。零视觉回归有**行为级**依据：四项全空时 `data-testid="video-models"` 不渲染、`video-format-models` 文本恰为「格式: MP4」（用例断言 `toBe("格式: MP4")`），即页面 DOM 与改动前同形。新增文本只可能让该行变长，由 `.video-info` 既有 `overflow-wrap` 与容器自然折行兜住 |
| 验证范围取消费者并集 | PASS | `git grep -l "story2video-stages\|ResultView"` 取并集后全跑：`ResultView.test.js` **132 passed**、`story2video-stages.test.js` **160 passed**、`story2video-project-service.test.js` **119 passed**、`element-plus.test.js` **7 passed**（产物级契约锁：本次未新增 element-plus 组件，仍实跑核对未破坏闭包） |
| 本地门禁 | PASS | `check-no-brand-residue.js`（tracked 全量）；`check-locale-sync.js`（zh/en 键集合）；`check-unwired-tests.js`（新断言加在已收编的两个测试文件，未新增测试文件）；`check-gate-record-debt.js`（本记录以 frontmatter 登记，不动 ledger） |
| 远程同步 | 由门禁推导 | 合并后由主干历史推导，不手写状态词（`gate-record-sync-derived-status` 口径） |

### 测试覆盖矩阵（Completeness 自评）

| 维度 | 覆盖 |
|---|---|
| 正常路径 | 四项齐备顺序渲染、与「格式」同行、`videoMode=fixed` 显示视频模型 |
| 门控边界 | `off` / 缺省 / 启用但 provider+model 均空 ⇒ 三种形态都不渲染视频模型项 |
| 优先级 | segments meta > options model > options provider；segments provider > options model |
| 回退 | model 缺失回退 provider；无 `promptOptimizationMeta` 不渲染文本模型项 |
| 脏数据 | `segments: null`、`options: 'not-an-object'`、空白串 model/provider、`model_used='template'` |
| 空态 | 四项全空 ⇒ 无分隔符、无空壳、DOM 与改动前同形 |
| 响应式 | 无 project ⇒ 整条不渲染；项目对象更新 ⇒ computed 重算 |
| 主进程透传 | 白名单收窄、fail-open、`{results}` 包装、template 降级如实呈现 |
| 不变量 | 摘要不含连续分隔符、不以分隔符开头/结尾、无「标签: 」空值 |

**评分**：正常 3/3 + 边界 2/2 + 异常 2/2 + 幂等 1/1 = 8/10（−2：无真实 Electron 窗口内的端到端人工核对记录在本仓，交 CI/用户验收）。

### 遗留（不假装已闭合）

- **老项目看不到文本模型，这是有意行为不是缺陷**。本期只补「新任务落盘」，不做历史数据回填（那需要重跑 optimize 或从 run context 反推，成本与语义都超出本需求）。PRD §3.1.3 与 CHANGELOG 已明写；若后续要回填，正确入口是 `run.context.optimize` 里仍存在的 entries，须另立切片并先定义"回填是否算重新生成"的幂等判据。
- **`optimize` 结果含 `null` 的崩溃是同函数里的既有缺陷，本期顺手修了但未做全仓同族扫描**。修的是 `story2video-stages.js` 两处（`pairedScenes` 的 `optimizedPrompts` 映射、`generateOneImage` 的 `promptText`）。同族模式（`typeof x === 'string' ? x : x.prompt`）在 `story2video-project-service.js` 的 `extractImageOptimizedPrompt` 等处是否也有，未逐处核对——那属于独立的健壮性切片。
- **模型信息是静态展示，无点击交互**。「跳转到模型设置」「用当前模型重跑」等交互是独立需求，本期明确不做（PRD §2.2）。
- **QM-6 双模型外部评审未跑**：本变更净增约 570 行、跨渲染端 + 主进程服务两层，规模上已接近 M+。判定为不触发的理由是「无逻辑分支新增」（主进程侧只加白名单透传 + 两处 null 防御，渲染端是纯 computed 派生），风险面集中在取值优先级而非控制流。该判定属 agent 自查，非机械闸门——若评审认为跨层数据契约变更应强制双模型，本条的「不触发」结论应被推翻。
