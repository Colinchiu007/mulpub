# PRD：多账号 API 发布引擎（API Publish Engine）

> 版本：v1.0（2026-09-23）
> 状态：**CEO 已签字**（经 /grill-me 21 问设计树逐条拷问，用户确认「一致」并批准按质量节拍全流程执行）
> 技术基线：`01-docs/rpa-api-publish/多账号API发布技术方案-v2.md`（decision-complete，含逐字切片附录）
> 上游链路：热门选题 → 一键生成视频（改写引擎 → 故事讲述流水线）→ **本引擎（发布到多平台）**

---

## 1. 一句话需求

把桌面端发布能力从「DOM 点击式 RPA」升级为参考产品同款的「Cookie + 直连平台官方 HTTP API」发布引擎，解决 `publish btn not found`、`douyin timeout`、`kuaishou 缺作品ID` 等 DOM 路径结构性缺陷，实现 8 平台稳定、可校验、可回查的自动发布。

## 2. 目标用户与核心价值

- **用户**：多平台内容运营者（一人管理 视频号/B站/抖音/快手/小红书/百家号/头条号/知乎 账号矩阵）。
- **核心价值**：发布成功率与速度——不依赖平台前端 DOM（改版免疫）、上传进度精确（分片级）、失败原因明确（语义错误码）、全程无需人守着浏览器。
- **MVP 范围**：W1 三平台（视频号、B站视频；百家号文章）+ 双轨降级 + 签名注册表收口。全量范围 W1-W4 四波（见技术方案 §9）。

## 3. 合规红线（不可协商）

1. ⛔ 运行时零请求 `*.refpub.cn` 及任何第三方签名服务；远程签名 env 后门（`MP_SIGNER_BASE`）连根拆除。
2. ⛔ 逆向证据只存文档域（`01-docs/**/evidence/`），不进运行时代码、不进安装包 files glob。
3. 平台抽取的签名函数句柄只存内存，绝不序列化落盘/入库/入 git。
4. AI 生成内容声明字段（如快手 `ai_generated`）在新链一律保留，默认如实声明。
5. 风控信号（非 JSON 响应/验证页）→ 停该平台上报用户，**禁止**自动换号绕过。

## 4. 功能列表

### P0（W1，本期交付）

| # | 功能 | 说明 | 验收标准 |
|---|------|------|----------|
| F1 | 视频号视频 API 发布 | helper_upload_params→applyuploaddfs→8MiB 分片→complete→post 提交全链 | 契约单测全绿；活体私密档发布成功，回查作品 ID+前台链接一致 |
| F2 | B站视频 API 发布 | preupload(X-Upos-Auth)→upos 分片 PUT→/x/vu/web/add 提交，csrf=bili_jct | 同 F1；草稿档 `is_draft` 可用 |
| F3 | 百家号文章 API 发布 | 自域 token（edit 响应头 + BJH__INIT__AUTH 正则）→ uploadproxy 传图 → 文章保存/发布 | ai-writer 同题图文稿发布成功可回查 |
| F4 | 签名注册表（进程内） | `registry.sign(signCommand, payload)`；Tier A 本地实现收编；未知 command fail-closed | 单测覆盖注册/查找/失败路径；无任何网络出口 |
| F5 | 远程签名通道拆除 | 删 `MP_SIGNER_BASE`/`getRemoteSign` 及 `SIGNER_PORTS` | grep 门禁：`signer.js` 无 axios 签名外发；相关旧单测改写 |
| F6 | publishMode 双轨总闸 | `config/platforms.yaml` 三态（api-then-dom/api-only/dom-rpa），默认 api-then-dom；降级条件矩阵（技术方案 §6.3） | 路由单测：三态 × 可降级/停报/不降级全覆盖 |
| F7 | 发布频控 | 同账号两次 API 发布提交间隔 ≥18 分钟（队列调度层） | 虚拟时钟边界单测（17:59 拒 / 18:01 放） |
| F8 | 发布方式显示项 | 发布记录新增「发布方式」徽标：API 直发/网页降级/仅API失败 | UI 渲染单测 + 视觉抽查截图 |
| F9 | 风控停止交互 | risk_blocked → 平台队列挂起 + 通知（文案 §6.3）+ 人工恢复/停止按钮 | Electron 窗口手动验证：模拟假服务器返回 HTML → 通知出现、平台挂起、其他平台不受影响 |
| F10 | 契约测试基建 | 本机临时 HTTP 假服务器 + 请求序列断言器（PromptBridge 模式） | 无网络环境下 `pnpm test` 全绿；CI 无真实外发 |

### P1（W2）

| # | 功能 | 验收标准 |
|---|------|----------|
| F11 | 抖音准自包含发布链 | getSdkToken(HEAD)+本地 clientSign(SHA256+EC)+空 a_bogus 直发 `create_v2`；通过 → 活体 1 条私密发布回查；触发风控 → 回 dom-rpa 并立项评估 a_bogus 公开算法逆 |

### P2（W3/W4）

| # | 功能 | 验收标准 |
|---|------|----------|
| F12 | 签名页基建 + 快手 spike | webpack 模块抽取 + 网络拦截双验证；spike 三步（抽取/比对/活体直发）任一失败即止步，快手保持 dom-rpa |
| F13 | 小红书 API 发布 | 仅当 F12 签名基建验证通过 |
| F14 | 头条号文章 | W4 前置取证其链无外包签名，否则并入签名页契约或止步 |
| F15 | 知乎视频+文章 | 复用 zhihuPublishVideo@2119327 / publishZhihuArticle@2106013 链；W4 前置取证自包含性 |

### 明确不做（本期）

网易号/皮皮虾/多多（长尾出局）；youtube/tiktok/twitter/weibo/csdn（官方 API 另立项目）；百家号/头条号视频（参考产品无视频链参照）；VCR 录制真实平台响应的测试方案（登录态泄露面）。

## 5. 主流程（功能逻辑）

```
用户在发布队列提交任务（视频/文章 + 目标平台多选 + 可见性[默认平台私密档，无则公开]）
 → 调度器按平台拆分任务，执行 18 分钟频控闸门
 → publishMode 分流：dom-rpa 直接走老链；api* 走新链
 → 取账号 Cookie+UA（登录态持久化数据，UA 与登录会话一致）
 → [Tier-B] 签名页就绪检查（未就绪→预热/自愈，失败→signer_degraded）
 → 平台链执行：预上传 → 分片(8MiB, 进度回传) → complete → 封面 → submit(含签名字段)
 → 每步响应校验（JSON + 语义字段 + 登录失效码表 + 风控信号）
 → 成功：写发布记录{publishId, url, mode=api}，队列前进
 → 失败：按分类 → 重试(≤3) / 降级 DOM(记 mode=degraded) / 停报(risk/login)
```

### 5.1 异常流与错误处理（每平台必测）

| 异常 | 处理 | 用户提示（zh 文案，en 成对） |
|------|------|------------------------------|
| Cookie 缺失/登录失效码 | 任务终止，账号标「登录失效」，不重试不降级 | 「{平台}登录已失效，请重新登录后再发布」 |
| 非 JSON 响应（风控页） | 重试 3 次仍非 JSON → risk_blocked：该平台队列挂起 | 「{平台}风控校验拦截，本次发布已停止，请稍后在应用内手动确认账号状态」 |
| 分片上传网络失败 | 单片重试 ≤3；连续 2 片失败中止本任务 | 「{平台}视频上传失败（第 {n}/{total} 段），已自动重试仍失败」 |
| submit 返回业务错误码 | 透传平台 msg 到记录详情 | 「{平台}发布提交失败：{平台返回msg}」 |
| 签名函数抽取/求值失败 | 自愈 ≤3 次/小时；超限 → signer_degraded → DOM | 「{平台}签名服务不可用，本次已自动改用网页发布流程」 |
| 视频文件不存在 | 即刻 io_error，不发任何请求 | 「视频文件不存在：{路径}」 |
| 频控未到间隔 | 任务排队等待，进度界面显示「等待发布窗口」 | 「已按账号发布节奏策略排队（间隔≥18分钟）」 |

### 5.2 数据校验规则（引擎侧 fail-closed）

- 请求侧：签名字段非空且 ≥40 字符才允许拼入白名单参数名；分片计划 `ceil(size/8388608)` 且末片=余数；Content-Range 与文件实际字节严格一致；UA/Cookie 任一为空 → 任务直接失败（不裸发）。
- 响应侧：见技术方案 §5 表——每步语义字段断言（uploadId/fileId/bvid/coverKey/作品ID），登录失效码表命中优先于通用错误映射。
- 一致性：验收回查 = 响应体作品 ID 与平台前台页作品 ID 字符串相等 + 标题/封面一致。

## 6. 交互逻辑与显示项（UI）

### 6.1 发布对话框（既有界面扩展）

- 新增「发布方式」只读说明行：`API 直发（失败自动改用网页流程）`，hover 显示三态解释。
- 新增「可见性」下拉：公开 / 私密（仅自己可见）/ 草稿（平台支持哪项显示哪项，不支持的选项隐藏并在 tooltip 说明）。

### 6.2 发布记录页（既有界面扩展）

- 新列「发布方式」徽标三态：`API 直发`（primary）/ `网页降级`（warning，tooltip 附降级原因码）/ `仅API失败`（danger）。
- 详情抽屉新增：分片进度历史（n/total）、平台返回原始 JSON（折叠）、签名字段是否本地计算（Tier A）或签名页（Tier-B）。

### 6.3 通知中心

- risk_blocked 挂起通知带两个动作按钮：`恢复发布`（重载该账号登录态后重试）/ `停止本批`。
- 文案见 §5.1 表，全部走 locales（键前缀 `publish.api.*`、`signer.*`），**zh/en 成对提交**（CI Gate 7）。

### 6.4 账号管理页

- 每账号卡片登录态行追加「签名服务」状态点（仅 Tier-B 平台）：就绪(绿)/抽取中(黄)/自愈中(黄闪)/不可用(灰)；点击跳日志过滤视图。

## 7. 非功能需求

