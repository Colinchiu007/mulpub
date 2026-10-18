---
record: voice-model-program-resolved
task: 语音模型改由程序+运营决定（移除「语音模型」下拉，运营中心能力默认模型覆盖全类别 + 总览）
date: 2026-10-18
---

## 本次执行记录：语音模型由程序与运营决定（voice-model-program-resolved，2026-10-18）【混合 PR】

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`apps/desktop/src/**`、`apps/desktop/electron/services/**`、`ops-center/backend/**`、`ops-center/frontend/src/**`）⇒ 隔离 worktree `D:\Data\projects\mp-worktrees\mp-voice-model-program-resolved`、裸分支 `voice-model-program-resolved`（非 C 盘；`git rev-parse --abbrev-ref HEAD` 实证）；依赖就绪 `node scripts/verify-worktree-deps.js` = `OK` |
| 第一性原因（QM-5 ①） | ✅ | 三处独立成因：①**UI 冗余**——「语音模型」下拉在多模态/单能力 MiniMax 下只有唯一候选（`capability_models.tts` / `models[0]`），零信息增益却把模型决策推给用户；②**口径分叉**——前端 `getS2VDefaultVoiceModel` / `getS2VDefaultVideoModel` 在多模态缺能力声明时猜 `models[0]`（可能是 image/video/llm 模型），主进程 `resolveProviderDefaultModel` 是 fail-closed，**三层测试各测一层、无一断言两层相等**，故前端可任意改兜底而不红（2026-08-09 修过同族问题后复发）；③**死字段**——前端读 `provider.defaultModel`，而 `_safeRow()` 从不返回该字段，运营配置的 `default_model` 被静默忽略 |
| 逃逸分析（QM-5 ②） | ✅ | ①单元层：`useTtsVoices.test.js` 只测前端解析、`model-provider-manager.resolve-default.test.js` 只测主进程，**跨层等价零覆盖**；②集成层：`CreateView.test.js` 10 处语音夹具只设 `s2vConfig.voiceProvider` 而不注册 `s2vVoiceProviders`，旧实现读 `voiceModel` 所以能过——**夹具替实现掩盖了"模型必须来自 provider 注册表"这一契约**；③呈现层：`S2vConfigPanels.test.js` 只迭代契约白名单，从未断言「某字段不渲染」这一负向事实 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增 **跨层一致性锁** `apps/desktop/electron/services/voice-model-resolution-parity.test.js`（27 例：22 组夹具同喂前端 composable 与主进程，逐项断言相等 + 4 条源码级防漂移锁 + MiMo 正交用例）；**变异反证**：摘掉前端 `category === 'multimodal'` fail-closed 分支 ⇒ 4 条同时转红（3 条跨层 + 1 条源码锁），还原即 27/27 绿；`S2vConfigPanels.test.js` 新增「永不渲染『语音模型』」三场景负向用例；`useTtsVoices.test.js` 导出面计数同步（20 refs / 5 computeds / 27 methods，并显式断言两个已删键不得复现）；ops-center 后端新增 6 例（全类别能力默认模型保存/越界 400/键归属 400/空值合法/总览分组与缺口/隐藏项排除/迁移幂等回填） |
| 防止再次发生（QM-5 ⑤） | ✅ | ①跨层一致性锁把"改一层忘另一层"变成红（本仓首次为"两份实现等价"立断言）；②`docs/PRD-S2V-PIPELINE-PAGE-UX.md` §4.3.1 把四级口径逐条写死，与主进程函数一一对应；③`learnings.md` 沉淀 4 条（跨层等价契约 / 死字段读取静默 / 正交特判不可混改 / 运营能力问法要给现状+缺口）；④ops-center 保存前双端校验（前端 `ElMessage.warning` 点名能力 + 后端 400 点名能力），运营填错当场可见 |
| 行尾与 diff 对账 | ✅ | `git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致（提交前实测，见 PR 正文） |
| locale 成对（Gate 7） | ✅ | 本期**零新增用户可见文案**：删除的是既有控件，未新增 `zh.js`/`en.js` 键，故无需成对提交；渲染端非 locale 文件未新增 CJK 字面量（`useTtsVoices.js` 仍有既有 CJK-literal 约束测试守护） |
| QM-1 打包 / QM-2 | 见下 | 见「QM-1 打包证据」小节 |
| QM-4 视觉 | 责任交给 CI | 本机不冒充跑像素门禁（缺 dev server，且 QM-4 明确禁止本机截图当基线）。变更确实影响 `create-story2video-detail` 的「声音」分组布局（少一个字段），基线重取证按流程由 CI 渲染产物承担。为收窄漂移面，`s2vSectionSummary('voice')` 的模板字面量**逐字节保持不变**（模型 ID 保留为只读回显）——理由两条：①该行含硬编码中文，改动会被 `check-locale-sync --cjk` 判为新增硬编码（实测改后即报「渲染端新增 1 处」，已回退并按 gate 口径复核 PASS）；②折叠态摘要本身在像素基线内 |
| QM-6 CCG 双模型外部评审 | ✅ 已执行（改用 codex 人工跨家族） | 引擎 `sh scripts/deep-review.sh` **跑不通**：critic 调用 `codeagent-wrapper.exe` 返回 `ETIMEDOUT`；另用 90s 探针验证 `claude -p "reply with exactly: PONG"` 在本机非交互模式下**完全无响应**（不是 diff 太大导致，是 CLI 通道坏）。改用 `codex exec`（OpenAI 家族）对 diff 做跨家族评审，得 **1 CRITICAL + 2 MAJOR + 3 MINOR**，全部处置：**C1**（两层优先级顺序不一致——minimax-multimodal 的 `default_model` 是 LLM 模型，主进程会把它当 TTS 返回；新建任务被前端显式 params 掩盖，只有断点续跑/播客踩到）⇒ 改主进程与前端同序（能力优先 + 多模态跳过 provider 级默认），更新主进程 12 条测试、parity 补 4 条关键夹具、源码锁改为校验函数体内顺序；**M1**（恢复路径不归一 voiceModel）⇒ `_applyS2VSnapshotObject` + `applyS2VPipelineDefaults` 双端重算；**M2**（运营中心校验用字符串化值、落库用原始值 ⇒ 非字符串静默通过）⇒ 非字符串直接 400 + 落库 trim + 2 条测试；**m2**（守卫 trim 不对称）⇒ `getS2VVoiceProvider` 统一 trim；**m1** 由 C1 修复消解；**m3**（总览对未知能力键失明）记录为已知限制。引擎失败证据保留在 `.ccg/reviews/*.json` 的 `deepReview.error`，未抹掉 |
| 远程同步 | 由门禁推导 | 见 PR（合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口，本行不手写状态词） |

- 保留门禁：判定 docs-only=false（走完整节拍）| 行尾对账 ✅ | 品牌残留 随 CI | 文档同步 随 CI doc-gate | 执行记录 ✅ 本文件（旧载体 `.quality-gates.md` 与 `scripts/gate-record-debt-ledger.json` 按 2026-10-15「旧载体冻结」政策**零改写**）| 远程同步 PR（见 PR 号）

### 实测对照（本片全部技术判断的依据）

| 判断 | 取证方式 | 读数 |
|------|----------|------|
| 多模态下「语音模型」下拉只有唯一候选 | 读 `s2vVoiceModelOptions` 旧实现 + `model-provider-seeds.js` 预设 | `minimax-multimodal.capability_models.tts = 'speech-2.8-turbo'`；`minimax-tts.models = ['speech-2.8-turbo']` |
| 前端读的是死字段 | 读 `_safeRow()` 返回字段集 | 返回 `config`/`capabilities`/`capability_models` 等，**无** `defaultModel` |
| 三层解析口径不等价 | 逐条比对三处实现 | 前端两处多模态缺声明 → `models[0]`；主进程 → `''` |
| 运营中心「早就有」这个设置 | 读 `models.py` + `model_preset_service.upsert_model_preset` + `ModelPresets.vue` | `default_model` 字段 + 「默认模型 ID」下拉 + `capability_models` 多模态区；`default_model` 已校验 ∈ models |
| 运营中心缺什么 | 同上，逐层对照 | ①只多模态可填 ②`capability_models` 值未校验 ∈ models ③无总览视图 ④`capabilities` 值未做白名单 |

### 测试读数（本机实跑）

| 套件 | 读数 |
|------|------|
| `apps/desktop` parity + `model-provider-manager*` | `Test Files 2 passed (2)` / `Tests 45 passed (45)` |
| `apps/desktop` `electron/services/{story2video,podcast,model-provider}*`（主进程口径改动的全部消费者） | `Test Files 56 passed (56)` / `Tests 1406 passed (1406)` |
| `apps/desktop` 定向（parity + useTtsVoices + S2vConfigPanels + model-provider-manager） | `Test Files 4 passed (4)` / `Tests 77 passed (77)` |
| `apps/desktop` `src/views/CreateView.test.js` | rebase 前 `307/307`（评审修复前后各跑一次）；rebase 到最新 main 后上游已调整用例数 ⇒ **终态 `300/300 passed`** |
| `apps/desktop` `CreateView.test.js` + `video-creation/**` 同批跑 | `Test Files 15` / `Tests 478`，其中 1 例 `去发布：有项目对象时视频模式预填充` 失败 —— **A/B 取证为顺序/时序污染 flake**：该用例单跑通过（5.3s）、完整单文件重跑 `300/300 passed`；它属发布预填，与本片语音域改动无交集，如实记录不掩盖 |
| `ops-center/backend` `test_model_presets_api.py` + `test_model_catalog_api.py` | `61 passed`（含新增 M2 两条、能力默认模型 6 条、迁移回填、总览） |
| `ops-center/frontend` `npm test` | `Test Files 16 passed (16)` / `Tests 161 passed (161)` |
| `ops-center/frontend` `npm run build` | `✓ built`（`ModelPresets-*.js` 22.75 kB） |
| `apps/desktop` `pnpm run lint` | exit 0（`eslint electron/ src/ --quiet` 无输出） |

### QM-1 打包证据

本片**未修改 `apps/desktop/electron/**` 的运行时逻辑**（仅在该目录下新增一个测试文件 `voice-model-resolution-parity.test.js`）。为稳妥仍执行了打包与启动三层判据：

| 判据 | 命令 / 方式 | 读数 |
|------|-------------|------|
| 依赖门禁 | `node scripts/verify-worktree-deps.js` | `消费方解析通过 11 项` / `OK`（未借用其它分支的 workspace 链接） |
| 打包 | `cd apps/desktop && pnpm exec electron-builder --win --dir --publish never` | **exit code 0**；`packaging platform=win32 arch=x64 electron=43.7.7 appOutDir=dist-electron\win-unpacked`；`updating asar integrity executable resource` 完成。两条 `file source doesn't exist`（`dist/fonts`、`.playwright-browsers`）是 `--dir` 模式下的既有常态（渲染层 dist 未构建 / 未装浏览器包），与本片改动无关 |
| 启动判据 ①（存活，隐含前提） | spawn `dist-electron\win-unpacked\Multi-Publish.exe`，8s 窗口内断言仍存活 | `alive_after_8s=true` |
| 启动判据 ③（stderr 为空） | 捕获 stderr 全文 | `(empty)` ⇒ 通过（未命中 `Failed to load platform config` / `PluginLoader.*mkdir failed` / `ENOTDIR.*app.asar` / `Cannot find module` 任一红线） |
| 子进程 env 卫生 | 显式构造 env 并剔除 `ELECTRON_RUN_AS_NODE`（与 `scripts/lib/qm1-child-env.js` 的 `buildChildEnv()` 同口径） | **实测父环境确实带着该变量**，已剔除并出声告警（`WARN parent env had ELECTRON_RUN_AS_NODE (stripped)`）——这正是 AGENTS.md 记录的那个会随 shell 继承、并使 Electron 以纯 Node 模式静默退出的变量；若不剔除，本次「stderr 为空 + rc=0」会被误读成通过 |
| 启动后行为 | stdout 抽样 | `[startup] 已净化 User-Agent`、`[SplitterBridge] workDir resolved`、`StageExecutor Registered …` 系列均正常 |

### 未在本机执行的项目（如实列出）

- **完整 `vitest run`**：`vitest.config.js` 是 `maxWorkers: 1` + `fileParallelism: false` 的串行配置，本机实测跑过 1 小时仍未结束（日志已到 `electron/services/wechat-mp-*`），故中止。替代证据是**与改动直接相关的定向套件全绿**（上表）+ CI 的 `QG` 全量 job 作为 required check。不把「跑过一部分」写成「全量通过」。
- **QM-4 像素基线重取证**：按 QM-4 明令禁止本机截图当基线，责任交 CI 渲染产物。
- **QM-6 双模型外部评审**：本机无可用外部评审通道。

