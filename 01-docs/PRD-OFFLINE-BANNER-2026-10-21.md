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
| 恢复回执 | `common.offlineRecovered` | 已恢复连接 | Connection restored |
| 播报锚点 | — | `data-testid="offline-live"` 的**常驻**容器（`role=status` + `aria-live=polite`），空态时不占位、无视觉 | 同左 |

规则一：计数段仅在 `cachedTaskCount > 0` 时渲染。**「0 个待发布」不是信息**，
它只是把一个空值渲染成一句像结论的话（本仓「测试断言不得反向固化错误行为」的同型：
界面上给一个恒出现的 0，用户会读成「系统数过了，是 0」）。

规则二（QM-6 i2 采纳后新增）：**恢复回执是一次性回执，不是状态**。它在「离线→在线」跃迁时出现，
`RECOVERY_NOTICE_MS = 6000` 后自动消失；首次挂载即为在线时不显示（那不是"恢复"）；
显示期间再次断网则立即让位给横幅（两条文案互斥，不并列）。
时长常量由 `useOfflineStatus.js` 单点导出，组件与测试引用同一处 —— 两处各写一份必然漂。

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
| S6 迟到响应必须丢弃 | 每次读回取一个自增 `epoch`，回调里 `epoch !== readEpoch` 即 return；**init 的首次读回与事件后复核共用同一把计数器** | IPC 不保证多次调用的响应按发起顺序到达。快速切换网络时会有并发复核，先发起的那次可能后返回——没有守卫就会把「已确认的离线」改回「在线」（或反之），且日志里一切正常。两条路径各持一把计数器也不够：跨路径的先后关系仍然丢失 |

## 4. 视觉与暗色档

新增令牌 `--color-warning-ink`（`styles/tokens.css`），两档**都显式声明**：

| 档 | 底 `--color-warning-soft` | 字 `--color-warning-ink` | 对比度（WCAG 公式现算） |
| --- | --- | --- | --- |
| 浅 | `#fef3c7` | `#92400e` | **6.37:1**（AA 4.5 达标） |
| 暗 | `#33240c` | `#fbbf24` | **9.00:1** |

「暗档必须显式重声明」是本仓既有教训：只定义一次会静默回退浅值（`tokens.css` 注释里已点名这条）。
入场动画 `slideDown` 补 `@media (prefers-reduced-motion: reduce) { animation: none }`。

## 5. 无障碍

- **播报锚点是常驻容器**：`role="status"` + `aria-live="polite"` 挂在从不被插入/移除的
  `.offline-live`（`data-testid="offline-live"`）上，横幅与恢复回执都是它的**内容**。
  改前这两个属性挂在 `v-if="isOffline"` 的横幅节点上 —— 而 `role=status` 的播报语义定义在
  「常驻 region 内的文本变化」，region 被整体移除时多数读屏**不会**播报「已恢复」，
  于是「断网与恢复各有一条播报」中的恢复半边在实现上并不成立（QM-6 i2 命中，已修）。
- 结构锁（不是注释）：`role="status"` / `aria-live` 必须出现在 `offline-live` 那一行、
  **不得**出现在 `offline-banner` 那一行，且容器行不得带 `v-if`。扫描域排除注释行 ——
  说明注释里会原样写出被禁形态，那是给读者的证据而不是违规。
- 图标 `aria-hidden="true"`，可访问名由文字承载（📡 会被读成"卫星天线"）
- 横幅无交互控件，不引入任何可聚焦元素，因此不触焦点环基线；恢复回执同样只是文本

## 6. 验收

- [ ] 会话中途断网 ⇒ 横幅即时出现（不等任何 IPC 返回）
- [ ] 恢复 ⇒ 即时消失；若主进程仍判离线，复核后重新出现
- [ ] 语言切到英文 ⇒ 无中文残留
- [ ] 暗色档下横幅底色与文字均为暗值，文字对比度 ≥ 4.5
- [ ] 读屏开启时，断网与恢复各有一条状态播报，且不朗读「卫星天线」
- [ ] `cachedTaskCount === 0` 时不出现计数段
- [ ] 关掉开发者工具也能归因：IPC 失败时日志有 `[offline]` 开头的 warn

