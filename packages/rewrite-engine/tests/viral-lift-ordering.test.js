/**
 * P2-b：模式卡片 expected_lift 参与爆款检索排序（AC-P2-4）
 * - 带 done 卡片的条目按 expected_lift 降序优先采样
 * - NULL lift / 无卡片条目排后但不丢弃
 * - 聚合风格指导的标题公式取最高 lift 卡片
 */
var { KnowledgeContextBuilder } = require('../src/knowledge-context-builder')

function item(id, title) { return { id: id, title: title, content: '正文内容足够长用于测试钩子'.repeat(5), tags: '[]' } }
function card(itemId, lift, formula) {
  return {
    viral_item_id: itemId, status: 'done', hook_type: 'suspense', hook_analysis: '信息差',
    emotion_curve: 'rise', narrative_structure: 'list', cta_style: 'question',
    golden_quotes: ['金句'], title_formula: formula || '{X}后我才明白{Y}',
    expected_lift: lift,
  }
}
function builder(items, cards) {
  return new KnowledgeContextBuilder({
    viralLibrary: { search: function () { return items } },
    patternCards: { get: function (id) { return cards[id] || null } },
  })
}

describe('viral lift ordering (P2-b)', function () {
  test('带 lift 卡片条目降序优先，无卡片条目不丢弃排后', async function () {
    var items = [item('v1', '标题AAA'), item('v2', '标题BBB'), item('v3', '标题CCC')]
    var cards = { v1: card('v1', 10), v2: card('v2', 50) } // v3 无卡片
    var ctx = await builder(items, cards).buildFullContext('测试主题关键词', { useViralLibrary: true })
    // 三条都在（无卡片不丢弃）
    expect(ctx).toContain('标题AAA'); expect(ctx).toContain('标题BBB'); expect(ctx).toContain('标题CCC')
    // 顺序：BBB(50) 先于 AAA(10) 先于 CCC(无卡片)
    expect(ctx.indexOf('标题BBB')).toBeLessThan(ctx.indexOf('标题AAA'))
    expect(ctx.indexOf('标题AAA')).toBeLessThan(ctx.indexOf('标题CCC'))
  })

  test('NULL lift 的 done 卡片排在正 lift 之后但不丢弃', async function () {
    var items = [item('v1', '标题AAA'), item('v2', '标题BBB')]
    var cards = { v1: card('v1', null), v2: card('v2', 30) }
    var ctx = await builder(items, cards).buildFullContext('测试主题关键词', { useViralLibrary: true })
    expect(ctx).toContain('标题AAA'); expect(ctx).toContain('标题BBB')
    expect(ctx.indexOf('标题BBB')).toBeLessThan(ctx.indexOf('标题AAA'))
  })

  test('聚合风格指导的标题公式取最高 lift 卡片', async function () {
    var items = [item('v1', '标题AAA'), item('v2', '标题BBB')]
    var cards = { v1: card('v1', 5, '{低}公式'), v2: card('v2', 99, '{高}公式') }
    var ctx = await builder(items, cards).buildFullContext('测试主题关键词', { useViralLibrary: true })
    expect(ctx).toContain('标题公式参考「{高}公式」')
  })

  test('回归：无卡片时顺序与内容不变', async function () {
    var items = [item('v1', '标题AAA'), item('v2', '标题BBB')]
    var ctx = await builder(items, {}).buildFullContext('测试主题关键词', { useViralLibrary: true })
    expect(ctx).not.toContain('爆款风格指导')
    expect(ctx.indexOf('标题AAA')).toBeLessThan(ctx.indexOf('标题BBB'))
  })
})
