---
record: film-auto-longform-plan
task: 影视工程「自动」模式长篇化改造 · 实施落地方案（PRD）
date: 2026-10-24
branch: film-auto-longform-plan
---

# 影视工程「自动」模式长篇化改造 · 实施落地方案

## 1. 本次产出

新增 `01-docs/PRD-FILM-AUTO-LONGFORM-2026-10-24.md`（896 行）——
把「自动模式能否从剧本文案产出 30 分钟以上短剧成片」的调研结论，转成一份**先文档后代码**的输入件。

docs-only，无代码改动。

## 2. 调研的三个结论

### 2.1 「30 分钟」在入口就被拒

- `apps/desktop/electron/services/film-engineering/auto-plan.js:41` `MAX_AUTO_DURATION_SEC = 600`；
  `:38` `MAX_AUTO_SHOTS = 120`；`:39` `MAX_AUTO_SCRIPT_LENGTH = 10000`。
- 前端镜像 `apps/desktop/src/views/film-auto/auto-constants.js:11-13` 同源（**改一处必须改另一处**）。
- 1800 秒进 `validateAutoInputs`（`auto-plan.js:94-96`）直接返回 `AUTO_BAD_PARAM`。

**容易漏算的一条**：真正更紧的锁是**字数**不是时长。
语速常量 `shot-duration.js:37` `ZH_CHARS_PER_SECOND = { normal: 8, argument: 10, tender: 5 }`（字/秒）
⇒ 30 分钟纯对白 = **14,400 字**（与镜数无关，只与总时长有关）；
含动作描述的剧本量 ≈ 24,000–36,000 字 ⇒ 现有 10,000 字上限**差 2.4–3.6 倍**。
反向看：10,000 字 ÷ 1800 秒 = **5.6 字/秒**，比 `normal` 档慢 30% ⇒ 不抬字数上限，30 分钟成片的台词密度就低到近乎静场。

### 2.2 仓里唯一 30 分钟+ 的能力不是「从剧本生成」

`01-docs/PRD-FILM-FULL-CORPUS-PRODUCTION-2026-09-23.md:15`：6,558 镜 / 95.1 分钟 / 146 批 / ~51GB，
但它是**把一部既有参考片重新生成一遍**（逐批确认），不是从新剧本文案生成。
随包 kit 实测只有 **153 镜**（`apps/desktop/electron/film-kit/shot-library.json`）。

### 2.3 即便在 10 分钟能力内，它也不是「自动跑到成片」

- 收口合成要人点一次按钮（`apps/desktop/src/views/film-auto/useFilmAutoRun.js:253-280`）；
- 提示词是「参考片模板 + 你的文案」拼接（`auto-plan.js:249` `templates[i % templates.length]`），
  且 LLM 已整体下线（`film-engineering-stages.js:126-131`）。

## 3. 任务前提的一次修正：音轨交给视频模型

任务给定的产品前提是「对白和声音交给视频生成模型统一完成」。
据此**复核了原判断中「音轨层缺失」一条**，结论是**该条不作为缺口**（不单独做 TTS/旁白/BGM）。
但复核过程中**翻出两条此前未发现的事实**，它们改变了方案的形态：

| # | 事实 | 取证 | 影响 |
|---|---|---|---|
| **F-1** | **9 个视频适配器全部没有任何 audio / dialogue / speech / voice 参数** | `apps/desktop/electron/services/adapters/` 下 `agnes-video / cogvideo / ltx / seedance / veo / kling / grok-video / wan / runway` 逐个 grep，命中数**全为 0** | 「对白由视频模型产出」要么是 provider **隐式**产出，要么**前提不成立**（当前链路出哑片）⇒ 列为 **M0 门** |
| **F-2** | **只有 2/9 个适配器消费应用下发的镜长** | 同上 grep `numFrames/width/height`：`agnes-video` 4/4、`ltx` 3/4、**其余 7 个全为 0**。`seedance.js:113-116` body 仅 `{model, prompt}`；`veo.js:117-122` 仅 `{instances, parameters.sampleCount}` | 镜长由 provider 默认决定 ⇒ 「台词-镜长契约」**必须分两档实现**（可控 ⇒ 严格档；不可控 ⇒ 强制拆镜档） |

另有一处**与 C3 前提直接冲突**的既有规则：
`script-adapt.js:100-104` 把 `AUDIO` 块归为静态类 ⇒ 被 `buildMotionPrompt` 剔除。
而实测 153 个模板里 **24 个带 `AUDIO` 块** ⇒ 在「音频语义归视频模型」的前提下，
这恰恰是**最该给模型的语义却被剔掉了**。已列为 R4.2（仅作用于自动模式入口，不动既有画布/工程案例语义）。

