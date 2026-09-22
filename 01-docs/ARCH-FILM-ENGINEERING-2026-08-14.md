# 影视工程流水线架构设计（Hell Grind 复刻）

> 日期：2026-08-14 ｜ 状态：已实现 ｜ 关联：PRD-video-creation.md §3.1.26、openspec/specs/film-engineering

## 1. 背景与目标

开源 AI 电影《Hell Grind》（Higgsfield 公开项目页 + OSideMedia/higgsfield-ai-prompt-skill，MIT）公开了完整影视工程：95 分钟、115,451 个素材、162 个分镜文件夹、结构化提示词体系。本架构把「真实工程的精选资产」复刻为应用内新流水线 `film-engineering`：

- **数据层**：随包 film-kit（≤5MB）：162 场景树 / 153 个代表性分镜提示词 / 332 条 token 资产索引 / 提示词方法论 / 10 张精选参考图。
- **引擎层**：kit 加载校验（fail-closed）、分镜库查询、一键复制文本组装、剧本套用引擎（分场 → 模板映射 → 同构 adaptedShots，可选 LLM 润色降级）、导出、勾选生成（复用 assetGenerator）。
- **集成层**：`film-engineering` 流水线注册（4 阶段）+ 10 个 IPC 通道（withSenderCheck）+ 路由 `/film-engineering` 三标签页视图。
- **质量**：服务/契约/前端全量单测；i18n zh/en 成对；OpenSpec 全流程；QM-1 打包验证。

## 2. 总体架构

```mermaid
flowchart LR
    subgraph Renderer[Renderer (Vue 3)]
        V[FilmEngineeringView 三标签页] --> C[useFilmEngineering composable]
    end
    C -->|electronAPI.filmEngineering.*| P[preload/film-engineering.js]
    P -->|ipcRenderer.invoke| H[ipc-handlers/film-engineering.js]
    H -->|withSenderCheck + 入参校验| S[FilmEngineeringService]
    S --> L[kit-loader: loadFilmKit]
    S --> SL[ShotLibrary: 查询/复制文本]
    S --> SA[ScriptAdapter: 剧本套用]
    S --> AG[assetGenerator: 勾选生成图片]
    S --> PE[PipelineEngine: 4 阶段链]
    L --> K[film-kit 数据资产目录]
    K --> M[film-manifest.json]
    K --> SH[shot-library.json]
    K --> R[reference-registry.json]
    K --> D[prompt-doctrine.json]
    K --> I[images/*.webp]
    S --> IPC2[导出 JSON/Markdown 下载]

    style K fill:#e8f0fe
    style H fill:#fef7e0
```

## 3. 数据资产设计（film-kit）

### 3.1 目录布局

```text
apps/desktop/electron/film-kit/
├── film-manifest.json        # 电影元数据 + 场景树（schemaVersion=1）
├── shot-library.json         # 153 个代表性分镜
├── reference-registry.json   # 332 条 token → 资产索引
├── prompt-doctrine.json      # 7 块模板 + 10 铁律 + 术语表（中英）
├── prompt-doctrine.zh.md     # 方法论完整中文版（文档/方法论页引用）
├── SCHEMA.md                 # schema 文档（kit 结构与校验规则）
└── images/                   # 10 张精选参考图（min webp）
```

### 3.2 数据契约（fail-closed 校验摘要）

| 文件 | 关键字段 | 校验规则 |
|------|---------|---------|
| film-manifest | schemaVersion / filmMeta{title,durationSec,logline,characters[]} / scenes[]{id,name,count,parentId,level} | schemaVersion===1；title/logline 非空；durationSec>0；characters 非空且 name 非空；scenes 非空、id 唯一、count>=0、level>=0、parentId 存在且无自引用环 |
| shot-library | shotId / sceneId / prompt / model / refTokens[] / resultUrl / width / height | prompt 非空 ≤50000；refTokens 每项 UUID；width/height 正数或 null |
| reference-registry | 键=UUID token；{kind: character\|scene\|prop\|unknown, name, imageUrls[]} | 键 UUID；kind 枚举；imageUrls 仅 https |
| prompt-doctrine | blocks[]{key,label,zh,en} / rules[]{key,title,zh} / glossary[]{term,zh} | blocks/rules 非空；glossary 数组 |

加载流程 `loadFilmKit(kitDir)`：逐个 `readFileSync` → `JSON.parse` → 四个 validate 函数 → 任一失败返回 `{ok:false, error}`，服务层抛 `FILM_KIT_UNAVAILABLE`。成功后构建索引：`shotById` / `sceneIndex` / `shotSceneIndex`。

### 3.3 语料来源与重建

