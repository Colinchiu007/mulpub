/**
 * v1.4 unit_guard：数字与量词/单位完整性守卫（design-subtitle-word-integrity §2.1）。
 *
 * 独立模块的原因与 subtitle-phrase-boundary.ts 同型：债务熔断对 text-segmentation.ts
 * 是零增长点名，新守卫逻辑放这里；同时让「数字│单位」这一规则的实现与规则表解耦。
 *
 * left_bind：切点左边是数字串（ASCII 0-9/点 + 中文数词，容忍尾部一个排版空格）、
 *            右边以 units 某项开头 ⇒ 坏点（'8│米'、'3.2│亿元'、'一百五十│元'）。
 * right_bind：从切点向左跳过空白/标点取首个非空白字符 c，c ∈ 引导字符集
 *             且右侧以 ASCII 数字开头且 c 与数字之间无其它汉字 ⇒ 坏点（'提升了│60%'）。
 *
 * 只拒确定性坏点——守卫拒绝后由 findSafeCutPosition 在邻域重找。
 * units 缺省（规则表无 word_split.unit_guard）时恒不命中 ⇒ 行为与 v1.3 一致。
 */

import subtitleRules from './subtitle-rules.json'

/** units 真源在规则表；模块内加载一次（与 phrase-boundary 同型），调用方零参使用。 */
export const UNIT_GUARD_UNITS: readonly string[] = subtitleRules.word_split.unit_guard?.units ?? []

const CN_NUMERAL_CHARS = '一二三四五六七八九十百千万亿兆两零〇'
const UNIT_LEADERS = '是约到达了超足低高等'
const SKIP_CHARS = /[\s，。！？；：、,.!?;:]/u

export function isNumeralChar(ch: string | undefined): boolean {
  return ch !== undefined && (/[0-9.]/u.test(ch) || CN_NUMERAL_CHARS.includes(ch))
}

/** units 最长优先前缀匹配；无命中返回空串。units 由调用方按规则表加载。 */
export function matchUnitPrefix(s: string, units: readonly string[] = UNIT_GUARD_UNITS): string {
  for (const u of units) {
    if (u && s.startsWith(u)) return u
  }
  return ''
}

/** 数字与量词/单位之间不得设切点。units 缺省时恒 false。 */
export function isUnitInterior(text: string, i: number, units: readonly string[] = UNIT_GUARD_UNITS): boolean {
  if (i <= 0 || i >= text.length) return false
  if (units.length === 0) return false
  const left = text.slice(Math.max(0, i - 8), i)
  const right = text.slice(i, i + 8)
  // left_bind：数字串（容忍尾部一个排版空格，'8 米'）│单位开头
  const leftTrim = left.endsWith(' ') ? left.slice(0, -1) : left
  if (isNumeralChar(leftTrim[leftTrim.length - 1]) && matchUnitPrefix(right, units).length > 0) return true
  // right_bind：向左跳空白/标点取引导字 c；c ∈ 引导集 && 右侧以 ASCII 数字开头 && 中间无汉字
  let j = i - 1
  while (j >= 0 && SKIP_CHARS.test(text[j])) j -= 1
  if (j < 0) return false
  if (!UNIT_LEADERS.includes(text[j])) return false
  if (!/[0-9]/u.test(right[0] ?? '')) return false
  if (j + 1 < i && /[\u4e00-\u9fff]/u.test(text[j + 1])) return false
  return true
}
