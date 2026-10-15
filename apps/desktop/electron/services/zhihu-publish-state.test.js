/**
 * zhihu-publish-state.test.js — 知乎发布终态判据（纯函数穷举）
 *
 * 回归动因（2026-10-15 用户报障「知乎显示发布成功但没有真实发布」）：
 * 旧判据 `/\/p\/\d+/` 把**草稿编辑页** `zhuanlan.zhihu.com/p/<id>/edit` 判成发布成功，
 * 而真机上点一次「发布」只会落到该编辑页 ⇒ 界面报成功、平台上只有草稿。
 * 本文件是这条判据的穷举锁：`/edit` 与任何带尾段的 `/p/<id>/…` 必须为 false。
 */
const {
  isZhihuPublishedUrl,
  isZhihuDraftEditorUrl,
  extractZhihuPostId,
  parseZhihuUrl,
  waitZhihuUrlSettle,
  confirmZhihuPublished,
  ZHIHU_CONFIRM_TIMINGS,
} = require('./zhihu-publish-state')

describe('isZhihuPublishedUrl — 只有公开文章页算发布成功', () => {
  it.each([
    'https://zhuanlan.zhihu.com/p/2094165753981309631',
    'https://zhuanlan.zhihu.com/p/2094165753981309631/',
    'https://zhuanlan.zhihu.com/p/2094165753981309631?utm_psn=1',
    'https://zhuanlan.zhihu.com/p/2094165753981309631#comments',
    'http://zhuanlan.zhihu.com/p/1',
    'https://www.zhihu.com/p/1',
  ])('公开文章页判成功：%s', (url) => {
    expect(isZhihuPublishedUrl(url)).toBe(true)
  })

  it.each([
    // ★ 本次事故的假成功形态：草稿编辑页 /edit
    'https://zhuanlan.zhihu.com/p/2094165753981309631/edit',
    'https://zhuanlan.zhihu.com/p/2094165753981309631/edit/',
    'https://zhuanlan.zhihu.com/p/2094165753981309631/edit?from=write',
    // 写作页（标题/正文填充期）
    'https://zhuanlan.zhihu.com/write',
    'https://www.zhihu.com/creator/write',
    // 其它带尾段的文章路径：一律不认（宽判据的教训）
    'https://zhuanlan.zhihu.com/p/2094165753981309631/draft',
    'https://zhuanlan.zhihu.com/p/2094165753981309631/manage',
    // 非知乎域名 / 非文章路径
    'https://evil.example.com/p/123456789',
    'https://zhuanlan.zhihu.com.evil.example.com/p/123',
    'https://zhuanlan.zhihu.com/people/someone',
    'https://zhuanlan.zhihu.com/',
    'about:blank',
    '',
    null,
    undefined,
    123,
  ])('非公开文章页判失败：%s', (url) => {
    expect(isZhihuPublishedUrl(url)).toBe(false)
  })
})

describe('isZhihuDraftEditorUrl — 草稿编辑页识别（命中即「只落了草稿」）', () => {
  it('命中 /p/<id>/edit', () => {
    expect(isZhihuDraftEditorUrl('https://zhuanlan.zhihu.com/p/2094165753981309631/edit')).toBe(true)
    expect(isZhihuDraftEditorUrl('https://www.zhihu.com/p/42/edit')).toBe(true)
  })

  it('公开文章页不算草稿编辑页（两判据互斥，不会同时为真）', () => {
    const url = 'https://zhuanlan.zhihu.com/p/2094165753981309631'
    expect(isZhihuDraftEditorUrl(url)).toBe(false)
    expect(isZhihuPublishedUrl(url)).toBe(true)
    expect(isZhihuDraftEditorUrl(url) && isZhihuPublishedUrl(url)).toBe(false)
  })

  it('写作页 / 他人主页不是草稿编辑页', () => {
    expect(isZhihuDraftEditorUrl('https://zhuanlan.zhihu.com/write')).toBe(false)
    expect(isZhihuDraftEditorUrl('https://zhuanlan.zhihu.com/people/x')).toBe(false)
    expect(isZhihuDraftEditorUrl(null)).toBe(false)
  })
})

