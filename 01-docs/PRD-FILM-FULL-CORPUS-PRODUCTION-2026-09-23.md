# PRD：《Hell Grind》全量语料导入与全片量产（film-full-corpus-production）

- 日期：2026-09-23
- 状态：已实现并合入分支 `film-full-corpus-production`（本文档为 10.1 交付的收口规格，与代码现状逐条核对）
- 关联 change：`openspec/changes/film-full-corpus-production/`（proposal / design / specs delta / tasks）
- 关联 change（追加）：`openspec/changes/film-gen-shot-error-observability/`——逐镜失败原因跨三层透传（见 §5.5），本文 §5.1/§5.2/§5.4/§6/§8 已按该 change 落地同步。
- 关联文档：`ARCH-FILM-ENGINEERING-2026-08-14.md`（架构基线 + 本立项追加节）、`ipc-manifest.md`（通道清单）、`DESIGN.md`（UI 规范）

---

## 1. 背景与目标

### 1.1 问题

电影工程 kit 初版导入采用"每场景文件夹仅取 1 条代表镜"的精选策略，只导入 153 镜；经对本地全量语料（161 文件夹 / 155,123 job）取证，原片实际含 **6,500 条唯一视频分镜提示词（采纳版 6,558 镜，video job 133,053）**，原片总时长 95.1 分钟（`filmMeta.durationSec=5706`）。旧 kit 丢失约 94.5% 分镜数据，且 `film_render` 契约以"单 run 目录 + selectedShots ≤ 10"为前提，结构上无法重建 95 分钟全片。

### 1.2 目标（三层）

| 层 | 目标 | 交付 |
|----|------|------|
| **L1 全量语料导入** | 每场景全部唯一提示词入库；kit 落点 asar → userData；schema 扩展规格元数据 | 导入器 `--full` 模式、两级 kit 加载链、分页查询、前端虚拟滚动 |
| **L2 render 跨 run 聚合** | `film_render` 输入从"单 run 目录扫描"扩展为**镜头清单（renderManifest）**，条目可来自多个批次 run 或下载通道 | manifest 拼接合同（fail-closed、上限 10,000 条）、混合出片 |
| **L3 全片量产驱动** | "全量出片"：N 镜自动切批（10 镜/批）逐批过成本确认闸、断点续跑、原片回收通道、末尾单次合成全片 | production driver + 5 IPC 通道 + 前端出片面板 |

### 1.3 兼容性承诺（已兑现）

- 现有单批 ≤10 镜出片流、单镜重试、kit 查询 IPC 契约不变（字段只增不改）；
- 分镜列表缺省全量数组返回保留为回归锚（`{limit,offset}` 分页为 opt-in 双形态）；
- 随包 asar 仅含**精简 kit**（123 镜代表集，~9MB），全量 kit（80MB shot-library）落 userData，打包产物不膨胀（QM-1 asar 清单抽查验证）。

---

## 2. L1：全量导入操作手册

### 2.1 导入器 CLI

脚本：`scripts/film-engineering/fetch-hell-grind-kit.py`（可复现重建，Python 3，无第三方依赖）

```bash
# 全量导入（采纳版口径）→ 共享数据锚点 film-kit/
python scripts/film-engineering/fetch-hell-grind-kit.py \
    --source-dir E:\hell-grind-full \
    --out-dir <userData>/film-kit \
    --full

# 只统计不落盘（对账口径：uniqueVideoPrompts / adoptedShots / 超限数）
python ... --full --dry-run

# 精选模式（默认，向后兼容；随包精简 kit 由此产出）
python ... --source-dir ... --out-dir apps/desktop/electron/film-kit

# 附带下载精选参考图（512px webp）
python ... --with-images
```

| 参数 | 说明 |
|------|------|
| `--source-dir` | 必需。全量语料根目录（每场景一文件夹，内含 job `.jsonl` 素材元数据） |
| `--out-dir` | 输出 kit 目录。全量模式建议指向 `<userData>/film-kit/`（精选默认 `apps/desktop/electron/film-kit`） |
| `--full` | 全量模式：每场景按唯一提示词导入**全部**采纳版镜（修复 94.5% 丢失） |
| `--dry-run` | 只输出 `compute_full_stats` 统计（与真实导入同源口径），不写文件 |
| `--with-images` | 下载参考图并统一压缩 512px webp |

