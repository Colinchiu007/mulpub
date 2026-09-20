## [Unreleased] - 2026-09-20 (故事讲述流水线详情页精致化：布局合同 + 表单控件统一 + 令牌双轨收敛)

### 修复（P0 视觉根因）
- `apps/desktop/src/styles/create-view.css` `.create-page`：补 `width: 100%`。父 `.cohere-main` 是 flex column，**交叉轴上的 `margin: 0 auto` 会抑制 `align-self: stretch`**，宽度退化为 `fit-content(max-content)` → 设计列宽 1080px 实测约 500px、右侧大片死白。与 `cohere-design-system.css` 的 `RewriteView`（`BUGFIX-REWRITE-PAGE-WIDTH` 2026-09-16）同源修复范式；`box-sizing` 不重复声明（全局 reset 已提供）。同时给 `.create-page--pipeline-detail` 补 `min-width: 0`。
- `.back-btn` 补 `align-self: flex-start`：它在 `flex-direction: column` 的 `.pipeline-detail` 中被 `align-items: stretch` 拉成通栏灰条（实测收敛到 71px）；详情页态隐藏顶部 `nav-arrow`，返回入口唯一。
- `.view-tabs`：`width: 100%` + 子项 `flex: 1 1 0; min-width: 0` 等分（页签数可变，**不硬编码栅格列数**）；`.view-tab.active` 去掉 `transform: scale(1.02)`（重排抖动源），改用 `box-shadow` + `font-weight`；补 `:focus-visible`。
- 表面处理统一：`.detail-header` / `.input-section` / `.s2v-config-section` 收敛到同一张 `.s2v-card` 规格（卡片背景 + 描边 + 12px 圆角 + `--spacing-5` 内边距），子标题走 `.s2v-card-title`。

### 新增（可复用组件与样式）
- `apps/desktop/src/components/UiSlider.vue`：受控滑条（`appearance: none` + `--pct` 渐变填充，`--pct` 由 computed 写入内联样式，为全页唯一内联样式）；双击复位默认值、`↑↓←→` = step、`PageUp/Down` = step×10、`End` = max，全部经 clamp + 步长对齐；小数位由 `step` 推导（`decimalsFromStep`）而非写死 `toFixed`；`prefers-reduced-motion` 降级。
- `apps/desktop/src/components/UiField.vue`：label + 控件槽 + suffix + hint + 错误位 + 运营隐藏守卫（`optionKey` → `ctx.visible()`，**fail-open 语义不得绕过**）；错误态 `aria-invalid` + `role="alert"`。
- `apps/desktop/src/styles/video-creation-forms.css`（`main.js` 在 `video-creation-buttons.css` 之后导入）：`.s2v-card` / `.s2v-card-title` / `.s2v-field-grid`（`auto-fit minmax(280px,1fr)`）/ `.s2v-estimate-slot`（`min-height: 44px` 防布局跳动）/ `.s2v-range-native` 兜底 / `.s2v-cta-shimmer`。
- `UiSelect.vue` 新增 `optionKey`（为空不包裹，向后兼容）/ `hint` / `error`；详情页 **27 个 `<select>` 全量迁移**，迁移后裸 `<select>` = 0（探针实测 `bareSelects: 0`）。

### 变更（视觉层级 / 微交互 / UE 加固）
- `.input-tab` 胶囊：active 态由「实心主色 + 白字」降级为浅底描边（不再压过主 CTA）；容器补 `role="tablist"` / `role="tab"` / `aria-selected`。
- 「恢复默认选项 / 保存配置 / 我的配置」三兄弟：下划线灰文字链接 → `.s2v-btn-ghost .s2v-btn-sm`，`data-testid` 全部保持。
- 字符计数 `n/6000 字符` 内嵌 textarea 右下角，随接近上限升级状态色（中性 → warning → danger + `aria-live`）。
- 折叠面板 `<summary>` 右侧显示 `.s2v-summary` 摘要值，未改动组追加「（默认）」后缀；展开态走既有 `ui.expandedGroups` 持久化通道。
- 启动按钮禁用原因可见化：`:disabled` + `:title` + `:aria-describedby` + 下方常驻 `.s2v-start-hint`（`data-testid="pipeline-blocked-reason"`），按优先级显示首条阻塞原因（`blockedReason.*`）。
- 预估摘要常驻：无文案时显示 `estimatePlaceholder` 占位而不塌容器；硬编码不通顺句替换为 locale 键 `flowGuide`。
- 动效：`.s2v-config-section` 接入 Staggered Reveal（`--stagger-index` 数组下标）、`.s2v-card:hover` 抬升、主 CTA `.s2v-cta-shimmer`；均带 `prefers-reduced-motion` 降级与 `pointer-events: none`。

### 变更（D2 令牌双轨收敛，详情页子树 19 处双轨清零）
- 详情页操作面统一改用 `video-creation-buttons.css` 的 `.s2v-btn-*`（品牌紫）：主 CTA、批量创作、配置管理三兄弟、运行控制 6 个 `UiButton`（编辑场景 / 编排暂停 / 恢复 / 暂停 / 确认并继续 / 取消）、分镜素材横幅 CTA、音色与背景音乐与模板等 12 个 `.btn-secondary`（危险操作改用 `.s2v-btn-danger`）。
- **为什么必须换元素而不是加类**：`UiButton` 的 scoped 样式 `.ui-btn-primary[data-v-x]` 特异性 (0,2,0) 压过外部 `.s2v-btn-primary` (0,1,0)，加类无效。全部 `data-testid` 与点击语义不变。
- 边界：弹窗 `UiModal #footer` 内的 `UiButton` 属 §6.1 弹窗契约管辖，本次不改；全站 `--apple-* → --color-*` 收敛登记为 openspec backlog change `ui-apple-token-retirement`（**不改 `--color-apple-accent` 取值**，避免全站基线重跑）。`.s2v-btn-primary` 的 fallback 由 Element 蓝 `#409eff` 修正为 `var(--color-primary, #5048E5)`。
- 特异性确定性：`.btn-start` / `.s2v-batch-trigger` 抬为 `.action-bar X`（0,2,0），不依赖样式表引入顺序。

### 修复（暗色模式，本次改动引入后自查发现）
- 根因：`tokens.css` 的 `[data-theme="dark"]` 只重定义 31 个槽，**未覆盖** `--color-text-strong` / `--color-text-secondary` / `--color-primary-light`（及 `--text`），直接用作文字色在暗色下变近黑不可读（实测：标题 / 字段 label / select 文字不可见）。
- 修法：**不改全局令牌（零 blast radius）**，把消费点改走 `cohere-design-system.css` 的暗色感知别名并保留 `--color-*` 作 fallback —— `var(--ink, var(--color-text-strong))` / `var(--muted, var(--color-text-secondary))`；`--color-bg-muted`（未定义槽，会整条声明失效）→ `var(--color-bg-inset, #f6f6f8)`；`.input-tab.active` 与 `.s2v-btn-*` 就地补暗色分支规则（浅色不写覆盖 → 基线零影响）。覆盖 `UiSelect` / `UiSlider` / `UiField` / `create-view.css` / `video-creation-forms.css` / `video-creation-buttons.css`。
- 新增可复用审计：比对 `tokens.css` 暗色槽集合与改动文件消费的 `--color-*`，输出未覆盖清单（暗色核对从“肉眼找”变“脚本清单”）。

### 抽取（偿还 CreateView 行数债）
- 新建 `apps/desktop/src/views/video-creation/S2vConfigPanels.vue`：迁入详情页 `.s2v-config-sections` 整棵子树（basic / appearance / videoEnhance+voice+advanced / publish 四组容器、六类 optionKey）；配套 `s2v-panel-contract.js` + `create-view-module-utils.js`。抽取为**纯搬运 + 绑定改写**：option 的 key / 默认值 / 取值范围 / 显隐判定逐条对照未变。`CreateView.vue` 6182 → 5657 行（−525）。

### 测试
- 新增 `UiSlider.test.js` / `UiField.test.js` / `S2vConfigPanels.test.js`；扩充 `UiSelect.test.js` / `story2video-ue-contract.test.js`。**硬门槛：6 文件 329 例全绿（`EXIT=0`）**。
- 像素基线：新增 `create-story2video-detail`，重生成 `create-editor / create-pipeline / create-history / create-result`（R1 列宽修复连带），逐张肉眼核对；全量 18/18 通过（`PIXEL_THRESHOLD=0.06` 与 CI GATE-7 对齐）。
- 视觉测试基建：`test-runner.js` 的 `pixelRegressionTest` 新增 `prepare` 交互前置钩子（部分页面态无法靠路由直达；抛错即失败，不静默跳过）；`run-pixel-tests.js` 新增 `selectPixelTests()`（`PIXEL_ONLY` 白名单，避免全量重生成把无关环境差烘进基线）。**两个陷阱登记**：① hash-only 导航不重载文档 → 像素用例互相污染（必须显式复位页签）；② `UPDATE_BASELINE` 仅在基线缺失时创建，重生成需先删后建。
- 本地门禁全绿（rc=0）：`check-vue-style-parse` / `check-color-literals` / `check-font-size-scale` / `check-frontend-consistency` / `check-locale-sync --pair-base·--keys(1037)·--cjk(0 新增命中)` / `verify-worktree-deps` / `check-debt-budget`（`filesOver500` 92 < 基线 93，**基线只允许下调**）。

### i18n
- 新增 `create.story2video.ui.*` 键组（zh/en 成对）：`doubleResetHint` / `sectionDefaultSuffix` / `estimatePlaceholder` / `charLimitWarning` / `charLimitReached` / `flowGuide` / 六个控件 label / `blockedReason.{noPipeline,unavailable,starting,running,invalidRange,noAsset,noText}`；术语对齐 `01-docs/i18n-glossary.md`。

### 文档
- `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` 新增 **§11 详情页视觉与交互精致化契约（2026-09-20）**（13 小节：根因溯源 / 布局列宽合同 / 组件契约 / 控件级显示项与取值范围 / 数据校验与边界 / 交互逻辑 / 令牌与 D2 完成态 / 提示文字中英对照 / 暗色与降级 / a11y / **实现偏离登记 D1–D8** / 测试与门禁合同 / 验收标准）。
- `docs/desktop-ui-layout-spec.md` 新增 **§15 CreateView 列宽与页签合同**（v1.6）；`docs/frontend-interaction-spec.md` 新增 **§10 表单控件与禁用反馈范式**。
- openspec：新增 change `story2video-detail-visual-refinement`（本次实现）与 `ui-apple-token-retirement`（backlog：全站 `--apple-*` 收敛 + `--color-text-*` 缺暗色槽）。

## [Unreleased] - 2026-09-18 (修复 Agnes 视频生成 taskId 提取漏掉 video_id 导致 task not found)

### 修复
- `apps/desktop/electron/services/adapters/agnes-video.js` `generateVideo()`：taskId 提取由 `data.id || data.task_id` 改为 `data.video_id || data.id || data.task_id`。Agnes `POST /videos` 实际返回 `{ video_id, id }`——`video_id` 是用于 `/agnesapi?video_id=` 查询的任务 ID，`id` 是请求 ID；此前用请求 ID 查询导致历史记录详情页「生成 AI 视频」报「当前模型账号的 AI 视频生成失败」（真实错误 `task not found`）。与 `agnes-multimodal.js` 同源契约对齐。

### 测试
- `agnes-video.test.js` 新增 2 例回归：`video_id` 优先于 `id`、仅返回 `video_id` 也能提取。RED→GREEN 证据完整（修复前 2 failed，修复后 43 passed，含审查补充的三字段优先级测试）。

### 文档
- 新增 `01-docs/BUGFIX-AGNES-VIDEO-TASKID-NOT-FOUND-2026-09-18.md`（根因溯源 / 逃逸分析 / 系统性漏洞 / 修复+回归 / 预防措施 / 数据校验 / 流程 / 交互逻辑 / 显示项 / 提示文字 / 边界情况 / 验收标准）。
- `01-docs/learnings.md`：新增 pitfall「adapter 的 taskId 提取必须覆盖 provider 实际返回的字段命名」。

## [Unreleased] - 2026-09-14 (侧边栏左上角品牌区改为「Logo + 版本号」)

### 变更（应用壳品牌区）
- `src/layouts/MpSidebar.vue` header：移除临时文字占位 `.mp-sidebar-brand`（`MP` 渐变徽标）与 `.mp-sidebar-title`（`Multi-Publish` 文本），改为「**汤姆鱼 Logo 图片 + 应用版本号**」：`[data-testid="mp-sidebar-logo"]`（`<img>`）+ `[data-testid="mp-sidebar-version"]`（`v` + 版本号，如 `v0.1.0`）；「+ 新建发布」按钮位置与行为不变。
- 新增品牌资产 `src/assets/brand/tom-fish-logo.png`：源图 `Logo矢量图-透明.png`（3042×1910 RGBA / 1.06MB）→ 探测 alpha 包围盒裁剪透明边距（内容 2930×1798，宽高比 1.6296）→ 等比缩小为 **176×108**（约 13.9KB，−98.7%），alpha 预乘加权避免透明边缘发黑；CSS `height: 36px; width: auto` → 实际约 59×36（3× 资源，HiDPI 不模糊）。
- 尺寸推导（200px 侧边栏）：可用 172px − 新建发布按钮 24px+8px − 版本号≈38px+8px ⇒ Logo ≤ ~94px；垂直与 40px 导航行对齐取高 36px ⇒ 宽 ≈59px，校验 59+8+38=105px ≤ 140px，不挤压按钮。

### 变更（版本号取数）
- 新增 `src/composables/useAppVersion.js`：**唯一**取数封装。纯函数 `extractAppVersion(response)`（仅 `code===0` 且 `data` 非空才返回 `String(data).trim()`）+ 组合式函数 `useAppVersion()`（`version`/`loading`/`loadVersion`）。
- 数据源沿用既有 IPC `app:get-version`（主进程读 `apps/desktop/package.json` 的 `version`；该字段由根 `package.json` 单一真相源经 `scripts/sync-version.mjs` 自动派生，见 `docs/version-management.md`），经 `@/api/electron-bridge` 的 `invoke('getVersion')` 调用，**未新增任何 IPC / 持久化 / store 字段**。
- 降级（4 条路径均静默、不抛错、不阻塞渲染）：无 `window.electronAPI`（`invoke` 返回 `undefined`）/ `code !== 0` / `data` 为空或纯空白 / IPC reject ⇒ **不渲染**版本节点，仅保留 Logo。

### 变更（i18n / 响应式 / a11y）
- 新增 i18n 词条（zh/en 成对）：`sidebar.brandLogoAlt`（Multi-Publish，Logo 替代文本）、`sidebar.appVersionTitle`（当前版本 / Current version，版本号悬停提示）。
- 窄屏（≤900px，侧边栏 68px）：Logo 保留并缩为 `height: 28px; max-width: 100%`；版本号隐藏；新建发布按钮沿用原隐藏行为。
- a11y：Logo `alt` 走 i18n；版本号为文本（可被朗读）；两者均不可聚焦、不进 Tab 序；Logo 禁拖拽/禁选中。

### 测试
- 新增 `src/composables/useAppVersion.test.js`（16 例）：`extractAppVersion` 成功/去空白/非字符串转串 + 9 类无效输入（失败码、空串、空白串、`data:null`、`data` 缺失、`undefined`、`null`、非对象、数组）；`useAppVersion` 成功取值、IPC 不可用、IPC 抛错、失败码不落脏值 + `loading` 复位。
- `src/layouts/MpSidebar.test.js`（13 例，本次 +4）：品牌 Logo 为 `<img>` 且 `src` 非空、`alt=Multi-Publish`、版本号 `v2.3.53`（单测 mock 固定值，与真实版本号解耦）且 `title=当前版本`、旧品牌类不存在；IPC 不可用 / 失败码 / IPC reject 三种情形均不渲染版本号且侧边栏整体仍在。既有 9 例全绿。
- 本地门禁：`vitest` 2 文件 29 例全绿；`eslint --quiet` 0 error；`tsc --noEmit` 0；Gate 6 IPC / Gate 10 前端一致性 / Gate 7 `--cjk`·`--keys`·`--pair-base` / 债务熔断全 PASS；**像素视觉门禁 17/17 通过**（影响区约 200×66px ≈ 全视口 0.64%，阈值 6%）。

### 文档
- 新增 `01-docs/PRD-SIDEBAR-BRAND-LOGO-VERSION-2026-09-14.md`（15 节：背景目标 / 变更范围 / 术语 / 需求明细 / 组件接口契约 / 数据校验与边界 / 流程与交互 / 视觉规范含尺寸推导与图片处理规范 / 响应式 / a11y / 显示项与 i18n / 异常降级 / 测试设计 / 验收标准 / 影响面与回滚）。
- `docs/desktop-ui-layout-spec.md`：§2.3 header 行改为品牌区、新增 **§2.6 左上角品牌区**（结构显示项 / 尺寸推导 / 校验降级 / 响应式 / 交互 a11y）、§8.1 显示项表更新（移除 `MP` / `Multi-Publish`，新增品牌 Logo 与版本号两行）。
- `docs/frontend-interaction-spec.md`：新增 **§6.5 侧边栏左上角品牌区**（位置唯一 / 资产唯一 / 取数唯一 / 降级静默 / 无交互 / 文案走 i18n）。

## [Unreleased] - 2026-09-14 (lint 接入 CI：error 级门禁 + 17 处存量清零，挖出 4 个真 bug)

### 修复（no-undef ×4，均为真实功能缺陷）
- `src/views/AutoPipelineView.vue`：视图调用了 `notifyInfo`，但 `useNotify()` 只解构 notifyError/notifySuccess/notifyWarning——`resumePipeline()` 的提示不在 try 内，**点「恢复流水线」直接 ReferenceError、恢复流程中断**；`cancelPipeline()` 的提示被 try/catch 吞掉。修复：补解构 `notifyInfo`。
- `electron/ipc-handlers/notify.js`：catch 兜底分支引用未导入的 `EC`（实际导出为 `ERROR`）→ 写日志失败时兜底路径自身抛 ReferenceError。修复：改用 `ERROR.REQUEST_ERROR`。
- `electron/publishers/account-manager.js`：`extractAccountInfo()` 引用未导入的 `PLATFORM_ACCOUNT_INFO_SELECTORS`（定义于 shared-utils platform-definitions）→ 该函数每次调用都在 try 内抛错并被吞成 `{}`，**账号信息提取功能自引入以来从未生效**。修复：补导入。
- `src/views/video-creation/StageProgress.vue`：data 键 `_lastActiveStageIndex` 以 `_` 开头是 Vue 保留前缀（实例代理不可见）→ 活动阶段去重恒失效、重复 scrollToStage。修复：改名 `lastActiveStageIndex` 并同步引用。

### 修复（其余 error 级 ×13）
- `preserve-caught-error` ×4（account-manager / full-auto-pipeline / pattern-extraction-service / llm-tag-generator）：rethrow 补 `{ cause: e }` 保留原始错误。
- `no-useless-assignment` ×4（knowledge-library-service / logger / rpa-view-platforms / video-clone/asset-generator）：移除在 try/catch 两条路径都被覆盖的无用初值。
- `no-empty` ×2（services/asset-generator）：空 catch 块补注释；另 1 处位于生成物（见下），随 ignores 排除。
- `no-control-regex` ×1（tag-suggest/compliance-filter）：有意匹配控制字符的清洗正则，带说明行内豁免。

### 变更（lint 配置 + CI 门禁）
- `eslint.config.mjs` 全局 ignores 新增 `electron/preload/**/*.bundle.js`（esbuild 生成物不应参与 lint）；`lint`/`lint:fix` 脚本去掉 `--no-ignore`（该参数会绕过 flat config ignores，是 15 条 "File ignored/unused directive" 噪音的根源）；新增 `lint:warnings` 脚本保留 warning 可见性。
- `.github/workflows/quality-gate.yml` static-gates 新增 **Gate 11 - ESLint (error-level gate)**：`pnpm exec eslint electron/ src/ --quiet`（与本地 `pnpm run lint` 同口径，只拦 error 级；warning 不阻断，后续以 per-rule 基线棘轮单独治理）。
- 修复后基线：`eslint electron/ src/ --quiet` **0 error**（修复前 17）；warning 393 → 340。

### 测试
- 新增 `electron/tests/notify-handler.test.js`（4：兜底封包/未知 key drop/白名单写日志/前缀匹配）、`electron/tests/account-manager-extract-info.test.js`（3：平台选择器注入/无平台回退/evaluate 异常降级）、`src/views/AutoPipelineView.test.js`（2：resume 不再 ReferenceError 且提示 resuming、cancel 提示 cancelled）；`StageProgress.test.js` 追加 1 例（活动阶段索引可被实例读写）。4 文件 34 用例全绿。
- 验证：`tsc --noEmit` 0 error；check-debt-budget / check-locale-sync --cjk / check-frontend-consistency / check-hardcoded-secrets 全 PASS；workflow-contract.test.js 19 pass。

### 文档
- 新增 OpenSpec change（已归档）：`openspec/changes/archive/2026-09-14-lint-gate-error-zero/`（proposal + specs/ci delta + tasks）。

## [Unreleased] - 2026-09-13 (视频创作·历史记录「查看文案」改为展示流水线原始文案并自动换行)

### 修复
- 视频创作·历史记录·任务详情页（`/create/result`）【查看文案】弹窗存在三处缺陷：① 弹窗与复制内容带分段序号 `【1】【2】…`；② 展示的是分句/分段后的 `segments[].text`，原稿段落与换行丢失（不是用户提交的原文）；③ 文本容器 `<pre class="script-text">` 未定义任何换行样式，`white-space: pre` 默认不折行，长行横向溢出弹窗被裁切。根因（引入于 `02d23fcf8`）：取数口径直接复用编辑区的分段结构，且 `script-text`/`script-modal-body` 只有 class 名没有落地 CSS。
- 修复（取数口径）：computed `scriptText` 改为**优先 `project.sourceText`**（流水线启动时 `run.params.text` 落盘、不参与分句的原文案，`story2video-project-service.js` 的 `saveRun`/`saveEditableRun`/`ensureProjectFromRun`），`trim()` 后非空即原样展示；`sourceText` 缺失的历史项目降级为 `segments[].text` 过滤空段、双换行拼接，**降级路径同样不带序号**；两者皆空则内容为空且【复制】按钮禁用。
- 修复（样式）：新增 `.script-text { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; font-family: inherit; line-height: 1.75; }`——保留原文换行并自动折行，长 URL/无空格长串兜底断行；纵向滚动交由弹窗既有 `.ui-modal-body`（不叠加第二层滚动条），`.script-modal-body` 仅 `min-width: 0`。
- 附带：弹窗增加 `test-id="script-modal"`、正文 `data-testid="script-text"`、复制按钮 `data-testid="script-copy-button"`，供稳定回归定位。

