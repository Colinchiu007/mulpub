# 前端大文件拆分方案（2026-10，v3 外部评审修订版）

> 目标：降低 `apps/desktop/src` 前端巨型单文件的维护成本与合并冲突面，给出**可逐 PR 落地、每步可回滚**的拆分路径。
> 依据：2026-10 全量行数实测（命令见文末附录），行数以实测时点为准，引用前请重跑附录命令。
> **v2→v3 修订说明**：v2 经外部评审（codeagent-wrapper 双通道：E1 claude 通道因后端实为 Flash 级模型空转被中止；E2 codex 返回完整结果，9 条 findings 全部经主代理复核属实）。v2 自身的 3 条 Critical 被推翻并已在 v3 修正：①「代理 methods 维持旧测试绿」不成立——测试有 **415 处 `w.vm.状态 = ` 直接赋值**，代理只覆盖方法，已补「状态桥接」机制（§2.3）；②v2 建议的 `locales/zh/<domain>.js` 结构与既有先例 `locales/<domain>/zh.js` **不同构**，check-locale-sync 成对 regex（:88）只认 `zh.js/en.js` 文件名——v3 改回先例同构结构（§3.1）；③locales 分批拆的**中间态无解**——已补「中间态装配契约」（§3.3）。审查记录见附录 B（第一轮）与附录 C（外部轮）。

## 一、现状总览（行数 Top 清单，仅源码）

| 行数 | 大小 | 文件 | 结构特征 |
|---|---|---|---|
| **5654** | 320KB | [CreateView.vue](../apps/desktop/src/views/CreateView.vue) | Options API（data :1034 / computed :1207 / watch :1790 / methods :1822-5654，methods 独占 ~3800 行是复杂度主集中区），template 880 行，10+ 功能域混杂 |
| **3819 / 3804** | ~205KB ×2 | [locales/zh.js](../apps/desktop/src/locales/zh.js) · [en.js](../apps/desktop/src/locales/en.js) | 51 个顶层命名空间单文件平铺（zh/en 键结构经审查核实完全对称），每次加文案必改这两个文件 → **全仓最高频冲突点** |
| **2744** | 139KB | [Collection.vue](../apps/desktop/src/views/Collection.vue) | template 660 + script ~1940 + style ~140 |
| **1857** | 102KB | [ResultView.vue](../apps/desktop/src/views/ResultView.vue) | script ~1300 行 |
| **1697** | 86KB | [Publish.vue](../apps/desktop/src/views/Publish.vue) | script ~960 行 |
| **1483** | 75KB | [Accounts.vue](../apps/desktop/src/views/Accounts.vue) | script ~1130 行 |
| **1428** | 55KB | [ModelProviders.vue](../apps/desktop/src/views/ModelProviders.vue) | |
| **1295** | 68KB | [PublishHistory.vue](../apps/desktop/src/views/PublishHistory.vue) | |
| **1060** | 50KB | [RewriteView.vue](../apps/desktop/src/views/RewriteView.vue) | |
| 926 | 52KB | [ViralAnalysis.vue](../apps/desktop/src/views/ViralAnalysis.vue) | 边界线，暂缓 |
| 744 | 54KB | [video-creation/S2vConfigPanels.vue](../apps/desktop/src/views/video-creation/S2vConfigPanels.vue) | 已是拆分产物，暂缓 |

> 测试文件（CreateView.test.js 实测 6573 行）**不列入拆分对象**，但它是拆分的最大成本项而非「自然归位」：全文件 grep `w.vm.` 命中 **1392 处**——测试直接 mount(CreateView) 后读写 data、调内部 methods（如 `restoreS2VLastOptions`、`selectPipeline`）。方法搬进 composable 后 vm 上不再存在，**「迁测试」实质是按新接口重写**，7 步累计测试改写量可能超过源码搬运本身（详见 §2.3 修订红线）。

**判据**：以「单次变更预期 diff 是否会被无关代码淹没」为拆分标准，而非单纯行数。CreateView 与 locales 是唯二「任何相关改动都必然翻动整个文件」的点，列为 P0。

---

## 二、P0-1：CreateView.vue（5654 行）拆分方案

### 2.1 拆分目标结构（v2：不新建目录，进既有 `video-creation/`）

> **v2 修订（审查 B-4）**：`src/views/video-creation/` 已是 CreateView 的既定部件目录（PipelineSelector / StageProgress / SceneAssetSelection / S2vConfigPanels / create-view-module-utils.js 均在其中，CreateView.vue:889 已在 import）。新拆组件**一律进 `video-creation/`**，不新建 `src/views/create/`，避免同一视图部件散居两目录、`SceneAssetConfirmDialog` 与 `SceneAssetSelection` 命名近似却路径分离。

模板注释分节（:31/:306/:351/:557/:628/:718/:737）已天然画出功能域边界（经审查 A-7 核实全部存在），按域拆为 **子组件 + composable** 两层：

```
src/views/
├── CreateView.vue                          # 壳：视图切换 + 布局 + 跨域共享状态
└── video-creation/                         # 【既有目录，新拆部件进这里】
    ├── PipelineLaunchPanel.vue             # 【新】流水线启动页（模板 :31-305）
    ├── QuickRenderView.vue                 # 【新】快速渲染视图（模板 :306-350）
    ├── PipelineHistoryPanel.vue            # 【新】历史记录视图（模板 :351-556，包壳复用现有 CreateViewHistory.vue）
    ├── BgmLibraryDialog.vue                # 【新】BGM 素材库管理（模板 :557-627）
    ├── PipelineConfigProfileDialogs.vue    # 【新】保存配置三弹窗（模板 :628-717）
    ├── SceneAssetConfirmDialog.vue         # 【新】分镜素材确认（模板 :718-736，包壳既有 SceneAssetSelection）
    ├── BatchCreatePanel.vue                # 【新】批量创作（模板 :737-末）
    └── composables/
        ├── usePipelineLaunch.js            # 启动/暂停/恢复/取消 + canStartPipeline 计算链
        ├── useS2vConfig.js                 # s2vConfig + 时长估算 + 校准（voice-estimate/tts-calibration 接线，经审查 A-7 核实为真实纯函数模块）
        ├── useBgmLibrary.js                # bgmLibrary CRUD + 通知
        ├── useConfigProfiles.js            # configProfile CRUD
        ├── useTtsVoices.js                 # 音色目录 + 克隆（tts-voice-catalog/clone 接线）
        └── useBatchCreate.js               # 批量队列状态机
```

**样式归属（v2 增补，审查 B-3）**：`CreateView.vue:882 import '@/styles/create-view.css'` 为非 scoped 全局样式，且 JS 逻辑与 css 色阶类名一一对应（:1466 计数→色阶类名耦合）。短期统一约定：**css 继续由壳文件全局 import，子组件不单独 import 样式**；禁止把 css 切进子组件 scoped style——色阶类名耦合意味着改样式归属就是行为变更，违反「行为零变更」红线。长期如需切分，单列任务并附类名耦合点清单。

### 2.2 拆分顺序（v2 修订：ConfigProfile 后移，第 6-7 步降级为止损复评项）

