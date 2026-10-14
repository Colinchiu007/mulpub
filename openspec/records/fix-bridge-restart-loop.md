---
record: fix-bridge-restart-loop
task: 主服务无限重启循环（孤儿后端占端口 + 就绪判据不校验应答者归属）——就绪必须校验 /api/health 自报 pid 等于本次 spawn 的子进程
date: 2026-10-14
---

## 本次执行记录：主服务无限重启循环——就绪判据补端口归属校验（fix-bridge-restart-loop，2026-10-14）【混合 PR】

| 环节 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离声明 | ✅ | 含 `apps/desktop/electron/**` + `packages/python-backend/**` 运行时改动 ⇒ 完整质量节拍，在隔离 worktree `D:\Data\projects\mp-worktrees\mp-fix-bridge-restart-loop`（D 盘）+ 裸分支 `fix-bridge-restart-loop` 完成。`pre-code-edit-guard.ps1` 在共享根正确拒绝（共享根禁止运行时代码改动），worktree 内放行；创建后以 `git worktree list` + `rev-parse --abbrev-ref HEAD` + `rev-parse --show-toplevel` + `status --porcelain` 四重实证非半失效 |
| 第一性原因 QM-5 ① | ✅ | `python-bridge.js` 的 `waitForHealthy()` 用 `if (await _healthCheck()) finish()` 判就绪，而 `_healthCheck()` 只 `GET /api/health` 看 `status === 'ok'`——**端口「有响应」被当成「本次 spawn 的子进程已就绪」**。事故现场：孤儿后端（pid 25480，本应用早前实例残留，02:18:06 启动后稳定服务 16.5 小时）一直占用 18357 并正常应答；本实例每次新 spawn 的后端因 `[Errno 10048]` bind 失败退出，但探活探到的是孤儿的应答 ⇒ 打出 `Backend ready on port 18357` ⇒ `restartCount = 0` 被清零 ⇒ `MAX_RESTARTS = 3` 熔断永不触发 ⇒ 无限重启。实测 **2645 次 `Starting Python backend` / 2644 次 `Process exited (code=1)`**，自 02:44:51 起持续 16.5 小时 |
| 逃逸分析 QM-5 ② | ✅ | 逃逸链：① `python-bridge.integration.test.js` 全部夹具用 `{status:'ok'}` 且子进程永活，**没有任何用例让「应答者」与「本次子进程」分离**——判据维度缺失；② 端口占用既有测试只覆盖「spawn 层 EADDRINUSE」与「子进程 exit」两条路径，而事故是**第三条路**：子进程活着的时候由外来进程应答；③ 无端到端断言「就绪后该端口确由本子进程持有」；④ 代码审查盲区：`_healthCheck` 命名与注释都在讲「后端是否健康」，掩盖了它同时被当作「归属判据」使用 |
| 系统性漏洞 QM-5 ③ | ✅ | 分类：**测试场景缺失 + 审查盲区**。根因是「健康端点只表达存活、不表达身份」——同一类漏洞也存在于 `serviceStatus` 面板的 `healthCheckDetail`（本次未扩大改动面，见已知边界） |
| 修复 QM-5 ④ | ✅ | ① `python-bridge.js` 拆出 `_healthCheckDetail()` 回传 `{ok, pid}`；`waitForHealthy()` 改为：`detail.ok` 且 `detail.pid === proc.pid` 才判就绪，不匹配立即以「端口被其他进程占用」快速失败（不再空等 30s 超时），并附占用者/自身 pid 与排查命令；② `_healthCheck()` 保留为 `_healthCheckDetail().then(d => d.ok)` 薄包装，**不产生第二份解析逻辑**（watchdog 语义不变）；③ 补「子进程已退出不得判就绪」；④ Python 侧 `HealthResponse` 增 `pid: int`，`/api/health` 返回 `os.getpid()`。**刻意不回退到下一端口**——该行为是既有刻意设计（回退会让两个后端同时写同一份 DB），本 PR 遵守并以测试固化 |
| 防再犯 QM-5 ⑤ | ✅ | JS 侧 3 条回归锁（事故场景/正向归属/无 pid 降级）+ Python 侧 1 条（`test_health_reports_own_pid` 断言 `pid == os.getpid()`）。**双向取证**：① JS 基线（暂存生产改动）我的锁为红 `promise resolved instead of rejecting`，修复后绿；② Python 基线全量我的锁为红 `KeyError: 'pid'`，修复后绿；③ 变异反证：把 `pid=os.getpid()` 改成 `+ 1` ⇒ 该锁立即红，还原即绿 |
| TDD 与相关域全量 | ✅ | JS `python-bridge.integration.test.js`：修复后 **22 passed / 2 failed**（2 条为既有失败，见下）；Python `packages/python-backend` 全量：修复后 **4 failed / 2857 passed**，基线全量 **5 failed / 2856 passed**（差值恰为我那条锁）⇒ 4 条失败全部既有、与本次改动无关 |
| 既有失败基线对照（不冒领） | ✅ | 暂存生产代码后重跑取证，全部为既有、**不在本 PR 修**：JS 2 条（`后端晚于 10 秒就绪时接管同一进程`、`健康检查超时抛错（fake timers）`，均走 Windows 专有分支、CI 在 Linux 不执行）；Python 4 条（`test_aggregation_video::test_engine_ensure_model_download_failure`、`test_frame_html::TestTemplatesDir::test_templates_dir_resolves_to_python_backend`、`test_llm_service::TestLLMServiceConfig::test_create_client_dummy_key_for_ollama`、`test_pipeline_loader::TestPipelineLoader::test_story2video_manifest_declares_text_only_versioned_contract`）。两条 JS 失败另经**隔离运行**（我的新用例被 skip 时仍失败）确认与本次改动无因果 |
| 端到端复现验证 | ✅ | 真实进程复现（该 worktree 自己的派生端口 8299，不触碰用户运行中的实例）：阶段一用 Node HTTP 服务冒充孤儿（正常应答 `/api/health` 且自报自己的 pid）⇒ `startPythonBackend` 在 **2095ms** 快速失败并精确点名两个 pid（占用者 49968 / 本次子进程 20504）；失败后 **9 秒内 python spawn 仍为 1 次、重启日志 0 条**（修复前为每 ~10 秒一轮）。阶段二释放端口 ⇒ 真实 Python 后端起来，`/api/health` 返回真实 `pid=29644`，就绪判定通过。三项判据全绿 exit 0 |
| 行尾对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径一致（提交前复验）；新增/改动文件行尾无混入 |
| 品牌残留 / docs 同步 | ✅ | `check-no-brand-residue.js` 见 CI；无 locale 改动；无 spec 变更 |
| QM-1 打包 | ✅ | `apps/desktop` 下 `pnpm run build:vue`（exit 0）后 `pnpm exec electron-builder --win --x64 --publish never` **exit 0**：win32 x64、electron 43.7.7、asar integrity 更新、NSIS 产出 `Multi-Publish.Setup.0.2.0.exe`。asar 清单 **14989 行**，含本次改动的 `\electron\services\python-bridge.js` 与 `logger`（8 命中），**无 `dist-electron` / `.vite` 包外路径泄漏**（0 命中）；解包后 `require('@multi-publish/rpa-engine')` OK、`require(electron/services/python-bridge.js)` 导出齐全 |
| QM-1 启动测试（三层判据） | ✅ | 打包应用启动 8 秒：stderr **0 字节** ⇒ 判据第③层（stderr 为空才可判通过）。**诚实附注**：进程在 8 秒内以 exit 0 自行退出，「存活」未被证明。已做**同机对照实验**：另一 worktree 不含本改动的既存打包产物（`mp-fix-sidebar-nav-slow`，10-14 19:02 构建）在相同隔离条件下行为**完全一致**（exit 0、stderr/stdout 皆空、无 userData 文件、无残留进程）⇒ 该早退是既有环境特性、**非本改动引入的回归**；两轮测试前后 `Get-Process electron` 计数均 8→8，无残留 |
| QM-4 视觉 | N/A | 无 `.vue` / 样式 / DOM 结构变更 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`。**如实登记为未执行，不冒充已闭合** |
| 已知边界（不假装闭合） | ✅ | ① **不自动结束占用者**：占用端口者可能是其他 worktree 的实例或用户主动启动的后端，自动杀进程风险高于收益；改为快速失败 + 日志给出精确排查命令（`Get-NetTCPConnection -LocalPort <port> -State Listen`）；② **旧后端降级**：应答无 `pid` 字段时降级为「不校验归属」，否则前后端版本不一致会把能用的后端判成不可用——代价是旧后端仍留事故入口，已在 `_healthCheckDetail` 注释写明；③ **watchdog 未纳入归属校验**（仍用纯存活 `_healthCheck`），本次为限制影响面刻意不改；④ 同族 `base-python-bridge.js`（splitter/prompt 等桥）的 `healthCheck` 同样只表达存活，本次未改 |
| 远程同步 | PASS（PR #3594 squash 合并 ⇒ `db4ac8172dad15401b26c5cb5999f4731512151d`，2026-10-14T22:38:46+08:00；远端分支 `fix-bridge-restart-loop` 已删（`git ls-remote --heads` 0 行），`git log origin/main --grep='(#3594)$'` 恰好 1 行） |

### 关键取证数字

- 事故规模：`2645` 次 `Starting Python backend` / `2644` 次 `Process exited (code=1)`；起于 `2026-10-14T02:44:51Z`（本地 10:44），持续 16.5 小时；`[Errno 10048]` 计数同步增长
- 占用者 pid `25480` 启动于 `2026-10-14 02:18:06`，父进程为当时 electron 主进程，稳定服务至收尾
- 修复后实测：外部占用 ⇒ 失败耗时 `2095ms`（对比修复前等待 30s 超时或无限重启）；失败窗口内 spawn `1` 次、重启日志 `0` 条
- 释放端口后：真实后端 `/api/health` 回 `{"status":"ok","pid":29644}`，归属匹配 ⇒ 就绪
- 冻结失败面：JS `22 passed / 2 failed`、Python `4 failed / 2857 passed`（4 + 2 条全部经基线对照证实为既有）
