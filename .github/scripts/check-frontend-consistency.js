#!/usr/bin/env node
/**
 * check-frontend-consistency.js — desktop-ui-consistency 提交门禁（L1）
 *
 * 覆盖 spec：openspec/specs/desktop-ui-consistency
 *   - Requirement「IPC 渲染端访问单轨制」：渲染层禁止直调 window.electronAPI，
 *     统一经 src/api/** 桥接层（白名单目录）。
 *   - Requirement「危险操作确认门禁」场景「确认框实现统一」：禁止原生 window.confirm，
 *     唯一确认原语为 ElMessageBox（及未来的 confirmDanger 封装）。
 *
 * 扫描根（UX 审计 5.1/5.2 扩域）：
 *   - apps/desktop/src        —— 全部三条规则（桌面端本体）
 *   - ops-center/frontend/src —— 只有"跨应用都成立"的两条：
 *       · windowConfirm：两个应用的确认框都必须是 ElMessageBox，原生 confirm 不可主题化、
 *         不可取消拦截，属同一条产品契约；
 *       · opsElectronApi（反向边界）：window.electronAPI 只在桌面端渲染进程存在，运营中心是
 *         独立 Web 应用；出现它等于把桌面端代码搬进来，运行期恒 undefined ⇒ 静默 no-op。
 *     **不加** appleAlias：`--apple-*` 别名层与 tokens.css 是桌面端资产，套到 ops 只会造出
 *     语义错配的"存量"，那种数既不可修也不可解释。
 *
 * 退出码三档：0 合规 / 1 存量超过基线（只降不升）/ 2 判据自身故障（扫描根缺失或域塌方）。
 *
 * 用法：
 *   node check-frontend-consistency.js                  # 对照基线，存量上涨即失败（exit 1）
 *   node check-frontend-consistency.js --update-baseline # 重新生成基线（任何一项增长时拒绝，除非 --force）
 *   node check-frontend-consistency.js --json            # 输出 JSON 明细（供审查代理消费）
 *
 * 基线语义与 locale-cjk-baseline.json 一致：债务只降不升；
 * 降基线随修复提交入库，涨基线必须 --force 并在 PR 说明。
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC_ROOT = path.join(ROOT, 'apps', 'desktop', 'src')
// 5.1/5.2（UX 审计实施方案）：运营中心前端纳入同一把一致性门禁。
// 它是**独立的 Vue3 Web 应用**（无 Electron、无 tokens.css），所以只有"跨应用都能成立"的规则
// 才适用；把桌面端专属规则（appleAlias 令牌回潮）硬套上去，只会造出一堆语义错配的存量。
const OPS_SRC_ROOT = path.join(ROOT, 'ops-center', 'frontend', 'src')
const BASELINE_FILE = path.join(__dirname, 'frontend-consistency-baseline.json')

// 扫描根描述符：id 供 pattern.roots 选，display 供违规路径前缀（必须与仓库相对路径一致，
// 否则门禁点名的位置读者按不到文件）。
const ROOTS = [
  { id: 'desktop', dir: SRC_ROOT, display: 'apps/desktop/src' },
  { id: 'ops', dir: OPS_SRC_ROOT, display: 'ops-center/frontend/src' },
]

// 渲染层业务目录；src/api 是唯一允许接触 window.electronAPI 的桥接层（spec 白名单）
const RENDERER_DIRS = [
  'views', 'components', 'composables', 'stores', 'features',
  'layouts', 'story2video', 'i18n', 'router', 'utils',
]

// 扫描面（scope）：
//   renderer —— 渲染层业务目录 + src 根入口（既有两模式的扫描面，保持不变）
//   allSrc   —— apps/desktop/src/** 全域（含 styles/*.css）；别名回潮门禁需要看到 CSS
const ALL_SRC_EXTS = /\.(css|vue|js|ts)$/

const PATTERNS = {
  // 原生 window.confirm 在两个应用里都是同一条禁令（本仓唯一确认原语是 ElMessageBox/confirmDanger）
  // ⇒ roots 含 ops。ops-center 原先有 1 处孤例（PromptEvalWorkbench.doDelete），随本批改掉。
  // ops 侧走 anySrc（全域）：RENDERER_DIRS 是按桌面端目录结构写的（story2video/i18n/features…），
  // 拿它当 ops 的域会把 ops 的 api/ config/ constants/ 整个漏掉 —— 那正是"目录表当成域"的盲区。
  // 桌面端判定面**保持 renderer 不变**（既有计数语义不许被这次扩域顺带改掉）。
  windowConfirm: { re: /\bwindow\.confirm\s*\(/, label: '原生 window.confirm（应为 ElMessageBox/confirmDanger）', scope: 'renderer', scopeByRoot: { ops: 'anySrc' }, roots: ['desktop', 'ops'] },
  rendererIpcDirect: { re: /\bwindow\.electronAPI\b/, label: '渲染层直调 window.electronAPI（应走 src/api 桥接层）', scope: 'renderer', roots: ['desktop'] },
  // 反向边界：window.electronAPI 只存在于桌面端渲染进程。运营中心是独立 Web 应用，
  // 出现它就是"把桌面端代码搬进来了"（运行期必然 undefined ⇒ 静默 no-op，属本仓"装饰性链路"同型）。
  opsElectronApi: { re: /\bwindow\.electronAPI\b/, label: '运营中心前端引用 window.electronAPI（跨应用边界：该 API 只在桌面端渲染进程存在）', scope: 'anySrc', roots: ['ops'] },
  appleAlias: {
    re: /var\(\s*--apple-/,
    label: '@deprecated 别名层消费 var(--apple-*)（应改指 tokens.css 权威令牌；ui-apple-token-retirement 只降不升，批次 6 钉 0）',
    scope: 'allSrc',
    roots: ['desktop'],
    // CSS 只有块注释；「注释在前、代码在后」的同一行必须仍被检出（见 stripBlockComments）
    commentStyle: 'blockAware',
  },
}

function parseArgs (args) {
  const opts = { updateBaseline: false, force: false, json: false }
  for (const a of args) {
    if (a === '--update-baseline') opts.updateBaseline = true
    else if (a === '--force') opts.force = true
    else if (a === '--json') opts.json = true
    else throw new Error(`unknown option: ${a}`)
  }
  return opts
}

function isExcluded (relPath) {
  const norm = relPath.replace(/\\/g, '/')
  if (norm.includes('/__tests__/') || norm.includes('/node_modules/')) return true
  // 注意：css 是批次 0 新增的扫描面（appleAlias）；此处只扩展「测试文件」判定到该扩展名，
  // 既有 .js/.ts/.mjs/.cjs 的排除语义保持不变（否则会静默改变既有两模式的计数）。
  if (/\.(test|spec)\.(js|ts|mjs|cjs|css)$/.test(norm)) return true
  return false
}

function listRendererFiles (srcRoot) {
  const files = []
  // src 根入口文件（App.vue / main.js 等）同样是渲染层组件，必须纳入扫描
  for (const entry of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(srcRoot, entry.name)
    if (entry.isFile() && /\.(vue|js|ts)$/.test(entry.name)) {
      const rel = path.relative(srcRoot, full)
      if (!isExcluded(rel)) files.push({ rel, full })
    }
  }
  for (const dir of RENDERER_DIRS) {
    const absDir = path.join(srcRoot, dir)
    if (!fs.existsSync(absDir)) continue
    walk(absDir)
  }
  return files

  function walk (dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(vue|js|ts)$/.test(entry.name)) continue
      const rel = path.relative(srcRoot, full)
      if (isExcluded(rel)) continue
      files.push({ rel, full })
    }
  }
}

/**
 * apps/desktop/src/** 全域扫描面（含 styles/*.css）。
 * 独立于 listRendererFiles：别名回潮门禁要覆盖 CSS，但既有两模式（window.confirm /
 * window.electronAPI）的判定面必须保持不变 —— 不共用同一遍历器。
 */
