# CCG 决策层对抗评审记录 · PR-3（F-I 任务级提示词接入规划 + F-H 方法论分区补全）

> 评审对象：`review-brief-pr3.md`（PR-3 决策层简报）
> ｜引擎：`scripts/plan-review.sh`（adversarial-review-loop，决策层 objectType=plan）
> ｜判定器：`scripts/ccg-review-decider.js` → **DUAL**（方案规模 250 行 > 200 阈值）
> ｜后端：**critic=codex（openai 家族）× proposer=claude（anthropic 家族）** —— 跨家族校验通过
> ｜原始产物在 `.adversarial/ccg-plan-review-brief-pr3-codex/`（被 `.gitignore` 忽略，不入库）；
> 　 本文件为**可入库的公开记录**。

---

## 一、轮次与读数

| 轮次 | critic | 问题数 | 其中 Critical | 最低维度分 | 维度分 | proposer 修订 |
|------|--------|--------|--------------|------------|--------|--------------|
| 第 1 轮 | codex | 8 | 2 | 4 | completeness 4 / consistency 4 / clarity 5 / feasibility 5 / security 7 | 引擎校验**通过**（9 处改动，采纳 8 / 有证据拒 0 / 部分采纳 0）|
| 第 2 轮 | codex | 8 | 3 | 4 | completeness 5 / consistency 4 / clarity 5 / feasibility 6 / security 6 | **机械修订失败**（`edits.before` 逐字定位不到 + 部分 accepted 无对应 edit）⇒ 由作者外科式落地 |
| 第 3 轮 | codex | 8 | 2 | 6 | completeness 6 / consistency 6 / clarity 7 / feasibility 6 / security 8 | **机械修订失败**（`edits[2].before` / `edits[14].before` 逐字定位不到）⇒ 由作者外科式落地 |
| 第 4 轮 | codex | 8 | 2 | 4 | completeness 5 / consistency 4 / clarity 6 / feasibility 5 / security 6 | **机械修订失败**（同形态）⇒ 由作者外科式落地 |
| 第 5 轮 | codex | 8 | 3 | 4 | completeness 6 / consistency 4 / clarity 6 / feasibility 5 / security 7 | **机械修订失败**（同形态）⇒ 由作者外科式落地 |
| 第 6 轮 | codex | 2 | — | — | **critic 输出校验失败 ⇒ 无维度分** | 引擎记为 error；原始输出仍读出 **2 条** ⇒ 由作者外科式落地 |
| 第 7 轮 | claude | 8 | 3 | 4 | completeness 5 / consistency 5 / clarity 4 / feasibility 4 / security 6 | **修订环节未能进入**：proposer=opencode 单次输入上限 7800 字符，本简报 23,345 字符 ⇒ 引擎直接拒收（**critic 侧照常产出 critique**）⇒ 由作者外科式落地 |
| 第 8 轮 | codex | 8 | 2 | 4 | completeness 7 / consistency 4 / clarity 6 / feasibility 6 / security 5 | **后端覆盖** `--critic codex --proposer claude`（见下方说明）；proposer 的**机械修订失败**（4 处 `edits.before` 逐字定位不到 + 2 条 accepted 无对应 edit）⇒ 由作者外科式落地 |
| 第 9 轮 | codex | 8 | 3 | 4 | completeness 6 / consistency 4 / clarity 6 / feasibility 5 / security 5 | 同上后端覆盖；proposer 机械修订**再次**失败（9 处 `edits.before` 定位不到 + 1 条 accepted 无对应 edit）⇒ 由作者外科式落地 |

**放行判据 = 0 Critical + 0 High**（维度分数**不作**放行判据 —— 第 4/5 轮的最低维度分回到 4，
与第 1 轮同档，说明「分数高低」本身不是收敛信号，**逐条是否处置干净**才是）。

**为什么多轮由人工落地**：proposer 的机械环节要求 `edits[].before` 在方案原文里**逐字**可定位；
本 brief 的中文长句反复触发复现失真（引擎自报 `edits[0].before 在方案原文中不存在`），
**评审结论本身不受影响**（critic 的意见与 proposer 的内容判断全部有效），
因此按 PR-1 的既有处置方式：**critic 意见逐条落地，proposer 的内容判断采纳，改动由作者外科式完成**。
这一事实在此显式记录，不冒充「引擎自动改的」。

## 二、第 1 轮 8 条的处置（全部采纳）

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / completeness | Q1 三选一未决 ⇒ PR 范围实质未定 | **决定选①**（先接渲染与变量装配，LLM 调用留后续），②③记为被否方案 |
| i2 | Critical / consistency | `geo_block` 写作「模板的 GEO 块」⇒ 命中 0 条是**定义缺陷**，推不出资产缺口结论 | 改为「镜头地理/空间字段 / kit 空间资产」；取不到 ⇒ 移出变量表 + W 类警告暴露 |
| i3 | Warning / consistency | `endFramePrompt` 落盘而 `promptTask` 不落盘 ⇒ 同链两种口径，体积理由只解释后者 | 统一口径（D20.3）：plan 级 `promptContext` + 逐镜 `promptVars` 落盘；`renderText`/`deliverable` 只在规划结果 |
| i4 | Warning / feasibility | system+user 每镜相同却按镜复制 2KB×N ⇒ 体积论证与载荷结构自相矛盾 | `system`/`user` 按 `taskId` 引用，不逐镜复制 |
| i5 | Warning / feasibility | `missing` 混装「设计上不填」与「资产缺口」⇒ 消费方无法区分；`{{style_prefix}}` 直送会污染提示词 | 分级 byDesign / assetMissing，并加机器可判字段（见第 2 轮 i3/i7） |
| i6 | Warning / completeness | W10/W11 只是 warnings，UI 是否可见/是否阻断导出未定义 ⇒ 静默降级 | 补可见位置与阻断条件（W10/W11 + `assetsIncomplete`） |
| i7 | Warning / completeness | 给了测试规模但无一条可执行断言清单 | 补断言→测试文件/用例名映射表（brief §四） |
| i8 | Info / security | 「可导出/预览」未定义导出通道与权限边界 | 本 PR **不开导出入口**（仅内部结果字段），导出留后续 PR 并附权限评审 |

## 三、第 2 轮 8 条的处置（全部采纳）

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / completeness | F-I-2 自认无消费方，产出只被测试碰到 —— **复刻了它自己批评的缺口** | **补只读「方法论接入状态」面板**（自动模式确认卡，plan 级）：命中数 / missing 分类 / `deliverable` / 资产版本戳 / W10-W11 ⇒ 进入用户路径 |
| i2 | Critical / consistency | 「W10 阻断导出」与「本 PR 不开导出入口」冲突 ⇒ 该断言本 PR 内无法取证 | 改为**机器可判字段** `assetsIncomplete = true`（测试直接断言该字段），**导出执行留后续 PR** |
| i3 | Critical / clarity | byDesign 与 assetMissing 行为等价 ⇒ 分级不产生可观测差异 | 明确差异：**byDesign** 渲染保留 `{{var}}` 原样 + 标注「不可直送 LLM」；**assetMissing** 渲染**空串** + 进 `missing` 清单；**各写一条用例** |
| i4 | Warning / clarity | `endFramePrompt` 契约缺失（结构/上限/locale 回退/与 prompt 的拼接关系）；Q2 未决却已定实现 | 补字段契约表（design D20.1）；**Q2 决定**：只用 doctrine 的 `frame_constraint`（`generate_shot_prompt` 那条要 LLM，本 PR 不可达） |
| i5 | Warning / completeness | 7 变量里 `style_prefix` 无源、`geo_block` 命中 0 条 ⇒ 实际可用率 5/7；验收只断言字段存在 | 加**量化判据**：真实 kit 抽样 20 镜，可填变量 ≥ 5 的镜数占多数，`missing` 清单与实测一致（把「5/7」固化为已知基线） |
| i6 | Warning / feasibility | `promptTask` 不落盘 ⇒ 续跑/重生成拿不到；无版本戳 ⇒ kit 更新后同一输入产出不同结果无法归因 | 资产面版本戳写入 `promptContext`；`vars` 随项目文件持久化；写明「同 kit ⇒ 重渲染逐字相同」的确定性前提 |
| i7 | Warning / security | 接受与成本闸 PR-5 的次序倒置，但**没有任何机制**防止后续消费方直送含占位符的文本；「标注不可直送」是文档约定不是强制 | 升级为**机器可判字段** `deliverable = false` + `blockedVars[]`，并**用测试锁死**；消费方接 LLM 前必须校验 |
| i8 | Info / completeness | 「~250/200/150 行」是无可验证判据的估算；四条验收断言未映射到测试文件与用例名 | 补断言→测试文件/用例名映射表（brief §四，共 11 条）；改动量标注「范围估计，不含 F-J 写路径」 |


## 三之二、第 3 轮（重跑一次）8 条的处置（全部采纳）

> 第 3 轮：critic 最低维度分从 4 升到 **6**（completeness 6 / consistency 6 / clarity 7 / feasibility 6 / security 8），
> 仍余 2 条 Critical；proposer 的机械修订**再次**失败（`edits[2].before` / `edits[14].before` 逐字定位不到）⇒ 同样由作者外科式落地。
> 产物：`proposal-v1.md`（本轮快照）、`critique-v1.md`（本轮意见）。前两轮产物归档在 `.adversarial/archived-pr3-r1r2/`。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | `endFramePrompt` 逐镜存整块文本（可达 50000）× N ⇒ 项目文件线性膨胀，与「不逐镜复制」自相矛盾 | **采纳**：改 **plan 级 `frameConstraint` 存一次** + 逐镜 `endFramePrompt` **仍为 `''`**（本批次无法逐镜派生，留空即不发送）→ 补体积断言 ⑩ |
| i2 | Critical / feasibility | 资产版本戳未含 locale / 键序未定义 / locale 回退会改文本 ⇒ 续跑可能静默得到不同文本 | **采纳**：资产面版本戳 = sha256(`v1` + locale + 回退事实 + doctrine + system + user)；`shot_json` 固定键序；补「两次渲染逐字相等」回归 ⑥ |
| i3 | Warning / feasibility | `style_prefix` 永久 byDesign ⇒ 生产 `deliverable` 恒 false；验收 ① 锁死了生产不可达的路径 | **采纳**：「7 变量齐备」改为**合成夹具**用例；面板显示「N/7 + 阻断变量与原因」；`style_prefix` 升格为**前置项** |
| i4 | Warning / feasibility | ⑦「可填 ≥5 占多数」无阈值且依赖真实 kit 快照 ⇒ 资产一更新即红 | **采纳**：阈值只对**固定合成夹具**；真实 kit 改为**非阻断巡检**（只断言一致性 + 打印读数） |
| i5 | Warning / completeness | `unknownVars` 无行为定义、无断言 | **采纳**：非法变量名计入 `missing` 且 `deliverable=false`，补用例 ④ |
| i6 | Warning / completeness | locale 回退只对 `endFramePrompt` 定义；`getTaskPrompts` 的 en 行为、标注的 i18n、`fallbackLocales` 断言均缺失 | **采纳**：回退规则提为**统一函数**覆盖三处；`fallbackLocales` 落 plan 级并补用例 ⑤⑥；标注文案走 i18n |
| i7 | Warning / consistency | `assetsIncomplete` 未说落点、也无消费方 | **采纳**：落 **plan 级**（持久化），并由接入状态面板消费显示「资产不完整，请重新导入」 |
| i8 | Info / clarity | F-H 只读 UI 与 F-I 运行时接线混批；i18n「4 处」与实际不匹配 | **采纳**：F-H 与 F-I **同批 revert**（本仓 squash 合并，单笔提交不可独立回退）；i18n 逐条列出 |

## 三之三、第 4 轮 8 条的处置（全部采纳）

