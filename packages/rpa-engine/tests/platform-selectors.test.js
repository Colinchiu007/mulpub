/**
 * platform-selectors.test.js
 * 验证: 所有 15 个平台的选择器完整、结构正确、无遗漏
 */
const {
  PLATFORM_LOGIN_URLS,
  PLATFORM_LOGIN_SUCCESS_SELECTORS,
  PLATFORM_PUBLISH_SELECTORS,
  PLATFORM_NAMES,
} = require('../src/platform-selectors')

const EXPECTED = [
  'wechat_mp', 'zhihu', 'weibo', 'douyin', 'xiaohongshu',
  'tencent_video', 'kuaishou', 'toutiao', 'youtube', 'tiktok',
  'bilibili', 'baijiahao', 'twitter', 'instagram', 'facebook',
]

// 各平台发布选择器应有"标题类字段"
// 有些平台用 title_input，有些用 content_textarea / textarea / caption_textarea
const TITLE_OR_CONTENT_FIELDS = [
  ['title_input'],                    // 标准标题
  ['content_textarea'],               // weibo
  ['textarea'],                       // twitter, 小红书文案
  ['caption_textarea'],               // tiktok, instagram
]

describe('PLATFORM_LOGIN_URLS', () => {
  test.each(EXPECTED)('%s 有登录 URL', (platform) => {
    expect(PLATFORM_LOGIN_URLS[platform]).toBeDefined()
    expect(PLATFORM_LOGIN_URLS[platform]).toContain('https://')
  })

  test('无多余平台', () => {
    const keys = Object.keys(PLATFORM_LOGIN_URLS)
    for (const key of keys) {
      expect(EXPECTED).toContain(key)
    }
  })
})

describe('PLATFORM_LOGIN_SUCCESS_SELECTORS', () => {
  test.each(EXPECTED)('%s 有登录成功选择器', (platform) => {
    expect(PLATFORM_LOGIN_SUCCESS_SELECTORS[platform]).toBeDefined()
    expect(Array.isArray(PLATFORM_LOGIN_SUCCESS_SELECTORS[platform])).toBe(true)
  })

  test.each(
    EXPECTED.filter(p => p !== 'bilibili') // bilibili 是 API 模式
  )('%s 登录成功选择器非空', (platform) => {
    expect(PLATFORM_LOGIN_SUCCESS_SELECTORS[platform].length).toBeGreaterThan(0)
  })

  test('bilibili 登录成功选择器为空数组（API 模式）', () => {
    expect(PLATFORM_LOGIN_SUCCESS_SELECTORS.bilibili).toEqual([])
  })
})

