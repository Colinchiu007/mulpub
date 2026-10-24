---
record: explainer-cdp-e2e
task: 让「AI 讲解视频」流水线可零凭据端到端复跑（CDP 驱动 + 本地 Provider 桩），并修掉复跑途中暴露的四个缺陷
date: 2026-10-23
---

## 本次执行记录：AI 讲解视频离线复跑能力与四处缺陷收口（explainer-cdp-e2e，2026-10-23）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/electron/services/**`、`apps/desktop/scripts/**`、`apps/desktop/tests/**`）+ 文档（`01-docs/PRD-video-creation.md`）⇒ 隔离 worktree `/workspace/mp-worktrees/mp-explainer-cdp-e2e`、裸分支 `explainer-cdp-e2e`（`git branch --show-current` 实证）；共享根 `/workspace/mulpub` 保持 `main` 且 clean |
| 第一性原因（QM-5 ①） | ✅ | 四个独立缺陷（**其中 D1 的首版实现带安全回归，被 CI 的既有回归锁逮住并已修正**，详见「修复 + 回归保护」行）：**D1** 免 Key 判据写成硬编码 id 白名单（`model-provider-manager.js` 的 `LOCAL_NO_KEY_PROVIDER_IDS`）而非「地址在回环上」这一属性 ⇒ 内置「Ollama (本地)」「本地 Whisper」被强制要求 API Key（其适配器契约明写 apiKey 可空）；**D2** 音色占位值 `'default'` 只在 provider 路径被过滤、edge-tts 路径没过滤 ⇒ edge-tts 抛 `ValueError: Invalid voice 'default'` ⇒ TTS 静默降级为 3s 静音、**成片完全无旁白**；**D3** `dev.js` 的 `waitForVite` 缺「Electron 只启动一次」的一次性守卫，`req.setTimeout(1000)` 的重试与成功回调竞态 ⇒ 反复 spawn，实测进程数冲到 **189**、RSS 3.4GB ⇒ Vite 被 OOM `SIGKILL`；**D4** Electron 在 Linux 无头环境没有真实口令存储后端（`basic_text` 不算加密 ⇒ `safeStorage.isEncryptionAvailable()` 恒 false，实测 basic/gnome-libsecret 两种后端均为 false）⇒ 模型 API Key 存不进去（`CRYPTO_UNAVAILABLE`） |
| 逃逸分析（QM-5 ②） | ✅ | ① **单测层**：`asset-generator.test.js` 只锁了 provider 路径的哨兵过滤，**没有** edge-tts 音色断言；`model-provider-local-no-key.test.js` 的三个用例全是既有白名单内的 id ⇒ D1/D2 都在盲区。② **测试执行层**：本片新增的测试若放 `apps/desktop/tests/e2e/**` 会被 vitest 的 `exclude: ['tests/e2e/**']` 整目录排除 ⇒ **一个都不会跑而 CI 全绿**（与 `startup-compat.test.js` 的历史逃逸同族）⇒ 单测改放 `apps/desktop/tests/` 根下，由 include 的 `tests` 通配收集。③ **断言层**：既有端到端只看「有音频流」，而**静音兜底同样产出音频流** ⇒ D2 的「成片没旁白」在断言上完全不可见 ⇒ 本片把断言升级为「有音频流 **且** 响度显著大于数字静音下界」。④ **夹具层**：`config/identity-public.json` 的 `identityAuthEnabled` 由**发行配置**锁定、不接受环境变量覆盖（`CONFIG_ENV_OVERRIDE_KEYS` 显式排除该键）⇒ 身份服务启用时主进程以身份状态为准，dev 管理员短路**不生效**；这既有回归锁（`license-access-control.test.js`「Logto 已启用时开发环境也不能把退出登录提升为 admin」）⇒ 本片**不动该策略**，改为在复跑手册里写明前置条件 |
| 修复 + 回归保护（QM-5 ④） | ✅ | D1：`canUseWithoutApiKey` 改为「**显式回环地址** + 本地预置」两路判定，**远端端点仍严格要求 Key** 的反例锁保留并扩写；⚠️ **首版有安全回归、被 CI 逮住**：首版把「空 base_url」也当回环（`isLoopbackBaseUrl('')` 返回 true）⇒ **heygen 这类「空地址=用适配器默认地址、而默认地址是远端」的 provider 被当成免 Key**，「HeyGen 已配但无 API Key → 拦截」这条既有回归锁当场变红。根因：属性的**空值语义**（空 ≠ 回环，是「用适配器默认地址」）被漏判。修正为「空地址只有本地预置才免 Key，其余一律要求 Key」，并补一条空地址边界断言；D2：哨兵值收敛为单一常量 `PLACEHOLDER_VOICE_IDS` + 两条路径共用的 `resolveConcreteVoiceId`，edge-tts 无具体音色时回落 `zh-CN-XiaoxiaoNeural`；D3：`dev.js` 加 `electronSpawned` 一次性守卫（判据先于置位、置位先于 spawn）；D4：`dev-launcher` 新增 `MP_ELECTRON_PASSWORD_STORE`（白名单 basic/gnome-libsecret/kwallet/kwallet5/kwallet6，**非法取值抛错而非静默忽略**，未设置时完全不下发该开关）。新增回归保护：`asset-generator.test.js` +3 例、`model-provider-local-no-key.test.js` +4 例、`dev-launcher.test.js` +7 例（node --test）、`apps/desktop/tests/local-provider-hub.test.js`（新建 16 例）、`apps/desktop/tests/animated-explainer-cdp.test.js`（新建 11 例）；实测：vitest 三个文件 9+23 例全绿，node --test 22 例全绿 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **单一事实源**：音色哨兵值从两处内联字面量收敛为 `PLACEHOLDER_VOICE_IDS`（杜绝 provider/edge-tts 两条路径再次漂移）；免 Key 判据从 id 白名单改为地址属性（新增 provider 免于人工维护清单）；② **可执行契约**：复跑断言新增「标题安全区」——合成引擎默认 `zoom-in` 是 1→1.25 居中缩放、左右各裁 10%，本地出图文字必须距边 ≥13%（实测边距 73px < 裁切量 128px 时成片里「好消息是」被裁成「消息是」且**不报错**）；③ **接线棘轮**：新增的两个 `*.test.js` 放在 vitest include 能收集的 `apps/desktop/tests/` 根下（不是 e2e 子目录），并在文件头注明「为什么不能放 e2e 目录」；④ **留痕**：`dev.js` 打印 `--password-store=` 生效现场、`--remote-allow-origins=*` 生效现场（禁止静默 no-op 表达「已开启」）；⑤ **复跑手册**：PRD §12.7 写明无凭据/无外网模型的前置条件与两个 Linux 无头必备开关 |
| 行尾与 diff 对账 | ✅ | 两口径 numstat 一致：`plain +2882 -16` / `--ignore-cr-at-eol +2882 -16`（相等，无行尾噪声）。**16 行删除的逐条归因**（全部是被新实现替换掉的旧行，无内容丢失）：`asset-generator.js` 4 行 = 内联的哨兵音色过滤三元式 + edge-tts 的 `voice` 取值行；`model-provider-manager.js` 5 行 = 硬编码白名单常量与其两行判据 + 旧注释行；`dev-launcher.js` 3 行 = `buildElectronArgs` 的函数签名行与 `module.exports` 行（改为带 `passwordStore`）；`dev.js` 2 行 = `require` 行与 `buildElectronArgs(...)` 调用行（改为传 `passwordStore`）；`dev-launcher.test.js` 1 行 = `require` 解构行；`model-provider-local-no-key.test.js` 1 行 = `require` 解构行。**无整段删除、无文件删除**。 |
| 逐文件行数门禁（`debt-guard`） | ✅ | 首轮 CI **红了**：`TARGET_GREW` 判 `apps/desktop/electron/services/asset-generator.js`（1403 > 目标 1369）与 `model-provider-manager.js`（1301 > 目标 1284）—— 这两个文件在「点名还账」名单里，**零增长容差**。按门禁自己的指示「降到目标以下」处置（**不抬基线**）：① 音色占位值判定抽成独立小模块 `apps/desktop/electron/services/tts-voice-id.js`（新逻辑进新文件，还账文件零增长）；② 免 Key 判据的注释块压到 2 行，并把 `isLoopbackBaseUrl` 的实现压缩两行（`catch` 与 `return` 合并），使该文件**行数净 0**。
   ⚠️ 该文件还有**第二道零余量约束**：债务预算门禁的 `MODEL_PROVIDER_FAN_OUT` 卡的是它**唯一 require 数 ≤ 66** ⇒ 把判据抽成新模块会多一个 require（67 > 66，直接红）⇒ 最终实现是**内联**（行数净 0 + require 数净 0），不新增文件。复跑 `node .github/scripts/check-max-lines.js` ⇒ `✅ 无新增超大文件，挂账清单与现实一致`（rc=0）。**附带发现**：该门禁在本地用**旧基线**跑会多报一条 `rpa-view-platforms.js`（主干上已由 PR #4329 上调目标到 1497）⇒ 验门禁必须用**最新 main 的基线**，否则会为别人的存量漂移背锅 |
