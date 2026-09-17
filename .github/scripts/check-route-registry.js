#!/usr/bin/env node
/**
 * check-route-registry.js — 路由入口登记门禁（desktop-ui-consistency T0-5，L1）
 *
 * 拦什么：
 * 「路由存在但没人说得清用户从哪进来」的暗路由。src/router/index.js 新增一条非
 * redirect 路由却没有在 src/config/route-registry.js 登记 → 本门禁失败（exit 1）。
 *
 * 校验规则：
 * 1. router/index.js 每条非 redirect 路由都必须在登记表出现（path 一一对应）；
 *    反向也查：登记表里出现 router 没有的 path = 陈旧登记，同样失败。
 * 2. 每条非 redirect 路由必须能回答入口：navEntry 非空，或 internal:true 且 entryFrom 非空；
 *    internal:true 还必须满足 navEntry === null 且 view 非空（redirect 不能标 internal）。
 * 3. 登记表 navEntry 非空的 key 集合必须与 SIDEBAR_MENU_KEY_ORDER 完全一致
 *    （= 侧边栏派生结果 key 集合，防运营中心种子漂移）。
 * 4. view 必须等于 router/index.js 中 import 的视图文件名；redirect 路由 view 必须为 ''。
 * 5. entryFrom 必须指向表内已登记的 path（防登记死链）。
 *
 * 为什么用静态解析而不是 import：
 * 登记表是 ESM 且 import 了 @element-plus/icons-vue（Vue 组件），门禁脚本跑在
 * 无 node_modules 保证的静态门禁阶段；静态解析零依赖、结果确定，不会因依赖安装
 * 状态而给出假绿/假红。解析不到预期结构时一律按失败处理（宁可红，不可静默放行）。
 *
 * 用法：
 *   node .github/scripts/check-route-registry.js           # 默认，失败 exit 1
 *   node .github/scripts/check-route-registry.js --json    # 输出 JSON 明细（供审查代理消费）
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const ROUTER_FILE = path.join(ROOT, 'apps', 'desktop', 'src', 'router', 'index.js')
const REGISTRY_FILE = path.join(ROOT, 'apps', 'desktop', 'src', 'config', 'route-registry.js')

/** navEntry.group 里可能出现的分组常量 → 实际分组值 */
const GROUP_CONSTANTS = { SIDEBAR_GROUP_PRIMARY: 'primary', SIDEBAR_GROUP_MORE: 'more' }

function parseArgs (args) {
  const opts = { json: false }
  for (const a of args) {
    if (a === '--json') opts.json = true
    else throw new Error(`unknown option: ${a}`)
  }
  return opts
}

/**
 * 扫描源码，返回所有「顶层」花括号块（跳过字符串与注释，只统计 {} 深度）。
 * @param {string} source
 * @returns {string[]} 块原文（含花括号）
 */
function scanTopLevelBlocks (source) {
  const blocks = []
  let depth = 0
  let start = -1
  let i = 0
  const n = source.length
  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      const eol = source.indexOf('\n', i)
      i = eol === -1 ? n : eol
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue }
        if (source[i] === quote) { i++; break }
        i++
      }
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
      i++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0 && start !== -1) blocks.push(source.slice(start, i + 1))
      if (depth === 0) start = -1
      i++
      continue
    }
    i++
  }
  return blocks
}

/** 从 openIdx（字符必须是 '{'）起做花括号配对，返回闭合下标（不含则为 -1） */
function matchBrace (source, openIdx) {
  let depth = 0
  let i = openIdx
  const n = source.length
  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') { const eol = source.indexOf('\n', i); i = eol === -1 ? n : eol; continue }
    if (ch === '/' && next === '*') { const end = source.indexOf('*/', i + 2); i = end === -1 ? n : end + 2; continue }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue }
        if (source[i] === quote) { i++; break }
        i++
      }
      continue
    }
    if (ch === '{') { depth++; i++; continue }
    if (ch === '}') { depth--; if (depth === 0) return i; i++; continue }
    i++
  }
  return -1
}