| 步 | 内容 | 预估移动行数 | 风险 |
|---|---|---|---|
| 1 | 抽 **BGM + SceneAsset** 两个弹窗组件（实测这两段模板 0 处 s2vConfig/selectedPipeline/$route 引用，真正低耦合）+ **每个弹窗按 QM-2 浮层互斥合同登记唯一 owner**（见 §2.4） | ~700 | 中（v2 上调：owner 登记义务） |
| 2 | 抽 `useTtsVoices` + `useBgmLibrary` 两个 composable（无模板依赖的纯逻辑） | ~600 | 低 → **`useBgmLibrary` 已完成（§2.5）；`useTtsVoices` 被实测阻断，见 §2.6 发现 T1（56 处 CJK 会撞 Gate 7 基线，须先决策 (a) 迁 i18n 或 (b) 显式 update-baseline）** |
| 3 | 抽 `BatchCreatePanel` + `useBatchCreate` | ~500 | 中（队列状态与发布中任务互斥） |
| 4 | 抽 `QuickRenderView` | ~250 | 低 |
| 5 | 抽 `useS2vConfig` + `useConfigProfiles` + **ConfigProfile 三弹窗**（依赖 s2vConfig，必须在 useS2vConfig 之后，审查 A-4） | ~1100 | **高（v3 上调，外部 E9：s2vConfig 域 vm 触点 >800 处是全案最重域，且是状态桥接机制首个实战验证点——若 computed get/set 委托在此步被证不可行，第 6-7 步复评结论需连带重估）** |
| 6⏸ | 抽 `PipelineLaunchPanel` + `usePipelineLaunch`（最大、耦合最深） | ~1500 | 高 — **v2 降级：第 1-5 步落地后用真实合并冲突数据复评是否执行（审查 B-5/B-7）** |
| 7⏸ | 壳文件清理：CreateView.vue 收敛为视图切换 + provide/inject | — | **v2 降级：同上。provide/inject 是隐式契约（无类型检查、IDE 跳不出注入点），若第 1-5 步已把 CreateView 削到 ~2500 行，壳层化收益/成本比最差，可放弃（审查 B-5）** |

**最终收口（v4，2026-10-10，按 §2.9 实测数据）**：

| 步 | 结论 |
|---|---|
| 1 | ✅ 部分完成：BGM 域 owner 登记已落（#3236）；**弹窗组件化未做**（先用 composable 验证 §2.3 机制，见 §2.5 偏离记录） |
| 2 | ✅ 完成：`useBgmLibrary`（#3236）+ `useTtsVoices` 4 模块（#3259，前置 i18n 迁移 #3252，§2.6/§2.7） |
| 3 | ✅ 完成：`useBatchCreate`（#3271 前置 #3272 Teleport 清场基建；§2.10）；删除三方法留壳（归属修正） |
| 4 | ❌ **不做**（§2.9：49 触点、冲突频率 2/50 全域最低，投入产出比不成立） |
| 5 | ❌ **不做**（§2.9：s2vConfig 108 + Profile 174 触点为全案最重，冲突频率与已完成 TTS 域相当——TTS 拆出后压力已分摊） |
| 6–7 | ❌ 连带放弃（依赖第 5 步壳层化） |

**里程碑 2 正式收尾**：CreateView.vue 5654 → **4896 行**（净 −758），方案承诺的「locales + 第 1-2 步 ≈ 80% 收益」已兑现；第 3 步已完成（#3271/§2.10），第 4/5/6/7 步以实测数据做出「不做」的明确结论（详见 §2.9）。

**分阶段止损策略（v2 采纳审查 B-7 反方路线）**：
- **里程碑 1**：locales 拆分（§三，机械低风险，解决全仓最高频冲突点，收益最确定）
- **里程碑 2**：CreateView 第 1-2 步（弹窗 + 2 composable，削 ~1300 行）
- **里程碑 2 完成后**：用真实合并冲突数据决定是否继续第 3-5 步；第 6-7 步默认不承诺。
- 即：**先做 locales + 第 1-2 步 ≈ 3-4 个 PR 拿全案 ~80% 收益**。

### 2.3 红线（v3 修订：方法代理 + 状态桥接两层过渡）

- **测试策略（v2 正名 + v3 补状态桥接，审查 A-1≈B-2 / 外部 E1）**：CreateView.test.js 6573 行、1392 处 `w.vm.` 触点中，除方法调用外还有 **415 处 `w.vm.状态 = ` 直接赋值**（实测：`w.vm.view = "pipelines"` :143、`w.vm.quickText = ...` 等）。「只代理 methods」保不住状态触点——v3 扩写为两层过渡：
  1. **方法代理**：壳 CreateView 对已搬走的方法保留同名代理（`this.xxx(...args) { return this.xxxComp.xxx(...args) }`），维持旧测试全绿；
  2. **状态桥接（v3 新增，外部 E1 Critical）**：被搬走的状态在壳层用 **computed get/set 双向委托**到 composable 的 ref——`get() { return this.xxxComp.state.value }` / `set(v) { this.xxxComp.state.value = v }`。必须显式写明两条兼容契约：①**整体对象赋值**（`vm.s2vConfig = {...}`）经 setter 整体替换 ref.value；②**原地变异**（`vm.list.push(x)`）要求 getter 返回 ref 内对象本身（非 spread 副本），否则 `{...spread}` 丢失响应式。Vue 3 中 ref 放进 `data()` 不会被解包，**禁止**把 composable ref 直接挂进 data。
  3. 新 composable/子组件**随实现同步写独立新测试**（不迁旧测试），旧测试在该域代理删除时才逐域替换；
  4. 抽公共夹具 `create-view-test-harness.js`（electronAPI mock / route / stores 前置）；
  5. 工期估算**按测试改写量翻倍计**（s2vConfig 域 vm 触点 >800 处，是最重域）。
- **代理退出机制（v3 新增，外部 E7）**：代理宿主命名**禁用 `_`/`$` 前缀**（Vue 3 中走 ctx 通道、语义含糊），用无前缀实例属性或模块级 Map；每个拆分 PR 附「代理方法 → 计划删除 PR 编号」映射表，并把「代理残留数 ≤ 当前未完成步数」设为可检查指标，防止双路径无限期并存。
- 跨域共享状态（`selectedPipeline`、`currentView`、route query 同步）留在壳文件，用 provide/inject 或 props 下发，**禁止**为省事引入全局 store。
- 拆出的 composable 中 IPC 调用参数必须保持 `JSON.parse(JSON.stringify())` 脱壳现状（QM-2 序列化合同）。
- **业务 composable 的 setup() 前提（v3 新增，外部 E5-③）**：拆出的 composable（useS2vConfig 等）若内部使用 `watch`/`onMounted` 等实例依赖 API，必须经组件 `setup()` 选项调用——壳文件需新增 `setup()` 入口或保持这些 composable 无实例依赖；方案执行前须逐 composable 确认其内部无生命周期/watch 依赖，或同步在壳文件引入 `setup()`。

### 2.4 浮层弹窗互斥合同（v3 修订，审查 B-1 + 外部 E5/E8）

CreateView 全文 0 处 `useEmbeddedViewSuspension`，`overlay-view-suspension.test.js` owner 登记表（:89-148）无任何 CreateView 弹窗。按 QM-2「应用级浮层弹窗互斥合同」：弹窗拆成独立组件即属**新增应用级模态浮层**，每个必须：

