// 小红书图文 draftOnly 的「硬证据」确认链 —— 回归锁（2026-10-15 首版，2026-10-15 CCG 评审后修订）。
//
// 现场（2026-10-15 真机复现）：应用里发一条小红书图文草稿，应用报「发布成功」，
// 但平台草稿箱**没有新增**。日志显示 draft-only done saved=true 只等了 3 秒，
// 命中的是页面**静态文案**（`/编辑于\s*\S{1,12}|已保存|保存成功|自动保存/` 这类
// 页面文本正则），同一时刻页面控制台正在连报「获取某个数据失败 / 请求失败」。
// 发布窗口随后是空编辑页（无图、无标题、无正文），草稿箱计数仍是 1。
//
// 根因：Electron 侧的 draftSaved 判据是**页面文本正则**，不是落库证据。
//
// ── 修订说明（CCG 跨家族深度评审 7 条发现，1 Critical）──
// 首版实现有三处被判为「与真机缺陷同形」：
//   i1(Critical) 第二通道端点表写成宽词子串，且把「resolve 非空」当成功 ——
//                会把页面自身草稿列表查询/埋点的 200、乃至非 200 响应读成落库证据；
//   i2           响应监听挂在计数等待之后，而 `_waitForResponse` 只监听注册之后的响应
//                ⇒ 必然错过真正的保存响应；
//   i4/i5        标题匹配能单独确认成功（同名旧草稿可翻案）、基线在写内容之后才读
//                （平台在填写阶段已自动保存 ⇒ 基线含住本次草稿 ⇒ 主判据常态失效）。
// 本文件按修订后的实现重写，并且**不再拷贝生产逻辑做桩**（原桩把
// `_waitForDraftBoxIncrement` / `_recheckDraftBoxByTitle` 的实现抄了一遍，
// 生产改了桩不改测试照绿 —— 评审 i6）。现在用例驱动**真实方法**：
// 只桩 `win.webContents.executeJavaScript`（返回计数文本/标题命中），并用虚拟时钟
// 让轮询循环立刻走完，从而真正覆盖生产的读计数、增量比较、重载复核三条逻辑。
//
// 锁住的不变量：
//   H1 基线未知（读不到计数）时**不得**报成功，也不得拿 0 顶替
//   H2 计数未增长**不得**报成功——哪怕草稿列表里见到了同名条目（同名旧草稿会误命中）
//   H3 计数增长 ⇒ 成功，且 draftEvidence 如实回传 counter-increment
//   H4 三条通道全部不可达 ⇒ success:false（fail-closed，绝不假成功）
//   H5 保存接口 200 ⇒ 成功（save-response）
//   H6 保存接口非 200 ⇒ **不得**确认成功
//   H7 重载复核拿到计数增量 ⇒ 成功（counter-increment-after-reload）
//   H8 接线锁：端点表形态 / 基线时机 / 监听时机 / 旧文本判据已移除 / 只点一次存草稿
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'

const MODULE = '../services/rpa-view-platforms'

async function loadPublishGeneric () {
  const mod = await import(MODULE)
  const mixin = mod.default || mod
  const fn = mixin._publish_generic
  if (typeof fn !== 'function') throw new Error('未能从 ' + MODULE + ' 取得 _publish_generic')
  return fn
}

const SRC_PATH = () => path.resolve(process.cwd(), 'electron/services/rpa-view-platforms.js')
// 判据本体搬去独立模块（行数门禁点名还账文件零增长容差），接线锁因此要同时看两个文件。
const MODULE_SRC = () => path.resolve(process.cwd(), 'electron/services/xhs-draft-confirm.js')
const CALLER_SRC = SRC_PATH

/** 虚拟时钟：让轮询循环（①20s / ③8s）在毫秒内走完，而不是真等 28 秒。 */
function installVirtualClock () {
  let now = Date.now()
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => now)
  return { advance: (ms) => { now += (ms || 0) }, restore: () => spy.mockRestore() }
}

