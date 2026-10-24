// @ts-check
/**
 * rpa-overseas 契约测试
 *
 * ## 这些用例在守什么
 *
 * 旧实现（`rpa-view-platforms.js` 内 `_publish_youtube`，已迁出）的 5 个 fail-open：
 * 上传超时只 warn、发布按钮点不到也算成功、无受众项、无标签、无发布后回读。
 * 本文件的用例**逐条钉住这些失败路径必须返回 success:false**。
 *
 * ## 断言设计原则（本仓既有教训）
 *
 * 1. **锁必须对「正确实现」和「错误实现」都敏感**：只锁错误实现的特征 = 没牙齿。
 *    例：若把「上传超时 ⇒ fail」写回「warn 后继续」，本文件必须红。
 * 2. **不许恒真断言**：不许只断言「调用了某函数」而不看返回值。
 * 3. **不许条件性跳过**：缺依赖时要如实失败，不许 skip 掩盖。
 */
// ⚠️ 本仓 vitest 走 **globals 模式**（vi / describe / it / expect 都是全局）
//    ⇒ 不要 `require('vitest')`：vitest 4 在 CommonJS 下用 require 导入会直接抛
//    「Vitest cannot be imported in a CommonJS module using require()」。
const {
  publishYoutube,
  parseInstagramDeepLink,
  parseInstagramShortcode,
  verifyPublished,
  getOverseasSelectors,
  OVERSEAS_STEP_SELECTORS,
  UPLOAD_DONE_FN,
} = require('./index')

/**
 * 造一个最小可用的 RpaViewManager 上下文。
 * ⚠️ 语义与真实 helper 对齐（别写成"理想行为"，那会让测试与实现一起错）：
 *  - `_click` 真实实现**恒返回 true 且不抛错**（点击成功与否要靠回读判定）；
 *  - `_fillInput` 真实实现在读回为空时**抛错**；
 *  - `_waitForCondition` 的 fn 必须是页面侧函数字面量字符串。
 */
function createContext (opts) {
  const o = opts || {}
  const calls = { navigated: [], clicked: [], filled: [], waited: [], slept: [], events: [], missSeen: {} }
  return {
    calls,
    _emitProgress: vi.fn(),
    _sleep: vi.fn(async (ms) => { calls.slept.push(ms); calls.events.push('sleep:' + ms) }),
    _navigateAndWait: vi.fn(async (win, url) => { calls.navigated.push(url) }),
    // ⚠️ 必须能**按选择器**区分返回值：真实链上 file_input 与「详情对话框标题框」
    //   是两次独立的等待，若一律返回 false，链会先在 file_input 处失败，
    //   用例就锁不到它真正想验的那一步。
    _waitForElement: vi.fn(async (win, sel) => {
      calls.elems = calls.elems || []
      calls.elems.push(String(sel))
      if (o.elementFound === false) return false
      if (o.missingSelector && String(sel).includes(o.missingSelector)) return false
      // 「同一个选择器先 miss N 次再 hit」：用来模拟「点 Next 之后页面才渲染出可见性步骤」
      if (o.missFirstFor && String(sel).includes(o.missFirstFor)) {
        const k = o.missFirstFor
        calls.missSeen[k] = (calls.missSeen[k] || 0) + 1
        if (calls.missSeen[k] <= (o.missCount || 1)) return false
      }
      return true
    }),
    _waitForCondition: vi.fn(async (win, fn) => (o.uploadDone ?? true)),
    _setFileInput: vi.fn(async (win, path) => {
      if (o.fileThrows) throw new Error('File not found: ' + path)
    }),
    _setElementContentSafe: vi.fn(async (win, sel, content) => {
      calls.filled.push({ sel, content })
      return (o.setContentOk ?? true)
    }),
    _fillInput: vi.fn(async (win, sel, val) => {
      calls.filled.push({ sel, val })
      if (o.fillThrows) throw new Error('fill not applied (readback=0)')
      return String(val || '').length
    }),
    _click: vi.fn(async (win, sel) => { calls.clicked.push(sel); calls.events.push('click:' + sel) }),
    // 逐字插入通道：YouTube 链**不该**用它（会触发 # 话题补全浮层）⇒ 断言它未被调用。
    // ⚠️ 必须真的挂一个 spy 上来：若 ctx 上根本没有这个键，
    //    `expect(ctx._insertTextTrusted).toBeUndefined()` 会**恒真**（零信息量）。
    _insertTextTrusted: vi.fn(async () => true),
    _getPlatformConfig: vi.fn(() => ({ publish_url: 'https://www.youtube.com/upload' })),
  }
}

