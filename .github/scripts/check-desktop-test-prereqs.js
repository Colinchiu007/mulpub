'use strict'
// 桌面测试前置构建锁（desktop test prereqs）
//
// 动因（2026-10-17，change: electron-ci-preload-build）：
// PR #3782（change: bundle-untrack）把 preload / paginator 产物移出版本控制
// （`git rm --cached`），并只在 quality-gate.yml 的三个 job 里插入了
// 「Build preload bundles」重建步骤。它的安全性论证因此**只对 quality-gate.yml 成立**，
// 而另外两条同样会跑 apps/desktop 的 vitest 的 workflow 被漏掉，两条各自收口：
//   - electron-ci.yml#electron-tests：**已由 PR #3837 补齐**（合并 1bed4ad2c）。注意该步骤带
//     `if: github.event_name != 'pull_request'`，所以「PR 侧绿」不构成「它绿」。
//   - clock-shift-oracle.yml#clock-shift-oracle：**由本 PR 补齐**。
//
// 为什么 oracle 那半边是「权威性保全」而不是「现在就红」（实测口径，别简化成口号）：
//   ① 缺产物 ≠ 必然红。本 PR 把全域候选（180 份）在缺产物档下跑满一趟，唯一红的
//      src/views/CreateView.test.js 经单文件 A/B（产物在场 300/300 绿、缺席 300/300 绿）
//      判为负载/时序类 ⇒ **与产物无关**。不得把本锁的理由写成「oracle 当前已红」，
//      那是没取证过的断言。
//   ② 真正的结构性理由在 scripts/check-clock-shift-oracle.js:354-357：基线段一旦因
//      **任何**原因出现红，它打印 ORACLE_NOT_AUTHORITATIVE 并 **return 0** ⇒ 巡检与
//      required check 看到的是绿灯，而「该域内无引信」这句结论已经失效。
//      这不是纸面推演：本 PR 的缺产物档全候选集运行里，基线段确实出现 1 份红 ——
//      把同一批红喂给该判据，那一趟就会走这条分支（判据自己不再出声）。
//   ③ 于是本锁守两块：**接线一致性**（同一个桌面测试面，另两条 workflow 已重建前置产物，
//      oracle 不该是唯一例外）与**权威性保全**（不让上游缺产物把它的判据变成无声 no-op）。
//      后者是预防性收口，但成因形态已被取证为真实发生，不是假设。
//
// 本锁要守的性质：**任何会跑 apps/desktop 的 vitest 的 CI job，都必须在它之前
// 重建 preload 产物**。判据从 workflow 文本推导，不读任何「人记得写」的清单。
//
// 两条视图（同一步的 `run` 文本算两次，模型刻意保持简单）：
//   flat：剥行注释 → 删 `"`/`'` → 折续行（`\`/反引号，须先于逗号折行）→ `,\s*`→空格 → `\s+`→单空格。
//         argv 形态（PowerShell 的 @("--filter","@multi-publish/desktop","test")）只有它看得见。
//   codeView：长度保留、引号区间填空格 ⇒ 用于分辨「哪些 token 是命令、哪些只是字符串字面量」。
//         例：`-FilePath "pnpm.cmd"` 在 codeView 里没有 pnpm token（不会被误当成命令）。
//
// 五个形态（FORM_KEYS，逐条对应「这一步怎么跑到桌面 vitest」）：
//   desktop-filter  `--filter … @multi-publish/desktop [run] <script>`（flat）
//   pnpm-verb       `pnpm [flags] [run] <script>` / `pnpm exec vitest`（codeView）
//   root-nx         `test:all` / `test:affected[:no-desktop]`（flat）
//   nx-direct       `nx run-many|affected …`（codeView；真仓 0 条，上界锁死）
//   oracle-cli      `node …/check-clock-shift-oracle.js`（flat；--dry-run 判域外）
//
// 域内/域外的判据（judgeEntry）见函数注释；**刻意只有 build:preload 是满足器**
// （A/B 实测：只重建 build:paginator 不足以让 electron-ci 的两条用例转绿）。
//
// 已知边界（不假装已闭合）：
//   - 同一 step 内不做语句级顺序建模（`satisfied(i) = steps[0..i] 里存在满足器`），
//     把重建与测试写进同一个 step 时判据会放行。
//   - 脚本闭包按**脚本名 token**解析（不是 shell 求值）：body 里出现同名脚本即视为调用。
//     方向是 fail-closed（宁可多算）；假阳会以 UNREGISTERED_IN_DOMAIN 出现在 CI 上，
//     可按需 exempt 并写明理由。
//   - 域外假阳控制点（已实证应绿）：build.yml#build、quality-gate.yml#unit-tests、
//     visual-test.yml#visual-test、gui-test.yml、autonomous-loop.yml。
//
// 退出码：0=通过；1=判据发现欠账（BUILD_* / *_IN_DOMAIN / STALE_* / REGISTRY_* /
//         FORM_COUNT_EXCEEDED）；2=扫描器自身故障（SCAN_FAILURE / YAML_PARSE_FAILURE /
//         *BELOW_MIN / EMPTY_DOMAIN / ARGS_INVALID / REGISTRY_UNREADABLE）。
//         两档刻意分开：把「判据瞎了」读成「没问题」是本仓反复吃过的那类错。
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')