/**
 * 构造桩实例。**不桩任何被测方法**（`_readDraftBoxCounter` / `_waitForDraftBoxIncrement`
 * / `_recheckDraftBox` 都跑生产实现），只桩它的外部依赖：
 *  - `win.webContents.executeJavaScript`：按脚本形态分流返回（计数文本 / 标题命中 / 登录探测）
 *  - `_navigateAndWait`：计数导航次数（③ 的重载靠它触发）
 *  - `_sleep`：推进虚拟时钟
 * `counterFn(readIndex, navCount)` 决定每次计数读到的值，用例据此摆布各通道。
 */
function makeInstance (counterFn, overrides = {}) {
  const clock = installVirtualClock()
  const state = { reads: 0, navs: 0 }
  const inst = {
    __clock: clock,
    __state: state,
    _emitProgress: vi.fn(),
    _sleep: async (ms) => { clock.advance(ms) },
    _resolveSelector: vi.fn(async () => '#e'),
    _fillInput: vi.fn(async () => {}),
    _click: vi.fn(async () => true),
    _waitForElement: vi.fn(async () => true),
    _setFileInput: vi.fn(async () => {}),
    _getPlatformConfig: vi.fn(() => ({})),
    _prepBaijiahao: vi.fn(async () => {}),
    _execHook: vi.fn(async () => {}),
    _waitForResponse: vi.fn(async () => null),
    _waitForCondition: vi.fn(async () => true),
    _composeEditorCaption: vi.fn(() => ''),
    _dismissPostNavDialogs: vi.fn(async () => {}),
    _navigateAndWait: vi.fn(async () => { state.navs++ }),
    _waitForNavigation: vi.fn(async () => {}),
    ...overrides,
  }
  inst._win = {
    webContents: {
      getURL: () => 'https://creator.xiaohongshu.com/publish/publish?target=image',
      isDestroyed: () => false,
      loadURL: async () => {},
      executeJavaScript: vi.fn(async (script) => {
        const s = String(script || '')
        if (s.includes('hasLoginPrompt')) return { hasLoginPrompt: false, hasForm: true }
        if (s.includes('JSON.stringify(texts')) {
          const val = counterFn(state.reads++, state.navs)
          return val === null || val === undefined ? JSON.stringify([]) : JSON.stringify(['草稿箱(' + val + ')'])
        }
        if (s.includes('===want')) return false
        return undefined
      }),
    },
  }
  return inst
}

function article (over = {}) {
  return { title: 'E2E 草稿箱验证', content: '正文内容', tags: ['E2E'], ...over }
}

async function runDraftOnly (inst, art, config = {}, platform = 'xiaohongshu') {
  const mod = await import(MODULE)
  const mixin = mod.default || mod
  // 判据本体（读计数 / 等增量 / 重载复核 / 确认链）已整体在 ../services/xhs-draft-confirm，
  // `_publish_generic` 的 draftOnly 分支只做委派 ⇒ 用例天然驱动**真实实现**，
  // 不需要（也没有）任何生产逻辑的桩副本。
  const cfg = {
    publish_url: 'https://creator.xiaohongshu.com/publish/publish',
    draftOnly: true,
    selectors: {
      title_input: ['#t'],
      editor: ['#e'],
      content_textarea: [],
      tag_input: [],
      draft_btn: [],
      publish_btn: [],
      ...(config.selectors || {}),
    },
    ...config,
  }
  return mixin._publish_generic.call(inst, inst._win, art, platform, cfg)
}

afterEach(() => { vi.restoreAllMocks() })