describe('extractZhihuPostId — 两种页面都能取到 ID（记录/回查用）', () => {
  it('公开文章页', () => {
    expect(extractZhihuPostId('https://zhuanlan.zhihu.com/p/2094165753981309631')).toBe('2094165753981309631')
  })

  it('草稿编辑页', () => {
    expect(extractZhihuPostId('https://zhuanlan.zhihu.com/p/2094165753981309631/edit')).toBe('2094165753981309631')
  })

  it('非知乎文章 URL 返回空串（不臆造 ID）', () => {
    expect(extractZhihuPostId('https://zhuanlan.zhihu.com/write')).toBe('')
    expect(extractZhihuPostId('https://example.com/p/1')).toBe('')
    expect(extractZhihuPostId('')).toBe('')
    expect(extractZhihuPostId(undefined)).toBe('')
  })
})

describe('parseZhihuUrl — 非法输入不抛，协议白名单', () => {
  it('只接受 http/https', () => {
    expect(parseZhihuUrl('javascript:alert(1)')).toBe(null)
    expect(parseZhihuUrl('file:///D:/x.html')).toBe(null)
    expect(parseZhihuUrl('not a url')).toBe(null)
    expect(parseZhihuUrl('https://zhuanlan.zhihu.com/p/1')).toBeInstanceOf(URL)
  })
})

// ---------------------------------------------------------------------------
// 两段式确认状态机（注入式，可完全脱机驱动）
// ---------------------------------------------------------------------------

const PUBLISH_BUTTON = "button:has-text('发布'), .PublishPanel-publish"
const DRAFT_URL = 'https://zhuanlan.zhihu.com/p/2094165753981309631/edit'
const PUBLIC_URL = 'https://zhuanlan.zhihu.com/p/2094165753981309631'
const WRITE_URL = 'https://zhuanlan.zhihu.com/write'

/** 按调用次数依次返回脚本里的 URL；用尽后固定返回最后一个 */
function scriptedReadUrl (urls) {
  let i = 0
  return () => {
    const list = urls.length ? urls : ['']
    const url = list[Math.min(i, list.length - 1)]
    i += 1
    return url
  }
}

function makeDeps (overrides = {}) {
  return Object.assign({
    readUrl: scriptedReadUrl([PUBLIC_URL]),
    waitForElement: vi.fn().mockResolvedValue(true),
    click: vi.fn().mockResolvedValue(true),
    sleep: vi.fn().mockResolvedValue(undefined),
    publishButton: PUBLISH_BUTTON,
    log: { warn: vi.fn() },
  }, overrides)
}

