# subtitle-split-quality Specification

## Purpose
Story2Video 文案生成字幕的坏切修复（2026-08-15 用户反馈：`扶余国`→`扶余/国`、`电视剧`→`电/视剧`、
`复杂`→`复/杂`、`空白一片`→`空/白一片`、`卵生、日影受孕` 7 字孤悬）。调查证实坏切为算法缺陷而非
版本漂移（本地==远程 `6cefc0c`）。本 spec 固化三端（sidecar Python / MP TS 镜像 / MP JS 镜像）
逐字一致的字幕分句 v1.2 语义，并修复 stage-executor 字幕参数透传。
## Requirements
### Requirement: 词边界感知切分（无标点切分不劈词）

无标点硬切与平衡切分 SHALL 优先选择完整词语或显式保护短语之外的边界。候选排序 SHALL 保留现有语义引导、块首/块尾规则，并在等距候选之间优先选择受限本地词边界判断认可的位置；本地词边界判断不得把普通分词结果升级为跨实现的绝对词典。word_split 字符集 SHALL 由共享规则表加载，三端禁止各自追加未同步的硬编码规则。

当候选边界位于 no_cut_bigrams 的任意长度短语内部、Unicode 代理对中间、小数数字 token 内部，或动词完成体“了”与普通汉字宾语之间时，该候选 SHALL 被拒绝。若保护条件使当前长度区间没有安全边界，系统 SHALL 保留完整块或继续寻找更宽范围内的安全边界，不得直接按算术位置裸切。

#### Scenario: 扶余国不被劈开
- **WHEN** 对 因此，在韩国的历史教科书里，能看到大量关于扶余国和扶余人的记载。 以 min=8/max=15 分句
- **THEN** 输出包含块 能看到大量关于扶余国 与 和扶余人的记载，禁止出现 扶余+国 拆块

#### Scenario: 电视剧/朱蒙/这位 不被劈开
- **WHEN** 对 2005年，韩国收视率最高的电视剧《朱蒙》播出，里面讲述的正是这位扶余王子的故事。 分句
- **THEN** 输出包含 电视剧《朱蒙》播出 与 这位扶余王子的故事，禁止出现 电+视剧、朱+蒙 拆块

#### Scenario: 复杂/空白一片 不被劈开
- **WHEN** 对 历史上的族群迁徙与政权更迭本就复杂，而民族叙事则倾向于把一切复杂简单化、直线化。 分句
- **THEN** 输出包含 把一切复杂简单化、直线化，禁止出现 把一切复+杂简单化 拆块；顿号枚举整体保留

#### Scenario: 语义完整短块显式声明
- **WHEN** 词边界保护产生 clean 后 < min 的语义完整短块（如 和扶余人的记载 7 字）
- **THEN** 该块 SHALL 保留且必须在共享向量 short_block_exceptions 中按 index 显式声明 reason，优先不劈词；未声明的 < min 块视为违规

### Requirement: 短块判定使用 clean 后长度（修复机制三）
Step 4 短块合并的「前块 <min」与「短尾」判定 SHALL 使用剥离尾部标点后的长度（`cleanLen`），
避免 Step 5 清理标点后块变短逃过合并；并入条件 SHALL 同时满足合并后 clean 长度 ≤ max_chars，
超限时保持独立短块（由 `short_block_exceptions` 声明）；块尾为句界字符且 clean 后 >3 字的完整句
SHALL 不并入前块。

#### Scenario: 卵生、日影受孕 不再孤悬
- **WHEN** 对 `故事里充满了神话色彩。卵生、日影受孕、鱼鳖搭桥，但剥去这些奇幻的外壳，内核却无比清晰。` 分句
- **THEN** 输出包含 `卵生、日影受孕、鱼鳖搭桥`（clean 后 7 字并入后续块/按枚举整体保留），
  禁止 `卵生、日影受孕、` 独立成 7 字短块

#### Scenario: 完整句不并入前块
- **WHEN** 相邻块中后块以 `。！？…` 结尾且 clean 后 >3 字
- **THEN** 该块保持独立，不并入前块（句界优先）

