/**
 * collection-batch.test.js — 采集页批量动作渲染层契约
 *
 * 主线（PRD-ZHIHU-FAV-BATCH-2026-10-03 §3.4/§3.6 + C3a P0 回归）：
 *  ① P0 回归锁：zhihu-fav-batch 批量结果映射 **禁止再出现 `...x.data.data`** ——
 *     mock 必须复制 handler 真实返回形状 {index, ok, data:{...}}，断言字段非空（QM-5 ④）
 *  ② coverImage → cover_url 字段映射修复（摸底发现的封面丢失点）
 *  ③ 发布取稿规则：改写稿优先，无改写稿/改写失败回退原文并计数（Q26C）
 *  ④ 平台预筛：图文条目排除纯视频平台；视频条目仅视频平台（D8）
 *  ⑤ 目标展开：平台 × 账号笛卡尔（对齐 publish-contract.buildPublishTargets 语义）
 */
import { describe, it, expect } from 'vitest'
import {
  mapFavBatchResultsToItems,
  buildBatchArticles,
  buildBatchTargets,
  groupItemsByKind,
  usablePlatformIds,
} from '@/features/collection/collection-batch'

/** handler 真实返回形状（复制 ipc-handlers/zhihu-fav-batch 的 results[i] 结构） */
function realShapeResult (over = {}) {
  return {
    index: 0,
    ok: true,
    duplicate: false,
    data: {
      success: true,
      title: '真实标题',
      content: '真实正文内容'.repeat(4),
      description: '描述',
      coverImage: 'https://picx.zhimg.com/cover.jpg',
      source: 'zhihu',
      rewrittenContent: '改写后的正文'.repeat(3),
      rewriteFailed: false,
      images: [],
      imageFallbacks: [],
      kind: 'article',
      favTime: 1700000000,
    },
    ...over,
  }
}

const BASE_ITEM = {
  id: 'base-1', title: '基础条目', content: '基础正文', sourceUrl: 'https://e.com/a',
}

describe('P0 回归锁 · mapFavBatchResultsToItems', () => {
  it('真实形状 {index,ok,data:{...}} → title/content/sourceUrl 全部映射成功', () => {
    const items = mapFavBatchResultsToItems(
      [realShapeResult()],
      [{ url: 'https://zhuanlan.zhihu.com/p/1', kind: 'article', favTime: 1700000000 }],
    )
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('真实标题')
    expect(items[0].content).toContain('真实正文')
    expect(items[0].sourceUrl).toBe('https://zhuanlan.zhihu.com/p/1')
    expect(items[0].rewrittenContent).toContain('改写后的正文')
  })

  it('缺失字段是 P0 级缺陷：任何一条成功结果的 title/content/sourceUrl 不得为空', () => {
    const items = mapFavBatchResultsToItems(
      [realShapeResult(), realShapeResult({ index: 1, data: realShapeResult().data })],
      [
        { url: 'https://zhuanlan.zhihu.com/p/1', kind: 'article', favTime: 1 },
        { url: 'https://zhuanlan.zhihu.com/p/2', kind: 'answer', favTime: 2 },
      ],
    )
    for (const it of items) {
      expect(it.title, `title 不得为空（${it.sourceUrl}）`).toBeTruthy()
      expect(it.content, `content 不得为空（${it.sourceUrl}）`).toBeTruthy()
      expect(it.sourceUrl, 'sourceUrl 不得为空').toBeTruthy()
    }
  })

  it('failed 条目（ok=false）不入库', () => {
    const items = mapFavBatchResultsToItems(
      [realShapeResult({ ok: false, data: { success: false } })],
      [{ url: 'https://zhuanlan.zhihu.com/p/1', kind: 'article', favTime: 1 }],
    )
    expect(items).toHaveLength(0)
  })

  it('清单条目的 kind/favTime 透传到条目', () => {
    const items = mapFavBatchResultsToItems(
      [realShapeResult()],
      [{ url: 'https://www.zhihu.com/pin/1', kind: 'pin', favTime: 1700000123 }],
    )
    expect(items[0].kind).toBe('pin')
    expect(items[0].favTime).toBe(1700000123)
  })

  it('results 为空/非数组 → 空数组不抛错', () => {
    expect(mapFavBatchResultsToItems(null, [])).toEqual([])
    expect(mapFavBatchResultsToItems([], null)).toEqual([])
  })

  // ── 改写稿实际字数（feat-zhihu-fav-batch-wordcount，2026-10-21）──
  // 主进程回传 rewrittenWordCount；它必须一路映射到条目，否则渲染层看不到"改写后多长"。
  it('rewrittenWordCount 映射到条目（改写稿实际字数）', () => {
    const items = mapFavBatchResultsToItems(
      [realShapeResult({ data: { ...realShapeResult().data, rewrittenWordCount: 1234 } })],
      [{ url: 'https://zhuanlan.zhihu.com/p/1', kind: 'article', favTime: 1 }],
    )
    expect(items).toHaveLength(1)
    expect(items[0].rewrittenWordCount).toBe(1234)
  })

  it('主进程未回传字数 ⇒ rewrittenWordCount 为 undefined（不伪造 0）', () => {
    const items = mapFavBatchResultsToItems(
      [realShapeResult()],
      [{ url: 'https://zhuanlan.zhihu.com/p/1', kind: 'article', favTime: 1 }],
    )
    expect(items[0].rewrittenWordCount).toBeUndefined()
  })
})

