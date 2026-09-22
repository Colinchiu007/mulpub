# 全仓库代码综合体检报告（只审查，不动代码）

## 总体结论

三个模块均无可直接利用的注入类漏洞（命令注入/SQL 注入/路径遍历/不安全反序列化系统检查均未命中），Electron 安全基线（sandbox/contextIsolation/导航守卫/凭据加密/日志脱敏）和 ops-center 后端的鉴权矩阵、PBKDF2 口令哈希、文件上传防护质量较高。真正的硬伤集中在一条线：**ops-center 的密钥与信任链治理**（签名私钥入库、弱密钥闸门可绕过、加密主密钥静默自生成），以及**局部实现缺陷**（B站采集桩实现、decrypt_key 调用参数错误被裸 except 吞掉）。

## 问题清单

### P0 - CRITICAL（信任链被击穿，须最先处理）

1. **Ed25519 运行时配置签名私钥随示例文件入库**
   - `ops-center/backend/.env.example:34-36` 内嵌一把可用私钥（已核实），且注释明确"桌面端内置默认公钥与这把 DEV KEY 配对"，作为 `/api/v1/runtime/bootstrap` 的验签信任锚。任何拿到仓库的人可伪造公告/版本策略/敏感词/pipelineOptions 全链路运行时配置，属供应链级风险。
   - 方案：`.env.example` 删除真实 PEM 只留生成命令占位；桌面端内置默认公钥仅在非打包（`app.isPackaged === false`）时生效，生产强制自定义密钥对；该私钥视为已泄露，全环境轮换。

2. **JWT 弱密钥闸门形同虚设 + 跨服务共享密钥**
   - `ops-center/backend/config.py:56-61` 的 `get_jwt_secret` 仅精确匹配拒绝固定串 `dev-secret-change-in-production`；`dev-secret-key-for-local-testing-2026`、口令 `admin123` 均能通过。`deploy/ops-center.service:12-13` 又把 `OPS_JWT_SECRET` 与 platform-orchestrator 的 `PO_SECRET_KEY` 绑成同一把（代码层 Stage -1.8 已解耦，部署层重新耦合），一把泄露即可跨服务伪造 admin 令牌。
   - 方案：校验最小长度 ≥32、拒绝 `dev-/test-/changeme` 前缀及与示例值相同；`admin_password` 拒绝弱口令并强制首登改密；生产经 `EnvironmentFile=` 注入强随机密钥并与 orchestrator 解耦。

### P1 - MAJOR（功能缺陷与高危配置）

**ops-center 后端：**

3. **`decrypt_key` 调用参数错误被裸 except 吞掉，功能从未生效**（已核实）
   - `services/model_preset_service.py:991` 以两参数调用 `key_service.decrypt_key`（实际单参数，`key_service.py:38`），必抛 `TypeError` 后被 `:992-993` `except Exception: pass` 吞掉——"test 连通性时回退已保存密钥"从未工作。改用 `prompt_eval_service.decrypt_key(secret, value)`（两参数版本）并记录日志。
4. **加密主密钥缺失时静默自生成**
   - `services/key_service.py:19-21`：`OPS_ENCRYPTION_KEY` 为空每次重启/每 worker 生成新内存密钥，历史 `OfficialKey` 密文永久不可解；`_model_to_dict:57` 解密无 try 包裹，`GET /secrets` 整表 500。改为 fail-closed 拒启，解密失败按条降级掩码。
5. **`ConfigItem` 敏感配置明文落库**
   - `models.py:30,33` + `config_service.py:64-97`：`OfficialKey` 有 Fernet 加密，但 `is_secret=1` 的 `ConfigItem.value`（含 platform_credential 分类）及审计 old/new 值明文存储，掩码仅在 API 展示层。写库前加密对齐。
6. **CORS 全开 + credentials**
   - `main.py:74-80`，触发值 `.env:4` 与 `ops-center.service:14`（`OPS_CORS_ORIGINS=*`）。生产收敛为白名单域名，启动期对危险组合告警。
7. **`test_provider_connection` 缺 SSRF 守卫**
   - `model_preset_service.py:952-1036` 对任意 `base_url` 直接 httpx 请求且携带真实 API Key，无 https 强制/私网拦截；同文件 `fetch_models_from_url:898-918` 有完整防护。抽公共校验器复用。