### 2.2 去重与采纳版规则（数据校验核心）

1. **规范化**：prompt 先 trim + 折叠连续空白，再取 SHA1 作为去重键（完整摘要，非前缀截断——前缀 500 截断口径曾导致对账 2,795 vs 6,500 差异，已修正并回写 design/proposal）。
2. **采纳版**：同键多个 job 取**末次 completed** job 为采纳版；`iterationCount` 记录迭代次数，`adoptedJobAt` 记录采纳 job 时间戳。**不依赖 is_favourite**（用户收藏不等于可交付版本）。
3. **视频口径黑名单**：`soul_cinematic`、`nano_banana` 等图片模型 job 一律排除（`--full` 视频分镜统计必须剔除，否则污染镜数与时长）。
4. **prompt 长度上限**：统一常量 `FILM_PROMPT_MAX_LEN = 50000`（导入器与 loader 单一来源导出）；超限条目**拒绝入库**并进 `import-report.json` rejected 清单（实测最长 39,801，超限 0）。

### 2.3 每镜字段合同（schema 扩展）

全量模式 shot 必含：

| 字段 | 类型 | 校验 |
|------|------|------|
| `shotId` / `sceneId` | string | 交叉引用：孤儿 sceneId fail-closed（`validateShotSceneRefs`，错误带文件名前缀与条目索引） |
| `prompt` | string | 非空、≤ `FILM_PROMPT_MAX_LEN` |
| `durationSec` | number | 正数（平均单镜 12.4s） |
| `width` / `height` | integer | 正整数 |
| `aspectRatio` | string | 必须匹配 `"W:H"`（如 `16:9`）；输入侧归一化见 §6.2 |
| `model` | string | 非空 |
| `resultUrl` | string(https) | 域名必须在 manifest `allowedHosts` 清单内（D7） |
| `iterationCount` | integer | 非负 |
| `adoptedJobAt` | number | 数值时间戳 |

### 2.4 落盘原子性与导入报告

- 每个 JSON 输出先写 `.tmp` 再 `rename` 原子替换（中断不留半成品 kit）。
- `import-report.json` 随写：`mode:"full"`、stats（`totalVideoJobs`/`uniqueVideoPrompts`/`adoptedShots`）、shots/rejected 清单。
- **实测基线（2026-09-23 真实导入）**：shotCount=6,558 / sceneCount=162 / rejected=0 / totalVideoJobs=133,053 / uniqueVideoPrompts=6,500；`allowedHosts=["d8j0ntlcm91z4.cloudfront.net"]`；全量 kit 落 `shared-user-data/film-kit/`（shot-library ≈80MB）。报告归档 `evidence/import-report-20260923.json`。

### 2.5 磁盘预期

| 资产 | 位置 | 体积 |
|------|------|------|
| 全量 kit（文本+manifest） | `<userData>/film-kit/` | ≈80MB（不含图） |
| 精简 kit（随包回退） | asar `electron/film-kit/` | ≈9MB（123 镜 + 162 场景 manifest + 36 参考图 webp） |
| 出片媒体 | `D:\Temp\film-engineering/<runId>/` | 单镜成品约 4.5-8.5MB（POC 10/10 实测）；**前端预估口径 8MB/镜** |
| 全片重生成峰值 | 146 批 × 10 镜 | ≈6,558 镜 × 8MB ≈ **51GB**（分段跑可先回收旧产物清批间目录） |

---

## 3. L1：两级 kit 加载行为（userData-full → asar-bundled）

### 3.1 探测链

`FilmEngineeringService._ensureKit()`（`apps/desktop/electron/services/film-engineering/film-engineering-service.js`）：

```
dirs = [ {userDataKitDir, label:'userData-full'}, {kitDir(默认 electron/film-kit), label:'asar-bundled'} ]
loadFilmKitChain({dirs})  →  逐级校验，首个全级通过的为准
```

- **userData 全量优先**：存在且校验通过 → `kit.source='userData-full'`，全部查询（status/listScenes/listShots/getShot/doctrine/getAllowedHosts）走全量 6,558 镜。
- **全量损坏回退精简**：userData 任一级校验失败（JSON 坏、schema 违例、孤儿 sceneId）→ 自动降级 asar 精简 kit，**回退事件经 log 输出，非静默**（用户可见 kitSource 变化）。
- **两级全坏**：抛 `FILM_KIT_UNAVAILABLE: <原因>`（缓存 loadError，fail-closed；`getStatus()` 不抛错，返回 `available:false + error` 供前端展示）。
- 全部 kit 读取点收口经 loader（grep 门禁：非测试代码无直读 `electron/film-kit/`；stages 显式 `params.kitDir` 亦走 `loadFilmKit`）。

