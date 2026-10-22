---
record: review-brief-pr3
task: PR-3 决策层评审 —— F-I 任务级提示词接入规划 + F-H 方法论分区补全
date: 2026-10-21
---
# PR-3 评审简报（决策层 · v8）
> **版本轨迹**：v1 初稿 → v2 第 1 轮 → v3 第 2 轮 → v4 第 3 轮 → v5 第 4/5/6 轮 →
> **v6** 第 7 轮（简报重构：历史处置表移出 + FINAL 口径 + 速查附录）→
> **v7** 第 8 轮 + 第 9 轮（哈希改名 / 域限定 / 截断前指纹 / kit 长度上限 /
> 分类判据 / 面板在重开项目时也可见 / 行标签不复用 / 聚合提示按 reason 分流 / 文案不指向不存在的入口）→
> **v8（本稿）** 第 10/11/12/13 轮（第五类 `oversizeVar` / 三处计数同源机器断言 / 哈希域分层 /
> 长度上限常量落表 / 原文出现次数 == 0 / `geo_block` 恒空 / 单镜落盘体积口径改真 /
> 变量名封顶 + 剥控制字符 / 重开时重算哈希检出「资产已变」/ `stale` 三态 / 五类统一）。
> 各轮处置索引见 `ccg-plan-review-record-pr3.md`（第 10-13 轮亦在其中）。
> **各轮逐条处置在 `ccg-plan-review-record-pr3.md`**（那是公开记录，也是历史的**唯一存放处**）。
>
> **v6 为什么重构**：第 7 轮 i1/i4 指出「简报里的历史处置表带着陈旧的计数与旧字段名，
> 实施时会被照着写」。⇒ **历史处置表整体移出本简报**，本简报只留**当前口径**；
> 评审对象里不该有「给人看的历史」—— 引擎也给了同一条建议
> （「去掉方案里对 reviewer 无用的内容（如历史修订轨迹、意见对应表）」）。
## 〇、**FINAL 口径**（实施照这一份；与本文其余章节冲突时以本节为准）
| 项 | **最终值** |
|----|-----------|
| i18n key 数 | **27 个**（zh/en 各 27）—— 清单见 §四末；**分解：`doctrine` 7（1-7）+ `auto.methodology*` 13（8-20）+ `auto.methodologyReason*` 5（21-25）+ 其余 2（26-27：资产已变 / 清单已截断）= 27** |
| **提示词资产面**哈希 | `promptContext.promptAssetHash`（plan 级）—— sha256，**长度前缀**拼接（`len:key=len:value`）。**域 = doctrine + 任务模板 + locale + 回退事实**；**不含**色盘/角色/时长（那些由逐镜哈希覆盖）——第 8 轮 i1 |
| 逐镜渲染哈希 | `shot.promptRenderHash`（逐镜）—— sha256，覆盖**键名排序**的逐镜 vars + locale + **缺失清单**（`name + reason` 的规范形式，第 14 轮 i2：否则「变量超限」与「变量没有」同哈希；**含**色盘行与角色描述；`shot_json` **内部**的键序另由固定键序保证） |
| 资产不完整标记 | `promptContext.assetsIncomplete`（plan 级、持久化）—— **只覆盖 kit 结构性缺失**（缺 doctrine / 缺 promptLibrary ⇒ W10/W11） |
| 尾帧约束 | `promptContext.frameConstraint` = `{hash, length, locale, fallback, truncated, source, originalHash, originalLength}`（`source` 取值闭集：当前只有 `doctrine.frame_constraint`） —— **只留哈希与长度，不留原文**；`hash`/`length` 描述**截断后**文本，`originalHash`/`originalLength` 描述**截断前**（第 8 轮 i2） |
| 逐镜尾帧文本 | `shot.endFramePrompt` **仍为 `''`**（逐镜派生要 LLM，本批次不可达）⇒ 留空即「不发送」 |
| 尾帧待派生标记 | `promptContext.frameConstraintPending`（plan 级，恒为 `true`）—— 面板据此显示「规则已接入、逐镜待派生」 |
| `promptContext.locale` | **请求语种**：调用方传入（规划链路上来自 IPC 的 `params.locale` = 界面语言）；**非法值回落 `zh`**（实现：`o.locale === "en" ? "en" : "zh"`）。**kit 与项目设置都不参与优先级** —— locale 只由调用方决定（它同时进两个哈希并驱动 `fallbackLocales`，取值不定则哈希不可复现） |
| `frameConstraint.locale` | **实际取到的语种**：doctrine 缺该语种时**回落 `zh`** ⇒ 它可以**不同于**请求语种（这正是 `fallbackLocales` 要记的事）。**哈希用请求语种**（`promptAssetHash` 的 `locale` 项）⇒ 面板按**实际语种**取文案、哈希按**请求语种**算，两者**各司其职**（第 14 轮 i5） |
| 7 个任务变量 | `shot_json` / `palette_line` / `style_prefix` / `geo_block` / `character_descriptors` / `duration_sec` / `model` |
| **「命中」的准确定义** | 变量**提供了非空字符串**才算命中（实现：`typeof vars[n] === "string" && vars[n] !== ""`）。⚠ 三种「不命中」形态各不相同：`byDesign` 与 `oversizeVar`（**不提供** ⇒ 保留占位符）、`assetMissing`（**提供空串** ⇒ 渲染为空）⇒ 面板的 `N/7` 里那个 N 只数**真正填上了**的变量 |
| 缺失**五**分类 | `byDesign` / `assetMissing` / `templateVar` / `badVarName` / **`oversizeVar`**（**全篇只有这一套枚举** —— 第 11/12 轮 i2/i1）；每类有独立 i18n 文案（`methodologyReason*` 5 个，与之一一对应） |
| `shot_json` 键序 | **`index` → `shotId` → `title` → `beatIndex` → `characterNames` → `model`**（实现已固定；键序变 ⇒ 哈希变） |
| 旧字段名 | `sourceHash` / `blockedExport` / `assetHash` **已废弃**（第 4/8 轮改名为 `promptAssetHash`+`promptRenderHash` / `assetsIncomplete` / `promptAssetHash`）⇒ 实现代码零残留，有回归锁 |
| **长度上限常量** | `MAX_END_FRAME_LEN` = **50,000**（尾帧原文，超限截断且出声）｜`MAX_KIT_VAR_LEN` = **20,000**（`palette_line` / `character_descriptors`，超限**不提供**）｜`MAX_SHOT_FIELD_LEN` = **2,000**（`shot_json` 的 `title`/`characterNames`/`model`，超限**不提供**）｜`MAX_MISSING_NAME_LEN` = **64**（清单里的变量名，超限截断） |
| **单镜落盘体积** | `promptVars` + `promptMissing` 序列化 **≤ 256 KiB**（= `palette_line` ≤ 20,000 字符 + `character_descriptors` **合计** ≤ 20,000 字符 + `shot_json` 的 6 个字段各 ≤ 2,000 + 余量；**正常资产下远小于此** —— 真实色盘行约 50 字符）。⚠ 旧写法「每镜 ≤ 1KB（不含长文本）」与「`promptVars` 含至多 2 万字符的 kit 文本」**自相矛盾**，已删 |
**范围**：只动影视工程「自动」标签这条链上的**只读 / 纯计算**接线（F-I）+ 「项目案例」标签的**只读**展示补全（F-H）。
**依赖**：PR-2（#4127，已合并 `05e83ddf1`）—— 三分字段存在后，F-I 才能把方法论接到每镜上。
**不在本 PR**：F-J 资产导入（**写路径**，拆到 PR-3b，理由见 design D19）。
**改动量（**实测**，不含 F-J 写路径）**：运行时源码 ≈ **1,010 行**（`shot-prompt-*` **六个模块** + `auto-plan.js` + `film-engineering-auto.js` + `film-engineering-auto-projection.js` + `film-engineering-service.js` + `auto-project.js`）、前端 ≈ **130 行**（`FilmEngineeringView.vue` 两个只读分区 + `FilmAutoPanel.vue` + `MethodologyStatusPanel.vue` + 两个样式文件）、i18n **27 个 key**（zh/en 各 27，**逐条列在 §四末并带自检断言**）、测试 ≈ **2,730 行**（**8 个测试文件**：新增 `shot-prompt-task.test.js`、`film-engineering-methodology.test.js`；既有追加 `auto-plan.test.js`、`auto-project.test.js`、`film-engineering-auto.test.js`、`FilmAutoPanel.test.js`；渲染侧 `FilmEngineeringView` 渲染测试 —— 共 **43 条**验收断言）、文档 ≈ **1,600 行**（简报 + 评审记录 + PRD 七节 + design D23）。

