# PROJECT-003 多平台一键发布 — 开发报告

**最后更新**: 2026-08-08
**当前版本**: 2.3.53
**当前状态**: 图片轮播稳定性与体验系列修复（PR #397-400、#402）已合入 main

> 本文件顶部保留 2026-06-03 的历史基线；当前 Logto 用户系统交付以文末
> “2026-07-20：Logto 用户系统交付补充”为准。

---

## 2026-08-28：视频创作流水线「保存配置」组合配置库

### 交付内容
- 视频创作模块所有流水线新增「保存配置」：命名组合配置保存（CreateView 编排/legacy 两分支，以及 video-clone、film-engineering 专用页）、一键应用、重命名、删除；设备级本地持久化路径为 userData/story2video-config-profiles/config-profiles.json，临时文件独占创建后原子替换，Windows 占用错误有界重试。
- IPC 四通道（list/create/rename/delete）+ preload public 白名单；应用语义含类型感知合并、枚举/数值归一化、失效 provider 回退、跨流水线拒绝；legacy 应用为整对象替换（修复原地合并语义 Bug）。
- 与「上次选项」自动恢复并存；不保存素材/运行态/凭证；不改变引擎与提交契约。

### 验证
- 数据与交互边界：名称按 Unicode code point 计数 1..60，pipelineId/profileId 使用正则白名单，快照为普通 JSON 对象且 UTF-8 ≤64KiB，每流水线最多 50 条；不可解析索引可读为空库并由合法 create 重建，可解析但根结构或条目非法时 list 过滤合法项且所有写操作 fail-closed、保留原始字节。保存/应用/重命名/删除均有输入校验、确认态、关闭时请求代际保护与安全错误映射；快照不保存素材、凭证、URL、runId、报告、相似度或发布运行态。
- 单测（截至当前 focused 证据）：服务 + IPC + composable + 管理器 + publisher 共 323 tests 全绿；VideoCloneView/FilmEngineeringView 页面级 8 tests 全绿；完整 desktop Vitest、类型、lint、构建、打包与可见窗口证据需在本分支交付阶段继续执行。
- 门禁：OpenSpec proposal/design/delta-spec/tasks 严格校验通过；locale zh/en 成对检查通过，CJK 当前仅剩 CreateView 历史行号漂移，确认无新增硬编码后再更新基线；tsc/eslint/preload/vite/打包门禁与全量测试按交付阶段记录。
- OpenSpec：proposal/design/delta-spec/tasks 齐全并已严格校验；正式 spec 与实现统一使用 userData/story2video-config-profiles/config-profiles.json，明确不可解析索引可重建、可解析非法索引写保护的区别。

### 最终交付状态（2026-08-29）
- 功能 PR #1219 已 squash 合并，merge SHA 为 252901500664d662ece2c2c2e8cd39c4416d2c68；QG Static/Autonomous/Browser E2E/Coverage/Desktop Shards×2/Unit Tests/Visual、Ubuntu/Windows build、electron-tests、gui-test、文档同步、Lint、Agent Judge、Gate Result 均通过，并已验证该 SHA 位于 origin/main。
- OpenSpec 主规格已同步，change 归档于 openspec/changes/archive/2026-08-29-s2v-pipeline-config-profiles/；CCG 任务已归档于 .ccg/tasks/archive/2026-08/s2v-pipeline-config-profiles/。归档过程中的文档同步门禁要求显式包含产品文档，因此本节作为最终状态补充，不改变已实现功能逻辑。
- 本地全量 desktop Vitest 保留两类既有环境/基线失败（asset-generator 的 spawn mock 与 Windows symlink EPERM）；打包应用虽通过 builder、ASAR 和入口检查，但未取得非零 MainWindowHandle/窗口标题，因此不可宣称可见窗口验证通过；.playwright-browsers 缺失也使完整 Chromium 捆绑未被宣称。
- 真实第三方登录、provider 调用、素材上传、发布、云同步和跨设备同步仍属于外部验收边界，本次实现与 CI 证据不覆盖这些结论。

## 2026-08-08（第二轮）：多模态模型类别 + MiniMax TTS 真实链路修复

### 交付范围（PR #411、#413、#414）

