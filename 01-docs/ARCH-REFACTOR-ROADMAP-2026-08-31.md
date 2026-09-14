# Multi-Publish 深度架构审计与技术重构路线图

> 基线：`origin/main@2e1b84fcf42245842ae09554a054a8d5f4b66b07`
>
> 审计日期：2026-08-31
>
> 交付性质：架构调研与规划，不是重构实施授权
>
> 审计范围：`apps/desktop`、`packages/*`、`ops-center`、`config`、`deploy`、`.github/workflows`、测试与当前架构文档
> 变更边界：本次不变更 API、IPC、数据库 Schema、依赖、打包产物、运行配置或生产环境

## 0. 执行摘要

### 0.1 总体判断

Multi-Publish 当前不是一个简单的 Electron 应用，也不是 README 所描述的“Electron + 一个 Python 后端”。它已经演进成一个以 Electron 主进程为组合根、同时连接本地浏览器自动化、多个 Python sidecar、Node/Python 发布引擎、视频处理工具链、云端身份与运营后台的**混合型模块化单体**。

当前系统的主要矛盾不是“技术栈太旧”，而是：

1. 业务增长速度超过了边界治理速度，领域逻辑继续向 `apps/desktop/electron/services/` 和少数超大 Vue 文件集中。
2. IPC、平台能力、发布路由、provider、通知、设计 token 和 sidecar 配置形成多套事实源。
3. 测试投入很高，但测试最密集的地方也往往是最耦合的地方；大量测试保护了行为，却没有形成可独立替换的模块边界。
4. Logto 业务身份、OpsCenter 管理员身份、桌面许可证/权益本可形成清晰信任域，但历史兼容和共享密钥削弱了隔离。
5. 部署、可观测性和性能证据落后于功能代码，部分质量声明仍停留在“进程存活”“测试文件存在”或历史文档。

推荐路线不是重写，也不是拆微服务，而是采用**绞杀者式模块化重构**：先建立契约、单一事实源和观测基线，再在兼容 facade 后移动实现；结构调整与行为变化分开交付。

### 0.2 架构状态诊断

| 维度 | 当前状态 | 判断 |
|---|---|---|
| 功能交付 | 功能面广，发布、账号、视频、模型、运营均已落地 | 有较强创新能力 |
| 领域边界 | Electron service 目录承载过多领域，多个路由/能力目录并行 | 正在“偿还债务”和“追赶需求”之间切换 |
| 安全基线 | Electron sandbox、sender 校验、Logto 验签较成熟；局部存在旁路 | 基础良好，但边界一致性不足 |
| 测试 | 静态统计约 884 个测试文件、19.9 万测试代码行 | 投入高，系统级验证仍有断层 |
| 持久化 | SQLite 快照、JSONL、媒体文件并存，所有权部分清楚 | 不应强行统一，但需明确语义 |
| 运维 | Logto/API 有较完整运行合同，OpsCenter/sidecar/性能门禁较弱 | 可观测性落后于代码规模 |
| 文档 | 权威新设计与历史草案同时存在，README 明显漂移 | 需要“现状/目标/废弃”三态治理 |

### 0.3 最优先的十项决策

| 顺序 | 决策 | 类型 | 建议时限 |
|---:|---|---|---|
| 1 | 修复 OpsCenter `sync/status` 未认证信息枚举 | 行为修复 | 0-30 天 |
| 2 | 补齐 `webview:list-tabs` sender 校验并生成全 channel inventory | 边界硬化 | 0-30 天 |
| 3 | 移除 sidecar 开发机绝对路径回退，禁止 API Key 进入子进程 argv | 边界硬化 | 0-30 天 |
| 4 | 给 OpsCenter 增加真实 readiness，收紧 CORS，并独立管理管理员密钥 | 运维/安全 | 0-60 天 |
| 5 | 建立平台产品目录、适配器能力目录和发布决策器三者的明确关系 | 架构契约 | 0-60 天 |
| 6 | 完成 IPC manifest/registrar 单轨，并将 renderer 调用收敛到单一 bridge | 跨进程边界 | 31-60 天 |
| 7 | 在 facade 后拆分 Story2Video stage、compose、project 超大模块 | 结构重构 | 2-6 个月 |
| 8 | 以 TS 算法为权威，消除 Story2Video 分句 JS/TS 手工镜像 | 单一事实源 | 2-6 个月 |
| 9 | 明确 `sql.js` 是“内存数据库 + 原子快照”，不要继续把它描述为真实 WAL SQLite | 数据契约 | 0-90 天 |
| 10 | 补齐 OpsCenter/Python 后端 CI、可见窗口/IPC/打包验证和 Windows 签名策略 | 交付闭环 | 0-90 天 |

## 1. 审计方法与证据边界

### 1.1 固定基线

本报告只描述以下 commit：

```text
origin/main = 2e1b84fcf42245842ae09554a054a8d5f4b66b07
branch      = codex/deep-architecture-refactor-plan
worktree    = D:\Data\projects\mp-worktrees\mp-deep-architecture-refactor-plan
```

共享主目录中的未提交 `01-docs/PRD.md`、`CHANGELOG.md` 和其他任务目录未被纳入结论，也未被修改。

### 1.2 静态规模

统计口径为 Git 跟踪的 `.js/.ts/.tsx/.jsx/.vue/.py`，排除依赖、构建产物、coverage 和逆向提取样本：

| 指标 | 数值 | 解释 |
|---|---:|---|
| 代码文件 | 1,975 | 生产代码与测试代码合计 |
| 代码总行数 | 438,871 | 物理行，不等于有效逻辑行 |
| 测试文件 | 884 | 按文件名/测试目录静态识别 |
| 测试代码行 | 199,477 | 约占统计代码 45% |
| Electron 主进程 | 633 文件 / 172,910 行 | 含测试 |
| Desktop renderer | 291 文件 / 78,532 行 | 含测试 |
| packages（不含 Remotion `.tsx` composition） | 669 文件 / 116,757 行 | 含测试；Remotion `.tsx` 计入下方残差 |
| OpsCenter backend | 102 文件 / 19,377 行 | 含测试 |
| OpsCenter frontend | 63 文件 / 7,279 行 | 含测试 |
| 其余统计代码 | 217 文件 / 44,016 行 | Desktop 根级测试/配置/脚本 128/25,530；Remotion `.tsx` 29/8,526；仓库自动化、部署和工具 60/9,960 |

以上分类与总计严格闭合。统计排除了 `01-docs/ui-reference` 下 1 个、182 行的逆向样本；这些数字说明测试投入和功能体量，不证明测试当前通过，也不证明所有代码都在生产路径中。

### 1.3 证据等级

| 等级 | 能证明什么 | 本报告中的用法 |
|---|---|---|
| E1 当前源码/配置 | 当前实现、静态调用和配置关系 | 架构事实的主要依据 |
| E2 静态命令结果 | 文件规模、集合差异、引用关系 | 复杂度和孤立模块定位 |
| E3 定向测试 | 某一合同在当前环境通过 | 本次未执行产品测试，仅设计未来门禁 |
| E4 全量测试/构建 | 仓库在某环境的整体门禁 | 本次未执行 |
| E5 可见 Electron/打包 | 窗口、preload、ASAR 和运行入口 | 本次未执行 |
| E6 远端/生产 | PR、分支保护、ECS、真实数据库 | 本次未访问 |
| E7 真实 provider | 第三方登录、上传、发布和额度 | 本次未验证 |

除特别说明外，本报告的事实属于 E1/E2。

## 2. 当前架构全景