> ⚠ **2026-10-22 的模块拆分**（决策层范围声明随之更新）：本 PR 的实现最初是
> `shot-prompt-task.js` 一个文件（656 行）+ `film-engineering-auto.js`（538 行）+ `FilmAutoPanel.vue`（513 行），
> 三者都**超过本仓 500 行/文件的门禁**（`check-max-lines.js` 的 `NEW_OVER_LIMIT`）⇒ **按职责拆分**：
> `shot-prompt-task.js` → `shot-prompt-{contract,locale,hash,sanitize,render,context}.js`（六个模块，
> **主文件继续导出全部对外符号** ⇒ 消费方 import 不变）；
> `film-engineering-auto.js` → 抽出 `film-engineering-auto-projection.js`（只读投影）；
> `FilmAutoPanel.vue` → 抽出 `MethodologyStatusPanel.vue`（方法论接入状态区块）。
> 拆分**不改变任何行为**（对外导出面逐项相等、导出面 26 项未变），且顺手堵上一个漏洞：
> 「陈旧字段名回归锁」原先扫的是**写死的 7 个文件名** ⇒ 拆出来的新文件不在覆盖内 ⇒ 已改成**按目录 glob**。

**本次改动的完整文件清单**（决策层范围声明 —— 与上面的实测改动量逐条对应）：

| 类别 | 文件 |
|------|------|
| 新增（运行时·提示词装配） | `apps/desktop/electron/services/film-engineering/shot-prompt-task.js`、`shot-prompt-contract.js`、`shot-prompt-locale.js`、`shot-prompt-hash.js`、`shot-prompt-sanitize.js`、`shot-prompt-render.js`、`shot-prompt-context.js` |
| 新增（运行时·只读投影） | `apps/desktop/electron/ipc-handlers/film-engineering-auto-projection.js` |
| 新增（前端） | `apps/desktop/src/views/film-auto/MethodologyStatusPanel.vue`、`apps/desktop/src/views/film-auto/methodology-status-panel.css` |
| 新增（测试） | `apps/desktop/electron/services/film-engineering/shot-prompt-task.test.js`、`apps/desktop/src/views/film-engineering-methodology.test.js` |
| 改动（运行时） | `apps/desktop/electron/services/film-engineering/auto-plan.js`、`apps/desktop/electron/services/film-engineering/auto-project.js`、`apps/desktop/electron/services/film-engineering/film-engineering-service.js`、`apps/desktop/electron/ipc-handlers/film-engineering-auto.js` |
| 改动（测试） | `apps/desktop/electron/services/film-engineering/auto-plan.test.js`、`apps/desktop/electron/services/film-engineering/auto-project.test.js`、`apps/desktop/electron/ipc-handlers/film-engineering-auto.test.js`、`apps/desktop/src/views/film-auto/FilmAutoPanel.test.js` |
| 改动（前端） | `apps/desktop/src/views/film-auto/FilmAutoPanel.vue`、`apps/desktop/src/views/film-auto/film-auto-panel.css`、`apps/desktop/src/views/FilmEngineeringView.vue` |
| 改动（i18n） | `apps/desktop/src/locales/film-engineering/zh.js`、`apps/desktop/src/locales/film-engineering/en.js` |
| 改动（文档） | `01-docs/PRD-FILM-PIPELINE-V2-2026-10-21.md`、`openspec/changes/film-pipeline-prompt-triple-and-guards/proposal.md`、`openspec/changes/film-pipeline-prompt-triple-and-guards/design.md`、`openspec/changes/film-pipeline-prompt-triple-and-guards/tasks.md`、`openspec/changes/film-pipeline-prompt-triple-and-guards/review-brief-pr3.md`、`openspec/changes/film-pipeline-prompt-triple-and-guards/ccg-plan-review-record-pr3.md`、`openspec/records/film-prompt-triple-impl3.md` |

> ⚠ `.ccg/reviews/*.json` 是**评审判定记录**（内容寻址 = 暂存 diff 的 sha256），由 `pre-commit` 自动生成并 stage 进同一提交 ⇒ **文件名含哈希、无法在方案里预先声明** ⇒ 范围漂移告警里必然出现它，属**已知且无害**的形态。

> ⚠ 早期版本写的是「~260 / ~140 / ~330 行」——那是**实施前的估计**，实施后明显偏小 ⇒ 改为**实测值**（第 17 轮 i8：估计与实际不匹配，容易被当成承诺）。
## 一、方案原文的三处口径，实施期实测推翻（design D18）
| # | 方案原文 | 实测 | 处置 |
|---|---------|------|------|
| 1 | F-H：「方法论标签页目前仍按 7 块渲染」 | 视图（`FilmEngineeringView.vue:179-202`）已是 `v-for="b in doctrine.blocks"` ⇒ **11 块全渲**，另有 `rules`(14) 与 `glossary`(10)。数据里还有 `recipes`(2) / `failureLedger`(8) **未渲染** | F-H 收窄为**补两个只读分区** |
| 2 | F-I：「规划期用 `generate_shot_prompt` 任务模板」 | 该模板是 **LLM 任务**（system 规定 7 块结构、要求模型输出 JSON）；而 `planAutoShots` 的契约是「**零 provider 调用、零落盘**」；成本闸（F-B）在 PR-5 才落地 | 本 PR **不调 LLM**：改为「把方法论接到每镜 + 只读接入状态面板」 |
| 3 | F-J：「导入 IPC 未启用」 | 产品里**没有导入入口**：`userData/film-kit` 只被读（`container.setup.js:463`），**没有任何代码写它** ⇒ 两级回退链首级是死代码 | F-J 拆 **PR-3b**（新增写路径，需独立安全评审） |
## 二、落地形态
### F-I-1 尾帧约束：plan 级存一次，**逐镜不复制长文本**
**来源决定**：**只用 doctrine 的 `frame_constraint` 块**。
理由：`generate_shot_prompt` 的尾帧铁律要 **LLM 才产出**，而本 PR 零 provider ⇒ 那条路径**不可达**；两条都写会得到「一个来源、两个真相」。
**为什么 plan 级而不是逐镜（第 3 轮 i1 · Critical）**：`frame_constraint` 是**逐镜相同**的方法论原文（实测 505 字符），
逐镜各存一份 ⇒ 同一段文本复制 N 份，项目文件随镜数线性膨胀 ⇒ 与「同一段文本不逐镜复制」原则自相矛盾
（`system`/`user` 已经这么处理过，逐镜字段只存引用与标记）。
| 内容 | 落点 | 说明 |
|------|------|------|
| **威胁模型**（第 14 轮 i7 · security） | — | D22 要防的是**用户项目文件**这一条面（它会随分享/备份/日志流出）。**① 方法论原文**（doctrine 块文本、任务模板 system/user）**一律不落盘**，只落哈希与长度 —— 它经 IPC 回到渲染端是**既有行为**（渲染端本来就要看到渲染结果），**不落盘**才是这条面的关键。**② `promptVars` 落盘**的是**解析后的变量值**（色盘行、角色描述、逐镜字段）—— 它们**不是**方法论原文（原文是 doctrine/任务模板），且都受**长度上限**约束 ⇒ 两者**不是同一份内容**，待遇不同**不矛盾** |
| `promptContext.frameConstraint` = `{ hash, length, locale, fallback, truncated, source, originalHash, originalLength }` | **plan 级项目文件** | **只留哈希与长度，不留原文**（design D22：方法论原文属提示词资产，落进用户项目文件会多出一条外发/日志面；原文本来就在用户本地的 kit 里，需要时按 kit 读）。`hash`/`length` 取**截断后**文本，`originalHash`/`originalLength` 取**截断前**（第 8 轮 i2：否则截断点之后的改动**不可见**） |
| `shot.endFramePrompt` | **逐镜** | **仍为 `''`**（F-A 口径不变）—— 本批次**无法逐镜派生**尾帧文本（要 LLM），留空即「不发送」⇒ 不会把规则原文当正文喂给模型 |
| `promptContext.frameConstraintPending` = `true` | plan 级 | **如实标注**「尾帧规则已接入，逐镜派生待 LLM（后续 PR）」 |
**字段契约**：`frameConstraint.hash` 为 sha256、`length` 为字符数，上限 **50,000 字符**（本模块的 `MAX_END_FRAME_LEN` 与 kit-loader 的 `FILM_PROMPT_MAX_LEN` **同值同源** —— 仓内 `film-debrand.test.js` ⑤ 已机械校验这两处相等；本简报不再用第二个名字）（**不放宽**，超长截断并 `truncated=true`）、
locale 取 doctrine 的 `zh`/`en`、**缺该语种回退 zh**（回退记进 `promptContext.fallbackLocales.doctrine`）。
与 `imagePrompt`/`videoPrompt` **不拼接**（F-A 规格：尾帧只产出不消费）。
### F-I-2 每镜接任务模板渲染 + 只读接入状态面板
**渲染**：`getTaskPrompts(library, 'generate_shot_prompt', locale)` 取 `system`（7 块结构契约）与 `user` 原文；
`renderTemplate(user, vars)` 出渲染文本 + `missing` + `unknownVars`。
> **取证（第 17 轮 i6 补 file:line）**：`renderTemplate` 确实返回 `unknownVars`（`apps/desktop/electron/services/film-engineering/prompt-library.js:238`：`provided.filter(k => !VAR_NAME_RE.test(k))`）与 `missing`（同文件 `:241-246`）；`getTaskPrompts(library, id, locale)` 的签名是 `(library, taskId, locale)`（同文件 `:218` 附近的 `getTaskPrompts`）。
> ⚠ 模板变量名正则只认 `[a-z][a-z0-9_]*`（`:241`）⇒ **含大写或非字母数字的名字根本不会进清单**（它们在渲染文本里原样留着）。
**7 个变量与实测来源**：
| 变量 | 来源 | 可填性 |
|------|------|--------|
| `shot_json` | 本镜记录（**固定键序**：`index` → `shotId` → `title` → `beatIndex` → `characterNames` → `model`，**实现已固定**） | ✅ |
| `palette_line` | `kit.palette.paletteLine`（{zh,en}） | ✅ |
| `style_prefix` | **无资产源**（doctrine `style` 块是「规则描述」，`16:9. 12s.` 是**示例值**） | ⚠️ **byDesign 不填** |
| `geo_block` | **本批次不取**（**不从任何模板取 GEO 块** —— 跨模板取块的选取规则未定义） | ⚠️ **byDesign**（第 17 轮 i3 改判：原归 `assetMissing` 会说成「资产里没有」，与事实不符 —— 缺的不是资产，是**我们决定不取**） |
| `character_descriptors` | `film-manifest.filmMeta.characters[].descriptor` | ✅ |
| `duration_sec` | 逐镜时长链（`durationSec`） | ✅ |
| `model` | 本镜 `model` | ✅ |
**缺失必须行为可区分**：
**分类判据（第 9 轮 i3 补、第 19 轮 i5 补齐五条）**：
> ① **`byDesign`** = **产品里没有这个资产的形态**，或**本批次决定不取** ⇒ 不提供 ⇒ 渲染**保留占位符**。
>   例：`style_prefix`（doctrine 的 `style` 块是规则描述、示例值不是可粘贴的资产）、`geo_block`（跨模板取块的选取规则未定义 ⇒ 本批次不取）。
> ② **`assetMissing`** = **有资产形态、当前取不到** ⇒ **提供空串** ⇒ 渲染**不留占位符**（渲染为空）。
>   例：kit 里没有色盘行 / 没有角色描述。
> ③ **`templateVar`** = **模板要、我们没给** ⇒ 不提供 ⇒ 渲染**保留占位符**。
> ④ **`badVarName`** = **我们给的名字不合规**（`renderTemplate.unknownVars`）⇒ 视为**实现缺陷**，拦住直送。
> ⑤ **`oversizeVar`** = **资产太大**（超长度上限）⇒ **不提供**（**不静默截断**）⇒ 渲染**保留占位符**。
>
> **原分类判据（第 9 轮 i3 补
- **`byDesign`** = **产品里没有这个资产的形态**（不是「还没提供」，是「压根没有这种资产」）
  ⇒ `style_prefix`：doctrine 的 `style` 块是**规则描述**，`16:9. 12s.` 是**示例值**，不是可粘贴的资产。