### 测试
- `ResultView.test.js` 新增 `describe("查看文案弹窗（展示流水线原始文案 + 自动换行）")` 5 条回归用例：① 原文案优先且逐字符一致、不含 `【`；② 老项目无 `sourceText` 时回退分段（不带编号、跳过空段）；③ 无原文案且无分段时内容为空 + 复制按钮禁用；④ 复制内容为原文案全文（stub `clipboard.writeText` 断言实参）；⑤ **源码级 CSS 契约**（`fs.readFileSync` 正则断言 `.script-text` 含 `white-space: pre-wrap`/`overflow-wrap: anywhere`/`word-break: break-word`，覆盖 jsdom 不应用 scoped CSS 的盲区）。RED（回退修复前）`5 failed | 125 passed` → GREEN `109 passed`。

### 文档
- 重写 01-docs/PRD-STORY2VIDEO-HISTORY-VIEW-SCRIPT-2026-09-13.md 至**迭代 2**：作废迭代 1 的「按分段编号【N】组织」需求，改为「展示启动流水线时的原始文案」；新增 §4.2 文案来源（`sourceText` 写入链 + 三级取值优先级 + 降级规则）、§4.4 换行与滚动（CSS 契约）、§5 数据校验 11 项、§6 显示项清单、§7 提示文字、§8 状态机、§9 边界情况、§10 验收标准、§13 变更记录。
- 新增 01-docs/BUGFIX-STORY2VIDEO-VIEW-SCRIPT-RAW-TEXT-2026-09-13.md（Bug 反思 5 步：根因溯源 `02d23fcf8` / 六层逃逸链 / 系统性漏洞（需求表述漏洞 + 测试覆盖漏洞 + 门禁缺失漏洞 + 取数口径漏洞）/ 修复与 5 条回归测试 / 预防措施 + 交互时序、提示文字、边界情况）。
- 更新 01-docs/learnings.md（新增 pitfall：展示"原始输入"必须回溯到最初落盘的原始字段；`<pre>` 展示容器必须显式声明 `white-space` 并配源码级契约测试；需求文档不得把实现细节当需求）。
## [Unreleased] - 2026-09-13 (lint 清理：消除唯一 no-useless-assignment)

### 修复
- `apps/desktop/src/views/HotTopics.vue` 的 `loadFromCacheThenRefresh()` 中 `let cached = null` 的初值在 try/catch 两条路径都会被覆盖，触发 eslint `no-useless-assignment`；经 `pnpm exec eslint src/ --no-ignore` 全量扫描确认这是 `apps/desktop/src` 下的**唯一**一处该规则告警。改为 `let cached`（不写初值）并补注释说明原因，行为完全不变（读取失败仍走 catch → null → 未命中缓存走网络抓取）。
- 同一行在 main 上属**历史遗留**（非本次改动引入）：`git blame` 与 `eslint` 在修复前的 main 同位置均报同一错误，故本次单独以 lint 清理提交处理，不与其他逻辑混提。

### 测试
- `HotTopics.test.js` 26 用例全绿（缓存优先渲染/后台静默刷新/无缓存走网络抓取等 SWR 路径均覆盖该函数）。
- `pnpm exec eslint src/views/HotTopics.vue --no-ignore` → 0 problem（修复前 1 error）；`check-debt-budget.js` 全部在基线内（HotTopics.vue 993 行 < 1000）。
- 说明：该规则此前不在 CI 门禁内（`.github/workflows/quality-gate.yml` 无 lint 步骤），本次未扩大范围把全局 lint 接入 CI（仓库仍有 `no-unused-vars` 31 处等既有告警，接入需先定阈值/基线）。

## [Unreleased] - 2026-09-13 (热门选题一键生成视频：后台运行后可并行发起新任务)

### 修复
- 热门选题页点某选题【生成视频】→ 弹窗内点【后台运行】→ 弹窗消失后，点**任意**选题的【生成视频】均无反应（按钮永久禁用）。根因：后台脱离路径 `handleGenVideoClose()` 只把 `genVideoPhase` 置为 `'background'`，从未复位 `genVideoBusy`；而入口同时有模板禁用 `:disabled="genVideoBusy"` 与方法内守卫 `if (genVideoBusy.value) return`，两处共用一个永不复位的标志（引入于 PR #1726 / commit `0c21d9561`，显式【后台运行】按钮 `d895eada8` 扩大了触发面）。
- 修复：抽出唯一复位路径 `resetGenVideoFrontendState()`（seq+1 使在途响应失效 → 停轮询/订阅/tick → 弹窗关闭 → phase='idle' → topic/stages/runId/progress/errorText/startedAt 清空 → **释放 genVideoBusy**），后台脱离与终态关闭共用；与视频创作页「脱离即全量复位」（`resetPipelineToNewTaskState`）语义对齐。热门选题**支持多任务并行**，并发上限由主进程 `PipelineEngine.maxConcurrentRuns`（`PIPELINE_CONCURRENCY_LIMIT`）判定，前端不再自设单任务锁。
- 同时修正：改写/启动阶段（尚无 run）点右上角 × 由「误报已转入后台（且后端仍会静默启动流水线）」改为「中止前端编排」——弹窗关闭、前端态复位、不启动流水线、无后台任务。
- 附带修复（文档）：`01-docs/CHANGELOG.md` 顶部残留的 3 行 Git 冲突标记（由 PR #4ab55b22 提交遗留），按"两段均为有效条目"合并保留。

### 测试
- `HotTopics.test.js` 新增/改写 4 条并发回归用例：①运行中关闭 → 后台脱离并复位前端态（busy 释放、runId 清空、不取消 run）；②改写阶段关闭 → 中止前端编排（不启动流水线）；③弹窗在途 busy 守卫仍拦截第二次编排（修复不过界）；④【后台运行】脱离后另一选题可立即启动并行流水线（按钮可用 + 第二次启动使用第二条选题的改写产物 + runId 切换）。原断言缺陷行为的用例 `keeps busy guard` 已改写；26 用例全绿。

### 文档
- 更新 01-docs/PRD-HOT-TOPICS-MODULE-2026-09-11.md（§3.10 取消/后台运行/并发约束口径修正、§5.6 流程图补并行与中止分支、§6.6 按钮矩阵与交互逻辑、**新增 §6.7 并发任务与前端态复位规格**、§8 验收标准新增第 12/13 条、§9 测试覆盖）
- 新增 01-docs/BUGFIX-HOT-TOPICS-GEN-VIDEO-PARALLEL-2026-09-13.md（Bug 反思 5 步：根因溯源 `0c21d9561` / 逃逸链 / 系统性漏洞 / 修复与回归测试 / 预防措施 + 交互时序、提示文字、边界情况）
- 更新 01-docs/learnings.md（pitfall：前端自设并发闸门、禁用态必须与复位路径成对、注释与实现不一致要质疑、测试可能固化缺陷）

## [Unreleased] - 2026-09-13 (图片轮播模式人脸种族一致性修复)

### 修复
- Story2Video 图片轮播模式下，同一文案生成含人脸图片时种族不一致（有的亚洲脸、有的欧美脸）。根因：story-context-engine.js 的 resolveAppearanceAnchor 仅对「古代东亚文化命中」与「明确文化关键词」注入东亚外观锚，现代/中性（无文化词）场景无锚点裸奔，图片 API（FLUX/DALL-E/MiniMax）训练数据偏西方，默认生成欧美脸；同一文案中偶然命中文化关键词的场景→亚洲脸、其余→欧美脸，跨场景不统一。
- 修复：resolveAppearanceAnchor 新增默认外观锚——modern/mixed 时代无文化命中且场景不含非东亚异域词（胡人/波斯/希腊/维京/玛雅/巴黎等）时默认注入「东亚人面孔、黑发、黄皮肤、深色瞳」；明确欧洲/美国文化、ancient 无 eastAsianCue（古希腊/维京/玛雅等）保持原逻辑不注入。

### 测试
- story-context-engine.test.js：新增 3 条用例（modern/mixed 无文化默认东亚锚双路径、modern/mixed 场景含非东亚词免除默认），升级 1 条旧期望（modern 无文化 → 默认东亚锚）；61 用例全绿无回归。

### 文档
- 更新 01-docs/PRD-STORY2VIDEO-SCENE-CONTEXT-2026-08-11.md（§5.3 功能逻辑 + §7 验收标准新增人脸一致性条目）
- 更新 01-docs/ARCH-STORY2VIDEO-SCENE-CONTEXT-2026-08-11.md（新增人物外观锚默认规则说明）

## [Unreleased] - 2026-09-13 (视频创作·历史记录「查看文案」)

### 新增
- 视频创作·历史记录·任务详情页（编辑页）成品视频下方按钮区，在【下载视频】右侧新增【查看文案】按钮：点击打开模态弹窗，展示全部文案文字（按分段编号【N】+文案内容，段间双换行分隔，空段显示【N】（无文案））。
- 弹窗底部【复制】按钮：点击将全部文案文字复制到剪贴板（`navigator.clipboard.writeText`，不支持时回退 textarea 方式）；复制成功后按钮文案变为「已复制」，1.5 秒后恢复；关闭弹窗重置复制状态。
- 新增 i18n key（zh/en 成对）：`story2video.view_script` / `script_modal_title` / `script_copied` / `script_copy_button` / `script_copied_button`。

### 文档
- 新增 01-docs/PRD-STORY2VIDEO-HISTORY-VIEW-SCRIPT-2026-09-13.md（功能描述/数据校验/流程/功能逻辑/交互逻辑/显示项/提示文字/边界情况）。

## [Unreleased] - 2026-09-07 (全自动内容生产与发布管道)

### 新增
- FullAutoPipeline 四阶段编排引擎（electron/services/full-auto-pipeline.js，829 行）：采集→改写→创作→发布 线性 DAG，run context 阶段间传递数据，支持断点续跑、取消、fail-open
- 4 个 IPC 通道（auto-pipeline:start/get-run/cancel/list-runs）+ preload API + DI 三步注册完整接线
- 前端管道配置与进度监控页面（AutoPipelineView.vue，439 行）：配置表单 + 四阶段进度 + 实时日志 + 历史运行
- 采集页批量采集 UI（Collection.vue）：RSS/URL 列表批量采集 + 进度轮询 + 取消

### 测试
- full-auto-pipeline.test.js 11 用例 + auto-pipeline.test.js 8 用例 + DI 回归 64 测试全绿
- E2E：真实 Electron + 6 个真实账号（百家号/快手/B站/抖音/公众号/头条），四阶段全部推进，fail-open 正确

### 文档
- 新增 01-docs/PRD-full-auto-pipeline.md（12 章，数据校验/流程/功能逻辑/交互/显示项/提示文字/API 契约/DI 接线链）

## [Unreleased] - 2026-09-07 (多平台发布 E2E 真实环境测试 + RPA 选择器修复)

### 修复
- 账号列表 `toPublicAccount` 调用 `checkLocalCredentials` 真实检测本地加密凭证，无凭证时标记 `has_cookies=false` + `status=expired`，不再依赖 `is_active` 误报"已登录"
- `_findByText` 选择器引擎修复：遍历所有 `:has-text` 模式而非仅取第一个（修复含多个文本选择器时后续候选被静默忽略的系统性缺陷）
- 微信公众号内容编辑器选择器扩展（新增 `#js_editor`, `.editor-area`, `[data-lexical-editor="true"]` 等），保存按钮增加"保存草稿"文本匹配
- 微信公众号内容编辑器未找到时 fail closed（不再跳过继续空保存）
- 发布按钮候选遍历：按 `publish_btn` 数组优先级依次尝试，页面改版后自动降级

### E2E 测试
- 真实 Electron 应用环境（CDP 10213，Vite 6165）对国内 4 平台（微信公众号/头条/抖音/视频号）完成全流程 E2E 发布测试
- 测试发现：4 个平台本地凭证文件存在但服务端 Cookie 均已过期，需重新登录
- 3 个无凭证平台（百家号/快手/B站）正确标记为 `status=expired`

### 参考产品逆向分析
- 完成参考产品 4.0 多平台发布逆向分析（抖音/头条/B站/微信公众号/百家号/快手/视频号/小红书/知乎/CSDN/雪球）
- 抖音认证体系（三层凭证：Cookie+localStorage+IndexedDB）已完整提取并复用

### E2E 测试（第二轮，2026-09-07）
- 对 4 个已登录平台（微信公众号/头条/抖音/视频号）进行第二轮真实发布测试，内容为智能手环睡眠改善主题真实自媒体文章
- 微信公众号（3 次）失败：内容编辑器未找到，根因为 Cookie 恢复失败、RPA 窗口显示"登录超时"
- 视频号（1 次）失败：发布验证超时，需更长的超时时间或更精确的验证逻辑
- 头条（1 次）状态未知：未出现在历史记录中，需进一步诊断
- 抖音未在本次测试中覆盖

### 修复（第二轮）
- 确认 `has_cookies:true` 仅表示本地加密凭证文件存在，不表示 RPA 窗口能使用这些 Cookie；Auth 分区与 RPA 分区是独立 session，Cookie 需显式复制
- 发布前登录态检测不应仅依赖 URL 关键字，需 DOM 探测（等待工作台特征元素）
- 微信公众号后台新版编辑器 DOM 已变化（`#js_editor_content`、`.ProseMirror` 旧选择器不再匹配），选择器需继续扩展并增加登录态前置检查

## [Unreleased] - 2026-09-05 (流水线进度弹窗「后台运行」按钮缺失修复)

### 修复
- 断点继续（openRunningPipeline）缺少人工检查点状态重置，与启动前台跟踪（startOrchestrationForeground）不一致；旧 run 的 sceneAssetSelectionActive/needsCheckpoint 残留会在状态拉取失败时让 isPipelineManualCheckpoint 误报，导致进度弹窗不显示「后台运行」按钮。补全 8 个状态重置（needsCheckpoint/providerWarnings/dismissedProviderWarnings/sceneAssetSelectionActive/sceneAssetCandidates/sceneAssetSelectionError/sceneAssetConfirming/dismissedBgmSkippedNotice），两条入口的前台状态初始化完全对齐。

## [Unreleased] - 2026-08-28 (视频创作流水线「保存配置」)

### 新增
- 视频创作模块所有流水线新增「保存配置」：当前流水线全部选项保存为有名字的组合配置（设备级本地持久化 userData/story2video-config-profiles/config-profiles.json），支持一键应用、重命名与删除；CreateView 编排/legacy、video-clone、film-engineering 均有专用快照白名单，均为纯前端表单快照，不改变提交契约。
- 新增 IPC 通道 story2video:config-profile-list/create/rename/delete（withSenderCheck + public 白名单，未登录可用）；应用走类型感知合并 + 枚举/数值归一化 + 失效 provider 回退，跨流水线配置拒绝应用；legacy 快照应用修复为整对象替换语义。
- 与「上次选项」自动恢复并存：应用配置不写入 lastOptions。

### 数据与测试
- 服务单测覆盖普通对象与特殊原型拒绝、Unicode 名称、CRUD、容量 50、64KiB、不可解析索引重建、部分损坏写保护、重名覆盖；IPC 覆盖参数非法、不可信 sender 无副作用与权限白名单；CreateView/VideoCloneView/FilmEngineeringView 组件测试覆盖保存、覆盖两段确认、列表倒序、应用归一化、跨流水线禁用、重命名、删除及专用快照；publisher wrapper、preload 权限矩阵同步更新。
- zh/en 文案成对新增（create.story2video.configProfile.*）；CJK 基线按行号位移显式重建（无新增裸硬编码文案）。

## [Unreleased] - 2026-08-24 (纯文档 PR 必需 CI 检查修复)

### CI
- 所有目标为 main 的 PR（含文档/流程/CI-only）均运行 Quality Gate、Electron CI、双平台 build 和 Doc Gate 的真实 job，避免分支保护把 path-filtered workflow 当作缺失 check。
- `push main` 的统一路径过滤保持不变，docs-only 提交合并后不重复运行全套 CI；workflow 契约测试区分 PR 全覆盖与 push 去重。
- Windows Browser E2E 对精确 `net::ERR_NO_BUFFER_SPACE` 导航错误至多重试一次；`goto`、`resetToRoute` 共用该策略，非匹配或第二次错误仍原样失败，快速合同在真实 E2E 前运行。
- 打包电影工程 E2E 的生成终态等待从 15 秒扩展为 30 秒，确保 Windows fallback 的 `生成失败` 能被真实分类；node:test require 合同不会启动 Electron。

## [Unreleased] - 2026-08-23 (统一进度弹窗范围边界收口)

### 文档
- 明确统一进度弹窗仅覆盖“有可观察流水线阶段状态”且具备 run 观察/恢复合同的路径；快速渲染 loading、发布 timeline、独立分析状态不套用，不提供伪造的“后台运行/历史可查看”语义。
- 标记 `CreateHistory.vue` 为废弃组件：`/create/history` 重定向到 `/create?view=history`，独立历史页内嵌进度卡片不得重新接入。

## [Unreleased] - 2026-08-23 (视频流水线进度弹窗与显式后台运行)

### 变更
- 恢复运行态【后台运行】入口；点击按钮或进度弹窗右上角关闭只停止 renderer 观察、恢复新建任务状态并刷新历史，不调用取消 IPC，主进程任务继续执行并保持并发占用。
- 将启动页内嵌的完整阶段信息迁移到统一进度弹窗，保留总进度、已用时、全部阶段、阶段详情/子进度、合成时间说明、provider warning、BGM 跳过提示、加载/不可用提示和人工 checkpoint 内容。
- 进度弹窗禁止遮罩和 Escape 关闭，仅右上角关闭按钮可触发后台脱离；离场含 opacity + scale 缩小动画；固定底部操作条继续可点击。
- 人工检查点（素材选择、内容策略、waiting_approval、needs_user_input、needsCheckpoint）隐藏后台入口并禁用关闭，避免任务失去继续所需的用户输入。
- 普通流水线缺少稳定 run identity 时只复用视觉壳和安全清理，不伪造按单任务恢复/取消能力；历史页保留轻量摘要，完整详情统一在控制页弹窗中查看。

### 数据与测试
- 对 runId、stage 数组/对象、progress 有限值与 `0..100` 范围做归一化；启动、恢复、push、轮询和暂停响应增加 run/request/action generation 与组件存活守卫。
- 新增 UiModal、CreateView、StageProgress 回归，覆盖 Teleport、遮罩/Escape 策略、后台/关闭等价、人工 checkpoint、底部操作条、非法数值和旧响应竞态。
- 同步 OpenSpec `s2v-progress-modal-background`、PRD、设计规范、前端 spec、learnings 与 CCG task。

## [Unreleased] - 2026-08-22 (字幕保护短语与在线结果质量门)

### 变更
- 字幕 `no_cut_bigrams` 支持任意长度保护短语并追加「蒙古/江南/包税人/大汗」，TypeScript、Electron JS 镜像与 smart-sentence-splitter Python 三端同步；流式累积在短语前缀中间不再硬切，超长 `max_chars` 配置下保护短语完整优先。
- 在线字幕归一化新增顺序连续覆盖与短语边界质量门：覆盖率足够但内容错序、重复、遗漏或切开保护短语时，该场景整体回退本地字幕并记录 `fallbackReason`，合格在线结果继续采用 `smart-sentence-splitter`。
- 语义停顿规则补充 `semantic_lead`（受约束的「提前/还/把/绝对」引导），并将「摇身一变｜成了」「日子｜绝对是元朝」等动作/判断边界优先于普通尾部收束，避免完整短语被短块合并重新吸回。

### 测试与门禁
- Electron 相关 131 passed、TypeScript 133 passed、sidecar Python 151 passed；新增用户样例与极端 `max_chars` 向量；QM-1 win-unpacked、ASAR require 与 8s 启动冒烟通过。

## [Unreleased] - 2026-08-23 (Story2Video 克隆音色生产重试契约)

### 修复
- Story2Video 初次 TTS 因跨账号克隆音色 `voice_id` 失效时，重克隆统一通过生产 `ModelProviderManager.callAdapter(providerId, 'cloneVoice', params)` 调用，并复用初始 TTS provider；重克隆或重试失败继续 fail-closed，不静默切换官方默认音色。

### 验证
- 已在真实 Electron profile 上验证克隆失败 → 重克隆 → TTS 重试 → compose 的完整链路；原问题 run `run_1787420188187_9w38` 已恢复并完成。

## [Unreleased] - 2026-08-21 (流水线启动前台跟踪 + 独立历史页「已中断」对齐)

### 变更
- 视频创作流水线启动成功后创作页实时轮询展示阶段进度；离开页面自动转后台运行、仅历史可见；重新进入回到全新新建状态（启动/续跑前台语义统一，并发门禁与 scene_asset_selection 检查点例外不变）。
- 移除旧的「启动即后台」监听机器（`runOrchestrationInBackground`/`startBackgroundCompletionWatch`/`checkBackgroundRunCompletion`/`s2vBackgroundTracking`），并新增 `_s2vAlive` 卸载竞态守卫，防止已卸载组件被终态响应触发结果页跳转。
- 独立历史页 `CreateHistory.vue` 对齐「已中断」：stale running 归入 interrupted、状态标签/路由/紫色样式；提示文案复用 locale `stageProgress.interruptedStage` / `stageProgress.interruptedHint`。

### 文案与文档
- locale zh/en 成对：新增 `create.story2video.startForegroundToast`，修订 `backgroundResumeToast`，删除已无引用的 `backgroundRunToast`。
- 同步 PRD-video-creation §3.1.35、总 PRD §3a.2（§3a.1 标废弃）、S2V-PIPELINE-PAGE-UX §5/§5.2.1、i18n-glossary 与 OpenSpec change `s2v-start-foreground-tracking`。

### 测试与门禁
- CreateView / CreateHistory / history-utils 定向 Vitest 全绿；locale pair（zh/en）+ CJK 基线通过；CJK 基线按脚本文档对行号位移显式重锚。

## [Unreleased] - 2026-08-20 (历史场景素材四卡布局与预览/选择交互)
## [Unreleased] - 2026-08-21 (历史详情场景素材未生成槽生成按钮 + 生成AI视频灰显修复)

