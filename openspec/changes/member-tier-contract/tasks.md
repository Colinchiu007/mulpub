# Tasks: member-tier-contract

## 1. 服务端契约（TDD）

- [x] 1.1 测试先红：`test/plan-matrix.test.js` 增例——price 11900/99900、video 300、
      `rank` 单调且不可 overrides、三条 features 派生、四项 limits 新键
- [x] 1.2 绿：`plan-matrix.js` 五个字段 + `PLAN_RANK`/`planRank()` + features/limits 派生 + 版本号 2026-10-20
- [x] 1.3 测试先红：`test/member-commerce-repository.test.js` 增例——低档码压制（upsert plan=pro、
      快照按 pro 现算、订单记 standard、`downgradeSuppressed=true`）、高档码整期升级
- [x] 1.4 绿：`postgres-commerce-store.js` `entitlementPayloadFor` + 档位序保护 + 返回三字段
- [x] 1.5 测试先红/绿：`test/subscription-service.test.js` 宽限用例（graceUntil=now+7d、
      previousPlan、保留 dashboard_full/schedule_batch、不保留 video_create/tier_access）+ 幂等键集合
- [x] 1.6 绿：`subscription-service.js` 兑换/开通走生效档位、settleExpiry 宽限快照与通知文案
- [x] 1.7 服务端快照下发：`publish-api-server.js` `_buildEntitlement` / `_buildEntitlementSnapshot`
      透传 limits/graceUntil/previousPlan

## 2. 客户端（TDD）

- [x] 2.1 测试先红：`electron/services/identity/entitlement-service.test.js`——limits/grace 透传、深拷贝隔离、非法形状丢弃
- [x] 2.2 绿：`entitlement-service.js` `normalizeEntitlement()` 扩展
- [x] 2.3 测试先红/绿：`src/stores/identity.test.js`——渲染层透传与丢弃
- [x] 2.4 测试先红：`src/features/member/plan-limits.test.js`（8 例：缺失即放行 / -1 / 空串 / 日发闭区间）
- [x] 2.5 绿：`src/features/member/plan-limits.js` 纯函数层
- [x] 2.6 测试先红/绿：`src/composables/usePlatformSelection.test.js` 5 例（超限拦截、取消不受限、按组同约束、缺失放行）
- [x] 2.7 绿：`usePlatformSelection.js` 可选 `getEntitlement` + `platformLimit`；`Publish.vue` 接线与提示；
      `locales/publish-page/{zh,en}.js` 两条文案

## 3. 质量节拍与交付

- [x] 3.1 全量服务端测试：`packages/api-publish-engine npm test` rc=0
- [x] 3.2 受影响前端测试：entitlement-service / identity store / plan-limits / usePlatformSelection / Publish（110 例）
- [ ] 3.3 QM-1：`electron-builder --win --x64` rc=0 + 启动验证（三层 stderr 判据）
- [x] 3.4 文档：PRD（新增）、pricing-strategy v2.2、两份机制文档状态回写、CHANGELOG
- [x] 3.5 质量门禁：`check-no-brand-residue.js` / 行尾对账 / 执行记录 `openspec/records/member-tier-contract.md`
- [ ] 3.6 PR → CI 绿 → squash 合并 → main push 回读 → 收尾