/** 取单引号/双引号字符串值；null/undefined 字面量返回 null */
function readStringOrNull (raw) {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (s === 'null' || s === 'undefined' || s === '') return null
  const m = /^['"]([\s\S]*?)['"]$/.exec(s)
  return m ? m[1] : s
}

/** 从块原文里取出某个字段的值片段（不跨嵌套块） */
function fieldRaw (block, field) {
  const re = new RegExp(`(?:^|[,{\\s])${field}\\s*:`)
  const m = re.exec(block)
  if (!m) return undefined
  let i = m.index + m[0].length
  // 跳过空白
  while (i < block.length && /\s/.test(block[i])) i++
  const ch = block[i]
  if (ch === '{') {
    const close = matchBrace(block, i)
    return close === -1 ? undefined : block.slice(i, close + 1)
  }
  if (ch === "'" || ch === '"') {
    const quote = ch
    let j = i + 1
    while (j < block.length) {
      if (block[j] === '\\') { j += 2; continue }
      if (block[j] === quote) { j++; break }
      j++
    }
    return block.slice(i, j)
  }
  let j = i
  while (j < block.length && ![',', '}', '\n'].includes(block[j])) j++
  return block.slice(i, j)
}

/**
 * 解析 src/router/index.js 的路由声明。
 * @returns {{ routes: Array<{path:string, name:string|null, view:string, redirect:string|null, line:number}>, parseErrors: string[] }}
 */
function parseRouterRoutes (source) {
  const routes = []
  const parseErrors = []
  const lines = source.split('\n')
  lines.forEach((line, idx) => {
    if (!/\{\s*path:/.test(line)) return
    const lineNo = idx + 1
    const pathMatch = /path:\s*['"]([^'"]+)['"]/.exec(line)
    if (!pathMatch) {
      parseErrors.push(`router/index.js:${lineNo} 无法解析 path：${line.trim()}`)
      return
    }
    const redirectMatch = /redirect:\s*['"]([^'"]*)['"]/.exec(line)
    if (redirectMatch) {
      routes.push({ path: pathMatch[1], name: null, view: '', redirect: redirectMatch[1], line: lineNo })
      return
    }
    const nameMatch = /name:\s*['"]([^'"]+)['"]/.exec(line)
    const viewMatch = /import\(\s*['"]@\/views\/([^'"]+)['"]\s*\)/.exec(line)
    if (!nameMatch || !viewMatch) {
      parseErrors.push(`router/index.js:${lineNo} 既不是 redirect、也缺少 name/component，无法归类：${line.trim()}`)
      return
    }
    routes.push({ path: pathMatch[1], name: nameMatch[1], view: viewMatch[1], redirect: null, line: lineNo })
  })
  return { routes, parseErrors }
}

/** 从登记表块里解析 navEntry */
function parseNavEntry (block) {
  const raw = fieldRaw(block, 'navEntry')
  if (raw === undefined) return { missing: true, navEntry: null }
  const trimmed = String(raw).trim()
  if (trimmed === 'null') return { missing: false, navEntry: null }
  if (!trimmed.startsWith('{')) return { missing: true, navEntry: null }
  const groupRaw = readStringOrNull(fieldRaw(trimmed, 'group'))
  return {
    missing: false,
    navEntry: {
      key: readStringOrNull(fieldRaw(trimmed, 'key')),
      group: groupRaw && Object.prototype.hasOwnProperty.call(GROUP_CONSTANTS, groupRaw) ? GROUP_CONSTANTS[groupRaw] : groupRaw,
      labelI18nKey: readStringOrNull(fieldRaw(trimmed, 'labelI18nKey')),
      to: readStringOrNull(fieldRaw(trimmed, 'to')),
      hasIcon: /\bicon\s*:/.test(trimmed),
    },
  }
}

/**
 * 解析 src/config/route-registry.js 的登记表。
 * @returns {{ entries: Array<object>, keyOrder: string[], parseErrors: string[] }}
 */
function parseRegistry (source) {
  const parseErrors = []
  const blocks = scanTopLevelBlocks(source).filter((b) => /\bpath\s*:\s*['"]/.test(b))
  if (!blocks.length) parseErrors.push('route-registry.js 未解析到任何登记项（ROUTE_REGISTRY 结构变了？）')

  const entries = blocks.map((block) => {
    const nav = parseNavEntry(block)
    if (nav.missing) parseErrors.push(`route-registry.js 登记项缺少可解析的 navEntry 字段：${block.slice(0, 60).replace(/\s+/g, ' ')}...`)
    const internalRaw = String(fieldRaw(block, 'internal') ?? '').trim()
    return {
      path: readStringOrNull(fieldRaw(block, 'path')),
      name: readStringOrNull(fieldRaw(block, 'name')),
      view: readStringOrNull(fieldRaw(block, 'view')) ?? '',
      internal: internalRaw === 'true',
      entryFrom: readStringOrNull(fieldRaw(block, 'entryFrom')),
      navEntry: nav.navEntry,
    }
  })

  // SIDEBAR_MENU_KEY_ORDER：取该常量后的第一个数组字面量
  // 注意：必须定位到声明处（export const），否则会命中文件头注释里的同名提及
  let keyOrder = []
  const marker = source.indexOf('export const SIDEBAR_MENU_KEY_ORDER')
  if (marker === -1) {
    parseErrors.push('route-registry.js 未找到 SIDEBAR_MENU_KEY_ORDER')
  } else {
    const open = source.indexOf('[', marker)
    if (open === -1) {
      parseErrors.push('route-registry.js 的 SIDEBAR_MENU_KEY_ORDER 不是数组')
    } else {
      let depth = 0
      let close = -1
      for (let i = open; i < source.length; i++) {
        const ch = source[i]
        if (ch === "'" || ch === '"') {
          const quote = ch
          i++
          while (i < source.length) {
            if (source[i] === '\\') { i += 2; continue }
            if (source[i] === quote) break
            i++
          }
          continue
        }
        if (ch === '[') depth++
        else if (ch === ']') { depth--; if (depth === 0) { close = i; break } }
      }
      if (close === -1) parseErrors.push('route-registry.js 的 SIDEBAR_MENU_KEY_ORDER 数组未闭合')
      else keyOrder = (source.slice(open + 1, close).match(/['"]([^'"]+)['"]/g) || []).map((s) => s.slice(1, -1))
    }
  }

  return { entries, keyOrder, parseErrors }
}

/**
 * 核心校验（纯函数，便于单测）。
 * @param {{ routerSource: string, registrySource: string }} input
 * @returns {{ ok: boolean, errors: string[], stats: object }}
 */
function checkRouteRegistry (input) {
  const errors = []
  const { routes, parseErrors: routerParseErrors } = parseRouterRoutes(input.routerSource)
  const { entries, keyOrder, parseErrors: registryParseErrors } = parseRegistry(input.registrySource)
  errors.push(...routerParseErrors, ...registryParseErrors)

  const registryByPath = new Map()
  for (const entry of entries) {
    if (!entry.path) { errors.push('route-registry.js 存在缺少 path 的登记项'); continue }
    if (registryByPath.has(entry.path)) errors.push(`route-registry.js 重复登记：${entry.path}`)
    registryByPath.set(entry.path, entry)
  }

  // 规则 1：router 非 redirect 路由必须登记；登记表的 path 必须都在 router 里
  const routerPaths = new Set(routes.map((r) => r.path))
  for (const route of routes) {
    if (route.redirect) continue
    if (!registryByPath.has(route.path)) {
      errors.push(`未登记路由：${route.path}（router/index.js:${route.line}）—— 请先在 src/config/route-registry.js 登记，字段：path / name / view / navEntry / internal / entryFrom`)
    }
  }
  for (const entry of entries) {
    if (entry.path && !routerPaths.has(entry.path)) errors.push(`陈旧登记：${entry.path} 在 router/index.js 中已不存在，请从 route-registry.js 删除`)
  }

  // 规则 4：view 与 router 的 component 一致；redirect 路由 view 必须为 ''
  for (const route of routes) {
    const entry = registryByPath.get(route.path)
    if (!entry) continue
    if (route.redirect) {
      if (entry.view !== '') errors.push(`redirect 路由 ${route.path} 的 view 必须为 ''（当前 '${entry.view}'）`)
    } else if (entry.view !== route.view) {
      errors.push(`视图不一致：${route.path} router 指向 ${route.view}，登记表写的是 '${entry.view || '（空）'}'`)
    }
  }

  // 规则 2：入口可回答性
  for (const entry of entries) {
    if (!entry.path) continue
    const isRedirect = entry.view === ''
    if (isRedirect) {
      if (entry.internal) errors.push(`redirect 路由 ${entry.path} 不应标记为 internal:true`)
      continue
    }
    if (entry.navEntry) {
      if (entry.internal) errors.push(`${entry.path} 同时有 navEntry 与 internal:true —— 二者互斥，只能选一个`)
      continue
    }
    if (!entry.internal) {
      errors.push(`暗路由未申报：${entry.path} 没有 navEntry 也不是 redirect，必须标 internal:true 并填写 entryFrom（宿主入口路径）`)
      continue
    }
    if (!entry.entryFrom) {
      errors.push(`internal 路由 ${entry.path} 缺少 entryFrom（用户从哪个页面进来？）`)
    }
  }

  // 规则 5：entryFrom 必须指向表内已登记的 path
  for (const entry of entries) {
    if (entry.internal && entry.entryFrom && !registryByPath.has(entry.entryFrom)) {
      errors.push(`entryFrom 死链：${entry.path} 的 entryFrom '${entry.entryFrom}' 不在登记表内`)
    }
  }

  // 规则 3：navEntry key 集合 == SIDEBAR_MENU_KEY_ORDER（= 侧边栏派生结果 key 集合）
  const navKeys = entries.filter((e) => e.navEntry && e.navEntry.key).map((e) => e.navEntry.key)
  const navKeySet = new Set(navKeys)
  const orderSet = new Set(keyOrder)
  const missingInOrder = navKeys.filter((k) => !orderSet.has(k))
  const staleInOrder = keyOrder.filter((k) => !navKeySet.has(k))
  if (missingInOrder.length) {
    errors.push(`菜单项未登记顺序：${missingInOrder.join(', ')} 有 navEntry 但不在 SIDEBAR_MENU_KEY_ORDER（会导致菜单项被排到末尾）`)
  }
  if (staleInOrder.length) {
    errors.push(`SIDEBAR_MENU_KEY_ORDER 存在失效 key：${staleInOrder.join(', ')}（登记表中已无对应 navEntry）`)
  }
  for (const entry of entries) {
    if (entry.navEntry && (!entry.navEntry.group || !entry.navEntry.labelI18nKey || !entry.navEntry.to || !entry.navEntry.hasIcon)) {
      errors.push(`菜单项字段不全：${entry.path} 的 navEntry 需要 key / group / labelI18nKey / to / icon`)
    }
  }
  if (new Set(navKeys).size !== navKeys.length) errors.push('route-registry.js 存在重复的 navEntry key')

  const internalCount = entries.filter((e) => e.internal).length
  const redirectCount = routes.filter((r) => r.redirect).length
  return {
    ok: errors.length === 0,
    errors,
    stats: {
      routerRoutes: routes.length,
      redirectRoutes: redirectCount,
      registryEntries: entries.length,
      menuItems: navKeys.length,
      internalRoutes: internalCount,
    },
  }
}

function main () {
  const opts = parseArgs(process.argv.slice(2))
  let routerSource
  let registrySource
  try {
    routerSource = fs.readFileSync(ROUTER_FILE, 'utf8')
    registrySource = fs.readFileSync(REGISTRY_FILE, 'utf8')
  } catch (err) {
    console.error(`[route-registry] 无法读取源文件：${err.message}`)
    process.exit(2)
  }

  const result = checkRouteRegistry({ routerSource, registrySource })

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    const s = result.stats
    console.log(`[route-registry] router 路由 ${s.routerRoutes} 条（redirect ${s.redirectRoutes} 条）/ 登记 ${s.registryEntries} 条 / 菜单项 ${s.menuItems} 个 / 暗路由 ${s.internalRoutes} 条`)
  }

  if (!result.ok) {
    console.error(`[route-registry] FAIL（${result.errors.length} 项）：`)
    for (const err of result.errors) console.error(`  - ${err}`)
    if (!opts.json) {
      console.error('\n修复指引：')
      console.error('  1. 在 src/config/route-registry.js 补登记（path / name / view / navEntry / internal / entryFrom）')
      console.error('  2. 有侧边栏入口 → 填 navEntry 并把 key 加进 SIDEBAR_MENU_KEY_ORDER（同步 ops-center app_menu_service.py CATALOG）')
      console.error('  3. 无侧边栏入口 → internal:true + entryFrom（宿主页面路径，必须在表内存在）')
      console.error('  4. 登记项与 router/index.js 的 path、视图文件名必须逐字一致')
    }
    process.exit(1)
  }
  if (!opts.json) console.log('[route-registry] PASS')
}

module.exports = { checkRouteRegistry, parseRouterRoutes, parseRegistry, scanTopLevelBlocks, parseArgs }

if (require.main === module) main()