describe('小红书 draftOnly 硬证据确认链（2026-10-15）', () => {
  it('H3 计数增长 ⇒ draft 成功，evidence=counter-increment（主判据命中）', async () => {
    // 基线读**两次**（评审 i3 的设防，取较大值）：索引 0/1 是这两次，都读到 1；
    // 其后都读到 2（增长）。
    const inst = makeInstance((i) => (i <= 1 ? 1 : 2))
    const res = await runDraftOnly(inst, article())
    expect(res.success).toBe(true)
    expect(res.draftSaved).toBe(true)
    expect(res.draftEvidence).toBe('counter-increment')
  })

  it('H1 基线未知（读不到计数）⇒ 不得报成功（且不得拿 0 顶替）', async () => {
    const inst = makeInstance(() => null)
    const res = await runDraftOnly(inst, article())
    expect(res.success).toBe(false)
    expect(res.draftSaved).toBe(false)
    expect(res.errorCode).toBe('PUBLISH_DRAFT_UNCONFIRMED')
  })

  it('H2 计数未增长 ⇒ 不得报成功，哪怕草稿列表见到了同名条目', async () => {
    // 计数恒为 1（不增长）；页面文案判据 _waitForCondition 仍返回 true（旧判据会判成功）；
    // 重载后列表里能匹配到同名条目 —— 这正是「同名旧草稿」的误命中形态。
    const inst = makeInstance(() => 1, {
      _waitForCondition: vi.fn(async () => true),
    })
    // 让标题匹配脚本返回 true（同名条目命中）
    inst._win.webContents.executeJavaScript = vi.fn(async (script) => {
      const s = String(script || '')
      if (s.includes('hasLoginPrompt')) return { hasLoginPrompt: false, hasForm: true }
      if (s.includes('JSON.stringify(texts')) return JSON.stringify(['草稿箱(1)'])
      if (s.includes('===want')) return true
      return undefined
    })
    const res = await runDraftOnly(inst, article())
    expect(res.success).toBe(false)
    expect(res.draftSaved).toBe(false)
    expect(res.errorCode).toBe('PUBLISH_DRAFT_UNCONFIRMED')
    // 文案要如实说明「见到了同名条目但不据此判成功」（否则用户无法理解为什么报失败）
    expect(String(res.error)).toMatch(/同名/)
  })

  it('H4 三条硬证据通道全部不可达 ⇒ fail-closed 报失败', async () => {
    const inst = makeInstance(() => null, { _waitForResponse: vi.fn(async () => null) })
    const res = await runDraftOnly(inst, article())
    expect(res.success).toBe(false)
    expect(res.draftSaved).toBe(false)
    expect(res.errorCode).toBe('PUBLISH_DRAFT_UNCONFIRMED')
  })

  it('H5 保存接口 200 成功响应 ⇒ 成功，evidence=save-response', async () => {
    const inst = makeInstance(() => 1, {
      _waitForResponse: vi.fn(async () => ({ url: 'https://edith.xiaohongshu.com/web_api/sns/v2/note', statusCode: 200 })),
    })
    const res = await runDraftOnly(inst, article())
    expect(res.success).toBe(true)
    expect(res.draftEvidence).toBe('save-response')
  })

  it('H6 保存接口非 200（500）⇒ 不得确认成功（resolve 非空 ≠ 落库）', async () => {
    const inst = makeInstance(() => 1, {
      _waitForResponse: vi.fn(async () => ({ url: 'https://edith.xiaohongshu.com/web_api/sns/v2/note', statusCode: 500 })),
    })
    const res = await runDraftOnly(inst, article())
    expect(res.success).toBe(false)
    expect(res.draftSaved).toBe(false)
    expect(res.errorCode).toBe('PUBLISH_DRAFT_UNCONFIRMED')
  })

  it('H7 重载草稿箱后读到计数增量 ⇒ 成功，evidence=counter-increment-after-reload', async () => {
    // nav=1 时（首次导航/页内轮询）计数恒为 1；③ 的重载让 nav=2，此后读到 2
    const inst = makeInstance((i, nav) => (nav >= 2 ? 2 : 1))
    const res = await runDraftOnly(inst, article())
    expect(res.success).toBe(true)
    expect(res.draftEvidence).toBe('counter-increment-after-reload')
  })

  it('H9 非小红书平台的 draftOnly 保持既有行为，不得被塞进小红书链（评审 i2）', async () => {
    // 头条（带 publishTime 的 DOM 轨）会以 draftOnly 运行（见 packages/rpa-engine/src/
    // toutiao-direct-bridge.js）。小红书链是专用选择器 + 中文计数文本，套上去会让它的基线
    // 恒为 null ⇒ 主判据永久失效 ⇒「本来能报成功的草稿」变成「恒失败」。
    const inst = makeInstance(() => null, { _waitForCondition: vi.fn(async () => true) })
    const res = await runDraftOnly(inst, article(), {}, 'toutiao')
    expect(res.success).toBe(true) // 既有行为：内容闸通过即成功
    expect(res.draftSaved).toBe(true) // 既有行为：页面文本判据的结果，仅作信息位
    expect(res.draftEvidence).toBeUndefined() // 没走小红书链（那条链会带 draftEvidence）
    expect(res.errorCode).toBeUndefined()
  })

  it('H9b 非小红书平台：内容没写进去时仍按内容闸 fail-closed（既有行为不变）', async () => {
    const inst = makeInstance(() => null, { _resolveSelector: vi.fn(async () => null) })
    const res = await runDraftOnly(inst, article(), {
      selectors: { title_input: ['#never'], editor: ['#never'] },
    }, 'toutiao')
    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('PUBLISH_DRAFT_CONTENT_NOT_FILLED')
  })

  it('H10 ②的返回形状对着**真实 helper** 锁（评审 i4：不能只用桩互证）', async () => {
    // confirmDraftSaved 读的是平铺 {statusCode, url}；`_waitForResponseExclusive` 若改成
    // 嵌套（如 {response:{statusCode}}）或改名，statusCode===200 会恒假 ⇒ ②静默失效
    // （fail-closed 但少一条通道，且用户侧只看到「未确认」）。所以锁住真实 helper 的形态。
    const helper = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/services/rpa-view-helpers.js'), 'utf-8')
    expect(helper).toMatch(/resolve\(\{url:\s*url\s*,\s*statusCode:\s*d\.statusCode\s*,\s*matchedUrls:\s*matched\}/)
  })

  it('H11 基线低估（侧边栏未渲染完读到 0）不得被算成增量（评审 i3）', async () => {
    // 读数序列：基线第一次 0、复核读到 1（渲染完成），其后恒 1。
    // 只读一次基线的话 baseline=0，随后的 1 会被判成「增量成立」——一条**旧**草稿
    // 就足以造成假成功（与真机缺陷同形）。现在基线取两次的较大值 = 1 ⇒ 1 > 1 不成立。
    const inst = makeInstance((i) => (i === 0 ? 0 : 1))
    const res = await runDraftOnly(inst, article())
    expect(res.success).toBe(false)
    expect(res.draftSaved).toBe(false)
    expect(res.errorCode).toBe('PUBLISH_DRAFT_UNCONFIRMED')
  })

  it('H12 计数节点读不到时，标题命中不得把失败文案切成「见到了同名条目」（评审 i7）', async () => {
    const inst = makeInstance(() => null, { _waitForResponse: vi.fn(async () => null) })
    // 计数节点读不到（草稿箱没渲染出来），而标题探针恒命中——模拟宽泛后代选择器
    // `[class*="draft"] [class*="title"]` 在编辑区/提示里误命中。
    inst._win.webContents.executeJavaScript = vi.fn(async (script) => {
      const s = String(script || '')
      if (s.includes('hasLoginPrompt')) return { hasLoginPrompt: false, hasForm: true }
      if (s.includes('JSON.stringify(texts')) return JSON.stringify([])
      if (s.includes('===want')) return true
      return undefined
    })
    const res = await runDraftOnly(inst, article())
    expect(res.success).toBe(false)
    expect(String(res.error)).not.toMatch(/同名/)
  })

  it('H8 接线锁：判据在确认模块里，且调用方只剩委派（八件事）', async () => {
    const moduleSrc = fs.readFileSync(MODULE_SRC(), 'utf-8')
    const callerSrc = fs.readFileSync(CALLER_SRC(), 'utf-8')

    // ① 端点表必须是**窄路径**（有据可查：Python 侧 DRAFT_SAVE_RESPONSE_PATTERNS），
    //    且**不得**退回宽词子串 —— 宽词会命中页面自身的草稿列表查询/埋点（评审 i1）。
    expect(moduleSrc).toContain("const SAVE_RESPONSE_PATTERNS = ['/web_api/sns/v2/note']")
    expect(moduleSrc).not.toMatch(/SAVE_RESPONSE_PATTERNS\s*=\s*\[[^\]]*['"](draft|save)['"]/)

    // ② 次判据必须校验 HTTP 200（评审 i1b：`_waitForResponse` 的兜底分支会 resolve 非 200）
    expect(moduleSrc).toContain('statusCode === 200')

    // ③ 确认式只能由「计数增量 / 响应 200 / 重载后增量」组成
    //    —— **标题命中不得出现在确认式里**（评审 i4）
    expect(moduleSrc).toContain('const draftSaved = counterConfirmed || responseConfirmed || recheckIncrement')

    // ④ 响应监听必须在**点击之前**挂上（评审 i2：只监听注册之后的响应，挂晚了必然错过）。
    //    锚**调用形态**而不是日志文案（评审 i6：锚日志串会被无关的文案改动弄红）。
    const mountAt = moduleSrc.indexOf('mountSaveResponseWatch(host, win)')
    const clickAt = moduleSrc.indexOf('host._click(win, cand)')
    expect(mountAt).toBeGreaterThan(-1)
    expect(clickAt).toBeGreaterThan(-1)
    expect(mountAt).toBeLessThan(clickAt)

    // ⑤ 存草稿入口只点一次（首版曾点两次：基线之前一次、之后又一次）
    expect((moduleSrc.match(/host\._click\(win, cand\)/g) || []).length).toBe(1)

    // ⑥ 兜底回查不得硬编码域名（评审 i3：平台地址走 config.publish_url 单一真源）
    const recheckStart = moduleSrc.indexOf('async function recheckDraftBox (')
    expect(recheckStart).toBeGreaterThan(-1)
    expect(moduleSrc.slice(recheckStart, recheckStart + 1400)).not.toMatch(/loadURL\('https?:\/\//)

    // ⑦ 调用方 draftOnly 分支：小红书子分支只剩委派，且**代码行**里不得再有旧判据。
    //    （只看代码行不看注释——块内注释会解释旧判据为什么被弃用，直接对整块文本做
    //    not.toMatch 等于「锁注释不锁代码」。）
    //    非小红书平台的那半段**保留**了既有页面文本判据（评审 i2：不能顺手改别的平台），
    //    所以这里把切片限定在小红书子分支内，锁的才是本刀真正替换掉的那条路径。
    const branchStart = callerSrc.indexOf('if (config.draftOnly) {')
    const branchEnd = callerSrc.indexOf('if (sel.publish_btn && sel.publish_btn.length>0) {', branchStart)
    expect(branchStart).toBeGreaterThan(-1)
    expect(branchEnd).toBeGreaterThan(branchStart)
    const branch = callerSrc.slice(branchStart, branchEnd)
    const xhsStart = branch.indexOf("if (platform === 'xiaohongshu') {")
    const xhsEnd = branch.indexOf('其它平台的 draftOnly')
    expect(xhsStart).toBeGreaterThan(-1)
    expect(xhsEnd).toBeGreaterThan(xhsStart)
    const xhsCode = branch.slice(xhsStart, xhsEnd)
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(xhsCode).not.toMatch(/innerText/)
    expect(xhsCode).not.toMatch(/_waitForCondition\s*\(/)
    expect(xhsCode).toContain('xhsDraftConfirm.runDraftOnly(')
    // 非小红书那半段仍受既有内容闸保护（本条是 H9b 的静态孪生断言）
    expect(branch).toContain('xhsDraftConfirm.contentGate(')

    // ⑧ 基线必须在**写入内容之前**读（评审 i5：填写阶段的自动保存会把本次草稿吃进基线）
    const baselineReadAt = callerSrc.indexOf('xhsDraftConfirm.readBaselineContext(')
    const fillTitleAt = callerSrc.indexOf('if (article.title && (titleSel || captionSel)) {')
    expect(baselineReadAt).toBeGreaterThan(-1)
    expect(fillTitleAt).toBeGreaterThan(-1)
    expect(baselineReadAt).toBeLessThan(fillTitleAt)
  })
})
