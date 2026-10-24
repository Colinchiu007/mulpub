---
record: explainer-visual-mode
task: 给「AI 讲解视频」流水线加「画面模式」二选一（AI 生成 / 动效标题卡），并把「不消耗积分」落成可执行判据
date: 2026-10-24
---

## 本次执行记录：AI 讲解视频「画面模式」（explainer-visual-mode，2026-10-24）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/electron/services/asset-generator.js` / `story2video-stages.js` / `explainer-stages.js`）+ 前端（`apps/desktop/src/views/CreateView.vue` / `locales/create/{zh,en}.js`）+ 测试（2 个新文件）+ 文档（`01-docs/PRD-video-creation.md` §14）⇒ 隔离 worktree `/workspace/mp-worktrees/mp-explainer-visual-mode`、裸分支 `explainer-visual-mode`（`git branch --show-current` 实证）；共享根保持 main clean |
| 第一性原因（QM-5 ①） | ✅ | 本片要解决的不是「加个下拉框」，而是**两件各自站不住的事**：① 「AI 讲解视频」只有一种画面来源（AI 生图），用户**没有零成本选项**；② 用户被要求在界面上看到「不消耗积分」这句话，而**本仓当时根本不存在「积分扣减点」** ⇒ 这句话要么是假的，要么需要先给它一个可执行定义。⇒ **第一性判据**：先回答「什么才叫消耗积分」，再谈怎么省。调研结论（本仓无扣减点、只有成本归集点）直接决定了实现形态：**「不消耗积分」= 不发起 provider 调用**，而不是「跳过某个记账调用」 |
| 逃逸分析（QM-5 ②） | ✅ | ① **语义层（最大的坑）**：桌面端 `credit` / `积分` 只出现在**文案与测试桩**里，逻辑上没有一处减余额；唯一与「消耗多少算力成本」相关的是**成本归集**（`model-provider-manager._writeLog` → `model_provider_logs` → `usage-reporter` → ops-center `model_usage_daily.cost`）。若把需求理解成「在标题卡模式下跳过记账」，就会去动 `_writeLog` —— 那是**全局副作用点**，为一种画面模式改它会污染所有 provider 调用。② **回落层（会静默变成 AI 生图）**：`story2video-stages.js` 的 `resolvedImageProvider` 在 `hasAssetGenerator` 为真时**总会**回落模型设置里的默认 image provider ⇒ 只「不设 `imageProvider`」**关不掉** AI 生图 ⇒ 界面显示已切到标题卡、实际仍在生图并继续产生成本归集，**没有任何报错**。③ **降级语义层**：标题卡若沿用 `source: 'ffmpeg-placeholder'` + `degraded: true`，会被发布侧「占位图不得当成功封面」那道防线（`publish.js:128` 判 `degraded === true`）**误判成失败产物**而白白回退本地封面 ⇒ 标题卡是**用户主动选的正常产物**，需要独立 `source` 且 `degraded: false`，而**老字面量一字不能改**。④ **断言层**：既有断言只看「有路径 / 有音频流 / 规格合规」，**没有任何断言能看见「provider 被调了」** ⇒ 「不消耗积分」在旧断言体系里**完全不可见**。⑤ **文案层**：`.vue` template 块里的中文字面量会被 `check-locale-sync --cjk` 的**基线增量比对**判为新增硬编码而拦下 ⇒ 新文案必须走 i18n（zh/en 成对）。 |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① **判据落到「调用数」**：`AssetGenerator.generateImage` 新增 `local_render === 'title-card'` ⇒ **跳过** `_tryProviderImage`（provider 调用数 = 0 ⇒ 无 `_writeLog` ⇒ 无 cost 桶 ⇒ 不消耗积分/额度）。**不动**任何记账调用。② **回落层堵死**：`story2video-stages.js` 按模式**显式置空** `resolvedImageProvider`（`visualMode === 'title-card' ? '' : 原有回落`）⇒ 标题卡模式真的关得掉 AI 生图。
   ⭐ **并补了第二道防线**：`explainer-stages.js` 在标题卡模式下**不填**默认 image provider / model
   ——单靠下游那处置空是**单点**：若将来有人重构掉它，上游填进去的 provider 就会让标题卡
   静默变回 AI 生图（界面显示已切换、实际仍产生成本归集，不报错不降级无痕迹）。
   ⇒ 两层都不提供 provider，「关不掉」这条路在结构上就不存在（已加对照断言：标题卡模式
   `imageProvider` 为 undefined / AI 模式仍为 `default-image-provider`）。③ **降级语义分离**：标题卡用新 `source: 'title-card'` + `degraded: false`；兜底占位图仍 `source: 'ffmpeg-placeholder'` + `degraded: true`（**老字面量逐字未改** ⇒ 发布侧/历史项目/结果页三道既有防线不破）。④ **内容映射正确**：标题取**场景旁白 `text`**、副标题取**画面提示词 `prompt`**；**刻意不用** `sceneTextOf`（它优先返回 `imagePromptSeed \|\| prompt`，在 explainer 场景里那是画面提示词 ⇒ 会把提示词当标题显示）。⑤ **透传不碰引擎**：`params.visualMode` 由 UI → `explainer_generate_assets` 执行器（签名里直接有 `params`）→ `innerOptions`（双保险）→ `story2video_generate_assets` 读 `firstDefined(params.visualMode, stage.options?.visualMode, 'ai')`（**params 优先**）⇒ **不动 `pipeline-engine.js`**（该文件在点名还账名单里、只剩 1 行余量，且 explainer 的 stage 名 `'assets'` 在 `resolveRuntimeStageOptions` 里**没有分支**，靠 params 直通才生效）。⑥ **回归保护**（`explainer-visual-mode.test.js` 9 例 + `CreateView.visual-mode.test.js` 8 例）：把「不调 provider」写成**可执行断言**（`_tryProviderImage` 调用次数 = 0），把「回落层」写成**两模式对照断言**（AI 模式回落 `default-image-provider` / 标题卡模式为空）—— 只有对照才锁得住「显式置空」这条；把「提示文案」写成**要点断言**（必须同时含「不消耗积分」+「表现形式单一」）而不是「文案非空」。 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **判据用属性不用人工名单**：「不消耗积分」= provider 调用数 = 0（**本质属性**），而不是「跳过第 3 个记账点」这类人工名单 ⇒ 将来真加了扣减点（PR #4322），判据自动继续成立。② **归一只有一处**：`visualMode` 的脏值一律回落 `'ai'`（两处归一：`story2video-stages` 与 `explainer-stages`），不把脏值透给主进程。③ **模式不串**：AI 模式的 `generateImage` 入参**与改动前逐字一致**（不带 `local_render`），并有回归断言。④ **降级面不混淆**：`degraded` 的语义被收窄为「provider 失败导致的降级产物」，用户主动选的标题卡不再被它牵连。⑤ **文案要点进断言**：提示文案同时含两个要点，缺一个就红。⑥ **接线棘轮**：两个新测试文件分别落在 vitest include 的 `electron/services/**/*.test.js` 与 `src/**/*.test.js` 白名单内（**无需改 vitest.config.js**）；`scripts/check-unwired-tests.js` 实测 PASS。⑦ **待复验项登记**：真扣减点（PR #4322）落地后需**复验一次**「标题卡模式在新扣减路径下仍为 0」—— 已写进 PRD §14.8 第 3 条。 |