### 2.1 运行进程图

```text
┌──────────────────────── Windows Desktop ─────────────────────────┐
│                                                                  │
│ Vue Renderer                                                     │
│  views → composables → Pinia stores → src/api                    │
│      │                                                           │
│      ▼ contextBridge                                             │
│ Preload (sandbox=true, contextIsolation=true, nodeIntegration=false)
│      │ typed-by-convention electronAPI                           │
│      ▼                                                           │
│ Electron Main                                                    │
│  main.js → bootstrap.js → phase1..phase5 → BrowserWindow         │
│      │            │            │               │                 │
│      │            │            │               ├─ sql.js snapshot DB
│      │            │            │               ├─ JSONL/replay logs
│      │            │            │               └─ media/project files
│      │            │            │                                 │
│      │            │            ├─ RPA views / Playwright / webContents
│      │            │            ├─ FFmpeg / ffprobe / Remotion     │
│      │            │            └─ model providers / TTS / images  │
│      │            │                                              │
│      │            ├─ Splitter sidecar :8002                       │
│      │            ├─ Aligner sidecar  :8004                       │
│      │            ├─ Prompt sidecar   :8013                       │
│      │            └─ Python backend   :8299..8303                 │
│      │                                                           │
│      └──── optional external video prompt engine :8020           │
└──────────────────────────────────────────────────────────────────┘
                         │ HTTPS / OIDC / provider API
                         ▼
┌──────────────────────── Cloud / ECS ─────────────────────────────┐
│ Nginx                                                            │
│  ├─ Logto 1.41.0 + Logto-owned PostgreSQL                        │
│  ├─ api-publish-engine + business PostgreSQL                     │
│  └─ OpsCenter FastAPI :8010 + its own SQLite                     │
│                                                                  │
│  业务身份：Logto OIDC/JWKS/introspection                         │
│  运营身份：OpsCenter 本地 admin + HS256 JWT                       │
└──────────────────────────────────────────────────────────────────┘
```

关键入口：

- `apps/desktop/electron/main.js:64-117`：单实例锁、上下文创建、退出协调和 ready 编排。
- `apps/desktop/electron/bootstrap.js:64-103`：容器、上下文、任务执行器和事件接线。
- `apps/desktop/electron/bootstrap.js:162-205`：sidecar、服务、IPC、窗口启动与失败回滚。
- `apps/desktop/electron/window.js:208-226`：BrowserWindow 安全参数及导航限制。
- `apps/desktop/src/main.js:1-38`：Vue、Pinia、Router、i18n、Element Plus 和全局错误处理。

### 2.2 Electron 启动与组合根

当前启动已经从历史上的单一 `main.js` 拆成：

```text
main.js
  ├─ startup-compat       userData/GPU 兼容
  ├─ createAppContext     同步组合
  │   ├─ createContainer
  │   ├─ extractContext
  │   ├─ taskQueue.setExecutor
  │   └─ wireTaskQueueEvents
  ├─ registerShutdownHandlers
  └─ runWhenReady
      ├─ media server
      ├─ startBridges
      ├─ startServices
      ├─ registerAllIpcHandlers
      └─ createWindow
```

这是正确方向：`bootstrap.js:106-155` 已有回滚，`phase5-ipc.js:50-130` 还实现了 IPC 注册事务和失败回滚。问题在于组合根仍同时承担任务执行策略、事件广播、服务定位和运行时权限接线，依赖只能靠对象解构和人工同步维持。历史上的“新增 DI 服务但 phase context 未传递”问题正是该结构的典型逃逸模式。

### 2.3 IPC 与信任边界

当前安全基础：

- `window.js:208-216` 使用 `sandbox:true`、`contextIsolation:true`、`nodeIntegration:false`。
- `core/ipc-security.js:29-82` 对开发 URL、`app://` 和 canonical `file://` sender 做边界校验。
- `license-access-control.js:232-276` 在 handler 调用时动态读取 access level 和 entitlement。
- `preload/access-control.js` 按 public/authenticated/admin 暴露能力。

当前 IPC 注册却存在三条轨道：

1. `phase5-ipc.js:173-235` 的中央 handler 注册；
2. `window.js` 中窗口创建后的 service registrar；
3. `phase1-context.js:140-151` 的早期副作用注册，例如 system tray。

这使“channel 是否注册、是否受 sender 校验、是否有权限和 feature gate”无法从一个清单回答。已点验的例外是 `webview-manager.js:1286-1289`：`webview:list-tabs` 未使用相邻 handler 的 `withSenderCheck`。

`isTrustedSender` 还保留两项兼容面：

- `app://localhost` 只校验 host/port，当前仓库未找到 scheme 注册源；
- 未显式设置 `DEV_SERVER_PORT` 时接受 `5174-5180`，可能信任同机其他 worktree 的 dev 页面。

### 2.4 Renderer 分层

预期依赖方向是：

```text
view → composable → store → api/electron-bridge → preload
```

这个方向大体存在，但边界并不单一：

- `api/electron-bridge.js:8-54` 已提供统一 `getApi/invoke/invokeWithFallback` 和 IPC 参数脱壳。
- `identity.js`、`providers.js`、`model-providers.js`、`ops-center-sync.js`、`cloud-publisher.js` 等重复实现自己的 `getApi`。
- `api/publisher.js:465` 直接调用 `window.electronAPI.extractVideoCover`，与该文件“不得直接访问”的注释矛盾。
- provider 与 model-provider 两套 API 名称和页面责任重叠。
- `CreateView.vue` 6,165 行、`ResultView.vue` 1,774 行、`ModelProviders.vue` 1,639 行，页面承担了状态机、编排、展示和异常处理多种职责。

设计层也存在多套事实源：`tokens.css` 声明自己是唯一来源，但入口同时加载 brand token、Cohere alias、Apple token 和视频创作 token；暗色值仍散落在视图 scoped CSS 中。

### 2.5 Workspace 与包职责

| Workspace | 当前职责 | 主要问题/判断 |
|---|---|---|
| `apps/desktop` | Electron 主产品与多数业务编排 | 实际应用核心，领域过度集中 |
| `api-publish-engine` | API adapters、HTTP server、Logto、Postgres、上传/重试 | 包含执行、路由、身份、服务端多种关切 |
| `python-backend` | Python FastAPI、部分 RPA/视频能力 | 与 JS 发布能力有业务重叠，但技术路线不同 |
| `story2video-engine` | TS 文本分段、字幕、模板等算法 | 应成为算法单一来源 |
| `remotion-composer` | React/Remotion 合成 | 合理的工具边界 |
| `video-clone-engine` | 独立六阶段克隆流水线 | JS、无外部依赖，是否 TS 化应由改动收益决定 |
| `shared-utils` | queue/scheduler/history/config/platform 等共享基础设施 | Desktop main/renderer 均重度消费；deep import 较多，公共出口与 `index.d.ts` 一致性需治理 |
| `rpa-engine` | browser-data 与 platform-selectors | `rpa-view-platforms.js` 真实消费 selectors；职责已收窄，browserData 暂无外部消费者 |
| `ai-writer` | 轻量 AI 写作 | 错误被静默转为空值/原文 |
| `ai-writer-api` | Express wrapper | `file:` 可解析，但包当前无消费者 |
| `ai-autonomous-tester` | 测试工具 | dev-only，边界合理 |
| `ops-center` | 运营配置、健康与模型/模板管理 | 与业务身份应隔离，但部署和 CI 较弱 |

