# Proposal: kuaishou-w3-live-fix（D1 API-first 凭证分区兜底 + D2 快手发布按钮选择器）

## Why

W3 6.3 活体验收（2026-09-26，证据 `01-docs/rpa-api-publish/evidence/api-w3-kuaishou/live-verdict-20260926.md`）未通过，暴露两个静态门禁/单测拦不住的真实缺陷：

- 🔴 **D1**：生产 `rpa_vm` 路由下 API-first 分支 `authData.cookies` 为空——快手登录态只落在 Electron auth 分区（`persist:account-…`），未同步进凭证 store → `KuaishouAdapter.execute()` `!cookie` fail-closed，九步 API 链 0 步未跑，W3 验收标的在生产路由下不可达。
- 🟠 **D2**：DOM 兜底轨 `publish_btn` 选择器与当前 cp.kuaishou.com 发布页按钮 DOM/文案不匹配（DIAG pubBtn=7 候选全 timeout），发布点击从未触发。

## What Changes

### D1（MODIFIED: api-publish-chain 凭证解析）
- `apps/desktop/electron/services/rpa-view-session.js`：抽出分区定位逻辑为 `findAuthPartitionDir(platform, accountId, userDataPath?)`（纯函数、可测），`_restoreAuthPartitionCookies` 改为消费它（行为不变）。
- `apps/desktop/electron/services/rpa-view-manager.js` API-first 分支：`authData.cookies` 拼出的 cookie 串为空时，经 `session.fromPartition('persist:'+分区名)` 从 auth 分区直读 cookie（按 `isPlatformCookieDomain` 过滤平台根域，防跨平台串味），非空即继续走 API；分区也无 cookie 时保持现状（空串 → adapter fail-closed 报「账号信息缺失」，错误信息补充「auth 分区亦无 cookie」定位线索）。

### D2（MODIFIED: 快手 DOM 兜底轨发布按钮）
- `packages/rpa-engine/src/platform-selectors.js` kuaishou `publish_btn`：按活体 DOM 取证刷新候选序列（保留旧候选兜底、新候选前置）。
- 选择器负例回归：对齐 platform-definitions 负例形态，防止「登录页/未就绪态」被误命中。

## Impact

- 受影响 spec 能力：`api-publish-chain`（W3 change delta 已存在，本 change 追加 delta）、DOM RPA 兜底轨（kuaishou 行）。
- 不翻转 platforms.yaml、不改路由表；D1 仅扩大 API-first 的凭证来源（分区只读），凭证 store 写路径不动（避免与 #2402 登录门禁面冲突）。
- 破坏性：无。分区缺失/无 cookie 时行为与现状一致（fail-closed + 降级 RPA）。
- 前置关联：PR #2413/#2424 已合并；#2402（登录误判）OPEN 中，本 change 不触碰其文件面（platform-definitions 的会话 cookie 标记已由 #2402 引入，本 change 仅消费 `isPlatformCookieDomain` 既有导出）。

## Out of Scope

- 凭证 store 与 auth 分区的双向同步机制（更大架构面，另行立项）。
- 小红书链（design §6 止步裁决）。
- 6.3 活体重跑与 QM-1 最终包（属 tasks 6.1/6.3 收口，需用户在场）。