| 行尾与 diff 对账 | ✅ | `git diff --cached --numstat` 实测：PRD +159/−0、`asset-generator.js` +21/−8（净增 13）、`explainer-stages.js` +8/−0、`story2video-stages.js` +23/−1（净增 22）、`locales/create/zh.js` +11/−0、`en.js` +12/−0、`CreateView.vue` +26/−0、两个新测试文件 +255/+0 与 +90/+0。**逐文件对账目标值**：`asset-generator.js` 1346→1359（target 1369，**余 10**）、`explainer-stages.js` 458→466（limit 500，**余 34**）、`story2video-stages.js` 3905→3927（target 4081，**余 154**）、`CreateView.vue` 5417→5443（target 5656，**余 213**）⇒ **全部未触发 `TARGET_GREW`，且未上调任何基线** |
| 接线棘轮 | ✅ | 新增 `apps/desktop/electron/services/explainer-visual-mode.test.js`（落在 vitest include 的 `electron/services/**/*.test.js` 白名单内）与 `apps/desktop/src/views/CreateView.visual-mode.test.js`（落在 `src/**/*.test.js` 白名单内）⇒ **无需改 vitest.config.js**；`scripts/check-unwired-tests.js` 实测 `OK: 全部测试均已接线或按欠账登记` |
| QM-1 打包 / QM-4 视觉 | ✅ / ✅ | QM-1：改动落在 `apps/desktop/electron/services/` ⇒ 走本地打包验证（读数见下方「QM-1 打包取证」小节）。QM-4：**改动了 `.vue`** ⇒ 不能 N/A ⇒ 已实跑像素对比（读数见下方「QM-4 视觉取证」小节），结论是**像素零影响** |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未见可用的外部评审通道（`codeagent-wrapper` 类工具未探测到）；**如实记为未执行，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`） |

### 「不消耗积分」的判据推导（本片的地基，附实测依据）

| 类别 | 是什么 | 位置 | 是否与本需求相关 |
|---|---|---|---|
| ① 限流 / 配额（不扣钱） | RPM 滑动窗口 + 429 冷却 + 5h 请求窗口 | `model-call-scheduler.js` 的 `withModelBudget`、`api-usage-governor.js`、`ai-generator.js` 的 `this._governor.run(...)` | ❌ 不是消耗 |
| ② **成本归集**（唯一与「消耗多少算力成本」相关的一条） | provider 调用 → `_writeLog` → `model_provider_logs` → 聚合上报 → ops-center `model_usage_daily.cost` | `model-provider-manager.js:308` → `usage-reporter.js:183` → `ops-center/backend/services/usage_service.py:157` | ✅ **本功能的判据落在这里** |
| ③ 真正的积分扣减 | **不存在** | `license-manager.js` 是本地 free/pro 功能门控（无余额）；`entitlement.quota.credits` 是服务端下发对象的深拷贝透传（无本地减法）；`_consumeEntitlementFeature` 只服务 `cloud_publish`；ops-center 侧无扣减逻辑 | — |

⇒ **「不消耗积分」= 本次运行没有产生 provider 调用**（记账是调用的副作用，不调用则整条链不发生）。
⇒ **反证**：若把判据写成「跳过 `_writeLog`」，测试无法证明「没有 provider 调用」；
而写成「`_tryProviderImage` 调用次数 = 0」，既能机械断言，又在真扣减点落地后自动继续成立。

### 新增/修改清单（供评审逐条对照）

| 文件 | 动作 | 行数影响 |
|---|---|---|
| `apps/desktop/electron/services/asset-generator.js` | 改：`local_render === 'title-card'` ⇒ 跳过 provider；标题/副标题取 `opts.title`/`opts.subtitle`；`source` 分离为 `'title-card'`（`degraded: false`），兜底仍是 `'ffmpeg-placeholder'`（`degraded: true`） | +21/−8（净增 13，1346→1359，target 1369） |
| `apps/desktop/electron/services/story2video-stages.js` | 改：解析 `visualMode`（params 优先）；标题卡模式**显式置空** `resolvedImageProvider`；出图入参加 `local_render`/`title`/`subtitle` | +23/−1（净增 22，3905→3927，target 4081） |
| `apps/desktop/electron/services/explainer-stages.js` | 改：把 `params.visualMode` 透传进 `innerOptions`；标题卡模式**不填**默认 image provider/model（第二道防线） | +16（458→474，limit 500） |
| `apps/desktop/src/views/CreateView.vue` | 改：新增 `explainerVisualMode` 状态、`isExplainerPipeline` 判定、explainer 专属「画面模式」下拉 + 提示、`startExplainerPipeline` 下发 `params.visualMode` | +26（5417→5443，target 5656） |
| `apps/desktop/src/locales/create/zh.js` / `en.js` | 改：新增 `create.explainer.visualMode.{label,ai,titleCard,hint}`（**成对**） | +11 / +12 |
| `apps/desktop/electron/services/explainer-visual-mode.test.js` | **新增** | +255（9 例） |
| `apps/desktop/src/views/CreateView.visual-mode.test.js` | **新增** | +90（8 例） |
| `01-docs/PRD-video-creation.md` | 改：新增 §14（14.1~14.8） | +159 |

### QM-4 视觉取证（改动了 `.vue` ⇒ 不能 N/A）

**结论：既有基线像素零影响；新控件在 explainer 详情页真实渲染且行为正确。**

**① 像素对比（实跑）**：`vite dev server`（127.0.0.1:5174）+ `PIXEL_ONLY=create-editor,create-pipeline,create-story2video-detail`
⇒ **3/3 PASSED，0 失败**（报告 `tests/visual-testing/reports/report-*.json`）。

**为什么这三条就够**：43 张视觉基线里与 create 相关的只有这三条 ——
`create-editor`（`/create`，**未选中流水线** ⇒ 整个高级配置区不渲染）、
`create-pipeline`（`/create/pipeline` **重定向到 `/create`**）、
`create-story2video-detail`（prepare 点选的是 `story2video-compose` 卡片 ⇒ 走 `S2vConfigPanels.vue`，
**普通高级配置区 `v-if="!isOrchestratedPipeline(...)"` 根本不渲染**）。
⇒ 没有任何一张基线会渲染新元素；而新元素是**新增 grid item**（`.config-grid` 是 `auto-fill` 栅格），
**在上述三页里根本不存在**，不会挤动既有 item 的排布。
⚠ 「像素一致」在这里本身就是**「元素不存在」的强证据**：若它出现在 story2video 详情页，
`auto-fill` 栅格必然重排 ⇒ 像素必然变。

**② 功能取证（实跑，一次性 playwright 脚本，未提交）**：注入仓库既有 IPC fixture
（`tests/e2e/helpers/fixture-loader` 的 `buildInitScript()`）+ `locale: 'zh-CN'`，
实测读数：

| 检查 | 读数 |
|---|---|
| 未选中流水线时的选择器数 | **0**（不渲染） |
| explainer 详情页的选项 | `["AI 生成", "动效标题卡"]` |
| 默认值 | `ai` |
| 切到「动效标题卡」后的提示 | 「动效标题卡由本地渲染，不消耗积分；但表现形式单一——只是图片展示文字，没有 AI 画面。」（**两个要点都在**） |
| 切回「AI 生成」后的提示数 | **0**（提示随选择消失） |
| **story2video 详情页的选择器数** | **0**（该流水线不适用，隔离成立） |
| 页面错误 | **0** |

**③ 顺带修正了一处取证脚本自身的错**：`/create` 不是有效入口（应用是 hash 路由）⇒ 正确 URL 是 `/#/create`；
首版用 `/create` 拿到的是**首页**（`h1` 为空、页面显示「今日好，E2E 用户」），不是「create 页没渲染出 h1」——
取证脚本自己错了，别把「脚本错了」读成「产品错了」。