- **安全**：Cookie 仅存 shared-user-data（现状不变）；日志脱敏复用 `log-redact.js`，签名 payload 片段级脱敏（不落完整 body）；签名页禁导航逃逸、renderer 无求值通道。
- **性能**：分片链单任务内存峰值 ≤2×8MiB Buffer；UploadEmitGate 节流（>100MB 每 5s）。
- **可靠**：所有关键路径错误处理；重试幂等（同 uploadId 内重试，不重复申请上传）。
- **可观测**：发布事件结构化日志 `{platform, mode, step, code, durMs, degraded}`；验收统计 = API 直发成功率。
- **兼容**：DOM RPA 老链零删除（W1-W4 期间双轨共存）；按 §6.4 退役标准逐步收编。
- **测试**：契约单测全离线可跑（CI 无网络依赖）；活体验收不进 CI。
- **版本/打包**：涉及 `packages/rpa-engine`? 否——仅 api-publish-engine + electron 服务层薄接线；若触 electron/ 则执行 QM-1 打包验证三件套。

## 8. 交付与验收流程（每波）

1. `scripts/session-init.sh api-publish-w<N>` 建独立 worktree（D 盘，`codex/api-publish-w<N>` 分支）。
2. TDD：先契约红测 → 实现 → 全绿 → `.quality-gates.md` 自检 → 质量节拍门禁。
3. PR → CI（locale 成对/品牌 grep 门禁/单测）→ autoMerge squash。
4. 活体验收：真实内容真实标题、间隔 ≥18 分钟、私密优先回查；证据 `{平台, 作品ID, 前台链接, 回查截图, degraded?}` 落 `01-docs/rpa-api-publish/evidence/api-w<N>-<platform>/` 随证据 PR 进仓（`git add -f`）。
5. 证据回写本 PRD 验收节 + 技术方案修订记录；缺一个平台不关波。
6. 有价值经验按规范入内置记忆 + EverOS。

## 9. 里程碑

| 里程碑 | 内容 | 判据 |
|--------|------|------|
| M0（已达成） | 逆向取证 + 21 问设计锁定 + 技术方案 v2 | 本文档 §1-§8 齐备 |
| M1 | W1 上线：F1-F10 全绿 + 3 平台活体证据 | §8 流程走完 |
| M2 | W2 抖音裁决：通过或回退（二选一，有记录） | F11 判据 |
| M3 | W3 spike 裁决（止损阀） | F12 三步判据 |
| M4 | W4 长尾 + DOM 退役评估开始 | F14/F15 + §6.4 |

## 10. 风险登记

| 风险 | 等级 | 缓解 |
|------|------|------|
| 平台 API 改版使参考产品链失效 | 高 | 契约测试红→修复循环；双轨 DOM 保底；W1 证据链可回源比对 |
| 活体发布触发账号风控 | 中 | 18 分钟频控 + 私密优先 + 风控即停不换号（用户决策 Q8） |
| 快手 sig3 抽取不可行 | 中 | spike 止损阀（Q19），失败面已封闭：留 DOM |
| 参考产品 bundle 被清理（曾发生） | 低 | 逐字切片已入本仓 evidence（120KB），文档域持久化 |
| 中文文案进 locales 遗漏 en | 低 | Gate 7 CI 硬拦截 |

---

## 11. W1 地基实现契约（§2/§3/§5 已交付，随 PR#2307）

> 本节是「实现即文档」的收口：地基三段（签名注册表、发布核心基座、频控+双轨路由）
> 已合入 `packages/api-publish-engine`，逐模块给出契约、数据校验、错误/提示语义。
> §4 三平台链、§6 UI 接线、§7 活体验收在此基座之上继续。

### 11.1 进程内签名注册表（src/signer/*）——合规红线落地

**功能逻辑**：所有平台签名经唯一入口 `registry.sign(signCommand, payload)` 求值；
运行时**不存在任何远程签名通道**。签名句柄/密钥只存内存，不落盘、不进安装包。

**模块契约**：
- `src/signer/registry.js` → `createRegistry()`：`register(signCommand, implFn)` /
  `sign(signCommand, payload)` / `has` / `list` / `unregister`。
- `src/signer/index.js`：默认注册表，收编 Tier-A 本地算法：
  `kuaishou.ns-sig3`、`douyin.browser-params`、`xiaohongshu.x-s`、`csdn.hmac-sha256`、
  `shipinhao.content-md5`（`base64(MD5(buffer))`）。
- `src/signer.js` 门面：`getDouyinSignature(url, ua)` / `getKuaishouSignature(path, body, cookie)`
  向后兼容（douyin/kuaishou/xiaohongshu 三调用点零改动）。

**数据校验（fail-closed）**：
- `signCommand` 必须为非空字符串，否则 `register` 抛错；
- 未注册 `signCommand` 调 `sign` → 抛 `unknown signCommand "..." (fail-closed, refusing to publish)`，
  **绝不回退远程、绝不返回伪签名**；
- 空 buffer → `shipinhao.content-md5` 抛错；
- 远程通道拆除清单（源码 grep 零残留 + 门面注释不含被禁 token 字面量）。

**提示文字（内部错误 message，经上层映射到 UI）**：
- 未注册命令：`签名命令未注册：<cmd>（已拒绝发布）`
- 快手缺 `api_ph`：返回空签名（由 §5.2「签名字段非空」上层校验拦截）。

### 11.2 发布核心基座（src/publish/core/*）

**`http-base.js`（$http 等价物）**
- `createHttpClient({baseURL,timeout,headers,agents:{httpAgent,httpsAgent},validateStatus})`：
  默认 `timeout=60000ms`、`validateStatus=2xx`；代理 agent 透传（深合并，按值断言）。
- `requestWithRetry(client, reqCfg, {maxAttempts=3, retryDelayMs=1000, isJson})`：
  **风控重试条件 = 响应非 JSON**（平台返回 HTML 风控页 → 重试），总尝试 ≤3；
  HTTP 状态码错误/网络异常**不属于**该重试条件，直接抛出保留原始语义；
  耗尽抛 `PublishHttpError(code=data_error|request_error)`（对齐 `error-codes.js`）。
- 提示文字：风控 `risk-control response (non-JSON) at <method> <url>`；请求失败 `request failed: <msg>`。

**`chunker.js`（FileChunker 等价物）**
- `chunkTotal(totalBytes, {chunkSize=8388608})` → `[{index,start,end,size,contentRange}]`；
  `contentRange = "bytes <start>-<end>/<total>"`（闭区间，HTTP 规范形态）。
- 数据校验：`totalBytes<=0` 或非有限 → 抛错；`chunkSize` 非正整数 → 抛错；
  三边界（整除/非整除/小于单片）逐一单测。

**`emit-gate.js`（UploadEmitGate 等价物）**
- `createEmitGate({totalBytes, onProgress, clock, intervalMs=5000})`：
  `<100MB` 每 10% 里程碑去重上报（同档/重复/回退吞掉）；`>=100MB` 每 `intervalMs` 时间节流；
  `report(bytes)` 越界裁剪到 `[0,total]`；`done()` 幂等补发 100%。
- 数据校验：`totalBytes<=0` 抛错。进度百分比即 §6.2 分片进度历史数据源。

**`test/helpers/fake-http.js`（契约测试基建）**
- `startFakeServer(routes)` 绑 `127.0.0.1:0`，逐字记录 `method/url/headers/body/rawBody`；
  路由支持 `times` 消费计数（可编程重试序列）；二进制分片原样保留。
- **不变量**：所有契约测试仅打本机假服务器（配合远程通道拆除 = 测试禁外发双保险，CI 无网络依赖）。

### 11.3 频控闸门 + 双轨路由决策核

**`publish-spacer.js`（§5.3 频控，用户决策 Q8）**
- `createPublishSpacer({minIntervalMs=18*60*1000, clock})`：同 `(platform, accountId)`
  两次发布提交须间隔 ≥18 分钟；`allow/record/tryAcquire/reset`；不同账号相互独立。
- 数据校验：缺 `platform` 或 `accountId` → 抛错（fail-closed）。
- 显示/提示：不足间隔返回 `{allow:false, waitMs}`，UI 据此提示「距上次发布不足 18 分钟，请 <waitMs> 后重试」。
- 进程内台账不持久化；重启后保守放行首条（由总闸兜底）。

**`publish-mode.js`（§5.1/§5.2 三态总闸决策矩阵）**
- `normalizeMode(mode)`：空/未定义 → 默认 `api-then-dom`；非法值抛错。
- `decideRoute({mode, outcome})` → `{route: api|dom|stop, degrade, reasonCode}`。
- **降级矩阵（合规红线：风控/登录失效不降级、不换号）**：

| publishMode \ outcome | success | risk_blocked | login_expired | transient_error | unsupported |
|---|---|---|---|---|---|
| `api-only` | api | **stop** | **stop** | stop | stop |
| `api-then-dom` | api | **stop** | **stop** | dom(degrade) | dom(degrade) |
| `dom-only` | 初始即 dom，不进 api | — | — | — | — |

- `reasonCode`：`ok / mode_dom_only / mode_unsupported_fallback / transient_error_fallback /
  risk_blocked_stop / login_expired_stop / api_failed_stop` → 结构化日志 `degraded+reasonCode`。
- **交互逻辑**：DOM 执行包装层 `publishWithMode()` 随 §4 三平台链就绪落地（消费本决策核输出）。

### 11.4 测试与门禁矩阵（地基，已全绿）

| 模块 | 测试文件 | 组 | 用例数 | 关键断言 |
|---|---|---|---|---|
| signer registry | signer-registry.test.js | direct | 10 | 未知命令 fail-closed、句柄不落盘 |
| signer 门面 | signer.test.js | vitest | 6 | 远程通道拆除、MP_SIGNER_BASE 被忽略 |
| http-base | http-base.test.js | vitest | 6 | !isJson 重试≤3、代理透传、状态码不重试 |
| chunker/emit-gate | publish-core.test.js | vitest | 11 | 三边界、里程碑、时间节流 |
| spacer/mode | publish-governance.test.js | vitest | 15 | 17:59拒/18:00放/18:01放、降级全矩阵 |