const REPO_ROOT = path.join(__dirname, '..', '..')
const WORKFLOWS_REL = path.join('.github', 'workflows')
const REGISTRY_REL = path.join('.github', 'scripts', 'desktop-test-prereq-jobs.json')
const ROOT_PACKAGE_REL = 'package.json'
const DESKTOP_PACKAGE_REL = path.join('apps', 'desktop', 'package.json')
const SATISFIER_SCRIPT = 'build-preload.js'
const SATISFIER_REF = 'build:preload'
const ORACLE_BASENAME = 'check-clock-shift-oracle.js'
const ORACLE_SCRIPT_REF = 'scripts/check-clock-shift-oracle.js'
const FORM_KEYS = ['desktop-filter', 'pnpm-verb', 'root-nx', 'nx-direct', 'oracle-cli', 'delegate']
const PNPM_TOKEN_WINDOW = 12
const MIN_WORKFLOW_FILES = 12
const MIN_JOBS = 24
// 委托形态：workflow 把"跑桌面全量"交棒给仓库脚本（2026-10-21 起 `electron-ci.yml#electron-tests` 就是这个形状）。
// ⛔ 判据不能是"看见 `node scripts/<名字>` 就算"——那是把判据换成名字白名单，脚本改成不跑桌面全量时本锁照绿。
// 成立条件与被委托脚本**自己的源码**里的三条锚同时命中：桌面包常量、`['--filter', DESKTOP_PKG, 'test']` 调用形状、`--shard=`。
const DELEGATE_CLI_RE = /node\s+scripts\/([\w.-]+\.js)/g
const DELEGATE_ANCHORS = [
  /(?:const|var|let)\s+DESKTOP_PKG\s*=\s*['"]@multi-publish\/desktop['"]/,
  /['"]--filter['"]\s*,\s*DESKTOP_PKG\s*,\s*['"]test['"]/,
  /--shard=/,
]
// 形态下界按实跑读数留余量（2026-10-17 实测 21 / 21 / 2 / 0 / 3；2026-10-21 起 delegate=1），
// 用意是「扫描器失明」与「仓库真的没有这种用法」可区分：
// 命中数掉到下界以下 ⇒ rc=2 自故障，而不是安静地判「没有域内 job」。
const MIN_FORM_COUNTS = {
  'desktop-filter': 12,
  'pnpm-verb': 12,
  'root-nx': 1,
  'nx-direct': 0,
  'oracle-cli': 1,
  'delegate': 1
}
const MAX_FORM_COUNTS = {
  'nx-direct': 0
}
const PNPM_SUBCOMMANDS = new Set([
  'install', 'add', 'remove', 'update', 'audit', 'list', 'why', 'outdated', 'prune',
  'licenses', 'store', 'config', 'setup', 'init', 'patch', 'pack', 'dedupe', 'rebuild',
  'link', 'import', 'fetch', 'doctor', 'self-update', 'publish', 'deploy'
])
const PNPM_STOP_TOKENS = new Set([
  '&&', '||', ';', '|', '&', ')', '}', '>', '>>', '\\', '`', ',', '--'
])
const PNPM_VALUE_FLAGS = new Set(['-C', '--dir', '--prefix'])
const PNPM_SCRIPT_NAME_RE = /^[A-Za-z0-9][\w:.-]*$/
const VITEST_TOKEN_RE = /(?<![\w./,:@=+-])vitest(?=\s|$)/
const CONFIG_FLAG_RE = /(^|\s)(?:--config|-c)(?=[=\s]|$)/
const NX_INVOKE_RE = /\bnx\s+(?:run-many|affected)\b/
const TEST_TARGET_RE = /(^|\s)(?:-t|--target|--targets)(?=[=\s])(?:=|\s)+test(?=\s|$)/
const EXCLUDE_DESKTOP_RE = /--exclude[=\s]+@multi-publish\/desktop(?=\s|$)/
const DESKTOP_FILTER_RE = /--filter[=\s]+@multi-publish\/desktop\s+(?:run\s+)?([A-Za-z0-9][\w:.-]*)/
const ROOT_NX_RE = /\btest:(?:all|affected)(?::no-desktop)?(?![\w:-])/
const NX_DIRECT_RE = /\bnx\s+(?:run-many|affected)\b/
const ORACLE_CLI_RE = /\bnode\s+\S*check-clock-shift-oracle\.js/
const PNPM_TOKEN_RE = /(?<![-\w$./])pnpm(?:\.cmd)?(?=\s|$)/
const DESKTOP_FILTER_GUARD_CHARS = 80
const ORACLE_DRYRUN_LOOKAHEAD_CHARS = 200
const PNPM_FILTER_LOOKAHEAD_CHARS = 200

/** 抛一个带 `.code` 的错误：collect() 会把它转成 severity=fatal 的 problem */
function fail (code, message) {
  const err = new Error(message)
  err.code = code
  throw err
}

function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function escapeRegExp (text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 取一段文本里的全部匹配（内部每次新建 RegExp，避免 g 标志的 lastIndex 状态串味） */
function matchAll (text, re) {
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g'
  return Array.from(text.matchAll(new RegExp(re.source, flags)))
}

/**
 * 剥掉一行里的 YAML/shell 注释：`#` 必须处在引号之外且前面是空白或行首
 * @param {string} line
 * @returns {string}
 */
function stripLineComment (line) {
  let quote = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote === null) {
      if (ch === '"' || ch === "'") {
        quote = ch
        continue
      }
      if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
      continue
    }
    if (ch === quote) quote = null
  }
  return line
}

/** @param {string} text @returns {string} */
function stripComments (text) {
  return text.split(/\r?\n/).map(stripLineComment).join('\n')
}

/**
 * 把引号区间整段填成空格（长度保留）⇒ 「token 是不是命令」可判
 * @param {string} text @returns {string}
 */
function stripQuotedSpans (text) {
  const chars = text.split('')
  let quote = null
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (quote === null) {
      if (ch === '"' || ch === "'") {
        quote = ch
        chars[i] = ' '
      }
      continue
    }
    if (ch === '\\' && quote === '"') {
      chars[i] = ' '
      if (i + 1 < chars.length) {
        chars[i + 1] = chars[i + 1] === '\n' ? '\n' : ' '
        i += 1
      }
      continue
    }
    if (ch === quote) {
      if (quote === "'" && chars[i + 1] === "'") {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 1
        continue
      }
      quote = null
      chars[i] = ' '
      continue
    }
    if (ch !== '\n' && ch !== '\r') chars[i] = ' '
  }
  return chars.join('')
}

/**
 * 归一化视图：删引号 → 折续行（`\`/反引号）→ `,\s*`→空格 → `\s+`→单空格（不 trim）
 * 顺序有约束：续行折叠必须在逗号折叠**之前**，否则 `-- \` + 换行会被逗号规则吞掉。
 * @param {string} text 已经剥过注释的文本
 * @returns {string}
 */
