---
record: purchase-verify-doc
task: 补文档：会员中心购买流程的构建/启动/验收步骤（含两个实测坑）
date: 2026-10-23
---

# 「会员中心 → 选套餐 → 购买」到底缺什么

## 1. 用户的问题

> 会员中心 → 选套餐 → 购买。这个流程的相关功能，好像还没做好。

## 2. 排查结论：不是没实现，是没构建

逐层核对（全部在 `origin/main` 上）：

| 层 | 位置 | 状态 |
|---|---|---|
| 视图 | `views/member-center/Subscription.vue` | ✅ 4 个购买按钮，`canPurchase = isAuthenticated` |
| 弹窗 | `components/WeChatPayDialog.vue` | ✅ 8 态状态机 |
| IPC | `electron/ipc-handlers/wechat-pay.js` | ✅ create-order / order-status / list-orders |
| 桥接 | `electron/preload/wechat-pay.js` | ✅ `wechatPayCreateOrder` 等 |
| 价目 | `electron/services/identity/entitlement-service.js:209` | ✅ 请求 `GET /api/v1/plans` |
| 订单页 | `views/member-center/OrdersBilling.vue` | ✅ 含「继续支付」复用订单号 |
| 测试 | WeChatPayDialog(9) + OrdersBilling(7) | ✅ 16/16 |

落地时间：#4187（2026-10-22 03:11）、#4219（2026-10-22 18:12）。

**本机 `%LOCALAPPDATA%\Programs\Multi-Publish` 与 `multi-publish` 两个目录都是空的**，
共享根也没有 `dist-electron` —— 说明从来没有可运行的构建。

## 3. 构建时踩到的两个坑（本节是文档的真正增量）

### 坑 1：`electron-builder --dir` 会「成功」产出没有界面的包

只跑 `pnpm exec electron-builder --win --x64 --dir` 时 exit 0、`Multi-Publish.exe` 也在，
但 `apps/desktop/dist`（Vite 渲染层产物）不存在时，asar 里只有 `node_modules` 里的几个 html。
启动是白屏。唯一线索是 `• file source doesn't exist from=...\dist\fonts`。

正解：`pnpm run build:dir`（= `build:vue` + `electron-builder --dir`），
并用 `asar list | Select-String '\\dist\\index.html'` 验证产物真的带界面。

### 坑 2：`ELECTRON_RUN_AS_NODE=1` 让应用静默退出

实测：`Start-Process` 启动后 12 秒内退出，**stderr/stdout 全空、退出码 0** —— 与「启动干净」同形。
根因是父 shell 带着 `ELECTRON_RUN_AS_NODE=1`，Electron 以纯 Node 模式启动后立即退出。

这复现了 AGENTS「QM-1 存活是三层判据的隐含前提」那条：只看 stderr 会把「根本没启动」读成通过。
正解：子进程 env 显式剔除该变量（`scripts/lib/qm1-child-env.js` 的 `buildChildEnv()`），
并单独断言「窗口期内仍存活」。本次清掉变量后应用正常存活。

## 4. 文档增量

`01-docs/RUNBOOK-WECHAT-PAY-E2E-2026-10-23.md` 新增 **§9 桌面端构建与购买流程验收**：

- §9.1 七层核对表（判断"没实现"还是"没构建"）
- §9.2 构建命令与 asar 验证
- §9.3 `ELECTRON_RUN_AS_NODE` 陷阱与三条判据
- §9.4 七步人工验收表（对应 §8 文案）
- §9.5 本次已验证到的边界（明确「手工测试单付款会 ORDER_NOT_FOUND 属预期」）

## 5. 未做（明确边界）

- 没有改任何代码：排查确认实现完整，改代码只会制造重复实现。
- 真机走完 §9.4 七步仍需人工扫码付款，本次只到「应用可启动 + 产物含购买流程」为止。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）
