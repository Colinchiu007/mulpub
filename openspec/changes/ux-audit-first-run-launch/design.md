# 设计：首启向导接回启动判定（单元 1.4）

## D1 判定走"拉"不走"推" —— 因为推送有一个结构性竞态

现状是主进程在 `window.js:228` 调 `runSetup(mainWindow)`，由它 `webContents.send('first-run:status', …)`。
把启动判定挂在**这条推送**上是接不住的：推送发生在**窗口刚创建**时，
而渲染端的订阅发生在 `App.vue` / `FirstRun.vue` 的 `onMounted` 里 ——
后者必然晚于前者，事件丢失且没有任何重试。这类"门控首个导航的推送"在本仓已有前例
（AGENTS「门控首个导航的异步 promise 必须带超时与销毁守卫」）。

**所以**：判定走**拉** —— `App.vue` 挂载时调 `firstRunCheck()`，`setupDone === false` 就导航到 `/first-run`。
事件推送（`first-run:status`）在本批之后**没有任何消费者**（向导页原先订阅它，而那个订阅随两行假检测一起撤下）。
主进程仍在每次建窗时广播 `needed`/`done`，preload 与 `src/api/publisher.js` 也仍导出 `onFirstRunStatus` ——
这正是 PRD §7.1 定义、本批延迟清理的「注册但无人用」死通道形态。**QM-6 i4 的处置**：不在本批假装它还服务谁，
而是把它与 `onboarding:*` 三条死通道并成同一次退役（见记录 §遗留 6.4），文档口径改成本句。
不作为"进不进向导"的判据。

三条不可破的口径：

1. 判据取**返回值里的布尔**，且必须区分"读到了 false"与"没读到"：
   `firstRunCheck()` 现在带 `invokeWithFallback(..., { code: 0, data: { setupDone: false } })` ——
   那个兜底把"桥不可用"伪装成"没做过"，在浏览器 dev server（无 `window.electronAPI`）里会让每个访问都跳向导。
   ⇒ 本批必须显式处理兜底档：判定只在 `code === 0` 且 `data` 是对象时生效，否则**不动导航**（保守放行）。
   这条是本单元最可能埋雷的一格。
2. 导航 MUST 只发生一次（用一个模块级闩或 `router.currentRoute` 判重），
   否则每次 App 重挂载都可能重复 push。
3. 已在 `/first-run` 时不重复 push（vue-router 对同路由 push 会抛 NavigationDuplicated）。

## D2 完成标记的唯一写者

```
唯一写者：electron/services/first-run.js 的 markDone()
唯一触发：ipcMain.handle('first-run:complete')  ← src/views/FirstRun.vue 的「完成」/「跳过」
```

`runSetup()` 里那句 `fs.writeFileSync(...'first-run-done'...)` **删掉**（它是"系统替用户完成"的实现）。
`reset()` 保留（测试/排障出口，已有）。
读侧不变：`checkDeps()` 仍返回 `{ setupDone: isSetupDone() }`。

`first-run:complete` 必须同批进 `license-access-control.js` 的 `PUBLIC_CHANNELS`
（`first-run:check` 就在那张表里）—— 漏登记的后果是"点完成没反应、也没有错误"，
用户下次启动又回到向导，属最难受的静默失效。这条由一把三处配对的锁守住。

## D3 向导里那两行"依赖检测"怎么处置

实测 `runSetup` 除标记外什么都不做（P2-E 的注释原文：「无需检查浏览器资源，直接标记首次运行完成」），
而 `FirstRun.vue` 的 `depSteps` 只有「Python 依赖」「Playwright 浏览器」两行，状态**唯一来源**是
收到 `type:'done'` 时 `forEach(s => s.status = 'done')` —— 也就是"什么都没测就全绿"。

处置（不新增假象、不假装在检测）：两行改为**如实陈述当前首启会做什么**的清单（文案走 locale），
状态语义从 `pending/active/done/error` 收成"信息行"，不再显示 ✅；
`retryDeps()` 与它"Re-trigger setup"的注释一并撤掉（它只调只读的 `firstRunCheck()`，从未重跑任何东西）。

⚠️ 这不是顺手清理：`FirstRun.test.js` 有 19 条用例，其中钉这两行状态流转的断言会随语义变化而需要改写。
**改写方向必须是"断言不再出现从未跑过的检测结论"**，不是把断言删掉换绿灯。

## D4 与 `onboarding:*` 的关系（本批不动，理由要写下来）

实测 `services/onboarding.js` 的三个通道（`complete/get-steps/status`）在 electron 侧除自身与测试外
**零调用方**，渲染端也**零调用**；而 `first-run-done` 在真实 profile 里存在。
按"哪个有存量数据"选存活者 ⇒ 留 `first-run`。

不把 `onboarding:*` 一起删掉的理由：它牵 `PUBLIC_CHANNELS`、`preload/system.js`、`preload/access-control.js`
与 `preload.test.js` 的导出清单（该测试逐名断言导出集合），属另一个判定面；
混进本片会让"首启可达"这件事的证据被稀释。登记为后续批（tasks §5）。
`onboarding.*` 这个 locale 命名空间**保留** —— `FirstRun.vue` 真的在读它的文案。

## D5 QM-1（改了 electron 就必须跑）

改动落在 `electron/services/`、`electron/ipc-handlers/`、`electron/preload/`、`electron/window.js`
⇒ 必须 `pnpm run build:dir`（先 vite build，否则 `--dir` 产物会打 `ERR_FILE_NOT_FOUND .../dist/index.html`，
那是"待人工判断"层而不是通过），再以隔离 `--user-data-dir` 启动、断言 8s 内存活 + 三层 stderr 判据，
子进程 env 经 `buildChildEnv()` 剥掉 `ELECTRON_RUN_AS_NODE`。
**现场还要验一次"全新 profile 进向导、已有 profile 不进"** —— 这条只能在打包态或真实运行里看，单测替代不了。

## D6 反证（写型，逐条必须指名变红）

- F1 把 `markDone` 的调用点摘掉（只留 handler）⇒ 「完成/跳过写标记」用例红
- F2 恢复"启动即写标记"（把 `writeFileSync` 放回 `runSetup`）⇒ 「主进程不得自动落标记」用例红
- F3 把 `first-run:complete` 从 `PUBLIC_CHANNELS` 删掉 ⇒ 三处配对锁红
- F4 把 preload 导出删掉而通道仍登记 ⇒ 同一条锁红（另一方向）
- F5 `App.vue` 的判定改成只在 `code === 0` 之外也放行（即用兜底值导航）⇒ 「桥不可用不得跳向导」用例红
- F6 把 `depSteps` 改回"收到 done 就全绿"⇒ 「不得显示从未跑过的检测结论」用例红
- F7 去掉重复导航闩（第二次挂载再 push 一次）⇒ 「判定只发生一次」用例红
