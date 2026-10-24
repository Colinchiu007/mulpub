# UX 审计 1.7：离线横幅实时出现（renderer 半边）+ 显示面整改

## Why

审计条目 1.7 记的是「中途断网，横幅不出现」。本轮取证确认它由**两处独立缺口**叠成：

1. **主进程只在「恢复」那条边上通知前端**。`apps/desktop/src/composables/useOfflineStatus.js` 的
   `init()` 只做两件事：一次性读 `offlineStatus`、注册 `onOfflineRestored`。而主进程
   `apps/desktop/electron/services/offline-manager.js::onNetworkChange` 的判据是
   `if (wasOffline && !isOffline)` —— 断网那条边只更新内部 `_isOffline`，**不发任何事件**。
   结果：用户在会话中途拔线/断 WiFi，横幅永不出现；只有重启应用（重新走那一次性读）才可能看到。
2. **渲染层没有任何实时监听**。Chromium 自己会向页面派发 `window` 的 `offline`/`online` 事件，
   是零 IPC 往返的第一响应源，原实现完全没用。

同一条链上还有三处「已建成但对用户不可达/不可读」的债务一并整改：文案硬编码中文在模板里
（英文用户看到中文）、颜色硬编码 hex（暗色档下整条横幅变成一块「亮色补丁」）、
无 `role=status`/`aria-live`（读屏用户完全不知道断网发生了）、失败静默 `catch(() => {})`
（违反 AGENTS.md「静默配置失败必须留日志」，让「IPC 坏了」与「网络正常」在界面上同形）。

## What Changes

1. `useOfflineStatus` 增加浏览器 `online`/`offline` 监听：**连通性第一响应来自浏览器事件**，
   随后向主进程复核一次，**复核结论覆盖浏览器值**（`cachedCount` 的真源是主进程待发布队列；
   且代理掉线 / DNS 不通这类情况下主进程的 `net` 栈与浏览器判断可能不一致，必须有唯一裁决方）。
2. 新增 `dispose()`，由组件 `onBeforeUnmount` 成对调用（本仓多 SPA 实例共存，
   未解绑的 window 监听会跨实例串写状态）。
3. 所有静默出口改为出声（`console.warn`，**ASCII**，不写入用户可见文案）。
4. `OfflineIndicator.vue`：文案进 `locales/common`（zh/en 成对）；图标与文字分离并 `aria-hidden`；
   `role="status"` + `aria-live="polite"`；颜色改走警告族 token（新增 `--color-warning-ink` 两档显式声明）；
   入场动画补 `prefers-reduced-motion` 守卫；去掉模板内联 `style`。

## 不在本批（刻意切出去的一半）

主进程 `onNetworkChange` 补 `offline:lost` 推送 —— 那要改 `apps/desktop/electron/` 与 preload
暴露面白名单（`preload.test.js:112` 是等值断言、`preload/access-control.js` 也要登记），
并按 QM-1 做打包验证。它是「权威源也出声」的加强，不是本批用户可见结果的必要条件：
浏览器事件已经让横幅即时出现。作为后续单独变更，见执行记录「遗留」。

## Impact

- Affected specs: `desktop-ui-consistency`（新增 2 条 Requirement）
- Affected code: `apps/desktop/src/composables/useOfflineStatus.js`、
  `apps/desktop/src/components/OfflineIndicator.vue`、`apps/desktop/src/locales/common/{zh,en}.js`、
  `apps/desktop/src/styles/tokens.css`
- 无 electron/ 改动 ⇒ 不触 QM-1 打包；无既有视觉注册表内的视图被改写 ⇒ 不刷像素基线
  （横幅仅在离线时渲染，采集态不出现；该推理写入记录，不当作已验证的像素结论）
