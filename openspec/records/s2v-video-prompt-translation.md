---
record: s2v-video-prompt-translation
task: 视频创作-视频详情页（成品编辑页）分段提示词区：补齐视频提示词中文翻译 + 提示词/翻译成对 + 编辑区默认折叠
date: 2026-10-19
branch: s2v-video-prompt-translation
---

## 本次执行记录：视频提示词中文翻译与提示词区交互重构（s2v-video-prompt-translation，2026-10-19）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | PASS | 运行时代码（`apps/desktop/electron/**` + `apps/desktop/src/**`）⇒ 隔离 worktree `<仓库父目录>/mp-worktrees/mp-s2v-video-prompt-translation`（非系统盘），裸分支 `s2v-video-prompt-translation`。入口为 `scripts/start-mp-task.ps1 -TaskName s2v-video-prompt-translation`（官方入口），输出 `worktreeCount: 61`、`writeGuard.ok: true`、分支 `s2v-video-prompt-translation` 已 set up to track `origin/main`。依赖就绪：`pnpm install --frozen-lockfile` rc=0 + `ensure-electron.js` v43.7.7 + `verify-worktree-deps.js` OK（11 项消费方解析通过） |
| 第一性原因 | PASS | 详见 PRD §0.1「根因」：图片提示词的翻译 pipeline 自 2026-08-12 建立（`translatePromptsForLocale` + compose 并行任务 + `promptTranslation` 落库），但视频提示词（`videoPrompt`）是 2026-08-15 才新增的字段，**其生成链路从未接入翻译能力**；同时「重新生成视频优化词」（`regenerateScenePrompt kind=video`）也只重写 `videoPrompt`，不产出译文。翻译缺失 + 结果页唯一翻译块被放在两个 textarea 与两枚重新生成按钮**之后**，视觉上与它描述的提示词隔了一整个区块 |
| TDD（先红后绿） | PASS | 先写测试 ⇒ `ResultView.test.js` 新增「提示词区」describe **6 红**（`segment-editor-toggle` 不存在 / 翻译块数不符）、`story2video-project-service.test.js` 新增 video 翻译用例 **2 红**（`videoPromptTranslation` 为 null）。补实现 ⇒ `ResultView.test.js` 同批 **9 绿**、`story2video-project-service.test.js` 同批 **6 绿**。回归：`ResultView.test.js` **124/124 绿**、`story2video-project-service.test.js` **125/125 绿** |
| 实现 | PASS | ①`story2video-stages.js` 新增并导出 `translateVideoPromptForLocale`（复用 `translatePromptsForLocale` 的批量调用/JSON 解析/兜底，避免第二份实现漂移）；②`story2video-project-service.js`：`regenerateScenePrompt kind=video` 成功后先清后写 `videoPromptTranslation`（fail-open）+ 新增 `_resolveUiLocale`（口径与流水线 optimize 阶段一致）+ compose/草稿/ensureProject 三条分段构造路径补 `videoPromptTranslation` 持久化；③`updateSegments` **不**接收该字段（只读，防前端伪造）；④`ResultView.vue`：图片/视频提示词各自带紧邻的只读翻译块 + 编辑区默认折叠 + 展开态互斥 + 删除展开分段时收起；⑤locales zh/en 成对新增 5 条 |
| 视觉验证 | PASS | 用真实组件 + Playwright 做了三态截图核验（脚手架验证后已按 R0 全数走 `safe-delete.js` 可恢复删除）：折叠态首屏只保留素材区概览；展开第 1 段时「画面提示词→图片提示词中文翻译」「视频优化词→视频提示词中文翻译」两对上下紧邻；展开第 2 段时第 1 段自动收起（互斥生效） |
| 单测（定向 + 消费者并集） | PASS | 定向：`ResultView.test.js`(124)/`story2video-project-service.test.js`(125)/`story2video-stages.test.js`+`story2video-ipc`(330)/`story2video-compose-engine`+`story2video-manual-assets`+`ResultView`(300)/`SceneAssetSelection`(11) 全绿。消费者并集按 `grep -l "vi.mock("` 复核：`ResultView.test.js` 自身 mock `@/api/publisher` 与 `@/api/tts-voice-catalog`，未涉及其他模块的 mock 同形问题 |
| 门禁（静态） | PASS | `check-locale-sync --cjk` PASS（基线 1331→当前 1146，无新增硬编码中文）；`check-no-brand-residue.js` PASS（10802 tracked 文件无残留）。`--keys` 因新增 5 条 zh/en 成对，随 CI 核 |
| QM-2 必检项 | PASS | 翻译调用走**现有** `aiGenerator.generateWithDefault('llm')`（不新增依赖、不新增 IPC 通道）；LLM 不可用/解析失败/超时 → `videoPromptTranslation=null` 且**不影响 videoPrompt 本身**（fail-open）；译文上限 2000 字符（与 `promptTranslation` 落库上限一致）；译文与原文相同视为未翻译返回 null（不展示冗余）；`updateSegments` 白名单外字段丢弃。无 `console.log` 污染；无同步 CPU 密集原语（翻译只在用户点击「重新生成视频优化词」这条低频路径触发） |
| 执行记录取证 | PASS | `node scripts/check-pr-exec-record.js --base=origin/main --mode=enforce` 随本 PR 一起取证（`.quality-gates.md`/ledger 按 2026-10-15「旧载体冻结」新规**不再新增块与键**） |

