---
change: ux-audit-stale-watchdog
branch: ux-audit-stale-watchdog
date: 2026-10-22
---

# 执行记录：发布进度「无更新」可见化（UX 审计 1.8）

## 门禁表

| 项 | 状态 | 读数与判据 |
| --- | --- | --- |
| 变更类型与隔离 | ✅ | 运行时代码变更（`apps/desktop/src/`）⇒ 隔离 worktree `mp-ux-audit-stale-watchdog`，裸分支 `ux-audit-stale-watchdog`，落点 `D:\Data\projects\mp-worktrees`（非 C 盘）；`node scripts/verify-worktree-deps.js` → OK（11 项解析通过） |
| TDD | ✅ 先红后绿 | 新增 `src/stores/publishProgress.stale.test.js`（9 条）**首跑 9 failed / 0 passed**（`/d/tmp/stale-red.log`：`Test Files 1 failed`、`Tests 9 failed (9)`），实现后同文件 9 passed；面板侧 4 条新用例首跑即红 1 条（`handleClose` 被写成两份、旧的一份覆盖新的），修完 45 passed |
| 消费者并集 | ✅ | `git grep -l publishProgress/PublishProgress*` 取并集后跑 12 个测试文件：**298 passed / 0 failed，无 `Errors` 段**（`/d/tmp/stale-union.log`）。范围口径如实写：这 12 个文件是**消费者并集**，不含 `electron/` 与 `tests/` |
| 全域 | ⏳ 回填 | `vitest run src` 正在跑（`/d/tmp/stale-src-full.log`），读数见 §2 |
| 反证（8 道） | ✅ | `node scripts/stale-watchdog-contract-mutate.js --keep-going` ⇒ `[BASELINE] rc=0 failed=0 passed=45 collected=45 errors=0 blind=false`、`[SUMMARY] 共 8 条：CAUGHT=8 其余=0`、8/8 `RESTORE_OK`、驱动 rc=0。S2 首跑是 **PARTIAL_RED（探针 0/1）**，成因见 §3.1，修完重跑 CAUGHT |
| QM-1 打包 | N/A（如实声明） | 本批只动 `apps/desktop/src/`（store + 三个组件 + locales），未触 `electron/` 与 `packages/rpa-engine/` ⇒ 按 QM-1 的触发条件不适用。**不是**"跑过且通过"，是"未触发" |
| QM-4 视觉 | ⏳ 交 CI 判 | `/first-run` 类改动不同：本批动的是 `PublishProgressPanel` 的徽标 DOM（class 由静态变绑定）与任务行文案。非陈旧态下 class 集合与文本未变，但**这不是我本地能证的** —— 由 `QG Visual`（Gate 7，windows-latest + CI 的 Chromium）判，红则按"基线只能取自同一次 CI 渲染"口径处理，禁止 `--update-baseline` 消化 |
| 静态门禁 | ✅ | `check-locale-sync.js --pair-base origin/main` → **PASS**；`--cjk` → **PASS（基线 1330 条，当前 1124 条，无新增硬编码）**；新增 3 键 zh/en 逐个 `grep -c` 均为 1；聚合 eslint 8 个改动文件 rc=0 |
| 行尾对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径逐字一致（见 §4 的暂存后读数）；新建文件一律 LF；`CHANGELOG.md` / `01-docs/UX-AUDIT-2026-10-17.md` 当场量得 cr=0（LF），未做统一回写 |
| 新文件未被 .gitignore 吞掉 | ✅ | `git check-ignore --no-index -v` 实测 `scripts/*.js`（.gitignore:106）**确实命中**新建的反证驱动 ⇒ 按既有惯例补 `!scripts/stale-watchdog-contract-mutate.js`（同族第 N 次：漏反选的症状是"本地全绿、CI 上 Cannot find module"）；测试文件 `publishProgress.stale.test.js` 不在忽略域内 |
| QM-6 双模型 | ⏳ | 见 §5 |
| 远程同步 | 由门禁推导 | PR 号见 §5；合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口，不手写状态词 |

## 1. 用户可见变化（逐项）