## 4. 方案形态

七层能力分层（时长规模 / 内容密度 / 台词-镜长 / 叙事结构 / 角色声画 / 提示词质量 / 经济性治理）
⇒ **五层缺位或只到一半**。据此排了 12 条需求（R1–R12）与 7 个里程碑（M0–M6）。

关键设计决定：

1. **M0 是门**：三个前置取证（F-1 音轨能力 / F-2 镜长可控性 / F-3 出片成功路径）不过 ⇒ 全案不动。
   理由：上游 PRD 自列 G8「出片成功路径未验证」——`plan → start → ledger → manifest → final.mp4` 从未成功产出过，
   在未跑通的链路上叠加工期是拿一个未证实的假设做优化。
2. **M1 把「放开规模」与「接限流」放同一个里程碑**：先放开门槛再补限流，中间任何一天都可能把运营配的服务商额度打满。
3. **M1 与 M2 不可颠倒**：先放开规模再补台词契约 = 先造出一堆念不完的镜头。
4. **新逻辑一律进新文件**：`auto-plan.js` / `auto-runner.js` / `script-adapt.js` 都在逐文件行数门禁视野内。
5. **每条验收都写成「能红的断言」**，不接受恒真断言。
6. **音轨层不建**（含不做字幕），只在 R10.2 保留「若后续要字幕，可复用 `story2video-compose-engine.js:589+` 的 drawtext 烧录」。

## 5. 判据

docs-only，无代码改动。保留门禁本地实跑结果：

| 门禁 | 结果 |
|---|---|
| `classify-docs-only` | docs-only=true（`01-docs/**` 在白名单内） |
| 行尾对账 | 两口径一致（896 / 0，两次 numstat 相同） |
| 品牌残留 `node scripts/check-no-brand-residue.js` | PASS（扫描 12,305 个 tracked 文件） |
| 编码完整性 | `grep -c $'\xef\xbf\xbd'` = 0 |
| 文档绝对路径 | 无命中 |
| `check-docs-sync` | 无代码变更 ⇒ 文档同步门禁不触发（PRD_PATTERN 命中 `01-docs/`） |

## 6. 遗留（不在本 PR 范围）

- M0 的三个取证需在**有可用视频 provider** 的环境下跑；开发机默认模型无通道（上游 G8 的原委）。
- 本 PR 只落**方案**，不落任何代码。代码落地按 M0 → M6 逐里程碑独立 PR。
- 上游 `01-docs/PRD-FILM-AUTO-MODE-2026-10-09.md` 的 §14.7（G5/G8）与 §14.8（清单式而非金额报价）
  将被本方案 R8.6 / R11.1 修订，**修订在对应里程碑的 PR 里做**，本 PR 不动上游 PRD。

## 远程同步

| 远程同步 | 由门禁推导 |
| --- | --- |

- 保留门禁：行尾对账 ✅ | 品牌残留 ✅ | 文档同步 ✅ | 远程同步（本 PR）

## CHANGELOG 条目

# docs(film): 新增影视工程「自动」模式长篇化改造实施落地方案（film-auto-longform-plan）

- 新增 `01-docs/PRD-FILM-AUTO-LONGFORM-2026-10-24.md`：把「自动模式能否从剧本文案产出 30 分钟以上短剧成片」的调研结论，转成可执行的落地方案（12 条需求 + 7 个里程碑 + 22 条可断言验收 + 8 条风险登记）。
- 结论：**当前不具备**该能力 —— 目标时长被硬编码在 600 秒（10 分钟），1800 秒在输入校验阶段即被拒；仓库里唯一 30 分钟以上的成片路径是「重生成一部既有参考片」，不是从新剧本文案生成。
- 方案给出三个**必须先做的前置取证**并设为门禁：视频 Provider 是否真的产出对白音轨（实测 9 个适配器**无任何** audio 参数）、是否接受应用下发的镜长（实测**只有 2/9** 消费 `numFrames`）、以及出片成功路径首次真机跑通。
- 明确音轨不单建（对白与声音交给视频生成模型统一完成），但由此把「台词长度 vs 镜长」与「提示词结构化台词」提升为核心需求，并修正一处既有规则冲突：模板的音频语义块此前被当作静态内容从视频提示词中剔除。