| PR | 内容 | 关键文件 |
|----|------|----------|
| #411 | 模型设置新增「多模态模型」类别 + MiniMax 多模态预设（一个 API Key，能力 tts/image/video）+ 能力路由（`getDefault` 多模态优先，默认开启）+ `MinimaxMultimodalAdapter` | `model-provider-seeds.js`、`model-provider-manager.js`、`adapters/minimax-multimodal.js`（新）、`ai-generator.js`、`ModelProviders.vue`、`useModelProviderCrud.js` |
| #413 | 克隆音色 voice_id 合规（官方约束长度[8,256]/首字母英文字母）+ 存量非法克隆标记失效 + 偏好回退默认音色（旁白 0/1 第一层根因） | `adapters/minimax-tts.js`、`tts-voice-clone-service.js`、`tts-voice-service.js`、`CreateView.vue` |
| #414 | 异步 T2A 查询响应层级双层兼容（官方 status/file_id 在顶层，实现只读 data.* 致 90s 超时；旁白 0/1 第二层根因） | `adapters/minimax-tts.js` |

### 真实链路验证（profile + 真实 MiniMax）
- 旁白 0/1 两层根因修复后：`minimax-tts synthesize success（约 13s）`，**图片 1/1 · 旁白 1/1**，成片 20s 生成；音色下拉显示失效克隆「01（已失效，请重新克隆）」并自动回退默认音色。
- 遗留：真实克隆音色重新克隆 → 成片（待办 C-1）；sensenova-llm key 解密失败需在模型设置重新填写。

### 验证与流程
- 本轮新增测试约 19 例（multimodal 12、voice_id 合规/委托 4、异步查询层级 2、失效克隆 catalog 1）；全量 6512 tests 通过。
- PR #411/#413/#414 均通过 Doc Sync、单元测试/Lint、Windows/Linux build、Electron tests、GUI/Visual tests 与 Quality Gate 后合入 main。
- 文档同步：PRD 7.1.4.1/7.1.15/7.1.16、CHANGELOG、learnings、E2E-PENDING 已随附。

---

## 2026-08-08：图片轮播稳定性与体验系列修复

### 交付范围（PR #397-400、#402，另有 PR #396 为并行会话）

| PR | 内容 | 关键文件 |
|----|------|----------|
| #397 | 模型服务异常检测（ProviderAnomalyBus）+ `callAdapter` 有界超时 + pipeline-engine 执行日志 + 优化进度前置 | `services/provider-anomaly.js`（新）、`model-provider-manager.js`、`pipeline-engine.js`、`story2video-stages.js`、`CreateView.vue` |
| #398 | 弹窗标题统一「提示」/「Notice」+ 选项保存 toast 悬浮布局 + 媒体校验细分与文件要求提示 | `story2video-notifications.js`、`CreateView.vue`、`locales/*` |
| #399 | 失败任务持久展示历史（`RunStateStore.listFailed()` + `getHistory()` 合并），状态「生成失败」 | `run-state-store.js`、`pipeline-engine.js`、`CreateView/CreateHistory.vue` |
| #400 | 分段图片显示（媒体服务 Content-Type 补图片类型）+ 下载改走主进程 `story2video:save-as` | `story2video-media-server.js`、`ipc-handlers/story2video.js`、`ResultView.vue`、preload bundle |
| #402 | MiniMax 异步 T2A（`speech-2.8-*` 走 t2a_async_v2→查询→下载）+ 资源进度前置 | `adapters/minimax-tts.js`、`story2video-stages.js` |
| #396 | 图片动效归一化到场景时长、移除单图轮播选项、UTF-8 manifest（并行会话） | 见 PLAN-STORY2VIDEO-SCENE-DURATION-2026-08-08.md |

### 关键根因与修复

- **MiniMax 生成失败**：默认模型 `speech-2.8-turbo` 是异步 T2A，但 adapter 调同步端点 `/t2a_v2`（200 但无 `data.audio`）→ 实现完整异步流程。
- **分段图片不显示**：媒体服务 `CONTENT_TYPES` 缺图片类型，`nosniff` 下 `<img>` 拒绝渲染 `application/octet-stream`。
- **下载无反应**：`<a download>` 对跨源本地 HTTP 媒体 URL 无效 → 主进程 `dialog.showSaveDialog + copyFileSync`。
- **失败任务历史消失**：`getHistory()` 只读内存，持久化失败快照未合并 → 新增 `listFailed()` 并按 runId 去重。
- **进度数字晚显示**：optimize/assets 进度前置写入（0/N），不等首个资源完成。
- **弹窗标题/toast/提示**：标题去流水线名；toast 改 overlay；媒体校验细分具体原因。