function normalizeForScan (text) {
  return text
    .replace(/["']/g, '')
    .replace(/\\\r?\n/g, '')
    .replace(/`\r?\n/g, '')
    .replace(/,\s*/g, ' ')
    .replace(/\s+/g, ' ')
}

/** @param {string} text 原始 run 文本 @returns {string} */
function viewFlat (text) {
  return normalizeForScan(stripComments(text))
}

/** @param {string} text 原始 run 文本 @returns {string} */
function viewCode (text) {
  return stripQuotedSpans(stripComments(text))
}

/** 脚本 body 里是否出现真正的 vitest 命令（`--ignores=…,vitest,…` 不算） */
function runsVitestCommand (body) {
  return VITEST_TOKEN_RE.test(body)
}

/** body 是否把 vitest 限定到某个 config（test:startup 这类属域外） */
function hasConfigFlag (body) {
  return CONFIG_FLAG_RE.test(body)
}

/** nx 命令是否显式排除了桌面包 */
function excludesDesktop (text) {
  return EXCLUDE_DESKTOP_RE.test(text)
}

/**
 * 被委托的仓库脚本**自己的源码**里是否真有桌面全量的调用形状（三条锚缺一不可）。
 * 读不到 = 没有委托（fail-closed），不得按"有委托"放过 —— 否则"文件被 .gitignore 吞掉"
 * 这种本机绿/CI 红的形态会在这里被读成"这一步不跑桌面测试"。
 * @param {string} file scripts/ 下的文件名
 * @returns {boolean}
 */
const delegateAnchorCache = new Map()
function delegateRunsDesktopSuite (file, root) {
  // 读哪棵树上 scripts/ 下那份源码，必须与"扫的是哪棵树"同源（同一个 root）——
  // 否则夹具树里的委托脚本永远读不到，正控分支就不可表示（而"不可表示"通常会伪装成"判得挺严"）。
  const base = root || REPO_ROOT;
  const key = base + '|' + file;
  if (delegateAnchorCache.has(key)) return delegateAnchorCache.get(key)
  let ok = false
  try {
    const src = fs.readFileSync(path.join(base, 'scripts', file), 'utf8')
    ok = DELEGATE_ANCHORS.every((re) => re.test(src))
  } catch (e) {
    ok = false
  }
  delegateAnchorCache.set(key, ok)
  return ok
}

/** nx 命令是否以 test 为目标 */
function hasTestTarget (text) {
  return TEST_TARGET_RE.test(text)
}

/**
 * 读两张 scripts 表：根 package.json 与 apps/desktop/package.json
 * @param {string} root 仓库根（可为夹具临时目录）
 * @returns {{root: Object<string,string>, desktop: Object<string,string>}}
 */
function loadScriptMaps (root) {
  const maps = { root: {}, desktop: {} }
  const read = (rel, bucket) => {
    let doc
    try {
      doc = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))
    } catch (err) {
      fail('SCAN_FAILURE', '无法读取 ' + rel + '：' + err.message)
    }
    const scripts = isPlainObject(doc) && isPlainObject(doc.scripts) ? doc.scripts : null
    if (scripts === null) fail('SCAN_FAILURE', rel + ' 缺少 scripts 映射')
    for (const name of Object.keys(scripts)) {
      const body = scripts[name]
      if (typeof body === 'string') maps[bucket][name] = body
    }
  }
  read(ROOT_PACKAGE_REL, 'root')
  read(DESKTOP_PACKAGE_REL, 'desktop')
  if (Object.keys(maps.root).length === 0 || Object.keys(maps.desktop).length === 0) {
    fail('SCAN_FAILURE', 'scripts 映射为空（root=' + Object.keys(maps.root).length +
      ', desktop=' + Object.keys(maps.desktop).length + '）')
  }
  return maps
}

/**
 * 按脚本名查表
 * @param {string} ref 脚本名
 * @param {'root'|'desktop'|'union'} prefer
 * @param {{root: Object, desktop: Object}} maps
 * @returns {Array<{map: string, name: string, body: string}>}
 */
function lookupScripts (ref, prefer, maps) {
  const out = []
  const push = (bucket) => {
    if (Object.prototype.hasOwnProperty.call(maps[bucket], ref)) {
      out.push({ map: bucket, name: ref, body: maps[bucket][ref] })
    }
  }
  if (prefer === 'union') {
    // 语义：`pnpm -r --if-present run test` 会同时命中根与各 workspace 的同名脚本，
    // 只看一张表会把「这条命令真的跑到了桌面 vitest」漏判成域外。
    push('root')
    push('desktop')
    return out
  }
  push(prefer)
  if (out.length === 0) push(prefer === 'root' ? 'desktop' : 'root')
  return out
}

/**
 * 从一段脚本 body 里找它调用了哪些已知脚本名（name-based，不是 shell 求值）
 * 方向是 fail-closed：宁可多算，漏算才会让判据放行。
 * @param {string} body
 * @param {{root: Object, desktop: Object}} maps
 * @returns {string[]}
 */
function extractScriptRefs (body, maps) {
  const names = new Set(Object.keys(maps.root).concat(Object.keys(maps.desktop)))
  const found = []
  for (const name of names) {
    const re = new RegExp('(?<![\\w:.-])' + escapeRegExp(name) + '(?![\\w:.-])')
    if (re.test(body)) found.push(name)
  }
  return found.sort()
}

/**
 * 解析脚本闭包（BFS + `map:name` 去重防环）
 * @param {string} ref
 * @param {'root'|'desktop'|'union'} prefer
 * @param {{root: Object, desktop: Object}} maps
 * @returns {Array<{map: string, name: string, body: string}>}
 */
function resolveScriptClosure (ref, prefer, maps) {
  const out = []
  const seen = new Set()
  const queue = lookupScripts(ref, prefer, maps)
  while (queue.length > 0) {
    const item = queue.shift()
    const key = item.map + ':' + item.name
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
    for (const next of extractScriptRefs(item.body, maps)) {
      for (const child of lookupScripts(next, 'union', maps)) {
        if (!seen.has(child.map + ':' + child.name)) queue.push(child)
      }
    }
  }
  return out
}

/**
 * 从 from 位置起的「续行链窗口」：遇 STOP token 即停（上限 max 字符）
 * 目的是把窗口收在**这一条命令**里，别把后面几条无关命令的 token 拉进来当脚本名。
 * @param {string} text codeView（保留换行）
 * @param {number} from
 * @param {number} max
 * @returns {string}
 */
function continuationWindow (text, from, max) {
  let lineEnd = text.indexOf('\n', from)
  if (lineEnd === -1) lineEnd = text.length
  let cursor = lineEnd
  while (cursor < text.length && cursor < from + max) {
    let next = text.indexOf('\n', cursor + 1)
    if (next === -1) next = text.length
    const piece = text.slice(cursor + 1, next)
    const trimmed = piece.replace(/^\s+/, '')
    const stop = /^(&&|\|\||[;|&)}\>]|`|,)/.test(trimmed) || trimmed === ''
    if (stop) break
    if (/\\\s*$/.test(text.slice(cursor, cursor + 1))) {
      lineEnd = next
      cursor = next
      continue
    }
    if (!/^\s/.test(piece) || /^\s*\\/.test(piece)) {
      lineEnd = next
      cursor = next
      continue
    }
    break
  }
  return text.slice(from, Math.min(lineEnd, from + max))
}

/**
 * 从 pnpm token 之后挑出「这一步执行的是哪个脚本」
 * @param {string} text codeView
 * @param {number} from pnpm token 结束位置
 * @returns {{ref: string, prefer: 'root'|'desktop'|'union', inline?: boolean}|null}
 */
function pickPnpmCandidate (text, from) {
  const window = continuationWindow(text, from, 400)
  const tokens = window.split(/\s+/).filter((token) => token.length > 0)
  let swallow = false
  for (let i = 0; i < tokens.length && i < PNPM_TOKEN_WINDOW; i++) {
    const token = tokens[i]
    if (swallow) {
      swallow = false
      continue
    }
    if (PNPM_STOP_TOKENS.has(token)) return null
    if (token === 'run' || token === 'run-script') continue
    if (token.startsWith('-')) {
      if (PNPM_VALUE_FLAGS.has(token)) swallow = true
      continue
    }
    if (token.startsWith('$') || token.startsWith('@(') || token.startsWith('(')) return null
    if (token.startsWith('@')) continue
    if (token === 'exec' || token === 'dlx') {
      return tokens[i + 1] === 'vitest' ? { ref: 'vitest', prefer: 'union', inline: true } : null
    }
    if (PNPM_SUBCOMMANDS.has(token)) continue
    if (PNPM_SCRIPT_NAME_RE.test(token)) return { ref: token, prefer: 'union' }
    return null
  }
  return null
}

/**
 * nx 命令文本 → 域内/域外
 * @param {string} text
 * @returns {{inDomain: boolean, code: string, why: string}}
 */
function judgeNxText (text) {
  if (!hasTestTarget(text)) {
    return { inDomain: false, code: 'nx-non-test-target', why: 'nx 目标不是 test，跑不到桌面 vitest' }
  }
  if (excludesDesktop(text)) {
    return { inDomain: false, code: 'no-desktop-excluded', why: '显式排除了 @multi-publish/desktop' }
  }
  return { inDomain: true, code: 'nx-invokes-desktop-tests', why: 'nx 以 test 为目标且未排除桌面' }
}

/**
 * 单条命中 → 是否域内（域内 = 这一步会跑 apps/desktop 的 vitest）
 * 分支顺序有约束：nx 分支必须在裸 vitest 分支**之前**——`test:all:no-desktop`
 * 的闭包里存在桌面 `test`（vitest）与 nx 两层，先看 nx 才不会被名字匹配骗成域内。
 * @param {Object} entry
 * @param {{root: Object, desktop: Object}} maps
 * @returns {{inDomain: boolean, code: string, why: string, closure: string[], touchesPreload: boolean}}
 */
function judgeEntry (entry, maps) {
  if (entry.form === 'delegate') {
    if (entry.delegateHit === true) {
      return {
        inDomain: true,
        code: 'delegate-runs-desktop-suite',
        why: 'workflow 把桌面全量委托给 ' + entry.ref + '，而**该脚本自己的源码**里三条锚齐命中（桌面包常量 + `\'--filter\', DESKTOP_PKG, \'test\'` + `--shard=`）',
        closure: [entry.ref],
        touchesPreload: false
      }
    }
    return {
      inDomain: false,
      code: 'delegate-not-desktop-suite',
      why: entry.ref + ' 的源码里没有桌面全量的调用形状（读不到也按"没有委托"处理）⇒ 这一步不算域内',
      closure: [entry.ref],
      touchesPreload: false
    }
  }
  if (entry.form === 'oracle-cli') {
    if (entry.dryRun) {
      return { inDomain: false, code: 'dry-run-only', why: '--dry-run 只做自检，不进候选域', closure: [], touchesPreload: false }
    }
    return { inDomain: true, code: 'oracle-cli', why: '完整两趟会跑全域候选（含 apps/desktop）', closure: [], touchesPreload: false }
  }
  if (entry.form === 'nx-direct') {
    const verdict = judgeNxText(entry.inline || '')
    return { inDomain: verdict.inDomain, code: verdict.code, why: verdict.why, closure: [], touchesPreload: false }
  }
  if (entry.ref === 'vitest') {
    return { inDomain: true, code: 'vitest-inline', why: '直接以 pnpm exec vitest 跑桌面用例', closure: [], touchesPreload: false }
  }
  const closure = resolveScriptClosure(entry.ref, entry.prefer, maps)
  const names = closure.map((item) => item.map + ':' + item.name)
  const touchesPreload = entry.ref === SATISFIER_REF || closure.some((item) => item.body.includes(SATISFIER_SCRIPT))
  if (closure.length === 0) {
    if (/^test/.test(entry.ref)) {
      return {
        inDomain: true,
        code: 'unregistered-test-script',
        why: '名为 ' + entry.ref + ' 的脚本不在任何 scripts 表里，但名字形态是测试脚本 ⇒ 按 fail-closed 记域内',
        closure: names,
        touchesPreload
      }
    }
    return { inDomain: false, code: 'unknown-script', why: '脚本 ' + entry.ref + ' 不在 scripts 表里且名字不是测试形态', closure: names, touchesPreload }
  }
  const bodies = closure.map((item) => item.body)
  const nxBody = bodies.find((body) => NX_INVOKE_RE.test(body))
  if (nxBody !== undefined) {
    const verdict = judgeNxText(nxBody)
    return { inDomain: verdict.inDomain, code: verdict.code, why: verdict.why + '（经 ' + entry.ref + ' → nx）', closure: names, touchesPreload }
  }
  const bare = bodies.find((body) => runsVitestCommand(body) && !hasConfigFlag(body))
  if (bare !== undefined) {
    return { inDomain: true, code: 'vitest', why: '闭包里有裸 vitest 命令', closure: names, touchesPreload }
  }
  const scoped = bodies.find((body) => runsVitestCommand(body))
  if (scoped !== undefined) {
    return {
      inDomain: false,
      code: 'config-scoped-vitest',
      why: '闭包里的 vitest 被 --config 限定，不在桌面默认域内',
      closure: names,
      touchesPreload
    }
  }
  return { inDomain: false, code: 'no-vitest-in-closure', why: '闭包里没有任何 vitest', closure: names, touchesPreload }
}

/**
 * 扫一个 step：算出两视图 + 五形态命中（未判定）
 * @param {*} step
 * @param {number} index
 * @returns {{index: number, name: string, ifText: string, codeView: string, entries: Array, judged: Array}}
 */
function scanStep (step, index, root) {
  const record = { index, name: '', ifText: '', codeView: '', entries: [], judged: [] }
  if (!isPlainObject(step)) return record
  record.name = typeof step.name === 'string' ? step.name : ''
  record.ifText = typeof step.if === 'string' ? step.if : ''
  const run = typeof step.run === 'string' ? step.run : null
  if (run === null) return record
  const flat = viewFlat(run)
  const codeView = viewCode(run)
  record.codeView = codeView
  const push = (entry) => record.entries.push(Object.assign({ index: record.index, name: record.name }, entry))
  // ① desktop-filter（flat）：argv 形态（@("--filter","@multi-publish/desktop","test")）只有它看得见
  for (const m of matchAll(flat, DESKTOP_FILTER_RE)) {
    const guard = flat.slice(Math.max(0, m.index - DESKTOP_FILTER_GUARD_CHARS), m.index)
    if (!guard.includes('pnpm')) continue // 挡散文里提到的 --filter
    push({ form: 'desktop-filter', ref: m[1], prefer: 'desktop' })
  }
  // ② root-nx（flat）
  for (const m of matchAll(flat, ROOT_NX_RE)) {
    push({ form: 'root-nx', ref: m[0], prefer: 'root' })
  }
  // ③ oracle-cli（flat）：尾部窗口含 --dry-run ⇒ 域外
  for (const m of matchAll(flat, ORACLE_CLI_RE)) {
    const after = flat.slice(m.index + m[0].length, m.index + m[0].length + ORACLE_DRYRUN_LOOKAHEAD_CHARS)
    push({ form: 'oracle-cli', ref: ORACLE_SCRIPT_REF, prefer: 'root', dryRun: after.includes('--dry-run') })
  }
  // ④ nx-direct（codeView）
  for (const m of matchAll(codeView, NX_DIRECT_RE)) {
    push({ form: 'nx-direct', ref: '(nx-direct)', prefer: 'root', inline: continuationWindow(codeView, m.index, 300) })
  }
  // ⑤ pnpm-verb（codeView）
  for (const m of matchAll(codeView, PNPM_TOKEN_RE)) {
    const forward = codeView.slice(m.index + m[0].length, m.index + m[0].length + PNPM_FILTER_LOOKAHEAD_CHARS)
    if (forward.includes('--filter')) continue // 已由 desktop-filter 形态覆盖
    const candidate = pickPnpmCandidate(codeView, m.index + m[0].length)
    if (candidate !== null) push(Object.assign({ form: 'pnpm-verb' }, candidate))
  }
  // ⑥ delegate（flat）：`node scripts/<x>.js` —— 必须扫**全部**候选而不是取首个。
  //    实测理由（PR #4192 同族）：同一步的注释里点名另一个脚本时，"第一个匹配"会把真委托
  //    档在后面 ⇒ 这个 job 从域内**静默消失**，而"少一个域内 job"与"全部合规"逐字同形。
  //    （`viewFlat` 已剥注释，这一条是双保险，不是多余。）
  for (const m of matchAll(flat, DELEGATE_CLI_RE)) {
    push({ form: 'delegate', ref: 'scripts/' + m[1], prefer: 'root', delegateHit: delegateRunsDesktopSuite(m[1], root) })
  }
  return record
}

/** 一个 step 是否重建 preload 产物（文本提及 / 命中脚本 / 闭包 body 提及） */
function buildsPreloadStep (step) {
  if (step.codeView.includes(SATISFIER_SCRIPT)) return true
  return step.judged.some((entry) => entry.verdict.touchesPreload === true)
}

/**
 * 扫全部 workflow 的 job：分类每条命中、算满足器位置
 * @param {Array<{file: string, doc: Object}>} workflows
 * @param {{root: Object, desktop: Object}} maps
 * @returns {{jobs: Array, entries: Array, formCounts: Object<string, number>}}
 */
function scavengeWorkflows (workflows, maps, root) {
  const jobs = []
  const entries = []
  const formCounts = {}
  for (const key of FORM_KEYS) formCounts[key] = 0
  for (const wf of workflows) {
    for (const jobId of Object.keys(wf.doc.jobs)) {
      const job = wf.doc.jobs[jobId]
      const record = {
        workflow: wf.file,
        id: jobId,
        key: wf.file + '#' + jobId,
        steps: [],
        entries: [],
        inDomain: false,
        satisfierSteps: []
      }
      const rawSteps = isPlainObject(job) && Array.isArray(job.steps) ? job.steps : []
      rawSteps.forEach((rawStep, index) => {
        const step = scanStep(rawStep, index, root)
        record.steps.push(step)
        for (const entry of step.entries) {
          const verdict = judgeEntry(entry, maps)
          const full = Object.assign({ workflow: wf.file, job: jobId }, entry, { verdict })
          step.judged.push(full)
          record.entries.push(full)
          entries.push(full)
          formCounts[full.form] = (formCounts[full.form] || 0) + 1
        }
      })
      record.inDomain = record.entries.some((entry) => entry.verdict.inDomain)
      record.satisfierSteps = record.steps.filter(buildsPreloadStep).map((step) => step.index)
      jobs.push(record)
    }
  }
  return { jobs, entries, formCounts }
}

/**
 * 登记表判据：域内 job 必须在 required 或 exempt 里，且两侧都不得有陈旧条目
 * @param {Array} domain 域内 job 记录
 * @param {*} registry
 * @param {{workflows: Array}} context
 * @returns {Array<{code: string, severity: string, message: string}>}
 */
function judgeRegistry (domain, registry, context) {
  const problems = []
  const debt = (code, message) => problems.push({ code, severity: 'debt', message })
  if (!isPlainObject(registry) || !Array.isArray(registry.required) || !Array.isArray(registry.exempt)) {
    debt('REGISTRY_INVALID', '登记表形状不合法：需要 required[] 与 exempt[] 两个数组')
    return problems
  }
  const whyOk = (item) => isPlainObject(item) &&
    typeof item.workflow === 'string' && item.workflow.length > 0 &&
    typeof item.job === 'string' && item.job.length > 0 &&
    typeof item.why === 'string' && item.why.trim().length >= 8
  const workflowJobs = new Map()
  for (const wf of context.workflows) workflowJobs.set(wf.file, new Set(wf.jobs))
  const requiredKeys = new Set()
  const exemptKeys = new Set()
  const seen = new Set()
  for (const item of registry.required) {
    if (!whyOk(item)) {
      debt('REGISTRY_INVALID', 'required 条目形状不合法（workflow/job/why 必填且 why ≥8 字符）：' + JSON.stringify(item))
      continue
    }
    const key = item.workflow + '#' + item.job
    if (seen.has(key)) {
      debt('REGISTRY_INVALID', '登记重复：' + key)
      continue
    }
    seen.add(key)
    requiredKeys.add(key)
  }
  for (const item of registry.exempt) {
    if (!whyOk(item)) {
      debt('REGISTRY_INVALID', 'exempt 条目形状不合法（workflow/job/why 必填且 why ≥8 字符）：' + JSON.stringify(item))
      continue
    }
    const key = item.workflow + '#' + item.job
    // 去重按「同列表内」判定：与 required 的冲突由下面的 EXEMPT_CONFLICT 单独表达，
    // 两者合并成同一个 seen 会让「这条写了两次」和「这条两侧都登记了」不可区分。
    if (exemptKeys.has(key)) {
      debt('REGISTRY_INVALID', '登记重复：' + key)
      continue
    }
    exemptKeys.add(key)
  }
  // 条目层面的形状问题（why 太短 / 同列表重复）同样必须早退：这些 key 没有进 requiredKeys /
  // exemptKeys，继续往下会再报一条「既未登记进 required 也未 exempt」——那句话是**假的**
  // （用户确实登记了，只是写坏了），会把「改一改这一条」误导成「去新加一条登记」。
  // 早退不改变结论方向：REGISTRY_INVALID 本身是 debt ⇒ 门禁照红。
  if (problems.length > 0) return problems
  const domainKeys = new Set(domain.map((job) => job.key))
  for (const key of requiredKeys) {
    if (exemptKeys.has(key)) debt('EXEMPT_CONFLICT', key + ' 同时出现在 required 与 exempt 里')
    if (!domainKeys.has(key)) debt('STALE_REQUIRED', key + ' 已不在域内（判据或 workflow 变了）⇒ 请删掉这条登记')
  }
  for (const key of exemptKeys) {
    if (!domainKeys.has(key)) debt('STALE_EXEMPT', key + ' 已不在域内 ⇒ 豁免已陈旧，请删掉')
  }
  for (const job of domain) {
    if (!requiredKeys.has(job.key) && !exemptKeys.has(job.key)) {
      debt('UNREGISTERED_IN_DOMAIN', job.key + ' 会跑桌面 vitest 但既未登记进 required 也未 exempt')
    }
  }
  for (const key of requiredKeys) {
    const [file, jobId] = key.split('#')
    if (!workflowJobs.has(file)) {
      debt('REGISTRY_STALE', key + ' 指向不存在的 workflow（' + file + '）')
    } else if (!workflowJobs.get(file).has(jobId)) {
      debt('REGISTRY_STALE', key + ' 指向的 job 不存在于 ' + file)
    }
  }
  return problems
}

/**
 * 把「PR 侧红灯不构成证据」写进工具输出（NOTE，不进 rc）
 * @param {Object} job
 * @returns {string[]}
 */
function judgeJobEvents (job) {
  const notes = []
  for (const step of job.steps) {
    if (step.ifText.length > 0 && step.ifText.includes('pull_request')) {
      const label = step.name.length > 0 ? '"' + step.name + '" ' : ''
      notes.push(job.key + ' step[' + step.index + '] ' + label +
        '带 `if: …pull_request…`：PR 侧该步骤被跳过 ⇒ PR 全绿不构成「这条判据在 CI 上跑过」的证据')
    }
  }
  return notes
}

/** 读全部 workflow（.yml/.yaml），带文件数/job 数下界 */
function loadWorkflows (root) {
  const dir = path.join(root, WORKFLOWS_REL)
  let names
  try {
    names = fs.readdirSync(dir).filter((name) => /\.ya?ml$/.test(name)).sort()
  } catch (err) {
    fail('SCAN_FAILURE', '无法读取 ' + WORKFLOWS_REL + '：' + err.message)
  }
  if (names.length < MIN_WORKFLOW_FILES) {
    fail('WORKFLOW_COUNT_BELOW_MIN', WORKFLOWS_REL + ' 只扫到 ' + names.length + ' 份 workflow，低于下界 ' +
      MIN_WORKFLOW_FILES + ' ⇒ 扫描域已失准（路径写错？夹具没建全？）')
  }
  const out = []
  let jobTotal = 0
  for (const name of names) {
    let text
    try {
      text = fs.readFileSync(path.join(dir, name), 'utf8')
    } catch (err) {
      fail('SCAN_FAILURE', '无法读取 ' + name + '：' + err.message)
    }
    let doc
    try {
      doc = yaml.load(text)
    } catch (err) {
      fail('YAML_PARSE_FAILURE', name + ' 无法解析：' + err.message)
    }
    if (!isPlainObject(doc) || !isPlainObject(doc.jobs) || Object.keys(doc.jobs).length === 0) {
      fail('WORKFLOW_JOBS_MISSING', name + ' 缺少非空 jobs 映射')
    }
    jobTotal += Object.keys(doc.jobs).length
    out.push({ file: name, doc, jobs: Object.keys(doc.jobs) })
  }
  if (jobTotal < MIN_JOBS) {
    fail('JOBS_BELOW_MIN', '全部 workflow 只扫到 ' + jobTotal + ' 个 job，低于下界 ' + MIN_JOBS)
  }
  return out
}

/** 读登记表：读不到/解析不了 ⇒ rc=2 自故障（不是「没欠账」） */
function loadRegistry (root) {
  let text
  try {
    text = fs.readFileSync(path.join(root, REGISTRY_REL), 'utf8')
  } catch (err) {
    fail('REGISTRY_UNREADABLE', '无法读取登记表 ' + REGISTRY_REL + '：' + err.message)
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    fail('REGISTRY_UNREADABLE', '登记表 ' + REGISTRY_REL + ' 不是合法 JSON：' + err.message)
  }
}

/**
 * 收集全部判据结果（不打印、不退出；供测试直接 require 使用）
 * @param {{root?: string}} [options]
 * @returns {{root: string, workflows: Array, jobs: Array, entries: Array, formCounts: Object, problems: Array, notes: string[], domain: Array}}
 */
function collect (options) {
  const opts = options || {}
  const root = opts.root ? path.resolve(opts.root) : REPO_ROOT
  const problems = []
  const debt = (code, message) => problems.push({ code, severity: 'debt', message })
  const fatal = (code, message) => problems.push({ code, severity: 'fatal', message })
  const result = { root, workflows: [], jobs: [], entries: [], formCounts: {}, problems, notes: [], domain: [] }
  try {
    const maps = loadScriptMaps(root)
    const workflows = loadWorkflows(root)
    result.workflows = workflows
    const scavenged = scavengeWorkflows(workflows, maps, root)
    result.jobs = scavenged.jobs
    result.entries = scavenged.entries
    result.formCounts = scavenged.formCounts
    for (const key of FORM_KEYS) {
      const seen = scavenged.formCounts[key] || 0
      const min = MIN_FORM_COUNTS[key]
      if (typeof min === 'number' && seen < min) {
        fatal('FORM_COUNT_BELOW_MIN', '形态 ' + key + ' 只命中 ' + seen + ' 处，低于下界 ' + min + '（扫描器失明？）')
      }
      const max = MAX_FORM_COUNTS[key]
      if (typeof max === 'number' && seen > max) {
        debt('FORM_COUNT_EXCEEDED', '形态 ' + key + ' 命中 ' + seen + ' 处，高于上界 ' + max + '（新增用法需同步评估）')
      }
    }
    const domain = scavenged.jobs.filter((job) => job.inDomain)
    result.domain = domain
    const registry = loadRegistry(root)
    result.registry = registry
    if (domain.length === 0 && registry._allowEmptyDomain !== true) {
      fatal('EMPTY_DOMAIN', '域内 job 为 0 而登记表明示不允许空域 ⇒ 判扫描器失准，不得读成「已通过」')
    }
    for (const problem of judgeRegistry(domain, registry, { workflows })) problems.push(problem)
    for (const job of scavenged.jobs) {
      if (!job.inDomain) continue
      for (const note of judgeJobEvents(job)) result.notes.push(note)
      if (job.satisfierSteps.length === 0) {
        debt('BUILD_MISSING', job.key + ' 会跑桌面 vitest（' +
          job.entries.filter((entry) => entry.verdict.inDomain).map((entry) => entry.ref).join(', ') +
          '），但整个 job 没有任何 preload 重建步骤（' + SATISFIER_REF + '）')
        continue
      }
      const offenders = new Map()
      for (const entry of job.entries) {
        if (!entry.verdict.inDomain) continue
        if (job.satisfierSteps.some((index) => index <= entry.index)) continue
        if (!offenders.has(entry.index)) offenders.set(entry.index, [])
        offenders.get(entry.index).push(entry.ref)
      }
      for (const [stepIndex, refs] of offenders) {
        const later = job.satisfierSteps.filter((index) => index > stepIndex)
        debt('BUILD_NOT_BEFORE_TESTS', job.key + ' step[' + stepIndex + '] 的 ' + refs.join(', ') +
          ' 跑在 preload 重建之前（满足器在 ' +
          (later.length > 0 ? 'step[' + later.join(',') + ']' : 'step[' + job.satisfierSteps.join(',') + ']，更晚或同在一步') + '）')
      }
    }
  } catch (err) {
    if (err && typeof err.code === 'string') fatal(err.code, err.message)
    else fatal('SCAN_FAILURE', '未预期错误：' + (err && err.stack ? err.stack : String(err)))
  }
  return result
}

/**
 * 打印报告：--json 只吐 JSON（供机器解析），否则吐人读行 + GitHub 注解
 * @param {Object} result collect() 的返回值
 * @param {{json?: boolean, verbose?: boolean}} [args]
 */
function printReport (result, args) {
  const opts = args || {}
  const domain = result.domain || []
  if (opts.json) {
    const payload = {
      root: result.root,
      workflowCount: result.workflows.length,
      jobCount: result.jobs.length,
      entryCount: result.entries.length,
      formCounts: result.formCounts,
      domain: domain.map((job) => ({
        key: job.key,
        satisfierSteps: job.satisfierSteps,
        entries: job.entries.filter((entry) => entry.verdict.inDomain).map((entry) => ({
          stepIndex: entry.index,
          form: entry.form,
          ref: entry.ref,
          code: entry.verdict.code,
          closure: entry.verdict.closure || []
        }))
      })),
      problems: result.problems,
      notes: result.notes
    }
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  const lines = []
  lines.push('[desktop-test-prereqs] root=' + result.root)
  lines.push('  workflows=' + result.workflows.length + ' jobs=' + result.jobs.length +
    ' entries=' + result.entries.length + ' in-domain=' + domain.length)
  lines.push('  forms ' + FORM_KEYS.map((key) => key + '=' + (result.formCounts[key] || 0)).join(' '))
  for (const job of domain) {
    lines.push('  [in-domain] ' + job.key + ' ' +
      (job.satisfierSteps.length > 0 ? 'build@step[' + job.satisfierSteps.join(',') + ']' : 'build=NONE'))
    for (const entry of job.entries) {
      if (!entry.verdict.inDomain) continue
      const ok = job.satisfierSteps.some((index) => index <= entry.index)
      lines.push('      step[' + entry.index + '] ' + entry.form + ' ref=' + entry.ref +
        ' -> ' + entry.verdict.code + ' ' + (ok ? 'ok' : 'BLOCKED') + ' · ' + entry.verdict.why)
    }
  }
  if (opts.verbose) {
    lines.push('  --- 全部 job 的命中明细（含域外）---')
    for (const job of result.jobs) {
      if (job.entries.length === 0) continue
      lines.push('  ' + job.key + (job.inDomain ? ' [in-domain]' : ' [out]'))
      for (const entry of job.entries) {
        lines.push('      step[' + entry.index + '] ' + entry.form + ' ref=' + entry.ref +
          ' -> ' + (entry.verdict.inDomain ? 'IN' : 'OUT') + ':' + entry.verdict.code)
      }
    }
  }
  for (const note of result.notes) lines.push('  [NOTE] ' + note)
  const fatal = result.problems.filter((problem) => problem.severity === 'fatal')
  const debt = result.problems.filter((problem) => problem.severity === 'debt')
  for (const problem of fatal) lines.push('  [FATAL:' + problem.code + '] ' + problem.message)
  for (const problem of debt) lines.push('  [DEBT:' + problem.code + '] ' + problem.message)
  lines.push('  problems: fatal=' + fatal.length + ' debt=' + debt.length)
  console.log(lines.join('\n'))
  for (const problem of result.problems) {
    console.log('::error title=' + problem.code + '::' + problem.message)
  }
}

/**
 * 解析 CLI 参数：未知旗标/非法取值一律抛 ARGS_INVALID（禁止静默忽略）
 * @param {string[]} argv
 * @returns {{root: string, json: boolean, verbose: boolean, help: boolean}}
 */
function parseArgs (argv) {
  const args = { root: REPO_ROOT, json: false, verbose: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--json') {
      args.json = true
      continue
    }
    if (token === '--verbose') {
      args.verbose = true
      continue
    }
    if (token === '--help' || token === '-h') {
      args.help = true
      continue
    }
    if (token === '--root') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value.length === 0 || value.startsWith('-')) {
        fail('ARGS_INVALID', '--root 需要一个目录参数')
      }
      args.root = path.resolve(value)
      i += 1
      continue
    }
    if (token.startsWith('--root=')) {
      const value = token.slice('--root='.length)
      if (value.length === 0) fail('ARGS_INVALID', '--root= 需要一个目录参数')
      args.root = path.resolve(value)
      continue
    }
    fail('ARGS_INVALID', '未知参数 ' + token + '（支持 --json / --verbose / --root=<dir> / --root <dir> / --help）')
  }
  return args
}

