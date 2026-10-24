---
record: explainer-artifact-contract-preprod
task: 把「AI 讲解视频」前生产三阶段（research/proposal/script）从散文产出改为上游 artifact 契约 + 机械自检
date: 2026-10-24
---

## 本次执行记录：前生产三阶段的产物契约（explainer-artifact-contract-preprod，2026-10-24）

| 门禁 | 状态 | Fresh 证据 |
|------|------|-----------|
| 变更类型与隔离 | ✅ | 运行时代码（`explainer-stages.js` 拆分 + 新增 `services/explainer/` 4 个模块）+ 测试 + 文档 ⇒ 隔离 worktree `/workspace/mp-worktrees/mp-explainer-artifact-contract-preprod`、裸分支 `explainer-artifact-contract-preprod`，基线 `origin/main = fc57173a`（含 P1 的 14 个 schema） |
| 第一性原因（QM-5 ①） | ✅ | 上游 OpenMontage 的 `animated-explainer.yaml` **本仓早就有了**（`packages/python-backend/.../pipeline/definitions/animated-explainer.yaml`，与上游仅 2 行差异且都在 publish 阶段）⇒ 但桌面 `pipeline-engine.js` **从不读 YAML** ⇒ 它是**装饰品**；三阶段也只是「LLM 出散文」。本片让桌面侧**第一次真的按上游契约产出东西** ⇒ 契约不是新发明的，是**仓内已有但没接线的**那份 |
| 逃逸分析（QM-5 ②） | ✅ | ① **「结构上像」≠「满足契约」**：散文产出的产物**没有任何东西能判它对不对**。② **schema 存在但没被用**：P1 已把 14 个 schema 搬进来，但零调用点 ⇒ 「搬了资产」不等于「校验发生」。③ **假绿面（最险）**：`fillRequired` 按 schema 的 `minItems` 补齐数组元素（实测 `concept_options.minItems=3`）⇒ **LLM 只给 1 个概念也会被补成 3 个** ⇒ 计数自检永远绿。④ **「归一化补齐」与「质量达标」混淆**：补齐是救字段，达标是判质量，混在一起就永远绿。⑤ **审批权错位**：LLM 若能自己写 `approval.status='approved'` ⇒ 「未审批就花钱」的闸门形同虚设。⑥ **顺手改无关行为**：我第一版重写 `callDefaultLlm` 时把「配置类错误不重试」改成了「一律重试」⇒ 既有测试立刻抓到（`callDefaultLlm 配置错误不重试直接失败`） |
| 修复 + 回归保护（QM-5 ④） | ✅ | ① 新增 `services/explainer/explainer-artifacts.js`（归一化 + 计数自检 + schema 校验，422 行）：**schema 驱动**的 `fillRequired`（按 schema 补必填，**不猜字段**）＋ **原始计数快照** `metadata.source_counts`（⇒ 补齐救不了计数自检）＋ `approval.status` **强制 pending** ＋ `metadata.retrieval='model_knowledge'`（口径偏离登记）＋ `metadata.render_runtime_source` 标注 runtime 是缺省还是 LLM 给的。② 新增 `services/explainer/explainer-preprod-stages.js`（三阶段执行器 + 结构化提示词，254 行）。③ 新增 `services/explainer/llm-call.js`：**`callDefaultLlm`/`getDefaultLlmConfig` 的唯一实现**（从原文件**原样搬出**）—— 它同时被 scenes 阶段与三阶段使用 ⇒ 两份真源会漂移。④ `explainer-stages.js` **474 → 352 行**（该文件在「点名还账」名单里、零容差 ⇒ 只能抽模块不能堆）。⑤ **scenes 阶段的输入适配**：`context.script` 从字符串变对象 ⇒ 读 `script.sections[].text`，**并兼容旧字符串形态**（断点续跑的旧 run 上下文仍是字符串）。⑥ 失败语义：④/⑤ 任一不过 ⇒ **fail-closed**（带字段路径与自检 code），**不产出半成品**。⑦ 76 个用例全绿（既有 23 + 新增 53） |
| 防止再次发生（QM-5 ⑤） | ✅ | ① **归一化与自检分层**：归一化只救字段，自检只判质量 ⇒ 代码上分开（`buildXxx` vs `checkXxxCriteria`）。② **原始计数快照**：任何「补齐」都不能让计数判据变绿（这是本片抓到的最险的一个假绿）。③ **schema 驱动而非手写缺省**：唯一真源是 schema ⇒ 不会猜错字段（本次手写缺省时把 `landscape` 当字符串、`selected_concept` 当字符串 ⇒ 产物一律不合法）。④ **审批权隔离**：LLM 只能提方案，不能批 ⇒ `approval.status` 由代码强制 `pending`。⑤ **口径偏离必须登记**：无 web search ⇒ `metadata.retrieval='model_knowledge'`；无单价表 ⇒ 金额 0 + notes「单价未知」⇒ 都写进 PRD §16.7，不默默做。⑥ **共享实现不复制**：`callDefaultLlm` 单点化 ⇒ 三阶段与 scenes 阶段共用同一份。⑦ **既有测试按「改输入不改意图」处置**（下详） |
| 行尾与 diff 对账 | ✅ | 见提交前两口径 numstat 实测（下详） |
| **CI 首轮红（主干级 vs 本 PR 级）** | ✅ 已定案 | ⚠ 首轮 `QG Desktop Shards (2/2)` 红（`Gate Result` 连带红）⇒ **两条失败都在 `title-card-renderer.test.js` 的 `itWithFfmpeg` 用例，形态是「Test timed out in 10000ms」**（我**没碰**该文件）。**按「对照组判据」查**：`main` 同期 30/30 **全绿**、我的分支红 ⇒ **不是主干级存量红** ⇒ 继续定位 ⇒ **根因是「我新增 3 个测试文件 ⇒ vitest 的 `--shard=2/2` 分片重排 ⇒ 把这个渲染用例挪进了更慢的 shard 2」**（实测 shard 2 的文件清单里 `title-card-renderer.test.js` 与我的 3 个新文件同时在内）⇒ 本地跑同一文件 **22/22 全绿**（本机有真 ffmpeg）⇒ 属「**不稳定耗时顶不住通用时限**」，与「测试键里不能含不稳定量」同源（新增即红且判定不确定）⇒ **修法**：把 `itWithFfmpeg` 包装成「统一取 60s 时限」的 `it`（**只放宽时限，不改断言语义、不改 skip 守卫**）⇒ 顺手把这个脆弱点修掉，不留给下一个触发分片重排的人 |
| 接线棘轮 | ✅ | 新增 `explainer-artifacts.test.js` 落在 vitest include 的 `electron/services/**/*.test.js` 白名单内（**无需改 vitest.config.js**）；`scripts/check-unwired-tests.js` 实测 PASS |
| QM-1 打包 / QM-4 视觉 | N/A / N/A | QM-1：本片改的是 `apps/desktop/electron/services/explainer-stages.js` 的**既有文件**（**运行时代码**）⇒ **不适用 N/A** ⇒ 由 CI 的 `build` job（windows-latest + `electron-builder --win --x64`，required check）兜底。QM-4：**零 UI 变化**（无新增控件/文案/i18n 键）⇒ 无视觉面 |
| QM-6 CCG 双模型外部评审 | 未执行 | 本机未见可用的外部评审通道；**如实记为未执行，不以自审冒充通过** |
| 远程同步 | 由门禁推导 | 本行**不需要事后改写**：合并后门禁按主干历史推导归属（`scripts/lib/merge-ledger.js`） |

