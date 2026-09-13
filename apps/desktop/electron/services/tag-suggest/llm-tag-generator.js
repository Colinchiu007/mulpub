// @ts-check
/**
 * llm-tag-generator — LLM 标签生成
 *
 * 组装 system/user prompt，调用 aiGenerator.generateWithDefault('llm')，
 * 对返回文本做 stripCodeFence + JSON.parse + fail-closed 校验。
 */
const { stripCodeFence } = require('../prompt-eval/llm')

const PLATFORM_PERSONALITY = {
  zhihu: '知乎：知识社区，标签倾向专业术语和领域话题。示例：人工智能、深度学习、行业分析、职业发展。避免：过于口语化或娱乐化标签',
  weibo: '微博：社交话题广场，标签为 #话题# 格式，倾向热点事件和社会讨论。示例：#人工智能#、#AI新突破#、#科技前沿#。避免：过于学术化标签，微博用户偏好通俗易懂',
  xiaohongshu: '小红书：生活方式平台，标签为 #话题# 格式，倾向生活化、场景化、情绪化表达。示例：#科技好物分享#、#AI工具推荐#、#效率神器#。避免：纯学术标签，小红书用户偏好实用+种草风格',
  bilibili: 'B站：视频社区，标签倾向二次元、游戏、科技评测、知识科普。示例：人工智能、AI教程、科技UP主、硬核科普。避免：小红书式的种草标签',
  toutiao: '今日头条：新闻资讯平台，标签倾向时事、社会热点、政策解读。示例：人工智能、AI政策、科技产业、数字经济。避免：二次元或过度娱乐化标签',
}

const SYSTEM_PROMPT = [
  '你是一位中国社交媒体标签策略专家。用户将提供一篇文章的内容，你需要为指定平台生成两类标签：',
  '',
  '1. **内容标签**（content）：描述文章核心主题的关键词，用于平台推荐算法理解内容。',
  '2. **流量标签**（traffic）：与当前热门话题相关的标签，用于获取额外曝光，但必须与文章内容有关联，不可硬蹭。',
  '',
  '## 平台人格',
  '',
  '{platformPersonality}',
  '',
  '## 输出规则',
  '',
  '- 每个平台生成 3-6 个内容标签和 2-4 个流量标签',
  '- 标签不得包含空格，中文标签不超过 8 字，英文标签不超过 30 字符',
  '- 流量标签必须与文章内容存在语义关联，禁止无关蹭热度',
  '- 严格按以下 JSON 格式输出，不要输出任何其他内容：',
  '',
  '{',
  '  "platforms": {',
  '    "{platform}": {',
  '      "content": ["标签1", "标签2"],',
  '      "traffic": ["热门标签1", "热门标签2"]',
  '    }',
  '  },',
  '  "reasoning": {',
  '    "contentFocus": "一句话概括文章核心主题",',
  '    "trafficAngle": "一句话说明蹭热度角度"',
  '  }',
  '}',
].join('\n')

/**
 * 组装 messages 与调用参数。
 */
function buildMessages ({ content, platforms, hotTopicsByPlatform }) {
  const personalityBlock = platforms
    .map(function (p) { return '## ' + p + '\n' + (PLATFORM_PERSONALITY[p] || PLATFORM_PERSONALITY.zhihu) })
    .join('\n\n')

  const systemPrompt = SYSTEM_PROMPT.replace('{platformPersonality}', personalityBlock)

  let hotBlock = ''
  if (hotTopicsByPlatform && Object.keys(hotTopicsByPlatform).length > 0) {
    const parts = Object.entries(hotTopicsByPlatform).map(function (entry) {
      var p = entry[0]; var topics = entry[1] || []
      var list = topics.slice(0, 5).map(function (t) { return t.tag }).join('、')
      return p + ': ' + list
    })
    hotBlock = '\n## 当前热门话题参考\n\n' + parts.join('\n')
  }

  const userPrompt = '## 文章内容\n\n' + content + '\n\n## 目标平台\n\n' + platforms.join('、') + hotBlock + '\n\n请为以上平台生成标签。'

  return {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.5,
    max_tokens: 800,
  }
}

/**
 * 解析并校验 LLM 输出（fail-closed）。
 */
function parseAndValidate (rawText) {
  const cleaned = stripCodeFence(String(rawText || '')).trim()
  if (!cleaned) throw new Error('LLM 输出为空')
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    throw new Error('LLM 输出非合法 JSON: ' + e.message, { cause: e })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LLM 输出非对象')
  }
  if (!parsed.platforms || typeof parsed.platforms !== 'object') {
    throw new Error('LLM 输出缺少 platforms')
  }
  const platforms = {}
  for (const entry of Object.entries(parsed.platforms)) {
    const key = entry[0]; const val = entry[1]
    if (!val || typeof val !== 'object') continue
    const content = val.content; const traffic = val.traffic
    if (!Array.isArray(content) || content.some(function (t) { return typeof t !== 'string' })) {
      throw new Error('平台 ' + key + ' content 非字符串数组')
    }
    if (!Array.isArray(traffic) || traffic.some(function (t) { return typeof t !== 'string' })) {
      throw new Error('平台 ' + key + ' traffic 非字符串数组')
    }
    platforms[key] = { content: content.slice(), traffic: traffic.slice() }
  }
  if (Object.keys(platforms).length === 0) {
    throw new Error('LLM 输出无有效平台标签')
  }
  const reasoning = parsed.reasoning && typeof parsed.reasoning === 'object' ? parsed.reasoning : null
  return { platforms: platforms, reasoning: reasoning }
}

module.exports = {
  PLATFORM_PERSONALITY,
  SYSTEM_PROMPT,
  buildMessages,
  parseAndValidate,
}