### 3.2 显示项：`film-engineering:status` 返回

| 字段 | 说明 | 显示位置 |
|------|------|---------|
| `available` | kit 可用 | 影视工程页顶栏 |
| `kitSource` | `userData-full` / `asar-bundled`（缺省） | 状态徽标（全量已导入 vs 仅随包精简） |
| `filmMeta` | 片名/时长等元数据 | 顶栏影片信息 |
| `sceneCount` / `shotCount` | 场景数/镜数（**全量口径**，取 manifest 聚合 count，非代表集 123） | 分镜树头计数、badge |
| `referenceCount` | 参考图数 | 设置区 |
| `error` | `FILM_KIT_UNAVAILABLE` 详情 | 不可用横幅 |

### 3.3 分页查询契约（≈6,558 镜规模）

`listShots(sceneId, {limit, offset})` 双形态：

- **缺省（不传分页参数）**：返回全量数组——既有前端/测试回归锚，行为不变。
- **传 `{limit,offset}`**：返回 `{shots, total, limit, offset}` 页封装。
- 上限保护：`FULL_LOAD_LIMIT=500`（缺省全量时超出截断并置 total）、`MAX_PAGE_LIMIT=200`（limit 超限拒绝）、`DEFAULT_PAGE_LIMIT=100`；未知 sceneId 仍**报错**（不空数组冒充）；IPC 层 `pageOpts` 负载守卫返回 `VALIDATION_ERROR`；preload 参数一律纯 JSON（避免 reactive proxy 克隆异常）。
- 前端：分镜列表虚拟滚动 + 分页拉取；场景计数显示全量口径。

---

## 4. L2：renderManifest 跨 run 合成合同

### 4.1 数据结构

```
renderManifest: [ { shotId, path, sourceKind: 'generated'|'downloaded', durationSec, orderIndex } ]
```

- 条目可来自**多个批次 run 目录**（`generated`）或**回收下载目录**（`downloaded`）——支持"B 回收做基准成片 + A 重生成逐镜替换"混合工作流。
- 上限 10,000 条（对账修正后从 5,000 上调）；非数组/空数组/条目缺字段 → fail-closed。

### 4.2 合成合同（film-render.js）

1. **磁盘为准 fail-closed**：逐条 `fs.existsSync(path)`，缺条目即失败并列出缺失 shotId 清单，不允许静默跳镜。
2. 全条目规格一致（codec/分辨率/fps）→ **零重编码 concat**；不一致 → **最小归一**（仅差异项转码，SPEC 常量 h264/1280x720），输出 `mode: 'concat'|'normalize'`。
3. run 目录自确保：executor 入口 `mkdirSync(runDir, {recursive:true})`（9.3 缺口③修复——manifest 模式全新 runId 目录不存在曾致 writeConcatList ENOENT）。
4. 产物 `final.mp4` + `finalPath` 返回；单 run ≤10 镜旧路径（目录扫描 shot_NNN）保持向后兼容。

### 4.3 六阶段 manifest 直通（9.3 缺口①②修复合同）

pipeline `film-engineering` 六阶段（load_template → select_shots → adapt_script → export_prompts → generate_videos → film_render）。当前四阶段 context 携带**非空 `renderManifest`** 时直通（`passthrough:true, manifestMode:true`），不再要求 kitDir/勾选：

| 阶段 | 直通输出 | fail-closed 负锚（无 manifest 时不变） |
|------|---------|--------------------------------------|
| load_template | `{template:null, passthrough, manifestMode}` | 无 kitDir 且无 selectedShots → 拒绝 |
| select_shots | `{selectedShots:[], passthrough, manifestMode}` | 无 ids 无已选 → 拒绝 |
| export_prompts | 空导出 + 文件名，`passthrough` | 空选择 → 拒绝 |
| generate_videos | `{checkpoint:false, entryCount}` | 正常流仍走成本闸暂停 |

