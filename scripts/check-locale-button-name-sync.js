#!/usr/bin/env node
/**
 * check-locale-button-name-sync.js — 引导文案里引用的按钮名必须与 locale 逐字一致
 *
 * 动因（2026-10-17，change: collected-results-fix）：PRD §4.3 的「阶段引导」文案在
 * locale 里**手写**了按钮名（「获取收藏夹」「加载收藏内容」「采集并改写」）。若将来改
 * `loadBtn` / `loadContents` / `collectAndRewrite` 的值而忘了同步改引导文案，界面会
 * 出现「引导让你点一个不存在的按钮」——此前无任何机械判据覆盖。
 *
 * 形态：**显式登记表**（REGISTRY），不是启发式正则。本仓实测教训：启发式一次引入
 * 5 个假阳的结局是逼人清空登记表（AGENTS.md「spec-mirror-wiring-gate」一节）。
 * 登记表声明「哪个 key 引用了哪些按钮 key」，判据逐字核对值相等；登记之外的一律不管。
 *
 * ⚠️ 格式契约（QM-6 评审 #4，2026-10-17）：
 *   1. 引导文案里的**按钮名**必须用「…」（zh）或 "…"（en）包裹，且被引用按钮名的
 *      **出现顺序**与该条登记的 refKeys 一致 —— 判据按段序取第 n 个引用段比对。
 *   2. 因此改引导文案的**措辞结构**（按钮名移出引号 / 调整引用顺序 / 增删引用段）
 *      属于判据契约变更：必须同步调整 `referencedNames` 或 REGISTRY，只改登记表不够。
 *   3. fail-closed 兜底：取不到第 n 个段会报 mismatch（显示「(无)」），不会静默放行。
 *
 * 用法：
 *   node scripts/check-locale-button-name-sync.js                    # 校验真实仓库
 *   （测试里传 { localesDir } 用临时目录）
 *
 * 退出码：0 = 一致；1 = 存在不一致 / key 缺失。fail-closed：locale 读不到也判 1。
 */
const fs = require('node:fs')
const path = require('node:path')

/**
 * 显式登记表：每条 = 一条「引用了按钮名的引导文案」。
 *   localeKey : 引导文案的 key（相对 collection 命名空间，如 collection.zhihuFav.*）
 *   refKeys   : 它引用的按钮 key（同命名空间）
 *   locales   : 限定检查哪些语言文件（缺省 ['zh','en']）
 */
const REGISTRY = [
  {
    // 「下一步：点「获取收藏夹」拉取收藏夹列表…」/ 'Next: click "Load Favorites" …'
    // 只引用了 1 个按钮名（首个「」/"…" 段）。注意：获取收藏夹按钮的 key 在
    // **zhihuFavlist** 区块（loadBtn），不在 zhihuFav —— 登记必须按真实归属。
    localeKey: 'zhihuFav.stepHintNoFavlists',
    refKeys: ['zhihuFavlist.loadBtn'],
  },
  {
    // 「…点「加载收藏内容」…并「采集并改写」」/ '…click "Load items" … collected & rewritten.'
    // zh 恰好两个都取得到；en 里「采集并改写」是作为普通短语出现的（"collected & rewritten"），
    // 不做逐字核对 —— 因此按语言给 refKeys。
    localeKey: 'zhihuFav.stepHintNeedContents',
    refKeys: ['zhihuFav.loadContents', 'zhihuFav.collectAndRewrite'],
    locales: { zh: ['zhihuFav.loadContents', 'zhihuFav.collectAndRewrite'], en: ['zhihuFav.loadContents'] },
  },
]

/** 从 locale 源码里抽出 `key: 'value'` 的值（单/双引号都支持；值内转义按字面保留）。
 *  不做 JS 求值 —— locale 文件是 ESM，eval 有副作用风险；正则提取对本用途足够，
 *  且失败时 fail-closed。 */
/**
 * 从 locale 源码抽 `key: 'value'` 的值。
 *
 * 支持区块限定（2026-10-17 修，change: fav-collect-ux）：key 可写 `区块.key`
 * （如 `zhihuFav.collectAndRewrite`）——本仓 `zhihuFavlist` 与 `zhihuFav` 是**同级**区块，
 * 内层同名 key 各有一份，裸 key 恒取第一个匹配 ⇒ 当两个区块同名 key 的值不同时
 * （本次实况：zhihuFavlist 仍是旧值「采集并改写」，zhihuFav 已改「采集&改写」），
 * 裸 key 会比对到错误的值。fail-closed：带前缀但找不到该区块/该 key 时返回 undefined。
 */
