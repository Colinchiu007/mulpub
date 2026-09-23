# 多账号 API 发布技术方案 v2 —— decision-complete 实现基线

> 状态：**已批准实施**（经 grill-me 21 问逐条拷问锁定，用户确认「一致」）
> v1 → v2：v1 是逆向调研文档；v2 是可直接开工的实现基线，纳入全部设计决策、逐字切片取证、验收标准与波次门禁。v1 保留于 `多账号API发布技术方案-v1.md`。
> 逆向事实源：`D:\Data\refpub-bundle\packages\main\dist\index.cjs`（8.4MB，参考产品 4.0 主进程发布引擎，已核实完好）。
> 逐字切片证据：本目录 `evidence/yx-slices-v2.txt`（六平台链，107KB）、`evidence/yx-slices-v2b.txt`（知乎/签名/合并步补提，13KB）。
> **红线（用户明令，不可违反）**：⛔ 运行时严禁请求 `*.refpub.cn` 或任何第三方签名服务；本方案所有能力逆向为**我们自己的代码**；`MP_SIGNER_BASE` 远程通道**全量拆除**（决策 Q16）。

---

## 0. 三句话摘要

1. 发布引擎从「DOM 点击 RPA」升级为参考产品同款架构：**Cookie + axios 直连平台官方创作者 HTTP API**（预上传 → 8MiB 分片 → 合并 → 发布提交），在 `packages/api-publish-engine` 内重写 adapters。
2. 签名依赖分层处理：**Tier A 本地 crypto 化**；**Tier-B 采用「浏览器辅助签名」**——常驻隐藏签名页内从平台前端 webpack 模块抽取签名函数本地求值，纯算法逆向为后备；对上层统一暴露 `signCommand → signature` 进程内注册表契约。
3. **双轨运行**：API 优先、失败自动降级 DOM RPA，配置驱动人工总闸；8 平台分 W1-W4 四波交付，每波活体验收（真实内容、间隔 ≥18 分钟、风控即停、证据齐才关波）。

---

## 1. 决策账（grilling 21 问落定，禁止重问）

| # | 决策点 | 锁定结论 |
|---|--------|----------|
| Q1 | 方式 | 参考产品同款：Cookie + 直连平台 HTTP API |
| Q2 | 落地位置 | `packages/api-publish-engine` 内重写 adapters（方案 a），不新建平行模块 |
| Q3 | 签名抽象 | 进程内注册表（非 HTTP 服务），契约 `{signCommand, payload} → signature` |
| Q4/Q8 | 活体验收 | **直接真实发布**；真实内容**真实标题**（无「测试」前缀）；同账号两次 API 发布间隔 **≥18 分钟**；出现风控信号**立即停该平台并报告**，不自动换号 |
| Q5 | 证据 | bundle 盘上完好（`D:\Data\refpub-bundle`），逐字切片直接回提取，无需重新解包 |
| Q6 | 平台范围 | **8 平台**：视频号、B站、快手、抖音、小红书、百家号、头条号 + 知乎 |
| Q7 | Tier-B 签名 | **(a) 浏览器辅助签名为主，(b) 纯算法逆转为备** |
| Q10 | 双轨 | API 优先、失败降级 DOM RPA；未入波骨架加「未验证 stub」头注 |
| Q12 | TDD 边界 | 注入 axios + 本机临时 HTTP 假服务器钉请求契约（PromptBridge 先例）；**禁止 VCR**（登录态不落测试夹具）；平台语义交波内活体验收 |
| Q13 | 取签机制 | **webpack 模块抽取为主、网络拦截捕获做一致性双验证**；每平台常驻隐藏签名页，登录预热、失效自愈 |
| Q14 | 内容类型 | 百家号/头条号只做文章（bundle 核实 `baijiahaoPublishVideo`/`toutiaohaoPublishVideo` 0 命中）；**知乎例外：`zhihuPublishVideo@2119327` 存在视频链**（v2 新证据），知乎视频+文章都做 |
| Q15 | 可见性 | 平台 API 支持私密/草稿/仅自己可见时**先私密验收**，回查通过后由用户手动转公开；不支持才直接公开 |
| Q16 | 后门拆除 | `signer.js` 的 `MP_SIGNER_BASE`/`getRemoteSign` 远程对比通道全量删除，不留 env 开关 |
| Q17 | 签名页安全 | ① renderer 仅白名单 IPC 求签、禁任意求值通道；② 抽取函数句柄只存内存**绝不序列化落盘**；③ 签名页不加载非平台域内容 |
| Q18 | 双轨总闸 | `config/platforms.yaml` 每平台 `publishMode: api-then-dom \| api-only \| dom-rpa`，默认 api-then-dom；降级事件进发布日志并计入验收统计 |
| Q19 | 波次 | W1 视频号+B站(视频)+百家号(文章) → W2 抖音 → W3 **快手 sig3 spike 门禁**（时间盒抠不通即止步，快手/小红书留守 DOM RPA）→ W4 头条号(文章)+知乎(视频+文章) |
| Q20 | 文章源 | 百家号/头条号/知乎文章由 ai-writer 现生成（同题图文稿） |
| Q21 | 验收证据 | 每波每平台：作品ID + 平台前台链接 + 登录态回查截图 + 是否降级 → `01-docs/rpa-api-publish/evidence/api-w<N>-<platform>/`，随波 PR `git add -f` 进仓，回写总 PRD；缺一不关波 |
| Q11 | 流程 | 一份总 PRD + 本方案挂 W1-W4 验收标准；每波独立 worktree（`session-init.sh api-publish-w1`…）+ 独立 PR + CI + autoMerge；W2 前按 W1 活体结果修订，允许砍 wave |