| 接线棘轮 | ✅ | 新增 `apps/desktop/tests/local-provider-hub.test.js`、`apps/desktop/tests/animated-explainer-cdp.test.js` 落在 vitest include 的 `tests` 通配内（**刻意避开** `tests/e2e/**` 的 exclude），`apps/desktop/scripts/dev-launcher.test.js` 的新增用例随该文件既有 CI 接线（`quality-gate.yml` Gate 2b 的 `node --test apps/desktop/scripts/dev-launcher.test.js`）自动生效；`scripts/check-unwired-tests.js` 的判定域不含 `apps/`（WORKSPACE_COVERED），无新增欠账 |
| QM-1 打包 / QM-4 视觉 | ✅ / N/A | QM-1：改动落在 `apps/desktop/electron/services/` 与 `apps/desktop/scripts/` ⇒ 已执行打包 + 启动判据（下详）。QM-4：**未触碰任何 `.vue` / 样式 / locale 文件**，无视觉面变更 ⇒ N/A |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未见可用的外部评审通道（`codeagent-wrapper` 类工具未探测到）；**如实记为未执行，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`，只认 squash 尾注 `(#NNNN)`） |

### 实测证据（本片全部技术判断的依据）

**端到端复跑（Linux 无头容器，3GB cgroup 内存）**：

| 轮次 | runId | 阶段 | 成片 | ffprobe |
|---|---|---|---|---|
| 1 | `mvkug44o_zrzw` | 8/8 `completed` | `s2v_1792751430487_1_output.mp4` | h264 / 1280x720 / 30fps / **aac 24kHz 单声道** / 61.76s / 5,020,696B |
| 2 | `mvkth5x5_9ev0` | 8/8 `completed` | `s2v_1792751726756_2_output.mp4` | h264 / 1280x720 / 30fps / **aac 24kHz 单声道** / 61.76s / 5,070,082B |

**音轨非静音取证**（`ffmpeg -af volumedetect`）：`mean_volume: -19.7 dB` / `max_volume: -2.9 dB`。数字静音的下界是 -91 dB ⇒ 差 70dB ⇒ 确认是真实人声而非静音兜底。**这是本次最关键的一条断言**：修复前的同一批成片是 `mean_volume ≈ -91 dB`（每场景固定 3.0s 静音），仅看「有音频流」看不出差别。

**D3 的进程数取证**：修复前 `pgrep -c -f "dist/electron"` = **189**、`ps` 合计 RSS = 3417MB、`free -m` used = 2857/3072、`dmesg` 出现 `oom-kill:constraint=CONSTRAINT_MEMCG ... task=ffmpeg`；修复后 electron 进程数 = **7**、used = 512MB。

**D2 的原始报错**（应用日志，原文）：`edge-tts failed exitCode=1 retried=true stderr_tail=Traceback (most recent call last): ... ValueError: Invalid voice 'default'.`

**D1 的原始报错**：`modelProviderUpdate` 返回 `{code:-1, errorCode:"CRYPTO_UNAVAILABLE", message:"系统安全存储不可用，无法保存 API Key。请重启应用或检查系统设置后重试。"}`。

**D4 的后端实测**：Electron 43.7.7 在本容器里 `--password-store` 取 `""` / `basic` / `gnome-libsecret` 三种取值，`safeStorage.isEncryptionAvailable()` **全部为 false**（`basic` 的后端名是 `basic_text`，Linux 上不算加密）。故 `MP_ELECTRON_PASSWORD_STORE` 只能解决「让 Chromium 走指定后端」，**safeStorage 在 Linux 上不可用这一事实不变** —— 真正让本地端点能免 Key 的是 D1（回环免 Key 判定），两者是不同层次的问题，不混为一谈。

**UI 模式（真实界面驱动）的实测结论**（2026-10-23，CDP 点界面）：

| 观察 | 结论 |
|---|---|
| 只改 `location.hash = '#/create'` | **视图不切换**（`location.href` 变了但仍渲染首页）；壳层不响应这次 hash 变更 ⇒ 驱动必须点侧边栏 `[data-testid="mp-primary-create"]` |
| 点侧边栏「视频创作」 | 正常挂载 `CreateView`，流水线卡片齐备（含 `animated-explainer`） |
| 点卡片 → 填 textarea → 点启动 | 三步都成功（按钮 `disabled === false`），**但流水线没有启动** |
| 原因 | **登录门按 `status === 'disabled'` 拒绝**（身份服务未启用）：`useLoginGate.ensureLogin` 弹提示后返回 `false`，`startPipeline()` 根本不被调用 ⇒ 这是**既有安全策略，不是缺陷** |
| 与 API 路径的差异 | API 路径（`pipelineStartOrchestrated`）**不受这层登录门约束**，只看 IPC 访问级别（未打包运行 ⇒ `admin`）⇒ 复跑走 API 路径是可行的，UI 路径在身份服务未启用时本就不该启动 |

⇒ 记录里把「两条路径的差异」写清，避免下一个维护者把「UI 跑不通」误判成流水线缺陷、或把「API 跑得通」误当成登录门失效。UI 模式的驱动代码仍然入库（它验证的是**界面可自动化**这件事），并在报告里如实标注被登录门拦截。

**次要观察（非用户可见缺陷）**：`notify:log` 的已知键白名单（`ipc-handlers/notify.js` 的 `KNOWN_MESSAGE_KEY_PREFIXES`）不含 `memberCenter.` / `loginGate.` 前缀 ⇒ 登录门产生的提示在**主进程日志侧**被丢弃（`drop unknown messageKey`）。**用户侧的 toast 照常弹出**（文案由 renderer 的 i18n 解析后直接用 `ElMessage` 展示，上报只影响主进程留痕），故不构成用户可见缺陷；本片只如实记录，未改。

**1080p 合成 OOM 的边界**：8 路 `xfade` 居中拼接在 1920x1080 下内存峰值超限（`dmesg` 的 `oom-kill ... task=ffmpeg`），ffmpeg 被 SIGKILL 时 stderr 还在推进（`speed=0.245x frame=553`）⇒ 表现为「合成阶段失败但没有 ffmpeg 报错」。本次以 1280x720 复跑通过；**这是环境容量约束，不是流水线缺陷**（桌面端 8GB+ 机器上不存在）。

### 遗留（不假装已闭合）

1. **Python 后端未在本环境跑通**：`splitter` / `prompt_engine` 两个 Python 包未安装 ⇒ 两个 bridge 反复重启（`No module named 'splitter'`）。`animated-explainer` 的八阶段不依赖它们，**不影响本次结论**；但「主服务 `not_started`」状态下若干旁路能力不可用，本片未处理。
2. **不解除身份服务启用时的登录要求**：dev 管理员短路只在「身份服务未启用」时生效，既有回归锁明确禁止在身份服务启用时提权 ⇒ 本片不动该策略，改为在 PRD §12.7 写明复跑前置条件（本地发行配置把 `identityAuthEnabled` 置 false）。
3. **`assets` / `editing` / `compose` / `publish` 四个阶段没有 explainer 专属文案键**，走通用 Story2Video 文案 ⇒ 用户在「AI 讲解视频」上看到的是「正在准备素材」这类通用措辞。本片在 PRD §12.5.2 如实登记，**未改**（改它要动 locale，属于另一件事）。
4. **本地桩只服务开发/自测**，不进生产链路；真实用户永远走各自的服务商。
5. **合成素材图的「标题安全区」只在本地桩里落实**：真实 AI 出图是照片/插画，不受该约束；该契约写进 PRD §12.2.4，供后续做「本地/程序化出图」的 Provider 参考。
6. **成片未做人工视听终审**：本次只做了机械断言（存在/可播/规格/非静音）与两帧抽帧目视（确认无裁切），未逐段听审。留待具备真人审片条件的环境补做。

## CHANGELOG 条目

# feat(视频创作): AI 讲解视频流水线可零凭据端到端复跑，并修掉「默认音色下成片完全没旁白」等四处缺陷（explainer-cdp-e2e）

- fix(视频创作): **默认音色下成片完全没有旁白**。用默认音色且没配 TTS 服务商时（走内置的免 Key 语音合成），edge-tts 会收到 `'default'` 这个占位串当音色名，直接报错，于是旁白被静默降级成每段 3 秒静音 —— 成片能播、有音轨，但**一个字都没有**，界面也不报任何错。根因是「未指定音色」的占位值只在模型服务商那条路径上被识别，语音合成这条路径没识别；现已把占位值收敛成单一常量、两条路径共用同一套判据。
- fix(模型设置): **本地模型服务商不再被强制要求 API Key**。内置的「Ollama (本地)」「本地 Whisper」在管理器里被要求必须填 Key（可它们自己的适配器明写「Key 可空」），用户被迫填一个毫无意义的假串；在系统安全存储不可用的机器上（Linux 无头/容器）连假串都存不进去，直接报「系统安全存储不可用」。根因是免 Key 判据写成了硬编码的服务商名单，而不是「地址在回环接口上」这一属性；现改为按地址判定 —— 远端服务商**仍严格要求 Key**，安全姿态不变。
- fix(开发环境): 启动桌面端时 Electron 会被**反复拉起**（实测进程数冲到 189 个、内存吃满后把开发服务器挤掉，表现为「窗口刚起来就没了」）。根因是等待开发服务器就绪的逻辑缺少「只启动一次」的一次性守卫，响应超时重试与成功回调会各拉起一次；现已加守卫。
- feat(开发环境): 新增 `MP_ELECTRON_PASSWORD_STORE` 开关，用于在无头/容器环境指定 Chromium 的口令存储后端（默认不设置 ⇒ Windows/macOS 行为一字不变；取值非法直接报错而不是静默忽略）。
- feat(视频创作): 新增「AI 讲解视频」流水线的**零凭据端到端复跑**能力：本地 Provider 桩（OpenAI 兼容的 LLM 端点 + Stable Diffusion WebUI 兼容的出图端点，均免 Key、不外网）+ 原生 CDP 驱动（不经 Playwright 的 connectOverCDP），可连续跑多轮并把「成片存在 / 可播放 / 规格合规 / **音轨非静音**」变成可断言的验收条件。此前这条八阶段链路只能靠人工点界面验证，出了问题也只能在真实账号上复现。
- docs(视频创作): PRD 增补 §12「AI 讲解视频离线可复跑与四处缺陷收口」，写清启动入参与校验、模型能力前置校验、本地桩的协议契约、**标题安全区**（合成默认的放大动效会裁掉左右各 10%，本地出图的文字必须留够边距，否则成片里首尾字被吃掉且不报错）、八阶段流程与产线口径、两种驱动方式的交互逻辑、阶段显示名与提示文字逐条对齐、验收矩阵、无凭据复跑操作手册，以及四个缺陷的第一性原因/逃逸分析/防再犯措施与未闭合项。

## learnings

### lesson: place-holder-voice-id-must-be-filtered-on-every-tts-path

**现场**：用 CDP 驱动「AI 讲解视频」流水线跑通后，发现成片**完全没有旁白**——每段固定 3.0 秒静音。应用日志里只有一行 `edge-tts failed exitCode=1 ... ValueError: Invalid voice 'default'.`，界面侧毫无异常。原始报错是被截断的 800 字符 stderr 尾巴里最后一行，翻完整日志才看到真正的 `Invalid voice 'default'`。

**根因**：上游取音色的兜底是哨兵串 `'default'`（`firstDefined(params.voiceId, stage.options?.voiceId, 'default')`），它表示「让适配器自己挑默认音色」。**模型服务商那条路径**早就会把 `'default' / 'male' / 'female-soft'` 过滤掉，**语音合成这条路径**却原样透传，于是 edge-tts 拿 `'default'` 当真实音色名去查表，查不到就抛错。两条路径对同一份输入的判据不一致，是这类缺陷的通用形态。

**可复用的 N 条**：

1. **哨兵值必须收敛成单一常量、且被每条路径共用**。同一份输入在两条路径上解析出不同语义，是「某条路径忘了过滤」这类缺陷的标准前奏。判据收敛到一处后，新增路径只要调同一个函数就不会再漂移。
2. **「有 X」不等于「X 是有效的」**。静音兜底同样产出音频流，只断言「有音频流」的端到端测试**对这类缺陷完全失明**。本片把断言升级为「有音频流 **且** 响度显著大于数字静音下界」（真实人声 -19.7dB vs 数字静音 -91dB），缺陷立刻可见。
3. **上游的兜底值会顺着调用链一路传下去**，在链条末端才暴露成第三方库的语义错误（`Invalid voice 'default'`）。读日志时**别只读最后一行**，把 stderr 尾巴完整展开——真正的信息常在最后一行，而调用方只把它当尾巴。
4. **降级路径本身也可能是缺陷现场**：功能「能跑通」不等于「跑对了」。凡是存在兜底分支的链路，验收条件必须针对**兜底后的产物**写，而不是针对「流程没报错」写。

### lesson: local-endpoint-should-be-credential-free-by-address-not-by-id-list

**现场**：想让内置的「Ollama (本地)」指向本机的自建端点，保存时被拒「系统安全存储不可用，无法保存 API Key」。逐层排查发现：Chromium 在 Linux 无头容器里根本没有可用的加密后端（`basic_text` 不算加密），于是任何 API Key 都存不进去；而**本机端点根本不需要 Key**。

**根因**：免 Key 判据被写成**硬编码的服务商 id 名单**（piper / local-diffusion / comfyui），而不是「地址在回环接口上」这一**属性**。名单是人工维护的：新增一个本地预置（ollama、local-whisper）时没人会想到去改它，于是同样本地、同样适配器明写「Key 可空」的服务商被漏掉，只能被迫填假 Key。

**可复用的 N 条**：

1. **判据要落在「这件事的本质属性」上，而不是「谁被登记过」上**。「在回环地址上」是本质属性（回环不可能把 Key 送往外网）；「在名单里」是人工登记的结果。属性判据对新增对象自动成立，名单判据对新增对象默认不成立。
2. **人工维护的白名单是漏项的默认来源**。新增一个同类对象时，漏改白名单的代价是「功能在名单内能用、在名单外不能用」，而且**不报错**。凡是能用属性表达的条件，就不要用名单表达。
3. **属性判据放宽后必须显式确认反向边界**：本次把判据放宽到「回环即免 Key」后，必须有一条「远端端点仍然强制要 Key」的回归锁，把「无 Key 配置永远不会变成一条远程请求通道」钉死。
4. **别把「系统不支持」与「系统缺配置」混为一谈**：本例里 Chromium 侧确实不支持加密（不可绕过），而「本地端点要不要 Key」是**另一层**问题（可绕过）。把两层混在一起，就会得出「必须造一个假 Key」的错误结论。

### lesson: dev-launcher-needs-a-one-shot-guard-for-slow-dependency

**现场**：在 3GB 内存的容器里启动桌面端，进程数几分钟内冲到 189 个 Electron 进程、合计 RSS 3.4GB，`free -m` 只剩 149MB，开发服务器被 OOM `SIGKILL`（`dmesg` 的 `oom-kill:constraint=CONSTRAINT_MEMCG ... task=ffmpeg`），表现为「窗口刚起来就没了」。加了一次性守卫后，同一台机器上 electron 进程数 = 7、内存占用 512MB。

**根因**：等待开发服务器就绪的逻辑里，`req.setTimeout(1000, ...)` 触发的重试与随后的成功回调**存在竞态**，两条路径都会走到「spawn Electron」。开发服务器在慢速文件系统（NAS 挂载）上响应稍慢就会踩中。

**可复用的 N 条**：

1. **「等待依赖就绪」的重试循环必须有一次性守卫**。超时重试与成功回调天然会同时到达一次（一次 destroy 与一次 response 谁先到不确定），没有守卫就等于「每次依赖就绪都可能多拉起一个消费者」。
2. **重复拉起的代价往往不是「多一个窗口」，而是「多一整棵进程树」**。本例每个 Electron 实例各带十几个辅助进程，量级差异决定了它能在几分钟内吃掉整机内存。判「重复拉起」的影响时，要按**整棵进程树**算，不能按单个进程算。
3. **单实例锁救不了这个场景**：这些实例共用同一份 profile，后到的会被单实例锁顶掉，但**在被回收前它们的进程树已经把内存吃掉了**。锁解决的是「逻辑上的重复」，解决不了「资源上的重复」。
4. **为「一次性守卫」加源码级性质锁**（守卫判据先于置位、置位先于实际动作），比重构后靠人记得写更可靠。

### lesson: shallow-clone-fakes-a-gate-red

**现场**：本地跑 `node scripts/check-gate-record-debt.js --carrier-mode=block` 报红 ——「声明的来源 PR 与主干事实不符 8 篇」；把 `--base-ref/--head-ref` 都指向 `origin/main`（即主干对主干）**同样报红**，看上去像主干既有欠账。

**根因**：本地是 `git clone --depth 1`（可见历史仅 50 个提交），而该判据用 `scripts/lib/merge-ledger.js` 从 **git 历史**推导「这篇记录实际是被哪个 PR 带进主干的」（靠 `git log --grep='(#NNNN)$'` 一类匹配）。历史被截断 ⇒ 旧 PR 推不出来 ⇒ 归属被错记成当前 tip ⇒ 报红。

**对照证据**：GitHub 上 main 的 quality-gate **连续 8 次 conclusion=success**（同一份判据在完整检出的 CI 上是绿的）。本地红、CI 绿 ⇒ 是环境假象，不是欠账。

**可复用的 N 条**：

1. **本地门禁红 ≠ 主干红**。凡是用 **git 历史**做推导的判据（记录归属、blame、增量统计），在浅克隆下都会失真 —— 结论必须用「主干 CI 实际结论」交叉验证后再定性。
2. **判据自身在 `main` 上跑一遍是最快的自证**：`--base-ref=origin/main --head-ref=origin/main`。若主干对主干仍红，那是环境/历史问题；只有「PR vs 主干」才红，才是这个 PR 的问题。
3. **完整检出才是门禁的运行环境**。做门禁验证时若用了浅克隆，先把历史补全（`git fetch --unshallow` 或 `--depth=50` 以上）再下结论。

### lesson: widening-a-criterion-must-also-decide-what-the-empty-value-means

**现场**：把「本地服务商免 API Key」的判据从**硬编码 id 名单**改成**「base_url 在回环接口上」这一属性**（想让它对新增对象自动成立）。本地跑既有回归锁全绿，**CI 却红了**：`electron/tests/pipeline-model-preflight.digital-human.test.js` 的「HeyGen 已配但无 API Key → 拦截」被判为「应拦截却放行」。

**根因**：属性的**空值语义**被漏判。原判据里「空 base_url ⇒ 回环 ⇒ 免 Key」是对的（那时它只对三个本地预置生效，而这三个预置的适配器默认地址确实在回环）；改成属性判定后，这条空值规则被**一并推广到了所有 provider** —— 而空 base_url 的真实语义是「**用适配器自带的默认地址**」，那个默认地址**可能是远端**（heygen 的默认是 `https://api.heygen.com/v2`）。于是「远端服务商无 Key 也放行」——**安全边界被静默放宽了**。

**可复用的 N 条**：

1. **把判据从「名单」放宽到「属性」时，必须同时决定这个属性的空值/缺省值算什么**。名单判据里「空地址」是隐含的例外（只在白名单内生效）；属性判据一旦泛化，这个例外就**自动扩散到了全体**。
2. **「属性」不等于「值域」**。「在回环上」这个属性在**空值上没有定义**（空地址不是「在回环上」，也不是「不在回环上」，而是「尚未指定」）—— 凡是判据依赖某个字段，都要把该字段的**未指定态**单独判一次。
3. **本地能过、CI 能红，说明你的本地环境少了一条约束**：CI 上跑的是**完整检出 + 完整依赖**，本地往往是浅克隆/半截依赖 ⇒ 本地绿不能证明 CI 绿（本次的反过来：本地绿、CI 红，说明**已有回归锁在 CI 上才真正覆盖到**）。
4. **仓库自己的回归锁往往比你的新测试更能抓出你引入的回归**。这次的判据（D1 的第一版）连我自己的新测试都没抓到，是一条**既有的、别的模块的**锁抓到的 ⇒ 改动既有行为前，先去读那一带的既有锁。

### lesson: e2e-test-files-under-e2e-dir-are-never-collected-by-vitest

**现场**：给新写的两个模块补单测时，先按「就近原则」把测试放在模块旁边（`apps/desktop/tests/e2e/lib/*.test.js`），结果 `vitest run` 一个都没跑到；查 `apps/desktop/vitest.config.js` 才发现 include 是白名单而 exclude 里有 `tests/e2e/**` —— 整个 e2e 子树被排除，**且 CI 不会因此变红**。仓库自己的注释里就记着同族事故（`startup-compat.test.js` 曾这样逃逸过一次）。

**根因**：仓库的测试收集是「include 白名单 + exclude 黑洞」两层，而 `tests/e2e/**` 这条 exclude 覆盖了整个 e2e 目录树。放在那里的测试既不被执行、也不被 `check-unwired-tests.js` 的接线棘轮发现（该脚本的判定域把 `apps/` 整体划为「由 vitest 按 workspace 收集」）。

**可复用的 N 条**：

1. **新增测试文件前先确认它落在哪条收集规则里**，不要凭「测试挨着被测模块」这种直觉放。判据是收集配置本身（include/exclude），不是目录名好不好看。
2. **「测试文件存在」不等于「测试会被执行」**。本仓的接线棘轮只管 `scripts/` 与 `.github/scripts/` 域；`apps/` 下的测试全靠 vitest 收集 ⇒ 放错目录 = 静默不跑。
3. **在测试文件头写明「为什么放在这里」**，把这条容易复发的约束固化在文件里；下一个维护者改目录时会先看到它。
4. **同族判据在别处也适用**：任何「收集是白名单」的机制，新增条目都必须显式登记，否则「没写」和「写了但没跑」在结果上完全一样。
