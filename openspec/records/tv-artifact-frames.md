---
record: tv-artifact-frames
task: 视频号作品列表判据改为遍历所有子 frame（壳页 textLen=15 的根因）
date: 2026-10-23
---

## 本次执行记录：视频号判据跨 frame 读取（tv-artifact-frames，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码，隔离 worktree + 裸分支 `tv-artifact-frames` |
| 第一性原因（QM-5 ①） | ✅ | 真机 `artifact 未命中（post-list-timeout:textLen=15）`；**15 恰等于壳页文本「视频号 · 助手 9 退出登录」的长度** ⇒ 判据读的是顶层壳页，而作品列表渲染在子 iframe 内（与发布页 `/micro/content/post/create` 同构） |
| 逃逸分析（QM-5 ②） | ✅ | 判据只在主 frame 执行 `executeJavaScript`；单元测试的 fake win 也没有子 frame，因此该缺陷在测试层完全不可见 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 轮询改为遍历 `mainFrame.framesInSubtree`，任一 frame 命中即成功，长度累加用于诊断；测试 fake 增加 `mainFrame.framesInSubtree`；`tencent-artifact` **5 例**通过 |
| 防止再次发生（QM-5 ⑤） | ✅ | 判据与「壳页 + 子 iframe」结构对齐；诊断日志输出合计长度，可区分"全空"与"壳页非空" |
| 行尾与 diff 对账 | ✅ | numstat 两口径一致 |
| 接线棘轮 | ✅ | 复用已接线测试 |
| QM-1 打包 / QM-4 视觉 | N/A | 仅服务层 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机无 `codeagent-wrapper`，如实记录 |

| 远程同步 | 由门禁推导 |

## 补记：CI 红（`QG Static` / `Gate Result`）的定位与修复（2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 失败步骤定位 | ✅ | `QG Static` job 日志原文：`76:16  error  Empty block statement  no-empty`，全 job 仅此 1 个 error |
| 第一性原因（QM-5 ①） | ✅ | 引入提交 `e84142c15f`（fix(tencent_video): read post-list title across all sub-frames）新增的诊断探针 `catch (_e) {}` 是**空 catch 块**；`apps/desktop/eslint.config.mjs` 对 `electron/**/*.js` 启用 `js.configs.recommended.rules` ⇒ `no-empty: error` |
| 逃逸分析（QM-5 ②） | ✅ | 该缺陷不在**单元测试**层而在**静态门禁**层：`no-empty` 是 lint 规则，只有 CI 的 `Gate 11 - ESLint (error-level gate)` 会执行；本地与测试都跑不到它 ⇒ 必须在合并前由 CI 拦下 |
| 修复（QM-5 ③④） | ✅ | 给该 catch 补一行说明性注释：`catch (_e) { /* 诊断探针失败：diag 保持 'url=? readyState=?' 默认值，不影响判定 */ }`。ESLint 9.39 的 `no-empty` **忽略含注释的块**；**同文件**另两处 catch（`/* 某些 frame 不可执行 */`、`/* 页面切换中继续轮询 */`）本就是这个写法且过门禁 ⇒ 对照组成立 |
| 防止再次发生（QM-5 ⑤） | ✅ | 沿用本文件既有的「catch 必带注释」写法；`no-empty` 规则本身即为该模式的机械回归锁，无需新增门禁 |
| 与上游的关系 | — | #4279 是本 PR 的同题前序，已因同一 `no-empty` 原因关闭；本 PR 承接其修复内容并补上该 lint 修复 |

> 说明：本 PR 同时 rebase 到最新主干（`origin/main`），冲突面只有 `CHANGELOG.md`（热写面），按「两侧记录都保留」用 `git merge-file --union` 消解。
