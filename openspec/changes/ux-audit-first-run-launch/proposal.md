# 变更：把首启向导接回启动判定（UX 审计阶段 1 · 单元 1.4）

## Why

`/first-run` 向导（`src/views/FirstRun.vue`，19 条自测）在路由表里存在、`App.vue` 为它留了全屏分支
（`isFullScreenRoute` 含 `/first-run`），但**没有任何代码在它该出现的时候导航过去**；
更糟的是主进程在窗口创建时就把它自己"完成"了：

```
electron/window.js:228          firstRun.runSetup(mainWindow)
electron/services/first-run.js:24-30   if (isSetupDone()) { send('done'); return }
                                        // P2-E: 无需检查浏览器资源，直接标记首次运行完成
                                        fs.writeFileSync(...'first-run-done'...)
```

⇒ 全新 userData 第一次启动也会立刻落下 `first-run-done` 标记并广播 `type:'done'`，
用户永远进不到向导。这与 1.1（`useTheme` 已实现零消费方）、1.2（公告横幅零渲染方）同形：
能力在、判定在，**用户侧不可达**。

## 取证：本仓有两套并列的"首启引导"，必须先选活下来的那个

| 机制 | 标记 | IPC 通道 | 生产消费方 | 真实数据 |
| --- | --- | --- | --- | --- |
| `electron/services/first-run.js` | `userData/first-run-done` | `first-run:check` + 事件 `first-run:status` | `electron/window.js:228`（启动即调）；~~`src/views/FirstRun.vue`~~（QM-6 i4：本批撤掉了它的订阅，
  事件通道 `first-run:status` 现全仓零消费者 ⇒ 与 `onboarding:*` 并批退役，见 design.md 与记录 §遗留） | 实测调试 profile 目录里 **`first-run-done` 存在** |
| `electron/services/onboarding.js` | 自己的 `completed:<ISO>` 标记 | `onboarding:complete/get-steps/status`（preload 三个方法都暴露了） | **零**：`grep -rna "startOnboarding\|isOnboardingDone" electron` 除自身与测试外无命中；渲染端也无人调 `onboardingComplete` | 无 |

按"哪个有存量数据"选存活者（不是"哪个设计更好看"）：**留 `first-run`**，
`onboarding:*` 那三条是注册了但无人调的死通道 —— 本批**不动它**（删它属另一片，见 tasks §5），
理由是它带着 `isTrustedSender` 白名单与 preload 导出清单，动它会牵动 `preload.test.js` 的导出契约，
与本审计项"接回启动判定"无关，混在一起会让这次改动的判定面说不清。
`onboarding.welcome` 那个 locale 命名空间**保留**（FirstRun.vue 的文案真的在读它）。

## What Changes

1. **主进程不再自动落标记**：`runSetup(mainWin)` 只做"读现状 + 广播"，
   未落标记时广播 `{ type: 'needed' }`，已落则 `{ type: 'done' }`。写入动作移交给显式出口。
2. **新增完成通道**：`first-run:complete`（IPC handler + preload `firstRunComplete`），
   并由 `license-access-control.js` 的 `PUBLIC_CHANNELS` 同批登记 ——
   只加 handler 不加白名单，未授权用户点"完成"会被静默挡掉（本仓「注册≠接线≠生效」的同型坑）。
3. **启动判定接回**：渲染端收到 `needed` 时导航到 `/first-run`；已在该路由时不重复导航。
   判定发生在 `App.vue`（外壳级订阅），不是某个页面里。
4. **向导自身的两处假象一并修**：
   - 「Python 依赖 / Playwright 浏览器」两行步骤的状态**只由主进程 `type:'done'` 一次性点亮**，
     而 P2-E 之后主进程什么都不检查 ⇒ 这两行是装饰性显示面，必须改成"如实说明当前会做什么"，
     不得保留"看着像在检测、其实只是被人点了个勾"的行。
   - `retryDeps()` 的注释写着 "Re-trigger setup" 而它只调 `firstRunCheck()`（只读，不会重跑）
     ⇒ 要么给它一个真的重跑出口，要么把这行注释和按钮语义改掉。**不得留下承诺与实现不符的注释。**
5. **完成/跳过都是显式动作**：向导上的「完成」与「跳过」都调 `firstRunComplete()` 后进入主界面；
   中途关窗 ⇒ 标记没落 ⇒ 下次仍进向导（这是期望行为，必须有测试钉住）。

## Impact

- Affected specs: `desktop-ui-consistency`（新增「启动期判定必须可达，且不得由系统自动替用户完成」）
- Affected code: `apps/desktop/electron/services/first-run.js`、`electron/window.js`、
  `electron/ipc-handlers/misc.js`、`electron/ipc-handlers/license-access-control.js`、
  `electron/preload/system.js`、`electron/preload/access-control.js`、
  `src/App.vue`、`src/views/FirstRun.vue` 及其测试、`src/locales/onboarding/*`（只增不改语义）
- **QM-1 必跑**：改动落在 `electron/` ⇒ 必须 `pnpm run build:dir` 后按三层 stderr 判据 + 存活断言验证打包态。
- 风险面：这是对**所有新装用户首启路径**的行为改变（从"直接进主界面"变成"先进向导"）。
  审计项 1.4 的验收标准就是这个（「全新 userData 首启即进向导」），
  但升级用户（已有 `first-run-done`）不受影响 —— 这一点必须有测试证明，不能靠推理。
