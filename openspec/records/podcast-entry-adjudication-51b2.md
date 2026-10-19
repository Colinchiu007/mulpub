---
record: podcast-entry-adjudication-51b2
task: 入口判据 §15 的坐标校正、§15.3 一条依据被实测推翻、以及新开 5.1b③（判据③  currently 不成立）
date: 2026-10-19
---

## 本次执行记录：播客出期入口判据 §15 的坐标与依据校正（podcast-entry-adjudication-51b2，2026-10-19）【docs-only】

| 门禁 | 状态 | 证据 |
|------|------|------|
| 变更类型与隔离 | ✅ | 纯文档/规格变更（`01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md`、`openspec/changes/podcast-oneclick-publish/tasks.md`、本篇记录、CHANGELOG），零运行时代码。仍按并发会话纪律走独立 worktree `mp-podcast-entry-adjudication-51b2`（`scripts/start-mp-task.ps1` 创建；共享根未落盘）。 |
| | 判定 | ✅ 现取 | 提交后实测：`node scripts/classify-docs-only.js --base=0472bed979 --head=HEAD` 输出 `docs-only=true`、`files=5`（`.ccg/reviews/fe18601….json` + PRD + CHANGELOG + tasks.md + 本篇记录），五条全命中 `CI_IGNORED_PATHS`。 | 其余判据当场读数：`check-changelog-growth` PASS（base 530 条 → head 531 条，字节 2843420 → 2847137）、`check-record-qm5-rows` OK（必需步骤 ①②④⑤，检查域 244 篇 / 欠账 27 条 / 未登记缺行 0）、`check-gate-record-debt` OK（`HAND-CLOSURE 人工改写=0`）、`check-doc-abs-paths` PASS（counts=1185 domain=4261 files=564，**账本未动**）、`check-no-brand-residue` PASS（10480 个 tracked 文件）、`check-pr-exec-record --mode=enforce` OK（新增记录 1 篇）。 |
| 行尾与 diff 对账 | ✅ | 两份被改文档工作副本均为 `i/lf w/crlf attr/text=auto`。补丁驱动先断言行尾**均匀**（`seps.every(s => s === '\r\n')`，不均匀直接抛错要求改成 `(line,sep)` 成对回写），锚点一律先按**剥 `\r` 的子串**定位并要求恰命中 1，写完再判 `CR 数 == LF 数`。两口径 `git diff --numstat` / `--ignore-cr-at-eol --numstat` 逐文件相等（PRD 6/4、tasks 2/1）。**第一次就靠这条 fail-closed 抓到锚点二义**：`ResultView.vue:726` 在 §14 的欠账行里也出现一次，命中 2 ⇒ 驱动拒绝改写；正解是把锚点收成整行前缀 `\| \`ResultView.vue:726\` \|`，而不是放宽计数。 |
| 品牌残留 | ✅ | 本刀不引入竞品名；`node scripts/check-no-brand-residue.js` 读数见下「其他判据」。 |
| 改了什么（一）坐标 | ✅ | §15.2 前两行的入口坐标按实测校正：`ResultView.vue:726` → `:64`（`<PodcastEpisodeEntry>` 挂载行；导入 `:447`、注册 `:479`），`CreateView.vue:4519` → `:4610`（`openPodcastEpisodePublish`；浮层 `PodcastPublishAction` 挂载 `:352-360`、事件绑定 `:373`）。**旧坐标不删**，在行内标"坐标实测校正"，并写明 §14 那条施工指令里的同一旧坐标**刻意保留不改写**、以本表为唯一真源。 |
| 改了什么（二）新增一枚 | ✅ | `CreateViewHistory.vue:291-293` 补进 §15.2。实测：按钮 `data-testid="history-podcast-episode-button"` 在历史卡片上 `$emit('publish-podcast-episode', item)`，由 `CreateView.vue:373` 消费、`:4610` 的处理函数**先按 `projectId` 回取完整项目**再挂浮层（卡片手里只有索引信息，而降级判定要读 `segments[].audioMeta.degraded`）。此前表里只写 `CreateView.vue`，把"入口在列表卡片、判据在项目"这处分叉藏住了。 |
| 改了什么（三）一条依据被推翻 | ✅ | §15.3 `PublishHistory` 那行的理由原文是「历史条目重发会**覆盖已上线的一期**（同 guid 换音频/换时长）」。实测否证：出期链**没有任何一层传过 `meta.guid`**（`PodcastEpisodeEntry.vue` / `PodcastScriptEntryLauncher.vue` / `PodcastScriptEntry.vue` / `src/api/podcast-channel.js` / `ipc-handlers/podcast-episode-ipc.js` 五处 grep `guid` **命中 0**），而 `podcast-rss.js:238` 是 `guid = ep.guid \|\| url` ⇒ guid 回落成音频 URL。所以"同一期再发一次"的产物是**第二条 item（两个 guid 并存）**，不是覆盖。结论（不放）不变，**依据换了**——按错依据做设计会去防覆盖，而真正要防的是重复。 |
| 改了什么（四）§15.4 的清点坐标 | ✅ | 「扫出 5 个候选页」那句不可复算：上一版没写扫描坐标。本日按自带坐标重跑得 `顶层 36 / 递归 52 / 候选 12 页`，与旧"5 页"清单只 3 页重合。现在把命令逐字写进 §15.4，并**当场做了敏感度对照**：换一组更严的产物词元复扫那 8 页（12 页除去已在表内的 4 页），只剩 3 页命中 ⇒ 词元集换一次清单就换一次。这一条把"数字必须能在仓库里一句话重取"落到了本节。 |
| 新开一行 5.1b③ | ✅ | 判据③（"重复点击不产生覆盖或重复 item"）对**三枚已落的视频出期入口当前不成立**：无 guid、无"已出过"判据、无二次确认，唯一挡的是 `PODCAST_CHANNEL_BUSY` 的**并发**互斥（先后点两次完全放行）。合同要点写进 `tasks 5.1b③` 五条：guid 白名单已就位（`podcast-episode-host.js:50` `META_ALLOWLIST` 含 `guid`，缺的只是没人传）、视频链身份取 `runId`（与 PR #3958 的音频键同判据）、**文本链身份取什么属产品判断**（候选 `rewriteHistoryId` / 内容指纹，定不下来不许实现）、guid 回落路径要重判、重复出期的用户侧形态必须先写进 PRD §6.4/§13 再动代码。 |
| 一条刻意不冒充的耦合 | ✅ | 记录 5.1b③ 第③点旁边写明：音频键改成随期变化**之前**，重复发布落同一个 URL ⇒ guid 相同 ⇒ `podcast-rss.js:181-183` 的 `EPISODE_DUPLICATE` **有机会**照出来；改完后两次 URL 天然不同，那条探针不再可见。**"有机会"是刻意的弱写法**——本刀没实测出期链在发布前是否真跑过 `validateFeed`（`podcast-episode-compliance.js` 判的是逐期 `validateEpisode`，跨期去重在 `validateFeed`），所以这条只能读成"少了一道巧合的兜底"，不能读成"少了一道生效的门禁"。 |
| QM-5 / QM-1 / QM-4 / QM-6 | N/A | 零运行时代码：QM-1 不触发（未改 `apps/desktop/electron/**`）、QM-4 不触发（未改任何 `.vue`/样式）、TDD 无被测对象；QM-6 由 `classify-docs-only=true` 走 docs-only 通道豁免双模型。 |
| 接线棘轮 | N/A | 本刀不新增测试文件；§15.4 的坐标是**命令文本**而非脚本件，因此不需要接进 CI（选择理由：把一份一次性取证脚本塞进 `scripts/` 会让本 PR 变成混合 PR 并触发全量重型 job，而它的价值只在"能被一句话重取"，命令文本已经满足）。 |
| 远程同步 | 由门禁推导 | 收口由 `scripts/lib/merge-ledger.js` 按主干历史推导；合并后的 main push 回读写进 PR 评论，不写回本文件。 |

