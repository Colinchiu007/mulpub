# 全仓库代码综合体检报告（只审查，不动代码）

> **[v5]** 第 4 轮对抗评审收口：critique-v4 提 7 条（全 Warning/Info、无 Critical），出方案方逐条现场核验后全部接受，合入本 v5。Critical 轨迹 4→1→0→0。

## 总体结论

三个模块均无可直接利用的注入类漏洞（命令注入/SQL 注入/路径遍历/不安全反序列化系统检查均未命中），Electron 安全基线（sandbox/contextIsolation/导航守卫/凭据加密/日志脱敏）和 ops-center 后端的鉴权矩阵、PBKDF2 口令哈希、文件上传防护质量较高。真正的硬伤集中在一条线：**ops-center 的密钥与信任链治理**（签名私钥入库、弱密钥闸门可绕过、加密主密钥静默自生成），以及**局部实现缺陷**（B站采集桩实现、decrypt_key 调用参数错误被裸 except 吞掉）。**[v-final]** 另：问题 8（systemd unit 把 JWT 秘密注入成公开常量 `${PO_SECRET_KEY}`）经第 2/3 轮评审以 L1 取证晋升 P0，与上述三项同属信任链硬伤，合计 4 项 P0。

## 问题清单

### P0 - CRITICAL（信任链被击穿，须最先处理）

1. **Ed25519 运行时配置签名私钥随示例文件入库**
   - `ops-center/backend/.env.example:34-36` 内嵌一把可用私钥（已核实），且注释明确"桌面端内置默认公钥与这把 DEV KEY 配对"，作为 `/api/v1/runtime/bootstrap` 的验签信任锚。任何拿到仓库的人可伪造公告/版本策略/敏感词/pipelineOptions 全链路运行时配置，属供应链级风险。
   - 方案：`.env.example` 删除真实 PEM 只留生成命令占位；桌面端内置默认公钥仅在非打包（`app.isPackaged === false`）时生效，生产强制自定义密钥对；该私钥视为已泄露，全环境轮换。**[v2]** 泄露面排查清单闭环 + 全环境轮换记录留存，作为问题 1/2/8 的关闭前置条件（见验证方式 DoD 节）。

2. **JWT 弱密钥闸门形同虚设 + 跨服务共享密钥**
   - `ops-center/backend/config.py:56-61` 的 `get_jwt_secret` 仅精确匹配拒绝固定串 `dev-secret-change-in-production`；`dev-secret-key-for-local-testing-2026`、口令 `admin123` 均能通过。`deploy/ops-center.service:12-13` 又把 `OPS_JWT_SECRET` 与 platform-orchestrator 的 `PO_SECRET_KEY` 绑成同一把（代码层 Stage -1.8 已解耦，部署层重新耦合），一把泄露即可跨服务伪造 admin 令牌。
   - 方案：校验最小长度 ≥32、拒绝 `dev-/test-/changeme` 前缀及与示例值相同；`admin_password` 拒绝弱口令并强制首登改密；生产经 `EnvironmentFile=` 注入强随机密钥并与 orchestrator 解耦。**[v2]** 启动期配置校验直接拒绝危险组合（含 CORS `*`+credentials，见条目 6/15 会话安全矩阵）。

> **[v-final 指针]** 问题 8（systemd 注入公开常量 JWT 秘密）经 L1 取证晋升 P0，为编号连续其正文仍列于下方 P1 块，但定级以 P0 处理、纳入 P0 关闭前置清单。

### P1 - MAJOR（功能缺陷与高危配置）

**ops-center 后端：**