| 远程同步 | 由门禁推导 | PR #4044（`s2v-video-prompt-translation` → `main`）；收口按主干历史推导，本行不手写状态词（2026-10-17 change `gate-record-sync-derived-status`） |

- 保留门禁：变更类型与隔离 ✅ | 行尾对账 ✅（`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径随 CI 核）| 品牌残留 ✅（本地 rc=0）| 文档同步 ✅（PRD §3.1.31 + openspec change + 上游 PRD 指针）| 执行记录 ✅ | 远程同步 PR #4044

## QM-6 深度审查取证（CCG DUAL · 9 轮 · 采纳并修复 17 处缺陷）

`sh scripts/deep-review.sh` 判定 `DUAL`（变更 617 行 > 200 阈值），critic=claude + proposer=opencode 跨家族校验通过。critic 单轮输出长期超过模型 JSON 上限（实测 33226 / 21145 字符被截断），4 轮未能跨家族收敛，落引擎第三档「自扮演裁决」（置信权重 0.6）。逐条对抗裁决**全部落盘**（`.adversarial/ccg-deep-{bfd5c6c2,2f769f26,1dc679e4,98846a84,52676ccd,7ac6b337,0e9e42df}/adjudication.json`），verdict 只取 `upheld` / `dismissed`，无一条留空。

### 采纳并已修（表内 16 处 + 第 9 轮 i2，共 17 处，各带针对性回归）

| 轮 | ID | 缺陷（用户可见后果） | 修法 | 修复提交 |
|----|----|----------------------|------|----------|
| 1 | i1 | 手动改写 `videoPrompt` 保存后，结果页仍展示描述**旧**提示词的译文 | `updateSegments` 增 `videoPromptChanged` 判定，改写即清空译文 | `2f769f26` |
| 1 | i4 | `createPromptTranslationPending` 签名行与函数体首行被并成一行（编辑事故） | 还原为两行 | `2f769f26` |
| 2 | i3 | 单条调用批量翻译函数 `translatePromptsForLocale` 属**未文档化**依赖 | JSDoc 契约节显式声明「单条调用是受支持路径」 | `df59f7cc9` |
| 3 | i1 | 翻译路径**无有界超时**：LLM stall 时整个 IPC 响应（含 videoPrompt 回写、`_upsertProject`）无限期挂起 | `Promise.race` + `PROMPT_TRANSLATION_BATCH_TIMEOUT_MS`（25s，与流水线单批同源），超时 fail-open | `eb0962d74` |
| 4 | i1 | compose 回填无条件取 fallback 译文：落地的是新词时旧译文透传 | 改条件式：落地值须与 fallback 的 `videoPrompt` 逐字节相同才回填 | `1dc679e44` |
| 4 | i3 | 新增测试出现同类同行合并格式损坏 | 还原为两行 | `1dc679e44` |
| 5 | i1 | compose 回填 IIFE 无空守卫直接解引用 `fallbackSegment.xxx` | 统一经 `fallback = fallbackSegment \|\| {}` 访问 | `98846a842` |
| 5 | i3 | 翻译 await（≤25s）发生在落盘之前：窗口内崩溃则本次**已付费的优化词一起丢失** | videoPrompt 落盘前移到翻译之前，译文成功后再落一次 | `98846a842` |
| 6 | i1 | 第二次落盘未置 `dirty`，且测试只断言返回值不断言磁盘（捕获不到「只进内存」） | 补 `project.dirty = true` + 磁盘断言回归 | `52676ccd8` |
| 6 | i2 | `_resolveUiLocale` 只校验字符集：`garbage`/`---` 直接作目标语言注入翻译 LLM ⇒ **垃圾译文落库**；`en-US` 不被短路 ⇒ en 界面白付一次调用 | 归一到主语言子标签（en/zh，其余缺省 zh），与展示侧 `getAppLocale()` 口径一致 | `52676ccd8` |
| 6 | i4 | 成功路径 `setTimeout` 从不清理，每次重新生成留一个最长 25s 悬挂定时器 | `timeoutId` 提外层 + `finally` `clearTimeout` | `52676ccd8` |
| 7 | i2 | 译文二次落盘用 await 前的**陈旧引用**，覆盖翻译窗口内用户的并发编辑 | 落盘前重读项目，只 patch 本分段译文字段 | `7ac6b3372` |
| 8 | i1 | 译文写回前不校验 prompt 身份：窗口内改词后旧译文被 patch 写回 | 写回前校验 `currentVideoPrompt === nextVideoPrompt` | `0e9e42dfd` |
| 8 | i2 | `Promise.race` 超时后内层 promise 滞后 reject 无人接管 ⇒ **unhandled rejection**（Electron 主进程节点级风险） | race 前挂 no-op `.catch` 接管 | `0e9e42dfd` |
| 9 | i1 | 注释/测试描述的是生产**不可达**输入（compose 自带 `videoPrompt`），漏述真实的流水线路径 | 重写三来源语义注释 + 测试改成真实形态 | `61b85fae6` |
| 9 | i3 | 重读用 `getProject`，而它对不存在的项目**抛错**：窗口内删项目 ⇒ IPC 异常响应 | 新增 `_findProject`（不存在返 null）+ 空值守卫 fail-open | `61b85fae6` |

> 第 9 轮另有 i2（失败路径返回陈旧快照导致渲染端回滚窗口内编辑）也被采纳修复于 `61b85fae6`，与上表 i1/i3 同批。

### 裁决为 dismissed 的（理由可验证，非「看起来没问题」）

| 指控（多轮重复提出） | 为何不修 |
|----------------------|----------|
| 生成侧用任务创建时固化的 `uiLocale`、展示侧用当前 `getAppLocale()`：切换界面语言后要么白付一次调用、要么译文永不补齐 | 这是**图片提示词翻译自 2026-08-12 起就存在的同源口径**（流水线 optimize 阶段同样提交时固化 `params.uiLocale`）。主进程结构上拿不到渲染进程实时 locale（无 `navigator`、无 IPC 通道），`_resolveUiLocale` 的取值来源即项目创建时固化的值。单独改视频一侧只会制造新的不对称；彻底改须连同 `promptTranslation` 与 `prompt_translations_pending`/compose 并行任务契约一起动，属独立 change。已登记 PRD §3.1.31「已知限制」第 2 条 |
| 翻译 await 在 IPC 内，用户多等一次 LLM、多付一次成本 | 「重新生成视频优化词」本身已是分钟级 LLM 操作，多一次同量级调用不改变量级；改后台异步需新增「翻译中」状态 + 轮询/推送通道 + 重试，复杂度远超收益。第 3 轮已补 25s 有界超时，消除「无限挂起」这一真实风险 |
| 「改回原文时译文不恢复」 | 指控方自述无 bug。系统无法验证字符串逐字节同一性，保守清空是正确语义；恢复路径（重新生成按钮）就在旁边且明确 |
| 「compose 空白串可能覆盖 fallback」 | 指控方推导已自证 OK：`safeText('').trim()` 为 falsy ⇒ 必走 fallback；且 `normalizeComposeScenes` 白名单根本不含该字段，无覆盖路径 |
| `.ccg/reviews/` 管线产物入库污染 diff | 这是既有门禁 `check-pr-exec-record.js` 的读取前提（删除未闭环的 dual 记录会被 L693-702 判红）。是否把它纳入 `.gitignore` 属「改谁来守门」，按 AGENTS.md 必须人工过目，不由 agent 自动决定 |

### 引擎侧限制（如实登记，不假装已闭合）

1. **critic 输出超长截断**：单轮评审输出 21145～33226 字符，超过模型 JSON 上限被砍断，导致 `status=error` 且有 4 轮无法跨家族收敛。这是模型/引擎的容量限制，不是代码问题；引擎自身提示语亦判断「重跑同样输入多半还是截断」。两次失败记录（`a10fb6a4`、`c5133ca6`）**保留其真实的 `error` 状态**，未美化。
2. **`.ccg/reviews/` 产物随提交累积**：每条 pre-commit 写一份按内容寻址的记录，本分支累计 11 份（3 份 `mode=dual`、8 份 `mode=single`）。`mode=single` 不进入欠账门禁的判定面（`check-pr-exec-record.js` L739 只判 `mode === 'dual'`）。
3. **`self_play_blocked` 的语义边界**：引擎把「存在 upheld 裁决」判为阻断（`ccg-deep-review.js` `blockingFromAdjudication`），**无法表达「该 upheld 已在后续提交修复」**。因此 3 条 dual 记录按 `check-pr-exec-record.js` L560-563 明示的通道，在记录内写入结构化 `deepReview.resolution`（`disposition` / `reason` / `upheldItems[].fixedIn` / `adjudication` 路径）并把状态置为闭环值 `needs_revision`。选 `needs_revision` 而非 `self_play_resolved`，是因为前者**保留 `performedBy` 后端对账**（后者在 L814 直接跳过该检查）——取更严的一档。门禁复跑读数：`OK: 本 PR 携带执行记录或带原因的豁免`、`dual-closed total=3`、`unknown=3`（`unknown` 属设计 §9.1 丙「可见不拦」档，因 resolution 未按 `evidence`/`tier` 结构化成外部可复核指针，如实留在可见面）。

**回归规模**：`story2video-project-service.test.js` 123 例 + 新拆出的 `story2video-video-prompt-translation.test.js` 12 例（合计 135，与拆分前一致）、`story2video-stages.test.js` 161 例、`ResultView.test.js` 123 例，共 **419 例全绿**；`eslint --quiet` rc=0。修复各带针对性回归（假计时器推进 25s 验证有界超时、并发 `updateSegments`/`deleteProject` 验证快照语义、`unhandledRejection` 监听验证滞后拒绝被接管、`_resolveUiLocale` 归一化表、en 界面不发起翻译调用）。

## 经验沉淀（用户要求：内置记忆 / 外部记忆 / EverOS 三处）

| 载体 | 落点 | 复核方式 |
| --- | --- | --- |
| **外部记忆**（仓内） | `01-docs/learnings.md` 置顶两篇：《「upheld 永远是阻断项」——门禁要的是「裁决已产出」，不是「建议已改完」（`ccg-closure-exits-and-debt-split`）》与《新 PR 的执行记录别再写 `PENDING` —— 那是旧口径的化石（`record-status-derived-marker`）》 | `Select-String -Path 01-docs/learnings.md -Pattern 'ccg-closure-exits-and-debt-split'` 命中 L1 |
| **内置记忆**（`~/.dsh/memory/Mulpub/`） | 新增 `ccg-deep-review-closure-exits.md`、`record-sync-derived-marker.md`；并在既有 `max-lines-named-target-zero-growth.md` 追加「边界补充：什么时候上调 targets 才是正解」一节（原篇结论是「抽组件而不是上调 target」，本节把边界划清：新 UI 模块该抽、跨方法防御性硬化该上调且须逐文件写理由） | 三个文件均存在且含本次实测读数 |
| **EverOS**（`127.0.0.1:8000`，v1.4.1） | `POST /api/v1/memory/add` → `status: accumulated`，再 `POST /api/v1/memory/flush` → **`status: extracted`**（只认这一步才算落盘）。`session_id=s2v-video-prompt-translation-20261020`，`app_id=multi-publish`，`project_id=default` ⇒ 实际落盘目录为 `default_project` | 产物已核：`~/.everos/multi-publish/default_project/users/me/episodes/episode-2026-10-20.md`（含 Subject/Summary/Content）与 `…/.atomic_facts/atomic_fact-2026-10-20.md`（`entry_count: 12`） |

> **EverOS 检索侧的如实说明**：`/api/v1/memory/search` 目前对该 `project_id` 返回空集合
> （`episodes/profiles/agent_cases` 全 0，`keyword` 与 `hybrid` 两法同）,而 `/health` 显示
> `cascade.failed_permanent=7 / unrecoverable_total=17`。即**存储成功、索引检索未命中**，
> 属既有基础设施状态（非本次引入）。因此本条的"已保存"结论以**文件落盘取证**为准，
> 不以检索回执为准 —— 这与仓规一致：不把工具的失明读成结论，也不把回执读成落盘。
## 债务熔断（逐文件行数门禁）处置与理由

`node .github/scripts/check-max-lines.js` 首轮报 5 条：3 条 `TARGET_GREW`（点名还账文件零增长容差）+ 2 条 `TEST_LEDGER_GREW`（测试文件膨胀超 200 容差）。**两类按门禁自身给的正解分流处置**，不是统一"调数"：

### 一、测试文件：按门禁要求拆分（不调任何数）

门禁正解原文是「测试文件同样要拆（按被测模块/场景分文件），别再堆成一个」。据此：

| 文件 | 处置 | 结果 |
|------|------|------|
| `story2video-project-service.test.js` | 把 12 个「视频提示词中文翻译」用例抽到新文件 `story2video-video-prompt-translation.test.js`（含自带最小 harness：`root`/`store`/`beforeEach`），按场景分文件 | 3759 → 3370 行（登记 3274 + 容差 200 = 3474 以内 ✓）；新文件 457 行（testLimit 1500 以内 ✓） |
| `ResultView.test.js` | 新增 describe 内部提炼 `viewWithSegments` 帮手消除 9 处 `createView + projectId + segments + nextTick` 四行样板，并把 fixture 对象合并为多字段单行 | 2398 → 2351 行（登记 2175 + 容差 200 = 2375 以内 ✓）；**断言一条未删**，123 例仍全绿 |

> 说明：`ResultView.test.js` 选「提炼样板」而非「再拆一个文件」，是因为拆出需要复制其 150 行的 `createView` harness（含 `vi.mock` 提升语义），会制造重复；提炼样板同时降低了维护成本。项目服务测试则天然按被测方法可切分，且 harness 只有 30 行，故直接拆分。

### 二、源文件：按门禁明示通道「在 review 中说明理由后一并上调 targets」

门禁正解原文含「降到目标以下，**或在 review 中说明理由后一并上调 targets**」。本节即该理由。三个文件均为**既有超大文件**（早已在 `targets` 点名还账清单里），本次增长全部来自 QM-6 九轮评审要求的防御性硬化，不含新功能铺张：

| 文件 | 原 target | 新 target | 增长 | 增长内容与不可省的证据 |
|------|-----------|-----------|------|------------------------|
| `story2video-project-service.js` | 2373 | **2527**（+154） | 视频提示词翻译落库、`_findProject` 非抛错读取、译文身份校验、locale 主语言归一化、compose 回填三来源语义 | 对应 QM-6 第 1/5/6/7/8/9 轮共 9 处 upheld 修复；每一处都指向一个用户可见缺陷（旧译文展示、并发编辑回滚、垃圾译文落库、IPC 异常响应）。拆出去需要把「项目持久化 + 分段编辑 + 素材重试 + 视频翻译」四个关注点分离，属独立重构 |
| `story2video-stages.js` | 4006 | **4081**（+75） | `translateVideoPromptForLocale`（含 25s 有界超时、滞后 rejection 接管、`finally` 清定时器）与契约 JSDoc | 对应第 2/3/6/8 轮 upheld 修复。该函数**必须**与 `translatePromptsForLocale` 同文件才能复用其批量调用/JSON 解析/逐行兜底（跨文件复用会把私有实现暴露成公共 API，风险高于收益） |
| `ResultView.vue` | 1890 | **1929**（+39） | 折叠开关按钮、两处「提示词 + 翻译」成对块、三枚方法、折叠/翻译样式 | 即用户诉求本身（补齐视频翻译 + 降低信息密度）。进一步压缩只能把翻译块抽成子组件或把样式移出 SFC——两者都属独立重构，且会把单文件的可读形态打散 |

**为什么不选「硬拆到目标以下」**：三个文件的增长都是**缺陷修复的净增量**（不是新功能扩张）。在 9 轮评审已确认正确性的状态下做跨关注点拆文件，是把「已收敛的正确性」换成「未验证的结构改动」——正是本仓反复记过的「为了指标牺牲已验证状态」同型风险。因此按门禁明示的第二条通道处置，并在此逐文件写明理由与后续可选方向；`targets` 上调后仍保持**零增长容差**（下一刀再动就要重新论证）。

**门禁复跑读数**：`node .github/scripts/check-max-lines.js` → `✅ 无新增超大文件，挂账清单与现实一致`（rc=0）；`node --test .github/scripts/check-max-lines.test.js` 在本机有 1 条失败（`system 档的 core.excludesFile 真能改域`），该用例自建临时 baseline 与临时 gitconfig、**不读仓库 baseline**，与本次改动无关，属宿主 git 版本行为差异，如实登记不美化。

## QG Changes 门禁处置：`远程同步` 行改派生标记

首轮 CI 的 `QG Changes` 报两条真仓用例红，根因是我在记录里写了 `| 远程同步 | PENDING |`。按 2026-10-17 change `gate-record-sync-derived-status` 的收窄口径：**新 PR 的记录不再手写状态词**，表行状态列写派生标记「由门禁推导」，bullet 写 `远程同步 PR #NNNN` 不带状态词，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导。已改为派生标记；`node --test scripts/check-gate-record-debt.test.js` 由 `fail 2` 转为 **115 例全绿**。同时验证 `check-gate-record-debt.js` 主判据输出 `OK: 两源所有未收口的 远程同步 行均已登记…`。