## 7. 第二半：主进程 `offline:lost` 推送（2026-10-22 已并入本条 PR）

主进程 `onNetworkChange` 补 `offline:lost` 推送：要改 `electron/` + preload 暴露面白名单
（`preload.test.js:112` 是等值断言）并按 QM-1 做打包与 8 秒 stderr 三层判据。
本批不动 `electron/`，因此浏览器事件是当前唯一实时源；主进程事件到位后构成
「乐观值 + 权威值」双通道，S2 的裁决方向不变。

### 7.1 根因（读 main 同源文件取证）

`offline-manager.js::onNetworkChange` 原先只有恢复分支：

```js
if (wasOffline && !isOffline) { log.info(...); processCachedTasks(); notifyFrontend() }  // → offline:restored
// 进入离线方向：既不写日志，也不通知任何人
```

而 `startMonitoring` 两侧监听是**对称注册**的（`net.on("online")` / `net.on("offline")`），
所以状态机两侧都在跑，**只有通知这一侧缺**。后果不是"报错"，是**方向性静默**：
用户拔网线/断 WiFi 时，主进程知道自己离线了，渲染层却不知道，横幅只能等浏览器 `offline` 事件或下一次人工触发的复核。

### 7.2 显示项与交互（并回后半边后的完整口径）

| 触发源 | 到达时机 | 横幅状态 | 待发布数量（`cachedTaskCount`）来源 | 播报 |
| --- | --- | --- | --- | --- |
| 主进程 `offline:lost`（新增） | `net` 判定由在线转离线的那一刻，**状态迁移**才发，重复 offline 事件不重发 | 立即显示离线态 | **优先取载荷里的 `cachedCount`**（主进程缓存队列真源），随后仍发起一次复核 | 与浏览器事件同一条 locale 文案，不新增播报 |
| 浏览器 `offline` 事件（第一轮已有） | Chromium 网络栈变化 | 立即显示 | 浏览器只知连通性 ⇒ 由复核取真源 | 同上 |
| 复核 `offlineStatus`（真源） | 上述两者之后各一次 | 结论**覆盖**事件值 | 主进程返回值 | — |
| 主进程 `offline:restored` | 离线转在线 | 收起横幅 | 载荷 `cachedCount` | — |

三条不变量（写下来是给下一个改这里的人，不是给评审看的）：

1. **载荷字段缺席不得被当成 0**。`cachedCount` 缺失时先按 0 显示、由复核补回真值——
   这条不是防御性代码，是因为主进程 `loadCache()` 与 `offlineStatus` 走的是两个函数，
   将来任一侧改形状都会让"显示 0 条待发布"变成假话。回归锁：`useOfflineStatus.live.test.js`
   「载荷缺 `cachedCount` 时复核必须把真值补回来」。
2. **宿主不支持订阅时必须降级而不是抛**。`window.electronAPI.onOfflineLost` 不存在
   （旧 preload / 浏览器直开 dev server）⇒ 只 warn，浏览器事件继续作为唯一实时源工作。
3. **订阅与解绑成对**。`dispose()` 按 `[通道名, 取消函数]` 逐个解绑并在失败文案里**点名是哪条通道**——
   本仓多处 SPA 标签共存，泄漏的订阅会跨实例串写状态。

### 7.3 明确不做

- **不给 `license-access-control.js` 的 `PUBLIC_CHANNELS` 加 `offline:lost`**。
  核对方式不是想当然：该表管的是**请求型**通道（`ipcMain.handle`），
  而推送型通道 `offline:restored` 从来不在表内。往里加一条 send 通道 = 写一条永不命中的死条目。
- 不改恢复侧的任何行为（`processCachedTasks()` 的顺序与语义保持原样）。
- 不新增 locale 键：断网文案沿用第一轮那两条，播报锚点沿用常驻 region。