`shared-utils` 和 `rpa-engine` 都是当前运行时依赖，不能作为孤立包删除。`ai-writer-api` 才是当前仓库无应用消费者的独立 HTTP/CLI 服务候选；其保留与否仍需检查外部部署、发布资产和真实产品责任，不能仅凭仓内 grep 决定。

### 2.6 发布链路

```text
Renderer Publish
  → IPC publish handler
  → TaskQueue / Scheduler
  → PublisherRouter.resolve route
      ├─ rpa_vm  → RpaViewManager → browser/webContents script
      ├─ api     → api-publish-engine.publishViaApi
      └─ backend → PythonBridge
  → history / monitor / impact tracker / progress IPC
```

当前产品平台目录 `config/platforms.yaml` 与桌面 `ROUTE_TABLE` 都是同一组 15 个平台，这一点是健康的。问题在下一层：

- `api-publish-engine/src/index.js:1-14` 有 10 个内置 adapter；
- `adapters/platform-configs.js` 有 23 个配置 adapter，其中 19 个不在产品平台目录；
- REGISTRY 与 platformConfigs 还有不可达重叠；
- `api-router.js:43-96` 自己判断 `has_api` 和 API→RPA fallback；
- 桌面 `publisher-router.js:434-498` 又维护 mode 与执行器选择。

因此当前不是“平台清单完全错误”，而是**产品可见平台、技术 adapter 能力和应用路由决策没有明确分层**。

### 2.7 Story2Video 与媒体链路

```text
pipeline:startOrchestrated
  → PipelineEngine / StageExecutor
      ├─ SPLIT    → ServiceBus → SplitterBridge :8002
      │               └─ local TS/JS fallback
      ├─ OPTIMIZE → PromptBridge :8013
      │               ├─ optional video engine :8020
      │               └─ CLI fallback
      ├─ ASSETS   → model providers / TTS / media tools
      └─ COMPOSE  → Story2VideoComposeEngine → FFmpeg/Remotion
  → Story2VideoProjectService → manifest / media / replay state
```

当前已有值得保留的合同：

- `sceneSource`、`subtitleSource`、`degraded`、`fallbackReason` 用于记录来源；
- 在线字幕有覆盖率和保护短语质量门；
- TS/JS 分句实现有 parity 测试；
- prompt bridge 会剥离内部字段并对敏感上下文做防御；
- BYOK 缺 key 时 fail closed。

主要债务：

- `story2video-stages.js` 3,767 行；
- `pipeline-engine.js` 2,618 行；
- `story2video-compose-engine.js` 2,486 行；
- `story2video-project-service.js` 2,297 行；
- `story2video-segmentation-engine.js` 1,111 行手工镜像 `story2video-engine/src/text-segmentation.ts` 1,388 行；
- 非 fallback 的 split 路径可能透传原始结果，provenance 不总是标准化；
- 全局 segmentation 来源通过“找到第一个带来源的 scene”推断，混合降级时会失真。

这里的两个 Electron 分句文件职责不同：`story2video-segmentation.js` 负责在线结果标准化、字幕质量门、fallback 编排和 provenance；`story2video-segmentation-engine.js` 是本地 Electron 可执行的 JS 算法镜像。真正应成为单一算法源的是 `packages/story2video-engine/src/text-segmentation.ts`，目标是由它生成 CJS 产物，而不是直接删除编排层。

### 2.8 身份与数据所有权

业务身份链：

```text
Desktop/Web → Logto Authorization Code + PKCE
            → JWT 本地 JWKS 验签 或 opaque token introspection
            → ensureBusinessUser(sub)
            → business PostgreSQL: identity_users/subscription/entitlement
```

`api-publish-engine/src/auth` 对 issuer、audience、scope、算法、key type、introspection endpoint 和 webhook 幂等处理较完整。

OpsCenter 身份链：

```text
OpsCenter login → 本地 PBKDF2 admin 校验 → HS256 JWT → require_admin
```

两套身份并存是合理边界：消费者身份和内部运维管理员的风险模型不同。问题是当前 OpsCenter 为历史 orchestrator token 兼容共享 `PO_SECRET_KEY`，使边界发生密钥耦合；未来应独立密钥和 audience，而不是把 OpsCenter 强行接入消费者 Logto。

桌面本地数据：

- `sqlite-wrapper.js:3-10` 明确使用 `sql.js`；
- `sqlite-wrapper.js:194-203` 通过 export → tmp → rename 原子快照落盘；
- `base-store.js` 执行 `journal_mode=WAL`，但 sql.js 内存数据库没有真实 WAL 文件语义；
- accounts/schedules/history/settings 等迁入快照数据库；
- execution replay、prompt feedback、session 等仍由 JSONL 承担；
- 大媒体与项目资产保存在文件系统。

这不是简单的“存储碎片化”。快照状态、追加事件日志和媒体资产有不同需求，应治理所有权，而不是强制用一个数据库。

### 2.9 部署与 CI

当前可确认：

- Logto Compose 使用 Logto 自己的 PostgreSQL；业务 API 通过外部 `BUSINESS_DATABASE_URL` 使用业务数据库。两者不能在架构图中画成同一个数据库。
- `api-publish-engine` 测试通过 Nx workspace 测试间接进入 quality gate，但没有专属生产合同 job。
- Python backend 只在 GUI workflow 中执行 import + 单个 pytest 冒烟，不是完整 pytest。
- OpsCenter backend 没有 CI pytest；frontend 没有明确 build gate。
- `quality-gate.yml` 的 `gate-result` 只打印各 job 结果，本身不会失败。远端分支保护是否把各 job 设为 required check，仓库内无法确认。
- `electron-ci.yml` 的 smoke 只证明 Electron 进程存活 30 秒；GUI workflow 才检查路由和 console/page error；二者都不能替代 Windows 可见窗口、ASAR 和真实 IPC 验证。
- Windows `electron-builder` 显式关闭代码签名；electron-updater 仍有 `latest.yml` SHA-512/HTTPS 完整性，不应夸大为“完全无完整性校验”，但缺少发布者身份锚和账户失陷后的二进制签名保护。

## 3. 值得保留的架构基础

重构不应抹掉已经存在的正确方向：

1. **Electron 安全默认值**：sandbox、context isolation、navigation/open handler 和 canonical sender 校验。
2. **启动失败回滚**：bridge/service/media server 已有 rollback 与 `Promise.allSettled` 清理。
3. **DI 迁移基础**：服务已经集中注册，虽不完整但比散落 `new` 更易演进。
4. **Logto 生产合同**：JWT/opaque token、JWKS/introspection、webhook、迁移最小权限已有深度防御。
5. **Story2Video provenance**：来源和降级不是完全静默，已有合同与 parity 测试。
6. **高测试投入**：大量测试可作为拆分时的 characterization safety net。
7. **工作树/写保护门禁**：并发开发环境已有隔离、hook 和共享根 watcher。
8. **平台产品目录与桌面路由已对齐**：无需推翻，需补齐下面的 adapter/capability 分层。

## 4. 问题分级与根因分析

### 4.1 P0：明确缺陷或高风险边界

