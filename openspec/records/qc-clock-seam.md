---
# 用法：复制本文件为 `openspec/records/<分支名或任务 slug>.md`。
record: qc-clock-seam
task: quick-collect IPC 路径漏转发 deps.now —— 48h 窗口走真实时钟，夹具越窗后必然翻红
date: 2026-10-13
---

## 本次执行记录：quick-collect 时钟 seam 漏转发（qc-clock-seam，2026-10-13）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | `apps/desktop/electron/` 运行时改动 → 混合 PR；隔离 worktree `mp-qc-clock-seam`（D 盘）+ 裸分支；共享根保持 main clean |
| 第一性原因（QM-5 ①） | PASS | `ipc-handlers/quick-collect.js` 的 `getEngine()` 构造 engine 时**漏传 `now`**：同一处 `deps.now` 交给了 `trendFnFor()`（feed fetcher 尊重它），却没交给 `createQuickCollectEngine()`，于是 `quick-collect-engine.js:63` 回落到 `() => Date.now()`，第 178 行的 `mergeMaterials(..., { now: now() })` 用**真实时钟**做 48h 窗口过滤。`git blame` 指向该 handler 建立 engine 的那次改动（S2 feed 源接入时只接了 fetcher 一路） |
| 逃逸分析（QM-5 ②） | PASS | ① **纯函数测试全绿**——`createQuickCollectEngine({ ..., now: () => NOW })` 的用例直接注入时钟（共 6 处），把不变量测住了；② 但走 **IPC 注册面**的用例用 `makeDeps()` / `baseDeps()`，两者都没有 `now`，且即便有也不生效（engine 不认）——**接线层无人覆盖**；③ 用例夹具锚在写死的 `NOW = 2026-10-11T04:00:00Z`，一旦真实时间越过夹具 + 48h 就**必然**红，属"定时炸弹"型：写下的当天绿、两天后红，与代码改动无关；④ 模块自身文档已明写契约「全部依赖注入（fetchFn / now / log），零直连 IO ⇒ 单测零出网、**零时钟依赖**」（`quick-collect-trend-sources.js:20`），**该不变量在 IPC 路径上被打破却无任何锁**——文档承诺与接线实现之间缺一致性判据 |
| 修复 + 回归保护（QM-5 ④） | PASS | ① 生产：`getEngine()` 转发 `now: deps.now`，并把 `deps.now` 加进 engine 缓存 keys（engine **构造时捕获**时钟，换时钟不重建等于仍走旧时钟）；② 测试：两个 IPC 夹具补 `now: () => NOW`，接上既有 seam；③ **新增确定性回归锁**——用「远在过去」的固定时钟（`2020-01-01`）＋ 1 小时前的素材，断言 `retrieval === 'ok'`。真实时钟必然把它滤掉，故「丢掉 now 转发」**立刻**红，不再依赖夹具自然老化（老化型只在越窗后红，正是本次逃逸的原因）。**反证已实跑**：撤掉生产转发 ⇒ 该文件 3 例红（含新锁），还原后 10/10 绿 |
| 防止再次发生（QM-5 ⑤） | PASS | ① 锁的形态从「夹具锚固定日期」升级为「夹具用远在过去/注入时钟」，让**接线回归即时可见**而非延迟两天；② 注释在 `getEngine()` 就地写明「deps.now 必须同时进 keys 与构造参数」及其原因，防止后人只改一处；③ 本记录把「模块文档承诺的不变量必须有接线层判据」列为可复用教训（纯函数测住了 ≠ 接线测住了） |
| 行尾与 diff 对账 | PASS | 变更 3 文件（M=3）；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；构建产物 `preload/index.bundle.js`、`home-shell-preload.bundle.js` 显示 `M` 但**内容零差异**（仅 stat 脏 + 行尾归一化），**未纳入提交** |
| 测试 | PASS | 触发失败的 3 例转绿；quick-collect 族 6 文件 **96 passed**；`electron/ipc-handlers/` 全目录 **58 文件 979 passed**；`node --check` 通过 |
| QM-1 打包 | PASS（启动项受限，如实登记） | `pnpm run build:vue`（渲染层 24.29s）+ `pnpm exec electron-builder --win --x64` rc=0。验证①asar 内含 `\electron\ipc-handlers\quick-collect.js` 与 `\dist\index.html`；②语法 OK + 5 个相对 require **全部解析**（`Cannot find module 'electron'` 属宿主模块，脱离 Electron 必然如此，非缺陷）；③启动 8s：进程以 **exit 0 干净退出**、stderr 空、无 `Failed to load platform config` / `PluginLoader.*mkdir failed` / `ENOTDIR.*app.asar` 特征。**早退原因已定位**：另一 worktree `mp-app-live2` 正跑着 8 个 Electron 进程持有单实例锁（`electron/main.js:73-75` 拿不到锁即 `app.quit()`）。按纪律**未终止任何他人进程**；故"窗口起来"这一项在本机**无法验证**，如实登记为受限 |
| QM-4 视觉 | N/A | 未改渲染层/样式 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实登记 |
| 远程同步 | PASS | PR #3459 已 squash 合并：merge SHA `5552f1f0ab39739eec60e62ba0ac9061ca863335`（2026-10-13T12:41:13+08:00）；`git ls-remote --heads origin qc-clock-seam` 返回 0 行，远端分支已删 |

