---
record: podcast-episode-tts-run
task: 刀 4 第 3 片·下半——把音色/口语化/分块/合成四层串成一次出期（零出站 prepare + 计费二次确认的显示量）
date: 2026-10-12
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写为 PASS + merge SHA，并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账 → worktree 清理）
---

# 播客刀 4 第 3 片·下半：出期编排层（podcast-episode-tts-run，2026-10-12）

> 分支 `podcast-tts-wiring`（隔离 worktree `D:Dataprojectsmp-worktreesmp-podcast-tts-wiring`，**非 C 盘**）。

## 这一片在做什么

新增 `apps/desktop/electron/services/podcast-episode-tts-run.js`：`prepareEpisodeTtsRun`（零出站：依赖校验 → 音色 → 分块 → 展示量估算）与 `runEpisodeTts`（确认后：取消采样 → 口语化 → 逐块合成）。规格见 PRD §7.4.8。

## 三条写在实现之前的口径

1. **本层不新立任何错误码**：空文案的码归分块层（`PODCAST_TTS_COPY_TOO_SHORT`）、音色归解析层（`PODCAST_TTS_VOICE_UNRESOLVED`）、注入缺失归合成层已有的 `PODCAST_EPISODE_INVALID`。理由与 §7.4.1.1 同源——两层各有一个码，UI 就不知道显示哪条提示。
2. **顺序 = 计费顺序**：音色解析排在口语化之前。先花 LLM 的钱再发现根本合成不了，是替用户做了一次不可撤回的花费。
3. **`estimate` 是文案不是判据**：时长区间由常量 `ESTIMATE_CP_PER_SEC` 粗估；结果里的 `durationSec` 只认合成层实测。

## 证据

| 项 | 值 |
| --- | --- |
| 行为锁 | 12 passed / 0 failed（`podcast-episode-tts-run.test.js`） |
| 变异反证 | M1 把 `content: coll.content` 改成 `prepared.content`（口语化结果不被消费）⇒ **恰好 1 条指名变红**，还原后 12 passed |
| 恒真断言自查 | 旁路那条原本写成 `x).toBe(x)`（恒真，不构成锁），已改为「每个块的文本必须是原文的子串」并实跑通过 |
| 真实出站 | 零（`generateTTS` / `concatBlocks` / `probeImpl` / `invokeLlm` 全注入；`prepare` 有一条「一次都没被调用」的行为锁） |
| QM-1 打包 | 见下方「QM-1」段（本 PR 触 `apps/desktop/electron/services/`，按门禁必须打包实测） |
| QM-6 双模型 | 见下方「QM-6」段 |

## QM-1

2026-10-12 本机 pnpm exec electron-builder --win --dir --publish never 完成（日志无 error 行，asar integrity 已写入）；产物 apps/desktop/dist-electron/win-unpacked/Multi-Publish.exe = 239,075,328 字节；asar list 命中 electronservicespodcast-episode-tts-run.js，证明新增服务确已进入交付产物；构建副产物 preload/index.bundle.js 被重生成，本 PR 不触渲染/preload，已按精确文件清单回退（AGENTS R2）。

## QM-6

QM-6 后端评审（claude）3 条 CONFIRMED，全部采纳并已修复：

1. `runEpisodeTts` 成功路径必然 ReferenceError（TDZ）——`const coll` 的初始化器里读了 `coll.content`。**根因是我自己的变异还原脚本**：M1 用「首次出现的字符串替换」做还原，而被还原的那一行与合成的取值行文本同形，还原把两行**对调**了。提交态实测 9 passed / 3 failed，评审独立复现并指名。
2. 108/117 两行文本对调（口语化输入应为 `content: prepared.content`、合成输入应为 `content: coll.content`）——即使修掉 TDZ，口语化出站也白花钱、改写永不生效。
3. 本记录的行为锁结论与提交代码矛盾（我写的是 12 passed / 0 failed，提交态实为 9/3）。

修复与反证：两行按原意改回；新增**回归锁**「口语化输入必须是 `prepared.content`、合成输入必须是 `coll.content`，且 `const coll` 初始化器内不得读 `coll`」；变异 N1（把两行再次对调）实测 **4 条变红**（新锁 + 三条行为锁），还原后 **13 passed / 0 failed**。

前端评审（opencode）另命中 **C3**：prepareEpisodeTtsRun 未向 resolveEpisodeVoice 传 `defaultProvider` ⇒ ②偏好/③capability 两级定位键为空、回退链成死代码，无 voiceRef 的频道一律被拒（违反 §7.4.0/§7.4.1.1）。处置：入参透传 `defaultProvider`，PRD §7.4.8 把它写成必填定位键并补校验表一行；新增三条回归锁（偏好命中 origin=preference / capability 命中 origin=providerDefault / 三层全缺仍**各调用一次两个读取实现**）。顺带清掉一条未使用的导入并把 `colloquial.usesOriginal` 做成结果位（提示文字唯一依据）。
当前行为锁实跑：**17 passed / 0 failed**。
方法论记账：结构/文本型变异脚本**不得用「首个匹配替换」还原**——同形文本必须按**行号或唯一上下文**定位，且还原后必须**重跑一次全量**再写证据（本条与记忆 self-lock-implementation-and-mutation-proof、feedback-evidence-recount-on-final-base 同源，这次是它第三次以不同形态命中）。

## 远程同步

| 远程同步 | PENDING | 待本 PR 合并后就地改写为 PASS + merge SHA（`git log origin/main --grep="(#NNNN)" --format=%H^|^cI` 取证），并在同一次提交删除 ledger 本条登记项 |