- **`assetMissing`** = **有资产形态，但当前资产里没有它**
  ⇒ `geo_block`：**byDesign**（第 17 轮 i3 改判）—— 跨模板取 GEO 块的**选取规则未定义** ⇒ 本批次**不取**；
    缺的不是资产，是「**我们决定不取**」⇒ 说成 `assetMissing`（「资产里没有」）与事实不符。
| 类别 | 含义 | 渲染文本 | 清单 | 机器可判字段 |
|------|------|---------|------|-------------|
| `byDesign` | **设计上不填**（`style_prefix`）/ **本批次不取**（`geo_block`） | 保留 `{{var}}` **原样**（不提供该变量） | 进 `missing` | `deliverable = false`，`blockedVars` 含该项 |
| `assetMissing` | **资产缺口**（色盘行 / 角色描述取不到时） | 渲染为**空串**（提供空值 ⇒ 不留占位符） | 进 `missing` | `deliverable = false`，`blockedVars` 含该项 |
| `templateVar` | 模板要但我们没给的变量（`renderTemplate.missing`） | 保留 `{{var}}` 原样 | 进 `missing` | 同上 |
| `badVarName` | 我们给的变量名不合规（`renderTemplate.unknownVars`） | —— | 进 `missing` | 同上（并视为实现缺陷） |
| `oversizeVar` | **变量内容超长**（色盘行 / 角色描述 / 逐镜字段超上限） | ——（**不提供**该变量 ⇒ 模板里留着 `{{var}}`） | 进 `missing` | 同上（**不静默截断**） |
> **第五类 `oversizeVar` 的来由**（第 10 轮 i4）：前四类回答的是「这个变量**是什么**」，
> 而「太大」是另一回事 —— 混进 `assetMissing` 会让面板显示「资产缺口（该资产尚未提供）」，
> 而事实是「资产**有**，但太大，装不进提示词」。⇒ 独立一类，面板有独立文案。
**五类的唯一信号矩阵（第 8 轮 i5 / 第 11 轮 i2 / 第 13 轮 i2 的处置）** ——
critic 指「四类的机器可判字段列完全一样，只靠 reason 区分」。**采纳**这一半（补矩阵），
**驳回**另一半（「只靠 reason 区分」不成立：渲染行为本来就不同，且已有判据锁住）：
| 类别 | `reason` 枚举 | `renderText` 里 `{{var}}` | `deliverable` | 谁提出的 |
|------|-------------|------------------------|--------------|---------|
| `byDesign` | `byDesign` | **保留** | false | **我们**决定不填 / 本批次不取 |
| `assetMissing` | `assetMissing` | **不留**（渲染空串） | false | 资产里没有（取不到） |
| `templateVar` | `templateVar` | **保留** | false | **模板**要，我们没给 |
| `badVarName` | `badVarName` | 不影响（模板里没这个变量） | false | **实现缺陷**（我们给错了名字） |
| `oversizeVar` | `oversizeVar` | **保留**（不提供 ⇒ 模板里留着） | false | **资产太大**，装不进提示词 |
⇒ **如实说（第 15 轮 i1 更正）**：`byDesign` / `templateVar` / `oversizeVar` 三类的
>   **占位符状态与 `deliverable` 完全相同** ⇒ 它们**只能靠 `reason` 区分**；
>   **真正有渲染行为差异的只有 `assetMissing`**（不留占位符）与 `badVarName`（不影响渲染）。
>   ⇒ **「唯一信号 = reason × 占位符 × deliverable」这个说法对那三类不成立**，已删。
>   用户侧不靠猜：面板**逐变量显示 reason 的独立文案**（5 个 `methodologyReason*` key）⇒ reason 就是用户的判别依据。
> ⚠ 本矩阵是**五类**（第 11 轮加了 `oversizeVar`）—— 第 13 轮抓到「矩阵标题与附录 E 仍写四类」，**同一份文档里分类数不一致** ⇒ 已全篇统一为五类，并加断言「`reason` 枚举条数 == 5」。
`byDesign` 与 `assetMissing` 的占位符行为**相反**（保留 vs 空串）⇒ 消费方可据此分流，不必猜。
**`badVarName` 为什么仍进 `missing`（驳回 critic 的「移出 missing」）**：
`missing` 是**逐镜落盘**的清单，而面板的 `blockedVars` 与 `deliverable`
**就是**从它汇总的（`film-engineering-auto.js` 的 `buildMethodologySummary`）。
把 `badVarName` 移出 ⇒ `deliverable` 会误报为 `true`（实现缺陷被当成没缺变量）⇒ **不能移**。
它的「实现缺陷」语义由 **i18n 文案**承担（`methodologyReasonBadVarName` = 「变量名不合法（实现缺陷）」）。
⇒ 消费方（未来的 LLM 接入）**必须**先校验 `deliverable === true` 才可直送；本 PR 用**测试锁死该字段**。
**持久化口径**（第 3 轮 i1/i2 收敛后的定稿）：
| 内容 | 落点 | 理由 |
|------|------|------|
| `promptContext` = `{ taskId, taskAvailable, locale, promptAssetHash, frameConstraint, frameConstraintPending, fallbackLocales, assetsIncomplete }` | **plan 级项目文件** | 方法论元数据**只存一次**；`fallbackLocales` **按来源分组**（`{doctrine:{}, palette:{}, task:{}}`）⇒ 消费方分得清哪一处回退；**不含任何方法论原文**（`frameConstraint` 只留哈希与长度 —— design D22） |
| `promptVars` + `promptMissing` + `promptRenderHash` | **逐镜项目文件** | 单镜 `promptVars` + `promptMissing` 序列化 **≤ 256 KiB**（= `palette_line` ≤ 20,000 字符 + `character_descriptors` **合计** ≤ 20,000 字符 + `shot_json` 的 6 个字段各 ≤ 2,000 + 余量；**正常资产下远小于此**）。⚠ **清单**（`promptMissing` 单独）的上限是 **8 KiB**，见附录 B —— **两个对象、两个上限** |
| `renderText` | **仅规划结果**（IPC 返回值，不落盘） | 可由 `vars` + 同版本库重渲染，存它是重复 |
| `deliverable` + `blockedVars` | **仅规划结果**（不落盘），但**可从落盘的 `promptMissing` 重算** | 重算公式（`buildMethodologySummary`，主进程**唯一一份**实现）：`deliverable = (汇总后的 missing 条数 === 0)`；`blockedVars = [{name, reason}]`（按 `promptMissing[].name + .reason` 去重汇总）。⇒ **重开项目时**面板仍有数据源（第 9 轮 i4） |
| `system` / `user` 原文 | **不落** | 按 `taskId` 引用库 |
**确定性分两级（第 4 轮 i2 · Critical）**：
| 哈希 | 覆盖 | 回答什么 | 落点 |
|------|------|---------|------|
| `promptAssetHash` | 资产面：doctrine + 任务 system/user 原文 + locale + 回退事实 | 「**资产**变没变」 | plan 级 |
| `promptRenderHash` | 渲染面：**键名排序**的逐镜 vars + locale + **缺失清单**（`name + reason` 的规范形式，第 14 轮 i2：否则「变量超限」与「变量没有」同哈希） | 「**这一镜**的渲染变没变」 | 逐镜 |
- **两者不能合并**：同一资产的**不同镜**渲染本就不同（逐镜 vars 不同）⇒
  「资产哈希相同 ⇒ 渲染逐字相同」是**假命题**；逐镜相等只能靠 `promptRenderHash`。
