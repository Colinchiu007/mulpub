---
record: publish-config-picker
task: 「去发布」浮窗新增「配置选择」——视频创作可一键套用已保存的配置档案（并核对「其它流水线是否已有配置管理」）
date: 2026-10-21
---

## 本次执行记录：「去发布」浮窗的配置选择器（publish-config-picker，2026-10-21）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更（渲染层 `apps/desktop/src/**`）+ 文档。隔离 worktree `D:/Data/projects/mp-worktrees/mp-publish-config-picker`（**D 盘，非 C 盘**）、裸分支 `publish-config-picker`（`rev-parse --abbrev-ref HEAD` 实证），经 `scripts/start-mp-task.ps1 -TaskName publish-config-picker` 正规入口创建（deps 校验读数 `[verify-worktree-deps] OK`）。共享根全程保持 main + clean，**未在其运行时路径落盘**：开工时误在共享根写文件，被 `Session Isolation Write Guard` 当场隔离（3 个文件进了 `%LOCALAPPDATA%\Mulpub\session-isolation\quarantine\`，tracked 文件从 HEAD 恢复，仓库仍 clean），随后全部改到 worktree 重做。基线：worktree 起点落后 origin/main，期间主干前进两笔，已 `git merge --ff-only origin/main` 对齐到 `be84f449a` 后才动手 |
| 第一性原因（QM-5 ①） | ✅ | 三条独立根因：①**入口缺失**——配置档案能力（保存/我的配置/应用/重命名/删除）只在创作页内部可达，「去发布」这一步无从选起；②**选项集合写死**——`PublishDestinationModal.vue` 的 `pipelineOptions` prop 默认写死 `[{ value: 'story2video-compose', label: '故事讲述' }]` 且三个调用方都没覆盖，弹窗里的流水线选择器只能选一条；③**断链**——热门选题页的「生成视频」去向最终只跳 `/create?draft=<id>`，**不带流水线**，弹窗里选的流水线被静默丢弃。③是②的连带伤，也是配置档案按 `pipelineId` 分域后「无从判断归属」的根源 |
| 逃逸分析（QM-5 ②） | ✅ | ①**单元测试层**：`PublishDestinationModal.test.js` 既有 7 例全在「披露节点 / 空选项 disabled / 提交默认值」上，**没有一条断言流水线下拉的选项集合**——prop 默认值写死一个元素，测试自然全绿；②**组件层**：配置档案能力有 `ConfigProfileManager` 组件与 `openspec/specs/story2video-pipeline-config-profiles` 规格，但那份规格的 Requirement 只管「每条流水线有没有入口」，**没有一条管「别的页面能不能选它」**，入口缺失是规格盲区而非实现遗漏；③**集成层**：三个调用方各自拼 query（`{ draft }` / `{ draft, pipeline }`），键名没有单一真源，键名漂移的表现是「配置静默丢失」而非报错；④**E2E/视觉层**：「去发布」浮窗不在任何视觉基线里（`base-screenshots` 无该视图），弹窗内的变化没有像素闸；⑤**流程层**：用户提的「是不是只有故事讲述有配置管理」这一疑问，**在代码里一直是对的**（配置档案早覆盖全部流水线），错的是「能力只在创作页里可达」这件事没有任何文档说清——于是被当成「其它流水线没有配置管理」提了出来 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ①新增 `components/PublishDestinationConfigPicker.vue`（配置选择器，自建下拉）+ `features/publish-destination/publish-destination-config.js`（纯函数：归一化 / 过滤 / 选中解析 / 载荷与 query 构造）+ `features/publish-destination/apply-config-profile-handoff.js`（创作页套用流程）；②浮窗的流水线下拉改用文案型全集（真源 `@/i18n/pipeline-labels` 新增只读导出 `TEXT_BASED_PIPELINE_IDS`，枚举与判定共用一份）；③`publish-video` 事件第 2 个参数新增 `{ configProfileId, configProfileName }`（第 1 个参数仍是流水线 id ⇒ 既有调用方零改动兼容）；④三个入口统一走 `buildCreateHandoffQuery()`（空值/非法值**不带该键**，绝不传空串）；⑤创作页 `_applyConfigProfileFromRoute()` 复用既有 `applyS2VConfigProfileSnapshot()`（不新增第二套套用逻辑）；⑥**修掉一处竞态**：创作页「恢复上次选项」与本片「套用配置档案」写同一份表单，并发时后写者胜——把恢复的 promise 留住并在套用前 `await`，保证配置档案（用户显式选择）必胜。回归锁：纯函数 15 例 + 组件 7 例（新增）+ 创作页 4 例（新建文件），详见下方「现场读数」 |
| 防止再次发生（QM-5 ⑤） | ✅ | ①**交接键名单一真源**：`buildCreateHandoffQuery()` 是三个入口拼 query 的唯一入口，键名漂移从「三处各拼」降为「一处定义」；②**流水线清单单一真源**：`TEXT_BASED_PIPELINE_IDS` 与 `isTextBasedPipeline` 同源，弹窗下拉与创作页灰显判据不再可能分叉；③**配置档案合法性判据与主进程同口径**（id `/^[A-Za-z0-9-]{8,64}$/`、pipelineId `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`），渲染层不会把「点��就报错」的档案列进下拉；④**失败路径全部可见**（加载失败 / 已删除 / 跨流水线 / 套用失败 / 无法确定流水线），且都不阻断创作；⑤**纯函数与组件分离**：数据校验分支由纯函数测试穷举，组件测试只验交互；⑥文档落 `01-docs/PRD-PUBLISH-DESTINATION-CONFIG-PICKER-2026-10-21.md`（数据校验/流程/交互/显示项/提示文字/边界/验收）与 `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §14 |
| 行尾与 diff 对账 | ✅ | 两口径 `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐文件一致（见下方读数）；新增文件与改动文件一律 UTF-8 无 BOM、CRLF（`* text=auto` 工作区形态），`loneLF=0` |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → 检查域 113 个测试文件、`OK: 全部测试均已接线或按欠账登记`。本片新增的两个 `*.test.js` 都在 `apps/` 下（vitest 按 workspace 自动收集，`WORKSPACE_COVERED`），**不需**在 workflow 额外点名即已被执行 |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | QM-1：**N/A**——本片未改 `apps/desktop/electron/` 与 `packages/rpa-engine/`（AGENTS.md 的 QM-1 触发条件是「每次修改 electron / rpa-engine 下代码后」）；另**主动**跑了一次渲染层打包验证 `pnpm run build:vue`（`build:preload` + `build:paginator` + `vite build`）→ **rc=0**，产物正常（`index-DFkXLbcI.js` 1.42MB / `CreateView-Ln2Za5cx.js` 354.91kB），唯一的 chunk>500kB 警告是既有形态、非本次引入。QM-4：**N/A**——「去发布」浮窗不在任何视觉基线里（`apps/desktop/tests/visual-testing/base-screenshots/` 无该视图；`check-visual-coverage` 读数：视图并集 56 张、判定 112 条、基线 43 → 69，登记一致），且本片改的是**浮窗内**的控件，不影响 `create-pipeline` / `create-editor` 等既有基线页面；浮窗内的空态/选项/提示三态由组件测试逐条锁住 |
| QM-6 CCG 双模型外部评审 | IN-FLIGHT | 判定与现场读数见下方「QM-6」小节（**以产物为准，不以 rc 为准**） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 现场读数（本次基线 `merge-base = be84f449a` 上取；这些是活数，引用前重取）

