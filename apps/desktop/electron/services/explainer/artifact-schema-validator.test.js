// @vitest-environment node
// @ts-check
/**
 * artifact-schema-validator.test.js — 上游 artifact schema 校验器的行为锁
 *
 * ## 覆盖两条线
 *
 * ① **行为线**：正例（最小合法实例必须过）+ 负例（缺 required / enum 非法 / const 不符 /
 *    嵌套缺字段 / 多余字段 / $ref 解析 / pattern / 未知 schema 名）。
 * ② **触达线**：跑完全部用例，统计 `errors[].keyword` **实际被触达**的关键字集合
 *    ⇒ 断言「13 个 schema 真正用到的每个关键字，都至少被一个用例真正触发过」。
 *
 * ② 是本文件的核心：**它不让「关键字覆盖」靠人肉核对**，而是让覆盖缺口当场暴露。
 * （自指断言的同款风险：若只断言「关键字集合 ⊆ 支持集」，一个**从未被触发过**的
 * 关键字也会算「已覆盖」—— 那正是「锁在守护死代码」的形态。）
 */

import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const validator = require('./artifact-schema-validator')
const { validate, validateAgainstSchema, loadSchema, collectKeywords, SUPPORTED_KEYWORDS, METADATA_KEYWORDS, SCHEMA_FILES, SCHEMA_ROOT } = validator

/** 跑完全部用例后收集「实际被触达的 keyword」 */
const touchedKeywords = new Set()

function track (result) {
  for (const err of result.errors) touchedKeywords.add(err.keyword)
  return result
}

/**
 * 按 schema 递归构造「最小合法实例」。
 * 规则：type 决定值形态；enum 取首项；const 取其值；required 全部填上；
 * 有 pattern 的字段用候选集试出可匹配值（试不出就跳过该字段——它必非 required）。
 */
function buildMinimalInstance (schema, root = schema) {
  if (!schema || typeof schema !== 'object') return null
  if (schema.$ref) {
    const segs = schema.$ref.slice(2).split('/')
    let node = root
    for (const s of segs) node = node && node[s]
    return buildMinimalInstance(node, root)
  }
  if (schema.const !== undefined) return schema.const
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  switch (type) {
    case 'object': {
      const out = {}
      const props = schema.properties || {}
      for (const key of (schema.required || [])) {
        const sub = props[key]
        if (sub && typeof sub.pattern === 'string') {
          const candidates = ['x', 'a', '0', 'test', 'example', 'abc', '#AABBCC', 'https://example.com', 'true']
          const hit = candidates.find(c => new RegExp(sub.pattern).test(c))
          if (hit) { out[key] = hit; continue }
          continue
        }
        out[key] = buildMinimalInstance(sub, root)
      }
      return out
    }
    case 'array': {
      const min = typeof schema.minItems === 'number' ? schema.minItems : 0
      const out = []
      for (let i = 0; i < min; i++) out.push(buildMinimalInstance(schema.items, root))
      return out
    }
    case 'string': {
      // 按 format 生成合法值（否则最小实例会因 format 校验而失败——那说明校验器是对的）
      if (typeof schema.format === 'string') {
        const byFormat = {
          date: '2026-01-01',
          'date-time': '2026-01-01T00:00:00Z',
          uri: 'https://example.com',
          url: 'https://example.com',
          email: 'a@example.com',
        }
        if (byFormat[schema.format]) return byFormat[schema.format]
      }
      return 'example'
    }
    case 'number': case 'integer': {
      if (typeof schema.minimum === 'number') return schema.minimum
      return 0
    }
    case 'boolean': return false
    case 'null': return null
    default: return null
  }
}

/** 取某个 schema 的 required 顶层字段（用于负例构造） */
function firstRequired (schema) {
  return Array.isArray(schema.required) && schema.required.length ? schema.required[0] : null
}

describe('artifact-schema-validator · 正例：13 个 schema 的最小合法实例必须通过', () => {
  for (const name of Object.keys(SCHEMA_FILES)) {
    it(`${name}.schema.json 的最小合法实例校验通过`, () => {
      const schema = loadSchema(name)
      expect(schema, `${name} schema 未载入`).toBeTruthy()
      const instance = buildMinimalInstance(schema)
      const result = track(validate(instance, name))
      expect(result.errors.map(e => `${e.path}:${e.keyword}`)).toEqual([])
      expect(result.ok).toBe(true)
    })
  }
})