### Requirement: Step 6 平衡切分越界修复
Step 6 平衡切分的标点锚点 `balanced` SHALL 满足 `0 < balanced < len(b)`；尾字符恰为标点时
`i+1 == len(b)` 的越界结果 SHALL 视为无效并回退字面平衡切点，禁止整块不切或死循环逼近。

#### Scenario: 尾标点不产生越界锚点
- **WHEN** 超长块的尾字符是优先级标点且进入平衡切分分支
- **THEN** 切分点严格落在块内部，切出的头/尾块均非空且尾块 ≥ min 或回退字面平衡

### Requirement: 字幕参数配置透传
`StageExecutor._buildStorySplitterOptions` SHALL 将 UI 层 `subtitle_min_chars`/`subtitle_max_chars`/
`subtitle_timing` 映射为 8002 `config.subtitle.min_chars_per_block`/`max_chars_per_block`/
`time_calculation_method`；这些键 SHALL 不泄漏为请求顶层键。禁止以测试断言固化「丢弃配置」行为。

#### Scenario: 字幕参数到达 8002 config
- **WHEN** split 阶段 options 携带 `subtitle_min_chars: 8, subtitle_max_chars: 15`
- **THEN** 8002 请求 `config.subtitle` 包含 `min_chars_per_block: 8, max_chars_per_block: 15`，
  且顶层不含 `subtitle_min_chars`/`subtitle_max_chars`

#### Scenario: 时间计算方法透传
- **WHEN** options 携带 `subtitle_timing: 'equal'`
- **THEN** 8002 请求 `config.subtitle.time_calculation_method === 'equal'`

### Requirement: 顿号枚举吞并谓语守卫（v1.2.1）
顿号枚举保护 SHALL 在枚举单元扫到片段尾仍无终止、且枚举单元内不含更多顿号项时判定为
「枚举项 + 谓语」被 max_chars 截断的过度吞并，回退顿号锚点（不依赖谓词引导词表）；
`predicate_starters` SHALL 包含高频动词首字 `混`。禁止产出 15+3 式劈词孤尾。

#### Scenario: 声音枚举吞谓语不劈词
- **WHEN** 对 `枪声、爆炸声、呐喊声混成一锅滚烫的粥。` 分句
- **THEN** 输出为 `枪声、爆炸声、呐喊声` + `混成一锅滚烫的粥`（10+8），
  禁止出现 `枪声、爆炸声、呐喊声混成一锅滚` + `烫的粥`（劈词孤尾）

#### Scenario: 未知谓语动词回退锚点
- **WHEN** 谓词引导词表之外的动词开头（如 `此起彼伏`）触发枚举扫描
- **THEN** 枚举保护回退顿号锚点，禁止吞并谓语整段到块尾；短头块并入超限时保持独立

### Requirement: 三端逐字一致与共享向量回归
sidecar Python、MP TS 镜像、MP JS 镜像 SHALL 对同一文本同一配置输出逐字一致的字幕块序列；
共享向量 `subtitle_segmentation_vectors.json`（含 6 条用户坏例）三副本同步，`expected_blocks`
为手工真值（禁止把实现输出直接写入向量）。

#### Scenario: Python 向量回归
- **WHEN** 在 smart-sentence-splitter 执行 `pytest tests/unit/test_subtitle_vectors.py`
- **THEN** 全部通过（含 26 条向量的块一致/min_chars 不变量/时间戳连续断言）

#### Scenario: TS 与 JS 镜像回归
- **WHEN** 执行 `pnpm --filter @multi-publish/story2video-engine test` 与
  `apps/desktop` 的 `story2video-segmentation-vectors.test.js` / `story2video-segmentation-parity.test.js`
- **THEN** 全部通过，JS 与 TS 输出一致且命中共享向量

### Requirement: 真实 8002 链路 E2E
`tests/e2e-pipeline-orchestrator.test.js` SHALL 包含通过真实 8002 `/v1/split` 执行的用户 6 段坏例用例，
断言 pipeline split 阶段输出字幕块序列命中 v1.2 目标；E2E 用例 SHALL 在每轮验证后释放并发槽。

