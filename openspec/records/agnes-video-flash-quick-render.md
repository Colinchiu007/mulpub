---
record: agnes-video-flash-quick-render
task: 快速渲染接入 Agnes Video 2.5 Flash 全能力（文生 / 首尾帧 / 参考素材 + 真实进度）
date: 2026-10-23
branch: agnes-video-flash-quick-render
delivered_by_pr: 4342
---

# 快速渲染接入 Agnes Video 2.5 Flash 全能力

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | 通过 | 运行时代码变更；独立克隆 + 裸分支 `agnes-video-flash-quick-render`；未在共享主目录落盘 |
| 第一性原因（QM-5 ①） | 通过 | 能力不可见的根因是**参数在三层被丢**：流水线层 `generateSceneVideo` 只传 6 字段、契约层 IPC 只收 `{prompt}`、渲染层无入口 |
| 逃逸分析（QM-5 ②） | 通过 | 既有单测只断言「调用了 `renderStartAiVideo`」与「返回本地路径」，**没有任何一条断言参数透传** ⇒ 参数被丢弃无人发现；「输出平台失效」同样无人断言 |
| 修复 + 回归保护（QM-5 ④） | 通过 | 新增 `scene-video-generator.test.js`（10）/ `agnes-video-models.test.js`（8）/ `QuickRenderPanel.test.js`（19）+ 扩展 `agnes-multimodal.test.js`（+6）/`render.test.js`（+6）：分别锁「有值才写键」「能力驱动上限」「profile→画幅映射」「领域码本地化」 |
| 防止再次发生（QM-5 ⑤） | 通过 | 判据收敛到三处单一真源（模型能力表 / 模式契约 / 请求体构造），新增 provider 只需声明能力，**不必改中央名单** |
| 行尾与 diff 对账 | 通过 | 两口径 numstat 一致；本 PR 无行尾改动（纯 LF） |
| 接线棘轮 | 通过 | 新增 `*.test.js` 三支由 vitest 默认发现（`apps/desktop` 的 `test` 脚本 = `vitest run`，无白名单接线机制）；已实跑全绿 |
| QM-1 打包 / QM-4 视觉 | 部分 | QM-1 未执行（沙箱无 Electron 打包环境）；QM-4 核实「快速渲染」**不在像素判定域**（`base-screenshots/` 无 create-quick 基线，`check-visual-coverage.js` 通过）⇒ 改 UI 不撞 Gate 7b 的 0px 判定；workflows 套件的截图步骤由 CI 的 QG Visual job 实跑 |
| QM-6 CCG 双模型外部评审 | **未执行** | 本机无 `codeagent-wrapper` ⇒ 如实记「未执行」，**不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`） |

## 1. 这次做的是什么事

把「视频创作 → 快速渲染」的 AI 视频能力，从**只有文生视频**扩到模型已具备的全能力（首尾帧 / 参考图 / 参考音频 / 时长 / 画幅 / 种子），并修掉两个当下就在冒烟的缺陷：**「输出平台」下拉在 AI 视频路径上完全失效**、**进度条不反映真实进度**。

## 2. 动因：能力早就写好了，只是链路三层都在丢

`agnes-multimodal` 适配器**早已完整实现** Agnes Video 2.5 Flash 协议（text / keyframe / reference 三模式、首尾帧、参考图 ≤5、参考音频 ≤3、seconds、aspect_ratio、seed）。但：

| 层 | 丢在哪 |
|---|---|
| 流水线层 | `story2video-stages.js` 的 `generateSceneVideo` 提交时只传 `{ prompt, model, width, height, numFrames, frameRate }` —— 媒体与模式参数**一个都没往下传** |
| 契约层 | IPC `render:start-ai-video` 入参只有 `{ prompt }`，宽高/时长在主进程**硬编码**（720×1280 / 8s / 30fps） |
| 渲染层 | 快速渲染只有「文案生成 / 图片轮播」两个 tab，无任何素材/参数入口 |

⇒ 模型已具备的能力在产品上**一个都不可见**。

## 3. 顺带查出的两个真缺陷

### 3.1 「输出平台」失效

该下拉只被 gallery 模式消费（传给本地 Remotion）；AI 视频路径压根没传画幅 ⇒ 成片**恒为 9:16**，选了 YouTube 横屏也出竖屏。**这不是「缺功能」，是当下就在冒烟的功能性缺陷。**

### 3.2 进度条失真：两层原因

1. 主进程只在提交前推一次进度，**轮询期间无回调**；
2. **载荷形状不匹配** —— preload 的 `onRenderProgress` 把 IPC 载荷**原样**传给回调（`(_e, p) => callback(p)`），主进程发的是 `{ percent, stage }` **对象**，而渲染层按 `(pct, stg)` 两个位置参数解构 ⇒ `pct` 拿到的是整个对象。

⇒ 修法不是「多推几次进度」，而是**按对象读载荷** + 在轮询期真的推。

## 4. 两条硬约束如何绕过（都不是靠抬基线）

### 4.1 `story2video-stages.js` 零余量

它在「点名还账」清单里（target=4081、**容差 0**），而当时文件**正好 4081 行** ⇒ **加一行即主干红、required check 连带红、全仓 open PR 被挡**。

**处置**：把 `generateSceneVideo` 及其依赖闭包（`downloadVideoToFile` / `probeVideoFile` / `pickFrameCountForSceneDuration` / `MAX_VIDEO_FILE_BYTES`）抽到新模块 `electron/services/scene-video-generator.js`；`story2video-stages.js` 保留 re-export（对外 API 形状不变，既有调用方与测试**零改动**）。

**结果**：4081 → **3906**（净减 175）⇒ 债已还，target 条目**保持不动**。

### 4.2 `model-provider-manager.js` 零余量

它同样在点名清单里（target=1284），main 上**正好 1284 行** ⇒ 任何净增长都违规。

第一版把 `describeVideoCapabilities` 方法直接加进 manager（+50 行）⇒ 门禁报 `TARGET_GREW`（1334 > 1284）。

**处置**：改判据而不是抬基线 —— 能力是**模型的属性**，用 model id 判定就不需要碰适配器实例：

- `describeVideoModel(model)` 对已知模型返回能力描述，对未知模型返回**保守回落**（`id` 为空）；
- 因此「这个模型支不支持参考视频 / 有几档分辨率」**是模型的本质属性**，不需要 provider 名单，也不需要 manager 加方法；
- 能力查询的实现移到新模块 `electron/services/model-provider-video-capabilities.js`。

**结果**：manager 净增长 **0**（1284 → 1284）⇒ 连还债都不必。

> 这一步的价值不在省 50 行，而在于**避免了「providerId 名单」这个判据**：名单对新增对象默认不成立，将来换一个讲同一套协议的 provider，不必记得去改任何中央名单。

### 4.3 新文件撞 500 行门禁

`QuickRenderPanel.vue` 初版 597 行 ⇒ 触发 `NEW_OVER_LIMIT`（新代码不得引入超大文件）。按仓内既有 mixin/composable 范式拆成 4 个文件：面板 439 / 素材区 131 / composable 145 / 常量 47，**全部 < 500**。

## 5. 判据收敛到三处单一真源

| 判据 | 单一真源 | 消费方 |
|---|---|---|
| 模型能力（尺寸档位 / 素材上限 / 是否支持参考视频 / 合法画幅） | `electron/services/adapters/agnes-video-models.js` | 适配器 + 能力查询 + 渲染层（经 IPC 拿 JSON） |
| 模式 ↔ 媒体契约 | `packages/shared-utils/src/agnes-video-request.js` | 渲染层 + 主进程 IPC（**共用同一判据**） |
| 请求体构造与本地预校验 | `electron/services/adapters/agnes-video-request.js` | 适配器 |

**为什么值得**：三处各写一遍判据，迟早不同步 ⇒ 出现「界面说可以提交、服务端却 400」的错位。

## 6. 客户端预校验（省掉必然 400 的请求）

服务端在**创建任务前**就拒收并返回 400（不计费，但每次白跑一趟）：`size must be 720P` / `images length must not exceed 5` / `audios length must not exceed 3` / `videos is not supported`。客户端按能力描述预校验，把这些挡在本地；违规返回**领域码**，渲染层映射为本地化文案，**不把英文码原样透给用户**。

## 7. 验证

| 面 | 证据 |
|---|---|
| 新增单测 | `scene-video-generator.test.js`（10）、`agnes-video-models.test.js`（8）、`QuickRenderPanel.test.js`（18） |
| 扩展既有单测 | `agnes-multimodal.test.js`（+6，能力驱动上限/档位/参考视频）、`render.test.js`（+6，领域码/时长越界/载荷透传/能力查询） |
| 既有单测改写 | `CreateView.test.js`：快速渲染相关用例**迁至** `QuickRenderPanel.test.js`（不是删除）；`viewQuickResult` 改新签名 |
| preload 契约 | `preload.test.js` 键数 339→340、`PUBLISH_METHODS` 88→89（含新增键的真实存在断言） |
| 本仓门禁（本地实跑） | `check-max-lines` ✅ / `check-locale-sync --cjk` ✅ / `--keys` ✅ / `check-no-brand-residue` ✅ / `check-visual-coverage` ✅ / `check-gate-record-debt` ✅ |
| 行数读数 | `story2video-stages.js` 4081→3906；`CreateView.vue` 5528→5419；`model-provider-manager.js` 1284→1284；新文件全部 < 500 |

## 8. 一条被本次改动证伪的旧说法

上一轮规划时我把「进度条不动」归因为「主进程没在轮询期推进度」。**不完整**：即使推了，渲染层也读不出来（载荷形状不匹配）。两处都修了才真的有进度。

## 9. 明确的边界（不做）

- **参考视频**：Flash 服务端硬拒 `videos is not supported`；需非 Flash 模型 `agnes-video-2.5` + 公网素材托管（复用 `podcast-hosting-upload.js` 的 OSS PUT 原语），另立 change `agnes-video-nonflash-reference-video`。
- `n > 1`（服务端仅支持 1）；`width/height/fps/num_frames` 直传（非 Flash 2.5 会 400）；`negative_prompt`（2.5 Flash 拒收该字段）。
- 主流水线每段视频用分镜图做参考 —— 属独立 change（`agnes-video-scene-reference-pipeline`），本次不捆绑。

## 10. 仍待实测（不能靠文档拍板）

| # | 待实测 | 影响 |
|---|---|---|
| T1 | Agnes 是否接受 base64 data URI 作为参考图/首尾帧 | 官方文档只写「公网可访问 URL」，第三方 SKILL 称可收 Base64；本仓 `film-engineering` 已有 dataURL 先例。**若被拒 ⇒ 改走公网托管**（Change 3 已预留） |
| T2 | 参考音频的 data URI | 第三方称服务端实测接受（2026-10），官方文档未写 |
| T3 | 非 Flash `agnes-video-2.5` 在中国站的可用性 | 文档说「已在国际站上线」，本仓 base_url 是中国站 |
| T4 | 端点与 Key 的代际绑定 | 第三方实测 `platform` 签的 key 在 `apihub` 上 401、在 `api` 上 200 |
