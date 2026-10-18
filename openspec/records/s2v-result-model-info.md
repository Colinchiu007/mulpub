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
| 实现（Step ③） | PASS | 渲染端：模板把「格式」与模型摘要并入同一个 `<p data-testid="video-format-models">`（天然同行，容器不足时浏览器自然折行，无需 JS 测宽或 CSS 断点）。主进程：`generate_assets` 挂 `promptOptimizationMeta` 到 scene；service 侧**零改动**（既有 `safePromptOptimizationMeta` 即收口） |
| 取值口径的裁决 | PASS | 三条易错口径在实现里显式定死并有测试锁：① **segments meta 优先于 options**（provider 真实执行 > 用户提交意图，多模态 provider 内部路由到别的模型时两者会不一致）——首轮实现漏了"segments 的 provider 也要优先于 options 的 model"，被用例当场抓住后修正；② **model 优先于 provider**（用户问的是"用了什么模型"），provider 仅在 model 缺失时兜底；③ `segments` 非数组按 `[]` 处理而**不是**把 options 一并作废（首轮断言写错，修正后锁住正确语义） |
| 视频模型门控 | PASS | 需求原文「如果使用了视频模型则显示，没有则不显示」实现为**双重门控**：`videoMode` 仅 `fixed`/`ai-judged` 视为启用（与 `pipeline-model-preflight.js` 的 video 能力需求判定同源），且解析值非空。只按 `videoProvider` 有无判断会把「用户曾选过 provider 后又把 mode 切回 off」误显示成启用 |
| 债务门禁与结构性拆分 | PASS | 首轮 CI `债务熔断检查` 红 4 条：`TARGET_GREW` ×2（`story2video-stages.js` 超 32、`ResultView.vue` 超 63）+ `TEST_LEDGER_GREW` ×2（两个测试文件各超容差 207/245 行）。按仓内同族先例（`podcast-publish-entry` / `publish-add-account-entry`）的口径**结构性拆分而不是上调 targets**：渲染进 `views/video-creation/ResultModelInfoRow.vue`、取值口径进 `views/video-creation/composables/useResultModelInfo.js`（纯函数、无 Vue 依赖）、主进程白名单进 `electron/services/story2video-prompt-meta.js`；测试按被测模块分文件。末态 `check-max-lines.js` rc=0，四个点名/挂账文件全部回到目标内。顺带收益：24 例里 21 例不需要 `mount` |
| 审查（Step ④） | PASS | 无新增依赖、无 `console.log`、无 `waitForTimeout`、无 `v-html`。所有读取路径对 `null`/非对象/非数组/空白串防御（`project`/`options`/`segments`/`*Meta` 五层）。i18n：`create.story2video.modelInfo.{textModel,voiceModel,imageModel,videoModel}` zh/en 成对，`ResultView.vue` 无新增中文字面量。IPC 序列化：未新增 IPC，只读既有 `story2video:get-project` 返回值 |
| QM-1 打包 | ➖ N/A | 虽触 `apps/desktop/electron/services/story2video-stages.js`，但该文件属 `electron/services/`（非 `electron/` 主进程入口/preload/IPC handler 层），未改 `electron/main.js`/preload/`ipc-handlers/**`。仍以完整单测套件（160 passed）覆盖；本地不冒充跑 electron-builder |
| QM-4 视觉回归 | PASS（附失明声明） | 本机不跑像素门禁（缺 dev server），证据责任点名交 CI `QG Visual`。零视觉回归有**行为级**依据：四项全空时 `data-testid="video-models"` 不渲染、`video-format-models` 文本恰为「格式: MP4」（用例断言 `toBe("格式: MP4")`），即页面 DOM 与改动前同形。新增文本只可能让该行变长，由 `.video-info` 既有 `overflow-wrap` 与容器自然折行兜住 |
| 验证范围取消费者并集 | PASS | `git grep -l "story2video-stages\|ResultView"` 取并集后全跑：`ResultView.test.js` **132 passed**、`ResultView.model-info.test.js` **24 passed**、`story2video-stages.test.js` **160 passed**、`story2video-prompt-meta.test.js` **17 passed**、`story2video-project-service.test.js` **119 passed**、`element-plus.test.js` **7 passed** ⇒ 合计 **436 passed / 0 failed** |
| 本地门禁 | PASS | `check-max-lines.js` rc=0；`check-no-brand-residue.js` PASS（10282 个 tracked 文件）；`check-locale-sync.js --keys` PASS（2123 个使用中 key）；eslint 相关文件 **0 errors**（5 个 warning 经 stash 前后 A/B 核为既有，非本次引入） |
| 远程同步 | 由门禁推导 | 合并后由主干历史推导，不手写状态词（`gate-record-sync-derived-status` 口径） |
| QM-6 CCG 双模型评审 | ⚠️ **未跑成（环境故障，如实记录）** | pre-commit 判定 `DUAL`（变更 570 行 > 200 行阈值）⇒ 应跑 `deep-review.sh` + `plan-review.sh`。两次实跑**均因评审后端超时失败**：`spawnSync C:/Users/邱领/.claude/bin/codeagent-wrapper.exe ETIMEDOUT`（deep-review 轮 1/3、plan-review 轮 1/3）。`--check-deps` 体检通过（claude / opencode 均解析到）、`--dry-run` 能完整预览判定与引擎配置 ⇒ **不是配置问题，是 wrapper 进程启动超时**。另修掉一个本机路径转换问题（`$HOME` 的 POSIX 路径被 MSYS 转成 `D:\c\...`，需显式传 `CCG_ARL_DIR` Windows 路径 + `MSYS_NO_PATHCONV=1`）。**结论：双模型外部评审这条门禁本次未取得读数，不冒充通过**；它是本地把关环节、不阻断 CI，但按「把工具的失明读成结论是同型错误」的口径，此处记为未闭合项 |

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
- **QM-6 双模型外部评审两次实跑均因后端超时失败，未取得读数**（详见门禁表该行）。pre-commit 的机械判定是 `DUAL`（570 行 > 200 行阈值），所以这不是"判定为不触发"，而是"触发了但没跑成"。引擎体检与 dry-run 都正常，失败点在 `codeagent-wrapper.exe` 的 `spawnSync` 超时。**未闭合**：需在 wrapper 稳定的环境里补跑 `deep-review.sh` 与 `plan-review.sh`（方案文档已就位：`.hermes/plans/s2v-result-model-info.md`）。在本条闭合前，本次变更的"第二双眼睛"实际缺失，风险面集中在取值优先级与门控判据——这两处已由 41 条单测覆盖，但单测覆盖不等于跨家族对抗评审。
