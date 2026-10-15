# 技术债务记录

记录日期 | 债务 | 优先级 | 说明
---|---|---|---
2026-07-04 | 全局 UTF-8 BOM 残留 | 🟡 中 | ~60+ 文件（含测试/脚本/文档）带 BOM，影响 Vitest/PostCSS 解析。已在 apps/desktop/package.json 修复，其余待清理

2026-07-06 | UTF-8 BOM 残留 | 🟡 中 | ✅ 已修复 | apps/desktop 74个 + packages 29个 + 01-docs 19个，共 122 个 BOM 文件已批量移除

2026-07-15 | FLUX listModels 浅拷贝突变污染 | 🟠 高 | ✅ 已修复 | `flux.js` listModels() 用 `slice()` 仅浅拷贝数组，对象引用共享，调用方修改返回值污染内部 FLUX_MODELS 静态列表。修复为 `map(m => ({ ...m }))`。由质量节拍补跑步骤② TDD 场景脑暴发现

2026-07-15 | Hunyuan Video Adapter 待实现 | 🟡 中 | ✅ 已修复 | 已在 commit 4736094 中实现全部 39 个 Adapter（含 Hunyuan），覆盖 6 大类别 43 个供应商。IVideoAdapter mixin 的 12 个 Video Adapter 全部就绪

2026-07-15 | model_provider_logs 表未启用 | 🟡 中 | ✅ 已修复 | store-schema.js 已添加 model_provider_logs 表 + 2 个索引，store.js 新增 addProviderLog/getProviderLogs/cleanProviderLogs 三方法，router.js 通过 logHandler 注入模式写入日志（不直接依赖 db，保持可独立测试）

2026-07-15 | ProviderRouter 未在 bootstrap 中接线 | 🟠 高 | ✅ 已修复 | phase1-context.js 创建 ProviderRouter 实例并注入 logHandler（转调 store.addProviderLog），调用 aiGenerator.setRouter() 完成接线。router._logCall 扩展第 4 参数 context（含 category/action/latency_ms），executeWithFailover 用 Date.now() 计算延迟。ai-generator.js _generateWithFailover 在 options 中传入 action: method。至此故障转移 + 调用日志全链路闭环

2026-07-15 | callAdapter 内部无日志记录 + IPC 无 logs 接口 | 🟠 高 | ✅ 已修复 | model-provider-manager.callAdapter 内部新增 _writeLog 统一记录日志（所有路径覆盖，不依赖 router logHandler），phase1-context.js 移除 router logHandler 避免双写。IPC 层新增 model-provider:logs（查询）和 model-provider:clean-logs（清理）两个接口。store 无 addProviderLog 方法时向后兼容不抛错，addProviderLog 抛错时 try-catch 包裹不影响主流程

2026-07-15 | Anthropic streamChat 无集成测试 | 🟢 低 | 部分覆盖 | 质量节拍补跑已补充 9 个单元测试覆盖 SSE 解析逻辑，但缺真实 Anthropic API 端到端集成测试（需 API Key，CI 环境无法执行）

2026-07-15 | preload/system.js 缺 model-provider 12 个方法 + IPC handler 无测试 | 🔴 严重 | ✅ 已修复 | 第 4 轮将 modelProviderLogs/cleanLogs 加到了已弃用的单文件 preload.js（window.js 实际加载 preload/index.js → preload/system.js），导致渲染进程无法调用全部 12 个 model-provider:* IPC 接口。修复：preload/system.js 补齐 12 个方法（121→133 方法），preload.test.js 同步更新 SYSTEM_METHODS（117→133）+ 断言 + INVOKE_CASES，新建 ipc-handlers/model-provider.test.js 覆盖 12 个 handler（34 测试，含 logs/clean-logs store 缺失兜底）。同时补录 4 个遗漏的 ai* 方法（aiIsConfigured/aiGenerateTitles/aiEnhanceContent/aiGenerateSummary）到 SYSTEM_METHODS 常量

2026-07-15 | SettingsDialog 占位 Tab 待实现 | 🟢 低 | 待实现 | 设置弹窗目前仅【模型设置】Tab 可用，通用/发布/账号 3 个 Tab 为占位禁用状态。未来需按需实现各自设置面板。前端下拉菜单使用了全局 click 监听（handleOutsideClick），组件卸载时已配对移除

