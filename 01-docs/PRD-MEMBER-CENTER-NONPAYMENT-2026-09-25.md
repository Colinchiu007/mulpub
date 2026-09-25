# PRD：会员中心非支付遗留批次（Member Center Non-Payment Batch）

- 日期：2026-09-25（补写，交付后收口文档）
- 状态：已交付（除支付外全量完成；支付卡商务侧询价暂缓，另立阶段 2 spec）
- 关联设计：`01-docs/DESIGN-MEMBER-CENTER-2026-09-23.md`（信息架构/权益矩阵/后端底座）、`01-docs/DESIGN-MEMBER-CENTER-P2-PAYMENT-2026-09-24.md`（支付阶段 2）

## 1. 背景

会员中心 P1 服务端底座（#2314）与前端 flat 卡片（P1-frontend）落地后，仍存在一批非支付遗留：
权益展示双源不一致（本地 licenseStore vs 服务端 entitlement）、七栏信息架构未落地、
消息中心/设备管理前端未接线、运营后台缺少权益开通与兑换码批量签发闭环。
本批次在不引入真实支付的前提下收口上述缺口。

## 2. 目标用户与核心价值

- 终端会员：在会员中心查看与自己服务端权益一致的计划/配额/订单/消息/设备，管理账号安全。
- 运营人员：通过 ops-center 手动开通订阅（C2）与批量签发兑换码（C1）完成变现闭环（无支付通道版）。

## 3. 交付清单与 PR 映射

| 项 | 内容 | 载体 | 状态 |
| --- | --- | --- | --- |
| A2 | entitlement 单一真源收敛：版本卡/升级 CTA 以服务端 `entitlement.plan/expiresAt` 为准，缺失回退本地 `licenseStore` | desktop renderer，PR #2385（MERGED） | ✅ |
| C1 | ops-center 兑换码批量签发入口（批次生成） | `ops-center` RedemptionCodes 视图 + admin API（前序批次已在 main） | ✅ |
| C2 | ops-center 会员权益开通：手动订阅开通转发 engine admin grant | PR #2389（MERGED，含 Gate16 字号修复） | ✅ |
| C3 | 消息发布用户级投放 | 用户侧接收/已读经 A1 消息中心子视图承接；运营侧投放复用 ops-center 下发通道 | ✅（随 A1） |
| B1/B2 | 设备管理（列会话/注销其它）与消息中心（列表/标记已读） | 服务端端点 P1 底座已存在；前端接线并入 A1 | ✅（随 A1） |
| A1 | 会员中心七栏壳：`MemberCenter.vue` 重构为壳层（左导航 + 右 `<component :is>`），拆出 Overview/AccountSecurity/Subscription/OrdersBilling/UsageQuota/Messages/HelpSupport 7 子视图 + labels.js；新增 `member` store 与 electron `member-api-service`（工厂组合挂载，IPC 4 通道带 sender 校验）；locales zh/en 成对 +24 key | PR #2395 | 🚀 auto-merge armed |

A1 同时移植 A2 单一真源回归至新架构：壳层升级 CTA 门控 3 例 + `Overview.test.js` 版本卡标签/徽标/回退 3 例。

## 4. P0 验收标准（本批次）

1. 未登录 → 仅登录引导；`status==='disabled'` → 身份服务未启用提示；登录 → 七栏导航可用，默认概览。【A1 ✅，壳层测试】
2. 权益单源：登录且有 entitlement 快照时，升级 CTA/版本卡标签以 `entitlement.plan` 为准；快照缺失回退本地 licenseStore。【A2 #2385 + A1 移植回归 ✅】
3. 设备管理可列活跃会话并「注销其它设备」；消息可列表/全部已读，导航消息栏带未读角标。【A1 IPC 接线 + member store 6 测试 ✅；真实链路联调随发布验证】
4. 运营闭环：ops-center 批量签发兑换码、手动开通订阅转发 engine grant。【C1/C2 已合并 ✅】
5. zh/en 成对（Gate7）；QG 静态门禁全 PASS（Gate14/15c/16/max-lines/frontend-consistency）；`build:vue` 成功；QM-1 `electron-builder --win --x64` exit 0 且 stderr 无黑名单错误。【A1 ✅】
6. 既有场景不回归：identity 全目录 + renderer 相关 186/186 绿（合并 origin/main 后复验）。【✅】

## 5. 非功能需求与约束

- auth-service.js 处于 499/500 行边缘：会员 API 客户端以工厂组合挂载（`authService.memberApiService`），禁止再向 AuthService 门面加行。
- 测试壳/视图边界：`MemberCenter.test.js` mock `member-center/views`，被测 data-testid 一律落壳层；`MEMBER_SECTIONS` 为壳层本地常量。
- IPC 参数纯 JSON、通道带 `withSenderCheck`；未登录/无 API 时 store 安全降级。
- CSS 全 token 化，新增语义色复用 `--soft-stone` 等已定义 token，不引入 `--bg` 类未定义变量。

## 6. 范围外（后续）

- 真实内嵌支付/自动续费/退款 webhook（阶段 2，见 P2-PAYMENT 设计）。
- 订单表真实支付流水（当前订单/账单以服务端记录为准，支付渠道接入后回填）。
- 团队协作、API Key 迁移等企业能力（设计 §1.3 非目标）。
