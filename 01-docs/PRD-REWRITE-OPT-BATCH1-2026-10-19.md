# PRD：改写引擎优化批次一（rewrite-opt-batch1）

> 状态：**方案待评审**（本文档本身不含任何代码变更）
> 基线：origin/main `7ebea9fbc`（含 #3980 默认策略修复）
> 日期：2026-10-19
> 上游：`01-docs/PRD-REWRITE-ENGINE.md`（引擎主 PRD，本篇是它的优化批次提案）
> 分支规划：`rewrite-opt-batch1`

---

## 0. 一句话

把改写引擎里**已建成但断线的能力接上**（fewShot/chainOfThought 没进 prompt、采纳信号不回流策略选择、质量分不拦截、后处理静默改稿），并立项长文分段改写。

## 0.1 为什么是「接线」而不是「新建」

#3980 的诊断确认了引擎骨架完整（策略可下发、三层知识库、反馈闭环、质量评估器都在位），但四类能力处于「建而未用」状态。本批次每项修复都是**消费已有数据/已有字段**，不新建存储、不新建服务，改动集中在 `_buildPrompt` 与 `_postProcess` 两个函数及其测试。

## 0.2 证据边界（本篇哪些结论是实测、哪些是推断）

| 结论 | 证据级别 |
|---|---|
| chainOfThought/fewShot/genre/metadata 四字段零消费点 | **实测**（grep 全引擎，仅策略定义处出现） |
| 采纳/拒绝信号只影响知识条目置信度，不影响策略选择 | **实测**（`_historyScore` 只读 `strategyRatings`/`preferredStrategies`） |
| 字数截断是硬 slice，可切断句子 | **实测**（`_postProcess` 内 `codePoints.slice(0, maxLength)`） |
| `_stripStructureHeadings` 会丢弃行首结构词的 ≤30 字行 | **实测**（判据在代码里，行为锁未覆盖「正文短句被删」形态） |
| 质量分只展示不拦截 | **实测**（`rewrite()` 返回 `quality` 字段，无任何消费分支） |
| 长文单次调用两头打折 | **推断**（无量化数据；但 6000 上限截取已在他人的 `5df46e079` 落地，佐证痛点真实） |

---

## 1. O1 — fewShot / chainOfThought 接线（P0）

### 现状

策略定义里每个策略都带这两个字段（`strategy-manager.js:223-227` 等 5 处），`_buildPrompt` 的 `vars` 表只有 `content/industry/purpose/tone/platform/knowledgeContext/mode/targetLength`，**没有任何消费点**。运营在 ops-center 改 fewShot 不会对改写结果产生任何影响。

### 目标行为

1. **fewShot 接线**：策略含非空 `fewShot` 数组时，拼接进 `userPrompt`（模板替换之后、爆款信号段之前），形态：

   ```
   【改写示例参考】（学习其风格与结构，禁止照抄内容）
   原文：{input}
   改写：{output}

   原文：{input2}
   改写：{output2}
   ```

   - 只取前 2 条（防 prompt 膨胀），每条 input/output 各截断 200 码点；
   - 空数组/非数组 ⇒ 不注入该段，行为与现状一致。

2. **chainOfThought 接线**：策略含非空字符串时，作为「生成前的思考指令」注入 userPrompt 首段：

   ```
   【写作流程要求】（先按此流程思考，再输出最终文案；输出时只给最终文案本身）
   {chainOfThought}
   ```

   - 放在硬约束之后、策略 systemPrompt 对应的 userPrompt 之前；与硬约束第 1 条「只输出文案本身」兼容（明确说「输出时只给最终文案」）。

### 实现位置

- `packages/rewrite-engine/src/rewrite-engine-core.js` `_buildPrompt`：新增 `_buildFewShotBlock(strategy)` 与 `_buildChainOfThoughtBlock(strategy)` 两个私有方法（各含清洗与截断），拼进 userPrompt。
- 防二次注入：fewShot 的 input/output 与 chainOfThought 文本中若含 `{placeholder}` 字面量，**不展开**（沿用现有「模板替换后追加」的既有防线）。

### 验收标准

