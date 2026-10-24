'use strict'
const fs = require('fs')
const path = require('path')

/**
 * artifact-schema-validator — 上游 OpenMontage artifact schema 的零依赖校验器
 *
 * ## 定位
 *
 * 上游 OpenMontage 的 `schemas/artifacts/*.schema.json` 是「AI 讲解视频」各阶段产物的
 * 权威契约（research_brief / proposal_packet / script / scene_plan / asset_manifest /
 * edit_decisions / render_report / final_review / publish_log / decision_log +
 * checkpoint / pipeline_manifest / playbook）。本模块把这 13 个 schema **逐字**搬进本仓
 * （`./schemas/`），并提供一个**零外部依赖**的 JSON Schema 校验器。
 *
 * ## 为什么不用 ajv
 *
 * ① 本仓**没有** ajv / json-schema（`grep` 全仓零命中）⇒ 引进来等于新增一整棵依赖树
 *    （而本仓的依赖漏洞门禁对**所有** PR 全量扫描，新增依赖 = 新增审计面 + 打包体积）。
 * ② 上游 schema 只用到 draft 2020-12 的一个**小子集**（实测 19 个关键字，见 §关键字），
 *    为此引入通用校验器不划算。
 * ③ 自研可把「**关键字覆盖**」变成一条**可机械验的契约**（见 `SUPPORTED_KEYWORDS` +
 *    `schema-keyword-coverage.test.js`）—— 通用校验器做不到「上游加关键字时逼我补实现」。
 *
 * ## 失败语义
 *
 * `validate()` **不抛错**，返回 `{ ok, errors }`：
 * - `errors[].path` 用 JSON Pointer 风格（`concept_options[0].cost_estimate.line_items[2].tool`）
 *   ⇒ 上游 YAML 的「Schema-valid」判据能被**具体定位到字段**，而不是「整个产物不合法」。
 * - 调用方自己决定 fail-closed 还是降级（阶段执行器一律 fail-closed）。
 *
 * ## 关键字（实测自 13 个 schema 全文）
 *
 * 断言性（本模块全部实现）：
 *   type / required / properties / additionalProperties / items / enum / const /
 *   minimum / maximum / exclusiveMinimum / exclusiveMaximum / multipleOf /
 *   minLength / maxLength / pattern / minItems / maxItems / uniqueItems /
 *   minProperties / maxProperties / patternProperties / oneOf / anyOf / allOf / not /
 *   if / then / else / contains / prefixItems / $ref / $defs
 *
 * 元数据（**不参与断言**，但必须被显式登记，否则「漏实现」与「不需要实现」无法区分）：
 *   $schema / $id / title / description / default / examples / deprecated /
 *   readOnly / writeOnly / nullable
 *
 * ⚠ 断言性关键字的实现**故意比当前 schema 用到的更全**（如 `anyOf` / `allOf` / `not` /
 *   `patternProperties` / `if-then-else` 当前都没用到）：
 *   上游 schema 演进时若新增这些关键字，`schema-keyword-coverage.test.js` 会**先红**
 *   （提示要补实现），而不是**静默不校验**（假绿）。
 */

/** 本模块**实现**的断言性关键字集合（schema 里出现即必须被校验到） */
const SUPPORTED_KEYWORDS = Object.freeze([
  'type', 'required', 'properties', 'additionalProperties', 'items', 'enum', 'const',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems',
  'minProperties', 'maxProperties', 'patternProperties',
  'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'contains', 'prefixItems',
  'format', '$ref', '$defs',
])

/** 元数据关键字（不参与断言，但必须被显式登记） */
const METADATA_KEYWORDS = Object.freeze([
  '$schema', '$id', 'title', 'description', 'default', 'examples',
  'deprecated', 'readOnly', 'writeOnly', 'nullable',
])

/** schema 名称 → 相对路径（相对本文件所在目录） */
const SCHEMA_FILES = Object.freeze({
  research_brief: 'artifacts/research_brief.schema.json',
  proposal_packet: 'artifacts/proposal_packet.schema.json',
  script: 'artifacts/script.schema.json',
  scene_plan: 'artifacts/scene_plan.schema.json',
  asset_manifest: 'artifacts/asset_manifest.schema.json',
  edit_decisions: 'artifacts/edit_decisions.schema.json',
  render_report: 'artifacts/render_report.schema.json',
  final_review: 'artifacts/final_review.schema.json',
  video_analysis_brief: 'artifacts/video_analysis_brief.schema.json',
  publish_log: 'artifacts/publish_log.schema.json',
  decision_log: 'artifacts/decision_log.schema.json',
  checkpoint: 'checkpoints/checkpoint.schema.json',
  pipeline_manifest: 'pipelines/pipeline_manifest.schema.json',
  playbook: 'styles/playbook.schema.json',
})

