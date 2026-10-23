// @ts-check
'use strict'
/**
 * kit-mirror-check 契约测试（PR-3b 资产导入 · 白名单镜像）
 *
 * 覆盖：代码白名单 == `SCHEMA.md`「文件清单」表标 ✅ 的行（归一化 + 字典序后逐行 `===`），
 * 以及 `images/` 落在**排除项清单**里（排除本身可审计）。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const { verifyKitMirror, parseSchemaWhitelist, canonical, SCHEMA_PATH } = require('./kit-mirror-check')
const { WHITELIST_PATTERNS } = require('./kit-import-scan')

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kit-mirror-'))
}

describe('kit-mirror-check: 白名单镜像', () => {
  it('仓内 SCHEMA.md 与代码白名单逐行相等', () => {
    const res = verifyKitMirror()
    expect(res.error).toBeUndefined()
    expect(res.missing).toEqual([])
    expect(res.extra).toEqual([])
    expect(res.ok).toBe(true)
    expect(res.actual.length).toBe(WHITELIST_PATTERNS.length)
  })

  it('images/ 落在排除项清单里（排除本身可审计）', () => {
    const res = verifyKitMirror()
    expect(res.excluded).toContain('images/')
    expect(res.actual).not.toContain('images/')
  })

  it('SCHEMA.md 缺一行 ⇒ 报 missing（漂移可见）', () => {
    const dir = tmpDir()
    const fake = path.join(dir, 'SCHEMA.md')
    const text = fs.readFileSync(SCHEMA_PATH, 'utf8')
      .replace(/^\| `palette\.json`.*$/m, '')
    fs.writeFileSync(fake, text, 'utf8')
    const res = verifyKitMirror({ schemaPath: fake })
    expect(res.ok).toBe(false)
    expect(res.missing).toContain('palette.json')
  })

  it('SCHEMA.md 多一行 ⇒ 报 extra（漂移可见）', () => {
    const dir = tmpDir()
    const fake = path.join(dir, 'SCHEMA.md')
    const text = fs.readFileSync(SCHEMA_PATH, 'utf8')
      .replace(/^\| `palette\.json`.*$/m, '| `palette.json` | v7 增强 | ✅ | x |\n| `extra-asset.json` | 否 | ✅ | 多出来的一行 |')
    fs.writeFileSync(fake, text, 'utf8')
    const res = verifyKitMirror({ schemaPath: fake })
    expect(res.ok).toBe(false)
    expect(res.extra).toContain('extra-asset.json')
  })

  it('读不到 SCHEMA.md ⇒ 失败（不静默跳过）', () => {
    const res = verifyKitMirror({ schemaPath: path.join(tmpDir(), 'nope.md') })
    expect(res.ok).toBe(false)
    expect(typeof res.error).toBe('string')
  })

  it('归一化口径：posix 归一 + 去尾斜杠 + 字典序', () => {
    expect(canonical(['b/', './a', 'a\\b'])).toEqual(['a', 'a/b', 'b'])
  })

  it('表解析：只认标 ✅ 的行，❌ 归排除', () => {
    const parsed = parseSchemaWhitelist([
      '| 文件 | 必填 | 导入 | 说明 |',
      '|------|------|------|------|',
      '| `a.json` | ✅ | ✅ | x |',
      '| `images/` | 否 | ❌ | y |',
      '',
    ].join('\n'))
    expect(parsed.patterns).toEqual(['a.json'])
    expect(parsed.excluded).toEqual(['images/'])
  })
})