function extractValue (src, key) {
  const dot = key.indexOf('.')
  let block = null
  let leaf = key
  if (dot > 0) {
    block = key.slice(0, dot)
    leaf = key.slice(dot + 1)
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let scope = src
  if (block) {
    const bm = src.match(new RegExp("(?:^|\\n)\\s*" + esc(block) + ":\\s*\\{"))
    if (!bm) return undefined
    scope = src.slice(bm.index + bm[0].length)
  }
  const re = new RegExp("(?:^|\\n)\\s*(?://[^\\n]*\\n\\s*)*" + esc(leaf) + ":\\s*('(?:[^'\\\\]|\\\\.)*'|\"(?:[^\"\\\\]|\\\\.)*\")")
  const m = scope.match(re)
  if (!m) return undefined
  return m[1].slice(1, -1)
}

/** 从「下一步：点「X」…」这类文案里取被引用的按钮名：取登记时约定的第 n 个「…」段。 */
function referencedNames (text, count) {
  const names = []
  const re = /[「"]([^」"]+)[」"]/g
  let m
  while ((m = re.exec(text)) !== null) names.push(m[1])
  return names.slice(0, count)
}

function checkOneLocale (localesDir, locale, registry) {
  const findings = []
  const file = path.join(localesDir, 'collection', locale + '.js')
  if (!fs.existsSync(file)) {
    return [{ kind: 'missing-file', locale, detail: file }]
  }
  const src = fs.readFileSync(file, 'utf8')
  for (const entry of registry) {
    // 按语言覆盖 refKeys（en/zh 文案结构不同时用；未给 locales 时两边都用 entry.refKeys）
    const refKeys = (entry.locales && entry.locales[locale]) || entry.refKeys
    // 传完整 key（含区块前缀）：同名 key 分属两个同级区块时，裸 key 恒取第一个匹配，
    // 会比对到另一个区块的值（本次实况：zhihuFavlist 旧值 vs zhihuFav 新值 ⇒ 永远 PASS 的假绿）。
    const text = extractValue(src, entry.localeKey)
    if (text === undefined) {
      findings.push({ kind: 'missing-key', locale, localeKey: entry.localeKey, detail: entry.localeKey + ' 在 ' + locale + '.js 缺失' })
      continue
    }
    const names = referencedNames(text, refKeys.length)
    for (let i = 0; i < refKeys.length; i++) {
      const refKey = refKeys[i]
      // 同样传完整 key（同 text 的修复理由：同名 key 跨区块时裸 key 取错值）
      const expected = extractValue(src, refKey)
      if (expected === undefined) {
        findings.push({ kind: 'missing-ref', locale, localeKey: entry.localeKey, refKey, detail: refKey + ' 在 ' + locale + '.js 缺失（登记表指向了不存在的按钮 key）' })
        continue
      }
      const got = names[i]
      if (got !== expected) {
        findings.push({
          kind: 'mismatch', locale, localeKey: entry.localeKey, refKey,
          detail: entry.localeKey + '（' + locale + '）引用的第 ' + (i + 1) + ' 个按钮名是「' + (got ?? '(无)') + '」，但 ' + refKey + ' 的现值是「' + expected + '」——按钮文案改了而引导没跟，用户会被指去点一个不存在的按钮',
        })
      }
    }
  }
  return findings
}

/**
 * @param {object} [opts]
 * @param {string} [opts.localesDir] locale 目录（缺省 = 仓库内 apps/desktop/src/locales）
 * @returns {{ ok: boolean, findings: Array<{kind:string,locale?:string,localeKey?:string,refKey?:string,detail:string}> }}
 */
function checkButtonNameSync (opts = {}) {
  const localesDir = opts.localesDir || path.join(__dirname, '..', 'apps', 'desktop', 'src', 'locales')
  const findings = []
  for (const locale of ['zh', 'en']) {
    findings.push(...checkOneLocale(localesDir, locale, REGISTRY))
  }
  return { ok: findings.length === 0, findings }
}

function main () {
  const res = checkButtonNameSync()
  console.log('[locale-button-name-sync] 登记条目 ' + REGISTRY.length + ' 条；结果 ' + (res.ok ? 'PASS' : 'FAIL'))
  for (const f of res.findings) console.log('  ❌ [' + f.kind + '] ' + f.detail)
  if (!res.ok) {
    console.log('  修法：改按钮文案时同步更新引用它的引导文案（登记表见本文件 REGISTRY）。')
    console.log('  若是**新增**一条引用按钮名的引导文案：把 (localeKey, refKeys) 登记进来，再让它过。')
    process.exit(1)
  }
}

if (require.main === module) main()

module.exports = { checkButtonNameSync, REGISTRY, extractValue, referencedNames }