回归：`node scripts/run-tests.js` 全绿；Gate 12 品牌残留 PASS；文档同步门禁由本节满足。


---

## 12. W1 平台发布链实现契约（§4，逐平台落地）

> 本节记录 `src/publish/platforms/*` 新链的逐字请求契约、数据校验、降级/提示文案，
> 随各平台切片增量补录。链一律委托 §11.2 的 `publish/core` 基座（`createHttpClient` +
> `requestWithRetry`），**不直连平台外的任何第三方服务**，测试仅打本机假 HTTP 服务器。

### 12.1 百家号图文（文章）链 `src/publish/platforms/baijiahao-article.js` ✅

决策账约束：**百家号只发文章**（不发视频）。本链为 W1 百家号唯一交付链，私有类
`BaijiahaoArticleChain`，外部调用方通过 `run(taskData, {draft})` 触发。

**请求序列（4 步，逐字对齐参考产品逆向证据 `evidence/yx-bjh-check.txt`）**：

| 步 | 方法/路径 | 关键请求头 | 提取/返回 | 失败语义 |
|----|-----------|-----------|-----------|----------|
| 1 baseToken | `GET /?source=inner` | `Cookie`, `host` | 正则 `BJH__INIT__AUTH__\s*=\s*['"]([^'"]+)` → `baseToken` | 未命中=登录失效（`data_error`） |
| 2 publishToken | `GET /pcui/article/edit?type=news` | `Cookie`, `referer`, `token=baseToken` | 响应头 `token` → `publishToken` | 缺响应头=登录失效 |
| 3 uploadImage | `POST /pcui/picture/uploadproxy` | `Cookie`, `multipart/form-data` | 图片 URL | `errno!=0` 抛 `data_error` |
| 4 submit | 私密优先：`POST /pcui/article/save?callback=bjhdraft`；正式：`POST /pcui/article/publish?type=news&callback=bjhpublish` | `Cookie`, `x-www-form-urlencoded`, `token=publishToken` | `{errno,ret.id}` | errno=10000015 风控；其他 errno 透传 errmsg |

**数据校验（引擎侧 fail-closed，发起任何请求前）**：
- 缺 `cookie` → 抛 `BaijiahaoArticleError`（`data_error`），**零请求**。
- 缺 `userAgent` → 抛 `BaijiahaoArticleError`（`request_error`），**零请求**。
- `taskData.title` 为空 → 抛 `BaijiahaoArticleError`（`data_error`）。
- `baseToken` 正则未命中 → 抛错且**绝不触达写端点**（save/publish 零请求）。
- 标题按 UTF-8 字节安全截断到 **149 字节**（`truncateTitle`，不切多字节字符，50 中文→49 中文/147 字节）。

**表单字段（`buildArticleFormData`，x-www-form-urlencoded）**：`title`(截断)、`content`、
`category`(默认「未分类」)、`reward_money=0`、`is_pay_column=0`、`type=news`、可选
`project_cover`、原创声明 `original=1`。

**私密优先（决策账验收口径）**：`opts.draft !== false` 时默认走 `save?callback=bjhdraft`
草稿端点；显式 `draft:false` 才走 `publish`。验收首发一律私密草稿、人工确认后再正式。

**风控停止（对齐 §11.3 双轨不降级）**：`errno=10000015` 时返回
`{success:false, code:10000015, error}`，提示文案：
> 「百家号风控拦截：<errmsg>（<hit_rule>），请先在浏览器中登录百家号完成验证」

其他非零 errno 透传原 `errmsg`，不吞原始错误。风控即停，不换号、不降级 DOM。

**§4.5 零请求单测（`test/baijiahao-article-chain.test.js`，8 例全绿）**：请求序列逐字断言、
token 逐级传递（edit 带 baseToken / save 带 publishToken）、headers 白名单（UA/Cookie 透传、
全部落在本机假服务器）、缺 cookie/UA/ baseToken 提取失败三态零请求、风控文案、标题截断。

**UI 显示项 / 提示文案**：见 §6；「发布方式」徽标三态中百家号 W1 仅 `api`/`dom` 可达，
失败详情展示 `error` 全文（含验证指引）。i18n key：`publish.api.baijiahao.risk`、
`publish.api.baijiahao.login_expired`、`publish.api.baijiahao.missing_cookie`。

**实现状态**：§4.3 ✅、§4.5（百家号维度）✅。§4.4（旧 `adapters/baijiahao.js` 视频链
变薄委托本文章链、外部接口不变）待后续切片；B站 §4.2 链待后续切片（视频号 §4.1 见 §12.2）。


### 12.2 视频号（微信 channels）视频链 `src/publish/platforms/shipinhao-video.js` ✅

`ShipinhaoVideoChain`，注入两个 axios 客户端：`api`（`channels.weixin.qq.com`）与
`cdn`（`finderassistancea.video.qq.com`），均走 §11.2 `createHttpClient` + `requestWithRetry`；
测试时二者同指本机假服务器，杜绝外发。

**请求序列（5 步，逐字对齐证据 `evidence/yx-slices-v2.txt`）**：

| 步 | 方法/路径 | 客户端 | 关键头 | 提取/返回 |
|----|-----------|--------|--------|-----------|
| 1 authKey | `POST /cgi-bin/mmfinderassistant-bin/helper/helper_upload_params` | api | `cookie`,`referer` | body `{timestamp,_log_finder_id,rawKeyBuff:null}` → `authKey` |
| 2 applyuploaddfs | `PUT /applyuploaddfs` | cdn | `X-Arguments(scene=2)`,`Authorization=authKey`,`Content-MD5:"null"` | `{BlockSum,BlockPartLength[]}` → `UploadID` |
| 3 uploadpartdfs(×N) | `PUT /uploadpartdfs?PartNumber&UploadID` | cdn | `Content-MD5=md5(chunk)`,`X-Arguments(scene=0)`,`Authorization`,`Content-Type:application/octet-stream` | 二进制分片 → `ETag` |
| 4 completepartuploaddfs | `POST /completepartuploaddfs?UploadID` | cdn | `X-Arguments(scene=2)`,`Authorization` | `{TransFlag:"0_0",PartInfo:[{PartNumber,ETag}]}` → 视频 url |
| 5 publish | `POST /cgi-bin/mmfinderassistant-bin/post/post_{create\|draft}` | api | `referer`,`cookie`,`Content-type:application/json` | postData(JSON) → `{errCode,data.postId}` |

**分片器（复用 §11.2 chunker）**：片长 **8388608**（8MiB）；`BlockSum=ceil(size/8MiB)`，
`BlockPartLength` 为各片实际字节数组（末片为余数）；`PartNumber` 从 **1** 递增；
每片 `Content-MD5` 为该片字节的 md5(hex)。`X-Arguments` 固定 `apptype=251`，含
`filetype/weixinnum/filekey(URL 编码)/filesize/taskid/scene`。

**数据校验（fail-closed，发首请求前）**：
- 缺 `cookie` → 抛 `ShipinhaoVideoError`（`data_error`），**零请求**。
- 缺 `userAgent` → 抛（`request_error`），零请求。
- 视频文件不存在 → 抛（`io_error`），**零请求**（`fs.existsSync` 前置）。
- `authKey` 缺失（响应无字段）→ 抛且**绝不触达任何 CDN 写请求**。

**私密优先**：`opts.draft !== false` → `post_draft`；`draft:false` → `post_create`。
`errCode!=0` 返回 `{success:false,code,errMsg}`；风控/登录失效停报，不换号、不降级 DOM。

**§4.5 零请求/契约单测（`test/shipinhao-video-chain.test.js`，7 例全绿）**：五步序列逐字、
`BlockSum`/`BlockPartLength` 与 8MiB 边界（1MB→1 片、8MiB+100→2 片 `[8388608,100]`）、
`Content-MD5`/`X-Arguments(scene)`/`Authorization` 头、分片字节完整性、PartInfo ETag、
`post_draft`/`post_create` 路由、三态零请求、`buildXArguments` 纯函数。

**UI 显示项 / i18n**：「发布方式」徽标 `api`；分片历史展示 `PartNumber`/`ETag`；失败详情
展示 `error`。key：`publish.api.shipinhao.risk`、`publish.api.shipinhao.file_missing`、
`publish.api.shipinhao.progress`（`视频上传中 {done}/{total}`）。

**实现状态**：§4.1 ✅、§4.5（视频号维度）✅。§4.4（旧 `adapters/shipinhao.js` 变薄委托本链）
待后续切片；B站 §4.2 链 ✅（见 §12.3）。


### 12.3 B站（bilibili）视频链 `src/publish/platforms/bilibili-video.js` ✅

`BilibiliVideoChain`，复刻自参考产品逆向 + 本地活体校验（真实发布 `bvid=BV1MahW6tE36`），
改走 §11.2 `publish/core`（`createHttpClient` + `requestWithRetry` + `chunkTotal`）以获得
「非 JSON 响应（风控 HTML）自动重试 ≤3」能力。注入两个 axios 客户端：`api`
（`member.bilibili.com`）与 `cdn`（运行时按 `endpoint`/`upos_uri` 解析出的 upos host）；
测试时二者同指本机假服务器（upos 落点走相对 `objectPath`），杜绝外发。

**请求序列（6 步，逐字对齐证据 `evidence/yx-slices-v2.txt` L24-45）**：

