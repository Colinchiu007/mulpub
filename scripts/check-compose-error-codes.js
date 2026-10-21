#!/usr/bin/env node
/**
 * check-compose-error-codes.js — compose 稳定错误码 ↔ locale 文案 一致性门禁
 *
 * 背景（2026-10-20 事故 error-message-user-friendly-audit）：compose 预检失败把英文技术
 * message 原样落库，历史记录失败卡片直出 `Input media exceeds the total size limit`。
 * 根因之一是「新增错误码要同时改三处（主进程常量 / 渲染端映射表 / zh+en 文案）」纯靠自觉，
 * 漏一处就静默渲染成 i18n key 原文或英文原文。本脚本把这条约束变成机械判据。
 *
 * 判据（三条，任一不过即 rc=1）：
 *   1. 主进程 COMPOSE_ERROR_CODES 与渲染端 COMPOSE_ERROR_KEY_MAP 的键集合**完全相等**；
 *   2. 每个映射值（`story2video.compose_*`）在 locales/story2video/zh.js 与 en.js **均存在**且为字符串；
 *   3. 每个 locale 文案里的 `{占位符}` 都能被主进程 messageParams 的键覆盖（防「文案要 scene 但没人传」）。
 *
 * 为什么放 scripts/ 而不是 .github/scripts/：与 check-unwired-tests.js 的登记口径一致，
 * 且本脚本只 require node 内置模块（可被 quality-gate.yml 的 changes job 直接调用，该 job 无 Install deps）。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const ENGINE = path.join(ROOT, 'apps', 'desktop', 'electron', 'services', 'story2video-compose-engine.js')
const HISTORY_UTILS = path.join(ROOT, 'apps', 'desktop', 'src', 'views', 'history-utils.js')
const ZH = path.join(ROOT, 'apps', 'desktop', 'src', 'locales', 'story2video', 'zh.js')
const EN = path.join(ROOT, 'apps', 'desktop', 'src', 'locales', 'story2video', 'en.js')

const problems = []

function read (file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    problems.push(`读取失败 ${path.relative(ROOT, file)}: ${error.message}`)
    return ''
  }
}

/**
 * 需要校验「文案占位符 ⇐ 主进程 messageParams」的错误码。
 *
 * 只列本次（2026-10-20）新增/接线的码。既有码（如 COMPOSE_DURATION_EXCEEDED 的
 * {limitMinutes}）由 `story2video-notifications.js` 的 normalizeParams 归一化分支
 * 从原文/参数二次推导，不在主进程 composeFailure 的 messageParams 里，机械扫会误报；
 * 那些码的一致性由既有测试（notifications.test.js / pipeline-error-formatter.test.js）守护。
 */
const PARAM_COVERAGE_CODES = new Set([
  'COMPOSE_INPUT_SIZE_EXCEEDED',
  'COMPOSE_SCENE_MEDIA_UNREADABLE',
  'COMPOSE_SCENE_AUDIO_UNREADABLE',
])

/**
 * 需要校验「文案占位符 ⇐ 主进程 messageParams」的错误码。
 *
 * 只列本次（2026-10-20）新增/接线的码。既有码（如 COMPOSE_DURATION_EXCEEDED 的
 * {limitMinutes}）由 `story2video-notifications.js` 的 normalizeParams 归一化分支
 * 从原文/参数二次推导，不在主进程 composeFailure 的 messageParams 里，机械扫会误报；
 * 那些码的一致性由既有测试（notifications.test.js / pipeline-error-formatter.test.js）守护。
 */
/** 从 `const X = Object.freeze({ A: 'a', B: 'b', })` 形态提取**值**集合（错误码值带 COMPOSE_ 前缀） */
function extractFrozenValues (source, constName) {
  const start = source.indexOf(`const ${constName} = Object.freeze({`)
  if (start === -1) return null
  const open = source.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return null
  const body = source.slice(open + 1, end)
  const values = []
  for (const match of body.matchAll(/:\s*'(COMPOSE_[A-Z0-9_]+)'/g)) values.push(match[1])
  return values
}

/** 从 `KEY: 'story2video.compose_xxx',` 形态提取 错误码 → locale key 映射 */
function extractKeyMap (source) {
  const start = source.indexOf('export const COMPOSE_ERROR_KEY_MAP = Object.freeze({')
  if (start === -1) return null
  const open = source.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return null
  const body = source.slice(open + 1, end)
  const map = {}
  for (const match of body.matchAll(/^\s*(COMPOSE_[A-Z0-9_]*)\s*:\s*'([^']+)'/gm)) {
    map[match[1]] = match[2]
  }
  return map
}

