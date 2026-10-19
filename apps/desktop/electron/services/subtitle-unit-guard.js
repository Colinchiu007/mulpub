/**
 * v1.4 unit_guard：数字与量词/单位完整性守卫（与 TS subtitle-unit-guard.ts 同构）。
 * 独立模块原因同 TS 侧：story2video-segmentation-engine.js 是行数点名对象（targets 1112）。
 */
const subtitleRules = require('@multi-publish/story2video-engine/subtitle-rules')

const CN_NUMERAL_CHARS = '一二三四五六七八九十百千万亿兆两零〇'
const UNIT_LEADERS = '是约到达了超足低高等'
const SKIP_CHARS = /[\s，。！？；：、,.!?;:]/u

const UNIT_GUARD_UNITS = subtitleRules.word_split.unit_guard?.units || []

function matchUnitPrefix (s, units = UNIT_GUARD_UNITS) {
  for (const u of units) {
    if (u && s.startsWith(u)) return u
  }
  return ''
}

function isUnitInterior (text, i, units = UNIT_GUARD_UNITS) {
  if (i <= 0 || i >= text.length) return false
  if (units.length === 0) return false
  const isNumCh = (ch) => ch !== undefined && (/[0-9.]/u.test(ch) || CN_NUMERAL_CHARS.includes(ch))
  const left = text.slice(Math.max(0, i - 8), i)
  const right = text.slice(i, i + 8)
  const leftTrim = left.endsWith(' ') ? left.slice(0, -1) : left
  if (isNumCh(leftTrim[leftTrim.length - 1]) && matchUnitPrefix(right, units).length > 0) return true
  let j = i - 1
  while (j >= 0 && SKIP_CHARS.test(text[j])) j -= 1
  if (j < 0) return false
  if (!UNIT_LEADERS.includes(text[j])) return false
  if (!/[0-9]/u.test(right[0] ?? '')) return false
  if (j + 1 < i && /[\u4e00-\u9fff]/u.test(text[j + 1])) return false
  return true
}

module.exports = { isUnitInterior, matchUnitPrefix }