| 步 | 方法/路径 | 客户端 | 关键头/参 | 提取/返回 |
|----|-----------|--------|-----------|-----------|
| 1 probe | `GET /preupload?r=probe` | api | `cookie`,`referer`,`accept:json` | → `lines[]`（上传线路候选） |
| 2 args(×线路) | `GET /preupload?<line.query>&r&name&size&profile=ugcupos/bup&ssl=0&version=2.7.1&build=2070100` | api | 同上 | → `{auth, endpoint, upos_uri, biz_id}`；命中 `code:601` 抛风控 |
| 3 init | `POST {objectPath}?uploads=&output=json` | cdn | `X-Upos-Auth=args.auth`,`referer` | → `upload_id`（缺失抛错） |
| 4 uploadpart(×N) | `PUT {objectPath}?partNumber&uploadId&chunk&chunks&size&start&end&total` | cdn | `X-Upos-Auth`,`Content-Type:application/octet-stream` | 二进制分片，`status>204` 抛错；读 `etag` 响应头去引号 |
| 5 complete | `POST {objectPath}?output=json&name&profile&uploadId&biz_id` | cdn | `X-Upos-Auth`,`Content-Type:application/json` | `{parts:[{partNumber,eTag}]}` → `location` |
| 6 publish | `POST /x/vu/web/add/v3?t&csrf`（私密 `/x/vupre/web/draft/add`） | api | `cookie`,`Content-Type:json;charset=UTF-8` | postData+`csrf` → `{code,data.bvid,data.aid}` |

**upos 目标解析（`buildUposTarget` 纯函数）**：`upos_uri` 新式 `upos://bucket/object` +
`endpoint` `//host` → `{host, objectPath:'/bucket/object'}`；兼容 `//host/bucket/object`
（取首段为 host）、绝对路径 `/…`（配 endpoint）、裸 `bucket/object`。投稿体
`videos[].filename` = `location` 去扩展名、去 bucket 段（`split('.')[0].split('/').slice(1)`，
复刻 bundle `P.split('.')[0].split('/')[1]`）。

**分片器（复用 §11.2 chunker）**：片长 **8388608**（8MiB）；`chunkTotal(size)` →
`parts[{index,start,end,size}]`，`partNumber = index+1` 从 **1** 递增，`chunk = index`，
末片为余数字节；`Content-MD5` 不参与（B站走 `etag` 响应头 + `X-Upos-Auth` 鉴权）。

**数据校验（fail-closed，发首请求前）**：
- 缺 `cookie` → 抛 `BilibiliVideoError`（`data_error`），**零请求**。
- 缺 `userAgent` → 抛（`request_error`），零请求。
- 缺 `taskData.video.path` → 抛（`data_error`），零请求。
- 视频文件不存在 → 抛（`io_error`），**零请求**（`fs.existsSync` 前置）。
- probe 返回 `lines:[]`（无可用线路）→ 抛「获取上传参数失败」且**绝不触达任何 upos/写请求**（仅 `GET /preupload`）。

** csrf 与登录态（Tier-A 本地自 cookie）**：`csrf = pickCookieValue(cookie,'bili_jct')`，
同时进 `query.csrf` 与 `body.csrf`；`DedeUserID` 用于文件名 `${mid}_${ts}_${ts.slice(9,12)}`。
`code:-1025/-1026` → `{success:false,cookieExpired:true}`（登录态失效，停报，不重登、不换号）。

**私密优先**：`opts.draft !== false` → `/x/vupre/web/draft/add`；`draft:false` →
`/x/vu/web/add/v3`。`code:601` → `{success:false,code:601,error:'B站风控(601)…滑块验证'}`；
其余非 0 → `{success:false,code,error}`。风控/登录失效一律停报，不降级 DOM。

**内容纯净**：`buildPostData` 的 `_cleanText` 去除标题/简介中括号包裹的「自动发布/一键发布
工具/由多平台」boilerplate 及残留换行（用户硬要求）。默认分区 `tid=21`（日常·综合），
`copyright:1`（原创）、`no_reprint:1`、`cover` 留空由 B站自动截帧。

**§4.5 零请求/契约单测（`test/bilibili-video-chain.test.js`，7 例全绿）**：私密优先六步序列
逐字（`methodPathList` = `GET /preupload`×2 → `POST/PUT/POST {OBJ}` → `POST /x/vupre/web/draft/add`）、
`X-Upos-Auth=args.auth`（init/分片均带）、分片二进制字节完整性（1MB→1 片）、`parts=[{partNumber:1,eTag:"PART_ETAG"}]`
去引号、多分片（8MiB+100→2 片，`partNumber` 1/2 递增、`chunks=2`、末片 100 字节）、
`csrf` 进 query+body、`videos[0].filename='n123'`（去 bucket/去扩展名）、`cid=biz_id=42`、
正式发布走 `/x/vu/web/add/v3` 不触达 draft、三态 fail-closed 零请求、`buildUposTarget`/`pickCookieValue` 纯函数。

**UI 显示项 / i18n**：「发布方式」徽标 `api`；投稿进度展示 `视频上传中 {percent}%`；
失败详情展示 `error`（风控 601 / 登录失效区分文案）。key：`publish.api.bilibili.risk`、
`publish.api.bilibili.cookie_expired`、`publish.api.bilibili.args_fail`、
`publish.api.bilibili.file_missing`、`publish.api.bilibili.progress`。

**实现状态**：§4.2 ✅、§4.5（B站维度）✅。§4.4（旧 `adapters/bilibili.js` 变薄委托本链）
待后续切片。



### 12.4 Adapters 变薄委托新链（§4.4）🚧（B站+视频号 ✅，百家号待专轮）

**目标**：三平台旧适配器（`src/adapters/{bilibili,shipinhao,baijiahao}.js`）改为**变薄委托**
`src/publish/platforms/*` 新链，使 HTTP/upos 传输逻辑**单一事实源**落在链层；适配器**外部接口
保持不变**（`constructor(name)`、`getReferer/getOrigin`、`uploadVideo/uploadCover/buildPostData/
publish`、继承自 `base-adapter` 的 `execute`、`listCollections`），调用方零改动。

**委托契约**：
- 适配器各方法内部 `new XxxChain({ cookie, userAgent })` 后转发；`execute` 仍走 `base-adapter`
  （保留 `formatContent`、进度事件、错误码映射、失败日志、`catch` 归一化）。
- **关键约束**：新链用**相对 URL** + 自带 `baseURL` 的 `createHttpClient` 客户端；故适配器
  **不得把 `this.http` 注入链的 `api`**（`this.http` 无 baseURL、且 `requestWithRetry` 依赖
  `client.request`，注入会破坏 URL 解析与重试）。链自建正确 baseURL 的客户端。
- `_chain(cookie, clients)` 提供注入缝（`_chainOverride`/clients），供结构测试断言转发。

**B站 ✅（本轮）**：`bilibili.js` 153→76 行（净 −58）：
- `uploadVideo` → `chain.getUploadArgs(fileName,size)` + `chain.uploadVideo(path,fileName,args)`，
  返回 `{objBase,bizId,size}` 与原形状一致；保留 `cancelToken` 前置检查与「空上传返回 null」契约
  （无视频路径 → null，不抛）。
- `buildPostData`/`_buildBase` 委托链的**模块级纯函数** `buildBilibiliPostData`/`buildUposTarget`
  （去重，不再各自实现）；`cleanBilibiliText` 去「自动发布」水印逻辑同源于链。
- `publish(cookie,postData)` → `chain.publish(postData,{draft:false})`：适配器对外**固定正式发布**
  （`/x/vu/web/add/v3`），与旧行为一致；**私密草稿**由 §5 `publishWithMode` 服务层经链 `draft` 选项驱动。
- **测试迁移**：`bilibili-upos.test.js` 由「`this.http` 桩验发布」改为「`_chainOverride` 断言委托转发
  （opts.draft===false、postData 透传）」；真实发布网络语义由 `bilibili-video-chain.test.js`
  假服务器覆盖（**更强**：钉完整请求序列/头/体）。结构测试 `bilibili-upos` 7 例 + 链测 7 例全绿；
  全量回归 **135 测 EXIT=0**（§4.4 视频号委托 +8 例后）。

**视频号 ✅（本轮）**：`shipinhao.js` 由 20 行 placeholder（走 `upload/orchestrator` 另一传输路径）改写为
66 行**变薄委托 `ShipinhaoVideoChain`**，HTTP/CDN 分片传输单一事实源归 `publish/platforms/shipinhao-video.js`：
- **外部接口零改动**：`constructor` 仍 `super("tencent_video")`（`adapters-interface` 契约钉死 name）、
  `getReferer`（`.../platform/post/create`）/`getOrigin`（`https://channels.weixin.qq.com`）/`getHeaders` 保留；
  `execute` 仍走 `base-adapter`（`formatContent`、进度事件、错误码映射、失败日志、`catch` 归一化全继承）。
- **`_chain(cookie, clients, ids)` 注入缝**：默认 `new ShipinhaoVideoChain({cookie, userAgent, apiBase, finderId, finderUin})`，
  测试可 `_chainOverride`。`ids` 透传 `_log_finder_id`/`weixinnum`（finderUin 缺省回退 finderId）。
- **`uploadVideo(td,cookie,cancelToken)`**：`td`/视频路径为空 → 返 `null`（空上传零请求契约，不抛）；
  文件不存在 → 抛 `SPH_NO_FILE`（fail-closed 零请求）；否则 `getUploadAuthKey` → `uploadVideo(path, meta)`
  （meta=`{authKey, filetype(mp4 缺省), filekey, taskid}`，链内 applyuploaddfs→逐片 uploadpartdfs(8MiB, Content-MD5)→
  completepartuploaddfs），返回 `{uploadId, videoInfo}`（`execute` 包装为 `{video: 此返回}`）；`cancelToken` 起止各检一次。
- **`uploadCover` → `null`**：视频号封面由视频抽帧，无独立封面上传链。
- **`buildPostData(td,uploadResult)`** → 链**模块级纯函数** `buildShipinhaoPostData(td, uploadResult.video, ids)`
  （去重，链 `run()` 复用同函数）：`description`=`content ?? title`、`media.videoId`=`uploadId`、
  `media.url`=`videoInfo.url || videoInfo.data.url`、`media.{width,height,duration}` 取自 `td.video`、
  `scene=7`/`reqScene=7`、`rawKeyBuff=null`、`location=null`、`timestamp`=13 位毫秒。
