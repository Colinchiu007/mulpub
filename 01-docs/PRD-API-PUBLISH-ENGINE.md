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
变薄委托本文章链、外部接口不变）待后续切片；视频号 §4.1、B站 §4.2 链待后续切片。


---

## 附：验收记录（活体证据回写区，随波更新）

| 波次 | 平台 | 日期 | 作品ID | 链接 | 截图 | 降级 | 结论 |
|------|------|------|--------|------|------|------|------|
| — | （W1 验收后回写） | | | | | | |