> 第 4 轮：最低维度分回到 **4**（consistency 4 为最低档），2 Critical + 6 Warning。
> 产物归档在 `.adversarial/archived-pr3-r4/`。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | §四末实际列了 16 个 key，正文两处写「12」⇒ 清单与计数未对账 | **采纳**：改为 16、逐条编号列出，并加**自检断言**（逐条断言清单里的 key 字面量在 zh/en 均存在） |
| i2 | Critical / consistency | 资产面版本戳只含 plan 级量，不含逐镜 `promptVars` ⇒ 两镜同哈希但渲染可不同，却断言「哈希相同 ⇒ 逐字相同」；拼接无分隔符有碰撞风险 | **采纳**：拆 **plan 级 `promptAssetHash`（资产面）+ 逐镜 `promptRenderHash`（渲染面）**（`promptAssetHash` 原名 `assetHash`，已在第 8 轮改名），拼接改**长度前缀**（`len:key=len:value`），分别断言 |
| i3 | Warning / feasibility | 「可单独回退这一笔」在 squash 合并下**无执行体** | **采纳**：删掉该说法 ⇒ 回退口径改为「**revert 整个 PR**」 |
| i4 | Warning / feasibility | 验收①要求 7 变量齐备，生产路径永不可达 ⇒ 锁死不存在的分支 | **采纳**：① 改为「**渲染器本身**（非生产路径）」，另加 ①b「**生产路径**：`style_prefix` ∈ blockedVars + `deliverable=false`」 |
| i5 | Warning / completeness | 验收⑩「与实测一致」无 ground truth（自己对照自己）；CI 无 film-kit 时的跳过/失败策略未定义 | **采纳**：**人工读数落盘**（5/7，容差 ±1，写明记录日期与原因）+ **明确的 SKIP 条件与读数打印格式** |
| i6 | Warning / consistency | `fallbackLocales` 是扁平列表，分不清 doctrine/palette/task 各自的回退来源 | **采纳**：改为**按来源分组**（`{doctrine:{}, palette:{}, task:{}}`），并补三处各自的回退用例 |
| i7 | Warning / consistency | `assetsIncomplete` 名字指「导出被阻断」，但本 PR 无导出入口 ⇒ 面板会误导 | **采纳**：面板文案改「资产不完整，请重新导入」（见第 5 轮 i2） |
| i8 | Warning / security | `frameConstraint` 方法论原文落进用户项目文件，而 `system` 原文被认为需单独权限评审 ⇒ 外发/日志面未评审 | **采纳**：**只存哈希与长度，不存原文** ⇒ 用户项目文件里**不含任何方法论原文** |

## 三之四、第 5 轮 8 条的处置（全部采纳）

> 第 5 轮：3 Critical + 5 Warning，最低维度分 4（consistency 4）。
> 产物归档在 `.adversarial/archived-pr3-r5/`。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | i18n 清单的分组编号写「1-4 / 5-10 / 11-17」，但表只有 16 行、末条编号 16 ⇒ 计数与表自相矛盾 | **采纳**：改为「与表逐行对齐」的编号 |
| i2 | Critical / consistency | 验收 ⑧/⑫ 仍用旧字段名 `assetsIncomplete` 与旧文案「导出已阻断」⇒ 实施会照旧名/旧文案写测试 | **采纳**：⑧ 改 `assetsIncomplete === true`；⑫ 文案改「资产不完整，请重新导入」；测试名同步 |
| i3 | Critical / feasibility | 自检断言要求「数 `filmEngineering.doctrine`/`auto` 命名空间下的 key 数 == 16」，但这两个命名空间还有大量既有 key ⇒ 断言必然失败 | **采纳**：改为**逐条断言清单里的 key 字面量**在 zh/en 均存在（**不按命名空间计数**），另断言「清单条数」与「zh/en 命中数一致」 |
| i4 | Warning / consistency | `assetsIncomplete` 外延未闭合：若把 `style_prefix`/`geo_block` 也算进去 ⇒ 恒 true，面板长期显示「请重新导入」而**重导也无效** | **采纳**：`assetsIncomplete` **只覆盖 kit 结构性缺失**（缺 doctrine / 缺 promptLibrary ⇒ W10/W11）；那两个走 `blockedVars` |
| i5 | Warning / feasibility | ①b 依赖真实 kit 但未定「CI 无 film-kit 时红还是跳」 | **采纳**：①b 补与 ⑩ **同款 SKIP 条件**与打印格式 |
| i6 | Warning / consistency | ①b 硬断言精确命中数、⑩ 允许 ±1 ⇒ 资产更新时两条判据互相矛盾 | **采纳**：①b **不比精确命中数**，只断言 `style_prefix` ∈ `blockedVars` + `deliverable === false` |
| i7 | Warning / consistency | 「可丢弃的独立提交」在 §二 / §五 i8 / §六-5 仍有残留，与 §二已推翻的说法矛盾 | **采纳**：三处同步为「**与 F-I 同批 revert**」，删除可丢弃表述 |
| i8 | Warning / feasibility | `assetMissing` 依赖 `renderTemplate` 对空串的语义，方案未验证 | **采纳**：**已验证** —— `renderTemplate` 对「已提供的空串」直接返回空串，对「未提供」才保留 `{{var}}`；两条路径各有用例锁住 |

## 三之五、第 6 轮的处置（critic 输出**校验失败** ⇒ 无 `critique-v1.md` 落盘）

> **这一轮的特殊形态**：critic 的输出**没通过引擎的 JSON 校验**，因此 `critique-v1.md` **没有落盘**；
> 但原始输出里仍能读出 **2 条**意见。本节按这 2 条记录，**不补写不存在的逐字原文**。
> 产物：`.adversarial/archived-pr3-r6/`（只有 `proposal-v1.md` + `family-snapshot.json`，**没有** critique 文件）。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | 文档里还残留旧字段名 `sourceHash`（第 4 轮已拆分为 `promptAssetHash` + `promptRenderHash`；`promptAssetHash` 原名 `assetHash`，已在第 8 轮改名）⇒ 实施会照旧名写代码 | **采纳**：实现侧全量搜 `sourceHash` 确认**零残留**（`shot-prompt-task.js` 只有 `promptAssetHash` / `promptRenderHash`）；历史处置记录里的旧名**保留原文**但逐条标注「（原名，已改名）」 |
| i2 | Warning / completeness | 面板上的**阻断原因**（byDesign / assetMissing / templateVar / badVarName）是机器枚举 ⇒ 渲染出来是原始英文标记，不是用户可读文案 | **采纳**：新增 4 个 i18n key `auto.methodologyReason*`（zh/en 成对）⇒ **i18n 计数由 16 改为 20**；实现侧 `REASON_*` 常量 ↔ i18n key 一一对应 |

**i2 的连锁影响**：i18n 计数 16 → 20 牵动 4 处文档（简报 §一 改动量、简报 §四末清单、PRD §8.b 表、PRD M-13 验收），
外加测试文件里 3 处**标题/注释**仍写「16」而**断言值已是 20** —— 「断言对、文案错」，
最容易被下一轮当成「计数未对账」再抓一次，故本轮一并改掉。

## 三之六、第 7 轮 8 条的处置（2 条成立·已修 / 2 条部分采纳 / 1 条驳回 / 1 条部分采纳）