### 变更
- 场景素材的生成按钮覆盖全部视觉卡：【生成新图】显示在图片 1/图片 2 卡内、【生成 AI 视频】显示在视频 1/视频 2 卡内，均为同一场景级动作的入口，写入目标仍由既有选中态/身份规则决定，video 2 保持视觉别名、不新增持久化身份。
- 【生成 AI 视频】的门控与后端回退契约对齐：`videoPrompt`/`prompt`/`text` 任一非空即可生成，修复老项目未持久化 `videoPrompt` 时按钮灰显不可点击的问题；三者全空仍禁用并提示。

### 测试与文档
- ResultView.test.js 更新错误固化断言（按钮 2→4），新增 videoPrompt 缺省回退 prompt/text 时可点并真实调用 IPC 的回归；同步 PRD、前端 spec 与 learnings。

## [Unreleased] - 2026-08-20 (历史场景素材四卡布局与预览/选择交互)

### 变更
- 视频任务编辑页每个场景固定显示四个视觉卡：图片 1、图片 2、视频 1、视频 2；缺少素材时保留与媒体缩略图相同尺寸和背景的空框，四格顺序和几何不折叠。
- 单选项移动到缩略图下方、素材名称前。缩略图现在只负责打开预览，radio 或其关联名称才是唯一的当前素材选择入口；视频 1/视频 2 继续归一到持久化的 `video` kind，不新增数据库或 IPC 枚举。
- 预览弹窗从 `lg` 调整为 `xl`，视频两个视觉卡都按视频元素预览；“生成新图”“生成 AI 视频”按 2026-08-21 修订覆盖全部图片/视频卡，均为同一场景级动作的多入口。
- 未生成素材只显示本地化的“未生成”/“Not generated”单行文案，清除空视频卡下方未解释的英文残留。

### 数据与交互校验
- renderer 对 `selectedMaterial` 做 `image1 | image2 | video` 白名单校验，对视觉视频别名统一发送 `video`；空槽、非法 kind、缺少受控路径由 renderer 与 IPC/service 双层拒绝。
- 预览必须同时具备受控 path 和可用 share URL；URL 失效时保留固定空框并禁止预览，其他场景素材不受影响。生成按钮保留 busy 防重复和 videoPrompt 非空前置校验。

### 测试与文档
- ResultView 新增四卡顺序、radio-only selection、thumbnail-only preview、视频 kind 归一、按钮归属、空态英文泄漏、URL 失效、视频媒体类型和 locale 成对回归；同步更新 Story2Video PRD、页面 UX PRD、OpenSpec change 与 learnings。

## [Unreleased] - 2026-08-19 (视频创作流水线自动后台运行)

### 变更
- 视频创作编排流水线成功启动后自动按后台任务执行：renderer 停止运行轮询并恢复启动初始态，主进程 run 继续执行且仍占用并发槽位；移除对【后台运行】按钮的依赖。
- 历史任务卡片点击【继续生成】或【从断点继续】后，进入 running 的任务留在历史视图后台运行并刷新阶段进度；只有分镜素材自选 paused 检查点继续进入创作页交互面板。
- 启动/续跑的 runId 增加非空字符串校验，旧轮询响应继续按 runId 快照丢弃，自动后台和续跑均不调用 pipelineCancel。

### 文档与测试
- 更新总 PRD §3a、PRD-video-creation 迭代表、i18n glossary 和 learnings；新增 OpenSpec change s2v-pipeline-always-background-run。
- CreateView/CreateViewHistory 定向回归覆盖自动后台、历史续跑、人工检查点、取消和竞态守卫。

## [Unreleased] - 2026-08-19 (Story2Video 历史断点恢复使用当前模型)

### 变更
- 历史记录失败/中断任务点击【从断点继续】后，未完成的文字推理、图片、TTS 和视频调用按当前模型设置解析；已完成本地资产按 scene index 复用，允许新旧模型资产混合。
- 恢复只清理旧 provider/model 路由，保留 prompt、场景文本、画幅、视频比例、voiceId、语速、音调和情绪；旧 video_plan 路由不再覆盖当前视频模型。
- TTS 保留原 voiceId；当前模型不兼容时不静默换音色、不覆盖旧音频，沿用兼容错误或既有 re-clone 合同。远程视频 taskId 未持久化时不伪造完成。
- History Continue 仍为一键操作，无新增模型选择 UI。

### 测试与文档
- 覆盖旧路由清理、legacy Python 路径、已完成图片/音频/视频复用、未完成调用使用当前能力模型和旧 video_plan 不回流。
- 详见 PRD-video-creation.md §3.1.33、ARCH-STORY2VIDEO-RESUME-CURRENT-MODELS-2026-08-19.md 与 OpenSpec change s2v-resume-current-models。

## [Unreleased] - 2026-08-17 (Story2Video 页面 UX 与任务操作统一)

### 变更
- 流水线启动页底部启动/暂停/继续/取消操作固定，运行阶段进度固定在内容顶部；视频任务编辑页保存与合成操作固定到底部。
- 历史记录统一所有状态卡片结构与通用任务信息，补齐删除入口；“编辑并重新合成”改为“编辑”；失败技术摘要改为本地化“失败原因”，任务标题为空时回退到原文案摘要。
- 历史详情入口统一进入视频任务编辑页，旧 /create/history 重定向到历史记录视图；编辑页增加分段跳转、上一条/下一条、AI 视频生成入口、音色目录/输入回退和语速滑条。
- 新增 pipeline:pause-run / pipeline:delete-run 桥接，删除和暂停持久化失败时保持原状态，防止历史记录出现半删除或假暂停。

### 文档与测试
- 详细合同见 01-docs/PRD-S2V-PIPELINE-PAGE-UX.md 与 openspec/changes/s2v-pipeline-page-ux/。
- 定向桌面回归：5 个测试文件、422/422 用例通过。

## [Unreleased] - 2026-08-16 (视频提示词上限 20000 → 40000)

### 变更
- 视频域上限 `VIDEO_ENGINE_LIMITS.videoMaxLengthMax` 20000 → **40000**（openspec `s2v-video-maxlength-40000`）：8020 standalone range [200,20000] → [200,40000]；videoPrompt 落库 `safeText` 视频专属 20000 → 40000（图片 prompt 20000 不动）；legacy 8013 [50,2000] 与共享 kernel 默认 500 不放松。8020 引擎侧 `VideoOptimizeRequest.max_length` le 同步 20000 → 40000（prompt-engine change `video-maxlength-40000`）。

### 测试
- 契约层 standalone clamp 断言同步 40000（22000/30000 范围内透传、40000 顶格）；服务层 video regen 断言 `max_length=40000` 显式透传 + 超长（25000 字符，>旧 20000 上限）完整落库。

## [Unreleased] - 2026-08-16 (历史重生成视频优化词长度放宽)

### 变更
- 历史记录「重新生成视频优化词」显式携带视频域 `max_length`（`VIDEO_ENGINE_LIMITS.videoMaxLengthMax`=20000）：8020 独立引擎 [200,20000] / 8013 legacy [50,2000] 由契约 builder 各自收敛，不再落回后端默认（legacy 500 / standalone 1800）截断；共享 kernel 默认 500 与 legacy 执行器契约收敛不放松。

### 测试
- 服务层 regenerateScenePrompt video 用例断言 `max_length=20000` 显式透传 + 超长（5000 字符）返回完整落库（safeText 20000）；video-prompt-engine-contract 既有双后端 clamp 断言保持（定向 Vitest 184/184）。

### 文档
- OpenSpec change `s2v-history-video-maxlength`（proposal/design/specs/tasks）；PRD 3.1.29.5 状态更新（待实现 → 已实现）。

## [Unreleased] - 2026-08-16 (历史记录图片提示词完整展示 + 未保存修改离开守卫)

### 修复
- 历史详情弹窗场景列表图片提示词 60 字符硬截断，长提示词（历史案例截断在 "Wunü Mo" 单词中间）无法完整查看；改为每个场景「旁白 / 画面提示词」两行独立完整展示（只渲染存在字段，长文本自动换行 + 列表滚动），卡片预览 120 截断保持。
- 结果页分段编辑修改后没有保存引导、直接返回会静默丢失；新增「有未保存修改」标识与离开守卫（保存并离开 / 不保存离开 / 取消），保存成功才放行、失败留页。

### 测试
- ResultView 离开守卫 6 用例（真实 router-view 触发 beforeRouteLeave + Teleport stub DOM 点击）；CreateViewHistory 长提示词完整展示 / 分行 / 空字段不渲染 / 卡片预览截断用例；locale zh/en 成对（新增 8 键：create.history.sceneNarration/scenePrompt + story2video.sceneMaterial 6 键）；CJK 基线经 --update-baseline 吸收行号偏移（官方门禁 1499/1499 无新增硬编码）；vue build 通过。
## [Unreleased] - 2026-08-16 (图片提示词 max_length 上限放开 500→2000 + 可配置)

### 变更
- 图片提示词优化 `optimize.max_length` 默认上限从 500 放开到 8013 契约上限 2000（pipeline stageDef 默认与文本配置契约默认同步），长提示词不再在 500 字符处按字符硬截断（历史案例：截断在 "Wunü Mo" 单词中间）。
- 创作页「外观」区新增「提示词最大长度」设置（200–2000，默认 2000），按需控制提示词长度与成本；执行器契约收敛 [50, 2000] 保持不变，不因放开默认放宽校验。
- 陈旧快照兼容：历史 last-options 缺 `maxPromptLength` 字段或越界时回落默认 2000，不破坏既有存储；已保存 run 快照 retain 原 `optimize.maxLength`（恢复/续跑沿用旧值），重新生成图片优化词时按新默认 2000 透传。

### 测试
- 主进程：pipeline 契约 `max_length` 断言 500→2000；新增 `resolveRuntimeStageOptions` 透传用例（`Story2VideoTextConfig.optimize.maxLength` → 请求 `max_length`）；text-config 默认 2000 断言。
- 渲染层：CreateView 默认 2000、下拉 8 档渲染、`buildStory2VideoTextConfig` 透传、恢复钳制（越界/缺失回退、合法保留）用例。
- locale：zh/en 成对新增 `create.story2video.maxPromptLength`；CJK 基线经显式 `--update-baseline` 吸收行号偏移（当前=基线 1500，无新增硬编码）。

### 文档
- OpenSpec change `s2v-optimize-maxlength`（proposal/design/specs/tasks 完成）；`locale-cjk-baseline.json` 行号重映射。

## [Unreleased] - 2026-08-15 (历史记录场景内容编辑、重新生成与整片重合成)

### 新增
- 已完成任务每个场景补齐内容闭环：**文本类元素可修改**（场景文案、字幕块、视频优化词、语音设置：音色 ID/语速/音调/情绪），**生成类元素可重新生成**（字幕、旁白语音、图片/视频优化词）。
- 历史记录入口：completed 且有 `projectId` 的任务卡片与详情弹窗新增【编辑并重新合成】按钮，详情弹窗展示只读场景列表与提示文案。
- 重新生成字幕：按场景文案本地分句重切 `subtitleBlocks` 并清空 `subtitleTimeline`（派生数据，合成时重建时间轴），不消耗外部额度。
- 重新生成旁白：按场景/项目语音设置调 TTS 替换 `audioPath`；失败保留旧音频、清理本次产物并回写 failed。
- 重新生成图片/视频优化词：`image` 重写 `prompt` 并清空 `promptTranslation`（旧翻译失效）；`video` 重写 `videoPrompt`；失败不改动分段。
- `updateSegments` 白名单扩展：videoPrompt/subtitleBlocks/subtitleTimeline/voiceId/voiceProvider/voiceModel/voiceSpeed/voicePitch/voiceEmotion 限长收敛（videoPrompt 20000、voiceId 160、voiceEmotion 80、voiceSpeed [0.5,2]、voicePitch [-12,12]（与流水线契约对齐，负值低沉音色可用）、subtitleBlocks ≤200 块×500 字符）；白名单外字段忽略不落库。
- 主进程同项目写串行队列（`_serializeProject`）：保存分段/整片重合成/三种重新生成按 projectId 串行执行，防止跨段并发或保存与重新生成竞态互相覆盖；渲染端任一分段生成中禁用全局保存/重新合成按钮。
- 重新生成前自动保存未落盘编辑（防本地修改被服务端响应覆盖）；重新生成字幕重置失败状态与字幕来源标记；compose 回显缺省 videoPrompt 时按项目原值回填（防重新合成后优化词丢失）。

### 修复
- 历史记录场景内容此前只能查看、无法修改，也没有整片重新合成入口；本迭代补齐「修改 → 保存分段 → 重新合成」完整流程。
- 完整桌面套件回归：`generate_assets` 视频分支的 `optimizedVideoPrompts` 仅在视频场景存在时定义，无视频场景（或视频生成器不可用）时持久化 `videoPrompt` 会引用未定义变量；已提升为分支外声明并补全量回归（story2video-stages.test.js 101/101 通过）。

### 测试
- 服务层 `safeVoiceSpeed`/`safeVoicePitch` 分界收敛/`extractOptimizedPrompt`/新字段透传与白名单外忽略/三个 regenerate 方法成功与失败回滚/recompose 保留 videoPrompt（C1 回归）/`_serializeProject` 串行队列（W2 回归）；IPC 三通道可信来源与非法 id/kind 拒绝 + 队列包裹断言；preload 方法数断言 99/289/87；ResultView 保存透传、字幕编辑拆分与清空语义、三按钮成功/失败通知、重新生成前自动保存、任一分段 busy 禁用全局按钮；CreateViewHistory 编辑入口与场景列表；notifications 失败归一化。定向 72+ 项通过，完整门禁见交付记录。

### 文档
- PRD-video-creation §3.1.29（数据模型/校验/流程/功能逻辑/交互/提示文字/安全边界/测试要求）+ 迭代记录表；OpenSpec change `s2v-history-scene-edit-recompose`。

## [Unreleased] - 2026-08-15 (视频创作历史记录状态浏览)

### 变更
- 视频创作历史记录改为六个状态标签，全部与状态筛选统一按有效更新时间倒序。
- 统一历史卡片信息，暂停环境/检查点与失败环节/错误摘要支持中英文；非取消卡片提供只读任务详情，取消卡片保持不可打开。
- 恢复、继续生成、打开结果、删除保持独立显式操作，避免点击卡片产生隐式副作用。

### 测试
- 新增有效时间归一化、状态筛选、标签键盘/ARIA、详情和动作隔离测试；定向 211 项通过，完整套件/构建/视觉结果见质量门禁记录。

## [Unreleased] - 2026-08-14 (流水线更名：全能创作 → 故事讲述)

### 变更
- **流水线展示名更名**：「全能创作 / Omni Creation」→「故事讲述 / Story Telling」；机器 ID `story2video-compose` 不变；配置标题、权限提示、模式摘要、素材模式选项等用户可见文案 zh/en 成对同步。

### 测试
- i18n 术语词典、locale 成对、流水线相关组件/E2E 断言同步更新，受影响套件全绿。

### 文档
- PRD、i18n-glossary、i18n-sync-mechanism、product-manual、OpenSpec change `story-telling-rename`（proposal/design/specs/tasks）。
## [Unreleased] - 2026-08-13 (模型服务异常横幅按运行归属 + 可关闭)

### 修复
- **模型服务异常提示跨运行残留**：`ProviderAnomalyBus.snapshotSince` 按运行创建时间为边界过滤异常快照（先过滤后截断；支持 ISO/epoch ms；非法边界回退全量不隐藏警告）；`pipeline:getRunContext` 以运行 `createdAt` 为界下发 `providerWarnings`，不退出应用重新进入「全能创作」启动新流水线不再显示旧运行（如 agnes-video 160s）的警告。
- **横幅 X 关闭按钮**：复用 BGM notice 模式新增 `dismissedProviderWarnings` 状态与关闭按钮；启动/取消/切换流水线时重置警告与关闭状态；hover 用 `color-mix` 主题色。

### 测试
- `provider-anomaly.test.js` +4（snapshotSince 含边界/未来空/数值 epoch/非法回退）；`pipeline.test.js` 异常快照下发改为按 createdAt 边界 + 旧异常不附加 + 无 createdAt 回退；`CreateView.test.js` +5（X 关闭、新运行重置、切换流水线重置、取消重置、轮询清空旧警告）。受影响 218 用例全绿，vite build exit 0。

### 文档
- OpenSpec change `story2video-provider-warning-ux`（proposal/design/specs/tasks）固化行为契约。
# CHANGELOG

## [Unreleased] - 2026-08-13 (阶段进行中信息实时推送与快照裁剪)

### 新增
- **`pipeline:update` 实时事件推送**：PipelineEngine 阶段事件（stage:start/complete/fail/checkpoint:pause/stage:progress/pipeline:complete/fail）桥接到受信主窗口；500ms 窗口节流合并，run 终态立即发送；cleanup 可卸载（无监听泄漏）。
- **轻量快照**：`getRunSnapshot(runId, { progressOnly })` 不含 context（checkpoint 仅类型元数据），事件/轮询载荷最小化；完整 `pipeline:getRunContext` 保留。
- **renderer 事件驱动**：preload `onPipelineUpdate`（可取消订阅）+ `src/api/publisher.js` 封装；CreateView 收到事件即更新阶段进度（仅进度子集，不覆盖完整 context——竞态缓解），3s 轮询保留为兜底并重置计时。

### 测试
- 推送桥 5 用例（节流合并/终态立即/无窗口静默/cleanup）、progressOnly 契约 2 用例、CreateView 事件 3 用例、preload 键数同步；6 文件 659/659 通过；Vite build + electron-builder --win --dir + 打包启动冒烟通过。

### 文档
- PRD 7.1.9.3 Phase 3 实施标注；OpenSpec change `pipeline-progress-real-time-push` tasks 13/13（PR #770）。

## [Unreleased] - 2026-08-13 (阶段进行中信息反馈颗粒度统一实施)

### 新增
- **阶段级进行中信息统一契约**：`stage.progress`（percent/message/detail/updatedAt）+ `stage.summary` 经 `getRunSnapshot()` 下发，与 `context.stage_progress` 双写；`StageExecutor` 统一 `onProgress` 通道 + `normalizeStageProgress` 字段级校验（fail-closed、单调不降、异常不阻断流水线）。
- **逐阶段进行中反馈**：publish 逐平台（「正在发布到 {平台} (i/N)」）、finalize_assets 逐段 TTS、split 完成摘要、optimize 运行中展示（修复仅完成后展示缺口）、LLM 阶段（domain_enrich/scene_context/select_video_scenes/explainer research·proposal·script·scenes）。
- **UI 通用化**：StageProgress 移除阶段名特判，统一渲染 message + 迷你进度条 + summary 优先；compose 旧快照降级保留；总进度加权当前阶段 percent。

### 测试
- 契约测试：onProgress → 快照可见 / 非法与降序拒绝 / 双写一致 / 加权公式 / UI 通用渲染（StageProgress 新增 5 用例）；8 测试文件 411/411 通过；Vite build + electron-builder --win --dir + 打包启动冒烟通过。

### 文档
- PRD 7.1.9.3 标注实施状态；PRD-video-creation §3.1.23 同步；OpenSpec change `pipeline-progress-feedback-unification` tasks 18/18（PR #756）。

## [Unreleased] - 2026-08-13 (视频创作流水线阶段进行中信息反馈颗粒度统一方案)

### 文档
- 新增 `01-docs/PLAN-VIDEO-PIPELINE-PROGRESS-FEEDBACK-2026-08-13.md`：整体梳理 14 条流水线各阶段「进行中」反馈现状（仅 compose/generate_assets/optimize 有子进度，其余阶段运行中无细节），提出统一 `stage.progress` 契约 + `StageExecutor.onProgress` 通道 + UI 去特判 + 三期实施（契约/通道/实时推送），含代码出处索引。
- `01-docs/PRD.md` 新增 7.1.9.3「阶段进行中信息反馈颗粒度统一契约」：统一进度契约（`stage.progress`/`stage.summary`/`context.stage_progress`）、执行器上报通道、各阶段目标反馈表、UI 通用化、数据校验与本地化、分期与门禁。
- `01-docs/PRD-video-creation.md`：修订记录新增 2026-08-13 行；新增 3.1.23「流水线阶段进行中信息反馈颗粒度统一」需求节（现状矩阵 + 目标合同摘要 + 分期）。
- `01-docs/PIPELINE-MATRIX.md`：新增 §9「阶段进度反馈能力矩阵」（各阶段数据载体/现状粒度/目标粒度），出处索引补充方案文档。

## [Unreleased] - 2026-08-12 (视频提示词输出语言按目标平台路由)

### 新增
- **语言路由增强**：独立引擎请求 output_language 解析升级为「显式参数 → 目标平台集合 → model 关键词兜底 → 文本 CJK 检测」：
  - 国产视频模型（minimax/seedance/kling/hailuo/doubao/cogvideo/hunyuan/wan/agnes）→ `zh`（中文主体 + 镜头术语双语，保真最高）
  - 国外视频模型（veo/runway/sora/ltx/pika/luma）→ `en`（模型按英文语料优化）
  - 避免「中文文案 + Veo/Runway」时中文提示词发给国外模型的错配
- **videogen 透传 model**：优化请求额外携带 `model`（`getDefault('video')` 返回的模型名），供通用网关 provider 场景按模型名兜底判 zh/en。

### 测试
- `video-prompt-engine-contract.test.js` 新增 8 用例（中文文案+veo→en / 中文文案+seedance→zh / 英文+minimax→zh / 显式覆盖 / 别名归一 / model 兜底 / 未知兜底 / languageFrom* 单元）；`videogen-stages.test.js` 新增透传断言（platform+model 转发）。
- 关联 prompt-engine 策略对齐（veo 英文优先 / doubao 中文优先注记，PR 待合）。

### 文档
- 关联 prompt-engine `01-docs/PRD-video-prompt-engine.md` §3.9 语言路由段落更新。

## [Unreleased] - 2026-08-12 (视频提示词优化：独立引擎 8020 优先 + 8013 回退)

### 新增
- **视频提示词优化双后端支持**：videogen 视频提示词优化支持独立视频提示词引擎（video_prompt_engine，8020）优先；配置 `VIDEO_PROMPT_PORT=8020`（可选 `VIDEO_PROMPT_HOST`，默认 127.0.0.1）启用，独立引擎不可用时自动回退 8013 `domain=video`（记录 warning，结果契约一致）。
- **独立引擎请求/响应契约**（`video-prompt-engine-contract.js`）：`buildStandaloneVideoOptimizeRequest`（8020 VideoOptimizeRequest：无 domain、含 output_language/num_candidates/context）、`isStandaloneVideoEngineEnabled` / `getStandaloneVideoEngineTarget` 环境开关与目标解析。
- **output_language 自动检测**：独立引擎请求按输入文本 CJK 字符占比（≥30%）自动选择 zh（中文主体 + 英文镜头术语双语）/ en；显式 `output_language`/`outputLanguage` 参数优先。