1. 策略含 fewShot ⇒ 改写 prompt 中出现「改写示例参考」段且示例内容与策略定义一致；
2. fewShot 为空/缺失 ⇒ prompt 中无该段（字节级与现状一致）；
3. chainOfThought 同上两条；
4. fewShot 文本含 `{industry}` 字面量 ⇒ 原样出现在 prompt 中（不被展开）；
5. 示例超长 ⇒ 按 200 码点截断，prompt 总量可控。

### 回归锁

- `rewrite-engine-core.test.js` 新增 describe「fewShot/chainOfThought 接线」：正向注入、空数组不注入、截断、防二次展开 4 条；
- 变异反证：删掉 `_buildFewShotBlock` 调用 ⇒ 正向用例红。

### 工作量与风险

- 工作量：0.5 天（含测试）。
- 风险：低。唯一注意点是与硬约束的兼容表述（已在上文给出措辞）；prompt 变长对 token 成本的影响 = 每次最多 +2 条示例（约 400 码点），可接受。

---

## 2. O2 — 字数软截断 + 结构标题剥离的正文保护（P0）

### 现状 A：硬截断

`_postProcess` 的字数限制是 `codePoints.slice(0, maxLength)`——**句子切一半、段落烂尾**都是合法产物。模型偶尔会超字数，此时用户拿到一句残句结尾。

### 现状 B：结构标题剥离误伤

`_stripStructureHeadings` 判据：行首命中结构关键词（开头/中间/结尾/悬念/钩子/情感转折/共鸣/号召/正文/结尾段）**且行长 ≤30 字 ⇒ 整行删除**。两个真实误伤形态：

- 正文短句「结尾是关键。」→ 行首「结尾」命中、长度 6 字 ⇒ **整行消失**；
- 上一轮 CCG 审查已点名的信息损失点（`rewrite-default-strategy-fix.md` 登记的后续项）。

### 目标行为

**A. 软截断**（`_postProcess` 内替换 slice 逻辑）：

1. 超长时向前找**最后一个句末标点**（`。！？…`，含引号后缀 `”` `”`）；
2. 找到且保留部分 ≥ max 的 70% ⇒ 截到该标点（句子完整）；
3. 找不到（如 70% 内无任何句末标点，常见于纯英文/代码）⇒ 回落硬截断并在 `metadata` 加 `truncated:true`；
4. 结果元信息里始终带 `resultTruncated`（true/false）。

**B. 结构标题剥离加护栏**（`_stripStructureHeadings` 追加两条判据，**不放宽**既有剥离）：

1. 行尾有句末标点（`。！？…`）⇒ 视为正文句子，**不剥**（真实标题行不会以句号收尾）；
2. 行长 ≤8 字且无标点才允许剥（原 30 字阈值收紧到标题长度量级）——此条**改变行为**，需回归锁逐条核对「该剥的仍剥、该留的都留」。

### 验收标准

1. 超长文本以句末标点收尾（不是残句）；纯无标点文本仍能截断且有 `truncated:true`；
2. 「结尾是关键。」完整保留；「开头（悬念钩子）」「**中间（情感转折）**」「## 结尾」仍被剥（既有用例必须全绿）；
3. `metadata.resultTruncated` 出现且布尔类型。

### 回归锁

- `ai-taste-remover.test.js` / `rewrite-engine-core.test.js`：软截断 4 条（句末截断/70% 兜底/truncated 标记/无标点回落）；
- 结构剥离：新增「正文短句保留」3 条（句号结尾/问号结尾/含冒号对话体）+ 既有剥离用例**逐条保持绿**（证明没放宽）；
- 变异反证：把「句末标点不剥」判据删掉 ⇒ 正文保留用例红。

### 工作量与风险

- 工作量：0.5 天。
- 风险：中。B-2 收紧阈值可能放过某种此前被剥的标题形态——用既有测试全集兜底；若既有用例出现需要保留剥除的新形态，逐条归因后再定。

---

## 3. O3 — 质量分参与拦截：低分标记 + 可选降强度重试（P1）

### 现状

`RewriteQualityEvaluator` 输出 `{sufficiency, semanticPreservation, originality, verdict}`，RewriteView 只做展示。**语义保持度 30 分的结果原样放行**，用户要自己发现「改写把事实改没了」。

### 目标行为