> 第 7 轮：critic 换成 **claude**（`scripts/ccg-review-backends.list` 的现行配置：critic=claude × proposer=opencode），
> 3 Critical + 4 Warning + 1 Info，最低维度分 4（feasibility 4）。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-claude/`（`critique-v1.md` 2,941 字节 —— **引擎校验通过**）。
>
> **这一轮的特殊形态**：critic 正常产出 critique，但**修订环节没能进入** ——
> proposer=opencode 的单次输入上限 7,800 字符，而当时简报 23,345 字符 ⇒ 引擎直接拒收。
> 引擎给的建议是：「把方案拆小后分轮评审，或去掉方案里对 reviewer 无用的内容
> （如历史修订轨迹、意见对应表——**那是给人看的，不是评审对象**）」。
> ⇒ 本轮处置照这条建议做：简报 v6 **把历史处置表整体移出**到本文件，简报只留当前口径。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | 简报最终 i18n 是 20（§四末），但历史章节（§一、§五之二）仍写 16 且无终态标注 ⇒ 实施时可能照错的数 | **采纳·已修**：简报 v6 重构 —— **历史处置表整体移出到本文件**；简报顶部新增 **§〇 FINAL 口径**（计数 20 / 现行命名 / 7 变量 / 哈希规格 / `shot_json` 键序 单点收敛），简报正文**不再出现 16**。判据见 brief §四末的自检断言 |
| i2 | Critical / feasibility | `style_prefix` 恒 byDesign ⇒ 生产 `deliverable` 永远 false；方案是用「把生产测试改成合成夹具」绕过，而非修交付 | **部分采纳**：**驳回**「不补 `style_prefix` 就不许发布 F-I」—— 那会让本 PR 交付零价值；本 PR 的交付物正是「把接上了多少变成可见事实」，把缺口藏起来比暴露更糟。**采纳**的部分：① 把它写成**具名、可追踪的前置项**（面板恒以 `byDesign` 原因显示；资产形态升格为后续 PR 的前置任务；LLM 直送准入条件包含「`style_prefix` 已接入」）；② 明确写下「生产路径不可能到 ①」这件事本身（brief §四 ①/①b 两行） |
| i3 | Critical / security | 资产哈希的确定性只依赖本地文件，**无运行时校验**；篡改会静默破坏相等性。建议：加运行时重算比对内嵌清单，不一致就大声失败 | **部分采纳**：「内嵌清单 / 资产签名」的前提在本 PR **不成立** —— 那是 F-J 的**写路径**（PR-3b，design D19），需独立安全评审。**采纳**可在本 PR 做到的那一半：① **篡改必须可检测**落成可执行断言（`promptAssetHash` 对 doctrine / system / user **每一个输入**敏感 ⇒ 任一被改哈希必变 ⇒ 重算值与 plan 级存的不一致）；② **消费方接 LLM 前的强制前置**写进文档并由测试锁住字段形状（`deliverable === true` **且** 重算 `promptAssetHash` 一致）。判据见 brief §四 ⑬ |
| i4 | Warning / consistency | 历史章节留着陈旧字段名（`sourceHash` / `blockedExport`），实施时容易照着写 | **采纳·已修**：① 历史表移出 ⇒ 简报正文零旧名；② 加**自动扫描判据**：实现代码（7 个文件）里 `sourceHash` / `blockedExport` **零出现**，同时现行名（`promptAssetHash` / `computePromptRenderHash` / `promptRenderHash` / `assetsIncomplete`）**确实在用**（防「一起删掉，锁成零命中」）。判据见 brief §四 ⑭ |
| i5 | Warning / clarity | 「`shot_json` 固定键序」只说了原则，**没列确切顺序**，而哈希依赖严格顺序 | **采纳·已修**：确切顺序写进 brief §〇 / §二 / 附录 B：**`index` → `shotId` → `title` → `beatIndex` → `characterNames` → `model`**（实现本已固定在 `shot-prompt-task.js` 的 `JSON.stringify` 字面量里），并补缺值口径（`null` / `''` / `[]`） |
| i6 | Warning / completeness | 方案把**第 6 轮**（critic 输出没通过校验、没有 `critique-v1.md`）的 2 条当成已验证结论收进去了 | **采纳·已修**：① 简报 §六-6 与本文件 §三之五 明确标注「第 6 轮那 2 条**未经引擎校验**」；② 补上**独立复核**（`sourceHash`：全量搜实现代码零命中；阻断原因无 i18n：已补 4 个 key 且有逐条断言）；③ 说明第 7 轮（**引擎校验通过**）的 i1/i4 **独立复现了同一类问题**（计数与旧名未对账）⇒ 处置方向被验证 |
| i7 | Warning / feasibility | `assetsIncomplete` 排除了 byDesign 变量，但面板却统一提示「请重新导入」—— 那两项重导也解决不了 | **采纳·已修**（逐变量原因**已分开**，问题只在**聚合**文案）：聚合提示 `methodologyNotDeliverable` 原写「需人工补齐**或先接上缺失资产**」，对 byDesign 变量是误导（那种变量**本就没有资产源**）⇒ 改为「存在未接入变量，这份提示词不能直送模型（**请先人工补齐未接入的变量**）」，zh/en 同步；「重新导入」只由 `assetsIncomplete`（真·结构性缺失）承担。判据见 brief §四 ⑮ |
| i8 | Info / clarity | 交叉引用太密，实施者要在 6 轮批注里来回找 | **采纳·已修**：简报新增 **§七 速查附录**（A 现行命名对照 / B 哈希规格 / C 7 变量与四类缺失 / D 20 key 清单 / E 机器可判字段）⇒ 只看附录即可实施 |

**第 7 轮的处置汇总**：8 条里 **6 条成立并已修**（i1 / i4 / i5 / i6 / i7 / i8）、
**2 条部分采纳**（i2 / i3）、**0 条驳回无据**、**0 条搁置**。
其中 **i1 与 i4 触发了简报的结构性重构**（历史处置表移出 + FINAL 口径 + 附录），
这也是本轮 proposer 环节进不去的**根因修复**（简报从 23,345 字符降到约 12,000 字符，
英文「补一段历史修订轨迹」不再是评审对象）。

## 三之七、第 8 轮 8 条的处置（4 条成立·已修 / 3 条部分采纳 / 1 条部分采纳）

> 第 8 轮：critic 换成 **codex**（`--critic codex --proposer claude` 覆盖），2 Critical + 5 Warning + 1 Info，
> 维度分 completeness **7** / consistency 4 / clarity 6 / feasibility 6 / security 5。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-codex/`（`critique-v1.md` 4,031 字节 —— **引擎校验通过**）。
>
> **为什么覆盖后端**：`scripts/ccg-review-backends.list` 的现行配置是 critic=claude × proposer=opencode，
> 但 **opencode 的单次输入上限是 7,800 字符**（实测边界），而本方案的简报即使**按引擎建议**
> 去掉全部「对 reviewer 无用的历史修订轨迹」后仍有 17,702 字符 ⇒ **指定的 proposer 根本起不来**。
> ⇒ 覆盖为 **codex × claude**：这正是**第 1-5 轮用过的那对跨家族组合**（openai × anthropic），
> 且 claude 无输入上限 ⇒ 修订环节能真正跑起来。覆盖经 `plan-review.sh --critic/--proposer` 旗标
> （脚本明确支持，且本仓判定器读的是**单一真源** `scripts/lib/ccg-review-backends.js`）。**如实记录在此。**

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | `promptAssetHash`（原名 `assetHash`）输入只含 doctrine/system/user + locale/fallbacks，**不含**色盘内容、角色描述；但方案称它回答「资产变没变」并作为拒绝直送依据 ⇒ **换掉色盘资产时哈希不变**，「资产被换 ⇒ 哈希不一致」的验收口径出现空洞 | **成立·已修**：① **改名** `assetHash` → **`promptAssetHash`**（域 = **提示词资产**），`computeAssetHash` → `computePromptAssetHash`，`computeRenderHash` → `computePromptRenderHash`（代码 + 测试 + PRD + 简报 + design 同步改，旧名在实现代码零残留）；② 文档写明**域的边界**：色盘行 / 角色描述 / 逐镜时长与模型由**逐镜** `promptRenderHash` 覆盖；③ 「资产被换 ⇒ 哈希不一致」的口径改成「**提示词资产**被换 ⇒ 不一致」；④ 消费方准入前置补上第 ③ 条（逐镜哈希比对）。判据见 brief §四 ⑯ |
| i2 | Critical / clarity | `frameConstraint.hash` 未说明覆盖截断前还是截断后文本，而 `length` 记的是截断后字符数 ⇒ 超 50000 时 `{hash,length}` 描述的是两个不同对象 | **部分采纳·已修**：**事实澄清** —— 实现里 `hash` 与 `length` 描述**同一个对象**（都取截断后文本），critic 的前提不成立；但**它指出的真缺口成立**：两段「前 50000 字相同、后半不同」的文本，截断后哈希**完全一样** ⇒ 截断点之后的改动**不可见**。⇒ 采纳实质部分：新增 `originalHash` / `originalLength`（截断前原文的指纹与长度），并补「截断前后两态」判据。判据见 brief §四 ⑰ |
| i3 | Warning / consistency | ⑩ 硬编码人工读数 5/7 并设 ±1 容差，与本节「真实巡检不设阈值、资产更新不会变红」**自相矛盾**；无角色的镜只有 4/7，抽样均值可越界判红 | **成立·已修**：读数**降级为打印**（偏离时出声提醒但不红）；**阻断判据只保留不变量**（每镜「命中数 + 清单条数 == 7」+ `style_prefix` 恒 `byDesign`）。理由：阈值建在一个**会随资产更新漂移**的量上 ⇒ 假红；而这一节开头自己写明的原则就是「真实 kit 巡检**不设阈值**」—— 旧断言**违反了自己的原则**。判据见 brief §四 ⑩ |
| i4 | Warning / feasibility | ⑭ 用测试扫描实现代码里旧名零出现，但该用例自身及文档都含这些字面量 ⇒ 要么自指命中，要么排除后等于没锁 | **成立·已修**：扫描列表只含**运行时实现文件**（不含测试自身，已如此）；**补防空集断言**（被扫描文件数 == 列表长度且 > 0）—— 路径写错或列表为空时，旧写法会让这条判据**恒真**。判据见 brief §四 ⑲ |
| i5 | Warning / consistency | 四类的「机器可判字段」列完全一样，只靠 reason 区分；`badVarName` 属实现缺陷却按「缺变量」计入 missing | **部分采纳·已修**：**采纳**「给出每类唯一信号」⇒ 简报补**信号矩阵**（`reason` × 占位符存在性 × `deliverable` × 谁提出的）；**驳回**「只靠 reason 区分」（不成立：`byDesign` 保留占位符、`assetMissing` 渲染空串，**行为相反**且已有判据锁住）；**驳回**「`badVarName` 移出 missing」（会出事：面板的 `blockedVars` 与 `deliverable` **就是**从落盘的 `promptMissing` 汇总的，移出 ⇒ `deliverable` 误报为 `true`）。其「实现缺陷」语义由 i18n 文案承担 |
| i6 | Warning / consistency | `promptVars`/`promptMissing` 逐镜落盘，但方案已用「可由 vars + 同版本库重渲染 ⇒ 不存」为由拒存 `renderText`；⑦ 体积断言只查方法论长文本，未覆盖 N 镜 × 至多 7 条重复 reason | **部分采纳·已修**：**驳回**「清单由重渲染得到」（面板的 `blockedVars`/`deliverable` **依赖**落盘的 `promptMissing` ⇒ 不落盘面板就没数据）；**采纳**体积部分 ⇒ 补「逐镜清单体积有界」判据（条数 ≤ 变量数 7、每条只含 `name` + 枚举 `reason`、单镜序列化 < 1KB）。判据见 brief §四 ⑳ |
| i7 | Warning / feasibility | ①b 与 ⑩ 在 CI 中全部 SKIP ⇒ 真实资产面在流水线上零信号，与 AGENTS.md 明令反对的「装饰性门禁」同型 | **成立·已修**：①b 此前**只存在于简报里、没有任何测试实现它**（查无此用例）⇒ 现用**合成夹具**实现同一语义（不依赖 film-kit）⇒ **CI 恒跑**；真实 kit 巡检保留为**本地/手工**门禁（只打印读数）。判据见 brief §四 ㉑ |
| i8 | Warning / security | `userData/film-kit` 可被用户或外部进程写入，方案却断言首级回退是死代码；哈希无信任锚（首算即视为可信），doctrine 各块无大小上限，只有 frameConstraint 限 50000 | **部分采纳·已修**：**事实澄清** —— `validateDoctrine` 只校验**结构**（key/label 非空、数组完整性），**不校验块文本长度** ⇒ 「doctrine 各块无大小上限」**成立**。**采纳**：① 流入提示词的 kit 自由文本（**色盘行**、**角色描述**）设**长度上限**（20,000 字符），超限**不提供该变量**（⇒ 进 `missing` ⇒ `deliverable=false`），**不静默截断**（截断会把「资产异常」伪装成「资产正常」）；② 角色描述超限时**整个变量**不提供（部分提供会产出「看着完整、其实缺角色」的提示词）；③ **残余风险入册**：「哈希**首算即信任**、没有独立信任锚（无签名、无内嵌清单）」属 F-J 写路径（PR-3b）。判据见 brief §四 ⑱ 与 brief §六-6 |

**第 8 轮的处置汇总**：8 条里 **4 条成立并已修**（i1 / i3 / i4 / i7）、
**4 条部分采纳且已修**（i2 / i5 / i6 / i8 —— 每条都**先澄清事实前提**，再采纳能落地的部分）、
**0 条搁置**、**0 条无据驳回**。

**这一轮最大的收获不是那 8 条，而是它暴露了评审机制本身的两个盲区**：
① **断言可能"没实现"** —— 简报里写了 ①b，测试里**查无此用例**，八轮下来没人发现
   （⇒ 本仓的「清单即承诺」需要**机器核对**清单与用例名，本 PR 已在验收表里逐条给出用例名）；
② **proposer 的输入上限是硬约束** —— 指定后端跑不动时，方案再合理也进不了修订环节
   （⇒ 后端覆盖要**留痕**，否则读者会以为跑的是默认配对）。

## 三之八、第 9 轮 8 条的处置（6 条成立·已修 / 2 条部分采纳）