### QM-1 打包取证

`vite build`（渲染层产物 + preload 重建）**rc=0**（`CreateView-*.js` 388.73 kB 正常产出）。

`electron-builder` 在本沙箱的**两道环境限制**（均为**既有仓库设计**，非本片引入）：
① **跨主机打包被仓库自带的护栏拒绝**：`apps/desktop/scripts/stage-media-tools.js` 的
`assertNativeBuildTarget()` 明确要求「目标平台 == 构建主机平台」⇒ `--win` 在 linux 主机上**必然**失败
（实测报错原文：「ffmpeg-ffprobe-static 只安装构建主机的二进制；请使用与目标匹配的原生构建主机。目标=win32/x64，主机=linux/x64」）。
② **linux 目标卡在预置二进制的完整性校验**：`ffmpeg-ffprobe-static` 的 postinstall 在本环境未跑完
（`media-tools-lock.json` 要求 `ffmpeg-linux-x64` / `ffprobe-linux-x64` 各 ~128 MB 且校验 **size + SHA-256**）
⇒ 用系统 `/usr/bin/ffmpeg` 冒充会被 `assertSourceIntegrity()` 拒（**这是对的**：宁可打包失败也不放行一个来源不明的二进制进产物）。

⇒ **如实记录**：本片的 QM-1 **在 Linux 沙箱内无法取到完整的「打包 + 启动」证据**，不伪造。