1. **门槛标记**：`semanticPreservation < 40` 时，结果带 `warnings: ['语义保持度偏低（X 分），建议人工核对关键事实']`（沿用既有 warnings 通道，RewriteView 已渲染该数组）；
2. **可选重试**：仅 `mode='imitate'` 且首发低分时，自动用「降强度」参数重试一次——重试策略=同策略但注入「本次为保真改写，优先保留原文事实与数据，允许降低文风变换幅度」的附加指令；重试结果与首发**都返回**（`attempts` 数组），由前端展示，**不自动替换**用户看到的结果；
3. 重试有开关（`userSettings.qualityRetry !== false` 默认开）且全链路 fail-open：重试抛错/超时 ⇒ 只返回首发 + warnings，绝不阻塞主流程。

### 验收标准

1. 低分结果带 warnings 且 RewriteView 可见；
2. 重试仅在 imitate + 低分 + 开关开时触发，**至多一次**；
3. 重试失败不阻塞主流程（fail-open 有测试）；
4. `attempts` 结构含两次的 `mode/quality/warnings`。

### 回归锁

- 新增 describe「质量拦截」：低分标记 / 重试触发条件 / 至多一次 / fail-open / 开关关闭不重试，5 条；
- 变异反证：去掉重试次数上限 ⇒ 「至多一次」用例红。

### 工作量与风险

- 工作量：1 天。
- 风险：中。重试会多一次 LLM 调用（成本翻倍于低分场景）；不自动替换结果的克制设计避免了「越改越差还不可逆」。门槛 40 是初值，落地后按 RewriteView 实际分布校准（评估器历史分布已有文档）。

---

## 4. O4 — 采纳信号回流策略选择（P1）

### 现状

用户点「采纳」是改写质量的最强信号，但 `_historyScore` 只消费 `strategyRatings`（1-5 星手动评分）与 `preferredStrategies`——**采纳/拒绝这个高频信号对策略选择零影响**。数据已在 `knowledge-library-service.js:364-367` 落库（adopted/rejected refs），缺的只是策略维度的聚合消费。

### 目标行为

1. `StrategyMatcher._historyScore` 增加第三档：`strategyAdoption`——从知识库聚合「该策略近 30 天采纳率」（采纳数 / (采纳+拒绝)，样本 <5 不计，回退 0.3 基础分）；
2. 权重分配调整为 industry 30 / purpose 25 / platform 20 / **history 15** / tone 10（历史维从 10→15，tone 让 5 分；五维总权不变）；
3. 数据源：`knowledge-library-service` 新增 `getStrategyAdoptionStats(strategyId)`（单条 SQL 聚合，不拉明细）；
4. **向后兼容**：无历史/知识库未注入时行为与现状逐字节一致（0.3 基础分路径不变）。

### 验收标准

1. 注入「采纳率高」的历史 ⇒ 对应策略 history 分上升并可能改变排名；
2. 样本 <5 ⇒ 回退基础分（与现状一致）；
3. 权重变更后既有 matcher 测试全绿（权重变化会改变并列形态，需逐条核对）；
4. `getStrategyAdoptionStats` 空库/异常 ⇒ 返回 null，matcher 回退，不抛错。

### 回归锁

- `strategy-matcher.test.js` 新增 adoption 档 4 条（有数据提升 / 样本不足回退 / 空库回退 / 权重单调性）；
- `knowledge-library-service` 侧 SQL 聚合 2 条（含异常降级）；
- 变异反证：把 adoption 档删掉 ⇒ 提升用例红。

### 工作量与风险

- 工作量：1 天。
- 风险：中。①权重改动会波及 #3980 刚建的破平测试（并列形态变化）——需要把二轮 i1/i2 的边界用例重新核对；②采纳数据冷启动期（样本 <5）行为不变，无静默变化风险；③必须处理「采纳 ≠ 策略好」的混淆（用户可能因题材采纳）——初版接受这个噪声，30 天窗口 + 5 样本门槛已是最小防御。

---

## 5. O5 — 模式/策略/字数三方冲突检测（P1）

### 现状

「抖音口播策略（maxLength 800，要求短句口播）+ mode=expand（扩到 2000 字）+ wordCountRange 800-2000」三者指令互相冲突，全靠模型自行仲裁。`genre` 字段（fiction/marketing/general/professional）同样零消费。

### 目标行为

