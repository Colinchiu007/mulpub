#!/usr/bin/env node
/**
 * check-locale-sync.js — i18n-content-sync 提交门禁（L1）
 *
 * 1) --pair-base <ref>：locale 文件必须 zh/en 成对出现在同一提交。
 *    检查 <ref>...HEAD 的 diff：apps/desktop/src/locales/zh.js 与 en.js 必须同时变更。
 *    典型用法：CI 传 --pair-base origin/main。
 *
 * 2) --cjk：渲染端硬编码中文字符串扫描（基线增量式）。
 *    扫描 apps/desktop/src 下非 locales 的 .js 文件与 .vue 的 <script> 块中的字符串字面量；
 *    与 .github/scripts/locale-cjk-baseline.json 基线对比，超出基线的「新增」命中即失败（exit 1）。
 *    --update-baseline 重新生成基线（存量债务吸收用，禁用于掩盖新增硬编码）。
 *
 * 3) --keys：渲染端「使用的 i18n key 必须存在于 zh/en locale」扫描。
 *
 * 4) --py-cjk：python-backend 用户可见中文消息扫描（基线增量式，2026-09-12 补洞）。
 *    扫描 packages/python-backend/src 下 .py 的 raise 语句字符串字面量；
 *    与 .github/scripts/locale-py-cjk-baseline.json 基线对比，超出基线的新增命中即失败（exit 1）。
 *    新增用户可见错误必须改走 UserVisibleError(error_code) 稳定错误码 + 渲染端 locale 文案，
 *    不得新增硬编码中文 raise（存量债务进入基线，--update-py-baseline 显式吸收）。
 *    扫描 apps/desktop/src 下非 locales 的 .js/.vue 中 t('...') / te('...') /
 *    notify* / notifyConfirm('...') 的字符串 key，逐一验证 zh.js 与 en.js 均存在。
 *    防止 vue-i18n 对缺失 key 原样返回（如 accountsPage.loginExpiredHint 泄漏到 UI）。
 *
 * 已知边界（2026-08-14）：CJK 基线按 file:line 存储，行号偏移（如 BGM 素材库新增 215 行）会触发全量 fresh 假阳性——修复方式为显式 --update-baseline（无新增用户可见硬编码时）。
 * 已知边界（2026-08-13）：
 * - 仅覆盖 .js 与 .vue <script>；.vue <template> 文案由 ui-i18n 存量批次收敛，不在本扫描范围。
 * - 注释剥离为启发式（块注释 + 行注释），正则字面量中的中文不匹配字符串提取，不会误报。
 * - utils/user-facing-error.js 是 errorCode→文案目录（既有 SSOT 之一），显式豁免；
 *   语料源收敛（并入 locales）后再移除豁免。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC_DIR = path.join(ROOT, 'apps', 'desktop', 'src')
const PY_SRC_DIR = path.join(ROOT, 'packages', 'python-backend', 'src')
const BASELINE_FILE = path.join(__dirname, 'locale-cjk-baseline.json')
const PY_BASELINE_FILE = path.join(__dirname, 'locale-py-cjk-baseline.json')
const CJK = /[\u4e00-\u9fff]/

function parseArgs () {
  const args = process.argv.slice(2)
  const opts = { pairBase: null, cjk: false, keys: false, pyCjk: false, updateBaseline: false, updatePyBaseline: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pair-base') opts.pairBase = args[++i]
    else if (args[i] === '--cjk') opts.cjk = true
    else if (args[i] === '--keys') opts.keys = true
    else if (args[i] === '--py-cjk') opts.pyCjk = true
    else if (args[i] === '--update-baseline') opts.updateBaseline = true
    else if (args[i] === '--update-py-baseline') opts.updatePyBaseline = true
    else {
      console.error(`unknown option: ${args[i]}`)
      process.exit(2)
    }
  }
  return opts
}

function gitDiffNameOnly (base) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return out.split('\n').map(s => s.trim()).filter(Boolean)
}

function runPairCheck (base) {
  let changed
  try {
    changed = gitDiffNameOnly(base)
  } catch (err) {
    console.error(`[locale-sync] 无法计算 ${base}...HEAD diff：${err.message}`)
    console.error('[locale-sync] 请确认 base ref 存在（CI 中先 git fetch origin main）')
    process.exit(2)
  }
  const zhFile = 'apps/desktop/src/locales/zh.js'
  const enFile = 'apps/desktop/src/locales/en.js'
  const zhChanged = changed.includes(zhFile)
  const enChanged = changed.includes(enFile)
  if (zhChanged && !enChanged) {
    console.error(`[locale-sync] FAIL：本提交只修改了 ${zhFile}，未成对修改 ${enFile}`)
    console.error('[locale-sync] 修改 locale 文件必须 zh/en 成对提交（i18n-content-sync L1）')
    process.exit(1)
  }
  if (enChanged && !zhChanged) {
    console.error(`[locale-sync] FAIL：本提交只修改了 ${enFile}，未成对修改 ${zhFile}`)
    console.error('[locale-sync] 修改 locale 文件必须 zh/en 成对提交（i18n-content-sync L1）')
    process.exit(1)
  }
  console.log(`[locale-sync] pair check PASS（${zhFile} 变更=${zhChanged}，${enFile} 变更=${enChanged}）`)
}

function toPosixRel (file) {
  return path.relative(ROOT, file).split(String.fromCharCode(92)).join('/')
}

/** python-backend 用户可见消息扫描：raise 语句字符串字面量中的中文（i18n 机制补洞，2026-09-12）。 */
function scanPyUserVisibleCjk (file) {
  const raw = fs.readFileSync(file, 'utf8')
  const stripped = raw
    .replace(/'''[\s\S]*?'''/g, '\n')
    .replace(/"""[\s\S]*?"""/g, '\n')
    .replace(/(^|[^:"'\\])#[^\n]*/g, '$1\n')
  const hits = []
  stripped.split('\n').forEach((line, idx) => {
    if (!/\braise\s+\w/.test(line)) return
    // 豁免 1：UserVisibleError(error_code, "中文兜底") —— 第二参是设计允许的
    // 错误码无法识别时的最后防线兜底，渲染端正常路径只读 error_code 查 locale。
    if (/raise\s+UserVisibleError\s*\(/.test(line)) return
    // 豁免 2：detail={"error_code": ..., "message": "中文兜底"} —— 同上，
    // detail 对象内的 message 是错误码兜底，非直出路径。
    if (/error_code/.test(line) && /message/.test(line)) return
    const matcher = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g
    let m
    while ((m = matcher.exec(line)) !== null) {
      if (CJK.test(m[2])) {
        const rel = toPosixRel(file)
        hits.push({ id: rel + ':' + (idx + 1), file: rel, snippet: m[2].slice(0, 60).replace(/\s+/g, ' ') })
      }
    }
  })
  return hits
}

function runPyCjkScan (opts) {
  const files = listFiles(PY_SRC_DIR).filter(f => f.endsWith('.py'))
  const hits = []
  for (const file of files) hits.push(...scanPyUserVisibleCjk(file))

  if (opts.updatePyBaseline) {
    // 与渲染端同一口径：按「文件 + 文案内容」入基线，行号漂移不产生假阳性。
    const baseline = [...new Set(hits.map(h => h.file + '||' + h.snippet))].sort()
    fs.writeFileSync(PY_BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n')
    console.log('[locale-sync] python CJK baseline updated: ' + baseline.length + ' entries (' + PY_BASELINE_FILE + ')')
    process.exit(0)
  }

  let baseline
  try {
    baseline = new Set(JSON.parse(fs.readFileSync(PY_BASELINE_FILE, 'utf8')))
  } catch (_) {
    console.error('[locale-sync] FAIL: cannot read python CJK baseline ' + PY_BASELINE_FILE + '; first-time init requires --update-py-baseline')
    process.exit(1)
  }
  const contentBaseline = resolveContentBaseline(baseline, hits)
  const fresh = hits.filter(h => !contentBaseline.has(h.file + '||' + h.snippet))
  const byFile = {}
  for (const h of fresh) {
    ;(byFile[h.file] = byFile[h.file] || []).push(h)
  }
  if (fresh.length > 0) {
    console.error('[locale-sync] FAIL: python-backend has ' + fresh.length + ' new hardcoded CJK user-visible messages (baseline ' + baseline.size + ')')
    for (const [file, list] of Object.entries(byFile)) {
      console.error('  ' + file)
      for (const h of list.slice(0, 8)) console.error('    ' + h.id + '  "' + h.snippet + '"')
      if (list.length > 8) console.error('    ... ' + list.length + ' total')
    }
    console.error('[locale-sync] python-backend user-visible errors must use UserVisibleError(error_code) + renderer locale copy (user-facing-messages rule); baseline refresh requires explicit --update-py-baseline')
    process.exit(1)
  }
  console.log('[locale-sync] python CJK scan PASS (baseline ' + baseline.size + ', no new hardcoded messages)')
}

function shouldScanFile (file) {
  const rel = toPosixRel(file)
  if (rel.startsWith('apps/desktop/src/locales/')) return false
  if (rel.endsWith('.test.js') || rel.endsWith('.spec.js')) return false
  if (rel.includes('/__tests__/')) return false
  return true
}

function listFiles (dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full))
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.vue')) out.push(full)
    else if (entry.name.endsWith('.py')) out.push(full)
  }
  return out
}

function scriptBlockOf (source) {
  const m = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)
  return m ? m[1] : ''
}

function templateBlockOf (source) {
  const m = source.match(/<template[^>]*>([\s\S]*?)<\/template>/)
  return m ? m[1] : ''
}

/** .vue <template> 块扫描：注释剥离后检测「属性值」与「标签间文本」中的中文字面量（i18n-sync-hardening R1）。 */
function scanTemplateCjk (file) {
  const raw = fs.readFileSync(file, 'utf8')
  const template = templateBlockOf(raw)
  if (!template) return []
  const stripped = template.replace(/<!--[\s\S]*?-->/g, '\n')
  const hits = []
  const rel = toPosixRel(file)
  stripped.split('\n').forEach((line, idx) => {
    const attrMatcher = /(["'])((?:\x5c.|(?!\1)[^\x5c])*)\1/g
    let m
    while ((m = attrMatcher.exec(line)) !== null) {
      if (CJK.test(m[2])) {
        hits.push({ id: `${rel}:${idx + 1}`, file: rel, snippet: m[2].slice(0, 60).replace(/\s+/g, ' ') })
      }
    }
    const textOnly = line.replace(/<[^>]*>/g, '')
    if (CJK.test(textOnly)) {
      hits.push({ id: `${rel}:${idx + 1}`, file: rel, snippet: textOnly.trim().slice(0, 60) })
    }
  })
  return hits
}

function scanCjkHits (file) {
  const raw = fs.readFileSync(file, 'utf8')
  const code = file.endsWith('.vue') ? scriptBlockOf(raw) : raw
  const stripped = code
    .replace(/\/\*[\s\S]*?\*\//g, '\n')
    .replace(/(^|[^:"'\x5c])\/\/[^\n]*/g, '$1\n')
  const hits = []
  stripped.split('\n').forEach((line, idx) => {
    const matcher = /(['"`])((?:\x5c.|(?!\1)[^\x5c])*)\1/g
    let m
    while ((m = matcher.exec(line)) !== null) {
      if (CJK.test(m[2])) {
        const rel = toPosixRel(file)
        hits.push({ id: `${rel}:${idx + 1}`, file: rel, snippet: m[2].slice(0, 60).replace(/\s+/g, ' ') })
      }
    }
  })
  if (file.endsWith('.vue')) hits.push(...scanTemplateCjk(file))
  return hits
}

function loadBaseline () {
  try {
    return new Set(JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')))
  } catch (_) {
    return new Set()
  }
}

/** 基线条目形态：旧版 file:line（行号漂移假阳性），新版 file||content。
 * 2026-09-12 修复：按「文件 + 文案内容」存储，文件内行号变化不再产生假阳性 fresh
 * （事故背景：PR #1732 在 PlatformOverridePanel.vue 上方插入代码，18 条基线全部行号偏移，
 *  --cjk 报 18 处假阳性 fresh，且因 Gate 7 退出码缺陷被静默吞掉，双缺陷叠加导致硬编码从未被拦截）。
 * 迁移策略：读取旧基线后，把 file:line 条目归并为 {file: [line...]}；与当前扫描命中按
 * (file, content) 匹配——同文件同内容无论行号多少都算已入基线。
 */
function contentBaselineFrom (legacyBaseline, currentHits) {
  // legacy: Set<string> "path:line" → Map<file, Set<contentSnippet>>（借助当前命中回填内容）
  const legacyLinesByFile = new Map()
  for (const entry of legacyBaseline) {
    const sep = entry.lastIndexOf(':')
    if (sep <= 0) continue
    const file = entry.slice(0, sep)
    const line = Number(entry.slice(sep + 1))
    if (!Number.isFinite(line)) continue
    if (!legacyLinesByFile.has(file)) legacyLinesByFile.set(file, new Set())
    legacyLinesByFile.get(file).add(line)
  }
  // 当前命中按 file:line 索引，把旧基线行号映射为该行当前内容（若该行仍有命中）
  const byLineKey = new Map()
  for (const h of currentHits) byLineKey.set(h.id, h.snippet)
  const contentSet = new Set()
  for (const [file, lines] of legacyLinesByFile) {
    for (const line of lines) {
      const snippet = byLineKey.get(file + ':' + line)
      if (snippet !== undefined) contentSet.add(file + '||' + snippet)
    }
  }
  return contentSet
}

/** 基线双格式解析，--cjk 与 --py-cjk 共用：
 *  新格式（file||content）直接用作内容集；旧格式（file:line）借当前命中回填内容再比较。
 *  2026-09-26：python 侧曾漏掉这次迁移，一次普通的 server.py 上方插入就让 17 条既有基线
 *  整体行号漂移、全部报成「新增硬编码」——与渲染端 PR #1732 事故同一类根因。 */
function resolveContentBaseline (rawBaseline, hits) {
  const isNewFormat = rawBaseline.size === 0 || [...rawBaseline].some((e) => e.includes('||'))
  return isNewFormat ? rawBaseline : contentBaselineFrom(rawBaseline, hits)
}

function runCjkScan (opts) {
  const files = listFiles(SRC_DIR).filter(shouldScanFile)
  const hits = []
  for (const file of files) hits.push(...scanCjkHits(file))

  if (opts.updateBaseline) {
    // 新基线格式：file||content（去重排序）。同文件同内容只记一条，行号无关。
    const baseline = [...new Set(hits.map(h => h.file + '||' + h.snippet))].sort()
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n')
    console.log(`[locale-sync] CJK baseline updated: ${baseline.length} 条（${BASELINE_FILE}）`)
    process.exit(0)
  }

  const baseline = loadBaseline()
  const contentBaseline = resolveContentBaseline(baseline, hits)
  const currentIds = new Set(hits.map(h => h.id))
  const fresh = hits.filter(h => !contentBaseline.has(h.file + '||' + h.snippet))
  const byFile = {}
  for (const h of fresh) {
    const file = h.file
    ;(byFile[file] = byFile[file] || []).push(h)
  }
  if (fresh.length > 0) {
    console.error(`[locale-sync] FAIL：渲染端新增 ${fresh.length} 处硬编码中文字符串（基线 ${baseline.size} 条，当前 ${currentIds.size} 条）`)
    for (const [file, list] of Object.entries(byFile)) {
      console.error(`  ${file}`)
      for (const h of list.slice(0, 8)) console.error(`    ${h.id}  "${h.snippet}"`)
      if (list.length > 8) console.error(`    … 共 ${list.length} 处`)
    }
    console.error('[locale-sync] 用户可见文案必须走 locale（zh/en 成对）；存量基线更新请显式运行 --update-baseline（禁止掩盖新增）')
    process.exit(1)
  }
  console.log(`[locale-sync] CJK scan PASS（基线 ${baseline.size} 条，当前 ${currentIds.size} 条，无新增硬编码）`)
}

/**
 * 收集渲染端源码中使用的 i18n key（t/te/notify 系列/notifyConfirm 的字符串首参）。
 * @returns {Map<string, string[]>} key → 使用文件列表
 */
function collectUsedKeys () {
  const files = listFiles(SRC_DIR).filter(shouldScanFile)
  const used = new Map()
  // 匹配 t('...') / te('...') / notifyX('...') / notifyConfirm('...') / t("...") 等
  const keyRe = /\b(?:t|te|notify|notifyError|notifySuccess|notifyWarning|notifyInfo|notifyConfirm)\s*\(\s*(['"])([^'"]+)\1/g
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8')
    const code = file.endsWith('.vue') ? scriptBlockOf(raw) + '\n' + templateBlockOf(raw) : raw
    let m
    while ((m = keyRe.exec(code)) !== null) {
      const key = m[2]
      // 跳过动态前缀 key（如 'coverCrop.ratio.' + ratio，结尾带点）
      if (!key || !key.includes('.') || key.endsWith('.')) continue
      if (!used.has(key)) used.set(key, [])
      const rel = toPosixRel(file)
      if (!used.get(key).includes(rel)) used.get(key).push(rel)
    }
  }
  return used
}

/** 从 locale 文件加载 key 集合（点分路径叶子）。 */
function loadLocaleKeys (localeFile) {
  const src = fs.readFileSync(localeFile, 'utf8')
  const tree = Function('return (' + src.replace(/^export default\s*/, '') + ')')()
  const keys = new Set()
  ;(function walk (node, prefix) {
    for (const [k, v] of Object.entries(node)) {
      const p = prefix ? prefix + '.' + k : k
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p)
      else keys.add(p)
    }
  })(tree, '')
  return keys
}

/**
 * 校验渲染端使用的 i18n key 必须存在于 zh/en（防 vue-i18n 缺失 key 原样返回泄漏）。
 */
function runKeysCheck () {
  const zhFile = path.join(ROOT, 'apps', 'desktop', 'src', 'locales', 'zh.js')
  const enFile = path.join(ROOT, 'apps', 'desktop', 'src', 'locales', 'en.js')
  let zhKeys, enKeys
  try {
    zhKeys = loadLocaleKeys(zhFile)
    enKeys = loadLocaleKeys(enFile)
  } catch (err) {
    console.error(`[locale-sync] FAIL：无法解析 locale 文件：${err.message}`)
    process.exit(1)
  }
  const used = collectUsedKeys()
  const missing = []
  for (const [key, files] of used) {
    if (!zhKeys.has(key) || !enKeys.has(key)) {
      missing.push({ key, files })
    }
  }
  if (missing.length > 0) {
    console.error(`[locale-sync] FAIL：渲染端使用了 ${missing.length} 个 zh/en 缺失的 i18n key（会导致 vue-i18n 原样返回 key 泄漏到 UI）`)
    for (const { key, files } of missing.slice(0, 30)) {
      console.error(`  ${key}  ← ${files.slice(0, 3).join(', ')}`)
    }
    if (missing.length > 30) console.error(`  … 共 ${missing.length} 处`)
    console.error('[locale-sync] 请将缺失 key 成对补入 apps/desktop/src/locales/zh.js 与 en.js（i18n-user-facing-messages 强制规则）')
    process.exit(1)
  }
  console.log(`[locale-sync] key existence check PASS（${used.size} 个使用中的 key 均存在于 zh/en）`)
}

const opts = parseArgs()
let ran = false
if (opts.pairBase) { runPairCheck(opts.pairBase); ran = true }
if (opts.cjk) { runCjkScan(opts); ran = true }
if (opts.keys) { runKeysCheck(); ran = true }
if (opts.pyCjk) { runPyCjkScan(opts); ran = true }
if (!ran) {
  console.error('用法：node .github/scripts/check-locale-sync.js --pair-base <ref> | --cjk [--update-baseline] | --keys | --py-cjk [--update-py-baseline]')
  process.exit(2)
}
