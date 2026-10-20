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
| 防止再次发生（QM-5 ⑤） | ✅ | ①**交接键名单一真源**：`buildCreateHandoffQuery()` 是三个入口拼 query 的唯一入口，键名漂移从「三处各拼」降为「一处定义」；②**流水线清单单一真源**：`TEXT_BASED_PIPELINE_IDS` 与 `isTextBasedPipeline` 同源，弹窗下拉与创作页灰显判据不再可能分叉；③**配置档案合法性判据与主进程同口径**（id `/^[A-Za-z0-9-]{8,64}$/`、pipelineId `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`），渲染层不会把「点一下就报错」的档案列进下拉；④**失败路径全部可见**（加载失败 / 已删除 / 跨流水线 / 载入失败 / 套用失败 / 无法确定流水线），且都不阻断创作；⑤**纯函数与组件分离**：数据校验分支由纯函数测试穷举，组件测试只验交互；⑥文档落 `01-docs/PRD-PUBLISH-DESTINATION-CONFIG-PICKER-2026-10-21.md`（数据校验/流程/交互/显示项/提示文字/边界/验收）与 `01-docs/PRD-S2V-PIPELINE-PAGE-UX.md` §14 |
| 行尾与 diff 对账 | ✅ | 两口径 `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 逐文件一致（见下方读数）；新增文件与改动文件一律 UTF-8 无 BOM、CRLF（`* text=auto` 工作区形态），`loneLF=0` |
| 接线棘轮 | ✅ | `node scripts/check-unwired-tests.js` → 检查域 113 个测试文件、`OK: 全部测试均已接线或按欠账登记`。本片新增的两个 `*.test.js` 都在 `apps/` 下（vitest 按 workspace 自动收集，`WORKSPACE_COVERED`），**不需**在 workflow 额外点名即已被执行 |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | QM-1：**N/A**——本片未改 `apps/desktop/electron/` 与 `packages/rpa-engine/`（AGENTS.md 的 QM-1 触发条件是「每次修改 electron / rpa-engine 下代码后」）；另**主动**跑了一次渲染层打包验证 `pnpm run build:vue`（`build:preload` + `build:paginator` + `vite build`）→ **rc=0**，产物正常（`index-DFkXLbcI.js` 1.42MB / `CreateView-Ln2Za5cx.js` 354.91kB），唯一的 chunk>500kB 警告是既有形态、非本次引入。QM-4：**N/A**——「去发布」浮窗不在任何视觉基线里（`apps/desktop/tests/visual-testing/base-screenshots/` 无该视图；`check-visual-coverage` 读数：视图并集 56 张、判定 112 条、基线 43 → 69，登记一致），且本片改的是**浮窗内**的控件，不影响 `create-pipeline` / `create-editor` 等既有基线页面；浮窗内的空态/选项/提示三态由组件测试逐条锁住 |
| QM-6 CCG 双模型外部评审 | ✅ | 判定 `mode=dual`（变更 1234 代码行 > 200 行阈值）。**真跑了双家族**：`sh scripts/deep-review.sh` → proposer=opencode **跨家族校验通过**、critic=claude 出 **4 条问题 / 4 维度**（correctness/security/performance/maintainability，最低分 5）。引擎收敛判据落到**自扮演第三档出口**（`status=self_play_pending`，4 条待裁决）⇒ 逐条裁决已落 `.adversarial/ccg-deep-75773bdf/adjudication.json`（prosecution / defense / verdict / rationale 四段齐全）：**i1 dismissed**（判据的 changedLines 只计代码文件，与含文档的总 diff 量的是不同的东西；sha 落在父提交是 pre-commit 的既定行为，驱动输出逐字写明）、**i2 upheld 已修**（配置选择器补齐键盘可达：↓/↑ 展开并落焦、菜单内 ↑/↓/Home/End/Enter/Esc、Tab 关闭不抢焦点）、**i3 upheld 已加固**（`_s2vRestorePromise` 改为「无论是否编排型都赋值」，顺序保证不再依赖调用顺序）、**i4 upheld 已改**（交接模块改为**显式依赖注入 + 纯决策函数**，模块不再认识 Vue）。另有 3 条 Info：i5 dismissed（`.ccg/reviews/**` 是 pre-commit 自动 stage 的既定产物形态，最近 3 笔 main 提交各带 3 个此类文件；判据 `check-pr-exec-record.js` 正是从变更集里读它们）、i6 dismissed（`normalizeConfigProfiles` 已用 `Number.isFinite` 归一，`Infinity`/`NaN` → 0，不可能支配排序；且档案来自设备级本地文件，不跨信任边界）、i7 **已修**（`options` 与 `displayText` 改为从同一个 computed 派生，不再各算一遍过滤/排序）。**第 1 轮修复已提交**（`11b4168fe`：交接模块改显式依赖注入 + 纯决策函数、`_s2vRestorePromise` 改为无论是否编排型都赋值、补齐键盘可达），随后**重跑第 2 轮**：`sh scripts/deep-review.sh` → proposer=opencode **跨家族校验再次通过**、critic=claude 出 **3 条争议 / 4 维度**（correctness/security/performance/maintainability，最低分 **7**，比第 1 轮高 2 分）、另 2 条 Info。**第 2 轮逐条裁决**已落 `.adversarial/ccg-deep-11b4168f/adjudication.json`（prosecution / defense / verdict / rationale 四段齐全）：**i1 upheld 已修**（critic 指出 `onMenuKeydown` 只处理方向键、缺 `Enter`/`Space` 的「选中」核心契约，与 PRD §3.3.4 键盘可达表和 `role="combobox"`/`role="listbox"` 的声明直接矛盾——**属实**：核对源码确认该分支当时确实缺失，已补 `commitActive()` 并加 3 例键盘回归锁）、**i2 upheld 已修**（`await d.loadProfiles()` 无 `try/catch`，载入失败会变成 mounted 链里的未捕获拒绝，且与同函数内 `awaitRestore` 的吞并处理不一致——**属实**：已加 `try/catch` + **独立**提示文案 `create.story2video.configProfile.handoffLoadFailed`，不复用 `loadFailed`（那是「可稍后重试」语义）也不用 `notFound`（那是「已被删除」语义），避免把「载入失败」说成「配置不存在」）、**i3 dismissed**（critic 认为两处拆分是「为门禁而拆、跨组件追踪成本高」；**辩护成立**：拆分是机械门禁强制的结果——`PublishDestinationModal.vue` 触 `check-max-lines` 的 500 行上限、`CreateView.vue` 触 `check-debt-budget` 的「单文件最大行数只降不升」（5359 行基线），不拆就是门禁红；两个新模块的文件头注释已写明拆分原因，且接口已按「纯决策函数 + 显式依赖注入」稳定下来）。另 2 条 Info：i4 dismissed（测试分层是刻意的——纯函数穷举数据分支、组件验交互、创作页验端到端；CI 的 vitest 按 workspace 自动收集，`check-unwired-tests.js` 已确认全部接线），i5 dismissed（快照结构校验由**主进程既有服务** `electron/services/story2video-config-profiles.js` 负责，渲染层再做一遍是第二套真相；且档案来自设备级本地文件，不跨信任边界）。**第 2 轮修复已提交**（`cadf4c03b`）。**第 3 轮**（评审 `cadf4c03b`）：proposer=opencode 跨家族校验**第三次通过**、critic=claude 出 **3 条争议 / 4 维度**（最低分 **7**），逐条裁决落 `.adversarial/ccg-deep-cadf4c03/adjudication.json`：**i1 upheld（已闭环）**（critic 指出 `.ccg/reviews/*.json` 的 `deepReview.status` 停在 `pending`、`evidence`/`findings` 为 `null`，与「已完成 QM-6 裁决」矛盾——**属实且正是本片当前要做的收尾**：已把三条 dual 记录（`e3d9af84` / `0c045bd7` / `e59ad472`）全部写成闭环态 `self_play_resolved` + `tier: external` + `evidence` + 结构化 `closureNote`；critic 建议里的「`sha` 应等于提案 head」**不成立**——记录名是**内容寻址**（`stagedDiffHash`），`sha` 字段指向**被评审的那一笔提交**，且判据 `check-pr-exec-record.js` 是从**变更集**里读这些文件、与 sha 无关）、**i2 upheld 已修**（critic 要求补拆分前后行数证据——属实：已把实测读数固化成 design.md D12 表格：浮窗 **527 → 304 行**（`check-max-lines` 上限 500，首跑红）、`CreateView.vue` **5379 → 5356 行**（`check-debt-budget` 基线 5359，首跑红））、**i3 upheld 已修**（critic 指出 `awaitRestore` 的错误被 `catch (_) {}` **全静默**吞并——**属实且有真实失败路径**：`restoreS2VLastOptions()` 内部只吞了 `storeGetSetting` 的读失败，`_applyS2VSnapshotObject()` 的异常仍会冒到模块层；已改为可选取的 `onRestoreError` 回调，CreateView 侧传入并提示「未能恢复上次的选项设置」（新增 locale 键 `create.story2video.configProfile.restoreFailed`，zh/en 成对），且**仍然不阻断**配置套用）。另 2 条 Info：i4 **已修**（补 design.md 安全边界声明：配置档案是设备级本地数据、由 OS 用户目录权限保护、渲染层不新增授权检查以免与既有 `ConfigProfileManager` 形成两套口径）、i5 **已修但按实情写**（critic 建议声明「每流水线 ≤50 条」——**该数字未经验证，不予采纳**：配置档案由用户自建、无产品级上限；实情写入 design.md：单文件本地 JSON 一次 IPC 全量读取、过滤 O(n)、n 为个位数到几十，不做预先缓存设计，将来以实测读数为依据再加） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`）；现场读数看 CI 步骤首行 `MERGE-LEDGER prs=<n>`。合并前这篇文件还不在基线上，判 byDesign 不红；把本行状态列写成 `PASS` 会被判「预写不存在的证据」而红 |

### 现场读数（本次基线 `merge-base = be84f449a` 上取；这些是活数，引用前重取）

| 判据 | 读数 |
| --- | --- |
| `pnpm exec vitest run src/features/publish-destination src/components/PublishDestinationModal.test.js src/views/CreateView.config-profile-handoff.test.js` | 4 文件 / **55 例全绿**（纯函数 15 + 交接 17 + 组件 19 + 创作页 4；第 3 轮修复后） |
| `sh scripts/deep-review.sh`（**第 2 轮**，评审 `11b4168fe`） | proposer=opencode 跨家族校验通过；critic=claude **3 条争议**（i1 Critical / i2 Warning / i3 Warning）+ 2 条 Info，4 维度最低分 **7**；引擎收敛到自扮演第三档出口，逐条裁决落 `.adversarial/ccg-deep-11b4168f/adjudication.json` |
| `sh scripts/deep-review.sh`（**第 3 轮**，评审 `cadf4c03b`） | proposer=opencode 跨家族校验**第三次通过**；critic=claude **3 条争议**（i1 Critical / i2 Warning / i3 Warning）+ 2 条 Info，最低分 **7**；裁决落 `.adversarial/ccg-deep-cadf4c03/adjudication.json` |
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

1. **热门选题页的「流水线被丢弃」只修了本片路径**：本片让「去发布」弹窗选到的流水线能带到创作页，但热门选题页**行内**的「生成视频」按钮组（`HotTopicsGenVideoPicker.vue`）走的是另一条链（直接 `startGenerateVideo(topic, pipelineName)`），其流水线选择的传递语义与本片无关，本片未动。
2. **配置档案仍是设备级本地**（`userData/story2video-config-profiles/config-profiles.json`）：换设备/换用户目录就没有。本片沿用该语义，不声称同步。
3. **配置下拉的朗读增强未做**：方向键 / Home / End / **Enter / 空格** / Esc / Tab 已实现（QM-6 第 1 轮 i2 与第 2 轮 i1 采纳后补齐），但「输入首字母跳到对应项」这类 listbox 可选增强未做，如实登记。
4. **本片触及的高危面为空**：改动只落在 `apps/desktop/src/**`（渲染层）与文档/规格，**未触** `apps/desktop/electron/`、`packages/rpa-engine/`、`scripts/check-*`、`.github/workflows/` ⇒ `check-pr-exec-record.js::HIGH_RISK_SURFACES` 矩阵不适用，「高危面不得自扮演豁免」这条在本片不触发。

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
- **失败路径全部可见**：配置已删除 / 跨流水线 / 套用失败 / 无法确定流水线 / **配置列表载入失败**，五种各有提示文案，且**都不阻断创作**（按流水线默认参数继续）。其中「载入失败」用**独立**提示文案，不复用「配置不存在」——配置可能好好地存在、只是这次没载入成功，说成「已被删除」是误导。

### 「其它流水线有没有配置管理」的结论

逐条核对后确认：**不是只有故事讲述有配置管理**。配置档案能力早已覆盖**全部**视频创作流水线——创作页共享分支（编排型 `story2video-compose` + legacy 型其余全部流水线，「保存配置 / 我的配置」按钮显示条件为 `v-if="selectedPipeline?.name"`，与流水线类型无关）、视频克隆页、影视工程页（均复用 `components/ConfigProfileManager.vue`）。既有规格 `openspec/specs/story2video-pipeline-config-profiles/spec.md` 的 Requirement「All video creation pipelines expose managed configuration profiles」即该契约。

因此本次**不重建**配置管理（重建会与创作页已有实现形成双源真相），而是把已有能力接到「去发布」这一步：让其它流水线的配置**在去发布时也能被选到并落地生效**。核对口径见 `01-docs/PRD-PUBLISH-DESTINATION-CONFIG-PICKER-2026-10-21.md` §10.2。

### 不做什么

- 不做配置的云同步 / 账号同步 / 跨设备备份（沿用既有「设备级本地」语义）。
- 不在「去发布」浮窗里新增保存 / 重命名 / 删除（弹窗只做「选」，管理仍在创作页与两个独立页）。
- **不改**主进程配置档案服务与四个 `story2video:config-profile-*` IPC 通道、preload、`ConfigProfileManager.vue`、`api/publisher.js`——本片只消费既有契约。

### 验证

- TDD：先写断言实跑红，再实现。纯函数 `publish-destination-config.test.js` **15/15**；交接模块 `apply-config-profile-handoff.test.js` **17/17**（QM-6 第 1 轮 i4 采纳后新增 12 例，第 2 轮 i2 采纳后 +1 例「载入失败不抛异常且给独立提示」，第 3 轮 i3 采纳后 +2 例「恢复失败调用 onRestoreError」「未提供回调也不抛异常」）；组件 `PublishDestinationModal.test.js` **19/19**（既有 7 例 + 新增 12 例，含 5 例键盘可达：↓ 展开、↑/↓/End/Esc、Enter 选中、空格选中、Home+空格选中「默认」）；创作页 `CreateView.config-profile-handoff.test.js` **4/4**。本片 4 文件合计 **55/55**。
- 回归：`CreateView.test.js` + `RewriteView.test.js` + `Collection.test.js` + `HotTopics.test.js` **570/570**；另 `ConfigProfileManager` / `HotTopicsGenVideoPicker` / `rewrite-handoff` / `hot-topics-publish-ux` / `S2vConfigPanels` **60/60**。
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

### lesson: 文档里写下的交互契约，等于一条「欠实现」的债（publish-config-picker）

**现场**：QM-6 第 2 轮，claude critic 给出 Critical：**配置选择器的 `onMenuKeydown` 没有实现 `Enter` / `Space` 的「选中」动作**，与 PRD §3.3.4 键盘可达表、`design.md` D2 的承诺、以及控件自己声明的 `role="combobox"` / `role="listbox"` 直接矛盾。

**根因**：第 1 轮评审曾以「补齐键盘可达」为名提过这条（当时记作 i2），修的时候只把方向键 / Home / End / Esc 落了地，**「选中」这一动作本身没写**——而 PRD 表格里 `Enter` / `Space` 那一行早就写好了。于是形成一种最难发现的债：**文档承诺了、测试也绿、唯独代码没有**。核对源码确认当时确实缺这个分支，不是评审误报。

**教训**：交互契约一旦写进 PRD / 规格，它就不再是「说明」，而是**一条待实现的债**，每一条都要有对应的实现或对应的降级说明。本次由此补齐三条要素：① 实现的**位置**要跟着契约走（「选中当前焦点项」落成 `commitActive()` 这个单一入口，菜单项下标 0 = 「默认」、其后依次是各条配置）；② **回归锁**要覆盖契约的**每一行**，不是覆盖「大致能用」——本片为此把 `Enter` / 空格 / `Home`+空格三条各写成独立用例；③ 契约表里凡是「已实现」的字样，在实现落地前一律按**未实现**计。

**附带一条（同一轮）**：`await d.loadProfiles()` 没有 `try/catch`，载入失败会变成 mounted 链里的**未捕获拒绝**。判据是「**同一函数内**的其它 await 做了吞并处理，唯独这个没有」——同一个函数里处理方式不一致，本身就是缺陷信号，不等外部报错来暴露。修法不只是加 `try/catch`，还要**给它独立提示**：复用既有的 `loadFailed`（「可稍后重试」语义）或 `notFound`（「已被删除」语义）都是误导——配置可能好好地存在、只是这次没载入成功。