function listAllSrcFiles (srcRoot) {
  const out = []
  walk(srcRoot)
  return out

  function walk (dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!ALL_SRC_EXTS.test(entry.name)) continue
      const rel = path.relative(srcRoot, full)
      if (isExcluded(rel)) continue
      out.push({ rel, full })
    }
  }
}

/**
 * 按 (rootId, scope) 取文件清单（带缓存，避免同一根同一 scope 重复遍历）。
 * `anySrc` 复用 allSrc 的全域遍历器：对 ops 而言它是**唯一**可用的域
 * （RENDERER_DIRS 是桌面端目录名，套到 ops 会漏掉 api/ config/ constants/）。
 * 缓存键必须带 root：两个应用同名 scope 若共用一条缓存，第二个根会直接读到第一个根的
 * 文件清单 —— 表现为"扩了域但计数一点没变"，且完全静默。
 */
function filesForScope (rootDir, rootId, scope, cache = new Map ()) {
  const ck = `${rootId}:${scope}`
  if (cache.has(ck)) return cache.get(ck)
  const files = (scope === 'allSrc' || scope === 'anySrc')
    ? listAllSrcFiles(rootDir)
    : listRendererFiles(rootDir)
  cache.set(ck, files)
  return files
}

/**
 * 域健康读数：每个根在每种 scope 下**实际扫到多少个文件**。
 * 为什么必须有：扩域最常见的失败形态不是报错，而是"路径写错 ⇒ 扫到 0 个文件 ⇒ 0 违规 ⇒ 读成通过"。
 * 这类结论（"全仓 0 命中"）必须先证明扫描器看见了文件（AGENTS「全仓关键词复扫必须带 -a」同族）。
 */