2026-07-15 | preload PUBLIC_METHODS 白名单遗漏渲染/流水线方法 | 🔴 严重 | ✅ 已修复 | `preload/index.js` 的 `PUBLIC_METHODS` 白名单未包含 `renderGetStatus`/`renderInstallDeps`/`onRenderInstallProgress`/`pipelineList`/`pipelineGet`。打包模式下 `accessLevel='public'`（无 Pro license/未登录），这些方法被 `filterApiByAccessLevel` 过滤，前端 `invokeWithFallback` 返回 `{}`，导致视频创作页面误报"缺少 remotion-composer"。修复：将上述 5 个只读方法加入 PUBLIC_METHODS，同时 CreateView.vue 增加 ipcError 防御性处理区分 IPC 失败和实际状态。commit df99ff6

2026-07-15 | story2video 双界面并存 | 🟡 中 | ✅ 已修复 | CreateView.vue（统一界面）和 PipelineView.vue（S2V 专属配置面板）并存，两套独立 UI+数据流，用户体验割裂。修复：将 S2V 编排模式（isOrchestratedPipeline/s2vConfig/startOrchestratedPipeline/updateOrchestrationStatus/advanceOrchestration）合并到 CreateView.vue，删除 PipelineView.vue，路由移除 /create/pipeline。commit df99ff6

2026-07-15 | 14条流水线共享全局 LLM 配置但 UI 暴露独立选择 | 🟢 低 | ✅ 已修复 | CreateView.vue 高级配置区暴露 LLM 提供商/模型选择，但 14 条流水线共享全局 LLM 配置，无独立模型选择环节。修复：llmConfig 精简为 { temperature }，移除 loadLlmProviders/availableLlmProviders 及对应 UI，startPipeline 传 llm:{temperature} 让后端用 getDefault(category) 默认供应商。commit df99ff6

2026-07-15 | keywordPersistTimer setInterval 未清理 | 🟡 中 | ✅ 已修复 | `phase3-services.js` 的 `keywordPersistTimer`（5分钟持久化定时器）仅 `.unref()` 但从未 `clearInterval`，应用退出时内存泄漏。修复：`startServices()` 返回 `{ keywordPersistTimer }`，`bootstrap.js` 捕获并加入 context，`shutdown.js` 在 window-all-closed 中 `clearInterval`

2026-07-15 | rpa-view-manager innerHTML 字符串拼接重复 | 🟢 低 | ✅ 已修复 | `rpa-view-manager.js` 3 处 innerHTML 设置通过字符串拼接构建 executeJavaScript 代码，虽已用 JSON.stringify 转义但模式重复。修复：抽取 `_setElementContentSafe(win, selector, content, opts)` helper 统一转义逻辑，重构 zhihu content 填充使用 helper

2026-07-15 | CreateHistory.vue stageClass(null) 抛错 | 🟡 中 | ✅ 已修复 | `stageClass(s)` 用 `typeof s === 'object'` 判断，但 `typeof null === 'object'` 导致 `null.status` 抛 TypeError。修复：改为 `s && typeof s === 'object'`

2026-07-15 | preload sendSync 无缓存 | 🟢 低 | ✅ 已修复 | `preload/index.js` `getAccessLevel()` 每次调用都执行 `sendSync`。虽实际只调用一次，但缺乏缓存防御。修复：添加 `_cachedAccessLevel` 模块级缓存 + 架构说明注释（contextBridge 同步约束使 sendSync 不可替代）

2026-07-16 | 缺少 CSP 内容安全策略 | 🔴 严重 | ✅ 已修复 | `src/index.html` 无 Content-Security-Policy，sandbox:false 下无法防 XSS。修复：添加 CSP meta 标签，script-src 'self'，允许 Fontshare/Google Fonts 字体 + Vite HMR (ws:/localhost)。安全性由 contextIsolation:true + nodeIntegration:false + CSP 三重保障

2026-07-16 | 空 catch 吞错误（10 处） | 🟠 高 | ✅ 已修复 | `api-publish-engine/src/` 10 处 `catch(e) {}` 错误完全消失。修复：scheduled-publish/publish-plan/audit-log/publish-api-client/plugin-loader(4处)/zhihu 共 10 处加 console.warn。未误改合理 fallback：md-converter.js/browser-data.js/http-provider.js