| 判据 | 读数 |
| --- | --- |
| `pnpm exec vitest run src/features/publish-destination src/components/PublishDestinationModal.test.js src/views/CreateView.config-profile-handoff.test.js` | 3 文件 / **33 例全绿**（纯函数 15 + 组件 14 + 创作页 4） |
| `pnpm exec vitest run src/views/CreateView.test.js src/views/CreateView.pipeline-runtime.test.js src/views/CreateView.batch-create.test.js src/i18n src/icon-usage.test.js` | 9 文件 / **390 例全绿** |
| `pnpm exec vitest run src/views/RewriteView.test.js src/views/HotTopics.test.js src/views/Collection.test.js` | 3 文件 / **268 例全绿** |
| `pnpm exec eslint <改动文件> --quiet` | rc=0（分 4 批跑：弹窗+纯函数+locale / 三入口 + 新测试 / CreateView） |
| `node .github/scripts/check-locale-sync.js --pair-base origin/main` | rc=0「pair check PASS」 |
| `node .github/scripts/check-locale-sync.js --cjk` | rc=0「CJK scan PASS（基线 1330 条，当前 **1124** 条，无新增硬编码）」——首跑**红过**：本片初版在 `CreateView.vue` 里用 `translateWithLocaleFallback(key, 中文兜底, 英文兜底)` 写了 3 处新中文被判新增硬编码；已改为纯 `this.$t(key)` + 新增 locale 键 `create.story2video.configProfile.pipelineUnresolved`（zh/en 成对） |
| `node .github/scripts/check-locale-sync.js --keys` | rc=0「key existence check PASS（195 个使用中 key 均存在于 zh/en）」 |
| `node .github/scripts/check-max-lines.js` | 首跑**红过**：`NEW_OVER_LIMIT: apps/desktop/src/components/PublishDestinationModal.vue 527 行 >= 500`。已把配置选择器抽成独立组件 `PublishDestinationConfigPicker.vue`，浮窗回到 **304 行**；复跑 rc=0「无新增超大文件，挂账清单与现实一致」 |
| `node scripts/check-debt-budget.js` | 首跑**红过**：`MAX_FILE_LINES: 5379 > baseline 5359 (apps/desktop/src/views/CreateView.vue)`。已把交接逻辑抽到 `features/publish-destination/apply-config-profile-handoff.js`（CreateView 只留 1 个方法 + 1 行 import）；复跑 rc=0「所有债务指标在基线内」（CreateView 5346 行） |
| `node .github/scripts/check-font-size-scale.js` | 首跑**红过**：新组件里 2 处 `font-size` 字面量（`10px` / `12.5px`）⇒ 改用七档 token `var(--font-size-xs)` / `var(--font-size-sm)`；复跑 rc=0 |
| `node scripts/check-no-brand-residue.js` | rc=0「PASS（扫描 11209 个 tracked 文件，无品牌残留）」 |
| `node scripts/check-text-encoding-integrity.js` | rc=0「OK：无新增编码损坏」 |
| `node scripts/check-unwired-tests.js` | rc=0「检查域内测试文件 113，OK」 |
| `node scripts/check-doc-abs-paths.js` | rc=0「PASS（全量审计 4835 个受管文件，无新增本机绝对路径；账本未放宽）」 |
| `node scripts/check-no-conflict-markers.js` | rc=0 |
| `node scripts/check-ui-wired.js` / `check-field-consumed.js` / `check-blanket-fs-mock.js` | 三条 rc=0（新建的测试文件 mock 的是 `@/api/publisher` 的具名导出，不是 blanket fs 夹具） |
| `node .github/scripts/check-desktop-test-prereqs.js` | rc=0「problems: fatal=0 debt=0」 |
| `node .github/scripts/check-frontend-consistency.js` / `check-vue-style-parse.js` / `check-color-literals.js` / `check-css-var-defined.js` | 四条 rc=0 |
| `node scripts/check-visual-coverage.js` | rc=0「OK — 每个注册视图的浅/暗基线都在判定域内或有带理由的登记项」 |
| `node scripts/check-gate-record-debt.js` | rc=0 |
| `node scripts/openspec-sync-check.js` | rc=0「OK: 387 tasks, 82 active changes, 243 archives」 |
| `openspec validate publish-config-picker --strict` | rc=0「Change 'publish-config-picker' is valid」 |
| `pnpm run build:vue`（渲染层打包） | rc=0，`✓ built in 26.49s` |

