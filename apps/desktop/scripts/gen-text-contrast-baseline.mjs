/**
 * gen-text-contrast-baseline —— 用**采集实现本身**重算并落盘 `Accounts.text-contrast-baseline.json`
 *
 * 为什么要有这份脚本（而不是每次临场手写一段）：QM-6 可维护性轴把「生成基线」与「校验基线」
 * 各写一份判据点名为本单元最高危单点。收敛成一份采集（`src/styles/text-contrast-sites.js`）后，
 * 如果"重跑生成器"这件事只存在于某次会话的临时脚本里，下一个会话仍会手写第三份口径 ——
 * 于是同一份基线会在两种形状之间来回，而两边读起来都像有门禁。
 *
 * 职责边界（越界即假绿）：
 *   - 本脚本**只重算读数**（per：ratio / need / surface / unresolved），以及"现场新增了哪些裸 hex 条目"。
 *   - `status`（needs-design / compliant-bare）与 `tokenCandidates` 是**人的判断**，脚本一律沿用旧基线，
 *     新出现的裸 hex 条目一律标 `status: null` 并让 `--check` 与写入路径同时非零退出 ——
 *     脚本不得代拍"这处算不算设计裁决"（那属产品裁决）。
 *   - `surfaces`（底色/边框/描边裸 hex 清单）按现场重算，判据与测试里那份扫描口径必须同源，
 *     不同源由测试的「清单没跟上现场」那条红来暴露。
 *
 * 用法：
 *   node apps/desktop/scripts/gen-text-contrast-baseline.mjs            # 重写基线文件
 *   node apps/desktop/scripts/gen-text-contrast-baseline.mjs --check    # 只比对，不写；有差异即 rc=1
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectSites, siteFails } from '../src/styles/text-contrast-sites.js'
import { scanStyleRules } from '../src/styles/color-token-reader.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'src')
const VUE = path.join(SRC, 'views', 'Accounts.vue')
const TOKENS = path.join(SRC, 'styles', 'tokens.css')
const BASELINE = path.join(SRC, 'views', 'Accounts.text-contrast-baseline.json')
const CHECK = process.argv.includes('--check')

/** 读文件并归一为 LF：基线 JSON 与源码都必须以 LF 口径比较（行尾不是内容） */
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

/**
 * 表面裸 hex 清单的扫描口径 —— 与 `Accounts.text-contrast.test.js` 里那条「清单没跟上现场」同判据。
 * ⛔ 两处必须逐字同形；改一处不改另一处会让测试当场红（这正是本文件存在的理由）。
 */
export function scanBareSurfaces (vueSrc) {
  const out = []
  for (const r of scanStyleRules(vueSrc)) {
    for (const k of ['background', 'background-color', 'border', 'border-color', 'outline']) {
      const v = r.decls[k]
      if (!v) continue
      if (/(^|[^-\w])#[0-9a-fA-F]{3,8}/.test(String(v).replace(/var\([^)]*\)/g, ''))) {
        out.push({ selector: r.selector, prop: k, value: String(v).trim() })
      }
    }
  }
  return out
}

/**
 * 生成新基线：读数来自采集实现，判断字段沿用旧基线。
 * @returns {{json:string, unmapped:string[]}} unmapped = 现场新增、还没有人裁决过的裸 hex 条目
 */
