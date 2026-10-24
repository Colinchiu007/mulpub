// @ts-check
'use strict'
/**
 * kit-mirror-check — 白名单镜像断言（代码 ↔ `SCHEMA.md`「文件清单」表）
 *
 * 归属：PR-3b（F-J 资产导入写路径）· 方案 `pr3b-import-design.md` §四 / §十 附录
 *
 * 为什么需要它：`SCHEMA.md` 的「文件清单」表是导入白名单的**人读镜像**，
 * 代码里的 `WHITELIST_PATTERNS` 是**唯一真源** ⇒ 两者一旦漂移，文档就在骗人。
 * 本模块提供**构建期/测试期**的逐行断言（**不在运行路径上** ⇒ 不违反
 * 「`SCHEMA.md` 不用于运行时解析」那条声明）。
 *
 * 归一化与排序口径（两侧一致 ⇒ 不同实现不会漂移）：
 *   `path.posix.normalize` → 去尾斜杠 → **按字典序（localeCompare）排序** → 再逐行 `===`。
 */

const nodeFs = require('fs')
const nodePath = require('path')

const { WHITELIST_PATTERNS, normalizePattern } = require('./kit-import-scan')

/** `SCHEMA.md` 路径（electron/film-kit/SCHEMA.md） */
const SCHEMA_PATH = nodePath.join(__dirname, '..', '..', 'film-kit', 'SCHEMA.md')

/** 表头里的「导入」列标记（✅ = 在导入白名单内） */
const INCLUDED_MARK = '✅'

/**
 * 从 `SCHEMA.md` 解析「文件清单」表里标 ✅ 的**模式**（第一列，去掉反引号）。
 * @param {string} text
 * @returns {{patterns: string[], excluded: string[], error?: string}}
 */
function parseSchemaWhitelist (text) {
  const lines = String(text || '').split(/\r?\n/)
  const start = lines.findIndex((l) => /^\|\s*文件\s*\|/.test(l))
  if (start < 0) return { patterns: [], excluded: [], error: '未找到「文件清单」表头' }
  // 表头下一行是分隔行（|---|---|），从其后开始逐行读
  const included = []
  const excluded = []
  for (let i = start + 2; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim().startsWith('|')) break
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 3) continue
    const file = cells[0].replace(/`/g, '').trim()
    const mark = cells[2]
    if (!file || file === '文件') continue
    if (mark.indexOf(INCLUDED_MARK) >= 0) included.push(file)
    else excluded.push(file)
  }
  return { patterns: included, excluded }
}

/** 归一化 + 排序（镜像比较的统一口径） */
function canonical (patterns) {
  return patterns
    .map((p) => normalizePattern(p))
    .filter((p) => p.length > 0)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * 镜像断言。
 * @param {object} [opts]
 * @param {string} [opts.schemaPath]
 * @param {object} [opts.fs]
 * @returns {{ok:boolean, expected?:string[], actual?:string[], missing?:string[], extra?:string[], error?:string}}
 */
function verifyKitMirror (opts) {
  const o = opts || {}
  const fsImpl = o.fs || nodeFs
  const schemaPath = o.schemaPath || SCHEMA_PATH
  let text
  try {
    text = fsImpl.readFileSync(schemaPath, 'utf8')
  } catch (e) {
    return { ok: false, error: '读不到 SCHEMA.md: ' + String(e && e.message) }
  }
  const parsed = parseSchemaWhitelist(text)
  if (parsed.error) return { ok: false, error: parsed.error }
  const expected = canonical(WHITELIST_PATTERNS)
  const actual = canonical(parsed.patterns)
  const missing = expected.filter((p) => actual.indexOf(p) < 0)
  const extra = actual.filter((p) => expected.indexOf(p) < 0)
  const ok = missing.length === 0 && extra.length === 0
  return { ok, expected, actual, missing, extra, excluded: parsed.excluded }
}

module.exports = {
  SCHEMA_PATH,
  INCLUDED_MARK,
  parseSchemaWhitelist,
  canonical,
  verifyKitMirror,
}