/** 从 locale 源文件取 `key: '...'` 的字符串值（只取 story2video 顶层命名空间下的键） */
function extractLocaleString (source, key) {
  const match = source.match(new RegExp(`^\\s*${key}\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'm'))
  if (!match) return null
  // 还原 JS 字符串转义（\uXXXX / \' / \\）
  try {
    return JSON.parse(`"${match[1].replace(/"/g, '\\"')}"`)
  } catch {
    return match[1]
  }
}

const engineSrc = read(ENGINE)
const utilsSrc = read(HISTORY_UTILS)
const zhSrc = read(ZH)
const enSrc = read(EN)

const engineCodes = extractFrozenValues(engineSrc, 'COMPOSE_ERROR_CODES')
if (engineCodes === null) {
  problems.push(`未在 ${path.relative(ROOT, ENGINE)} 找到 COMPOSE_ERROR_CODES = Object.freeze({...})`)
} else if (engineCodes.length === 0) {
  problems.push('COMPOSE_ERROR_CODES 为空——预检失败必须至少登记一个稳定错误码')
}

const keyMap = extractKeyMap(utilsSrc)
if (keyMap === null) {
  problems.push(`未在 ${path.relative(ROOT, HISTORY_UTILS)} 找到 COMPOSE_ERROR_KEY_MAP = Object.freeze({...})`)
}

if (engineCodes && keyMap) {
  const engineSet = new Set(engineCodes)
  const mapSet = new Set(Object.keys(keyMap))

  for (const code of engineSet) {
    if (!mapSet.has(code)) problems.push(`主进程错误码 ${code} 未登记到 COMPOSE_ERROR_KEY_MAP（渲染端会回落英文原文）`)
  }
  for (const code of mapSet) {
    if (!engineSet.has(code)) problems.push(`COMPOSE_ERROR_KEY_MAP 中的 ${code} 在主进程 COMPOSE_ERROR_CODES 不存在（陈旧条目）`)
  }

  for (const [code, localeKey] of Object.entries(keyMap)) {
    const leaf = localeKey.replace(/^story2video\./, '')
    const zhText = extractLocaleString(zhSrc, leaf)
    const enText = extractLocaleString(enSrc, leaf)
    if (zhText === null) problems.push(`${code} → ${localeKey} 在 locales/story2video/zh.js 缺失`)
    if (enText === null) problems.push(`${code} → ${localeKey} 在 locales/story2video/en.js 缺失`)

    // 占位符覆盖：文案里的 {xxx} 必须能在主进程 messageParams 键集合里找到。
    // 主进程侧以 composeFailure 调用的 messageParams 字面量为准（脚本按码收集）。
    const placeholders = new Set()
    for (const text of [zhText, enText]) {
      if (typeof text !== 'string') continue
      for (const m of text.matchAll(/\{(\w+)\}/g)) placeholders.add(m[1])
    }
    const provided = PARAM_COVERAGE_CODES.has(code) ? collectMessageParamKeys(engineSrc, code) : null
    for (const ph of placeholders) {
      if (provided && !provided.has(ph)) {
        problems.push(`${code} 文案占位符 {${ph}} 在主进程 messageParams 中未提供（会渲染成空占位符）`)
      }
    }
  }
}

/**
 * 第五侧：渲染端源码里**硬编码的 'COMPOSE_*' 字面量**。
 *
 * 动因（CCG 外部评审 i3，2026-10-20）：`story2video-notifications.js` 的 resolveMessageKey
 * 直接拿 `notification?.errorCode === 'COMPOSE_INPUT_SIZE_EXCEEDED'` 这类字面量做分支判断。
 * 这些字面量不在「主进程常量 / 映射表 / locale 文案」三侧之内 ⇒ 主进程改了码名，
 * 本门禁全绿而那条分支静默失效，用户又回落成英文原文——正是本 change 要消灭的形态。
 *
 * 判据：扫渲染端被点名的文件，凡出现 `'COMPOSE_XXX'` 字面量，XXX 必须在主进程常量集合里。
 * 只扫字面量、不扫注释（注释里讲码名是正常的文档行为）。
 */