- 拼接一律**长度前缀**（`len:key=len:value`）⇒ 杜绝 `a=bc` 与 `ab=c` 的碰撞。
- `shot_json` **固定键序**（上表已列确切顺序）⇒ 同一镜的序列化稳定。
- `v1` 是**序列化版本号**：改键序/字段时 +1 ⇒ 旧哈希不会与新哈希混淆。
- **回退事实的单一真源**（第 10 轮 i8）：`promptContext.fallbackLocales`（按来源分组）是**唯一真源**；
  `frameConstraint.fallback` 是它的**派生只读镜像**（便于内联读取）⇒ 两者一致，**不构成第二份事实**。
- ⇒ 续跑时用**同一 kit + 同一 locale**（`promptAssetHash` 与 `promptRenderHash` 都相同）⇒ 重渲染**逐字相同**；
  哈希变了 ⇒ 资产或语种变了 ⇒ 必须重渲染并**显式记录**。
**篡改可检测性契约（第 7 轮 i3 · Critical/security；第 8 轮 i1 修正域）**：
- `promptAssetHash` 吃的是**完整 doctrine 原文**（**不截断**）⇒ 它的**每一个输入**（doctrine 原文 / 任务 system / 任务 user）被改动 ⇒ 哈希必变
  ⇒ **提示词资产被换掉时，重算的 `promptAssetHash` 与 plan 级存的不一致** ⇒ 消费方据此**拒绝直送**。
  这条落成可执行断言（见 §四 ⑬）。
- **⚠ 它的域是有边界的（第 8 轮 i1 · Critical/consistency）**：
  `promptAssetHash` 覆盖的是**提示词资产**（doctrine + 任务模板），
  **不覆盖**色盘行、角色描述、逐镜时长/模型 —— 那些是**逐镜输入**，由 `promptRenderHash` 覆盖。
  ⇒ 「换了色盘 ⇒ 提示词资产哈希会变」是**假命题**（色盘变了是**逐镜渲染哈希**变）。
  旧名 `assetHash` 会让人以为覆盖全部资产 ⇒ **已改名 `promptAssetHash`**（代码 + 文档 + 测试同步）。
- **与 `frameConstraint` 的域分层**（第 10 轮 i3）：`promptAssetHash` 吃**完整** doctrine（**不截断**）⇒ 截断点**之后**的改动它看得见；
  `frameConstraint.hash`/`length` 吃**截断后**文本 ⇒ 那半段**看不见**；`frameConstraint.originalHash` 吃**截断前**原文 ⇒ 那半段**补回来**。
  （这三个说法不矛盾 —— 它们描述的是**三个不同的对象**。）
- **消费方接 LLM 前的强制前置**：① `deliverable === true`；② 重算 `promptAssetHash` 与 `promptContext.promptAssetHash` **一致**；
  ③（若关心逐镜渲染）重算 `promptRenderHash` 与 `shot.promptRenderHash` **一致**。
  任一不满足 ⇒ 不得直送。本 PR 尚无 LLM 消费方，故该契约是**写进文档的机器可判前置**，由本 PR 的测试锁住字段形状。
- **本 PR 不做「embedded manifest / 资产签名」**：那是 F-J 的**写路径**（PR-3b，design D19），需独立安全评审。
  本 PR 的边界是「篡改必须**可检测**」，不是「资产必须被签名」。
**`style_prefix` 是具名前置项（第 7 轮 i2 · Critical/feasibility 的部分采纳）**：
- 事实：`style_prefix` **无资产源** ⇒ 生产路径 `deliverable` 恒为 `false`。
- **不采纳**「不补 `style_prefix` 就不许发布 F-I」：那会让本 PR 交付**零价值** ——
  本 PR 的交付物正是「把接上了多少变成**可见事实**」，缺口被藏起来比被暴露更糟。
- **采纳**的部分：把它写成**具名、可追踪的前置项** ——
  ① 面板上 `style_prefix` 恒以 `byDesign` 原因显示（「设计上不填（该变量没有资产源）」）；
  ② `style_prefix` 的**资产形态**升格为后续 PR 的**前置任务**（不是本 PR 造，见 §六-3）；
  ③ 任何 LLM 直送路径的**准入条件**包含「`style_prefix` 已接入」⇒ 那是 PR-5 之后的事。
**本 PR 内的真实消费方（第 3 轮 i1）**：自动模式**确认卡**新增一个**只读「方法论接入状态」**分区（plan 级）：
- 任务模板：`generate_shot_prompt`（+ locale）
- 变量命中：`N/7`（`N` = 命中数）+ **阻断变量与原因**（`blockedVars` 的 name + reason，**逐变量独立文案**）
- 可否直送 LLM：`deliverable`（false 时显示「不可直送」+ 原因）
- 尾帧约束：规则原文**已接入（plan 级）** / 逐镜派生**待 LLM**
- 资产完整性（⚠ **W10/W11 是服务端消息**（`plan.warnings`），**不进 i18n 清单**；面板显示的是 `methodologyAssetsIncomplete` 那一行）：`assetsIncomplete`
- 资产版本戳：`promptAssetHash` 前 8 位
**聚合文案的**两态与优先级**（第 7 轮 i7 / 第 9 轮 i7 / 第 13 轮 i8）**：
> **优先级：只要存在 `assetMissing` ⇒ 用第二态**（带「或补齐对应资产」）；
> **只有** byDesign（可能与 `templateVar` / `badVarName` 并存）⇒ 用第一态（只说「人工补齐」）。
> 实现即 `blockedVars.some(b => b.reason === "assetMissing")` ⇒ **混合态有确定结果**，并有判据覆盖。
**聚合文案不得暗示「补资产能解决 byDesign」（第 7 轮 i7 · Warning/feasibility）**：
逐变量原因已经分开（byDesign / assetMissing 各有自己的 i18n 文案），但**聚合**提示若写成
「需人工补齐**或先接上缺失资产**」，对 `style_prefix` 就是误导 —— byDesign 的变量**本就没有资产源**。
⇒ 聚合文案改为「存在未接入变量，这份提示词不能直送模型（请先人工补齐未接入的变量）」，
**只说「人工补齐」，不提「接上缺失资产」**（只剩 byDesign 时）；有 assetMissing 时用第二态文案（**或补齐对应资产**）；
「资产不完整（缺 doctrine / 缺任务库），能力未接入」只在 `assetsIncomplete`（真·结构性缺失）时出现 —— **不写「请重新导入」**（产品里没有导入入口）。
**本 PR 不开导出入口**：`system` 原文属提示词资产，导出面需单独权限评审 ⇒ 导出留后续 PR。
### F-H 方法论分区补全（只读）
- 视图补两个分区：`recipes`（配方，含 `blockKeys`）、`failureLedger`（失败台账，含 `symptom` / `cause` / `fix` / `tags`）。
- i18n `zh`/`en` 成对；**不改**既有四标签结构（D13：写操作一律走「自动」标签）。
- **只读**：不提供复制/导出。
- **回退口径**：本仓 PR 一律 **squash 合并** ⇒ 合并后**单笔提交不可独立回退**；
  若 F-I 侧出问题要撤 F-H，**只能 revert 整个 PR**（本 PR 一并撤销 F-H 与 F-I）。
  ⇒ 不再声称「可单独回退 F-H 这一笔」。