const SCHEMA_ROOT = path.join(__dirname, 'schemas')
const schemaCache = new Map()

/**
 * 载入 schema（带进程内缓存）。
 * @param {string} name SCHEMA_FILES 的键
 * @returns {object|null} schema 对象；名字未知返回 null
 */
function loadSchema (name) {
  const rel = SCHEMA_FILES[name]
  if (!rel) return null
  if (schemaCache.has(name)) return schemaCache.get(name)
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(SCHEMA_ROOT, rel), 'utf8'))
  } catch (_) {
    parsed = null
  }
  schemaCache.set(name, parsed)
  return parsed
}

/** 清空 schema 缓存（测试用；同步脚本刷新后调用） */
function clearSchemaCache () { schemaCache.clear() }

function isPlainObject (v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v) }

function typeOf (v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (Number.isInteger(v)) return 'integer'
  return typeof v
}

function typeMatches (value, expected) {
  const actual = typeOf(value)
  if (expected === 'number') return actual === 'number' || actual === 'integer'
  if (expected === 'integer') return actual === 'integer'
  return actual === expected
}

/** 解析本地 `$ref`（仅支持 `#/$defs/<name>` 与 `#/definitions/<name>`） */
function resolveRef (ref, root) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null
  const segments = ref.slice(2).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
  let node = root
  for (const seg of segments) {
    if (!node || typeof node !== 'object' || !(seg in node)) return null
    node = node[seg]
  }
  return node
}

function pushError (errors, pathStr, keyword, message) {
  errors.push({ path: pathStr || '$', keyword, message })
}

function checkType (value, schema, pathStr, errors) {
  if (!schema || schema.type === undefined) return
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (types.some(t => typeMatches(value, t))) return
  pushError(errors, pathStr, 'type',
    `类型应为 ${types.join('|')}，实际为 ${typeOf(value)}`)
}

function checkEnumConst (value, schema, pathStr, errors) {
  if (Array.isArray(schema.enum) && !schema.enum.some(v => v === value)) {
    pushError(errors, pathStr, 'enum',
      `取值不在允许集合 [${schema.enum.map(v => JSON.stringify(v)).join(', ')}] 内，实际为 ${JSON.stringify(value)}`)
  }
  if (schema.const !== undefined && value !== schema.const) {
    pushError(errors, pathStr, 'const',
      `取值必须为 ${JSON.stringify(schema.const)}，实际为 ${JSON.stringify(value)}`)
  }
}

function checkNumber (value, schema, pathStr, errors) {
  if (typeof value !== 'number' || Number.isNaN(value)) return
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    pushError(errors, pathStr, 'minimum', `数值 ${value} 小于下限 ${schema.minimum}`)
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    pushError(errors, pathStr, 'maximum', `数值 ${value} 大于上限 ${schema.maximum}`)
  }
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
    pushError(errors, pathStr, 'exclusiveMinimum', `数值 ${value} 必须严格大于 ${schema.exclusiveMinimum}`)
  }
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
    pushError(errors, pathStr, 'exclusiveMaximum', `数值 ${value} 必须严格小于 ${schema.exclusiveMaximum}`)
  }
  if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
    const ratio = value / schema.multipleOf
    if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
      pushError(errors, pathStr, 'multipleOf', `数值 ${value} 不是 ${schema.multipleOf} 的整数倍`)
    }
  }
}

function checkString (value, schema, pathStr, errors) {
  if (typeof value !== 'string') return
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    pushError(errors, pathStr, 'minLength', `字符串长度 ${value.length} 小于下限 ${schema.minLength}`)
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    pushError(errors, pathStr, 'maxLength', `字符串长度 ${value.length} 大于上限 ${schema.maxLength}`)
  }
  if (typeof schema.pattern === 'string') {
    let re
    try { re = new RegExp(schema.pattern) } catch (_) { re = null }
    if (re && !re.test(value)) {
      pushError(errors, pathStr, 'pattern', `字符串不匹配模式 ${schema.pattern}`)
    }
  }
  if (typeof schema.format === 'string') {
    const fmt = schema.format.toLowerCase()
    if (FORMATS[fmt]) {
      const ok = FORMATS[fmt](value)
      if (!ok) pushError(errors, pathStr, 'format', `字符串不满足 ${schema.format} 格式`)
    }
  }
}