1. **登记唯一、确定的 owner**（v3 修正，外部 E8：禁止 `create-batch-create-*` 这类模式匹配式命名）——一个组件内 N 个浮层登记 N 个确定 owner，如 `create-bgm-library-dialog`、`create-config-profile-save-dialog`、`create-config-profile-list-dialog`、`create-config-profile-apply-dialog`、`create-config-profile-delete-dialog`、`create-scene-asset-confirm`、`create-batch-create-queue-dialog` 等，逐个枚举；
2. **Options API 等价写法（v3 修正，外部 E5-①）**：`useEmbeddedViewSuspension.js` 实测导出为**两个普通 async 函数** `suspendEmbeddedViewsForOverlay(owner)` / `releaseEmbeddedViewsForOverlay(owner)`（:48/:67），**不是 composable**（无 ref、无 setup 上下文依赖），可在任何实例上下文调用。CreateView 是 Options API，映射为：`watch: { dialogVisible(v) { v ? suspendEmbeddedViewsForOverlay(OWNER) : releaseEmbeddedViewsForOverlay(OWNER) } }` + `beforeUnmount()` 选项中兜底调 release——不存在「Options API 用不了」的问题；
3. **双路径重复释放的安全性依据（v3 新增，外部 E5-②）**：允许 `watch(visible)` + `beforeUnmount` 双路径重复释放的前提——suspend 先同步登记模块级 activeOwners 再 await（快速开合竞态安全），且 release 对未知/已释放 owner **幂等返回 false**（overlay-view-suspension.test.js :262-272 已锁此行为），双路径不会重复挂起也不会计数漂移；
4. 在 `overlay-view-suspension.test.js` 同步登记 owner 接入断言；
5. 修改 `WebviewManager` 可见性链路时同跑 `overlay-view-suspension.test.js` + `shell-mode-6b.test.js` 全量。

**这是第 1/3/5 步（所有含弹窗的步）的硬门禁，漏做即合同违规。** 第 1 步风险因此维持「中」。

### 2.5 执行记录（里程碑 2 第 1 批实测，2026-10-10，PR #3236）

**实际范围（与 §2.2 计划有偏离，如实记录——不得被误读为「第 1 步已完成」）**：

| §2.2 计划 | 本批实际 | 说明 |
|---|---|---|
| 第 1 步：抽 BGM + SceneAsset **弹窗组件**（.vue） | ❌ 未抽组件；✅ BGM 两浮层 **owner 登记**完成 | 弹窗模板仍在 CreateView.vue，仅状态与方法迁出；组件化留待后续批次 |
| 第 2 步：抽 `useTtsVoices` + `useBgmLibrary` | ⚠️ 仅 `useBgmLibrary` | `useTtsVoices` 未做 |

**为什么先做 composable 而非组件**：组件化必然引入 props/emits 重接线（§五-1「受控行为重接线」），而 composable + 代理/桥接可做到**旧测试零改动全绿**——先用零行为变更的一步验证 §2.3 过渡机制本身成立，再在同一机制上做组件化，风险更可控。

**结果（实测证据）**：

| 项 | 结果 |
|---|---|
| CreateView.test.js | **288/288 零改动全绿** —— §2.3「方法代理 + 状态桥接」机制经实测成立 |
| 新增 useBgmLibrary.test.js | 9/9 |
| overlay-view-suspension.test.js | 17/17（含两新 owner 登记断言） |
| CreateView.vue | 5586 → 5518 行（净 -68；迁出 BGM 域约 123 行，新增代理与桥接 36 行 + 1 处 deps 注入） |
| 新增 composable | `src/views/video-creation/composables/useBgmLibrary.js`（231 行）+ 独立测试 |

**本批新实测坑（已固化进代码与测试）**：

1. **deps 注入必须在首个 `await` 之前同步执行**：`setupBgmLibraryDeps` 初版放在 `mounted()` 的 `await Promise.all(...)` **之后**，测试 `mount` 后 `await nextTick()` 即调方法时注入点尚未执行 → 9 个 BGM 测试全红（`deps not injected`）。正解：注入置于 `mounted()` 首行（首个 await 前），并同步写 `window.__bgmLibraryDeps` 兜底跨实例/早调用时序（`requireDeps()` 二级兜底）。
2. **模块级单例 composable 的跨用例状态泄漏**：`reactive` 置于模块作用域（单例，因 BGM 素材库是设备级资源）导致 BGM 条目/弹窗态在 vitest 用例间残留——配置管理弹窗的 `.bgmLibrary-item` 计数断言拿到 BGM 残留节点（实测 `expected 3 to be 2`）。正解：导出 `resetBgmLibraryForTest()` 并**在每个相关 describe 的 `beforeEach`** 复位；只放顶层 `beforeEach` 不够——嵌套 describe 有自己的 `beforeEach`，会整体覆盖外层。
3. **拆出的 composable 不得引入 CJK 字面量**：CI Gate 7 的 `--cjk` 基线扫描拦截渲染端非 locales 文件的新增中文字符串（本仓只豁免 locales 与 `utils/user-facing-error.js`）。初版 composable 含错误消息与 `'背景音乐'` 宾语 → `--cjk` 红（CI QG Static 抓到）。正解：错误消息改英文技术文本；用户可见宾语（kindLabel）改经 deps 注入壳的 `story2videoKindLabel(kind)`（走 locale）。
4. **`closeXxxDialog` 级联释放的幂等前提**：素材库弹窗关闭会级联调 `closeBgmDeleteDialog()`，后者无条件 release 删除弹窗 owner。其安全性依赖 `releaseEmbeddedViewsForOverlay` 对未知/已释放 owner **幂等返回 false**（该行为已有 `overlay-view-suspension.test.js` 锁定），故无需在级联路径加条件判断——但这条依赖必须在方案里写明，否则后来者会把「无条件 release」当 bug 改掉。

**方法论校验点（供后续批次参考）**：§2.3 的「方法代理 + 状态桥接」经本批实测**成立**（288/288 零改动全绿是最硬的证据）；§2.3-5 的「工期按测试改写量翻倍计」在本批**未发生**（因代理/桥接无需改写测试），该估算仍待第 5 步（s2vConfig 重域）验证。

### 2.6 剩余步骤的实测前置条件（2026-10-10 新增，发现 T1：§2.2 第 2 步被证不成立）

**发现 T1（有硬证据的阻断项）**：§2.2 第 2 步把 `useTtsVoices` 描述为「无模板依赖的纯逻辑」——**该判断经实测为错**。把 TTS 方法块（CreateView.vue:3225–3865，28 个方法）原样放入新文件后，用仓库自带门禁实测：

```
node .github/scripts/check-locale-sync.js --cjk
→ [locale-sync] FAIL：渲染端新增 56 处硬编码中文字符串（基线 1489 条，当前 1381 条）
   apps/desktop/src/views/video-creation/composables/__probe-tts.js
     :122  "当前语音模型暂不支持音色列表与克隆功能，已使用默认音色。"
     :123  "当前语音服务商配置不可用，请在模型设置中检查并配置后重试。"
     :124  "暂时无法获取音色列表，已使用默认音色，请稍后重试。"
     … 共 56 处
```

**为什么这是结构性阻断而非可忽略告警**：Gate 7 的 CJK 基线按 **file:line** 记账，**同一文件内的行号漂移被容忍**（该行为有 `check-locale-sync.test.js`「行号漂移不产生假阳性」锁定），但**新路径一律算 fresh 命中**——所以「把代码从 A 文件搬到 B 文件」在基线口径下等价于「新增硬编码中文」，哪怕字符串多重集完全没变。

**56 处的来源分布**（抽取自 `friendlyVoiceCatalogError` / `s2vVoiceCloneHint` / `nextS2VVoiceCloneName` / `selectS2VVoice` / `addS2VVoiceClone` / `deleteS2VVoiceClone` / `renameS2VVoiceClone` / `formatS2VVoiceCloneDuration` 等，以及 `story2videoKindLabel` 的 kind 宾语表：图片 / 旁白音频 / 背景音乐 / 视频素材）。

**因此 `useTtsVoices` 抽取前必须先做一次决策（二选一，均非本方案可默认）**：