describe('PLATFORM_PUBLISH_SELECTORS', () => {
  // —— 存在性 ——
  test.each(EXPECTED)(
    '%s 有发布选择器', (platform) => {
      const selectors = PLATFORM_PUBLISH_SELECTORS[platform]
      expect(selectors).toBeDefined()
      expect(typeof selectors).toBe('object')
    }
  )

  // facebook 发布选择器已补齐（Meta Creator Studio）
  test('facebook 发布选择器已定义', () => {
    const sel = PLATFORM_PUBLISH_SELECTORS.facebook
    expect(sel).toBeDefined()
    expect(typeof sel).toBe('object')
    expect(sel.upload_btn).toBeDefined()
    expect(sel.file_input).toBeDefined()
    expect(sel.publish_btn).toBeDefined()
    expect(sel.upload_btn.length).toBeGreaterThan(0)
    expect(sel.file_input.length).toBeGreaterThan(0)
    expect(sel.publish_btn.length).toBeGreaterThan(0)
  })

  // —— 标题或正文输入字段 ——
  function hasTitleOrContent(platform) {
    const sel = PLATFORM_PUBLISH_SELECTORS[platform]
    if (!sel) return false
    return TITLE_OR_CONTENT_FIELDS.some(fields =>
      fields.some(f => Array.isArray(sel[f]) && sel[f].length > 0)
    )
  }

  test.each(EXPECTED.filter(platform => platform !== 'baijiahao'))(
    '%s 有标题或正文输入字段', (platform) => {
      expect(hasTitleOrContent(platform)).toBe(true)
    }
  )

  test('baijiahao 视频发布选择器组合完整', () => {
    const sel = PLATFORM_PUBLISH_SELECTORS.baijiahao
    for (const field of ['write_btn', 'file_input', 'editor', 'desc_textarea', 'cover_input', 'cover_trigger', 'publish_btn']) {
      expect(Array.isArray(sel[field])).toBe(true)
      expect(sel[field].length).toBeGreaterThan(0)
    }
    expect(sel.tag_input).toEqual([])
  })

  // —— publish_btn ——
  test.each(EXPECTED)(
    '%s 有 publish_btn', (platform) => {
      const sel = PLATFORM_PUBLISH_SELECTORS[platform]
      expect(sel.publish_btn).toBeDefined()
      expect(sel.publish_btn.length).toBeGreaterThan(0)
    }
  )

  // —— kuaishou publish_btn 活体实证候选（2026-09-28 D2 二轮取证定案） ——
  // 一轮取证（snapshot-005）误判 <span>立即发布</span> 为提交钮——二轮活体验证（发布流实测 +
  // 账号标签注入探测）证明它是「发布时间」单选项；真提交钮是底栏 <div>发布</div>（裸 div、
  // 全页唯一直接文本为「发布」的元素，兄弟为 <div>取消</div>）。首位改为 div:has-text("发布")
  // （解析器 exactLeaf 层唯一命中）；单选项诱饵候选必须从列表移除。
  test('kuaishou publish_btn 首位为活体实证的底栏提交钮 div:has-text("发布")', () => {
    const sel = PLATFORM_PUBLISH_SELECTORS.kuaishou
    expect(sel.publish_btn[0]).toBe('div:has-text("发布")')
    // 旧候选保留在列表内兜底（页面改版回退路径）
    expect(sel.publish_btn).toContain('span:has-text("发布")')
    expect(sel.publish_btn).toContain('button:has-text("发布")')
  })

  test('kuaishou publish_btn 不得含发布时间单选项诱饵 span:has-text("立即发布")', () => {
    const sel = PLATFORM_PUBLISH_SELECTORS.kuaishou
    // 「立即发布」是发布时间区的单选项（radio），点击只切换定时模式，不触发发布 API——
    // 一轮取证误判其为提交钮导致活体点击点错对象（responses=0），必须移除。
    expect(sel.publish_btn).not.toContain('span:has-text("立即发布")')
  })

  // —— 视频平台上传按钮字段（各平台命名不同） ——
  const VIDEO_UPLOAD_FIELDS = {
    douyin:        ['upload_btn', 'file_input'],
    tencent_video: ['upload_btn', 'file_input'],
    kuaishou:      ['upload_btn', 'file_input'],
    youtube:       ['create_btn', 'upload_option', 'file_input'],
    tiktok:        ['file_input', 'caption_textarea'],
    bilibili:      ['upload_btn'],
  }

  for (const [platform, expectedFields] of Object.entries(VIDEO_UPLOAD_FIELDS)) {
    test.each(expectedFields)('%s 有视频上传字段: %s', (field) => {
      const sel = PLATFORM_PUBLISH_SELECTORS[platform]
      expect(sel).toBeDefined()
      expect(sel[field]).toBeDefined()
      expect(sel[field].length).toBeGreaterThan(0)
    })
  }

  // —— 所有选择器字段值为数组 ——
  test('所有选择器字段值为数组', () => {
    for (const [platform, fields] of Object.entries(PLATFORM_PUBLISH_SELECTORS)) {
      for (const [field, value] of Object.entries(fields)) {
        expect(Array.isArray(value)).toBe(true)
      }
    }
  })

  // —— 无多余平台 ——
  // 2026-10-18 video-publish-4：允许 `<platform>_video` 形态的键（按内容类型选选择器，
  // 见 src/publish-selectors-by-content-type.js）。这类键必须满足：
  //   ① 去掉 `_video` 后缀后是已知平台（不得凭空造平台）；
  //   ② 至少登记 file_input（否则视频上传整段被跳过，即 6 平台归因里头条真因）。
  test('无多余平台', () => {
    const keys = Object.keys(PLATFORM_PUBLISH_SELECTORS)
    for (const key of keys) {
      // 先按原判据走：已知平台键直接通过（`tencent_video` 自身以 _video 结尾，
      // 但它是平台名而非「视频选择器键」，必须先过这一条）
      if (EXPECTED.includes(key)) continue
      if (key.endsWith('_video')) {
        const base = key.slice(0, -'_video'.length)
        expect(EXPECTED, '视频选择器键 ' + key + ' 的基座不是已知平台').toContain(base)
        const v = PLATFORM_PUBLISH_SELECTORS[key]
        expect((v.file_input || []).length, key + ' 缺 file_input').toBeGreaterThan(0)
        continue
      }
      expect(EXPECTED).toContain(key)
    }
  })
})

describe('PLATFORM_NAMES', () => {
  test.each(EXPECTED)('%s 有中文名称', (platform) => {
    expect(PLATFORM_NAMES[platform]).toBeDefined()
    expect(PLATFORM_NAMES[platform].length).toBeGreaterThan(0)
  })
})