| ID | 问题与证据 | 根因 | 爆炸半径 | 为什么测试会逃逸 |
|---|---|---|---|---|
| P0-1 | `ops-center/backend/routers/sync.py:61-76` 的 status 无认证 | 同文件 POST 有 admin guard，GET 遗漏 | 暴露项目 code、配置路径和条目数 | OpsCenter backend 没进入 CI，端点缺鉴权负例 |
| P0-2 | `webview-manager.js:1286` 未包 `withSenderCheck` | service 自注册轨道缺统一清单 | renderer 被导航/XSS 后的信息面扩大 | 单 handler 测试没有全量 channel 策略断言 |
| P0-3 | prompt CLI 把 `llm.api_key` 放进 argv | HTTP fallback 沿用 CLI 参数模型 | 同机进程列表、诊断工具可读 secret | mock exec 只验证参数存在，不验证 OS 可见性 |
| P0-4 | splitter/prompt/aligner 含开发机绝对路径探测 | 为本机开发便利增加静默 fallback | 打包/其他开发机可能启动错误源码 | 维护者机器路径存在，CI 路径不存在，行为不一致 |
| P0-5 | OpsCenter 在当前 Starlette 1.0.1 下会对任意 Origin 反射 `Access-Control-Allow-Origin` 并允许 credentials；同时无真实 readiness | 默认 `cors_origins="*"` 且 `allow_credentials=True`，最简部署模板长期未收敛 | 凭据型跨域信任边界过宽；当前显式 Bearer 模型降低经典 Cookie CSRF 风险，但不能把任意来源视为受信运营前端 | 无浏览器 CORS allow/deny 合同与生产形态健康测试 |
| P0-6 | OpsCenter 与历史 orchestrator 共享 HS256 secret | 兼容旧 token | 任一系统 secret 泄漏扩大到另一管理面 | 各自单测不会验证跨服务 token 拒绝 |
| P0-7 | Windows 安装包无代码签名 | 交付成本/证书缺失 | SmartScreen、release 账户失陷后的身份校验 | CI 只验证构建/哈希，不验证发布者签名 |

P0 不代表全部必须放在一个 PR。每项都应独立 OpenSpec、独立回归和独立回滚。

CORS 结论来自本机解算的 Starlette 1.0.1 最小 ASGI 合同：简单请求、预检、Cookie 和 Authorization Bearer 请求都会反射请求 Origin 并返回 credentials 许可。`ops-center/backend/requirements.txt` 只声明 `fastapi>=0.115.0`，没有锁定 Starlette；未来实施必须在锁定依赖后重跑浏览器/ASGI 合同，不能把本次结果无期限外推到所有版本。

### 4.2 P1：结构性债务

#### A. 组合根与 IPC 多轨

现状由 phase5、window registrar 和 phase1 side effect 共同注册 IPC。根因是模块迁移按“能启动”拆分，而没有把“channel manifest”作为系统对象。影响是权限、幂等、依赖顺序和 preload 完整性需要多处人工同步。

#### B. 超大 orchestrator

大文件本身不是重写理由；真正问题是变化原因过多：

- `story2video-stages.js` 同时包含多个 stage 的业务决策；
- `pipeline-engine.js` 同时包含定义、执行状态、队列与事件；
- `CreateView.vue` 同时包含工作流控制、页面切换和大量视图状态。

测试文件与生产文件一同膨胀，说明“按文件隔离测试”没有降低修改爆炸半径。

#### C. 发布能力多源

产品目录、内置 REGISTRY、generic platformConfigs、plugin loader、桌面 ROUTE_TABLE、API fallback 各自回答了部分问题，却没有定义谁负责：

- 平台是否对用户可见；
- 支持 article/video/image 哪种能力；
- 支持 API/RPA/backend 哪种执行；
- 哪种执行是首选；
- 失败能否回退；
- 回退是否允许重复副作用。

根因是平台接入按 adapter 文件增长，没有先建立 capability contract。

#### D. Story2Video 双实现和 provenance 漏口

TS/JS parity 测试降低了漂移概率，却没有消除双维护成本。任何规则变更都必须同时改实现、镜像、规则和多层测试；某些路径又绕过标准化结果。正确目标是“一个算法源 + 多运行时产物”，而不是继续增加 parity 用例来维持两份手写代码。

#### E. Renderer 多桥和多设计系统

统一 bridge 已存在却未成为硬门禁；provider API、通知和 token 也在历史演进中形成兼容层。根因不是缺少新框架，而是没有删除旧入口。

#### F. 持久化语义不清

代码把 sql.js 包装成 better-sqlite3 风格，并调用 WAL pragma，容易让维护者误判并发和崩溃语义。实际是内存 DB + 原子全量快照。JSONL 继续存在不是 bug，但必须有数据所有者、保留期限、恢复策略和 owner 规则。

#### G. Workspace 出口和责任漂移

`shared-utils` 是活跃共享基础设施，但主进程和 renderer 大量依赖 `src/*` deep import，公共出口与 `index.d.ts` 不能作为唯一可信契约。`rpa-engine` 仍由 `rpa-view-platforms.js` 使用 selectors，包名与当前收窄责任可能不再匹配，且 `browserData` 暂无外部消费者。`ai-writer-api` 在仓库应用依赖图中无消费者，但作为独立 HTTP/CLI 服务是否退役属于产品与部署决策。目标是先建立出口/消费者/部署清单，再决定重命名、迁移或退役。

### 4.3 P2：运营、性能和文档债务

1. 冷启动、IPC p95/p99、DB 快照耗时、sidecar 首次就绪、stage 延迟和内存没有当前基线。
2. sidecar 统一使用 loopback HTTP，但没有进程级 session token、请求并发预算和一致的版本握手。
3. API adapter 的 cache/circuit/token 状态为模块级 Map，边界和上限不统一。
4. `BasePlatformAdapter` 通过 error message 子串分类 timeout/parse/cancel。
5. README 仍写 v2.0/Electron 33/npm/旧 6 表和已不存在的架构。
6. 历史设计仍保留共享 JWT、Celery/Redis/PostgreSQL 本地后端和“绕过风控”等废弃描述。

### 4.4 不应视为缺陷的合理双系统

| 双系统 | 为什么合理 | 应治理什么 |
|---|---|---|
| API 发布与 RPA 发布 | 平台能力和合规接口不同 | 共享能力/结果合同，不强行共享执行代码 |
| Logto 用户身份与 OpsCenter admin | 消费者和内部管理风险模型不同 | 独立 secret/aud、明确跨服务拒绝 |
| SQLite/JSONL/文件系统 | 快照、事件、媒体数据模型不同 | 所有权、恢复、保留与 owner 规则 |
| JS Electron 与 Python sidecar | 生态和媒体/自动化能力不同 | 版本、健康、鉴权、超时、fallback 合同 |
| Element Plus 与自定义 Ui 组件 | 第三方基础能力与品牌组件可共存 | 责任边界和 token 单一来源 |

## 5. 目标架构

### 5.1 原则

1. 保持 Electron 为桌面组合根，不拆分新的常驻微服务。
2. 先建立依赖边界，再移动文件；先做 characterization，再改变行为。
3. 领域核心不依赖 Electron、HTTP、文件路径或 provider SDK。
4. 每个外部边界只有一个 manifest/registry；兼容入口必须有删除日期。
5. 失败、降级和来源必须结构化，不用 message 文本推断。
6. 本地工具链采用无 broker 的进程内事件，不引入 Kafka/Redis。
7. 观测先于性能重构；未测量的性能目标只能是暂定预算。

### 5.2 目标结构

```text
apps/desktop/electron/
  app/
    bootstrap/                # 唯一组合根和生命周期
    ipc/                      # manifest、registration、ACL、serialization
  domains/
    accounts/                 # account/login/proxy use cases
    publishing/               # plan/execute/history/monitor
    story2video/              # pipeline application services
    providers/                # model/provider use cases
    identity/                 # desktop session/entitlement port
    projects/                 # project/replay/asset manifest
  infrastructure/
    electron/                 # BrowserWindow/webContents adapters
    persistence/              # snapshot DB / JSONL / filesystem repositories
    sidecars/                 # supervisor + typed clients
    media/                    # ffmpeg/remotion adapters
    network/                  # HTTP/provider clients

packages/story2video-engine/  # 唯一算法源，可生成 CJS 产物
packages/api-publish-engine/  # 云服务 host + API adapters
packages/contracts/           # 仅在有两个真实 host 消费后建立
```