function domainStats (roots = ROOTS) {
  const stats = []
  const cache = new Map()
  for (const r of roots) {
    const exists = fs.existsSync(r.dir)
    const renderer = exists ? filesForScope(r.dir, r.id, 'renderer', cache).length : 0
    const anySrc = exists ? filesForScope(r.dir, r.id, 'anySrc', cache).length : 0
    stats.push({ root: r.id, dir: r.dir, exists, renderer, anySrc })
  }
  return stats
}

/** 域下界（2026-10-19 本机实测：desktop renderer=375 / anySrc=540，ops anySrc=83）。
 * 重取一句话：`node -e "console.log(require('./.github/scripts/check-frontend-consistency.js').domainStats())"`。
 * 下界取"当前量级的一半或更少"：仓库不会因为一次 PR 腰斩，腰斩只可能是路径写错或目录被搬走。
 * 只登记**被消费的 (根, scope) 组合** —— 给没人用的组合留一条下界是死配置。 */
const DOMAIN_FLOORS = {
  'desktop:renderer': 200,
  'desktop:anySrc': 300,
  'ops:anySrc': 40,
}

/** allSrc 与 anySrc 是同一个遍历器（全域），读数桶必须合并 —— 否则 appleAlias 声明的
 * `desktop:allSrc` 永远不会出现在 stats 的键里，那条下界就是写给不存在的东西。 */
function scopeBucket (scope) {
  return (scope === 'allSrc' || scope === 'anySrc') ? 'anySrc' : scope
}

/**
 * 域健康判定（纯函数，便于反证）：
 * - 任一根目录不存在 ⇒ 自身故障
 * - 该根被任何 pattern 消费而其对应 scope 扫到 0 文件 ⇒ 自身故障
 * - 扫到文件数低于下界 ⇒ 自身故障（覆盖塌方，不是"更少违规"）
 */
function assertDomainHealthy (stats, floors = DOMAIN_FLOORS) {
  const errors = []
  const consumed = new Set()
  for (const p of Object.values(PATTERNS)) {
    const scopeByRoot = p.scopeByRoot || {}
    for (const rid of p.roots || ['desktop']) {
      consumed.add(`${rid}:${scopeBucket(scopeByRoot[rid] || p.scope || 'renderer')}`)
    }
  }
  for (const s of stats) {
    if (!s.exists) { errors.push(`扫描根不存在：${s.root} → ${s.dir}`); continue }
    for (const scope of ['renderer', 'anySrc']) {
      const key = `${s.root}:${scope}`
      if (!consumed.has(key)) continue
      const got = s[scope]
      const floor = floors[key]
      if (got === 0) { errors.push(`域为空：${key}（0 个文件）—— "0 违规"在这个读数下不构成通过证据`) }
      else if (typeof floor === 'number' && got < floor) {
        errors.push(`域塌方：${key} 只扫到 ${got} 个文件，低于下界 ${floor}`)
      }
    }
  }
  return errors
}

// 注释行（整行 //、/* 前导、JSDoc 的 * 续行、HTML <!-- ）不计违规：
// 注释里的提及不是真实调用；行内尾注释仍计入（保守方向，避免误放行）
function isCommentLine (line) {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('<!--')
}

/**
 * 剥离行内块注释（跨行状态），返回本行剩余代码。
 * 为什么需要：`isCommentLine` 对「以 /* 开头」的整行直接跳过 —— 在 CSS 里
 * `/* 说明 *\/ .a { color: var(--apple-accent) }` 这种「注释在前、代码在后」的
 * 同一行会被整体漏检（批次 0 反证实测踩到）。新增的 allSrc 扫描面（含 CSS）
 * 必须按「去注释后的代码」判定，才能守住回潮门禁。
 * 既有 renderer 面沿用 isCommentLine（不改其判定语义）。
 */
