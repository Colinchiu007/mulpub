// @ts-check
/**
 * quick-collect-presets — 官方内置的快捷采集指令（只读目录）
 *
 * 为什么放在主进程而不是渲染端：
 *   ① 内置词条是**产品内容**（6 段长提示词），放 `src/` 会进 CI 的渲染端 CJK 硬编码扫描面；
 *   ② 版本升级时内置词条必须随应用更新 —— 一旦落盘，旧副本会盖住新版本，用户永远看到老提示词。
 *      因此内置指令**不落盘**（渲染端写入设置键时过滤掉 `builtin === true`）。
 *
 * 词条设计口径：
 *   - `keywords` 只放**英文**检索词：`search` 类检索源是 Reddit / HN / GitHub 三个英文社区，
 *     中文关键词在这三个源上命中率极低（实测口径见 PRD §6.2 与本 change 的记录）；
 *   - `sources` 是**闭集子集**（唯一真源 = `quick-collect-sources.js`）：可以是 `kind:'search'`
 *     的英文社区，也可以是 `kind:'trend'` 的中文榜单/时间线（后者无需关键词，按榜单取）；
 *   - 每个词条最多 3 个关键词（引擎只取前 3 个，避免一次点击打出十几条外呼）；
 *   - `windowHours` 取 48（时效类）或 168（周级盘点类），取闭集值；
 *   - 「榜单素材没有发布时间」这条约束写在 **system 提示词**里（`quick-collect-prompt.js`
 *     硬约束第 6 条），**不在每个内置词条里重复一遍** —— 单实现才守得住；
 *   - `provenance` 标注这段话的**来源**：`'user'` = 用户给定原文（必须逐字，改动即改需求，有对照串锁着），
 *     `'agent'` = 依 PRD 场景推演的产品内容（可以随需求调整）。**不得把 agent 推演当成用户要求**：
 *     2026-10-11 曾出现"平台规则与合规动向"这条 agent 设计的词条被当成用户需求、并据此排了一整片
 *     素材源扩展（S3）的情况 —— 加了这个字段 + 一条"只有 AI 领域动向是 user"的断言，下次先红在这里。
 */

/** 中文热榜源（`kind:'trend'`，无发布时间，按抓取时刻计入窗口） */
const CN_HOT_SOURCES = Object.freeze(['weibo', 'zhihu', 'douyin', 'bilibili', 'baidu', 'toutiao', 'tencent'])
/** 中文榜单垂类（hot-topics 实际提供的两个垂类信道；榜单类同样没有发布时间） */
const CN_HOT_VERTICALS = Object.freeze(['sina_finance', 'ithome_tech'])
/** 英文社区检索源（`kind:'search'`） */
const EN_SEARCH_SOURCES = Object.freeze(['reddit', 'hackernews', 'github'])