## 交互方案选型（用户点名要「分析常见合理的 UI/UE 处理方式」）

对「内容太多」诉求评估了 4 类常见处理，结论与理由记入 PRD §3.1.30「交互设计」。

| 方案 | 结论 | 理由 |
|------|------|------|
| 提示词与翻译**左右分栏**（同一行） | ❌ 不采纳 | 中英文都是**长文本**（本例英文 480 字符 / 中文 130 字符）。左右分栏会把每侧可用宽度砍到 ≈50%，英文提示词在 500px 栏宽下要滚 6-8 行，中文侧大量留白——阅读与编辑体验双输。左右分栏只适合「短键值对」（如设置页标签+输入框） |
| 翻译**默认隐藏 + hover/点击 tooltip** | ❌ 不采纳 | 翻译是需要**静读**的长文本，tooltip 的窄宽度与易消失性和它冲突；且「不可复现的临时浮层」不符合桌面端信息查阅习惯 |
| **默认折叠 + 点击展开**（本次采用） | ✅ 采用 | 这是「详情区块过长」的标准解（ Progressive Disclosure ）。首屏只留分段序号/状态/素材区概览，编辑区按需展开；配合**展开态互斥**（一次只编辑一个分段），进一步压低视觉噪音。本项目已有同族实现可对齐（`QuickCollectPanel` 查看提示词、`BatchCollectPanel` 分组面板、`FilmAutoPanel` el-collapse 高级区） |
| 翻译与提示词**上下紧邻成对**（本次采用） | ✅ 采用 | 用户明确要求「翻译文字要和对应的图片/视频提示词放在一起」。上下紧邻保持每侧全宽（长文本不被砍），并用弱化样式（左边框 + 次级底色 + 只读，不可编辑）与可编辑 textarea 形成层级差 |

