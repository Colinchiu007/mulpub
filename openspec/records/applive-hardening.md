---
record: applive-hardening
task: 应用启动白屏防护：Vite 存活探针 + 可选自愈（env 门控，默认关闭）+ 白屏根因 runbook
date: 2026-10-12
---

## 本次执行记录：应用启动白屏防护——Vite 存活探针 + 可选自愈（applive-hardening，2026-10-12）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码 + `.github/workflows/` + `scripts/`（行为变更）→ 隔离 worktree `mp-applive-hardening`，裸分支 `applive-hardening`（基线 `origin/main`=`a08c7ce3c`）；`pre-code-edit-guard.ps1` rc=0 已验证 |
| 第一性原因（QM-5 ①） | PASS | `/start-app` 白屏的第一性原因是应用启动后 Vite dev server 被外部进程**杀死/僵尸化**：端口仍在监听但 HTTP 返回空或非 HTML 体，前端拿不到入口 HTML ⇒ 白屏。此前该链路只等"端口监听"就绪，对"端口在但服务已死"零感知，只能靠人工重启 |
| 逃逸分析（QM-5 ②） | PASS | ①启动链路没有对 Vite 实际返回的 HTML 做存活探针，仅轮询 TCP 端口；②dev server 中途死亡后没有任何自愈，Electron 窗口停在白屏；③代码审查与视觉回归都不覆盖"dev server 运行中途死亡"的场景，缺陷在 CI 全绿时仍能漏到用户态 |
| 修复 + 回归保护（QM-5 ④） | PASS | `scripts/mp-applive-launcher.ps1` 新增 `Test-ViteServing`（拉取 `/` 并校验响应体为 HTML，纯 ASCII、无 import 级依赖）、`Get-AppliveAutoHealConfig`（读 `MP_APPLIVE_AUTOHEAL` 默认 OFF、`MP_APPLIVE_AUTOHEAL_MAX` 默认 3，非法/≤0 回落 3）、`Invoke-AppliveAutoHeal`（注入式 scriptblock，发 `AUTOHEAL_DISABLED`/`AUTOHEAL_ENABLED`/`AUTOHEAL_RESTART`/`AUTOHEAL_EXHAUSTED`），主流程接探针 + 自愈；`scripts/mp-applive-launcher.test.ps1` 7 节覆盖配置/探针/自愈（结尾 `APPLIVE_LAUNCHER_TEST_OK`）；`.github/workflows/quality-gate.yml` Gate 2d 显式点名该测试 |
| 防止再次发生（QM-5 ⑤） | PASS | 探针 + 门控自愈把"dev server 死亡 → 窗口白屏"由人工重启升级为机械可观测、可选项自愈；`docs/app-live-white-screen-runbook.md` 固化根因、判定词与处置 SOP |
| 行尾与 diff 对账 | PASS | `git diff --numstat origin/main HEAD` 两口径（含 `--ignore-cr-at-eol`）一致：`.github/workflows/quality-gate.yml` 1/0、`docs/app-live-white-screen-runbook.md` 91/0、`scripts/mp-applive-launcher.ps1` 298/125（含基线重写 125 行）、`scripts/mp-applive-launcher.test.ps1` 123/0 |
| 接线棘轮 | PASS | 新增 `scripts/mp-applive-launcher.test.ps1` 由 `quality-gate.yml` Gate 2d 显式 `pwsh ... -File scripts/mp-applive-launcher.test.ps1` 点名，避免"写了测试却未被 CI 收集" |
| QM-1 打包 / QM-4 视觉 | N/A | 本次仅改动 `scripts/*.ps1` launcher 与 `.github/workflows/`；QM-1 触发条件（修改 `apps/desktop/electron/` 或 `packages/rpa-engine/`）不命中，无打包/视觉面 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper` 双模型评审器，按 `_TEMPLATE.md` 如实写「未执行」，不冒充通过；变更以纯 ASCII launcher 脚本 + 测试 + CI 接线为主，门禁由 Gate 2d 测试与 QM-1 豁免覆盖 |
| 远程同步 | PASS | 11782ecb60ffd3a446022d09263f2e93713dda2b (2026-10-12T01:26:19+08:00) |

### 遗留（不假装已闭合）

- 自愈默认关闭：本 PR 只把**能力**接好并门控，默认 OFF（避免误杀正常会话）；如需默认开，需先有"自愈误判率/重启抖动"的实测基线，建议独立 PR 评估。
- 探针仅校验"返回为 HTML"，未校验 HTML 内挂载点/脚本是否存在；更深的"页面加载但不渲染"类缺陷仍需人工排查，runbook 已留处置指引。