/**
 * `format` 断言（上游实际用到 `date` / `date-time` / `uri`）。
 * 未登记的 format 名**不报错**（JSON Schema 规定 format 默认是「提示」而非「断言」），
 * 但登记过的必须真的校验 ⇒ 不能悄悄放行。
 */
const FORMATS = Object.freeze({
  date: v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)),
  'date-time': v => !Number.isNaN(Date.parse(v)),
  uri: v => /^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]+$/.test(v),
  url: v => /^https?:\/\/[^\s]+$/i.test(v),
  email: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
})

function checkArray (value, schema, pathStr, errors) {
  if (!Array.isArray(value)) return
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    pushError(errors, pathStr, 'minItems', `数组长度 ${value.length} 小于下限 ${schema.minItems}`)
  }
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    pushError(errors, pathStr, 'maxItems', `数组长度 ${value.length} 大于上限 ${schema.maxItems}`)
  }
  if (schema.uniqueItems === true) {
    const seen = new Set(value.map(v => JSON.stringify(v)))
    if (seen.size !== value.length) {
      pushError(errors, pathStr, 'uniqueItems', '数组存在重复元素')
    }
  }
  if (schema.prefixItems && Array.isArray(schema.prefixItems)) {
    schema.prefixItems.forEach((sub, i) => {
      if (i < value.length) validateNode(value[i], sub, `${pathStr}[${i}]`, errors, null)
    })
  }
  if (schema.items !== undefined) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach((sub, i) => {
        if (i < value.length) validateNode(value[i], sub, `${pathStr}[${i}]`, errors, null)
      })
    } else {
      value.forEach((item, i) => validateNode(item, schema.items, `${pathStr}[${i}]`, errors, null))
    }
  }
  if (schema.contains !== undefined) {
    const ok = value.some(item => {
      const sub = []
      validateNode(item, schema.contains, pathStr, sub, null)
      return sub.length === 0
    })
    if (!ok) pushError(errors, pathStr, 'contains', '数组没有元素满足 contains 约束')
  }
}

function checkObject (value, schema, pathStr, errors, root) {
  if (!isPlainObject(value)) return
  const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : null
  const required = Array.isArray(schema.required) ? schema.required : []
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      pushError(errors, pathStr ? `${pathStr}.${key}` : key, 'required', `缺少必填字段 ${key}`)
    }
  }
  if (props) {
    for (const [key, sub] of Object.entries(props)) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      validateNode(value[key], sub, pathStr ? `${pathStr}.${key}` : key, errors, root)
    }
  }
  if (typeof schema.minProperties === 'number' && Object.keys(value).length < schema.minProperties) {
    pushError(errors, pathStr, 'minProperties', `对象字段数少于下限 ${schema.minProperties}`)
  }
  if (typeof schema.maxProperties === 'number' && Object.keys(value).length > schema.maxProperties) {
    pushError(errors, pathStr, 'maxProperties', `对象字段数大于上限 ${schema.maxProperties}`)
  }
  if (schema.patternProperties && typeof schema.patternProperties === 'object') {
    for (const [pattern, sub] of Object.entries(schema.patternProperties)) {
      let re
      try { re = new RegExp(pattern) } catch (_) { re = null }
      if (!re) continue
      for (const [key, val] of Object.entries(value)) {
        if (re.test(key)) validateNode(val, sub, pathStr ? `${pathStr}.${key}` : key, errors, root)
      }
    }
  }
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(props || {}))
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        pushError(errors, pathStr ? `${pathStr}.${key}` : key, 'additionalProperties',
          `不允许的额外字段 ${key}`)
      }
    }
  } else if (isPlainObject(schema.additionalProperties)) {
    for (const [key, val] of Object.entries(value)) {
      if (props && Object.prototype.hasOwnProperty.call(props, key)) continue
      validateNode(val, schema.additionalProperties, pathStr ? `${pathStr}.${key}` : key, errors, root)
    }
  }
}

/**
 * 校验单个节点。
 * @param {*} value 被校验值
 * @param {object} schema 当前节点的 schema
 * @param {string} pathStr 路径（JSON Pointer 风格）
 * @param {Array} errors 错误收集器
 * @param {object|null} root 根 schema（供 $ref 解析）
 */