#### Scenario: 用户 6 段坏例命中目标
- **WHEN** 8002 服务运行（sidecar 代码 ≥ v0.16.0/词边界修复 + v1.2.1 枚举守卫）且执行该 E2E 用例
- **THEN** 6 段文本的字幕块序列分别命中共享向量 `expected_blocks`，逐字相等

### Requirement: 本地字幕切分保护短语边界

本地字幕切分器 SHALL 将共享规则表中的 no_cut_bigrams 项视为不可切开的短语；该字段中的项目可以是任意长度，而不只限于两个字符。字幕切点不得落在任一匹配短语的内部。

#### Scenario: 用户样例的受保护短语不被拆开
- **WHEN** 本地切分器处理包含“蒙古”“江南”“包税人”“大汗”的用户样例文案
- **THEN** 任意相邻字幕块边界都不得落在这四个短语内部，且字幕块拼接后保留原文中的全部非块尾标点字符

#### Scenario: 受保护短语长度超过最长字幕块
- **WHEN** 配置的 max_chars_per_block 小于某个共享保护短语的长度
- **THEN** 该短语 SHALL 仍作为完整字幕块输出，不得为满足长度上限而在短语内部切分
#### Scenario: 三端共享规则保持一致
- **WHEN** TypeScript、Electron JS 镜像和 smart-sentence-splitter Python 端加载同一规则表
- **THEN** 三端 SHALL 对同一输入使用相同的短语边界保护语义

### Requirement: 在线字幕结果必须通过内容与边界质量门

在线字幕结果 SHALL 只有在按原文顺序连续覆盖场景文本，且所有相邻字幕块边界均不落在共享保护短语内部时，才可标记为 smart-sentence-splitter 并直接采用。

#### Scenario: 在线结果包含坏词边界
- **WHEN** 在线结果的字幕块覆盖率足够但在“江|南”或其他受保护短语内部切分
- **THEN** 该场景 SHALL 回退到本地字幕切分，subtitleSource SHALL 为 local-typescript，并记录可追溯的回退原因

#### Scenario: 在线结果内容错序或重复
- **WHEN** 在线字幕拼接长度达到覆盖率阈值但不能按顺序连续匹配场景原文
- **THEN** 该场景 SHALL 回退到本地字幕切分，不得以 smart-sentence-splitter 标记不连续结果

#### Scenario: 在线结果合法
- **WHEN** 在线字幕按顺序完整覆盖场景文本且所有边界安全
- **THEN** 系统 SHALL 原样采用在线字幕，并保持 subtitleSource 为 smart-sentence-splitter

### Requirement: 场景文本与现有来源合同保持兼容

字幕质量修复 SHALL 只替换不合格场景的 subtitleBlocks，不得修改服务返回的场景 text；现有 subtitleSource 枚举值 SHALL 保持兼容。

#### Scenario: 单场景回退不改变场景文本
- **WHEN** 某个在线场景因字幕质量门失败而回退
- **THEN** 场景 text SHALL 与服务结果中的规范化文本一致，且其他合格场景仍可继续使用在线字幕

### Requirement: 语义引导字优先形成字幕边界

字幕切分器 SHALL 将共享规则表中的 `semantic_lead` 及其后续约束视为语义边界候选。后块以语义引导字开头时，候选排序 SHALL 优先保留该边界，并且 `mergeShort` 与硬切后的尾块平衡 SHALL 不得将该后块重新合并或从该边界回吸字符。

#### Scenario: 动作短语不被回吸
- **WHEN** 文本包含“其实是跟南宋的老爷们提前谈妥了”“之前蒙哥非要死磕，还搞屠城”或“他们甚至嚣张到把大量蒙古人都卖去当奴隶”
- **THEN** 字幕 SHALL 分别保留“其实是跟南宋的老爷们｜提前谈妥了”“之前蒙哥非要死磕｜还搞屠城”和“他们甚至嚣张到｜把大量蒙古人都卖去当奴隶”的语义边界