---

## 2. 平台 × 内容类型 × 签名分层矩阵

| 平台 | 视频 | 文章 | 签名成分 | 波次 | 参照链（bundle 偏移，切片见 evidence） |
|------|------|------|-----------|------|----------------------------------------|
| 视频号 | ✅ | — | 全本地（Content-MD5 + authKey 接口自返） | W1 | `getUploadAuthKey@983820`、`applyuploaddfs@984912`、`uploadpartdfs@986392/995595`、`getUploadedVideoInfo$4@996037`(complete)、`shipinhaoPublishVideo@1092626` |
| B站 | ✅ | 延后 | 全本地（csrf=bili_jct + X-Upos-Auth） | W1 | `publishBilibiliVideo@1466868`、`getUploadIdResponse$3@1457472`(preupload/upos)、`/x/vu/web/add@1462478` |
| 百家号 | ❌无参照 | ✅ | token 自域响应（Tier A） | W1 | `getBaijiahaoPublishArticleToken@1841535`、`BJH__INIT__AUTH@1842459`、`pcui/picture/uploadproxy@1857820` |
| 抖音 | ✅ | — | 准自包含：本地 clientSign(SHA256+EC私钥) + **空 a_bogus 先验** | W2 | `create_v2@2672901/2674350`、`clientSign@2673851`、`x-secsdk-csrf-request@1525855`(getSdkToken)、`getUploadedVideoInfo$3@1380840`(快手复用注意) |
| 快手 | ✅ | — | `__NS_sig3` 外包签名（参考产品服务端 VM，回源不可得）→ **浏览器辅助签名** | W3(spike) | `getSign$5@1341838`、`__NS_sig3@1342665/1343225`、`getUploadArgsResponse$9@1344875`、`uploadVideoPart$b@1386455`、`publishKuaishouVideo@1389174` |
| 小红书 | ✅ | — | `x-s/x-t` 外包（→5096）→ 同 W3 签名页 | W3 | 切片含 `getXiaohongshuProMessage`；完整链 W3 前置补提 |
| 头条号 | ❌无参照 | ✅ | 自有签名（→5031/5032）→ 签名页 | W4 | `pcui`相邻段 `@1732179` 区、`getSdkToken` 复用段（头条 mp.toutiao.com 域） |
| 知乎 | ✅ | ✅ | **不在外包表**（x-zse 0 命中）→ 疑似自包含，W4 前置取证 | W4 | `publishZhihuArticle@2106013`、`zhihuPublishVideo@2119327`、`zhihuPublishDynamic@2126523`、聚合对象 `@2132700` |

出局平台（参考产品不支持或另立官方 API 项目线）：网易号、皮皮虾、多多、youtube、tiktok、twitter、weibo、csdn。

---

## 3. 目标架构

### 3.1 模块布局（全部在 `packages/api-publish-engine/src/`）

