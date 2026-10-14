# Rebuttal — B1 PRD 后端轴评审回应（2026-10-14）

> 出方案方：opencode-hosted（step-5-preview）｜评审方：claude（session cebf1a2d）
> 回应规则：接受/部分接受/拒绝 + 证据；拒绝须给证据

## 逐条回应（8 条，全部接受）

### F1（严重）D1 选型②未覆盖注入时序竞态

**回应：接受（L1）。** 评审指出的窗口期真实存在：preload 自身早失败（require 挂/同步抛错）时，页面 JS 已读到原生 navigator，而我的「marker 读回观测」确属 post-hoc——检测晚于损害。

**落修订（PRD v1.1）**：
1. **注入顺序重构**：preload 首行先做最小 navigator patch（`Object.defineProperty` 一处，独立 try/catch，失败不阻断后续），其后才是完整 evasions——最高价值 evasion 的暴露面最小化
2. **inj-start marker 提前**：marker 在注入第一行同步写入（早于 evasions），读回可区分「preload 未执行/注入首行失败/evasions 部分失败」三态
3. **变异反证新增**：「注入延迟注入」变异——把注入推迟到 setTimeout 500ms，测试必须红（锁 document_start 语义）
4. 降级语义保留：marker 三态缺失 → warn + 正常发布不阻断（损害已发生时的兜底）

### F2（严重）D3 contextId 缓存失效边界缺失

**回应：接受（L1）。** 我只列了 SPA 导航，漏了 iframe（独立 frameId/contextId）、弹窗（新 renderer 需重新 create）、preload 崩溃后 contextId 悬挂。

**落修订**：
1. 缓存键改 **frameId + documentId 双键**；`did-navigate` / `did-navigate-in-page` 触发清理重建
2. **v1 范围显式声明**：仅 top frame；检测到多 frame DOM 作用域的场景（iframe 内选择器）→ warn + 回落 main world（不做 iframe 内 isolated 执行）
3. 弹窗（`window.open` 新 renderer）：v1 不在通道内（RPA 发布流无弹窗依赖；如出现按未覆盖 warn）
4. contextId 悬挂：execute 前 `Runtime.evaluate` 探活，失败即重建（一次性）

### F3（警告）「不动 exposeBinding」范围不可执行

**回应：接受（L2）。** 文字声明锁不住后人扩范围。

**落修订**：exposeBinding **白名单硬编码守卫**——代码内 `BINDING_ISOLATED_ALLOWLIST`（空或仅明确列举的通信 API 可入 isolated 路径）+ 测试断言「allowlist 外 API 走 isolated 必须抛错」，范围声明从文档升格为机械锁。

### F4（警告）sha256 信任来源未见

**回应：接受（L1）。** 「下载后校验 sha256」若 hash 与二进制同出一元（同 CDN）确实不增安全——我原设计有 TOFU 盲区。

**落修订**：hash 信任链三层——①**签名优先**：官方发布带 PGP 签名/证书的渠道优先验证签名；②**双路交叉**：GitHub Releases API 返回的官方 metadata 与 npm 包锁文件两路独立取 hash，不一致即拒；③manifest 明示「spawn 前复检防磁盘篡改、不防首次下载污染」，trust-on-first 的信任锚=上述两路中的任一路未被同时攻破。camoufox/yt-dlp 等所有外部二进制同一纪律。

### F5（严重）ddddocr sidecar 本地 HTTP 端口无鉴权

**回应：接受（L1）。** ddddocr 的 `api/server.py` 自带 uvicorn，默认可能 0.0.0.0：端口——且截图含账号/发布内容。

**落修订**：①**强绑 127.0.0.1**（自托管路由启动参数覆盖默认）；②**随机 token header 鉴权**（Electron 侧启动时生成并持有，sidecar 校验）；③**onnx 权重 LICENSE 核验**写入 manifest 流程（FIND-7 的三件套已含模型许可，此处显式到 ddddocr 的 common.onnx 等 4 个权重文件）；④**截图仅内存不落盘**（IPC 直传 base64，sidecar 不写临时文件）声明入 PRD。

### F6（警告）风控判定归属未定义

**回应：接受（L2）。** 「拦截」的判定主体确实未定义——自动映射误判网络错误，人工标注不可规模化；且 A/B 错峰与同账号队列排他的相互作用我没算清（TaskQueue 同 `(platform,accountId)` 通道天然串行，「同任务同账号错峰」在通道语义下实际是排队而非并行）。

**落修订**：①**分层归类判定器**（入 B1 实现）：平台返回状态码 + 失败模式（风控页 DOM/验证码出现/审核拒绝文案）→ 三分类 风控/非风控/未知；未知进人工抽检队列；②A/B 设计勘误：同账号双通道在 TaskQueue 通道串行语义下**本就是纵向交替**（天然满足 pair+ctrl），「错峰」措辞改为「交替轮次 + 排他由通道调度保证」；③数据口径契约表格同步修正该表述（与原 v3.2 计划文档不符处以本 PRD 为准，回填计划）。

### F7（警告）测试计划缺口

**回应：接受。** 落修订：①PR-2 加**打包体积阈值 CI 断言**（dddddocr 栈 <=250MB，超限即红——防预算静默失控）；②**sidecar 生命周期进程级单测**（真实 spawn python-backend 子进程测端口冲突/退出清理/健康检查，不 mock 进程本体）；③**i18n 键一致性扫描**接 CI（captcha 三处 PHASE_ENUM 同步 + zh/en 成对 + 死键）。

### F8（信息）QM 映射与三重锁真源

**回应：接受。** 落修订：①PRD 加「QM 映射」列——每 F 标注必经 QM 条目与验收路径（QM-1/2/6/视觉 N/A）；②evasions 三重锁明确**单一真源 = npm 包版本**，sha256+产物快照是防回归冗余（杜绝「三重无权威」歧义）。

## 收敛状态

- 后端轴 8 条全部接受，修订点全部明确到 PRD 章节级
- 前端轴（opencode）评审 stdin 重试中（首次长中文 argv 被 opencode CLI 吞掉）
- 两轴齐后：PRD 升 v1.1 → 若仍有 Critical 再修 → 收敛判据 = 无未修 Critical/Warning → 推送（PRD+openspec change+spike 证据，docs-only 流程）
