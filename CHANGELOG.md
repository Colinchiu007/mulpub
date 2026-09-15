# [未发布] refactor(signer): 签名本地化收口——移除第三方远程签名依赖（2026-09-15）

### 背景
- `packages/api-publish-engine/src/signer.js` 的 `SIGNER_BASE` 指向第三方远程签名服务（复刻自参考产品客户端的调用方式）：客户端把签名原料发到别人服务器换取签名参数——**明文 HTTP、发布元数据外发、无 SLA**，属非正常调用方式。
- 依赖面复核：真实运行时只有**抖音 / 快手**两个 API 直调适配器在用且**均有本地回退**；`getBaijiahaoSignature`（无本地回退）与 `getXiaohongshuToken` 无任何生产调用方——#1837 时代"百家号硬依赖"的判断不成立（只看了函数设计、没验证调用链）。

### 变更
- **快手 `__NS_sig3` 本地计算**（`MD5(api_ph|body)`，`api_ph` 取自登录 cookie），`kuaishou.js` 适配器补传 cookie。⚠️ 复核发现此前未传 cookie，本地兜底恒产出**空签名**——"远程失败即本地兜底"从未真正生效
- **移除无生产调用方的远程函数**：`getXiaohongshuToken` / `getBaijiahaoSignature`；移除小红书/百家号/头条端口映射
- **抖音 `_signature` 默认纯本地**（本地实现为「浏览器参数 + 占位签名」，真实有效性待真机发布验证）；`MP_SIGNER_BASE` 环境变量转为**验证对比通道**（设置后远程优先、本地兜底）
- `signer.test.js` 重写：端口表（仅抖音）/ 导出面（死代码断言为 undefined）/ 本地计算正确性 / 验证开关行为
- 文档修正：`PRD-NAMING-NORMALIZATION` §3.1 两阶段行为变化 + §2.4/§6 被"叠词修正规则"误改的描述恢复、`phase-6-integration-decision` 决策更新、`learnings` 新增「依赖面结论必须落到调用链」教训

### 行为变化（需真机发布验证）
- 默认**不再对任何第三方服务器发起请求**；抖音/快手 API 直调发布完全依赖本地签名算法
- 验证方式：设置 `MP_SIGNER_BASE`（远程优先）与不设置（纯本地）各真实发布一条，对比签名通过率
- 如本地签名被风控拦截：短期设 `MP_SIGNER_BASE` 恢复远程路径；长期需提取参考产品签名 JS 在主进程内本地执行（路 A）

### 验证
- `packages/api-publish-engine` `node scripts/run-tests.js` → **11 个测试文件全绿**（signer.test.js 重写 + e2e 链路 mock 兼容）
- 品牌残留门禁 PASS（5452 个 tracked 文件）；`check-frontend-consistency` / 债务熔断 PASS

---
# [未发布] refactor(auth-gate): 登录门禁判定抽取共享工具并推广到数据看板（2026-09-15）

### 变更
- **共享工具**：新增 `apps/desktop/src/utils/auth-gate.js` 导出 `isAuthGateResult()`（errorCode 优先判定，code:-3 仅在无 errorCode 时兜底；ENTITLEMENT_REQUIRED 不误判），`PublishHistory.vue` 改为引用
- **数据看板**：`Dashboard.vue` 对 `dashboard:stats` / `history:list` 的 AUTH_REQUIRED 不再静默吞掉——显示「登录后可查看发布统计与最近发布」引导条 +「去登录」按钮（`identity.signIn`），登录成功 `watch(isAuthenticated)` 自动重载；权益不足保持既有路径不误判
- **文档**：`01-docs/PRD-PUBLISH-HISTORY-LOGIN-GATE-2026-09-15.md` 增补「范式推广」章节

### 验证
- 新增 `auth-gate.test.js` 5 例、`Dashboard.test.js` 4 例（门禁态 / 去登录触发 signIn 且自动重载 / 正常态无横幅 / 权益不足不误判）；`PublishHistory.test.js` 23 例回归全绿
- `check-locale-sync.js --keys` / `--cjk` PASS；eslint 0 errors