8. **systemd 单元引用未定义变量 + root 运行**
   - `deploy/ops-center.service:7,11-13`：`${OPS_ENCRYPTION_KEY}/${PO_SECRET_KEY}` 无 `EnvironmentFile` 来源解析为空（触发问题 4 或直接拒启）；`routers/env.py:82-92` 的 JWT 对齐检查在本进程内恒返回 `unknown` 属误导性死代码。

**packages 引擎层：**

9. **B站采集"API 优先"分支是返回空数据的桩实现**（已核实）
   - `packages/collection-engine/src/platform-adapters/bilibili-adapter.js:81-91`：算好 `signedUrl` 后直接返回 `{ title:'', desc:'' }` 不发真实请求，却以 `success:true` 上报，静默污染下游。补真实 HTTP 请求或删除分支统一走浏览器兜底。
10. **`shared-utils` 生产代码顶层 `require('electron')` 未声明依赖**
    - `shared-utils/src/publish-history.js:7`（顶层）、`scheduler.js:371`；非 Electron 环境 import 即崩。声明 peerDependency 并改注入式/懒加载。
11. **`video-clone-engine` 链接下载缺 SSRF 防护（跨引擎不一致）**
    - `video-clone-engine/src/adapters/ingest-url.js:38-50` 放行任意 URL 给 yt-dlp；Python 侧 `video_service.py:136-148` 有域名白名单+内网拦截。抽公共校验器对齐。
12. **Python Playwright 浏览器无 try/finally 关闭**
    - `python-backend/.../character_animation_utils.py:66-74` 截图抛异常即泄漏 chromium 进程（同仓 `browser_fetcher.py:139-173` 是正确写法，可参照）。
13. **朝代成语守卫缺"刘备/孙权"**
    - `apps/desktop/electron/services/story-context-engine.js:326-329` 的 `IDIOM_EXCLUSIONS` 仅含诸葛亮/曹操，AGENTS.md 门禁点名的高风险人名"刘备/孙权"未登记，俗语（"刘备借荆州"）会整篇误判三国朝代污染全场景。补登记 + 正/负双回归（须跑 `story-context-engine.test.js` 全量）。

**apps/desktop 桌面端：**

14. **IPC `withSenderCheck` 覆盖不一致**
    - 336 个 `ipcMain.handle` 约 215 个带守卫；`logs:clear`（删全部日志）、`feedback:submit`（可打包日志外发）及 aggregation/analytics/misc/platform/auto-pipeline/ops-center-sync 等无来源校验。写/破坏性/可外发 handler 统一补守卫；CI 增加"handler 必须声明 guarded 或豁免"静态检查防漂移。
15. **管理后台 JWT 存 localStorage**
    - `ops-center/frontend/src/stores/auth.js:59-60`，与问题 6 叠加放大 XSS→接管面。评估 HttpOnly+SameSite Cookie 会话，至少配套 CSP 与缩短 TTL。

### P2 - MINOR（择机偿还）