```
publish/
  core/
    http-base.js        # $http 等价物：axios 实例工厂、timeout 60s、retryCondition=!isJson(res.data) 最多3次、可注入 httpAgent/httpsAgent（代理）
    uploader.js         # FileChunker：8MiB(8388608) 分片、UploadEmitGate 节流（>100MB 每5s；小文件每10%）
    progress.js         # publishStatusEnum + SetProgressNewEvent/SetProgressEvent 等价（对接现有队列 progress 事件）
    cancel.js           # 复用现有 cancel-token.js
    errors.js           # errorCode{request_error,data_error,io_error,unknown_error} + BadRequestException 等价
    contract.js         # 逐步响应校验（见 §5，全平台统一 schema 断言入口）
  platforms/
    shipinhao.js  bilibili.js  baijiahao.js  douyin.js  kuaishou.js  xiaohongshu.js  toutiao.js  zhihu.js
    # 每个 = { publishVideo?, publishArticle?, getUploadPlan, uploadChunk, complete, submit, checkLogin }
signer/
  registry.js           # 进程内注册表：register(signCommand, implFn)；sign(signCommand, payload) → signature
  local/                # Tier A：md5/csrf/token 提取等纯函数（收编现 signer-local.js）
  page-runner/          # Tier-B：签名页生命周期管理（仅 Electron 主进程装配，见 §4）
index.js                # 导出；adapters/ 旧骨架逐个改为委托 platforms/ 实现（Q16：signer.js 删远程通道）
```

- **降级收口点（Q18）**：现有发布入口（electron 服务层调用 adapter 处）统一走 `publishWithMode(platform, task, cookie)`：读 `config/platforms.yaml` 的 `publishMode` → `api-then-dom` 时先调 API 链，命中「降级触发条件」（§6.3）则落 DOM RPA 路径并记录 `degraded: true`。
- **UA 一致性**：API 请求 UA 取登录会话 webview 实际 UA（`session.getUserAgent` / 保存登录态时一并持久化 `ua` 字段），与 Cookie 同存取。

### 3.2 数据流（以视频链为例）

```
发布队列任务(video, title, cover, tags, accountId)
 → accounts.json 取该账号 Cookie+UA（apps 层已有能力，不改存储）
 → registry.sign 预热检查（Tier-B 平台：确认签名页 alive，否则拉起/重载）
 → platforms/<p>.getUploadPlan(size) → 分片计划
 → 预上传接口 → uploadId/authKey
 → 循环 PUT 分片（Content-Range，8MiB）—— UploadEmitGate 回传进度
 → complete 接口 → fileId/bvid 等平台句柄
 → 封面上传（各自平台接口）
 → submit 发布 body（含标题/标签/可见性参数 §7.3/签名字段）
 → 响应校验 → {success, publishId, publishUrl?, degraded:false}
 → 失败按 §6.3 分类：可重试(网络/5xx,≤3) / 降级DOM / 风控停报
```

---

## 4. Tier-B 签名页（浏览器辅助签名，决策 Q13/Q17）

### 4.1 组成

- **每平台一个常驻隐藏签名页**：`BrowserWindow({show:false})` 或 `webview`（优先主进程 `session.fromPartition('persist:signer-<platform>')` 复用**登录会话同一 partition**，保证 Cookie/UA 同源——具体 partition 复用方式 W3 spike 验证）。加载平台创作者域名真实页面，登录预热时初始化。
- **函数抽取器（extractor）**：在页面上下文注入一次性脚本，通过 `window.webpackChunk*` push 劫持获取 `__webpack_require__`，按特征码（对已知调用点字符串做模块源码扫描）定位签名模块，取出签名函数句柄存于**页面内一个受控全局槽位**（如 `window.__mpSigner.ksSig3`）。
- **求签通道（IPC，白名单）**：主进程 `signer:invoke` ← renderer/引擎侧只能调 `{signCommand:'kuaishou.sig3', payloadHashRef}` 形态的白名单方法；主进程经 `webContents.executeJavaScript` 调用槽位函数。**renderer 不存在任意 JS 求值通道**（Q17①）。
- **一致性双验证（拦截法）**：抽取完成后，hook 页面 `XMLHttpRequest.open/send` 与 `fetch`，对页面自身发出的带 `__NS_sig3` 请求，用抽取函数对同 payload 复算，比对一致才登记函数句柄为 `verified`；不一致 → 槽位废弃、重扫模块、报告。
- **自愈**：求签抛错/平台改版特征码失配 → 页面 reload + 重抽取（限流：每平台每小时 ≤3 次，超限置 `signer.degraded=true`，该平台自动落到 DOM RPA 并报告）。
- **安全边界**：函数句柄与抽取脚本**只存内存**（页面 world + 主进程变量），不写文件、不进 git、不进安装包（Q17②）；签名页 `will-navigate`/`setWindowOpenHandler` 锁死本平台域（Q17③）。

