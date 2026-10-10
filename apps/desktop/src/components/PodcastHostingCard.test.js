/**
 * PodcastHostingCard 视图行为（刀 2 渲染层收口）
 *
 * 锁四件在编译期不可见的事：
 * - **locales 拆分后的接线**：卡片文案取自 `@/i18n` → `locales/zh.js` → `locales/podcast/zh.js`。
 *   拆文件时只要少写一行 spread，页面就显示键名而不是文案；本用例用**真实 locale 值**断言，
 *   因此对「键存在但取不到」这类断链必然变红（不用 `toContain` 子串，按 AGENTS.md 文本结构断言口径）。
 * - **按钮可用性即交互契约**：未配置托管时「连通性测试/清除凭证」必须禁用，无频道时「发布 Feed」必须禁用。
 * - **回滚点缺失不得被成功掩盖**：`state:'success'` 且 `backupCreated:false` 必须额外出声。
 * - **emit 必须有父级绑定**（R92）：`published` 在父模板里没有 `@published` 就是运行时静默失效，
 *   类型检查与构建都抓不到，所以这里直接对父组件源码做接线断言。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import i18n from '@/i18n'
import zh from '@/locales/zh'
import PodcastHostingCard from '@/components/PodcastHostingCard.vue'

// 组件在顶层 import，mock 工厂会在模块图初始化时执行——那时顶层 `let api` 还在 TDZ 里。
// vi.hoisted 把这份夹具提到所有 import 之前，症状是「Cannot access 'api' before initialization」。
const api = vi.hoisted(() => ({
  hostingGet: vi.fn(),
  hostingSave: vi.fn(),
  hostingCheck: vi.fn(),
  feedPublish: vi.fn(),
}))

vi.mock('@/api/podcast-channel', async (importOriginal) => {
  const actual = await importOriginal()
  return Object.assign({}, actual, api)
})

const ok = (data) => ({ available: true, result: { ok: true, ...data } })

const NOT_CONFIGURED = { configured: false, provider: 'oss', endpoint: '', bucket: '', pathPrefix: '', maskedAccessKeyId: '' }
const CONFIGURED = { configured: true, provider: 'oss', endpoint: 'oss-cn-hangzhou.aliyuncs.com', bucket: 'pod', pathPrefix: 'feeds', maskedAccessKeyId: '***ghij' }

const here = path.dirname(fileURLToPath(import.meta.url))

afterEach(() => { vi.clearAllMocks() })

async function mountCard (props = { channelId: 'ch_test0001' }) {
  const w = mount(PodcastHostingCard, { props, global: { plugins: [i18n] } })
  await nextTick()
  await vi.waitFor(() => expect(w.find('[data-testid="podcast-hosting-card"]').exists()).toBe(true))
  return w
}

describe('PodcastHostingCard 文案接线（locales/podcast 拆分后必须仍取得真实值）', () => {
  it('标题与提示取自 podcast.hosting 命名空间，不是键名', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: NOT_CONFIGURED }))
    const w = await mountCard()
    expect(w.find('h2').text()).toBe(zh.podcast.hosting.sectionTitle)
    expect(w.find('.podcast-hosting-hint').text()).toBe(zh.podcast.hosting.sectionHint)
    expect(w.text()).not.toContain('podcast.hosting.sectionTitle')
  })

  it('未配置态如实显示「未配置」，已配置态显示掩码而非明文', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: NOT_CONFIGURED }))
    const w = await mountCard()
    expect(w.find('[data-testid="podcast-hosting-configured"]').attributes('data-state')).toBe('not-configured')
    expect(w.find('[data-testid="podcast-hosting-configured"]').text()).toBe(zh.podcast.hosting.notConfigured)

    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    const w2 = await mountCard()
    expect(w2.find('[data-testid="podcast-hosting-configured"]').attributes('data-state')).toBe('configured')
    expect(w2.find('[data-testid="podcast-hosting-configured"]').text()).toContain('***ghij')
  })
})

describe('PodcastHostingCard 按钮可用性契约', () => {
  it('未配置托管时「连通性测试」与「清除凭证」禁用；配置齐备后解禁', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: NOT_CONFIGURED }))
    const w = await mountCard()
    expect(w.find('[data-testid="podcast-hosting-check"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="podcast-hosting-clear"]').attributes('disabled')).toBeDefined()

    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    const w2 = await mountCard()
    expect(w2.find('[data-testid="podcast-hosting-check"]').attributes('disabled')).toBeUndefined()
    expect(w2.find('[data-testid="podcast-hosting-clear"]').attributes('disabled')).toBeUndefined()
  })

  it('没有活动频道时「发布 Feed」禁用（发布是频道动作，全局凭证不足以确定目标）', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    const w = await mountCard({ channelId: '' })
    expect(w.find('[data-testid="podcast-hosting-publish"]').attributes('disabled')).toBeDefined()
  })

  it('本期未接入的托管类型不可选（能选就会得到一个必然失败的表单）', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: NOT_CONFIGURED }))
    const w = await mountCard()
    const cos = w.find('[data-testid="podcast-hosting-provider"]').findAll('option').find((o) => o.attributes('value') === 'cos')
    expect(cos.attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="podcast-hosting-provider"]').findAll('option')[0].attributes('value')).toBe('oss')
  })

  it('清除凭证在 payload 里带 clearSecret（IPC 只传一个对象，标志位不得做成第二个参数）', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    api.hostingSave.mockResolvedValue(ok({ hosting: NOT_CONFIGURED }))
    const w = await mountCard()
    await w.find('[data-testid="podcast-hosting-clear"]').trigger('click')
    await vi.waitFor(() => expect(api.hostingSave).toHaveBeenCalledTimes(1))
    const sent = api.hostingSave.mock.calls[0][0]
    expect(api.hostingSave.mock.calls[0]).toHaveLength(1)
    expect(sent.clearSecret).toBe(true)
    // 清除动作不得顺手把空串当新值提交（空串会被落盘层判成覆写）
    expect('accessKeyId' in sent).toBe(false)
    expect('accessKeySecret' in sent).toBe(false)
  })
})

describe('PodcastHostingCard 发布结果三态', () => {
  it('成功且回滚点已建：只显示成功，不显示缺失告警', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    api.feedPublish.mockResolvedValue(ok({ state: 'success', itemCount: 3, backupCreated: true, url: 'https://pod/feeds/ch_test0001/feed.xml' }))
    const w = await mountCard()
    await w.find('[data-testid="podcast-hosting-publish"]').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-testid="podcast-hosting-publish-result"]').exists()).toBe(true))
    expect(w.find('[data-testid="podcast-hosting-publish-result"]').attributes('data-state')).toBe('success')
    expect(w.find('[data-testid="podcast-hosting-no-backup"]').exists()).toBe(false)
  })

  it('成功但没有回滚点：必须额外出声，不得把「无法回退」藏进成功文案', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    api.feedPublish.mockResolvedValue(ok({ state: 'success', itemCount: 3, backupCreated: false, prevExists: true }))
    const w = await mountCard()
    await w.find('[data-testid="podcast-hosting-publish"]').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-testid="podcast-hosting-no-backup"]').exists()).toBe(true))
    expect(w.find('[data-testid="podcast-hosting-no-backup"]').text()).toBe(zh.podcast.hosting.backupMissing)
  })

  it('首次发布要说"还没有上一版"，不得谎称"回滚点没建上"（两件事的处置方向不同）', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    api.feedPublish.mockResolvedValue(ok({ state: 'success', itemCount: 1, backupCreated: false, prevExists: false }))
    const w = await mountCard()
    await w.find('[data-testid="podcast-hosting-publish"]').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-testid="podcast-hosting-no-previous"]').exists()).toBe(true))
    expect(w.find('[data-testid="podcast-hosting-no-backup"]').exists()).toBe(false)
    expect(w.find('[data-testid="podcast-hosting-no-previous"]').text()).toBe(zh.podcast.hosting.noPrevious)
  })

  it('发布结果原样透传给父组件（父模板确有 @published 绑定）', async () => {
    const viewSrc = fs.readFileSync(path.join(here, '..', 'views', 'PodcastChannelView.vue'), 'utf8')
    expect(viewSrc).toMatch(/@published=/)

    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    api.feedPublish.mockResolvedValue(ok({ state: 'success', itemCount: 1, backupCreated: true }))
    const w = await mountCard()
    await w.find('[data-testid="podcast-hosting-publish"]').trigger('click')
    await vi.waitFor(() => expect(w.emitted('published')).toBeTruthy())
    expect(w.emitted('published')[0][0].state).toBe('success')
  })

  it('PUT 失败保留 failed 形状（不得压成布尔，也不得谎报公网已更新）', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    api.feedPublish.mockResolvedValue(ok({ state: 'failed', code: 'PODCAST_HOSTING_UPLOAD_FAILED', status: 403, backupCreated: true, itemCount: 2 }))
    const w = await mountCard()
    await w.find('[data-testid="podcast-hosting-publish"]').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-testid="podcast-hosting-publish-result"]').exists()).toBe(true))
    expect(w.find('[data-testid="podcast-hosting-publish-result"]').attributes('data-state')).toBe('failed')
    expect(w.find('[data-testid="podcast-hosting-publish-result"]').text()).toBe(zh.podcast.hosting.publishFailed.replace('{status}', '403'))
    expect(w.find('[data-testid="podcast-hosting-no-backup"]').exists()).toBe(false)
  })
})

describe('PodcastHostingCard 失败可见性', () => {
  it('保存被校验拒绝时错误文案与逐条 issue 同时出现', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: NOT_CONFIGURED }))
    api.hostingSave.mockResolvedValue({
      available: true,
      result: { ok: false, code: 'PODCAST_HOSTING_INVALID', issues: [{ code: 'HOSTING_ENDPOINT_INVALID' }] },
    })
    const w = await mountCard()
    await w.find('[data-testid="podcast-hosting-endpoint"]').setValue('oss-cn-hangzhou.aliyuncs.com')
    await w.find('[data-testid="podcast-hosting-bucket"]').setValue('pod')
    await w.find('[data-testid="podcast-hosting-save"]').trigger('click')
    await vi.waitFor(() => expect(w.find('[data-testid="podcast-hosting-error"]').exists()).toBe(true))
    expect(w.find('[data-testid="podcast-hosting-error"]').text()).toBe(zh.podcast.errors.PODCAST_HOSTING_INVALID)
    await vi.waitFor(() => expect(w.find('[data-testid="podcast-hosting-issues"]').exists()).toBe(true))
  })

  it('新增错误码必须有成对文案（不得长期落到 fallback）', () => {
    for (const code of [
      'PODCAST_HOSTING_REQUIRED',
      'PODCAST_HOSTING_INVALID',
      'PODCAST_HOSTING_PREFIX_UNSAFE',
      'PODCAST_HOSTING_SECRET_MISSING',
      'PODCAST_HOSTING_CRYPTO_UNAVAILABLE',
      'PODCAST_HOSTING_IDENTITY_REQUIRED',
      'PODCAST_FEED_NOT_BUILT',
      'PODCAST_HOSTING_UPLOAD_FAILED',
      'PODCAST_HOSTING_BODY_READ_FAILED',
    ]) {
      expect(zh.podcast.errors[code], code).toBeTruthy()
      expect(typeof zh.podcast.errors[code], code).toBe('string')
    }
  })
})


describe('PodcastHostingCard 公网 feed 未同步横幅（feedSync 读侧接线）', () => {
  const FAILED = { status: 'failed', attemptedAt: '2026-10-11T00:00:00.000Z', error: { status: 403 } }
  const PARTIAL = { status: 'partial', attemptedAt: '2026-10-11T00:00:00.000Z' }
  const OK = { status: 'success', attemptedAt: '2026-10-11T01:00:00.000Z' }

  it('failed：显示横幅并带 HTTP 状态码，文案取真实 locale 值而不是键名', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    const w = await mountCard({ channelId: 'ch_test0001', feedSync: FAILED })
    const banner = w.find('[data-testid="podcast-hosting-feed-stale"]')
    expect(banner.exists()).toBe(true)
    expect(banner.attributes('data-state')).toBe('failed')
    expect(banner.find('[data-testid="podcast-hosting-feed-stale-text"]').text()).toBe(zh.podcast.hosting.feedNotSynced.replace('{status}', '403'))
    expect(banner.find('[data-testid="podcast-hosting-feed-retry"]').text()).toBe(zh.podcast.hosting.retryFeed)
  })

  it('partial：说「部分同步」而不是状态码（两种成因的处置动作不同）', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    const w = await mountCard({ channelId: 'ch_test0001', feedSync: PARTIAL })
    expect(w.find('[data-testid="podcast-hosting-feed-stale"]').attributes('data-state')).toBe('partial')
    expect(w.find('[data-testid="podcast-hosting-feed-stale"]').text()).toContain(zh.podcast.hosting.feedPartial)
  })

  it('success / 缺席 / 结构破坏一律不显示横幅（没坏就不要喊）', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    for (const feedSync of [OK, null, undefined, 'failed', { status: 'unknown' }]) {
      const w = await mountCard({ channelId: 'ch_test0001', feedSync })
      expect(w.find('[data-testid="podcast-hosting-feed-stale"]').exists(), JSON.stringify(feedSync)).toBe(false)
    }
  })

  it('重试走的就是那一份发布实现；无频道或进行中不得再发第二次', async () => {
    api.hostingGet.mockResolvedValue(ok({ hosting: CONFIGURED }))
    let resolvePublish
    api.feedPublish.mockImplementation(() => new Promise((r) => { resolvePublish = r }))
    const idle = await mountCard({ channelId: '', feedSync: FAILED })
    expect(idle.find('[data-testid="podcast-hosting-feed-retry"]').attributes('disabled')).toBeDefined()

    const w = await mountCard({ channelId: 'ch_test0001', feedSync: FAILED })
    await w.find('[data-testid="podcast-hosting-feed-retry"]').trigger('click')
    await nextTick()
    expect(api.feedPublish).toHaveBeenCalledTimes(1)
    expect(api.feedPublish).toHaveBeenCalledWith({ channelId: 'ch_test0001' })
    // 进行中：按钮必须禁用，否则一次点击会变成两次覆盖写
    expect(w.find('[data-testid="podcast-hosting-feed-retry"]').attributes('disabled')).toBeDefined()
    resolvePublish({ available: true, result: { ok: true, state: 'success', itemCount: 2, prevExists: true, backupCreated: true } })
    await vi.waitFor(() => expect(w.find('[data-testid="podcast-hosting-publish-result"]').attributes('data-state')).toBe('success'))
  })
})

describe('PodcastChannelView 对 feedSync 的接线（R92 同族：数据到了但没人渲染）', () => {
  const viewSrc = fs.readFileSync(path.join(here, '../views/PodcastChannelView.vue'), 'utf8')

  it('真源必须传给卡片，且发布成功/失败两条出口都要重读 channel', () => {
    expect(viewSrc).toContain(':feed-sync="feedSync"')
    expect(viewSrc).toContain('loadChannel()')
    // 失败出口也必须重读：writeFeedSync 已把 failed 落进真源，不重读就是「界面停在旧状态」
    expect(viewSrc.split('loadChannel()').length - 1).toBeGreaterThanOrEqual(3)
  })
})
