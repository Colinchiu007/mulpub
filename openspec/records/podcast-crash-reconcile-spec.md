---
record: podcast-crash-reconcile-spec
task: 按 tasks 3.6b② 要求的顺序，先把「崩溃对账」的合同写进 spec delta（实现仍未做，本行保持未勾）
date: 2026-10-19
---

## 本次执行记录：出期崩溃对账的合同先行（podcast-crash-reconcile-spec，2026-10-19）【docs-only】

| 门禁 | 状态 | 证据 |
|------|------|------|
| 变更类型与隔离 | ✅ | 纯规格/文档：spec delta +1 条 Requirement（+4 Scenario）、`tasks.md` 加一条未勾进展行、PRD §13 第 13 条补一句现状、本篇记录、CHANGELOG。隔离 worktree `mp-podcast-crash-reconcile-spec`。 |
| 为什么这一刀**只有合同没有实现** | ✅ | `tasks 3.6b②` 原文与 PRD §13 第 13 条都把顺序写死了：「落地顺序不得反：先在 spec delta 加 Requirement（现 13 条无一涉及对账），再落跨重启凭据 → `channel:get` 投影 → 频道页横幅 + zh/en 键」。所以本刀收口在"合同进 spec"，`3.6b②` **保持未勾**，PRD 那条也明文写"本条仍是未闭合接受项，不得因合同已写而改判"。 |
| 现状取证（写合同的输入，全部当场量） | ✅ | 忙标记确为进程内：`services/podcast-channel-locks.js:121` 起 `createPublishGate()` 用的是模块级 `const inFlight = new Map()`，`:91-92` 的注释写着「崩溃随进程消失，**残留由启动对账接管（只提示不自动修复）**」——那句话是本 Requirement 两条决定里"只报告不重发"的既有出处，不是我新立的规矩；但它同时把"启动对账"当成已存在的东西来陈述，而 `publishInFlight` 在**代码里命中 0**（`git grep -c publishInFlight -- apps/desktop/electron packages` = 0 行，命中项只落在 `.adversarial/` 与 `.ccg/` 产物里）⇒ **没有任何既有状态可扫**，这才是本条必须"留凭据"而不是"扫状态"的直接依据。另确认落点分离：`episodes.json` 只在链末尾写（`podcast-channel-service.js:40` `EPISODES_FILE`），所以"结果文件里有没有这一期"不能反推在途态。 |
| 两条写进合同的取舍（不是实现细节，后来者不得顺手改） | ✅ | ① **凭据写入失败 ⇒ fail-closed 拒绝发起**。这与 AGENTS「进度事件是旁路、发送失败不得冒泡」**刻意相反**，理由写在 Requirement 正文里：进度丢了只影响观感，凭据丢了会让下一次启动无从对账，等于把本条要消灭的黑洞重新制造出来；做成静默旁路的话，"磁盘满"会变成"发布照常成功但中间态永远不可知"。② **对账只报告、绝不自动重发**：`meta.guid` 至今没有任何一层传过（`podcast-rss.js:238` 让 guid 回落成音频 URL ⇒ 重复发布的产物是**第二条 item**，不是修好的那一期），所以重发只能是用户显式发起，其身份来源待 `tasks 5.1b③`。这条把两刀之间的**依赖方向**写死：3.6b② 不能靠"自动重发"实现，因为那样会把 5.1b③ 未定的问题变成事故。 |
| 投影通道选择 | ✅ | 复用 `channel:get` 已有的 `feedSync` 读侧（`ipc-handlers/podcast.js:185`，消费者 `src/components/PodcastHostingCard.vue:45-47,95-104`），Requirement 明文 MUST NOT 为对账新造第三条状态源——同一份"上次发布怎么了"的答案有两个真源时，界面必然读到过期那一个（本仓「多层回退链的定位键必须由上层显式透传」同族）。 |
| 行尾与 diff 对账 | ✅ | 三个被改文件工作副本均 CRLF。补丁驱动先断言行尾**均匀**、锚点**恰命中 1**，写完判 `CR==LF` 且单行替换不得改变 CR 数；两口径 `git diff --numstat` / `--ignore-cr-at-eol --numstat` 逐文件相等（spec 30/0、tasks 1/0、PRD 1/1）。 |
| 接线棘轮 | N/A | 不新增测试文件，也无新脚本；`check-unwired-tests` 无新命中。 |
| QM-1 / QM-4 / QM-5 / TDD | N/A | 零运行时代码与零 `.vue`/样式改动；本刀不是 bug 修复（它落的是一条尚未存在的能力的合同），QM-5 五步随实现片走。 |
| QM-6 | N/A | `docs-only=true` 走精简门禁，双模型评审按 AGENTS 豁免；**未调用外部模型**，本行不得读成"已复核"。 |
| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 推导；main push 回读写进 PR 评论，不写回本文件。 |

## 现场读数

- spec delta 的 Requirement 计数：13 → **14**（`grep -c "^### Requirement"`）。
- 本刀**没有**闭合的东西（防止被"合同已写"读成"事已办"）：跨重启的在途凭据文件与其写入/收尾时机、`channel:get` 的 `interrupted` 字段、频道页横幅与 `podcast.episode.*` zh/en 文案键、强杀再启动的真机复现、以及"凭据写失败"那条领域码——**五条全部未落**。