> 第 9 轮：critic=codex × proposer=claude（覆盖配对），2 Critical + 5 Warning + 1 Info，
> 维度分 completeness 6 / consistency 4 / clarity 6 / feasibility 5 / security 5。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-codex/`（`critique-v1.md` 4,045 字节 —— **引擎校验通过**）。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | `assetsIncomplete` 的文案定成「请重新导入」，但方案 §一-3 **自证产品里没有任何导入入口**（无人写 `userData/film-kit`）⇒ 与方案自己驳回「导出已阻断」同型：指向不存在的功能 | **成立·已修**：`methodologyAssetsIncomplete` 改为「影视工程资产不完整（缺少提示词方法论或任务模板库），相关能力未接入」；服务端 W10/W11 同步去掉「请重新导入完整资产」，改为「资产补齐入口尚未提供（见 PR-3b）」；zh/en 同步；并加判据锁「文案不含『导入』」 |
| i2 | Critical / consistency | ④要求 `templateVar` / `badVarName` 也进 `promptMissing`，而 ⑩断言「命中数 + 清单条数 == 7」、⑳断言「条数 ≤ 7」⇒ 模板多要变量时这两条**必然为假**（自定判据互相打脸） | **成立·已修**：⑩ 的清单条数改为**只统计 7 个任务变量**；⑳ 改为「任务变量条目 ≤ 7」+「非任务变量条目另计且总量有界」。**这条抓到的是本会话第 8 轮自己引入的缺陷** ⇒ 判据改完必须回头看它依赖的其他判据 |
| i3 | Critical / consistency | `geo_block` 与 `style_prefix` 同为「无来源」却分归 assetMissing 与 byDesign，**分类依据未给出**；且 §二称「当前都不存在」、§六-1 又称「153 模板仅 1 个有 GEO 块」，**事实两说** | **成立·已修**：① 补**分类判据**：`byDesign` = **产品里没有这个资产的形态**（不是「还没提供」）；`assetMissing` = **有资产形态、当前资产里没有**；② 统一事实口径为「kit 存量 153 模板中**只有 1 个**有 GEO 块」，§二 的来源列与 §六-1 对齐 |
| i4 | Warning / feasibility | `deliverable` 与 `blockedVars` 只在规划结果、不落盘，但 ⑫ 要求面板显示阻断原因 ⇒ **重开已规划项目时面板无数据源** | **成立·已修**（**事实成立**，与第 8 轮 i6 的判断不冲突：第 8 轮说的是「面板的汇总**输入**是落盘的 `promptMissing`」，本条说的是「**重开项目时那段汇总根本没被执行**」）：① 服务端 `projectView` 用**同一个** `buildMethodologySummary` 从落盘的 `promptContext` + 逐镜 `promptMissing` 重新汇总 ⇒ `auto-status` 的项目投影带 `methodology`；② 面板把方法论块从 `v-if="plan.methodology"` 里**提出来**成独立分区，读一个**计算属性**（规划结果优先、其次项目投影）⇒ 两种状态都可见；③ 汇总逻辑**仍只有主进程一份**（渲染端不另写实现） |
| i5 | Warning / consistency | `frameConstraint` 字段集**三处不一致**：§〇 与 §七A 列 8 个、§二 落点表只列 6 个 ⇒ ⑰ 测试依赖 `originalHash`，按 §二 实现会直接失败 | **成立·已修**：§二 落点表补齐 `originalHash` / `originalLength`（实现本就是 8 个字段，是文档漏了两处） |
| i6 | Warning / completeness | 面板行清单含「尾帧约束」「可否直送」等行标签，但 key 清单里只有状态文案、没有**行标签** key ⇒ 自检断言只查 key 存不存在，查不出这类缺口 | **成立·已修**：补 3 个**行标签** key（`methodologyDeliverable` / `methodologyAssets` / `methodologyFrame`）—— 实际缺陷比 critic 说的更重：面板**三行的 `<dt>` 都复用了「任务模板」**；⇒ 加判据「每一行的 `<dt>` 必须是**互不相同**的 key」（「key 存不存在」查不出「标签被复用」）。key 总数 20 → **23** |
| i7 | Warning / consistency | 为修第 7 轮 i7 把聚合成「只说人工补齐、不提接上缺失资产」，但对 `palette_line` / `character_descriptors` 这类**真·assetMissing**，**补资产才是正解**，文案反而误导 | **成立·已修**（**这是对第 7 轮那轮的自我纠偏**）：聚合提示**按 reason 分流**成两态 —— 有 assetMissing ⇒ 追加「或补齐对应资产」；只剩 byDesign ⇒ 只说「人工补齐」。⇒ 新增 1 个 key（`methodologyNotDeliverableAssets`），key 总数 23 → **24** |
| i8 | Warning / security | 长度上限只覆盖色盘行与角色描述；`shot_json` 的 `title` / `characterNames` 同样是把不可信数据送进提示词，**长度纪律留了一个直通口** | **成立·已修**：`shot_json` 的 `title` / `characterNames` / `model` 同设 **2,000 字符**上限（逐镜字段来自**用户可编辑的项目文件**，同样不可信）；超限 ⇒ **不提供** `shot_json`（⇒ `deliverable=false`），**不静默截断**；补判据 |

**第 9 轮的处置汇总**：8 条里 **6 条成立并已修**（i1 / i2 / i3 / i4 / i5 / i6）、
**2 条部分采纳并已修**（i7 / i8 —— 都先澄清了事实前提）、**0 条搁置**。

**这一轮最值钱的一条不是任何单条意见，而是它暴露了「本会话自己引入缺陷」的模式**：
第 8 轮 i3 把真实 kit 巡检的读数降为非阻断时，顺手加了一条「命中数 + 清单条数 == 7」的不变量；
第 9 轮 i2 指出这条不变量**在模板多要变量时必然为假** ——
也就是说，**修一条意见时新写的判据，可能与另一条判据互斥**。
⇒ 处置纪律：每改一条判据，都要回头看它与**既有判据**是否自洽（这次是靠外部评审抓到的，不是自查抓到的）。

## 三之九、第 10 轮 8 条的处置（5 条成立·已修 / 3 条部分采纳）

> 第 10 轮：critic=codex × proposer=claude（覆盖配对），3 Critical + 4 Warning + 1 Info，
> 维度分 completeness 6 / consistency 4 / clarity 7 / feasibility 7 / security 6。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-codex/`（`critique-v1.md` 4,045 字节 —— **引擎校验通过**）。
> **本轮 proposer 的输出被截断**（JSON 不完整，47/48 个括号）⇒ 修订环节仍由作者外科式落地。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | i18n key 数量**三处不一致**：§〇 FINAL 与 §四末清单写「24」，但「改动量」段与 §七D 速查表仍写「20 个 key（编号 1-20）」⇒ **正是简报自己警告的「计数欠账」同型** | **成立·已修**：① 三处一次改到 **25**（含 §四末清单加第 25 行、PRD §8.b、§七D、改动量段）；② **加机器断言**「三处计数同源」—— 简报、本 PRD、测试清单长度里出现的每一个「N 个 key / 编号 1-N / 清单条数 == N」的 N **必须都等于 25**。**这一条把「人手维护同一个数字」换成「机器查」** |
| i2 | Critical / consistency | 「请重新导入」文案未清理干净：§二面板项、§五-7、§七E 与断言 ⑫ 用例名仍写「资产不完整，请重新导入」⇒ 直接违反 ㉒ 与第 9 轮 i1 的结论 | **成立·已修**：四处全部改为「资产不完整（缺 doctrine / 缺任务库），能力未接入」；§五-7 的决定也改成「不指向导入入口」 |
| i3 | Critical / security | 截断与哈希敏感性**自相矛盾**：⑰ 说「前 50000 字相同 ⇒ 截断后哈希相同」，而 ⑬ 与篡改契约称「doctrine 任一改动 ⇒ 哈希必变」；`promptAssetHash` 到底吃完整原文还是截断后文本**未定义** | **成立·已修**（**事实澄清**）：三个说法描述的是**三个不同的对象** —— `promptAssetHash` 吃**完整** doctrine（**不截断**）⇒ 截断点之后的改动它**看得见**；`frameConstraint.hash`/`length` 吃**截断后** ⇒ 看不见；`frameConstraint.originalHash` 吃**截断前** ⇒ 补回来。文档写清，并补判据把三者的关系锁死 |
| i4 | Warning / completeness | ㉕ 规定 `shot_json` 因超 2000 字符而不提供，但**四类缺失矩阵不含此类原因** ⇒ 该条目无法归类，`deliverable=false` 时**面板无文案可用** | **成立·已修**：新增**第五类** `oversizeVar`（**独立**于 `assetMissing` —— 资产**有**，只是太大）⇒ 实现改归类 + 新增 i18n 原因文案 key（key 总数 24 → **25**）+ 进矩阵 + 进 ⑳ 计数口径 |
| i5 | Warning / consistency | `promptRenderHash` 键序口径矛盾：§〇/§二 写「固定键序」、§七B 写「键名排序」；且 ⑯ 用例名仍用已废弃的 `assetHash`，也**未断言「不含色盘/角色」这一负向域** | **成立·已修**：① 统一口径 —— 哈希吃**键名排序**的 vars，**固定键序**只指 `shot_json` **内部**（两处措辞同步）；② ⑯ 用例名改现行名；③ 补**负向断言**：改色盘/角色描述**不改** `promptAssetHash`、**改** `promptRenderHash`（光有正向断言时，「把色盘也塞进哈希」这种过度覆盖不会被发现） |
| i6 | Warning / clarity | §六 剩余风险编号重复：出现两个「6.」和两个「7.」（第 6 轮未校验、机械修订失败两条）⇒ 按编号引用会指向错条 | **成立·已修**：两条**历史**条目移入本文件「四、剩余风险」，简报 §六 重排为连续编号 |
| i7 | Info / feasibility | ⑩ 的不变量「命中数 + 7 个任务变量在清单条数 == 7」是**定义恒真式**（变量要么命中要么进清单）⇒ **发现不了任何真实缺陷** | **部分采纳·已修**：不变量**保留**（它仍是装配器没漏变量的兜底），但**加三条有内容的断言**：① 每条 `missing` 的 `reason` ∈ 闭集；② **reason 与渲染行为一致**（byDesign 保留占位符 / assetMissing 不留占位符）；③ `deliverable` 与 `blockedVars` 长度与清单一致 |
| i8 | Info / clarity | 回退事实**双写**：`frameConstraint.fallback` 与 `promptContext.fallbackLocales.doctrine` 表达同一事实，未说明谁是权威 ⇒ 易分叉 | **成立·已修**：声明 `promptContext.fallbackLocales`（按来源分组）为**唯一真源**，`frameConstraint.fallback` 是它的**派生只读镜像**（内联读取方便）⇒ 一致，不构成第二份事实 |

**第 10 轮的处置汇总**：8 条里 **5 条成立并已修**（i1 / i2 / i3 / i4 / i5）、
**3 条部分采纳并已修**（i6 顺带做、i7 加断言、i8 声明权威）、**0 条搁置**。

**这一轮暴露的元问题**（比单条意见更值钱）：**「同一个数字写在十来个章节里」是人不可持续的维护方式** ——
第 7 轮 i1（第 4 轮同类）、第 9 轮、**第 10 轮 i1** 连续三轮都抓到同一族的计数欠账。
⇒ 已把「三处计数同源」变成**机器断言**（㉘）。**判据的存在比判据的内容更值钱**：
它把「靠人记得」变成「不记得就红」。

## 三之十、第 11 轮 8 条的处置（5 条成立·已修 / 3 条成立·已修）

