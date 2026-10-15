/**
 * article-body-format 双形态 parity 回归（CJS ↔ ESM 孪生）+ 与发布链同判据锁
 *
 * 锁三件：
 *   ① **逐行同源** —— 剥离「模块包装」与头注释后，`.browser.js` 与 `.js` 必须逐行相同
 *      （比「若干行为向量相等」强：向量只覆盖想得到的分支）。
 *   ② **导出面相同** —— 缺一个导出会让渲染端在运行时才炸（具名导出错误），
 *      而 `vite build` / `vitest` 都可能是绿的（见 scripts/check-renderer-cjs-boundary 头注释）。
 *   ③ **与发布链同判据** —— 渲染端装载编辑器用的 `toHtmlBody` 必须与
 *      `api-publish-engine/src/content-formatter.js` 的 HTML 分支 `formatArticleBody(<html 平台>, x)`
 *      对同一输入给出**逐字节相同**结果。两包不能互相 require（引擎是零 workspace 依赖运行时），
 *      所以这条 parity 是本仓「各存一份」形态的安全网。
 *
 * 动因（2026-10-15 百家号二次报障）：编辑器把纯文本当 HTML 装载 ⇒ 段落塌成一段 ⇒
 * 发布链看到「已是 HTML」幂等透传 ⇒ 平台只收到一个 `<p>`。修法是装载前经 `toHtmlBody`。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')
const CJS_PATH = path.join(SRC, 'article-body-format.js')
const ESM_PATH = path.join(SRC, 'article-body-format.browser.js')
const ENGINE_FORMATTER = path.resolve(SRC, '..', '..', 'api-publish-engine', 'src', 'content-formatter.js')

const engine = require(ENGINE_FORMATTER)
const cjs = require(CJS_PATH)

/** 剥掉头注释（开头到第一个非注释、非空行之前的全部注释块） */
function stripHeaderComment (src) {
  const lines = src.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const l = lines[i].trim()
    if (l === '') { i++; continue }
    if (l.startsWith('/*')) {
      while (i < lines.length && !lines[i].includes('*/')) i++
      i++
      continue
    }
    if (l.startsWith('//')) { i++; continue }
    break
  }
  return lines.slice(i)
}

/** 剥掉模块包装：'use strict' / module.exports 块 / export 块 */
function stripModuleWrapper (lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const t = lines[i].trim()
    if (t === "'use strict'" || t === '"use strict"') { i++; continue }
    if (t === 'module.exports = {') {
      while (i < lines.length && lines[i].trim() !== '}') i++
      i++
      continue
    }
    if (t === 'export {') {
      while (i < lines.length && lines[i].trim() !== '}') i++
      i++
      continue
    }
    out.push(lines[i])
    i++
  }
  while (out.length > 0 && out[0].trim() === '') out.shift()
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return out
}

function normalized (p) {
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)
  // 先摘掉可能出现在头注释**之前**的包装行（CJS 的第 1 行是 'use strict'），
  // 否则 stripHeaderComment 会在第一行就 break，把整个头注释当成正文。
  let i = 0
  while (i < lines.length) {
    const t = lines[i].trim()
    if (t === '' || t === "'use strict'" || t === '"use strict"') { i++; continue }
    break
  }
  return stripModuleWrapper(stripHeaderComment(lines.slice(i).join('\n')))
}

describe('① 逐行同源（CJS ↔ ESM 孪生）', () => {
  it('剥离包装后两文件逐行相同', () => {
    const a = normalized(CJS_PATH)
    const b = normalized(ESM_PATH)
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) {
      expect(
        b[i],
        `第 ${i + 1} 行起漂移（行号按剥离包装后计）：\n  CJS: ${JSON.stringify(a[i])}\n  ESM: ${JSON.stringify(b[i])}`
      ).toBe(a[i])
    }
    expect(b.length).toBe(a.length)
  })

  it('规模下界（防「解析退化成空集合」假绿）', () => {
    expect(normalized(ESM_PATH).length).toBeGreaterThan(25)
  })
})

