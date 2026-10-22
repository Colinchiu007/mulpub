import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNotifyText } from '@/utils/notifyCore'
import {
  REWRITE_ENGINE_MAX_INPUT_CHARS,
  REWRITE_ENGINE_MAX_OUTPUT_CHARS,
  LENGTH_TARGET_CHARS,
  buildRewriteLengthOptions,
  countRewriteChars,
  prepareRewriteInput,
  shouldSegmentRewrite,
} from './rewrite-engine-limits'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE_CORE = resolve(HERE, '../../../../packages/rewrite-engine/src/rewrite-engine-core.js')
// Python 侧长度三档真源（长度三档只在 Python 聚合后端有定义）
const PY_SERVICE = resolve(HERE, '../../../../packages/python-backend/src/multi_publish/aggregation/service.py')
// 中文 locale（长度三档文案所在处）
const LOCALE_ZH = resolve(HERE, '../locales/collection/zh.js')

describe('rewrite-engine-limits — 与引擎上限的结构锁', () => {
  it('渲染层常量 === 引擎 MAX_INPUT_CHARS，且分流判据消费该常量（防两处漂移）', () => {
    const source = readFileSync(ENGINE_CORE, 'utf8')
    const match = source.match(/const MAX_INPUT_CHARS = (\d+)/)
    expect(match, '引擎 rewrite-engine-core.js 缺少 MAX_INPUT_CHARS 常量').toBeTruthy()
    expect(Number(match[1])).toBe(REWRITE_ENGINE_MAX_INPUT_CHARS)
    // 第二刀起该常量是「分段阈值」而非硬拒上限：判据必须引用常量做分流
    expect(source).toContain('> MAX_INPUT_CHARS')
    expect(source).not.toContain('> 6000')
    // 长度硬拒分支已移除（>阈值走分段，不返回 TOO_LONG）
    expect(source).not.toContain("errorCode: 'TOO_LONG'")
  })

  it('渲染层输出上限常量 === 引擎 MAX_OUTPUT_CHARS（wordCountRange 合法域真源）', () => {
    const source = readFileSync(ENGINE_CORE, 'utf8')
    const match = source.match(/const MAX_OUTPUT_CHARS = (\d+)/)
    expect(match, '引擎 rewrite-engine-core.js 缺少 MAX_OUTPUT_CHARS 常量').toBeTruthy()
    expect(Number(match[1])).toBe(REWRITE_ENGINE_MAX_OUTPUT_CHARS)
    // 引擎 wordCountRange 防御必须消费该常量，不得写死 6000
    expect(source).toContain('range.max <= MAX_OUTPUT_CHARS')
    expect(source).not.toContain('range.max <= 6000')
  })
})

describe('countRewriteChars — Unicode 码点口径（与引擎 [...content].length 一致）', () => {
  it('BMP 字符按 1 计', () => {
    expect(countRewriteChars('中文abc')).toBe(5)
  })

  it('emoji（代理对）按 1 个码点计，而不是 String.length 的 2', () => {
    expect('😀'.length).toBe(2)
    expect(countRewriteChars('😀')).toBe(1)
  })

  it('null / undefined 归一为空串', () => {
    expect(countRewriteChars(null)).toBe(0)
    expect(countRewriteChars(undefined)).toBe(0)
  })
})

describe('prepareRewriteInput — 不再预截断（rewrite-segment-and-finish-reason 第二刀）', () => {
  // 历史：曾把 >50000 截到 50000（fix-collect-rewrite-too-long）。分段改写落地后，
  // 渲染层预截断会让超长正文永远到不了引擎分段路径（第三轴 M1：死代码），故改为透传。

  it('任意长度都原样透传（50001 不再被截）', () => {
    const content = '字'.repeat(50001)
    const prepared = prepareRewriteInput(content)
    expect(prepared.truncated).toBe(false)
    expect(prepared.originalLength).toBe(50001)
    expect(prepared.text).toBe(content)
    expect([...prepared.text].length).toBe(50001)
  })

  it('超长 emoji 文本同样透传（无截断即无劈开代理对的风险）', () => {
    const content = '😀'.repeat(50001)
    const prepared = prepareRewriteInput(content)
    expect(prepared.truncated).toBe(false)
    expect(prepared.text).toBe(content)
  })

  it('原长文（旧 6000 上限回归）透传', () => {
    const content = '字'.repeat(6001)
    expect(prepareRewriteInput(content).text).toBe(content)
  })

  it('null → 空串（空正文由漏斗的判空守卫处理，不归本函数）', () => {
    expect(prepareRewriteInput(null)).toEqual({ text: '', originalLength: 0, truncated: false })
  })
})

