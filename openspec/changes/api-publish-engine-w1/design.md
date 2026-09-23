# Design: api-publish-engine-w1

> 完整实现基线见 `01-docs/rpa-api-publish/多账号API发布技术方案-v2.md`（含 21 问决策账、逐平台 API 序列、bundle 偏移索引与逐字切片附录）。本文只收敛 W1 架构决策要点，不重复之。

## Context

- 逆向事实源 bundle 在盘（`D:\Data\refpub-bundle\packages\main\dist\index.cjs`），W1 三平台 API 序列已有逐字切片（`01-docs/rpa-api-publish/evidence/yx-slices-v2*.txt`）。
- 现有 `packages/api-publish-engine` 的 adapters 为未验证猜测骨架（含 fabricated endpoint），本次以真实链替换；`signer.js` 有远程对比后门需拆除。
- DOM RPA 老链（`apps/desktop/electron/services/rpa-view-platforms.js`）保持可用作降级目标，本期零改动。

## Goals / Non-Goals

**Goals**：W1 三平台 API 链 + 签名注册表收口 + publishMode 路由 + 18min 频控 + 契约测试基建 + 显示项/locale。
**Non-Goals**：抖音（W2）、签名页基建（W3）、头条/知乎（W4）、DOM 路径删除、海外平台。

## Decisions（摘要，全量见技术方案 v2 §1 决策账）

1. **落地位置**：`packages/api-publish-engine/src/publish/{core,platforms}` + `signer/{registry,local}`；旧 adapters 变薄委托。理由：单引擎，避免双发布系统并存（决策 Q2）。
2. **HTTP 基座**：axios 工厂，timeout 60s，`retryCondition = res => !isJson(res.data)` ≤3 次；实例可注入（假服务器测试）。风控识别信号 = 非 JSON 响应。
3. **签名**：进程内 registry，`{signCommand,payload}→signature`；未知 command 抛错 fail-closed；W1 全部本地实现（md5/csrf/token）。`MP_SIGNER_BASE`/`getRemoteSign`/`SIGNER_PORTS` 物理删除（红线）。
4. **双轨路由**：electron 服务层 `publishWithMode()` 读 `config/platforms.yaml.publishModes`；降级矩阵三类（可降级/停报/不降级）；降级写 `degraded:true+reasonCode` 结构化日志。
5. **频控**：队列调度层记录 `lastSubmitAt[accountId]`，虚拟时钟可测。
6. **测试**：本机临时 HTTP 假服务器（Node `http.createServer` on 127.0.0.1:0）+ 请求序列断言器；沿用仓内 PromptBridge「真实 HTTP 覆盖包装响应」先例；禁止 VCR/登录态夹具。
7. **UI**：发布记录「发布方式」徽标 + 风控挂起通知（恢复/停止），文案 locales `publish.api.*` zh/en 成对；IPC 参数 `JSON.parse(JSON.stringify())` 脱壳按既有规范。

## Risks / Trade-offs

- 参考产品链与平台现状可能已漂移 → 契约测试只钉「请求侧合同」，响应语义靠 W1 活体验收一次性校准；失败面被 publishMode 总闸封闭（随时掐回 dom-rpa）。
- `getSign$5` 等 Tier-B 实现本期不建 → registry 预留注册接口即可，避免过度设计。
- electron 接线若触 `apps/desktop/electron/` → 触发 QM-1 打包验证三件套（打包+asar list+8s 启动）。

## Migration Plan

1. 新链单测全绿后替换旧 adapter 内部实现（外部接口不变，调用方无感）。
2. `platforms.yaml` 默认对未入波平台写 `dom-rpa`，行为与升级前一致；回滚 = 全平台改 `dom-rpa`（配置级回滚，无需 revert 代码）。

## Open Questions

- 视频号/B站/百家号私密/草稿档的确切参数名 → W1 编码期以切片原文取证确定（技术方案 §7.3 已定策略，不阻塞开工）。