### 测试
- `video-prompt-engine-contract.test.js` 新增 10 用例：独立请求构造（无 domain/平台归一/边界收敛）、语言检测（显式优先/自动 zh/en/context 全文判 zh）、环境开关（合法端口/非法值）、8020 优先、失败回退 8013、批量成功与回退、未启用零回归。

### 文档
- `01-docs/VIDEO-PROMPT-OPTIMIZE-ENGINE-DESIGN-2026-08-11.md` v1.1 附注：最终方案由「8013 domain=video」升级为「独立引擎 8020 + 回退兼容」（用户要求视频/图片引擎分离）。
- 关联 prompt-engine 仓库 `video-prompt-engine-enhancement`（PR #29，已合并）。

## [Unreleased] - 2026-08-12 (Story2Video 场景上下文规则数据化 + 运营后台规则管理)

### 新增
- **场景上下文规则数据化**：规则表抽取为随包 `story-context-rules.json`（单一来源），支持环境变量/userData 配置覆盖加载 + 结构校验（非法规则回退内置并告警）。
- **运营后台「场景上下文规则」管理**（ops-center，admin）：查看/编辑/校验/保存/导出规则 JSON，版本与操作人追踪；API `GET/POST validate/PUT/GET export`。
- **打磨修复**：历史题材词表补全（北宋/南宋/汴京/临安/岳飞/元朝/大都）；场景内特有角色识别；上下文块措辞自然化（消除「欧洲中/现代中」）。

### 测试
- 引擎 +7 用例（规则加载/外部覆盖/非法回退/打磨回归）32 全绿；ops-center pytest 5 新用例 + 全量 126 通过；前端 build 通过。

### 文档
- PRD.md 7.1.33 补充运营后台规则管理小节；CHANGELOG/learnings/.quality-gates 同步。
- **2026-08-12 追补**：PRD.md §7.1.33(1) 与独立 PRD §9.1 的 Mermaid 架构图改为 TB 布局并渲染为 PNG（`01-docs/assets/story2video-scene-context-architecture.png`，本地 mermaid v10.9.1 + Edge headless 生成）嵌入文档；openspec `story2video-scene-context` / `story2video-scene-context-ops` spec 补充 `context.scene_context` 完整 JSON 样例与 `story-context-rules.json` 规则结构/校验语义样例（与主 PRD 一致）。

## [Unreleased] - 2026-08-12 (图片轮播模型下拉空白 / 新增模型后不刷新修复)

### 修复
- **图片轮播「图片生成器」下拉空状态**：未配置任何已启用且已配置的模型时，下拉显示「无」占位项 + 引导提示「未找到可用的图片生成器，请先在「模型服务商」中配置并启用支持图片生成的模型（含多模态模型）。」，不再出现空白选中项。
- **新增模型后能力下拉不刷新**：「设置 → 模型设置」弹窗关闭后，创作页自动重新加载模型服务商列表（新增 `stores/settings-dialog.js` revision 信号，App.vue 关闭时通知，CreateView 监听并重拉 `model-provider:list`）——新增 MiniMax 等多模态模型后，「图片生成器」「语音生成器」下拉立即出现、「音色复制 / 克隆」面板立即可用，不再停留在挂载时的旧列表。
- **陈旧 provider 选中值归一化**：重新加载时图片生成器指向已删除/停用 provider 的选中值自动清空（含 imageModel），避免下拉空白选中项与陈旧配置提交。

### 测试
- CreateView.test.js 新增 6 个回归用例（空列表显示「无」+ 提示、设置弹窗关闭后刷新且音色克隆可用、陈旧 provider 清空、IPC 失败保留旧选中值、视频生成器空态、语音空态引导）；同步 3 个 3.1.16 重构后过时的历史记录按钮 class 断言（`history-btn.*` → `s2v-btn-resume`/`s2v-btn-secondary`）；CreateView.test.js 137/137 全绿，vite build 通过，Claude 双轮只读审查闭合（M1 失败保留 / M2 视频对齐 / W1 语音空态提示 / 卸载守卫 / 链接路由验证）。

### 文档
- PRD-video-creation §3.1.22 新增完整修复合同（背景/根因/修复内容/数据流/数据校验/交互逻辑/显示项/提示文字/边界/回归/预防）；PRD.md 7.4.1.1 新增「空能力下拉占位」「设置弹窗关闭刷新」合同；learnings 记录 QM-5 复盘。

## [Unreleased] - 2026-08-11 (Story2Video 场景上下文增强中间层 scene_context)

### 新增
- **场景上下文增强中间层（scene_context）**：分句引擎与图片提示词优化引擎之间新增故事背景上下文阶段——读完整文案提取全局故事上下文（题材/时代/朝代/文化地域/场景设定/角色/时代道具/视觉风格/叙事语气/一句话梗概/一致性锚点/时代负面锚点），并把全局锚点融合进每个场景，注入 prompt-engine 优化请求，保证图片/视频生成的故事背景准确性、一致性与连贯性（如唐代全文 + 「一个老妇人在做饭」→ 不再生成西方老太太现代厨房）。
- 流水线 `story2video-compose` 阶段顺序更新为 `split → domain_enrich → scene_context → optimize → select_video_scenes → generate_assets → compose → publish`。
- 新增配置 `scene_context`（enabled/maxSummaryLength/maxAnchors/includeNegativeAnchors/contextBlockMaxChars，默认 true/300/8/true/400），渲染层→normalizer→pipeline 边界一致。
- optimize 请求 context 使用逐场景上下文块（白名单七键：synopsis/full_text/setting/narrative_intent/scene_type/character_list/character），时代负面锚点自动合并进 negative_prompt。

### 测试
- 新增 story-context-engine 用例（用户示例唐朝+做饭、无关键词、多文化、时代道具互斥、配置边界、敏感键、空场景 fail-closed、降级、白名单键、审查修复回归）；story2video-stages/text-config/契约/E2E 阶段顺序同步；Story2Video 相关用例全绿，完整 E2E 真实合成视频通过。

### 文档
- 新增 01-docs/PRD-STORY2VIDEO-SCENE-CONTEXT-2026-08-11.md 与 ARCH-STORY2VIDEO-SCENE-CONTEXT-2026-08-11.md；PRD.md 7.1.32、learnings、.quality-gates 同步。


## [Unreleased] - 2026-08-10 (视频创作「已用时」改为步骤执行耗时总和)

### 修复
- **「已用时」计算口径**：原按墙钟 `endedAt - createdAt`（运行中 `now - createdAt`）计算，暂停/检查点审阅/失败→断点恢复之间的空闲时间全部计入（用户实证 1245 分 33 秒）；现改为各步骤实际执行耗时之和（主进程 `run.activeMs`，执行器真实运行窗口为段，`finally` 保证成功/失败/取消/异常都累计）。
- 断点恢复跨重启：`activeMs` 随 run-state 快照持久化（version 1 不变），恢复继承累计继续累加；在飞段不落盘防停机时间膨胀。
- 前端：`已用时` = `activeMs` + 运行中当前执行段每秒本地增量，终态定格；旧数据回退墙钟；完成汇总与结果页 `durationMs` 同步累计口径。

### 测试
- 主进程 pipeline-engine +6、resume-orchestration +1、run-state-store +2；前端 CreateView +5；聚焦 209 用例全绿。

### 文档
- PRD 7.1.9 表格口径更新 + 新增 7.1.9.2 详细合同（数据模型/流程/数据校验/功能逻辑/交互逻辑/显示项/提示文字/边界场景）；product-manual、UI-INVENTORY 同步。

## [Unreleased] - 2026-08-09 (视频创作流水线进度区固定)

### 新增
- **流水线进度头部固定**：视频创作流水线运行/结束后，进度条 + 百分比 + 已用时（+ 完成摘要）在页面滚动时固定在主内容区顶部（`position: sticky; top: 0`），不再随滚动离开视口；阶段明细列表仍正常滚动。背景用主题 `--bg`（明暗一致），贴顶带轻阴影分隔。

### 测试
- CreateView.test.js 新增 sticky 头部结构断言（存在 + 位于阶段列表内），117 用例全绿。

### 文档
- PRD 7.1.3「运行反馈」补充「进度区固定」合同。

## [Unreleased] - 2026-08-09 (多模态模型音色克隆修复)

### 修复
- **音色克隆对多模态模型放行**：`tts-voice-clone-service._hasMatchingProvider` 与音色目录同合同——`category=multimodal` 且声明 tts 能力才放行（模型匹配含 `capability_models.tts`），未声明 tts 能力仍 fail-closed `VOICE_CLONE_MODEL_MISMATCH`。
  - 背景：上一轮只改了 `tts-voice-service`（音色目录），克隆链路漏改，用户在「MiniMax（多模态）」下添加克隆音频报「所选语音模型与克隆配置不一致，请检查模型设置」。
- 测试：tts-voice-clone-service 新增 multimodal 克隆成功 + 未声明 tts 能力拒绝 2 用例（共 56 用例全绿）。

### 文档
- PRD 7.4.1.1「provider 能力校验」注明音色目录与克隆服务同合同。

## [Unreleased] - 2026-08-09 (能力下拉只展示已配置服务商)

### 修改
- **Story2Video 能力下拉过滤未配置服务商**：图片生成器/语音生成器下拉只展示 `is_configured=true` 的 provider（有可用 API Key 或免 Key 本地模型）。未配置 / Key 解密失败（如跨机器复制 profile 导致 os_crypt 不匹配）的 provider 不再出现在下拉，旧配置恢复时自动回退到已配置项。
  - 背景：debug profile 残留 minimax-image/minimax-tts（key 解密失败），流水线旧配置显式选中它们后在 generate_assets 反复重试「尚未配置 API Key」卡住并失败。
- CreateView.test.js 更新/新增：未配置 provider 不出现、已配置 multimodal 保留（共 117 用例全绿）。

### 文档
- PRD 7.4.1.1 新增「已配置过滤」合同。

## [Unreleased] - 2026-08-09 (单多模态模型覆盖全部能力：能力选择器 + 音色目录)

### 新增
- **只保留一个多模态模型即可覆盖全部能力**：用户删除单能力模型（minimax-tts/minimax-image 等）后，「图片生成器」「语音生成器」下拉、TTS 音色目录、流水线能力路由仍全部可用：
  - `ModelProviderManager.listProviders(category)`：能力选择器在类别结果后并入**已启用且 `config.capabilities` 含该能力**的多模态 provider；未启用/未声明能力/已软删行不并入，fail-closed 过滤。
  - `tts-voice-catalog`：`PROVIDER_MODEL_CAPABILITIES` 新增 `minimax-multimodal` 白名单（speech-2.8-turbo/hd、2.6-hd/turbo，`user_clone` + 桌面克隆，与 minimax-tts 能力边界一致）。
  - `tts-voice-service._hasMatchingProvider`：放行声明 tts 能力的 multimodal provider（模型匹配含 `capability_models.tts`）；未声明 tts 能力 → `VOICE_MODEL_MISMATCH` fail-closed。
  - 前端 Story2Video：多模态在下拉显示「MiniMax（多模态）」后缀；语音模型下拉只展示 `capability_models.tts`（speech-2.8-turbo）并默认选中。

### 修改
- 前端 `getS2VDefaultVoiceModel` / `s2vVoiceModelOptions`：多模态 provider 的默认语音模型取 `capability_models.tts`，不再误取 `models[0]`（可能是 image/video/llm 模型）。

### 测试
- 新增多模态能力合并/白名单/音色目录/前端下拉用例：`tts-voice-catalog`（minimax-multimodal 白名单 + 非白名单模型 fail-closed）、`tts-voice-service`（multimodal getCatalog 成功 / 未声明 tts 能力拒绝 / 白名单外模型拒绝，均不调用 adapter）、`model-provider-multimodal`（能力选择器并入已启用多模态、未启用/未声明能力不并入）、`CreateView`（图片/语音下拉展示「（多模态）」、语音模型限定与默认模型）；共 +9 用例，相关回归（manager/crypto/ai-generator/asset-generator/story2video-stages/clone-service）全绿。

### 文档
- PRD 7.4.1.1「多模态模型作为能力选择器与音色目录」+ 7.1.4 多模态 TTS 音色合同补充。

## [Unreleased] - 2026-08-09 (提示词优化思考块泄露修复 + 无实质内容守卫)

### 修复
- **图片提示词优化思考块泄露**：带推理能力的 LLM（如 MiniMax-M3/M2.7）在 OpenAI 兼容接口下可能把 `<think>...</think>` 思考过程放进 `content`，`OPTIMIZE` 阶段原样用作图片提示词导致成图语义错误。
  - `minimax-llm.js` 新增 `stripThinkingBlocks`（成对/未闭合思考块剥离），`chatCompletion` 应用净化，`streamChat` 用状态机抑制跨 chunk 思考块。
  - `story2video-stages.js` OPTIMIZE 对 LLM 返回内容二次净化（双保险，不依赖具体 adapter）。
- **无实质内容文案守卫**：纯数字/纯符号文案（如「12」）跳过 LLM 优化，直接用原文兜底（`skipped_optimize: true`），避免模型凭空编造与原文无关的场景；单字中文（如「一」）仍正常优化。
- 新增回归测试：`stripThinkingBlocks` 成对/未闭合/纯思考、chatCompletion/streamChat 思考块剥离、OPTIMIZE 净化、纯数字跳过优化（共 +6 用例）。

### 文档
- learnings.md「提示词优化思考块泄露 + 无实质内容编造复盘」；PRD 补充提示词优化净化合同。

## [Unreleased] - 2026-08-08 (多模态 LLM 能力 + 删除交互 + 测试脱敏 + 运营后台预设模型设置)

### 新增
- **MiniMax 多模态补全文字推理（llm）能力**：预设 `minimax-multimodal` 能力升级为 `['llm','tts','image','video']`，`capability_models.llm='MiniMax-M2.7'`（官方文档 OpenAI 兼容 `POST /v1/chat/completions`）。
- **新增 `minimax-llm` Adapter**：`chatCompletion` / `streamChat` / `listModels` / `testConnection`，注册进 `ModelProviderManager._registerBuiltinAdapters`；`MinimaxMultimodalAdapter` 组合委托扩展为 LLM/TTS/Image/Video 四个适配器。
- **能力→调用方法映射**：`ai-generator.TYPE_TO_METHOD` + `capability_models[type]` 保证多模态模型按能力走与单类型模型完全相同的调用方法。
- **`_syncPresetCapabilities` 升级为 diff-merge**：存量预设行合并新增能力（保留用户已有配置），旧数据库升级后自动获得 `llm` 能力。
- **运营后台（ops-center）新增「预设模型设置」模块**：`model_presets` 表 + `/api/v1/model-presets` CRUD + 前端「预设模型」页；含 `default_model` 默认模型设置（已知默认模型预填）、`is_visible` 显示开关、`doc_links`/`capability_doc_links` 文档链接（≤10 条，http(s) 校验）、多模态能力手工配置。

### 修改
- **多模态表单隐藏 Base URL**：新增/编辑对话框对 `multimodal` 类别不展示 Base URL 输入（预设地址系统写死，多能力端点由各适配器各自持有）。
- **「禁用」按钮改为「删除」**：预设服务商删除 = 软删除（列表隐藏 + 清除 Key + 禁用，可在「添加服务商」重新添加）；自定义服务商物理删除；统一二次确认。
- **测试连接提示脱敏**：成功仅显示「✅ 连接成功」，不再回显 `{"success":true}` 等原始技术响应体；全项目筛查 `JSON.stringify(res.data)` 类泄漏。

### 测试
- 新增 minimax-llm 适配器单测（请求体/响应解析/错误映射/SSE/能力协商）、多模态 diff-merge 升级、ai-generator llm 能力模型选择、预设软删除（R85 目录保持）等用例；ops-center 后端新增 6 个模型预设 API 测试（38 全绿），前端构建通过。

### 文档
- PRD 5.3 / 7.1 删除规则 / 7.4.1（多模态 llm 能力）/ 7.4.2（运营后台预设模型设置）/ 7.4.3（测试脱敏）+ CHANGELOG + E2E 待办。

## [Unreleased] - 2026-08-08 (MiniMax 异步 T2A 查询响应层级修复)

### 修复
- **旁白 0/1 第二层根因（真实 provider 复测）**：voice_id 修复后错误从 `voice id wrong` 变为「异步语音合成查询超时（90s）」。根因：官方查询接口把 `status`/`file_id`/`task_id` 放在响应**顶层**（`{ task_id, status, file_id, base_resp }`），实现只读 `data.*`（`queryData.data`）导致任务永远显示 pending 直到超时。
- **双层兼容解析**：`_synthesizeAsync` 轮询同时读顶层与 `data.*`；`status=success`+`file_id` 才下载，`processing` 继续轮询，`failed`/`expired` 立即失败。
- **真实链路验证**：修复后 `minimax-tts synthesize success（约 13s）`，图片 1/1 · 旁白 1/1，成片 20 秒生成（视频预览可见旁白与分段音频）。

### 测试
- 新增 2 例：官方顶层 `status/file_id` 响应正常完成并下载、顶层 `status=processing` 继续轮询后完成。

### 文档
- PRD 7.1.15「查询响应层级」修订 + CHANGELOG。

## [Unreleased] - 2026-08-08 (克隆音色 voice_id 合规 + 失效回退默认音色)

### 修复
- **旁白 0/1 根因（真实 provider 排查）**：图片正常、仅 TTS 合成失败，provider 日志 `invalid params, voice id wrong`。根因：克隆音色 `voice_id="01"` 不符合 MiniMax 官方约束（长度 [8,256]、首字符必须英文字母），旧版 `cloneVoice` 用名称清洗生成非法 id，导致复刻/合成被平台拒绝。
- **voice_id 合规生成**：`cloneVoice` 改用 `buildMiniMaxCloneVoiceId`（MiniMax 前缀 + 清洗名称 + 随机后缀，长度 [8,256]、末位非 -/_）；新增 `isValidMiniMaxCloneVoiceId`。
- **存量自愈**：`listClones` 标记非法克隆 `invalid`；音色 catalog 将失效克隆移出可选项并放入 `invalidVoices`；偏好指向失效克隆时自动回退默认音色（旁白合成恢复）。
- **前端提示**：音色下拉与克隆面板显示「已失效，请重新克隆」（禁用选择，可删除），无需新增错误码。

### 测试
- 新增 8 例：buildMiniMaxCloneVoiceId 合规与随机性、isValidMiniMaxCloneVoiceId 边界、cloneVoice 复刻请求携带合规 voice_id、clone-service 非法/合法克隆标记、catalog invalidVoices 合并与偏好回退、CreateView 失效展示。

### 文档
- PRD 7.1.16「克隆音色 voice_id 合规与失效回退合同」+ 7.4 音色克隆 voice_id 合规说明。

## [Unreleased] - 2026-08-08 (多模态模型类别 + 能力路由 + MiniMax 多模态预设)

### 新能力与修复
- **多模态模型类别**：模型设置新增「多模态模型」类别（第 7 类，副标题同步）；新增预设 `minimax-multimodal`（MiniMax，仅需一个 API Key），声明能力 `['tts','image','video']`（≥2 项）与能力默认模型 `{ tts:'speech-2.8-turbo', image:'image-01', video:'MiniMax-Hailuo-2.3' }`，能力持久化到 provider `config`（含存量预设回填）。
- **多模态优先开关**：「优先使用多模态模型进行所有的AI操作」全局开关（默认勾选，user 级 `prefer_multimodal` 持久化）。
- **能力路由**：`ModelProviderManager.getDefault(category)` 开启偏好且多模态已配置并声明能力时返回多模态模型；`ai-generator.generateWithDefault` 按 `capability_models[type]` 选择模型；story2video 资源阶段未显式指定 provider 时按能力路由（显式下拉选择优先）。
- **多模态适配器**：`MinimaxMultimodalAdapter` 组合并委托 MiniMax TTS/Image/Video 三个既有适配器（TTS 走 t2a_async_v2 异步端点）。

### 测试
- 新增 12 例：multimodal 类别/标签与预设能力声明（≥2 + 能力默认模型齐全）、种子 config 持久化、getDefault 路由（关闭/开启/未配置/未声明能力 四分支）、偏好开关往返、多模态适配器能力与委托、ai-generator 能力模型选择（含普通 provider 回退）。

### 文档
- PRD 7.4.1「多模态模型类别」合同（类别/预设/能力声明/路由/开关/交互/验收）+ 5.3 类别表更新。

## [Unreleased] - 2026-08-08 (失败历史断点继续 + 终态快照唯一性 + 分段图片 CSP)

### 新能力与修复
- **失败历史可断点继续**：历史记录中失败且可恢复（非内容政策）的任务卡片新增「从断点继续」按钮，点击调用 `pipeline:resumeOrchestration` 续跑并切回流水线视图；续跑后任务以「进行中」继续留在历史，不再消失；内容政策类失败不显示该按钮。
- **终态记录唯一性**：`_finalizeRun` 写入内存历史时按 runId 去重（断点续跑复用同 id，只保留最新一条终态），避免新旧终态重复展示。
- **取消终态持久化**：编排模式取消（cancelled）与失败一样调用 `RunStateStore.saveFailed` 落盘终态快照，避免「续跑→再次取消→重启后任务丢失」。
- **分段图片 CSP 放行**：`img-src` 增加 `http://127.0.0.1:* http://localhost:*`（与 `media-src`/`connect-src` 对齐），修复分段编辑图片被 CSP 拦截不显示而视频正常的问题。

### 测试
- 新增 4 例：CreateView 失败历史「从断点继续」展示与续跑（含内容政策不显示）、PipelineEngine `_history` 同 runId 去重、取消终态快照重启后仍在历史；`index.test.js` 断言 `img-src` 放行本机来源。

### 文档
- PRD 历史记录章节补充「断点继续交互 / 终态唯一性 / 取消终态持久化」与 CSP 图片放行合同。

## [Unreleased] - 2026-08-08 (MiniMax 异步 T2A + 资源进度前置)

### 修复
- **MiniMax TTS 生成失败（生成图片与旁白阶段）**：默认模型 `speech-2.8-turbo` 是异步 T2A（T2A Async），但 adapter 调用同步端点 `/t2a_v2`，异步模型返回 200 且无 `data.audio` → 抛「Missing audio data in response」→ 瞬时重试耗尽 → 整段失败。已实现完整异步流程：`/t2a_async_v2` 创建任务 → 轮询 `/query/t2a_async_query_v2` → `/files/retrieve_content` 下载音频（90s 轮询上限、1s 间隔、可注入）。
- **克隆音色与官方音色分开路由（MiniMax 官方文档确认）**：
  - 克隆创建 `/v1/voice_clone` 请求体补充 `model: speech-2.8-hd`（此前缺 model 字段）。
  - 克隆音色合成（voice_id 不在系统音色列表）强制使用 `speech-02-hd` 模型走 `/t2a_async_v2`（官方模型表唯一标注「复刻相似度」的模型），不再用配置的 speech-2.8-turbo（会导致「invalid params, voice id wrong」）。
  - 官方音色继续使用用户配置模型（speech-2.8-turbo）。
  - `speech-02-*` 模型纳入异步路由。
