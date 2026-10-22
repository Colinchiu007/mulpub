# Tasks — UX 审计 1.7（离线横幅实时出现，renderer 半边）

> `[x]` 只给当场有命令输出的步骤。

## 1. 行为锁（先红）

- [x] 1.1 新增 `apps/desktop/src/composables/useOfflineStatus.live.test.js`（12 例：事件即时改状态 / 事件后复核 / 主进程结论优先 / **两条迟到响应各自一格**（init 迟到、复核迟到）/ dispose 解绑 / dispose 幂等 / 失败出声 / 导出形状含 dispose / 未 init 就 dispose / 计数取真源）
- [x] 1.2 新增 `apps/desktop/src/components/OfflineIndicator.test.js`（12 例：出现条件 / zh→en 无残留 / 计数段可见性 / role+aria-live / 图标 aria-hidden / 禁内联 style / 禁 hex 字面量 / reduced-motion / token 必须在 tokens.css 有定义 / 卸载解绑 / 卸载后不受全局事件影响）

## 2. 实现

- [x] 2.1 `useOfflineStatus.js`：浏览器 `online`/`offline` 监听 + 事件后向主进程复核 + 复核覆盖事件值 + `dispose()` 成对解绑 + 全部静默出口改 `console.warn`（ASCII）
- [x] 2.2 `OfflineIndicator.vue`：文案进 locales；图标 `aria-hidden`；`role="status"` + `aria-live="polite"`；颜色走 token；补 reduced-motion；去内联 style
- [x] 2.3 `locales/common/{zh,en}.js` 成对新增 `offlineBanner` / `offlinePendingCount`
- [x] 2.4 `styles/tokens.css` 新增 `--color-warning-ink` 两档（浅 `#92400e` = 6.37:1，暗 `#fbbf24` = 9.00:1，按 WCAG 公式现算）

## 3. 反证与验证

- [x] 3.1 `node scripts/offline-live-contract-mutate.js`：基线两套件 `red=0`；`M1..M15` 全部 CAUGHT（含 M14/M15 两道迟到响应守卫）；两个被改文件 md5 还原一致
- [x] 3.2 三套件实跑：`useOfflineStatus.test.js` 11 + `useOfflineStatus.live.test.js` 12 + `OfflineIndicator.test.js` 12 ⇒ `Tests 35 passed (35)`；另跑挂载该组件的 `App.sidebar-collapse` + `shell-mode-6a` ⇒ 12 passed
- [x] 3.3 聚合 eslint（CI Gate 11 同一条 `eslint electron/ src/ --quiet`）`AGG_RC=0`
- [x] 3.4 门禁：`check-css-var-defined` PASS（未定义变量 0）、`check-color-literals` PASS（125 / 基线 129，本次减 4）、`check-frontend-consistency` PASS、`check-locale-sync --pair-base HEAD` PASS、`--cjk` PASS（1122 条，本次把 2 条硬编码中文收进 locale）
- [x] 3.5 变异反证曾抓到**我自己的夹具时序错**（M4/M5 首跑 MISSED）：init 那一次读回会在事件之后到达并替事件写状态 / init 的失败 warn 顶替了事件后的 warn。两条用例改为「先 flush 让 init 落地、再触发事件（并 mockClear 计数器）」后各自 CAUGHT
- [ ] 3.6 桌面端全量 vitest 与像素门禁由 CI 承担（本地未跑，不写成已通过）

## 4. 文档与收口

- [x] 4.1 `01-docs/PRD-OFFLINE-BANNER-2026-10-21.md`（显示项 / 文案 / 交互 / 校验规则 / 暗档对比 / 遗留的第二半）
- [x] 4.2 `01-docs/UX-AUDIT-2026-10-17.md` 阶段 1.7 行改状态，并写明「主进程 Lost 推送」拆到后续
- [x] 4.3 `openspec/records/ux-audit-offline-live.md`（含 `## CHANGELOG 条目` / `## learnings`；远程同步行写「由门禁推导」）
- [ ] 4.4 QM-6 双模型外部评审与处置
- [ ] 4.5 PR → CI → 按判据合并

## 5. 刻意拆出的第二半（不假装已闭合）

