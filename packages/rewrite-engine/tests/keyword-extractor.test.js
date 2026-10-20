/**
 * keyword-extractor tests
 *
 * Coverage:
 * - 中文长文规则提取（词频排序、停用词过滤）
 * - 英文混排
 * - 纯停用词 / 空输入
 * - LLM 兜底：严格 JSON 解析、fail-open（非法 JSON / 调用异常返回空数组）
 */
var { extractSync, extractWithLLM } = require('../src/keyword-extractor')

describe('keyword-extractor', function () {
  test('中文长文提取按词频排序且不含停用词', function () {
    var text = '自媒体运营的核心是内容质量。内容质量决定了自媒体账号的天花板。' +
      '很多自媒体人忽视内容质量，只追求流量。流量思维让自媒体账号越做越差。'
    var keywords = extractSync(text, 5)
    expect(Array.isArray(keywords)).toBe(true)
    expect(keywords.length).toBeGreaterThan(0)
    expect(keywords.length).toBeLessThanOrEqual(5)
    // 高频词「自媒体」应排前
    expect(keywords.indexOf('自媒体')).toBeGreaterThanOrEqual(0)
    expect(keywords[0]).toBe('自媒体')
    // 停用词不出现
    keywords.forEach(function (k) {
      expect(['的', '了', '是', '在', '让', '没有']).not.toContain(k)
    })
  })

  test('英文混排提取英文整词', function () {
    var text = 'Content marketing is the core of content strategy. Content is king.'
    var keywords = extractSync(text, 3)
    expect(keywords.length).toBeGreaterThan(0)
    expect(keywords).toContain('content')
  })

  test('纯停用词输入返回空数组', function () {
    var keywords = extractSync('的 了 是 在 和 与 或', 5)
    expect(keywords).toEqual([])
  })

  test('空输入返回空数组', function () {
    expect(extractSync('', 5)).toEqual([])
    expect(extractSync(null, 5)).toEqual([])
    expect(extractSync(undefined, 5)).toEqual([])
  })

  test('topN 截断', function () {
    var text = '苹果 香蕉 苹果 橙子 苹果 香蕉 葡萄 西瓜 芒果 草莓 蓝莓 樱桃'
    var keywords = extractSync(text, 3)
    expect(keywords.length).toBeLessThanOrEqual(3)
  })

  test('extractWithLLM 解析严格 JSON 成功', async function () {
    var llmClient = { chat: async function () { return '{"keywords": ["自媒体", "内容质量"]}' } }
    var keywords = await extractWithLLM('任意文本', 5, llmClient)
    expect(keywords).toEqual(['自媒体', '内容质量'])
  })

  test('extractWithLLM 剥离代码围栏', async function () {
    var llmClient = { chat: async function () { return '```json\n{"keywords": ["钩子"]}\n```' } }
    var keywords = await extractWithLLM('任意文本', 5, llmClient)
    expect(keywords).toEqual(['钩子'])
  })

  test('extractWithLLM 非法 JSON fail-open 返回空数组', async function () {
    var llmClient = { chat: async function () { return 'not json at all' } }
    var keywords = await extractWithLLM('任意文本', 5, llmClient)
    expect(keywords).toEqual([])
  })

  test('extractWithLLM 调用异常 fail-open 返回空数组', async function () {
    var llmClient = { chat: async function () { throw new Error('LLM unavailable') } }
    var keywords = await extractWithLLM('任意文本', 5, llmClient)
    expect(keywords).toEqual([])
  })

  test('extractWithLLM 无客户端返回空数组', async function () {
    var keywords = await extractWithLLM('任意文本', 5, null)
    expect(keywords).toEqual([])
  })

  test('extractWithLLM 关键词数量截断且过滤非字符串', async function () {
    var llmClient = { chat: async function () { return '{"keywords": ["甲乙", "丙丁", "戊己", 42, null]}' } }
    var keywords = await extractWithLLM('任意文本', 2, llmClient)
    expect(keywords).toEqual(['甲乙', '丙丁'])
  })

  // ── rewrite-segment-and-finish-reason：chat object 形态回归（第二消费点）──
  // 背景：finish_reason 透传后主 llmClient 返回 {text, finishReason}；
  // extractWithLLM 历史上对非 string fail-open 静默返回 []。以下两例锁住归一化。

  test('extractWithLLM chat 返回 {text} object ⇒ 仍能提取关键词（不静默失效）', async function () {
    var llmClient = { chat: async function () { return { text: '{"keywords": ["自媒体", "内容质量"]}', finishReason: 'stop' } } }
    var keywords = await extractWithLLM('任意文本', 5, llmClient)
    expect(keywords).toEqual(['自媒体', '内容质量'])
  })

  test('extractWithLLM chat 返回 {text:""} ⇒ fail-open 空数组（归一化后判空）', async function () {
    var llmClient = { chat: async function () { return { text: '', finishReason: 'stop' } } }
    var keywords = await extractWithLLM('任意文本', 5, llmClient)
    expect(keywords).toEqual([])
  })

  test('extractWithLLM chat 返回数字等非法 shape ⇒ fail-open 空数组', async function () {
    var llmClient = { chat: async function () { return 42 } }
    var keywords = await extractWithLLM('任意文本', 5, llmClient)
    expect(keywords).toEqual([])
  })
})

// ===== 审查修复回归（PR #1746 双模型审查发现）=====

describe('keyword-extractor 审查修复回归', function () {
  test('多代码围栏输出取最后一个围栏（贪婪语义）', async function () {
    var llmClient = { chat: async function () {
      return '分析如下：\n```\n一些推理过程\n```\n\n```json\n{"keywords": ["目标词"]}\n```'
    } }
    var keywords = await extractWithLLM('任意文本', 5, llmClient)
    expect(keywords).toEqual(['目标词'])
  })

  test('LLM 返回停用词被过滤', async function () {
    var llmClient = { chat: async function () { return '{"keywords": ["的", "不是", "有效词"]}' } }
    var keywords = await extractWithLLM('任意文本', 5, llmClient)
    expect(keywords).toEqual(['有效词'])
  })

  test('中英混排在无 Segmenter 回退路径不丢英文（通过 tokenize 间接验证）', function () {
    var { tokenize } = require('../src/keyword-extractor')
    var words = tokenize('自媒体 Content Marketing 运营')
    expect(words).toContain('content')
    expect(words).toContain('marketing')
  })
})
