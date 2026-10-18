---
record: fix-s2v-voice-clone-integrity
task: 克隆音色本地样本完整性核验 + 生成前置守卫（2026-10-18 事故：registry 记录仍为 active、本地样本目录缺失、供应商拒绝 voice_id，9 条 TTS 失败并以同一句英文重复 9 次）
date: 2026-10-18
---

## 本次执行记录：克隆音色本地样本完整性核验 + 生成前置守卫（fix-s2v-voice-clone-integrity，2026-10-18）

> 本文件为执行记录（唯一强制载体，见 `openspec/records/` 新形态）。
> 状态列不手写远程同步状态词：合并一旦发生，收口由 `scripts/lib/merge-ledger.js` 按主干历史推导。

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码变更（`apps/desktop/electron/**` 主进程 + `apps/desktop/src/**` 渲染层）⇒ 隔离 worktree `mp-worktrees/mp-fix-s2v-voice-clone-integrity` + 裸分支 `fix-s2v-voice-clone-integrity`（基于 `origin/main` `5f2e21770`（rebase 前创建于 `c4f140419`，rebase 后合入并发 #3929））；共享主仓（`mulpub` 共享根，main-only 协调目录）未做任何写入 |
| 第一性原因（QM-5 ①） | ✅ | 见 §QM-5①：`listClones` 只校验 `voice_id` 格式、从不与样本磁盘对账；`generate_assets` 无音色前置守卫；`tryReCloneVoice` 对样本目录 ENOENT 只是 catch 后返回 null。事故三方证据：`app.log:29882`（运行开始）/`:30077`（generate_assets 开始）/`:30082`–`:30129`（9 条 TTS 失败）/`:30084`（ENOENT）/`:30175`（0/9 收尾）；SQLite registry 记录 `deletionState=active` 且 `sampleStorage.relativeDir` 指向不存在的 `47f825cb-634e-4c5f-8d90-cc904e547411`；磁盘上 owner 目录仅剩另一个 MiMo 克隆的 `e39cae19-3438-448a-af7f-aa802eaa7fc9` |
| 逃逸分析（QM-5 ②） | ✅ | 见 §QM-5②：服务层无「记录在、目录删」用例；catalog 用例只构造失效替身；阶段层无「生成前即失效」用例；渲染层未覆盖「没有访问权」原文；无「双失效」集成夹具；审查把样本持久化当成已闭合兜底 |
| 系统性漏洞定位（QM-5 ③） | ✅ | 见 §QM-5③：①本地副本类能力只测读写不测存在性（测试场景缺失）；②失效通道只有 voice_id 单一来源、无原因枚举（测试质量不足）；③生成阶段对用户显式资源无前置守卫（流程缺失）；④批量失败按条拼接、无去重/聚合（审查盲区） |
| 修复 + 回归保护（QM-5 ④） | ✅（变异实测待 Lead 回填） | 见 §QM-5④：`listClones` 对账 + `invalidReason`、`getCloneVoiceStatus`、生成前置守卫、运行期聚合、`summarizeAssetFailures` 去重、渲染层归一化。回归锁：服务层新增 8 例、阶段层新增 10 例、通知层新增 5 例、格式化器新增 3 例（按测试文件新增 `it(` 计数）。变异反证清单见详细 PRD §12.3，实测结果由 Lead 回填 |
| 防止再次发生（QM-5 ⑤） | ✅ | 见 §QM-5⑤：`01-docs/learnings.md` 顶部 4 条教训、`CHANGELOG.md` 顶部条目、详细 PRD、`01-docs/PRD.md` §7.1.16.4（两处副本逐字节相同）、OpenSpec change `story2video-voice-clone-integrity`、本记录 |
| 行尾与 diff 对账 | 待提交前实测 | 工作树读数：`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 两口径逐档相等（新增文件未跟踪，提交后由 Lead 复跑并回填）。文档插入统一用 node 脚本做 CRLF 规范化，未手工编辑两份副本 |
| 接线棘轮 | ✅ | 新增 2 个测试文件（`apps/desktop/electron/services/story2video-voice-guard.test.js` 10 例、`tts-voice-clone-integrity.test.js` 8 例），均落在 `apps/desktop/vitest.config.js` 的 `electron/services/**/*.test.js` 收集域；另扩展现有通知/格式化器测试。`node scripts/check-unwired-tests.js` 实跑 = `OK: 全部测试均已接线或按欠账登记`（检查域内 106 个测试文件） |
| QM-1 打包 | 待提交前实测（由 Lead 执行） | 本刀改动含 `apps/desktop/electron/services/**`（主进程）⇒ 按 QM-1 必须打包。命令与三层 stderr 判据见详细 PRD/AGENTS.md；本记录不预填结论，Lead 执行后回填打包读数 |
| QM-2 代码必检项 | ✅ | 改动为只读异步 fs 对账 + 一次前置状态查询（每条 TTS 一次，O(1)，不随场景数增长）；无同步 CPU 密集原语、无新增 IPC、无 `v-html`、无硬编码等待；守卫日志只记 `voiceId/provider/reason`，不含音频/密钥/绝对路径 |
| QM-4 视觉回归 | N/A（有据） | 未改模板/样式/DOM；失效克隆的展示复用既有通道（下拉禁用 option、克隆列表徽标、`设为默认` 禁用），未新增页面结构 |
| QM-6 CCG 双模型外部评审 | 待提交前实测（由 Lead 执行） | codex + claude 两轴只读审查；本记录不预填结论，Lead 执行后回填 CRITICAL/MAJOR/MINOR 与采纳项 |
| 远程同步 | 由门禁推导 | 合并后由 `scripts/lib/merge-ledger.js` 按主干历史推导收口，不手写状态词、不为收口另开 PR |

## QM-5 五步（详细）

### ① 根因溯源

| 序 | 事实 | 证据 |
|---|---|---|
| 1 | 用户运行 `story2video-compose`（项目 `mvdxd21s_o1ws`），阶段 5/7 `generate_assets` 失败 | `app.log:29882`（14:32:39.333Z 运行开始）、`:30077`（14:33:31.481Z generate_assets 开始） |
| 2 | 9 条 TTS 全部被供应商拒绝，原文 `you don't have access to this voice_id`，间隔约 3 秒 | `app.log:30082` / `:30087` / `:30092` / `:30097` / `:30104` / `:30109` / `:30116` / `:30122` / `:30129` |
| 3 | 重克隆回退读取本地样本目录抛 ENOENT | `app.log:30084`：`scandir '.../voice-clone-samples/<ownerHash>/47f825cb-634e-4c5f-8d90-cc904e547411'` |
| 4 | 阶段以 `0/9 scenes have both image and audio` 失败，错误串把同一句英文按 `TTS #1..9` 重复 9 次 | `app.log:30175`（14:35:48.485Z）；`:30176` finalize failed |
| 5 | 用户重试一次，24 秒后同样失败 | `app.log:30309`（14:43:37.016Z 第二次 generate_assets 开始）、`:30364`（14:44:01.356Z 0/9）、`:30365` finalize failed |
| 6 | SQLite registry 记录仍为 active，`sampleStorage` 指向不存在的目录；偏好与 `lastOptions` 仍指向该 `voiceId` | `multi-publish.db` 只读查询：`tts-voice-clones:v2:minimax-multimodal:speech-2.8-turbo` → id `MiniMaxMiniMaxCloneVoice_00jngz_0qrltk`、`deletionState=active`、`relativeDir=voice-clone-samples/<ownerHash>/47f825cb-...`；偏好 `tts-voice-preference:v1:minimax-multimodal:speech-2.8-turbo` 同 id；`story2video.lastOptions.v1` 同 id（savedAt `2026-10-18T14:32:39.353Z`） |
| 7 | 磁盘 owner 目录仅剩 `e39cae19-...`（属于另一个 MiMo 克隆） | `shared-user-data/voice-clone-samples/<ownerHash>/` 只读列举；MiMo registry 记录指向该目录 |
| 8 | 该克隆创建于 2026-08-13（`createdAt=1786586213776`），失效已存在约两个月 | SQLite registry 记录 |
| 9 | 同类前兆：同日更早 `mvdthpjy_mnte` 以同一形态 `0/22` 失败 | `app.log:27241`（12:46:27.759Z generate_assets 开始）、`:27245`（同原文）、`:27247`（同 ENOENT）、`:27498`（12:52:58.552Z 0/22） |
| 10 | 修复前 `listClones` 只校验 `voice_id` 格式；`generate_assets` 无守卫；`tryReCloneVoice` 的样本读取异常被 catch 成 null；`summarizeAssetFailures` 逐条拼接；渲染层匹配不到「没有访问权」 | 修复前基线 `c4f140419`（事故时点；本分支已 rebase 到 `5f2e21770`）：`tts-voice-clone-service.js:355-375`、`story2video-stages.js:1477-1485` / `1492-1625` / `2749+` / `3604-3643`、`notification-error-patterns.js:37`、`pipeline-error-formatter.js`（无对应规则） |

第一性原因一句话：**把「registry 里有 active 记录」当成「这个音色还能用」——本地样本的存在性从未被对账，生成阶段也没有任何守卫，于是可预判的失效被推到运行期，以满额度调用和重复英文收场。**

### ② 逃逸链（按测试层级）

| 层级 | 为什么没拦住 | 证据 |
|---|---|---|
| 服务单元测试 | `tts-voice-clone-service.test.js` 覆盖增删改查/样本读取/非法 voice_id，但没有「记录还在、样本目录被删」用例；`listClones` 既有断言只覆盖非法 id（如 `"01"`） | 修复前测试文件通览；本刀新增 8 例（落在新文件 `tts-voice-clone-integrity.test.js`：缺陷 1、优先级 1、fail-open/历史记录 2、status 三态 1、owner 隔离 1、模型回退 1、错误码 1） |
| catalog 单元测试 | `tts-voice-service.test.js` 的 `invalidVoices` 用例构造 `invalid:true` 替身验证消费逻辑，不验证 `listClones` 能否产出该标记 | 既有用例「非法克隆不进入可选项并回退默认音色」 |
| 阶段单元测试 | 无「生成前即确定音色失效」用例；失败聚合用例的错误各不相同，测不出重复拼接；无「全部同因」聚合用例 | 修复前 `story2video-stages.test.js` 通览；本刀新增 10 例（落在新文件 `story2video-voice-guard.test.js`） |
| 渲染层测试 | 通知/格式化覆盖 voice not found / invalid / 当前账号无权访问，但没有覆盖供应商原文 `you don't have access to this voice_id`；也没有「新规则早于通用素材失败」的顺序锁 | 本刀通知层新增 5 例、格式化器新增 3 例 |
| 集成 / E2E | 真实运行只覆盖正常音色与「供应商拒绝但样本完好」的重克隆成功路径；「样本也被删」的双失效组合无夹具 | 事故即该组合的真实形态 |
| 代码审查 | 样本持久化被当作「有备份」的兜底，未追问「备份本身是否还在」；`tryReCloneVoice` 的 catch 把 ENOENT 归入普通失败，掩盖了它其实是可预判失效 | QM-5① 第 10 行 |

### ③ 系统性漏洞定位

| 分类 | 具体漏洞 |
|---|---|
| 测试场景缺失 | 「本地副本」类能力（克隆样本、缓存、导入素材）只测「写入/读取」，不测「读取对象已消失」。存在性对账从未进入测试模板 |
| 测试质量不足 | 「失效」概念只有 voice_id 格式一个来源，没有原因枚举（`invalidReason`），后续新增失效来源时消费方无法区分；catalog 用例只测消费端、不测生产端 |
| 流程缺失 | 生成阶段对「用户显式选择的资源是否可用」没有前置检查，把可预判失败推给运行期；失败聚合无「相同错误去重」断言 |
| 审查盲区 | 批量资源的错误呈现按条拼接，在「同一原因 N 次」场景必然产生噪音；评审未把「异常被 catch 成 null 后是否掩盖了可预判条件」列为提问 |

### ④ 修复 + 回归保护

| 修复项 | 落点 | 回归锁 |
|---|---|---|
| 本地样本磁盘对账（目录存在/非符号链接/至少一个音频扩展名文件） | `tts-voice-clone-integrity.js` `inspectSampleStorage` / `computeCloneInvalidReason` / `buildPublicCloneEntries` + `tts-voice-clone-service.js` `listClones` 薄封装 | 服务层 4 例：缺失目录、目录完好、非法 id 优先、无 sampleStorage 不判失效 |
| 只读状态查询（owner 隔离、模型候选回退、只读） | `tts-voice-clone-integrity.js` `readCloneVoiceStatus` + `tts-voice-clone-service.js` `getCloneVoiceStatus` 薄封装 | 服务层 4 例：三态形状、owner 隔离、模型回退、错误码 |
| catalog 继承失效通道 | `tts-voice-service.js`（不改） | 既有 `invalidVoices`/偏好回退用例；新增失效来源由 `listClones` 打标覆盖 |
| 生成前置守卫（零资源调用） | `story2video-voice-guard.js` `resolveVoiceCloneGuard` / `buildVoiceCloneUnavailableError` + `story2video-stages.js` `generate_assets`/`finalize_assets` 接入 | 阶段层 4 例：样本缺失、非法 id、fail-open 三种、不误伤两种 |
| 运行期聚合（先写 resume） | `story2video-voice-guard.js` `buildVoiceCloneAggregateError` + `story2video-stages.js` `generate_assets` TTS 失败分支 | 阶段层 1 例：9 条同因聚合、无原始英文、无 `TTS #`、resume 写入 |
| 失败聚合去重 + 场景区间 | `story2video-voice-guard.js` `summarizeAssetFailures`（经 `story2video-stages.js` 过渡期重导供测试） | 阶段层 2 例：连续区间、单条/非连续 |
| 克隆不可用判定统一 | `story2video-voice-guard.js` `isClonedVoiceUnavailableMessage`（`tryReCloneVoice` 与聚合共用） | 阶段层 2 例：正例 8 种、反例（限流/额度/网络） |
| 渲染层归一化与文案 | `notification-error-patterns.js` / `story2video-notifications.js` / `pipeline-error-formatter.js` / locales | 通知层 5 例 + 格式化器 3 例：错误码/原文、zh/en 逐字、顺序锁 |

变异反证（防装饰性测试）：清单见 `01-docs/PRD-S2V-VOICE-CLONE-INTEGRITY-2026-10-18.md` §12.3
（M1 去对账、M2 反转优先级、M3 fail-closed、M4 守卫 warn-only、M5 聚合条件改 `some`、
M6 不去重、M7 删/移动渲染规则、M8 守卫放到 Promise 之后）。**实测结果由 Lead 回填，本记录不预填。**

### ⑤ 预防措施（全部落到文件）

1. `01-docs/learnings.md` 顶部 4 条教训：`registry-presence-is-not-availability`（记录在≠可用）、
   `mark-invalid-at-the-single-entry-not-at-each-consumer`（唯一入口打标）、
   `preflight-guard-must-fail-open-and-run-before-side-effects`（只读/副作用前/命中才阻断/故障放行）、
   `aggregate-repeated-provider-errors-before-showing-them`（同因聚合 + 先写 resume）。
2. `CHANGELOG.md` 顶部条目（问题 / 改动 / 验证 三段；验证段注明真实读数由提交前实测回填）。
3. 详细 PRD `01-docs/PRD-S2V-VOICE-CLONE-INTEGRITY-2026-10-18.md`：事故时间线、数据校验、
   判定规则、交互、逐字文案、可观测性、G1–G16 验收、测试计划与变异反证、风险与遗留。
4. `01-docs/PRD.md` §7.1.16.4（两处副本逐字节相同）：合同行全部带独立 `【已实现】` 标注，
   并写入实现特性 `feat_story2video_voice_clone_integrity`。
5. OpenSpec change `story2video-voice-clone-integrity`：proposal/design/tasks/spec delta，
   把「样本对账 / 只读状态 / 失效通道 / 前置守卫 / 运行期聚合 / 失败去重 / 错误归一化 / 不变量」
   写成 MUST/SHALL Requirement 与 WHEN/THEN Scenario。
6. 本执行记录（QM-5 五步 + 门禁表 + 勾账 + 自测块）。

## 任务勾账

| 任务 | 状态 | 证据 |
|---|---|---|
| 服务层：`listClones` 磁盘对账 + `invalidReason` | ✅ | `tts-voice-clone-service.js`；服务层测试 4 例 |
| 服务层：`getCloneVoiceStatus`（只读、owner 隔离、模型回退） | ✅ | 同上；服务层测试 4 例 |
| 阶段层：前置守卫（`generate_assets` / `finalize_assets`） | ✅ | `story2video-stages.js`；阶段层测试 4 例 |
| 阶段层：运行期聚合 + resume | ✅ | 同上；阶段层测试 1 例 |
| 阶段层：`summarizeAssetFailures` 去重 + 场景区间 | ✅ | 同上；阶段层测试 2 例 |
| 阶段层：`isClonedVoiceUnavailableMessage` 统一判定 | ✅ | 同上；阶段层测试 2 例 |
| 渲染层：pattern / 通知键 / 格式化器规则 / zh-en 文案 | ✅ | 通知层测试 5 例 + 格式化器 3 例；locales 成对 |
| 文档：详细 PRD / PRD.md §7.1.16.4 / PRD-video-creation / change / 本记录 / CHANGELOG / learnings | ✅ | 本记录「② 预防措施」逐项列文件 |
| 定向测试全绿 | 待提交前实测 | 由 Lead 执行并回填（命令见自测块） |
| 宽范围回归 | 待提交前实测 | 同上 |
| QM-1 打包（主进程改动必须打包） | 待提交前实测 | 由 Lead 执行并回填 |
| QM-6 双模型外部评审 | 待提交前实测 | 由 Lead 执行并回填 |
| 提交 / PR / 合并 / main push 回读 | 待执行 | 由 Lead 执行；收口由 `merge-ledger` 推导 |

## 自测块（提交前当场跑，禁止预填结论）

```
# 1) 定向测试（Lead 提交前执行并回填真实读数）
cd apps/desktop && pnpm vitest run electron/services/tts-voice-clone-integrity.test.js \
  electron/services/story2video-voice-guard.test.js electron/services/tts-voice-clone-service.test.js \
  electron/services/story2video-stages.test.js electron/services/tts-voice-service.test.js
cd apps/desktop && pnpm vitest run src/story2video/story2video-notifications.test.js \
  src/utils/pipeline-error-formatter.test.js src/views/CreateView.test.js

# 2) 变异反证（清单见详细 PRD §12.3；逐条执行并记录哪几条变红）
#    未变红的变异必须补断言或如实标注「不可分辨」

# 3) 文档门禁（本记录落盘后执行；实际输出见下）
node scripts/check-text-encoding-integrity.js
node scripts/check-no-brand-residue.js
node scripts/check-spec-purpose.js
node scripts/openspec-sync-check.js
node scripts/check-doc-abs-paths.js --base=origin/main --head=HEAD   # 需提交后取证

# 4) 行尾与 diff 对账（提交前）
git diff --numstat
git diff --ignore-cr-at-eol --numstat
#    两口径逐档相等；新增文件在提交后进入 diff，由 Lead 复跑

# 5) QM-1（改动了 electron 主进程，必须执行）
cd apps/desktop && pnpm exec electron-builder --win --dir --publish never
#    asar list / require 链 / 8 秒启动 stderr 三层判据（②非空且未命中红线 ⇒ NEEDS_REVIEW）
```

**本记录落盘时已实测的文档门禁读数（2026-10-18，由 docs-record 执行；提交后由 Lead 复跑）：**

```
- `check-text-encoding-integrity.js` → rc=0：判据域 9978 个文本文件；现场问题 2（均为基线内 `.ccg/tasks/archive/2026-08/...` 存量），基线登记 6、4 条已修复（不判红），`OK：无新增编码损坏`。
- `check-no-brand-residue.js` → rc=0：扫描 10301 个 tracked 文件，`PASS`。
- `check-spec-purpose.js` → rc=0：扫描 154 份主规格，违规 0，`OK`。
- `openspec-sync-check.js` → rc=0：`OK: 387 tasks, 63 active changes, 234 archives.`
- `check-doc-abs-paths.js --base=origin/main --head=HEAD` → rc=0；因工作树未提交，HEAD==origin/main ⇒ 改动集 0，属取证顺序限制（提交后由 Lead 复跑）。补充全量口径 `--all` → rc=0：4112 个受管文件、现场存量 1185 处按文件对齐，无新增本机绝对路径。
- `check-changelog-growth.js --base=origin/main --head=HEAD` → rc=0：PASS（520 条标题 520→520；同上，提交后复跑）。
- 新增文档人工编码校验（尚未进 tracked 扫描域的部分）→ UTF-8 strict 解码 OK、U+FFFD=0、Windows 绝对路径 0、品牌词 0。
- 行尾与 diff 对账（工作树 tracked 文件；未跟踪的新增测试/文档待提交后进入 diff）：`git diff --numstat` 与 `git diff --ignore-cr-at-eol --numstat` 均为 13 行且逐项相等（Compare-Object 无差异）。
- `check-unwired-tests.js` → rc=0：检查域内 106 个测试文件，`OK: 全部测试均已接线或按欠账登记`。
```

### 遗留（不假装已闭合）

- **供应商侧撤销但本地样本完好**：启动前无法判定（只能判本地样本完整性），仍依赖运行期
  `tryReCloneVoice` 重克隆；重克隆失败才聚合为可操作提示。这是设计边界。
- **启动后、生成前样本被外部删除**：守卫可能已通过，运行期聚合兜底。
- **样本目录有音频但内容损坏**：对账只判「有材料」，不判「可解码」；失败由克隆/合成链路报错。
- **对账扩展名用全局 `ALLOWED_AUDIO_EXTENSIONS`**：比个别 model 的上传白名单宽（详细 PRD §14 R11）。
- **config 页/克隆列表的「已失效，请重新克隆」「设为默认」仍是硬编码中文**：存量 i18n 债务，
  非本刀范围。
- **旧日志 `[object Object]`**（`app.log:30083`）：既有日志取对象未序列化缺陷，未在本刀强制改造。