3. **`decrypt_key` 调用参数错误被裸 except 吞掉，功能从未生效**（已核实）
   - `services/model_preset_service.py:991` 以两参数调用 `key_service.decrypt_key`（实际单参数，`key_service.py:38`），必抛 `TypeError` 后被 `:992-993` `except Exception: pass` 吞掉——"test 连通性时回退已保存密钥"从未工作。改用 `prompt_eval_service.decrypt_key(secret, value)`（两参数版本）并记录日志。**[v2]** 细则：先写复现红测试（TypeError 被吞→假回退）；except 收窄为精确异常；失败返回可区分结果 `decrypted=false, reason=...` 并记结构化 warn（不含密钥材料）；回归验证回退路径真实生效、连通性不再误报成功。 **[v3 反转]** 现场取证修正：不得改用 prompt_eval_service（其 `_fernet` 用 `Fernet(base64url(sha256(secret)))`，与加密 OfficialKey 的 `key_service._get_fernet`=`Fernet(settings.encryption_key)` 两套方案互不可解）；正确最小修复是把 :991 改回单参数 `decrypt_key(key_row.api_key)`（:964 已导入单参数版），红测试须断言"解密明文==真实 Key"并覆盖"加密密钥未配置""历史密文不可解"两路径，防 DoD 虚转绿。
4. **加密主密钥缺失时静默自生成**
   - `services/key_service.py:19-21`：`OPS_ENCRYPTION_KEY` 为空每次重启/每 worker 生成新内存密钥，历史 `OfficialKey` 密文永久不可解；`_model_to_dict:57` 解密无 try 包裹，`GET /secrets` 整表 500。改为 fail-closed 拒启，解密失败按条降级掩码。**[v2]** 细则：启动期校验 `OPS_ENCRYPTION_KEY` 非空且 Fernet 格式有效，任一 worker 失败即整进程非零退出；生产禁止自生成，开发需显式开关+启动告警；历史密文不可解按条降级掩码并记 audit，不自动清洗、不整表 500。**顺序依赖：#3 先行修复；#4 与掩码降级预案同批交付并先预发布验证，防启动阻断。**
5. **`ConfigItem` 敏感配置明文落库**
   - `models.py:30,33` + `config_service.py:64-97`：`OfficialKey` 有 Fernet 加密，但 `is_secret=1` 的 `ConfigItem.value`（含 platform_credential 分类）及审计 old/new 值明文存储，掩码仅在 API 展示层。写库前加密对齐。
6. **CORS 全开 + credentials**
   - `main.py:74-80`，触发值 `.env:4` 与 `ops-center.service:14`（`OPS_CORS_ORIGINS=*`）。生产收敛为白名单域名，启动期对危险组合告警。**[v2]** 与 15 整合为会话安全矩阵：`credentials=true` 时 `allow_origins` 禁止 `*` 且启动期直接拒绝该组合；白名单精确匹配（子域需显式列出）；15 的 Cookie 迁移必须同步变更 CORS/CSRF/CSP 并互相引用验收。
7. **`test_provider_connection` 缺 SSRF 守卫**
   - `model_preset_service.py:952-1036` 对任意 `base_url` 直接 httpx 请求且携带真实 API Key，无 https 强制/私网拦截；同文件 `fetch_models_from_url:898-918` 有完整防护。抽公共校验器复用。
8. **【定级：P0（v-final 晋升，原列 P1）】systemd 单元将密钥变量注入成公开字面量 + root 运行**（[v5] 标题按订正后机制改写，与 I1 收口一致）
   - **[v3 更正]** 机制订正：systemd `Environment=` 不做 `${}` 展开，进程收到字面量 `${PO_SECRET_KEY}` 作 JWT 秘密——是仓库可复算的确定性公开常量，`get_jwt_secret` 恰好放行，外部可伪造 admin 令牌，**应升为 P0**；修复用 `EnvironmentFile=` 注入真实随机值，并在启动校验中额外拒绝含 `${`/`$(` 的字面量。**[v5 裁定（合并 v3 更正/订正两注，删除互相抵消的旧表述，此为最终单一结论）]** `routers/env.py:82-92` 的 JWT 对齐检查对未配置场景返回 `unknown` 并带 detail 说明且 `test_env_api.py:43-58` 锁定，属跨服务诊断端点的预期行为（**非死代码**）；本进程内恒返回 `unknown` 的根因是当前部署单元未注入该变量，属部署配置问题，处置为在 orchestrator/trendscope 环境补跑或移除该端点。

