---
record: podcast-episode-script-entry
task: 为 tasks 4.3② 补齐它缺的数据源合同（PRD §7.10.4.1 只读预览接口）并把该项拆成可验收的 ②-a/②-b
date: 2026-10-16
---

# 4.3② 前置合同：只读预览接口（podcast-episode-script-entry，2026-10-16）

> 分支 `podcast-episode-script-entry`（worktree `D:/Data/projects/mp-worktrees/mp-podcast-episode-script-entry`，非 C 盘，起点 `origin/main` `1dc3377c8`）。docs-only：未动 locales、未动运行时代码。
> 载体冻结已生效 ⇒ **未写** `.quality-gates.md`、**未加** ledger 键；本篇是本 PR 记录的唯一载体，`远程同步` 行全文恰 1 条。

## 一、为什么写合同而不是直接写实现（决定性一手）

`tasks 4.3②` 的字面范围是「三枚入口 + IPC/preload 通道 + §7.10.3 计费二次确认浮层与 `episode.*` 键」。但浮层要按 PRD §7.10.4 显示**块数、总码点、服务商/模型/音色三段（且命中来源必须标注）**，而这三个数**在渲染端一个都取不到**。`origin/main` 实测（不是推断）：

- `planChunks` 只在 `apps/desktop/electron/services/` 下（`git grep -l` 命中 5 个文件全在 electron）；**`apps/desktop/src` 命中 0、`preload` 命中 0**。
- §7.4.0 的 `resolveEpisodeVoice` **零生产调用方**（只有它自己的测试在调）；`voiceRef` 在 `apps/desktop/src` **命中 0 个文件**。
- `publishFromScript`（4.3① 落的主进程层）同样只有自己的测试在调 —— 它是**待接的消费者侧空白**，与上面两条是同一形状。

所以「先把浮层做出来、音色与计数以后补」会在界面上留下**空数或假数**；而在渲染层另写一套分块/音色推断，就是本 PRD 反复禁止的「两份口径必然漂移」。这条与 §6.4.2 那次同族：**显示项要反查喂它的那条通道，接不通就说明该显示项还没有合同**（第一次命中是 `podcast-episode-ui` 的七相位进度，这次是预览计数）。

## 二、本片落的两处（都是合同，不是实现）

| 位置 | 内容 |
| --- | --- |
| PRD 新增 §7.10.4.1 | 唯一读路径 `podcast:episode:planPreview`（preload 面 `episodePlanPreview`）：入参 `{channelId, script}`、成功载荷 `plan{totalBlocks,totalCodepoints}` + `voice{providerId,model,voiceId,origin,resolvedBy}`；`plan` 由 `planChunks` 同一实现产出、`voice` 由 `resolveEpisodeVoice` 产出，**只转发不加工**；拒绝态沿用既有领域码（不为预览新增同义码）；计数缺失=整块不显示、**绝不回落 0**；`origin` 闭集外不显示并 warn。**（2026-10-16 第二笔改名：第一版此处写作 kebab 通道名 + `podcastEpisode.*` 命名空间，与本仓既有形状不符，现名以主干 PRD 为准，见 §六）** 7 条验收判据 + 三条故意不做（不限流、不估金额、不在预览里做口语化）。 |
| PRD §8.2.9 顶部 | 一行**承载方**指针：该节读面由 §7.10.4.1 一次提供，不再单开 `podcast:voice-preview`——**偏差就地明写**（两趟近重复读路径会让音色解析跑两遍），落点/三态标注/验收判据照用不变。 |
| `tasks.md` 4.3② | 原文保留、行末追加实测结论；其后插 **②-a**（只读预览接口 + 两条必需锁）与 **②-b**（出期通道 + 浮层 + 入口，**按枚切**）。父项在两个子项都落地前**不勾**。 |

两条随 ②-a 必须同 PR 落的锁，已写进 tasks 子项，避免下一个会话「顺手省掉」：① 预览的零副作用判据取**副作用缺席**（`mkdir` 次数 = 0 且忙标记未被占），不看返回码；② `resolveEpisodeVoice` 的**生产调用方结构锁**（`git grep -l` 命中数 > 1，只有它自己和它的测试即红）—— 这条锁的意义就是防止「接口落地了、链还是装饰性的」。

## 三、②-b 里「按枚切」的判据澄清

PRD §7.10.6 与 AGENTS 都禁「先开通道再补入口」（无消费者的通道＝装饰性链路）。该判据的承重是**通道与至少一枚真实消费者同 PR**，不是「三枚入口必须同 PR」。故 ②-b 先落 `CopyLibraryView.vue` 一枚，另两枚各留一条未勾子项——这样每一片都可验「用户点得动」，而不是一次堆三页改动。这与 `tasks 3.5` 当年「未完成的后半拆成新的未勾项」同一口径。