function findHardcodedComposeCodes (source) {
  const found = new Set()
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const line of withoutBlockComments.split(/\r?\n/)) {
    if (/^\s*\/\//.test(line)) continue
    for (const m of line.matchAll(/'((?:COMPOSE_)[A-Z0-9_]+)'/g)) found.add(m[1])
  }
  return found
}

/**
 * 收集某个错误码在主进程 composeFailure(...) 调用里给出的 messageParams 键。
 *
 * 做法：以 `COMPOSE_ERROR_CODES.<码>` 为锚点，取其后**第一个** `{ ... }` 对象字面量
 * ——即 composeFailure 的第三个参数（messageParams）。锚点到该对象之间不会出现别的
 * 花括号对象（调用形态固定为 `composeFailure(CODES.X, '诊断原文', { ...params })`），
 * 若未来改成多行/嵌套写法导致取错，本函数的返回会缺键 → 门禁报「占位符未提供」，
 * 属于 fail-closed 方向（误报而非漏报）。
 */
function collectMessageParamKeys (source, codeValue) {
  const keys = new Set()
  // codeValue 是错误码**值**（如 COMPOSE_INPUT_SIZE_EXCEEDED），主进程以
  // `COMPOSE_ERROR_CODES.<常量名>` 引用，常量名 = 值去掉 COMPOSE_ 前缀。
  const constName = codeValue.replace(/^COMPOSE_/, '')
  const marker = `COMPOSE_ERROR_CODES.${constName}`
  let cursor = source.indexOf(marker)
  while (cursor !== -1) {
    const open = source.indexOf('{', cursor)
    if (open === -1) break
    let depth = 0
    let end = -1
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    if (end === -1) break
    const body = source.slice(open + 1, end)
    // 键名识别：允许前置空白（含 CRLF 的 \r）与逗号/花括号，不要求特定行首字符。
    for (const m of body.matchAll(/(?:^|[,{\s])\s*([a-z][A-Za-z0-9]*)\s*:/g)) keys.add(m[1])
    cursor = source.indexOf(marker, end)
  }
  return keys
}

// ── 第五侧：渲染端硬编码的 'COMPOSE_*' 字面量（CCG 评审 i3）──
// 这些字面量不进「常量 / 映射表 / 文案」三侧，改码名时门禁全绿而分支静默失效。
//
// 扫描目标若不存在则**跳过**（自测沙箱只造四份夹具，不复制整个渲染端目录）。
// 这不构成逃逸：`check-compose-error-codes.test.js` 有一条针对**真实仓库**的断言，
// 要求本清单里的每个文件都存在且确实包含字面量——删掉文件会让那条断言变红。
const HARDCODED_LITERAL_SCAN = [
  'apps/desktop/src/story2video/story2video-notifications.js',
]
if (engineCodes) {
  const engineSet = new Set(engineCodes)
  for (const rel of HARDCODED_LITERAL_SCAN) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) continue
    let src = ''
    try {
      src = fs.readFileSync(abs, 'utf8')
    } catch (error) {
      problems.push(`读取失败 ${rel}: ${error.message}`)
      continue
    }
    for (const literal of findHardcodedComposeCodes(src)) {
      if (!engineSet.has(literal)) {
        problems.push(`${rel} 硬编码了 '${literal}'，但它在主进程 COMPOSE_ERROR_CODES 里不存在（分支会静默失效、用户回落英文原文）`)
      }
    }
  }
}

if (problems.length > 0) {
  console.error('[compose-error-codes] FAIL')
  for (const p of problems) console.error('  - ' + p)
  console.error('')
  console.error('修复方向：新增/修改 compose 稳定错误码时，三处必须同改——')
  console.error('  ① apps/desktop/electron/services/story2video-compose-engine.js 的 COMPOSE_ERROR_CODES + composeFailure(...) 的 messageParams')
  console.error('  ② apps/desktop/src/views/history-utils.js 的 COMPOSE_ERROR_KEY_MAP')
  console.error('  ③ apps/desktop/src/locales/story2video/{zh,en}.js 的 compose_* 文案（zh/en 成对）')
  console.error('  ④ 渲染端若硬编码了 \'COMPOSE_*\' 字面量，码名必须与 ① 一致（第五侧校验）')
  process.exit(1)
}

const count = engineCodes ? engineCodes.length : 0
console.log(`[compose-error-codes] PASS（${count} 个稳定错误码，主进程常量 / 渲染端映射 / zh+en 文案 / messageParams 占位符 / 渲染端硬编码字面量 五侧一致）`)