不要在第一波创建六个新的 domain package。先在 desktop 内用目录和 facade 建边界；只有跨 Electron/API/Python 的合同有两个真实消费者时，才提取一个小型 `packages/contracts`。

### 5.3 IPC manifest

每个 IPC method 应由一个描述符回答：

```ts
type IpcDescriptor<Req, Res> = {
  channel: string
  access: 'public' | 'authenticated' | 'admin'
  feature?: string
  request: (value: unknown) => Req
  response: (value: unknown) => Res
  timeoutMs?: number
  cancellable?: boolean
  ownerScoped?: boolean
}
```

第一阶段不必引入新的 schema 框架。可以复用现有 validator，并用 manifest 测试保证：

- channel 唯一；
- preload method 有且只有一个主进程 handler；
- access/feature 明确；
- 所有 registrar 使用注入的 controlled IPC；
- event channel 与 invoke channel 分开登记；
- 长任务具有 timeout/cancel 语义。

### 5.4 发布能力模型

```text
ProductPlatformCatalog        用户可见平台、名称、内容类型
          │
          ├── intersects ── AdapterRegistry
          │                  每 adapter 自述 capabilities
          ▼
PublishPlanResolver           纯函数：选择 API/RPA/backend + fallback policy
          │
          ▼
PublisherExecutor             执行选定 plan，不再重新决策
```

建议合同：

```ts
type PublishCapability = {
  platform: string
  modes: Array<'api' | 'rpa' | 'backend'>
  contentTypes: Array<'article' | 'image' | 'video'>
  supportsDraft: boolean
  supportsSchedule: boolean
  idempotency: 'none' | 'client-key' | 'provider-key'
}

type PublishPlan = {
  platform: string
  primary: 'api' | 'rpa' | 'backend'
  fallback?: 'api' | 'rpa' | 'backend'
  fallbackAllowedAfter: Array<'not-started' | 'auth-failed' | 'transient-error'>
}
```

关键点是防止 API 已产生副作用后又盲目 RPA 重发。fallback 必须根据结构化失败阶段和幂等信息决定。

### 5.5 Story2Video 目标边界

```text
PipelineRegistry       只定义 pipeline/stage DAG
PipelineRunner         状态机、取消、恢复、并发
StageHandler<T>        每 stage 一个小 handler
ArtifactManifest       资产、来源、降级、hash、版本
ComposePort            FFmpeg/Remotion 实现
ProjectRepository      项目 metadata 与媒体路径
```

迁移时保留原 `Story2VideoStages` facade 和事件名；先把内部函数移动到 handler，再让 registry 注入。不要同时改变 UI、prompt、资产选择和 compose 输出。

分句算法以 `packages/story2video-engine/src/text-segmentation.ts` 为权威，通过 build 生成 Electron 可加载的 CJS；在产物切换稳定前保留 parity 测试，切换完成后删除手工 JS 镜像。

`ArtifactManifest` 应在每个 scene 记录来源，而不是用一个全局来源代表混合场景：

```ts
type SceneProvenance = {
  sceneId: string
  sceneSource: string
  subtitleSource: string
  degraded: boolean
  reasons: string[]
  engineVersion?: string
}
```

### 5.6 数据所有权

| 数据 | 权威存储 | 事务/恢复语义 | owner 规则 |
|---|---|---|---|
| accounts/settings/schedules/history | sql.js snapshot DB | 事务后原子 snapshot；记录 snapshot 延迟/失败 | repository 强制 owner_subject |
| pipeline run state | 明确选 SQLite 或 append log，不双写无期限 | crash resume 必须有版本号 | owner + project |
| replay/audit/feedback | JSONL append log | 可截断恢复、保留期、压缩 | owner hash，不记录 secret |
| media/project assets | 文件系统 + manifest | hash、atomic rename、GC | project/owner namespace |
| cloud identity/entitlement | business PostgreSQL | 服务端事务和 migration ledger | verified `sub` |
| OpsCenter config | OpsCenter SQLite | admin-only，backup/restore | admin domain |

短期推荐继续使用 sql.js，不因为名称误导立刻切换数据库。先测量 DB 大小、快照 p95、启动导入耗时和崩溃丢失事件；只有达到约定阈值或出现真实一致性问题，再通过 ADR 比较 better-sqlite3。原生模块会增加 Windows/ASAR/build 复杂度，不能只为“真 SQLite”而引入。

### 5.7 Sidecar supervisor

统一 sidecar descriptor：

```ts
type SidecarDescriptor = {
  name: string
  command: string
  cwd: string
  versionCommand?: string[]
  host: '127.0.0.1'
  port: number | 'allocated'
  healthPath: string
  startupTimeoutMs: number
  requestTimeoutMs: number
  maxConcurrency: number
  restartPolicy: { max: number; backoffMs: number[] }
  fallback: 'none' | 'local-js' | 'alternate-service'
}
```

安全建议：

- 工作目录来自配置/打包资源，不扫描开发者绝对路径；
- 应用启动时生成 session token，经环境变量传给 sidecar，并在 loopback 请求头校验；
- secret 经 stdin 或环境变量传递，不进入 argv 和日志；
- health 包含版本和能力，不只返回 HTTP 200；
- 所有 request 进入 concurrency limiter，并支持 AbortSignal；
- 不为本机 loopback 引入 mTLS、service mesh 或消息 broker。

### 5.8 事件与可观测性

保留 EventEmitter，但在上面增加事件 catalog，而不是引入外部队列：

```text
eventName, eventVersion, traceId, runId, taskId, ownerHash,
domain, stage, platform, provider, durationMs, outcome,
degraded, source, errorCode
```

禁止记录 cookie、token、完整 prompt、用户正文和本地绝对路径。跨 Electron → sidecar → provider 使用同一 `traceId`，但 metrics 聚合使用 hash/枚举。

## 6. 安全威胁模型

| 威胁 | 当前防线 | 缺口 | 目标控制 |
|---|---|---|---|
| Renderer 被注入 | sandbox、context isolation、sender 校验 | IPC 注册旁路、dev 端口带 | 单一 manifest + 全 channel 策略测试 |
| 同机恶意进程 | loopback 限制 | sidecar 无 session 鉴权 | 每会话 token + version handshake |
| provider secret 泄漏 | credential store、日志脱敏 | CLI argv | stdin/env + 进程参数测试 |
| 未授权运营探测 | 部分 require_admin | sync/status 遗漏 | 默认 admin，显式 public allowlist |
| 管理 token 横向使用 | 两套身份逻辑 | 共享 HS256 secret | 独立 secret/aud/issuer-like namespace |
| 恶意/失陷 release | HTTPS + sha512 | 无发布者签名 | Authenticode + protected release workflow |
| 路径逃逸 | file sender realpath、部分路径校验 | sidecar cwd 猜测、媒体路径多源 | canonical path policy + manifest roots |
| 重复发布 | queue/fallback/retry | fallback 幂等语义不统一 | PublishPlan + idempotency + side-effect stage |

## 7. 测试与质量门禁目标

### 7.1 测试金字塔