- **`publish(cookie,postData)`** → `chain.publish(postData,{draft:false})`：适配器对外**固定正式发布**
  （`post_create`），与旧行为一致；链返回 platform=shipinhao 映射回外部名 tencent_video 保持对外契约；
  **私密草稿**由 §5 `publishWithMode` 服务层经链 `draft` 选项驱动。
- **关键约束**：同 B站——适配器**不得把 `this.http` 注入链 `api`**（`this.http` 无 baseURL 破坏相对 URL 解析、
  且 `requestWithRetry` 依赖 `client.request`）；链自建 baseURL 的 api/cdn 客户端。
- **测试**：新增 `shipinhao-adapter.test.js`（8 例：name/referer/origin 契约、`_chain` 构造透传、
  `buildPostData` 字段与回退、`publish` 委托 `{draft:false}` 且 platform 映射、空上传返 null、
  `SPH_NO_FILE` fail-closed、`uploadCover` null）；真实发布网络语义由 `shipinhao-video-chain.test.js`
  假服务器覆盖（7 例，钉 5 步请求序列/头/体）。`upload/orchestrator` 系 8+ 适配器共享模块，**不改动**，仅 re-point 本适配器。

**百家号 ⚠️（行为决策，非纯委托）**：旧 `baijiahao.js` 是**视频**适配器（455 行，`e2e-publish-full-chain`
以 `this.http` 桩钉死其视频全链）；§4.3 新链是**文章**链 `BaijiahaoArticleChain`（Q14：百家号只发文章）。
二者非 1:1，re-point 属**外部行为变更**（视频→文章），需专轮与 §5 服务层/`platforms.yaml` 一并处理，
不在「变薄委托」等价重构范围内。

**AI 声明字段平移（§4.4 硬要求）**：`aigc_bjh_status`（百家号：`aiGenerated!==false → is_checked=1`，
显式人工 `false → 0`）现存于 `baijiahao.js buildVideoPostData`；快手为 `ai_generated`。跨平台默认须
**声明「AI 生成」一致**（e2e 钉 `activity_list[0][id]=aigc_bjh_status&...[is_checked]=1` 与
`ks.ai_generated===1`）。各链完成委托时**必须把该声明字段带入新链 `buildPostData`**：百家号文章链
`BaijiahaoArticleChain` 的投稿体需补 `aiGenerated`→声明字段映射（随百家号 re-point 切片交付）；
视频号/B站链按其平台字段（B站无 AI 声明字段，维持现状）对齐。

**取消语义记录（待办）**：委托后 B站分片级 `cancelToken` 逐片检查由链承接前，粒度略降（仅保留上传
起止检查）；分片级取消统一由 §5/§7 落地。



---

### 12.5 双轨发布服务层执行包装 `publishWithMode`（§5.2）✅

**目标**：把 §5.1 决策核（`publish/core/publish-mode.js` 的 `decideRoute` 纯函数）与「实际执行」
缝合成可直接调用的服务层执行包装 `src/publish/core/publish-mode-runner.js`，落地 PRD F2「双轨降级」
总闸与决策账「风控即停不换号、不因换号绕风控」。与旧 `api-router.publishWithFallback` 的区别：
后者非模式驱动、风控也会回落 DOM；本包装严格按三态总闸决策，是 §5 服务层的**事实路由**。

**API**：`createPublishWithMode(deps) -> async publishWithMode(platform, taskData, cookie, opts)`
- `deps`（全注入、便于零外发单测）：`apiPublish(platform,taskData,cookie,opts)->Promise<result>`、
  `domPublish(...)`（可缺）、`getMode(platform)->mode`（读 `platforms.yaml.publishMode`，可缺→默认 api-then-dom）、
  `spacer`（§5.3 `createPublishSpacer` 实例，可缺）、`logger`（默认 `src/logger`）、`outcomeOf`（结果归一覆写，测试用）。
- `opts`：`{accountId, mode(覆盖 getMode), onProgress, ...}`；`accountId` 缺省从 cookie 前 16 字符派生。
- 返回归一结果：`{platform, mode, track:api|dom|throttled, degraded, reasonCode, success, publishId?, error?, code?, stopped?, requiresDom?, waitMs?, apiAttempt?, domAttempt?}`。

**流程（编排顺序 = 数据/风控校验顺序）**：
1. `mode = normalizeMode(opts.mode ?? getMode(platform))`（非法模式抛错，fail-closed）。
2. `entry = decideRoute({mode})`：`dom-only` → 直接进入第 5 步 DOM 轨；否则进入 API 轨。
3. **spacer 闸门**（§5.3，同 (platform,accountId) 间隔 ≥18min）：`spacer.tryAcquire` 不放行 →
   立即返 `{track:throttled, success:false, reasonCode:throttled, waitMs}`，**零请求**（不发 API/DOM）。
   `logger.warn` 结构化记 `{platform, mode, accountId, reasonCode:throttled, waitMs}`。
4. **API 轨**：跑 `apiPublish`（异常归一为 `{success:false,error,code}`）→ `outcomeOf(res)` 映射
   `success|risk_blocked|login_expired|unsupported|transient_error` → `decideRoute({mode,outcome})`：
   - `success` → 留 API，`{track:api, success:true, reasonCode:ok, publishId, apiAttempt}`（`logger.info`）。
   - `risk_blocked` / `login_expired` → **停报**，`{track:api, success:false, stopped:true, degraded:false, reasonCode:risk_blocked_stop|login_expired_stop}`，**绝不降级、绝不换号**（`logger.error`，合规红线）。
   - `transient_error` / `unsupported` 且 `mode=api-then-dom` → 降级 DOM（第 5 步）；`mode=api-only` → 停报（`api_failed_stop`）。
5. **DOM 轨**（dom-only 入口 或 api-then-dom 降级）：无 `domPublish` → `{requiresDom:true, degraded(降级时true), success:false}`；
   有则跑 `domPublish` → `{track:dom, degraded, reasonCode, success, publishId, apiAttempt, domAttempt}`。
   **降级必发结构化日志** `logger.warn("publish-mode","degraded to dom",{platform,mode,degraded:true,reasonCode,error})`
   （决策账：可观测「双轨降级」事件，供 UI 提示与埋点）。

**结果→outcome 归一（`outcomeOfResult`，数据校验）**：显式标志优先（`success`/`riskBlocked|risk_blocked`/
`loginExpired|login_expired`/`unsupported`）；再按具名错误码（`BILI_RISK_601`/`10000015`→risk）；再按文案正则兜底
（登录/cookie失效→login；风控/滑块/601/频繁/verify→risk；暂不支持/no api→unsupported）；其余→`transient_error`。
保守方向：疑似风控即便文案含糊也停报（宁停不绕），符合「不因换号绕风控」。

**交互逻辑 / 显示项（下游 UI 消费）**：
- `track=throttled` + `waitMs` → UI 提示「该平台/账号需间隔 18 分钟，请 X 分钟后再发」，不发起发布。
- `stopped=true`（risk/login）→ UI 停报该平台、提示人工处理（登录续期 / 创作者中心滑块），不自动重试、不换号。
- `degraded=true` → UI 标「API 失败已降级到浏览器发布」，附 `reasonCode`（`transient_error_fallback` / `mode_unsupported_fallback`）。
- `requiresDom=true` 且无 DOM 执行器 → UI 提示「需启用桌面端 DOM 发布器」。

**测试**：`publish-mode-runner.test.js`（19 例，纯假发布者零外发）覆盖 outcomeOfResult（标志/错误码/文案兜底）、
dom-only（不触 API、无 DOM→requiresDom）、api-then-dom（成功留 API / transient 降级+日志 / 抛异常归一降级 /
risk 停报不降级 / login 停报 / unsupported 回落 / 降级无 DOM→requiresDom）、api-only（任何失败停报）、
spacer（首次放行、17min 节流零请求 waitMs、越 18min 再放行、不同账号独立、dom-only 轨同受约束）、
模式来源（getMode 默认 + opts.mode 覆盖 + 缺省 api-then-dom + 无 API 执行器回落）。全量回归 **154 测 EXIT=0**（20 文件）。

**待办（后续切片）**：§5.1 `config/platforms.yaml` 落 `publishMode` 字段（逐平台三态，未入波=dom-only）并由服务层
`getMode` 实读；§5.4 `risk_blocked` 挂起该平台 + 通知（恢复/停止）、不影响其他平台；本包装与 §4 链、`index.publishViaApi`
接线成产品入口随 §5.1/§5.4 一并落地。

## 12.6 双轨发布服务层：publishMode 配置落字段（§5.1）+ 风控挂起（§5.4）

本轮把 §5「双轨路由 + 频控 + 风控停止」补齐到可上线：§5.2 已有执行包装 `publishWithMode`，本轮补上它的两个数据/联动端点——§5.1 逐平台发布模式的配置事实源与读取器、§5.4 风控命中后的平台挂起与通知。四者合起来构成 §5 服务层闭环：`getPublishMode` 供模式、`spacer` 供频控、`decideRoute` 供决策、`riskSuspender` 供风控停摆。

### 12.6.1 §5.1 发布模式配置（config/platforms.yaml）

- **字段**：每个平台新增 `publishMode`，取值三态之一 `api-only | api-then-dom | dom-only`（与 `publish-mode.js` 的 `MODES` 严格一致，非 `dom-rpa` 等旧命名）。
- **本波取值**：W1 三平台 `tencent_video`（视频号）、`bilibili`（B站）、`baijiahao`（百家号）= `api-then-dom`；其余 12 平台全部 = `dom-only`（未入波，即便 `has_api: true` 的 youtube/facebook/twitter 也先按 DOM 处理，等各自波次再切）。
- **与 has_api 的关系**：`publishMode` 是 §5 双轨服务的唯一事实源；`has_api` 保留给旧 `api-router.publishWithFallback`/`shouldUseApi` 与 desktop 侧使用，二者互不覆盖、互不冲突。视频号 `has_api: false` 但已建链，故显式 `publishMode: api-then-dom`（字段优先于派生）。
- **数据校验**：`getPublishMode` 返回值恒为三态之一；`normalizeMode` 对非法值（拼写错、旧命名）直接抛错 fail-closed，配置写错不会静默走错轨。

