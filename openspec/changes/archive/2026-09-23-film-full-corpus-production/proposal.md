# Proposal: film-full-corpus-production

## Why

《Hell Grind》电影工程 kit 导入时按"每场景文件夹仅取 1 条代表镜"的精选策略（`scripts/film-engineering/fetch-hell-grind-kit.py` 的 `pick_representative`），只导入了 153 镜；经对本地全量语料（`E:\hell-grind-full`，161 文件夹 / 155,123 job）取证，原片实际含 **2,795 条唯一分镜提示词**（视频 job 133,083 个，平均单镜时长 12.4s），原片总时长 95.1 分钟（`filmMeta.durationSec=5706`）。当前 kit 丢失约 94.5% 的分镜数据，且 `film_render` 契约以"单 run 目录 + selectedShots ≤ 10（MAX_VIDEO_BATCH）"为前提，**从结构上无法重建 95 分钟全片**。

## What Changes

- **L1 全量语料导入**：导入脚本升级为"每场景全量唯一提示词导入"——按规范化 prompt 去重（同 prompt 的多次迭代取末次已完成 job 为采纳版），每镜携带 `duration/width/height/aspectRatio/model/resultUrl/iterationCount` 规格元数据；kit 数据落点从随包 asar（<6MB 预算）迁移到用户数据目录（共享数据锚点），随包仅保留精简索引或回退包；加载校验 schema 同步扩展（既有 `prompt <= 20000 字符` 上限与现状矛盾——kit 已有 39,470 字符镜——本次一并收口为统一上限常量并显式化）。
- **L2 render 跨 run 聚合契约**：`film_render` 输入从"本 run 目录扫描 shot_NNN"扩展为**镜头清单（render manifest）**：`[{shotId, path, sourceKind: generated|downloaded, durationSec, orderIndex}]`，条目可来自多个 batch run 目录或下载通道；保持 fail-closed（缺条目即失败并列清单）与既有规格一致零重编码 / 不一致最小归一的拼接合同；单 run ≤10 镜路径保持向后兼容。
- **L3 全片量产驱动**：新增"全量出片"能力：将 N 镜按 `MAX_VIDEO_BATCH=10` 自动切分为批次子 run，逐批走 generate_videos 成本确认闸（每批确认前零计费），聚合各批产物到统一渲染目录，末尾单次 render 产出全片 final.mp4；同时提供**原片回收通道**：kit 镜的 `resultUrl`（原作者已生成视频，HiggsField CDN）可直连下载到本地受控媒体目录并作为 `sourceKind=downloaded` 进入 manifest，支持"B 回收做基准成片 + A 重生成逐镜替换"混合工作流。
- 前端：分镜树/列表在 ≈6,558 镜规模下虚拟化浏览（1.3 对账修正口径）；出片面板增加"全量出片（分批）"入口与批次进度视图。
- 无破坏性变更：现有单批 ≤10 镜出片流、单镜重试、kit 查询 IPC 契约不变（字段只增不改）。

## Capabilities

### New Capabilities

（无——全部行为归属既有 `film-engineering` 能力）

### Modified Capabilities

- `film-engineering`：
  - "film-kit 数据资产 schema 与加载校验"——kit 全量导入后数据落点迁移（asar → userData）、schema 扩展（时长/画幅/采纳版元数据）、prompt 长度上限收口；
  - "分镜库查询契约"——每场景多镜（153→≈6,558 规模）列表查询与响应约束；
  - "成片合成与产物合同"——render 输入扩展为跨 run manifest（保持磁盘为准 fail-closed）；
  - 新增需求："全量分批出片驱动"、"原片 resultUrl 下载通道"。

## Impact

- **代码**：`scripts/film-engineering/fetch-hell-grind-kit.py`（导入扩容）；`apps/desktop/electron/services/film-engineering/`（kit 加载/校验、video-gen、film-render.js）；`apps/desktop/electron/` IPC 与 preload（新增批量出片/下载通道接口）；`apps/desktop/src/`（FilmEngineView 出片面板、分镜列表虚拟化、locales zh/en 成对）。
- **数据**：kit 资产从 `apps/desktop/electron/film-kit/`（随包）迁至共享数据目录（体积从 <6MB 增至 ~40-80MB 提示词库 + 可选图片），打包产物瘦身；`D:\Temp\film-engineering/<runId>/` 媒体根沿用。
- **依赖**：不新增第三方依赖（下载沿用 node/undici 现有能力 + SSRF 白名单合同，需评估 HiggsField CDN 域名的白名单化策略）。
- **前置依赖（ ordering 约束）**：本 change 的 L2/L3 delta 基于**未归档** change `film-engineering-video-gen` 的 `film-engineering` delta（"成片合成与产物合同"等 4 条 ADDED 需求尚未 sync 进主 spec）。实施（apply）前必须先 `openspec sync/archive` 该 change，本 change 的 delta 以合并后状态为基线撰写；若前者被拒绝或修改，本 change specs 需同步修订。
- **成本/风险**：全量重生成 ≈140-280 批 × 10 镜（免费 provider 档墙钟 15~30 小时量级），驱动设计必须支持断点续跑；下载通道涉及外部 URL 有效期（CDN 链接可能过期），失败降级为重生成路径。