### 4.2 W3 spike 门禁（时间盒 1 个工作日）

1. 用快手账号登录态，在 `cp.kuaishou.com` 页面完成 webpack 模块抽取，抠出 sig3 生成函数。
2. 拦截法比对：同 payload 本地复算 == 页面真发请求的 `__NS_sig3`。
3. 用复算签名直发一条真实 API（活体）。三步任一失败 → **止步**：快手/小红书保持 DOM RPA，签名页基建仅保留已验证平台可用时再启用。

---

## 5. 数据校验（每步合同，假服务器钉死 + 活体抽检）

统一原则：**响应必须是 JSON 且语义字段在场**；`retryCondition = res => !isJson(res.data)` 捕捉风控 HTML（最多重试 3 次后判「风控信号」）。

| 步骤 | 校验断言（失败动作） |
|------|---------------------|
| 预上传 | `uploadId/authKey/bvid` 非空字符串；否则 error=`io_error` 级 `data_error`，可重试≤3 |
| 分片 PUT | HTTP 200/206 且 ETag/uploadUrl 偏移应答存在；单片失败重试≤3，连续 2 片失败 → 中止任务 |
| complete | 平台句柄（fileId/bvid/media_id）非空；**快手特判 `result∈{1,109}`**，其余码进错误映射 |
| 封面上传 | coverKey/pic_id 非空 |
| 发布提交 | `errCode/result/base_resp` 语义码 == 0/1 且返回作品 ID；**登录失效码表**（视频号 300330/300333/300334；快手 result=109 等）→ 标记账号 `login_expired`，停任务不降级 |
| 签名字段 | 提交前本地断言：签名串非空、长度阈值（sig3≥40）、仅允许拼进白名单参数名 |

### 5.1 错误码到用户文案映射（locales 成对，见 §7.4）

- `login_expired` → 「{平台}登录已失效，请重新登录后再发布」
- `risk_blocked`（非 JSON/验证页）→ 「{平台}风控校验拦截，本次发布已停止，请稍后在应用内手动确认账号状态」
- `upload_fail` → 「{平台}视频上传失败（第 {n}/{total} 段），已自动重试仍失败」
- `submit_fail` → 「{平台}发布提交失败：{平台返回msg}」
- `signer_degraded` → 「{平台}签名服务不可用，本次已自动改用网页发布流程」

---

## 6. 双轨降级与 publishMode

### 6.1 配置（`config/platforms.yaml` 增段）

```yaml
publishModes:
  shipinhao: api-then-dom   # 允许值: api-then-dom | api-only | dom-rpa
  bilibili: api-then-dom
  baijiahao: api-then-dom
  douyin: api-then-dom
  kuaishou: dom-rpa         # W3 spike 通过前保持 dom-rpa
  xiaohongshu: dom-rpa
  toutiaohao: api-then-dom  # W4 起生效
  zhihu: api-then-dom
```

### 6.2 语义

- `api-then-dom`：API 链失败且命中降级条件 → 同任务转 DOM RPA 路径（现有 `rpa-view-platforms.js`），结果记录 `degraded:true`。
- `api-only`：不降级，失败即报（验收波期间对已入波平台临时使用，防止验收证据混轨）。
- `dom-rpa`：不触碰新链（未入波平台默认态）。

### 6.3 降级触发条件（仅网络性/引擎性失败）

可降级：`request_error`（重试尽）、`upload_fail`、`signer_degraded`、未知 5xx。
**不降级直接停报**：`risk_blocked`（风控）、`login_expired`（账号态）、参数校验失败（我方 bug，修码不甩 DOM）。

### 6.4 退役标准

某平台连续 **5 次活体 API 直发成功**（`degraded:false`，跨 ≥2 天）后，允许在 Code Review 中提议删除该平台 DOM 路径；删除单独成 PR。