**关键事实：QM-1 的实质由 CI 硬门禁兜底，且已在本 PR 的 head commit 上跑过。**
`.github/workflows/build.yml` 的 `build` job 跑在 **windows-latest** 上，执行
`cd apps/desktop && pnpm exec electron-builder --win --x64 -p never`，
该 workflow 的注释原文即写着「**Windows electron-builder 完整打包（QM-1 场景）**」；
而 `build` 是 **required status check**（required contexts = `Gate Result` / `build` / `QG Unit Tests` / `QG Coverage`）
⇒ **打包不过就合不进去**。本 PR head commit `ccbed94e` 上该 job 实测 **success**。

⇒ 这也解释了为什么仓库自己设了「目标平台 == 构建主机平台」的护栏：**跨主机打包本来就不被允许**，
AGENTS.md 里写的 `--win` 命令隐含「在 Windows 主机上执行」这一前提。

**本地已取的等价证据**：① `vite build` rc=0（渲染层产物 + preload 重建）；
② `node --check` 逐文件通过；③ 主进程侧 250+ 例既有测试 + 9 例新测试全绿
（**主进程模块的 require 图与语法都在 vitest 里真跑过**）；
④ `verify-worktree-deps.js` PASS（11 个 workspace 包解析到当前 worktree）。