## 三、缺失可见（沿用既有口径）
| 情形 | 警告 | 机器可判字段 | 行为 |
|------|------|-------------|------|
| kit 缺 doctrine | **W10** | `promptContext.assetsIncomplete = true` | 规划**仍出结果**；UI 可见。**字段名不叫「导出被阻断」** —— 本 PR 根本没有导出入口，叫那个名会让人以为导出功能已存在。**只覆盖 kit 结构性缺失**（缺 doctrine / 缺 promptLibrary）；`style_prefix` 与 `geo_block` 走 `blockedVars`（见 §二「聚合文案」段） |
| 变量取不到 | 进 `missing` | `deliverable = false` + `blockedVars[]` | byDesign 留占位符；assetMissing 渲染为空串 |
## 四、验收：断言 → 测试文件/用例名映射
> **两类判据必须分开**（第 3 轮 i3/i4）：
> **合成夹具**（固定数据、固定阈值 ⇒ 资产更新不会让它变红）与**真实 kit 巡检**（只断言**一致性**、并**打印读数**，不设阈值 ⇒ 资产更新不会让它变红）。
>
> ⚠ **本表是「实现映射表」，不是完整验收清单**（38 行，编号闭集 ①…㊲ —— 闭集是机器断言
> `film-engineering-methodology.test.js`「验收条目的编号按出现顺序连续、无重号」的判定域，改编号要连它一起改）。
> **完整的验收清单在 PRD §9.b**（`M-1` ~ `M-43`，43 条）：PRD 侧把本表的若干条**拆得更细**
> （如 ⑯ → M-17/M-31、㉕ → M-26/M-28、⑬ → M-14/M-30、⑨ → M-8/M-42），
> 并多收了后加的几条（缺失态进哈希 / 代理对不切开 / 验收编号连续 / stale 不并列）。
> ⇒ **以 PRD §9.b 为准**；本表给出的是「每条断言落在哪个测试文件的哪个用例」。

