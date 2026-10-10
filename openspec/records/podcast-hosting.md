---
record: podcast-hosting
task: 按 PRD §7 刀 2 落地播客托管直传接线（凭证合并、发布顺序、上传错误收口、渲染层卡片与 locales 拆层）
date: 2026-10-11
sync_reason: 待 PR 合并后按产物取证（state=MERGED + mergeCommit.oid、远端分支 0 行、git log 恰好 1 行、比树为空）并就地回填
sync_backfill_owner: podcast-hosting 分支作者（本会话）
---

# 本次执行记录：播客一键发布 刀2（托管直传接线）（podcast-hosting，2026-10-11）

> 分支：`podcast-hosting`（隔离 worktree `D:\Data\projects\mp-worktrees\mp-podcast-hosting`，**非 C 盘**）；共享根 `D:\Data\projects\mulpub` 保持 `main` 且 clean。
> 范围：🛠 运行时代码变更 ⇒ 完整质量节拍；`classify-docs-only.js` 判 false（混合 PR）。

## 提交构成（origin/main..HEAD）

| SHA | 内容 |
| --- | --- |
| `8496f7684` | 托管服务层：`podcast-hosting-service.js`（掩码视图、凭证合并唯一判定点、回滚点先行、发布通行证 `channelPublishPass`）+ 18 例行为锁（真 registry/真 fs/假 credential-store/假 httpClient，零出站） |
| `e26b88432` | 渲染层接线：4 条 IPC 通道与两个 bundle、`PodcastHostingCard.vue`、`usePodcastHosting.js`、locales 拆到 `locales/podcast/{zh,en}.js`、读流 error 监听与 2xx 不掩盖读体失败 |
| `6ef66d8f3` | `PODCAST_HOSTING_PREFIX_UNSAFE` 出声拒绝 + 9 条托管域码 zh/en 成对文案 + 对应测试 |
| （本表及收尾提交）| 文档回写：PRD §7/§8/§9/§10/§11/§12/§13 与 §8.1 逐字表重生成、DESIGN §10 刀 2 追加、openspec 3 条 Requirement 与 tasks 1.11–1.13/2.1–2.4 对账、CHANGELOG 顶部条目、本记录与 `.quality-gates.md` 顶部记录及 ledger 登记 |

## 关键判断（为什么这么修，不是改了什么）

1. **Errors 不是测试噪声，是产品缺陷的现场**：18 例全过但 vitest 记 8–10 条 uncaught，说明缺陷在「夹具回收临时目录」这一刻恰好被暴露——生产里对应的是 feed 文件被移动/删除后主进程崩溃。先把锁本身改成 no-op 复现崩溃路径，再修，才敢声称它是回归锁。
2. **落盘层的清洗不能替代输入层的出声**：`normalizePathPrefix` 去掉 `..` 是防逃逸的第二道闸（必须有），但输入层跟着静默改写会让用户填的发布路径与真正生效的路径不是同一个东西。两道闸职责不同，不是重复实现。
3. **「可选但点了必失败」是一种需要处置的界面形态**：`cos` 在输入层合法（不丢用户已填的值），在落盘层被拒。界面把它做成 `disabled` 并给理由，比让用户撞一次错误码更接近诚实。
4. **拆文件是门禁逼出来的正确动作**：`NEW_OVER_LIMIT` + 墓碑双判据下，唯一正解是按不变量归属拆层（凭证跨频道共用 vs 发布按频道触发），而不是挂账或提阈值。

## 远程同步

| 远程同步 | PENDING | 待 PR 合并后回填 `PASS` + merge SHA（取证：`gh pr view <n> --json state,mergeCommit`、`git log origin/main --grep="(#<n>)$" --format=%H|%cI`、`git ls-remote --heads origin podcast-hosting` 0 行、squash 后比树为空），并在同一次提交删除 frontmatter 两个 sync_* 字段与 ledger 登记项 |