### 「其它流水线有没有配置管理」的核对结论（用户提问项）

结论：**不是只有故事讲述有**。配置档案能力**早已覆盖全部**视频创作流水线：

| 承载形态 | 覆盖范围 | 实现位置 |
|---|---|---|
| 创作页共享分支（编排型） | `story2video-compose` | `views/CreateView.vue` 操作条辅助区 + `views/video-creation/S2vConfigPanels.vue` |
| 创作页共享分支（legacy 型） | 其余全部流水线 | 同上；「保存配置 / 我的配置」按钮显示条件是 `v-if="selectedPipeline?.name"`，**与流水线类型无关** |
| 独立页面 | `video-clone`、`film-engineering` | `views/VideoCloneView.vue`、`views/FilmEngineeringView.vue` + 复用 `components/ConfigProfileManager.vue` |

既有规格 `openspec/specs/story2video-pipeline-config-profiles/spec.md` 的 Requirement「All video creation pipelines expose managed configuration profiles」即该契约。**真正缺的是入口**（配置在「去发布」这一步选不到），本片补的正是入口。核对口径见 `01-docs/PRD-PUBLISH-DESTINATION-CONFIG-PICKER-2026-10-21.md` §10.2。

### 遗留（不假装已闭合）

1. **QM-6 外部双家族评审在本记录写作时仍在途**（见上方 QM-6 行），闭合要在最后一笔提交上重跑评审后取产物。
2. **热门选题页的「流水线被丢弃」只修了本片路径**：本片让「去发布」弹窗选到的流水线能带到创作页，但热门选题页**行内**的「生成视频」按钮组（`HotTopicsGenVideoPicker.vue`）走的是另一条链（直接 `startGenerateVideo(topic, pipelineName)`），其流水线选择的传递语义与本片无关，本片未动。
3. **配置档案仍是设备级本地**（`userData/story2video-config-profiles/config-profiles.json`）：换设备/换用户目录就没有。本片沿用该语义，不声称同步。
4. **「未能确定流水线，无法套用所选配置」复用了 `create.story2video.configProfile.applyFailed` 键**（靠 `translateWithLocaleFallback` 的兜底参数区分文案）——本片最终改为独立键 `pipelineUnresolved`，此前的复用取舍已被消除。
5. **自建下拉的无障碍细节只做到 ARIA 语义 + 键盘可达性由浏览器原生行为承担**：未实现方向键在选项间移动（`role="listbox"` 声明了，但未实现 roving tabindex）。仓内 `HotTopicsGenVideoPicker` 有同款实现（其键盘处理在菜单级），本片未复制那套键鼠逻辑——如实登记为已知限制。