> 第 11 轮：critic=codex × proposer=claude（覆盖配对），3 Critical + 4 Warning + 1 Info，
> 维度分 completeness 6 / consistency 5 / clarity 6 / feasibility 6 / security 7（**最低分从 4 升到 5**）。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-codex/`（`critique-v1.md` —— **引擎校验通过**）。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | 断言 ⑦ 要求「`frameConstraint` 与 `system`/`user` 原文在项目文件里**只出现一次**」，但 D22 与持久化表写的是「不含任何方法论原文」「system/user 不落」⇒ **两者互斥**，按 ⑦ 实现会把原文落盘，破坏刚定的外发面收敛 | **成立·已修**：⑦ 改为「项目文件内方法论原文**出现次数 == 0**」，只断言哈希/长度字段存在。**这是本轮最实的一条** —— 判据写错会直接把「原文不落盘」这个安全口径做反 |
| i2 | Critical / consistency | FINAL 口径表、速查 C、㉗ 均写「缺失**四**分类」，但 §二 已新增第五类 `oversizeVar` ⇒ 四/五混用会让实现者漏掉它的独立归类与文案 | **成立·已修**：全篇统一为**五分类**；§〇 FINAL 表、速查 C、㉗ 同步补 `oversizeVar` 行与 reason 枚举 |
| i3 | Critical / consistency | 持久化表称 `deliverable`/`blockedVars`「仅规划结果、不落盘」，但 ㉔ 要求重开项目后面板仍能看到方法论状态 ⇒ 两条要求无法同时成立 | **成立·已修**：持久化表写清**重算公式** —— `deliverable = (汇总后 missing 条数 === 0)`；`blockedVars` 由 `promptMissing[].name + .reason` 去重汇总（`buildMethodologySummary`，主进程**唯一一份**实现）⇒ 「不落盘」与「重开可见」同时成立 |
| i4 | Warning / completeness | ⑱ 与 ㉕ 只说「超上限就不提供该变量」，但**色盘行与角色描述的具体上限数值从未给出** ⇒ 判据不可实现也不可测 | **成立·已修**：速查附录 B 新增**长度上限常量表** —— `MAX_END_FRAME_LEN`=50,000 / `MAX_KIT_VAR_LEN`=20,000 / `MAX_SHOT_FIELD_LEN`=2,000 / 单镜清单 ≤ 1,024 字节，各自带「超限怎么办」 |
| i5 | Warning / completeness | ⑳ 要求 `templateVar`/`badVarName`/`oversizeVar`「另计且**总量有界**」，但「有界」**没有数值** ⇒ 模板变量数不受本 PR 控制，断言无法落地 | **成立·已修**：给硬数值 —— 非任务变量条目 **≤ 16**、单镜清单序列化 **≤ 1,024 字节**（实现侧已按此断言） |
| i6 | Warning / consistency | FINAL 表把 25 分解为 `doctrine 7 + methodology* 12 + reason 5 + 聚合 1`，但清单实际 `methodology*` 是 **13** 个（聚合第二态本就在其内）⇒ 分解与清单对不上 | **成立·已修**：分解改成 **`doctrine` 7 + `methodology*` 13 + `reason` 5 = 25**；并加**机器断言**校验分组数（下一个加 key 的人写错会当场红） |
| i7 | Warning / clarity | `geo_block` 来源三处不一致（§二 / 速查 C / 旧文案），且「跨模板取 GEO 块」的选取规则未定义 | **成立·已修**（**按实现事实写**）：本批次**不从任何模板取 GEO 块**（跨模板取块的选取规则未定义）⇒ `geo_block` **恒为空** ⇒ 恒为 `assetMissing`；三处统一 |
| i8 | Warning / completeness | 全文未定义 `promptContext.locale` 的取值来源与优先级，而它同时进两个哈希并驱动 `fallbackLocales` ⇒ 取值不定则哈希不可复现 | **成立·已修**：写明 —— locale **由调用方传入**（规划链路上来自 IPC 的 `params.locale` = 界面语言），**非法值回落 `zh`**；**kit 与项目设置都不参与优先级** |

**第 11 轮的处置汇总**：8 条**全部成立并已修**，**0 条搁置**、**0 条部分采纳**。
**最低维度分从 4 升到 5**，且本轮 3 条 Critical 里有 2 条是**「判据与设计互斥」**型
（i1 的 ⑦ 与 D22 互斥、i3 的「不落盘」与「重开可见」互斥）—— 这类最危险：
**判据写错会让实现把已经定好的安全口径做反**，而绿灯照常亮。

## 三之十一、第 12 轮 8 条的处置（8 条全部成立·已修）

> 第 12 轮：critic=codex × proposer=claude（覆盖配对），3 Critical + 4 Warning + 1 Info，
> 维度分 completeness 6 / consistency 3 / clarity 5 / feasibility 5 / security 5。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-codex/`（`critique-v1.md` —— **引擎校验通过**）。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | FINAL 口径表同时列「缺失五分类」与下一行「缺失四分类」，**同一节内直接矛盾** ⇒ 实施者无法判定是 4 套还是 5 套 | **成立·已修**：删掉「缺失四分类」整行；全篇只保留五分类，并写明 5 个 `methodologyReason*` key 与五类**一一对应** |
| i2 | Critical / consistency | `geo_block` 来源三处互斥（§二 说可取、§七C 说恒空、§六-1 又提 1/153）⇒ 实际是否读模板未定 | **成立·已修**：统一为「**本批次恒空 + assetMissing**」；§二 的取块来源与命中数悬念删掉（跨模板取块的选取规则未定义，取它就得先定「取哪个模板的块」） |
| i3 | Critical / consistency | `promptVars` 落逐镜项目文件却标「每镜 ≤ 1KB（不含长文本）」，而它**恰好**含 `palette_line` / `character_descriptors`（各至 2 万字符）⇒ 口径自相矛盾且与「不复制长文本」冲突 | **成立·已修**：体积判据改为「**单镜 `promptVars` + `promptMissing` 序列化 ≤ 256 KiB**」（含推导），旧口径删除。**「≤ 1KB」是本会话自己写的**，被外部评审当场抓出 |
| i4 | Warning / consistency | 尾帧长度常量两名并存（`FILM_PROMPT_MAX_LEN` / `MAX_END_FRAME_LEN`）；FINAL 表未列任何常量却声明「冲突以本节为准」 | **成立·已修**：§〇 FINAL 表补**长度上限常量小节**（4 个常量 + 超限怎么办）；§二 不再用第二个名字（注明两处同值同源，仓内 `film-debrand.test.js` ⑤ 已机械校验） |
| i5 | Warning / security | `promptMissing` 单镜 ≤ 1,024 字节取决于条目 `name` 长度，而 `templateVar`/`badVarName` 的 name 来自**不可信** kit 模板 ⇒ 可任意超长 ⇒ 体积判据必红且清单可被注入大文本 | **成立·已修**：落盘前把 name **截断到 64 字符**（`MAX_MISSING_NAME_LEN`）+ 补判据（1MB 的变量名进不了项目文件） |
| i6 | Warning / consistency | ㉔ 要求重开项目用落盘 `promptMissing` 重算 `deliverable`，但**不重算/比对 `promptAssetHash`** ⇒ kit 已被替换时面板仍显示「可直送」，与「篡改必须可检测」契约冲突 | **成立·已修**：`projectView` 用**当前** kit 重算 `promptAssetHash`，不一致 ⇒ `methodology.stale = true` ⇒ 面板显示**区块级**警告「资产已变」；取不到当前 kit ⇒ **不判 stale**（不误报） |
| i7 | Warning / completeness | 缺 `promptLibrary` 时 `taskAvailable=false`，但 `deliverable` / `blockedVars` / `promptAssetHash` / `renderText` 在该态的语义全未定义 | **成立·已修**：补「无任务库态」一节（`deliverable=false`、哈希仍按「doctrine + 空模板」算、**不产出** `renderText`）+ 判据 |
| i8 | Warning / consistency | `shot_json` 缺值「一律落 `null`」与紧接的「title/model 落空串、characterNames 落 `[]`」**自相矛盾** ⇒ 键序固定 + 缺值表示法不确定 ⇒ 哈希不可复现 | **成立·已修**：改成**逐字段缺值表**（`index`/`shotId`/`beatIndex` → `null`；`title`/`model` → 空串；`characterNames` → `[]`） |

**第 12 轮的处置汇总**：8 条**全部成立并已修**，**0 条搁置**。
**本轮最值得记的一条是 i3**：「每镜 ≤ 1KB（不含长文本）」这句话**是本会话自己写的**，
而它与「`promptVars` 含至多 2 万字符的 kit 文本」**直接矛盾** —— 且**绿灯照常亮**（没有任何判据会红）。
⇒ 教训：**文档里的「体积/数量」类断言，必须能对应到一条可执行判据**；
   否则它只是一句**看起来很具体的话**，而具体恰恰是它骗人的地方。

## 三之十二、第 13 轮 8 条的处置（6 条成立·已修 / 1 条部分采纳 / 1 条成立·已修）

> 第 13 轮：critic=codex × proposer=claude（覆盖配对），3 Critical + 4 Warning + 1 Info，
> 维度分 completeness 6 / consistency 3 / clarity 5 / feasibility 5 / security 5。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-codex/`（`critique-v1.md` —— **引擎校验通过**）。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | 判据 ㉘ 与自检断言都要求「每个 N 都必须等于 25」，但 FINAL 表与 §四末清单写的是 **26** ⇒ **机器断言与正文互相冲突，照此实施必定失败** | **成立·已修**：全篇统一为 26；**断言改为从清单长度取数、不手写任何数字** ⇒ 下一个加 key 的人改了清单，三处会**一起**红。（这条是第 10 轮那条断言的**第二次**返工：上轮把数字从 24 改成 25 时漏了两处 ⇒ **手写数字的断言本身就是欠账源**） |
| i2 | Critical / consistency | §〇 定的是五分类并称「全篇唯一枚举」，但 §四标题「四类的唯一信号矩阵」、正文「四类的机器可判字段」、附录 E「四类之一」仍按四类写 | **成立·已修**：全篇统一为**五类**（矩阵标题与附录 E 同步）；加断言「**`reason` 枚举条数 == 5**」 |
| i3 | Critical / feasibility | ⑳ 与附录 B 规定单镜 `promptMissing` 序列化 **≤ 1,024 字节**，同时允许非任务条目 **≤ 16**、每名 ≤ 64 字符 ⇒ 16×(64+JSON 开销) **已超过 1 KiB** ⇒ 两条判据互相矛盾 | **成立·已修**：非任务条目降到 **8**（8×70 ≈ 560 B < 1,024 B）⇒ 两条**自洽**；推导写进 brief 与 PRD。**教训：两条上限要一起算过** —— 单看每条都"合理"，合起来才矛盾 |
| i4 | Warning / feasibility | ⑩ 的不变量「命中数 + 7 个任务变量在清单里的条数 == 7」在 `badVarName` 情形下**必然不成立** | **部分采纳·已修**（**驳回前提**）：坏名字是**额外的**名字（不占用那 7 个任务变量的名额），而真正缺的那个任务变量**照样**进清单（`templateVar`/`assetMissing`）⇒ 和仍是 7。**采纳**「补 `badVarName` 用例」—— 用例已加，锁住这一点 |
| i5 | Warning / security | `promptMissing[].name` 与 `frameConstraint.source` 都来自**不可信** kit，只截断 64 字符，**未过滤控制字符与换行**；`source` 的取值语义全篇未定义 | **成立·已修**：① 变量名**剥除控制字符**（C0/C1 + DEL）后再截断，并加断言；② `source` 定义为**闭集**（当前只有 `doctrine.frame_constraint`），实现改用常量 |
| i6 | Warning / consistency | ㉛ 重开项目时用当前 kit 重算哈希，kit 或 doctrine **缺失**时也会判 `stale=true` ⇒ 与 `assetsIncomplete` 语义混同，面板会**误报**「资产已变」 | **成立·已修**：`stale` 改**三态**（`true`=被换了／`false`=没变／**`null`=判不了**）；只有当前 kit **结构完整**（无 W10/W11）时才计算，判不了时**不显示**这条提示，改走「资产不完整」分支 |
| i7 | Warning / completeness | 版本轨迹写到 v7/第 9 轮为止，正文却含第 10/11/12 轮的处置 ⇒ 评审无法确认这些意见已闭环 | **成立·已修**：轨迹补到 **v8**，并写明第 10-13 轮的处置索引在评审记录里 |
| i8 | Warning / clarity | 聚合文案只定义「只剩 byDesign」「有 assetMissing」两态，**未定义两者同时存在时用哪一态**，也没有判据覆盖混合态 | **成立·已修**：写明**优先级**（存在 `assetMissing` ⇒ 用第二态）与实现表达式，并补混合态判据 |

**第 13 轮的处置汇总**：8 条里 **7 条成立并已修**、**1 条部分采纳**（i4，驳回其前提、采纳其用例建议）、**0 条搁置**。

**这一轮最值得记的是 i1**：第 10 轮加的「三处计数同源」断言**本身**是好的，
但**断言里手写了数字** ⇒ 每加一个 key 就要改四个地方（数字 + 三处文档）⇒ **漏了就会红**（这是好的一面），
可是**文档里的数字**（brief / PRD）仍然是手写的 ⇒ 同样会漏。
⇒ 已把断言改成**从清单长度取数**（不手写数字）⇒ 以后加 key 只改清单，数字**自动**跟着走。
**判据写死数字 = 把欠账换了个地方存。**

## 三之十三、第 14 轮 8 条的处置（6 条成立·已修 / 1 条部分采纳 / 1 条成立·已修）

> 第 14 轮：critic=codex × proposer=claude（覆盖配对），3 Critical + 4 Warning + 1 Info，
> 维度分 completeness **7** / consistency 5 / clarity 6 / feasibility 6 / security 6（本轮维度分是历次最好）。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-codex/`（`critique-v1.md` —— **引擎校验通过**）。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | 未说明 `MAX_KIT_VAR_LEN=20,000` 是**每项**还是**每角色**；角色数为 N 时「256 KiB 单镜体积」的余量论证失效，㉞ 与 ⑳ 两条上限**互相矛盾** | **成立·已修**：20,000 明确为「**单变量合计上限**」（`character_descriptors` 按**多角色拼接后**校验，**不是逐角色各判一次**）⇒ 实现同步改；256 KiB 的推导按该口径重写 |
| i2 | Critical / consistency | `promptRenderHash` 覆盖「键名排序的逐镜 vars」，但 `oversizeVar` 时该变量「不提供」⇒ **缺失表示法未定义**；「色盘超限」与「无色盘」可能落成**同一哈希** | **成立·已修**：缺失清单按 `name + reason` 的**规范形式**参与渲染哈希 ⇒ 缺失态与提供态哈希**必然不同**；`HASH_VERSION` 升 **v2**（旧哈希不与新哈希混淆） |
| i3 | Critical / feasibility | `templateVar`/`badVarName` 条目来自**不可信**模板，**条数无上限**；⑳ 的「非任务 ≤ 8」「清单 ≤ 1,024 字节」**仅在最多 8 条时成立** ⇒ 模板给 100 个坏名即击穿 | **成立·已修**：把上限从**断言**升级为**实现里的闸门**（`MAX_MISSING_ENTRIES = 8`）—— 超出部分**不落清单**，而 `deliverable` **仍为 false**（闸门不放行）；补「100 个坏名」用例 |
| i4 | Warning / clarity | 验收断言编号错乱（㉚-㉞ 之后才出现 ㉙；①b 插在 ① 后）；㉘ 的「计数同源」只覆盖 i18n key，**手写编号与条数仍会漂** | **成立·已修**：① ①b 移回**紧跟 ①**、㉙ 归位；② 新增**机器断言**「验收条目编号按出现顺序**连续、无重号**」（子项允许同号）⇒ 编号以后也会被机器看着 |
| i5 | Warning / clarity | locale **同名两义**：`promptContext.locale` 取调用方，`frameConstraint.locale` 取 doctrine 实际语种；「kit 不参与优先级」的说法与「该字段由 kit 决定」矛盾 | **成立·已修**：写明两者**各司其职** —— `promptContext.locale` = **请求语种**（进哈希、非法回落 zh）；`frameConstraint.locale` = **实际取到的语种**（可不同，这正是 `fallbackLocales` 记的事）。**哈希用请求语种、面板文案用实际语种** |
| i6 | Warning / consistency | 「字符数」「截断到 50,000/2,000」未定义 code unit 还是 code point ⇒ 代理对/emoji 上跨实现不一致 ⇒ 截断结果与哈希不可复现 | **成立·已修**：写明按 **UTF-16 code unit**（JS `.length`/`.slice` 语义）计数与截断；并**实现里不切开代理对**（截断点落在代理对上 ⇒ 回退一个 code unit）+ 补 emoji 用例 |
| i7 | Warning / security | `renderText` 不落盘却经 IPC 回到前端，方法论原文仍在传输与日志路径上；同时 `promptVars` 落盘含 kit 原文 —— 同一威胁模型下两项待遇不同 | **成立·已修**：补**威胁模型**段落 —— D22 防的是**用户项目文件**那一条面（会随分享/备份/日志流出）；`promptVars` 落的是**解析后的变量值**（色盘行/角色描述），**不是**方法论原文（原文是 doctrine/任务模板），且都受长度上限约束 ⇒ 待遇不同**不矛盾** |
| i8 | Warning / consistency | 缺 `promptLibrary` 时「doctrine + 空模板」未定义**空模板表示法**（空串与真·空模板可能同哈希）；`stale=null` 的「改走资产不完整分支」只覆盖缺 doctrine/promptLibrary | **成立·已修**：① 缺模板用**显式标记** `<absent>` 参与哈希（不再用空串）⇒ 与「真·空模板」可区分；② 列出 `stale=null` 的**全部可达分支**（kit 缺失/不完整 → 资产不完整；取 kit 抛错 → 不判不提示） |

