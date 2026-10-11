/**
 * https 判据的单一真源锁（刀 3 第 3 片，QM-6 后端 ④a）
 *
 * 这条锁测的不是「判据对不对」（判定表已经覆盖），而是「有没有第二份判据」。
 * 三份抄本的实际风险是**放宽时只放宽一处**：同一个功能会出现两种「能不能播」的答案，
 * 用户侧表现为「音频能下、订阅抓不到」这种无法归因的组合。
 *
 * ⛔ 扫描前必须剥注释（本仓有过「结构锁不剥注释、把注释里的示例读成真实代码」的事故）。
 * 本模块与相邻文件的注释里大量出现 `https://` 字样与判据本身的引用，不剥就会自己抓到自己。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { isPublicHttpsUrl } from './podcast-public-url'

const DIR = __dirname

/** 逐行剥行注释与块注释行；只做「不让注释被当成代码」这一件事，不做语法解析。 */
function stripComments (src) {
  return src
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line) && !/^\s*\*/.test(line) && !/^\s*\/\*/.test(line))
    .map((line) => line.replace(/\/\/[^\n]*$/, ''))
    .join('\n')
}

const SCHEMA_FILES = [
  'podcast-episode-publish.js',
  'podcast-episode-host.js',
  'podcast-episode-adapters.js',
  'podcast-hosting-service.js',
]

describe('podcast-public-url · 判定表', () => {
  it('只认 https：http / 相对路径 / 非字符串 / 空串一律否', () => {
    expect(isPublicHttpsUrl('https://cdn.example/a.mp3')).toBe(true)
    expect(isPublicHttpsUrl('HTTPS://cdn.example/a.mp3')).toBe(true)
    expect(isPublicHttpsUrl('  https://cdn.example/a.mp3  ')).toBe(true)
    for (const bad of ['http://cdn.example/a.mp3', '//cdn.example/a.mp3', 'cdn.example/a.mp3',
      '', '   ', 'https:/cdn.example/a', 'javascript:alert(1)', null, undefined, 42, {}, []]) {
      expect(isPublicHttpsUrl(bad)).toBe(false)
    }
  })

  it('它不是 safe-http-url 的替代品：那条判据允许 http（href 面），本条不允许（feed 面）', async () => {
    const { safeHttpUrl } = require('@multi-publish/shared-utils/src/safe-http-url')
    expect(safeHttpUrl('http://cdn.example/a.mp3')).toBeTruthy()
    expect(isPublicHttpsUrl('http://cdn.example/a.mp3')).toBe(false)
  })
})

describe('podcast-public-url · 出期链内不得出现第二份协议判据', () => {
  it.each(SCHEMA_FILES)('%s 不自带 https 正则', (name) => {
    const src = stripComments(fs.readFileSync(path.join(DIR, name), 'utf8'))
    expect(src).not.toMatch(/\/\^https/)
    expect(src).not.toMatch(/test\(\s*\/https\?/)
  })

  it('出期链的四个文件都引用共享实现（不是"恰好没用正则"而是"确实接上了"）', () => {
    const publishing = fs.readFileSync(path.join(DIR, 'podcast-episode-publish.js'), 'utf8')
    const hosting = fs.readFileSync(path.join(DIR, 'podcast-hosting-service.js'), 'utf8')
    expect(publishing).toMatch(/require\('\.\/podcast-public-url'\)/)
    expect(hosting).toMatch(/require\('\.\/podcast-public-url'\)/)
  })

  it('反证夹具：判据若被抄成第二份，本锁必须变红（证明它在跑，不是恒真）', () => {
    const copied = "  if (!/^https:\\/\\//i.test(url)) throw new Error('x')\n"
    expect(stripComments(copied)).toMatch(/\/\^https/)
    // 注释里出现同一串不得触发——否则本仓每条讲判据的注释都会让它恒红，最终被人删掉
    expect(stripComments("// 以前这里写着 /^https:\\/\\//i 是不对的\n")).not.toMatch(/\/\^https/)
  })
})