**引擎闸合同**：`pipeline-engine._executeStage` 判定 `normalizedResult.success && normalizedResult.checkpoint !== false && _shouldCheckpoint(...)`——**只放宽显式 `false`**，truthy/缺省行为不变，13 条既有流水线零影响；回归锚：selectedShots 正常流仍在 cost_confirm 暂停（paused 持久化、`confirmStageGate` 恢复路径不变）。

---

## 5. L3：全量出片流程（驱动 + IPC + 前端）

### 5.1 批次切分与台账（production-driver.js）

- 批大小 `PRODUCTION_BATCH_SIZE=10`（144 镜 → 15 批 = 14×10+1×4）；保序、batchIndex 从 0 连续。
- 批次 runId **确定性派生** `prod-<taskId>-b<batchIndex>`（重入可复算，断点续跑基础）。
- 台账 ledger JSON 落 `<userData>/film-production/<taskId>.json`：批/镜双层状态（pending/running/done/failed）、runId、shotIds。**逐镜 `shots[i].error`（string|null，`film-gen-shot-error-observability` 追加，详见 §5.5）**：该镜失败原因，`done`/成功恒为 `null`；`createLedger` 初始化为 `error:null`（append-only），旧台账无此字段读取时按 `null` 处理，向后兼容。
- **断点续跑** `resolveResumePlan(ledger, {probe})`：以磁盘产物为事实源 probe 各批 run 目录（missing 清单），已完成批次直接跳过（`skipped-complete`），不信任台账乐观状态。
- taskId 校验：`/^[a-zA-Z0-9._-]{1,64}$/`（前端预检 + 主进程 IPC 负载守卫双端同源）。

### 5.2 IPC 通道（5 invoke + 1 event，preload `filmEngineering` 共 16 方法）

| Channel | 方向 | 入参 | 返回/负载 | 许可证闸 |
|---------|------|------|-----------|---------|
| `film-engineering:production-plan` | invoke | `{taskId, shotIds}` | 批次数/批大小/镜数、diskEstimate(8MB/镜)、wallclockEstimate(300s/镜)、mediaRoot | 否 |
| `film-engineering:production-run-batch` | invoke | `{taskId, batchIndex, aspect, seconds}` | 该批真实子 run 启动（走 generate_videos 流） | 否 |
| `film-engineering:production-status` | invoke | `{taskId}` | ledger + 批/镜进度（`batches[].shots[].error` 含逐镜失败原因，见 §5.5；批级 `batch.error`）（**只读**，不触发生成计费） | 否 |
| `film-engineering:download-recycled` | invoke | `{items:[{shotId,resultUrl,orderIndex}]}` | 分片 ≤40/片下载结果 | 否 |
| `film-engineering:retry-shot` | invoke | `{runId, shotId}` | 单镜重试（prompt 由主进程按 runId 取原文，不随负载） | 否 |
| `film-engineering:production-update` | event 主→渲染 | — | 批次级 running/done/skipped-complete + 逐镜节流进度（`production:shot-progress` 携 `reason`=该镜失败原因，成功/未失败为 `null`，见 §5.5） | — |
| `pipeline:startOrchestrated`（compose 用） | invoke | `{initialContext:{renderManifest}}` | 全片合成 run | **是**（AUTH_REQUIRED code -3） |

- 事件合同：负载只带计数/batchIndex/shotIndex，**守卫断言不携带 shotIds 数组**（防 IPC 膨胀）；逐镜 `production:shot-progress` 经 `EVENT_MERGE_MS=500` 窗口节流取最新计数，`doneCount` 单调不回退。
- IPC 参数序列化：一律 `JSON.parse(JSON.stringify(obj))` 脱壳（AGENTS.md IPC 合同）。

### 5.3 回收通道安全合同（shot-downloader.js，D7）

1. **只信 kit `allowedHosts` 精确清单**（当前唯一域 `d8j0ntlcm91z4.cloudfront.net`），不通配、不硬编码兜底域。
2. **SSRF 双防线**：仅 https 协议 + DNS 解析复核（解析结果必须是公网 IP，拒绝回环/内网段——防域名重绑定）。
3. 下载完整性：临时文件 → **ffprobe 校验**（可解码 + 时长可读）→ 原子 rename 入媒体目录；失败条目返回错误不清资产。
4. `sourceKind:'downloaded'` 条目与生成产物同权进入 renderManifest（混合出片）。

### 5.4 进度事件与状态机