---

## 7. 交互逻辑与显示项（桌面端）

### 7.1 涉及界面

- **发布记录页**（既有）：新列「发布方式」徽标：`API 直发` / `网页降级` / `仅API(失败)`。
- **发布进行中弹窗/进度条**（既有队列）：进度阶段文案对齐 `publishStatusEnum`：准备上传 → 获取上传参数 → 上传中 {n}%（分片节流回传）→ 封面处理 → 提交发布 → 成功/失败。
- **账号管理页**：登录态卡片新增「签名服务」状态点（Tier-B 平台）：`就绪/抽取中/自愈中/不可用`（悬浮提示 §5.1 文案）。

### 7.2 提示文字与 i18n（强制成对，CI Gate 7）

所有新增用户可见文案写入 `apps/desktop/src/locales/zh.js` + `en.js` 成对提交；键名前缀 `publish.api.*` / `signer.*`；产品名词如涉及更新同步 `01-docs/i18n-glossary.md`。

### 7.3 可见性参数（Q15）

- 各平台 submit body 支持私密/草稿/仅自己可见参数时（W1 前置取证确定各平台参数名：视频号 `postTime`/draft 接口、B站 `is_draft`、百家号草稿、抖音/知乎私有等），验收发布默认传该参数；UI 发布对话框增加「可见性」下拉（公开/私密/仅自己，默认沿用平台默认值），验收模式由发布引擎按任务参数覆盖。
- API 不支持私密档的平台：直接公开，验收报告注明。

### 7.4 频控与停止（Q8）

- 同账号跨平台/同平台任意两次 API 发布提交间隔 **≥18 分钟**（发布队列调度层实现，误差 ±30s；配置键 `publish.api.minIntervalMinutes: 18`）。
- 任一平台命中 `risk_blocked`：**该平台队列挂起**（其他平台继续），通知中心弹 §5.1 `risk_blocked` 文案 + 人工「恢复/停止」按钮；不自动切号重试。

---

## 8. TDD 与测试策略（Q12）

1. **契约单测（每平台每链一个套件）**：注入指向本机临时 HTTP 假服务器的 axios 工厂；断言请求序列（method+path 顺序）、每步 headers 白名单（Cookie/Referer/Origin/UA/X-Arguments 形态）、body schema 字段、分片 Content-Range 精确切分（含整除/非整除/小于单片三种边界）、签名字段占位注入位置。**禁止**任何测试真实外发（假服务器 + `MP_SIGNER_BASE` 已删除双保险）。
2. **registry 单测**：注册/查找/未知 signCommand fail-closed；句柄不落盘断言（tmpdir 扫描）。
3. **降级路由单测**：publishMode 三态 × 触发条件矩阵（可降级/停报/不降级）。
4. **频控单测**：虚拟时钟下 18 分钟边界（17:59 拒、18:01 放）。
5. **活体验收**：每波一次性，全部真实平台，证据规格 Q21；不进 CI。
6. 测试文件放 `packages/api-publish-engine/test/`，命名 `<platform>-api-chain.contract.test.js` 等；遵循本仓既有「既有严格单测上扩展新功能的TDD红绿与可桩方法模式」。

---

## 9. 波次计划与验收标准