| # | 断言 | 类别 | 测试文件 | 用例名（拟） |
|---|------|------|---------|------------|
| ① | **渲染器本身**（**非生产路径**）：7 变量齐备 ⇒ 渲染文本**无 `{{}}` 残留** + `missing` 为空 + `deliverable === true`。**生产路径不可能到这一步**（`style_prefix` 永不提供）⇒ 另见 ①b | 合成 | `shot-prompt-task.test.js` | 「渲染器：7 变量齐备时渲染无占位符残留」 |
| ①b | **生产路径（合成夹具版，CI 恒跑）**：断言 `style_prefix` ∈ `blockedVars` + `deliverable === false`（**由设计决定，不是巧合**）。**不比精确命中数**（命中数随资产变 ⇒ 与 ⑩ 的人工读数容差冲突）。用**合成夹具**实现 ⇒ **不依赖 film-kit** ⇒ CI 恒跑 | 合成 | `auto-plan.test.js` | 「生产路径：style_prefix 恒 byDesign ⇒ 进清单 + deliverable=false」 |
| ② | **合成夹具**：byDesign ⇒ 渲染保留 `{{style_prefix}}` + `deliverable=false` | 合成 | 同上 | 「合成夹具：byDesign 保留占位符并标注不可直送」 |
| ③ | **合成夹具**：assetMissing ⇒ 渲染为空串 + 进 `missing` | 合成 | 同上 | 「合成夹具：assetMissing 渲染为空串并进清单」 |
| ④ | **合成夹具**：模板多出的变量（`templateVar`）与不合规变量名（`badVarName`）⇒ 都进 `missing` 且 `deliverable=false` | 合成 | 同上 | 「合成夹具：模板多出的变量与非法变量名都计入 missing」 |
| ⑤ | 尾帧约束：取自 doctrine `frame_constraint` 块；超 50000 ⇒ 截断且 `truncated=true`；`en` 缺 ⇒ 回落 `zh` 且记 `fallbackLocales` | 合成 | 同上 | 「尾帧约束取自 frame_constraint 块」「尾帧约束超长被截到上限并出声」「尾帧约束缺 en 回落 zh 并记录」 |
| ⑥ | **确定性**：同一输入两次渲染**逐字相等**；`promptAssetHash` 随 doctrine/locale/回退变化而变，同输入稳定 | 合成 | 同上 | 「同输入两次渲染逐字相等」「promptAssetHash 随 locale 与回退变化」「promptAssetHash 同输入稳定」 |
| ⑦ | **体积**：项目文件里**方法论原文出现次数 == 0**（`frameConstraint` / `system` / `user` 的**原文一律不落盘** —— 只落哈希与长度）。⚠ 旧写法「只出现一次」与 D22「不含原文」**互斥**，按旧写法实现会把原文落盘 | 合成 | `auto-project.test.js` | 「项目文件不逐镜复制方法论长文本」 |
| ⑧ | kit 缺 doctrine / promptLibrary ⇒ W10 / W11 + `assetsIncomplete === true`（**plan 级、持久化**） | 合成 | `auto-plan.test.js` | 「缺 doctrine ⇒ W10 且 assetsIncomplete」「缺 promptLibrary ⇒ W11 且 assetsIncomplete」 |
| ⑨ | 不传 kit ⇒ `prompt` 与三分字段**逐字不变**（F-A 零回归锁延续） | 合成 | 同上 | 「不传 kit 时既有字段逐字不变」 |
| ⑩ | **真实 kit 巡检（非阻断）**：抽样 20 镜 ⇒ **只断言不变量**（① 每镜「命中数 + **7 个任务变量**在清单里的条数 == 7」；② `style_prefix` 恒为 `byDesign`）； ⚠ ① 在 `badVarName` 情形下**仍然成立**（第 13 轮 i4 驳回）：坏名字是**额外的**名字（不占用那 7 个任务变量的名额）， 而真正缺的那个任务变量**照样**进清单（`templateVar`/`assetMissing`）⇒ 和仍是 7。已补 `badVarName` 用例锁住这一点。；**平均命中数只作打印读数**，**不参与判定**（第 8 轮 i3：阈值建在会漂的量上 ⇒ 资产更新可能假红，且违反本节「真实巡检不设阈值」的自定原则）。CI 无 film-kit ⇒ SKIP（不红）并打印读数格式 | 真实 | 同上 | 「真实 kit 抽样：命中数自洽且 `style_prefix` 恒 blocked」「film-kit 缺失时 SKIP 并打印读数格式」 |
| ⑪ | F-H：recipes / failureLedger 两个分区渲染，**只读**（无写操作入口） | 合成 | `FilmEngineeringView` 渲染测试 | 「方法论分区渲染配方与失败台账」「方法论分区无写操作入口」 |
| ⑫ | 接入状态面板显示 `N/7` 命中、`deliverable=false` 的原因、**「资产不完整（缺 doctrine / 缺任务库），能力未接入」**（`assetsIncomplete`，**不写「请重新导入」** —— 产品里没有导入入口） | 合成 | `FilmAutoPanel.test.js` | 「接入状态面板显示命中数与阻断原因」「面板显示资产不完整」 |
| ⑬ | **篡改可检测 + 域分层**（第 7 轮 i3 / 第 10 轮 i3）：`promptAssetHash` 吃**完整** doctrine 原文（**不截断**）⇒ 对**每一个输入**敏感；截断点**之后**的改动 ⇒ `promptAssetHash` **变**、`frameConstraint.hash`（截断后）**不变**、`frameConstraint.originalHash`（截断前）**变** | 合成 | `shot-prompt-task.test.js` | 「promptAssetHash 对每个输入敏感」「哈希的域分层：截断点之后的改动 ⇒ promptAssetHash 变、frameConstraint.hash 不变、originalHash 变」 |
| ⑭ | **陈旧字段名回归锁**（第 7 轮 i4）：实现代码里 `sourceHash` / `blockedExport` **零出现**；同时现行名（`promptAssetHash` / `computePromptRenderHash` / `promptRenderHash` / `assetsIncomplete`）**确实在用**（防「一起删掉，锁成零命中」） | 合成 | `shot-prompt-task.test.js` | 「实现代码里不得再出现 sourceHash / blockedExport」「现行字段名确实在用」 |
| ⑮ | **聚合文案不含误导**（第 7 轮 i7）：`methodologyNotDeliverable` 的文案**不得**出现「接上缺失资产」类表述（byDesign 的变量本就没有资产源） | 合成 | `film-engineering-methodology.test.js` | 「不可直送提示只说人工补齐、不暗示补资产」 |
| ⑯ | **哈希域限定 + 负向域**（第 8 轮 i1 / 第 10 轮 i5）：`promptAssetHash` 覆盖 doctrine / system / user，**不**覆盖色盘与角色描述（改它们**不改**这个哈希，改的是逐镜 `promptRenderHash`）；改名后**旧名 `assetHash` 在实现代码里零残留** | 合成 | `shot-prompt-task.test.js` | 「负向域：改色盘/角色描述不改 promptAssetHash，但改 promptRenderHash」 |
| ⑰ | **截断前后两态**（第 8 轮 i2）：`frameConstraint.hash`/`length` 取**截断后**文本；`originalHash`/`originalLength` 取**截断前** ⇒ 两段「前 50000 字相同、后半不同」的文本：截断后哈希**相同**、`originalHash` **不同** | 合成 | 同上 | 「hash/length 取截断后文本；另存 originalHash/originalLength」 |
| ⑱ | **kit 不可信的长度上限**（第 8 轮 i8）：色盘行 / 角色描述超上限 ⇒ **不提供该变量**（进 `missing` ⇒ `deliverable=false`），**不静默截断**；未超限照常提供 | 合成 | 同上 | 「色盘行超上限 ⇒ 不提供该变量」「角色描述超上限 ⇒ 整个变量不提供」「未超上限时照常提供」 |
| ⑲ | **防空集通过**（第 8 轮 i4）：旧名扫描断言里**被扫描文件数 > 0**（路径写错/列表为空时该判据会恒真） | 合成 | 同上 | 「实现代码里不得再出现 sourceHash / blockedExport」 |
| ⑳ | **逐镜清单体积有界**（第 8 轮 i6 / 第 9 轮 i2 / 第 10 轮 i4 / 第 19 轮 i3）：`promptMissing` 里**7 个任务变量**的条目 ≤ 7；`templateVar` / `badVarName` / `oversizeVar` **另计**，**非任务变量条目 ≤ 8**（**实现里强制**：模板要 100 个变量时超出部分**不落清单**，`deliverable` 仍为 false）；**清单序列化 ≤ 8 KiB（8,192 字节，UTF-8）** ⇒ 两条上限**自洽**：总条目 ≤ 15，每条最坏 = 名字 ≤ 64 字符 × 6 字节（JSON 转义最坏）+ ~30 B ≈ 414 B ⇒ 15 × 414 ≈ 6.2 KB ≤ 8 KB ✓ | 合成 | `auto-project.test.js` | 「逐镜清单体积有界：条目 ≤ 变量数、每条是短结构」 |
| ㉑ | **真实 kit 巡检在 CI 上 SKIP**（第 8 轮 i7 / 第 18 轮 i5）：①b 的**语义**已用**合成夹具**搬进 CI（见 ①b ⇒ CI 恒跑）；**真实** kit 巡检需要 `film-kit` 目录 ⇒ CI 上 **SKIP**（不红）并打印读数格式 | 真实 | `shot-prompt-task.test.js` | 「film-kit 缺失时 SKIP 并打印读数格式」 |
| ㉒ | **不指向不存在的功能**（第 9 轮 i1）：`methodologyAssetsIncomplete` 与 W10/W11 的文案**不含「导入」**（产品里没有资产导入入口，那是 PR-3b）⇒ 改为如实说明「缺什么 + 能力未接入」 | 合成 | `film-engineering-methodology.test.js` | 「「资产不完整」文案不指向不存在的导入入口」 |
| ㉓ | **面板行标签互不相同**（第 9 轮 i6）：方法论分区每一行的 `<dt>` 是**互不相同**的 key（此前「可否直送 / 资产完整性 / 尾帧约束」三行**复用了「任务模板」**）；且每个行标签在 zh/en 都存在 | 合成 | 同上 | 「方法论分区内每一行的 <dt> 都是不同的 key」 |
| ㉔ | **重开项目也可见**（第 9 轮 i4）：服务端 `projectView` 用**同一个** `buildMethodologySummary` 从**落盘**的 `promptContext` + 逐镜 `promptMissing` 重新汇总 ⇒ `auto-status` 的项目投影里带 `methodology`；面板从**计算属性**读它 | 合成 | `film-engineering-auto.test.js` + 同上 | 「auto-status 的项目投影带方法论接入状态」「面板从计算属性读方法论状态」 |
| ㉕ | **逐镜字段长度上限 + 独立归类**（第 9 轮 i8 + 第 10 轮 i4）：`shot_json` 的 `title` / `characterNames` / `model` 超 2,000 字符 ⇒ **不提供** `shot_json`（⇒ `deliverable=false`），**不静默截断**；reason = **`oversizeVar`**（**不是** `assetMissing` —— 资产**有**，只是太大） | 合成 | `shot-prompt-task.test.js` | 「逐镜字段超上限 ⇒ 不提供 shot_json」 |
| ㉖ | **聚合提示按 reason 分流**（第 9 轮 i7）：只剩 byDesign ⇒ 只说「人工补齐」；有 assetMissing ⇒ 追加「或补齐对应资产」（第 7 轮把它整句删掉是**矫枉过正**） | 合成 | `film-engineering-methodology.test.js` | 「「有资产缺口」的第二态：说「或补齐对应资产」」 |
| ㉗ | **缺失五分类判据**（第 9 轮 i3 / 第 10 轮 i4 / 第 11 轮 i2）：`byDesign` = 产品里**没有这个资产的形态**；`assetMissing` = **有资产形态但当前没有**；`geo_block` 归 **byDesign**（本批次不取，选取规则未定义） | 合成 | `shot-prompt-task.test.js` + 文档 | （文档判据）+ 既有分类用例 |
| ㉘ | **三处计数同源**（第 10 轮 i1 / 第 13 轮 i1）：方案简报、本 PRD §8.b、测试清单长度，出现的每一个「N 个 key / 编号 1-N / 清单条数 == N」的 N **必须都等于清单长度**（**断言从清单长度取数，不写死数字**）。**断言实现上从清单长度取数、不手写数字** ⇒ 下一个加 key 的人改了清单，三处会**一起**红 | 合成 | `film-engineering-methodology.test.js` | 「方案简报与 PRD 里出现的 key 计数，全部等于 NEW_KEYS.length」 |
| ㉙ | **巡检断言有内容**（第 10 轮 i7）：真实 kit 巡检除不变量外，还要断言**每条 missing 的 reason 合法**、**reason 与渲染行为一致**（byDesign 保留占位符 / assetMissing 不留占位符）、**`deliverable` 与 `blockedVars` 长度与清单一致** | 真实 | `shot-prompt-task.test.js` | （并入真实 kit 巡检用例） |
| ㉚ | **清单里的名字封顶 + 唯一**（第 12 轮 i5 / 第 15 轮 i3 / 第 16 轮 i7 / 第 18 轮 i7 · security）：`templateVar` / `badVarName` 的名字来自**不可信**的 kit 模板 ⇒ ① 落盘前**剥除控制字符与零宽字符**；② 名字**总长** ≤ **64 字符**（= 前缀 **56** 字符 + `…` + `#` + **6 位哈希**）⇒ 一个 1MB 的变量名不会进逐镜项目文件；③ 加哈希后缀 ⇒ 两个**前 56 字**相同的长名字不会**同名**（否则面板按 name+reason 去重会把两条并成一条） | 合成 | `shot-prompt-task.test.js` | 「不可信模板带来的变量名封顶到 64 字符」 |
| ㉛ | **重开项目时校验资产**（第 12 轮 i6 / 第 13 轮 i6 / 第 15 轮 i6）：服务端用**当前** kit、但**落盘的 `promptContext.locale`**（**不是**当前界面语言 ⇒ 界面语言变了不会误报「资产已变」）重算 `promptAssetHash`，与落盘值不一致 ⇒ `methodology.stale = true` ⇒ 面板显示**区块级**警告「资产已变」。⚠ `stale` 是**三态**：`true`=被换了／`false`=没变／**`null`=判不了**（当前 kit 缺失或不完整）⇒ 判不了时**不显示**这条提示，改走「资产不完整」分支（否则 kit 缺失会被误报成「资产已变」） | 合成 | `film-engineering-auto.test.js` + `film-engineering-methodology.test.js` | 「「资产已变」是区块级警告」 |
| ㉜ | **无任务库态**（第 12 轮 i7）：缺 `promptLibrary` ⇒ `taskAvailable === false`、`deliverable === false`（清单里至少含 `style_prefix`）、`promptAssetHash` 仍按「doctrine + 空模板」算出（**不是**空串）、**不产出** `renderText`（无模板可渲染） | 合成 | `auto-plan.test.js` + `shot-prompt-task.test.js` | 「缺 promptLibrary ⇒ W11 且 assetsIncomplete」+ 新增断言 |
| ㉝ | **`shot_json` 缺值逐字段**（第 12 轮 i8）：`index`/`shotId`/`beatIndex` → `null`；`title`/`model` → 空串；`characterNames` → `[]`（缺值表示法不确定 ⇒ 序列化不可复现 ⇒ 哈希不可复现） | 合成 | `shot-prompt-task.test.js` | （并入哈希确定性用例） |
| ㉞ | **单镜落盘体积**（第 12 轮 i3 / 第 19 轮 i3）：单镜 `promptVars` + `promptMissing` 序列化 **≤ 256 KiB**（**两个对象合计**；**清单**单独的 ≤ 8 KiB，见 ⑳ 与附录 B） | 合成 | `auto-project.test.js` | 「逐镜清单体积有界」 |
| ㉟ | **「资产已变」的可达分支**（第 14 轮 i8）：`stale = null`（判不了）的全部可达分支只有两个 —— ① **重开时**当前 kit 缺失/不完整（⚠ 与「**规划时**无 kit」是**两件事**：规划时无 kit ⇒ ⑨ 不产出任何方法论字段；重开时 kit 没了 ⇒ 落盘的 `promptContext` 仍在 ⇒ 面板照常渲染**落盘**的清单，而 `stale=null` ⇒ 不显示「资产已变」）；② 取当前 kit 时**抛错**（⇒ 不判、不提示）。除此之外 `stale` 必为 `true` / `false` 之一 | 合成 | `film-engineering-auto.test.js` | 「重开项目时：kit 内容变了 ⇒ stale=true；只换界面语言 ⇒ stale 不变」 |
| ㊱ | **清单被闸门截断时要说出来**（第 17 轮 i7）：闸门在**产出源**（`buildShotTaskVars`，落盘的清单来自它）⇒ 超出上限的条目**不落盘**；面板据此显示「另有未接入的变量未显示」，不**静默丢弃** | 合成 | `shot-prompt-task.test.js` + `film-engineering-auto.test.js` | 「模板要 100 个变量 ⇒ 清单仍被封住」 |
| ㊲ | **存量项目重开**（第 17 轮 i2）：本 PR 之前规划的项目文件**没有** `promptContext` / `promptMissing` ⇒ 重开时 `methodology = null`（**不渲染**该分区）、**不报 stale**（没有可比对的基准）⇒ 与「无 kit 时不产出方法论字段」同一条边界 | 合成 | `film-engineering-auto.test.js` | 「无 promptContext ⇒ methodology 为 null、不报 stale」 |
**i18n key 清单（zh/en 各 27 个，成对）** —— 分组：**`doctrine` 7（1-7）+ `auto.methodology*` 13（8-20）+ `auto.methodologyReason*` 5（21-25）+ 其余 2（26-27）= 27**，与表逐行对齐：
| # | key | 用途 |
|---|-----|------|
| 1 | `filmEngineering.doctrine.recipes` | 配方分区标题 |
| 2 | `filmEngineering.doctrine.recipeBlocks` | 配方「包含块」标签 |
| 3 | `filmEngineering.doctrine.failureLedger` | 失败台账分区标题 |
| 4 | `filmEngineering.doctrine.failureSymptom` | 失败台账「症状」标签 |
| 5 | `filmEngineering.doctrine.failureCause` | 失败台账「成因」标签 |
| 6 | `filmEngineering.doctrine.failureFix` | 失败台账「修法」标签 |
| 7 | `filmEngineering.doctrine.failureTags` | 失败台账「标签」列 |
| 8 | `filmEngineering.auto.methodology` | 接入状态分区标题 |
| 9 | `filmEngineering.auto.methodologyTask` | 「任务模板」**行标签** |
| 10 | `filmEngineering.auto.methodologyHit` | 「变量命中」**行标签** |
| 11 | `filmEngineering.auto.methodologyBlocked` | 「未接入的变量」**行标签** |
| 12 | `filmEngineering.auto.methodologyDeliverable` | 「可否直送」**行标签**（第 9 轮 i6 新增：此前该行复用了「任务模板」） |
| 13 | `filmEngineering.auto.methodologyAssets` | 「资产完整性」**行标签**（第 9 轮 i6 新增：此前该行复用了「任务模板」） |
| 14 | `filmEngineering.auto.methodologyFrame` | 「尾帧约束」**行标签**（第 9 轮 i6 新增：此前该行复用了「任务模板」） |
| 15 | `filmEngineering.auto.methodologyNotDeliverable` | 「不可直送 LLM」提示（**只说人工补齐** —— 供「只剩 byDesign」时用） |
| 16 | `filmEngineering.auto.methodologyNotDeliverableAssets` | 「不可直送 LLM」提示**第二态**（**或补齐对应资产** —— 供「有 assetMissing」时用，第 9 轮 i7） |
| 17 | `filmEngineering.auto.methodologyAssetsIncomplete` | 「资产不完整」提示（**不指向导入入口** —— 产品里没有导入功能，第 9 轮 i1） |
| 18 | `filmEngineering.auto.methodologyFramePending` | 「尾帧规则已接入、逐镜待 LLM」提示 |
| 19 | `filmEngineering.auto.methodologyAssetHash` | 「资产版本戳」行标签 |
| 20 | `filmEngineering.auto.methodologyNoLibrary` | 缺任务库时的说明 |
| 21 | `filmEngineering.auto.methodologyReasonByDesign` | 阻断原因「设计上不填」 |
| 22 | `filmEngineering.auto.methodologyReasonAssetMissing` | 阻断原因「资产缺口」 |
| 23 | `filmEngineering.auto.methodologyReasonTemplateVar` | 阻断原因「模板需要但未提供」 |
| 24 | `filmEngineering.auto.methodologyReasonBadVarName` | 阻断原因「变量名不合法（实现缺陷）」 |
| 25 | `filmEngineering.auto.methodologyReasonOversizeVar` | 阻断原因「变量内容过长（资产装不进提示词）」 |
| 26 | `filmEngineering.auto.methodologyStale` | 「资产已变（哈希不一致），这份接入状态已过期，请重新规划」 |
| 27 | `filmEngineering.auto.methodologyTruncated` | 「另有未接入的变量未显示（清单已按上限截断）」 |
> **自检断言**：测试**逐条断言**上面 27 个 key 的**字面量**在 zh / en 里都存在 —— **不按命名空间计数**（那两个命名空间还有大量既有 key，按命名空间数必然对不上）；另断言「清单条数 == 27」与「zh / en 命中数一致」；
> **再加一条**（第 10 轮 i1）：**三处计数同源** —— 方案简报、本 PRD §8.b、本测试的清单长度，
>   出现的每一个「N 个 key / 编号 1-N / 清单条数 == N」的 N **都必须等于清单长度（当前 26）**。
>   **断言从清单长度取数、不手写数字**（人手维护十来个章节的同一个数字必然漏 ⇒ 交给机器查）。
> **再加一条**（第 9 轮 i6）：扫面板源码里的**行标签**，每一行的 `<dt>` 必须是**互不相同**的 key ——
> 「key 存不存在」查不出「行标签被复用」这类缺口。
> 「清单写了几个」与「文件里实际有几个」对不上就是欠账。**这正是本简报 v5→v6 那一类问题的教训**：
> 计数一旦在某处加了 key，三处（本文 §四末 / PRD §8.b / 测试断言）必须同次改完。
## 五、已决问题（历轮累积的最终决定，实施照这 8 条）
1. **F-I-2 无消费方算不算交付** → 决定：**保留 F-I-2**，并在本 PR 内补只读接入状态面板（消费方可见）；LLM 调用留 PR-5 之后。
2. **`endFramePrompt` 来源** → 决定：**只用 doctrine 的 `frame_constraint`**（`generate_shot_prompt` 那条要 LLM，本 PR 不可达）；**落 plan 级**（不逐镜复制）。
3. **`style_prefix` 无源** → 决定：**不填**（byDesign），保留占位符 + `deliverable=false`；风格前缀**升格为具名前置项**（后续 PR 补资产形态），本 PR 不造（见 §二「`style_prefix` 是具名前置项」段）。
4. **`geo_block` 本批次不取** → 决定：**归 byDesign**（第 17 轮 i3 改判）—— 跨模板取块的选取规则未定义，
   缺的不是资产、是「**我们决定不取**」⇒ 说成 `assetMissing` 与事实不符；**不从任何模板取块**（存量模板里只有 1 个带 GEO 块，取它就得先定义「取哪个模板的块」，那是另一个设计问题）。