```
plan-ready ──发起出片──▶ batching ──全部批次 done──▶ ready-to-compose ──合成──▶ done
    │                      │  ▲                            
    └─(resume 只读恢复)────┘  └─ 逐批「确认执行本批」(确认前零调用零计费) 
```

- compose 收口：`pipeline:startOrchestrated('film-engineering', {autoAdvance:true, initialContext:{renderManifest}})` → 六阶段直通+render → `finalPath`。
- 冒烟实测（9.3，runId=mud8v775_admc）：混合 10 段（5 generated + 5 recycled）compose completed，final.mp4 ffprobe 实测 **94.58s / 1280x720 / h264 ~24fps / aac / 15.9MB**。

---

### 5.5 逐镜错误可观测性（film-gen-shot-error-observability）

真实 A 通道批量出片时，单镜失败原因曾跨三层被静默吞掉：`video-gen` 失败不记日志、handler `runBatchViaVideoGen` 丢弃 `r.error` 且 `getShot` 空 catch、driver `onShotProgress` 无 error 通道 / 台账无 `error` 字段——违反 §5.4「逐镜标注失败原因」合同。本 change 打通三层透传，**保持批收口的磁盘复核权威裁决不变（behavior-preserving）**：

| 层 | 文件 | 修复 | 数据校验 |
|----|------|------|---------|
| L-A 生成器 | `services/film-engineering/video-gen.js` | 统一失败出口 `noteFail(reason)`：五失败分支（提交 `code!==0` / 内层 `data.code<0` / 无 `taskId` / 轮询超时或 `failed/error/cancelled` / `catch` 兜底）先 `log.warn('FilmVideoGen', 'shot <i> (<shotId>) failed: <reason>')` 再返回 `{index,shotId,success:false,error:reason}` | `reason` 优先取 provider `message`，缺省回落分类默认文案（见 §6.2 文案表）；成功仍 `log.info`；`log` 缺失时守卫不崩 |
| L-B 驱动 | `services/film-engineering/production-driver.js` | `createLedger` 每镜结构加 `error:null`；`onShotProgress(shotIndex,status,reason)` 第三参落 `batch.shots[i].error`；`emitShotProgress` 事件带 `reason` | `error = next==='done' ? null : (typeof reason==='string' && reason ? reason.slice(0,500) : null)`——**≤500 截断**、非字符串归 `null`；批 `running` 时 `batch.error=null`；**磁盘 re-probe 权威**：落盘镜强制 `done` 且 `s.error=null`（覆盖偶发误报），未落盘才保留失败原因 |
| L-C 批执行 | `services/film-engineering/production-runner.js`（`runBatchViaVideoGen`，为满足超大文件门禁从 `ipc-handlers/film-engineering.js` 拆出） | `getShot` 包 `try/catch` 捕获 `shotErr=e.message`；取原文失败分支 `reason = shotErr || '未取到分镜提示词（原文为空或分镜不存在）'` → `log.warn` + `onShotProgress(i,'failed',reason)`；结果分支成功 `done`、失败透传 `r.error`（缺省 `'视频生成失败（未知原因）'`），不重复记日志（video-gen 内已 warn） | `getShot` 异常不再冒充「分镜不存在」——原文异常原因优先透出 |

- **向后兼容**：`error` 为 append-only 新增字段，不改既有字段；`production-status` 经 `{...sh}` 原样返回旧台账缺字段（undefined→前端 `s.error || null`）。
- **透出路径（显示项来源）**：① 主进程日志（`FilmVideoGen` warn，stderr/日志文件）；② `production-status` → `batches[].shots[].error`（持久台账，断点复查）；③ `production-update` 事件 `production:shot-progress.reason`（实时）。`useFilmProduction.applyStatus` 已将 `shots` 原样透传至批视图 `entry.shots`（含 `error`）；批次级失败另见 `batch.error`。
- **不做的事**：不改批收口磁盘复核权威裁决、不改 `doneCount` 单调不回退口径、不改 IPC 负载守卫；provider 原始错误文案原样透出（截断 500），不二次包装。

## 6. 前端出片面板：交互逻辑与显示项

入口：影视工程页工具栏 `fe-production-entry`「全量出片」按钮——**选中分镜 >0 即可用**（无单批 20 上限约束，与 generateSelected 勾选生图流区分）；点击自动 `production-plan` 拉计划。

### 6.1 面板状态分区与显示项

