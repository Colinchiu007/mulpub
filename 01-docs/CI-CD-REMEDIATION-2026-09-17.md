# CI/CD 整改文档（2026-09-17）

> 关联 PR：#1900（已合 main）、#1901（评审中）、#1902（评审中）、#1903（评审中）
> 目标：把「触发条件不对称」+ 5 类 CI 单点隐患 + 根治清单固化成一份可引用记录，使本次所有改动有据可查。
> 位置：本文件落 `01-docs/`（按本仓约定为本地工作文档，`.gitignore` 忽略，不进常规提交；如需纳入仓库历史见 §5 的 PR）。

## 0. TL;DR

- 今日（及近期）CI 连环故障的根因**不是单点 bug**，而是 **5 类单点隐患叠加**：制品配额、自托管 runner 脆弱性、契约/平台测试债、触发条件不对称、本地 git 不可靠。
- 已落地 4 个修复 PR：
  - **#1900**（已合 main `46a119a9bf`）：build.yml 上传 Windows 安装包步加 tag 门控，根治 artifact 配额爆满。
  - **#1901**：契约测试对齐 Windows 自托管（去掉 xvfb 硬断言）。
  - **#1902**：visual-test 上传步改 `continue-on-error`，配额满不置红。
  - **#1903**：Electron CI 的 `pull_request` 加正向 `paths` 过滤（本次重点，见 §1）。
- 仍有待办：小制品 retention 降 1–3 天、其余 workflow 触发对称性复核、损坏 run 清理（仅 Support 可清）。

---

## 1. 触发条件不对称（本次重点）

### 现象
- `electron-ci.yml`：`push: [main]` 带 `paths-ignore`（`01-docs/**`、`docs/**`、`*.md`、`LICENSE`、`.gitignore`、`.editorconfig`、`.ccg/**`、`.claude/**`、`.hermes/**`、`.agents/**`、`openspec/**` 不触发）；
  但 **`pull_request: [main]` 完全没有路径过滤**。
- 后果：**每个 PR**（含 #1901 仅改 `.github/scripts/workflow-contract.test.js`）都触发完整 Windows 自托管 Electron 回归，绑死那台易卡死的 `win11-desktop-01` runner，是日常 CI 排队/噪音的根因之一。

### 根因
- 触发条件在 `push` / `pull_request` 两侧**不对称**：`push` 已意识到「非代码改动不该跑重型 CI」，`pull_request` 却漏了同等过滤。

### 修复（PR #1903）
- 给 `pull_request` 加**正向 `paths`**：
  ```
  paths:
    - 'apps/desktop/**'
    - 'packages/**'
    - 'scripts/**'
    - 'package.json'
    - 'pnpm-lock.yaml'
    - '.github/workflows/electron-ci.yml'
  ```
- `push` 的 `paths-ignore` 不动，两侧现在对称。
- 语义：桌面相关改动合并前仍跑（保证 main 始终可发布）；纯文档 / ops-center / web 等无关 PR 不再占用 Windows runner。
- 验证：PR 本身改了 workflow 文件（在 `paths` 清单内），Electron CI 会照常触发，正好验证改动。

---

## 2. 5 类 CI 单点隐患

每类含：现象 / 根因 / 影响 / 已落地修复。

### 2.1 制品配额单点（artifact quota）
- **现象**：免费 500MB 配额爆满，仓库累计约 1.03TB 制品（99.9% 来自 469MB `Multi-Publish-Windows` 安装包反复生成）。所有带 Upload 的 job 报错 `Failed to CreateArtifact: Artifact storage quota has been hit`。
- **根因**：`build.yml` 的 `Upload Windows artifact` 步 `retention-days: 7` 且无 tag 门控，普通 `main` push 也上传 469MB 却无人下载，纯浪费配额；其余 report 制品均 ≤9MB。
- **影响**：任何带 Upload 步的 job 假失败，误导合并门禁（如 #1901 的 `visual-test` 本体全通过，仅收尾上传失败）。
- **修复**：#1900（已合 main）给上传步加 `if: startsWith(github.ref,'refs/tags/v')`；#1902 给 visual-test 上传步加 `continue-on-error: true`。

### 2.2 自托管 runner 脆弱性（runner fragility）
- **现象**：`win11-desktop-01` 常驻进程 + `run-loop.cmd` 无限循环 → 杀进程后自动重生、`busy` 永不清；派发故障（online 却不认领 job）；古董损坏 run 堵在队列最前。
- **根因**：计划任务 `RestartCount=10` + run-loop 死亡螺旋；卡在 GitHub 内部 `requested` 态的损坏 run 无法被 cancel（`409`/`202` 均无效，连 `force-cancel` 也 409）。
- **影响**：Windows 自托管 job（Electron CI / gui-test / quality-gate / visual-test）全堵。
- **修复**：宿主机两段式修复（`RestartCount=0` → 结束进程 → 等 offline → 恢复并启动）+ 新 token 重建。损坏 run **仅 GitHub Support 工单可清**（免费账户无工单入口，走社区讨论）；删除 + 重建 runner 对堵队列**无效**（损坏在 run 对象本身，非 runner 指派）。