- 主进程 `offline-manager.js::onNetworkChange` 只在恢复边通知；补 `offline:lost` 需同时改
  `electron/preload/system.js` 暴露面、`preload/access-control.js` 与 `preload.test.js:112` 的
  **等值** API 名单（本轮 grep 现场读数），并按 QM-1 做打包 + 8 秒 stderr 三层判据。本批不动 electron/，
  因此浏览器事件是当前唯一的实时源——这也意味着：**若某台机器的 Chromium 网络栈与
  electron `net` 结论不同，横幅会先显示再由复核纠正**，而不是永不出现。

## 7. 第二半：主进程 `offline:lost`（2026-10-22 并入本条 PR）

- [x] 7.1 `offline-manager.js::onNetworkChange` 补 `!wasOffline && isOffline` 分支 ⇒ 日志 + 推 `offline:lost`
      （载荷 `{isOffline:true, cachedCount}`）；恢复侧一字未动
- [x] 7.2 判据是**状态迁移**而非事件计数：重复 offline 事件不得重发（独立用例锁住）
- [x] 7.3 `preload/system.js` 暴露 `onOfflineLost`，`preload/access-control.js` 登记，
      `preload.test.js` 两处计数 141→142、339→340 并把日期与原因写进用例名
- [x] 7.4 `src/api/publisher.js` 新增 `onOfflineLost`（走 `bridgeOn("OfflineLost")`，桥缺失时 no-op）
- [x] 7.5 `useOfflineStatus`：立即采纳载荷 + 随后复核；注册失败只 warn；`dispose` 成对解绑并点名通道
- [x] 7.6 **核对后决定不做**：不给 `PUBLIC_CHANNELS` 加 send 通道（该表只管请求型通道，
      `offline:restored` 从来不在表内 ⇒ 加了就是死条目）
- [x] 7.7 修既有装饰用例：那条名字写着 sends offline:restored 的用例从来没断言 send，
      且文件顶部 `mockSend` 全文件零引用（死夹具）；本轮改为按实例换探针后再断言
- [x] 7.8 红侧取证：主进程两条 + 渲染层三条先红后绿；另有两条是**正控**（摘掉订阅仍绿，
      证明夹具能观测到 send，不是恒红）；变异「订阅门改 if(false)」实测 `3 failed | 13 passed`，
      还原后 md5 对账 == 变异前值
- [x] 7.9 QM-1 打包 + 隔离 profile 9 秒存活 + 三层 stderr 判据 + 通道级端到端真机取证（读数见执行记录 §7.9）
- [x] 7.10 全域 `vitest run src electron tests` 复跑读数（含 `tests/**`，此前只跑 src+electron 是范围窄了）
      ⇒ `1084 files: 1 failed / 1082 passed / 1 skipped`，`19068 tests: 1 failed / 19062 passed / 5 skipped`，
      `Errors` 段经 `grep -c -a` 读回为 **0**；唯一那条红是 `feedback.test.js` 的 `fs.symlinkSync` EPERM
      （本机无符号链接权限，main 工作区单跑同文件复现，不在本批改动集内）—— 归因见执行记录 §7.11

## 8. QM-6 第三轮（评审跑起来了但结论被截断；现场可见的 1 条 Critical 已修）

- [x] 8.1 两次驱动读数都如实记：不带 `CCG_ARL_DIR` ⇒ rc=2「找不到引擎」（一条都没跑）；
      带上 ⇒ 跨家族校验通过、轮 1 调 claude 后 **JSON 被截断**（括号配平 12/12 但结尾不是 `}`），rc=2。
      ⛔ 不得把 rc=2 读成"评审过了没问题"，也不得读成"评审没跑"
- [x] 8.2 从被截断输出里可读的 `i1 / Critical / correctness` 当场核为**真**：
      `offline:restored` 只赋值，既不 `++readEpoch` 也不 `reconcile()`，
      而 `reconcile()` 内部 `const epoch = ++readEpoch` ⇒ "发起复核"就是"作废在途"这个动作本身
- [x] 8.3 先写红用例（把那次复核做成慢响应，在 restored 之后释放）⇒ `1 failed | 16 passed`，
      红的正是新加那条；修复＝在恢复回调末尾补 `reconcile()`（对称化，不新增第二份 epoch 写法）
- [x] 8.4 复跑 `useOfflineStatus.live.test.js` + `tests/offline-manager.test.js`
      ⇒ **2 files / 44 passed / 0 failed**
- [x] 8.5 spec 补 Scenario「两个方向的推送都必须作废在途的旧读回」，
      记录 §八 写明截断成因与下一步（分批 + 收窄提问，不是重跑同样输入）