export function buildBaseline (oldBaseline, sites, surfaces) {
  const bySelector = new Map(oldBaseline.exemptions.map((e) => [e.selector, e]))
  // surfaces 里人写的 note（例如"这一族是死样式"）必须跟着走：按 selector+prop 回挂，
  // 否则"重跑一次生成器"就把人工批注洗掉了 —— 而那批注正是下一个人判断该不该删的依据。
  const noteByKey = new Map((oldBaseline.surfaces || []).map((s) => [`${s.selector}||${s.prop}`, s.note]).filter(([, v]) => v))
  const mergedSurfaces = surfaces.map((s) => {
    const note = noteByKey.get(`${s.selector}||${s.prop}`)
    return note ? { ...s, note } : s
  })
  // 登记面 = 「裸 hex 文字色」∪「判据读过不了的站点」。第二半是 2026-10-20 补的：
  // `.search-icon` / `.clear-search` 的 color 是 **token**（不是裸 hex），但它们的承载底是
  // `position: absolute` 定位出来的兄弟面，判据定位不了 ⇒ ratio=null。只按"裸 hex"建条目，
  // 这些站点会被生成器整体丢掉，而下一条判据（每条 AA 不过都必须落在基线里）当场判红 ——
  // 那等于"重跑生成器就把已核对的基线改成另一种形状"，正是 QM-6 可维护性轴点名的失效模式。
  const registered = sites.filter((s) => /^#[0-9a-f]{3,8}$/i.test(s.value) || siteFails(s))
  const unmapped = []
  const exemptions = registered.map((s) => {
    const old = bySelector.get(s.selector)
    if (!old) {
      unmapped.push(s.selector)
      return { selector: s.selector, value: s.value, per: s.per, status: null, tokenCandidates: [] }
    }
    return {
      selector: s.selector,
      value: s.value,
      per: s.per,
      status: old.status,
      tokenCandidates: old.tokenCandidates || [],
      ...(old.reason ? { reason: old.reason } : {}),
    }
  })
  // 按选择器字典序输出：采集实现给的是 CSS 源码顺序，而 CSS 里插入一条规则就会让整段清单重排，
  // 于是"只改了一个颜色"的 diff 看起来像"重写了整份基线"。排序与内容无关，纯粹让 diff 可读。
  exemptions.sort((a, b) => (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0))
  const next = { _comment: oldBaseline._comment, exemptions, surfaces: mergedSurfaces }
  return { json: JSON.stringify(next, null, 2) + '\n', unmapped }
}

function main () {
  const vue = read(VUE)
  const tokens = read(TOKENS)
  const rawBaseline = readFileSync(BASELINE, 'utf8')
  // ⛔ 行尾不是内容，但**改写它**会让 git 把整份文件判为逐行变更（本仓实测把 13k 行 diff 撑成 42k）。
  // 所以生成器落盘时沿用文件自己现在的行尾，不"统一成一种"。
  const eol = rawBaseline.includes('\r\n') ? '\r\n' : '\n'
  const old = JSON.parse(rawBaseline.replace(/\r\n/g, '\n'))
  const { sites } = collectSites(vue, tokens)
  const surfaces = scanBareSurfaces(vue)
  const { json, unmapped } = buildBaseline(old, sites, surfaces)
  const current = rawBaseline.replace(/\r\n/g, '\n')
  const withEol = json.replace(/\n/g, eol)
  if (unmapped.length) {
    console.error(`新增裸 hex 条目 ${unmapped.length} 处尚无人工裁决的 status：${unmapped.join(' | ')}`)
    console.error('⇒ status 属判断不属读数，脚本不得代拍；请先在基线里为每条写出 status 与 reason 再重跑。')
    process.exitCode = 1
    return
  }
  if (CHECK) {
    if (json === current) { console.log('BASELINE-IN-SYNC 读数与现场逐字段一致'); return }
    console.error('BASELINE-DRIFT 基线与现场读数不一致（下面是两边的差异行）')
    const a = current.split('\n'); const b = json.split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) console.error(`  L${i + 1}\n    基线: ${a[i]}\n    现场: ${b[i]}`)
    process.exitCode = 1
    return
  }
  writeFileSync(BASELINE, withEol, 'utf8')
  console.log(`WROTE ${path.relative(process.cwd(), BASELINE)} eol=${eol === '\r\n' ? 'crlf' : 'lf'} exemptions=${JSON.parse(json).exemptions.length} surfaces=${surfaces.length}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main()
