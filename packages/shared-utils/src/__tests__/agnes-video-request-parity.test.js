/**
 * agnes-video-request 双形态 parity 回归（CJS ↔ ESM 孪生）
 *
 * 锁两件：
 *   ① **逐行同源** —— 剥离「模块包装」与头注释后，`.browser.js` 与 `.js`
 *      必须**逐行相同**。这比「若干行为向量相等」强得多：向量只能覆盖想得到的
 *      分支，逐行比对覆盖全部（含想不到的）。
 *   ② **导出面相同** —— 缺一个导出会让渲染端在运行时才炸（具名导出错误），
 *      而 `vite build` / `vitest` 都是绿的（见 check-renderer-cjs-boundary 头注释）。
 *
 * 动因：2026-10-23 渲染层 `QuickRenderPanel.vue` 直接 import
 * `@multi-publish/shared-utils/src/agnes-video-request`（CJS）跨了边界，
 * vite dev server 抛「does not provide an export named 'AGNES_VIDEO_REQUEST_ERRORS'」
 * → **整个 /create 页面挂载失败**（Browser E2E：/create 18 项全红、流水线卡片
 * count=0；报错形态与「视频能力缺失」毫无关联，排查成本高）。
 * 修法是本仓既有形态：建 ESM 孪生 + vite alias + 本 parity 回归。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')
const CJS_PATH = path.join(SRC, 'agnes-video-request.js')
const ESM_PATH = path.join(SRC, 'agnes-video-request.browser.js')

/** 剥掉头注释（开头到第一个非注释、非空行之前的全部注释块） */
function stripHeaderComment (src) {
  const lines = src.split(/\r?\n/)
  let i = 0
  // 跳过头部的块注释（可能不止一段）与空行
  while (i < lines.length) {
    const l = lines[i].trim()
    if (l === '') { i++; continue }
    if (l.startsWith('/*')) {
      // 找到该块注释结束
      while (i < lines.length && !lines[i].includes('*/')) i++
      i++ // 跳过含 */ 的那行
      continue
    }
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
  // 剥掉「包装行」留下的前导/尾部空行 —— CJS 有 'use strict' 后跟一空行，
  // ESM 没有这行，故两侧空行数天然不同；那是包装的一部分，不是逻辑漂移。
  while (out.length > 0 && out[0].trim() === '') out.shift()
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  return out
}

function normalized (p) {
  return stripModuleWrapper(stripHeaderComment(fs.readFileSync(p, 'utf8')))
}

describe('① 逐行同源（CJS ↔ ESM 孪生）', () => {
  it('剥离包装后两文件逐行相同', () => {
    const cjs = normalized(CJS_PATH)
    const esm = normalized(ESM_PATH)
    // 先给一个有用的失败信息：指出第一处不同的行号
    const n = Math.max(cjs.length, esm.length)
    for (let i = 0; i < n; i++) {
      expect(
        esm[i],
        `第 ${i + 1} 行起漂移（行号按剥离包装后计）：\n  CJS: ${JSON.stringify(cjs[i])}\n  ESM: ${JSON.stringify(esm[i])}`
      ).toBe(cjs[i])
    }
    expect(esm.length).toBe(cjs.length)
  })

  it('规模下界（防「解析退化成空集合」假绿）', () => {
    // 若上面的剥离逻辑坏掉（例如把整个文件当注释吃掉），逐行比对会退化成「空 vs 空」而假绿。
    expect(normalized(ESM_PATH).length).toBeGreaterThan(100)
  })
})

describe('② 导出面相同', () => {
  it('ESM 孪生的具名导出集合与 CJS 的 module.exports 键集合相等', async () => {
    const cjs = require(CJS_PATH)
    const esm = await import(ESM_PATH)
    const cjsKeys = Object.keys(cjs).sort()
    const esmKeys = Object.keys(esm).filter((k) => k !== 'default').sort()
    expect(esmKeys).toEqual(cjsKeys)
    expect(cjsKeys.length).toBeGreaterThan(3)
  })

  it('常量取值相等（模式表与错误码表）', async () => {
    const cjs = require(CJS_PATH)
    const esm = await import(ESM_PATH)
    expect(esm.AGNES_VIDEO_MODES).toEqual(cjs.AGNES_VIDEO_MODES)
    expect(esm.AGNES_VIDEO_REQUEST_ERRORS).toEqual(cjs.AGNES_VIDEO_REQUEST_ERRORS)
  })
})

describe('③ 行为向量（包装差异不影响结果）', () => {
  const vectors = [
    [{}, { ok: true, mode: 'text' }],
    [{ mode: 'text', images: ['a'] }, { ok: false, code: 'text-disallows-media', mode: 'text' }],
    [{ mode: 'text', firstFrame: 'f' }, { ok: false, code: 'text-disallows-media', mode: 'text' }],
    [{ mode: 'keyframe' }, { ok: false, code: 'keyframe-requires-frame', mode: 'keyframe' }],
    [{ mode: 'keyframe', firstFrame: 'f' }, { ok: true, mode: 'keyframe' }],
    [{ mode: 'keyframe', lastFrame: 'f' }, { ok: true, mode: 'keyframe' }],
    [{ mode: 'keyframe', firstFrame: 'f', images: ['a'] }, { ok: false, code: 'keyframe-disallows-reference', mode: 'keyframe' }],
    [{ mode: 'reference' }, { ok: false, code: 'reference-requires-media', mode: 'reference' }],
    [{ mode: 'reference', images: ['a'] }, { ok: true, mode: 'reference' }],
    [{ mode: 'reference', audios: ['a'] }, { ok: true, mode: 'reference' }],
    [{ mode: 'reference', videos: ['a'] }, { ok: true, mode: 'reference' }],
    [{ mode: 'reference', images: ['a'], firstFrame: 'f' }, { ok: false, code: 'reference-disallows-frames', mode: 'reference' }],
    [{ mode: 'bogus' }, { ok: false, code: 'mode-unsupported', mode: 'bogus' }],
    [{ firstFrame: 'f' }, { ok: true, mode: 'keyframe' }],
    [{ images: ['a'] }, { ok: true, mode: 'reference' }],
  ]

  it('validateVideoRequest 在 15 组向量上两侧结果完全一致', async () => {
    const cjs = require(CJS_PATH)
    const esm = await import(ESM_PATH)
    for (const [input, expected] of vectors) {
      expect(esm.validateVideoRequest(input), JSON.stringify(input)).toEqual(expected)
      expect(cjs.validateVideoRequest(input), JSON.stringify(input)).toEqual(expected)
    }
  })

  it('inferVideoMode 在同一组向量上两侧推导一致', async () => {
    const cjs = require(CJS_PATH)
    const esm = await import(ESM_PATH)
    for (const [input] of vectors) {
      expect(esm.inferVideoMode(input)).toBe(cjs.inferVideoMode(input))
    }
  })
})