```text
少量真实验收：第三方登录/上传/发布、生产 OIDC、干净机安装
        ▲
打包 Electron：可见窗口、preload、IPC、ASAR、stderr、签名
        ▲
跨进程集成：真实临时 HTTP sidecar、FFmpeg、Postgres fixture
        ▲
契约测试：IPC manifest、adapter capabilities、schema、migration
        ▲
领域单测：resolver、state machine、provenance、error mapping
```

### 7.2 逃逸链与补强

| 债务 | 单测为何没拦 | 集成为何没拦 | E2E/打包为何没拦 | 新门禁 |
|---|---|---|---|---|
| IPC sender 漏包 | 单 handler mock 绕过 senderFrame | 无全 channel 策略扫描 | 可信页面调用仍成功 | manifest completeness + untrusted sender table test |
| Ops sync/status 无 auth | endpoint 无负例 | backend 不进 CI | 无 Ops E2E | pytest auth matrix + CI |
| CLI argv secret | mock 只断言调用成功 | 不观察 OS command line | 打包测试不触发 fallback | child-process contract test |
| JS/TS 分句漂移 | parity 能发现但维护成本高 | 两条路径不总一起跑 | 真实 sidecar 不稳定 | generated artifact hash + vectors |
| pseudo-WAL 误解 | SQL API 行为测试可过 | 不模拟进程中断/大库 | 启动 smoke 不查恢复 | crash/reopen + snapshot latency benchmark |
| 平台能力多源 | 各 registry 自测可过 | 没有集合/路由交叉断言 | 真实平台测试昂贵 | product × adapter × route matrix |

### 7.3 CI 目标矩阵

下表时间是目标预算，不是当前实测。按责任域分片，避免一个总 job 让失败无法归属：

| Job / owner | 分片与目标预算 | 必须验证 | Flake / skip 规则 | 不能替代 |
|---|---|---|---|---|
| static/contracts / Architecture | manifest、locale、OpenSpec、type/lint；≤10 min | IPC/capability/config 单一事实源 | 不得 skip；合同失败不得重试掩盖 | 运行时 |
| Node workspace / Package owners | api-publish、Story2Video、shared packages 分域；每片 ≤15 min | 单测、生产入口 require、包出口 | 只允许基础设施错误重试 1 次并保留首败；隔离 flake 必须有 owner/ticket/到期日 | Desktop Electron |
| Python backend / Backend | 按 auth/media/provider 分片；每片 ≤15 min | 完整 pytest 汇总、import、dependency lock | 缺依赖不是成功 skip；测试总数为 0 直接失败 | 真实 provider |
| OpsCenter / Ops | backend 与 frontend 两片；各 ≤15 min | pytest、frontend test/build、readiness、CORS allow/deny | 禁止静默 skip；浏览器合同必须含允许和拒绝来源 | ECS 部署 |
| Desktop Vitest / Desktop domains | accounts/publish/Story2Video/infrastructure；每片 ≤20 min | 分片完整性、无残留进程 | 固定 shard 清单；漏片或空片失败 | 可见窗口 |
| Linux GUI / Desktop QA | route shards；≤15 min | 路由、console/page errors | xvfb/浏览器缺失必须失败并报环境原因 | Windows/ASAR |
| Windows visible-window + IPC / Release QA | package、ASAR、preload/IPC、窗口；≤30 min | builder、ASAR require、stderr、非零 MainWindowHandle/title、受保护 IPC | 不得以进程存活或 Vite ready 替代；不可静默 skip | 第三方发布 |
| Signed release / Release owner | 签名与更新合同；≤20 min | Authenticode、metadata/hash、artifact provenance | 证书缺失 fail closed；仅非发布分支显式 non-applicable | 用户安装成功 |
| Remote policy / Maintainers | 每次 release/保护规则变更现场核对 | required checks、branch protection、当前 SHA | 仓库 YAML 不得自证远端配置 | 本地检查 |

统一 flake 策略：测试失败默认是真失败；只有被证明为基础设施故障时可自动重试一次，报告保留首次失败。隔离不稳定测试必须记录 owner、问题单、到期日和替代覆盖；任何“依赖不存在、无显示器、测试发现为 0”的路径都不能以成功状态静默跳过。

## 8. 性能与 SLO 方案

当前没有足够运行数据，以下是**先测量再锁定**的初始预算，不是已满足的 SLO：

| 指标 | Phase 0 采样 | 暂定预算 | 触发重构的阈值 |
|---|---|---|---|
| 冷启动到可见窗口 | dev + unpacked + installed 各 30 次 | p95 ≤ 8s | p95 连续两周 > 10s |
| preload/IPC ready | startup trace | p95 ≤ 2s | channel 未注册或 ready 超时 >0.1% |
| 普通 IPC | histogram，排除长任务 | p95 ≤ 50ms | p95 >100ms |
| DB snapshot | DB 大小分桶 | p95 ≤ 100ms（需校准） | UI 卡顿/失败或 >250ms |
| sidecar ready | 每服务启动计时 | p95 ≤ 15s | 启动失败 >1% |
| stage duration | pipeline/stage/provider 维度 | 基线后按 stage 定义 | p95 退化 >20% |
| 主进程内存 | idle/one run/three runs | 基线 + leak slope | 每 run 不回收或 1h 持续增长 |
| 发布成功率 | 按平台/模式/错误码 | 只对真实验收定义 | 不允许用 mock 成功率代替 |

建议先用现有 logger 和 metrics adapter 输出本地结构化事件，不立即引入完整 OpenTelemetry collector。只有跨服务追踪确有消费方时再接 OTLP。

## 9. 分阶段迁移路线

### Wave 0：事实和边界止血（0-30 天）

| 项目 | 内容 |
|---|---|
| 前置 | 每项独立 OpenSpec；冻结对应接口行为；先写失败的回归/合同测试并接入 CI，再修改实现；记录当前测试与打包基线 |
| 文件范围 | OpsCenter sync/config/main/deploy；IPC webview/registration；sidecar bridges；CI；README 现状页 |
| 行为变更 | 只做明确安全修复：auth、sender、secret transport、CORS/readiness |
| 结构变更 | IPC 只完成 sender guard + 全 channel inventory；建立 platform/sidecar inventory，不移动大文件 |
| 测试 | 先落 auth 401/403、untrusted sender、argv 无 secret、readiness 依赖失败和 CI contract，再落对应修复 |
| 回滚 | 每个修复独立 feature/config 开关；不回滚身份数据列 |
| 退出条件 | P0 缺陷有回归；性能 baseline 有数据；远端 required checks 已现场记录 |

### Wave 1：契约先行（31-60 天）

| 项目 | 内容 |
|---|---|
| 前置 | Wave 0 inventory 完成；当前 handler/preload/platform 快照测试通过 |
| 文件范围 | `app/ipc` manifest；renderer electron-bridge；platform catalog/adapter registry；sidecar supervisor facade |
| 结构变更 | 在 31-60 天完成 IPC manifest 单轨和 registrar 收口；旧入口委托新 facade，不改变 channel 名、route mode 和 UI |
| 测试 | channel 唯一/完整；renderer 禁止 direct electronAPI；平台矩阵；sidecar config |
| 回滚 | facade 可切回原注册器/route resolver；保留兼容 re-export |
| 退出条件 | 新增 IPC/platform/sidecar 不再需要编辑 3+ 清单；无双重注册 |

### Wave 2：Story2Video 建缝（61-90 天）