describe('shouldSegmentRewrite — 分段提示判据', () => {
  it('恰好 50000 码点 ⇒ 不分段（阈值是 >，不是 >=）', () => {
    expect(shouldSegmentRewrite('字'.repeat(50000))).toBe(false)
  })

  it('50001 码点 ⇒ 需要分段提示', () => {
    expect(shouldSegmentRewrite('字'.repeat(50001))).toBe(true)
  })

  it('按码点计（emoji 50001 个 ⇒ 分段；不会因 String.length 翻倍误判早）', () => {
    expect(shouldSegmentRewrite('😀'.repeat(50000))).toBe(false)
    expect(shouldSegmentRewrite('😀'.repeat(50001))).toBe(true)
  })

  it('空/短文本 ⇒ 不分段', () => {
    expect(shouldSegmentRewrite('')).toBe(false)
    expect(shouldSegmentRewrite(null)).toBe(false)
    expect(shouldSegmentRewrite('短文')).toBe(false)
  })
})

describe('LENGTH_TARGET_CHARS — 长度三档目标字数的跨语言结构锁（fix-length-compress-target-800）', () => {
  // 为什么需要这把锁：界面上的「精简（约 N 字）」与后端实际用的 target 是**两处副本**。
  // 只改一边 ⇒ 用户看到的字数与实际产出的字数不符，且没有任何其它判据会发现。
  //
  // ⚠️ 为什么要读后端 Python 源文件（跨层耦合，评审 i3/i5 提出）：
  //   备选是让 Python 侧导出 JSON 契约文件、两端各读它。之所以**不**这么做：
  //   那要新增一个构建产物 + 一条生成链路（谁生成、何时生成、CI 里是否同步），
  //   而本仓长度三档**只有一处定义**（Python 侧的 `_LENGTH_RANGES`），
  //   直接读它的成本远低于引入一条新的同步机制。
  //   代价（已知并接受）：Python 侧若改动 `_LENGTH_RANGES` 的**写法**（换引号、
  //   换行、换变量名），本锁会失配而红 —— 这是**显式失败**（改写格式即提醒同步），
  //   而不是静默失配；锁内已断言「必须解析到三档」，正则失配时同样会红，不会空过。
  it('渲染层镜像 === Python _LENGTH_RANGES 的 target（只改一边即红）', () => {
    const source = readFileSync(PY_SERVICE, 'utf8')
    const block = source.match(/_LENGTH_RANGES\s*=\s*\{([\s\S]*?)\n\}/)
    expect(block, 'Python service.py 里找不到 _LENGTH_RANGES 定义').toBeTruthy()
    const targets = {}
    for (const m of block[1].matchAll(/"(\w+)":\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g)) {
      targets[m[1]] = { min: Number(m[2]), max: Number(m[3]), target: Number(m[4]) }
    }
    // 解析必须真的拿到三档：正则失配时「解析到 0 条」也要红，不能静默通过
    expect(Object.keys(targets).sort()).toEqual(['compress', 'expand', 'keep'])
    for (const [name, v] of Object.entries(targets)) {
      expect(LENGTH_TARGET_CHARS[name], `渲染层缺少 ${name} 档目标字数`).toBe(v.target)
      // 三元组不变量：界面显示的是 target，而后端真正校验的是 (min, max, target) 区间。
      // 若 min/max 与 target 失配（如 min > target），界面显示的字数就是误导 ⇒ 这里一并钉住。
      expect(v.min, `${name} 档区间失配：min=${v.min} > target=${v.target}`).toBeLessThanOrEqual(v.target)
      expect(v.target, `${name} 档区间失配：target=${v.target} > max=${v.max}`).toBeLessThanOrEqual(v.max)
    }
  })

  it('locale 文案不得写死字数（只能用 {count} 插值，否则会与镜像常量脱钩）', () => {
    const localeSource = readFileSync(LOCALE_ZH, 'utf8')
    for (const key of ['rewriteLengthKeep', 'rewriteLengthCompress', 'rewriteLengthExpand']) {
      const m = localeSource.match(new RegExp(key + ":\\s*'([^']*)'"))
      expect(m, `locale 里找不到 ${key}`).toBeTruthy()
      expect(m[1], `${key} 必须用 {count} 插值目标字数`).toContain('{count}')
      // 模板里除 {count} 外不得出现裸数字（防有人把 800 直接写进文案）
      expect(m[1].replace('{count}', ''), `${key} 里出现了写死的数字`).not.toMatch(/\d/)
    }
  })

  it('三档 target 的单调关系成立（区分档位语义的唯一依据就是 target）', () => {
    expect(LENGTH_TARGET_CHARS.compress).toBeLessThan(LENGTH_TARGET_CHARS.keep)
    expect(LENGTH_TARGET_CHARS.keep).toBeLessThan(LENGTH_TARGET_CHARS.expand)
  })
})