const USAGE = [
  '用法：node .github/scripts/check-desktop-test-prereqs.js [--json] [--verbose] [--root=<dir>]',
  '',
  '判据：任何会跑 apps/desktop 的 vitest 的 CI job，都必须在它之前重建 preload 产物。',
  '退出码：0=通过；1=欠账（BUILD_* / UNREGISTERED_IN_DOMAIN / STALE_* / REGISTRY_* / FORM_COUNT_EXCEEDED）；',
  '        2=扫描器自身故障（SCAN_FAILURE / YAML_PARSE_FAILURE / *BELOW_MIN / EMPTY_DOMAIN / ARGS_INVALID / REGISTRY_UNREADABLE）。'
].join('\n')

/**
 * @param {string[]} [argv]
 * @returns {number} 退出码
 */
function main (argv) {
  let args
  try {
    args = parseArgs(Array.isArray(argv) ? argv : process.argv.slice(2))
  } catch (err) {
    console.error('[desktop-test-prereqs] ' + (err && err.code ? err.code : 'ARGS_INVALID') + '：' + err.message)
    console.error(USAGE)
    return 2
  }
  if (args.help) {
    console.log(USAGE)
    return 0
  }
  const result = collect({ root: args.root })
  printReport(result, args)
  if (result.problems.some((problem) => problem.severity === 'fatal')) return 2
  if (result.problems.length > 0) return 1
  return 0
}