### 验证与流程

- 本轮新增测试约 31 例（provider-anomaly 11、callAdapter 异常检测 4、getRunContext 2、CreateView 横幅 3、optimize 进度 2、listFailed 5、getHistory 重启/去重 2、状态文案 1、媒体 Content-Type 2、save-as 2、preload/API 若干、ResultView 下载 3、MiniMax 异步 5、进度前置 1）；相关文件测试全过。
- CI 稳定性：credential-store 真实 Windows 文件锁用例超时提升到 60s（CI 全量负载偶发超时，非回归）。
- PR #397-400、#402 均通过 Doc Sync、单元测试/Lint、Windows/Linux build、Electron tests、GUI/Visual tests 与两组 Quality Gate 后合入 main（`8b0ba223`）。
- 文档同步：PRD.md 7.1.12-7.1.15、CHANGELOG、learnings 各 PR 已随附；本报告为汇总。

### 待真实验收

MiniMax 异步 T2A 成片、分段图片/下载交互、失败任务历史展示、provider 异常横幅——需真实 provider 账号/API 跑 E2E（见 `E2E-PENDING.md`）。

---

## 2026-07-30：剩余工作树祖先关系整合

### 整合边界

- `codex/desktop-baseline-fixes@df36d6a` 的许可证权限和四类 STT 行为已由主线等价吸收；与 `main@df188100` 创建双父 merge commit 只闭合提交祖先关系，不回退主线产品实现。
- 6 个冲突路径均保留主线增强版本；冲突消解后的产品树与 `main` 无净差异。
- PR #345 的净差异仅为 CCG 任务记录、质量门禁和本开发报告，不包含产品代码、配置、依赖或运行时产物。

### 验证与流程

- 聚焦回归 9 files / 191 tests；Desktop 全量 335 files / 5839 tests；Fault 14/14、Monkey 5/5、Vue 1825 modules 和 preload 双 sandbox 均通过。
- Windows x64 QM-1 使用 electron-builder 25.1.8 / Electron 43.1.1 生成最终 NSIS/ASAR；离线 Chromium 610 files / 721,890,062 bytes，源码与产物逐文件哈希一致；随包 FFmpeg 编码、ffprobe 探测和完整解码通过。
- 污染开发环境变量下隐藏启动 10 秒，8 个本次进程存活且 stderr 0；`16521/8002/8013` 均归属本次进程树，精确清理后无 PID、端口或临时目录残留。stdout 中既有通用 Python backend、托盘图标/快捷键和 orchestrator 降级保持显式记录。
- 两个隔离本地复核无阻断项；用户明确选择暂不向 antigravity/Claude 外发审计差异，因此不把本次流程豁免记作 CCG 双模型通过。
- PR #345 最新 head 的 Doc Sync、单元测试/Lint、Windows/Linux build、Electron tests 和两组 Quality Gate 全部通过，并于 `2026-07-30T15:27:14Z` 以 merge commit `1539014` 合入 `main`。

---

## 2026-07-26：Story2Video Text 标准模式对齐

### 交付范围

- `story2video-compose` 只接受 `text`；`image/remix/gallery/audio/batch` 明确排除，不再作为待实现模式。
- 对齐文案、分句、提示词优化、图片/TTS Provider、字幕、BGM、动效、模板、输出版本、项目历史、结果交付和发布参数。
- 普通视频流水线继续支持文字、图片、音频和视频输入；结果页的分段编辑、旁白替换、STT、重试、裁剪和 ZIP 不因创作模式收敛而删除。

### 实现与数据合同

