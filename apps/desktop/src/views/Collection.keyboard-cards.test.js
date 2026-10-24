/**
 * 采集页「快捷采集 / 草稿箱 / 来源入口」这组可点卡片的键盘可达合同（UX 审计 4.4 第二批）
 *
 * PRD §三 把修法钉成四件套：`role="button"` + `tabindex="0"` + `@keydown.enter.prevent` +
 * `@keydown.space.prevent`，且两个 keydown 的表达式必须与 `@click` **逐字一致**。
 *
 * 本文件按 QM-6 评审（PR #4088 i2/i3/i4/i6/i8）重写，四条判据一条不能少：
 *   1) 结构（**模板 AST 层**，不是源码行层）：六张卡片的四件套齐备且表达式相同。
 *      第一版是 `split('\n').filter(整行正则)` + `new RegExp('@keydown.enter.prevent')`，
 *      两个毛病都是评审抓出来的（i4）：模板被 prettier 折行 ⇒ 标签不再整行命中 ⇒ **假红**；
 *      属性名里的 `.` 未转义 ⇒ `@keydown.xenter.prevent` 也算命中。现在用 `@vue/compiler-sfc`
 *      解析，排版形态与判据彻底解耦。
 *   2) 域（身份枚举，i8）：判定域不是「≥6 张」这种数量保底，而是**逐张点名**。
 *      数量保底对「第 7 张卡写成别的 class 顺序」结构性失明 —— 漏的那张不会让任何断言变红。
 *   3) 行为（六张全覆盖 + 恰一次，i2/i3）：Enter 与 Space **各自**触发**同一个可观测出口**，
 *      且断 `toHaveBeenCalledTimes(1)`。第一版只测了草稿箱一张（其余 5 张只有"表达式与自身相等"
 *      的结构锁 —— 若 @click 本身就指向一个坏方法，结构锁照绿）；而 `toHaveBeenLastCalledWith`
 *      对"触发了两次"完全免疫。出口按 `data-testid` 定位，每张卡断自己那个真实下游。
 *      断言的是**归一化后的目的地**（i6），不是 `router.push` 的字符串写法 —— 改成
 *      `push({ path, query })` 不该让这条锁红。
 *   4) 禁令：补了 `role="button"` 的元素**不得有可见、可聚焦的后代** —— `button` 是 leaf 角色，
 *      取到该角色后其子树在无障碍树上变成 presentational，容器里的真按钮会**从 a11y 树消失**，
 *      而视觉、鼠标、单测、构建全都不报错（本仓实测过 3 处，见 PRD §三「硬禁令」）。
 * 外加一条负控：只有 `@click` 的 div 按 Enter **必须不产生事件**，否则第 3 条会退化成"测 mount 副作用"。
 *
 * ⚠️ 键盘焦点环**不在本文件**，在 `src/focusable-ring-contract.test.js`（评审 i1，Critical）：
 *    本批把 6 张卡从"不可聚焦"变成 `tabindex="0"` 可聚焦，可 3.6 那把环锁 `focus-ring.test.js`
 *    的判定域按设计只收按钮类 ⇒ 两把锁之间有一条缝，键盘用户 Tab 到卡片上看不到焦点在哪。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSfc } from '@vue/compiler-sfc'

vi.mock('element-plus', () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
  ElDialog: { template: '<div class="el-dialog"><slot></slot></div>' },
}))

const pushSpy = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushSpy }),
}))

import CollectionView from './Collection.vue'
import i18n from '@/i18n'
import { PLATFORM_SOURCE_URLS } from '@multi-publish/shared-utils/src/platform-definitions'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(HERE, 'Collection.vue'), 'utf8')

/**
 * 判定域 = 逐张点名（i8）。每张卡给三件事：`testid`（渲染层定位）、`click` 表达式、
 * 以及**它自己的可观测出口**（behavior 用它断"键盘真的走到了下游"）。
 * 新增第 7 张卡必须在这里登记 —— 没登记时 `cardIds` 与 AST 扫描结果对不上，当场红。
 */