function stripBlockComments (line, state) {
  let out = ''
  let i = 0
  while (i < line.length) {
    if (state.inBlock) {
      const end = line.indexOf('*/', i)
      if (end === -1) return out
      state.inBlock = false
      i = end + 2
      continue
    }
    const start = line.indexOf('/*', i)
    if (start === -1) { out += line.slice(i); break }
    out += line.slice(i, start)
    const end = line.indexOf('*/', start + 2)
    if (end === -1) { state.inBlock = true; break }
    i = end + 2
  }
  return out
}

/**
 * 默认**只扫桌面端根**：第二个参数必须由调用方显式传入。
 * 理由：既有单测全部按"单根临时树"写，若默认去读真实的 ops-center 目录，那么任何人在 ops 里
 * 引入一处违规，就会把这些桌面端用例的计数改掉 —— 测试读宿主仓库状态是自污染。
 * 真实双根由 main() 显式传 SRC_ROOT + OPS_SRC_ROOT，并由一条"main 必须两个根都传"的结构锁守住。
 */
function findViolations (srcRoot = SRC_ROOT, opsSrcRoot = null) {
  const rootsById = {
    desktop: { dir: srcRoot, display: 'apps/desktop/src' },
    ops: { dir: opsSrcRoot, display: 'ops-center/frontend/src' },
  }
  const result = {}
  for (const key of Object.keys(PATTERNS)) result[key] = []

  // 按**消费点（处）**计数：同一行出现 2 次算 2 处（基线语义是「引用数」，见
  // ui-apple-token-retirement 基线 337/339 处）。既有两模式目前基线为 0，逐次计数
  // 不改变其判定；若将来某行出现两次 `window.electronAPI`，逐次计数只会更准确。
  const globalRes = {}
  for (const [key, { re }] of Object.entries(PATTERNS)) {
    globalRes[key] = re.flags.includes('g') ? new RegExp(re.source, re.flags) : new RegExp(re.source, re.flags + 'g')
  }

  const scopeCache = new Map()
  for (const [key, { scope, scopeByRoot, roots, commentStyle }] of Object.entries(PATTERNS)) {
    let blockState = { inBlock: false }
    for (const rootId of roots || ['desktop']) {
      const root = rootsById[rootId]
      if (!root) throw new Error(`pattern ${key} 声明了未知扫描根: ${rootId}`)
      const effScope = (scopeByRoot && scopeByRoot[rootId]) || scope || 'renderer'
      if (!fs.existsSync(root.dir)) continue
      for (const { rel, full } of filesForScope(root.dir, rootId, effScope, scopeCache)) {
      const content = fs.readFileSync(full, 'utf8')
      const lines = content.split(/\r?\n/)
      blockState = { inBlock: false } // 每个文件重置块注释状态
      lines.forEach((line, idx) => {
        let target = line
        if (commentStyle === 'blockAware') {
          const isCss = /\.css$/.test(rel)
          if (!isCss && isCommentLine(line)) return // .vue/.js：整行注释约定照旧
          target = stripBlockComments(line, blockState)
          if (!target.trim()) return
          if (!isCss && target.trim().startsWith('//')) return
        } else if (isCommentLine(line)) {
          return
        }
        const re = globalRes[key]
        re.lastIndex = 0
        while (re.exec(target) !== null) {
          // 前缀必须取**当前根**的 display。原先写死 apps/desktop/src：扩域后 ops 的命中会
          // 报出一个不存在于该文件的位置，读者按不到文件 —— 门禁点名位置是它唯一的可核验出口。
          result[key].push({ file: `${root.display}/${rel.replace(/\\/g, '/')}`, line: idx + 1, root: rootId })
          if (re.lastIndex === 0) break // 零宽匹配保护
        }
      })
      }
    }
  }
  return result
}