| 路径 | 内容 | 代价 / 风险 |
|---|---|---|
| **(a) 先迁 i18n** | 把这 56 处 CJK 迁到 locales（zh/en 成对），抽完后新文件零 CJK | **属行为影响面**：文案迁移必须逐条保持措辞，且既有断言这些字符串的测试需核对；是一个独立的 i18n 任务 |
| **(b) 走 `--update-baseline`** | 纯搬迁（字符串多重集不变），显式吸收为存量债务 | AGENTS.md 允许「存量债务吸收」，但**禁止掩盖新增**——PR 内必须附「前后字符串多重集完全相同」的可核对证据（本批已备该检测手段） |

**连带结论**：§2.2 的**第 3–5 步同样需要按此口径预检**（先测「方法块搬入新文件后 `--cjk` 的 fresh 命中数」），再决定是否纳入批次——尤其第 5 步 `useS2vConfig`（s2vConfig 域含 TTS/图片/视频三域文案）。

**与 §2.5 坑 3 的关系**：坑 3 记录的是「**新写**的 composable 不要让 CJK 进入」；发现 T1 是它的**镜像**——「**搬迁**含既有 CJK 的代码同样会撞基线」。两条合起来构成 composable 抽取的完整 CJK 前置检查。

**T1 处置结果（2026-10-10，tts-i18n-migrate）**：用户选定路径 **(a) 先迁 i18n**，已执行完毕：

- 21 个新键（zh/en 成对）加入 `create.story2video.voice.*`；52 行 CJK 字面量改为 locale 取值。
- **关键发现（显著降低成本）**：`friendlyVoiceCatalogError` 的 26 条消息**键早已存在于 locales**（zh/en 值与原字面量逐字相同），且该函数本就是「locale 优先 + 内嵌兜底」双轨——故这块是**纯机械的删除冗余**，无需新写英文文案。`cloneStatusPending` / `cloneSuccessToast` 亦然（原为 `'已选择 ' + count + '…'` 拼接，改用既有占位符键）。
- **顺带收敛**：`validateStory2VideoFile` 的 `rules[].label` 是**第二处** kind 标签表（与 `story2videoKindLabel` 重复），一并收敛到同一数据源。
- **实测收益**：CI Gate 7 `--cjk` 基线 **1489 → 1274**（净还债），`CreateView.test.js` **288/288 零改动全绿**（zh 文案逐字不变的证据）。
- **行为影响面（如实声明）**：zh 用户文案逐字不变；en 用户 3 处改善（音色类别宾语随 locale、克隆默认名前缀 `音色NNN`→`VoiceNNN`、素材要求与时长格式随 locale）。「键缺失」防御路径由中文兜底改英文兜底（键均存在，路径不可达）。
- **残留项**：`s2vVoiceCloneHint` 的拼接分隔符 `'；'` 与句末 `'。'`（U+FF1B / U+3002）不在 CJK 判定区间，仍在代码中（英文界面会显示中文标点），留待后续 i18n 清理。

**下一步**：`useTtsVoices` 抽取可开工（新文件应零 CJK）；§2.2 第 3–5 步仍须按同口径预检。

### 2.7 执行记录（里程碑 2 第 2 批：useTtsVoices 抽取，2026-10-10）

**§2.2 第 2 步至此完成**（`useBgmLibrary` 见 §2.5，`useTtsVoices` 见本节）。

**前置检查（§2.6 同口径，实测）**：把 TTS 方法块（`CreateView.vue:3225–3866`，641 行）放入探针文件后 `check-locale-sync.js --cjk` 报 **0 处** fresh 命中——T1 的 i18n 前置任务（§2.6 处置结果）确实解除了阻断。

**抽取规模**：28 个方法 + 6 个计算属性 + 20 个状态 → **按子域拆 4 个模块**（合计 908 行）：

| 模块 | 行数 | 职责 |
|---|---|---|
| `tts-voices-state.js` | 182 | 状态 + deps + `requireDeps` + 2 个纯 helper（`getS2VVoiceProvider`/`getS2VDefaultVoiceModel`）+ 6 个计算属性 + 复位 |
| `tts-voices-shared.js` | 268 | 共享操作层：上下文构造 / 选项归一 / 请求时效判定 / 消息友好化 / **音色选择持久化** / 命名与容量时长格式化 |
| `tts-voices-clone.js` | 229 | 克隆 CRUD（选样本 / 自动入库 / 删除 / 重命名） |
| `useTtsVoices.js` | 229 | 门面：目录加载 + 服务商/模型切换 + 汇总导出 `refs/computeds/methods/setup/reset` |

**为什么必须拆（CI 真实拦截）**：单文件版（793 行）被 **债务熔断门禁**判红——`NEW_OVER_LIMIT: useTtsVoices.js 793 行 >= 500，新代码不得引入超大文件`。按子域拆分后各模块均 < 500 行，`check-debt-budget.js` 本地复跑全绿。

**层次（单向，禁止环）**：`state` ← `shared` ← { `clone`, 门面 }。两条约束决定归属，均由生成器的 fail-closed 断言固化：
- `selectS2VVoice` 必须放 **shared** 而非门面：克隆流程（新增后选中、删除后回退）要调用它，放门面会形成 门面→clone→门面 环；
- `getS2VVoiceProvider` / `getS2VDefaultVoiceModel` 必须放 **state** 而非 shared：计算属性 `s2vVoiceModelHidden` 依赖前者，而 shared 又依赖这些计算属性，放 shared 会形成 state→shared→state 环。
`check-debt-budget.js` 的 `circularDeps: 0` 即该层次无环的机械证据。

| 项 | 结果 |
|---|---|
| CreateView.vue | 5522 → **5056 行**（净 **-519**，含桥接/代理与 deps 注入） |
| CreateView.test.js | **288/288 零改动全绿**（仅新增 composable 复位钩子） |
| 新增 `useTtsVoices.test.js` | 15/15 |
| `tts-voice-i18n.test.js` | 6/6（防回流断言改扫 TTS 模块族） |
| Gate 7 `--cjk` / `--keys` | PASS（基线 1489 → 当前 1270）/ PASS（1524 key） |
| 债务熔断 | PASS（maxFileLines 5057 < 基线 5657；>500 行文件 96 < 基线 101；**circularDeps 0**） |

**关键架构发现（决定了本批为何能零改动）**：TTS 语音 UI **不在 CreateView 模板里**（模板区 0 处 `s2vVoice*`），而在子组件 `S2vConfigPanels.vue`；该子组件经 `s2v-panel-contract.js` 的 `createS2VPanel(vm)` **按名访问父实例**（`state[key] → vm[key]`、`fns[key] = (...a) => vm[key](...a)`、`setState(key, v) → vm[key] = v`）。因此**只要壳实例上仍存在同名 computed/方法**，子组件与契约**零改动**即可继续工作——本批据此把「桥接 + 代理」做成完整同名面，未触碰 `s2v-panel-contract.js` 一行。

**留壳（不迁出）的方法与理由**（`KEEP` 清单已做成接线脚本的 fail-closed 断言，误删即报错）：

| 留壳成员 | 理由 |
|---|---|
| `loadS2VProviders` | 跨域：同时加载 image/voice/video 三域服务商 |
| `getS2VVideoProvider` / `getS2VDefaultVideoModel` / `handleS2VVideoProviderChange` | 视频域 |
| `story2videoKindLabel` | 被 useBgmLibrary 经 deps 注入复用（跨域） |
| `isS2VDefaultVoice` / `previewS2VVoice` | 仅依赖 s2vConfig / 预览器，非本域状态 |
| `s2vEstimateFactors` | 采样域（`s2vTtsSamples`），非音色域 |

**本批新实测坑（已固化进生成器/脚本）**：