const CARDS = [
  { testid: 'quick-create-draft', click: 'createDraft', via: 'draft' },
  { testid: 'quick-clipboard-import', click: 'importFromClipboard', via: 'draftSave' },
  { testid: 'quick-drafts-box', click: "switchTab('drafts')", via: 'tab' },
  { testid: 'source-entry-weibo', click: "openCollection('weibo')", via: 'source', source: 'weibo' },
  { testid: 'source-entry-baidu', click: "openCollection('baidu')", via: 'source', source: 'baidu' },
  { testid: 'source-entry-toutiao', click: "openCollection('toutiao')", via: 'source', source: 'toutiao' },
]

/**
 * 模板 AST 里 class 含 `col-stat-card-click` 的开标签 → { tag, testid, attrs(静态), on(事件表达式) }。
 * `on` 的键是 `事件名:修饰符链`（如 `keydown:enter.prevent`），值是表达式串。
 */
export function scanCards (src) {
  const { descriptor, errors } = parseSfc(src, { filename: 'Collection.vue' })
  expect(errors.length, 'SFC 解析本身失败 ⇒ 判据无从测量：' + JSON.stringify(errors.map((e) => e.message))).toBe(0)
  const ast = descriptor.template && descriptor.template.ast
  expect(ast, '模板 AST 取不到（descriptor.template 为空）⇒ 判据失明，不得当作通过').toBeTruthy()
  const out = []
  const walk = (node) => {
    if (!node) return
    if (node.type === 1 && Array.isArray(node.props)) {
      const cls = node.props.find((p) => p.type === 6 && p.name === 'class')
      const clsText = cls && cls.value ? cls.value.content : ''
      if (clsText.split(/\s+/).includes('col-stat-card-click')) {
        const attrs = {}
        const on = {}
        for (const p of node.props) {
          if (p.type === 6) attrs[p.name] = p.value ? p.value.content : ''
          else if (p.type === 7 && p.name === 'on') {
            const mods = (p.modifiers || []).map((m) => m.content)
            const key = (p.arg && p.arg.content ? p.arg.content : '?') + (mods.length ? ':' + mods.join('.') : '')
            on[key] = p.exp ? p.exp.content : ''
          }
        }
        out.push({ tag: node.tag, testid: attrs['data-testid'] || '', attrs, on })
      }
    }
    for (const k of node.children || []) walk(k)
  }
  walk(ast)
  return out
}

function mountView () {
  return mount(CollectionView, { global: { plugins: [createPinia(), i18n] } })
}

/** 真实 IPC 边界：草稿落库 + 顶部标签页打开（与 Collection.test.js 同一套桩） */
function stubElectron (draftSave) {
  const createNewTabPage = vi.fn().mockResolvedValue({ code: 0, data: { tabId: 'tab-kb' } })
  window.electronAPI = {
    draftSave,
    draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
    storeGetSetting: vi.fn().mockResolvedValue('[]'),
    storeListSetting: vi.fn().mockResolvedValue('[]'),
    pageManager: { createNewTabPage },
  }
  return { createNewTabPage }
}

/**
 * 目的地归一化（i6 + 二轮 i2）：**所有形态必须过同一条规范化路径**，否则"归一化"本身是假的。
 * 第一版的毛病：字符串与 `{path,query}` 得到 `/publish?tab=drafts`（带前导斜杠），
 * 而 `{name,query}` 得到 `publish?tab=drafts`（不带）—— 于是实现一旦从 path 改成 name 跳转，
 * 锁会在"用户被带去哪"完全没变时假红；而把这种不对称固化进断言（第一版就是这么写的）
 * 等于把守卫的洞当契约钉住。正解：`name` 补上前导斜杠、query 键排序、值做 URL 编码。
 * 取不到的形态一律抛错（静默返回 '' 会把"断言没比上任何东西"读成通过）。
 */