describe('② 导出面相同', () => {
  it('ESM 具名导出集合 == CJS module.exports 键集合', async () => {
    const esm = await import(ESM_PATH)
    expect(Object.keys(esm).filter((k) => k !== 'default').sort()).toEqual(Object.keys(cjs).sort())
    expect(Object.keys(cjs).length).toBeGreaterThanOrEqual(5)
  })

  it('HTML_TAG_PATTERN 常量两侧取值相等', async () => {
    const esm = await import(ESM_PATH)
    expect(esm.HTML_TAG_PATTERN).toBe(cjs.HTML_TAG_PATTERN)
  })
})

describe('③ 与发布链 HTML 分支同判据（逐字节相等）', () => {
  const HTML_PLATFORMS = ['baijiahao', 'toutiao', 'wechat_mp']
  const vectors = [
    // ★ 本次事故：源文 6 段（\n\n 分段）⇒ 必须成 6 个 <p>，而不是 1 个
    ['第一段\n\n第二段', '<p>第一段</p><p>第二段</p>'],
    ['a\nb\nc', '<p>a</p><p>b</p><p>c</p>'],
    ['a\r\n\r\nb', '<p>a</p><p>b</p>'],
    ['  前后空白  \n\n\n', '<p>前后空白</p>'],
    ['', ''],
    ['   ', ''],
    [null, ''],
    [undefined, ''],
    // 已是 HTML：幂等透传（不二次包装）
    ['<p>x</p><p>y</p>', '<p>x</p><p>y</p>'],
    ['<p>a<br>b</p>', '<p>a<br>b</p>'],
    // 转义先行：正文里的裸尖括号不会被当成标签
    ['a < b && c > d', '<p>a &lt; b &amp;&amp; c &gt; d</p>'],
    // 代码片段不是标签（宽判据会吃掉它，白名单判据保留）
    ['#include <stdio.h>\nvector<int> v', '<p>#include &lt;stdio.h&gt;</p><p>vector&lt;int&gt; v</p>'],
  ]

  it('每条向量：孪生输出 == 引擎 formatArticleBody（三个 HTML 承载平台）', () => {
    for (const [input, expected] of vectors) {
      expect(cjs.toHtmlBody(input), `toHtmlBody(${JSON.stringify(input)})`).toBe(expected)
      for (const platform of HTML_PLATFORMS) {
        expect(
          engine.formatArticleBody(platform, input),
          `formatArticleBody('${platform}', ${JSON.stringify(input)})`
        ).toBe(expected)
      }
    }
  })

  it('hasHtmlTags 与引擎同判据（含反向向量）', () => {
    const cases = ['<p>x</p>', '<div>y</div>', 'plain text', 'a < b', '#include <stdio.h>', '&lt;p&gt;', 'vector<int>', '<p>x</p>']
    for (const c of cases) {
      expect(cjs.hasHtmlTags(c), `hasHtmlTags(${JSON.stringify(c)})`).toBe(engine.hasHtmlTags(c))
    }
  })

  it('textToParagraphHtml 与引擎逐字节相同', () => {
    for (const [input] of vectors) {
      expect(cjs.textToParagraphHtml(input)).toBe(engine.textToParagraphHtml(input))
    }
  })
})

describe('④ 事故形态反证：单段输出必须被判红', () => {
  it('6 段源文不得产出单个 <p>（旧缺陷形态）', () => {
    const source = ['一', '二', '三', '四', '五', '六'].join('\n\n')
    const out = cjs.toHtmlBody(source)
    expect((out.match(/<p>/g) || []).length).toBe(6)
    expect(out).not.toBe('<p>' + source.replace(/\n/g, '') + '</p>')
    // 段间不得残留裸换行（HTML 承载平台上换行会被吞，正是本事故的形态）
    expect(out.includes('\n')).toBe(false)
  })

  it('幂等：再次归一不产生二次包装', () => {
    const once = cjs.toHtmlBody('甲\n\n乙')
    expect(cjs.toHtmlBody(once)).toBe(once)
  })
})