## CHANGELOG 条目

# feat(video-creation): 「去发布」浮窗新增「配置选择」，视频创作可一键套用已保存的配置档案（publish-config-picker）

- **新增**：「去发布」浮窗（改写页 / 采集页 / 热门选题页共用）的视频创作分支，在「流水线选择」旁新增**「配置选择」**下拉，列出**所选流水线**已保存的配置档案（按 `pipelineId` 过滤、`updatedAt` 倒序，非法条目逐条丢弃、其余保留）。
- **空态**：该流水线**一条配置都没有**时，下拉框显示文字「**默认**」且**不可展开（下拉内容为空）**，并给出一行说明「该流水线还没有保存过配置，可在创作页用「保存配置」创建」。加载中 / 加载失败 / 无配置三态互斥且都有可见文案——**加载失败不会被伪装成「没有配置」**。
- **联动**：切换流水线立即替换配置列表并作废此前选中的配置（配置档案按流水线分域，跨流水线套用是错误语义）；配置在库中消失时回落「默认」，不留悬空选中态；浮窗每次打开重新读取配置库。
- **流水线选项集合扩大**：「流水线选择」由写死的「故事讲述」一项，扩为全部**文案型**视频创作流水线（`story2video-compose` / `talking-head` / `localization-dub` / `animated-explainer` / `documentary-montage` / `animation` / `character-animation` / `hybrid` / `avatar-spokesperson`），判据与创作页「带文案进入时灰显非文案型」同源（为此给 `@/i18n/pipeline-labels` 补只读导出 `TEXT_BASED_PIPELINE_IDS`，枚举与判定共用一份真源）。素材型 / 录屏型 / 内部冒烟 / 独立页流水线**不出现**（它们接不了「一段改写文案」）。
- **交接**：`publish-video` 事件第一个参数仍是流水线 id（既有调用方零改动兼容），第二个参数新增 `{ configProfileId, configProfileName }`；跳转到创作页的 query（`draft` / `pipeline` / `configProfile`）收敛到**一处纯函数** `buildCreateHandoffQuery()`，空值/非法值一律**不带该键**（绝不传空串——空串会被创作页当成「指定了一个叫空串的配置」而报错）。
- **创作页自动套用**：新增 `CreateView._applyConfigProfileFromRoute()`，在**选中流水线之后**执行，复用既有 `applyS2VConfigProfileSnapshot()` 语义（枚举归一化 / 失效服务商回退 / 分辨率按能力上限归一 / 语音数据重载 / 折叠组恢复全部复用，不新增第二套套用逻辑），套用成功后记录已应用配置名并提示「已应用配置」。
- **修掉一处竞态**：创作页的「恢复上次选项」与本片的「套用配置档案」写的是同一份表单，并发时**后写者胜**——若恢复后到，用户刚挑好的配置会被覆盖（用户感知：「我在弹窗里选了配置，进创作页却不是那套」）。现把恢复的 promise 留住并在套用前 `await` 它，保证**配置档案（用户显式选择）必胜**。
- **修掉一处断链**：热门选题页的「生成视频」去向最终跳 `/create?draft=<id>`，**不带流水线**（弹窗里选的流水线被静默丢弃）。现随队列项一路带上 `pipeline` 与 `configProfile`；不选流水线时 query 不带 `pipeline` 键，行为与改动前一致。
- **失败路径全部可见**：配置已删除 / 跨流水线 / 套用失败 / 无法确定流水线，四种各有提示文案，且**都不阻断创作**（按流水线默认参数继续）。

### 「其它流水线有没有配置管理」的结论

逐条核对后确认：**不是只有故事讲述有配置管理**。配置档案能力早已覆盖**全部**视频创作流水线——创作页共享分支（编排型 `story2video-compose` + legacy 型其余全部流水线，「保存配置 / 我的配置」按钮显示条件为 `v-if="selectedPipeline?.name"`，与流水线类型无关）、视频克隆页、影视工程页（均复用 `components/ConfigProfileManager.vue`）。既有规格 `openspec/specs/story2video-pipeline-config-profiles/spec.md` 的 Requirement「All video creation pipelines expose managed configuration profiles」即该契约。