### 实现要点（值得留存的判断）

**1.「纯函数测住了」不等于「接线测住了」。** 本案的不变量（窗口用注入时钟）在 6 处纯函数用例里被严格测过，
而 IPC 注册面那一路既没注入 `now`、engine 也不认——两层缺口叠加，测试全绿。**判据要覆盖"依赖从入口一路流到消费点"的完整链路**，
不能只测链路末端的纯函数。

**2. 夹具锚在固定日期 = 定时炸弹，且方向是"必然红"而非"可能红"。** `NOW` 写死 + 真实时钟做窗口 → 越窗后 100% 失败。
这类测试的绿是**借来的时间**，与代码正确性无关。修法不是把日期往后挪（那只是重设引信），而是让它**不再依赖真实时钟**。

**3. 老化型回归锁是弱锁。** 若只用"夹具越窗"来兜住这个接线缺陷，那必须等两天才会红——期间任何 PR 都可能被它误伤。
改用「远在过去」的时钟后，撤掉转发**立刻**红，回归保护从"延迟可见"变成"即时可见"。**新写的防再犯锁必须做一次撤掉修复即变红的反证。**

**4. 想 kill 占用进程前先问"这是谁的".** 启动验证失败的第一反应是清理残留进程；
但本机 8 个 Electron 进程属于**另一个 worktree 正在运行的用户应用**，按名字批量 kill 会误杀他人会话。
正确做法是定位锁持有者、如实记录"该项受限"，而不是把环境障碍当缺陷消灭。

### 遗留（不假装已闭合）

- **「窗口起来」未在本机验证**：受单实例锁限制（他人实例在跑）。CI 的 desktop shards 与 QG Visual 覆盖运行面，
  但"打包产物能起窗口"这一条本机没有证据。
- **同类时钟 seam 未做全仓排查**：本次只修了 quick-collect。其他模块若也把 `now`/`clock` 注入纯函数却未从入口转发，
  存在同型缺口（判据同：入口 → 消费点的依赖流是否贯通）。**未做全仓扫描**。
- **`build:preload` 会重写 tracked 的 `*.bundle.js`**：本次内容零差异故未提交，但若 preload 源码与已提交产物长期漂移，
  打包会静默产生未提交 diff。是否该加"产物与源码一致"的锁，需另行评估。
- **前序遗留仍未动**：`/rollout` 补锁影响面、改密未接入审计日志、LLM 判分随机性、PRD 227 项状态标注回填。
