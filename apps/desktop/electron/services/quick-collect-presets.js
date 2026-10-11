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
 *     硬约束第 6 条），**不在每个内置词条里重复一遍** —— 单实现才守得住。
 */

/** 中文热榜源（`kind:'trend'`，无发布时间，按抓取时刻计入窗口） */
const CN_HOT_SOURCES = Object.freeze(['weibo', 'zhihu', 'douyin', 'bilibili', 'baidu', 'toutiao', 'tencent'])
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
    sources: ['reddit', 'hackernews', 'github'],
    builtin: true,
  }),
  Object.freeze({
    id: 'builtin-platform-policy',
    icon: '📜',
    title: '平台规则与合规动向',
    summary: '内容平台规则、审核口径、AIGC 标识与限流封禁相关的真实变化',
    prompt: '请检索最近一周内与内容平台规则、内容审核口径、AIGC（AI 生成内容）标识要求、限流与封禁治理相关的真实变化，覆盖：1) 主流内容/社交平台（短视频、图文、社区）的官方公告或政策更新；2) 各国监管对大模型与生成式内容的合规要求变化；3) 已被证实的大规模限流、下架或处罚事件。输出 3-5 条「需要留意」（每条含：变化内容、来源链接、会影响谁、创作者现在应该做什么），并单列 1-2 条「与我无关」的噪音。用中文，只写能核对的来源，找不到可靠信息就如实说，不要编造条款编号。',
    keywords: ['content moderation', 'platform policy', 'AI content labeling'],
    windowHours: 168,
    sources: ['reddit', 'hackernews', 'github'],
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
    sources: [...CN_HOT_SOURCES, ...EN_SEARCH_SOURCES],
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
    sources: ['reddit', 'hackernews', 'github'],
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
    sources: ['bilibili', 'douyin', 'weibo', ...EN_SEARCH_SOURCES],
    builtin: true,
  }),
  Object.freeze({
    id: 'builtin-risk-alert',
    icon: '⚠️',
    title: '舆情风险与避雷',
    summary: '近期与创作/发布相关的争议、版权与账号风险信号',
    prompt: '请检索最近一周内与内容创作者风险有关的真实事件与讨论，覆盖：1) 因内容引发的争议、舆情与删帖/下架案例；2) 版权、字体、音乐、素材授权相关的纠纷或平台判罚；3) 账号被限流、封禁、禁言的公开案例与官方说明。输出 4 条「避雷清单」（每条含：发生了什么、来源链接、触发条件、我怎么避免），并标注每条的可信度（官方公告 / 多方报道 / 只有单方说法）。用中文，不要编造案例；没有任何可靠信息就明确说"本周未发现可靠的风险事件"，不要为了凑条数编。',
    keywords: ['content controversy', 'copyright claim', 'account suspended'],
    windowHours: 168,
    sources: ['weibo', ...EN_SEARCH_SOURCES],
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