2026-07-16 | IPC 无 sender 验证（9 个敏感 handler） | 🔴 严重 | ✅ 已修复 | `isTrustedSender()` 已定义但仅覆盖 3/212 handler。修复：提取 `withSenderCheck(fn)` 高阶函数到 `ipc-handlers/helpers.js`，包装 9 个敏感 handler（auth:save-credentials/store:delete-account/store:update-account/payment:complete/payment:simulate/batch:execute/batch:delete/scheduler:create/scheduler:cancel）。测试环境跳过验证

2026-07-16 | IPC handler try-catch 模板重复 | 🟡 中 | ✅ 已修复 | ~40 handler 完全相同的 try-catch 模式。修复：提取 `wrapIpcHandler(fn)`/`wrapIpcHandlerRaw(fn)` 高阶函数到 `ipc-handlers/helpers.js`，统一 try-catch + 参数校验 + 错误日志。scheduler.js 迁移为示例，保留原响应格式 + catchData 兜底

2026-07-16 | 两套 preload 并存（旧版 423 行未删除） | 🟠 高 | ✅ 已修复 | 旧版单文件 `electron/preload.js`（423 行）已弃用，window.js 实际加载 `preload/index.js`，但 CI 脚本和测试仍依赖旧版。修复：重构 `check-ipc-bridge.js` 改用 `preload/` 子目录递归扫描，更新 `ipc-handlers.test.js` 移除旧版读取逻辑，HIDDEN 集合补充 8 个 pipeline 内部 handler，删除旧版 preload.js

2026-07-16 | ai-writer 包 100% var 声明遗留 | 🟢 低 | ✅ 已修复 | `packages/ai-writer/src/` 2 个源文件 38 处 var 声明。修复：index.js 18 处（16 const + 2 let）+ cli.js 20 处（全部 const），按是否重新赋值判断 const/let

2026-07-16 | setTimeout unref 覆盖不足（32%） | 🟢 低 | ✅ 已修复 | 主进程 104 处 setTimeout/setInterval 仅 33 处 unref。修复：所有 13 处 setInterval 已有 unref（100%），新增 7 处长期 setTimeout unref（auth-view-session 10s 超时 + rpa-view-manager 60s/120s 发布超时）。短期定时器和浏览器上下文定时器不修改

2026-07-16 | 10 处硬编码 127.0.0.1/端口 | 🟡 中 | ✅ 已修复 | callback-server/oauth-manager/window/python-bridge/prompt-bridge/splitter-bridge 6 个文件 13 处硬编码。修复：新建 `electron/config/app-config.js` 统一 6 个服务配置（环境变量优先），替换 13 处硬编码。保留安全检查代码中的 127.0.0.1（isTrustedSender 字面量）

2026-07-16 | Store 类过于庞大（570 行 8 功能域） | 🟠 高 | ✅ 已修复 | `store.js` 570 行含 8 个功能域（账号/历史/定时/设置/回调/批量/频率/模型日志），违反单一职责。修复：物理拆分为 `store/` 目录（base-store + 8 子 store + index），Mixin 模式 `Object.assign(Store.prototype, ...)`，store.js 改为 38 行 thin re-export 保持 `require('./store')` 向后兼容。新增 39 个快照测试。SQLite schema 不变

2026-07-16 | App.vue 过于庞大（332 行 7 功能域） | 🟡 中 | ✅ 已修复 | `App.vue` 332 行含布局/侧边栏/导航栏/状态栏/更新通知/离线指示/通知条 7 个功能域。修复：提取 4 个组件（UpdateNotification/OfflineIndicator/layouts/AppNavbar/layouts/AppSidebar），App.vue 瘦身到 60 行。每个组件独立管理生命周期

2026-07-16 | Adapter 目录膨胀（52 文件平面排列） | 🟢 低 | ✅ 已修复 | `adapters/` 52 文件平面排列。修复：6 个基础设施文件移入 `_base/` 子目录（base/registry/router/provider-error/openai-compatible/music-library），207 处 require 路径更新。46 个 adapter 不动（命名后缀已自带分组语义）

2026-07-16 | createAppContext 上帝对象（52 字段） | 🔴 严重 | ✅ 已修复 | `extractContext()` 返回 52 个扁平字段。修复：按 infra(9)/services(30)/windows(8)/pipelines(5) 分组，Proxy 兼容层（5 个 trap）实现 `context.store` → `context.infra.store` 自动转发，零破坏现有消费者。后续可逐文件迁移

