/**
 * announcement 域的 zh/en 成对锁 + 组件不得自带硬编码文案（UX 审计 1.2）
 *
 * ⚠️ 为什么自己写一条：CI 的 Gate 7（`check-locale-sync.js`）只比对**根级** zh.js/en.js，
 * 对 `src/locales/<域>/{zh,en}.js` 这种拆分文件**实测删掉 en 键照样打 PASS**（任务 #20 已登记）。
 * 借不得那道门禁，所以成对判据落在这里。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zh from './announcement/zh'
import en from './announcement/en'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LOCALES = path.resolve(HERE, '..', 'locales')
const COMPONENT = path.resolve(HERE, '..', 'components', 'AnnouncementBanner.vue')

function flatten (obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
    else out.push(key)
  }
  return out.sort()
}

describe('announcement 文案合同', () => {
  it('zh 与 en 的键集合必须逐字相等（缺一条即英文界面漏中文）', () => {
    expect(flatten(en)).toEqual(flatten(zh))
  })

  it('键集合必须非空且包含本批要求的四个落点', () => {
    const keys = flatten(zh)
    expect(keys.length).toBeGreaterThan(0)
    for (const need of ['regionLabel', 'closeLabel', 'severity.info', 'severity.warning', 'severity.maintenance']) {
      expect(keys, `announcement 域缺键 ${need}`).toContain(need)
    }
  })

  it('两侧取值都不得为空串（空串会让界面出现看不见摸不着的空标签）', () => {
    for (const [side, mod] of [['zh', zh], ['en', en]]) {
      const walk = (obj, prefix = '') => {
        for (const [k, v] of Object.entries(obj)) {
          if (v && typeof v === 'object') walk(v, `${prefix}${k}.`)
          else expect(String(v).trim(), `${side} 的 ${prefix}${k} 是空值`).not.toBe('')
        }
      }
      walk(mod)
    }
  })

  it('两个装配文件都必须展开 announcement 命名空间', () => {
    for (const f of ['zh.js', 'en.js']) {
      const src = fs.readFileSync(path.resolve(LOCALES, f), 'utf8')
      expect(src, `locales/${f} 没有展开 announcement 域 ⇒ 键取不到`).toMatch(/announcement:\s*\{\s*\.\.\./)
    }
  })

  it('组件模板与脚本不得自带中文文案（可访问名也是文案）', () => {
    const src = fs.readFileSync(COMPONENT, 'utf8')
    // 只测 template 与 script 两块，style 里没有文案；注释里允许出现中文（写的是"为什么"）
    const noComments = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*(\/\/|\/\*|\*)[^\n]*$/gm, '')
    const body = noComments.slice(0, noComments.indexOf('<style'))
    const hits = body.match(/[\u4e00-\u9fff][^\n]*/g) || []
    expect(hits, `AnnouncementBanner 里出现硬编码中文 ⇒ 英文界面会露出中文：${hits.join(' / ')}`).toEqual([])
  })
})
