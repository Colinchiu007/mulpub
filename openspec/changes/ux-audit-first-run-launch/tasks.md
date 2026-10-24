# 任务：首启向导接回启动判定（ux-audit-first-run-launch）

## 1. 测试先行（红）

- [x] 1.1 `electron/services/first-run.test.js`：`runSetup` 在无标记时 **不得**创建 `first-run-done`，
      且广播 `{type:'needed'}`；有标记时广播 `{type:'done'}` 且不写文件
- [x] 1.2 `markDone()` 写入唯一标记文件；重复调用幂等（不追加、不报错）
- [x] 1.3 `ipc-handlers`：`first-run:complete` 返回 `code:0` 且落标记；写盘失败返回错误码并留日志（不静默）
- [x] 1.4 **三处配对锁**：`first-run:complete` 同时出现在 handler 注册、`PUBLIC_CHANNELS`、preload 导出；
      任一缺失即红并点名缺哪处
- [x] 1.5 `App.vue` 判定（拉取式）：`setupDone === false` ⇒ 导航 `/first-run`；`true` ⇒ 不导航；
      **桥不可用（兜底档）⇒ 不导航**；且判定只发生一次
- [x] 1.6 向导：点「完成」与「跳过」都调 `firstRunComplete()` 再进主界面；中途离开不调 ⇒ 标记不落
- [x] 1.7 显示面：向导**不得**出现"从未跑过的检测结论"（`✅ Python 依赖` / `✅ Playwright 浏览器` 这类），
      并锁 `retryDeps` 那种"注释承诺重跑、实际只读"的形态不得回归

## 2. 实现（绿）

- [x] 2.1 `first-run.js`：删自动落标记；导出 `markDone()`；`runSetup` 只读 + 广播
- [x] 2.2 `ipc-handlers/misc.js` 新增 `first-run:complete`；`license-access-control.js` 同批登记
- [x] 2.3 `preload/system.js` + `preload/access-control.js` 导出 `firstRunComplete`；`preload.test.js` 导出清单同步
- [x] 2.4 `src/api/publisher.js` 增 `firstRunComplete()`（**不得**给它一个会把"桥不可用"伪装成
      `setupDone:false` 的兜底；判定要能区分三档）
- [x] 2.5 `App.vue` 挂载时拉一次判定并按需导航（模块级闩防重复）
- [x] 2.6 `FirstRun.vue`：两行假检测改如实信息行；撤 `retryDeps` 的假承诺；加「完成」/「跳过」出口
- [x] 2.7 locales：新增文案 zh/en 成对（`src/locales/onboarding/*` 内增键，不改既有语义）
- [x] 2.8 重跑 `FirstRun.test.js` 19 条，按新语义改写涉及检测行的断言（方向是"不再显示未跑过的结论"，
      不是删断言）

## 3. 打包与运行验证（QM-1，改了 electron 必跑）

- [x] 3.1 `pnpm run build:dir`（先 vite build，避免 `--dir` 产物打 `ERR_FILE_NOT_FOUND`）
- [x] 3.2 隔离 `--user-data-dir` 启动 + 8s 存活断言 + 三层 stderr 判据；子进程 env 经 `buildChildEnv()`
- [x] 3.3 **现场两条**：全新空 profile 首启进向导；已有 `first-run-done` 的 profile 首启不进向导。
      读数（截图或窗口标题/路由取证）写进执行记录

## 4. 反证

- [x] 4.1 `scripts/first-run-launch-contract-mutate.js`：F1–F15 逐条注入（F8/F9 是 F8 首跑 MISSED 后拆出来的两道闸各打各的；
      F10/F11 随 QM-6 i2/i6 补；F12–F14 随 i3/i5 补；F15 随 i10 补）
      （规矩沿用 1.2/1.3：可执行形态、不攻击断言本身、解析前剥 ANSI、`collected>0` 下界、`RUN_UNCLEAN` 档、
      还原后 md5 回读 + 信号兜底）