## 已知限制（不假装已闭合）

1. **存量项目无 `videoPromptTranslation`**：2026-10-19 之前生成的项目该字段为 null，结果页视频提示词旁显示占位文案「未生成」。只在用户点「重新生成视频优化词」后补齐第一份译文——**未做存量批量回填**（那需要一次遍历 N 个项目的 LLM 批量翻译，成本与失败面都不适合塞进本次 UI 修复）。登记为后续可选项。
2. **`_resolveUiLocale` 的 locale 来源**：主进程无 `navigator`，不做系统语言探测；口径为 `story2videoTextConfig.config.optimize.uiLocale` → `options.uiLocale` → 缺省 `zh`。若用户**在任务创建后**切换了界面语言，新生成的视频译文仍按任务创建时的语言。与图片提示词翻译同源（流水线 optimize 阶段也是提交时固化 `uiLocale`），非本次新引入的不一致。
3. **en 界面的 DOM 断言受限**：单测挂载未装 i18n 插件，`getAppLocale()` 的返回值变化不触发组件重渲染（预存在的测试环境限制，非产品缺陷）。因此「en 不展示翻译块」这条用例断言的是 `showPromptTranslation`/`showVideoPromptTranslation` 两个判定函数的返回值，而非 DOM 数量；生产环境由 `App.vue` 安装 i18n 插件，locale 切换即重渲染。