describe('发布取稿规则 · buildBatchArticles', () => {
  it('改写稿优先：rewrittenContent 非空 → content 用改写稿', () => {
    const articles = buildBatchArticles([{
      ...BASE_ITEM, rewrittenContent: '改写稿内容', rewriteFailed: false,
    }])
    expect(articles[0].content).toBe('改写稿内容')
  })

  it('改写失败/无改写稿 → 回退原文', () => {
    const articles = buildBatchArticles([
      { ...BASE_ITEM, content: '原文', rewriteFailed: true },
      { ...BASE_ITEM, content: '原文2' },
    ])
    expect(articles[0].content).toBe('原文')
    expect(articles[1].content).toBe('原文2')
  })

  it('coverImage → cover_url 映射（封面丢失修复）', () => {
    const articles = buildBatchArticles([{
      ...BASE_ITEM, coverImage: 'https://picx.zhimg.com/c.jpg',
    }])
    expect(articles[0].cover_url).toBe('https://picx.zhimg.com/c.jpg')
  })

  it('images 本地路径透传（图片本地化产物）', () => {
    const articles = buildBatchArticles([{
      ...BASE_ITEM, images: ['D:\\img\\a.jpg'],
    }])
    expect(articles[0].images).toEqual(['D:\\img\\a.jpg'])
  })

  it('countOriginalFallback 统计将使用原文的条数（确认框展示）', () => {
    const r = buildBatchArticles([
      { ...BASE_ITEM, rewrittenContent: '改写稿' },
      { ...BASE_ITEM, content: '原文B', rewriteFailed: true },
      { ...BASE_ITEM, content: '原文C' },
    ])
    expect(r).toHaveLength(3)
    expect(buildBatchArticles.originalFallbackCount).toBeUndefined() // 不污染数组
  })

  it('独立统计函数 countOriginalFallback', async () => {
    const { countOriginalFallback } = await import('@/features/collection/collection-batch')
    const n = countOriginalFallback([
      { ...BASE_ITEM, rewrittenContent: '改写稿' },
      { ...BASE_ITEM, content: '原文B', rewriteFailed: true },
      { ...BASE_ITEM, content: '原文C' },
    ])
    expect(n).toBe(2)
  })
})

describe('平台预筛 · groupItemsByKind / usablePlatformIds / buildBatchTargets', () => {
  // 夹具对齐 config/platforms.yaml 真实分类（QM-6 m1/m10：禁止夹具与生产漂移）
  const PLATFORMS = [
    { id: 'douyin', contentCategory: 'VIDEO' },
    { id: 'kuaishou', contentCategory: 'VIDEO' },
    { id: 'bilibili', contentCategory: 'VIDEO' },
    { id: 'xiaohongshu', contentCategory: 'IMAGE_TEXT' },
    { id: 'zhihu', contentCategory: 'IMAGE_TEXT' },
    { id: 'baijiahao', contentCategory: 'MIXED' },
  ]

  it('groupItemsByKind：视频型与图文型分组', () => {
    const r = groupItemsByKind([
      { ...BASE_ITEM, kind: 'video' },
      { ...BASE_ITEM, id: 'b2', kind: 'article' },
      { ...BASE_ITEM, id: 'b3', kind: 'answer' },
    ])
    expect(r.videoOnly).toHaveLength(1)
    expect(r.imageText).toHaveLength(2)
  })

  it('无 kind 字段的历史条目默认归图文型', () => {
    const r = groupItemsByKind([{ ...BASE_ITEM }])
    expect(r.imageText).toHaveLength(1)
    expect(r.videoOnly).toHaveLength(0)
  })

  it('图文条目可用平台：排除纯 VIDEO 平台', () => {
    expect(usablePlatformIds('imageText', PLATFORMS)).toEqual(['xiaohongshu', 'zhihu', 'baijiahao'])
  })

  it('视频条目可用平台：仅 VIDEO + MIXED', () => {
    expect(usablePlatformIds('video', PLATFORMS)).toEqual(['douyin', 'kuaishou', 'bilibili', 'baijiahao'])
  })

  it('buildBatchTargets：平台 × 账号笛卡尔展开', () => {
    const targets = buildBatchTargets(
      ['xiaohongshu', 'zhihu'],
      [
        { platform: 'xiaohongshu', accountId: 'acc-1' },
        { platform: 'xiaohongshu', accountId: 'acc-2' },
        { platform: 'zhihu', accountId: 'acc-3' },
      ],
    )
    expect(targets).toEqual([
      { platform: 'xiaohongshu', accountId: 'acc-1' },
      { platform: 'xiaohongshu', accountId: 'acc-2' },
      { platform: 'zhihu', accountId: 'acc-3' },
    ])
  })

  it('buildBatchTargets：无账号平台保留 {platform, accountId:null}（兼容旧流程）', () => {
    const targets = buildBatchTargets(['xiaohongshu'], [])
    expect(targets).toEqual([{ platform: 'xiaohongshu', accountId: null }])
  })
})