**packages 引擎层：**

9. **B站采集"API 优先"分支是返回空数据的桩实现**（已核实）
   - `packages/collection-engine/src/platform-adapters/bilibili-adapter.js:81-91`：算好 `signedUrl` 后直接返回 `{ title:'', desc:'' }` 不发真实请求，却以 `success:true` 上报，静默污染下游。补真实 HTTP 请求或删除分支统一走浏览器兜底。**[v2]** 硬约束：`success` 必须绑定 title/desc 非空校验；空结果一律 `success:false, reason:'api_stub_not_implemented'`；或显式移除该分支统一浏览器兜底；补污染事件打点（platform=bilibili, mode=api_stub）防静默污染下游聚合。
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
    - 336 个 `ipcMain.handle` 约 215 个带守卫；`logs:clear`（删全部日志）、`feedback:submit`（可打包日志外发）及 aggregation/analytics/misc/platform/auto-pipeline/ops-center-sync 等无来源校验。写/破坏性/可外发 handler 统一补守卫；CI 增加"handler 必须声明 guarded 或豁免"静态检查防漂移。**[v2]** 豁免治理：豁免清单集中单文件（显式业务理由+风险等级+到期日/移除条件），豁免下限=只读/非破坏/非外发；CI 既校验 handler 声明完备，也校验豁免条目变更需审批；豁免命中记审计日志。 **[v3/v5]** 计划新建 `scripts/ipc-guard-count.js`（**待建·尚未落地**，全仓当前无此脚本）把"约 215/336"的全量正则近似口径固化为精确解析（channel+守卫），随第三批 PR 交付并挂 CI 断言阈值、注明含/排除 `.test.js`；经核验或 CI 挂载前不得宣称该守卫已生效；订正 `license-access-control.js:31` 为功能开关非 sender 守卫，不计入守卫覆盖。
15. **管理后台 JWT 存 localStorage**
    - `ops-center/frontend/src/stores/auth.js:59-60`，与问题 6 叠加放大 XSS→接管面。评估 HttpOnly+SameSite Cookie 会话，至少配套 CSP 与缩短 TTL。**[v2]** 改为可验证交付：落地 HttpOnly+SameSite=Lax Cookie 会话 + CSP 收紧 + CSRF 防护假设更新，回归登录/401/登出与会话窃取用例；与条目 6 矩阵联动复核。

### P2 - MINOR（择机偿还）