因此本次**不重建**配置管理（重建会与创作页已有实现形成双源真相），而是把已有能力接到「去发布」这一步：让其它流水线的配置**在去发布时也能被选到并落地生效**。核对口径见 `01-docs/PRD-PUBLISH-DESTINATION-CONFIG-PICKER-2026-10-21.md` §10.2。

### 不做什么

- 不做配置的云同步 / 账号同步 / 跨设备备份（沿用既有「设备级本地」语义）。
- 不在「去发布」浮窗里新增保存 / 重命名 / 删除（弹窗只做「选」，管理仍在创作页与两个独立页）。
- **不改**主进程配置档案服务与四个 `story2video:config-profile-*` IPC 通道、preload、`ConfigProfileManager.vue`、`api/publisher.js`——本片只消费既有契约。

### 验证

- TDD：先写断言实跑红，再实现。纯函数 `publish-destination-config.test.js` **15/15**；组件 `PublishDestinationModal.test.js` **14/14**（既有 7 例 + 新增 7 例）；创作页 `CreateView.config-profile-handoff.test.js` **4/4**。
- 回归：`CreateView.test.js` + `CreateView.pipeline-runtime.test.js` + `CreateView.batch-create.test.js` + i18n + icon-usage 共 **390/390**；`RewriteView` / `HotTopics` / `Collection` 三页 **268/268**。
- 门禁本机实跑：ESLint rc=0；locale 三档（`--pair-base` / `--cjk` / `--keys`）rc=0；行数两门禁（`check-max-lines` / `check-debt-budget`）rc=0；字号 / 颜色 / CSS 变量 / 前端一致性 / Vue 样式解析 rc=0；接线棘轮 / 品牌残留 / 编码完整性 / 文档绝对路径 / 冲突标记 / 视觉覆盖 / 执行记录债务 rc=0；`openspec validate --strict` rc=0；渲染层 `build:vue` rc=0。

### 文档

- 新增 `01-docs/PRD-PUBLISH-DESTINATION-CONFIG-PICKER-2026-10-21.md`（详细 PRD：数据校验 / 流程 / 功能逻辑 / 交互逻辑 / 显示项 / 提示文字 / 边界 / 验收 / 测试映射）。
- `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` 新增 §14「「去发布」浮窗的配置选择器契约」。
- change `openspec/changes/publish-config-picker/`（proposal / tasks / design / spec）+ 本篇执行记录。

## learnings

### lesson: 「能力有没有覆盖」和「能力从哪进得去」是两个问题（publish-config-picker）

**现场**：用户问「视频创作的所有流水线里，是不是只有故事讲述有配置管理功能？」。逐条核对代码后确认**不是**——配置档案（保存/我的配置/应用/重命名/删除）早已覆盖全部视频创作流水线：创作页共享分支的编排型与 legacy 型（按钮显示条件是 `v-if="selectedPipeline?.name"`，与流水线类型无关）、视频克隆页、影视工程页；既有规格里也早有「All video creation pipelines expose managed configuration profiles」这条 Requirement。

**真正缺的**是**入口**：配置档案只能在创作页内部进入（保存入口在流水线操作条，「应用」在「我的配置」弹窗里），于是「去发布」这一步完全选不到它。

**教训**：拿到「A 是不是只有 B 有 X」这种问句时，先分清它问的是**覆盖**还是**可达**。两者的整改完全不同：覆盖不足要补实现（重、且容易与已有实现形成双源真相）；可达不足只需**接线**（轻，且能复用全部既有语义）。本片若按字面「给其它流水线实现配置管理」去做，最可能的结局是**第三套**配置管理实现——与创作页那套、与独立页复用的 `ConfigProfileManager` 三份并存，正是本仓反复治理的双源真相病根。核对口径写在 PRD §10.2（可被复核），而不是只给一句「已经都有了」。

**附带一条**：用户提的「在流水线选择下拉框旁边加一个配置选择框」这句话里，隐含前提是「流水线下拉里有好几条流水线」。实测该下拉当时只有「故事讲述」一项（prop 默认值写死、三个调用方都没覆盖）——**需求描述与现状之间存在落差时，落差本身就是待办项**，不能只按字面实现新控件而把落差留在原地。本片因此把流水线下拉一并扩为文案型全集（判据与创作页灰显同源），并把「为什么是文案型」写进 PRD。