if (require.main === module) {
  process.exitCode = main()
}

module.exports = {
  REPO_ROOT,
  WORKFLOWS_REL,
  REGISTRY_REL,
  ROOT_PACKAGE_REL,
  DESKTOP_PACKAGE_REL,
  SATISFIER_SCRIPT,
  SATISFIER_REF,
  ORACLE_BASENAME,
  ORACLE_SCRIPT_REF,
  FORM_KEYS,
  MIN_WORKFLOW_FILES,
  MIN_JOBS,
  MIN_FORM_COUNTS,
  MAX_FORM_COUNTS,
  stripLineComment,
  stripComments,
  stripQuotedSpans,
  normalizeForScan,
  viewFlat,
  viewCode,
  runsVitestCommand,
  hasConfigFlag,
  excludesDesktop,
  hasTestTarget,
  loadScriptMaps,
  lookupScripts,
  resolveScriptClosure,
  extractScriptRefs,
  continuationWindow,
  pickPnpmCandidate,
  judgeNxText,
  judgeEntry,
  delegateRunsDesktopSuite,
  DELEGATE_ANCHORS,
  DELEGATE_CLI_RE,
  judgeRegistry,
  judgeJobEvents,
  scanStep,
  buildsPreloadStep,
  scavengeWorkflows,
  loadWorkflows,
  loadRegistry,
  collect,
  printReport,
  parseArgs,
  main
}