## 四、质量节拍自检

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | docs-only；经 `scripts/start-mp-task.ps1` 建 D 盘隔离工作区（起点 = 当时 origin/main），共享根未用作编辑位 |
| 锚点与行尾 | PASS | 逐行 splice + 「锚点命中数恰 1」+「下一行为空」前置断言；PRD/tasks 行尾先量后写（crlf==lf==cr 三者相等才允许 join 回写）；写后回读断言小节数/子项数/标题未破坏 |
| 引用完整性 | PASS | §7.10.4.1 与 §8.2.9 的行号锚点均从工作树现读（1363→1364 行）；文中引用的 §7.4.0 / §7.10.3 / §7.10.6 / §6.4.2 / §15.2 五处小节标题逐个 grep 确认存在，不留悬空引用 |
| 载体冻结合规 | PASS | 旧载体与 ledger 未出现在净 diff（`git diff --name-only` 命中 0），记录只写 openspec/records |
| QM-1 / QM-4 / TDD | N/A | 本片未触运行时代码与 locales；被改动的两个文件均在文档白名单内 |
| QM-6 双模型外部评审 | 未执行 | 纯规格/文档片按 AGENTS 不强制；如实登记，不自扮演豁免 |
| 交付收尾 | 见本篇末尾的「远程同步」小节——一条事实只留一行，此处刻意不重复 ROW_RE 形状 |

## 五、遗留与不假装闭合的部分

- ②-a / ②-b 均未开工，实现时仍要各走 QM-1（②-a 改的是 electron IPC 面 ⇒ 必须打包 + 三层 stderr；②-b 另加 QM-4 像素与 `overlay-view-suspension` 登记）。
- §7.10.4 原表那行**没改**（它写的仍是目标态数据来源）。刻意不去「顺手改写」成本片新定的接口名，是为了让「合同落后于实现」这件事在本篇里留痕；待 ②-a 落地后由实现 PR 一并把该行数据来源更新。
- 共享根本次实测出现三格连拒（脏 AGENTS.md 是滞后错觉 → 钩子落后于 #3688 → 外来 worktree 未登记），已全部按仓内正规入口处置；其中 `violations.jsonl` 位于 `quarantine/` 内、隔离区堆积集中在 10-06→10-10 这两条是我自己的误读，已更正。

## 六、提交后的就地更正（第一笔 #3714 合并后另开 #3715 落地；原计划「同 PR 第二笔」因 auto-merge 抢在推分支之前完成而失效）

第一版 §7.10.4.1 把接口写成 `podcast:episode:plan-preview` 与 `podcastEpisode.planPreview`。实现前核对既有形状（`git grep` 真实通道 + preload 键）发现两处都与本仓惯例不符：真实通道是 `podcast:episode:publishFromVideo`（动词段 camelCase），preload 键是**扁平**的 `episodeList` / `episodePublishFromVideo`（不存在 `podcastEpisode.*` 这层命名空间）。合同若留 kebab + 命名空间，实现期只有两种坏结果——照合同做就破坏命名一致性，照惯例做就与已提交的合同漂移。故就地改名 `plan-preview`→`planPreview`、`podcastEpisode.planPreview`→`episodePlanPreview`，并补两条判据：① 命名照既有形状写进正文；② **改 `electron/preload/podcast.js` 必须同 PR 重生 `preload/index.bundle.js` 与 `home-shell-preload.bundle.js` 两个 tracked 产物**（`git ls-files` 实测两者都入库）。只改源不重生 ⇒ 通道在打包产物里根本不存在，而 vitest 读的是源文件 ⇒ 本地全绿也测不出来，因此这条必须由 QM-1 在 bundle 里验到通道名。

刻意**没动** §8.2.9 里 `podcast:voice-preview` 那 4 处字样——那是他人已合并进主干的文本，改它等于替别人的合并结果改写措辞（与「不得代删已合并载体」同一资格判断），两节关系由 §8.2.9 顶部的承载指针统一说明。写后断言：kebab 残留 0、`planPreview` 恰 3（含正文那条命名判据自身）、扁平键恰 2、`voice-preview` 仍 4。

## 远程同步

| 远程同步 | PASS | 两笔均已合并：#3714 merge SHA c643880c0ad7e18811927677511d9cf979a2f723（2026-10-16T08:21:21Z）、#3715 merge SHA b98122a347ff6f22750d9033ff008b1c9eafe9a7（2026-10-16T08:31:09Z）；取证自 `git log origin/main --grep` 两个 PR 尾注各恰 1 行，`git ls-remote --heads origin podcast-episode-script-entry` 返回 0 行证远端分支已删，可离线复核 |