1. **默认参数在函数体之前求值**：把 `this.s2vConfig.voiceProvider` 注入为 `d.getS2vConfig()` 后，`function getS2VVoiceProvider(providerId = d.getS2vConfig().voiceProvider)` 会在**进入函数体前**求值 `d` → `ReferenceError: d is not defined`（实测 21 例失败 / 127 errors）。正解：把引用 `d` 的默认值**下沉到函数体首行**（`if (param === undefined) param = d....`）。
2. **成员前的注释归属**：按 `name() {` 行切区间会把「属于下一成员的注释」算进上一成员（并导致区间重叠）。正解：前导注释归属**其后**成员，区间 = [本成员含注释起点, 下一成员含注释起点)。
3. **必须「先删 data 再算区间」**：接线脚本里若在「删除 data 字段」**之前**就算好方法/计算属性的行区间，索引会整体偏移，导致**误删留壳方法**（本次实测误删 `isS2VDefaultVoice`/`loadS2VProviders` 等，已 `git checkout --` 回退重做）。已在脚本内加两条 fail-closed 断言：区间不得重叠、留壳清单必须齐全。
4. **CRLF 陷阱**：源文件为 CRLF，生成器的多行正则若用 `\n` 会静默不匹配（`injectRequireDeps` 直接报错，`.replace` 类操作则可能静默漏改）。正解：统一 `replace(/\r\n/g,'\n')` 处理后，写回 `.vue` 时还原其原行尾。
5. **新建文件有 500 行硬上限（债务熔断）**：抽取产物超 500 行会被 `check-debt-budget.js` 判 `NEW_OVER_LIMIT` 直接拦红（本批实测被 CI 拦下）。结论：**composable 抽取必须一开始就按子域规划模块边界**，而不是先写单文件再拆。
6. **模块化后须自查「跨模块 import 的名字确实被源模块 export」**：单文件版没有这个问题，一旦拆模块，漏 `export` 只会表现为运行期 `undefined（reading 'value'）`，静态看不出来。生成器已加三道 fail-closed 自检：①未声明/未导入的裸调用；②跨模块 import 必须在源模块有对应 export；③行数上限。

**残留项**：`s2vConfigSummary`（L1925）等壳内文案仍含非本域 CJK；本批已把 `'自动 Edge TTS'` 与 `'（多模态）'` 收敛为共用 locale 键（`autoEdgeProvider` / `multimodalSuffix`，后者由语音与视频两处共用），其余留待后续。

### 2.8 第 3–5 步 CJK 预检结论与批量域抽取的暂缓决定（2026-10-10）

**§2.6 同口径预检（探针实测，main @ 8ba53d078 基线）**：

| 步 | 候选 | 行数 | fresh CJK 命中 | T1 阻断 |
|---|---|---|---|---|
| 3 | 批量创作域 19 方法 | 279 | **0** | 无 |
| 4 | 快速渲染域 6 方法 | 36 | **0** | 无 |
| 5 | ConfigProfile 域 12 方法 | 163 | **0** | 无 |

**结论**：第 3–5 步均无 T1 阻断（i18n 债已在 #3252 一并清偿）。

**批量域（第 3 步）的归属修正与暂缓**：

1. **归属修正**：批量删除三方法（`requestHistoryBatchDeletion` / `closeBatchDeletionDialog` / `confirmBatchDeletion`）与删除确认文案 `story2videoBatchDeleteDialogMessage` **依赖历史域状态**（`deleting` / `history` / `story2videoBatchDeleteDialog`），跨域过深 → **留壳**。批量域实际可迁出：15 方法 + 10 状态（含被模板引用的 `S2V_BATCH_MAX_TEXTS/FILES`）+ 轮询定时器。
2. **模板引用面**：与 TTS 域（UI 在子组件、模板 0 引用）不同，**批量创作 UI 就在 CreateView 模板里（36 处引用）**——抽取后桥接/代理面必须完整覆盖模板触点。
3. **抽取已实现并自检全过（useBatchCreate.js 330 行），但旧测试在连跑下暴露 3 例跨用例状态污染**（单跑全绿）：
   - 现象：批量弹窗经 **Teleport 渲染到 body**，弹窗内交互（如切 tab 的 `@click="s2vBatchTab = 'files'"`）的事件闭包在**上一用例 unmount 后仍可能通过残留 DOM 触发**，写入模块级单例（桥接 setter 委托 `batchCreateRefs`）→ 下一用例读到 `s2vBatchTab === 'files'` 残留，走错分支。
   - **单文件时代的同类风险不存在**：状态挂在 vm 实例上，unmount 即销毁。**composable 模块级单例把「组件卸载」与「状态生命周期」解耦了**——这是本方案 §2.3 模式的结构性代价，此前 BGM/TTS 两批未暴露是因为它们的弹窗测试均单跑语义/不依赖 Teleport 交互残留。
   - 已试并放弃的修法：包装 `w.unmount`（破坏 this 绑定与时序）、`afterEach` 清 `document.body`（残留不在 DOM）。**未找到不改旧测试语义的最小修复**。
4. **决定（止损纪律）**：批量域抽取**暂缓**，回退本批代码改动；下一步先做**测试基建修复**——给批量弹窗测试建立「卸载后清扫 Teleport 残留 + flush 挂起微任务」的标准模式（候选：`afterEach` 内 `await new Promise(setTimeout 0)` 冲刷后再清 body；或让桥接 setter 带代际标记拒收过期 vm 的写入），修复后重跑本批。**在此期间第 3 步不计入已完成里程碑。**
5. **教训入档**：§2.3 的「模块级单例 composable」模式对**有 Teleport 弹窗交互的域**有一个此前未识别的前提——测试必须在卸载后冲刷并清场。抽取前应先审「该域的测试是否依赖 Teleport 交互」，把这类测试基建成本计入 §2.3-5 的工期估算。

**§2.8 暂缓的后续（batch-teleport-fix，同日）：测试基建已落地、批量域抽取已闭环**——见 §2.10。

### 2.10 批量域抽取闭环 + Teleport 清场基建（batch-teleport-fix，2026-10-10）

**上轮（§2.8）遗留的两个问题本轮均已解决**：

1. **上轮误删 two 行 data 声明的根因与根治**：接线脚本「先摘常量行再 splice 块」的两次 splice 使行号失效，误删了块外的 `MAX_STORY2VIDEO_TEXT_CHARACTERS` 与 `s2vImageProviders/VideoProviders` 声明。本轮改为**「批量块 + 容量常量行」作为一个连续区间一次 splice**，并加**幸存自检**（两个声明必须还在，否则报错）——同类错误不可能再静默通过。
2. **跨用例污染的真因与修复**（比 §2.8 的 Teleport 假设更准确）：经逐点实证（`DBG-sync` 双路读取证明 vm 与模块单例同源、非双实例），污染是**上一用例的迟到状态写入在下一用例的 mount 过程中落地**（`mountS2V` 的 `setTimeout(50)` 窗口恰好给挂起微任务让路）。**修复是双保险**：
   - `afterEach` 调 `afterTeleportCleanup()`（`teleport-cleanup.js`：冲刷挂起微任务 → 清 body → 再冲刷）；
   - `mountS2V` **mount 前强制 `resetBatchCreateForTest()`**（兜底防线：无论前序如何泄漏，mount 时状态必为初值）。
   `teleport-cleanup.test.js`（3 例）以最小复现组件固化该模式（含「清场顺序必须 unmount 在前」的实证）。

**抽取结果**：

