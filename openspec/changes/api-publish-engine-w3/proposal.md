# Proposal: api-publish-engine-w3（签名页基建 + 快手 sig3 spike 门禁 + 快手/小红书链，F12/F13 / M3 裁决波）

## Why

W1（三平台链+双轨+注册表）与 W2（抖音准自包含链，PR #2370 squash 合并 `fcb46982`，CI 15 checks 全绿）已合并 main。W3 的使命是 PRD P2/F12+F13 与技术方案 §4/§9：快手 `__NS_sig3` 与小红书 `x-s/x-t` 均为**外包签名**（bundle 取证证实生成逻辑在服务端 VM，回源不可得，切片证据 `yx-slices-v2.txt @1341838/@1342665/@1343225`），决策账 Q7/Q13 已锁定唯一合规路径——**Tier-B 浏览器辅助签名页**（应用内隐藏签名页 + webpack 模块抽取 + 拦截法一致性双验证，函数句柄只存内存）。W3 内置**止损阀（Q19/M3，时间盒 1 个工作日）**：spike 三步（抽取/比对/活体直发）任一失败即止步，快手/小红书保持 DOM RPA，失败面已封闭。现有 `adapters/kuaishou.js` 的 `__NS_sig3` 参数仍指向被禁的远程签名通道形态，与合规墙冲突，spike 通过后必须换血。

## What Changes

- **签名页基建（新增，main 进程）**：`apps/desktop/electron/` 新增 signer-page 模块——`session.fromPartition('persist:signer-<platform>')` 复用登录会话 partition（partition 复用方式为本波 spike 验证项之一）、常驻隐藏 `BrowserWindow({show:false})` 加载平台创作者域真实页面、`will-navigate`/`setWindowOpenHandler` 锁死本平台域、白名单 IPC `signer:invoke`（`{signCommand, payload}` 形态，renderer 无任意 JS 求值通道，Q17①）。
- **函数抽取器 + 双验证（新增）**：页面上下文经 `window.webpackChunk*` push 劫持取 `__webpack_require__`，按特征码扫描定位签名模块，句柄存页面内受控槽位（`window.__mpSigner.<key>`，仅内存）；hook `XMLHttpRequest/fetch` 对页面真发请求同 payload 复算比对，一致才登记 `verified`；求签异常 → reload+重抽取（限流 ≤3 次/小时，超限 `signer.degraded=true` → 该平台落 DOM RPA 并报告）。
- **M3 spike 门禁（裁决写死）**：时间盒 1 个工作日，三步：① `cp.kuaishou.com` 登录态完成 webpack 抽取抠出 sig3 函数；② 拦截法比对同 payload 本地复算 == 页面真发 `__NS_sig3`；③ 复算签名直发一条真实 API（活体）。**任一失败 → go 判据不成立**：本波快手/小红书发布链代码不合并（隔离分支留存），仅评审签名页基建可用性；platforms.yaml 不动。
- **（spike 通过后）快手视频链**：`publish/platforms/kuaishou-video.js`——getUploadArgs → 分片上传 → complete（**特判 `result∈{1,109}`**，109→login_expired 不降级）→ 封面 → 发布提交（`__NS_sig3` 经 signer 注册表新 provider `browser-page` 求签拼接；`ai_generated` 声明字段从现有 adapter 平移不丢失，Q4/§10）；`KuaishouAdapter` 变薄委托（§4.4 模式）；platforms.yaml kuaishou `publishMode` 翻转 api-then-dom。
- **（spike 通过后）小红书链**：前置补提完整链切片（现有证据仅 `getXiaohongshuProMessage` 段）→ `publish/platforms/xiaohongshu.js`（`x-s/x-t` 走同一签名页基建）→ Adapter 委托 + publishMode 翻转。取证发现链不可钉（字段面缺口过大）→ 小红书并入 W4 或止步，波不阻塞快手。
- **签名注册表扩展**：`api-signer-registry` 既有契约 `{signCommand, payload} → signature` 不变，新增 `kind:'browser-page'` provider 实现（经进程内 IPC 桥接签名页），⛔ 绝不引入任何远程 HTTP 签名通道（Q16 拆除形态保持，`MP_SIGNER_BASE` 类零命中门禁扩展覆盖）。
- **CI 断言扩展**：`packages/`、`apps/` 运行时代码无 `__mpSigner` 字符串常量硬编码（槽位名仅存在于注入脚本模板）、无快手/小红书签名服务 URL 形态常量（§10 门禁落地）。
- **QM-1 强制**：本波触碰 `apps/desktop/electron/` → 每次修改后打包三件套（builder --dir → asar 清单/require 链 → exe 8s 存活捕获 stderr）不可豁免。

## Capabilities

### New Capabilities

- `api-publish-signer-page`: Tier-B 浏览器辅助签名页基建——隐藏窗口生命周期、登录 partition 复用、域锁与安全边界、webpack 抽取与特征码登记、拦截法双验证、白名单求签 IPC、自愈与限流降级、M3 spike 三步门禁行为。
- `api-publish-kuaishou-chain`: 快手视频 API 发布链——上传/提交请求契约、result 语义码（含 109 登录失效）、sig3 经签名页求签拼接、AI 声明字段保留、风控即停不降级。
- `api-publish-xiaohongshu-chain`: 小红书 API 发布链——x-s/x-t 经签名页求签、完整链字段契约（以补提切片为准）、前置取证不满足时的止步行为。

### Modified Capabilities

- `api-publish-chain`（W1 delta）：新增「签名请求经进程内 provider 抽象分派（local / browser-page 两类），browser-page 路径不得引入远程签名通道」的 Requirement 级约束（注册表契约形态扩展，非破坏性）。

## Impact

- `apps/desktop/electron/`：新增 signer-page 管理模块 + preload/IPC 白名单登记（→ QM-1 强制、修改 preload 后 sandbox 两模式验证）。
- `packages/api-publish-engine`：`signer/`（browser-page provider）、`publish/platforms/kuaishou-video.js`/`xiaohongshu.js`（新增，spike 后）、`adapters/kuaishou.js`/`xiaohongshu.js`（变薄委托，spike 后）。
- `config/platforms.yaml`：kuaishou/xiaohongshu `publishMode` 翻转（仅 spike go 时）。
- 测试：签名页抽取/比对/降级用「本机假 webpack 页面 + 假平台域（127.0.0.1 hosts 注入或 partition 隔离测试窗口）」钉契约；全离线零外发；活体三步在用户在场窗口执行。
- 文档与证据：spike 比对记录 + （若过）活体证据入 `01-docs/rpa-api-publish/evidence/api-w3-<platform>/`；PRD F12/F13、M3 裁决回写 techdoc v2 修订记录。
- 风险：sig3 抽取失败为**预期内合法结局**（止损阀），失败面已封闭（留 DOM）；签名页基建与业务链解耦——spike 止步时基建按代码可用性单独评审是否合并；桌面 Electron 改动引入打包回归面（QM-1 覆盖）。