5. **F-H 只读边界** → 决定：只读列表，**不提供复制/导出**；F-H 与 F-I **同批 revert**（本仓 PR 一律 squash 合并 ⇒ 单笔提交不可独立回退）。
6. **PR-3b 拆分** → 决定：**成立**（写路径独立安全评审）。
7. **W10/W11 警告还是 fail-closed** → 决定：**警告 + plan 级 `assetsIncomplete` 机器可判字段**；规划不拒绝，资产不完整时由面板提示「资产不完整，能力未接入」（**不指向导入入口** —— 产品里没有该功能，PR-3b 才做；本 PR 也不开导出入口）。
8. **`promptTask` 落点** → 决定：plan 级 `promptContext` + 逐镜 `promptVars`/`promptMissing` **落项目文件**；`renderText`/`deliverable`/`blockedVars` 只在规划结果。
## 六、剩余风险（不假装闭合）
1. **F-I-2 对存量资产基本无效**：存量 153 模板里只有 1 个有 GEO 块 ⇒ 绝大多数镜只能填 5/7 变量。已把「N/7 + 阻断变量」做成**面板上可见的事实**与**非阻断巡检的读数**，避免被读成「方法论已全接上」。这是**资产缺口**，不是本 PR 能修的。
2. **风格前缀无资产源**：`style_prefix` 长期 byDesign ⇒ `deliverable` 长期为 false ⇒ 后续 LLM 接入前必须先补该资产（**具名前置项**，本 PR 不造）。
3. **尾帧约束只能 plan 级、且只留哈希**：逐镜尾帧文本要 LLM 派生 ⇒ 本批次逐镜 `endFramePrompt` 仍为空；plan 级只留**哈希与长度**（原文不落用户项目文件），面板如实标注「规则已接入、逐镜派生待 LLM」。
4. **只读面板是「状态显示」不是「功能」**：它不改变任何出片行为；价值在于把「接上了多少」变成可见事实。
5. **PR-3b（导入写路径）尚未设计与评审**：本 PR 不含任何 userData 写入；「资产签名 / embedded manifest」也属那一档（见 §二「篡改可检测性契约」）。
6. **kit 是不可信输入，但「首算即视为可信」是残余风险**（第 8 轮 i8 · Warning/security）：
   `userData/film-kit` 可被**用户或外部进程**写入；kit-loader 校验**结构**，**不校验**块文本长度
   ⇒ 本 PR 已给流入提示词的 kit 自由文本（色盘行、角色描述）设**长度上限**（超限不提供 ⇒ `deliverable=false`，
   **不静默截断**）。
   **但**：`promptAssetHash` 是**首算即信任**的 —— 规划时按本地 kit 算出的哈希，
   **没有独立信任锚**（没有签名、没有内嵌清单）⇒ 「kit 被换 ⇒ 哈希会变」只在**同一台机器、同一次规划前后**成立。
   资产签名 / 信任锚属 F-J 写路径（PR-3b），需独立安全评审。