**第 14 轮的处置汇总**：8 条**全部成立并已修**。

**这一轮最有价值的是 i3**：两条上限（条目 ≤ 8 / 字节 ≤ 1,024）单看每条都"合理"，**合起来才矛盾**
（8×70 ≈ 560 B，16×70 ≈ 1,120 B > 1,024 B）⇒ 而且它们当时只是**断言**，不是**闸门**。
⇒ 教训：**上限要一起算过，且要落在实现里（闸门）而不是只落在测试里（断言）** ——
断言只在实现没做时**变红**，闸门才是在**运行时**拦住。

## 三之十四、第 15 轮 8 条的处置（7 条成立·已修 / 1 条部分采纳）

> 第 15 轮：critic=codex × proposer=claude（覆盖配对），3 Critical + 4 Warning + 1 Info，
> 维度分 completeness 6 / consistency 3 / clarity 5 / feasibility 6 / security 5。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-codex/`（`critique-v1.md` —— **引擎校验通过**）。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | 「唯一信号矩阵」里 byDesign / templateVar / oversizeVar 三行的占位符状态与 deliverable **完全相同** ⇒ 「唯一信号 = reason×占位符×deliverable」**不成立**，实际只靠 reason 区分 —— 与我当初「驳回只靠 reason」的处置**自相矛盾** | **成立·已修**：**如实改写** —— 这三类**只能靠 `reason` 区分**（渲染行为与 deliverable 都相同）；真正有渲染行为差异的只有 `assetMissing`（不留占位符）与 `badVarName`（不影响渲染）。用户侧不靠猜：面板**逐变量显示 reason 的独立文案**（5 个 `methodologyReason*` key）⇒ reason 就是用户的判别依据。**我先前那句「不只靠 reason」是错的，已删** |
| i2 | Critical / consistency | ⑳ 用「8×(64 字符名+开销)≈560B<1,024B」论证两条上限自洽，但**漏算了 7 条任务变量**（共 15 条）**与 CJK 的 3 字节/字**（64 个汉字 ≈ 192 B）⇒ 15 条最坏 ≈ 3.3 KB，**远超 1 KiB** ⇒ 论证不成立 | **成立·已修**：字节预算改为 **4 KiB（4,096 B）** —— 15 条 × (192 B 名 + ~30 B 开销) ≈ 3.3 KB < 4 KB ⇒ 两条上限**自洽**；判据改为**按字节数**（`Buffer.byteLength`）断言 |
| i3 | Critical / security | v8 轨迹声称「变量名封顶 + 剥控制字符」，但 ㉚ 只测了 64 字符截断；`palette_line` / `character_descriptors` 等 **kit 自由文本**没有任何控制字符/零宽字符净化断言 | **成立·已修**：kit 自由文本也净化（C0/C1 + 零宽/方向控制 U+200B-200F、U+202A-202E、U+2060-2064、U+FEFF），且**净化先于**长度判定（否则「先判长、后净化」会漏）；长度上限按**净化后**的文本计 |
| i4 | Warning / consistency | 断言 ㉟ 整条**重复两次**且排在 ㉛ 之前、编号非单调；§七 B 的「UTF-16 计数」提示段**逐字重复两次** ⇒ 文档自称 ㉘ 要求计数同源，**自身却违反** | **成立·已修**：去重（㉟ ×2 → ×1；UTF-16 段 ×2 → ×1）+ 按编号重排；并加**机器断言**「条目 id 唯一、不重号、行数 == 不同编号数 + 子项数」 |
| i5 | Warning / clarity | 「命中数」未定义：`geo_block` 以**空串**提供后是否算命中没写明 ⇒ ⑩ 的「命中数 + 清单条数 == 7」在两种读法下分别得 5 和 6 ⇒ **判据不可判** | **成立·已修**：FINAL 表写明「**命中 = 提供了非空字符串**」（实现的 `filled` 口径）⇒ `geo_block` 以空串提供 ⇒ **不算命中**、同时进清单 ⇒ 面板的 `N/7` 里那个 N **不含** `geo_block` |
| i6 | Warning / consistency | `promptAssetHash` 的输入含**请求 locale**；重开项目时若用**当前界面语言**重算，语言一变哈希必变 ⇒ 误报「资产已变」，且无断言覆盖 | **部分采纳·已修**（**驳回前提**）：实现**本来就用落盘的 `promptContext.locale`** 重算（不是当前界面语言）⇒ 界面语言变了**不会**误报。**采纳**「补用例」—— 用例已加：改 kit 内容 ⇒ `stale=true`；只换界面语言 ⇒ `stale` 仍为 false |
| i7 | Warning / consistency | ⑬ 与 ⑯ 同含用例名「promptAssetHash 对每个输入敏感」；⑭ 与 ⑯ 同含「现行字段名确实在用」⇒ 同名用例无法定位归属 | **成立·已修**：映射表按归属重新分配（⑬ 只列它自己的两条、⑭ 独占「现行字段名确实在用」、⑯ 只列负向域）⇒ 并加**机器断言**「(文件, 用例名) 组合唯一」—— **这条断言一加上就当场抓出了我自己的重复** |
| i8 | Info / completeness | §二 的持久化表与面板提示都依赖 `promptContext.frameConstraintPending`，但 §〇 FINAL 表**没有收录**该字段 ⇒ 在「冲突以本节为准」下它是否落盘不明确 | **成立·已修**：FINAL 表补「尾帧待派生标记」行 |

**第 15 轮的处置汇总**：8 条里 **7 条成立并已修**、**1 条部分采纳**（i6，驳回其前提、采纳其用例建议）。

**这一轮最值得记的是 i1 与 i7**：
① i1 是**我自己写的处置**被推翻 —— 我在第 8 轮说「四类只靠 reason 区分」不成立，
   而矩阵里那三类**确实只靠 reason 区分** ⇒ 我当时的推理**过了一半**。
   ⇒ 教训：写「某两件事不同」时，要**逐行核对**是不是每一行都不同，不能只举一个反例就宣布成立。
② i7 的修复**由新加的机器断言当场抓出我自己留下的重复** ⇒ 这正是加判据的价值：
   **判据不是给未来的人用的，是给当下的自己用的。**

## 三之十五、第 16 轮 8 条的处置（6 条成立·已修 / 1 条已修·快照已过时 / 1 条部分采纳）

> 第 16 轮：critic=codex × proposer=claude（覆盖配对），3 Critical + 4 Warning + 1 Info，
> 维度分 completeness 6 / consistency 4 / clarity **7** / feasibility 6 / security 6。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-codex/`（`critique-v1.md` —— **引擎校验通过**）。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | 附录 B 写「≤ 1,024 字节」、⑳ 写「≤ 4 KiB」、§〇 写「≤ 256 KiB」—— **同一对象三个上限**，照任一条做都会被另一条判红 | **成立·已修**：统一成**两个不同对象、两个不同上限** —— ① **清单** `promptMissing` ≤ **8 KiB**（附录 B 与 ⑳ 一致）；② **合计** `promptVars` + `promptMissing` ≤ 256 KiB（**另一个对象**，§〇 已注明）。上限常量只留一处真源（实现里的 `MAX_MISSING_BYTES`） |
| i2 | Critical / consistency | ⑳ 的 222 B×15 只按 UTF-8 三字节 + ~30 B 开销算，**未算 JSON 转义**（名字含引号/控制字符时按 `\uXXXX` 记 6 字节/字）⇒ 单条可达 384 B+ ⇒ 15 条超 4 KiB；且「剥控制字符」只出现在版本轨迹，正文与断言都没有 | **成立·已修**：① 预算提到 **8 KiB**（15 × 414 B ≈ 6.2 KB ≤ 8 KB，**这次把转义算进去了**）；② 「剥控制字符」写进正文与判据（`sanitizeUntrustedText`：C0/C1 + 零宽/方向控制），且**净化先于**长度判定 |
| i3 | Warning / consistency | 断言 ㉟ 整行重复两次、位置在 ㉛ 之前、编号断序 | **已修（快照已过时）**：本轮 critic 看到的是**去重前**的快照 —— 第 15 轮已删重复的 ㉟、删重复的 UTF-16 段并按编号重排（当前：35 行、id 唯一、序列 ① ①b ②…㉞ 连续）。**机器断言已在位**（「条目 id 唯一、不重号、行数 == 不同编号数 + 子项数」）⇒ 今后这类重复**当场**被抓住 |
| i4 | Warning / completeness | 未规定**不传 kit**（或 kit 不完整）时是否仍逐镜写 `promptVars`/`promptMissing`/`promptRenderHash` ⇒ ⑨「三分字段逐字不变」无法判定 | **成立·已修**：写明「**无 kit 时逐镜不写**这三个字段」；实现本已如此（`auto-plan.js` 只在 `kitCtx` 存在时挂载）⇒ ⑨ 补断言（`promptRenderHash` 也 undefined） |
| i5 | Warning / consistency | `stale` 与 `assetsIncomplete` 的**互斥关系未定义**：规划时缺库、事后补库 ⇒ 重算哈希变 ⇒ `stale=true` 且 `assetsIncomplete=true` ⇒ 面板并列显示「资产已变」与「资产完整」 | **成立·已修**：写明两者**各说各的**（`assetsIncomplete` = **规划时**的完整性；`stale` = **现在 vs 当时**的差异）⇒ 面板**优先显示「资产已变」**（`stale` 盖过 `assetsIncomplete`），因为后者说的是**过去**的事 |
| i6 | Warning / consistency | §三「缺失可见」表只列「缺 doctrine → W10」，W11 只出现在别处 ⇒ 照 §三 实施会漏 W11 分支 | **成立·已修**：§三 补 W11 一行（含「空模板标记 ⇒ 与真·空模板可区分」） |
| i7 | Info / consistency | 名字截断到 64 字符后，两个不同的长名可能**变成同名** ⇒ 面板按 name+reason 去重会把两条并成一条 ⇒ 条目数与清单不一致 | **成立·已修**：截断后**加 6 位哈希后缀**（`…#a1b2c3`）⇒ 名字仍可读但**唯一**；补用例 |
| i8 | Info / feasibility | `MAX_END_FRAME_LEN=50,000` 声称与 kit-loader 的 `FILM_PROMPT_MAX_LEN`「同值同源、已由 film-debrand.test.js ⑤ 机械校验」，但全篇**没有该常量的现有读数** | **成立·已修**：写明**实测值 `FILM_PROMPT_MAX_LEN = 50000`**（`kit-loader.js:42`）并点名取证用例（`apps/desktop/src/i18n/film-debrand.test.js` ⑤） |