describe('artifact-schema-validator · 负例：每类违规都必须被指名报错', () => {
  it('缺少 required 字段 ⇒ 报 required 并指名字段', () => {
    const schema = loadSchema('research_brief')
    const instance = buildMinimalInstance(schema)
    const key = firstRequired(schema)
    delete instance[key]
    const result = track(validate(instance, 'research_brief'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.keyword === 'required' && e.path.includes(key))).toBe(true)
  })

  it('enum 取值非法 ⇒ 报 enum', () => {
    const schema = loadSchema('scene_plan')
    const instance = buildMinimalInstance(schema)
    // scene_plan.scenes[].type 是 9 选 1 的 enum
    instance.scenes = [{
      id: 's1',
      type: '__不存在的类型__',
      description: 'd',
      start_seconds: 0,
      end_seconds: 1,
    }]
    const result = track(validate(instance, 'scene_plan'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.keyword === 'enum')).toBe(true)
  })

  it('const 不符 ⇒ 报 const', () => {
    const schema = loadSchema('research_brief')
    const instance = buildMinimalInstance(schema)
    instance.version = '9.9'
    const result = track(validate(instance, 'research_brief'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.keyword === 'const')).toBe(true)
  })

  it('嵌套 items 内层缺字段 ⇒ 报**内层** path（不是笼统的顶层报错）', () => {
    const schema = loadSchema('scene_plan')
    const instance = buildMinimalInstance(schema)
    instance.scenes = [{ id: 's1', type: 'broll', description: 'd', start_seconds: 0, end_seconds: 1 }]
    delete instance.scenes[0].description
    const result = track(validate(instance, 'scene_plan'))
    expect(result.ok).toBe(false)
    const hit = result.errors.find(e => e.keyword === 'required')
    expect(hit).toBeTruthy()
    expect(hit.path).toBe('scenes[0].description')
  })

  it('type 不符 ⇒ 报 type', () => {
    const schema = loadSchema('research_brief')
    const instance = buildMinimalInstance(schema)
    instance.data_points = '不是数组'
    const result = track(validate(instance, 'research_brief'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.keyword === 'type')).toBe(true)
  })

  it('additionalProperties=false ⇒ 多余字段被报（不被静默吞掉）', () => {
    const schema = loadSchema('script')
    expect(schema.additionalProperties).toBe(false)
    const instance = buildMinimalInstance(schema)
    instance.__多出来的字段 = 1
    const result = track(validate(instance, 'script'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.keyword === 'additionalProperties')).toBe(true)
  })

  it('未知 schema 名 ⇒ ok=false 且给出明确 errors（不抛错）', () => {
    const result = validate({}, '__不存在的schema__')
    expect(result.ok).toBe(false)
    expect(result.errors[0].keyword).toBe('schema')
  })

  it('$ref 指向的 $defs 也会被校验（引用不是免检区）', () => {
    // 用内联 schema 验（上游的 $ref 嵌在 concept_options[] 内层，从最小实例下钻不稳）
    const schema = {
      $defs: { taste: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } },
      type: 'object',
      required: ['taste'],
      properties: { taste: { $ref: '#/$defs/taste' } },
    }
    const ok = track(validateAgainstSchema({ taste: { a: 'x' } }, schema))
    expect(ok.ok).toBe(true)
    const bad = track(validateAgainstSchema({ taste: {} }, schema))
    expect(bad.ok).toBe(false)
    expect(bad.errors.some(e => e.keyword === 'required')).toBe(true)
  })

  it('上游的 proposal_packet 确实用到 $ref（防「上游不再用 $ref」后本用例空转）', () => {
    const schema = loadSchema('proposal_packet')
    expect(JSON.stringify(schema)).toContain('"$ref"')
    expect(findRefTarget(schema), 'proposal_packet 里应能找到 $ref 落点').toBeTruthy()
  })

  it('format 生效：非法 uri / date 被报（research_brief 的 sources[].url）', () => {
    const schema = loadSchema('research_brief')
    const instance = buildMinimalInstance(schema)
    instance.sources = [{ url: '不是链接' }]
    const result = track(validate(instance, 'research_brief'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.keyword === 'format')).toBe(true)
  })

  it('pattern 生效：非法颜色值被报（playbook.chart_palette）', () => {
    const schema = loadSchema('playbook')
    const instance = buildMinimalInstance(schema)
    instance.chart_palette = ['不是颜色']
    const result = track(validate(instance, 'playbook'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.keyword === 'pattern')).toBe(true)
  })

  it('maximum 生效：超出上限的数值被报（asset_manifest 的 quality_score）', () => {
    const schema = loadSchema('asset_manifest')
    const instance = buildMinimalInstance(schema)
    instance.assets = [{ quality_score: 5, path: 'a.png' }]
    const result = track(validate(instance, 'asset_manifest'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.keyword === 'maximum')).toBe(true)
  })

  it('oneOf 生效：必须恰好满足一个分支', () => {
    const schema = {
      type: 'object',
      required: ['v'],
      properties: {
        v: {
          oneOf: [
            { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
            { type: 'object', required: ['b'], properties: { b: { type: 'string' } } },
          ],
        },
      },
    }
    expect(track(validateAgainstSchema({ v: { a: 'x' } }, schema)).ok).toBe(true)
    const both = track(validateAgainstSchema({ v: { a: 'x', b: 'y' } }, schema))
    expect(both.ok).toBe(false)
    expect(both.errors.some(e => e.keyword === 'oneOf')).toBe(true)
  })

  it('exclusiveMinimum 生效：等于下界也报错', () => {
    const schema = { type: 'object', properties: { n: { type: 'number', exclusiveMinimum: 1 } } }
    expect(track(validateAgainstSchema({ n: 1 }, schema)).ok).toBe(false)
    expect(track(validateAgainstSchema({ n: 1.5 }, schema)).ok).toBe(true)
    const r = track(validateAgainstSchema({ n: 1 }, schema))
    expect(r.errors.some(e => e.keyword === 'exclusiveMinimum')).toBe(true)
  })

  it('minimum 生效：负数秒数被报', () => {
    const schema = loadSchema('scene_plan')
    const instance = buildMinimalInstance(schema)
    instance.scenes = [{
      id: 's1', type: 'broll', description: 'd', start_seconds: -1, end_seconds: 1,
    }]
    const result = track(validate(instance, 'scene_plan'))
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => e.keyword === 'minimum')).toBe(true)
  })
})