- **性能税**：`preload/index.js:48-61` `getAccessLevel` 每次受限调用 `sendSync` 同步往返（改主进程推送+事件失效缓存）；`model_preset_service.py:903` async 路由内同步 `socket.getaddrinfo` 阻塞事件循环（改 `asyncio.to_thread`）。
- **N+1 与非原子**：`routers/config.py:47-53` 审计日志逐行掩码查询；`routers/sync.py:67-71`；`batch_update`（`config_service.py:99` 每条单独 commit）改单事务。
- **脆弱等待**：`url-collector.js:412`、`videogen-stages.js:818`、`xiaohongshu.py:191`（sleep 30s）等固定 sleep 改条件等待/具名常量（桌面端已有 `_waitForFn` helper）。
- **静默空 catch**：`slideshow.ts:555` 等 4 处、`compose-ffmpeg.js:182,190`、`knowledge-base` 相关——有意降级但无线上留痕，统一补 `logger.warn/debug`。
- **定时器/资源**：`knowledge-evolution-scheduler.js:114-117` 外层 setTimeout 未入 `_timers` 清理清单（孤儿 setInterval）；`rpa-view-helpers.js:294-316` `_waitForResponse` 并发共享单句柄 `webRequest`。
- **安全小项**：`ai-writer-api/src/server.js:42` API Key 非常数时间比较（改 `timingSafeEqual`）；`audio-aligner` `audio_path` 无目录约束；`bilibili-adapter.js:76-77` query 未 `encodeURIComponent`；`webview-manager.js:419` localStorage 注入字符串拼接（当前不可逃逸但脆弱）。
- **重复上传**：`api-publish-engine/src/adapters/generic-adapter.js:26-34` `uploadVideo/uploadCover` 各自跑完整 `upload()`，同任务传两遍。
- **依赖锁定**：`ops-center/backend/requirements.txt` 全 `>=` 无上限无 hash，供应链不可复现。**[v2]** 本轮未运行 npm audit / osv-scanner / pip-audit，已知 CVE 结论缺失，登记入未覆盖维度表。
- **[v3 验收]** 脆弱等待改造须给出"条件轮询+上限+超时原因"及一个验收用例；Python 侧 `model_preset_service.py`/`prompt_eval_service.py` 引入与 lint `max-lines` 对等的最小行数门禁（新代码阻断、存量挂账）；`flutter-skill-bridge` 处置 deadline=下个发版周期末，判据输出入 CHANGELOG。
- **超大文件**：`CreateView.vue` 5589 行、`story2video-stages.js` 3725、`pipeline-engine.js` 2605、`publish-api-server.js`/`text-segmentation.ts` ~55KB、`model_preset_service.py`/`prompt_eval_service.py` 1000+ 行。
- **占位空壳**：`packages/flutter-skill-bridge` 仅剩 node_modules 无源码，确认去留。
- **枚举双份**：Story2Video `imageEffect/transition` 在 `story2video-engine/src/types.ts` 与 renderer `create-view-module-utils.js` 各写一份（当前一致，有漂移风险），抽单一来源。

### 已证伪 / 正面结论（不需处理）

- `CreateView.pollTimer` 泄漏：子代理误报，已核实 `beforeUnmount:5645` 调用 `stopPipelinePolling()`（内部 4465-4469 清 pollTimer），赋值处均有 `!this.pollTimer` 守卫或先前显式停止。
- 三模块均无硬编码密钥赋值字面量（除问题 1 的 .env.example）、无 `shell=True`/裸 `eval`、无用户可控 SQL 拼接、无 `v-html`、rpa-engine Adapter 能力清单无重复 concat、TODO/FIXME 生产代码清零、Vue 端 console.log 清零。
  - **[v2]** 证据锚点：以上来自全量正则统计（`rg "shell=True|v-html|api_key\s*=\s*["']"` 零命中或命中均在测试/白名单）、TODO/FIXME 生产目录 grep 清零、Adapter 能力 concat 断言见 `apps/desktop/electron/tests` 合同测试；属"全量检索未见"而非逐行穷尽。
- **[v2 补记] 打包许可材料门禁已存在且 fail-closed**（回应评审对许可合规维度的关注）：`AGENTS.md:476` 要求 GPL 材料缺失时 beforePack 失败关闭；实测 `apps/desktop/scripts/stage-media-tools.js:64-66` 对 FFmpeg 许可证/包装层许可证/README 缺文件即 throw，`:104-112` 字节数+SHA-256 双校验，`tests/before-pack-media-tools.test.js` 有合同测试；electron-builder 签名与 auto-updater 更新链未审（见未覆盖登记表）。

## 优化方案（v2 重排：P1 的 5/7/8 补入批次，批内标注顺序依赖）

