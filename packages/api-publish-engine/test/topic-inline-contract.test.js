// @ts-check
/**
 * topic-inline-contract.test.js — 话题内联描述跨包契约锁（publish-topic-inline-description）
 *
 * 锁三件事（spec delta「跨包话题内联契约锁」）：
 *   A) 15 平台三态矩阵清单（内联保留 / 内联转换双井号 / 剥离独立字段）——缩水/漂移即红
 *   B) 各平台适配器/链实际行为与矩阵一致（含抖音 text_extra 偏移、剥离完整性）
 *   C) 单一实现纪律——剥离/转换只准调 content-formatter，适配器源码不得自抄正则
 *
 * 反证口径（变异即红，断言精确性即锁）：
 *   - 摘 bilibili 的 stripTopicsFromContent 调用 → B-6 desc 含话题 → 红
 *   - 摘 douyin 的 text_extra 标记 → B-1 text_extra 为空数组 ≠ 期望 → 红
 *   - 摘 weibo/shipinhao 的 convertInlineTopics → B-4/B-3 单井号 ≠ 双井号 → 红
 */
import { describe, it, expect } from 'vitest'
const { buildDouyinPostData } = require('../src/publish/platforms/douyin-video.js')
const { buildKuaishouPostData } = require('../src/publish/platforms/kuaishou-video.js')
const { buildShipinhaoPostData } = require('../src/publish/platforms/shipinhao-video.js')
const { buildBilibiliPostData } = require('../src/publish/platforms/bilibili-video.js')
const WeiboAdapter = require('../src/adapters/weibo.js')
const ZhihuAdapter = require('../src/adapters/zhihu.js')
const ToutiaoAdapter = require('../src/adapters/toutiao.js')
const WechatMpAdapter = require('../src/adapters/wechat_mp.js')
const XiaohongshuAdapter = require('../src/adapters/xiaohongshu.js')
const { BaijiahaoArticleChain } = require('../src/publish/platforms/baijiahao-article.js')
const fs = require('fs')
const path = require('path')

// ---- A) 三态矩阵清单（单一真源；与 PRD §3.3 / design §3.2 对齐）----
const INLINE_KEEP = ['douyin', 'kuaishou', 'xiaohongshu', 'tiktok', 'twitter', 'instagram', 'youtube', 'facebook']
const INLINE_CONVERT = ['weibo', 'tencent_video', 'baijiahao']
const STRIP_TO_FIELD = ['bilibili', 'zhihu', 'toutiao', 'wechat_mp']
const ALL_PLATFORMS = [...INLINE_KEEP, ...INLINE_CONVERT, ...STRIP_TO_FIELD]

describe('A) 话题内联三态矩阵清单锁', () => {
  it('15 平台全覆盖且互不重叠（缩水/漂移即红）', () => {
    expect(ALL_PLATFORMS).toHaveLength(15)
    expect(new Set(ALL_PLATFORMS).size).toBe(15)
    expect(INLINE_KEEP).toHaveLength(8)
    expect(INLINE_CONVERT).toHaveLength(3)
    expect(STRIP_TO_FIELD).toHaveLength(4)
  })
})