| 项 | 结果 |
|---|---|
| `useBatchCreate.js` | 330 行（12 状态 + 15 方法 + 1 计算…0 计算——删除确认文案留壳）；deps 注入 8 项；每函数 `const d = requireDeps()` fail-closed |
| `CreateView.vue` | 5057 → 4896 行（净 −161） |
| `CreateView.test.js` | **288/288 零改动全绿**（新增 2 处复位钩子 + 批量 describe 的 afterEach 清场 + mount 前强制复位） |
| 新增 `teleport-cleanup.js/.test.js` | 清场基建 + 3 例机制锁 |
| 全量（views+locales+overlay） | 见本 PR CI |
| Gate 7 / 债务熔断 | PASS / PASS |

**留壳清单**（跨域过深）：批量删除三方法 + `story2videoBatchDeleteDialogMessage`（依赖 `deleting`/`history`/`story2videoBatchDeleteDialog`）。

**里程碑 2 收口状态更新**：§2.9 的「第 3 步缓做」前置已满足，**第 3 步至此完成**——`CreateView.vue` 4999 → 4896 行。第 4/5/6/7 步维持「不做」结论不变。

### 2.9 第 3–5 步复评收口（2026-10-10，数据驱动；里程碑 2 落地完成）

> 方案 §2.2 的止损条款：「里程碑 2 完成后：用真实合并冲突数据决定是否继续第 3–5 步；第 6–7 步默认不承诺。」本节按该条款，用实测数据给出**收口结论**——里程碑 2 至此正式收尾。

**实测数据（main @ 96f5a68f6 基线）**：

| 步 | 域 | 触点总数 | 模板引用 | 近 50 次改动中的域命中率（冲突频率代理） | CJK 预检 | 单例/Teleport 风险 |
|---|---|---|---|---|---|---|
| 3 | 批量创作 | 114 | **36（高）** | 4/50 | 0 | **有（Teleport 弹窗，实测污染）** |
| 4 | QuickRender | ~49 | 20 | 2/50 | 0 | 无（无弹窗） |
| 5 | useS2vConfig + ConfigProfile | **s2vConfig 108 + Profile 174** | 33 | 7/50 | 0 | 无 |

**已完成批次的收益核对（对照 §六收益预估）**：

| 项 | 预估 | 实测 |
|---|---|---|
| `locales/zh.js` | 3819 → ~290 行 | **440 行**（zh/en 成对装配 + 51 域模块；比预估多 150 行是装配注释与结构锁锚点） |
| `CreateView.vue` | 削 ~1300 行 | **5654 → 4999（净 -655）**；BGM 域 → `useBgmLibrary.js`，TTS 域 → 4 模块 908 行 |
| 冲突面 | locales 全仓冲突点 ~96% 消除 | 成立（域级隔离后 Gate 7 成对校验按域跑） |
| 旧测试 | 零改动全绿 | 两批均 **288/288 零改动** |

**收口结论（按收益/成本/风险排序）**：

1. **第 5 步（useS2vConfig + ConfigProfile）：不做。** 成本最高（s2vConfig 108 触点 + Profile 174 触点，§2.2 原文标注「全案最重域、状态桥接机制首个实战验证点」），而冲突频率（7/50）与 TTS 域（8/50）相当——TTS 域已完成拆分后，该域的冲突压力已被其他批次分摊。且 `useS2vConfig` 需要把 s2vConfig 本体迁出（108 处跨域写点经 deps 转发，运行时开销与出错面最大）。**第 6–7 步连带放弃**（它们依赖第 5 步的壳层化）。
2. **第 4 步（QuickRenderView）：不做。** 收益最低：仅 49 触点、冲突频率 2/50（各域最低），36 行方法 + 20 模板引用。为 ~86 个触点引入一套桥接/代理 + 测试复位 + 新测试文件，投入产出比不成立。
3. **第 3 步（批量创作）：缓做，前置是测试基建。** 冲突频率 4/50 居中，但它是**唯一有 Teleport 弹窗测试污染问题的域**（§2.8 实测）。前置条件：先落地「卸载后冲刷挂起微任务 + 清 Teleport 残留」的测试基建标准模式（并回填 §2.3 作为通用纪律），随后 `useBatchCreate.js`（330 行，已实现并全过自检）可直接重跑接线。
4. **里程碑 2 至此收尾**：第 1+2 步（useBgmLibrary + useTtsVoices）已落地并验证「方法代理 + 状态桥接」机制；第 3 步做了归属修正与实现预置；第 4/5 步以数据做出「不做」的明确结论——**不是没做完，而是数据不支持做**。

**给后续会话的交接（若重启第 3 步）**：
- `useBatchCreate.js` 的生成器与接线脚本思路已在方案 §2.8 记录；重做时按 §2.7 的流水线（恢复壳 → 生成 → 接线 → 三道自检）执行。
- 先在 `CreateView.test.js` 的批量 describe 落地 Teleport 清场标准模式，全量绿后再接线。
- CJK 无阻断（§2.8 预检）；`S2V_BATCH_MAX_TEXTS/FILES` 需加入桥接（模板引用）；批量删除三方法留壳。


---

## 三、里程碑 1（P0-2）：locales/zh.js · en.js（各 ~3800 行，51 命名空间）

> **v2 提升为里程碑 1（审查 B-6/B-7）**：这是全方案收益/成本比最高的部分——机械低风险、解决全仓最高频冲突点、全文唯一量化收益（冲突概率降 ~96%）。
> **v2 增补（审查 A-8）**：本拆分**并非首创**——仓内 `locales/accounts-cloud-sync/{zh,en}.js` 与 `locales/identity-diagnostics/{zh,en}.js` 已按「子目录模块 + 装配文件展开回原命名空间」模式运行且 CI 已覆盖，直接复用其装配写法与测试范式。

### 3.1 方案：按先例同构结构 `locales/<domain>/{zh,en}.js`（v3 修正，外部 E2 Critical）

> **v3 关键修正**：v2 提议的 `locales/zh/<domain>.js`（按语言分目录）与既有先例 `locales/accounts-cloud-sync/{zh,en}.js`（按域分目录）**不同构**——check-locale-sync.js 的成对 regex（:88 `/(^|\/)(zh|en)\.js$/`）只认文件名是 `zh.js/en.js`，按语言分目录的文件名是 `create.js` **不命中 regex**，成对检查完全失明，「无需改脚本」「单边直接红」两条断言同时失效。v3 改回先例同构结构，成对检查零改动成立。

```
src/locales/
├── zh.js / en.js                  # 装配文件：import 各域子模块并展开合并导出
├── create/
│   ├── zh.js                      # 现 zh.js :319-680（行号以实测时点为准）
│   └── en.js
├── story2video/
│   ├── zh.js
│   └── en.js
├── publish-page/  {zh,en}.js
├── accounts-page/ {zh,en}.js
├── collection/    {zh,en}.js
├── …（51 个命名空间各一目录，目录名 kebab-case 与命名空间对应）
├── accounts-cloud-sync/           # 【既有先例，已按此结构运行】
└── identity-diagnostics/          # 【既有先例】
```

装配写法（与先例一致）：`zh.js` 顶部 `import createZh from './create/zh'`，在对应命名空间位置 `create: { ...createZh, /* 未拆出的键暂时保留原文 */ }`（中间态详见 §3.3）。

### 3.2 关键约束（对齐 CI Gate 7 locale-sync）

