# Tasks — hot-topics-pipeline-picker

## 1. 规格与文档（先文档再代码）

- [x] `openspec/changes/hot-topics-pipeline-picker/`：proposal / design / spec delta / tasks
- [x] `01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md`：新增 §3.13（选择器完整规格）+ 同步 §3.10 / §5.6 / §6.6 / §7.1 / §8 / §9
- [x] `01-docs/PRD-HOT-TOPICS-MULTI-SOURCE-AI-CATEGORY-2026-10-12.md`：行内操作按钮清单补下箭头入口
- [x] `01-docs/PRD-VIDEO-PIPELINE-PROGRESS-MODAL-2026-10-17.md`：弹窗显示项补「流水线：{名称}」与动态阶段
- [x] `01-docs/DESIGN.md`：行内按钮组 + 下拉菜单视觉/交互契约（含空间自适应/滚动关闭）
- [x] `01-docs/i18n-glossary.md`：登记 10 个术语
- [x] `CHANGELOG.md` 未发布段
- [x] `openspec/records/hot-topics-pipeline-picker.md`（门禁证据表，远程同步先 PENDING）

## 2. TDD：先写失败测试

- [x] `features/hot-topics/gen-video-pipelines.test.js`：运行模式分类（S2V / 文本驱动 / 媒体 / 专属 / 内部 / 未实现 / 未知）、可执行判定、禁用原因 key、阶段名、选项排序与去重/非法条目、默认徽标、启动参数两分支（11 例）
- [x] `features/hot-topics/gen-video-stage-tracking.test.js`：动态阶段创建/回退、首阶段 running/failed、重试复位、完成归一、终态归并、取消（6 例）
- [x] `features/hot-topics/gen-video-view-model.test.js`：标题截断、流水线标识、摘要、门控、进度公式（6 例）
- [x] `features/hot-topics/gen-video-picker-state.test.js`：单例 uid、展开方向与高度压缩（6 例）
- [x] `features/pipeline/run-context-video-path.test.js`：publish/compose/export/render/report 与 `{data}` 包裹、缺失返回 null（5 例）
- [x] `components/HotTopicsGenVideoPicker.test.js`：按钮组渲染/aria/busy、首开懒加载与缓存、全部流水线列出与禁用原因、选中 emit、禁用项不 emit、外点/Esc/箭头键、滚动关闭、加载失败回退+重试、空清单（13 例）
- [x] `views/HotTopics.test.js`：每行下箭头存在、打开后选择 `animated-explainer` 启动并生成动态阶段、弹窗显示流水线标识、主按钮仍默认 S2V、禁用项点击无副作用、清单失败回退、非 S2V 成片从 `context.render` 提取并解锁出口、run-only 发布只带 video_path（7 例）
- [x] `views/HotTopics.test.js`（收藏）：收藏行下箭头存在、选择流水线启动（1 例）
- [x] RED 取证：先跑新增测试记录失败数（HotTopics 7 failed / 49 passed；Picker 整包导入失败），再实现转 GREEN（97/97）

## 3. 实现

- [x] `features/hot-topics/gen-video-pipelines.js`（纯函数）
- [x] `features/hot-topics/gen-video-stage-tracking.js`（纯函数；为守住 500 行红线从 composable 拆出）
- [x] `features/hot-topics/gen-video-view-model.js`（纯函数；同上）
- [x] `features/hot-topics/gen-video-picker-state.js`（跨实例单面板 + 展开方向/高度纯函数）
- [x] `features/pipeline/run-context-video-path.js`（共享成片提取）
- [x] `components/HotTopicsGenVideoPicker.vue`（按钮组 + 菜单 + 加载/错误/空/回退 + 键盘/外点/滚动关闭/单面板/翻转压缩）
- [x] `composables/useHotTopicsGenVideo.js`：`startGenerateVideo(topic, pipelineName)`、动态阶段/进度、按流水线构造参数、终态提取共享函数、`genVideoPipelineName/Label`
- [x] `views/HotTopics.vue`：行内接入组件、弹窗流水线标识、`defineExpose` 新状态
- [x] `components/HotTopicsFavorites.vue`：行内接入组件（emit 带 pipelineName；损坏条目两组按钮禁用）
- [x] `views/CreateView.vue`：`extractOrchestrationVideoPath` 委托共享纯函数
- [x] `locales/hot-topics/{zh,en}.js`：成对新增 16 个文案 + `genVideoStartToast` 通用化

## 4. 回归与质量门禁

- [x] 新增/受影响测试全绿（HotTopics 56 + Picker 13 + 纯函数 28 = 97/97；CreateView 296/296）
- [x] `eslint`（apps/desktop，`--quiet`）rc=0
- [x] `check-locale-sync.js`（`--keys` / `--pair-base origin/main` / `--cjk`）全 PASS
- [x] `check-debt-budget.js`、`check-color-literals.js`、`check-css-var-defined.js`、`check-font-size-scale.js`、`check-frontend-consistency.js`、`check-vue-style-parse.js`、`check-unwired-tests.js`、`check-no-brand-residue.js` 全 PASS
- [x] `check-max-lines.js`：首版 composable 559 行触发 `NEW_OVER_LIMIT` → 拆纯函数模块后 494 行；干净扫描 PASS（打包后两个 gitignored preload bundle 会被扫描到，已 `git check-ignore` 证明并在干净状态复跑）
- [x] QM-1：`pnpm run build:dir` rc=0；asar 含 `\dist\index.html` 与 HotTopics chunk（含 picker testid）；启动 8s 存活、stderr 0 字节、无红线 → PASS（子进程剔除 `ELECTRON_RUN_AS_NODE`，父环境带该变量已告警）
- [x] QM-4：真实 dev 实例截图取证（14 项全列出、默认徽标、禁用原因、翻转压缩后不裁切）；hot-topics 不在像素套件 → 已登记盲区
- [x] 变异反证：把「选择流水线」改回写死 `story2video-compose` → 新用例变红（见记录 §4）；恢复后全绿
- [x] 行尾两口径对账、品牌残留扫描、doc-gate（提交后取证数值见记录）

## 5. 交付

- [x] 内置记忆（`~/.dsh/profiles/memory-hot-topics-pipeline-picker.md`）
- [x] 外部记忆（`01-docs/learnings.md` 追加条目）
- [x] EverOS 记忆（`/api/v1/memory/add` + `/flush`，app=multi-publish / project=default；status=extracted）
- [ ] commit → push → PR → CI 全绿 → squash 自动合并（`gh pr merge --squash --delete-branch`）
- [ ] 合并后回填 `openspec/records/hot-topics-pipeline-picker.md`（远程同步 PASS + merge SHA）并合并回填 PR
- [ ] worktree 按 `scripts/safe-worktree-remove.ps1` R1-R7 清理