| 分区 | 显示项 | 交互 |
|------|--------|------|
| 头部 | 任务 ID 输入 + 校验提示 | `^[a-zA-Z0-9._-]{1,64}$` 前端预检，不符即时红字 |
| plan-ready | 批次计划预览：`共 N 批（每批最多 10 镜），本次 M 个分镜`；磁盘预估（GB/MB 自适应单位）；耗时预估（分钟）；媒体目录 | 「发起出片」；「恢复任务」（断点续跑入口） |
| batching | 批卡片列表：`第 i/n 批 · count 个分镜 · 画幅 16:9 · 时长 5s`；状态 el-tag（待确认/生成中/已完成/失败）；`{done}/{total} 镜` 计数；总进度条 | 每批独立「确认执行本批」（**确认前零模型调用零计费**）；画幅/时长下拉（复用 video 面板 16x9/9x16、5/8/10s 枚举）；批次明细展开逐镜状态；failed 镜「重试该镜」 |
| 全程 | 剩余批次数、`累计已确认 N 镜`（与 plan 估算同口径，D9 缓解项） | 进度刷新**不重置用户展开态**（batches 就地 mutate 不重建数组；展开 Set 以 batchIndex 为键） |
| 回收 | 引导文案（D10"先回收后精修"）+「回收全部原片」 | 分片 ≤40/片，orderIndex 全局连续；结果 `已回收 ok/total 个文件到 <dir>` |
| compose | `全部批次已收口，渲染清单共 N 条` | 「合成成片」→ run 进度 → doneTitle「成片已生成」/ failedTitle + manifestMissing 错误详情 |

> **逐镜失败原因显示（film-gen-shot-error-observability）**：批次明细展开时，failed 镜的失败原因取自 `entry.shots[].error`（源自台账 `shots[].error`，见 §5.5），数据层已由 `useFilmProduction.applyStatus` 透传至批视图；展示位为批次明细的逐镜状态与「重试该镜」入口附近。批次级错误 `batch.error`（如「批次生成后磁盘缺 N 镜」）在批卡片 `status:failed` 徽标旁透出。

### 6.2 提示文字全清单（locales `filmEngineering.production.*`，zh/en 各 44 键成对，Gate 7）

zh 关键文案（完整以 `apps/desktop/src/locales/zh.js` L2264-2308 为准）：

| 键 | zh 文案 |
|----|---------|
| entry / entryDesc | 全量出片 / 对已导入分镜按批次生成视频并合成成片；逐批确认后才计费，支持断点续跑。 |
| taskIdPlaceholder / taskIdInvalid | 用于出片台账与断点续跑，如 my-task-01（仅限字母/数字/._-） / 任务 ID 只允许字母、数字、._-，长度 1-64 |
| planSummary | 共 {batches} 批（每批最多 {size} 镜），本次 {shots} 个分镜 |
| batchHint | 确认后才开始本批生成；确认前零模型调用、零计费。 |
| confirmedBudget | 累计已确认 {count} 镜 |
| status* | 待确认 / 生成中 / 已完成 / 失败 |
| resumeHint / noLedger | 输入此前的任务 ID，只读恢复批/镜进度（不触发任何生成与计费）。 / 未找到该任务的出片台账，请确认任务 ID 或先发起一次出片 |
| recycleGuide | 建议先回收原片到本地再精修：远端结果链接有效期有限，过期后需重新生成。 |
| recycled | 已回收 {ok}/{total} 个文件到 {dir} |
| manifestReady / manifestMissing | 全部批次已收口，渲染清单共 {count} 条 / 暂无法合成：渲染清单未收口（{error}） |
| providerMissing | 尚未配置默认视频模型。请在模型设置中配置视频 Provider（如 Seedance / Kling / Veo / CogVideo）并设为默认后重试。 |

- provider 缺失时后端以 `errorCode=VIDEO_MODEL_NOT_CONFIGURED` 信封透出，前端映射 providerMissing 引导文案。

**后端逐镜失败原因默认文案（非 i18n，provider 原始 `message` 优先透出，超长截断 500）**：