function makeWin (opts) {
  const o = opts || {}
  return {
    webContents: {
      getURL: () => o.url || 'https://www.youtube.com/upload',
      executeJavaScript: vi.fn(async (script) => {
        if (o.execThrows) throw new Error('executeJavaScript failed')
        if (typeof o.execResult === 'function') return o.execResult(script)
        return o.execResult ?? ''
      }),
    },
  }
}

/** 超时注入：用小值，避免用例真等（默认 60s/30min 是给真机用的） */
const OPTS = { publishVerifyTimeoutMs: 1, uploadWaitTimeoutMs: 1 }

const ARTICLE = {
  title: '测试标题',
  content: '<p>测试正文</p>',
  video_path: '/tmp/demo.mp4',
  tags: ['a', 'b'],
  accountId: 'acc-1',
}

// ============================================================
// 一、YouTube fail-closed 判据
// ============================================================

describe('YouTube 发布链（fail-closed）', () => {
  it('未登录（跳到 accounts.google.com）⇒ 必须失败，不得放行', async () => {
    const ctx = createContext()
    const win = makeWin({ url: 'https://accounts.google.com/signin' })
    const r = await publishYoutube.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/not logged in/)
  })

  it('没有视频文件 ⇒ 必须失败（YouTube 不支持纯图文发布）', async () => {
    const ctx = createContext()
    const win = makeWin()
    const r = await publishYoutube.call(ctx, win, { title: 't', content: 'c' }, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/needs video file/)
  })

  it('上传等待超时 ⇒ 必须失败（旧实现只 warn 就继续点发布）', async () => {
    const ctx = createContext({ uploadDone: false })
    const win = makeWin()
    const r = await publishYoutube.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/upload did not complete/)
  })

  it('详情对话框未出现 ⇒ 必须失败（不点发布）', async () => {
    const ctx = createContext({ missingSelector: 'title-textarea' })
    const win = makeWin()
    const r = await publishYoutube.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/details dialog not ready/)
  })

  it('文件注入抛错 ⇒ 必须失败', async () => {
    const ctx = createContext({ fileThrows: true })
    const win = makeWin()
    const r = await publishYoutube.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/file upload failed/)
  })

  it('发布后回读不到作品链接 ⇒ 必须失败（点了按钮≠发了出去）', async () => {
    const ctx = createContext()
    // executeJavaScript 恒返回空 ⇒ 回读不到任何 href
    const win = makeWin({ execResult: '' })
    const r = await publishYoutube.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/video link not found/)
  })

  it('全流程成功 ⇒ 返回 success:true 且带作品链接', async () => {
    const ctx = createContext()
    // 回读：元数据核验与链接回读都返回 youtube 链接
    const win = makeWin({ execResult: 'https://youtu.be/abc123' })
    const r = await publishYoutube.call(ctx, win, ARTICLE, OPTS)
    expect(r.success).toBe(true)
    expect(r.url).toBe('https://youtu.be/abc123')
    expect(r.verified).toBe(true)
  })

  it('标签要在「显示更多」展开后才填（点 toggle → 填 tags）', async () => {
    const ctx = createContext()
    const win = makeWin({ execResult: 'https://youtu.be/abc123' })
    await publishYoutube.call(ctx, win, ARTICLE, OPTS)
    const clicked = ctx.calls.clicked.join(' | ')
    expect(clicked).toMatch(/toggle-button/)
    const tagFill = ctx.calls.filled.find((f) => String(f.sel || '').includes('tags'))
    expect(tagFill).toBeTruthy()
    expect(String(tagFill.val)).toContain('a,b')
  })

  it('标题用一次性灌入（setElementContentSafe），不逐字插入', async () => {
    const ctx = createContext()
    const win = makeWin({ execResult: 'https://youtu.be/abc123' })
    await publishYoutube.call(ctx, win, ARTICLE, OPTS)
    const titleFill = ctx.calls.filled.find((f) => String(f.sel || '').includes('title-textarea'))
    expect(titleFill).toBeTruthy()
    // 逐字插入通道（_insertTextTrusted）在本链**不应**被使用
    expect(ctx._insertTextTrusted).not.toHaveBeenCalled()
  })

  it('点 Next 之后必须等页面渲染再判（否则会连点多点、跳过可见性设置）', async () => {
    // 可见性 radio：第一次查不到（还在「元素」步骤）→ 点 Next → 第二次才查到
    const ctx = createContext({ missFirstFor: 'name="PUBLIC"', missCount: 1 })
    const win = makeWin({ execResult: 'https://youtu.be/abc123' })
    await publishYoutube.call(ctx, win, ARTICLE, OPTS)
    const nextIdx = ctx.calls.events.findIndex((e) => e.indexOf('click:') === 0 && /下一步|next-button/.test(e))
    expect(nextIdx).toBeGreaterThan(-1)          // 确实点过 Next
    const sleptAfter = ctx.calls.events.slice(nextIdx + 1).some((e) => e.indexOf('sleep:') === 0)
    expect(sleptAfter).toBe(true)                // 点完 Next 之后有等待
  })

  it('可见性 radio 读的是**选择器表**（注入假表 ⇒ 点假表里的那个）', async () => {
    // ⚠️ 这条断言曾经是**恒真**的：表里 PUBLIC 的候选与实现里硬编码的
    //    'tp-yt-paper-radio-button[name="PUBLIC"]' **逐字相同** ⇒ 两种实现都能过。
    //    ⇒ 改为**注入一张假表**，假表里 PUBLIC 候选是另一个选择器：
    //      实现若走表 ⇒ 点假表的；实现若硬编码 ⇒ 点真表的 ⇒ 断言红。
    const fake = {
      file_input: ['input[type="file"]'],
      title_input: ['#title-textarea #textbox'],
      desc_textarea: ['#description-textarea #textbox'],
      next_btn: ['#fake-next'],
      publish_btn: ['#fake-publish'],
      audience_not_for_kids: ['#fake-audience'],
      tags_toggle: ['#fake-tags-toggle'],
      tags_input: ['#fake-tags-input'],
      cover_input: ['#fake-cover'],
      visibility_btn: ['#fake-visibility-radio'],
      visibility_radio: {
        PUBLIC: ['#fake-radio-PUBLIC'],
        UNLISTED: ['#fake-radio-UNLISTED'],
        PRIVATE: ['#fake-radio-PRIVATE'],
      },
      published_link: ['a[href*="youtu.be"]'],
    }
    const ctx = createContext()
    const win = makeWin({ execResult: 'https://youtu.be/abc123' })
    await publishYoutube.call(ctx, win, ARTICLE, { ...OPTS, selectors: fake })
    const clicked = ctx.calls.clicked.join(' | ')
    expect(clicked).toMatch(/#fake-radio-PUBLIC/)
    // 且**不应**出现真表里的那个选择器（若出现 ⇒ 实现绕过了注入的表）
    expect(clicked).not.toMatch(/tp-yt-paper-radio-button/)
  })

  it('导航地址取自平台配置（yaml 是 publish_url 单一真源）', async () => {
    const ctx = createContext()
    const win = makeWin({ execResult: 'https://youtu.be/abc123' })
    await publishYoutube.call(ctx, win, ARTICLE, OPTS)
    expect(ctx._getPlatformConfig).toHaveBeenCalledWith('youtube', ARTICLE)
    expect(ctx.calls.navigated[0]).toBe('https://www.youtube.com/upload')
  })
})