2026-07-16 | remotion-composer 36 文件零测试 | 🔴 严重 | ✅ 已修复 | `packages/remotion-composer/` 36 个 TS 文件无任何测试，项目最严重测试缺口。修复：为 3 个核心模块添加 111 个单元测试（props-validator 38 + scene-builder 34 + media-profiles 39），新建 vitest.config.js + package.json test script

2026-07-16 | shared-utils 5 个手动测试脚本 | 🟡 中 | ✅ 已修复 | `packages/shared-utils/` 5 个 manual-*.js 手动测试脚本含 process.exit() 无法被 Vitest 收集。修复：迁移为 5 个 .test.js Vitest 测试（45 passed + 9 skipped），删除原手动测试文件，调整 vitest.config.js include 规则排除含 process.exit() 的孤儿文件

2026-07-16 | rpa-engine registry.js 空壳死代码 | 🟢 低 | ✅ 已修复 | `packages/rpa-engine/src/publishers/registry.js` 是空壳（`registry = {}`，所有方法抛错或返回空），已废弃。修复：删除 registry.js + registry.test.js，移除 index.js 导出和 check-integrity.js 引用。评估 rpa-engine 合并：保留（合并成本 > 收益）

2026-07-16 | rpa-engine browser-data.js 无消费方 | 🟢 低 | 待评估 | `packages/rpa-engine/src/browser-data.js`（393 行 AES-256-GCM 加密持久化代码）在 index.js 导出但全库无运行时消费方。后续清理候选，需确认是否真的无用再删除

2026-07-16 | license-manager 弱密钥派生（静态盐） | 🟠 高 | ✅ 已修复 | `_deriveKey()` 用静态盐 "license-salt" + 可预测的 userData 路径密码，易被彩虹表攻击。修复：v2 格式用 `crypto.randomBytes(16)` 生成每次加密随机盐，`v2:` 前缀标识格式，v1 旧格式向后兼容解密。commit 4ffe565

2026-07-16 | rpa-view-manager innerHTML 注入用户内容 | 🟠 高 | ✅ 已修复 | 4 处 innerHTML 直接注入用户内容到第三方页面（_setElementContentSafe/_fillInFrame/_fillInput/douyin描述），存在 XSS 风险。修复：DOMPurify-lite 净化（移除 script/iframe/object/embed + 所有 on* 事件属性）。commit 4ffe565

2026-07-16 | publish-alert shell 注入风险 | 🟠 高 | ✅ 已修复 | `execFile('cmd', ['/c', 'start', ...])` 构造命令字符串，音频路径未转义可被注入。修复：改用 `spawn('powershell', [...], { shell: false })`，音频路径单引号转义。所有平台均用 spawn + shell:false。commit 4ffe565

2026-07-16 | rpa-view-manager 711行超大文件7+职责 | 🟠 高 | ✅ 已修复 | 805 行含登录/状态/发布/监控/UI注入/二维码/截图 7+ 职责。修复：Mixin 模式拆分为 4 文件（manager 99行 + helpers 211行 + session 47行 + platforms 339行），Object.assign(prototype, ...mixins)，方法体零修改。commit 4f22d1c

2026-07-16 | content-intelligence 825行超大文件 | 🟠 高 | ✅ 已修复 | 825 行含 Reddit/HN/GitHub 搜索 + trending + 标签生成 + benchmarking 多职责。修复：Mixin 模式拆分为 3 文件（main 381行 + sources 235行 + analysis 300行），方法体零修改。commit 4f22d1c

2026-07-16 | rpa-view-manager 24处硬编码setTimeout纯等待 | 🟠 高 | ✅ 已修复 | 25 处 `await new Promise(function(r){setTimeout(r,N)})` 纯等待违反 QM-2 反 waitForTimeout 原则。修复：统一替换为 `this._sleep(N)` helper（unref + 单一维护点），剩余 12 处 setTimeout 为合法 timeout 控制。commit 4ffe565

2026-07-16 | proxy-manager 代理URL凭据未编码 | 🟠 高 | ✅ 已修复 | 代理 URL 中 username/password/host 未 encodeURIComponent，含 @/: 字符会导致 URL 解析错误。修复：三处 encodeURIComponent 包裹。commit 4ffe565

