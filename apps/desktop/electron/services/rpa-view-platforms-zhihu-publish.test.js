/**
 * rpa-view-platforms-zhihu-publish.test.js — 知乎发布终态的行为级回归（2026-10-15 假发布修复）
 *
 * 与 `rpa-view-platforms.test.js` 的知乎 describe 分工：
 *   · 那边保留「导航/标题/正文注入」等 2026-09-29 修复的既有断言 + 一条
 *     「草稿编辑页不得判成功」的替换断言（原断言把缺陷锁成了契约，见 BUGFIX 文档）；
 *   · 本文件专测**发布终态**：公开文章页判成功、草稿编辑页补点一次后成功、
 *     写作页不补点如实失败、以及「成功分支不得绕过 confirmZhihuPublished」的结构锁。
 * 拆文件的第二个理由：`rpa-view-platforms.test.js` 已 1472 行，新增断言会撞
 * `.github/scripts/check-max-lines.js` 的测试文件 1500 行上限（新超限文件直接红）。
 */
const fs = require('fs')
const platformsMixin = require('./rpa-view-platforms')

const ZHIHU_REAL_PUBLIC_URL = 'https://zhuanlan.zhihu.com/p/2094165753981309631'
const ZHIHU_REAL_DRAFT_URL = 'https://zhuanlan.zhihu.com/p/2094165753981309631/edit'
const ZHIHU_WRITE_URL = 'https://zhuanlan.zhihu.com/write'

function readPlatformsSource () {
  return fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')
}

function createZhihuContext () {
  return {
    _emitProgress: vi.fn(),
    _navigateAndWait: vi.fn().mockResolvedValue(undefined),
    _waitForElement: vi.fn().mockResolvedValue(true),
    _click: vi.fn().mockResolvedValue(true),
    _sleep: vi.fn().mockResolvedValue(undefined),
    _setElementContentSafe: vi.fn().mockResolvedValue(undefined),
    _insertTextTrusted: vi.fn().mockResolvedValue(true),
  }
}

function createZhihuWindow (url, executeJavaScriptImpl) {
  const executeJavaScript = executeJavaScriptImpl || vi.fn().mockResolvedValue(true)
  return {
    win: {
      webContents: {
        getURL: vi.fn().mockReturnValue(url),
        getTitle: vi.fn().mockReturnValue(''),
        executeJavaScript,
      },
    },
    executeJavaScript,
  }
}

describe('知乎发布终态 — 公开文章页判成功', () => {
  it('URL 已是 zhuanlan.zhihu.com/p/<id> → success=true 且带出 postId', async () => {
    const { win } = createZhihuWindow(ZHIHU_REAL_PUBLIC_URL)
    const context = createZhihuContext()

    const result = await platformsMixin._publish_zhihu.call(context, win, { title: 'T', content: 'C' })

    expect(result.success).toBe(true)
    expect(result.url).toBe(ZHIHU_REAL_PUBLIC_URL)
    expect(result.postId).toBe('2094165753981309631')
    // 已是公开页 ⇒ 无需补点
    const publishClicks = context._click.mock.calls.filter(([, sel]) => String(sel).includes('发布'))
    expect(publishClicks.length).toBe(1)
  })
})

describe('知乎发布终态 — 两段式补点（首点落草稿、次点才真发布）', () => {
  it('首点后停在草稿编辑页 → 补点「发布」→ 跳公开文章页 → success=true', async () => {
    const { win } = createZhihuWindow(ZHIHU_WRITE_URL)
    // 平台模型：第 1 次点「发布」→ 落草稿并跳 /edit；第 2 次点（草稿编辑页）→ 真发布并跳公开文章页
    let publishClicks = 0
    win.webContents.getURL = vi.fn(() => (
      publishClicks >= 2 ? ZHIHU_REAL_PUBLIC_URL
        : publishClicks === 1 ? ZHIHU_REAL_DRAFT_URL
          : ZHIHU_WRITE_URL))
    const context = createZhihuContext()
    context._click.mockImplementation(async () => { publishClicks += 1; return true })

    const result = await platformsMixin._publish_zhihu.call(context, win, { title: 'T', content: 'C' })

    expect(result.success).toBe(true)
    expect(result.postId).toBe('2094165753981309631')
    const pubClicks = context._click.mock.calls.filter(([, sel]) => String(sel).includes('发布'))
    expect(pubClicks.length).toBe(2)
    // 补点前必须重新等「发布」元素就绪（草稿编辑页是另一次页面加载）
    expect(context._waitForElement.mock.calls.filter(([, sel]) => String(sel).includes('发布')).length)
      .toBeGreaterThanOrEqual(2)
  })

  it('补点后仍未离开草稿编辑页 → success=false（绝不把草稿当发布成功）', async () => {
    const { win } = createZhihuWindow(ZHIHU_REAL_DRAFT_URL)
    const context = createZhihuContext()

    const result = await platformsMixin._publish_zhihu.call(context, win, { title: 'T', content: 'C' })

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('draft-editor-still-not-published')
    expect(result.url).toBe(ZHIHU_REAL_DRAFT_URL)
  })
})

describe('知乎发布终态 — 不作假成功、不重复点击', () => {
  it('停在写作页（无草稿页证据）→ 只点一次、如实报 unexpected-page', async () => {
    const { win } = createZhihuWindow(ZHIHU_WRITE_URL)
    const context = createZhihuContext()

    const result = await platformsMixin._publish_zhihu.call(context, win, { title: 'T', content: 'C' })

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('unexpected-page')
    const publishClicks = context._click.mock.calls.filter(([, sel]) => String(sel).includes('发布'))
    expect(publishClicks.length).toBe(1)
  })

  it('结构锁：发布终态只能经 confirmZhihuPublished，不得自造 URL 子串/宽正则判据', () => {
    const source = readPlatformsSource()
    expect(source).toContain('zhihuPublishState.confirmZhihuPublished')
    // 旧缺陷形态（2026-09-29 引入、2026-10-15 报障）：URL 子串命中即判成功
    expect(source).not.toMatch(/curUrl\.includes\('publish'\)/)
    expect(source).not.toMatch(/curUrl\.includes\('success'\)/)
    expect(source).not.toMatch(/curUrl\.includes\('article'\)/)
    // panelGone 兜底曾是第二个假成功出口，已删除
    expect(source).not.toContain('panelGone')
  })
})