### 2.3 契约 / 平台测试债（contract drift）
- **现象**：main HEAD 上 `QG Static` 恒红，报错 `Electron GUI gate 必须经 xvfb 虚拟显示`。
- **根因**：`gui-test.yml` 的 `Electron GUI gate (release-only)` 已迁 `[self-hosted, windows, x64]` 并去掉 xvfb（Windows 无需虚拟帧缓冲），但 `.github/scripts/workflow-contract.test.js:93` 仍硬断言 `/xvfb-run/`（Linux 旧假设）→ 契约测试与 workflow 现实不同步。
- **影响**：main 天生红，quality-gate 永远过不了，掩盖真实回归。
- **修复**：#1901 把契约测试改为「Windows 自托管下断言**不走** xvfb」+ 正断言直接启动 `electron-gui-v9.js`，保留 `startsWith(github.ref,'refs/tags/v')` tag 门控 + `timeout --signal=TERM --kill-after=30s 8m` 硬看门狗。

### 2.4 触发条件不对称（trigger asymmetry）
- 见 §1。修复：#1903。

### 2.5 本地 git / partial-clone 不可靠（tooling fragility）
- **现象**：partial-clone 上 `reset --hard` 制造**假 D**（工作树缺文件但 index/HEAD 完好）；`git rev-parse origin/main` 报 stale/MISSING；`git worktree add` 把索引弄错成 root-commit + 5488 文件全量提交；`git status` 显示 `.github/` 大量 ` D ` 而磁盘上目录已物理消失。
- **根因**：partial clone + 代理 EOF 物化失败；并发会话破坏共享 `.git`；监控脚本空响应误判（假绿误合并）。
- **影响**：本地无法可靠提交/验证，凡建提交都被迫走 GitHub Git DB API；假绿脚本曾误合并 PR #1897。
- **修复**：凡建提交/分支一律 GitHub Git DB API（blob→tree→commit→ref，见 §5）；监控脚本加「总数 > 0 守卫 + 空响应按未通过 + 重查 total_count 二次确认」。

---

## 3. 根治清单（durable guardrails）

### A. 制品配额
- [x] build.yml 上传 Windows 安装包步加 tag 门控（#1900 已合 main）
- [x] visual-test.yml 上传步 `continue-on-error`（#1902）
- [ ] 小制品 report retention 降到 1–3 天
- [ ] 定期 bulk-delete 过期制品（stale `total_count` 不可信，以真实 204 删除数衡量）

### B. 自托管 runner
- [x] 宿主机两段式修复（`RestartCount=0` → 结束进程 → 等 offline → 恢复并启动）
- [x] 固化教训：删除 + 重建 runner 对堵队列无效（损坏在 run 对象本身）
- [ ] 损坏 run 仅 Support 工单可清；免费账户无入口 → 社区讨论；或接受为无害幽灵

### C. 契约 / 平台测试
- [x] 契约测试随 workflow 迁移同步更新（#1901）
- [ ] 契约测试不得硬写平台专属期望（Linux xvfb / Windows 平台断言）；跨平台断言用动态探测

### D. 触发条件对称性
- [x] `pull_request` 加正向 `paths`（#1903）
- [ ] 复核其余 workflow 的 `push` / `pull_request` 触发是否对称

### E. 本地 git 可靠性
- [x] partial-clone 上禁止 `reset --hard`；假 D 精确恢复（按 `status` 清单 `xargs -n 20 git checkout --`）
- [x] 凡建提交/分支一律 GitHub Git DB API

### F. 监控脚本铁律
- [x] 总数 > 0 才允许判定全绿
- [x] `gh` 调用失败/空响应按「未通过」处理
- [x] 轮询到空/0 须二次确认（重查 `total_count` / 重试），防限流抖动假绿

---

## 4. 关联 PR 索引（有据可查）

| PR | 标题 | 状态 | 解决的隐患 |
|----|------|------|-----------|
| #1897 | ci: 修复 CI 基础设施门禁（PR 无门禁 / nx 空集 / artifact 配额 / agent-judge 降级） | 已合 | 配额/门禁 |
| #1900 | fix(ci): 仅 tag 推送时上传 469MB 安装包（根治 artifact 配额） | 已合 main `46a119a9bf` | 2.1 |
| #1901 | fix(ci): 契约测试对齐 Windows 自托管（去 xvfb 硬断言） | 评审中 | 2.3 |
| #1902 | fix(ci): visual-test 上传改 best-effort（配额满不置红） | 评审中 | 2.1 |
| #1903 | fix(ci): Electron CI `pull_request` 加正向 `paths` 过滤 | 评审中 | 2.4 / §1 |

---

## 5. 附录：本次用到的命令 / 脚本

- **建提交走 GitHub Git DB API**（绕过损坏的本地 git）：
  `D:/Data/projects/Multi-Publish/.workbuddy/create-pr-1903.py`
  流程：`GET /git/refs/heads/main` → `/git/commits/{sha}` 取 tree → `/git/blobs/{sha}` 取原文 → 修改 → `POST /git/blobs` → `POST /git/trees`（base_tree）→ `POST /git/commits`（parents=[main]）→ `POST /git/refs` 建分支 → `gh pr create`。
- **监控 PR CI**：`D:/Data/projects/Multi-Publish/.workbuddy/monitor-1903.py`（轮询 `gh pr checks 1903 --json`，全 completed 才退出）。
- **清理 artifact 须 `curl + $(gh auth token)` 直连**：本沙箱 `gh api` 对 `api.github.com` TLS 握手超时，`curl` 直连稳定；`total_count` 严重 stale（幽灵条目），以真实 204 删除数衡量进度。

---

*本文件为整改记录，随 #1901/#1902/#1903 合并后如有新结论再补充。*