### 12.6.2 §5.1 读取器 api-router.getPublishMode(platform)

- **优先读字段**：`cfg.publishMode` 非空则取之。
- **派生回退**：字段缺省时按 `has_api` 派生——`has_api:true → api-then-dom`，否则 `dom-only`；未知平台 → `dom-only`。
- **归一**：结果经 `normalizeMode` 归一并做合法性校验（非法抛错）。
- **API 签名**：`getPublishMode(platform: string): 'api-only'|'api-then-dom'|'dom-only'`；已随 `module.exports` 导出，供 §5.2 `createPublishWithMode({ getMode: getPublishMode })` 直接接线。

### 12.6.3 §5.4 风控挂起器 risk-suspender.createRiskSuspender(deps)

- **职责**：某平台/账号命中 `risk_blocked`（风控）后挂起之并通知；**不影响其他平台/账号**继续发布。
- **挂起粒度**：默认账号级——`publishWithMode` 传入由 cookie 派生或 opts 指定的 `accountId`，只挂触发风控的那个账号；同一平台的其他干净账号不被牵连（符合「风控即停该号、不误伤他号、绝不自动换号绕过」的合规红线）。也支持平台级挂起（`suspend(platform)` 省略 accountId，覆盖该平台所有账号）。
- **注入依赖**：`{ clock?, notify?, logger? }`，纯内存状态（`Map`），无任何计时器/网络/持久化，测试零副作用。**不含自动恢复逻辑**——`resume` 只由显式调用触发（人工确认已处理 / 冷却到期）。
- **API**：`suspend(platform, accountId?, info?)`（幂等，重复挂起只更新记录、只通知一次）｜`isSuspended(platform, accountId?)`｜`getSuspension(platform, accountId?)`｜`resume(platform, accountId?)`（命中返回 true 并通知一次）｜`listSuspended()`｜`clear()`（逐条 resume 通知，reason=`cleared`）｜`size()`。
- **通知事件**：`notify({ type:'suspend'|'resume', platform, accountId, reason, at })`；notify 抛错被吞并转 `logger.error('risk-suspender', ...)`，绝不炸主发布流程。

### 12.6.4 §5.4 与 §5.2 执行包装的联动（publishWithMode）

- **入口挂起守卫**：`publishWithMode` 若注入 `riskSuspender` 且 `isSuspended(platform, accountId)` 为真 → **直接返回** `{ track:'suspended', stopped:true, reasonCode:'risk_suspended' }`，不进入任何 API/DOM 轨、**零请求**，并发 `logger.warn('publish-mode','skipped (risk-suspended)')`。
- **风控命中即挂起**：API 轨结果归一为 `risk_blocked` 且决策为「停报」时，调用 `riskSuspender.suspend(platform, accountId, { reason:'risk_blocked_stop', error })`。
- **仅风控挂起**：`login_expired`（登录失效）走停报但**不挂起**（可重新登录恢复，非风控封锁）；`transient_error/unsupported` 走降级不挂起。
- **向后兼容**：`riskSuspender` 为可选注入，不传时 `publishWithMode` 行为与 §5.2 完全一致（既有 19 例测试不受影响）。

### 12.6.5 交互显示项与提示文字（UI 接线约定，§6 落地）

- **挂起状态点**：账号管理/发布记录页对被挂起账号显示「风控挂起」红色状态（对应 `reasonCode: 'risk_suspended'` / `'risk_blocked_stop'`）。
- **提示文字（zh / en 成对，Gate locale 校验）**：
  - 风控停报：`发布已暂停：触发平台风控，请人工处理后重试（不会自动换号）` / `Publishing paused: platform risk control triggered. Handle manually and retry (no automatic account switch).`
  - 挂起跳过：`该账号处于风控挂起状态，已跳过发布` / `This account is suspended due to risk control; publishing skipped.`
  - 恢复动作：提供人工「恢复 / 停止」按钮 → 分别调用 `riskSuspender.resume(platform, accountId)` 与保持挂起。
- **结构化日志埋点**：`skipped (risk-suspended)`（warn）、`stopped (no degrade)` 带 `outcome:risk_blocked`（error）供运营看板统计风控频次。

### 12.6.6 测试与验证

- `publish-mode-config.test.js`（§5.1，读真实 platforms.yaml）：每平台 `publishMode` 存在且为三态之一；W1=api-then-dom、其余=dom-only；`getPublishMode` 字段优先覆盖 has_api 派生、缺省派生、未知→dom-only、全平台遍历恒合法。
- `risk-suspender.test.js`（§5.4，纯注入零外发）：平台级/账号级挂起语义、幂等单次通知、resume/clear、缺 platform 抛错、notify 异常吞并转 error、多平台互不干扰；联动 5 例——risk_blocked→停报且挂起该账号（他账号不受牵连）、已挂起再发布 short-circuit 零调用、挂起不影响他平台、login_expired 停报不挂起、不传 riskSuspender 向后兼容。
- 全量回归 22 文件 / 175 测 EXIT=0；Gate 12（品牌残留）6016 tracked 文件 PASS。

### 12.6.7 待办（后续波次）

- §5 服务入口在 `index.js` 组装为产品级 `publishWithMode` 单例（`apiPublish=index.publishViaApi` + `getMode=apiRouter.getPublishMode` + 进程内 `spacer`/`riskSuspender` 单例 + `domPublish` 接 desktop RPA），替换旧 `publishWithFallback` 成为默认路径。
- notify 回调对接 desktop 通知中心 + i18n 文案；「恢复/停止」按钮接入 IPC。

## 12.7 双轨发布服务入口装配（§5 收口：index.js 组装 publishWithMode 单例）

§5 的四件套（`getPublishMode` 供模式 / `spacer` 供频控 / `decideRoute`+`publishWithMode` 供决策执行 / `riskSuspender` 供风控停摆）此前各自就绪但缺一个统一入口。本轮新增 `src/publish/publish-service.js` 并在 `index.js` 装配成产品级服务，使 §5 成为可直接调用、可被 UI/IPC 复用的单一事实入口；旧 `api-router.publishWithFallback` 保留兼容、不再是推荐路径。

### 12.7.1 API 签名

- `createPublishService(deps): { publishWithMode, getMode, spacer, risk }`
  - `deps.apiPublish(platform, taskData, cookie, opts): Promise<result>`（**必填**，缺失即抛错 fail-closed）。
  - `deps.getMode?(platform): string`（缺省 `()=>undefined` → 归一为 `api-then-dom`）。
  - `deps.spacer?` / `deps.riskSuspender?`（缺省内部新建进程内单例）。
  - `deps.onRiskEvent?(event)` / `deps.logger?`（风控事件通知桥接与日志）。
- `publishWithMode(platform, taskData, cookie, opts?): Promise<PublishResult>`
  - `opts = { accountId?, mode?, rpaPublish?, onProgress?, ... }`；`rpaPublish` 为 DOM/RPA 回落执行器，**每次调用注入**（缺省则该次无 DOM 能力）。
- `index.js` 顶层装配并导出：`publishWithMode`、`publishService`（含 `.risk` / `.spacer` / `.getMode`）、`getPublishMode`。

### 12.7.2 装配与接线（index.js）

- `_publishService = createPublishService({ apiPublish: publishViaApi, getMode: (p)=>apiRouter.getPublishMode(p), logger, onRiskEvent })`。
- `apiPublish` 直接绑定 `index.publishViaApi`（走各平台适配器 `execute`/`publish`），`getMode` 绑定 §5.1 `apiRouter.getPublishMode`。
- `onRiskEvent` 桥接到 `logger.warn('publish-service', 'risk_'+type, event)`（§6 再接桌面通知中心 + i18n）。
- **循环依赖处理**：`publish-service.js` 只依赖 `./core/*` 叶子模块，不 require `./index`/`./api-router`；由 `index.js` 注入 `apiPublish`/`getMode`，规避 `index↔api-router` 的惰性 require 环，同时让单测可用假 `apiPublish` 零外发驱动整条服务链。

### 12.7.3 编排流程与数据校验

1. 取 `mode = normalizeMode(opts.mode ?? getMode(platform))`（非法值抛错，未配置默认 `api-then-dom`）。
2. 取 `accountId = opts.accountId || cookie.slice(0,16) || 'default'`。
3. **风控挂起守卫**（§5.4）：`risk.isSuspended(platform, accountId)` 为真 → 直接返回 `{track:'suspended', stopped:true, reasonCode:'risk_suspended'}`，**零请求**。
4. **频控闸门**（§5.3）：`spacer.tryAcquire(platform, accountId)` 不放行 → 返回 `{track:'throttled', waitMs}`，**零请求**（spacer 为服务级单例，跨调用共享台账）。
5. 跑 `apiPublish` → `outcomeOfResult` 归一 → `decideRoute`：`success` 留 API；`risk_blocked` 停报**并挂起该账号**（`risk.suspend`，他账号不受牵连）；`login_expired` 停报不挂起；`transient/unsupported` + `api-then-dom` 降级 DOM；`api-only` 任何失败停报。
6. 降级 DOM 用 `opts.rpaPublish`；缺省则返回 `requiresDom:true`（**不误判成功**），交上层决定。

### 12.7.4 返回结果契约（归一 PublishResult）

`{ platform, mode, track: api|dom|throttled|suspended, degraded, reasonCode, success, publishId?, error?, code?, stopped?, requiresDom?, waitMs?, apiAttempt?, domAttempt? }`。`reasonCode` 取值：`ok / mode_dom_only / mode_unsupported_fallback / transient_error_fallback / risk_blocked_stop / login_expired_stop / api_failed_stop / throttled / risk_suspended`。

### 12.7.5 交互显示项与提示文字（供 §6 UI 接线）