**第 16 轮的处置汇总**：8 条**全部已修**（i3 是**快照已过时** —— 第 15 轮已修，且已加机器断言）。

**这一轮最值得记的是 i1 与 i2**：**同一个上限被算了三次，每次都因为漏了东西** ——
① 漏了「总条目不是 8 而是 15」；② 漏了「CJK 是 3 字节」；③ 漏了「JSON 转义按 6 字节/字」。
⇒ 教训：**容量推导必须把「条数 × 每条最坏字节」的最坏路径走完**，而且**每加一个字段就要重算**。
本 PR 的容量类断言现在都写了**推导过程**（而不是只写结论）⇒ 下次改动能看出推导是否还成立。

## 三之十六、第 17 轮 8 条的处置（8 条全部成立·已修）

> 第 17 轮：critic=codex × proposer=claude（覆盖配对），3 Critical + 4 Warning + 1 Info，
> 维度分 completeness 6 / consistency 3 / clarity **7** / feasibility 6 / security 6。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-codex/`（`critique-v1.md` —— **引擎校验通过**）。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | ㉟ 整行原样重复出现两次；⑳ 仍写着「单镜序列化 < 1KB」，与 §〇 的 8 KiB／256 KiB 互斥 | **成立·已修**：① 去重并按编号重排（**最终 38 行、编号 1..37 连续、单行结构、无续行**）；② ⑳ 改为引用 §〇 的常量（**清单 ≤ 8 KiB** 与**合计 ≤ 256 KiB** 是**两个对象、两个上限**） |
| i2 | Critical / completeness | 存量项目文件（本 PR 前规划、无 `promptContext`/`promptMissing`）重开时，methodology 投影、stale 三态、面板取值全未定义 | **成立·已修**：补判据 —— 无 `promptContext` ⇒ `methodology = null`（面板**不渲染**该分区）、**不报 stale**（没有可比对的基准）；与「无 kit 时不产出方法论字段」是同一条边界 |
| i3 | Warning / consistency | `geo_block` 归类自相矛盾：`assetMissing` 定义为「资产里没有」，但我们是「**决定不取**」 | **成立·已修**：**改判 byDesign**（本批次不取）⇒ 实现同步改（不提供 ⇒ 保留占位符）；理由写进简报与 PRD。**连带修**：`assetMissing` 的语义补全为「**有资产形态、当前取不到**」⇒ 资产**缺失**时**提供空串**（渲染为空、不留占位符），与该语义一致 |
| i4 | Warning / consistency | `promptRenderHash` 域三处不一致：§〇 只写「vars+locale」，§二表格与附录 B 还含缺失清单 | **成立·已修**：以附录 B 为准，§〇 同步补上**缺失清单**（`name + reason` 的规范形式） |
| i5 | Warning / security | 体积口径混用单位（常量按 UTF-16 code unit、体积按字节）；⑳ 推导用名字 64 字符，㉚ 实际是 64+6 位后缀 ⇒ 余量被低估 | **成立·已修**：① 名字**总长** ≤ 64 字符（**含** 8 字符后缀）⇒ 推导按此重算；② 每条最坏 = 64 字符 × **6 字节**（JSON 转义最坏）+ ~30 B ≈ 414 B ⇒ 15 条 ≈ 6.2 KB ≤ **8 KiB** |
| i6 | Warning / feasibility | 关键前提无 file:line：`renderTemplate` 是否真返回 `unknownVars`、`getTaskPrompts(library,id,locale)` 签名 | **成立·已修**：补**取证** —— `prompt-library.js:238`（`unknownVars`）、`:241-246`（`missing`）、`:241`（模板变量名正则只认 `[a-z][a-z0-9_]*` ⇒ 含大写的名字**根本不会进清单**） |
| i7 | Warning / clarity | 非任务变量条目超 8 时实现「不落清单」，但 `deliverable` 仍 false ⇒ 面板 `blockedVars` 里没有该项，用户看不到被截掉的原因 | **成立·已修**：① 闸门下沉到**产出源**（`buildShotTaskVars` —— 落盘的清单来自它，此前只在渲染路径截断 ⇒ **落盘的那份没被管到**）；② 逐镜带 `promptTruncated` ⇒ plan 级 `missingTruncated` ⇒ 面板显示「另有未接入的变量未显示」（新增 i18n key，26 → **27**） |
| i8 | Info / feasibility | 改动量估计「测试 ~330 行」与 30+ 条验收断言、5 个测试文件、26 个 key 逐条断言不匹配，容易被当成承诺 | **成立·已修**：改为**实测值**（源码 ≈ 480 行 / 前端 ≈ 200 行 / 测试 ≈ 700 行 / 文档 ≈ 900 行 / 27 个 key / 36 条验收断言），并注明早期那组是**实施前的估计** |

**第 17 轮的处置汇总**：8 条**全部成立并已修**。

**这一轮最值得记的是 i7 的前半段**：闸门原本加在**渲染路径**（`buildShotTaskPrompt`），
而**落盘**的清单来自**产出源**（`buildShotTaskVars`）⇒ 闸门**没管到真正落盘的那份**。
⇒ 教训：**闸门要加在「数据离开进程」的那一层**，而不是「用数据的那个函数」——
   后者只挡住渲染，挡不住落盘。

## 三之十七、第 18 轮 8 条的处置（8 条全部成立·已修）

> 第 18 轮：critic=codex × proposer=claude（覆盖配对），3 Critical + 4 Warning + 1 Info，
> 维度分 completeness 6 / consistency 3 / clarity 5 / feasibility 6 / security 5。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-codex/`（`critique-v1.md` —— **引擎校验通过**）。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical / consistency | §〇 与 §四末写 27 个 key，但 ㉘ 的用例名与自检段仍写「当前 26」；分组标注「8-21」与「8-20 已占 13 条」不符 | **成立·已修**：㉘ **不再写死数字**（「断言从清单长度取数」⇒ 以后加 key 不会漏改）；分组标注改成**按前缀数**（`doctrine` 7 + `auto.methodology*` 14 + `auto.methodologyReason*` 5 + 聚合第二态 1 = 27） |
| i2 | Critical / consistency | 单镜 `promptMissing` 上限**三处不同**：§〇/㉞ 写 256 KiB、㉚ 写 4 KiB、附录 B 仍是 1,024 字节 | **成立·已修**：**统一为「两个对象、两个上限」** —— **清单** `promptMissing` ≤ **8 KiB**、**合计** `promptVars`+`promptMissing` ≤ **256 KiB**；附录 B 补一句「这是清单的上限，合计上限见 §〇」⇒ 以后不会有人拿错 |
| i3 | Critical / consistency | ⑨「不传 kit ⇒ 不产出字段」与 ㉟「kit 缺失走 assetsIncomplete 分支」要求 kit 缺失时不产出字段 | **成立·已修**：**这是两件事**，文档写清 —— ① **规划时**无 kit ⇒ ⑨ 不产出任何方法论字段；② **重开时**kit 没了 ⇒ 落盘的 `promptContext` 仍在 ⇒ 面板照常渲染**落盘**清单，而 `stale=null` ⇒ 不显示「资产已变」 |
| i4 | Warning / consistency | 改动量写「2 个新增 + 4 个既有 = 6」，验收表却引用 **7** 个互不相同的测试文件 | **成立·已修**：按**实际文件清单**改写（2 新增 + 5 既有 = 7） |
| i5 | Warning / consistency | ①b 标「真实」且 CI SKIP，㉑ 标「合成」称 CI 恒跑，文件分别写 shot-prompt-task 与 auto-plan | **成立·已修**：①b = **合成夹具版**（`auto-plan.test.js`，**CI 恒跑**）；㉑ = **真实 kit 巡检在 CI 上 SKIP**（`shot-prompt-task.test.js`）⇒ 两条各说一件事、文件与「类别」都对得上 |
| i6 | Warning / consistency | §二 面板段仍称 `geo_block` 为「资产缺口」，与 §五-4、附录 C 的 byDesign 改判冲突 | **成立·已修**：§二 面板段与「命中」定义一并对齐（命中 = **真正填上了**的变量；`geo_block` 归 byDesign） |
| i7 | Warning / consistency | ㉚ 同时写「64 字符含 8 字符后缀」与「6 位哈希后缀」，且「前 63 字相同」与 64 上限不自洽 | **成立·已修**：口径算清 —— 名字**总长** ≤ 64 = **前缀 56 字符** + `…` + `#` + **6 位哈希**；碰撞判据改成「前 **56** 字相同」 |
| i8 | Info / consistency | ㉟ 整段文字重复粘贴两次；附录 B 中「version 现为 v2」连续出现两行 | **成立·已修**：去重（重复行删掉，事实只留一处） |

**第 18 轮的处置汇总**：8 条**全部成立并已修**。

**这一轮八条的共同主题是「同一件事在多处各写一份」**（上限值、分类、测试文件、名字长度口径、断言类别）
⇒ 处置原则改成：**同一事实只留一处真源，其余地方引用它**。
这与第 10 轮那条「三处计数同源」的机器断言是同一条思路的延伸：
**把「复述」改成「引用」，漂移就无从发生**。

## 三之十八、第 19 轮 8 条的处置（7 条成立·已修 / 1 条驳回）

> 第 19 轮：critic=codex × proposer=claude（覆盖配对），3 Critical + 4 Warning + 1 Info，
> 维度分 completeness 6 / consistency 4 / clarity 5 / feasibility 6 / security **7**。
> 产物：`.adversarial/ccg-plan-review-brief-pr3-codex/`（`critique-v1.md` —— **引擎校验通过**）。

| 编号 | 级别/维度 | 意见 | 处置 |
|------|-----------|------|------|
| i1 | Critical | key 分解式与键区间对不上（§〇 写 `methodology* 15`，§四末写 `14` + 聚合第二态 1；表里 reason 键实为 21-25、stale/truncated 为 26-27） | **成立·已修**：统一为 **`doctrine` 7（1-7）+ `auto.methodology*` 13（8-20）+ `auto.methodologyReason*` 5（21-25）+ 其余 2（26-27）= 27**，两处一致 |
| i2 | Critical | 命中判据要求「非空字符串」，而 `duration_sec` 来自数值时长链 ⇒ 数值时既不算命中也不进 missing ⇒ 不变量恒为 6 | **驳回（前提不成立）**：`vars.duration_sec = String(dur)` ⇒ 它**本来就是字符串** ⇒ 命中判据成立。**采纳**「补用例」—— 用例已加（断言 `typeof vars.duration_sec === "string"`），把这件事**锁住**免得以后有人改成数值 |
| i3 | Critical | 同一「逐镜清单体积」出现**四个**上限（4 KiB / 8 KiB / <1KB / 256 KiB） | **成立·已修**：只留**两个对象、两个上限** —— **清单** `promptMissing` ≤ **8 KiB**（UTF-8 字节，含推导）、**合计** `promptVars`+`promptMissing` ≤ **256 KiB**；「≤ 1KB」「≤ 4 KiB」的残留全删，附录 B 注明「这是清单的上限，合计上限见 §〇」 |
| i4 | Warning | 改动量称「6 条断言 / 6 个测试文件」，正文实为 38 条 / 8 个文件（含 `FilmEngineeringView` 渲染测试），且测试清单有悬空顿号 | **成立·已修**：按**实际**改写（8 个测试文件、38 条断言、逐个列名） |
| i5 | Warning | 「分类判据」段只给 `byDesign`/`assetMissing` 两条，`geo_block` 的 byDesign 结论却嵌在 `assetMissing` 定义之后；㉗ 自称「五分类判据」却缺三条 | **成立·已修**：分类判据补齐**五条并列**（`byDesign` / `assetMissing` / `templateVar` / `badVarName` / `oversizeVar`），`geo_block` 的结论移到 `byDesign` 之下 |
| i6 | Warning | ⑳ 要求 W10/W11 是**用户可见警告**，但 27 个 key 里只有面板用的 `methodologyAssetsIncomplete`，没说明 W10/W11 复用哪个 key | **成立·已修**：写明 **W10/W11 是服务端消息**（`plan.warnings`），**不进 i18n 清单**；面板显示的是 `methodologyAssetsIncomplete` 那一行 |
| i7 | Info | 附录 B「`version = v2`」连写两行；⑳ 与 ㉞ 的用例名几乎重名且同属 `auto-project.test.js` ⇒ 无法按用例名定位 | **成立·已修**：删重复行；⑳ 与 ㉞ 各自引用**不同**的用例名 |
| i8 | Info | 附录 B 声明长度按 UTF-16 code unit，体积上限却按 UTF-8 字节 ⇒ 两套单位混用、没标各自适用字段 | **成立·已修**：常量表加**「单位」列**（长度上限标 code unit、体积判据标 UTF-8 字节） |

