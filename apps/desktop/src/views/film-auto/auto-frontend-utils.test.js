import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toFileUrl } from './file-url'
import { PROMPT_BLOCK_HEADINGS, checkPromptBlocks } from './auto-prompt-blocks'

describe('toFileUrl（本地成品可播放 URL）', () => {
  it('Windows 盘符路径补足三斜杠并统一分隔符', () => {
    expect(toFileUrl('C:\\x\\shot_000.mp4')).toBe('file:///C:/x/shot_000.mp4')
    expect(toFileUrl('D:/Data/a b.mp4')).toBe('file:///D:/Data/a b.mp4')
  })

  it('POSIX 绝对路径两斜杠，UNC 路径保持两斜杠', () => {
    expect(toFileUrl('/tmp/film-engineering/final.mp4')).toBe('file:///tmp/film-engineering/final.mp4')
    expect(toFileUrl('//server/share/a.mp4')).toBe('file://server/share/a.mp4')
  })

  it('空/非字符串 → 空串（调用方据此不渲染 video 元素）', () => {
    expect(toFileUrl('')).toBe('')
    expect(toFileUrl('   ')).toBe('')
    expect(toFileUrl(null)).toBe('')
    expect(toFileUrl(undefined)).toBe('')
    expect(toFileUrl(123)).toBe('')
  })
})

describe('checkPromptBlocks（块结构非阻断提示）', () => {
  // 2026-10-19：块标题由 5 项补齐为 7 项（补 SCENE CONTEXT 与 STYLE，与后端 BLOCK_HEADINGS
  // 及随包方法论同源）。夹具随之补齐，否则「完整提示词」会被判缺块。
  const FULL = [
    'EXT. STREET - NIGHT',
    '[CHARACTER: ROKO] street kid',
    '',
    'SCENE CONTEXT',
    'EXACT 3 CHARACTERS',
    '',
    'GEO SPATIAL LAYOUT',
    'Alley left',
    '',
    'ACTION TIMING',
    '0-2s walk',
    '',
    'AUDIO',
    'rain',
    '',
    'CHARACTER ACTING',
    'tense',
    '',
    'STYLE',
    'Photoreal. NON-IP.',
    '',
    'POSITIVE CONSTRAINTS',
    '8K',
  ].join('\n')

  it('完整提示词 → missing 为空、ok=true、检出角色行', () => {
    const r = checkPromptBlocks(FULL)
    expect(r.ok).toBe(true)
    expect(r.missing).toEqual([])
    expect(r.present).toEqual([...PROMPT_BLOCK_HEADINGS])
    expect(r.hasCharacterLine).toBe(true)
  })

  it('缺块如实列出（顺序稳定），非阻断（只报不改）', () => {
    const r = checkPromptBlocks('EXT. X\n[CHARACTER: ROKO] walks.\n\nACTION TIMING\n0-2s')
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(['SCENE CONTEXT', 'GEO SPATIAL LAYOUT', 'AUDIO', 'CHARACTER ACTING', 'STYLE', 'POSITIVE CONSTRAINTS'])
    expect(r.hasCharacterLine).toBe(true)
  })

  it('块标题带括号后缀或结尾冒号时仍算成块（与后端 BLOCK_HEADING_RE 同形态）', () => {
    const r = checkPromptBlocks('GEO SPATIAL LAYOUT (locked across every CO shot):\nAlley left\nACTION TIMING:\n0-2s')
    expect(r.present).toContain('GEO SPATIAL LAYOUT')
    expect(r.present).toContain('ACTION TIMING')
  })

  it('正文里偶然出现块名不算成块（必须独占一行）', () => {
    const r = checkPromptBlocks('He talks about the AUDIO and GEO SPATIAL LAYOUT in one breath.\nGEO SPATIAL LAYOUT\nx')
    expect(r.present).toContain('GEO SPATIAL LAYOUT')
    expect(r.missing).toContain('AUDIO')
  })

  it('空提示词 → 全部缺块且无角色行（调用方该情形另有必填校验）', () => {
    const r = checkPromptBlocks('')
    expect(r.missing).toEqual([...PROMPT_BLOCK_HEADINGS])
    expect(r.hasCharacterLine).toBe(false)
    expect(checkPromptBlocks(null).ok).toBe(false)
  })
})

describe('块标题单一真源对账（前端复刻 vs 后端 BLOCK_HEADINGS）', () => {
  it('前端清单与 shot-library.js 的 BLOCK_HEADINGS 逐项一致', () => {
    const backendFile = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..', '..', '..', 'electron', 'services', 'film-engineering', 'shot-library.js',
    )
    const source = fs.readFileSync(backendFile, 'utf8')
    const block = source.match(/const BLOCK_HEADINGS = \[([\s\S]*?)\]/)
    expect(block, 'shot-library.js 必须仍以 BLOCK_HEADINGS 数组声明块标题（否则本锁失明）').toBeTruthy()
    const backendHeadings = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(backendHeadings.length).toBeGreaterThanOrEqual(3)
    expect([...PROMPT_BLOCK_HEADINGS]).toEqual(backendHeadings)
  })
})