#### Scenario: 判断短语不劈词
- **WHEN** 文本包含“汉族地主阶级最爽的日子绝对是元朝”
- **THEN** 字幕 SHALL 输出“汉族地主阶级最爽的日子｜绝对是元朝”，且不得在“绝对”内部切分

#### Scenario: 三端结果一致
- **WHEN** TypeScript、Electron JS 镜像和 smart-sentence-splitter Python 端使用相同 min/max 配置处理同一文本
- **THEN** 三端 SHALL 输出逐块相同的字幕文本，并保持原文字符顺序和完整覆盖

### Requirement: 常用双字词不得被字幕边界拆开

字幕切分器 SHALL 将共享规则表中的 `no_cut_bigrams` 词组视为不可切开的短语。对于“哪怕”“没法”“那些”“展现”等用户反馈词，任意切点 SHALL 不得落在词组内部，且 TypeScript、Electron JS 与 Python 端 SHALL 使用同一规则源。

#### Scenario: 用户反馈词保持完整
- **WHEN** 以 `min_chars=8`、`max_chars=15` 处理包含“哪怕朱元璋”“暂时没法彻底”“只是这里的那些”或“实际行动展现出”的文本
- **THEN** 输出 SHALL 不包含“哪｜怕”“没｜法”“那｜些”或“展｜现”的边界，且拼接后保留原文字符顺序

### Requirement: 未闭合引号不得吞掉后续正文

字幕清理遇到未闭合或多余引号时 SHALL 只处理无法配对的引号字符，正文内容 SHALL 保持可见并参与后续长度切分；句界处理 SHALL 不因单个未闭合半角引号永久屏蔽后续句号。

#### Scenario: 未闭合半角引号后的正文保留
- **WHEN** 文本包含 `前朝。"字里行间全在抱怨元末群雄。` 且没有对应闭引号
- **THEN** 字幕 SHALL 保留“字里行间全在抱怨元末群雄”的正文，不得输出空块或丢弃后续文本；未配对引号可被规范化移除

#### Scenario: 对称半角引号仍正常闭合
- **WHEN** 文本包含 `他说"元以宽失天下"。`
- **THEN** 成对引号内容 SHALL 保持为一个可见片段，后续句号 SHALL 正常形成句界

### Requirement: 三端共享回归

同一输入和字幕配置经 TypeScript、Electron JS 与 smart-sentence-splitter Python 端处理时 SHALL 输出逐块一致，且共享向量 SHALL 锁定新增边界与引号场景。

#### Scenario: 完整用户文案回归
- **WHEN** 三端处理用户提供的明代士绅文案
- **THEN** 结果 SHALL 逐块一致，保护词不跨块，正文拼接覆盖原文（忽略块尾句读和被规范化移除的未配对引号）

### Requirement: 完成体“了”后的宾语边界保护

字幕切分器 SHALL 默认保护动词完成体“了”与其后的普通汉字宾语，不得把“了”后的第一个普通汉字位置作为优先切点。标点、空白和共享规则表明确允许的从句引导字仍可形成边界；该保护 SHALL 同时覆盖语义候选、好切点候选和平衡/最终 fallback。

#### Scenario: 普通宾语不从“了”后脱离
- **WHEN** 以相同 min/max 配置处理 杀了人、完成了任务 或 写了信 并需要长度切分
- **THEN** 不得在 了|人、了|任 或 了|信 位置产生优先字幕边界，且拼接后的字幕保留完整原文

#### Scenario: 真实条款引导仍可切分
- **WHEN** 处理 他完成了但是仍然需要继续说明这个决定 或“了”后紧跟标点/空白的文本
- **THEN** 允许在“了”后真实从句引导或标点边界切分，不得因宾语保护吞掉该语义边界

#### Scenario: 成了例外保持既有语义
- **WHEN** 处理包含 成了 的文本，并且该边界不是 完成了 或 做成了 的普通宾语边界
- **THEN** SHALL 按既有语义候选规则判断，不得把所有“成了”文本一律视为不可切分

### Requirement: 短语边界感知切分（v1.3）