function validateNode (value, schema, pathStr, errors, root) {
  if (!schema || typeof schema !== 'object') return
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root)
    if (!resolved) {
      pushError(errors, pathStr, '$ref', `无法解析的本地引用 ${schema.$ref}`)
      return
    }
    validateNode(value, resolved, pathStr, errors, root)
    return
  }
  checkType(value, schema, pathStr, errors)
  checkEnumConst(value, schema, pathStr, errors)
  checkNumber(value, schema, pathStr, errors)
  checkString(value, schema, pathStr, errors)
  checkArray(value, schema, pathStr, errors)
  checkObject(value, schema, pathStr, errors, root)

  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    for (const sub of schema.allOf) validateNode(value, sub, pathStr, errors, root)
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    const ok = schema.anyOf.some(sub => {
      const subErrors = []
      validateNode(value, sub, pathStr, subErrors, root)
      return subErrors.length === 0
    })
    if (!ok) pushError(errors, pathStr, 'anyOf', '取值不满足 anyOf 中任何一个分支')
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    const matched = schema.oneOf.filter(sub => {
      const subErrors = []
      validateNode(value, sub, pathStr, subErrors, root)
      return subErrors.length === 0
    }).length
    if (matched !== 1) {
      pushError(errors, pathStr, 'oneOf',
        `取值必须恰好满足 oneOf 中的一个分支，实际满足 ${matched} 个`)
    }
  }
  if (schema.not !== undefined) {
    const subErrors = []
    validateNode(value, schema.not, pathStr, subErrors, root)
    if (subErrors.length === 0) pushError(errors, pathStr, 'not', '取值不得满足 not 约束')
  }
  if (schema.if !== undefined) {
    const ifErrors = []
    validateNode(value, schema.if, pathStr, ifErrors, root)
    const branch = ifErrors.length === 0 ? schema.then : schema.else
    if (branch !== undefined) validateNode(value, branch, pathStr, errors, root)
  }
}

/**
 * 校验一个 artifact。
 * @param {*} artifact 待校验产物
 * @param {string} schemaName SCHEMA_FILES 的键
 * @returns {{ ok: boolean, errors: Array<{path: string, keyword: string, message: string}>, schema: object|null }}
 */
function validate (artifact, schemaName) {
  const schema = loadSchema(schemaName)
  if (!schema) {
    return {
      ok: false,
      errors: [{ path: '$', keyword: 'schema', message: `未知 schema 名称 ${schemaName}` }],
      schema: null,
    }
  }
  const errors = []
  validateNode(artifact, schema, '', errors, schema)
  return { ok: errors.length === 0, errors, schema }
}

/**
 * 用**内联 schema** 校验一个值（不经 SCHEMA_FILES 命名）。
 * 用途：① 测试对上游 schema 里嵌套很深、难以定位的关键字（oneOf / exclusiveMinimum…）
 * 做行为级验证；② 将来引入自研 schema 时复用同一套校验语义。
 * @param {*} value 待校验值
 * @param {object} schema schema 对象
 * @returns {{ ok: boolean, errors: Array<{path: string, keyword: string, message: string}> }}
 */
function validateAgainstSchema (value, schema) {
  const errors = []
  validateNode(value, schema, '', errors, schema)
  return { ok: errors.length === 0, errors }
}

/**
 * 收集一个 schema 全文里出现过的**全部**键（供覆盖自检用）。
 * @param {object} node schema 节点
 * @param {Set<string>} out 收集器
 */
function collectKeywords (node, out = new Set()) {
  if (Array.isArray(node)) {
    node.forEach(item => collectKeywords(item, out))
    return out
  }
  if (!node || typeof node !== 'object') return out
  for (const [key, value] of Object.entries(node)) {
    out.add(key)
    if (key === 'properties' || key === '$defs' || key === 'definitions') {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(sub => collectKeywords(sub, out))
      }
    } else if (key === 'items' || key === 'additionalProperties' || key === 'contains' ||
               key === 'not' || key === 'if' || key === 'then' || key === 'else') {
      collectKeywords(value, out)
    } else if (key === 'oneOf' || key === 'anyOf' || key === 'allOf' || key === 'prefixItems') {
      collectKeywords(value, out)
    } else if (key === 'patternProperties') {
      if (value && typeof value === 'object') {
        Object.values(value).forEach(sub => collectKeywords(sub, out))
      }
    }
  }
  return out
}

module.exports = {
  SUPPORTED_KEYWORDS,
  METADATA_KEYWORDS,
  SCHEMA_FILES,
  SCHEMA_ROOT,
  loadSchema,
  clearSchemaCache,
  validate,
  validateAgainstSchema,
  collectKeywords,
}