/** @type {ReadonlyArray<object>} */
const PRESET_COMMANDS = Object.freeze([
  Object.freeze({
    id: 'builtin-ai-trends',
    icon: '🤖',
    title: 'AI 领域动向',
    summary: '过去 48 小时 AI / 新技术领域的版本发布、新项目与值得关注的事件',
    prompt: "请检索过去48小时内AI与新技术领域的真实动态，覆盖三类：1) 主流大模型/AI框架（如OpenAI、Anthropic、Deepseek、GLM、Kimi、SeeDance、Llama、PyTorch、vLLM等）的新版本发布或安全公告；2) GitHub上热度上升、值得工程师试用的新AI项目；3) 其他对你判断'值不值得关注'有重大影响的事件。输出一份简短摘要：3-5条'建议关注'（每条含事件、来源链接、为什么重要、建议动作），2-3条'可忽略'一句话带过。用中文，不要编造，找不到可靠信息就如实说。",
    keywords: ['LLM release', 'AI model', 'GitHub AI project'],
    windowHours: 48,
    // 提示词逐字不动（用户需求原文），只把素材源换成"英文社区 + 有发布时间的 AI/技术时间线"
    sources: ['arxiv_cs_ai', 'hf_papers', 'qbitai', 'solidot', ...EN_SEARCH_SOURCES],
    provenance: 'user',
    builtin: true,
  }),
  Object.freeze({
    id: 'builtin-ai-papers',
    icon: '📄',
    title: 'AI 前沿论文速览',
    summary: '最近一周值得看的 AI/机器学习论文与新方法，含一句话结论与能不能用上',
    prompt: '请检索最近一周内 AI 与机器学习领域值得关注的新论文与新方法，输出 3-5 条「值得一看」，每条包含：1) 一句话结论（解决了什么问题、核心思路是什么）；2) 来源链接（论文页或官方博客）；3) 为什么值得关注（对哪类人有价值：模型训练 / 推理优化 / 多模态 / Agent / 内容生产等）；4) 是否已有开源实现或可直接试用的工具。再单列 2-3 条「可以先不看」（纯增量调参、评测刷分、尚无复现的宣称）。用中文，只写能核对的来源，找不到可靠信息就如实说，不要编造论文标题、作者或数字。',
    keywords: ['new AI paper', 'machine learning method', 'AI research release'],
    windowHours: 168,
    sources: ['arxiv_cs_ai', 'hf_papers', 'qbitai', ...EN_SEARCH_SOURCES],
    provenance: 'agent',
    builtin: true,
  }),
  Object.freeze({
    id: 'builtin-hot-topics',
    icon: '🔥',
    title: '热点选题雷达',
    summary: '最近 48 小时技术/互联网圈在热议什么，能写成什么选题',
    prompt: '请检索最近 48 小时内技术、互联网与创作者圈层里讨论量明显上升的话题，输出 5 条可写选题，每条包含：1) 话题一句话；2) 为什么现在热（给出素材里的依据，例如讨论量、来源）；3) 来源链接；4) 建议的切入角度（面向哪个读者、从什么争议点切入）；5) 预估写作难度（低/中/高）。另外用一句话列出 2 条「看着热但其实没有新信息」的伪热点。用中文，不要编造事件和链接，素材不足以判断"热"就如实说。',
    keywords: ['trending topic', 'viral content', 'tech trend'],
    windowHours: 48,
    sources: [...CN_HOT_SOURCES, ...CN_HOT_VERTICALS, ...EN_SEARCH_SOURCES],
    provenance: 'agent',
    builtin: true,
  }),
  Object.freeze({
    id: 'builtin-dev-tools',
    icon: '🧰',
    title: '创作工具与效率新品',
    summary: '剪辑 / 配音 / 生图 / 写作类工具的新版本、新能力与值得试用的点',
    prompt: '请检索最近一周内与内容创作效率工具有关的真实更新，覆盖：1) 视频剪辑与字幕类；2) 语音合成 / 配音 / 克隆类；3) 图像与视频生成类；4) 写作与排版类。输出 4 条「值得试用」（每条含：工具名、更新了什么、来源链接、适合什么场景、上手成本），再用一句话列出 2 条「只是营销话术、暂无实际可用更新」。用中文，工具名与版本号必须来自素材，找不到就如实说。',
    keywords: ['video editing AI', 'image generation tool', 'text to speech tool'],
    windowHours: 168,
    sources: ['qbitai', 'infoq_cn', 'sspai', 'oschina', 'ithome_tech', ...EN_SEARCH_SOURCES],
    provenance: 'agent',
    builtin: true,
  }),
  Object.freeze({
    id: 'builtin-peer-content',
    icon: '📈',
    title: '同行内容与形式趋势',
    summary: '同赛道创作者最近在写什么、什么形式在起量',
    prompt: '请检索最近一周内与创作者内容趋势有关的真实讨论，覆盖：1) 什么内容形式正在起量（长文 / 短视频 / 图文 / 播客等）与其原因；2) 哪些平台的分发机制或流量结构发生了变化；3) 创作者普遍在抱怨或验证有效的做法。输出 3 条「趋势判断」（每条含：观察到的现象、来源链接、支持它的证据、对我可以怎么用），并说明这些观察在多大程度上能推广（哪些是社区共识、哪些只是个别案例）。用中文，不要编造数据；如果素材只够支撑 1-2 条判断，就只输出 1-2 条。',
    keywords: ['content creator growth', 'short video trend', 'newsletter growth'],
    windowHours: 168,
    sources: ['bilibili', 'douyin', 'weibo', 'sspai', 'oschina', ...EN_SEARCH_SOURCES],
    provenance: 'agent',
    builtin: true,
  }),
  Object.freeze({
    id: 'builtin-ai-howto',
    icon: '🛠️',
    title: 'AI 实操技巧与工作流',
    summary: '被真实使用者验证有效的 AI 用法、提示词与自动化流程，照着做就能用',
    prompt: '请检索最近一周内被真实使用者验证有效的 AI 实操技巧与工作流，输出 3-5 条「可以直接照做」的做法，每条包含：1) 做法一句话；2) 适用场景与前置条件（用什么模型或工具、需要什么账号或权限）；3) 关键步骤或提示词要点（给出可复制的最小骨架，不要只讲概念）；4) 来源链接与是否有他人复现反馈；5) 预期收益（省下什么时间、解决哪个具体问题）。再单列 1-2 条「听着好但实际不好用」的做法及原因。用中文，只写能核对的来源，找不到可靠信息就如实说，不要编造工具名或功能。',
    keywords: ['AI workflow', 'prompt engineering tips', 'AI automation'],
    windowHours: 168,
    sources: ['sspai', 'oschina', 'infoq_cn', ...EN_SEARCH_SOURCES],
    provenance: 'agent',
    builtin: true,
  }),
])

/**
 * 内置目录（深拷贝出口：调用方改了返回值不能污染单例）。
 * @returns {object[]}
 */
function listPresetCommands () {
  return PRESET_COMMANDS.map((c) => ({
    ...c,
    keywords: [...c.keywords],
    sources: [...c.sources],
  }))
}

/** @returns {object|null} 深拷贝的内置词条（含变化时用于版本提示） */
function getPresetCommand (id) {
  const found = listPresetCommands().find((c) => c.id === id)
  return found || null
}

/** 内置 id 集合（渲染端据此判断"不可编辑/不可删除"，也用于落盘过滤） */
const PRESET_IDS = Object.freeze(PRESET_COMMANDS.map((c) => c.id))

module.exports = { PRESET_COMMANDS, PRESET_IDS, listPresetCommands, getPresetCommand }
