---
record: podcast-hosting
task: 按 PRD §7 刀 2 落地播客托管直传接线（凭证合并、发布顺序、上传错误收口、渲染层卡片与 locales 拆层）
date: 2026-10-11
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
| `64f38c7ca` | CI 首轮红处置：`QG Static` 判显式守卫占比 64.9% < 65.0%，根因是 4 条新通道走 `guarded()` 别名注册（分子按**注册点字面**统计）⇒ 抽出 `handlerFor` 并把守卫写回注册点，65.8% 转绿；**未**提阈值、**未**加豁免 |
| `d9ba07a0e` | QM-6 后端 6 条处置：凭证成对守卫、回滚点快照挪到 `buildFeed` 之前 + `prevExists` 进信封、两处 `writeFeedSync` 包 try/catch、探测键唯一化、`pathPrefix` 判据改与清洗输出逐字比对、`toIpcError` 空数组不再归入校验类；新增 1 条 IPC 回归锁 + 卡片两分支标注；PRD §7/§8/§11、spec 3 条 Scenario、tasks 2.5、CHANGELOG 同步 |
| `80a400ccd` | `.adversarial/ccg-deep-84c3413a/{adjudication.json,family-snapshot.json,critique-backend-v1.md}` 入库 + `.quality-gates.md` QM-6 行改写 |
| `0f83cc265` | `podcast-channel` 浅/暗两张像素基线按 run `38087089456` 的 `quality-gate-visual-reports` artifact 重取（Gate 7b 逐文件归因：43 张里违规恰好这 2 张，其余 41 张 0 px），`.quality-gates.md` 增 QM-4 行 |
| `891d07379` | 跨家族复核命中 d-1（`prevExists` 改取 `hadPrevious`，与 `backupCreated` 分两维）与 d-2（备份走临时文件 + 复用 `atomicRenameSync` 唯一实现）；CI shard 2 两处本机全绿的红（`getHostingService` 未接 `credentialStore` ⇒ runner 上 `CRYPTO_UNAVAILABLE`；glossary 术语「音频外链 / Audio direct link」en 侧未采用）；新增 3 条行为锁（含一条不依赖宿主 DPAPI 的决定性接缝锁）；residual-1 的文档口径纠正（spec 两处 Requirement + §8 显示项 + §13 第 9 条 + DESIGN §10 + tasks 3.6） |
| （本次复核产物入库提交） | `.adversarial/ccg-deep-84c3413a/{adjudication.json(d-1/d-2/residual-1),family-snapshot.json(thirdRound),critique-delta-opencode.md}` | 文档回写：PRD §7/§8/§9/§10/§11/§12/§13 与 §8.1 逐字表重生成、DESIGN §10 刀 2 追加、openspec 3 条 Requirement 与 tasks 1.11–1.13/2.1–2.4 对账、CHANGELOG 顶部条目、本记录与 `.quality-gates.md` 顶部记录及 ledger 登记 |

## 关键判断（为什么这么修，不是改了什么）

1. **Errors 不是测试噪声，是产品缺陷的现场**：18 例全过但 vitest 记 8–10 条 uncaught，说明缺陷在「夹具回收临时目录」这一刻恰好被暴露——生产里对应的是 feed 文件被移动/删除后主进程崩溃。先把锁本身改成 no-op 复现崩溃路径，再修，才敢声称它是回归锁。
2. **落盘层的清洗不能替代输入层的出声**：`normalizePathPrefix` 去掉 `..` 是防逃逸的第二道闸（必须有），但输入层跟着静默改写会让用户填的发布路径与真正生效的路径不是同一个东西。两道闸职责不同，不是重复实现。
3. **「可选但点了必失败」是一种需要处置的界面形态**：`cos` 在输入层合法（不丢用户已填的值），在落盘层被拒。界面把它做成 `disabled` 并给理由，比让用户撞一次错误码更接近诚实。
4. **拆文件是门禁逼出来的正确动作**：`NEW_OVER_LIMIT` + 墓碑双判据下，唯一正解是按不变量归属拆层（凭证跨频道共用 vs 发布按频道触发），而不是挂账或提阈值。
5. **「有备份文件」不等于「有上一版」**：后端评审命中的 b2-3 是本刀影响最大的一条——`buildFeed` 就地覆写 `feed.xml`，之后的 `copyFileSync` 拷的是本次产物，`backupCreated:true` 在界面上说的是「回滚点已建立」，实际那份和主键内容相同。凡是「先产出再备份」的顺序，都必须先问一句**备份源在备份发生时是不是已经被本次产物覆盖了**；这类失真不会报错，只会让回滚功能在真正需要它的那一天失效。
6. **采纳判据不等于采纳修法**：b2-6 的「探测有副作用」成立，但评审给的 HEAD 方案会把「凭证只有写权限」这种真实可用配置误判成不可用（OSS 按方法签名）；正解是保留 PUT、把键改成唯一且自带命名空间。评审给的是**问题 + 候选解**，判据与解法要分别核。
7. **错误分类也是合同**：`SECRET_MISSING` 带 `{issues:[]}` 被 `Array.isArray([])` 归进 VALIDATION_ERROR，当时渲染层只按 `subCode` 取文案所以用户无感——但「现在没人用」不等于「语义对」，下一次按 `code` 分流的逻辑（校验错就展开表单）会直接走错。判据取在唯一实现处收紧，而不是逐个去掉 `issues`。
8. **写侧证据不能冒充读侧行为**：`readFeedSync` 零生产调用者、`getChannel` 只回 `meta`、`src/` 无任何 `feedSync` 消费点，而 spec/PRD 写着「重启后仍能看到『公网 feed 未同步』」——那是把「我落盘了」读成「用户看得见」。修法不是补 UI（重试入口与刀 3 状态机共用同一份判据，先做会写两遍，还让像素基线第三次漂移），而是**把措辞降级为可验证的事实**并把欠账挂到具体任务项上。判据手法：凡「状态已持久化所以用户能看到」的句子，一律从 UI 实际读的字段反查写入者清单。
9. **「本机绿 / CI 红」先问这一维是不是宿主能力，再问是不是接缝根本没接**：`getHostingService()` 的注释写着「凭证存储可注入」而参数没传，真实 `credential-store` 在本机（有 DPAPI）默默替测试干了活，CI runner 上直接 `CRYPTO_UNAVAILABLE`。补的锁必须**不依赖宿主能力**：把注入件设成必然失败（`saveCredential: () => false`），断言错误码如实——这样「摘掉接线」在两种机器上都红。

## 远程同步

| 远程同步 | PASS（2026-10-11T07:05:38+08:00 合并为 `93cc1c5b7638bb49347100e031f9632517145ad8`；四条产物取证：gh state=MERGED 且 mergeCommit.oid=93cc1c5b7638bb49347100e031f9632517145ad8、远端分支 已删除（ls-remote 0 行）、`git log origin/main --grep='(#3283)$'` 恰好 1 行、比树 `git diff --stat <branch-tip> 93cc1c5b7638bb49347100e031f9632517145ad8` 为空） |

