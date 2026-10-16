---
record: fix-start-app-detached
task: sync-app.ps1 启动链在 agent 会话内必被杀（三次实测），改为 WMI 脱离 + 存活断言；并修掉我第一版断言把活应用误判死的斜杠匹配 bug
date: 2026-10-16
# ↓ 三个字段只在「远程同步」尚无法收口时填写；回填成 PASS 后必须整段删除。
sync_status: PENDING
sync_reason: 本 PR（fix-start-app-detached）尚未合并，merge SHA 还不存在，无法取证收口
sync_backfill_owner: 下一个会话（三形态同改：frontmatter 三字段 + 表格行 + 记录文件无 ledger 登记项需删，同一次提交）
---

## 本次执行记录：start-app 启动链脱离 agent 会话 + 存活断言（fix-start-app-detached，2026-10-16）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR | 改 `scripts/sync-app.ps1` + 新增 `scripts/sync-app.test.js` ⇒ docs-only=false（classify 实测）。隔离 worktree `mp-start-app-detached` + 裸分支 `fix-start-app-detached`；共享根保持 main、未动他人 dirty 文件 |
| 第一性原因（QM-5 ①） | ✅ | **用户三次看不到应用**（今天 10:53 / 11:24 / 14:24）。根因不是"应用坏了"，而是**启动链挂在 agent 会话的 Windows Job Object 上，会话结束整棵树被连坐杀**。决定性对照实验（同一天、同一脚本、同一 live2）：① agent job 内 `powershell -File sync-app.ps1` → electron=0；② agent job 内 `Start-Job` + `node dev.js` → electron=0；③ **WMI `Win32_Process.Create` 拉起 bootstrap** → 8 进程 + 窗口 + 端口，**存活**。`sync-app.ps1:188` 原本用 `Start-Process powershell.exe -File $launcher`——skill 的 Pitfalls 早记载"仅用 Start-Process 启动 pwsh 跑 start-desktop.ps1 仍不够"，但 sync-app 这条路没改过 |
| 逃逸分析（QM-5 ②） | ✅ | **逃逸链**：脚本层——`sync-app.ps1` 打印 `launcher started (detached)` 就退出，**没有任何存活判据**；测试层——`mp-applive-launcher.test.ps1` 只测 launcher 内部函数（`Test-ViteServing`/`Get-AppliveAutoHealConfig`），**不测"脱离"这个契约**；skill 文档层——Pitfalls 记载了正确做法，但 sync-app 这条**具体路径**没被任何锁覆盖。系统性漏洞：**"启动成功"是打印出来的，不是断言出来的** |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① `Start-Process` → **`Invoke-CimMethod Win32_Process.Create`** 拉 launcher（launcher 内部本就 WMI 拉 dev.js，缺的只是 sync-app→launcher 这一跳）；② **加存活断言**：150 秒内必须检出本 worktree 的 electron，且优先要求可见主窗口，否则 `exit 1`（QM-1 的教训："进程起来了"与"进程活着"是两个命题）。**回归保护：新增 `scripts/sync-app.test.js` 4 条锁** |
| 防止再次发生（QM-5 ⑤） | ✅ | 4 条锁固化契约（`node --test scripts/sync-app.test.js`）：锁1 必须 WMI、禁 Start-Process 拉 launcher；锁2 必须有存活断言且失败 exit 1；锁3 worktree 匹配必须双向斜杠；锁4 保持 5.1 兼容（含反向自检：判据须能认出三元，防恒真）。**RED 实证**：对 `origin/main` 原版 3 条业务锁**全红**（0/4→3 fail），当前版 **4/4 绿** |
| 我在本轮犯并修掉的错（如实） | ✅ | **第一版存活断言把活应用判死**：A/B 实验显示应用明明活着（electron=7、窗口「社媒管家」、三端口全在），断言却报 `FAIL: process exited early`。根因：`Win32_Process.CommandLine` 是**反斜杠**，launcher 传的是**归一化正斜杠** worktree，PowerShell `-like` 两者都不容 ⇒ 单变体匹配必然漏。**用当前活进程做判定性验证实锤**：双向匹配命中=True、旧单变体命中=False。**这正是 skill 里已记载的坑（"活体检测须双向匹配斜杠变体"），我写断言时忘了应用——读过的坑会在新写代码时复发，所以必须变成锁而不是留在文档里** |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 相等 |
| 接线棘轮 | ✅ | `check-unwired-tests` OK；新增 `scripts/sync-app.test.js` 需确认被 workflow 点名（见遗留） |
| TDD | ✅ | 先写 4 锁 → 原版 3 红（证明锁有效）→ 实现 → 4/4 绿；锁4 的判据本身也做反向自检 |
| QM-1 打包 / QM-4 视觉 | N/A | 未触 `apps/desktop/electron/` 与视觉面 |
| QM-6 CCG 双模型外部评审 | 未执行 | 判定 single（见 .ccg/reviews/<HEAD>.json）；本片为启动脚本修复，不涉运行时代码 |
| 实测（三场景） | ✅ | ① 修好后在**原失败场景**（agent job 内直接调 sync-app）：`START_CONTRACT_OK: electron alive with visible main window (WMI-detached)` rc=0；② **job 结束后仍存活**：electron 8、窗口 pid=17428「社媒管家」、三端口 5231/9279/18357 全监听；③ 前台直启 dev.js 复现应用无问题（electron=7、账号检查 9 个全过）——证明失败只在启动链，不在应用 |
| 已知边界 | ✅ | ① `Invoke-CimMethod` 需要本机 WMI 可用（skill 已记载"WMI 不可用回退 Start-Process"，本轮保留该回退但断言仍会兜住：回退形态下断言可能超时失败，属**正确的 fail-loud**，不会假绿）；② 存活断言按 worktree 路径匹配，若未来改用别的活体检测口径需同步锁3；③ `0xC0000135`（STATUS_DLL_NOT_FOUND）在 Job Object 强杀时也会出现——我一度误判为 DLL 缺失，实际电子文件/dist 与 VC 运行时都完好，最终由 A/B 对照（同代码、同环境，仅启动方式不同）定位为连坐杀。**教训：退出码不能单独当根因，必须做变量隔离的对照** |
| 远程同步 | PENDING | 本 PR 尚未合并；合并后由回填会话同一次提交改写 PASS + merge SHA 并删除上方 sync_* 三字段 |
