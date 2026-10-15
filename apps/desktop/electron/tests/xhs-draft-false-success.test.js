// 2026-10-07 真机 E2E 暴露的假成功回归保护。
//
// 现场：publishBatch([{platform:'xiaohongshu'}]) 返回 taskId，history 记
// status=success、mode=dom，但应用日志里标题/正文/标签三项全是 WARN
// （title field not found / content editor not found / tag input not found），
// 页面什么都没写进去。根因：draftOnly 分支无条件 `return {success:true}`。
//
// 本文件锁三条不变量：
//   ① 内容没写进去 ⇒ 必须 success:false（绝不报成功）
//   ② 内容写进去了 ⇒ 才允许走落库判定并返回 draft 成功
//   ③ draftSaved 的判定不再接受孤立的「草稿」二字（页面常驻文案，恒真）

import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'

const MODULE = '../services/rpa-view-platforms'

// rpa-view-platforms.js 导出的是 mixin 集合（Object.assign(platformsMixin, ...)），
// `_publish_generic` 是挂在宿主类原型上的方法。测试直接把该方法挂到一个
// 桩实例上调用：这样测的是生产函数体本身，不经过导航/开窗等无关副作用。
async function loadPublishGeneric () {
  const mod = await import(MODULE)
  const mixin = mod.default || mod
  const fn = mixin._publish_generic
  if (typeof fn !== 'function') throw new Error('未能从 ' + MODULE + ' 取得 _publish_generic')
  return fn
}

/** 构造一个最小可用实例：只桩掉 draftOnly 判定会碰到的成员 */
function makeInstance (overrides = {}) {
  const calls = { waits: [], sleeps: [] }
  const inst = {
    _emitProgress: vi.fn(),
    _sleep: async (ms) => { calls.sleeps.push(ms) },
    _resolveSelector: vi.fn(async () => null),
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
    _navigateAndWait: vi.fn(async () => {}),
    _waitForNavigation: vi.fn(async () => {}),
    // 导航后弹窗关闭：生产实现在 _publish_generic 里于 draftOnly 分支之前调用，
    // 缺这个桩会让 6 例在抵达被测逻辑前就 TypeError（首轮 7/7 全红的唯一原因）。
    _dismissPostNavDialogs: vi.fn(async () => {}),
    // 2026-10-15 硬证据确认链：草稿箱计数三件套。本文件的用例只关心「内容填写」
    // 这一层，所以给「读到计数且随后增长」的默认桩，让流程能走到返回处；
    // 计数判据本身由 xhs-draft-only-hard-evidence.test.js 专锁（那边驱动真实方法，
    // 不抄生产逻辑——见该文件顶部修订说明）。
    _readDraftBoxCounter: vi.fn(async () => 1),
    _waitForDraftBoxIncrement: vi.fn(async () => true),
    _recheckDraftBox: vi.fn(async () => ({ increment: false, titleSeen: false })),
    ...overrides,
  }
  inst.__calls = calls
  inst._win = {
    webContents: {
      getURL: () => 'https://creator.xiaohongshu.com/publish/publish?target=image',
      // 生产代码在返回失败时会先判 isDestroyed（窗口可能已关）：桩缺这个成员会让
      // 用例在抵达断言前 TypeError（真实 WebContents 恒有该方法，故桩必须补齐）。
      isDestroyed: () => false,
      executeJavaScript: async () => undefined,
    },
  }
  return inst
}

function article (over = {}) {
  return { title: 'E2E 草稿箱验证', content: '正文内容', tags: ['E2E'], ...over }
}

/** 直接驱动 _publish_generic 到 draftOnly 分支，避免整条导航链路 */
async function runDraftOnly (inst, art, config = {}) {
  const cfg = {
    publish_url: 'https://creator.xiaohongshu.com/publish/publish',
    draftOnly: true,
    selectors: {
      title_input: [],
      editor: [],
      content_textarea: [],
      tag_input: [],
      draft_btn: [],
      publish_btn: [],
      ...(config.selectors || {}),
    },
    ...config,
  }
  const publishGeneric = await loadPublishGeneric()
  return publishGeneric.call(inst, inst._win, art, 'xiaohongshu', cfg)
}