- Electron 适配层新增 `Story2VideoTextConfig` v1，在创建 run 前完成默认值、枚举、数值范围、text-only、敏感上下文和纯 JSON 白名单校验。
- CreateView 只为 Story2Video 展示文案输入，构造版本化嵌套配置，并以独立 `s2vOutputConfig` 隔离分辨率、FPS 和格式。
- PipelineEngine 仅在 `story2video-compose` 启动路径调用归一化器，再把参数映射到既有六阶段；共享 `StageExecutor`、`ServiceBus` 和普通 `pipelineStart` 未修改。
- Python YAML 收敛为 `required: [text]`、`supported_modes: [text]`，默认值和阶段 options 与 Electron 合同同步。
- 完成项目使用 manifest v2 保存白名单配置，BGM 先复制到受控项目目录；旧 manifest v1 保持可读。

### 整体架构影响评估

| 边界 | 影响 | 结论 |
|------|------|------|
| 普通视频流水线 | 不经过 Story2Video 归一化，原有 text/images/audio/video 参数继续进入既有 stage 映射 | 低风险，无流程变更 |
| `StageExecutor` / `ServiceBus` | 接口和实现均未修改 | 无架构变更 |
| Story2Video 调用方 | 旧图片、音频、视频创作输入会在创建 run 前失败 | 预期的合同收紧 |
| 项目持久化 | 新项目写 manifest v2；读取端继续接受 v1 | 低风险、向后兼容 |
| 外部服务 | 8002、8013、真实 Provider、发布账号、音色克隆、配额和公网分享仍在外部边界 | 不冒充本地完成 |

### 质量结果

- TDD text-only 边界：新增畸形媒体输入用例先 `3 failed`，实现后归一化器 `21/21` 通过；四个相关测试文件 `97/97` 通过。
- 新归一化器覆盖率：statements 84.31%、branches 76.57%、functions 100%、lines 89.31%。
- 故障注入 `14/14`、Monkey `5/5`、真实 ffmpeg MP4/WebM + BGM/水印/转场 `1/1`。
- 真实 YAML loader + JSON Schema 合同通过；当前可用 Python 环境缺少 pytest，未将直接 loader 验证写成 pytest 全套通过。
- Vue 生产构建通过（1825 modules），preload 在 `sandbox:true/false` 两种模式通过。
- Story2Video 详情页只出现“文案”输入；桌面和 390px 移动 viewport 无横向溢出或运行时错误；像素门禁 `17/17`。
- Windows x64 electron-builder 通过；关键文件进入 ASAR，从解包文件集加载 RPA 入口成功，应用 8 秒存活且 stderr 为空。
- 全桌面 coverage：323 files / 5720 tests 通过，5 files / 9 tests 失败。失败文件在本分支无 diff，分别是许可证环境判断 6 项和 STT 旧能力预期 3 项，作为基线阻断单独处理。

---

## 2026-07-20 当前交付

### 交付范围

- 保持 Multi-Publish 顶部菜单和最左侧平台账号列表不变。
- 重构账号管理、内容发布、批量发布、草稿、排期和动态状态区域。
- 复用参考产品逆向分析中的字段、状态和交互证据，不直接依赖其构建产物。

### 设计与代码分离

| 层级 | 责任 | 主要位置 |
|------|------|----------|
| 展示层 | 纯渲染、可访问性、用户事件 | `src/features/accounts`、`src/features/publish`、`views` |
| 用例层 | 页面状态、校验、流程编排 | `src/composables`、`src/stores` |
| Renderer API | Electron 能力统一入口和 fallback | `src/api/publisher.js` |
| Preload | 最小 IPC 能力暴露 | `electron/preload` |
| IPC 边界 | 来源校验、纯 JSON 契约、字段白名单 | `electron/ipc-handlers` |
| 领域服务 | 账号、队列、发布路由、二维码和存储 | `electron/services`、`electron/publishers` |

页面主路径不直接调用 `window.electronAPI`。账号公开数据与凭证数据分离：渲染层只能读取/写入公开元数据，凭证由主进程登录服务捕获并持久化。

### 完成功能

- 账号分组、收藏、搜索、筛选、排序、默认账号、批量删除和状态刷新。
- 内嵌浏览器登录、二维码登录、OAuth/API 登录入口。
- 单篇和批量多账号发布、定时排期、取消、重试和终态进度。
- 草稿完整往返、平台级差异化标题/正文、内容限制和预检。
- 任务队列 shutdown 取消等待/延迟/运行中任务；RPA 取消与成功响应竞态保护。
- IPC sender 校验、账号公开字段脱敏、渲染器账号写入白名单和路径参数校验。