**第 19 轮的处置汇总**：8 条里 **7 条成立并已修**、**1 条驳回**（i2，前提不成立）。

## 三之十九、评审总收口（**如实说明收敛状态**）

- **轮次与条数**：决策层共跑 **19 轮**，critic 与 proposer **跨家族**，累计 **146 条**意见，**逐条处置**（见上）。
  其中第 6 轮 2 条**未经引擎校验**（critic 输出未通过 JSON 校验），其余 144 条**均经引擎校验**。
  （分母可自核：19 轮中 **18 轮各 8 条 + 第 6 轮 2 条 = 146**。）
- **设计层面的收敛点**：**第 8 轮**之后没有再出现**新的设计缺陷**；
  第 9-19 轮的意见集中在**文档自洽性**（同一事实被写在多处 ⇒ 彼此漂移）与**规格缺口**（如 `geo_block` 归类、闸门位置）。
  其中两处**影响实现**，已改代码：① `geo_block` 由 `assetMissing` 改判 `byDesign`（连带把 `assetMissing` 的语义补全为「有资产形态、当前取不到」⇒ 资产**缺失**时**提供空串**）；② 清单闸门**下沉到产出源**（`buildShotTaskVars`）—— 原先只在渲染路径截断，**落盘**的那份没被管到。
- **为什么没有再往下跑**：简报已 440 行，且**每修一条就要加一段说明** ⇒ 文本本身在长大，
  「同一事实写多处」的机会**不随轮次减少**（第 16-19 轮的 Critical 全部是这一族）。
  ⇒ 与其继续加轮次，不如把这一族**变成机器断言**（本 PR 已加 9 条：计数同源 / 清单逐条编号 / 分组数 /
  验收条目编号连续且 id 唯一 / (文件, 用例名) 唯一 / 面板行标签互不相同 / 陈旧字段名零残留 + 现行名在用 /
  防空集通过 / 章节交叉引用可解析 / 清单编号连续）—— **判据比轮次更耐久**。
- **残余风险（不假装闭合）**：文档仍可能存在**未被这 9 条断言覆盖**的自洽性问题（人工阅读才能发现）。
  缓解：**评审记录与简报都在仓内可查**，后续任何一条被指出都能定位到具体轮次与处置。
  **实例（本次自己踩到）**：本族断言只覆盖了 **i18n 计数**，**没覆盖评审条数** ⇒ 「收口声明的总数」与「上方分轮表之和」漂移了没人红（见下节）。

## 三之十九之补、收口数字的事后校正（2026-10-22，PR 推送前自查）

**起因**：PR 推送前逐条核对对外数字，发现本文件的**收口段落与它自己上方的分轮表互相矛盾**：

| 位置 | 原值 | 实测真值 | 判据 |
|------|------|----------|------|
| 收口「轮次与条数」 | 138 条 | **146 条** | 本文件分轮表逐轮相加：19 轮中 18 轮各 8 条 + 第 6 轮 2 条 |
| 收口「其余经引擎校验」 | 136 条 | **144 条** | 146 − 第 6 轮 2 条 |
| 最终口径「i18n key 共」 | 24 个 | **27 个** | 与 `origin/main` 的 zh locale 做**键集差集**：新增 27、删除 0、zh/en 键集对称；分解 7+13+5+2 |
| 人工落地条数「48 条」 | 轮次枚举漏了第 10 轮 | 补全为 **6 轮 × 8 = 48** | 轮次清单与执行记录第 ④ 条对齐 |
| 执行记录收口表「第 13 轮关键产出」 | **第 12 轮的复制品** | 按第 13 轮真实的 8 条意见重写 | 与本文件「三之十二」逐条比对 |

**为什么会被红不了**：这 9 条断言覆盖的是 **i18n 计数**（清单条数 / zh-en 命中数 / 分组数），
而**评审条数**当时是**纯手写**的 ⇒ 「同一个数字写在多处必然漂移」这一族**在数字口径上**照样发生了。
⇒ 已把分母（18×8+2）**写进收口段落本身**，读者一加就对得上；**仍未变成机器断言**（列入残余风险，不假装闭合）。

**教训（与第 16 轮同族、不同面）**：第 16 轮把「三处计数同源」变成机器断言时，
**只挑了 i18n 计数这一个面** ⇒ 同一族的**另一个面（评审条数）**照样漂移。
⇒ **断言一个族不够，要按「这个数字在几个文件里被复述」来盘点，而不是按「这族大概归谁管」。**


## 三之二十、最终口径汇总（design D20 / D21 / D22）

- **plan 级持久化**：`promptContext` = `{ taskId, taskAvailable, locale, promptAssetHash, frameConstraint, frameConstraintPending, fallbackLocales, assetsIncomplete }`。
- **plan 级 `frameConstraint`**：**只存 `{hash, length, locale, fallback, truncated, source, originalHash, originalLength}`** —— **不存方法论原文**（第 4 轮 i8）；`hash`/`length` 取截断后文本，`originalHash`/`originalLength` 取截断前（第 8 轮 i2）。
- **逐镜持久化**：`promptVars` + `promptMissing` + `promptRenderHash`（**不含**任何长文本）。
- **只在规划结果**：`renderText` + `deliverable` + `blockedVars`（可由 `vars` + 同版本库重渲染）。
- **不落盘**：`system` / `user` 原文（按 `taskId` 引用库）。
- **两个哈希**：**`promptAssetHash`（plan 级 · 提示词资产面：doctrine + 任务模板 + locale + 回退事实）**
  + **`promptRenderHash`（逐镜 · 渲染面：固定键序的逐镜 vars + locale，含色盘行与角色描述）**，
  拼接用**长度前缀**防碰撞。旧名 `assetHash` **已废弃**（第 8 轮 i1：域是提示词资产，不是全部资产）。
- **kit 自由文本的长度上限**：`palette_line` / `character_descriptors` 超 20,000 字符 ⇒ **不提供该变量**
  ⇒ 进 `missing` ⇒ `deliverable=false`；**不静默截断**（第 8 轮 i8）。
- **逐镜字段的长度上限**：`shot_json` 的 `title` / `characterNames` / `model` 超 2,000 字符 ⇒
  **不提供** `shot_json` ⇒ 进 `missing` ⇒ `deliverable=false`；**不静默截断**（第 9 轮 i8）。
- **缺失分类判据**：`byDesign` = **产品里没有这个资产的形态**；`assetMissing` = **有资产形态、当前没有**（第 9 轮 i3）。
- **i18n key 共 27 个**（zh/en 各 27）：`doctrine` 7（1-7）+ `auto.methodology*` 13（8-20）+ `auto.methodologyReason*` 5（21-25）+ 聚合第二态 2（26-27）= 27（第 9 轮 i6/i7 起的口径，第 19 轮 i1 定稿；逐条清单见 `review-brief-pr3.md` §四末）。
  **实测对账**：与 `origin/main` 的 zh locale 做键集差集 ⇒ **新增 27、删除 0**、zh/en 键集完全对称。
- **面板行标签互不相同**：7 行各有自己的 `<dt>`（此前三行复用了「任务模板」）（第 9 轮 i6）。
- **面板在两种状态下都可见**：规划结果（刚规划完）**与**项目投影（重开项目）——
  后者由服务端用**同一个** `buildMethodologySummary` 从**落盘**的 `promptContext` + 逐镜 `promptMissing` 重新汇总（第 9 轮 i4）。
- **「不可直送」聚合提示按 reason 分流**：有 assetMissing ⇒ 「或补齐对应资产」；只剩 byDesign ⇒ 只说「人工补齐」（第 9 轮 i7）。
- **「资产不完整」文案不指向导入入口**：产品里没有资产导入功能（PR-3b 才做）（第 9 轮 i1）。
- **逐镜 `endFramePrompt` 仍为 `''`**：本批次不逐镜派生（要 LLM），plan 级只留哈希与长度并如实标注「待 LLM」。

## 四、剩余风险（不假装闭合）

1. **F-I-2 对存量资产基本无效**：存量 153 模板里**只有 1 个**有 GEO 块 ⇒ 绝大多数镜只能填 5/7 变量。已用量化判据把「5/7」固化为**已知基线**，避免被读成「方法论已全接上」。这是**资产缺口**，不是本 PR 能修的。
2. **风格前缀无资产源**：`style_prefix` 长期 byDesign ⇒ `deliverable` 长期为 false ⇒ 后续 LLM 接入前必须先把风格前缀升格为资产（后续项，不在本 PR 造）。
3. **尾帧约束只能 plan 级、且只留哈希**：逐镜尾帧文本要 LLM 派生 ⇒ 本批次逐镜 `endFramePrompt` 仍为空；面板如实标注「规则已接入、逐镜派生待 LLM」。
4. **只读面板是「状态显示」不是「功能」**：它不改变任何出片行为；价值在于把「接上了多少」变成可见事实。
5. **PR-3b（导入写路径）尚未设计与评审**：本 PR 不含任何 userData 写入。
6. **kit 不可信，但哈希「首算即信任」是残余风险**（第 8 轮 i8）：`userData/film-kit` 可被用户或外部进程写入；
   kit-loader 只校验**结构**、不校验块文本长度 ⇒ 本 PR 已给流入提示词的 kit 自由文本设长度上限（超限不提供）。
   **但** `promptAssetHash` **没有独立信任锚**（无签名、无内嵌清单）⇒ 「kit 被换 ⇒ 哈希会变」
   只在**同一台机器、同一次规划前后**成立。资产签名属 F-J 写路径（PR-3b），需独立安全评审。
7. **真实 kit 巡检在 CI 上没有信号**（第 8 轮 i7）：真实资产面需 `film-kit` 目录，CI 没有 ⇒ 该巡检在 CI 里 SKIP。
   ⇒ 它的**语义**已用**合成夹具**搬进 CI（①b，CI 恒跑）；真实巡检保留为本地/手工门禁（只打印读数）。
8. **第 6 轮是「引擎未校验」的一轮**：那轮 critic 输出没通过 JSON 校验 ⇒ **没有 `critique-v1.md` 落盘**，
   它的 2 条意见是**从原始输出里读出来的**，**未经引擎校验**。
   ⇒ 处置：两条都**独立复核过**（`sourceHash` 残留：全量搜实现代码，零命中；
   阻断原因无 i18n：已补 4 个 key 并有逐条断言），
   且第 7 轮（**引擎校验通过**）的 i1/i4 **独立复现了同一类问题**（计数与旧名未对账）⇒ 处置方向被验证。
   **但仍如实标注：第 6 轮那 2 条不是引擎校验过的产物。**
9. **多轮的人工落地**：proposer 的机械修订在第 2/3/4/5/8/10 轮中文长句上反复失败（同 PR-1 形态）⇒ 那 48 条意见（**6 轮 × 8 条**）由作者外科式落地，**逐条可在上表核对**；第 6 轮 critic 输出校验失败，那 2 条同样由作者落地；第 7 轮因 opencode 输入上限 7800 字符，修订环节**根本没能进入**（critic 侧照常产出 critique）。