- **第一批（安全应急，P0 全部 + P1 中的 3/4/6/7/8）**：签名私钥出库+强制轮换（1）、弱密钥闸门+启动期危险组合拒绝（2）、decrypt_key 修正（3，**须先于 4**）、加密主密钥 fail-closed+历史密文掩码降级预案（4，预发布先验，防启动阻断）、CORS 收敛入会话安全矩阵（6）、test_provider_connection SSRF 守卫（7）、systemd 单元变量/运行用户修正（8）。 **[v3]** 8 因 JWT 秘密变公开常量升为第一批内 P0 处置；轮换（1）须附双钥/宽限期过渡方案。**[v-final/v5]** 本批预算仅覆盖代码改动＋单机 pytest/打包验证；逐项工作量（各 P0 代码修复/pytest 与 systemd 部署、跨环境验证分列独立时间窗）在实施 plan 中核算，本报告不预设总体天数（删除原"约 1-2 天"口径，与 rebuttal-v3 I4 承诺对齐）；下方泄露排查清单与客户端升级阈值属问题 1/2/8 的跨环境关闭前置，单列时间线，不计入本批可交付物。回归以 `cd ops-center/backend && pytest` 门禁；交付物含启动失败应急/回滚指引。
- **第二批（功能缺陷与数据治理，P1 中的 5/9/10/11/12/13）**：ConfigItem 敏感配置写库前加密（5）、B站采集桩实现硬约束（9）、shared-utils electron 依赖治理（10）、video-clone SSRF 对齐（11）、Python 浏览器 try/finally 生命周期（12）、IDIOM_EXCLUSIONS 补登记（13，登记刘备借荆州/刘备摔阿斗/孙权称帝等俗语条目，随修复 PR 附正/负回归用例名 **[v3 订正]** 只登记真惯用语（刘备借荆州/刘备摔阿斗），"孙权称帝"是史实陈述非俗语，保留为正向朝代证据；补正向回归"纯三国文本仅出现孙权称帝仍识别三国"防守卫过扩吞真阳性（原登记条目，随修复 PR 附正/负回归用例名，跑 `story-context-engine.test.js` 全量）。
- **第三批（纵深防御与可观测性，P1 中的 14/15 + P2 静默 catch/安全小项）**：IPC sender 守卫补齐+豁免治理+CI 双校验（14）、admin 会话迁移 HttpOnly+SameSite=Lax Cookie + CSP 收紧并回归登录/401/登出用例（15，与 6 矩阵联动复核）、timingSafeEqual、路径约束等。 **[v3 订正]** 经现场取证撤回评审 I5 建议：登录限速/锁定已存在（auth_service.py 内存计数 username|IP、5 次失败锁 60s、过期清扫防内存爆破），admin 凭据缺失 fail-closed 503 亦已闭环；残余仅"失败外发告警"属 P2 增强。
- **第四批（技术债，P2 余项）**：超大文件按既有 mixin/composable 范式分批拆分（`max-lines` lint 先对新代码阻断、存量挂账）、脆弱等待条件化、N+1 与批量化、requirements 锁定+补跑依赖 CVE 扫描（npm audit/osv-scanner/pip-audit）、flutter-skill-bridge 限期处置（判据：全仓 `rg flutter-skill-bridge` 零引用即删，否则补 README 说明用途）。

## 验证方式（v2：DoD 化）

- 每批走 worktree 隔离 + TDD：先为问题 3（红测试复现 TypeError 被吞→假回退）、问题 9（空内容不得 success:true）、问题 13（俗语不误判）写复现红测试再修。
- ops-center 改动跑后端 pytest 门禁 + 前端 build 门禁；桌面端改动按 QM-1 打包验证。
- 每条 P1 的关闭条件（DoD）= 对应红测试转绿 + 批次门禁通过 + 修复说明入 CHANGELOG；条目 6/15 附加：危险组合（`*`+credentials）启动拒绝的断言测试存在且通过。
- **P0 关闭前置——泄露面排查清单（全部勾选方可关闭问题 1/2/8）**：
  - [ ] `git log -S "<PEM片段/dev-secret值>" --all` 定位全部引入提交/分支（证据：命令输出存档；责任人+完成时间登记）；
  - [ ] 所有部署机 `.env`/`EnvironmentFile` 无 dev 私钥与弱密钥残留（证据：逐机 grep 输出）；
  - [ ] **[v-final]** 逐机核对 systemd unit（`ops-center.service` 而非仅 `.env`/`EnvironmentFile`）无 `${...}` 字面量残留；`OPS_JWT_SECRET` 已替换为独立随机值并作废/轮换历史令牌；与 orchestrator 的 `PO_SECRET_KEY` 解耦已验证（证据：unit grep + 新旧令牌失效验证）；
  - [ ] CI secrets / 制品库无同密钥引用（证据：secrets 清单核对记录）；
  - [ ] 桌面端历史发行版本内置默认公钥的发放范围清单确认，验签锚切换兼容窗口评估（证据：版本清单+结论记录）；
  - [ ] **[v3]** 服务端配置双钥/宽限期过渡（并行接受新旧公钥、旧钥设到期日），存量客户端升级到安全阈值（**[v-final]** 量化为 ≥95% 活跃客户端升级，配套强制升级/离线兜底）达标记为轮换完成前置；旧默认公钥信任截至=轮换后 90 天，到期后拒绝旧钥签发；**显式声明宽限期内旧客户端仍暴露于已泄露私钥伪造配置的残余风险敞口**（证据：双钥配置 + 升级率报表 + 截至日历）；
  - [ ] 全环境密钥轮换完成并留存轮换记录，新公钥验签通过（证据：轮换记录+验签日志）。