### 本地门禁实测（全部 Fresh）

| 门禁 | 结果 |
|---|---|
| `node scripts/check-debt-budget.js` | ✅ `filesOver1000: 28 (baseline 29)` / `filesOver500: 94 (95)` / `circularDeps: 0` |
| `.github/scripts/check-max-lines.js`（用 `origin/main` 的 baseline 实跑后还原） | ✅ `无新增超大文件，挂账清单与现实一致`（点名还账 20 项全部未触发 `TARGET_GREW`） |
| `node scripts/check-no-hot-carrier-edit.js` | ✅ `命中热写面=0 判定=PASS`（未动 `CHANGELOG.md` / `01-docs/learnings.md`） |
| `node scripts/check-text-encoding-integrity.js` | ✅ `无新增编码损坏` |
| `node scripts/check-no-brand-residue.js` | ✅ PASS（扫 12448 个 tracked 文件） |
| `node scripts/check-unwired-tests.js` | ✅ `全部测试均已接线或按欠账登记` |
| `.github/scripts/check-locale-sync.js --cjk` | ✅ `基线 1330 条，当前 1115 条，无新增硬编码` |
| `.github/scripts/check-locale-sync.js --pair-base origin/main` | ✅ pair check PASS（zh/en 成对） |
| 受影响模块既有测试 | ✅ `story2video-stages.test.js` 161 例、`explainer-stages.test.js`、`asset-generator.test.js`、`asset-generator-provider.test.js`、`title-card-renderer.test.js`、`story2video-stages-aspect-ratio.test.js` 15 例、`publish.test.js` 51 例、`ResultView.test.js`、`stage-executor.test.js` —— 合计 **251+ 例全绿** |

## CHANGELOG 条目

# feat(视频创作): AI 讲解视频新增「画面模式」：可切「动效标题卡」，本地渲染不消耗积分（explainer-visual-mode）

- feat(视频创作): 「AI 讲解视频」流水线新增「画面模式」二选一 —— **AI 生成**（沿用模型设置里的默认生图模型，消耗积分/额度）与**动效标题卡**（本地 ffmpeg 渲染，**不消耗积分**，但表现形式单一：只是图片展示文字，没有 AI 画面）。界面上会明确写出这条取舍，不让用户按错误预期下单。
- feat(视频创作): 动效标题卡以**场景旁白为标题、画面提示词为副标题**逐场景出图，复用既有的标题卡渲染能力（含标题安全区，不会被合成阶段的放大动效裁掉边缘文字）。
- fix(视频创作): 标题卡模式**显式关掉**了 AI 生图 —— 此前生成阶段在有出图能力时**总会**回落模型设置里的默认生图模型，只「不设模型」是关不住的，界面显示已切换、实际仍在生图并继续产生算力成本归集。
- fix(视频创作): 标题卡产物的降级语义与「占位图兜底」**彻底分开** —— 标题卡是用户主动选的正常产物，不再被发布侧「占位图不得当成功封面」的那道防线误判成失败产物；占位图兜底的既有标识逐字未变，防线不破。
- docs(视频创作): PRD 增补 §14，写清「不消耗积分」在本仓的可执行定义（**没有积分扣减点，只有成本归集点** ⇒ 判据是「不发起 provider 调用」）、数据合同与校验、调用链、交互与显示项、验收矩阵，以及未闭合项（配置持久化、真扣减点落地后的复验项）。

## learnings

### lesson: a-user-facing-claim-must-have-an-executable-definition-before-the-code

**现场**：需求写的是「动效标题卡不消耗积分」。我第一反应是去积分链路上找一个「扣减点」加个开关 ——
但全仓实测发现**根本不存在扣减点**（桌面端 `credit` / `积分` 只出现在文案与测试桩里），
存在的是**成本归集点**（provider 调用的副作用）。

**如果不查这一层**，我会写出两种坏代码之一：
① 在 `model-provider-manager._writeLog` 里加「跳过记账」开关 ⇒ 那是**全局副作用点**，
为一种画面模式改它会污染所有 provider 调用，而且「跳过记账」并不等于「没有消耗」（provider 已经被调了，费用真实发生）；
② 在某个记账调用点包一层「标题卡模式不记」⇒ 同样是把归集点当扣减点治，方向错了。