describe('artifact-schema-validator · 关键字触达自检', () => {
  it('13 个 schema 用到的每个关键字，都至少被一个用例真正触发过', () => {
    const used = new Set()
    for (const name of Object.keys(SCHEMA_FILES)) {
      const schema = loadSchema(name)
      collectKeywords(schema, used)
    }
    const known = new Set([...SUPPORTED_KEYWORDS, ...METADATA_KEYWORDS])
    // ① schema 用到的关键字必须都被「知道」（否则校验器会静默忽略它 ⇒ 假绿）
    const unknown = [...used].filter(k => !known.has(k))
    expect(unknown, `以下关键字既未实现也未登记为元数据：${unknown.join(', ')}`).toEqual([])
    // ② **违规类**关键字必须被真正触达（否则「声明支持」只是摆设）
    //    ⚠ 容器类关键字（properties / items / $ref / $defs / additionalProperties /
    //    patternProperties / prefixItems）**不会**出现在 errors[].keyword 里 ——
    //    它们违规时冒出来的是**内层**关键字（如 required / type）。
    //    ⇒ 容器类另由「结构锁」+ 负例的 path 断言覆盖（如 `scenes[0].description`
    //    就同时证明了 items/properties 确实被穿过）。
    const CONTAINER_KEYWORDS = new Set([
      'properties', 'items', '$ref', '$defs', 'additionalProperties',
      'patternProperties', 'prefixItems', 'contains',
    ])
    const usedAssertive = [...used].filter(k =>
      SUPPORTED_KEYWORDS.includes(k) && !CONTAINER_KEYWORDS.has(k))
    const untouched = usedAssertive.filter(k => !touchedKeywords.has(k))
    expect(untouched,
      `以下关键字在 schema 中被使用，但没有任何用例真正触发过（覆盖缺口）：${untouched.join(', ')}`).toEqual([])
  })

  it('校验器源码里真的实现了每个「已声明支持」的断言性关键字（结构锁）', () => {
    // ⚠ 未被 13 个 schema 用到的关键字**无法用行为验**（没有样本）⇒
    // 退化为「源码里确有实现痕迹」的结构锁。
    // ⚠ 这条锁的强度低于「触达自检」，因此两条**必须并存**：
    //    触达自检管「schema 用到的必须真被触发」，结构锁管「声明支持的必须真被实现」。
    const src = fs.readFileSync(path.join(__dirname, 'artifact-schema-validator.js'), 'utf8')
    const missing = SUPPORTED_KEYWORDS.filter(kw => !src.includes(kw))
    expect(missing, `这些关键字被声明为已支持，但源码里找不到实现痕迹：${missing.join(', ')}`).toEqual([])
  })
})

/** 在 schema 里递归找出第一个 oneOf 节点 */
function findOneOf (node) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node.oneOf)) return node.oneOf
  for (const value of Object.values(node)) {
    const hit = findOneOf(value)
    if (hit) return hit
  }
  return null
}

/** 在 schema 里递归找出第一个 exclusiveMinimum（含其 path 与下界值） */
function findExclusiveMinimum (node, trail = []) {
  if (!node || typeof node !== 'object') return null
  if (typeof node.exclusiveMinimum === 'number') {
    return { path: trail.slice(0, -1), key: trail[trail.length - 1], value: node.exclusiveMinimum }
  }
  for (const [key, value] of Object.entries(node)) {
    const hit = findExclusiveMinimum(value, trail.concat([key]))
    if (hit) return hit
  }
  return null
}

/**
 * 在 schema 里找出「被 $ref 引用到 $defs 的字段」（递归）。
 * ⚠ 上游的 $ref 不在顶层 properties（实测 proposal_packet 的 taste_profile 嵌在
 * concept_options[] 的 items 里）⇒ 只查顶层会漏。
 * @returns {{ path: string[], defName: string }|null}
 */
function findRefTarget (schema) {
  const walk = (node, trail) => {
    if (!node || typeof node !== 'object') return null
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const hit = walk(node[i], trail.concat([i]))
        if (hit) return hit
      }
      return null
    }
    if (typeof node.$ref === 'string') {
      const m = node.$ref.match(/^#\/\$defs\/(.+)$/)
      if (m && schema.$defs && schema.$defs[m[1]]) return { path: trail, defName: m[1] }
    }
    for (const [key, value] of Object.entries(node)) {
      const hit = walk(value, trail.concat([key]))
      if (hit) return hit
    }
    return null
  }
  return walk(schema, [])
}
