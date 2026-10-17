---
record: obs-history-timing
task: history:list 补耗时读数与 >300ms 阈值告警——把「发布记录页慢 1–2 秒」从推理变成读数
date: 2026-10-17
---

## 本次执行记录：history:list 补耗时读数与 >300ms 阈值告警（obs-history-timing，2026-10-17）

### 变更类型与分层

运行时代码（`apps/desktop/electron/ipc-handlers/`）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-obs-history-timing`（脚本 `start-mp-task.ps1 -TaskName obs-history-timing`）+ 裸分支 `obs-history-timing`（基于 `725f87a0b`）。`pre-code-edit-guard.ps1` **rc=0**。

**为什么必须进 worktree 而不能走 docs-only 通道**：改的是主进程 runtime，`apps/` 在共享根写保护名单内，且必须跑 QM-1 打包。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | `start-mp-task.ps1 -TaskName obs-history-timing` → worktree + `obs-history-timing` 分支，HEAD `725f87a0b` 与 origin/main **0/0**；`pre-code-edit-guard.ps1` rc=0；依赖 `pnpm install --frozen-lockfile` + `ensure-electron`（v43.7.7）+ `verify-worktree-deps` **OK（11 项消费方）** |
| 第一性原因（QM-5 ①） | PASS | 用户报「点左侧菜单『发布链接』慢 1–2 秒」。上一轮只读排查用 `git log -S` + 全链路静态追踪定位到 `/publish/history` → `PublishHistory.vue`，并实测该页**唯一同步阻塞原语**（`publish-history.js:60` 全量 `readFileSync`）用用户真实数据（71 行 / 178,720 B）仅 **4ms**。但 `ipc-handlers/publish-history-ipc.js:39` 的 `history:list` 日志只打 `owner/total/records/page/pageSize`，**没有耗时**（对比 `ipc-handlers/account.js:380` 的 `accounts:list` 有 `耗时=`）⇒ **主进程侧拿不到读数，只能推理不能证实**。本轮补的就是这个读数缺口 |
| 逃逸分析（QM-5 ②） | PASS | 五层全失效，且**每一层的具体形状**：①**单元测试**——`publish-history-ipc.js` 此前**没有专属测试文件**，它只被 `publish*.test.js` 间接覆盖功能正确性，零条断言日志字段；②**集成测试**——无「history:list 打了几条日志、字段全不全」的判据；③**E2E/视觉**——对「画面正确只是迟到」结构性免疫；④**代码审查**——`ipcLog` 的 detail 是自由拼串，审查时没有对照清单要求「每个返回数据的 handler 必须带耗时」，故漏打不会被发现；⑤**观测**——日志缺字段这件事本身没有门禁能发现（缺字段 ≡ 字段为空，都是合法日志行） |
| 修复 + 回归保护（QM-5 ④） | PASS | 见下「实现」与「回归锁」。**§12.6 CCG 判定**：`ccg-review-decider` 对 21 行代码改动判 `mode=skip`（≤200 行且未命中敏感面），故无深度审查欠账 |
| 防止再次发生（QM-5 ⑤） | PASS | ①阈值提为**模块级常量** `SLOW_THRESHOLD_MS` 并写「为什么是 300ms」的注释（不留魔法数字）；②**反向锁**：不仅测「超阈值打 warn」，还测「不超阈值**不得**打 warn」（只锁一半等于没锁，见下 M-D 变异）；③**失败路径也带耗时**并注释理由（慢请求常常最终报错）；④CHANGELOG + 本记录 |
| 行尾与 diff 对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；改动集仅 2 文件：`publish-history-ipc.js` +23/−2（102→121 行）、`publish-account-logging.test.js` +94（219→313 行） |
| 接线棘轮 | PASS | **未新增任何 `*.test.js` 文件**——4 条回归锁全部追加进已接线的 `publish-account-logging.test.js`（该文件本就是「IPC 日志增强」的专属判据文件，语义同位）。故无「新测试文件未被 workflow 点名」风险 |
| 逐文件行数门禁 | PASS | `node .github/scripts/check-max-lines.js` → **exit 0**（`✅ 无新增超大文件，挂账清单与现实一致`；`limit=500 超限=95/挂账=95`、`testLimit=1500 超限=12/挂账=12`）。改后 `publish-history-ipc.js` **121 行**、测试 **313 行**，均远低于限额，且该文件**不在**挂账清单上（上一轮撞闸是因为改 `publish.js`，本轮文件是后来拆分出的独立模块） |
| ESLint | PASS | `pnpm exec eslint --quiet <两个改动文件>` → **exit 0** |
| 单元/集成测试 | PASS | 目标套件 `publish-account-logging.test.js` **13/13**（9 旧 + 4 新）；`electron/ipc-handlers` **全量 61 文件 / 1062 用例全绿、0 FAIL**（含 podcast 两个 bundle 契约套件） |
| QM-1 打包 | PASS | `pnpm run build:vue`（`build:preload` + paginator + `vite build`）→ **exit 0**（38.16s）；`electron-builder --win --dir --publish never` → **exit 0**；asar 清单含 `\electron\ipc-handlers\publish-history-ipc.js`。仅剩一条 `file source doesn't exist: .playwright-browsers` 属**既知环境态**（本 worktree 未装 Playwright 浏览器，与本次改动无关） |
| QM-1 ① 存活断言 | **OK** | 窗口期 8000ms 内**仍存活 = true**（`child.on('exit')` 未在窗口内触发），结束时主动 SIGKILL 自己那个 PID。**存活是三层判据的隐含前提，单独断言，不只依赖 stderr** |
| QM-1 ② 子进程 env | **已剔除 = true** | 父环境**确实带着** `ELECTRON_RUN_AS_NODE=1`；`buildChildEnv()` 剔除后断言 `hasOwnProperty(childEnv,'ELECTRON_RUN_AS_NODE') = false`，spawn 显式传该 env（不传就会重新继承） |
| QM-1 ③ stderr 三层 | **PASS（第③层）** | 首轮 stderr 290 B：`Failed to load URL: .../app.asar/dist/index.html ERR_FILE_NOT_FOUND` ⇒ 判 **NEEDS_REVIEW（第②层，不得判通过）**。根因是本 worktree 未跑 renderer build、包内缺 `dist/index.html`。补跑 `build:vue` + 重打包后**复验 stderr = 0 字节** ⇒ 第③层 PASS。**没有把第②层当通过** |
| QM-1 附：env 缺陷出声 | PASS | `envDefectNotice()` 确实打印告警（父环境带 `ELECTRON_RUN_AS_NODE=1`）——**未静默剔除**。这条对本机有实际意义：该变量会让任何 Electron 可执行文件以纯 Node 模式启动并静默退出，与「启动干净」完全同形 |
| QM-4 视觉 | N/A（有据，非免检） | 本次改动**零渲染端变更**（只改主进程一个 handler 的日志字符串与一个阈值分支），`src/` 下无任何文件被改。账号页/发布页像素基线不受影响 ⇒ 不重采基线。**判 N/A 的依据是 diff 文件集为空集，不是「我没查」**（上一轮曾把「没查」写成「不适用」，这是本仓已登记的教训） |
| 远程同步 | PASS | 已合并（PR #3831，squash）