| 触发层 | 默认文案 |
|--------|---------|
| 提交 `code!==0` | `submit.message` 或 `视频生成调用失败（provider: <id>）` |
| 内层 `data.code<0` | `data.message`/`data.error` 或 `视频生成失败（provider: <id>）` |
| 无 `taskId` | `视频生成未返回任务 ID（provider: <id>）` |
| 轮询超时/失败 | `视频生成超时或失败（provider: <id>）` |
| 生成器 `catch` | 异常 `error.message`（原样） |
| `getShot` 异常/取原文失败 | `e.message`，否则 `未取到分镜提示词（原文为空或分镜不存在）` |
| 结果失败无 `error` | `视频生成失败（未知原因）` |
| 批收口磁盘缺镜 | `批次生成后磁盘缺 <N> 镜`（`batch.error`） |

- 组件卸载清理：`dispose()` 注销 production/pipeline 双订阅 + poll 定时器；disposed 后事件忽略（监听泄漏回归测试覆盖）。

---

## 7. 许可证闸边界

| 能力 | 闸 | 说明 |
|------|----|------|
| `pipeline:startOrchestrated`（含 compose 全片合成） | **受闸** | 未登录返回 `AUTH_REQUIRED` code -3 |
| production-plan / run-batch / status、download-recycled、retry-shot | 不受闸 | 计划/只读状态/下载属本地操作；run-batch 内部真实生成流由各自既有链路把关 |

手动验证（debug profile）需 `identity-session.json` + `identity-entitlement.json`（自 shared-user-data 拷入）方可过 startOrchestrated 闸。

---

## 8. 验收与证据索引

| 项 | 证据 |
|----|------|
| L1 导入器 | pytest `test_fetch_hell_grind_kit.py`；真实导入报告 `evidence/import-report-20260923.json`（6,558/162/0 rejected） |
| L1 加载链 | kit-loader 单测矩阵（userData 优先/损坏回退/双缺 FILM_KIT_UNAVAILABLE/上限常量单一来源）；service 4 接线回归 |
| L2/L3 单测 | production-driver 19/19；film-render manifest 集成；video-gen checkpoint 合同 |
| 集成 E2E | `film-engineering.e2e-int.test.js` 3/3（真实 kit 链 userData 优先 + 12 镜两批过闸 + 真实 ffmpeg concat + HTTP 回收混合出片） |
| 真实冒烟 | 9.3：5 镜真实出批 + 5 镜 cloudfront 回收 + compose completed（ffprobe 94.58s）；`.agent_context/film-fix/9.3-EVIDENCE.md` |
| 回归规模 | film-engineering 全目录 + pipeline-engine + IPC：17 文件 220/220；eslint --quiet 0 |
| QM-1 | `electron-builder --win --dir` EXIT=0；asar 清单抽查（全量 kit 未入包、精简 kit 完好、修复在包内）；require 链 OK；exe 启动 10s 存活 stderr 空 |
| 逐镜错误可观测性 | `video-gen.error-observability.test.js`（7：五失败分支 warn 含 shotId+原因、成功仅 info、log 缺失守卫）；`production-driver.error-observability.test.js`（4：reason 落台账 error + 事件回显 + 持久化 reload + ≤500 截断）；`film-engineering.e2e-int.test.js` 9.1c（真实 run-batch + production-status 断言逐镜 error：done/null、provider 拒绝、getShot 异常原因非空） |
| 回归（本 change） | film-engineering 全目录受影响 **21 文件 306/306** 绿（`--no-file-parallelism`，含真实 ffmpeg e2e），无劣化；eslint --quiet 0 |
| POC（可行性） | 10 条 resultUrl curl+ffprobe 10/10 命中（4.5-8.5MB/镜）→ L3 不收缩 |

## 9. 决策与遗留（OQ 处置结论）

- **OQ1 非采纳版默认不包含**：维持 wontfix——采纳版（末次 completed）已覆盖交付需要，同 prompt 历史迭代只以 `iterationCount` 计数暴露，不入库。
- **OQ2 会话级批量授权**：deferred——逐批确认实测痛感可控（146 批为极限场景，常规子集出片批次数小）；如后续反馈强烈再评估"本次会话免确认"开关。
- **OQ3 图片扩充**：resolved 维持精选 36 张——参考图服务剧本套用场景，全量图片（万级）收益低体积大。
- 设计假设回查：proposal"成本 ≈140-280 批 × 墙钟 15-30h（免费档）"与 driver 146 批实测口径一致；`MAX_VIDEO_BATCH=10` 假设已由 PRODUCTION_BATCH_SIZE=10 继承，无漂移。