- **性能税**：`preload/index.js:48-61` `getAccessLevel` 每次受限调用 `sendSync` 同步往返（改主进程推送+事件失效缓存）；`model_preset_service.py:903` async 路由内同步 `socket.getaddrinfo` 阻塞事件循环（改 `asyncio.to_thread`）。
- **N+1 与非原子**：`routers/config.py:47-53` 审计日志逐行掩码查询；`routers/sync.py:67-71`；`batch_update`（`config_service.py:99` 每条单独 commit）改单事务。
- **脆弱等待**：`url-collector.js:412`、`videogen-stages.js:818`、`xiaohongshu.py:191`（sleep 30s）等固定 sleep 改条件等待/具名常量（桌面端已有 `_waitForFn` helper）。
- **静默空 catch**：`slideshow.ts:555` 等 4 处、`compose-ffmpeg.js:182,190`、`knowledge-base` 相关——有意降级但无线上留痕，统一补 `logger.warn/debug`。
- **定时器/资源**：`knowledge-evolution-scheduler.js:114-117` 外层 setTimeout 未入 `_timers` 清理清单（孤儿 setInterval）；`rpa-view-helpers.js:294-316` `_waitForResponse` 并发共享单句柄 `webRequest`。
- **安全小项**：`ai-writer-api/src/server.js:42` API Key 非常数时间比较（改 `timingSafeEqual`）；`audio-aligner` `audio_path` 无目录约束；`bilibili-adapter.js:76-77` query 未 `encodeURIComponent`；`webview-manager.js:419` localStorage 注入字符串拼接（当前不可逃逸但脆弱）。
- **重复上传**：`api-publish-engine/src/adapters/generic-adapter.js:26-34` `uploadVideo/uploadCover` 各自跑完整 `upload()`，同任务传两遍。
- **依赖锁定**：`ops-center/backend/requirements.txt` 全 `>=` 无上限无 hash，供应链不可复现。
- **超大文件**：`CreateView.vue` 5589 行、`story2video-stages.js` 3725、`pipeline-engine.js` 2605、`publish-api-server.js`/`text-segmentation.ts` ~55KB、`model_preset_service.py`/`prompt_eval_service.py` 1000+ 行。
- **占位空壳**：`packages/flutter-skill-bridge` 仅剩 node_modules 无源码，确认去留。
- **枚举双份**：Story2Video `imageEffect/transition` 在 `story2video-engine/src/types.ts` 与 renderer `create-view-module-utils.js` 各写一份（当前一致，有漂移风险），抽单一来源。

### 已证伪 / 正面结论（不需处理）

- `CreateView.pollTimer` 泄漏：子代理误报，已核实 `beforeUnmount:5645` 调用 `stopPipelinePolling()`（内部 4465-4469 清 pollTimer），赋值处均有 `!this.pollTimer` 守卫或先前显式停止。
- 三模块均无硬编码密钥赋值字面量（除问题 1 的 .env.example）、无 `shell=True`/裸 `eval`、无用户可控 SQL 拼接、无 `v-html`、rpa-engine Adapter 能力清单无重复 concat、TODO/FIXME 生产代码清零、Vue 端 console.log 清零。

## 优化方案（建议执行顺序，均需另起 worktree 分支走质量节拍）

- **第一批（安全应急，P0 全部 + P1 中的 3/4）**：签名私钥出库与轮换、弱密钥闸门加固、CORS 收敛、decrypt_key 调用修正、加密主密钥 fail-closed。均为 ops-center 局部改动，1-2 天，回归以 `cd ops-center/backend && pytest` 门禁。
- **第二批（功能缺陷，P1 中的 9/10/11/12/13）**：B站采集桩实现落地、shared-utils electron 依赖治理、video-clone SSRF 对齐、Python 浏览器生命周期、IDIOM_EXCLUSIONS 补登记（含四场景回归）。
- **第三批（纵深防御与可观测性，P1 中的 14/15 + P2 静默 catch/安全小项）**：IPC sender 守卫补齐 + CI 静态检查、admin 会话存储方案评估、timingSafeEqual、路径约束。
- **第四批（技术债，P2 余项）**：超大文件按既有 mixin/composable 范式分批拆分（建议 `max-lines` lint 先对新代码阻断、存量挂账）、脆弱等待条件化、N+1 与批量化、requirements 锁定。

## 验证方式（后续执行时）

- 每批走 worktree 隔离 + TDD：先为问题 3（TypeError 被吞）、问题 9（空内容 success:true）、问题 13（俗语不误判）写复现红测试再修。
- ops-center 改动跑后端 pytest 门禁 + 前端 build 门禁；桌面端改动按 QM-1 打包验证。
- 问题 1/2 修复后需人工确认曾使用该 dev 私钥/弱密钥的环境清单并完成轮换。

## 假设与边界

- 本次审查为"全仓模式统计 + 高价值文件抽样深读"，未逐行通读全部约 600+ 生产文件；结论中 IPC 守卫覆盖、密钥字面量检索来自全量正则统计，可信度高。如需对特定目录穷尽审查可指定后展开。
- CRITICAL 两条的"已泄露"判定基于文件已入 git 历史这一事实；即使从未部署，git 历史中的 PEM 也永久公开，故按已泄露处置。