- 全量语料（155,123 jobs / 161 jsonl）本地归档于 `D:\Data\projects\mp-research\hell-grind-full`（不进仓库）。
- 重建脚本 `scripts/film-engineering/fetch-hell-grind-kit.py --source-dir <全量目录> --out-dir <kit 目录>`：
  - 分镜代表性选取：每文件夹取 `created_at` 最大的 completed **视频** job（无视频取图片 job）；
  - token 解析：prompt 中 `<<<uuid>>>` 匹配 `params.reference_elements[].id`（非 job id）；注册表 key 必须 UUID；
  - 角色图：按名优先取 `char_1-4.webp`；其余精选 min 版压缩为 webp；
  - 产出 SCHEMA.md 与统计输出（场景/分镜/注册表/未解析 token 数/体积）。

## 4. 引擎层设计

### 4.1 kit-loader.js

导出 `loadFilmKit` / `validateManifest` / `validateShotLibrary` / `validateReferences` / `validateDoctrine` / `MAX_PROMPT_LENGTH=50000`。fail-closed 是铁律：**不允许部分可用**。

### 4.2 shot-library.js（查询 + 复制文本组装）

```text
listScenes()        → [{id,name,count,parentId,level,shotCount}]
listShots(sceneId)  → [public shot]（sceneId 非法/不存在抛错）
getShot(shotId)     → public shot + resolvedRefs[]（token → registry entry | {kind:unknown}）
buildCopyText(shotId, mode)  → full | blocks | characters | geo
buildCopyTexts(shotIds, mode) → 合并文本（≤50）
```

复制文本由**主进程组装**（跨平台一致），前端只写剪贴板。`blocks` 模式：按 `BLOCK_HEADINGS`（GEO SPATIAL LAYOUT / ACTION TIMING / AUDIO / CHARACTER ACTING / POSITIVE CONSTRAINTS）切块，输出 `[ 标题 ]` + 内容；无块回退原文。`characters` 模式：过滤 `[CHARACTER:` 行。`geo` 模式：GEO 块内容；缺失返回 `（无 GEO SPATIAL LAYOUT 块）`。

### 4.3 script-adapt.js（剧本套用引擎）

**分场**（`splitScript`）：`\r\n`→`\n` 归一化 → 按 `\n{2,}` 分段 → 单行标题（`第X场` / `SCENE n` / `INT.` / `EXT.` / `INT./EXT`）并入下一段；每段产出 `{index,title,text}`。

**模板映射**（`buildTemplatePrompt`）：kit 全部分镜按序循环作为模板（`templates[i % templates.length]`），组装结构：

```text
[场景头：INT./EXT. 模板首行，否则剧情首句]
[剧情句（用户剧本段落全文）]
[模板全部 [CHARACTER:...] 行；命中角色映射时追加 （用户角色名）]
[模板 5 大提示词块原样保留]
```

**输出**（与 kit 分镜同构，可直接被勾选生成/导出消费）：`{shotId: adapt-001, sceneId: 标题归一化|adapted-scene-N, prompt, model: 模板 model, refTokens: 模板前 8 个, roleBindings, beatIndex, sourceTemplateId, llmEnhanced:false}`。

**校验**：剧本非空 ≤10000 字；characterMap 对象 ≤10 键、值非空；无模板分镜/无法分场均返回明确错误。

**LLM 润色**：`llmEnabled && llm.enhance` 可用时逐条润色（≤20），每条失败降级本地模板结果并记 warnings；全部失败 `llmEnhanced:false`。默认确定性模板（无 LLM 也能工作，可离线测试）。

### 4.4 流水线阶段（film-engineering-stages.js）

```text
film_load_template  → loadFilmKit，context.template 缓存复用（幂等）
film_adapt_script   → ScriptAdapter.adaptScript（stages 内 llm:null，确定性）
film_select_shots   → selectedShotIds 必须在 kit 或 adapted 中（≤50）
film_export_prompts → JSON/Markdown 导出（格式非法报错）
```

注册点：`container.setup.js` 调 `registerFilmEngineeringStages(pipelineEngine)`；`PIPELINES` 数组新增 `film-engineering` 条目。

### 4.5 聚合服务（film-engineering-service.js）

`getStatus()` 不抛错；`exportPrompts`（≤50，JSON/Markdown）；`generateSelected`（≤20，逐条调 `assetGenerator.generateImage(prompt, {style:'cinematic', index, aspect_ratio})`，容错聚合：全部失败 → fail + 首个错误；部分失败 → `partialFailure:true`）。

## 5. IPC 契约

10 通道全部 `withSenderCheck`（防外部网页调用）+ 入参运行时校验，统一信封 `{code, data?, message?}`；`code===0` 成功。校验上限：剧本 10000、角色映射 10 键、数组批量 50、生成批量 20、prompt 50000。通道加入 PUBLIC_CHANNELS（未登录可用）。preload 暴露 `window.electronAPI.filmEngineering.*` 10 方法。

