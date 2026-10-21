# PRD：离线横幅（UX 审计 1.7 整改）

> 落地日期 2026-10-21 ｜ 分支 `ux-audit-offline-live` ｜ OpenSpec change `ux-audit-offline-live`
> 关联：`01-docs/UX-AUDIT-2026-10-17.md` 阶段 1.7；组件 `apps/desktop/src/components/OfflineIndicator.vue`

## 1. 问题

用户断网时看不到任何提示。原实现的检测面只有「启动时读一次 + 主进程恢复时通知一次」，
而主进程 `offline-manager.js::onNetworkChange` 的判据是 `if (wasOffline && !isOffline)` ——
**断网那条边不通知任何人**。因此会话中途断网，横幅永不出现，直到重启应用。

同一条链上还叠着四处「建成但对用户不可用」：

| 缺陷 | 现场 | 后果 |
| --- | --- | --- |
| 文案硬编码在模板 | `<span>📡 网络已断开 — 发布任务将被缓存…</span>` | 英文用户看到中文；文案不可维护 |
| 颜色硬编码 hex | `#fef3c7 / #fbbf24 / #92400e` | 暗色档下整条横幅是一块「亮色补丁」，且无对比度判据 |
| 无可播报语义 | 纯 `<div>` | 读屏用户完全不知道断网/恢复发生了 |
| 失败静默 | 两处 `catch(() => {})` | 「IPC 坏了」与「网络正常」在界面上同形，运维无从归因 |

## 2. 显示项与文案（唯一真源 = locales）

| 元素 | 键 | zh | en |
| --- | --- | --- | --- |
| 说明 | `common.offlineBanner` | 网络已断开 — 发布任务将被缓存，网络恢复后自动重试 | You are offline — publish tasks will be cached and retried once the connection returns |
| 计数 | `common.offlinePendingCount` | `{count} 个待发布` | `{count} pending` |
| 图标 | — | 📡（`aria-hidden`，纯装饰，不进可访问名） | 同左 |

规则：计数段仅在 `cachedTaskCount > 0` 时渲染。**「0 个待发布」不是信息**，
它只是把一个空值渲染成一句像结论的话（本仓「测试断言不得反向固化错误行为」的同型：
界面上给一个恒出现的 0，用户会读成「系统数过了，是 0」）。

## 3. 交互逻辑与状态真源

```
浏览器 offline 事件 ──► isOffline = true（同帧，不等 IPC）
                     └─► reconcile() ──► 主进程 offlineStatus ──► 覆盖连通性 + 写入 cachedCount
浏览器 online  事件 ──► isOffline = false ──► 同上
主进程 offline:restored ──► isOffline = false, cachedCount = 事件值（既有链路保持）
组件卸载 ──► dispose()：解绑 window 两个监听 + 注销主进程订阅
```

| 规则 | 判据 | 为什么是这个方向 |
| --- | --- | --- |
| S1 第一响应来自浏览器事件 | 事件 handler 内**同步**置位，不在任何 `await` 之后 | 复核要跨 IPC，把「有没有断网」绑在一次往返上，慢的那几百秒里用户看到的仍是在线 |
| S2 最终裁决在主进程 | 复核返回后覆盖事件值 | 主进程用 electron `net` 栈判连通性，还持有待发布队列；两边都可能对，必须有唯一裁决方，不得各写各的 |
| S3 计数只取主进程 | `cachedCount` 只由 `offlineStatus` / `offline:restored` 写入 | 渲染层没有任何队列信息，自推等于编数 |
| S4 复核失败不得静默 | `console.warn('[offline] …')`（ASCII），保持事件值 | 回落成默认值会把「IPC 坏了」伪装成「在线且无积压」，违反「静默配置失败必须留日志」 |
| S5 监听成对解绑 | `dispose()` 由 `onBeforeUnmount` 调用，且有 `attached` 幂等守卫 | 本仓多个 SPA 实例共存，活监听会跨实例串写状态（先例：page-manager 订阅无 id 全清事故） |

## 4. 视觉与暗色档

新增令牌 `--color-warning-ink`（`styles/tokens.css`），两档**都显式声明**：

| 档 | 底 `--color-warning-soft` | 字 `--color-warning-ink` | 对比度（WCAG 公式现算） |
| --- | --- | --- | --- |
| 浅 | `#fef3c7` | `#92400e` | **6.37:1**（AA 4.5 达标） |
| 暗 | `#33240c` | `#fbbf24` | **9.00:1** |

「暗档必须显式重声明」是本仓既有教训：只定义一次会静默回退浅值（`tokens.css` 注释里已点名这条）。
入场动画 `slideDown` 补 `@media (prefers-reduced-motion: reduce) { animation: none }`。

## 5. 无障碍

- 容器 `role="status"` + `aria-live="polite"`（WCAG 4.1.3 状态消息：变化要被播报，但不打断当前朗读）
- 图标 `aria-hidden="true"`，可访问名由文字承载
- 横幅无交互控件，不引入任何可聚焦元素，因此不触焦点环基线

## 6. 验收

- [ ] 会话中途断网 ⇒ 横幅即时出现（不等任何 IPC 返回）
- [ ] 恢复 ⇒ 即时消失；若主进程仍判离线，复核后重新出现
- [ ] 语言切到英文 ⇒ 无中文残留
- [ ] 暗色档下横幅底色与文字均为暗值，文字对比度 ≥ 4.5
- [ ] 读屏开启时，断网与恢复各有一条状态播报，且不朗读「卫星天线」
- [ ] `cachedTaskCount === 0` 时不出现计数段
- [ ] 关掉开发者工具也能归因：IPC 失败时日志有 `[offline]` 开头的 warn

## 7. 遗留（第二半，刻意拆出）

主进程 `onNetworkChange` 补 `offline:lost` 推送：要改 `electron/` + preload 暴露面白名单
（`preload.test.js:112` 是等值断言）并按 QM-1 做打包与 8 秒 stderr 三层判据。
本批不动 `electron/`，因此浏览器事件是当前唯一实时源；主进程事件到位后构成
「乐观值 + 权威值」双通道，S2 的裁决方向不变。