### 质量状态

单元、覆盖率、故障注入、Monkey、E2E、视觉、preload sandbox 和变异测试已建立。本轮最终打包、ASAR、require 链、启动及完整回归的最新结果统一记录在 `.quality-gates.md`，未完成前不标记发布完成。

---

## 历史基线（2026-06-03，v0.1.1）

## 已完成内容

### 1. 项目骨架
- 目录结构完整（src/web/config/tests/data）
- PRD 文档（`PRD.md`）
- README 说明文档
- requirements.txt 依赖清单
- config.yaml 配置文件

### 2. 核心模块（src/multi_publish/）

| 模块 | 文件 | 状态 |
|------|------|------|
| 顶层导出 | `__init__.py` | ✅ v0.1.1 |
| 数据模型 | `models.py` | ✅ |
| 凭证加密 | `crypto.py` | ✅ |
| **账号持久化** | `account_store.py` | ✅ **新增** |
| 发布器管理器 | `core/publisher_manager.py` | ✅ |
| 任务队列 | `core/task_queue.py` | ✅ |
| 调度器 | `core/scheduler.py` | ✅ |
| 基础发布器接口 | `publishers/base.py` | ✅ |
| 微信公众号发布器 | `publishers/wechat_mp.py` | ✅ **正式发布支持** |

### 3. Web 服务（web/）

| 文件 | 状态 |
|------|------|
| FastAPI 服务 | `web/server.py` ✅ v0.1.1 |
| 首页 | `web/templates/index.html` ✅ |
| 发布页 | `web/templates/publish.html` ✅ |
| 账号管理页 | `web/templates/accounts.html` ✅ **CRUD 完整** |
| 任务列表页 | `web/templates/tasks.html` ✅ |
| 全局样式 | `web/static/style.css` ✅ |

### 4. 测试验证

```
[OK] 顶层导入 OK
[OK] models OK
[OK] crypto OK (AES-256 加密解密通过)
[OK] account_store OK (持久化存储测试通过)
[OK] publisher_manager OK
[OK] task_queue OK
[OK] scheduler OK
[OK] publishers/base OK
[OK] publishers/wechat_mp OK (正式发布接口已实现)
All core tests passed!
```

---

## 本期新增功能

### ✅ 账号持久化存储（P0）
- **模块**: `account_store.py`
- **存储**: JSON 文件（`data/accounts.json`）
- **加密**: PBKDF2-HMAC-SHA256 密钥派生 + AES-256
- **特性**: 原子写入、重启后自动加载、主密码固定密钥
- **API**: GET/POST/PATCH/DELETE `/api/accounts`

### ✅ 微信公众号正式发布（P0）
- **接口**: `cgi-bin/publish`（需要企业认证公众号）
- **流程**: 创建草稿 → 正式发布
- **权限检测**: 自动识别权限不足错误
- **fallback**: 正式发布失败时返回草稿信息
- **验证**: `validate()` 方法测试认证状态

---