2026-07-16 | api-key-manager 残留 var 声明 | 🟢 低 | ✅ 已修复 | Phase 2 var 现代化遗漏：`_save()` 中 `var h` + `validateKey()` 中 `var keyHash`/`var entry` + `function(k)` 回调。修复：3 处 var → const + 箭头函数。commit 4ffe565

2026-07-16 | ai-writer 包无结构化输出能力 | 🟡 中 | ✅ 已修复 | `packages/ai-writer/src/index.js`（83行）仅支持纯文本输出，无法返回结构化 JSON。修复：Path 1 迁移 Pixelle-Video LLMService 到 `python-backend/services/llm_service.py`（377行），支持 Pydantic v2 `response_type` + 三层 JSON 解析回退。ai-writer 包保留并存（Node.js 端简单文本生成）

2026-07-16 | Prompt 写在代码里难维护 | 🟢 低 | ✅ 已修复 | 原 `ai-writer` 中 prompt 硬编码在 generateTitles/generateSummary 函数内。修复：Path 2 新建 `python-backend/prompts/` 目录，7 个独立 prompt 文件（content_narration/image_generation/title_generation/topic_narration/video_generation/asset_script_generation/style_conversion），每个自包含 system + user template + JSON schema

2026-07-16 | config/config.yaml 无类型安全 | 🟡 中 | ✅ 已修复 | 纯 YAML 读取无类型校验、无热重载、无深度合并。修复：Path 4 新建 `python-backend/config/` 目录（schema.py 95行 + loader.py 60行 + manager.py 152行），Pydantic v2 schema + 热重载 `reload()` + 深度合并 `update()` + 单例模式。适配 Multi-Publish 结构（LLM/TTS/Publishers/VideoCreation）

2026-07-16 | core/task_queue.py 缺状态机和互斥 | 🟡 中 | ✅ 已修复 | 现有 `task_queue.py` 无任务状态机、无同类型互斥、无并发限制。修复：Path 5 新建 `core/task_manager.py`（并行模块，不替换 task_queue.py），状态机 pending→running→completed/failed/cancelled + `cancel_previous=True` 互斥 + `max_concurrent` 并发限制 + `start()/stop()` 生命周期

2026-07-16 | 缺 HTML 模板视频生成能力 | 🟢 低 | ✅ 已修复 | Remotion 复杂动画不适合快速生成带文字/图片的短视频封面。修复：Path 3 迁移 Pixelle-Video `frame_html.py`（411行）+ `frame_processor.py`（249行）+ 3 种尺寸 HTML 模板（1080x1080/1080x1920/1920x1080），Jinja2 风格 DSL + HTML 消毒 + Playwright 截图


2026-08-06 | W1 run-state 快照未按 owner 隔离 | 🟠 高 | ✅ 已修复 | RunStateStore 快照改为 `userData/run-state/owners/{sha256(subject)}/<runId>.json`，owner provider 注入（phase3-services 接线），legacy 平铺快照读取自动迁移；跨账号 runId 不再可互读。PR #374
2026-08-06 | W2 governor 排队超时回收依赖下次释放 | 🟡 中 | ✅ 已修复 | 新增 `_sweepExpired`（每次 run() 入口回收）+ `sweepAll()`（PipelineEngine._finalizeRun 统一调用），过期 waiter 不再悬挂到任务链结束。PR #374
2026-08-06 | W3 governor 默认 RPM 为保守估计 | 🟡 中 | ✅ 已修复 | 新增 governor-provider-limits.js（52 provider 预算），governor 支持 setProviderLimits/构造注入，container 启动注入；优先级 key > provider > 类别默认。PR #374

2026-08-13 | JS stageDefs 与 Python YAML manifest 阶段命名漂移 | 🟡 中 | 基线见 [PIPELINE-MATRIX.md](./PIPELINE-MATRIX.md) §6：多数 YAML 为通用模板（idea/script/scene_plan/assets/edit/compose/publish），与 JS 实际执行阶段（upload/transcribe/…）不一致；仅 story2video-compose 高度对应。后续建「manifest 合同一致性」门禁时以此为基线。待处理
2026-10-02 | recraft.js 图片尺寸契约观察项 | 低 | 待核实 | recraft.js generateImage 只读 params.size，而 asset-generator 统一传 width/height（含 aspect_ratio 推导产物），竖屏请求会静默落 1024x1024 方形（与 agnes-image 2026-10-02 修复的断链同形态，但 recraft 无用户实测报告）。未盲改原因：Recraft 官方尺寸白名单无法核实（docs.recraft.ai 抓取 522 超时）。待办：核实官方文档后按白名单映射 width/height，并在 image-adapter-aspect-contract.test.js 登记断言