### 既有测试的处置（逐条：改了什么 / 为什么）

⚠ 依据「**契约变更把既有测试拉红时，先判「我破坏了实现」vs「测试锁的正是我要改的行为」**」：
**7 条既有测试红** ⇒ 逐条判「该场景在新契约下还该成立吗」⇒ **全部属于「输入形态过时」** ⇒ **改输入、保留原意图**：

| 用例 | 改了什么 | 为什么 |
|---|---|---|
| 「用默认 LLM 生成大纲」 | mock 返回「上游 research_brief JSON」（原返回散文大纲）；断言从 `output.toContain('起源')` 改为 `output.data_points[0].claim`（**夹具里 data_points[0].claim 仍设为「起源」⇒ 断言语义不变**） | 产物从字符串变对象 ⇒ 形态变、意图不变 |
| 「用结构化 key 上报开始与完成摘要」 | mock 返回 JSON | 同上 |
| 「未配置默认 LLM 时失败」 | **未改**（异常文案透传保持原样） | ⚠ 我第一版重写 `callDefaultLlm` 改了这条行为 ⇒ 被它抓出来 ⇒ 改为**原样搬出**（见 `llm-call.js`） |
| 「callDefaultLlm 配置错误不重试直接失败」 | **未改**（同因 ⇒ 抽到 `llm-call.js` 后自然恢复） | 同上 |
| 「proposal 依赖 context.research」 | mock 返回 proposal JSON；`context.research` 传**对象形态** | 契约变更 |
| 「script 依赖 context.proposal」 | mock 返回 script JSON；`context.proposal` 传**对象形态** | 契约变更 |
| 「callDefaultLlm 空内容时重试直到拿到非空内容」 | mock 第二次返回 research_brief JSON（原来返回散文「1. 主题：测试大纲」）；断言改为查 JSON 里的 topic | 形态变、意图不变（第二次拿到非空有效内容） |