## API 端点清单

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/` | 首页 |
| GET | `/publish` | 发布页面 |
| GET | `/accounts` | 账号管理页面 |
| GET | `/tasks` | 任务列表页面 |
| GET | `/api/health` | 健康检查 |
| POST | `/api/publish` | 发布内容（支持定时） |
| GET | `/api/tasks` | 列出任务 |
| GET | `/api/tasks/{id}` | 获取单个任务 |
| POST | `/api/tasks/{id}/cancel` | 取消任务 |
| POST | `/api/tasks/{id}/retry` | 重试任务 |
| GET | `/api/schedules` | 列出调度 |
| DELETE | `/api/schedules/{id}` | 删除调度 |
| POST | `/api/schedules/{id}/pause` | 暂停调度 |
| POST | `/api/schedules/{id}/resume` | 恢复调度 |
| **GET** | `/api/accounts` | 列出账号（支持过滤） |
| **POST** | `/api/accounts` | 添加账号（持久化） |
| **PATCH** | `/api/accounts/{id}` | 更新账号 |
| **DELETE** | `/api/accounts/{id}` | 删除账号 |
| **POST** | `/api/accounts/{id}/validate` | 验证账号配置 |
| WebSocket | `/ws` | 实时进度推送 |

---

## 启动方式

```bash
cd C:\Users\邱领\.qclaw\workspace\team\projects\PROJECT-003-multi-publish
$env:PYTHONPATH="src;" + $env:PYTHONPATH
python -m uvicorn web.server:app --host 0.0.0.0 --port 8082
```

访问: http://localhost:8082

---

## Phase 1 完成情况

| 任务 | 说明 | 状态 |
|------|------|------|
| ✅ 账号持久化存储 | JSON 文件 + PBKDF2 加密 | **完成** |
| ✅ 微信公众号正式发布 | `cgi-bin/publish` 接口 | **完成** |
| ⏳ 与 PROJECT-001 集成 | 在 content-aggregator 中添加一键发布按钮 | 待完成 |
| ⏳ 真实端到端测试 | 需要企业认证公众号的 AppID/AppSecret | 待完成 |

---

## Phase 2 计划

| 任务 | 说明 | 优先级 |
|------|------|--------|
| 格式适配器 | Markdown → 各平台格式转换 | P1 |
| 封面图处理 | 自动裁剪/压缩/上传 | P1 |
| 批量发布队列 | 多任务并行处理 | P2 |

---

## 技术要点

1. **发布器接口标准化**: 所有平台发布器继承 `BasePublisher`，统一 `publish()`/`validate()`/`close()` 接口
2. **凭证加密**: AES-256（Fernet），PBKDF2 密钥派生，`enc:` 前缀自动识别
3. **账号持久化**: JSON 文件存储，原子写入（tmp + rename），重启自动加载
4. **任务队列**: 异步并发控制（Semaphore），支持取消/重试
5. **调度器**: 一次性定时 + 周期性调度，5秒轮询检查
6. **微信正式发布**: `draft/add` → `publish` 流程，权限错误自动检测

---

## 微信公众号 API 权限说明

| 接口 | 权限要求 | 当前状态 |
|------|----------|----------|
| `cgi-bin/token` | 所有公众号 | ✅ 已实现 |
| `cgi-bin/draft/add` | 所有公众号 | ✅ 已实现 |
| `cgi-bin/publish` | **企业认证公众号** | ✅ 已实现 |

**注意**: 个人公众号无法使用 `publish` 接口，只能保存草稿手动发布。

---

## 2026-07-20：Logto 用户系统交付补充

**分支**：`codex/logto-user-system`
**需求版本**：PRD v2.4.0-logto
**架构**：`01-docs/ARCH-F14-logto-user-system.md`
**状态**：本地实现与工程门禁完成；生产集成验收待真实租户/数据库

### 交付范围

1. Electron 登录：PKCE、固定回环回调、safeStorage、恢复/刷新/退出/切换状态机、IPC/preload/Pinia/UI。
2. API 身份：Node/Python JWT/JWKS 验证、统一错误语义、`sub` lazy upsert 和跨用户隔离。
3. 权益与用量：服务端 entitlement、RSA 离线快照、原子额度扣减、本地 license 降权兼容。
4. 运维：PostgreSQL 迁移、Webhook 事务消费、Logto 1.41.0 Compose、环境变量和回滚说明。

### 质量结果

- Desktop coverage：285 files、5007 tests；68.37% statements / 60.59% branches / 69.86% functions / 70.51% lines。
- Node API：61 个测试分组全部通过；Python：2503 passed、1 skipped。
- 故障注入 14/14、Monkey 5/5、视觉 16/16、身份 mock E2E 两个 viewport。
- Preload 在真实 Electron 的 `sandbox:true/false` 两种模式下通过；Windows 打包 exit 0，ASAR 身份文件、敏感文件扫描、require 链和应用 8 秒启动通过。
- 两轮独立安全/代码复审未报告 CRITICAL/MAJOR，范围与结果记录在 `TEST-PLAN-LOGTO.md` 第 7 节；最终新增 IPC 与 Webhook 防护完成 RED -> GREEN。
- API Key 边界完成 RED -> GREEN：历史 pending 定时任务即使跨重启恢复，也会在发布前返回 `SCHEDULE_OWNER_REVOKED`；未托管静态 Key 返回 `SCHEDULE_OWNER_INVALID`；Key 存储损坏时返回 `API_KEY_STORE_UNAVAILABLE` 且不覆盖原文件。
- 最终在独立干净工作树复验 Node API；修复旧异步测试假绿、配置化平台识别和 Webhook SSRF 测试合同后，61 个测试分组与 Vitest 8 files / 24 tests 全部通过。
- Stryker 完整 1505 mutants 在本机负载上限内未完成；`identity-errors.js` 专属分片 90%，完整限制已记录在测试计划。

### 未关闭的外部验收

- 真实 Logto 租户登录、刷新轮换、退出、账号切换和 Webhook 投递。
- 真实 PostgreSQL 迁移、并发 lazy upsert、事务回滚和额度压力测试。
- 身份 E2E 当前使用浏览器注入 mock bridge，不能替代真实 Electron + Logto 验收。

---

## 2026-08-04：参考产品账号/发布 GUI E2E 收口

### 本轮变更

- 发布页标题、正文编辑器、发布目标、批量模式、提交按钮和进度区域补充稳定 `data-testid`；账号页添加账号和活动账号“验证”入口使用稳定选择器。
- `FunctionalRunner` 的首次挂载和重置路由就绪预算统一提升到 15 秒，覆盖 CI 首次 Vite 编译、Vue 异步挂载和平台/账号 fixture 加载。
- 发布集成流改用 feature-ready 条件、稳定选择器和 IPC 调用增量（baseline → increment）断言；离线缓存、恢复在线、空表单校验和 IPC 失败路径均等待真实 UI/IPC 结果后再判定。
- 修复路由结果页 query hash 等待、末尾斜杠 URL、页面链接扫描的非法 `Locator.filter({ visible })` 用法；同步迁移旧账号/发布 E2E 的过时 testid 合同。

### 验证证据

| 门禁 | 结果 |
|------|------|
| 账号/发布组件定向 Vitest | 3 files / 28 tests passed |
| 桌面完整 Vitest | 357 files / 6107 tests passed |
| 路由 functional E2E | 18/18 routes passed；发布 12/12、账号 14/14 |
| 跨页面集成流 | Flow 1–6 共 44/44 checks passed |
| Vite renderer/preload build | `npm run build:vue` exit 0 |
| 像素视觉门禁 | 17/17 passed |

### 2026-08-04 续作：账号排序与状态可见性合同

#### 本轮变更

- 账号 Store 增加名称、平台、添加时间、最后使用、粉丝数、登录状态六类排序字段，支持升序/降序；文本、日期、粉丝数统一归一化，缺失/非法值和相同值均有确定性处理。
- Accounts 视图增加 `account-sort` 字段选择器和 `account-sort-order` 方向按钮，排序发生在搜索/状态筛选后，平台、分组、负责人/发布人筛选沿用稳定结果。
- AccountManagementCard 为每个账号提供稳定卡片/状态/检查记录 testid、`role=status` 和可访问标签；状态分为已登录、已过期、异常、暂无检查记录，检查时间优先于错误原因。
- 对未知第三方状态保持 fail-closed 语义：不生成 Cookie、团队归属、检查结果或线上授权结论；未接入的团队分享仍显示禁用状态。

#### 续作验证证据

| 门禁 | 结果 |
|------|------|
| 账号 Store / Accounts / AccountManagementCard 定向 Vitest | 3 files / 151 tests passed |
| renderer/Vue 模板构建 | `npm run build:vue` exit 0；仅有既有动态导入和大 chunk warning |
| diff / 空白检查 | `git diff --check` passed |
| 外部双模型审查 | 未声称通过；需保留 wrapper 不可用证据并完成本地静态审查 |

该证据使用续作工作树的临时依赖 junction 运行，依赖目录未纳入提交；它证明本地 renderer/test 合同，不替代真实参考产品账号授权、Cookie 恢复、第三方发布或安装包验收。

### 交付边界

上述结果证明本地 mock/fixture、渲染合同、IPC 调用和视觉基线一致；不等同于真实第三方账号授权、真实平台上传/发布、团队分享服务、跨设备同步或生产 Electron 安装包验收。Antigravity 与 Claude 外部审查本轮均不可用，原因分别记录为 `agy command not found in PATH` 与 Claude wrapper exit code 1。

## 2026-08-05：参考产品 parity 续作（账号数据、代理与扫码预览）

### 本轮变更

- Electron 账号公开数据白名单补齐粉丝数、负责人、运营人、最近使用、最近检查和检查原因的字段别名归一化；未知字段与 Cookie/token 继续 fail closed，不进入 renderer。
- `account:set-proxy` 等待 `AccountManager.setAccountProxy` 的异步结果，保存失败统一返回 IPC 错误；代理对话框重新打开时保留类型/端口并保持主机脱敏、认证不回显。
- 账号页补齐二维码事件到可见二维码预览的渲染链，限制图片协议并在扫码关闭/完成后清理预览。

### 验证证据

| 门禁 | 结果 |
|------|------|
| 账号 IPC 与代理组件定向 Vitest | 2 files / 35 tests passed |
| 账号 Store、视图、组件与发布 API 定向 Vitest | 5 files / 383 tests passed |
| 账号事件与二维码视图定向 Vitest | 2 files / 77 tests passed |
| 桌面完整 Vitest | 357 files / 6135 tests passed |
| ESLint 受影响文件 | 0 errors；4 个既有 unused warning |
| Vue renderer/preload build | `npm run build:vue` exit 0 |
| 像素视觉门禁 | 17/17 passed（启动当前工作树 Vite 后执行） |
| Windows 打包与 ASAR | electron-builder exit 0；`ACCOUNT_IPC_REQUIRE_OK`；8 秒启动存活且 stderr 为空 |

### 交付边界

本轮只证明本地代码、IPC 合同、renderer 渲染、打包入口和视觉回归；不把真实参考产品第三方登录、平台 Cookie 恢复、团队分享、跨设备同步、线上发布审核或外部双模型审查不可用误报为完成。

## 2026-08-08：CCG 双模型审查修复（账号脱敏/代理/二维码）

### 变更内容

- `toPublicErrorValue` 脱敏正则覆盖下划线/驼峰/中文/组合键（`access_token`、`refreshToken`、`api_key`、`密码`、`令牌`、`user_token`、`client_secret`、`loginPassword`、裸 `session` 等），数组错误字段逐项递归脱敏，`authorization: Bearer <token>` 与逗号分隔 Bearer 值一次性吞掉，避免残留泄漏；`Bearer ***` 保留。
- `publicAccountAliases.publisher` 增加 `publishers`、`publisher_list` 复数别名；`toPublicMetadataValue` 支持数组元素归一化，renderer 的复数分支不再死代码。
- `account:set-proxy` 返回判断改为 `status?.configured`；`toPublicAccount` 对字符串代理端口做数值归一化（1..65535 校验）。
- 二维码预览 img 增加 `referrerpolicy="no-referrer"`；`useAccountEvents` 的 reopen/completed/closed/stop 清空 `qrImage` 已核验并补测试。
- 新增双路径契约测试：`accounts:list`（后端）与 `account:list`（本地）对同一 raw account 输出完全一致且字段脱敏。

### 验证证据

| 门禁 | 结果 |
|------|------|
| account IPC 定向 Vitest | 1 file / 35 tests passed |
| useAccountEvents 定向 Vitest | 1 file / 6 tests passed |
| Accounts 视图 + 代理对话框定向 Vitest | 2 files / 76 tests passed |
| 桌面完整 Vitest | 377 files / 6417 tests passed（清理 C: 盘后全绿；此前 1 个 `story2video-paths` ENOSPC 为磁盘空间不足，非代码问题） |
| ESLint 受影响文件 | 0 errors；4 个既有 unused warning |
| Vue renderer build | `vite build` exit 0；仅既有 chunk-size warning |
| 像素视觉回归 | 17/17 passed |
| Windows electron-builder | exit 0；ASAR 包含 account IPC/preload/Accounts chunks；解包 `ACCOUNT_IPC_REQUIRE_OK`；8 秒启动存活且 stderr 为空 |

### 交付边界

本轮证据覆盖本地 IPC 合同、renderer 事件与 Vue 模板；仍不替代真实第三方登录、Cookie 恢复、平台发布审核、团队分享或跨设备同步验证。