| 位置 | 修前 | 修后 |
| --- | --- | --- |
| 面板头部徽标（全部任务 3 分钟无事件） | 永远转圈显示「进行中」，与"正在推进"不可区分 | **停掉转圈**，中性档显示「N 分钟无更新」；不用失败红（无事件不是失败的证据） |
| 任务行状态列 | 只显示阶段词 | 无更新的行追加「（N 分钟无更新）」；未陈旧的行不追加 |
| 关闭按钮 | `:disabled="hasRunning"`，挂死时**永久灰** | `hasRunning && !hasStalledRunning`：只要还有任务在动仍禁；全部无更新即解禁，`title` 改为「任务已 N 分钟无更新，可关闭面板（不会取消任务）」 |
| 点关闭 | 只在 `sessions.length===0` 时收起 ⇒ 即便解禁也"点了没反应" | 追加 `|| hasStalledRunning` 出口：真的把面板收起，且**不丢** `sessions`（展开仍是原状态）、不发取消 IPC |

## 2. 时钟与预算

- 阈值 `STALL_AFTER_MS = 180_000`、心跳 `STALL_TICK_MS = 15_000` 均在 store 模块级单点导出，
  组件不再各算一份时间差（反证 S1 打的就是"阈值被改成永不发火"这一格）。
- **同域比较**：判据两侧都取渲染端 `Date.now()`（`lastEventAt` 本就是它写的），
  刻意**不读**事件里带来的主进程 `timestamp` —— 反证里专门有一条
  「事件带一个 13 位纪元戳，不得据此判陈旧」。
- 测试全部 `vi.useFakeTimers({ now: … })`，不写死"相对当下的绝对时间戳 + 相对窗口"那种引信形态。

## 3. 本轮两处自错（按实况记，不删）

### 3.1 `watch` 恒不触发 —— 一条"接了线但不执行"的装饰性接线

最初把 tick 的启停挂在：

```js
watch(() => 有没有非终态任务, (hasLive) => hasLive ? 起 : 停, { immediate: true, flush: 'sync' })
```

看起来是"所有出口自动覆盖"的最省写法。实测**一次回调都没执行**：本 store 的会话对象是
`push` 进 `ref([])` 之后按**原始引用**继续改的（`_createSession` 返回 raw session，
`_ensureTask` / `handleProgressEvent` 直接改 raw），Vue 的响应式追踪看不见这些写入。

发现方式不是读代码，是**新写的行为锁当场红**：`存在非终态任务 ⇒ 需要 tick` 那条读出
`活跃 tick 数 = 0`。如果我只测"陈旧集合对不对"（computed 在被读时照样算得出来），
这条装饰性接线就会带着"看起来已实现"的状态进主干。

现改为显式挂在必经出口 `_recomputeSessionStatus` 上，并对三条**不经该出口**的路径
（新建会话分支 / `dismissSession` / `clearFinished`）各补一次调用 ——
"单一入口"在这里不成立，成立的是"单一判据 + 全部出口都调它"。

### 3.2 同名函数被写出两份，后者静默覆盖前者

改 `handleClose` 时没注意文件里已有一个同名声明，于是我以为的新实现是**死代码**。
抓它的正是 §1 第 4 行那条用例（解禁后点关闭 ⇒ `panelVisible` 仍为 true）。
已删除旧实现，只留一份。教训与 §3.1 同源：**"我以为改了"与"运行时执行的是哪一份"是两件事**，
只有行为锁能分辨。

### 3.3 反证 S2 首跑 PARTIAL_RED 的成因（判据顺序，不是断言写错）

`stalledTaskIds` 是 computed，副作用只在**求值时**发生。用例原先的顺序是
「断 phase 未变 → 再读 stalledTaskIds」，于是 S2 注入的 `task.phase='failed'` 发生在断言之后，
锁抓不到自己声称的东西。修法不是改宽断言，而是**按生产的读取顺序排队**
（先算派生值，再断 phase）—— 面板渲染就是这个次序。
这条与「测试断言不得反向固化错误行为」同族，但落点是**断言顺序**，值得单记。

## 4. 收尾清单（提交后回填）

- `git diff --numstat` / `--ignore-cr-at-eol --numstat` 两口径读数：（提交后填）
- PR 号、CI 结果、是否自动合并及理由：见 §5

## 5. QM-6

（评审跑完后回填：后端、条目、逐条处置、闭环状态与不可闭合原因。）