// ============================================================
// 一之一、宿主方法契约（防「mock 掉的拼写错」这类盲区）
// ============================================================

describe('宿主方法契约', () => {
  // ⚠️ 本文件里 publishYoutube 依赖的宿主方法**全部被 mock** ⇒ 方法名拼错时
  //    本文件仍会全绿，只有真机才炸（「可加载 ≠ 能用」的同型）。
  //    ⇒ 这里从**真实 mixin 源码**做结构锁，锁住方法名与签名形状。
  const fs = require('fs')

  function readSource (rel) {
    return fs.readFileSync(require.resolve(rel), 'utf-8')
  }

  it('helpers mixin 提供 DOM/输入/等待能力（publishYoutube 依赖的）', () => {
    const src = readSource('../rpa-view-helpers')
    for (const m of [
      '_navigateAndWait', '_waitForElement', '_waitForCondition',
      '_setFileInput', '_setElementContentSafe', '_click', '_sleep', '_fillInput',
    ]) {
      expect(src).toMatch(new RegExp('(async )?' + m + '\\s*\\('))
    }
  })

  it('platforms mixin 提供 _getPlatformConfig（publish_url 的读取口）', () => {
    const src = readSource('../rpa-view-platforms')
    expect(src).toMatch(/_getPlatformConfig\s*\(/)
  })

  it('manager 本体提供 _emitProgress（进度回传）', () => {
    const src = readSource('../rpa-view-manager')
    expect(src).toMatch(/_emitProgress\s*\(/)
  })

  it('分发点是动态方法名 ⇒ 新增平台无需改分发点', () => {
    const src = readSource('../rpa-view-manager')
    expect(src).toMatch(/'_publish_'\s*\+\s*platform/)
  })
})

// ============================================================
// 一之二、注入页面的脚本契约
// ============================================================

describe('注入页面的脚本契约', () => {
  it('UPLOAD_DONE_FN 必须是合法的 JS 函数字面量（helper 会把它拼进页面执行）', () => {
    // ⚠️ 这条断言的价值：helper 的 _waitForCondition 把 fn 拼成
    //   `let c = <fn>; ...` ⇒ fn 语法错时**只有真机**才会炸（本地 mock 掉了 helper）。
    //   而 YouTube 上传等待是 fail-closed 的关键一步 ⇒ 语法错 = 永远等不到 = 永远失败。
    expect(typeof UPLOAD_DONE_FN).toBe('string')
    expect(() => new Function('return (' + UPLOAD_DONE_FN + ')')).not.toThrow()
    const fn = new Function('return (' + UPLOAD_DONE_FN + ')')()
    expect(typeof fn).toBe('function')
  })

  it('UPLOAD_DONE_FN 的完成词覆盖中英文（平台可能返回任一语种）', () => {
    for (const w of ['处理', '上传完成', 'Processing', 'Finished']) {
      expect(UPLOAD_DONE_FN).toContain(w)
    }
  })

  it('注入脚本里的正则不得含会提前闭合字符串的引号（转义坑）', () => {
    // 曾经的坑：ffmpeg 之类的地方写 \' 会提前闭合引号 ⇒ 后半段被当成参数。
    // 这里断言脚本里不出现「反斜杠 + 单引号」这种转义（页面脚本一律用双引号包字符串）。
    expect(UPLOAD_DONE_FN).not.toContain("\\'")
  })
})

// ============================================================
// 二、发布后核验层
// ============================================================

describe('发布后回读核验', () => {
  it('YouTube：回读到链接才算核验通过', async () => {
    const win = makeWin({ execResult: 'https://youtu.be/x' })
    const r = await verifyPublished(win, 'youtube', {})
    expect(r.verified).toBe(true)
    expect(r.evidence.videoUrl).toBe('https://youtu.be/x')
  })

  it('YouTube：回读不到 ⇒ verified:false 且给出原因（不是抛错）', async () => {
    const win = makeWin({ execResult: '' })
    const r = await verifyPublished(win, 'youtube', {})
    expect(r.verified).toBe(false)
    expect(r.reason).toBeTruthy()
    expect(r.error).toBeUndefined()
  })

  it('Instagram：三重元数据齐全才算核验通过', async () => {
    const win = makeWin({
      execResult: (script) => {
        const s = String(script)
        if (s.includes('og:url')) return 'https://www.instagram.com/p/ABC123/'
        if (s.includes('instapp:owner_user_id')) return '999'
        if (s.includes('description')) return '这是我的正文'
        if (s.includes('al:ios:url')) return 'instagram://media?id=555_999'
        return ''
      },
    })
    const r = await verifyPublished(win, 'instagram', { expectedText: '我的正文' })
    expect(r.verified).toBe(true)
    expect(r.evidence.contentId).toBe('555')
    expect(r.evidence.ownerId).toBe('999')
  })

  it('Instagram：正文与预期不符 ⇒ 不得算已核验（可能发到了别处）', async () => {
    const win = makeWin({
      execResult: (script) => {
        const s = String(script)
        if (s.includes('og:url')) return 'https://www.instagram.com/p/ABC123/'
        if (s.includes('instapp:owner_user_id')) return '999'
        if (s.includes('description')) return '别的内容'
        if (s.includes('al:ios:url')) return 'instagram://media?id=555_999'
        return ''
      },
    })
    const r = await verifyPublished(win, 'instagram', { expectedText: '我的正文' })
    expect(r.verified).toBe(false)
    expect(r.reason).toMatch(/正文/)
  })

  it('Instagram：元数据不完整 ⇒ verified:false（不是恒真）', async () => {
    const win = makeWin({ execResult: '' })
    const r = await verifyPublished(win, 'instagram', {})
    expect(r.verified).toBe(false)
  })

  it('核验过程自身出错 ⇒ 返回 error 字段（与 verified:false 区分开）', async () => {
    const win = makeWin({ execThrows: true })
    const r = await verifyPublished(win, 'youtube', {})
    expect(r.error).toBeTruthy()
    expect(r.verified).toBeUndefined()
  })

  it('X 网页轨不声称已核验（公开可见性只能由官方 API 回读确认）', async () => {
    const win = makeWin({ execResult: 'published' })
    const r = await verifyPublished(win, 'twitter', {})
    expect(r.verified).toBe(false)
    expect(r.reason).toMatch(/官方 API/)
  })
})

describe('解析器：Instagram 作品标识', () => {
  it('深链解析出 contentId 与 ownerId', () => {
    expect(parseInstagramDeepLink('instagram://media?id=555_999')).toEqual({ contentId: '555', ownerId: '999' })
  })

  it('深链形态不合法 ⇒ null（不返回半个结果）', () => {
    expect(parseInstagramDeepLink('instagram://media?id=555')).toBeNull()
    expect(parseInstagramDeepLink('')).toBeNull()
    expect(parseInstagramDeepLink('https://instagram.com/p/ABC/')).toBeNull()
  })

  it('规范链接解析出短码', () => {
    expect(parseInstagramShortcode('https://www.instagram.com/p/ABC123/')).toBe('ABC123')
    expect(parseInstagramShortcode('https://www.instagram.com/reel/XY9/')).toBe('XY9')
  })

  it('拒绝外域与非 HTTPS（防把别人的作品当成自己的）', () => {
    expect(parseInstagramShortcode('https://evil.com/p/ABC123/')).toBe('')
    expect(parseInstagramShortcode('http://www.instagram.com/p/ABC123/')).toBe('')
    expect(parseInstagramShortcode('https://www.instagram.com/stories/x/')).toBe('')
  })
})

// ============================================================
// 三、选择器表
// ============================================================

describe('海外选择器表（增量）', () => {
  it('增量表只登记本 PR 有专属链的平台（不登记没人消费的选择器）', () => {
    // tiktok / twitter / instagram / facebook 的**步骤**选择器随各自专属链同批落地；
    // 通用字段已在真源表 packages/rpa-engine/src/platform-selectors.js 里。
    expect(Object.keys(OVERSEAS_STEP_SELECTORS)).toEqual(['youtube'])
  })

  it('YouTube 增量键齐全（缺一个就是漏功能）', () => {
    const s = OVERSEAS_STEP_SELECTORS.youtube
    for (const k of [
      'title_input', 'desc_textarea', 'audience_not_for_kids',
      'tags_toggle', 'tags_input', 'cover_input', 'upload_progress', 'published_link',
    ]) {
      expect(s[k]).toBeTruthy()
      expect(s[k].length).toBeGreaterThan(0)
    }
  })

  it('合并后拿到通用字段（来自真源表）+ 增量字段（来自本表）', () => {
    const merged = getOverseasSelectors('youtube')
    // 通用字段：file_input / next_btn / publish_btn 在真源表里
    expect(merged.file_input).toBeTruthy()
    expect(merged.next_btn).toBeTruthy()
    expect(merged.publish_btn).toBeTruthy()
    // 增量字段：upload_progress / published_link 只在本表里
    expect(merged.upload_progress).toBeTruthy()
    expect(merged.published_link).toBeTruthy()
  })

  it('增量覆盖真源表（更精确的 contenteditable 选择器胜出）', () => {
    const merged = getOverseasSelectors('youtube')
    // 真源表 youtube.title_input 首候选是 '#title-textarea'；
    // 增量表首候选是 '#title-textarea #textbox'（真正可填的 contenteditable）
    expect(merged.title_input[0]).toBe('#title-textarea #textbox')
  })

  it('未知平台返回空对象而不是抛错', () => {
    expect(getOverseasSelectors('nope')).toEqual({})
  })
})
