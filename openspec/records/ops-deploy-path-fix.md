---
# 用法：复制本文件为 `openspec/records/<分支名或任务 slug>.md`。
# 文件名就是这条记录的键（与历史 `.quality-gates.md` 的"标题键"互不重叠，两套语义不混）。
# 下划线开头的文件与 `_exempt/` 子目录不参与记录计数。
record: ops-deploy-path-fix
task: 修复 ops-center/deploy 三处部署缺陷（归档仓库 clone / 安装路径不一致 / feature_gates 硬编码）并补反馈目录可写路径
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在
sync_backfill_owner: 下一个会话
---

## 本次执行记录：ops-center 部署脚本缺陷修复（ops-deploy-path-fix，2026-10-12）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（ops-center/deploy/）：隔离 worktree `mp-ops-deploy-path-fix` + 裸分支 `ops-deploy-path-fix`，共享根未落盘；pre-commit 门禁 3 项通过 |
| 第一性原因（QM-5 ①） | PASS | ①deploy.sh clone `Colinchiu007/ops-center` —— 该仓库 2026-08-10 已并入 mulpub 并归档（最后提交标题即「标注本仓库已并入 Multi-Publish（归档）」），其 deploy/ 缺 setup-service.sh，clone 它等于部署 2026-08 快照。②setup-service.sh 用 /opt、deploy.sh 用 /root，安装目录无单一事实源。③feature_gates 源写死 /root/...，而 seed.py 默认只探测 Windows 开发机路径与 ~/，服务器上必然缺失且静默跳过 |
| 逃逸分析（QM-5 ②） | PASS | 三层逃逸：单元测试层——deploy/ 是 shell，不在 pytest 覆盖范围；CI 层——无 shellcheck、无部署冒烟 job；文档层——OPERATIONS.md 只写本地启动（§11），无部署章节，缺陷无对照面。且 ops-center 归档仓库仍可 clone 成功（HTTP 200），从外部看不出已过时 |
| 修复 + 回归保护（QM-5 ④） | PASS | 改 mulpub 稀疏检出 + 覆盖前校验 4 个必需文件（缺失 exit 1）；三处统一 INSTALL_DIR（可 OPS_INSTALL_DIR 覆盖）；feature_gates 改 OPS_FEATURE_GATES_SOURCE 可配且缺失显式告警；unit 补 OPS_FEEDBACK_MEDIA_DIR。回归保护：新增 deploy/smoke-deploy.sh（3 例：来源缺失 fail-closed / fgates 缺失告警置空 / seed 可导入），bash -n 双脚本通过，pytest 541 passed，npm run build 通过，CI ops-center 后端测试 pass 6m56s |
| 防止再次发生（QM-5 ⑤） | PASS | 新增 docs/OPERATIONS.md §12（代码来源/安装目录/feature_gates/反馈目录/部署前必改项/冒烟口径），把四项口径写成运维可对照的文档；归档事实与「三个路径必须一致」进文档，避免下一个会话重犯 |
| 行尾与 diff 对账 | PASS | 变更 5 文件（A=1 M=4 D=0），无删除；新增 smoke-deploy.sh 为 A，其余为 M |
| 接线棘轮 | PASS | 新增 smoke-deploy.sh 非 *.test.js，不属测试接线；但已被 smoke 自查覆盖（改 deploy/ 后应重跑，已写入 §12.6） |
| QM-1 打包 / QM-4 视觉 | N/A | 未触桌面端运行面（无 apps/、packages/ 改动） |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录，不以自审冒充 |
| 远程同步 | PENDING | 合并后取 `git log origin/main --grep='(#3393)$' --format=%H\|%cI` 回填 merge SHA 与时间，`git ls-remote --heads origin ops-deploy-path-fix` 返回 0 行证远端分支已删；回填后删除上方三个 sync_* 字段 |

### 遗留（不假装已闭合）
- smoke-deploy.sh 未接入 CI：本次仅本机实跑 3/3 通过，CI 无对应 job，后续改 deploy/ 若忘记重跑仍可能漏。接线进 CI 需改 .github/workflows/，属「改守门者」类变更，需人工过目，本次未做。
- 归档仓库 Colinchiu007/ops-center 仍在 GitHub 可访问（HTTP 200）。若不做归档标记（如 README 置顶 + archived flag），未来仍可能被误 clone。
- QG Desktop Shards / Coverage 三个 job 耗时长（25-40 分钟 pending），与本次改动无关但拖慢 PR 收敛；未查其慢的成因。
- platform_def_service.py 的 publish-capabilities.json 相对路径（../../packages/...）在 ops-center 布局下解析失败、回落内置快照（2026-10-02）的字面量，与渲染端护栏存在漂移风险——本次发现但未修，不在本分支范围。