describe('draftOnly 假成功修复（2026-10-07）', () => {
  it('标题选择器全部失配 ⇒ 必须 success:false（不得报成功）', async () => {
    const inst = makeInstance({ _resolveSelector: vi.fn(async () => null) })
    const res = await runDraftOnly(inst, article(), {
      selectors: { title_input: ['#never-matches'], editor: ['#also-never'] },
    })
    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('PUBLISH_DRAFT_CONTENT_NOT_FILLED')
    expect(String(res.error)).toMatch(/草稿内容未写入页面/)
  })

  it('正文编辑器未找到 ⇒ 必须 success:false', async () => {
    const inst = makeInstance({ _resolveSelector: vi.fn(async () => null) })
    const res = await runDraftOnly(inst, article(), {
      selectors: { title_input: ['#t'], editor: ['#e'], content_textarea: [] },
    })
    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('PUBLISH_DRAFT_CONTENT_NOT_FILLED')
  })

  it('填入抛错（重试耗尽）⇒ 必须 success:false', async () => {
    const inst = makeInstance({
      _resolveSelector: vi.fn(async () => '#e'),
      _fillInput: vi.fn(async () => { throw new Error('readback empty') }),
    })
    const res = await runDraftOnly(inst, article(), {
      selectors: { title_input: ['#t'], editor: ['#e'] },
    })
    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('PUBLISH_DRAFT_CONTENT_NOT_FILLED')
    expect(String(res.error)).toMatch(/readback empty/)
  })

  it('标题正文都写成功 ⇒ 允许返回 draft 成功（不得把真成功也打成失败）', async () => {
    const inst = makeInstance({
      _resolveSelector: vi.fn(async () => '#e'),
      _fillInput: vi.fn(async () => {}),
    })
    const res = await runDraftOnly(inst, article(), {
      selectors: { title_input: ['#t'], editor: ['#e'] },
    })
    expect(res.success).toBe(true)
    expect(res.draft).toBe(true)
    expect(res.fillReport).toBeTruthy()
    expect(res.fillReport.title.ok).toBe(true)
    expect(res.fillReport.content.ok).toBe(true)
  })

  it('只有标签失配 ⇒ 降级放行（标签是增强项，不阻断）', async () => {
    // 标题与正文必须成功，只有标签选择器失配 —— 否则测的就不是「只标签失败」了
    // （首轮桩写成「标签选择器数组非空但 resolve 返回 null」，结果正文也 resolve
    //  不到，于是走的是「正文未写入」分支，断言在错误的语义上失败）。
    // 源码 rpa-view-platforms.js:382 的调用是
    //   this._resolveSelector(win, sel.tag_input, 5000, 2000)
    // 第二参是**数组** `['#tag-never']`。首轮桩写成字符串比较（sels === '#tag-never'）
    // 恒假 ⇒ 返回 '#ok' ⇒ tagsOk=1 ⇒ fillReport.tags.ok 为 true，
    // 断言在错误的语义上失败。这里按数组语义匹配。
    const inst = makeInstance({
      _resolveSelector: vi.fn(async (win, sels) =>
        (Array.isArray(sels) && sels.includes('#tag-never')) ? null : '#ok'),
      _fillInput: vi.fn(async () => {}),
    })
    const res = await runDraftOnly(inst, article(), {
      selectors: { title_input: ['#t'], editor: ['#e'], tag_input: ['#tag-never'] },
    })
    expect(res.success).toBe(true)
    expect(res.fillReport.tags.ok).toBe(false)
    expect(res.fillReport.title.ok).toBe(true)
    expect(res.fillReport.content.ok).toBe(true)
  })

  it('文章没有正文 ⇒ 不因正文缺失判失败（只判实际尝试过的字段）', async () => {
    const inst = makeInstance({
      _resolveSelector: vi.fn(async () => '#t'),
      _fillInput: vi.fn(async () => {}),
    })
    const res = await runDraftOnly(inst, article({ content: '' }), {
      selectors: { title_input: ['#t'], editor: ['#e'] },
    })
    expect(res.success).toBe(true)
  })

  it('draftSaved 判定已换成硬证据（不再是页面文本正则）', async () => {
    // 2026-10-15 真机实测证伪了「页面文本正则」这条路：
    // 应用报「发布成功」但草稿箱无新增——旧正则 3 秒即命中页面静态文案，
    // 同一时刻页面控制台正在连报「获取某个数据失败 / 请求失败」。
    // 本断言从「锁旧正则形状」改为「锁新判据已接线」：draftOnly 分支必须
    // 读草稿箱计数、等计数增量，并把三条硬证据通道接齐。
    // 计数判据的行为细节由 xhs-draft-only-hard-evidence.test.js 专锁。
    const fs = await import('node:fs')
    const file = path.resolve(process.cwd(), 'electron/services/rpa-view-platforms.js')
    const src = fs.readFileSync(file, 'utf-8')

    // 旧判据的页面文本正则必须已不在 draftOnly 分支里。
    // 注意：块内**注释**会提到旧判据的名字（解释为什么弃用它），所以不能简单
    // 搜「已保存」字样；要搜的是「把它当判据用」的代码形态——innerText 匹配
    // 与 _waitForCondition 驱动 saved。
    // 切片按**分支边界**取，不按「标记 + 固定字符数」取：固定长度切片会在注释一改
    // 就静默切歪（切少了会漏检，切多了会把相邻分支的 innerText 也算进来）——
    // CCG 深度评审 i7 点的就是这个脆弱锚点。
    const start = src.indexOf('if (config.draftOnly) {')
    const end = src.indexOf('if (sel.publish_btn && sel.publish_btn.length>0) {', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const draftBlock = src.slice(start, end)
    expect(draftBlock).toBeTruthy()
    // 只看代码行、不看注释：块内注释会解释旧判据被弃用的原因，必然提到它读的属性名，
    // 对整块文本做 not.toMatch 等于「锁注释不锁代码」（CCG 深度评审 i7）。
    const codeOnly = draftBlock.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(codeOnly).not.toMatch(/innerText/)
    expect(codeOnly).not.toMatch(/_waitForCondition\s*\(/)

    // 新判据的确认链必须在场。注意 `_readDraftBoxCounter`（读基线）**不在**这个分支内：
    // 基线已按评审 i5 前移到「写入内容之前」读，分支里用的是那份读好的 baseline。
    expect(draftBlock).toContain('_waitForDraftBoxIncrement')
    expect(draftBlock).toContain('_recheckDraftBox')
    expect(draftBlock).toContain('_waitForResponse')
    expect(draftBlock).toContain('baseline')
    // fail-closed：三条都不可达必须报失败，而不是返回 success:true
    expect(draftBlock).toContain('PUBLISH_DRAFT_UNCONFIRMED')
    // 基线确实被读过（只是发生在这个分支之外）
    expect(src).toContain('xhsDraftBaseline = await this._readDraftBoxCounter')
  })
})

// 2026-10-10 硬约束收紧：小红书**任何形态都不得真实发布**。
// 图文轨早已 draftOnly（上一条 describe）；视频轨此前仍走「点发布」链路，与约束冲突 ⇒ fail-closed。
// 这两条锁的是**约束的落点本身**：把 draftOnly 摘掉、或把视频放回发布链路，都会立刻变红。
describe('小红书硬约束落点（2026-10-10）：图文 draftOnly / 视频 fail-closed', () => {
  async function loadXhsPublish () {
    const mod = await import(MODULE)
    const mixin = mod.default || mod
    const fn = mixin._publish_xiaohongshu
    if (typeof fn !== 'function') throw new Error('未能从 ' + MODULE + ' 取得 _publish_xiaohongshu')
    return fn
  }

  it('图文：强制 draftOnly=true 且切图文 tab 交给 generic（绝不点发布）', async () => {
    const seen = []
    const inst = makeInstance({
      _getPlatformConfig: vi.fn(() => ({
        publish_url: 'https://creator.xiaohongshu.com/publish/publish',
        selectors: {},
      })),
      _publish_generic: vi.fn(async (win, art, platform, cfg) => {
        seen.push({ platform, cfg })
        return { success: true, draft: true }
      }),
    })
    const res = await (await loadXhsPublish()).call(inst, inst._win, article({ images: ['D:/Temp/xhs-covers/cover-1.png'] }))

    expect(res.success).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0].platform).toBe('xiaohongshu')
    // 硬约束的机械判据：draftOnly 必须在，且没有任何路径能把它置回 false
    expect(seen[0].cfg.draftOnly).toBe(true)
    expect(seen[0].cfg.preFill).toBe('switchImageTab')
  })

  it('视频：fail-closed 拒绝执行，绝不进 generic（不得真实发布）', async () => {
    const inst = makeInstance({
      _getPlatformConfig: vi.fn(() => ({ publish_url: 'https://creator.xiaohongshu.com/publish/publish' })),
      _publish_generic: vi.fn(async () => ({ success: true })),
    })
    const res = await (await loadXhsPublish()).call(inst, inst._win, article({ video_path: 'D:/Temp/x.mp4' }))

    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('XHS_VIDEO_DRAFT_UNSUPPORTED')
    expect(String(res.error)).toMatch(/小红书仅允许保存到平台草稿箱/)
    expect(inst._publish_generic).not.toHaveBeenCalled()
  })
})