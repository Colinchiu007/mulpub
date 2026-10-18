---
record: fix-model-default-follow
task: 流水线生成器默认值跟随「模型设置」默认（图片/视频/语音三类）——根因是前端只依赖 is_default 排序副作用，从未调用主进程 getDefault
date: 2026-10-18
# 远程同步不需要事后回填：收口由门禁按主干历史推导（change: gate-record-sync-derived-status）。
---

## 本次执行记录：流水线生成器默认值跟随「模型设置」默认（fix-model-default-follow，2026-10-18）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ 混合 PR（运行时代码 + 文档） | 运行时代码：隔离 worktree `D:\Data\projects\mp-worktrees\mp-fix-model-default-follow`（**D 盘，非 C 盘**）+ 裸分支 `fix-model-default-follow`；共享根全程停留在 `main` 且未落任何改动。入口用 `scripts/session-init.sh fix-model-default-follow`（经 Git for Windows Bash 显式路径调用，避开裸 `bash` 解析到 WSL 的已知坑）；`scripts/pre-code-edit-guard.ps1` 先跑一次确认 BLOCKED（共享主目录禁写运行时路径）后才建 worktree。依赖就绪三件套（`pnpm install --frozen-lockfile` / `ensure-electron` v43.7.7 / `verify-worktree-deps` 11 项消费方解析通过） |
| 第一性原因（QM-5 ①） | ✅ | `CreateView.vue::loadS2VProviders()` 在「用户无显式选择」时解析默认值，但**从未读取「谁是默认」这个事实**，只依赖两种间接信号：① 语音生成器 `nextVoiceProviders.find(p => p?.category === 'multimodal' && typeof p?.capability_models?.tts === 'string')` —— 只看「是不是多模态」，不看「是不是默认」；② 图片/视频生成器 `this.s2vImageProviders[0].id` / `this.s2vVideoProviders[0].id` —— 直接取首项。后两者唯一的「正确」来源是 `listProviders()` 的 `ORDER BY is_default DESC, is_preset DESC, name ASC`，这是**排序副作用不是契约**，同分时按 `name ASC` 字典序，默认项很容易落到第二及以后。**真源早已存在但前端没问**：`ModelProviderManager.getDefault(category)`（IPC `model-provider:get-default`，preload `system.js:266` 已暴露）内部 `_multimodalProviderFor()` 已完整实现双默认语义（`model-provider-manager.js:1186`）。桌面端缺的是前端调用，不是主进程能力 ⇒ **本次不改主进程/IPC/DB** |
| 逃逸分析（QM-5 ②） | ✅ | 单元层：`create-view-module-utils.test.js` 只覆盖 stage/snapshot/字段挑选，**没有**默认 provider 解析的纯函数可测；组件层：`CreateView.test.js:848` 的夹具里 `elevenlabs` 与 `minimax-multimodal` **都无默认标记**，旧代码的「第一个多模态」规则恰好让断言通过 —— 测试忠实实现了错误需求；E2E/视觉层：无覆盖「改默认 → 下拉默认跟随」的跨页场景；审查层：2026-08-12 审查聚焦「多模态要出现在下拉里」，未质疑「默认该由谁决定」。属**测试场景缺失 + 审查盲区**复合的系统性漏洞：`ORDER BY is_default DESC` 的排序副作用被当成默认契约，而没有任何测试固定「默认项必须在第一位」或「默认值来自 getDefault」 |
| 修复 + 回归保护（QM-5 ④） | ✅ | 新增纯函数 `resolveS2VDefaultProviderId(providers, category, preferredId)`（`apps/desktop/src/views/video-creation/create-view-module-utils.js`），口径与主进程 `_multimodalProviderFor` 逐条对齐：普通 provider `is_default === true`；多模态 `config.capability_defaults` 含该能力或整体 `is_default === true`，**且必须 `capabilities` 含该能力**（防 image 默认的多模态抢走 tts 下拉）。`loadS2VProviders()` 增补 `modelProviderGetDefault(image/tts/video)` 三路查询，与既有三个 `list` 分两批 `Promise.allSettled` **并行**（不增加串行延迟）。回归锁：`create-view-module-utils.test.js` **9 例新增**（多模态能力默认 / 普通 provider 默认 / 多模态整体默认 / 图片视频同样跟随 / 无默认回首项 / 悬空 id 不回退 / 空列表 / 多模态未声明能力 / 脏入参不抛错）；`CreateView.test.js` **6 例新增**（三类默认跟随 × 3 + getDefault 不可用降级 + 显式选择不被覆盖 + 用户选过 Mimo） |
| 旧断言改写（需求变更，非回归） | ✅ 已留注释 | `CreateView.test.js` 原「语音生成器默认选择已配置的多模态 TTS 模型（minimax-multimodal 优先于普通 TTS 服务商）」夹具中两者**都无默认标记**，旧代码因「第一个多模态」选中 minimax；新口径回退首项 elevenlabs ⇒ 该断言锁定的正是本次要纠正的行为。改写为「语音生成器默认选择模型设置里设为默认的多模态 TTS 模型」，并在用例上方留注释说明语义变更与指向新增用例组 |
| 防止再次发生（QM-5 ⑤） | ✅ | ① 把「谁是默认」从排序副作用提升为**显式契约**：单一纯函数 + 主进程真源双测；② PRD 固化口径 —— `PRD-S2V-PIPELINE-PAGE-UX.md` 新增 §9.10（8 小节：需求与根因 / 判定口径表 / 交互优先级 / 三类生成器 / 数据流 / 数据校验与边界 / 验收标准 / 已知限制）与 §4.3.2 索引，`PRD.md` §7.1.4 条目修订（两处重复段同步改写）；③ 新增详版 PRD `01-docs/PRD-MODEL-DEFAULT-FOLLOW-2026-10-18.md`（含 §8.3 逃逸分析与系统性漏洞分类）；④ 记忆三处落盘（内置 / 外部 / EverOS） |
| TDD 顺序 | ✅ RED→GREEN | 先写 9 例纯函数测试跑出 `TypeError: resolveS2VDefaultProviderId is not a function`（9 failed / 11 passed），实现后 **20/20 全绿**；再写 6 例集成测试，实现接入后全绿 |
| 测试实测 | ✅ | `create-view-module-utils.test.js` **20 passed**；`CreateView.test.js` 全量 **313 passed**（110s，含 6 新增 + 1 改写）；邻近域回归 `src/views/video-creation` + `s2v-options-autosave.test.js` + `CreateView.voice-clone-delete-guard.test.js` + `views-deep2.test.js` 共 **14 files / 143 passed**。桌面端全量 vitest 已转后台执行，合并前以 CI 全量结果为准 |
| 数据校验边界（fail-closed 全分支） | ✅ | `providers` 非数组/空 → `''`；`category` 非字符串 → trim 空串，`includes('')` 恒 false 降级首项；provider 缺 `id`/`id` 非字符串 → 不参与判定；`config` 为数组/标量/null → 视为无 `capability_defaults`；`capability_defaults` 非数组 → 未声明；多模态 `capabilities` 不含该能力 → 不算默认；`is_default` 非严格 `true`（如 `1`/`"1"`）→ 不算（主进程 `_safeRow` 已转布尔，此处不复制宽松真值判断）；`preferredId` 不在列表内或未通过口径 → 忽略并向下，**绝不返回悬空 id**（避免下拉空白选中项）；`modelProviderGetDefault` 三路全失败 → `defaultProviderId()` 返回 `''`，走列表内默认标记解析（不退回首项） |
| 交互优先级 | ✅ | 用户显式选过的 provider > 显式「自动 Edge TTS」（`s2vVoiceProviderExplicitEdge`）> 模型设置默认 > 首项兜底。该表沿用并显式化了 2026-08-12 既有合同，本次仅把第三档从「第一个多模态/首项」改为「模型设置的默认」 |
| 明确不做（防行为扩张） | ✅ | ① **不新增 `getS2VDefaultImageModel`**：图片侧原本只设 `imageProvider` 不设 `imageModel`（由 `_applyS2VSnapshot`/restore 与 `applyS2VPipelineDefaults` 处理），新增该方法属无需求的行为扩张且引入新回归面；② 不改 `s2vVoiceProviderOptions` 计算（「自动 Edge TTS」首项与「（多模态）」后缀不动）；③ 不改 `handleS2VVoiceProviderChange` 的 `voiceProviderExplicitEdge` 记录；④ 不改运营中心 `PipelineOptions.vue`（其 `visual.imageProvider`/`voice.voiceProvider` 的 `default_value` 仍为空串 —— 运营中心不持有桌面本地 provider id，该契约不是本需求路径）；⑤ 不改影视工程/播客等独立链路的模型选择器（不走 `loadS2VProviders()`），不扩大爆炸半径 |
| locale 成对 | ✅ | 本轮**未新增 locale 键**（无新增用户可见文案，纯默认值解析逻辑变更）；CI Gate 7 `check-locale-sync` 与 `--cjk` 基线扫描预期零新增命中 |
| 行尾与 diff 对账 | ✅ | 全部改动文件为 LF；`git diff --numstat` 与 `--ignore-cr-at-eol --numstat` 两口径一致；无删除文件 |
| QM-1 打包 | ✅ PASS | `pnpm run build:dir`（= `build:vue` + `electron-builder --dir`）**rc=0**；渲染端 `CreateView-CRBulwfB.js` **346.32 kB**（gzip 90.14 kB）正常产出。**启动验证三层判据 + 存活断言**：父环境实测带 `ELECTRON_RUN_AS_NODE="1"`，已显式剔除并由 notice **出声告警**（未静默）；子进程 env 该校验位 `absent (OK)`；`alive after 9000ms = true`、`stdout 21344 字节`、`stderr 0 字节`、红线命中 `[]` ⇒ **PASS**。判据取自 AGENTS.md QM-1 三色表（①红线→FAIL ②非空未命中→NEEDS_REVIEW ③空→PASS），且存活单独断言（提前退出时 stderr 必然为空，只看 stderr 会把「没启动」读成「启动干净」） |
| 静态门禁 | ✅ | ESLint 改动 4 文件 **0 error**；`check-locale-sync --keys` **PASS**（2123 个使用中 key 齐备，本轮未新增 locale 键）；`--cjk` **PASS**（基线 1331 → 当前 1189，无新增硬编码）；`check-no-brand-residue.js` **PASS**（10282 tracked，零残留）；`check-doc-abs-paths.js` **PASS**（4093 受管文件，无新增本机绝对路径） |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后由 `scripts/lib/merge-ledger.js` 按主干历史（squash 尾注 `(#NNNN)`）推导归属。状态列**不得**预写成 `PASS`（会判「预写不存在的证据」） |