| 波次 | 交付 | go 判据 | no-go/回退 | 验收证据 |
|------|------|---------|-----------|----------|
| W1 | core/* + signer/registry(含 Q16 拆除) + publishMode 闸 + 视频号/B站视频链 + 百家号文章链 | 契约单测全绿 + 品牌/locale 门禁过 | 单平台活体连续失败 → 该平台回 dom-rpa，波不阻塞其余 | 3 平台 × {作品ID,链接,回查截图,degraded=false} |
| W2 | 抖音链（本地 clientSign + 空 a_bogus） | 空 a_bogus 活体通过 ≥1 次发布 | 触发风控 → 抖音回 dom-rpa 并评估 a_bogus 公开算法逆（另立方案，不在本 wave 承诺） | 同规格 1 平台 |
| W3 | 签名页基建 + 快手 spike 门禁 + （spike 过）快手/小红书 | spike 三步全过 | **spike 不过即止步**（决策账 Q19），基建合并与否按代码可用性单独评审 | spike 比对记录 + 活体发布证据（若过） |
| W4 | 头条号文章 + 知乎（**视频+文章**，链自包含性 W4 前置取证） | 知乎/头条取证无外包签名 | 取证发现依赖外包签名 → 并入签名页契约或回 dom-rpa | 2-3 链 × 同规格 |

每波独立：worktree `mp-api-publish-w<N>`（`session-init.sh api-publish-w<N>`）→ TDD → PR → CI → autoMerge → 活体验收 → 证据 PR 回写。W2 启动前依据 W1 活体结果修订本方案（允许砍 wave）。

---

## 10. 合规与安全门禁

- `grep -R "refpub\.cn" apps/desktop packages/api-publish-engine` 必须为空（提交前本地跑 + CI）；签名白名单域表硬编码校验（`signer/page-runner` 只允许矩阵中平台域）。
- 逆向切片证据仅存 `01-docs/rpa-api-publish/evidence/`（文档域，不进任何运行时代码/安装包 `files` glob）。
- 抽取的签名函数**绝不序列化**：CI 增加断言扫描 `packages/`、`apps/` 内无 `__mpSigner`、无 kuaishou sig 相关字符串常量。
- 发布行为合规：AI 内容声明字段保留（现 kuaishou adapter 的 `ai_generated` 逻辑平移进新链，不丢失）。
- 质量节拍：每波提交前 `.quality-gates.md` 自检；locale 成对（Gate 7）；分支守卫（expected-branch）。

---

## 11. bundle 定位索引 v2（增量，供后续补提）

| 函数 | 偏移 | 状态 |
|------|------|------|
| getSignServerUrl | @591720 | v1 已提取 |
| 视频号 getUploadAuthKey / applyuploaddfs / uploadpartdfs / complete(getUploadedVideoInfo$4) / publish | @983820 / 984912 / 986392 / 996037 / 1092626 | ✅ v2 已提取 |
| B站 publishBilibiliVideo / preupload(getUploadIdResponse$3) / add | @1466868 / 1456530–1457983 / 1462478 | ✅ |
| 百家号 token 链 / uploadproxy | @1841535 / 1842459 / 1857820 | ✅ |
| 抖音 create_v2 / clientSign / getSdkToken(HEAD) | @2672901 / 2673851 / 1525855 | ✅ |
| 快手 getSign$5 / sig3 用法 / 分片 / publish | @1341838 / 1342665 / 1386455 / 1389174 | ✅ |
| 知乎 publishArticle / publishVideo / publishDynamic / 聚合 | @2106013 / 2119327 / 2126523 / 2132700 | ✅（动态/聚合段仅头 900B，W4 补全） |
| 小红书完整发布链 | 聚合 `getXiaohongshuProMessage` 附近 | ⏳ W3 前置补提 |
| 头条号文章发布链 | @1732179 区（toutiaohao 签名上下文） | ⏳ W4 前置补提 |

---

## 12. 关联文档

- `01-docs/PRD-API-PUBLISH-ENGINE.md` — 总 PRD（P0/P1/P2、验收标准全文）
- `多账号API发布技术方案-v1.md` — 原始逆向调研（保留）
- `evidence/yx-slices-v2.txt`、`evidence/yx-slices-v2b.txt` — 逐字切片
- `openspec/changes/api-publish-engine-w1/` — W1 change 契约


## 11. 修订记录

| 日期 | 波次 | 变更 | 佐证 |
|------|------|------|------|
| 2026-09-23 | W1 §2 | 签名收口进程内注册表 `src/signer/registry.js`（fail-closed），门面物理拆除远程签名通道（端点覆盖/远程取签/端口映射/axios 直连全删），`getDouyinSignature`/`getKuaishouSignature` 向后兼容 | PR#2307 `db7d4188ca`；signer 16 测全绿；源码 grep 远程 token 零残留 |
| 2026-09-23 | W1 §3 | 新增 `src/publish/core`：`http-base`（timeout60s+风控重试!isJson≤3+代理注入+PublishHttpError对齐error-codes）、`chunker`（8MiB闭区间三边界）、`emit-gate`（10%里程碑/5s时间节流/幂等补100）；契约假服务器 `test/helpers/fake-http.js` | PR#2307 `e808fc37cb`；17 测全绿 |
| 2026-09-23 | W1 §5 | 新增 `publish-spacer`（同账号≥18min虚拟时钟）+ `publish-mode`（三态总闸降级矩阵，风控/登录失效停报不降级不换号） | PR#2307 `b9b260d298`；15 测全绿 |
| 2026-09-23 | W1 §4.1 | 新增视频号视频发布链 `src/publish/platforms/shipinhao-video.js`（委托 publish/core，注入 api/cdn 双客户端）：authKey(helper_upload_params)→applyuploaddfs(BlockSum/BlockPartLength,X-Arguments scene=2)→uploadpartdfs(8MiB 分片,Content-MD5=md5,scene=0)→completepartuploaddfs(PartInfo ETag)→post_create/post_draft(私密优先)；缺 cookie/文件不存在/authKey 缺失 fail-closed 零请求 | PR#2307；`shipinhao-video-chain.test.js` 7 测全绿；全量回归 17 文件/119 测绿；PRD §12.2 |
| 2026-09-23 | W1 §4.3 | 新增百家号图文发布链 `src/publish/platforms/baijiahao-article.js`（委托 publish/core）：baseToken(`/?source=inner` 正则)→publishToken(`pcui/article/edit` 响应头)→uploadproxy→私密优先 `save?callback=bjhdraft`/正式 `publish?type=news`；标题 149 字节截断；缺 cookie/UA、baseToken 未命中 fail-closed 零请求；errno=10000015 风控停止不降级 | PR#2307；`baijiahao-article-chain.test.js` 8 测全绿；全量回归 16 文件/112 测绿；PRD §12.1 |
| 2026-09-23 | W1 §4.2 | 新增B站视频发布链 `src/publish/platforms/bilibili-video.js`（委托 publish/core，注入 api/cdn 双客户端，改走 requestWithRetry 获风控 HTML 重试）：preupload?r=probe→preupload(逐线路)(auth/endpoint/upos_uri/biz_id,601 抛风控)→init `?uploads`(X-Upos-Auth)→8MiB 分片 PUT(status>204 抛,读 etag 去引号)→complete `?output=json&name`(parts→location)→私密优先 `/x/vupre/web/draft/add`/正式 `/x/vu/web/add/v3`(csrf=bili_jct 进 query+body)；buildUposTarget 解析 upos://bucket/object；去「自动发布」水印；缺 cookie/UA、文件不存在、probe 无线路 fail-closed 零请求；-1025/-1026 登录失效、601 风控停报不降级 | PR#2307；`bilibili-video-chain.test.js` 7 测全绿；全量回归 18 文件/126 测绿；PRD §12.3 |
| 2026-09-23 | W1 §4.4 | B站适配器 `src/adapters/bilibili.js` 变薄委托新链 `BilibiliVideoChain`（153→76 行，净 −58）：uploadVideo/buildPostData/_buildBase/publish 全部转发链，HTTP/upos 单一事实源归链层；链导出模块级纯函数 `buildBilibiliPostData`/`buildUposTarget`/`cleanBilibiliText` 去重；publish 对外固定正式发布(draft:false)、私密草稿交由 §5 服务层；外部接口不变(base execute/progress/error 映射保留)。约束：链用相对URL+自带baseURL，适配器不注入 this.http。`bilibili-upos.test.js` 迁移为「_chainOverride 断言委托转发」，发布网络语义由链假服务器测覆盖。视频号(走 upload/orchestrator)、百家号(旧视频链 vs 新文章链，Q14 属行为变更)待后续切片；AI 声明字段 aigc_bjh_status 平移要求记入 PRD §12.4 | PR#2307；全量回归 18 文件/127 测绿；PRD §12.4 |
| 2026-09-23 | W1 §4.4 视频号 | 视频号适配器 `src/adapters/shipinhao.js` 由 20 行 placeholder（走 upload/orchestrator）改写为 66 行变薄委托新链 `ShipinhaoVideoChain`：uploadVideo(authKey→applyuploaddfs→逐片 uploadpartdfs 8MiB/Content-MD5→completepartuploaddfs 返 {uploadId,videoInfo})/buildPostData(委托模块级纯函数 buildShipinhaoPostData，链 run 复用去重)/publish(post_create 固定 draft:false，链 platform=shipinhao 映射回外部名 tencent_video) 全部转发链，HTTP/CDN 传输单一事实源归 publish/platforms；外部接口零改动(super name=tencent_video、getReferer/getOrigin/getHeaders、base execute/progress/error 映射保留)；uploadCover→null(抽帧无独立封面链)。空上传返 null、文件不存在抛 SPH_NO_FILE fail-closed 零请求。约束同 B站：链用相对URL+自带baseURL，适配器不注入 this.http；upload/orchestrator 系 8+ 适配器共享模块不改动仅 re-point。新增 shipinhao-adapter.test.js(8 例委托断言)+链假服务器测(7 例)；全量回归 19 文件/135 测绿。百家号(旧视频链 vs 新文章链，Q14 属行为变更)待专轮；AI 声明字段 aigc_bjh_status 平移要求记入 PRD §12.4 | PR#2307；PRD §12.4 |
| 2026-09-23 | W1 §5.2 | 新增双轨发布服务层执行包装 `src/publish/core/publish-mode-runner.js`：`createPublishWithMode(deps)` 把 §5.1 决策核 decideRoute 与实际执行缝合——读 mode(三态总闸)→spacer 18min 闸门(不放行即返 track:throttled+waitMs、零请求)→跑 apiPublish→outcomeOfResult 归一(success/risk_blocked/login_expired/unsupported/transient_error，显式标志>具名错误码 BILI_RISK_601/10000015>文案正则，保守宁停不绕)→再决策：success 留 API、risk/login 停报绝不降级绝不换号(合规红线)、transient/unsupported+api-then-dom 降级 DOM、api-only 任何失败停报；降级必发结构化日志 {degraded,reasonCode}。全注入(apiPublish/domPublish/getMode/spacer/logger)便于零外发单测。区别于旧 api-router.publishWithFallback(非模式驱动、风控也回落)。新增 publish-mode-runner.test.js(19 例)；全量回归 20 文件/154 测绿。待办:§5.1 platforms.yaml 落 publishMode 由服务层 getMode 实读、§5.4 risk 挂起+通知、与本包装和 index.publishViaApi 接线成产品入口 | PR#2307；PRD §12.5 |
| 2026-09-23 | W1 §5.1 落 publishMode + getPublishMode | config/platforms.yaml 逐平台新增 publishMode（三态 api-only\|api-then-dom\|dom-only，W1 三平台=api-then-dom，其余=dom-only，独立于 has_api）；api-router.getPublishMode(platform) 字段优先→has_api 派生→normalizeMode 归一（非法值抛错 fail-closed），供 §5.2 getMode 接线。新增 publish-mode-config.test.js（读真实 yaml） | PR#2307；PRD §12.6 |
| 2026-09-23 | W1 §5.4 风控挂起 risk-suspender | 新增 src/publish/core/risk-suspender.js：createRiskSuspender({clock,notify,logger}) 纯内存、账号级挂起（默认只锁触发风控的账号，不误伤他号；支持平台级）、幂等单次通知、显式 resume/clear、无自动恢复。与 §5.2 联动：入口 isSuspended 守卫零请求 short-circuit（track:suspended / risk_suspended）、risk_blocked 停报即 suspend、login_expired 不挂起；riskSuspender 可选注入向后兼容。新增 risk-suspender.test.js（14 例，含 5 联动） | PR#2307；PRD §12.6 |
| 2026-09-23 | W1 §5 服务入口装配 publish-service | 新增 `src/publish/publish-service.js`：`createPublishService(deps)` 把 §5 四件套（getMode/spacer/publishWithMode/riskSuspender）组装成产品级服务；`index.js` 装配单例（apiPublish=publishViaApi、getMode=apiRouter.getPublishMode、onRiskEvent→logger）并导出 `publishWithMode`/`publishService`/`getPublishMode`。apiPublish 注入规避 index↔api-router 循环、可零外发单测；domPublish 由每次 opts.rpaPublish 提供，缺省走 requiresDom。publishWithFallback 保留兼容、不再推荐。新增 publish-service.test.js（10 例）。| PR#2307；PRD §12.7 |

> 详细实现契约（模块签名、数据校验、错误/提示语义、测试矩阵）见
> `01-docs/PRD-API-PUBLISH-ENGINE.md` §11。§4 三平台链、§6 UI 接线、§7 活体验收
> 在本基座之上继续；W2 启动前依 W1 活体结果再修订本方案。