describe('waitZhihuUrlSettle — 轮询到公开文章页即提前返回（不空等满时限）', () => {
  it('第二次轮询就是公开文章页 → 只睡一次', async () => {
    const deps = makeDeps({ readUrl: scriptedReadUrl([WRITE_URL, PUBLIC_URL]) })
    const url = await waitZhihuUrlSettle(deps, 6000, 500)
    expect(url).toBe(PUBLIC_URL)
    expect(deps.sleep).toHaveBeenCalledTimes(1)
  })

  it('全程不是公开文章页 → 按时限轮询后返回最后一次 URL', async () => {
    const deps = makeDeps({ readUrl: () => DRAFT_URL })
    const url = await waitZhihuUrlSettle(deps, 1000, 500)
    expect(url).toBe(DRAFT_URL)
    expect(deps.sleep.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('readUrl 抛错不冒泡（判据 fail-closed，不炸发布流程）', async () => {
    const deps = makeDeps({ readUrl: () => { throw new Error('webContents destroyed') } })
    await expect(waitZhihuUrlSettle(deps, 500, 500)).resolves.toBe('')
  })
})

describe('confirmZhihuPublished — 只有公开文章页才算发布成功（本次报障的回归锁）', () => {
  it('① 首个观察点就是公开文章页 → published=true，不补点', async () => {
    const deps = makeDeps({ readUrl: () => PUBLIC_URL })
    const r = await confirmZhihuPublished(deps)
    expect(r.published).toBe(true)
    expect(r.reason).toBe('published')
    expect(r.postId).toBe('2094165753981309631')
    expect(deps.click).not.toHaveBeenCalled()
  })

  it('② 落在草稿编辑页 → 补点一次「发布」→ 跳到公开文章页 → published=true', async () => {
    // 模型：补点前页面停在草稿编辑页；补点（第二次「发布」）后平台跳到公开文章页。
    let clickedAgain = false
    const deps = makeDeps({
      readUrl: () => (clickedAgain ? PUBLIC_URL : DRAFT_URL),
      click: vi.fn().mockImplementation(async () => { clickedAgain = true; return true }),
    })
    const r = await confirmZhihuPublished(deps)
    expect(r.published).toBe(true)
    expect(r.reason).toBe('published-after-second-click')
    expect(r.extraClicks).toBe(1)
    expect(deps.click).toHaveBeenCalledTimes(1)
    expect(deps.click).toHaveBeenCalledWith(PUBLISH_BUTTON)
    expect(deps.waitForElement).toHaveBeenCalledWith(PUBLISH_BUTTON, ZHIHU_CONFIRM_TIMINGS.waitButtonMs)
  })

  it('③ ★ 停在草稿编辑页、补点后仍未发布 → published=false（绝不再报假成功）', async () => {
    const deps = makeDeps({ readUrl: () => DRAFT_URL })
    const r = await confirmZhihuPublished(deps)
    expect(r.published).toBe(false)
    expect(r.reason).toBe('draft-editor-still-not-published')
    expect(r.url).toBe(DRAFT_URL)
    // 如实带出草稿 ID（供上层记录「草稿已建、未发布」，而不是丢成空）
    expect(r.postId).toBe('2094165753981309631')
    expect(deps.log.warn).toHaveBeenCalled()
  })

  it('④ 停在写作页（无草稿编辑页证据）→ 不补点、published=false（避免重复点击造出两份草稿）', async () => {
    const deps = makeDeps({ readUrl: () => WRITE_URL })
    const r = await confirmZhihuPublished(deps)
    expect(r.published).toBe(false)
    expect(r.reason).toBe('unexpected-page')
    expect(r.extraClicks).toBe(0)
    expect(deps.click).not.toHaveBeenCalled()
  })

  it('⑤ 草稿编辑页但「发布」按钮找不到 → 不点空、published=false', async () => {
    const deps = makeDeps({
      readUrl: () => DRAFT_URL,
      waitForElement: vi.fn().mockResolvedValue(false),
    })
    const r = await confirmZhihuPublished(deps)
    expect(r.published).toBe(false)
    expect(r.reason).toBe('draft-editor-publish-button-missing')
    expect(deps.click).not.toHaveBeenCalled()
  })

  it('⑥ 补点时点击抛错 → 冒泡给上层统一 try/catch（不静默吞）', async () => {
    const deps = makeDeps({
      readUrl: () => DRAFT_URL,
      click: vi.fn().mockRejectedValue(new Error('click intercepted')),
    })
    await expect(confirmZhihuPublished(deps)).rejects.toThrow('click intercepted')
  })

  it('⑦ 时限可注入（测试零真实等待：所有时限传 0 仍走完判定）', async () => {
    const deps = makeDeps({
      readUrl: () => DRAFT_URL,
      settleMs: 0,
      waitButtonMs: 0,
      secondSettleMs: 0,
      pollMs: 100,
    })
    const r = await confirmZhihuPublished(deps)
    expect(r.published).toBe(false)
    expect(deps.sleep.mock.calls.every(([ms]) => ms <= 100)).toBe(true)
  })
})
