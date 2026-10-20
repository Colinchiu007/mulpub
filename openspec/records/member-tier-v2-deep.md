---
record: member-tier-v2-deep
task: 会员档位机制 v2.0 深度版——可执行门禁面、价格结构经济学、额度工作负载校准（含两轮专项调研）
date: 2026-10-19
type: docs-only
---

# 会员档位机制 v2.0（member-tier-v2-deep）

## 产出

- 新增 `01-docs/MECHANISM-MEMBER-TIERS-DEEP-2026-10-19.md`（v2.0 深度版），回答四个 v1.x 未覆盖的
  本质问题，**不推翻 v1.1 档位总表与六规则**：
  1. **可执行性分层（C1）**：代码取证确认全仓唯一服务端权威门禁是 `cloud_publish`
     （`publish-api-server.js:629-657`）；本地 RPA/BYOK/`limits` 三项是纸糊的
     （`normalizeEntitlement()` 丢弃 limits、零校验，DEEP-ANALYSIS G6）。
     对策 = 价值上云（Obsidian/Bear/Raycast 范式）+ 本地荣誉制（Sublime/Obsidian）+
     空头承诺两级兑现路径（P0 UI 级 / P1 服务端审计级）。
  2. **价格结构诊断（C2）**：¥59→¥79 价差 1.34x 低于行业中位 2.0x（五产品一手实证），
     是 standard/pro features 相同的经济根源。给出结构 A（pro 调 ¥119/¥999，承载
     自动化/多设备/巡检，推荐）与结构 B（砍标准版，不推荐），需 CEO 拍板。
  3. **每档经济模型（C3）**：免费档成本 <¥1/月/人；账号数变显式分档轴（对标参考产品
     20 账号点锚）；pro 涨价的成本-价值支撑（三项新权益边际成本近零）。
  4. **额度工作负载校准（C4）**：以 MARKET-RESEARCH 三档画像反推全部额度；
     唯一调整建议 `videoMonthly` 500→300（3x 余量原则）；新增「画像×余量」评审 checklist。
  5. **转化漏斗核对（C5）**：目标 8% 是头部水平（2026 一手报告 200 家 B2B 中位 8%，
     行业级 2.1-5.6%）；建议改双目标（冷启动 3% 底线/成熟 8% 目标）；trial 归 P2-PAYMENT；
     变现闭环是档位机制的前置项。
  6. **三条新权益轴（C6）**：云同步账号数（free✗/standard≤20/pro 不限，服务端可强制）、
     设备数软上限（2/3/不限，复用 sessions 表零新开发）、云端代执行语义升格、
     BYOK 工具化权益清单（对冲积分引擎延期风险）。
  7. **修复清单四批（C7）**：v1.1 A 批沿用 + B 批调价 + C 批空头承诺兑现 + D 批可执行性。
- 无代码变更；`PLAN_MATRIX_VERSION` 未动；调价/配额调整均为建议值待 CEO 拍板。

## 调研方式（两轮专项）

- **外部基准轮**（子代理，7 主题）：Freemium 转化率（200 家 B2B 一手报告 + First Page Sage）、
  档位价差（Notion/Figma/Slack/Dropbox/Linear 官方页 2026-10-19 直抓，二→三档 1.5-3.4x 中位 2.0x）、
  年付折扣（16.7%/20%/25-30%）、试用期（14 天主流 62%、要卡 vs 免卡）、
  免费档配额（Figma 17% 实证；「10-20% 原则」无权威出处——如实标注）、
  额度校准（「负载×2-3 倍」无公开出处，用 ConsultEvo 五要素替代）、
  桌面产品信任模型（Sublime 荣誉制/JetBrains 离线宽限/Setapp 按设备/1Password 价值上云）。
- **混合架构轮**（子代理，6 主题）：BYOK 商业化（TypingMind 买断/BoltAI 设备分档/
  OpenRouter 抽成对照）、本地 vs 云端划线（Obsidian/Bear/Things3）、设备数实现
  （Keygen 机器指纹+心跳范式）、反滥用（邮箱<指纹<手机$0.05/次<支付验证；Netflix
  打击依赖云侧数据——本地产品做不到）、云端代执行高档权益（Buffer/Apify/Raycast）、
  License 攻防（Electron asar-integrity 官方定位"额外一层"；防君子共识；SaaS 化权益）。
- 两个子代理环境 web_search/web_fetch 均不可用（402/DNS），均改用系统级 HTTP 直抓
  官方页 + DDG HTML 检索；全部来源 URL 入文档附录；「待核实」逐条标注。

## 代码取证（本会话主代理独立完成）

`plan-matrix.js:144-172`（limits 下发形状）、`publish-api-server.js:615-659`（cloud_publish
服务端校验+扣减）、`license-access-control.js:190-193`（ONLINE_ONLY 通道集）、
`entitlement-service.js:10/37-47`（72h grace + normalizeEntitlement 丢弃 limits——G6 实锤）、
`cloud-publisher.js`（orchestrator 通道）、`entitlement-gate.js:20-37`（渲染层「体验分级非
访问控制」自认）、`postgres-commerce-store.js:40-47`（设备会话地基）、
`cloud-accounts/handlers.js`（云同步明文上行事实）。

## 质量节拍

docs-only 通道：保留门禁逐项执行——变更类型与隔离声明（就地编辑 01-docs/，经分支+PR）、
行尾对账（numstat 两口径一致）、品牌残留（本地 `check-no-brand-residue.js` rc=0 后提交）、
文档同步（v1.1 文档不改，关系段已写）、CHANGELOG（不适用）。
跳过项：QM-1/QM-2/QM-4/TDD/QM-6（无代码变更）。

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：变更类型与隔离声明 ✅ | 行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PR（开 PR 后填编号）

## 修订（2026-10-19 · v2.1 生命周期与触点工程）

- 代码取证发现三处与档位机制冲突的生命周期行为：① **跨档续叠平移降级**
  （`UPSERT_SUBSCRIPTION` 无条件 `plan = EXCLUDED.plan`——pro 用户兑 standard 码会把
  剩余 pro 期整体降级，且「续叠」是到期通知文案明确引导的用户动作）；② **到期降级是
  悬崖不是斜坡**（`settleExpiry` 惰性一次性打回 free，在线到期用户无缓冲，72h grace
  只覆盖离线场景）；③ 升级无 proration（兑换码模式下正确，P2 支付接通后须切）。
- v2.1 增补（`MECHANISM-MEMBER-TIERS-DEEP` 文件）：C9 生命周期状态机取证与三冲突修法
  （`rank` 字段档位序保护 / `plan_grace_until` 到期宽限快照 / proration 归 P2）；
  C9.3 生命周期触点矩阵（额度 80%/耗尽/到期前 7 天/D+7 win-back，全部复用
  identity_notifications 现成管道）；C9.4 四层触点工程（能力/产出/价值/回访触点，
  数据地基 usage-tracker + publish_history 已存在）；C10 风控合规边界（频控不入档位
  卖点、账号数合规叙事三绑定、商用授权免责边界）。
- C7 修复清单增补：A 批 +rank 字段（一石二鸟：会员中心审计 P1-10 契约前置）；
  D 批 +⑤跨档续叠保护 ⑥到期宽限快照 ⑦触点接线；运营侧触点文案（locales zh/en 成对）。
- 明确不做：邮件/推送通道（站内已够达）、proration 自建（归 P2）、频控豁免当权益（红线）。