主进程 handler 统一签名 `(_e, ...params)`，`withKit` 必须同时转发 Electron event 与业务参数（`fn(event, ...args)`）；若只转发业务参数，参数会左移并触发 VALIDATION_ERROR。renderer 提交到 IPC 的 payload 必须是纯 JSON，Vue reactive proxy 由 composable 在构造 payload 时脱壳。

## 6. 前端设计

### 6.1 composable（useFilmEngineering.js）

- 状态：status / scenes / selectedSceneId / shots / shotDetail / doctrine / selectedShotIds / copyMode / generating / exportLoading / adapt{script,characterMap,llmEnabled,adaptedShots,warnings,loading}。
- 剪贴板：`navigator.clipboard.writeText` 优先，失败回退 textarea + `execCommand('copy')`。
- IPC 信封解包：`unwrap()` 统一 `formatUserError`（含用户可读 fallback）。
- 浏览器直开 Vite（无 electronAPI）静默降级：status 置「当前环境未提供桌面端能力」，操作提示不可用。
- 选区分镜 payload 构建：kit 分镜直接透传；adapted 分镜在前端本地组装（虚拟 shotId 不经过主进程 copy-texts，直接写剪贴板）。

### 6.2 视图（FilmEngineeringView.vue）

三标签页：分镜库（场景树 + 分镜列表 + 工具栏 + 详情抽屉 + 生成结果弹窗）/ 剧本套用（剧本 + 角色映射 + LLM 开关 + 结果列表）/ 方法论（7 块 + 10 铁律 + 术语表）。交互细节与提示文字见 PRD §3.1.26。

### 6.3 路由与入口

- 路由 `/film-engineering`（懒加载）；CreateView 入口：流水线卡片 `FILM_ENGINEERING_PIPELINE_ENTRY` → 路由跳转。
- `pipeline-labels.js` 注册卡片标签；`pipelines.names/descriptions/modes` i18n 成对。

## 7. 测试策略

| 层 | 文件 | 覆盖 |
|----|------|------|
| kit 加载 | kit-loader.test.js | 缺文件/坏 JSON/schema 非法/token 格式错 → fail-closed |
| 分镜库 | shot-library.test.js | 查询/非法 id/复制四模式/批量上限 |
| 剧本套用 | script-adapt.test.js | 分场/模板映射/角色绑定/超长拒绝/LLM 降级标记 |
| 契约 | film-engineering-adapt-contract.test.js | adaptedShots 与 kit 分镜同构、可被 generate-selected 消费 |
| 阶段链 | film-engineering-stages.test.js | 4 阶段链/checkpoint/错误 |
| IPC | ipc-handlers/film-engineering.test.js | 校验/sender/FILM_KIT_UNAVAILABLE |
| 服务聚合 | film-engineering-service.test.js | status/export/generate 容错聚合 |
| preload | preload.test.js | 10 方法桥接 + public 权限 |
| 真实 E2E | apps/desktop/tests/e2e/film-engineering-real.js | 打包 Electron EXE 24 项：入口/场景/分镜/详情/复制/导出/套用/方法论/生成（`pnpm test:e2e:film-engineering`） |
| 前端 | useFilmEngineering.test.js + CreateView.test.js | IPC 数据转发/空态/错误路径/入口路由 |
| i18n | src/i18n/i18n.test.js | zh/en 对称 + filmEngineering 命名空间 |

## 8. 安全与边界

1. **fail-closed**：kit 数据损坏 → 整体不可用，绝不部分降级。
2. **sender 校验**：全部 IPC withSenderCheck，拒绝外部网页调用。
3. **参数校验**：所有入参运行时校验（长度/枚举/数组上限），防注入。
4. **纯 JSON 序列化**：renderer → IPC 参数为纯 JSON（无 reactive proxy）。
5. **URL 白名单**：registry imageUrls 仅 https；前端 img `referrerpolicy="no-referrer"` + loading=lazy。
6. **版权边界**：只使用公开 API 元数据与精选小图；电影视频本体不入库；文档标注来源（Higgsfield 项目页 + MIT skill）。
7. **打包状态**：kit 通过 `files` glob 随 asar 打包；QM-1 验证加载。

## 9. 已知限制与后续（V2）

1. V1 勾选生成仅图片（assetGenerator）；AI 视频生成（Seedance 等视频 provider 直连）留 V2。
2. LLM 润色默认关闭（确定性模板优先）；服务端 PromptBridge 接入后默认开启。
3. adaptedShots 的角色映射替换为「追加括号标注」，不做深度语义替换（保留模板原文供用户编辑）。
4. 全量语料不进仓库（数十 GB）；kit 重建依赖本地归档目录。

## 10. 回滚与兼容

