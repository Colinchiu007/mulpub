---
record: podcast-tts-compose
task: 刀 4 第一层——TTS 分块上限与入参形状（纯函数，零出站）
date: 2026-10-11
sync_status: PENDING
sync_reason: 本 PR 尚未合并，merge SHA 还不存在；合并后由回填 PR 改写 PASS + merge SHA 并整段删除本三个 sync_ 字段
sync_backfill_owner: 下一个会话（收尾链：合并 → 回填 → 销账 → worktree 清理）
---

# 播客刀 4 第一层——TTS 分块与入参形状层（podcast-tts-compose，2026-10-11）

> 分支 `podcast-tts-compose`；worktree `D:\Data\projects\mp-worktrees\mp-podcast-tts-compose`（非 C 盘）。范围见 PRD §7.4.2 第 2 条与 §7.4.3 第①层。

## 为什么先做这一层

刀 4 的其余站（口语化、逐块合成、拼接、静音片段）都依赖手柄，而**分块与入参形状**的失败形态是静默的：provider 侧截断不报错、`String.length` 与码点错位、硬切把句子读成两截。这些都能在一个零依赖纯函数上被精确断言，所以先落它，手柄另片接。

## 未闭合（如实记，不是遗漏）

- 本层**目前无生产调用者**：`synthesizeEpisodeAudio` / `colloquialize` / `concatBlocks` 未落，接线片必须同 PR 改 §7.4.2 与逐格结果态测试（结构锁 ⑪ 的口径是不改相位枚举、只换 `extractMix` 这一站的实现）。
- QM-6 双模型未跑；真机音频验收未做（需要 provider 凭证与打包应用）。

## 远程同步

| 远程同步 | PENDING | 待本 PR 合并后就地改写成 PASS + merge SHA（`git log origin/main --grep="(#NNNN)" --format=%H^|^cI` 取证），并在同一次提交删除 ledger 本条登记项与记录文件的 sync_ 三字段 |

## QM-6 双模型评审处置（2026-10-11）

- **前端 opencode**（session 见 `D:/Temp/qm6-dao4-frontend.log`）：以工作态日志交付、未产出最终 JSON（与第 3 片同一失败形态），其候选 findings 经逐条核实后 **5 条成立并已修**、2 条按取舍保持现状：
  - **已修①（边界，最高价值）**：`planChunks(opts.maxCodepoints)` 与 `validateComposeInput(payload.maxChunkCodepoints)` 允许调用方把 2000 **抬高**——那正是本模块要防的 provider 静默截断的入口。现钳回 `MAX_CHUNK_CODEPOINTS`（只可下调），回归锁「抬高也必须被钳回」。
  - **已修②（内容正确性）**：只跳 `''` 而不跳纯空白段，`'   '` 会变成一次独立 TTS 调用并读出一段空白。现按 `trim() === ''` 跳过，并锁「任何块 trim 后非空」。
  - **已修③（第 2 块的接口前置）**：块只带 `para`，而一段可切多块 ⇒ 多块共用同一个 `para`，未来「第 N 段」与「已完成块数/总块数」必然撞键。现每块带全局 `index`，返回值带 `totalBlocks`。
  - **已修④（合同一致性）**：领域码名与本节 §7.4.6 漂移——实现写 `PODCAST_TTS_CONTENT_TOO_SHORT` / `PODCAST_TTS_VOICE_REF_INCOMPLETE`，合同是 `PODCAST_TTS_COPY_TOO_SHORT` / `PODCAST_TTS_VOICE_UNRESOLVED`。「代码服从本节，不是反过来」，现按合同改名并加逐字断言。
  - **已修⑤（PRD 自身）**：§7.4.2 第 2 条补「上限只可下调不可上调」，与实现同一次落地。
  - **保持现状①**：`RUN_ID_INVALID` 复用 `PODCAST_EPISODE_INVALID` 是刻意的——§6.4 的入参表本来就把它归到「字段不合格 + issues 逐条列出」，另立一码会让同一类失败在两套文案里分叉。
  - **保持现状②**：`cpLen` 与仓内既有的 `[...s].length` / `Array.from(...).length` 属**同一口径的三种写法**而非三种判据；收敛成共享实现需要动 3 个包的既有热点文件，属独立小 PR，不在本层夹带。
- **后端 claude**：仍在跑（session 23f51fb6），结论到达后按同一格式补记；未拿到后端产物前**不合并**（不做自我豁免）。
- 测试：`podcast-tts-compose.test.js` **21 passed / 0 failed**（本处置新增 4 条）。

### 后端 claude 评审（重试一次后交付）：3 Critical + 3 Warning + 1 Info，逐条处置

| # | 级别 | 结论 | 处置 |
|---|---|---|---|
| C1 | Critical | 「成串标点（？！ / ……）并进同一句」只在第二遍合并里对「前句以终止标点结尾」生效；第一遍逐字断句会把 `？` 与 `！` 拆开，于是注释承诺的形态从未实现 | **已修**：只有「当前是终止标点且下一个不是」才断句。锁：`splitSentences('真的？！我不信……好吧')` 精确等于 `['真的？！','我不信……','好吧']`，另加一条 `'？|！'` 不得出现的反面对照 |
| C2 | Critical | 重构不变量的断言按 `Map(para → 拼接)` 收集，**没有**按块顺序断言 ⇒ 块内/块间重排抓不住 | **已修**：逐段 `filter(para===idx).map(text).join('')` **逐字等于原段**，并断言段落下标序列单调不减（不重排）。不假装「块间必须补换行」——那不是本层合同 |
| C3 | Critical | 音色三段 PRD §7.4.0 写的是 `providerId / model / voiceId`，实现查的是 `provider` ⇒ 合法配置会被判「只给 1 段」而拒发 | **已修**：按合同的 `providerId`，夹具与错误文案同步；`{ provider: ... }` 不再被认作半配（这是**形状**变了，不是判据变松） |
| W4 | Warning | 本层另写一份宽松 `CHANNEL_ID_RE`，`'c'`/`'UPPER'`/`'myChannelABC'` 在本层放行、在下一层被 registry 拒 ⇒ 同一条入参两次判定不同 | **已修**：`require('./podcast-channel-registry').CHANNEL_ID_RE` 单点复用；4 个宽松形态必须在本层就拒 + 一条「用的就是那份正则」的同源断言 |
| W5 | Warning | 「值为纯空格 `' '` 会被判『给了』」 | **否证（L1 反例）**：实现是 `String(ref[k] || '').trim() !== ''`，`' '` 经 `trim()` 为空串 ⇒ **不**计入 given。已在注释里写明该判据，不改动行为 |
| W6 | Warning | `runId` 未 trim，首尾空白会一路进主进程临时目录名 | **已修**：`String(payload.runId).trim()` 后判形；锁：`'  run_12345678  '` 归一为 `'run_12345678'` |
| I7 | Info | 超限段切块时块界可能落在 `？` / `！` 之间，逐块串行 TTS 会引入停顿 | **登记不修**：本层只保证「不硬切句子」，块界听感属第 2 块（拼接与静音插入）的范围，写进 tasks 的下一片；不在没有真实 TTS 往返证据时改判据 |

测试：`podcast-tts-compose.test.js` **25 passed / 0 failed**（本轮新增 4 条锁 + 2 条夹具改写）。