## 一条与本 PR 无关、但会拦住自动合并的 main 红（已归因，不在本刀修）

- **归因读数**：`QG Desktop Shards (2/2)` 与 `QG Coverage` 自 **`2e108e7a6`（PR #3946「语音模型改由程序+运营决定，移除下拉」）合入 main 起持续红**。对照面取最近 9 次 main push：`33e0940e5` success → **`2e108e7a6` failure** → `e5ed32f52` / `5736b3ed2` / `950af9f3b` 三条 shard2 全 failure。失败面只有一条用例：`src/views/video-creation/S2vConfigPanels.test.js:290「语音 / 音色 ID 同在『旁白设置』子分区」`，整片读数 `Test Files 1 failed | 508 passed | 1 skipped (510)`。
- **根因线索（未修，留给归属 PR）**：该 `UiField` 的 `v-if` 现在要求 `s2vConfig.voiceProvider && s2vVoiceContextModel`（`S2vConfigPanels.vue:359`），而 #3946 把 `voiceModel` 改成程序静默解析后，用例只设了 `s2vConfig.voiceModel`、**没给 `state.s2vVoiceContextModel`**（该值经 `S2vConfigPanels.vue:788` 从 state 转发）⇒ v-if 恒假、标签不渲染。这是 AGENTS「门禁断言随实现迁移同步」那一条的漏更，不是新缺陷。
- **为什么判"与我无关"是实测而不是推论**：两个互不相干的在飞改动集（#3955 音色三态、#3958 音频键）**在同一分片报同一条红**，且 main push 上没有我的内容时就已经红。既有红不认领，也不在本刀顺手修——修它要动的是 #3946 的测试前提，属另一刀。
- **但它确实拦住了自动合并**：本仓自动合并判据取「`gh pr checks` 零 pending、零 fail」，比 GitHub 的 required 清单更严（实测 required 面里 ruleset 是 `QG Static / QG Unit Tests / electron-tests / 文档同步检查 / 债务熔断检查 / 单元测试 + Lint / GUI Gate Result` 七条、classic protection 另有 `Gate Result / build / QG Unit Tests / QG Coverage`，两条清单互不完全覆盖），所以一条**非 required** 的红也会让在飞 PR 的守卫停在 `STOP：checks 真失败`。**这是设计如此**：不得为了让 PR 过就把"零 fail"放宽成"零 required fail"，那等于把门禁改成"没人看的那一条不算数"。
- 取证顺带记一条工具事实：`gh api repos/<owner>/<repo>/actions/jobs/<id>/logs` 对这条 job 返回 **0 字节**（探针失明，读起来像"没有失败"），而 `gh run view <run> --job <id> --log` 给出 5.2 MB 全文。判"CI 里到底红在哪条"一律走后者。

## 其他判据读数

- 本节的全部当场读数已并入上方「判定」行（base `0472bed979`），此处不再重复列；重取命令逐条写在该行里，任何人可在仓库内一句话复算。