### 顺带修掉的一个既有脆弱点（分片重排暴露）

`title-card-renderer.test.js` 的真 ffmpeg 渲染用例吃 vitest 的**通用 10s 时限** ⇒
在慢的 shard 上必然超时（本地与其它 shard 都过）⇒ **任何一次「新增测试文件导致分片重排」都会把它点着**。
⇒ 改为 `itWithFfmpeg` 统一取 **60s 时限**（只放宽时限，不改断言、不改 skip 守卫）。
⚠ 这不是「为了让本 PR 变绿而改判据」：判定**仍然完全相同**，只是不再被**机器快慢**决定。

### 新增/修改清单

| 文件 | 动作 | 行数影响 |
|---|---|---|
| `apps/desktop/electron/services/explainer/explainer-artifacts.js` | **新增** | +422 |
| `apps/desktop/electron/services/explainer/explainer-preprod-stages.js` | **新增** | +254 |
| `apps/desktop/electron/services/explainer/llm-call.js` | **新增**（原样搬出 `callDefaultLlm`/`getDefaultLlmConfig`） | +78 |
| `apps/desktop/electron/services/explainer/explainer-artifacts.test.js` | **新增**（53 例） | +约 300 |
| `apps/desktop/electron/services/explainer-stages.js` | 改：三阶段抽出 + 删三个 prompt + exports 转发 + scenes 输入适配 | 474 → 352（**净减 122**） |
| `apps/desktop/electron/services/explainer-stages.test.js` | 改：7 条用例的输入形态（逐条见上） | +约 120 / −约 20 |
| `apps/desktop/electron/services/title-card-renderer.test.js` | 改：`itWithFfmpeg` 包装成统一 60s 时限（**只放宽时限**；因本 PR 新增测试触发 vitest 分片重排，把该渲染用例挪进更慢的 shard 而超时） | +约 10 |
| `01-docs/PRD-video-creation.md` | 改：新增 §16（16.1~16.8） | +约 120 |

## CHANGELOG 条目

# feat(视频创作): AI 讲解视频前生产三阶段改为上游 artifact 契约 —— 研究/方案/脚本三阶段开始机械可判（explainer-artifact-contract-preprod）

- feat(视频创作): 「AI 讲解视频」的 research / proposal / script 三阶段不再产出散文，改为产出**上游 OpenMontage 契约**的 `research_brief` / `proposal_packet` / `script`，逐字段按 schema 校验（错误信息带**字段路径**与被违反的关键字）。
- feat(视频创作): 上游的**计数型**硬指标变成机械判据：研究至少 3 条数据点 / 3 个角度 / 5 条带链接的来源；方案至少 3 个真正不同的概念选项 + 逐项成本 + 选中概念有效引用；脚本总时长与目标偏差 ≤ ±10%。不达标即**失败并指名缺哪一条**（不再产出会带着残缺字段流到下游的半成品）。
- fix(视频创作): **审批权从 LLM 手里收回** —— 方案的 `approval.status` 一律强制为 `pending`，模型无权自称「已批准」（否则「花钱前先让人拍板」这道闸门形同虚设）。
- fix(视频创作): 归一化改为**由 schema 驱动**（按 schema 补必填字段），不再凭想象手写字段缺省；并给**原始计数**留快照 ⇒ 补齐动作不会让计数判据变绿（补齐救字段、判据判质量，两件事分开）。
- fix(视频创作): 口径偏离显式登记：桌面端**没有**通用联网检索 ⇒ 研究来源标注为「模型知识引用（非实时检索）」；本仓**无单价表** ⇒ 成本金额缺省 0 并注明「单价未知」⇒ 不让「0 元」被读成「不要钱」。
- refactor(视频创作): 三阶段的执行器与提示词抽到独立模块，并把 `callDefaultLlm` **收敛为唯一实现**（原先 scenes 阶段与三阶段会各有一份 ⇒ 两份真源必然漂移）；`explainer-stages.js` 净减 122 行（该文件在零容差的点名还账名单里 ⇒ 只能抽模块不能堆）。
- test(视频创作): 新增 53 例（归一化 / schema 合法性 / 计数自检 / 审批闸门 / 口径标注），既有 23 例按「改输入不改意图」适配；「配置类错误不重试」这条既有行为被回归锁住（我第一版顺手改它时被当场抓住，已改回原样）。