- UI 只需调用 `index.publishWithMode(platform, task, cookie, { rpaPublish })` 即获全链路行为，据 `track`/`reasonCode` 渲染：
  - `track:'api'` → 徽标「API 发布」；`track:'dom'`+`degraded` → 徽标「已降级 · DOM」（提示文字：`API 暂时不可用，已改用浏览器发布` / `API unavailable, fell back to browser publishing.`）。
  - `track:'throttled'` → 「频控等待 {waitMs 换算分秒}」，禁用按钮（`发布间隔不足 18 分钟，请稍后再试` / `Publishing interval under 18 minutes, please wait.`）。
  - `track:'suspended'` 或 `stopped` → 「风控暂停」（见 §12.6.5 文案），配「恢复/停止」按钮调用 `publishService.risk.resume/isSuspended`。
- `publishService.risk.listSuspended()` 供账号管理页拉取被挂起清单渲染红色状态点。

### 12.7.6 测试与验证

- `publish-service.test.js`（10 例，假 apiPublish/rpaPublish 零外发）：缺 apiPublish 抛错；api-then-dom 成功走 API 且仅调一次；transient+rpaPublish 降级 DOM；transient 无 rpaPublish→requiresDom；risk_blocked→停报+挂起该账号+再次发布 short-circuit 零调用；resume 后可再发；getMode 缺省归一 api-then-dom；spacer 服务级单例跨调用节流（第二条 throttled 零调用）；onRiskEvent 收到 suspend 事件；service 暴露 risk/spacer/getMode 句柄。
- index.js 冒烟：`require('./src/index')` 正常加载（无循环崩溃），暴露 `publishWithMode`/`getPublishMode('bilibili')='api-then-dom'`/`publishService.risk.suspend`。
- 全量回归 23 文件 / 185 测 EXIT=0；Gate 12 6019 tracked PASS。

### 12.7.7 §5 收口状态与待办

- §5「双轨路由 + 频控 + 风控停止」服务层四件套 + 统一入口已全部落地（§5.1~§5.4 + 本装配）。
- 待办（转 §6/§7）：把 UI/IPC 发布入口从 `publishWithFallback` 切到 `publishWithMode`；`onRiskEvent` 接桌面通知中心 + i18n 文案；`rpaPublish` 由 desktop ROUTE_TABLE 顶层分派的 DOM 执行器注入；活体验收（§7）。

### 12.8 W1 §4.4 百家号 re-point（旧视频链 → 新文章链，Q14 只发图文）

**背景与决策**：Q14 明确「百家号只发图文（文章）」。§4.3 已交付独立文章链 `src/publish/platforms/baijiahao-article.js`（`BaijiahaoArticleChain`，本机假 HTTP 契约测试 `baijiahao-article-chain.test.js`）。本轮把对外适配器 `src/adapters/baijiahao.js` 由 457 行视频链（`preuploadVideo` / 分片 `uploadVideoPart` / `compuploadVideo` / `video process` 轮询 / `publishVideo`）**整体下线**，改为薄委托到文章链，落实「单一事实源 = 文章链」。这是行为变更（发布产物 video → article），属 §4.4 预留的「百家号专轮」。

**适配器委托接线（`adapters/baijiahao.js`，约 70 行）**：
- `class BaijiahaoAdapter extends BasePlatformAdapter`，`super("baijiahao")`，`this.apiBase = "https://baijiahao.baidu.com"`；外部接口保真（`getReferer()` → `.../builder/rc/edit?type=news`、`getOrigin()` → 百家号域）。
- `_chain(cookie, clients)`：`new BaijiahaoArticleChain({ cookie, userAgent: HttpConfig.userAgent, ...clients })`；测试可注入 `_chainOverride` 或用 `opts.http` 传 http/baseUrl 覆盖，杜绝真实网络。
- 图文无视频：`uploadVideo()` / `uploadCover()` 返回 `null`（保持基类 execute 契约的空上传语义，不发起请求）。
- `buildPostData(taskData)`：委托 `chain.buildArticleFormData(taskData)`（x-www-form-urlencoded），供旧调用点 / 测试复用。
- `execute(taskData, cookie, opts)`（`publishViaApi` 入口）：① `!taskData.title` → 返回 `{ success:false, error:"缺少标题（百家号图文发布需 title）", platform:"baijiahao" }`（fail-closed 零请求，不调链）；② `draft = opts.draft !== false`（**私密草稿优先**，对齐 Q14 活体验收口径）；③ `await chain.run(taskData, { draft })`；④ 链失败 `{ success:false }` → 透传 `error` / `code`（不吞风控 10000015 等原始码）；⑤ 链抛错（缺 cookie / UA fail-closed）→ catch 归一 `{ success:false, error, platform }`；⑥ 成功 → `{ success:true, platform, draft, publishId, url:"https://baijiahao.baidu.com/pcui/article/<id>", raw }`。

**AI 生成声明平移（文章链 `buildArticleFormData`）**：旧视频链 `activity_list[0][id]=aigc_bjh_status & activity_list[0][is_checked]=1/0` 平移到文章链；以 `URLSearchParams.set('activity_list[0][id]', 'aigc_bjh_status')` + `set('activity_list[0][is_checked]', aiGenerated ? '1' : '0')` 实现（方括号自动编码为 `%5B/%5D`，与逆向抓包逐字一致）。语义 `aiGenerated = taskData.aiGenerated !== false` → **默认勾选**（AI 生成内容必须如实声明），人工创作须显式 `aiGenerated:false` 才取消。与快手 `ai_generated` 跨平台一致（e2e「跨平台 AI 声明一致性」用例保留）。

**链级既有能力（§4.3，本轮未动）**：baseToken（`/?source=inner` 正则 `BJH__INIT__AUTH__`）→ publishToken（`/pcui/article/edit?type=news` 响应头 `token`）→ uploadImage（`/pcui/picture/uploadproxy`）→ submitArticle（`draft` → `/pcui/article/save?callback=bjhdraft` 私密优先，否则 `/pcui/article/publish?type=news`）；errno 10000015 风控弹码可操作提示；标题 149 字节 UTF-8 截断；缺 cookie / UA fail-closed 零请求。

**测试变更（行为变更专轮，全量回归 23 文件 / 173 测 EXIT=0）**：
- `baijiahao-article-chain.test.js`：新增 2 例（`buildArticleFormData` 默认 `is_checked=1` / `aiGenerated:false`→`0`）；链级假 HTTP 契约（save / publish / token 逐级传递 / 风控 10000015 / 截断 / fail-closed 零请求）共 10 例。
- `baijiahao-api-chain.test.js`：由 378 行视频链用例（preupload / 分片 / complete / process / publishVideo / buildVideoPostData）**整体重写**为 10 例「委托接线」（接口保真 / upload 桩 null / buildPostData 委托 / AI 声明 / 截断 / execute 草稿优先 / 透传 aiGenerated / 缺标题零请求 / 风控 error 透传 / 链抛错归一）。
- `e2e-publish-full-chain.test.js`：百家号段由视频全链（2 分片 + process + article/publish）改「委托文章链」4 例（execute→chain.run / 草稿优先 / aiGenerated 透传 / 缺标题 fail-closed / buildPostData 含 aigc + 截断）；移除 `createTempVideo` 与视频 mock handlers；快手段与「跨平台 AI 声明一致性」保留。
- 用例净变化 −12（视频链用例随能力下线）；百家号真实 HTTP / token / 风控覆盖不降（迁入 `article-chain` 假服务器组）。

**显示项 / 提示文字（供 §6 UI）**：百家号发布产物由「视频」改为「图文」；成功回 `publishId` + 可点 `url`；风控 `code=10000015` → 提示「百家号发布被风控拦截（<hit_rule>）。请先在浏览器中登录百家号完成验证（<scenes>），验证通过后重新发布。」；缺 cookie / UA / 标题 → fail-closed 可读错误，绝不静默成功。

**Gate / 合规**：只直连 baijiahao 官方域名，无任何远程签名；测试仅本机假 HTTP / 纯表单函数，零外发。Gate 12 品牌残留扫描 6021 tracked 文件 PASS。


## 12.9 桌面集成后端：图文 API 发布分流 + 发布方式记录（§6 后端基座，随本 PR）

> 定位：§4.4 百家号 re-point（Q14 只发图文）暴露了桌面发布路由层的集成缺陷——`apps/desktop/electron/services/publisher-router.js` 的 `ApiPublisher.publish` 硬依赖 `article.video_path` 并做 ffprobe 横版校验，图文任务（无视频）会在到达引擎适配器之前抛「缺少视频文件路径」。本节定义桌面侧的图文/视频分流与「发布方式」记录，作为 §6.1 发布记录徽标的数据源。

### 12.9.1 功能逻辑与流程
- `ApiPublisher.publish(task, opts)` 先 `buildPublishArticle` 解析平台化内容 + `loadAuthForTask` 取凭证；随后按 `article.video_path` 是否存在分流：
  - **图文模式**（`isArticle = !videoPath`）：跳过 ffprobe，构造不含 `video` 字段的 `taskData`（`title/content/tags/draft/aiGenerated`），并透传 `images`（来自正文内联图，由 `RichTextProcessor` 提取）与 `author`；不再要求封面/时长/分辨率。
  - **视频模式**（有 videoPath）：维持原行为——`probeVideo` 探测宽高时长，宽 < 高抛「竖版视频暂不支持 API 发布，请使用 RPA 发布」，`taskData.video` 携 path/duration/width/height，带 `cover`。
  - 两种模式均保留平台特有字段透传（B站 category/copyright、百家号 original/location、合集/播放列表、商品/任务）。
- 最终统一 `publishViaApi(platform, taskData, cookie, {timeout, draft, signal})`；成功返回 `{success, url(脱敏), postId, platform, mode:'api'}`。
- **发布方式记录**：`ApiPublisher` 返回 `mode:'api'`（图文/视频均如此）；`RpaVmPublisher` 成功返回新补 `mode:'dom'`。`bootstrap/phase4-events.js` 的 `task:success` 已把整个 `task.result`（含 mode）写入 `history.addRecord`，无需改动即成为 §6.1 徽标数据源。