## 假设与边界

- 本次审查为"全仓模式统计 + 高价值文件抽样深读"，未逐行通读全部约 600+ 生产文件。置信度分层（v2 量化）：IPC 守卫覆盖（约 215/336）、密钥字面量、shell=True/v-html 等结论来自**全量正则统计，高置信**；P2 超大文件（CreateView.vue 5589 行等）内部细节**未穷尽逐行**，第三/四批执行时补抽样覆盖。
- CRITICAL 两条的"已泄露"判定基于文件已入 git 历史这一事实；即使从未部署，git 历史中的 PEM 也永久公开，故按已泄露处置。
- **AGENTS.md QM-2 合同覆盖矩阵（v-final 补记，回应 I6）**——本报告结论与仓库权威安全基线逐条对照：
  | QM-2 合同 | 覆盖状态 |
  |---|---|
  | Story2Video 朝代成语守卫 | covered（问题 13）|
  | Adapter capability 单一来源 | covered（正面结论：无重复 concat）|
  | GPL 媒体二进制发布约束 / beforePack | covered（正面结论：门禁已存在且 fail-closed）|
  | 打包状态优先于开发环境变量 | covered（问题 1 修复以 `app.isPackaged===false` 为前提）|
  | Vue 模板语法 / 注释语法 | covered（build 门禁，正面结论）|
  | IPC file URL canonical 合同 | partial（问题 14 覆盖 sender 守卫，未单列 realpath 目录边界回归）→ 归第三批，触发节点=IPC 守卫补齐 PR，完成条件=补 realpath 目录边界回归用例后转 covered |
  | API Key 单 writer 锁 | out-of-scope（本轮未审 publish-api-server 锁竞争，归第四批 CI/健壮性专项）|
  | 自动更新静默合同 / entitlement 时钟偏差 / Prompt 批量内容合同 / 生产依赖闭包 / Docker runner 文件集 | out-of-scope（见未覆盖登记表触发节点）|
  说明：out-of-scope 与 partial 项均复用下方"触发节点/归属"机制登记（partial 项须在对应批次 PR 补全至 covered，P0/本批关闭前清点确认无遗留 partial），非免责声明。
- **未覆盖维度登记表（v2 补记）**——本轮明确未执行项，后续按需展开：
  - 依赖已知漏洞扫描：npm audit / osv-scanner / pip-audit 未运行（JS 与 Python 生产依赖均无 CVE 结论）；
  - electron-builder 代码签名配置与 auto-updater 更新链完整性验证未审（GPL 许可材料门禁已核实存在且 fail-closed，见正面结论）；
  - 备份/恢复与灾备流程未审；
  - CI 工作流结构完整性（步骤注入、secrets 暴露面）未逐条审。
- **触发节点/归属（v3，回应 I9）**：依赖 CVE 扫描 + CI secrets 暴露面审查 → 绑定第四批并入发版 gate；electron-builder 代码签名与 auto-updater 链 → 绑定下次发版；备份/灾备 → 绑定部署清单评审。（避免"登记即终态"。）