1. **成对提交铁律不变**：拆分时 zh/en 必须同 PR 完成同名文件拆分（check-locale-sync.js :86-89 已机械强制，单边直接红）。
2. **合并语义防丢键**：`index.js` 聚合用显式展开（`export default { ...create, ...publish }`），并新增一个 locale 结构锁测试：拆分后导出的**扁平键集合必须与原单文件精确相等**（防手工搬运丢键）。**现成模板**：直接复用 `locales/accounts-cloud-sync/` 先例的装配写法与结构锁测试模式（审查 A-8）。
3. 新增文案时开发者只改对应域的小文件 → 冲突面从「全仓共用两个文件」降为「按域隔离」。
4. 命名空间重名键检查：聚合时若后展开的覆盖先展开的，结构锁测试必须报红。
5. **CI 脚本零改动成立（v3 修正，外部 E2）**：v3 已改回先例同构结构 `locales/<domain>/{zh,en}.js`，成对 regex（:88）天然命中，**确认无需改脚本**。仍需验证两点（审查 A-5+B-6）：①`evalLocaleModule` 递归跟随默认相对 import **限深 4 层**——装配链深度不得超过，且**只允许默认导出形式**（脚本遇不支持形式直接抛错）；②脚本的 **key 存在性校验段（:447-448）读单文件 zh.js/en.js**——zh.js 改为装配文件后导出面不变，必须在 PR 中显式跑一次 key 校验证明仍生效。
6. **「消费方零改动」不成立（v2 修订，审查 A-3，Critical）**：import 型消费方（i18n/index.js、pipeline-error-formatter.js 等）确实零改动，但 **5 个测试读的是文件原始文本**而非模块导出，键搬走后立即变红，**必须列入 locales PR 必改清单**：
   - `apps/desktop/src/tab-independent-home.test.js:64`（`read('locales/zh.js')` + `toMatch(/newTabTitle/)`）
   - `apps/desktop/src/views/Home.todo-guard.test.js:12-13`（readFileSync zh.js/en.js）
   - `apps/desktop/src/views/selfcheck-migrate.test.js:19-20`（`read('src/locales/zh.js')`）
   - `apps/desktop/src/views/PublishScheduleResult.test.js:43`（硬编码遍历 `['src/locales/zh.js','src/locales/en.js']`）
   - `apps/desktop/electron/services/webview-manager/home-shell-title.test.js:50-53`（**里程碑 1 落地时被 CI QG Desktop Shards 1/2 抓到的第 5 个**，此前按 `src/` 目录圈定 grep 漏检 electron/services——教训：raw-text 测试清单必须以**全仓** `readFileSync.*locales` 复扫为准，不能按目录圈定）
   - 处置：改为 import 模块后断言键；**断言路径按真实嵌套层级写**（实测 `scheduleCreatedTag` 在 `publishPage.publishFlow` 子对象 depth-2，文本断言时代「全文搜得到」掩盖了真实层级）。

### 3.3 拆分顺序与中间态装配契约（v3 修订，审查 A-2 + 外部 E3/E4）

~~一次 PR 完成~~ → **按域分批**（zh+en ~7600 行搬运，违反 §五「单 PR ≤1500 行」红线）。

**中间态装配契约（v3 新增，外部 E3 Critical）**：分批期间「部分键在子文件、部分仍在 zh.js」的双源并存必须有可行装配方案，否则结构锁第一天就红。采用 **_rest 残余文件模式**：
- **PR1** 落地：`zh.js` 中待拆的 51 个命名空间整体移入 `zh/_rest.js`（按原结构导出一个大对象），`zh.js` 改为 `import restZh from './_rest'` + `import createZh from './create/zh'` 并 `export default { ...restZh, create: { ...restZh.create, ...createZh } }`——zh.js 从 PR1 起恒为装配文件，此后每批 PR 只是把键从 `_rest` 搬进对应域目录；
- 备选：**index 休眠模式**——全部 51 域迁完前 zh.js 保持全文不动、域文件逐个建但暂不接线，最终 PR 一次性切换装配并删残余（优点：每步 PR 更小；缺点：最终 PR 集中风险）。执行时在 PR1 评审中二选一，默认推荐 _rest 模式（风险分散）。
- **结构锁测试的部分迁移期比较基准（v3 新增）**：不得按「全量精确相等」字面执行——改为：①对已迁移域做**子集精确相等**（域文件键集合 == 原单文件该命名空间键集合）；②对未迁移域断言**仍完整留在 `_rest`（或 zh.js 原文）**；③全局断言「已迁移域键 + 残余键 == 原全量键」（防搬运丢键）。

**PR 预算（v3 修正，外部 E4）**：统一口径为 **≤1500 行/PR**——每 PR **≤11 个命名空间**（留验证余量），共 5-6 个 PR；**首 PR 配额单独下调至 ≤8 个**（它除搬运外还携带 `_rest` 骨架 + 结构锁测试 + §3.2-6 的 4 个 raw-text 测试改写）。

---

## 四、P1：其余大视图（按「先抽 composable 后抽组件」统一打法）

| 文件 | 行数 | 拆分建议 | 优先级理由 |
|---|---|---|---|
| Collection.vue | 2744 | 抽 `useCollectionData`（采集/筛选/分页逻辑）+ 采集表单与结果列表两个子组件 | script 1940 行，逻辑/视图比例最差 |
| ResultView.vue | 1857 | 抽 `useResultData` + 导出/分享子组件 | — |
| Publish.vue | 1697 | 已有 `usePublishFlow`（602 行）等 composable 先例，继续外移剩余表单校验与平台覆盖逻辑 | 仓内已有同款拆分范式可循 |
| Accounts.vue | 1483 | 抽 `useAccountCrud` + 登录态卡片子组件 | — |
| ModelProviders.vue | 1428 | 已有 `useModelProviderCrud`（558 行），继续外移 | 同上 |
| PublishHistory.vue | 1295 | 抽 `usePublishHistory`（筛选/重试/删除） | — |
| RewriteView.vue | 1060 | 暂缓，等前六项落地后复评 | 接近阈值 |

P1 各项均为**独立任务**，无先后依赖，可按迭代容量自由摘取。

---

## 五、统一执行纪律（每个拆分 PR 必须满足）

1. **行为零变更（v3 修正，外部 E6）**：拆分 PR 只做代码搬移 + import 重接，不顺手改任何逻辑、命名、样式（P5 explicit over clever）。样式归属按 §2.1 约定（css 留壳文件全局 import）。**但模板段抽子组件必然涉及 props/emits 重接线，不属于纯搬移**——每个抽子组件的 PR 必须先列「绑定清单」（v-model 链、嵌套对象变异点、`$refs` 依赖），对「嵌套对象直改 prop」的位置显式声明取舍（改 emit 上抛 / 传可变异代理），并在 PR 描述中声明为**受控行为重接线**（非「零变更」），同时跑 QM-4 像素回归兜底。禁止笼统宣称零变更。
2. **测试策略（v2 修订）**：CreateView 域按 §2.3 的「代理 methods 过渡 + 新测试随实现同步写 + 公共夹具 harness」执行，**不再要求「先迁测试再迁实现」**；其余视图（P1）仍按「测试先行」执行；全量 `vitest` 必须通过。
3. **QM-4 视觉回归**：CreateView.vue 属视图层，拆分落地后必须跑 `npm run test:visual:pixel` 确认无像素回归（脚本经审查 B-6 核实存在于 package.json:32）。
4. **CI 契约**：`href-scheme-contract.test.js`、locale-sync（Gate 7）等全量扫描类测试不因路径变化漏扫。locales 拆分按 §3.2-5/3.2-6 清单核对（CI 脚本目录感知已确认，**无需改脚本**，但要验证聚合深度 ≤4 与 key 校验生效）。
5. **单 PR ≤ 1500 行移动**：超过则再拆步（locales 按 §3.3 分批执行，不豁免）。
6. **浮层合同（v2 新增）**：凡拆出模态弹窗组件，按 §2.4 完成 owner 登记 + 释放兜底 + overlay-view-suspension.test.js 断言，缺一不可。

## 六、收益预估

