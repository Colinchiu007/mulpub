---
record: xhs-tier2-endpoints
task: CCG 深评第四/五轮裁决落地——判据与成本闸分离、截断留痕（Tier2 加固专项，含 rebase 解冲突与 gui-test.yml 结构修复）
date: 2026-10-11
---

## 本次执行记录：小红书 DOM/RPA Tier2 加固（xhs-tier2-endpoints，2026-10-10/11）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | python-backend 发布器 + electron CI ⇒ 隔离 worktree `mp-xhs-tier2`，分支 `local/xhs-tier2-endpoints`（20 提交）|
| 修复内容 | PASS | 判据与成本闸分离、截断留痕、草稿箱计数条件轮询、活体取证固化确认判据、回查失败升 warning、兜底标题扫描补成本闸、风控文本轨归一（词表收强指认短语防裸词误判）、按行数闸拆出 DOM 模块 |
| CI 收敛（含 rebase） | PASS | PR 曾 DIRTY（与 main 分叉 91 提交）：rebase 12 轮冲突全解（py 发布器/选择器/测试保 HEAD 演进版，docs 保详细版，gui-test.yml 双层标记修复）；后续 gui-test.yml 重复键再修（rebase 解法缺陷补救）；最终 20/20 checks 全 SUCCESS |
| 真机验证 | PASS | 草稿箱计数条件轮询 + 活体取证固化（判据与成本闸分离后不再空等）|
| 远程同步 | PASS | #3200 = `87e311c45e9e596690c735884c0d523c73022066`（squash，2026-10-11T04:30:06Z）。取证：`git log origin/main --grep='(#3200)$'` 唯一命中；`git ls-remote --heads origin local/xhs-tier2-endpoints` 返回 0 行；worktree R1-R5 删除（gone: True，R7 基线 M/D=0）|

### 过程记录（rebase 冲突解法备忘）

- gui-test.yml 曾出现**双层冲突标记**（<<<<<<< HEAD <<<<<<< HEAD）与重复键（working-directory/shell/run 出现两组）——
  初版解法只删了部分行，导致 yml 结构仍非法、静态守卫 4 用例红。二次修复（删除重复键段）后与 main 对齐。
- untracked 清位时误删了分支内被跟踪的 .adversarial/.ccg 文件——已 git checkout 恢复（教训：删 untracked 前先确认这些路径不在跟踪清单）。

### 遗留（不假装已闭合）

- xiaohongshu 登录载体改造（支持主站 web_session 会话）——见 xhs-note-align 记录，独立工作项。
