---
record: podcast-tasks-reconcile-41-42
task: 刀 4 账目对账——4.1 口语化 / 4.2 分块 TTS 已在主干却挂着未勾；顺带清掉一条「尚未收口」引导注释
date: 2026-10-17
---

## 本次执行记录：刀 4 账目对账（podcast-tasks-reconcile-41-42，2026-10-17）【docs-only】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 纯账目/文档变更（`openspec/changes/.../tasks.md` 两行勾收 + `openspec/records/` 两篇），无运行时代码。按分层规则就地编辑 + 经 PR 落地，不进 worktree。 |
| 判定（docs-only） | PASS | commit 后取证：`node scripts/classify-docs-only.js --base=origin/main --head=HEAD` ⇒ docs-only=true files=5（PR 正文已记）；rebase 到最新主干后净差异仍只含本篇四件产物。 |
| 行尾/编码对账 | ✅ | `git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐文件相同（tasks.md 4/2、记录 0/1）；改动由驱动脚本逐行保留各自行尾，CR 总量守恒断言实跑（tasks.md cr 107→109、记录 79→78）。 |
| 品牌残留 | PENDING | `node scripts/check-no-brand-residue.js`（本 PR 文案只写「参考产品」口径，不写竞品名）。 |
| 文档同步 | PENDING | `openspec-sync-check` 由 CI 跑；本片不改任何 spec 条款，只勾收已完成项并补出处行。 |
| 远程同步 | PASS | 已合并，merge SHA bbcc1440f127b21f58346426c93cf85b372f6e9c（2026-10-16T17:29:38Z）；取证自 git log origin/main 的 (#3758) 尾注恰 1 行，`git ls-remote --heads origin podcast-tasks-reconcile-41-42` 返回 0 行证远端分支已删，可离线复核 |

- 保留门禁：判定 docs-only PENDING | 行尾对账 ✅ | 品牌残留 PENDING | 文档同步 PENDING | 远程同步 PASS

## 一、这次到底改了什么（为什么值得一个 PR）

`openspec/changes/podcast-oneclick-publish/tasks.md` 里 4.1「口语化分段 prompt」与 4.2「分块 TTS 装配」长期挂着未勾，而**代码与指名回归锁早已在主干**。按「任务勾选与证据不符」这条判据，这属于自动合并闸门第 5 条要拦的形态之一：下一个会话读到「未做」就会重做一遍，或读到「做了但没锁」就放弃接线。

取证方式（不凭记忆、不凭 PR 号印象）：

- `git log origin/main --grep=(#3368)$ --format=%H|%cI` ⇒ `db0b0fc2258fb163733b22a71c956d55f4f19e17`（2026-10-12T08:13:30+08:00）
- `git log origin/main --grep=(#3359)$ --format=%H|%cI` ⇒ `0e408f5d62d75534e623299ab415702a6e56d5ba`（2026-10-12T02:27:36+08:00）
- 主干 blob 现场核对标志物：`podcast-tts-compose.js` 内 `MAX_CHUNK_CODEPOINTS = 2000`（并带「只可下调不可上调」的钳制注释）与 `PODCAST_TTS_CHUNK_UNSAFE`；`podcast-episode-synth.js` 内 `PODCAST_TTS_CHUNK_DEGRADED` / `PODCAST_TTS_ALL_FAILED` / 预物化 `anullsrc` 块间静音 / `gapSec` 越界钳进 [0.3,0.6] 并出声 / 唯一出口 `generateTTS` / 瞬退避复用 `withAssetTransientRetry`；`podcast-tts-colloquialize.js` 与其测试的 `checkStructure —— 分段结构不变量`（段数、空行位置、段尾补/换/删标点三种失真各自独立判不合格、reason 不含用户正文）。

顺带清掉的第二处：`openspec/records/podcast-episode-plan-preview.md` 的 frontmatter 里留着 `# ↓ 远程同步尚未收口 ⇒ …回填时整段删除。` 这一行——它是**给自己看的说明**，不是状态位，`check-gate-record-debt.js` 不查它。三把 `sync_*` 字段已随回填 PR 删除，唯独这句说明留下，于是该记录变成**注释说「尚未收口」、表格行写 `PASS`** 的自相矛盾体，而 CI 全绿。当场可重跑的清点：origin/main 的 `openspec/records/*.md` 共 370 篇，含「尚未收口」字样的**只有 1 篇**，且那篇状态已收口——就是本篇。口径：删字段型回填必须连「只为那几个字段存在」的引导说明一起删。

## 二、刻意没做的（以及为什么）

- **不勾 4.5**：它未勾属实——回退链与 `PODCAST_TTS_VOICE_UNRESOLVED` 在主干，但 §8.2.9 的「②③ 命中时界面标注来源三态」**只有合同没有实现**，勾了就是把账做假。
- **不动 PRD 正文的显示项表**：§7.10.4 那行「浮层尚未消费 / 三把 plan* 键未落」是对 ②-b 的如实描述，仍成立。
- **不在本片碰 ②-b 代码**：文本出期通道是原子的（桥接层导出集与 preload 暴露面逐键对账，且「无消费者的通道属装饰性链路」），不能与浮层拆开落地，故留给独立的运行时代码片。

## 三、本片的失败与返工（如实记，不写成一个干净的过程）

- 取证驱动第一版用 `execSync` 跑 `git log ... --format=%H|%cI`：**execSync 经 cmd.exe**，`%cI` 被当成环境变量、`|` 被当管道拆走，git 根本没跑，报回来的是一句与「找不到提交」毫无关系的 cmd 错。正解是 `execFileSync(file, argv)` 不过 shell。这条与本仓既有记忆「`execSync` 走 cmd」同源，但**新的落点是 git 的 format 串里含 `%` 与 `|` 时必然中招**。
- 第二版把含 `--grep='(#3359)$'` 的长文案写进 JS **单引号**字符串里，单引号提前终止 ⇒ 整行被静默拆成两行，`node --check` 才抓到。这是本仓硬规则「任何含引号嵌套的内联脚本一律写成文件再跑」的又一次现场：**判据文件必须 `node --check` 通过后才允许它写盘**。
- 两次失败都**在写盘之前**抛出，工作树逐字节未变（`git diff --numstat` 为空可复核）——fail-closed 生效，不是运气。

## 四、验证与收尾

- 待跑（合并后回填本行）：`node scripts/check-gate-record-debt.js`、`node scripts/check-doc-abs-paths.js`（本片新增文案一律用占位符，不写盘符路径）、`node scripts/check-no-brand-residue.js`、`node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce`（**必须 commit 之后**取证）。
- 远程同步：PENDING（合并后同一次提交内改 PASS + 删 sync_* 三字段；2026-10-15 起新 PR 不往 `.quality-gates.md` 插块、不往 ledger 加键）。
- 写入时间：2026-10-16T17:19:09+00:00