**merge SHA**：`c812bd7b9d5e94ed583a8b1e71e53e76a410c259`
**合并时间**：`2026-10-17T12:28:16Z`（UTC）
**远端分支**：`git ls-remote --heads origin obs-history-timing` 返回 **0 行** ⇒ 已删除。

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS

## 实现（+23/−2，一个文件）

`ipc-handlers/publish-history-ipc.js`：

```js
const SLOW_THRESHOLD_MS = 300   // 模块级常量 + 注释说明「为什么是 300ms」

ipcMain.handle('history:list', withSenderCheck(async (event, opts) => {
  const startedAt = Date.now()            // 起点只罩住「取归属 + 读记录 + 追加再次发布标记」，不含 IPC 传输
  try {
    ...
    const elapsedMs = Date.now() - startedAt
    ipcLog('info', 'history:list', 'ok', `... 耗时=${elapsedMs}ms`)
    if (elapsedMs > SLOW_THRESHOLD_MS) {
      ipcLog('warn', 'history:list', 'slow', `耗时=${elapsedMs}ms 超过 ${SLOW_THRESHOLD_MS}ms 阈值 —— 发布记录页卡顿排查入口（同页同步原语实测仅 4ms，慢处不在读文件这一层）`)
    }
    ...
  } catch (e) {
    ipcLog('error', 'history:list', 'error', `message=${e.message} 耗时=${Date.now() - startedAt}ms`)  // 失败路径也带读数
  }
}))
```