## learnings

### lesson: 补齐动作会让「计数型判据」假绿——必须给**原始计数**留快照

**现场**：归一化用「按 schema 补必填字段」实现（schema 驱动、不猜字段，是对的），
但 schema 的 `minItems` 会让**数组元素也被补齐**：实测 `concept_options` 的 `minItems=3`
⇒ LLM 只给了 1 个概念，**归一化把它补成 3 个** ⇒ 计数自检看到 3 个 ⇒ **永远绿**。

**根因**：**补齐（救字段）与达标（判质量）混在了同一个数字上**。
补齐是「让产物合法」，达标是「让产物够好」⇒ 两者必须是**两个量**。

**正解**：归一化时把**LLM 原始给了多少**写进 `metadata.source_counts`，
计数自检**按原始计数判定** ⇒ 补齐救不了它。
⚠ 这条比「不要在归一化里补齐」更实用 —— 因为**有些数组确实必须补**（否则 schema 判红），
真正要防的是「补齐后的数字被当成质量指标」。

### lesson: 手写「字段缺省值」= 凭想象猜 schema（错得离谱且不报错）

**现场**：我照着上游 `research_brief` 的**印象**写了归一化器：
把 `landscape` 当字符串、把 `data_points[].value` 当合法字段、把 `selected_concept` 当字符串
⇒ **三个全错**（真实是 object / additionalProperties:false 不允许 / 是对象）⇒ 产物一律不合法。

**根因**：**上游 schema 就在仓库里**（P1 已逐字搬入）⇒ 手写缺省 = 用猜测替代了**唯一真源**。

**正解**：归一化改成**schema 驱动**——「schema 说缺什么就补什么」：
`fillRequired(value, schema, root)` 递归补 required 字段、按 `minItems` 补数组长度、按 `enum[0]`/`const`/`default`/`minimum` 兜底。
⚠ 配套：**`fillRequired` 要遍历全部 properties**（不只 required）——
非必填但有 `minItems` 的数组（实测 `key_points`）也要递归，否则长度不足 ⇒ schema 判红。

### lesson: 抄/搬一个既有实现时，**不要顺手"优化"它**

**现场**：把三阶段抽到新模块时，我顺手重写了 `callDefaultLlm`：
参数名写成 `maxTokens`（原为 `max_tokens`）、messages 结构改了、**把「配置类错误不重试」改成「一律重试」**。
⇒ 既有测试 `callDefaultLlm 配置错误不重试直接失败` **当场红**（期望调用 1 次，实际 2 次）。

**正解**：把这个函数**原样搬进共享模块**（`llm-call.js`），
scenes 阶段与三阶段都从那里引 ⇒ 既保住行为，又拿到「单一真源」。

**判据**：**改契约时不要顺手改无关行为**。
被搬的函数若与别的阶段共用 ⇒ 它的行为是**别人的契约** ⇒ 原样搬 + 单独抽文件，
而不是「重写一版更漂亮的」。

### lesson: 契约变更后，下游阶段必须做**输入适配**（且兼容旧形态）

**现场**：`context.script` 从字符串变成 `script` 对象 ⇒ 下一个阶段（scenes）读 `context.script` 的方式全变。

**正解**：下游改成读 `script.sections[].text`，**同时保留对旧字符串形态的兼容**
⇒ 断点续跑的旧 run 上下文里仍是字符串 ⇒ 不兼容就会让「从断点继续」直接失败。
⚠ 通用形态：**上游产物形态变更 ⇒ 所有下游消费点都要做「双形态适配」**，否则老 run 全部作废。