| 指标 | 现状 | 里程碑 1+2 后（v2 止损点） | 全量拆分后（若复评继续） |
|---|---|---|---|
| CreateView 单文件 | 5654 行 | ~4300 行（第 1-2 步） | 壳 <600 行，最大子文件 <1500 行 |
| locales 冲突面 | 2 个文件承载全部 51 域 | **每域 1 文件，冲突概率降 ~96%** ✅ 全额拿到 | 同左 |
| 新增文案/功能的 diff 定位 | 在 3800/5600 行中检索 | 文案直接进入域文件 | 全部进入域文件 |
| 预估 PR 数 | — | **6-7 个**（locales 5 + CreateView 2） | 12+ 个，且含 2 个高风险 PR |

**v2 结论（采纳审查 B-7）**：里程碑 1+2 即可拿全案 ~80% 收益，第 3-7 步按届时真实合并冲突数据复评，不预先承诺。

---

## 附录：测量命令

```powershell
Get-ChildItem -Recurse -File 'apps\desktop\src','ops-center\frontend\src' -Include *.vue,*.js,*.ts |
  ForEach-Object { [pscustomobject]@{ Lines=(Get-Content $_.FullName | Measure-Object -Line).Lines; Path=$_.FullName } } |
  Sort-Object Lines -Descending
```
（2026-10 实测；ops-center/frontend 最大文件 603 行，无需拆分。行数会随日常提交漂移，执行引用前必须重跑。）

---

## 附录 B：CCG 双模型对抗审查记录（2026-10，v2）

**审查方式**：平台无 `codeagent-wrapper`，按质量节拍 Step ④ fallback (b) 走平台等价机制——并行派两个独立审查子代理（审查 A：正确性/边界/规格合规；审查 B：风险/遗漏/反方），各返回 JSON findings，主代理指纹去重 + 逐条裁决。两路 findings 的关键证据（vm 触点 1392 处、4 个 raw-text locale 测试、CreateView 0 处 useEmbeddedViewSuspension、check-locale-sync.js :447）均经主代理独立复核属实。

**裁决总表**（15 条 findings，指纹去重后 12 项，**12 项全部接受**，0 拒绝）：

| 指纹 | 来源 | 级别 | 发现摘要 | 处置落点 |
|---|---|---|---|---|
| test-migration | A-1≈B-2 | Critical | 测试是重写不是迁移：6573 行 / 1392 处 vm 触点，「先迁测试」鸡生蛋；方案 :22 与 :68 曾自相矛盾 | §2.3 代理 methods 过渡 + harness 夹具；§一删除「自然归位」表述 |
| pr-size | A-2 | Critical | locales 单 PR ~7600 行违反方案自身 1500 行红线 | §3.3 改 5 PR 分批 |
| zero-change | A-3 | Critical | 「消费方零改动」被 4 个 readFileSync 文本断言测试证伪 | §3.2-6 必改清单 |
| overlay-owner | B-1 | Critical | 拆弹窗即撞浮层互斥合同，owner 登记义务方案零提及 | §2.4 新增节 + §五-6 门禁 |
| profile-coupling | A-4 | Warning | ConfigProfile 弹窗与 s2vConfig 深度穿插，非「耦合最浅」 | §2.2 移至第 5 步 |
| style-ownership | B-3 | Warning | create-view.css 全局样式归属与 :1466 类名耦合未提 | §2.1 样式归属约定 |
| dir-boundary | B-4 | Warning | 新目录 create/ 与既有 video-creation/ 边界重叠 | §2.1 一律进 video-creation/ |
| ci-locale | A-5+B-6 | Warning | CI 脚本已目录感知（担忧过时）；但 :447 key 校验读单文件是要害 | §3.2-5 验证两点 |
| data-drift | A-6 | Warning | 行数漂移（CreateView 实测 5654 非 5586，test 6573 非 6008） | §一更新数字 + 附录注明重跑 |
| readability | B-5 | Warning | 第 6-7 步 provide/inject 隐式耦合收益/成本比最差 | §2.2 降级为止损复评项 |
| precedent | A-8 | Info | locales 已有 2 个拆分先例可复用装配/测试范式 | §3 引用先例 |
| counter | B-7 | Info | 反方路线：locales + 第 1-2 步拿 80% 收益 | §2.2 分阶段止损 + §六 |

**审查核实通过项**（无争议，审查 A-7/B-6）：Options API 结构及 methods 块位置、7 个模板分节注释、51 命名空间 zh/en 完全对称、`@/story2video/*` 纯函数模块真实存在、BGM/批量两段模板低耦合实测成立、`test:visual:pixel` 脚本存在、vite/vitest `@` alias 一致。

---

## 附录 C：外部评审记录（2026-10，v3）

**审查方式**：质量节拍 Step ④ CCG 通道 (a)——`codeagent-wrapper` 并行双外部后端。E1（claude 通道）因后端实为 DeepSeek-V4-Flash 级模型、20+ 分钟在低价值核查上空转，经用户确认中止；E2（codex）返回完整结果（86,981 tokens 全仓核查）。E2 的 3 条 Critical 证据均经主代理独立复核属实：**415 处** `w.vm.状态 = ` 直接赋值（test.js）、check-locale-sync.js :88 成对 regex `/(^|\/)(zh|en)\.js$/` 只认 `zh.js/en.js` 文件名、useEmbeddedViewSuspension.js :48/:67 导出为普通 async 函数（非 composable）。

**裁决总表**（E2 共 9 条 findings，**9 条全部接受**，0 拒绝）：

| ID | 级别 | 发现摘要 | 处置落点 |
|---|---|---|---|
| E1 | Critical | 「代理 methods 维持旧测试绿」不成立——415 处状态直接赋值需「状态桥接」（computed get/set 双向委托 ref，整体赋值 vs 原地变异两种契约） | §2.3 扩写两层过渡 |
| E2 | Critical | v2 的 `locales/zh/<domain>.js` 与先例 `locales/<domain>/zh.js` 不同构，成对 regex 失明，「无需改脚本」失效 | §3.1 改回先例同构结构 |
| E3 | Critical | locales 分批拆中间态无解（双源并存，结构锁第一天即红） | §3.3 补 _rest/index 休眠中间态装配契约 + 部分迁移期比较基准 |
| E4 | Warning | §3.3 PR 预算（≤12 域/1600 行）与 §五-5（≤1500 行）自相矛盾，首 PR 必超限 | §3.3 统一 ≤1500 行/≤11 域，首 PR ≤8 域 |
| E5 | Warning | useEmbeddedViewSuspension 是普通函数非 composable，Options API 映射、竞态幂等依据、业务 composable setup() 前提未写 | §2.4-②③④ + §2.3 末条 |
| E6 | Warning | 模板抽子组件被定性「纯搬移」，props/emits 重接线与「行为零变更」红线内在冲突 | §五-1 受控行为重接线声明 |
| E7 | Info | 代理宿主 `_xxxComp` 前缀走 ctx 通道语义含糊，代理删除无时间门禁 | §2.3 命名规则 + 删除映射表 |
| E8 | Info | owner 建议含通配符 `create-batch-create-*`，与「owner 唯一」合同冲突 | §2.4-① 逐个枚举确定名 |
| E9 | Info | 第 5 步风险标「中」偏低（s2vConfig >800 触点最重域 + 状态桥接首战） | §2.2 第 5 步上调「高」 |

**外部评审揭示的 v2 自伤模式**：v2 在修 v1 的 4 条 Critical 时，因未核实底层事实（ref 响应式语义、CI regex、装配中间态），新引入了 3 条 Critical——印证「防再犯锁必须做变异反证」的仓内纪律：方案文本本身的每一条断言都需要源码级证据。
