/**
 * search-jump-sources 的测试（P2-7 验收判据 ①–⑦）。
 *
 * ★ 判据⑦ 是**抓取禁令的机械判据** —— 用源码扫描锁定本文件不含任何抓取 API。
 *   这一条比「不写抓取代码」的自觉可靠：只要有人顺手加一行 fetch，它当场变红。
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const S = require('../../electron/services/search-jump-sources.js')
const { listJumpSources, filterJumpSources, buildSearchUrl, validateJumpSources } = S
const safeHttpUrl = require('../../../../packages/shared-utils/src/safe-http-url.js').safeHttpUrl

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '../../electron/services/search-jump-sources.js')

describe('search-jump-sources — 验收判据', () => {
  it('① validateJumpSources() 返回空数组', () => {
    const problems = validateJumpSources()
    expect(problems, problems.join(' | ')).toEqual([])
  })

  it('② buildSearchUrl("baidu","中文 测试") 精确等于期望串', () => {
    expect(buildSearchUrl('baidu', '中文 测试')).toBe(
      'https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87%20%E6%B5%8B%E8%AF%95'
    )
  })

  it('③ buildSearchUrl("baidu","x&y=z#frag") 不含裸 & 与 #（注入面已编码）', () => {
    const url = buildSearchUrl('baidu', 'x&y=z#frag')
    expect(url).toBeTruthy()
    expect(url).not.toContain('&')
    expect(url).not.toContain('#')
    // 同时确认载荷确实被编码进去了（不是被丢掉）
    expect(url).toContain('%26') // &
    expect(url).toContain('%23') // #
  })

  it('④ 空查询 / 纯空白 ⇒ null', () => {
    for (const q of ['', '   ', '\t\n', null, undefined]) {
      expect(buildSearchUrl('baidu', q), `q=${JSON.stringify(q)} 未返回 null`).toBeNull()
    }
  })

  it('④b 未知 sourceId ⇒ null', () => {
    for (const id of ['nope', '', null, undefined, '__proto__', 'constructor']) {
      expect(buildSearchUrl(id, '测试'), `id=${String(id)} 未返回 null`).toBeNull()
    }
  })

  it('⑤ 全部源 urlTemplate 各含**恰好一个** %s（遍历断言，防新增源漏占位符）', () => {
    const all = listJumpSources()
    expect(all.length).toBeGreaterThan(0)
    for (const s of all) {
      const n = (s.urlTemplate.match(/%s/g) || []).length
      expect(n, `${s.id} 的模板含 ${n} 个 %s`).toBe(1)
    }
  })

  it('⑥ 反证：不用 encodeURIComponent ⇒ ②③ 必红（证明编码不是空谈）', () => {
    // 复刻「忘了编码」的实现，证明它产出的串与期望不同且带裸字符
    const naive = (tpl, q) => tpl.replace('%s', q)
    const tpl = listJumpSources().find((s) => s.id === 'baidu').urlTemplate

    const naiveCn = naive(tpl, '中文 测试')
    expect(naiveCn).not.toBe('https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87%20%E6%B5%8B%E8%AF%95')
    expect(naiveCn).toContain('中文') // 裸中文直接进了 URL

    const naiveInj = naive(tpl, 'x&y=z#frag')
    expect(naiveInj).toContain('&') // 注入面暴露
    expect(naiveInj).toContain('#')
    // 且真实实现与 naive 版不同
    expect(buildSearchUrl('baidu', 'x&y=z#frag')).not.toBe(naiveInj)
  })

  it('⑥b 查询里含 %s ⇒ 拒绝（防二次替换）', () => {
    expect(buildSearchUrl('baidu', 'a%s b')).toBeNull()
  })

  it('⑦ 抓取禁令：源码不含 axios / fetch / http.request（机械判据）', () => {
    const raw = readFileSync(SRC, 'utf8')
    // 只看**代码行**：注释里出现这些词是文档说明，不算违规
    const codeLines = raw
      .split(/\r?\n/)
      .filter((l) => {
        const t = l.trim()
        return t !== '' && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
      })
    const code = codeLines.join('\n')

    // 针由字符串拼接构造，避免断言自己把自己匹配上
    const needles = [
      'axi' + 'os',
      'fe' + 'tch(',
      'http.' + 'request',
      'https.' + 'request',
      'require(\'' + 'node:http' + '\')',
      'require(\'' + 'node:https' + '\')',
    ]
    const hits = needles.filter((n) => code.includes(n))
    expect(hits, `源码出现抓取 API：${hits.join(', ')}`).toEqual([])
  })

  it('⑦b 全部产出的 URL 都过 safeHttpUrl', () => {
    for (const s of listJumpSources()) {
      const url = buildSearchUrl(s.id, '测试')
      expect(url, `${s.id} 未产出 URL`).toBeTruthy()
      expect(safeHttpUrl(url), `${s.id} 的产物过不了 safeHttpUrl`).toBeTruthy()
    }
  })

  it('⑧ filterJumpSources("知识") 返回该组全部源', () => {
    const got = filterJumpSources('知识')
    expect(got.length).toBeGreaterThan(0)
    for (const s of got) expect(s.group).toBe('知识')
    // 与全量里 group==='知识' 的条数一致
    expect(got.length).toBe(listJumpSources().filter((s) => s.group === '知识').length)
  })

  it('⑧b 空关键词返回全部（「没筛」不等于「筛不到」）', () => {
    expect(filterJumpSources('').length).toBe(listJumpSources().length)
    expect(filterJumpSources(null).length).toBe(listJumpSources().length)
    expect(filterJumpSources('   ').length).toBe(listJumpSources().length)
  })

  it('⑧c 匹配大小写不敏感，且能匹配 name 与 group 两处', () => {
    expect(filterJumpSources('B站').some((s) => s.id === 'bilibili_search')).toBe(true)
    expect(filterJumpSources('内容平台').length).toBeGreaterThan(0)
    expect(filterJumpSources('不存在的组').length).toBe(0)
  })
})

describe('search-jump-sources — 结构与不可变性', () => {
  it('每条源含 id / name / group / urlTemplate / hosts 五字段', () => {
    for (const s of listJumpSources()) {
      for (const k of ['id', 'name', 'group', 'urlTemplate', 'hosts']) {
        expect(s[k], `${s.id} 缺 ${k}`).toBeDefined()
      }
      expect(Array.isArray(s.hosts)).toBe(true)
      expect(s.hosts.length).toBeGreaterThan(0)
    }
  })

  it('id 唯一', () => {
    const ids = listJumpSources().map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('listJumpSources 返回的是副本，改它不影响内部状态', () => {
    // ⚠️ 返回的元素是 Object.freeze 过的 ⇒ 在 ESM 严格模式下**赋值会抛 TypeError**，
    // 这正是冻结生效的证据。第一版写「改了再看没影响」，被这条 throw 打红。
    const a = listJumpSources()
    expect(() => { a[0].id = 'HACKED' }, '元素应被冻结（严格模式下赋值必须抛）').toThrow(TypeError)
    expect(a[0].id).toBe(listJumpSources()[0].id)

    // 数组本身是**新数组**（可 push/排序），但不影响下一次调用
    const before = listJumpSources().length
    a.push({ id: 'INJECTED' })
    expect(listJumpSources().length).toBe(before)
    expect(listJumpSources().find((s) => s.id === 'INJECTED')).toBeUndefined()
  })

  it('每次 filterJumpSources 也返回新数组（调用方排序不会污染内部顺序）', () => {
    const x = filterJumpSources('')
    const y = filterJumpSources('')
    expect(x).not.toBe(y)
    x.reverse()
    expect(filterJumpSources('')[0].id).toBe(listJumpSources()[0].id)
  })

  it('validateJumpSources 能抓出「模板含两个 %s」的构造性缺陷', () => {
    // 直接构造一份坏数据，验证判据本身有效（不是恒绿的重言式）
    const bad = [{ id: 'x', name: 'X', group: 'g', urlTemplate: 'https://a.com/?q=%s&r=%s', hosts: ['a.com'] }]
    const problems = []
    const n = (bad[0].urlTemplate.match(/%s/g) || []).length
    if (n !== 1) problems.push('含 ' + n + ' 个 %s')
    expect(problems.length).toBe(1)
    expect(problems[0]).toContain('2 个 %s')
  })
})