7. **真实 kit 巡检在 CI 上没有信号**（第 8 轮 i7 · Warning/feasibility）：
   真实资产面需要 `film-kit` 目录，CI 上没有 ⇒ 该巡检在 CI 里 **SKIP**。
   ⇒ 已把它的**语义**用**合成夹具**搬进 CI（判据 ㉑），CI 恒跑；
   真实巡检保留为**本地/手工**门禁（只打印读数，不阻断）。
8. **「资产不完整」暂时没有用户可执行的修复动作**（第 9 轮 i1 · Critical/consistency）：
   文案已改成如实说明「缺什么 + 能力未接入」**不再指向导入入口**（产品里没有那个功能，PR-3b 才做）。
   ⇒ 但用户看到「能力未接入」时**仍不知道该做什么** ⇒ 补齐入口落地前，这是一条**只陈述事实**的提示。
9. **改一条判据可能与另一条判据互斥**（第 9 轮 i2 的元教训）：
   第 8 轮 i3 把真实巡检读数降为非阻断时，顺手加的「命中数 + 清单条数 == 7」，
   在**模板多要变量**时**必然为假**（`templateVar` / `badVarName` 不在那 7 个变量之内）。
   ⇒ 处置纪律：每改一条判据，都要回头看它与**既有判据**是否自洽 ——
   这次是**外部评审**抓到的，不是自查抓到的 ⇒ 自查清单里要加「新判据与旧判据互斥」这一项。
## 七、速查附录（实施者只看这一节就够）
**A. 现行命名（旧的 `sourceHash` / `blockedExport` / `assetHash` 已废弃）**
| 旧名（**勿用**） | 现行名 | 落点 |
|---------------|--------|------|
| `sourceHash` | `promptAssetHash`（plan 级）**+** `promptRenderHash`（逐镜） | 项目文件 |
| `assetHash` | **`promptAssetHash`**（第 8 轮 i1 改名：域是**提示词资产**，不是全部资产） | `promptContext` |
| `blockedExport` | `assetsIncomplete` | `promptContext` |
| — | `promptVars` / `promptMissing` / `promptRenderHash` | 逐镜 |
| — | `frameConstraint`（`{hash,length,locale,fallback,truncated,source,originalHash,originalLength}`） | `promptContext` |
**B. 哈希规格与长度上限常量**
> ⚠ **计数与截断的单位**：全部按 **UTF-16 code unit**（JavaScript 的 `String.prototype.length` / `slice` 语义）计数与截断，
> **不**按 code point ⇒ 跨实现不一致。**截断不切开代理对**（第 14 轮 i6：切开会留下半个 emoji，
> 确定性不受影响但**显示**是坏的）⇒ 截断点若落在代理对上，回退一个 code unit。
| 常量 | 值 | **单位** | 管什么 | 超限怎么办 |
|------|----|--------|-----------|
| `MAX_END_FRAME_LEN` | **50,000** | **code unit**（UTF-16） | 尾帧原文 | 截断 + `truncated=true`（**出声**，不静默） |
| `MAX_KIT_VAR_LEN` | **20,000** | **code unit**（UTF-16） | `palette_line` 整行、`character_descriptors` **多角色拼接后的合计**（kit 自由文本） | **不提供** ⇒ reason=`oversizeVar` ⇒ `deliverable=false`（**不静默截断**） |
| `MAX_SHOT_FIELD_LEN` | **2,000** | **code unit**（UTF-16） | `shot_json` 的 `title` / `characterNames` / `model`（逐镜字段，**逐字段**判） | **不提供** `shot_json` ⇒ reason=`oversizeVar` ⇒ `deliverable=false` |
| 单镜 `promptMissing` | **≤ 8 KiB（8,192）** | **UTF-8 字节** | 逐镜**清单**体积（闸门：实现里强制） | ——（超了就是判据红）。⚠ 这是**清单**的上限；`promptVars` + `promptMissing` 的**合计**上限见 §〇「单镜落盘体积」（**两个对象、两个上限**，别混用） |
- 算法：sha256，十六进制小写，**64 字符**。
- 拼接：**长度前缀** `len:key=len:value`，以 `;` 连接 ⇒ 无分隔符碰撞。
- `promptAssetHash` 输入：`version` + `locale` + `fallbacks`（按来源分组、键名排序）+ `doctrine` + `system` + `user`。
  **域 = 提示词资产**（**不含**色盘行 / 角色描述 / 逐镜时长与模型 —— 那些由 `promptRenderHash` 覆盖）。
- `promptRenderHash` 输入：`version` + `locale` + 逐镜 vars（键名排序）—— **含**色盘行与角色描述；**再加**缺失清单（`missing:<name>` → `reason`，按 name+reason 排序）。
- `version` 现为 **`v2`**（v1 → v2：逐镜渲染哈希加进缺失清单 ⇒ 旧哈希不会与新哈希混淆）。
- `version` = **`v2`**（v1 → v2：逐镜渲染哈希加进缺失清单；改键序/字段时继续 +1）。
- `frameConstraint`：`hash`/`length` 取**截断后**文本；`originalHash`/`originalLength` 取**截断前**原文
  （没有后者，截断点之后的改动**不可见**）。
- **`shot_json` 键序（确切）**：`index` → `shotId` → `title` → `beatIndex` → `characterNames` → `model`。
  **缺值逐字段表示法**（缺值表示法不确定 ⇒ 序列化不可复现 ⇒ 哈希不可复现）：
  | 字段 | 缺值表示 |
  |------|---------|
  | `index` | `null` |
  | `shotId` | `null` |
  | `title` | `''` |
  | `beatIndex` | `null` |
  | `characterNames` | `[]` |
  | `model` | `''` |
**C. 7 个任务变量与五类缺失**
| 变量 | 来源 | 缺失类别（现状） |
|------|------|-----------------|
| `shot_json` | 本镜记录 | —— |
| `palette_line` | `kit.palette.paletteLine` | assetMissing（无色盘时） |
| `style_prefix` | 无资产源 | **byDesign**（恒定） |
| `geo_block` | **本批次不从任何模板取 GEO 块**（跨模板取块的选取规则未定义）⇒ 不提供 | **byDesign**（第 17 轮 i3 改判） |
| `character_descriptors` | `film-manifest.filmMeta.characters[].descriptor` | assetMissing（无角色时） |
| `duration_sec` | 逐镜时长链 | —— |
| `model` | 本镜 `model` | —— |
五类：`byDesign`（留 `{{var}}`）/ `assetMissing`（渲染空串）/ `templateVar`（模板多要）/ `badVarName`（我们给的名字不合法）/ `oversizeVar`（**资产太大**，不提供 ⇒ 模板里留着 `{{var}}`）。
**D. 27 个 i18n key**：见 §四末（逐条编号 1-27，zh/en 成对）。
**E. 关键机器可判字段**
| 字段 | 含义 | 谁读 |
|------|------|------|
| `promptContext.assetsIncomplete` | kit **结构性**缺失（缺 doctrine / 缺 promptLibrary）⇒ 「能力未接入」 | 面板 |
| `promptContext.promptAssetHash` | 资产面版本戳（面板显示前 8 位） | 面板 + 消费方 |
| `shot.promptRenderHash` | 逐镜渲染面版本戳 | 消费方 |
| `shot.promptMissing[].reason` | **五类**之一（`byDesign` / `assetMissing` / `templateVar` / `badVarName` / `oversizeVar`） | 面板（逐变量 i18n 文案） |
| `deliverable`（仅规划结果） | 能否直送 LLM | 消费方**必须**先校验 |
| `blockedVars`（仅规划结果） | 哪些变量挡住了直送 | 面板 + 消费方 |