2026-10-02 | podcast-repurpose 图片默认画幅与竖屏 compose 不一致 | 低 | 待产品确认 | podcast-repurpose-stages.js visualize 阶段默认 aspect_ratio 16:9（params.aspectRatio 可显式覆盖），而其 render 阶段固定 720x1280 竖屏 compose，默认路径同样产生黑边。属产品默认值选择（非契约断链），已补透传回归测试（podcast-repurpose-stages.test.js）；待产品确认 podcast 场景竖屏语义后调整默认值

2026-10-05 | CreateView.vue 超大文件治理（issue #1944 结项） | 低 | ✅ 已偿还 | 登记时 `maxFileLines` 基线被一次性「接受漂移」抬到 6511（2026-09-18 / commit `ae75b785`），属只刷新不偿还。治理结果（2026-10-05 实测）：`apps/desktop/src/views/CreateView.vue` **5589 行**（基线 5657，已低于 issue 目标 `<= 6000`，较 6511 降 922 行）；债务熔断 `scripts/check-debt-budget.js` 五项指标全绿，且 `filesOver500` 实测 **98 < 基线 101**（issue 复核时为 101，方向由「违反只减不增」转为低于基线）。抽取沿用仓库既有先例（PipelineView.vue 已并入、S2V 编排面板化、CopyLibraryPanel 等）。结项说明：`modelProviderRequireFanOut` 仍持平 65（与基线持平、未触发门禁），属 model-provider 单文件关注点尚未拆分的后续债，不再挂在本 issue 上

2026-10-05 | settings 行损坏抹 Key（`_readStoredObject` 三态契约） | 中 | 待排期 | 损坏/半截 JSON 行会被当作「读不到」而回落默认值，连带把该行已存的 Key 抹掉；三态契约（损坏 / 缺失 / 合法）需在 `_readStoredObject` 显式分开，波及 6 个调用点，属跨面切片不宜顺手改。来源：QM-6 后端评审 Warning #4，登记于 `docs/settings-persistence-contract.md` §8.1（#2899 未修）
2026-10-05 | 运行时信任锚与被保护状态同落可写表、落盘后不重验签 | 高 | 待产品决策 | 自定义锚 `runtimePublicKey`（`opsCenterSync` 行）与受保护运行时状态（`opsCenterRuntime` 行）同在 settings 表；`_loadRuntimeState` 直接恢复缓存、**不重验签**，验签只发生在 `_fetchRuntime` 的网络负载上 ⇒ 签名链保护「传输」不保护「落盘重放」，能写本机 SQLite 的一方可自签也可直接改状态行。属产品级安全决策（信任锚移出可写表），加验签了结不了。来源：QM-6 后端评审 Warning #6，登记于 `docs/settings-persistence-contract.md` §8.2（#2899 未修）
2026-10-05 | 窄包装未转发 `getSettingObject`（hot-topics 三处手抄归一化） | 低 | 待排期 | `hot-topics-service` 经 `container.setup.js` 拿到的是只转发部分方法的窄包装，仍用自身三处手抄归一化逻辑；#2899 只加注释 + 装配锁（`KNOWN_LAGGING` 白名单）未强行转发，以免凭空登记无关欠账。扩转发属独立切片；`docs/settings-persistence-contract.md` §6 已登记 13 处待收敛，归入跨面 AST 判据 + 全仓棘轮一并做