describe('buildRewriteLengthOptions — 长度下拉文案带目标字数（fix-length-compress-target-800）', () => {
  // 用**真实**的 resolveNotifyText（而不是自造的假 resolve）：本次要验的正是
  // 「真实插值函数会不会真的把 {count} 替换掉」——用假 resolve 测等于没测。
  const resolve = (key, params) => resolveNotifyText(key, params).text

  it('三个选项都带上了各自的目标字数', () => {
    const options = buildRewriteLengthOptions(resolve)
    expect(options.map(o => o.value)).toEqual(['keep', 'compress', 'expand'])
    expect(options[0].label).toContain('1500')
    expect(options[1].label).toContain('800')
    expect(options[2].label).toContain('2500')
  })

  it('真实 resolveNotifyText 会插值：三档都验，文案里不得残留 {count} 占位符', () => {
    // 若真实插值函数不支持 params，这条会红（UI 上就会露出 "{count}"）。
    // 必须**三档都验**：只验 compress 会漏掉「只有某档的 key 不支持插值」的情况。
    for (const value of ['keep', 'compress', 'expand']) {
      const key = `collection.rewriteLength${value[0].toUpperCase()}${value.slice(1)}`
      const raw = resolveNotifyText(key, { count: LENGTH_TARGET_CHARS[value] }).text
      expect(raw, `${key} 的真实文案未取到`).toBeTruthy()
      expect(raw, `${key} 的文案残留 {count} 占位符`).not.toContain('{count}')
      expect(raw, `${key} 的文案未含目标字数`).toContain(String(LENGTH_TARGET_CHARS[value]))
    }
    for (const o of buildRewriteLengthOptions(resolve)) {
      expect(o.label, `${o.value} 档标签残留 {count}`).not.toContain('{count}')
    }
  })

  it('精简档的目标字数 === 镜像常量（800）', () => {
    const compress = buildRewriteLengthOptions(resolve).find(o => o.value === 'compress')
    expect(compress.label).toContain(String(LENGTH_TARGET_CHARS.compress))
    expect(LENGTH_TARGET_CHARS.compress).toBe(800)
  })

  it('负向用例：locale 未命中时不得留下空白下拉项，且仍带目标字数与单位', () => {
    // 评审 i4：插值断言只有正向用例，缺「resolve 失效」这一侧。
    // 这里模拟 locale key 缺失/未命中（resolve 返回空）⇒ 必须有兜底文案，
    // 否则用户会看到三个**没有文字**的下拉项（且看不出目标字数）。
    const fallback = buildRewriteLengthOptions(() => '')
    expect(fallback).toHaveLength(3)
    for (const o of fallback) {
      expect(o.label, `${o.value} 档兜底文案为空`).toBeTruthy()
      expect(o.label, `${o.value} 档兜底文案缺目标字数`).toContain(String(LENGTH_TARGET_CHARS[o.value]))
      // 兜底文案也要带单位（评审 i5）：与 locale 模板同口径，否则用户看不出是字数
      expect(o.label, `${o.value} 档兜底文案缺单位`).toContain('chars')
    }
  })
})
