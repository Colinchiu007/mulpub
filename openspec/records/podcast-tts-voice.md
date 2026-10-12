---
sync_pr: 0
---

## 播客刀 4 第 3 片·上半：音色解析层（podcast-tts-voice）

- 范围：新增 `apps/desktop/electron/services/podcast-tts-voice.js`（纯函数解析层）与同名行为锁 16 条；PRD §7.4.1.1 落地口径已写全（回退顺序、键名归一、码表单点、异常与没配的区分、空值不算命中、无默认 provider、注入缺失 fail closed、显示项 3 的数据来源）。
- **本片不接线**：不改 `podcast-episode-host.js`、不新增 IPC/preload 通道、不动浮层。口语化 prompt、宿主注入替换（`extractEpisodeAudio` → `synthesizeEpisodeAudio`）、三态来源标注的 locale 键与 `podcast-tts-compose.js` 回接 PRODUCERS 均属第 3 片下半。
- QM-1 打包 **PASS**（2026-10-11）：本机 `electron-builder --win --dir` rc=0；`asar list` 命中唯一一行 `\electron\services\podcast-tts-voice.js`；`asar extract` 后从**解包产物** require 成功，导出逐字为 `VOICE_ERRORS,VOICE_ORIGIN,resolveEpisodeVoice`（且 VOICE_ERRORS.UNRESOLVED 逐字为 PODCAST_TTS_VOICE_UNRESOLVED）。本层无任何宿主接线点，真实 Electron 窗口的端到端验证随接线片交付（届时才存在会被加载的调用方）。
- 本机实跑：`vitest run electron/services/podcast-tts-voice.test.js electron/services/podcast-tts-compose.test.js` → **2 files / 41 tests passed**（新增 16、既有分块层 25 未受影响）。
- 设计取舍（不是遗漏）：半配置与三层全空**共用一个用户可见码** `PODCAST_TTS_VOICE_UNRESOLVED`，靠 `issues[].path` 区分层。另造一码会让 locale 多一条只服务于内部归因的文案键（AGENTS 死键禁令）。

## QM-6 后端评审逐条处置（2026-10-11，verdict=PASS：Critical 0 / Warning 1 / Info 4）

- **V1（Warning，已修）**：本层在调用 `voiceRefIssues` 前把 `provider` 归一成 `providerId`，而形状层的 parts 硬编码 `providerId` ⇒ 同一条 `{provider, model, voiceId}` 在本层判"三段齐备并出期"、在先跑的形状层判"半配置并拒绝"。文件头写着「判据复用那一份，不许第二份」，而这次是**在复用之前先放宽**，同样造出两份结论。修法：删别名，两层只认 `providerId`；用例改为**两层同结论契约锁**（同一条 aliasRef 两侧都必须判半配置 + 用三段齐备的 goodRef 证明锁不是恒不匹配）。
- **Info（已修）**：非对象 voiceRef（字符串/数字/数组/布尔）原先各字段取到空串 ⇒ `voiceRefIssues` 返 `[]` ⇒ 被当作"三段同缺"落进 ②③ 回退链，等于形态错误时由系统替用户选音色。现当场拒绝（`issues[0].path=voiceRef`）且两个读取实现调用数为 0。
- **Info（保留为有意取舍，不改行为）**：注入缺失守卫在 ① 之前执行，因此宿主漏注入时连"频道已配好音色"也会被整体拒绝。取舍理由是 fail closed 优于一半生效——一旦按"是否需要依赖"分支，判据是否生效就由调用点写法决定，而漏注入本身是主进程 bug，应当响。
- **Info（deferred，已落 tasks）**：不核查 `providerId` 是否已在配置中 / `is_configured` / 模型是否真的渲染 TTS。该读取点在宿主接线片才存在（provider 配置归 `model-provider-manager`），本片没有真实消费方，先加会造出一条无法验证的判据。
- **码表语义**（Info）：注入缺失复用 `PODCAST_EPISODE_INVALID` 被指出语义偏「用户入参问题」。此处保持复用（不为内部编程错误新增用户可见码），层间靠 `path=voice.deps` 区分。
- 前端 opencode 未产出结构化 findings，本 PR 记为 **后端单模型 + 主代理逐条处置**，不冒充「双模型通过」。


## QG Static 真红的处置（2026-10-11 22:5x）

- 现象：`QG Static` 判红两条 eslint `no-useless-assignment`（`podcast-tts-voice.js:113/128`）。根因与刀 4 第 3 片下半同型——`let pref = null` / `let capability = null` 的哨兵初值**永不被读**（紧接的 `try` 必定整体赋值，`catch` 分支直接 `return`）。
- 修法：删掉两处初值。本机 `pnpm exec eslint electron/services/podcast-tts-voice*.js --quiet` rc=0；`vitest run` 2 files / 42 tests passed。
- 纪律化（防再犯的判据，不只在注释里说）：新增 `let x = 哨兵值` 时先问「catch 是否必定 return」——若是，初值即死代码，直接省略声明初值。同型问题本片内出现 3 次（synth 测试 2 处、colloquialize 1 处、voice 2 处），已一并进项目记忆。
## 远程同步

| 远程同步 | PASS | 已合并：PR #3372，merge ba97ca9cd268803ec3a9088ba3046efade824d7a（2026-10-12，squash）。取证：`git log origin/main --grep "(#3372)$" --format=%H|%cI`；本次回填同一次提交删除 ledger 登记项，并在带 frontmatter 的记录文件里删 sync_ 字段 |