2026-10-08 | 运营中心 ECS 部署前置清单（韧性链路收尾）| 中 | 部署时执行 | 运营中心计划延后部署（2026-10-08 用户确认），代码与手册已全部就绪（三层降级/权益宽限期/生效回执已合入 PR #3126；运维章节见 docs/ops-center-ecs-deployment.md §10）。部署当天按 docs/ops-center-ecs-deployment.md §7 清单执行，其中三项不可跳过：(1) 信任锚：§4.1 命令生成 Ed25519 密钥对，私钥配 ECS OPS_RUNTIME_SIGNING_KEY_PATH、公钥填打包版「运营中心同步配置」，否则打包版运行时策略全部拒收（NO_PRODUCTION_TRUST_ANCHOR，fail-closed 硬阻断）；(2) 外部探针：§10.1 阿里云云监控配 /health 探测+证书到期监测——探针只能打 /health，勿用 /api/v1/system/health（admin 鉴权，恒 401 误报，PR #3152 已纠错），并禁止用运营中心自己的 cron 探测自己；(3) L3 种子人工确认：apps/desktop/resources/ops-seed/runtime-bootstrap.json 是否为要随版本发布的最终版数据（CI 只校验结构，不校验业务正确性），必要时跑导出脚本刷新。公网验证必须在 ECS 上 curl，开发机 DNS 被代理 Fake-IP(198.18.x) 接管测不出真实状态。部署后跑 §10.4 五条韧性验证（ACK 出现/降级补报/断网可用/宽限期/探针告警）。剩余可后置开发项（等真实使用反馈再排期，勿提前实现）：生效看板前端页 V-4、config_audit_log 写入点补全 V-5（39 个运营页面）、未确认客户端下钻 V-6、墓碑本地持久化 D-6——数据端点（/api/v1/runtime/rollout、/api/v1/telemetry/degradation/summary，均 require_admin）已可用 curl 查。

2026-10-16 | 依赖审计门禁按 `vuln.id` 单键匹配、不认公告 aliases（同一条公告换号即假红） | 中 | 待排期 | `scripts/check-dep-audit.js` 的 `parsePipAudit`（`:187` `const id = vuln.id || vuln.name;`）只用 pip-audit 报的**主 id** 当键，把 `aliases` 整个丢掉；而公告库会改用自家新号、把旧 CVE 收进 aliases ⇒ 同一条公告、同一版本、同一 `patched=无` 会被判成**两条互相矛盾的结论**。实测现场（2026-10-16）：`pip-audit` 对 `python-jose 3.5.0` 报 `id=PYSEC-2026-4298`、`aliases=["CVE-2026-85394","GHSA-3qf3-8w2g-rqmx"]`、`fix_versions=[]`，而基线当时以 `CVE-2026-85394` 为键 ⇒ 门禁同时打出 `NEW_ADVISORY: pip/PYSEC-2026-4298` 与 `RESOLVED_STILL_BASELINED: pip/CVE-2026-85394`，**而安全结论一个字都没变**（原判 `not-exploitable`，依据是 `middleware/auth.py:37`、`services/logto_verifier.py:95` 的 `algorithms` 显式限定与 `config.py:52` 的 `Literal["HS256"]` 类型锁死）。三点危害：① 假红被表述成「一增一失」，而最省事的修法是照新 ID 再登记一条 ⇒ **同一条公告在基线里留两份**，且旧条目收到 `RESOLVED` 提示后会被顺手删掉本来还对的那条；② 每次换号都刷一次红，会**训练人把「依赖漏洞审计」红当噪声忽略**——而这条门禁守的正是依赖漏洞，忽略它的代价最大；③ 续判只能靠人肉翻 `pip-audit` 原始 JSON 的 aliases 才能确认「是不是同一条」，本轮即如此（本轮已由 PR #3668 按旧证据续判并清账，未改结论）。修法（**另立项，勿顺手改**）：`parsePipAudit` 一并收集 `vuln.aliases` 入条目，匹配时**主键或任一 alias 命中即视为同一条**，并把这种情况报成「key 迁移」而不是 `NEW_ADVISORY`+`RESOLVED_STILL_BASELINED` 双报；回归锁 = 造一份「同公告换号」的 pip-audit JSON 夹具，断言门禁**不**报 NEW/RESOLVED 而报 key 迁移。**边界（不可放宽）**：别名合并只改变「这条公告是否已在账上」，`decision` / `note` / `reviewBy` 语义与 `VALID_DECISIONS`、`patched` 校验一律不动 —— 该修复**不得**被当成放宽门禁的借口。附一条排除性观察以免后续误读：本轮出现过「本地 `check-dep-audit.js` 判绿、同一提交在 CI 判红」，已查实**不是门禁抖动或环境差异** —— 本地工作区当时已带另一会话**已暂存未提交**的基线修复（跑门禁前的快照 `node -e` 读出的键就是 `PYSEC-2026-4298`），而 CI 跑的是主干上仍是旧键 `CVE-2026-85394` 的版本；`git diff --cached` 与该快照均可复现此解释