### 12.9.2 数据校验（fail-closed）
- 凭证缺失：图文/视频均要求 cookie 非空，否则抛「平台 Cookie 缺失（账号 … 未登录或凭证不可用）」，零请求。
- 图文不再要求 video_path；视频仍强校验横版（宽高可探测且宽≥高）。
- 发布结果缺 postId：抛「发布结果缺少平台作品 ID」，不写成功历史。
- 取消信号：`signal.aborted` 在发布前/后各检一次，成功响应不覆盖取消语义。

### 12.9.3 交互显示项与提示文字
- 发布记录（§6.1，待 UI 专轮渲染）「发布方式」徽标三态取值：`api`（直连平台 HTTP API）/ `dom`（RPA 隐形浏览器）/ 降级（api-then-dom 降级，随 §5 服务层接入后补）；数据源 `record.result.mode`。
- 图文路径无视频相关提示；视频路径保留「竖版视频暂不支持 API 发布，请使用 RPA 发布」「视频信息探测失败（ffprobe 不可用或文件损坏）」。

### 12.9.4 测试与验证
- `publisher-router.test.js` 新增 4 例：图文不调 probeVideo 且 taskData 无 video 字段并返回 mode:api、images（来自正文）+author 透传、draft 透传到 taskData 与 opts、RPA 成功返回 mode:dom；文件内 57 测全绿，既往视频冒用例不受影响。
- 回归：phase4-events / ipc-handlers.publish / publish-history 共 47 测绿；ESLint（Gate 11）无 error。测试全程 mock `publishViaApi`，不外发、无品牌词。
- 待办（下一子切片，需桌面应用活体视觉验收）：§6.1 发布记录「发布方式」徽标三态渲染 + 详情分片历史 + `publish.api.*` locale 成对（zh/en，Gate 7）。

### 12.10 §6.1 发布方式徽标三态渲染 + publish.api.* i18n（前端落地，随本 PR）

> 定位：§12.9 后端已把发布方式 `mode`（`api`/`dom`）随 `task.result` 写入 history。本节把它渲染为发布记录卡片的「发布方式」徽标，并补齐 `publish.api.*` 文案（zh/en 成对，Gate 7）。

**交互与显示项**：
- 位置：`PublishHistory.vue` 记录卡 `.record-delivery` 行，紧随状态徽标（成功/失败/待处理）与平台名之后。
- 三态取值：`api` → 「API 直连」（蓝 `#1d4ed8`/底 `#eaf2fe`）；`dom` → 「RPA 浏览器」（紫 `#5b21b6`/底 `#f1f0f7`）；`fallback` → 「降级发布」（琥珀 `#9a6700`/底 `#fff6df`，§5 服务层 api-then-dom 降级接入后启用）。
- 数据源：`record.result.mode`（`deliveryModeValue`）；非 {api,dom,fallback} 或缺失 → 空串 → **不渲染徽标**（旧记录/RPA 历史无 mode 时保持原样，向后兼容）。
- 悬停提示（`title`，`deliveryModeHint`）：`api`=「通过平台官方 HTTP API 直连发布」；`dom`=「通过隐形浏览器自动化发布」；`fallback`=「API 发布不可用，已自动降级为浏览器发布」。
- 可测试锚点：`data-testid="delivery-mode-<recordId>"`。

**i18n 文案（publish.api.*，zh/en 成对）**：`modeApi`/`modeDom`/`modeFallback`（徽标标签）+ `modeApiHint`/`modeDomHint`/`modeFallbackHint`（提示）。zh 用中文、en 用英文，`i18n.test.js` 逐键校验成对（Gate 7）。

**测试与验证**：`PublishHistory.test.js` 新增 3 例（`record.result.mode=api` 渲染「API 直连」、`mode=dom` 渲染「RPA 浏览器」、无 `result.mode` 不渲染徽标），文件内 28 测全绿（原 25 + 新 3）；`i18n.test.js` + `model-providers-copy.test.js` 共 22 测绿（zh/en 成对）；ESLint（Gate 11）无 error；Gate 12 品牌残留扫描通过。渲染为 jsdom DOM 级功能验证（徽标存在性 + 文案 + 条件显隐），像素级视觉签核随 §7 活体轮在打包应用内复核。

**待办**：§6.1 余下「详情分片历史」（记录详情弹窗按平台分片展示各子发布结果与 mode）随 §7 活体轮一并落地；`fallback` 徽标态待 §5 服务层 api-then-dom 降级返回 `mode: fallback` 后自然生效。

### 12.11 §6.1 发布详情弹窗分片增强：发布方式 / 作品 ID / 作品链接（前端落地，随本 PR）

> 定位：§12.10 已在记录卡渲染「发布方式」徽标。本节把同一 `record.result` 数据源延伸到记录详情弹窗，逐字段展示发布方式、平台作品 ID 与作品链接，便于运营从历史反查已发布内容。

**功能逻辑与数据源**：
- 详情弹窗 `selectedRecord = { ...listRecord, ...historyGet.data }`；`result` 字段来自 list 记录（`publish-history.js` 的 `addRecord` 以 `...safeRecord` 整体持久化 `result`，`listRecords` 原样回传）。
- helper `resultValue(record, key)`：仅接受 `record.result[key]` 为 `string`/`number`（转字符串），其余（缺失/对象/数组/null）返回空串。

**交互与显示项**（`.record-detail-grid`，「发布模式」行之后条件渲染）：
- **发布方式**（`detailDeliveryMode`）：`v-if="deliveryModeValue(selectedRecord)"`，值复用 `deliveryModeLabel`（api=「API 直连」/dom=「RPA 浏览器」/fallback=「降级发布」）。
- **作品 ID**（`detailPostId`）：`v-if="resultValue(selectedRecord,'postId')"`，值 `result.postId`。
- **作品链接**（`detailLink`）：`v-if="resultValue(selectedRecord,'url')"`，渲染 `<a :href target="_blank" rel="noopener" class="detail-link" data-testid="detail-link">`（外链新标签、`rel=noopener` 防反向窗口劫持；`word-break: break-all` 防长链溢出）。
- 向后兼容：任一字段缺失 → 该行 `v-if` 不渲染（旧记录/RPA 历史无 `result` 时详情弹窗保持原样）。

**i18n 文案（historyPage.*，zh/en 成对）**：`detailDeliveryMode`（发布方式/Delivery mode）、`detailPostId`（作品 ID/Post ID）、`detailLink`（作品链接/Post link）。

**测试与验证**：`PublishHistory.test.js` 新增 2 例（带 `result:{mode:'api',postId,url}` 渲染三行 + 断 `detail-link` 的 `href`/`rel=noopener`；无 `result` 时 `detail` 不含「发布方式」且无 `detail-link`），文件 30 测全绿（原 28 + 新 2）；i18n 相关 20 测绿；ESLint（Gate 11）无 error；Gate 12 品牌扫描 6055 PASS。像素级视觉随 §7 活体轮在打包应用内复核。

**待办**：多平台「一条记录 → 多个平台子结果」的完整分片列表（每子结果独立 mode/postId/url），待平台适配器把子结果数组写入 `result.subResults` 后扩展；`fallback` 态随 §5 服务层 api-then-dom 降级自然生效。

### 12.12 §5.4 桌面风控挂起信号生产端：risk_blocked 判定 + publish:risk-hold IPC（后端落地，随本 PR）

> 定位：引擎层（§5.4）已有 `createRiskSuspender` + `publish-mode-runner` 内建风控分类，但桌面发布队列走 `publisher-router.js` 直连各 Publisher，失败仅 `throw` 通用 Error，不经引擎 `publishWithMode`，故风控命中不被识别、无信号达渲染层。本节在桌面事件层补齐「识别 + 发信号」生产端，作为 §6.1 通知中心 UI 与后续挂起守卫的数据契约。

**功能逻辑与流程**：
- 新增 `apps/desktop/electron/services/publish-risk.js` 纯函数 `isRiskBlocked(errorMessage)`：正则 `RISK_RE`（与引擎 `publish-mode-runner` 词表同义：风控/risk/滑块/601/10000015/frequent/频繁/verify/验证/安全验证/操作频繁/captcha）匹配 `task.error`；非字符串或空串 → false（fail-safe）。
- `phase4-events.js` 的 `task:failed` 处理内：在既有通用 `publish:progress`（✗ 发布失败）之外，若 `isRiskBlocked(task.error)` 为真，追加 `win.webContents.send('publish:risk-hold', { platform, accountId, taskId, error })`。`accountId` 取 `task.article?.accountId || null`；仅在窗口存活（`win && !win.isDestroyed()`）时发。

**数据校验**：`errorMessage` 类型守卫（非 string 或空 → false）；`accountId` 缺失 → `null`；窗口销毁 → 不发（沿用既有存活守卫）。

**显示项与提示文字**：本切片为「信号生产端」，不改渲染层（无可见 UI 变更）；`publish:risk-hold` 载荷 `{platform, accountId, taskId, error}` 即 §6.1 通知中心的消费契约。

**合规红线**：风控即停、绝不自动换号绕过——本模块只做识别，不含任何自动恢复逻辑；挂起态的显式恢复由 §6.1 UI（恢复/停止）+ 引擎 `riskSuspender.resume` 承担（后续切片）。

**测试与验证**：`publish-risk.test.js` 3 例（常见风控信号命中 / 普通失败非命中 / 非字符串安全 false）；`phase4-events.test.js` +2 例（风控失败发 `publish:risk-hold` 且载荷含 platform/accountId/taskId、普通失败不发但发 `publish:progress`）。electron 6 测绿；ESLint（Gate 11）无 error；Gate 12 品牌扫描 6055 PASS。

**待办（后续切片，端到端验收绑定 §7）**：渲染层订阅 `publish:risk-hold` 的通知中心 UI（恢复/停止）+ preload 暴露 `onRiskHold` + 桌面 `riskSuspender` 状态接入发布队列派发前置守卫（真正「挂起」该平台/账号后续发布）。

## 附：验收记录（活体证据回写区，随波更新）

| 波次 | 平台 | 日期 | 作品ID | 链接 | 截图 | 降级 | 结论 |
|------|------|------|--------|------|------|------|------|
| — | （W1 验收后回写） | | | | | | |