**正解**：先把用户-facing 的断言翻译成**本质属性** ——
「不消耗积分」在「只有成本归集、没有扣减」的现状下，精确等价于「**没有 provider 调用**」。
于是实现形态变成「**根本不发起那次调用**」，判据变成「`_tryProviderImage` 调用次数 = 0」，
**可机械断言**，而且等真扣减点（PR #4322）落地后**自动继续成立**，不需要回头改。

**泛化**：任何「不消耗 X / 不产生 Y / 免费」的用户承诺，都要先问一句
「**在这个仓里，X 的产生点是什么？它是副作用还是显式动作？**」——
若它是**副作用**（记账、日志、上报、埋点），那正确解法是**不触发那个源头**，
而不是在副作用处加开关。后者会让承诺在源头仍然发生时**说谎**。

### lesson: a-fallback-that-always-resolves-defeats-not-setting-a-value

**现场**：「标题卡模式不要用 AI 生图」 ⇒ 直觉写法是「不设 `imageProvider`」。
但 `story2video-stages.js` 里 `resolvedImageProvider` 是这么写的：

```js
const resolvedImageProvider = (useCurrentModels ? currentImage?.providerId : imageProvider)
  || (hasAssetGenerator ? resolveCapabilityProvider('image') : '')
```

`hasAssetGenerator` 为真时**总会**回落模型设置里的默认 image provider ⇒
「不设」等于「照旧用默认」⇒ 界面显示已切到标题卡，**实际仍在 AI 生图并继续产生成本归集**，
没有报错、没有降级、没有任何痕迹。

**判据**：当一条配置链存在**「兜底回落」**时，「不设值」**不等于**「关闭」。
要表达「关闭」，必须**显式覆盖那个回落点**（本片是 `visualMode === 'title-card' ? '' : 原有回落`）。

**泛化**：看到 `a || fallback(...)` 这种形态，就要问「**我要的是「没有 a」还是「a 由别处决定」？**」
前者必须显式给一个能压过 fallback 的值（这里是空串），后者才该省略。

**配套的测试形态**：这条不能只断言「标题卡模式下 provider 为空」——
那在「所有模式 provider 都为空」的世界里也会绿。必须**两模式对照**
（AI 模式回落 `default-image-provider` / 标题卡模式为空）才锁得住。

### lesson: an-active-choice-and-a-fallback-failure-must-not-share-one-flag

**现场**：标题卡复用 `asset-generator` 的标题卡渲染分支，而该分支原本返回
`source: 'ffmpeg-placeholder'` + `degraded: true` —— 因为它是**provider 失败后的降级产物**，
发布侧那道「占位图不得当成功封面」的防线按 `degraded === true` 拦截它。

若标题卡沿用同一组标记，它会被那道防线**误判成失败产物** ⇒ 用户选了标题卡，
成片却回退成本地封面 ⇒ 静默的功能失效（不报错，产出也不对）。

**修法**：给「用户主动选」的路一个**独立的 `source` 值 + `degraded: false`**，
而**老字面量 `'ffmpeg-placeholder'` 一个字都不改**（那三个消费方是按**字符串**匹配的：
`publish.js` / `video-clone` / `ResultView`）。

**泛化**：当一个标记同时承担「这是降级产物」和「这是某种产物」两种含义时，
**主动选择与失败兜底必须分旗**。判据是「**这个标记在下游被用来做决定**」——
被用来做决定 ⇒ 不能让两种语义共用。

### lesson: git-add-a-can-swallow-a-symlinked-node-modules

**现场**：worktree 里为了复用依赖，把 `node_modules` 做成了**指向别的 worktree 的符号链接**。
`git add -A` 之后 `git diff --cached --numstat` 里赫然出现一行：

```
1       0       node_modules
```

⇒ `.gitignore` 第 1 行写的是 `node_modules/`（**带斜杠**）⇒ 只匹配**目录** ⇒
**符号链接不是目录** ⇒ 逃逸出 ignore 规则 ⇒ 被当成一个新文件加进暂存区。

**判据**：`git add -A` 之后**必须核对 `git diff --cached --numstat`**，
逐条确认没有 `node_modules` / 依赖目录 / 构建产物混进去 —— 靠 `.gitignore` 的直觉判断在这里会失效。

**泛化**：`.gitignore` 里带斜杠的目录规则**只对真目录生效**；
符号链接（以及被 `git add -f` 强推的路径）会绕开它。
凡是「提交前不打算带的东西」，要么**显式 `git rm --cached`**，要么**在提交前逐条对账 numstat**。