1. `_buildPrompt` 新增 `_detectConfigConflicts(strategy, mode, wordCountRange)`，检测三类冲突：
   - **长度**：策略 `postProcess.maxLength` < wordCountRange.min ⇒ 显式在 userPrompt 注入「以 X 字为上限（策略体裁限制优先于字数区间）」；
   - **体裁×模式**：genre=marketing/fiction 且 mode=imitate ⇒ 注入「保留原文事实，仅调整表达风格」的调和指令（防带货腔覆盖事实型原文）；
   - **体裁×平台**：genre 与平台声明的匹配度极低（策略不支持该平台）⇒ warnings 提示「所选策略与目标平台不匹配」（不注入 prompt，只提示用户）；
2. 冲突信息同时进 `metadata.conflicts`（结构化），前端可展示。

### 验收标准

1. 冲突场景下 prompt 含调和指令且**不再含原始冲突表述**（以最终注入文本为准）；
2. 无冲突 ⇒ prompt 与现状字节一致；
3. `metadata.conflicts` 空数组时序列化不出现该键（防前端展示空壳）。

### 回归锁

3 类冲突各 1 条 + 无冲突字节一致 1 条 + conflicts 空不序列化 1 条，共 5 条；变异反证：删掉长度冲突分支 ⇒ 对应用例红。

### 工作量与风险

- 工作量：1 天。
- 风险：低-中。调和指令的措辞需要实测调优（指令本身也是 prompt，可能引入新偏差）；「字节一致」验收保证无冲突场景零回归。

---

## 6. O6 — 长文分段改写（P2，单独立项）

### 现状与动机

6000 字上限 + 单次调用。`5df46e079`（他人已合入）证明超长截取已是真实场景。分段改写同时救**长度**与**保真**，但引入新问题面（段落连贯性、上下文传递、失败恢复），值得独立 PRD 与评审，不塞进本批次。

### 方案骨架（供独立 PRD 展开）

1. **切分**：按空行分段 → 超长段按句末标点二次切分，目标每段 ≤1500 码点；
2. **上下文传递**：每段 prompt 携带「前一段改写结果的最后 200 码点」作为衔接锚（非全文重写上下文，控成本）；
3. **执行**：顺序执行（段间有依赖，不并行）；单段失败重试 1 次，再失败**整篇 fail-closed**（不做部分拼接——半篇改写比原文更危险）；
4. **门槛**：仅 `content > 3000` 码点触发，以下走单次调用（现状路径逐字节不变）；
5. **进度**：复用既有 `ai:progress` 通道上报「第 x/N 段」。

### 工作量估算

2-3 天（含并发边界与失败恢复测试）。建议在 O1-O5 落地后单独立项。

---

## 7. 实施顺序与批次

| 批次 | 内容 | 工作量 | 理由 |
|---|---|---|---|
| 第一批 | O1 fewShot 接线 + O2 软截断/剥离护栏 | 1 天 | 改动最小、效果立现、纯引擎侧无 UI 联动 |
| 第二批 | O3 质量拦截 + O5 冲突检测 | 2 天 | 都在 prompt 组装/返回层，同域联做 |
| 第三批 | O4 采纳回流 | 1 天 | 涉及权重变更与跨服务聚合，单独评审 |
| 独立立项 | O6 分段改写 | 2-3 天 | 需要独立 PRD 与失败恢复设计 |

**每批独立走 PR + 质量门禁**；不合并成一个大 PR（评审面不可控，#3980 的 661 行 diff 已是审查效率的边界）。

---

## 8. 全局验收标准（每批通用）

1. 全部改动在隔离 worktree + TDD（先红后绿）+ 变异反证；
2. 「无配置 ⇒ 行为与现状逐字节一致」是每项的硬验收（向后兼容是硬约束，不允许默认行为漂移）；
3. 新增 prompt 段落必须防二次注入（沿用模板替换后追加的既有防线）；
4. 涉及 LLM 成本的变化（O3 重试）必须有开关且默认保守；
5. 每批 PR 附 `openspec/records/<分支>.md` 执行记录（含远程同步行，状态列写「由门禁推导」）。

## 9. Out of Scope

- 运营中心硬约束可运营漂移（#3980 已登记，属 ops 治理）；
- ai-taste-remover 词表逻辑调整；
- RewriteView UI 重构（新增展示项按现有 slots 最小化添加）；
- 多模型 A/B 改写（评估器已支持多 provider，但策略编排不在本批次）；
- `_stripStructureHeadings` 的关键词表本身扩充（O2 只加护栏不动词表）。