口径与 `accounts:list` 的 `耗时=` **同形**，使两个页面可以在同一份日志里对时间（这正是排查「哪一页慢」所必需的）。

## 回归锁（4 条，全部追加进已接线文件）

文件：`electron/ipc-handlers/publish-account-logging.test.js`（新增 `describe('history:list 耗时可观测性')`）

| # | 断言 | 为什么必须有 |
|---|------|-------------|
| L1 | 成功路径 ok 日志含 `耗时=Nms` | 主诉求 |
| L2 | **失败路径 error 日志也含** `耗时=Nms` | 慢请求常常最终报错；只打 ok 会漏掉一半现场 |
| L3 | `>300ms` 时额外打一条 warn 阈值告警 | 从「有读数」升级到「自动出声」 |
| L4 | **`≤300ms` 时不得打告警**（反向锁） | 只测「慢的要响」证不出「不慢的不响」；后者才是防刷屏的那一半 |

**时钟注入而非真实等待**：用 `vi.spyOn(Date,'now')` + 可变 `clock`，让 `listRecords` 内部推进时钟 ⇒ 无需真实 sleep（既慢又不稳），也不用 fakeTimers 污染其它用例。

## TDD 与变异反证（实测读数）

**RED（先）**：`Tests 3 failed | 10 passed (13)` —— 3 条正向断言红、反向锁 L4 如预期已绿、旧 9 条仍绿。

**GREEN（后）**：`13/13` 全绿；`electron/ipc-handlers` 全量 `61 文件 / 1062 用例` 全绿。

**变异反证 4 条，各自指名红，无漏网**（每注入一条即跑判据、随即还原，末尾核对还原后逐字节相同 + 回绿）：

| 变异 | 内容 | 结果 |
|------|------|------|
| M-A | 从 ok 日志去掉 `耗时` 字段 | **红 ✓**，红在 L1 |
| M-B | 从 error 日志去掉 `耗时` | **红 ✓**，红在 L2 |
| M-C | 阈值告警整块短路（`if (false && …)`） | **红 ✓**，红在 L3 |
| M-D | **阈值条件写反**（`>` 改 `<`）⇒ 慢的不响、快的乱响 | **红 ✓**，同时红在 L3 **与 L4** |

> M-D 是这条判据「有牙」的决定性证据：它证明**反向锁 L4 不是装饰**——若只写 L3，条件写反会同时满足「301ms 打告警」而悄悄放过「5ms 也打告警」，告警就退化成噪声。

## 遗留（不假装已闭合）

1. **本改动只提供读数，不提供归因**。拿到 `耗时=` 后需用户在真机复现一次「点发布慢 1–2 秒」，用日志里的读数判定慢在哪一段：若 `history:list 耗时` 很大 ⇒ 主进程侧确有慢点；若很小 ⇒ 慢在渲染端（路由懒加载、组件挂载、IPC 排队），届时须转 `src/` 侧排查。**这条是把「只能推理」变成「可以证实」的那一步，但它本身不是结论。**
2. **阈值 300ms 是经验值**，未做真机分布采样。若上线后发现告警过密或过疏，调 `SLOW_THRESHOLD_MS` 一个常量即可，无需改判据。
3. **`history:get` / `history:delete` 仍未带耗时**：本轮只覆盖用户报障的列表路径（`history:list`）。若后续怀疑这两个也慢，按同一形状补即可（同一文件、同一常量）。
4. **`accounts:list` 仍无阈值告警**（上一轮登记的遗留项，本轮未动）：它只有 5 处耗时读数、0 处阈值。与本次同形，可复用同一常量口径。