| 项目 | 内容 |
|---|---|
| 前置 | pipeline characterization、artifact fixtures、真实 FFmpeg 小样本完成 |
| 文件范围 | stages、pipeline registry/runner、compose adapters、segmentation build |
| 结构变更 | 每个 stage 提取 handler；原 facade 与事件合同保持 |
| 行为变更 | provenance 标准化单独 PR；不得和文件移动混合 |
| 测试 | stage contract、resume/cancel、mixed provenance、TS/CJS vectors、real ffmpeg |
| 回滚 | stage-by-stage registry flag；旧 facade 仍可执行 |
| 退出条件 | 单 stage 可独立测试/替换；手工 JS 镜像删除；全链产物 hash 可解释 |

### Wave 3：发布与数据边界（4-6 个月）

| 项目 | 内容 |
|---|---|
| 前置 | 产品/adapter/route capability matrix 和真实平台抽样验收 |
| 文件范围 | PublisherRouter、api-router、adapter errors/cache、task queue、repositories |
| 结构变更 | 一个 pure plan resolver；executor 不再二次决策；repository 封装 owner |
| 行为变更 | fallback/idempotency 策略按平台逐个灰度 |
| 测试 | API/RPA capability、side-effect stage、cancel/retry、owner isolation、crash/reopen |
| 回滚 | 每平台保留旧 resolver flag；不可双发的平台默认关闭 fallback |
| 退出条件 | 每个平台只有一个可解释 PublishPlan；错误为结构化 code；存储语义文档与代码一致 |

### Wave 4：Renderer 与设计系统（7-9 个月）

| 项目 | 内容 |
|---|---|
| 前置 | IPC bridge 单轨完成；页面行为/视觉 baseline 完整 |
| 文件范围 | CreateView/ResultView/ModelProviders、provider API、notify、tokens |
| 结构变更 | 按 use case 拆 composable/feature；semantic token + compatibility alias |
| 行为变更 | UI/UX 改动独立 change，不夹在拆文件 PR |
| 测试 | component/flow/visual/i18n；Electron 窗口真实 IPC |
| 回滚 | 旧页面 facade 和 token alias 保留一个发布周期 |
| 退出条件 | 核心页面不持有跨域编排；direct IPC 为 0；主题 token 单一来源 |

### Wave 5：运维和发布闭环（10-12 个月）

| 项目 | 内容 |
|---|---|
| 前置 | metrics 字段稳定；CI 各运行时 job 可复现 |
| 文件范围 | logging/trace、OpsCenter deploy、Logto/API runbook、Windows release |
| 结构变更 | dashboard/runbook/alert ownership；artifact provenance |
| 测试 | failure injection、backup/restore、signed installer/update、ECS smoke |
| 回滚 | 保留旧 release channel；签名/更新可灰度 |
| 退出条件 | SLO 有 4 周数据；告警有 owner；安装/更新在干净机验收 |

### Wave 6：基于数据的可选优化（13-18 个月）

仅在指标证明需要时考虑：

- 将 sql.js 换成原生 SQLite；
- 把确有独立伸缩需求的媒体任务远程化；
- 引入 OTLP collector；
- 基于出口、动态加载和外部部署审计，清理真正孤立的 workspace 或未消费导出；`shared-utils`/`rpa-engine` 不属于可直接删除对象；
- 升级 Pinia 主版本和大范围 TS 迁移。

这些不是默认路线。如果 Wave 0-5 已满足交付速度、可靠性和性能目标，应停止继续重构。

## 10. 30/60/90 天执行清单

### 30 天

1. 先把 OpsCenter sync/status 的 401/403 负例与 CORS allow/deny 合同接入 CI，再修复鉴权、readiness 和 allowlist 默认值。
2. 为 `webview:list-tabs` 补 sender guard，生成全 channel inventory；本阶段不强行迁移全部 registrar。
3. 移除 sidecar knownPaths，CLI secret 改 stdin/env。
4. 记录 Windows code signing ADR 和证书/发布流程成本。
5. CI 增加 OpsCenter backend/frontend 和 Python backend 分片。
6. 测量启动、DB snapshot、sidecar ready、pipeline stage。
7. 重写 README 架构章节，标记历史草案为 superseded。

### 60 天

1. IPC manifest 覆盖全部 invoke/event channel，所有 registrar 切到单轨。
2. Renderer API 全部经过 electron-bridge，加入静态门禁。
3. 建立 ProductPlatformCatalog / AdapterRegistry / PublishPlanResolver。
4. 建立 sidecar descriptor/supervisor facade 和 session token 方案。
5. 独立 OpsCenter secret/audience，增加跨服务 token 拒绝测试。
6. 选定 Story2Video 第一批两个 stage 做纯结构提取。

### 90 天

1. Story2Video 关键 stage 可独立运行/恢复/取消。
2. 分句 TS 单源生成 CJS，混合 provenance 合同落地。
3. 每个平台发布计划可从单一 resolver 解释。
4. sql.js snapshot 和 JSONL 所有权文档化并有 crash/reopen 测试。
5. 可见 Electron 窗口、ASAR、preload 和 IPC 门禁进入 Windows CI 或发布前强制流程。
6. 审计 `shared-utils` 的 deep import/类型出口、`rpa-engine` 的 selectors/browserData 责任和 `ai-writer-api` 的外部部署，分别决定出口收敛、重命名/迁移或独立服务退役。

## 11. ADR 与 OpenSpec 拆分清单

### 11.1 ADR

| ADR | 决策问题 | 推荐默认 |
|---|---|---|
| ADR-IPC-001 | IPC manifest 与 runtime validation | 现有 validator + manifest，暂不加新库 |
| ADR-PUB-001 | 产品平台、adapter 能力和路由 | 三层模型 + pure resolver |
| ADR-S2V-001 | 分句算法单一来源 | TS 源生成 CJS |
| ADR-DATA-001 | sql.js 还是原生 SQLite | 先保留 sql.js，指标触发再评估 |
| ADR-ID-001 | OpsCenter 是否接入 Logto | 保持独立 admin，分离 secret/aud |
| ADR-SIDECAR-001 | 本地 sidecar 安全和端口 | loopback + session token，不上 mTLS |
| ADR-REL-001 | Windows 签名与更新信任 | Authenticode + 受保护 release |
| ADR-OBS-001 | OpenTelemetry 采用时机 | 先结构化日志，存在消费方再 OTLP |

### 11.2 建议的独立 OpenSpec change

1. `secure-ops-center-sync-status`
2. `unify-ipc-registration-manifest`
3. `secure-sidecar-config-and-cli-secrets`
4. `ops-center-readiness-and-secret-isolation`
5. `publish-platform-capability-catalog`
6. `renderer-electron-bridge-single-track`
7. `story2video-stage-boundaries`
8. `story2video-segmentation-single-source`
9. `desktop-persistence-semantics`
10. `backend-ci-coverage`
11. `windows-visible-window-ipc-gate`
12. `windows-release-signing`
13. `sidecar-supervisor-facade`
14. `frontend-semantic-token-consolidation`
15. `provider-api-consolidation`
16. `cross-process-observability-baseline`
17. `audit-workspace-exports-and-consumers`

不要创建一个覆盖上述全部内容的实施 change 或 PR。README 现状修订属于 docs-only change，不应与任一运行时修复绑定。

## 12. 明确不做

1. 不进行全库重写或一次性目录搬迁。
2. 不将 Electron 主进程拆成大量网络微服务。
3. 不因为行数大就把所有 JS 一次性迁移为 TypeScript。
4. 不强行合并 Logto 用户身份和 OpsCenter 管理员身份。
5. 不用 PostgreSQL 替换桌面本地存储。
6. 不把 JSONL 全部迁到 SQLite；replay/audit 可保持 append log。
7. 不引入 Kafka、Redis、service mesh 或本地 mTLS。
8. 不删除 RPA；多数平台没有稳定公开 API。
9. 不把真实 provider 的失败静默包装为“成功降级”。
10. 不在同一个 PR 中同时拆结构、改产品行为和换存储。
11. 本规划本身不修改 API、IPC、Schema、依赖、打包产物、运行配置或生产环境；清单中的名称不是实施授权。