无标点长块硬切时，字幕切分器 SHALL 优先落在共享规则表 `word_split.phrase_boundary.pairs` 登记的显式成对短语右边界。切点判定 = 块以某 pair 的 `left` 逐字结尾，且紧随其后的字符命中该 pair 的 `next`。仅单侧命中（或仅命中字符集而不满足成对约束）SHALL NOT 构成短语边界，以避免把「某|些」「票仓的|无奈」这类受保护词内部位置误判为边界。

短语边界切分的头块 SHALL 允许放宽到 `min_chars_per_block - phrase_boundary.min_head_relax`；尾块仍要求 ≥ `min_chars_per_block`，避免产生过短尾块。该放宽路径产生的 `< min_chars` 头块 SHALL 在共享向量 `short_block_exceptions` 中按 index 显式声明 reason。

短语边界 SHALL 与优先级标点等价，在 Step 3 累积阶段即兑现切分，不得等到 MAX 分支的兜底路径（那里合法窗口已错过最佳切点，会退化为算术位置裸切）。

#### Scenario: 为了拉拢不在某些内部劈开
- **WHEN** 对 很多人以为，这是一个简单的政治表态，是选举年为了拉拢某些特定票仓的无奈之举。 以 min=8/max=15 分句
- **THEN** 输出包含 是选举年为了 与 拉拢某些特定票仓的无奈之举，禁止出现 是选举年为了拉拢某 + 些特定票仓的 拆块

#### Scenario: 地缘政治不被劈开
- **WHEN** 对 我们常常会被宏大的地缘政治术语淹没，觉得这事儿离自己太远。 分句
- **THEN** 输出包含 我们常常会被宏大的 与 地缘政治术语淹没，禁止出现 我们常常会被宏大的地 + 缘政治术语 拆块

#### Scenario: 日常生活不被劈开
- **WHEN** 对 最终会体现为日常生活中的隔阂与偏见。 分句
- **THEN** 输出包含 最终会体现为 与 日常生活中的隔阂与偏见，禁止出现 最终会体现为日常 + 生活中的隔阂 拆块

#### Scenario: 短语边界头块放宽须显式声明
- **WHEN** 短语边界路径产生 clean 后 < min_chars 的头块（如 是选举年为了 6 字、去理解那段历史 7 字）
- **THEN** 该块 SHALL 保留且必须在共享向量 `short_block_exceptions` 中按 index 显式声明 reason；未声明的 < min_chars 块视为违规

#### Scenario: 三端短语边界一致
- **WHEN** TypeScript、Electron JS 镜像和 smart-sentence-splitter Python 端加载同一规则表处理同一输入
- **THEN** 三端 SHALL 输出逐块相同的字幕文本，短语边界位置完全一致

#### Scenario: 规则表缺省向后兼容
- **WHEN** 规则表不含 `word_split.phrase_boundary` 段（旧版规则表）
- **THEN** 短语边界判定 SHALL 恒为 false，`min_head_relax` SHALL 为 0，分句行为与 v1.2 完全一致

### Requirement: 词边界判断异常时安全回退

本地词边界判断器缺失、初始化失败、词典加载失败或运行时抛错时，字幕主流程 SHALL 继续使用显式短语、字符规则和安全边界守卫，不得让 soft tie-break 异常使整段分句失败。所有长度 fallback SHALL 复用同一安全边界合同；在当前范围内找不到合法边界时，系统 SHALL 保留完整块或扩大安全搜索范围。

#### Scenario: 词边界判断器运行时失败
- **WHEN** 本地词边界判断器在切分过程中抛出异常
- **THEN** 分句流程继续完成，输出不落在显式保护短语、代理对或小数 token 内部，且异常不向字幕调用方透出为未处理错误

#### Scenario: 安全边界不存在时不裸切
- **WHEN** 超长块的所有候选位置都被保护短语、“了”后宾语或小数边界守卫拒绝
- **THEN** 系统 SHALL 保留该块或等待后续安全边界，不得用固定算术位置绕过保护合同，也不得进入死循环