- [x] 4.2 末跑 `CAUGHT=15/15`（基线 `collected=290 passed=290`）且每条 `RESTORE_OK`、驱动 rc=0。
      **反证域随 i5 扩过一次**：`src/api/publisher.test.js` 原先不在 `TEST_FILES` 里，
      所以 11 道那轮的 `collected=45` 对 i5 不构成证据；F13/F14 若不在域内只会读出「域内零红」。
- [x] 4.3 F15 的教训写进 PRD §4.2：i10 的判别式必须是「写入落点是临时名」，
      只断言「最终名内容完整」对"直接写最终名"完全免疫（旧写法产出的内容同样完整）⇒ 反证会 MISSED

## 5. 文档与验证

- [x] 5.1 `01-docs/PRD-FIRST-RUN-LAUNCH-2026-10-21.md`
- [x] 5.2 审计文档 1.4 行状态 + 文末落地记录；CHANGELOG 条目
- [x] 5.3 `openspec/records/ux-audit-first-run-launch.md`（门禁表 + 现场读数）
- [x] 5.4 全域 `vitest run src`（先 `build:preload`）+ `electron` 侧相关测试 + 聚合 eslint + 静态门禁
- [ ] 5.5 QM-6 双模型评审与逐条处置（判定必为 DUAL：改了 electron/ + IPC + 授权白名单）
      —— **首轮已跑完并逐条处置**（proposer=opencode / critic=claude，10 条：6 Warning + 4 Info；
      i1 判不成立，i2–i6 成立并修，i7–i10 四条 Info 同批处置；逐条依据见记录 §四）。
      未勾剩的原因是**闭环状态**：填完真实裁决后驱动落 `self_play_blocked`（5 条 upheld），
      而现有词表没有"指控成立且已在本 PR 修好"这一档，`closureNote` 只覆盖假阳性 ⇒
      `check-pr-exec-record.js --mode=enforce` 仍报欠账、本 PR 不自动合并（任务 #19，机制缺口非 diligence）。
- [ ] 5.6 PR + CI + 合并后回读 main push

## 6. 遗留（写明，不静默吞掉）

- [ ] 6.1 `services/onboarding.js` 的三条 IPC 通道**全仓零调用方**（实测），属"注册但无人用"的死通道；
      退役它要同时动 `PUBLIC_CHANNELS` / 两个 preload / `preload.test.js` 的导出清单 ⇒ 另批
- [ ] 6.2 `firstRunCheck()` 的 `invokeWithFallback` 兜底把"桥不可用"伪装成 `setupDone:false`
      —— 本批在调用侧显式区分，兜底本身是否改成 `code:-1` 属 API 面统一话题，登记不改
- [ ] 6.3 反证驱动接进 CI（任务 #23）
- [ ] 6.4 **本批自己制造的一条死通道**（QM-6 i4）：撤掉向导页的订阅后，`first-run:status` 广播 +
      `onFirstRunStatus`（preload、access-control 清单、两个 bundle、publisher 导出）全仓零消费者。
      它与 `services/onboarding.js` 的三条无调用方通道是同一形态，**必须并成同一次退役**，
      因为退役要同时动 `PUBLIC_CHANNELS` / 两个 preload / `preload.test.js` 的导出清单与 bundle 重打包，
      分两批改会留下"删了一半的清单"这种更难查的中间态。本批不假装它在服务谁。
- [ ] 6.5 `__resetFirstRunGateForTest` 仍从生产模块 `useFirstRunGate.js` 导出（QM-6 i7 第三条）：
      它是模块级闩的唯一测试复位口，代价是一个只有测试会调的符号进生产 bundle。
      正解是把闩的状态移进可注入的 store 或独立测试夹具模块，但那要同时改 `App.vue` 的接线形状
      与接线锁的锚点，属另批；本批只在函数文档里写明"生产代码不得调用"，不假装它不存在。