function readBaseline ({ required = true } = {}) {
  if (!fs.existsSync(BASELINE_FILE)) {
    if (!required) return null
    // fail-closed：校验模式下基线缺失视为配置错误，不允许静默放行
    console.error(`[frontend-consistency] FAIL: 基线文件缺失: ${BASELINE_FILE}（运行 --update-baseline 生成并随提交入库）`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
}

/**
 * 共享基线文件的写入必须**保留他方键**：frontend-consistency-baseline.json 由三个检查
 * 共用（本脚本 windowConfirm/rendererIpcDirect、check-color-literals 的 colorLiterals、
 * check-css-var-defined 的 cssVarUndefined）。若本脚本只写自己的键，另两个门禁读到的基线
 * 会变 undefined → 比较失败 → 误报 FAIL（且掩盖真实基线）。
 * 契约：以旧基线为底、用本次计数覆盖；旧基线里没有的键**不得凭空补 0**（缺失是配置错误，
 * 应由各自门禁的 fail-closed 分支报出来，而不是被悄悄抹平）。
 */
function mergeBaseline (oldCounts, nextCounts) {
  return { ...(oldCounts || {}), ...(nextCounts || {}) }
}

function writeBaseline (counts) {
  const old = readBaseline({ required: false }) || {}
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(mergeBaseline(old, counts), null, 2)}\n`, 'utf8')
}

/**
 * 基线判定（纯函数，便于回归）：
 * - 基线**缺键** → fail-closed（`counts > undefined` 恒 false，会静默放行新增检查项）
 * - 当前计数 > 基线 → 失败（只降不升）
 */
function evaluateBaseline (counts, base) {
  const failures = []
  for (const [key, { label }] of Object.entries(PATTERNS)) {
    const allowed = base[key]
    if (allowed === undefined) {
      failures.push(`${label}: 基线缺少 "${key}" 键（运行 --update-baseline 固定存量；不得静默放行）`)
      continue
    }
    if (counts[key] > allowed) failures.push(`${label}: 当前 ${counts[key]} 处 > 基线 ${allowed} 处`)
  }
  return failures
}

function main () {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(e.message)
    process.exit(2)
  }
  const stats = domainStats()
  const unhealthy = assertDomainHealthy(stats)
  if (unhealthy.length) {
    // 退出码 2 = 判据自身故障，与"发现违规"的 1 分开：把"没扫到文件"读成"没有违规"，
    // 就是本仓反复记过的"装饰性门禁"同型（工具失明伪装成结论）。
    for (const e of unhealthy) console.error(`[frontend-consistency] SELF_FAILURE: ${e}`)
    console.error('[frontend-consistency] 域读数: ' + JSON.stringify(stats))
    process.exit(2)
  }
  const violations = findViolations(SRC_ROOT, OPS_SRC_ROOT)
  const counts = {}
  for (const key of Object.keys(PATTERNS)) counts[key] = violations[key].length

  if (opts.updateBaseline) {
    const old = readBaseline({ required: false }) || {}
    const increased = Object.keys(counts).filter(k => counts[k] > (old[k] ?? 0))
    if (increased.length && !opts.force) {
      console.error(`[frontend-consistency] 拒绝更新基线：${increased.join(', ')} 存量增长（如确需增长请加 --force 并在 PR 说明）`)
      process.exit(1)
    }
    writeBaseline(counts)
    console.log(`[frontend-consistency] 基线已更新: ${JSON.stringify(counts)}`)
    return
  }

  const base = readBaseline()
  const failures = evaluateBaseline(counts, base)

  // 域读数每次出声：扩域这件事的"真的扫到了吗"必须留在现场，不能只写在注释里。
  const domainLine = stats.map(s => `${s.root}(renderer=${s.renderer},anySrc=${s.anySrc})`).join(' ')
  if (opts.json) {
    console.log(JSON.stringify({ counts, baseline: base, ok: failures.length === 0, violations, domain: stats }, null, 2))
  } else {
    console.log(`[frontend-consistency] 域: ${domainLine}`)
    for (const [key, { label }] of Object.entries(PATTERNS)) {
      console.log(`[frontend-consistency] ${key}: ${counts[key]} / 基线 ${base[key] ?? '∞'}`)
    }
    for (const key of Object.keys(PATTERNS)) {
      for (const v of violations[key]) console.log(`  - ${v.file}:${v.line}`)
    }
  }

  if (failures.length) {
    console.error('[frontend-consistency] FAIL\n  ' + failures.join('\n  '))
    process.exit(1)
  }
  if (!opts.json) console.log('[frontend-consistency] PASS')
}

module.exports = { findViolations, parseArgs, isExcluded, PATTERNS, mergeBaseline, evaluateBaseline, listRendererFiles, listAllSrcFiles, filesForScope, domainStats, assertDomainHealthy, scopeBucket, ROOTS, OPS_SRC_ROOT, DOMAIN_FLOORS }

if (require.main === module) main()
