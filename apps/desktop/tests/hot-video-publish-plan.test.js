/**
 * hot-video-publish-plan 单元测试（mp-hot-topics-video-publish E2E 发布扩展）
 *
 * 纯函数 helper：把「已生成视频的热门选题」转换为 publish:batch 所需的
 * 发布目标（targets）与文章载荷（article）。全部为 CJS，供 E2E 驱动与
 * 本测试共同 require。
 */

const {
  buildPublishTargets,
  buildPublishArticle,
  buildPublishPlan,
  extractStoryText,
} = require('./e2e/lib/hot-video-publish-plan')

const acc = (over) => ({
  id: 'a1',
  platform: 'baijiahao',
  name: '账号一',
  status: 'active',
  has_cookies: true,
  ...over,
})

describe('buildPublishTargets', () => {
  it('只保留 active 且有 cookies 的账号，映射为 {platform, accountId}', () => {
    const accounts = [
      acc({ id: 'b1', platform: 'baijiahao' }),
      acc({ id: 'k1', platform: 'kuaishou', status: 'expired' }),
      acc({ id: 'd1', platform: 'douyin', has_cookies: false }),
      acc({ id: 't1', platform: 'toutiao' }),
    ]
    expect(buildPublishTargets(accounts)).toEqual([
      { platform: 'baijiahao', accountId: 'b1' },
      { platform: 'toutiao', accountId: 't1' },
    ])
  })

  it('支持平台白名单过滤（onlyPlatforms）', () => {
    const accounts = [
      acc({ id: 'b1', platform: 'baijiahao' }),
      acc({ id: 't1', platform: 'toutiao' }),
    ]
    expect(buildPublishTargets(accounts, { onlyPlatforms: ['toutiao'] })).toEqual([
      { platform: 'toutiao', accountId: 't1' },
    ])
  })

  it('同一平台多账号全部保留（能发的都发）', () => {
    const accounts = [
      acc({ id: 'b1', platform: 'baijiahao' }),
      acc({ id: 'b2', platform: 'baijiahao', name: '账号二' }),
    ]
    expect(buildPublishTargets(accounts)).toHaveLength(2)
  })

  it('非数组输入返回空数组', () => {
    expect(buildPublishTargets(null)).toEqual([])
    expect(buildPublishTargets(undefined)).toEqual([])
  })

  it('is_active=true 但无 status 字段也视为可用（兼容旧数据结构）', () => {
    const accounts = [{ id: 'x1', platform: 'bilibili', is_active: true, has_cookies: true }]
    expect(buildPublishTargets(accounts)).toEqual([{ platform: 'bilibili', accountId: 'x1' }])
  })
})

describe('buildPublishArticle', () => {
  const base = {
    topic: { id: 'ht-1', title: '一个足够长的热门选题标题用于测试截断行为验证', summary: '摘要' },
    rewrittenText: '改写引擎生成的完整正文内容。',
    videoPath: 'D:/out/video-1.mp4',
  }

  it('正常产出 article：title 取选题标题、content 优先取改写全文、video_path 必填', () => {
    const article = buildPublishArticle(base)
    expect(article.title).toBe(base.topic.title)
    expect(article.content).toBe('改写引擎生成的完整正文内容。')
    expect(article.video_path).toBe('D:/out/video-1.mp4')
    expect(Array.isArray(article.tags)).toBe(true)
  })

  it('超长标题按 maxTitleLength 截断（默认 60）', () => {
    const long = { ...base, topic: { title: 'x'.repeat(100) } }
    const article = buildPublishArticle(long)
    expect(article.title.length).toBeLessThanOrEqual(60)
    expect(article.title.startsWith('xxxx')).toBe(true)
  })

  it('无改写文本时回退选题 summary/title 作为内容', () => {
    const article = buildPublishArticle({ ...base, rewrittenText: '' })
    expect(article.content).toBe('摘要')
    const article2 = buildPublishArticle({
      topic: { title: '仅标题' },
      videoPath: 'D:/v.mp4',
    })
    expect(article2.content).toBe('仅标题')
  })

  it('缺少 videoPath 抛错（无视频不得发布）', () => {
    expect(() => buildPublishArticle({ ...base, videoPath: '' })).toThrow(/video/i)
    expect(() => buildPublishArticle({ ...base, videoPath: null })).toThrow(/video/i)
  })

  it('缺少标题抛错', () => {
    expect(() =>
      buildPublishArticle({ topic: { title: '   ' }, videoPath: 'D:/v.mp4' })
    ).toThrow(/title/i)
  })

  it('coverPath/tags 透传', () => {
    const article = buildPublishArticle({
      ...base,
      coverPath: 'D:/out/cover.jpg',
      tags: ['热门', '故事'],
    })
    expect(article.cover_path).toBe('D:/out/cover.jpg')
    expect(article.tags).toEqual(['热门', '故事'])
  })
})

describe('buildPublishPlan', () => {
  const input = {
    accounts: [{ id: 'b1', platform: 'baijiahao', status: 'active', has_cookies: true }],
    topic: { title: '选题', summary: '摘要' },
    rewrittenText: '正文',
    videoPath: 'D:/v.mp4',
  }

  it('组合产出 { targets, article }', () => {
    const plan = buildPublishPlan(input)
    expect(plan.targets).toEqual([{ platform: 'baijiahao', accountId: 'b1' }])
    expect(plan.article.video_path).toBe('D:/v.mp4')
  })

  it('无可用发布目标时抛 NO_PUBLISH_TARGETS', () => {
    expect(() =>
      buildPublishPlan({ ...input, accounts: [] })
    ).toThrow(/NO_PUBLISH_TARGETS/)
  })
})

describe('extractStoryText（从流水线 run context 提取改写全文）', () => {
  it('优先取 scene_context.scenes[0].context.full_text', () => {
    const ctx = {
      split: { scenes: [{ text: '片段一' }, { text: '片段二' }] },
      scene_context: { scenes: [{ text: '片段一', context: { full_text: '片段一片段二合并全文' } }] },
    }
    expect(extractStoryText(ctx)).toBe('片段一片段二合并全文')
  })

  it('full_text 缺失时回退拼接 split.scenes[].text', () => {
    const ctx = { split: { scenes: [{ text: 'A' }, { text: 'B' }] }, scene_context: { scenes: [] } }
    expect(extractStoryText(ctx)).toBe('AB')
  })

  it('两者都缺失返回空字符串（发布层自行回退 summary/title）', () => {
    expect(extractStoryText({})).toBe('')
    expect(extractStoryText(null)).toBe('')
    expect(extractStoryText(undefined)).toBe('')
  })

  it('full_text 存在但 split 缺失时仍取 full_text', () => {
    const ctx = { scene_context: { scenes: [{ context: { full_text: '仅全文' } }] } }
    expect(extractStoryText(ctx)).toBe('仅全文')
  })
})