export function normalizeTarget (arg) {
  let path = ''
  let query = null
  if (typeof arg === 'string') {
    const qi = arg.indexOf('?')
    path = qi < 0 ? arg : arg.slice(0, qi)
    query = qi < 0 ? {} : Object.fromEntries(new URLSearchParams(arg.slice(qi + 1)))
  } else if (arg && typeof arg === 'object') {
    if (arg.path) path = arg.path
    else if (arg.name) path = arg.name
    else throw new Error('路由入参既无 path 也无 name：' + JSON.stringify(arg))
    query = arg.query || {}
  } else {
    throw new Error('无法归一化路由入参形态：' + String(arg))
  }
  // 前导斜杠**只在这一处**补。写成 `path = '/' + arg.name` 再叠这一句是重复逻辑，
  // 重复逻辑的后果实测过：反证 M18「摘掉统一补斜杠」照样全绿（另一处把斜杠补回来了），
  // 于是那道变异根本没测到它声称测的东西 —— 判据的牙必须是单点的。
  if (!path.startsWith('/')) path = '/' + path
  const pairs = Object.keys(query).sort().map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k])))
  return path + (pairs.length ? '?' + pairs.join('&') : '')
}

describe('Collection.vue · 快捷卡片键盘可达（结构：模板 AST + 逐张点名）', () => {
  const cards = scanCards(SRC)

  it('判定域逐张点名：AST 扫到的卡片集合与登记清单**双向**相等（新增不登记即红）', () => {
    expect(cards.length, 'AST 一个卡片都没扫到 ⇒ 判据失明').toBeGreaterThan(0)
    const scanned = cards.map((c) => c.testid).sort()
    const expected = CARDS.map((c) => c.testid).sort()
    expect(scanned, 'AST 扫到的 testid 集合与登记清单不一致（新增卡片必须登记；漏 testid 会让行为锁定位不到）').toEqual(expected)
    for (const c of cards) expect(c.testid, '卡片缺 data-testid ⇒ 行为锁无法逐张定位').toBeTruthy()
  })

  it('每张卡四件套齐备，且 Enter / Space 表达式与 @click 逐字一致', () => {
    for (const want of CARDS) {
      const c = cards.find((x) => x.testid === want.testid)
      expect(c, '登记的卡片在模板里找不到：' + want.testid).toBeTruthy()
      expect(c.attrs.role, want.testid + ' 必须是 button 角色').toBe('button')
      expect(c.attrs.tabindex, want.testid + ' 必须可聚焦').toBe('0')
      const click = c.on.click
      expect(click, want.testid + ' 取不到 @click 表达式').toBe(want.click)
      expect(c.on['keydown:enter.prevent'], want.testid + ' 的 Enter 表达式必须与 @click 逐字一致：' + click).toBe(click)
      expect(c.on['keydown:space.prevent'], want.testid + ' 的 Space 表达式必须与 @click 逐字一致：' + click).toBe(click)
      // 反向：不得出现"少了 .prevent"的第三种写法（Space 会滚页 = 半个键盘可达）
      expect(c.on['keydown:enter'], want.testid + ' 不得再挂一条无 .prevent 的 enter').not.toBeDefined()
      expect(c.on['keydown:space'], want.testid + ' 不得再挂一条无 .prevent 的 space').not.toBeDefined()
    }
  })

  it('补了 role=button 的卡片不得有可聚焦后代（leaf 角色会把子树从 a11y 树上抹掉）', async () => {
    const w = mountView()
    await flushPromises()
    const dom = w.findAll('.col-stat-card-click')
    expect(dom.length, '渲染层卡片数与登记清单不一致').toBe(CARDS.length)
    for (const c of dom) {
      // 用 innerHTML 而不是 html()：html() 含卡片自己的 `tabindex="0"`，
      // 拿它做"不得有可聚焦后代"的判据会把**本次修法的正确形态**判成缺陷（第一版就踩了这条）。
      const inner = c.element.innerHTML
      // 只允许 svg / span / div 这类非交互后代；出现真控件即说明这个卡片不该拿 button 角色
      expect(inner, '可聚焦后代让 a11y 树失去该子树：' + inner.slice(0, 90)).not.toMatch(/<(button|a|input|select|textarea)\b/)
      expect(inner).not.toMatch(/tabindex="(?!-1)/)
    }
  })
})

describe('Collection.vue · 快捷卡片键盘可达（行为：六张全覆盖 + 恰一次）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: vi.fn().mockResolvedValue('剪贴板标题\n剪贴板正文') },
      writable: true, configurable: true,
    })
  })

  /**
   * 每张卡触发一次某事件，返回"它自己的下游"被调了几次。
   * 三条都必须走同一条断言（评审 i2）：`toHaveBeenLastCalledWith` 只看最后一次，
   * 真双重激活时参数相同 ⇒ 照样绿；所以这里返回计数，由调用方断 `=== 1`。
   */
  async function fireOnce (w, card, event) {
    const draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: 'd-kb' } })
    const { createNewTabPage } = stubElectron(draftSave)
    const el = w.find(`[data-testid="${card.testid}"]`)
    expect(el.exists(), '定位不到卡片：' + card.testid).toBe(true)
    pushSpy.mockClear()
    draftSave.mockClear()
    createNewTabPage.mockClear()
    await el.trigger(event)
    await flushPromises()
    if (card.via === 'source') {
      expect(createNewTabPage, card.testid + ' 的键盘事件没有走到打开来源标签页：' + event)
        .toHaveBeenCalledWith(expect.objectContaining({ url: PLATFORM_SOURCE_URLS[card.source], platform: card.source }))
      return createNewTabPage.mock.calls.length
    }
    if (card.via === 'draftSave') {
      // 空剪贴板会走"提示而不落库"的分支 ⇒ 这里夹具给的是有内容的文本
      expect(draftSave, card.testid + ' 的键盘事件没有走到草稿落库：' + event).toHaveBeenCalled()
      return draftSave.mock.calls.length
    }
    expect(pushSpy, card.testid + ' 的键盘事件没有走到路由跳转：' + event).toHaveBeenCalled()
    return pushSpy.mock.calls.length
  }

  it('六张卡片的 click / Enter / Space 各自都把用户带到同一个目的地，且**恰好一次**', async () => {
    const w = mountView()
    await flushPromises()
    const wantTarget = {
      'quick-create-draft': '/publish?draft=d-kb',
      'quick-drafts-box': '/publish?tab=drafts',
    }
    for (const card of CARDS) {
      const seen = []
      for (const event of ['click', 'keydown.enter', 'keydown.space']) {
        const calls = await fireOnce(w, card, event)
        // 恰一次。⚠ 如实口径（二轮 i8）：这条**不能**捕获"浏览器为 role=button 合成 click ⇒ 双重激活"，
        // 因为本锁跑在 JSDOM，而 JSDOM 与真 Chromium 一样都不为 div[role=button] 合成 click
        // —— 后者由 PRD §三-B 的真浏览器取证承保（静态夹具实测：Enter/Space 读数里都没有 click）。
        // 这条真正防的是**我们自己**把同一动作绑两遍（如 keydown 与 click 都接上且各自再调一次）。
        expect(calls, card.testid + ' 在 ' + event + ' 上触发了 ' + calls + ' 次，应为恰 1 次').toBe(1)
        if (wantTarget[card.testid]) seen.push(normalizeTarget(pushSpy.mock.calls[0][0]))
      }
      if (wantTarget[card.testid]) {
        expect(seen, card.testid + ' 三种事件的目的地不一致（键盘路径与鼠标路径分叉）').toEqual(
          [wantTarget[card.testid], wantTarget[card.testid], wantTarget[card.testid]])
      }
    }
  })

  it('负控：只有 @click 的 div，按 Enter 必须不产生任何调用（否则上面的用例在测 mount 副作用）', async () => {
    const handler = vi.fn()
    const w = mount({
      template: '<div class="only-click" @click="go">x</div>',
      methods: { go: handler },
    })
    await w.find('.only-click').trigger('keydown.enter')
    await w.find('.only-click').trigger('keydown.space')
    expect(handler, '负控本身失效 = 整套键盘断言都不成立').not.toHaveBeenCalled()
    await w.find('.only-click').trigger('click')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('归一化器自身：四种 push 写法必须得到同一个目的地（否则锁在钉实现形态）', () => {
    const want = '/publish?tab=drafts'
    expect(normalizeTarget('/publish?tab=drafts')).toBe(want)
    expect(normalizeTarget({ path: '/publish', query: { tab: 'drafts' } })).toBe(want)
    // 二轮 i2：name 形态过去少一个前导斜杠 ⇒ 同一条断言直接抓这条不对称
    expect(normalizeTarget({ name: 'publish', query: { tab: 'drafts' } }), 'name 与 path 形态必须同串').toBe(want)
    expect(normalizeTarget('/publish?b=2&a=1'), 'query 顺序不该影响归一化').toBe(normalizeTarget({ path: '/publish', query: { a: 1, b: 2 } }))
    // 值里带 & / = 时必须编码，否则两个不同目的地会归一成同一个串
    expect(normalizeTarget({ path: '/p', query: { q: 'a&b' } })).toBe('/p?q=a%26b')
    expect(normalizeTarget({ path: '/p', query: { q: 'a' , x: 'b' } })).not.toBe(normalizeTarget({ path: '/p', query: { q: 'a&x=b' } }))
    expect(() => normalizeTarget(42), '取不到的形态必须出声，不能静默返回空串').toThrow()
    expect(() => normalizeTarget({ query: { a: 1 } }), '既无 path 又无 name 必须出声').toThrow()
  })

  it('边界（二轮 i3 / 三轮 i5）：keydown 自动重复会再次触发 —— 代价在哪张卡上就钉哪张', async () => {
    // 这条不是"希望如此"的行为锁，而是**把已知代价钉在测试里**：将来若给卡片加 `event.repeat` 守卫，
    // 本条必须同步改成"repeat 不触发"，否则它就在保护一个已经不存在的形态（反向锁）。
    // 三轮 i5 的纠正：第一版**只测草稿箱卡**，而那张的重复代价是"重复 push 同一个 tab"—— 无害；
    // §三-B 写的真代价在**来源卡**（`createNewTabPage` 无幂等键 ⇒ 按住 Space 连开多个标签页）。
    // 只钉无害路径 = 声称"把已知代价钉在测试里"而实际钉住了另一张卡，故两张都要断。
    const w = mountView()
    await flushPromises()

    // ① 来源卡：连发两次 Enter ⇒ 真的开两个标签页（这才是要显形的那笔代价）
    const draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: 'd-kb' } })
    const { createNewTabPage } = stubElectron(draftSave)
    const srcCard = w.find('[data-testid="source-entry-weibo"]')
    expect(srcCard.exists(), '来源卡不见了，边界锁无从触发').toBe(true)
    createNewTabPage.mockClear()
    await srcCard.trigger('keydown.enter')
    await srcCard.trigger('keydown.enter', { repeat: true })
    await flushPromises()
    expect(createNewTabPage, '来源卡连发两次 Enter 当前会开出两个标签页 —— 这是 PRD §三-B 记的代价；'
      + '若加 repeat 守卫，本条必须同时改成"恰 1 次"').toHaveBeenCalledTimes(2)

    // ② 草稿箱卡（二轮原样保留）：连发两次 Enter ⇒ 两次 push
    pushSpy.mockClear()
    const box = w.find('[data-testid="quick-drafts-box"]')
    await box.trigger('keydown.enter')
    await box.trigger('keydown.enter', { repeat: true })
    expect(pushSpy, '按住 Enter 会连发 keydown ⇒ 这里断的是"当前确实每次都触发"；加 repeat 守卫时同步改这条').toHaveBeenCalledTimes(2)
  })
})