describe('B) 平台行为锁（描述为话题真源，按矩阵三态消费）', () => {
  const TOPIC = '美食探店'
  const CONTENT = `今天探店 #${TOPIC} 太好吃了`

  it('B-1) douyin：content_desc 保留内联话题 + text_extra 位置标记（字符偏移）+ 无话题空数组', () => {
    const pd = buildDouyinPostData({ title: 'T', content: CONTENT, tags: [TOPIC] }, { videoId: 'V1', coverPoster: 'P1' })
    expect(pd.item.common.content_desc).toBe(CONTENT)
    // '#美食探店' 在 '今天探店 #美食探店 太好吃了' 中起于 5，长 5 → [5,10)
    expect(pd.item.common.text_extra).toEqual([
      { start: 5, end: 10, type: 0, user_id: '', hashtag_id: 0, hashtag_name: TOPIC },
    ])
    // 无话题时兼容现状（空数组）
    const plain = buildDouyinPostData({ title: 'T', content: '没有话题的正文' }, { videoId: 'V1', coverPoster: 'P1' })
    expect(plain.item.common.text_extra).toEqual([])
  })

  it('B-2) kuaishou：caption 保留内联话题（描述为真源，不拼 tags）', () => {
    const data = buildKuaishouPostData({ title: 'T', content: CONTENT, tags: [TOPIC] }, {})
    expect(data.caption).toBe(`T\n${CONTENT}`)
  })

  it('B-3) tencent_video：description 含 #话题#（微信系双井号隐性转换）', () => {
    const pd = buildShipinhaoPostData({ title: 'T', content: CONTENT, tags: [TOPIC] }, {}, {})
    expect(pd.description).toBe(`T\n今天探店 #${TOPIC}# 太好吃了`)
  })

  it('B-4) weibo：正文含 #话题#（微博双井号隐性转换）', () => {
    const adapter = new WeiboAdapter()
    const data = adapter.buildPostData({ title: 'T', content: CONTENT, tags: [TOPIC] })
    expect(data.content).toBe(`T\n今天探店 #${TOPIC}# 太好吃了`)
  })

  it('B-5) baijiahao：表单 content 含 #话题#（双井号拼正文，参考产品取证口径）', () => {
    const chain = new BaijiahaoArticleChain({})
    const form = chain.buildArticleFormData({ title: 'T', content: CONTENT, tags: [TOPIC] })
    const params = new URLSearchParams(form)
    // 2026-10-12 契约变更（publish-article-body-format）：百家号 `content` 是富文本编辑器的
    // HTML 承载字段，纯文本会被平台按 HTML 解析（换行=可忽略空白 → 整篇一整段）。
    // 话题转换仍先在纯文本上完成（`(^|\s)#话题` 边界成立），随后整体包 <p>。
    expect(params.get('content')).toBe(`<p>今天探店 #${TOPIC}# 太好吃了</p>`)
  })

  it('B-6) bilibili：desc 剥离话题 + tag 独立字段含（无双份重复）', () => {
    const pd = buildBilibiliPostData({ title: 'T', content: CONTENT, tags: [TOPIC] }, {})
    expect(pd.desc).toBe('今天探店 太好吃了')
    expect(pd.tag).toBe(TOPIC)
  })

  it('B-7) zhihu：content 剥离话题 + topics 字段含', () => {
    const adapter = new ZhihuAdapter()
    const pd = adapter.buildPostData({ title: 'T', content: CONTENT, tags: [TOPIC] })
    expect(pd.content).toBe('今天探店 太好吃了')
    expect(pd.topics).toEqual([{ name: TOPIC }])
  })

  it('B-8) toutiao：content 剥离话题 + tags 字段含', () => {
    const adapter = new ToutiaoAdapter()
    const data = adapter.buildPostData({ title: 'T', content: CONTENT, tags: [TOPIC] })
    expect(data.content).toBe('今天探店 太好吃了')
    expect(data.tags).toEqual([TOPIC])
  })

  it('B-9) wechat_mp：content 剥离话题 + tags 字段含', () => {
    const adapter = new WechatMpAdapter()
    const data = adapter.buildPostData({ title: 'T', content: CONTENT, tags: [TOPIC] })
    expect(data.content).toBe('今天探店 太好吃了')
    expect(data.tags).toBe(TOPIC)
  })

  it('B-10) xiaohongshu：content 保留内联话题（内联保留型）', () => {
    const adapter = new XiaohongshuAdapter()
    const data = adapter.buildPostData({ title: 'T', content: CONTENT, tags: [TOPIC] })
    expect(data.content).toBe(CONTENT)
  })

  it('B-11) youtube/tiktok/twitter：源码结构锁——content 透传无剥离（execute 需网络无法直跑）', () => {
    const read = (file) => fs.readFileSync(path.join(__dirname, '../src/adapters', file), 'utf8')
    const youtube = read('youtube.js')
    const tiktok = read('tiktok.js')
    const twitter = read('twitter.js')
    // 内联保留型平台：描述原样透传（话题已在 content 里），不出现剥离调用
    for (const [name, src] of [['youtube', youtube], ['tiktok', tiktok], ['twitter', twitter]]) {
      expect(src.includes('stripTopicsFromContent'), `${name} 不得剥离话题`).toBe(false)
      expect(src.includes('convertInlineTopics'), `${name} 不得转换话题格式`).toBe(false)
    }
  })

  it('B-12) 剥离完整性：剥离型平台描述无残留话题片段', () => {
    const multi = `开头 #话题A 中间 #话题B 结尾`
    const bilibili = buildBilibiliPostData({ title: 'T', content: multi, tags: ['话题A', '话题B'] }, {})
    expect(bilibili.desc).toBe('开头 中间 结尾')
    expect(bilibili.desc.includes('#')).toBe(false)
    const zhihu = new ZhihuAdapter().buildPostData({ title: 'T', content: multi, tags: ['话题A', '话题B'] })
    expect(zhihu.content.includes('#')).toBe(false)
  })

  it('B-13) 代码片段不误伤：#include 不在已知话题清单时剥离型平台原样保留', () => {
    const code = '代码 #include <stdio.h> 结尾'
    const bilibili = buildBilibiliPostData({ title: 'T', content: code, tags: ['美食'] }, {})
    expect(bilibili.desc).toBe(code)
  })
})

describe('C) 单一实现纪律（结构锁）', () => {
  const ADAPTER_FILES = [
    'weibo.js', 'zhihu.js', 'toutiao.js', 'wechat_mp.js', 'xiaohongshu.js',
    '../publish/platforms/bilibili-video.js', '../publish/platforms/baijiahao-article.js',
    '../publish/platforms/shipinhao-video.js',
  ]

  it('剥离/转换只准调 content-formatter，适配器源码不得自抄 # 正则替换', () => {
    for (const file of ADAPTER_FILES) {
      const src = fs.readFileSync(path.join(__dirname, '../src/adapters', file), 'utf8')
      // 自抄特征：replace + 动态拼接的 # 正则（content-formatter 之外的第二份实现）
      const selfRolled = /replace\(\s*new RegExp\([^)]*['"]#/.test(src)
      expect(selfRolled, `${file} 出现自抄话题正则`).toBe(false)
    }
  })
})