### 遗留（不假装已闭合）

1. **图片生成器的 `imageModel` 仍不跟随默认 provider 联动**：本次只解析 `imageProvider`，`imageModel` 沿用既有链路（restore 快照 / `applyS2VPipelineDefaults`）。若默认图片 provider 被切换，`imageModel` 可能短暂停留在旧 provider 的模型值。这与改动前行为一致（非本次引入），但属可改进项 —— 需先确认图片模型是否有独立的 `getS2VDefaultImageModel` 需求，再决定是否新增，**不在本任务契约内**。
2. **`preferredId` 与列表内判定可能不一致的窗口**：主进程 `getDefault` 的候选集（`enabled=1` + 有可用 Key）与前端 `enabledProviders`（额外要求 `name` 非空）不完全相同。当前用「双重校验 + 向下降级」吸收该差异，不会白屏；但若未来主进程放宽/收紧过滤条件，需同步复核 §9.10.2 口径表。
3. **其他页面的模型选择器未纳入**：影视工程、播客等页面有各自的模型选择逻辑，不走 `loadS2VProviders()`。本次按「爆炸半径最小」未触碰；若用户后续反馈那些页面也有同样问题，需按同一口径（调用 `getDefault` + 复用或等效实现 `resolveS2VDefaultProviderId`）单独修复。