- 移除 PIPELINES 条目 + container.setup 注册调用即可完全禁用；删除 film-kit 目录不影响既有功能。
- 所有新通道独立命名；路由懒加载；旧版本不受影响。

---

## 11. 全量语料与全片量产扩展（2026-09-23，openspec change `film-full-corpus-production`）

> 本节为基线修正 + 增量架构。§1/§3 的"153 代表镜 / 随包 ≤5MB / 10 IPC 通道"口径在此升级为：全量 **6,558 采纳版镜（6,500 唯一视频提示词 / 162 场景 / video job 133,053）**，kit 两级落点，film-engineering 通道 **16 个**。详版规格见 `PRD-FILM-FULL-CORPUS-PRODUCTION-2026-09-23.md`。

### 11.1 L1 全量导入与两级 kit

- 导入器 `scripts/film-engineering/fetch-hell-grind-kit.py` 新增 `--full`（每场景全部唯一提示词入库，规范化 SHA1 去重 + 末次 completed 采纳版 + 图片模型黑名单）、`--dry-run`（对账统计与真实导入同源）、`--with-images`；落盘 `.tmp`→rename 原子写 + `import-report.json`。
- **两级加载链**（`kit-loader.loadFilmKitChain`）：`userData-full`（共享锚点 `<userData>/film-kit/`，≈80MB）优先 → 损坏自动回退 `asar-bundled` 精简 kit（123 镜代表集，随包 ≈9MB），回退经 log 可见非静默；两级全坏抛 `FILM_KIT_UNAVAILABLE`。`getStatus()` 新增 `kitSource` 显示项。
- schema 扩展字段：`durationSec/width/height/aspectRatio("W:H")/model/resultUrl/iterationCount/adoptedJobAt`；prompt 上限统一常量 `FILM_PROMPT_MAX_LEN=50000`（超限拒绝入库进 rejected）；manifest 新增 `allowedHosts`（下载白名单单一来源，D7）。
- 查询分页双形态：缺省全量数组（回归锚）/ `{limit,offset}` → `{shots,total,limit,offset}`；`FULL_LOAD_LIMIT=500`、`MAX_PAGE_LIMIT=200`、`DEFAULT_PAGE_LIMIT=100`；前端虚拟滚动。

### 11.2 L2 renderManifest 跨 run 合成

`film_render` 输入扩展为镜头清单 `[{shotId,path,sourceKind:'generated'|'downloaded',durationSec,orderIndex}]`（上限 10,000），条目可跨批次 run 目录与下载通道混合；磁盘为准 fail-closed（缺条目列清单拒绝）；规格一致零重编码 concat / 不一致最小归一（h264/1280x720）；executor 入口自确保 run 目录（mkdirSync recursive）。六阶段流水线前四阶段对非空 renderManifest **直通**（passthrough/manifestMode，fail-closed 负锚保留），generate_videos 直通返回显式 `checkpoint:false`，引擎闸判定改 `checkpoint !== false`（只放宽显式 false，13 条既有流水线零影响）。

### 11.3 L3 全量出片驱动与回收通道

- `production-driver.js`：`PRODUCTION_BATCH_SIZE=10` 保序切批；批次 runId 确定性派生 `prod-<taskId>-b<idx>`；台账 `<userData>/film-production/<taskId>.json`（批/镜双层状态）；断点续跑以**磁盘产物 probe 为事实源**（不信任台账乐观状态）。
- IPC 新增 5 invoke + 1 event：`production-plan`（批次/磁盘 8MB·镜/墙钟 300s·镜预估）、`production-run-batch`（逐批确认后才计费）、`production-status`（只读恢复）、`download-recycled`（回收，分片 ≤40/片）、`retry-shot`（单镜重试，prompt 主进程按 runId 取原文）、`production-update`（事件，500ms 节流、负载只带计数不带 shotIds）。许可证闸边界：仅 `pipeline:startOrchestrated`（compose）受闸。
- `shot-downloader.js` 安全合同：只信 kit `allowedHosts` 精确清单；https-only + DNS 公网复核双防线（SSRF）；临时文件 → ffprobe 校验 → 原子 rename。
- 前端出片面板（FilmEngineeringView + `useFilmProduction`）：plan-ready → batching（逐批确认卡片 + 批/镜双层进度 + 重试/续跑/回收引导）→ compose → done；locales `filmEngineering.production.*` zh/en 各 44 键成对。

### 11.4 验证基线

集成 E2E 3/3（真实 kit 链 + 12 镜两批过闸 + 真实 ffmpeg concat + HTTP 回收混合出片）；真实 provider 冒烟（5 镜出批 + 5 镜 cloudfront 回收 + compose completed，final.mp4 ffprobe 实测 94.58s/1280x720/h264+aac）；回归 17 文件 220/220、eslint 0；QM-1 打包三验证（全量 kit 确认未入 asar）。