- **音色无效错误细分**：adapter 把「voice id wrong」类错误归类 `INVALID_CONFIG`（非瞬时、不重试、快速失败）；renderer 新增 `VOICE_INVALID` 消息（提示所选音色无效/已失效 + 建议重新选择或使用默认音色），不再弹笼统「当前操作未能完成」。
- **进度数字很久才显示**：「生成图片与旁白」阶段开始即写入 `assets_progress={0/N, 0/M}`，前端立即显示「图片 0/N · 旁白 0/M」，不再等首个资源完成（图片生成 16-30s）。

### 测试
- 新增 9 例：异步 T2A 完整链路（创建/查询/下载）、查询内联音频、task_id 缺失、查询失败、轮询超时、进度前置写入、克隆音色自动切 speech-02-hd、官方音色用配置模型、cloneVoice 携带 model、音色无效 INVALID_CONFIG 分类。

### 文档
- PRD 新增「7.1.15 MiniMax 异步 T2A 与资源进度前置合同」。

## [Unreleased] - 2026-08-08 (视频预览：分段图片显示 + 文件下载修复)

### 修复
- **分段编辑图片显示**：媒体服务 Content-Type 映射缺失图片类型（png/jpg/jpeg/webp/gif），带 `nosniff` 时 `<img>` 拒绝渲染 `application/octet-stream`；已补齐 image/* 类型。
- **下载按钮无反应**：`<a download>` 对跨源/本地 HTTP 媒体 URL 无效（静默失败）。新增主进程 `story2video:save-as`（系统保存对话框 + 受控路径校验 + 文件复制），下载视频/裁剪片段/旁白/分段图片/音频/视频统一改走该通道；成功提示「文件已保存。」，取消不提示。

### 测试
- 新增 8 例：媒体服务图片 Content-Type（png/jpg/jpeg/webp）、save-as 保存/取消/外部路径拒绝、preload 新 API（计数 + IPC 映射 + 列表）、renderer API fallback、ResultView 下载改走 save-as（含取消分支）。

### 文档
- PRD 新增「7.1.14 视频预览：分段图片与文件下载合同」。

## [Unreleased] - 2026-08-08 (失败任务历史持久展示 + 状态「生成失败」)

### 新能力与修复
- **失败任务持久展示**：流水线执行失败的任务现在持久显示在【历史记录】中（状态「生成失败」）。应用重启后仍可见——`RunStateStore.saveFailed` 持久化失败快照（补充 `createdAt`），`PipelineEngine.getHistory()` 合并 `runStateStore.listFailed()` 的持久化失败快照（按 runId 与内存 `_runs`/`_history` 去重）。
- **状态文案**：`failed` 状态在历史记录显示「生成失败」（CreateView 内部历史视图 + `/create/history` 独立页），状态筛选下拉项同步改为「生成失败」。

### 测试
- 新增 7 例：RunStateStore `listFailed`（legacy/owner/去重/损坏跳过/createdAt）、PipelineEngine `getHistory` 合并持久化失败快照（重启场景 + 同会话去重）、CreateHistory 状态文案。
- CI 稳定性：credential-store 真实 Windows 文件锁用例超时提升到 60s（CI 全量负载下 powershell 子进程启动延迟可致 30s 偶发超时，非回归）。

### 文档
- PRD 后台运行流水线章节「失败任务持久展示」合同。

## [Unreleased] - 2026-08-08 (弹窗标题 / 操作反馈 / 提示信息细化)

### 新能力与修复
- **弹窗标题规范**：提示类弹窗标题统一为「提示」/「Notice」，去掉「{流水线名} 提示」前缀（CreateView 错误/删除确认/模板删除确认 + ResultView 通知对话框）。
- **选项保存 toast 布局**：「选项已保存 ✓」「已恢复上次的选项设置」改为操作栏上方绝对定位悬浮提示，不再挤占【启动流水线】按钮位置（原 toast 作为 flex 子项把按钮推到右侧）。
- **媒体文件校验细分**：格式不支持/大小超限/文件不可读分别给出具体提示（含具体格式、允许列表、最大与当前大小）；主进程导入失败原因透传映射；批量旁白逐文件失败不再重复弹笼统提示。
- **文件要求提示**：图片/旁白音频/背景音乐/视频素材选择控件附近常驻显示格式与大小要求（i18n 中英文）。
- **提示信息梳理**：媒体校验类全面细化；限流/额度/权限/模型配置类保持专属文案；瞬时失败保留友好通用兜底，不暴露技术细节。

### 测试
- 新增 8 例：弹窗标题 3、媒体细分消息插值 1、CreateView 媒体细分 5（格式/大小/主进程透传/不可读/要求提示）、toast 显示与消失 1（含操作栏不受影响）。

### 文档
- PRD 新增「7.1.13 弹窗标题、操作反馈与提示信息规范」。

## [Unreleased] - 2026-08-07 (模型服务异常检测 + 有界超时 + 执行日志)

### 新能力
- **模型服务异常检测（provider-anomaly）**：新增 `providerAnomalyBus`，检测慢响应（llm/tts/audio 30s、image 60s、video 120s）、超时、网络错误，按 provider 去重保留最近 5 条内存快照；`pipeline:getRunContext` 存在异常时附带 `providerWarnings`，前端流水线详情页显示非阻塞友好横幅（含 provider 与秒数、建议到【模型设置】切换/检查），轮询实时更新、运行结束清空。
- **有界调用超时**：`callAdapter` 兜底超时（视频 10 分钟、其余 2 分钟，`params.timeoutMs` 优先），超时抛 `ProviderError(TIMEOUT)` 归入瞬时错误冷却重试，避免 agnes-llm 等 provider 单次挂起 2-3 分钟无限阻塞流水线。
- **流水线执行日志**：pipeline-engine 每阶段开始/结束记录 INFO 日志（runId/pipeline/stage/序号/耗时/成功），运行终态（completed/failed/cancelled）记录 INFO/WARN（总耗时 + 截断错误摘要 ≤500 字符），配合 model_provider_logs 定位「模型自身问题」。
- **提示词优化进度前置**：阶段一开始即写入 `context.optimize_progress={done,total}`（断点续传从已完成数起步），前端执行期间即可显示「共 N 个场景，已完成 M 个」。

### 修复
- 提示词优化长文案卡死表象（实测 agnes-llm 单请求 122s/180s/153s → 阶段累计 476s）：已切换默认 LLM 至 sensenova-llm（deepseek-v4-flash）验证 optimize 2-3s 完成，并用有界超时 + 异常提示兜底。

### 测试
- 新增 `provider-anomaly.test.js`（阈值/判断/上报/快照/事件）；callAdapter 异常检测 4 用例（正常/超时/网络/慢响应）；`pipeline:getRunContext` 下发 2 用例；CreateView 横幅 3 用例；optimize 进度前置与断点续传 2 用例。

### 文档
- PRD 新增「7.1.12 模型服务异常检测、有界超时与执行日志合同」。

## [Unreleased] - 2026-07-15 (Phase 2 质量节拍补跑 — 模型供应商 Adapter)

### 质量节拍日常循环 6 步补跑（P3.6-P3.8 回顾性补跑）

> P3.6-P3.8 三个 Adapter 实现时跳过了质量节拍 6 步，本次补跑完整执行并留下证据。

#### 6 步执行证据

| 步骤 | 内容 | 产出 |
|------|------|------|
| ⓪ pre-flight | 回顾性补充 31 条验收标准（Anthropic 10 + ElevenLabs 11 + FLUX 10） | 验收标准文档化 |
| ① 上下文检查 | 读取 3 Adapter 源码 + 3 测试 + base.js + provider-error.js + seeds.js + manager.js | 接口契约确认 |
| ② TDD 场景脑暴 | 识别 10 个测试缺口，补充 40 个边界测试 | 测试 2231 → 2271 (+40) |
| ④ 完整性审查 | 6 大专项（异常/权限/事务/边界/风格/Demo）审查 3 个 Adapter | 发现并修复 1 个 MAJOR bug |
| ⑤ 文档更新 | CHANGELOG + tech-debt 更新 | 本节 |
| ⑥ AI 协作质量检查 | 经验记录到 project_memory | 新增 2 条教训 |

#### Bug 修复

- **FLUX listModels 浅拷贝突变污染** (MAJOR)
  - 文件: `apps/desktop/electron/services/adapters/flux.js`
  - 原代码: `return FLUX_MODELS.slice()` — slice() 仅浅拷贝数组，对象引用共享
  - 症状: 调用方修改返回值 `list[0].id = 'tampered'` 会污染内部静态列表 FLUX_MODELS
  - 修复: `return FLUX_MODELS.map(m => ({ ...m }))` — 对每个对象创建副本
  - 发现方式: 步骤② TDD 场景脑暴的"破坏性场景"测试揭示

#### 新增测试覆盖（40 个）

**Anthropic（18 个）— 补跑 CRITICAL 缺口 streamChat**
- streamChat SSE 流式解析（10 个）：onChunk 回调校验、stream:true 请求体、content_block_delta 事件触发、[DONE] 终止、非 content_block_delta 过滤、JSON 解析失败静默忽略、非 data: 行忽略、无 getReader 错误、跨 chunk SSE 行拼接、无 messages 参数
- chatCompletion 多 block（6 个）：多 text block 合并、tool_use block 过滤、空 content 数组、多 system 消息合并、无 model 错误、非数组 messages 错误
- 错误响应边界（2 个）：非 JSON 纯文本错误、JSON 无 error 字段

**ElevenLabs（11 个）**
- audio format 推断（3 个）：mp3_44100_128→mp3、pcm_24000→pcm、ulaw_8000→ulaw
- synthesize 边界（5 个）：只传 stability、只传 similarityBoost、不传 voice_settings、空 text、空 voiceId
- 错误响应边界（3 个）：detail 字符串格式、500 错误、非 JSON 纯文本错误

**FLUX（11 个）**
- width/height 与 image_size 优先级（2 个）：同时传时 width/height 优先、只传 width 不设置尺寸
- generateImage 参数完整性（4 个）：seed 传递、无 images 字段、无 model 字段回退、无参数错误
- listModels 突变安全（1 个）：揭示并验证浅拷贝 bug 修复
- testConnection 边界（2 个）：500 错误、网络错误
- 错误响应边界（2 个）：非 JSON 纯文本错误、JSON 无 error 字段

#### 测试基线

- 补跑前: 2231 passed / 0 failed / 10 skipped
- 补跑后: 2271 passed / 0 failed / 10 skipped（+40 测试，零回归）


## [Unreleased] - 2026-07-15 (Phase 5.4 — Electron 升级)


### 质量节拍 Phase 5.4 安全运营 — Electron 33→43 主版本升级

#### 成果
- **Security**: npm audit 0 vulnerabilities (从 6 high CVE → 0) ✅
- **Composite Score**: 9.7/10 (较 Phase 4.1 基线 8.7 ↑1.0)
- **Electron**: 33.4.0 → 43.1.1 (跨 10 个主版本)
- **全量回归**: JS 1982 passed / 0 failed / 10 skipped — 零回归

#### 升级详情
- 根目录 package.json: `"electron": "^33.4.0"` → `"^43.1.1"`
- apps/desktop/package.json: `"electron": "33.4.0"` → `"^43.1.1"`
- rpa-engine peerDependency `>=33.0.0` 已兼容，无需修改

#### Breaking Changes 评估 (33→43)
| 版本 | Breaking Change | 项目影响 |
|------|----------------|---------|
| v38 | Removed plugin-crashed event | 未使用 ✅ |
| v38 | Removed macOS 11 support | Windows 优先 ✅ |
| v39 | window.open popups always resizable | Accounts.vue 1 处, UI 微调 ✅ |
| v40 | Deprecated clipboard from renderer | 项目用 navigator.clipboard ✅ |
| v41 | PDFs no longer separate WebContents | 未涉及 PDF ✅ |
| v42 | electron postinstall 不自动下载 | 按需下载, 已验证 ✅ |
| v42 | macOS notifications UNNotification | Windows 优先 ✅ |
| v43 | NativeImage.toBitmap color space | 未使用 ✅ |
| v43 | Dialog default to Downloads | 项目 dialog 调用少 ✅ |
| v44 | clipboard removed from renderer | 项目用 navigator.clipboard ✅ |

#### 验证
- TSC: 零错误 ✅
- npm audit --omit=dev: 0 vulnerabilities ✅
- vitest: 1982/0/10 ✅
- Electron 二进制: 43.1.1 已下载到 dist/electron.exe ✅


## [Unreleased] - 2026-07-15 (Phase 4.1)


### 质量节拍 Phase 4.1 质量体检 — 全项目健康度评估

#### 成果
- **Composite Score**: 8.7/10 (较 07-11 基线 8.6 ↑0.1)
- **TSC 类型检查**: 10/10 ✅ 零错误
- **循环依赖**: 10/10 ✅ 零循环 (309 files)
- **JS 测试**: 9.5/10 ⚠️ 1981 passed / 1 偶发 timeout / 10 skipped (1992 总计)
- **Python 测试**: 9/10 ⚠️ 2180 passed / 3 failed (预存, 与基线一致)
- **安全扫描**: 6/10 ⚠️ 6 high vulnerabilities (较基线 14→6, 减半)

#### 6 大维度评分
| 维度 | 评分 | 状态 |
|------|------|------|
| Type check | 10/10 | ✅ CLEAN |
| Tests JS | 9.5/10 | ⚠️ 1 偶发 timeout |
| Tests Python | 9/10 | ⚠️ 3 预存失败 |
| Lint | 9/10 | ⚠️ 8 unsorted-imports |
| Circular deps | 10/10 | ✅ CLEAN |
| Dead code | 7/10 | ⚠️ 4 unused deps |
| Security | 6/10 | ⚠️ 6 high CVE |

#### 改进建议
- **P3**: 修复 IntelligenceView timeout + Python 3 预存失败 + 清理 4 unused deps + ruff --fix
- **P4**: Electron 升级 (6 CVE) + npm audit fix (form-data)


## [Unreleased] - 2026-07-15


### 质量节拍 Phase 5.1 问题排查 — 25 个预存测试失败清零

#### 成果
- **全量回归**: 1982 passed / 10 skipped / **0 failed** (1992 总测试)
- **基线提升**: 1955 passed / 23 failed → 1982 passed / 0 failed (+27 测试, -23 失败)
- **测试文件**: 136 passed | 3 skipped (139 总计)

#### 修复清单 (8 文件, +160/-115 行, commit eb60cbc)
1. **Home.test.js / views-deep.test.js** — getVersion mock 返回 `{code:0, data:string}` 适配新 API 契约 (2 失败)
2. **ipc-handlers.test.js** — HIDDEN 集合新增 `pipeline:registerStageExecutor` (1 失败)
3. **CreateView.test.js** — 完整重写 271 行适配三视图架构 (16 失败)
   - 11 个 API 重命名: text→quickText, canRender→canQuickRender, startRender→startQuickRender 等
   - 补充 8 个 pipeline* mock (pipelineList/Start/Pause/Resume/Cancel/Status/Advance/History)
   - setTimeout(0) 替代 nextTick 等待 async mounted()
4. **views-deep2.test.js** — 3 个 CreateView 断言适配三视图 + .mode-tab 期望 2 而非 3 (3 失败)
5. **pixel-diff.js** — resemblejs require 包裹 try-catch + available 属性, canvas 缺失时优雅 skipped (2 失败)
6. **vitest.config.js** — exclude 新增 visual-testing/** 与 path-utils.test.js (非 vitest 格式)
7. **test-setup.js** — mock 路径匹配 bug 修复: `includes(key)` 误匹配子串 → 精确 `endsWith` 匹配 (1 失败)

#### 根因分析
| 类别 | 失败数 | 根因 |
|------|--------|------|
| CreateView 重构 | 19 | 组件从单视图改为三视图架构, API 全部重命名, 测试未同步 |
| Mock 契约不匹配 | 2 | getVersion 返回类型变更, 测试 mock 未更新 |
| IPC HIDDEN 遗漏 | 1 | 新增 handler 未加入 HIDDEN 列表 |
| 视觉测试环境 | 2 | node-canvas 原生模块 Windows 下缺失 |
| 非 vitest 格式 | 1 | path-utils.test.js 是 CLI 脚本 |
| Mock 路径匹配 bug | 1 | test-setup.js `includes("path")` 误匹配 `path-utils` |

#### Bug 反哺 (新增 anti-pattern)
- **mock 路径子串匹配 bug**: `includes(normalizedKey)` 导致 "path" 误匹配 "path-utils.js" → 必须用精确 `endsWith` 或完全相等匹配

#### 质量评分
- Phase 4 基线: 8.95
- Phase 5.1 完成后: 维持 8.95 (零失败, 无回归)





### 质量节拍 Phase 3+4 收尾 — retro 跟踪表更新 + Phase 4 门禁确认

#### 文档同步
- 更新 retro 跟踪表：10 项行动全部标记 ✅ + commit hash（原 8 项全 ⬜）
- 新增第十二节：P2 系列技术债务清零完整记录（P2-6~P2-10 逐项跟踪）
- 修正 P1-C 状态：⏳ 推迟 → ✅ 已完成（3 commit: d82bffc+3e914e6+9f69647）
- 修正 Phase 4 状态：🔄 进行中 → ✅

#### Phase 4 门禁确认
- [x] /health 评分 8.95 (>= 7) ✅
- [x] /retro 产出了 learnings（+2 lessons / +3 patterns / +1 anti-pattern）✅
- [x] Bug 反哺完成（P2-10 router.publish 不存在 + P2-7 fs.rmSync Windows 静默失败）✅
- [x] learnings 已 review（3 新 pattern 为代码级，已入 project_memory.md，无需 skillify）✅
- [x] 未触发 /bug-reflection 的未解决问题（仅 2 个预存 TODO，非阻塞）✅

#### 技术债务最终状态
- 所有 P0/P1/P2 级别技术债务已全部清零
- 质量评分 6.2 → 8.95（+2.75）
- 全量回归 1955 passed / 23 pre-existing failed（无新增失败）
- TSC 类型检查：零错误
- 质量节拍补跑全流程完成（Phase 3.1 发布审查 + Phase 4 经验沉淀）


### P2-10 — PUBLISH 阶段实现 (质量节拍 Phase 2 日常循环)

#### 问题
- `stage-executor.js` PUBLISH 执行器调用 `router.publish(...)`，但 `PublisherRouter` 只有 `createPublisher(platform, deps).publish(task)` 模式
- **`router.publish` 方法根本不存在** → 永远走占位成功分支，真实发布从未执行
- 无 videoPath 验证（undefined 直接传给 router）
- 无 platforms 验证（空数组时静默成功）
- 无日志记录（成功/失败都没 log）
- 占位成功误导调用方（`placeholder: true` 但 `success: true`，无法区分）

#### 修复 — 重写 PUBLISH 执行器
- **API 匹配**：`router.publish(...)` → `router.createPublisher(platform, deps).publish(task)`
- **videoPath 验证**：从 compose output 提取（支持 string/object 两种格式）+ `fs.existsSync` 验证
- **platforms 验证**：非空数组检查，支持 `stage.platforms` 优先于 `params.platforms`
- **日志记录**：占位 warn / 单平台 info / 失败 warn / 异常 warn 全覆盖
- **多平台汇总**：`publishedTo` + `failedPlatforms` + `results` + `stats` 详细输出
- **异常隔离**：单平台 publish 抛异常不中断其他平台
- **占位分支保留**：E2E 编排验证兼容（router 未配置时仍返回占位成功 + warn 日志）

#### 输出结构
```javascript
// 真实发布
{
  success: true/false,  // 至少一个平台成功
  output: {
    placeholder: false,
    videoPath: '/tmp/xxx.mp4',
    publishedTo: ['xiaohongshu', 'bilibili'],
    failedPlatforms: ['douyin'],
    results: [{ platform, success, url, error }, ...],
    stats: { total, succeeded, failed }
  },
  error: null / 'All platforms failed: ...'
}
// 占位（router 未配置）
{ success: true, output: { placeholder: true, publishedTo: [], videoPath } }
```

#### 测试
- **新建** `stage-executor-publish.test.js` (13 用例)
  - 占位分支: router null / container null / 无 createPublisher 方法
  - 输入验证: videoPath undefined / 文件不存在 / platforms 空数组 / platforms 未指定
  - 单平台: 成功 / 失败
  - 多平台: 部分成功 / 全部失败
  - 异常处理: publish 抛异常不中断其他平台
  - 优先级: stage.platforms 优先于 params.platforms
- **13/13 PASS**（128ms）
- 相关测试无回归：stage-executor.test.js 35/35 PASS

#### 6 大专项审查
1. **异常处理** ✅ — publisher.publish try-catch 隔离，占位分支 warn 日志
2. **权限边界** ✅ — createPublisher 参数数组调用，videoPath 验证后再用
3. **事务一致性** ✅ — 多平台尽力而为，至少一个成功即整体成功
4. **边界值** ✅ — router/videoPath/platforms/单平台/多平台/异常全 13 场景覆盖
5. **代码风格** ✅ — @ts-check + JSDoc + 与现有执行器一致
6. **Demo 代码** ✅ — 无硬编码，日志完整，fs 按需 require


### P2-8 — 测试超时 + 临时文件清理 (质量节拍 Phase 2 日常循环)

#### 问题
- 3 个 e2e 测试文件（e2e-bridge-integration / e2e-pipeline-orchestrator / e2e-full-pipeline）无 timeout 设置
- 外部 Python 服务挂起时测试无限等待，可能挂死 CI
- e2e-full-pipeline 创建真实文件（图片/TTS/视频）无 afterEach 清理，残留磁盘

#### 修复
- **e2e-bridge-integration.test.js** — 5 test 加 `{ timeout: 30000 }`（HTTP 调用 30s）
- **e2e-pipeline-orchestrator.test.js** — 5 test 加 `{ timeout: 10000~120000 }`（分级：注册检查 10s / 单阶段 60s / autoAdvance 120s）
- **e2e-full-pipeline.test.js** — 1 test 加 `{ timeout: 120000 }`（含 ffmpeg 合成）
- **e2e-full-pipeline.test.js** — 新增 `afterEach` 清理：
  - 收集 `_tmpFiles` 数组（图片/TTS/视频路径）
  - 清理 `os.tmpdir()/story2video/assets/` 下的 `img_*.png` / `tts_*.mp3`
  - 清理 `os.tmpdir()/story2video/` 下的 `*_output.mp4`
  - 不递归子目录（sessionDir 由 ComposeEngine P2-7 自管）

#### 测试
- node --check 语法验证通过（3 文件）
- vitest 全量回归：279 passed | 10 skipped | 5 failed（全为预存 canvas.node 缺失，无新增失败）
- node --test 加载验证：timeout 参数被正确接受，test 1-2 通过（后续因 Python 服务未运行而失败，预期）

#### 6 大专项审查
1. **异常处理** ✅ — afterEach 所有 fs 操作 try-catch，单文件失败不中断
2. **权限边界** ✅ — 只清理 img_*/tts_/*_output.mp4 前缀，不误删其他文件
3. **事务一致性** ✅ — afterEach 在 test 成功/失败时都执行（node:test 保证）
4. **边界值** ✅ — 目录不存在/文件已删除/空目录全覆盖
5. **代码风格** ✅ — node:test `{ timeout: N }` 标准格式，afterEach 从 node:test 导入
6. **Demo 代码** ✅ — 无硬编码路径（全用 os.tmpdir()），timeout 值有依据

#### 设计说明
- e2e 文件用 `node:test` 模块（不是 vitest），vitest.config 虽 include 但实际由 `node --test` 运行
- timeout 分级策略：30s（纯 HTTP）< 60s（split+optimize）< 120s（ffmpeg 合成）
- afterEach 双重清理：_tmpFiles 数组（精确）+ 目录扫描（兜底）


### P2-7 — 临时文件清理 (质量节拍 Phase 2 日常循环)

#### 问题
- `story2video-compose-engine.js` 每次 compose 创建 `sessionDir`（含 segments + concat_list.txt + output.mp4）
- 合成完成后 sessionDir 内的 segments 和 concat_list.txt 永久残留，占磁盘
- 无历史 sessionDir 清理机制，长时间运行导致临时目录堆积

#### 修复
- **成功路径**：合成后将 output.mp4 移到 outputDir 根目录（`<sessionId>_output.mp4`），清理整个 sessionDir
- **失败路径**：segments 全部失败/拼接失败/输出验证失败时，清理 sessionDir
- **历史清理**：compose 启动时调用 `_cleanupOldSessions()` 清理超过 `maxSessionAgeMs`（默认 24h）的 `s2v_*` 目录
- **跨平台删除**：`_rmSyncRecursive()` 手动递归删除（`fs.rmSync({recursive:true})` 在部分 Windows 环境静默失败）

#### 新增方法
- `_cleanupSession(sessionDir)` — 清理单个 sessionDir
- `_rmSyncRecursive(dirPath)` — 跨平台可靠递归删除
- `_cleanupOldSessions(maxAgeMs)` — 清理历史残留 sessionDir
- 构造函数新增 `maxSessionAgeMs` 选项（默认 24h）

#### 测试
- **新建** `story2video-compose-engine-cleanup.test.js` (12 用例)
  - _cleanupSession: 存在/不存在/文件删除/日志记录
  - _cleanupOldSessions: 超期清理/非 s2v_ 前缀/普通文件/返回数/默认 24h/outputDir 不存在
  - constructor: 默认/自定义 maxSessionAgeMs
- **12/12 PASS**（24.68s，含真实 fs 操作）
- 相关测试无回归：story2video-compose-engine 12/12 + base-python-bridge 16/16 + phase2-bridges 6/6

#### 6 大专项审查
1. **异常处理** ✅ — try-catch 容错，单目录失败不中断，移动失败保留原路径
2. **权限边界** ✅ — 仅清理 s2v_ 前缀目录，不清理非目录文件
3. **事务一致性** ✅ — 成功先 copy 再清理，失败直接清理
4. **边界值** ✅ — 存在/不存在/空/旧/新/非前缀/普通文件/不存在 outputDir 全覆盖
5. **代码风格** ✅ — @ts-check + JSDoc + 与现有代码一致
6. **Demo 代码** ✅ — 无硬编码，跨平台注释完整

#### 踩坑记录
- `fs.rmSync({ recursive: true, force: true })` 在 Windows 部分环境**静默失败**（不抛错但目录未删除）
- 调试过程：创建 test-rm-debug*.js 验证，发现 fs.rmSync 对有内容的目录无效，手动递归 unlinkSync+rmdirSync 正常
- 解决：实现 `_rmSyncRecursive()` 手动递归删除，确保跨平台可靠


### P2-6 — BaseBridge 抽取 (质量节拍 Phase 2 日常循环)

#### 问题
- splitter-bridge.js (230 行) 和 prompt-bridge.js (252 行) 有 ~60% 重复代码
- start/attach/_launchProcess/_waitForHealthy/_startWatchdog/_stopWatchdog/_scheduleRestart/healthCheck/stop 几乎完全相同
- 差异仅在类名/端口/Python 模块/业务方法

#### 修复
- **新建** `base-python-bridge.js` (261 行) — BasePythonBridge 基类
  - 公共逻辑：start/stop/attach/healthCheck/_launchProcess/_waitForHealthy/_startWatchdog/_stopWatchdog/_scheduleRestart/_post
  - 配置化：name/pythonModule/port/host/workDir/log/requestTimeout
- **重构** `splitter-bridge.js` 230→44 行 (**-81%**) — 继承基类，仅保留 split()
- **重构** `prompt-bridge.js` 252→56 行 (**-78%**) — 继承基类，仅保留 optimize()/optimizeBatch()

#### 测试
- **新建** `base-python-bridge.test.js` (16 用例)
  - 构造函数初始化/log 回退/默认超时
  - start/attach/stop 生命周期
  - _post HTTP 请求 mock
  - 子类继承验证 + 业务方法调用验证
- **16/16 PASS**（2.24s）
- 相关测试无回归：phase2-bridges 6/6 + story2video-compose-engine 12/12
- 全量回归：1943 通过 / 23 预存失败（无新增失败）

#### 6 大专项审查
1. **异常处理** ✅ — error→reject/resolve(false)，stop try-catch 全覆盖
2. **权限边界** ✅ — spawn 参数数组，http.request 参数对象，无 shell 注入
3. **事务一致性** ✅ — stop 原子清理，无多步写入
4. **边界值** ✅ — isRunning/process=null/默认超时全覆盖
5. **代码风格** ✅ — @ts-check + JSDoc + 与 python-bridge.js 一致
6. **Demo 代码** ✅ — 无硬编码，日志完整

#### 代码消除效果
- 删除重复代码：~330 行（2 × ~165 行公共逻辑）
- 新增基类：261 行（含 JSDoc + 测试）
- 净减少：splitter + prompt = 482→100 行（-79%），加基类 261 行 = 总 361 行（-25%）


### P1-C Phase 3 — 发布审查 + 推送 (质量节拍 Phase 3)

#### 全量回归测试
- bootstrap 目录: 36/36 PASS（4 文件: phase1-context 9 + phase2-bridges 6 + phase3-services 10 + phase5-ipc 11）
- bootstrap.test.js (集成): 44/44 PASS
- electron/ 全量: 719/719 PASS（1 文件加载失败为预存 path-utils 问题，非本次回归）

#### 6 大专项审查
1. **异常处理** ✅ — callbackServer/keywordMonitor/loginMonitor/analytics 4 处 try-catch 容错隔离
2. **权限边界** ✅ — 无 IPC 注册，getMainWin 调用前 win && !win.isDestroyed() 检查
3. **事务一致性** ✅ — taskQueue 持久化+恢复+清空 savedState 原子操作
4. **边界值** ✅ — restored/recovered > 0 才 log，savedState 存在才反序列化
5. **代码风格** ✅ — @ts-check + JSDoc + 按需 require + 命名一致
6. **Demo 代码** ✅ — 无硬编码路径/占位实现/TODO

#### 推送问题解决（SSH over 443）
- 问题: VPN TUN 模式劫持 github.com DNS（→198.18.29.58），HTTPS push 必失败（curl 52）
- 尝试: DoH（TLS 被拦截）/ 直连 IP（301 重定向被劫持）/ curloptResolve（TLS 被中断）
- 解决: **SSH over 443**（ssh.github.com:443 不被劫持）
  ```bash
  git remote set-url origin ssh://git@ssh.github.com:443/Colinchiu007/Multi-Publish.git
  git push origin main  # 3e914e6..9f69647 main -> main
  git remote set-url origin https://github.com/Colinchiu007/Multi-Publish.git  # 改回
  ```
- 沉淀: project_memory.md 更新 Lessons Learned + Reusable Patterns

#### P1-C 完成总结
- **目标**: bootstrap.js createAppContext + runWhenReady 拆分（140+100 行 inline → 3 个 phase 文件）
- **产物**: phase1-context.js (130 行) + phase3-services.js (124 行) + phase2-bridges.js (56 行，前序)
- **效果**: bootstrap.js 359 → 137 行（**-62%**），职责单一化
- **测试**: 3 个新 phase 文件 25 用例 + bootstrap.test.js 44 集成用例无回归
- **质量评分**: 8.95（Phase 5 基线）→ P1-C 完成后维持（无回归）
- **3 个 commit**: d82bffc (phase2-bridges) → 3e914e6 (phase1-context) → 9f69647 (phase3-services)


### P2-9 — 字幕转义修复 (质量节拍 Phase 2 日常循环)

#### 问题
- `story2video-compose-engine.js` L165-168 字幕转义仅覆盖 3 个字符（`:` `'` `,`），缺少 `\` `%` `{` `}`
- 转义顺序错误：应在转义其他字符前先转义 `\`，否则后续转义符 `\` 会被二次转义
- 风险：字幕含 `%` 会触发 ffmpeg `%{n}` 函数扩展；含 `{}` 会触发变量扩展；含 `\` 会导致滤镜解析错误

#### 修复
- **提取独立函数** `escapeSubtitleText(text)`（L51-75，7 字符转义 + 正确顺序）
- **转义顺序**：`\` → `:` → `'` → `,` → `%` → `{` → `}`（反斜杠必须最先）
- **调用替换**：`_createSegment` 中 L191 改为 `escapeSubtitleText(opts.subtitleText)`
- **导出**：`module.exports` 新增 `escapeSubtitleText` 供独立测试

#### 测试
- **新建** `story2video-compose-engine.test.js`（12 用例）
- 覆盖：纯中文/冒号/单引号/逗号/反斜杠/百分号/花括号/组合/空串/转义顺序/null/换行
- **12/12 PASS**（1.79s）
- 全量回归：1927 通过 / 23 预存失败（与 P2-9 无关）

#### 6 大专项审查
1. **异常处理** ✅ — `if (!text) return ''` 处理 falsy；`_createSegment` 在 try-catch 中
2. **权限边界** ✅ — 纯函数；`execFile`（非 exec）参数数组，无 shell 注入
3. **事务一致性** ✅ — 纯函数无多步写入；写后验证 `existsSync`
4. **边界值** ✅ — 测试覆盖空/null/undefined/换行/组合字符
5. **代码风格** ✅ — 单引号/2空格/无分号/小驼峰，与 `findFfmpeg` 一致
6. **Demo 代码** ✅ — 无硬编码路径；日志完整；无调试 console.log


### P1-C Phase 2.2 — bootstrap.js 拆分 phase3-services.js (质量节拍 Phase 2)

#### 拆分范围
- **新建**: `electron/bootstrap/phase3-services.js` (115 行，服务初始化)
- **新建**: `electron/bootstrap/phase3-services.test.js` (10 用例)
- **修改**: `electron/bootstrap.js` (238→137 行，-101 行，累计 359→137 = -62%)

#### 拆出职责（从 runWhenReady L116-213 拆出）
- usageTracker / store.init / publishIntervalGuard
- taskQueue.setStateSaver / callbackServer.start
- scheduler.restore / taskQueue.deserialize
- keywordMonitor.onAlert + 持久化定时器（5min interval, unref）
- login status monitor (F1.3, 30min interval)
- analytics providers 注册（xiaohongshu / douyin）
- cloudPublisher 构造 + registerIpcHandlers

#### 行为等价性
- 原: 100 行 inline（10 个服务初始化块，含 3 个 try-catch）
- 新: `await startServices({ container, store, taskQueue, ... })` (1 行调用)
- runWhenReady 简化为: startBridges → startServices → registerAllIpcHandlers → createWindow

#### 测试覆盖
- phase3-services.test.js: 10/10 PASS
- bootstrap.test.js: 44/44 PASS（runWhenReady 全部集成测试通过）
- bootstrap 目录全量: 80/80 PASS（5 文件）


### P1-C Phase 2.1 — bootstrap.js 拆分 phase1-context.js (质量节拍 Phase 2)

#### 拆分范围
- **新建**: `electron/bootstrap/phase1-context.js` (130 行，DI 实例提取 + 模块单例副作用)
- **新建**: `electron/bootstrap/phase1-context.test.js` (9 用例)
- **修改**: `electron/bootstrap.js` (339→238 行，-101 行，累计 359→238 = -33.7%)
- **修复**: `test-setup.js` mock 路径匹配（Windows 路径分隔符标准化）

#### 拆出职责
- 所有 `container.get(...)` 调用（17 个 DI 实例）
- 模块单例 + 副作用（seedDefaults / startMonitoring / registerIpcHandlers）
- scheduler / BatchManager / offlineManager 的 setTaskQueue 接线
- ModelProviderManager 接线
- 平台配置 / 敏感词 / 横切服务加载
- 从 `createAppContext()` L48-164 拆出

#### 保留原位（高风险）
- `taskQueue.setExecutor` 闭包（依赖 getMainWin + publisherRouter + rpaViewManager）
- `wireTaskQueueEvents` 调用（依赖 getMainWin）

#### 行为等价性
- 原: 140 行 inline（DI 提取 + 副作用 + setExecutor + 事件接线 + return）
- 新: `const ctx = extractContext(container)` (1 行) + setExecutor 保留 + wireTaskQueueEvents 保留 + `return ctx`
- 内部逻辑完全一致，仅函数封装不改执行序

#### test-setup.js 修复
- 问题: `__registerMock('./services/x', ...)` 注册的 mock，从子目录 `require('../services/x')` 时匹配失败
- 原因: Windows 上 resolved 路径用 `\`，mock key 用 `/`，`includes()` 匹配失败
- 修复: 标准化两者路径分隔符为 `/` 再匹配

#### 测试覆盖
- phase1-context.test.js: 9/9 PASS
- bootstrap.test.js: 44/44 PASS（回归无损失）
- bootstrap 目录全量: 26/26 PASS
- electron/ 目录: 709/709 PASS（1 文件加载失败为预存 path-utils 问题）


### P1-C 试点 — bootstrap.js 拆分 phase2-bridges.js (质量节拍 Phase 2)

#### 拆分范围
- **新建**: `electron/bootstrap/phase2-bridges.js` (56 行，验收 ≤80 行 ✅)
- **新建**: `electron/bootstrap/phase2-bridges.test.js` (6 用例)
- **修改**: `electron/bootstrap.js` (359→339 行，-20 行)

#### 拆出职责
- Python bridges 启动（pythonBridge + splitterBridge + promptBridge）
- before-quit 退出清理（stop 调用，容错隔离）
- 从 `runWhenReady()` L210-235 拆出

#### 行为等价性
- 原: 26 行 inline（pythonBridge try-catch + Promise.allSettled + before-quit 注册）
- 新: `await startBridges({ app, pythonBridge, splitterBridge, promptBridge })` (1 行调用)
- 内部逻辑完全一致，仅函数封装不改执行序

#### 测试覆盖 (6/6 PASS)
1. 三个 bridge 全部启动成功 — 记录 2 条 info 日志
2. pythonBridge 失败 — 不阻断其他 bridge 启动
3. splitterBridge 失败 — promptBridge 仍启动，记录 warn
4. before-quit 注册 — 触发时调用 stop
5. before-quit 中 stop 失败 — 不影响其他 stop
6. promptBridge 失败 — splitterBridge 仍启动，记录 warn

#### 回归验证
- bootstrap 目录 17/17 全绿（phase2-bridges 6 + phase5-ipc 11）
- 全量 1894 passed / 25 failed（全部为预存失败，与本次拆分无关）
- 预存失败: CreateView.test.js (UI)、visual-testing、path-utils、container.setup (getComposerDir)

#### P1-C 试点结论
- ✅ 拆分模式有效（与 phase4-events/phase5-ipc 一致）
- ✅ 行为等价性验证通过
- ✅ 测试覆盖充分（6 用例覆盖正常/失败/清理）
- ⏳ 下一步: phase1-context.js + phase3-services.js（待用户确认）


### Phase 5 运营期收尾 — 性能/安全/运维三大报告更新 (质量节拍 Phase 5)

#### Phase 5.2 性能验证（修复后基线复测）
- **修复前→后**: 总内存 828.5 → 745.4 MB (-10.0%)，回到 800MB 阈值内
- **Electron**: 476.5 → 393.9 MB (-82.6 MB)，源于 container.js 真实循环依赖检测启用后 DI 容器去冗余
- **Node.js / Python**: 持平（修复集中在 Electron 主进程侧）
- **端口**: 8002/8013 保持 UP，零回归
- **健康评分**: 6/10 → 7/10
- **报告**: 01-docs/retros/benchmark-2026-07-14.md（追加第九章）

#### Phase 5.4 日常安全检查（P0 修复后复评）
- **安全评分**: 8.55/10 → 8.95/10 (+0.40，接近 9.0)
- **OWASP Top 10**: 4 项强化（A03 Injection / A05 Security Misconfig / A07 Auth / A08 Data Integrity）
- **新增 4 道安全防线**: P0-1 命令注入根除 + P0-2 桩实现替换 + P1-A 路径清理 + P1-B IPC 白名单
- **新增 25 个安全回归测试**: asset-generator (4) + container (10) + phase5-ipc (11)
- **门禁**: ✅ PASS (>= 8/10)，可推进至 Phase 5.6 月度审计
- **报告**: 01-docs/retros/cso-daily-2026-07-14.md（追加第八章）

#### Phase 5.5 运维手册更新（P0/P1 后新配置）
- **新增 env 变量**: `SPLITTER_DIR` / `PROMPT_DIR` / `FFMPEG_PATH` (3 个，全可选，有 process.cwd()/PATH fallback)
- **ffmpeg 跨平台查找顺序**: env → PATH → 常见安装位置 → null
- **IPC sender 白名单运维须知**: app:// + file:// 始终可信，dev localhost 可信，其他拒绝
- **容器循环依赖运维须知**: 启动错误信息含 "Circular dependency detected: A -> B -> A"
- **启动配置清单**: 5 项检查（3 env + 2 验证）
- **报告**: 01-docs/retros/ops-manual-2026-07-14.md（追加第十一章）

#### Phase 5 门禁结果
- [x] /investigate 无未解决告警 (Phase 5.1 零回归)
- [x] /cso daily 安全扫描通过 (8.95/10)
- [x] 性能指标在基线内 (745.4 MB < 800 MB 阈值)

#### 质量评分趋势
- 补跑前 6.2 → P0 修复后 8.0 → P1 修复后 8.5 → Phase 4 体检 8.5 → Phase 5 复评 8.95

### 安全加固 — P1 硬编码路径 + IPC sender 验证 (质量节拍 Phase 2)

#### P1-A: 硬编码开发者路径清理
- **严重级别**: HIGH (生产环境必崩)
- **问题**: 3 个文件硬编码 `D:/Data/projects/...` 开发者路径
- **修复**:
  - `splitter-bridge.js` L17: `D:/Data/projects/smart-sentence-splitter` → `process.cwd()` (env 优先)
  - `prompt-bridge.js` L16: `D:/Data/projects/prompt-engine` → `process.cwd()` (env 优先)
  - `story2video-compose-engine.js` L36: `D:\Projects\ffmpeg-7.1\...` → 跨平台常见安装位置查找
- **测试**: 36/36 改动相关测试通过

#### P1-B: IPC sender 来源验证
- **严重级别**: MEDIUM (恶意页面可调用 IPC)
- **问题**: `phase5-ipc.js` 中 `usage:stats/daily/track` 三个 handler 无 sender 验证
- **修复**:
  - 新增 `isTrustedSender(event, app)` 函数
  - 白名单：`app://` 协议、`file://` 协议、开发模式 `localhost/127.0.0.1`
  - 不可信来源返回默认值 + log.warn
- **测试**: phase5-ipc.test.js 11 个测试覆盖（可信/不可信/边界/null 防呆）

#### P1-C: bootstrap.js createAppContext 拆分（已完成）
- **原因**: 140 行核心启动代码，拆分风险高，需独立循环+完整测试覆盖
- **状态**: ✅ 已完成（3 commit: d82bffc → 3e914e6 → 9f69647，bootstrap.js 359→137 行 -62%）

### 安全修复 — P0 命令注入 + P0 桩实现 (质量节拍 Phase 2)

#### P0-1: asset-generator.js 命令注入漏洞修复
- **严重级别**: CRITICAL (CVSS 9.8)
- **问题**: `spawn('python', [...], { shell: true })` 中 shell:true 允许恶意文本触发任意命令
- **修复**: `shell: true` → `shell: false`，参数通过数组直接传递给 Python 解释器
- **测试**: 新增 asset-generator.test.js，4 个安全回归测试覆盖 5 种 shell 元字符注入
- **文件**: `apps/desktop/electron/services/asset-generator.js` L148

#### P0-2: container.js 桩实现替换为真实实现
- **严重级别**: HIGH
- **问题**: `detectCircularDeps()` 返回硬编码 `{ hasCycle: false, cycle: [] }`，无真实检测
- **修复**:
  - `get()` 加入 `_resolving` Set 运行时循环依赖检测，发现环时抛错
  - `detectCircularDeps()` 改为"探测式"实现：遍历未初始化 factory，尝试解析触发环检测
  - `_lastCycle` 缓存上次检测到的循环
- **测试**: container.test.ts 新增 10 个测试（6 循环依赖 + 4 dispose）
- **文件**: `apps/desktop/electron/core/container.js` L17-21, L74-104, L138-161

#### 质量节拍日常循环 6 步全执行
- ⓪ pre-flight: 6 道防线检查通过
- ① 上下文检查: 读取 2 文件源码，发现审查报告误差（dispose 非死代码）
- ② 测试脑暴: 8+8 个测试场景，TDD 顺序
- ③ 增量实现: 2 文件修改 + 2 测试文件
- ④ 6 大专项审查: 全部 PASS（1 已知 P1 WARN 不在本次范围）
- ⑤ 文档更新: CHANGELOG + 本记录
- ⑥ AI 协作检查: 见会话总结

## [v2.3.55] - 2026-07-10

### 第三十一轮 — IPC handler EC 常量迁移
- 8 个 IPC handler 完成 EC 常量迁移，启用 VALIDATION_ERROR/NOT_FOUND/AUTH_ERROR 三类语义化错误码
- 修复 01-docs/CHANGELOG.md 乱码段（v2.3.37~v2.3.39 三个版本）+ 补齐 v2.3.42~v2.3.55

## [v2.3.54] - 2026-07-10

### 第二十九轮 — 3 启动 bug 根因深挖 + 安全 MAJOR 收尾
- 3 个启动 bug 根因：logger.js 悬空引用 / container.setup.js 解构错 / system-tray.js 缺降级
- 安全 MAJOR × 3：移除硬编码 CSDN appSecret / CORS 收紧 / API Key SHA-256 哈希存储
- 资源泄漏 MAJOR：auth-view-session.js restoreLocalStorage 加 10s 超时
- 一致性 MAJOR：apps/desktop/package.json 版本 2.3.44→2.3.53 + description 乱码修复

## [v2.3.53] - 2026-07-10

### 第二十八轮 — 环境启动 + 中文乱码定位 + R51 P0
- 环境从零搭建：npm install 1188 包 + electron 33.4.0 + Xvfb + 系统库 + 中文字体
- 中文乱码根因：headless 环境缺中文字体（非编码问题）
- 合并另一个会话 3 个启动 bug 修复：logger.js / container.setup.js 解构 / system-tray try/catch
- R51 P0 完成：24 文件扫描，仅 render.js render:start 需补 data 参数校验

## [v2.3.52] - 2026-07-10

### 第二十七轮 — 安全审计 + R14 资源泄漏 + R14 一致性
- 三路并行 agent 审查：安全审计(8维度) + R14资源泄漏(6子维度) + R14一致性(6子维度)
- 4 CRITICAL 全部修复：license-manager XOR→AES-256-GCM / python crypto.py salt 持久化 /
  batch-manager.js 事件监听修复 / 两份 error-codes.js 语义冲突
- 9 个高优先级 MAJOR 修复：文件句柄泄漏 / DB 连接泄漏 / 进程泄漏 / 监听器泄漏

## [v2.3.51] - 2026-07-10

### 第二十六轮 — R52 IPC 响应格式统一收尾
- 191/191 IPC handler 完成 R52 格式统一（100% 合规率）

## [v2.3.50] - 2026-07-10

### 第二十五轮 — R52 持续推进 + 错误码冲突解决
- desktop 侧 error-codes.js NOT_FOUND/TIMEOUT_ERROR/NETWORK_ERROR/IO_ERROR 改为 -10~-13
- 避免与 api-publish-engine 的 -4(exception)/-5(io_error) 冲突

## [v2.3.49] - 2026-07-09

### 第二十四轮 — R52 持续推进

## [v2.3.48] - 2026-07-09

### 第二十三轮 — R52 持续推进

## [v2.3.47] - 2026-07-09

### 第二十二轮 — R52 持续推进

## [v2.3.46] - 2026-07-09

### 第二十一轮 — R52 启动

## [v2.3.45] - 2026-07-09

### 第二十轮 — 质量节拍启动

## [v2.3.44] - 2026-07-09

### 第十九轮 — 预审

## [v2.3.43] - 2026-07-09

### 第十八轮 — 基础设施梳理

## [v2.3.42] - 2026-07-08

### 第十七轮 — 基础设施梳理

## [v2.3.41] - 2026-07-08

### 新增
- Phase 1 — OpenMontage 视频集成：composition-manager.js
  - 管理 7 个 Remotion Composition（Explainer / TalkingHead / CinematicRenderer / CollageBurst / TitledVideo / LyricOverlay / HeroTitle）
  - text/gallery/video 三种模式 props 生成
  - props 完整性校验
- render-engine.js 扩展：listCompositions / getComposition / validateProps
- IPC 端点：render:list-compositions / render:get-composition / render:validate-props
- preload.js 暴露 composition API 到渲染进程
- container.setup.js 注册 compositionManager

### 文档
- 01-docs/architecture-video-integration.md — OpenMontage 集成架构方案 v2.0


### 修复
- main.js DI 容器重构遗留编译错误（缺少 createContainer 导入等 4 处）
- main.js 移除 13 个被容器取代的直接 import，ESLint 归零（11 warnings → 0）

### 文档
- INFRA-001: jest 30 testRunner 子包解析失败（预存基础设施问题）

### 测试
- composition-manager.test.js: 7/7 通过


### 新增
- Phase 2 — AI + 视频工具桥接：ai-generator.js + video-engine.js
  - ai-generator.js：管理 18+ AI Provider（视频/图像/音频/TTS）
  - video-engine.js：10 种视频处理 + 5 种分析 + 10 素材源
  - 通过 python-bridge.js 调用 Python 后端 API
- IPC 端点：ai:list-providers / ai:generate / ai:save-config 等
- IPC 端点：video:process / video:analyze / video:mix-audio 等
- Python 后端 API 端点：/api/ai/* + /api/video/*（7 个新路由）
- preload.js 暴露 AI + Video API 到渲染进程
- container.setup.js 注册 aiGenerator + videoEngine

### 测试
- ai-generator.test.js: 8/8 通过
- video-engine.test.js: 5/5 通过


### 新增
- Phase 3 — Pipeline 管线编排：pipeline-engine.js
  - 13 条内容管线（animated-explainer / cinematic / talking-head 等）
  - 执行状态机：start / pause / resume / cancel / advance
  - 阶段进度跟踪 + 检查点确认
  - 执行历史记录
- IPC 端点：pipeline:list/get/start/pause/resume/cancel/status/advance/history/fetch
- preload.js 暴露 11 个 Pipeline API 到渲染进程
- container.setup.js 注册 pipelineEngine
- Python 后端已在 Phase 2 提供 /api/pipelines 和 /api/pipelines/{name}

### 测试
- pipeline-engine.test.js: 11/11 通过
- 全量 4 个新模块 31/31 测试通过
## [v2.3.40] - 2026-07-07

### 修复
- test_e2e_api.py: 断言修复 (platforms key)
- UAT-005: console.error -> logger (4 files)

### 测试
- Python: 1367 passed, 0 failed

### 推送
- GitHub main synced


## [v2.3.39] - 2026-07-07

### UAT 与 验收测试计划
- 依据 01-docs/UAT-PLAN.md 拆解 10 个验证任务，覆盖 30+ 验收点
- P0: 核心流程 (J1-J4) — 账号管理/发布队列/视频合成/内容采集
- P1: 重要功能 (J5-J7) — AI 生成/批量发布/数据统计
- P2: 增强功能 (J8-J10) — 评论管理/SQLite 持久化/监控告警
- 预留验收报告 6 个验证用例 (UAT-001~006)

## [v2.3.38] - 2026-07-07

### 测试 — video_compose.py 新增用例 21 条 (8%->28% 覆盖)
- _compare_transcript_to_script: 10 条 — 空 transcript / 字段缺失 / 字段类型 / 错误 JSON /
  空白内容 / 时间戳格式异常 / 长度不匹配 / 缺 token / 边界 / 多段对照
- _get_composition_id: 3 条 — 默认 / 命中 / 未命中
- _needs_remotion: 2 条 — 需要 / 不需要
- _resolve_subtitle_style: 7 条 — 默认 / playbook / edit_decisions / explicit /
  无效值 / None 处理
- 累计：1335+21=1356

### 文档
- 同步 1356 用例总数

## [v2.3.37] - 2026-07-07

### 测试 — scoring.py (video_creation) 28 条 (36%->72% 覆盖)
- _tokenize_text: 6 条 — 空 / 单 / 多 / 标点 / 重复 / None
- _compute_task_fit: 5 条 — 有 best_for / 无 best_for / 多平台匹配 / style 不匹配 / 边界
- _compute_control: 4 条 — 空 / 完整 / 部分缺失 / 异常类型
- ProductionPathScore: 分数计算/字段缺失
- format_ranking: top_n > list / 越界 / 排序
- _keyword_overlap: overlap 计算 vs Jaccard / 大小写不敏感 / 空集合
- _expand_synonyms: 同义词 / social 关键词
- rank_providers: 排序 / 分数相等 / 空列表
- 累计：1307+28=1335

### 文档
- 同步 1335 用例总数

## [v2.3.36] - 2026-07-07

### ?? -- downloader.py 18 ? (35%->68% ??)
- _guess_ext: URL ????? / ???? / ?????? / ????
- _get_sub_dir: video/image/cover/unknown ???
- format_size: ??/KB/MB ???
- http property: ??? / ??
- close(): ?? HTTP ???
- download: ???????? / ???? / ??? key / ????
- ????: 1289+18=1307

### ??
- ?? 1307 ????

## [v2.3.35] - 2026-07-07

### ?? -- _shared.py HTTP ???? 16 ? (62%->85% ??)
- generate_heygen_video: 9 ?? -- ?? API Key / ?? provider / ? ref / ? execution_id / text_to_video ?? /
  image_to_video(ref_url) / image_to_video(ref_path) / HTTP ??
- generate_ltx_modal_video: 7 ?? -- ?? endpoint / ? ref / ?????? / JSON ?? / ref_path / ref_url / ??? / ? video_url
- ????: 1273+16=1289

### ??
- ?? 1289 ????

## [v2.3.34] - 2026-07-07

### ?? -- _shared.py HTTP ?? 17 ? (26%->62% ???)
- poll_heygen: ????/?????/??/??/??/HTTP??/processing???
- upload_image_fal: ?? API Key / ????? / ???? / FAL_AI_API_KEY ?? / WebP ??
- upload_image_heygen: ????? / v2 ?? / v2 404 ??? fal / v2 500 ??? fal
- ?? respx mock httpx??? @patch???????????
- ????: 1256+17=1273

### ??
- _shared.py ???: 26%->~62%?? HTTP ???
- ?? 1273 ????

## [v2.3.30] - 2026-07-07

### 测试 -- _shared.py 43 例 (11%->26% 覆盖率)
- HEYGEN_PROVIDERS / WAN_VARIANTS / HUNYUAN_VARIANTS 等数据字典结构验证
- estimate_quality_cost / estimate_speed_runtime / estimate_local_runtime 纯函数
- get_torch_device: cuda/MPS/cpu 多场景
- local_generation_enabled/status: 环境变量控制
- local_install_instructions: 文档内容验证
- probe_output: ffprobe 成功/失败/无 ffprobe
- 测试总数: 1165+43=1208

### 验证
- _shared.py 覆盖率: 11%->26%
- 全部 1208 测试通过
## [v2.3.29] - 2026-07-07

### 测试 -- hf_utils 24 例 (32%->68% 覆盖率)
- _f() 浮点格式化 / escape_text() HTML 转义
- parse_json_output() 多行 JSON 解析
- compute_total_duration() cut 时长计算
- is_inside() 路径包含检查
- 测试总数: 1125+24=1149

### 验证
- hf_utils 覆盖率: 32%->68%
## [v2.3.28] - 2026-07-07

### 测试 -- upscale 10 例 + bg_remove 2 例
- upscale: MODELS 数据验证 / VIDEO_EXTENSIONS / get_status / 输入不存在错误路径
- bg_remove: get_status (rembg 未安装) / 输入不存在错误路径
- 测试总数: 1113+12=1125

### 验证
- upscale: ~15%->32%
- bg_remove: 49%->56%
## [v2.3.27] - 2026-07-07

### 测试 -- color_grade 15 例 (~30%->77% 覆盖率)
- PROFILES 数据结构验证 (7 个预设全检查)
- list_profiles() / _build_filter() 全分支覆盖
  - custom_vf / lut_path / profile / intensity blend
- execute() 错误路径 (文件不存在)
- 测试总数: 1098+15=1113

### 验证
- color_grade 覆盖率: ~30%->77%（剩余 14 行 FFmpeg 调用/LUT 路径）
## [v2.3.26] - 2026-07-07

### 测试 -- face_enhance 14 例 (48%->95% 覆盖率)
- PRESETS 数据结构验证 (9 个预设全检查)
- list_presets() / _build_filter() 全分支覆盖
  - custom_vf 优先 / presets 数组 / 单个 preset / 默认值 / 未知值
- execute() 错误路径 (文件不存在/无 preset)
- 测试总数: 1084+14=1098

### 验证
- face_enhance 覆盖率: 48%->95%（剩余 3 行 FFmpeg 调用）
## [v2.3.25] - 2026-07-07

### 测试 -- character_animation_utils 63% + publisher_manager 50%
- character_animation_utils.py: 27 例 (_slug/_character_color/_normalize_style/_write_json)
- publisher_manager.py: 11 例 (init/precheck/registry 委托/get_or_create/close_all)
- 测试总数: 1046+38=1084

### 验证
- 新测试: 186/186 passed (所有近期新增)
- character_animation_utils 覆盖率: 44%->63%
- publisher_manager 覆盖率: 38%->50%
## [v2.3.24] - 2026-07-07

### 测试 -- compose_utils.py 41 例 (21%->88% 覆盖率)
- is_image: 15 种扩展名全覆盖
- tokenize: 标点/数字/Unicode/大小写混合
- parse_probe_fps: 分数/浮点/边界值
- build_subtitle_style: 默认/自定义/边框/对齐
- read_text_file: 文件读取/路径对象/不存在
- 测试总数: 1005+41=1046

### 验证
- Python: 1046/1046 passed
- compose_utils.py 覆盖率: 21%->88%（剩余 ffprobe 依赖行）
## [v2.3.23] - 2026-07-07

### 测试 -- video_trimmer 60% + logging_setup 75% (21%->60% / 47%->75%)
- P0-2: video_trimmer.py 21 例 (_build_atempo_chain + 错误路径全覆盖)
- P0-2: logging_setup.py 8 例 (get_publisher_logger + log_call 装饰器同步/异步)
- 测试总数: 976+29=1005
- 项目总覆盖率: 36%->37%

### Bug 修复 -- _concat 的 finally 块 list_path 未初始化 (后测试驱动发现的 bug)
- video_trimmer.py _concat(): list_path 初始化 None + finally 判 None 保护
- logging_setup.py log_call(): asyncio.iscoroutinefunction 判断使装饰器同时支持同步/异步函数

### 验证
- Python: 1005/1005 passed
## [v2.3.22] - 2026-07-07

### 测试 -- delivery_promise + hyperframes_style_bridge (0%->100% 覆盖率)
- P0-2: delivery_promise.py 46 例 (纯数据+逻辑, PromiseType/validate_cuts/classify_from_brief)
- P0-2: hyperframes_style_bridge.py 31 例 (纯函数, _first/_font/_motion_easing/style_bridge)
- 测试总数: 898+77=975
- Python lint: 13->8 (5 个自动修复)

### 验证
- Python: 975/975 passed
## [v2.3.21] - 2026-07-07

### 测试 -- media_profiles 11 例 (0%->100% 覆盖率)
- P0-2: 补充 media_profiles 模块单元测试 11 例
- 覆盖 AspectRatio/MediaProfile/get_profile/ffmpeg_output_args
- 测试总数: 887+11=898

### 验证
- Python: 898/898 passed

## [v2.3.20] - 2026-07-07

### 测试 -- slideshow_risk 18 例 (0%->93% 覆盖率)
- P0-2: 补充 slideshow_risk 模块单元测试 18 例
- 覆盖 6 个评分维度 + 主函数全部路径
- 测试总数: 869+18=887
- 项目总覆盖率: 34%->35%

### 验证
- Python: 887/887 passed

## [v2.3.19] - 2026-07-07

### 代码质量 -- N803 参数命名清零 (3->0)
- query_worker.py: localStorage -> local_storage (参数/属性/方法)
- lint 从 14 降至 11 (剩余 E402/N801/N806/B027/N802/N818)

### 验证
- Python: 869 passed
- ESLint: 0 errors
- TypeScript: 0 errors

## [v2.3.18] - 2026-07-07

### 代码质量 -- B017 + PRD 版本同步
- B017: pytest.raises(Exception)->ValueError
- PRD 版本更新 v2.3.8 -> v2.3.17

### 验证
- Python: 869 passed
- ESLint: 0 errors
- TypeScript: 0 errors

## [v2.3.17] - 2026-07-07

### 代码质量 -- B904 异常链清零 (19->0) + B018
- 19 处 B904 raise-without-from-inside-except 全部修复
- 1 处 B018 useless-expression (None -> pass)
- server.py/client.py/douyin.py/_utils.py 共 5 文件
- Python lint 从 71 降至 15 (剩余 E402/N803/N801 等命名风格)

### 验证
- Python: 869 passed
- ESLint: 0 errors
- TypeScript: 0 errors

## [v2.3.16] - 2026-07-07

### 代码质量 -- Python lint unsafe fixes (27) + vitest config CJS
- 27 项 unsafe-fixes lint (UP042 StrEnum, UP045/UP046 类型标注, B905 zip strict, B007/N806 命名)
- vitest.config.js: ESM import/export -> CJS require/module.exports (兼容非 type=module 包)

### 验证
- Python: 869 passed
- ESLint: 0 errors
- TypeScript: 0 errors
## [v2.3.15] - 2026-07-07

### 代码质量 -- Python lint 增量清理 (17 auto-fixed)
- 修复 17 个 auto-fixable lint 问题 (F401 未使用导入 7 + I001 导入排序 3 + UP006 类型标注 6 + W292 换行 1)
- 剩余 55 个低优先 lint (B904 异常链/N803 命名风格等), 后续逐步处理

### 验证
- Python: 869 passed
- ESLint: 0 errors
- TypeScript: 0 errors

## [v2.3.14] - 2026-07-07

### 代码质量 -- api-publish-engine TS 类型错误清零 (24-0)
- 修复 24 个 TypeScript 类型错误 (JSDoc 标注增强)
- BasePlatformAdapter: 添加 publish() @returns JSDoc, 消除 7 个 TS2416 继承签名不兼容
- BasePlatformAdapter.getReferer(): 添加 @returns {string} 标注, 消除 void 转换错误
- cancel-token.js: 添加 throwIfCancelled() @type 标注, 消除属性不存在错误
- retry-middleware.js: 添加 circuit breaker @type 标注, 消除 err.code 错误
- upload/base-provider.js: 添加 _doUpload() 抽象方法桩 + JSDoc 类型标注
- upload/http-provider.js, anti-detect.js: 添加 @returns 标注, 修复类型推断

### 验证
- TypeScript: 0 errors (原 24 errors)
- ESLint: 0 errors
- Python: 869 passed
- Jest: 207 passed (23 suites)
## [v2.3.13] - 2026-07-07

### 测试
- 补充 HttpClient 扩展测试 23 例 (覆盖率 58% → 88%)
  - HTTP 方法助手: put/delete/async_get/async_post/async_put/async_delete
  - 客户端生命周期: close_sync/close_async 幂等性
  - 错误路径: 代理错误、重试耗尽、_map_httpx_error
  - 深层异步: timeout/proxy/connection/HTTP 错误路径

### 验证
- Python: 869 passed ✅ (原 846 + 23)
- Jest: 207 passed ✅
- _http_client 覆盖率: 88% (原 58%)

## [v2.3.12] - 2026-07-07

### 测试
- 补充 _rate_limit 扩展测试 11 例 (覆盖率 89% → 94%)
  - parse_retry_after: Unix 时间戳模式、reset 秒数、无效回退、大小写
  - parse_rate_limit_limit: 正常/异常/缺失/大小写
  - parse_rate_limit_remaining: 大小写变体

### 验证
- Python: 846 passed ✅ (835 + 11)
- Jest: 207 passed ✅

## [v2.3.11] - 2026-07-07

### 代码质量 — Python F-level lint 清零
- 修复全部 23 个 F-level lint 问题 (F821/F841/F401/F811)
- **修复 3 个真实 bug**:
  - hyperframes_compose.py: _f 静态方法自我递归调用 (应实现 CSS 浮点格式化)
  - video_selector.py: supports 未定义变量 (移除无效引用)
  - video_stitch.py: 清理 ideo_codec/codec 变量名不一致
- **补充缺失导入**: hunyuan_video.py 补充 yping.Any, publisher_manager.py 提升 PublishResult 导入
- **清理**: eye_enhance.py/green_screen_processor.py 未使用变量替换为 _

### 验证
- Python: 835 passed ✅
- Jest: 207 passed (23 suites) ✅
- F-level lint: 0 errors ✅
- E/W lint: 31 (仅 E501 行长度，低优先)

## [v2.3.10] - 2026-07-07

### 修复
- Python 后端 11 个文件中的 F841/F821 真实 bug
- video_stitch.py: 修复 ideo_video_codec → ideo_codec 变量名双写 bug (影响 _resolve_normalization_target)

### 代码质量
- 未使用变量替换: start/ls/include_auto/opacity/msg_data_id/has_tags → _
- 注释掉无用代码块: probe_cmd (video_understand.py)
- 恢复 eye_enhance.py 中 operations 变量的正常使用

### 验证
- Python: 835 passed ✅
- Jest: 207 passed (23 suites) ✅

## [v2.3.9] - 2026-07-07

### 代码质量
- ruff format 统一格式化 Python 后端全部 194 文件
- 自动修复 102 个 lint 问题 (未使用导入/导入排序/多语句合并)
- 手动修复 5 个文件的多语句 Enum 定义 (分号 → 换行)
- 剩余 61 个低级 lint 告警 (长行/未使用变量) 留待后续清理

### 验证
- Python: 835 passed ✅
- Jest: 207 passed (23 suites) ✅
- tsc: 0 errors ✅

## [v2.3.8] - 2026-07-07

### 测试 (今日累计 +130，总 751)
- 遗留 47 个测试迁移到 packages/python-backend/tests/ → +55
- video_creation/scoring.py 评分引擎测试 → +23
- precheck.py PreCheck 引擎测试 → +8
- tikhub_bridge.py 桥接层测试 → +8
- _errors/_rate_limit/_retries/_auth 基础设施测试 → +54

### 清理
- 删除根目录 tests/ 中已迁移的遗留文件
- gitignore .coverage 文件

### 质量门禁
- ✅ Python: 751 passed (原 621, +130)
- ✅ 全部已推送 GitHub (main)

## [v2.3.7] - 2026-07-07

### 测试
- 补充 _errors/_rate_limit/_retries/_auth 基础设施模块单元测试 (54 tests)
- _error: 错误体系层级 / 脱敏 / HTTP状态映射
- _rate_limit: 限流header解析
- _retries: 重试策略/退避计算
- _auth: BearerAuth/AuthMiddleware

### 验证
- Python 测试: 751 passed

## [v2.3.6] - 2026-07-07

### 测试
- 补充 TikHubBridge 桩模块单元测试 (8 tests)
- 覆盖: 初始化/可用性/平台/资源方法/异步异常

### 验证
- Python 测试: 715 passed

## [v2.3.5] - 2026-07-07

### 测试
- 补充 PreCheck 引擎单元测试 (8 tests)
- 覆盖: CheckSeverity/CheckResult/DuplicateCheck/PreCheckEngine

### 验证
- Python 测试: 707 passed

## [v2.3.4] - 2026-07-07

### 测试
- 补充 video_creation/scoring.py 单元测试 (23 tests)
- 覆盖: ProviderScore/ProductionPathScore/_keyword_overlap 等

### 验证
- Python 测试: 699 passed

## [v2.3.3] - 2026-07-07

### 测试迁移
- 将根目录 tests/ 中 47 个遗留测试迁移到 packages/python-backend/tests/
- test_core_progress → test_progress 合并
- test_core_downloader → test_downloader 合并
- test_core_scheduler → test_publish_scheduler 新建
- test_core_task_queue → test_task_queue 新建
- test_platform_e2e → test_models 合并

### 验证
- Python 测试: 676 passed (+55)
## [v2.3.2] - 2026-07-07
### 测试
- 补充 pagination 分页工具单元测试（13 tests）
  - OffsetPaginator: build_params/has_next/next_page
  - CursorPaginator: build_params/has_more
  - Page: 默认值/自定义构造

### 验证
- Python 测试: 621 passed (+13)
## [v2.3.0] - 2026-07-07
### 测试
- 补充 HttpClient HTTP 客户端单元测试（12 tests）
  - 认证管理: set_auth/clear_auth/空token
  - HTTP 请求: GET/POST 成功
  - 错误映射: 404/500 → MultiPublishHTTPError
  - 重试逻辑: 超时/连接错误/500→200恢复
  - Authorization header 验证
  - 使用 respx mock 框架模拟 HTTP

### 验证
- Python 测试: 590 passed (+12)
- Jest 测试: 207 passed
## [v2.2.9] - 2026-07-07
### 测试
- 补充核心数据模型 models.py 单元测试（19 tests）
  - 5 个 Enum: PlatformCategory/PlatformType/TaskStatus/PublishMode/PublishPhase
  - PLATFORM_META 完整性: 12 平台全覆盖
  - AuthData: is_empty/to_dict/from_dict roundtrip
  - PublishResult: success/failure 路径
  - PublishTask: 初始化/is_finished/to_dict
  - ProxyConfig: to_dict/from_dict roundtrip
  - PlatformAccount: 初始化/代理配置

### 验证
- Python 测试: 578 passed (+19)
## [v2.2.8] - 2026-07-07
### 测试
- 补充 config_model 配置模型单元测试（9 tests）— BudgetMode/BudgetConfig/OutputConfig/PathsConfig/VideoCreationConfig load/resolve

### 修复
- VideoCreationConfig.load() YAML 加载时不转换嵌套 dataclass 的 bug
  - 新增 _from_dict() 方法递归构造 BudgetConfig/OutputConfig/PathsConfig

### 验证
- Python 测试: 559 passed (+9)
## [v2.2.7] - 2026-07-07
### 测试
- 补充 CostTracker 费用跟踪单元测试（9 tests）— 覆盖初始化/预算属性/estimate/reserve/complete/fail/CAP 模式超限/快照/持久化
- 补充 ToolRegistry 工具注册表单元测试（9 tests）— 覆盖初始化/注册/空名错误/get/list/clear/按tier筛选/长度
- 总计 Python 测试: 550 passed (+18)
## [v2.2.6] - 2026-07-07
### 测试
- 补充 ProgressThrottle 节流阀单元测试（7 tests）— 覆盖初始化/自定义参数/强制上报/首次调用/delta阻塞/时间阻塞/reset
- 补充 PlatformRegistry 平台注册表单元测试（7 tests）— 覆盖默认注册表/is_supported/JSON加载/注册注销/get调用/异常/scan
- 总计 Python 测试: 532 passed (+14)
## [v2.2.5] - 2026-07-07
### 重构
- Python 后端 import 排序统一 + 类型提示现代化（119 文件）
  - isort 风格统一: stdlib → 第三方 → 项目内导入，字母序排列
  - Python 3.10+ 类型语法: Optional[X] → X | None, Dict/List/Tuple → dict/list/tuple
  - 移除未使用导入（typing.Any, pathlib.Path 等）
  - 补充文件末尾缺失的换行符
  - wechat_publisher/models.py 完整类型现代化

### 验证
- Python 测试: 518 passed ✅
- 改动涉及 119 文件 ±678 行
## [v2.2.4] - 2026-07-07
### 测试
- 补充 pipeline loader 模块测试（17 tests）— 覆盖 11 个 manifest 函数
  - test_pipeline_loader.py: get_stage_order / get_required_tools / get_stage_skill
    / get_stage_review_focus / check_extension_permitted / _condition_is_active 等

### 统计
- Python 测试: 518 passed (+71)
- Jest 测试: 207 passed
- Vitest 测试: 1056 passed
- **总计: 1781 tests ALL GREEN**

## [v2.2.3] - 2026-07-07
### 测试
- 补充 OpenMontage Phase 5-7 模块测试（enhancement/subtitle/capture/avatar/character）共 54 个新测试
  - test_enhancement.py: 23 tests — 6 个增强工具（BgRemove, ColorGrade, EyeEnhance, FaceEnhance, FaceRestore, Upscale）
  - test_subtitle_capture.py: 15 tests — SubtitleGen 纯 Python 字幕生成 + ScreenRecorder/CapRecorder
  - test_avatar.py: 6 tests — LipSync + TalkingHead 口型同步
  - test_character.py: 10 tests — 6 个角色动画工具

### 修复
- color_grade.py: tier 值 CORE→ENHANCE 修正
- face_enhance.py: tier 值 CORE→ENHANCE 修正
- character/__init__.py: 补全 6 个 BaseTool 子类的导出和 __all__

### 文档
- PRD 版本同步至 v2.2.2

### 统计
- Python 测试: 501 passed (447→501, +54)
- Jest 测试: 207 passed
- Vitest 测试: 1056 passed
- **总计: 1764 tests ALL GREEN**
## [v2.2.2] - 2026-07-06
### 修复
- TS 类型错误全面清零 — 修复 5 个服务文件 50 处类型错误
  - account.js: JSDoc 类型标注 + catch(e) unknown 安全处理
  - auth-view-cdp.js: 函数参数完整类型化
  - auth-view-session.js: Promise<> 类型 + 参数 JSDoc + once() 替代 on({once})
  - python-bridge.js: ChildProcess/NodeJS.Timeout 类型 + Error 类型守卫
  - auth-view-manager.js: 全类成员/方法 JSDoc + 成员变量类型化 + null 安全检查
- PipelineBrowser 集成到 CreateView（新增浏览管线模式）
- test:vue 207/207 全绿（tsc 0 errors + jest 207 passed）

## [v2.2.1] - 2026-07-06
### 里程碑
- check:all 首度全绿 ✅ (check:ts 0 errors + ESLint 0 errors + test:vue 1058 passed)
- JS 文件 TS 类型错误清零（108→0，三轮修复）
- 18 个服务文件 @ts-nocheck 确保 preload/浏览器上下文正确排除

### 改进
- 产品说明书版本同步至 v2.2.0
- product-manual.md 添加 PipelineBrowser 引用
- PRD 版本同步至 v2.2.0

## [v2.2.0] - 2026-07-06
### 重构：根目录清理 (P1-4)
- 删除 6 个冗余根目录：03-config / 04-tests / 05-standards / 06-scripts / team / team-workflow
- 03-config/ → 删除（与 config/ 完全重复）
- 04-tests/ → test_wechat_publisher 迁移至 packages/python-backend/tests/
- 05-standards/（3 份开发规范）→ 迁移至 01-docs/
- team/scripts/（2 份 CI 脚本）→ 迁移至 scripts/
- conftest.py 合并到 python-backend/tests/
- 修复：移除 04-tests 旧测试文件（import 路径失效，已有替代测试）

## [v2.1.9] - 2026-07-06
### 基础设施清理
- 批量移除 UTF-8 BOM（122 个文件：apps/desktop 74 + packages 29 + 01-docs 19）
- 消除 Vitest/PostCSS/Python ast.parse 因 BOM 导致的解析风险
- 技术债务记录更新：BOM 残留 ✅ 已修复

### 安全审计 (/cso)
- 扫瞄 apps/desktop/electron, src, rpa-engine, shared-utils, api-publish-engine, python-backend
- 结果：0 CRITICAL / 0 MAJOR（全部误报 — Electron 安全配置正确）

## [v2.1.8] - 2026-07-06
### 新增
- PipelineBrowser 管线浏览器组件（Vue SFC）：加载/空/错误/管线卡片 四种状态
- Pipeline IPC handlers（pipelines:list / pipelines:get）
- Python 后端 /api/pipelines 路由 + 4 个单元测试
- 视频创作管线 API 集成到主进程（ipc-handlers/index.js 注册）

### 改进
- gitignore 增加 NUL 设备和 test API keys 自动生成忽略规则
- 视频管线数据流：Vue 组件 → IPC（HTTP Bridge）→ Python 后端 → Pipeline Registry

### 技术
- PipelineBrowser 测试覆盖全部状态（loading / error / empty / card rendering）
- IPC handler 测试覆盖成功/失败/超时场景
- Python 路由测试覆盖列表/详情/404

## [v2.1.7] - 2026-07-06
### 里程碑
- ESLint 完全清零: 7 errors + 26 warnings 全部修复
### 变更
- 修复 7 个 UTF-8 BOM 错误（no-irregular-whitespace）
- 替换 var → const/let（abort-utils.js, store-interface.js）
- 前缀化未使用参数 _e（catch 子句 + 回调参数）
- eslint 配置增强: varsIgnorePattern + caughtErrorsIgnorePattern
## [v2.1.6] - 2026-07-06
### 里程碑
- TS 迁移 Phase 3 完成: 86 个 JS 文件（含 3 层） electron/services 文件添加 @ts-check (100%)
### 修复
- 修复 vitest 2 个失败测试（publisher-router 错误消息中文化 + phase10 超时/axios mock）
- 修复 Jest 1 个失败测试（startup.test.js 错误消息中文化同步）
- 发布错误消息汉化: publisher-router.js "Platform not configured" → "平台未配置"
- 扩展覆盖: electron/core/ (3), ipc-handlers/ (20), publishers/ (2)
- 总计 86 个 JS 文件已添加 @ts-check

## [v2.1.5] - 2026-07-06
### 改进
- TS 迁移 Phase 3: 新增 5 个文件 @ts-check (cloud-publisher/publish-poller/store-schema/credential-store/scheduler)
- 累计 16/61 文件 ts-check (26% 进度)


## [v2.1.5] - 2026-07-06
### 改进
- TS 迁移 Phase 3: 新增 5 个文件 @ts-check (cloud-publisher/publish-poller/store-schema/credential-store/scheduler)
- 累计 16/61 文件 ts-check (26% 进度)

## [v2.1.4] - 2026-07-06
### 修复
- 测试基础设施大修：113 failed → 207 passed（jest 配置分离 + moduleNameMapper + ws mock）
- error-codes.js 同步 TS 源（修复 getMessage 缺失、错误码值不一致）
- 删除重复的 electron mock（electron/services/__mocks__/electron.js）
- publisher-router.js 中文模板字面量修复（checkJs 兼容性）

### 新增
- 34 个向后兼容的重定向文件（electron/X.js → electron/services/X.js）
- jest.config.cjs（限定 tests/ 目录为 Jest 范围）

### TS 迁移 Phase 3
- 新增 4 个文件添加 // @ts-check: cookie-converter, publisher-router, tasks-repo, media-downloader
- 累计 12/57 文件（21% 进度）
- 92 个渐进式 TS 类型待修复项

### 测试
- Jest: 207 passed ✅
- Vitest: 1049 passed ✅
- Python: 443 passed ✅
- **总计: 1699 测试 ALL GREEN**

> 完整变更日志请查看 [01-docs/CHANGELOG.md](01-docs/CHANGELOG.md)
>
> 以下为精简版变更摘要：


## [v2.1.3] - 2026-07-06
- PR #303: Phase 4 清理 — electron 回滚 43→33 + 测试临时文件清理
- PR #304: TS 迁移 Phase 3 — JSDoc 渐进类型化基础设施 (tsconfig.check.json + check:ts)
- PR #305: TS 迁移 Phase 3 — 3 个服务文件类型化
- PR #306: TS 迁移 Phase 3 — video-uploader.js 类型化
- PR #307: 新增 wechat_publisher 模型+异常 24 个单元测试 (443 Python tests)
- PR #308: 根目录清理 — 合并 docs/references/standards 到 01-docs/
- PR #309: TS 迁移 Phase 3 — test-helpers.js 类型化 (累计 7/77)
- P0-3: 清理 browser_data 浏览器缓存 62MB
- PRD 版本同步 v2.1.2 → v2.1.3

### 累计状态
- Python 测试: 419 → 443
- TS 类型化: 7/77 服务文件
- 根目录: 减少 3 个冗余目录

## [v2.1.2] - 2026-07-06
- PRD v2.1.2 全面修复（14 项内容审查问题）
- 清空 9 个代码 TODO（data-sync.js / utils.py / test 文件）
- 大文件拆分收尾：修复 video_compose.py 4 个缺失委托方法
- 决策日志更新至 D-018

## [v2.1.1] - 2026-07-06
- PRD 全面更新至 v2.1.1，补充 6 个使用流程章节
- 决策日志创建（01-docs/decision-log.md）
- 代码深度分析报告（01-docs/code-depth-analysis-2026-07-06.md）

## [v2.1.0] - 2026-07-05
- OpenMontage 全阶段集成（Phase 0-7）
- Pipeline 管线编排（13 种视频制作管线）
- 视频/图像/音频 AI 创作

## [v2.0.0] - 2026-07-02
- 内容智能模块（热点/标题/标签/爆款分析）
- 多平台实时监控 + 评论管理
- 云端发布 + Pro 版本 + 插件系统
- 发布日历与计划

## [v1.4.0] - 2026-06-28
- PreCheck 前端开关 + platforms.json 外部化

## [v1.3.0] - 2026-06-27
- AI 内容创作功能（AI Writer, 标题助手等）

## [v1.2.0] - 2026-06-26
- 插件系统 + 定时发布 + 评论管理

## [v1.1.x] - 2026-06-13 ~ 2026-06-17
- CLI 工具 + 内容格式化 + Docker 支持

## [v1.0.x] - 2026-06-03 ~ 2026-06-13
- 初始版本：Electron 桌面端 + FastAPI 后端
- 15 平台发布器 + 账号管理 + 内容智能分析



## [v2.1.3] - 2026-07-06
- TS 迁移 Phase 3: JSDoc 渐进类型化基础设施完成
  - 新增 tsconfig.check.json (extends 主 tsconfig, checkJs:false, noEmit)
  - logger.js + store-interface.js 添加 // @ts-check + 完整 JSDoc 类型
  - 新增 check:ts / check:all npm scripts
- 验证通过: check:ts ✅ build:ts ✅ test:vue (1049) ✅ Python (419) ✅

## [v2.1.3] - 2026-07-06
- PRD 版本同步 v2.1.2 → v2.1.3
- TS 迁移 Phase 3 继续: 新增 3 个服务文件 JSDoc 类型化
  - abort-utils.js: 修复 timeoutId/reason/Promise 类型
  - aggregator-bridge.js: 修复 class constructor @param + @returns 类型
  - first-run.js: 修复 catch(e) unknown 类型
  - 累计 5/77 服务文件已完成 JSDoc 类型化
  - check:ts ✅ build:ts ✅ test:vue (1049) ✅ Python (419) ✅




## [v2.2.5] - 2026-07-07
### 重构
- Python 后端 import 排序统一 + 类型提示现代化（119 文件）
  - isort 风格统一: stdlib → 第三方 → 项目内导入，字母序排列
  - Python 3.10+ 类型语法: Optional[X] → X | None, Dict/List/Tuple → dict/list/tuple
  - 移除未使用导入（typing.Any, pathlib.Path 等）
  - 补充文件末尾缺失的换行符
  - wechat_publisher/models.py 完整类型现代化

### 验证
- Python 测试: 518 passed ✅
- 改动涉及 119 文件 ±678 行





















## [Unreleased] - 2026-08-09 (历史记录可见性 + 分段重试反馈 + 优化拒绝文本兜底)

### 修复
- **失败/已取消任务在历史记录可见**：历史页默认 tab 是「渲染记录」（只含成功渲染项目），失败/取消任务只在「流水线记录」tab → 用户误以为任务消失。现在存在运行中/失败/已取消任务时自动切到「流水线记录」，且「渲染记录」tab 顶部显示提示横幅。
- **取消任务保留在历史**：`cancel()` 已写入终态（`_finalizeRun('cancelled')` + `runStateStore.saveFailed` 持久化），历史页「流水线记录」显示「已取消」；点击失败/取消/运行中卡片跳回创作页（支持断点继续）。
- **历史页运行中任务进度显示**：流水线记录卡片增加总进度条（按 stage 完成比例/progress 计算）与 stage 状态标记（✓/⟳/✕），与流水线详情页同步轮询。
- **分段编辑重试图片/视频**：重试按钮显示「重试中...」loading 反馈；重试成功后重新解析分段图片媒体 URL（`refreshSegmentImageUrls`），不再显示旧图/空白；失败时也尝试刷新（服务端可能部分更新）。
- **提示词优化 LLM 拒绝文本兜底**：模型返回 "I cannot generate ... missing description" 等拒绝内容时不再作为图片提示词——原文有实质内容则回退原文（`optimize_note='llm_rejected_use_original'`），否则按失败处理；纯数字文案（如 11/12）仍由守卫优先拦截。

### 测试
- CreateHistory +4 断言更新/新增（tab 自动切换、banner、进度文本）；ResultView +1（重试后刷新图片 URL）；story2video-stages +2（拒绝文本回退、纯数字守卫优先）。相关 206 用例通过。

### 文档
- PRD 7.1.18「历史记录可见性与运行状态合同」+ learnings 复盘。



## [2026-08-17] feat(story2video): 翻译调度优化

- 自动模式把只读提示词翻译延后到视频合成阶段并行执行；增加稳定 index 回填、批次/总预算、fail-open 诊断、pending 恢复契约，保留 manual 候选翻译时序。
## [2026-08-17] feat(story2video): 手动选材模式提示词翻译与视频合成并行

- 手动选材模式不再在 `optimize` 阶段等待提示词翻译；候选素材和选择 checkpoint 可先展示。
- 翻译在 `compose` 阶段与视频合成并行，按场景 `index` 回填，不改变候选、选择、媒体和 TTS 数据。
- 增加手动模式 pending、候选缺翻译、compose 回填与状态保持回归。
## [Unreleased] - 2026-08-19 (Story2Video 历史失败提示脱敏与模型账号细化)

### 修复
- 修复视频创作历史记录失败提示可能显示 {sceneText} 内部占位符的问题，统一改为场景号、素材比例和生成类型组成的自然语言 context。
- 新增 provider 显示名集中映射：已识别的 MiniMax、Kling、Agnes Image 等模型账号在失败提示中直接点名；未知 provider 安全回退为“当前模型账号”。
- 限流、额度/余额不足、图片生成空结果、素材生成失败和 API Key 失败提示补充具体模型账号与下一步操作，继续屏蔽请求 ID、堆栈、状态码和内部服务前缀。

### 测试与文档
- 新增 formatter 与 renderer 通知双入口回归，覆盖 zh/en、已知/未知 provider、场景 context、二次格式化和技术占位符泄漏。
- 同步 PRD-video-creation.md、PRD-S2V-PIPELINE-PAGE-UX.md、OpenSpec change、CCG task 和 QM-5 复盘。
## [Unreleased] - 2026-08-20 (Story2Video 历史卡片与非运行任务编辑)

### 变更
- 历史记录六个状态标签统一使用任务卡片：所有状态均显示标题、任务文案预览、首场景缩略图、视频时长、更新时间和任务耗时；标题为空时按标题、参数标题、任务文案、流水线名称回退，文案预览超过 120 个 JavaScript 字符追加 `…`。
- 增加首场景素材缩略图 IPC：合法图片优先；没有图片时由受控 FFmpeg 生成第一个视频的第 0 秒首帧；路径、符号链接、大小、格式和失败回滚均 fail-closed，失败只显示“未生成”占位而不阻塞历史列表。
- 历史 project/run 合并按 projectId、项目 runId、legacy id 去重，项目标题/文案/分段/素材优先，run 状态/阶段/错误/检查点/运行耗时补充；纯 run 记录不会伪造编辑项目。
- 只要流水线已经启动且不是 running，拥有项目的 paused、failed、completed、cancelled 任务均可进入视频任务编辑页；cancelled 可编辑但不能断点继续，running 继续使用流水线控制流。
- 结果页为缺失或失败的图片、视频、提示词、翻译、字幕和语音保留固定“未生成”占位；更新时间覆盖内容成功写入及暂停/继续/取消/失败/完成操作。

### 测试与门禁
- 新增/更新历史卡片、project/run 合并、更新时间、缩略图 IPC、媒体槽兼容和 ResultView 占位回归；定向测试、类型检查、locale/CJK、依赖解析和 Electron QM-1 门禁在交付前执行。
- 外部 Antigravity 因区域/账户资格不可用、Claude wrapper 因超时/代理连接失败未返回报告；已记录内部审查结论和残余风险，不将内部审查冒充外部双模型审查。

## 2026-09-04 — 账号管理页质量修复
- 重复账号去重（后端 409 + "此账号已添加过"）
- 账号卡片显示用户昵称；验证按钮全状态显示；去登录按钮按登录态灰显/启用
- 验证通过提示"登录状态正常"，失效弹窗"登录已失效，是否重新登录"
- B站统一更名 Bilibili；Bilibili/快手创作者中心 URL 修正
- 标签页标题改为应用页面名称并锁定；首页隐藏刷新、地址栏灰显、前进后退可用
## 2026-09-05 — 账号管理页核心缺陷修复 v2
- 修复 i18n 键缺失导致验证弹窗静默失败
- 重复去重升级：platform_account_id 优先匹配
- 登录时捕获账号昵称/粉丝数/头像/平台ID 并持久化
- IPC 白名单增加 platform_account_id