## 13. 未决问题与真实环境验证

| 未决项 | 当前只能确认 | 需要的证据 |
|---|---|---|
| GitHub required checks | workflow YAML | GitHub branch protection 当前状态 |
| ECS 真实端口/网络 | Compose/文档互有漂移 | 远端 `docker compose ps/config` |
| OpsCenter systemd env | unit 无 EnvironmentFile | 远端 manager environment/启动日志 |
| Logto 登录 | 静态 OIDC 合同 | 真实 PKCE、refresh、opaque token |
| 第三方发布 | adapter/RPA 代码 | 各平台受控账号真实草稿/发布 |
| provider 能力/额度 | 请求与错误映射 | 真实 key、quota、上传、内容审核 |
| Windows 安装/更新 | builder 配置 | 签名安装包、干净机、升级/回滚 |
| 性能容量 | 无统一 baseline | 长时运行与真实媒体/provider 负载 |
| 跨设备/云同步 | 本地 owner 与云身份接口 | 两台设备和真实账号数据验证 |

## 14. 双模型分析与审查结论

### 14.1 Analyzer / Architect 阶段共识

opencode 与 Claude 均识别出：

- Electron 主进程业务集中；
- Story2Video/pipeline 超大模块是主要变更热点；
- IPC 需要单一注册/权限清单；
- 发布能力与路由需要收敛；
- CI、可见窗口、后端和运维证据需要补齐；
- 应采用增量边界迁移，而非大爆炸重写。

### 14.2 分歧与误报处理

外部分析中以下主张经当前源码核验后未采纳：

| 外部主张 | 核验结果 | 最终处理 |
|---|---|---|
| Renderer 未开启 sandbox | 错；`window.js` 明确 `sandbox:true` | 作为已建立基础保留 |
| desktop 是真实 WAL SQLite | 错；底层为 sql.js 原子快照 | 改为数据语义治理 |
| platforms.yaml 与 ROUTE_TABLE 不一致 | 错；两者均为相同 15 平台 | 问题下移到 adapter/capability 层 |
| shared-utils 的 `index.d.ts` 不存在 | 错；文件存在 | 改为声明/运行时一致性审计 |
| rpa-engine 是空壳或无消费者 | 错；有 browser-data/selectors，且 `rpa-view-platforms.js` 真实消费 selectors | 改为责任收窄与未消费导出审计 |
| shared-utils 无运行时消费者 | 错；Desktop main/renderer 均有大量直接与 deep import | 改为出口、类型和 deep-import 治理 |
| 自动更新完全无完整性校验 | 夸大；有 HTTPS/sha512，无代码签名 | 精确描述身份锚缺失 |
| OpsCenter `PO_SECRET_KEY` 是拼写错误 | 错；是历史共享设计 | 评估密钥隔离与 systemd 注入 |
| 远端 required checks 未配置 | 仓库无法证明 | 标记 E6 待验证 |

Claude wrapper 的前两次失败来自空值 `--setting-sources`；使用本机参数净化 shim 后完成分析。Claude 随后在任务目录生成了一份未经核验的草稿；本报告只吸收经 `file:line` 复核的内容，并删除该草稿以免误导。

### 14.3 Reviewer 阶段

最终工件由两个 reviewer 独立审查：

| Reviewer | Session | 结论 | Critical |
|---|---|---|---:|
| opencode | `ses_fa9cb6b42ffe5p4oWZ2nkPlaqX` | `APPROVE_WITH_CHANGES` | 0 |
| Claude | `b661aa0a-b683-4a49-8a2d-bcf266e784e8` | `APPROVE_WITH_CHANGES` | 0 |

采纳修订包括：补齐统计残差、将 IPC inventory/sender 修复与完整 manifest 分成两个时段、细化 CI 时间/分片/flake/skip 策略、补 Windows 可见窗口与 sidecar facade 独立 change、明确测试先行、区分两个分句文件职责、补固定基线和非实施授权。审查后又用当前源码纠正了 `shared-utils`/`rpa-engine` 消费关系。完整执行状态、降级记录、Warning/Info 与未采纳理由见 CCG 归档中的 `review.md`。

Claude wrapper 同时报告 `claude-code:unrecognized_model` 子代理警告，但主 Claude reviewer 输出完整；该工具警告与审查结论分开记录，不能据此把审查判为失败，也不能把它省略。

## 15. 关键证据索引

| 主题 | 证据 |
|---|---|
| 启动 | `apps/desktop/electron/main.js:64-117`；`bootstrap.js:64-215` |
| DI | `core/container.setup.js`；`bootstrap/phase1-context.js` |
| Window 安全 | `window.js:208-226` |
| Sender | `core/ipc-security.js:29-82` |
| IPC ACL | `ipc-handlers/license-access-control.js:155-276` |
| IPC 漏口 | `services/webview-manager.js:1279-1289` |
| Renderer bridge | `src/api/electron-bridge.js:8-54`；`src/api/publisher.js:465` |
| Shared packages | `core/container.setup.js:61-67`；`bootstrap/phase1-context.js:355-357`；`services/rpa-view-platforms.js:20-21` |
| 发布路由 | `services/publisher-router.js:434-498`；`api-publish-engine/src/api-router.js:43-96` |
| Adapter registry | `api-publish-engine/src/index.js:1-89`；`adapters/platform-configs.js` |
| Story2Video | `services/stage-executor.js`；`story2video-stages.js`；`story2video-compose-engine.js` |
| 分句 provenance | `services/story2video-segmentation.js:79-201` |
| Sidecar | `services/base-python-bridge.js`；`splitter-bridge.js`；`prompt-bridge.js:37-48,244-270` |
| sql.js snapshot | `services/sqlite-wrapper.js:3-10,111-141,190-209` |
| Logto | `api-publish-engine/src/auth/logto-auth.js`；`logto-jwks.js`；`logto-runtime.js` |
| Ops auth | `ops-center/backend/config.py:45-56`；`middleware/auth.py`；`routers/auth.py` |
| Ops 漏口 | `ops-center/backend/routers/sync.py:61-76` |
| Ops CORS/health | `ops-center/backend/main.py:67-74,106-108` |
| Release | `apps/desktop/package.json:112-174`；`services/auto-updater.js` |
| CI | `.github/workflows/quality-gate.yml`；`electron-ci.yml`；`gui-test.yml` |
| 文档漂移 | `README.md:5,65-113`；`01-docs/003-electron-tech-design.md`；`integration-architecture.md:6-65` |

## 16. 结论

Multi-Publish 已拥有足够多的正确基础，不需要重新发明整套系统。真正有价值的重构是把已有能力变成明确的边界：让 IPC、平台能力、发布计划、sidecar、数据所有权、身份域和观测字段都只有一个可查询的事实源；让大文件背后的 use case 能在 facade 后独立测试和替换；让 CI、打包、远端和真实 provider 证据不再互相替代。

只要遵循“契约先行、结构与行为分离、逐平台/逐 stage 灰度、指标触发后续投资”，这套系统可以在不停止业务交付的情况下，用 6-12 个月完成主要边界重构；13-18 个月的工作应严格由实际性能和运维数据决定，而不是自动执行。
