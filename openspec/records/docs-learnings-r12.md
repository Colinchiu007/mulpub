---
record: docs-learnings-r12
task: 补 2026-10-14 第 12 轮五条教训（命令成功 ≠ 意图达成）
date: 2026-10-14
---

## 本次执行记录：补第 12 轮五条教训（docs-learnings-r12，2026-10-14）

- 判定：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` → **`docs-only=true`（files=2）**

## 变更内容

`01-docs/learnings.md` 追加 55 行（第 12 轮 P0-5 的五条教训）。

## 来源：R1-R5 清理 worktree 时救回的未提交改动

这 55 行原先是 `mp-reuse-browser` worktree 里**未提交**的改动。

按 R4「对主工作区做批量操作前，未提交修改先备份」执行：

| 步骤 | 产物 |
| --- | --- |
| 备份到 `%TEMP%` | 哈希对账一致（`26C9D2A9…`）|
| 确认 `origin/main` 不含这段 | grep 三个特征串均**否** |
| 从 `origin/main` 新建分支单独落地 | 而非当脏改动丢弃 |

## 冲突处理

从 `origin/main` 新建分支后 stash pop 与 main 的 404 行新内容冲突（main 已前进 53 个提交）。
按「追加型文件两侧都保留」解决：**main 新内容在前、本 55 行追加在后**，marker 零残留。

★ 检测 marker 用 **node 读文件**，不用 PowerShell 管道 —— 管道输出混入 git 的
`LF will be replaced by CRLF` warning，曾让我误判「仍有残留」。

## 五条教训

1. `git checkout -- <file>` 还原到 **HEAD**，不是 `origin/main` ⇒ 正解 `git checkout origin/main -- <file>`；判据是还原后比对 `git diff --name-only origin/main...HEAD`
2. 写「依赖主干新代码」的测试前，先确认分支 base 是否已含那段代码 ⇒ 事前 `git merge-base` + grep 约 10 秒，事后诊断约 10 分钟
3. 「尚无消费方的配置」既误触门禁，也是真问题
4. 扩展注册表不变量时，「允许例外」必须与「例外要出声」成对
5. 再次自报机制缺口

## 保留门禁

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 行尾对账 | PASS | `git diff --numstat` 与 `--ignore-cr-at-eol` 两口径一致（55/0）|
| 品牌残留 | PASS | `check-no-brand-residue.js` exit=0 |
| 文档同步 | PASS | `classify-docs-only.js` → `docs-only=true` |
| 执行记录 | PASS | 本文件即按出路①新增 |
| 远程同步 | PASS | #3568 merge `6e7805a22af1396616673a31ed127e2ebccd4919` |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步 PASS（#3568 @ 6e7805a22）
