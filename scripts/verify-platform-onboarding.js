#!/usr/bin/env node
/**
 * verify-platform-onboarding — 扩平台标准动作自检（设计文 §9.3 的 11 步 + 2 条额外判据）
 *
 * 用法：node scripts/verify-platform-onboarding.js <slug>
 *
 * ## 为什么要有这个脚本
 *
 * 设计文 §9.3 把「扩一个平台」拆成 11 步，每步都有明确的文件与判据。但**靠人逐条核**有两个问题：
 *   ① 漏一步不会报错 —— 平台照样能发，直到某个平台的分类 ID 被拒、或正文被平台按 HTML
 *      解析后塌成一行，才发现；
 *   ② 判据分散在 7 个文件里，新会话不知道「还有第 8 步」。
 *
 * 本脚本把 11 步变成**一条命令**，逐条输出 PASS/FAIL，并对不存在的 slug **非零退出**
 * （不静默通过 —— 静默通过是这类自检脚本最坏的失败形态）。
 *
 * ## 两条额外判据（不在 11 步里，但 AGENTS.md 有硬规定）
 *
 *   ⑫ 新平台正文链**不含**自己写的 `<p>` 包装或 HTML 剥离（源码扫描）
 *      —— 承载形态必须经 `formatArticleBody()` 单一实现，禁止各链自抄转换。
 *   ⑬ **顺序不变量**：话题转换必须先于 `<p>` 包装
 *      —— 反序会让 `(^|\s)#话题` 因井号前是 `>` 而停在单井号形态。
 *
 * ## 路径说明
 *
 * 本脚本里的路径来自设计文 **§9.3 正文表格**（该表标注「已核实存在」）。
 * ⚠️ PLAN 文件 P3-1 那行把三个路径写错了（`apps/desktop/electron/services/platform-definitions.js`、
 * `config/publish-capabilities.json`、`apps/desktop/electron/services/platform-entries.js` 都不存在）。
 * 照那份写会 11 步全 FAIL。**以本脚本为准。**
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')

/** 步骤定义：每项返回 { ok, detail } */
function buildChecks (slug) {
  const read = (rel) => {
    const p = path.join(ROOT, rel)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  }

  const defs = () => read('packages/shared-utils/src/platform-definitions.js')
  const formatter = () => read('packages/api-publish-engine/src/content-formatter.js')
  const caps = () => read('packages/shared-utils/src/publish-capabilities.json')
  const yamlText = () => read('config/platforms.yaml')

  const checks = []
  const add = (id, title, fn) => checks.push({ id, title, fn })

  add(1, 'platform-definitions.js 的 PLATFORM_LOGIN_URLS 命中', () => {
    const t = defs()
    if (!t) return { ok: false, detail: '文件不存在' }
    const m = t.match(/PLATFORM_LOGIN_URLS\s*=\s*\{([\s\S]*?)\n\}/)
    if (!m) return { ok: false, detail: '未找到 PLATFORM_LOGIN_URLS' }
    return m[1].includes(`${slug}:`)
      ? { ok: true, detail: '命中' }
      : { ok: false, detail: `PLATFORM_LOGIN_URLS 无 ${slug}:` }
  })

  add(2, 'platform-definitions.js 的 PLATFORM_DASHBOARD_URLS 命中', () => {
    const t = defs()
    if (!t) return { ok: false, detail: '文件不存在' }
    const m = t.match(/PLATFORM_DASHBOARD_URLS\s*=\s*\{([\s\S]*?)\n\}/)
    if (!m) return { ok: false, detail: '未找到 PLATFORM_DASHBOARD_URLS' }
    return m[1].includes(`${slug}:`)
      ? { ok: true, detail: '命中' }
      : { ok: false, detail: `PLATFORM_DASHBOARD_URLS 无 ${slug}:` }
  })

  add(3, 'platform-definitions.js 的 PLATFORM_LOGIN_SUCCESS_PATTERNS 命中', () => {
    const t = defs()
    if (!t) return { ok: false, detail: '文件不存在' }
    const m = t.match(/PLATFORM_LOGIN_SUCCESS_PATTERNS\s*=\s*\{([\s\S]*?)\n\}/)
    if (!m) return { ok: false, detail: '未找到 PLATFORM_LOGIN_SUCCESS_PATTERNS' }
    return m[1].includes(`${slug}:`)
      ? { ok: true, detail: '命中（⚠️ 同域平台须用路径精确匹配，见该文件既有反例注释）' }
      : { ok: false, detail: `PLATFORM_LOGIN_SUCCESS_PATTERNS 无 ${slug}:` }
  })

  add(4, 'config/platforms.yaml 该 slug 配置字段完整', () => {
    const t = yamlText()
    if (!t) return { ok: false, detail: '文件不存在' }
    const blockLines = platformYamlBlock(t, slug)
    if (!blockLines) return { ok: false, detail: `platforms.yaml 无 ${slug}: 段` }
    const block = blockLines.join('\n')
    const need = ['type', 'content_category', 'max_title', 'max_content', 'has_api', 'publishMode', 'enabled']
    const missing = need.filter((k) => !new RegExp(`^\\s{4}${k}:`, 'm').test(block))
    return missing.length === 0
      ? { ok: true, detail: `7 个字段齐（含 has_api / publishMode）` }
      : { ok: false, detail: `缺字段: ${missing.join(', ')}` }
  })

  add(5, 'publish-capabilities.json 元数据 + validateRegistry() 空数组', () => {
    const t = caps()
    if (!t) return { ok: false, detail: '文件不存在' }
    let j
    try { j = JSON.parse(t) } catch (e) { return { ok: false, detail: 'JSON 解析失败: ' + e.message } }
    const flat = JSON.stringify(j)
    if (!flat.includes(`"${slug}"`)) return { ok: false, detail: `注册表无 ${slug}` }
    let vr = null
    try {
      const mod = require(path.join(ROOT, 'packages/shared-utils/src/publish-capabilities.js'))
      vr = typeof mod.validateRegistry === 'function' ? mod.validateRegistry() : null
    } catch (e) { return { ok: false, detail: '加载 publish-capabilities.js 失败: ' + e.message } }
    if (vr === null) return { ok: false, detail: '导出里没有 validateRegistry()' }
    return (Array.isArray(vr) && vr.length === 0)
      ? { ok: true, detail: '元数据命中 + validateRegistry() 空数组' }
      : { ok: false, detail: `validateRegistry() 返回 ${JSON.stringify(vr)}` }
  })

  add(6, 'getArticleBodyKind() 符合预期', () => {
    let mod
    try { mod = require(path.join(ROOT, 'packages/api-publish-engine/src/content-formatter.js')) } catch (e) {
      return { ok: false, detail: '加载失败: ' + e.message }
    }
    if (typeof mod.getArticleBodyKind !== 'function') return { ok: false, detail: '无 getArticleBodyKind 导出' }
    const kind = mod.getArticleBodyKind(slug)
    return ['html', 'plain'].includes(kind)
      ? { ok: true, detail: `kind='${kind}'（未知平台保守按 plain 是内置行为）` }
      : { ok: false, detail: `kind='${kind}' 不是 html/plain` }
  })

  // TAG_STYLES 的**默认兜底值**，从实现里读出来（不复制字面量）。
  // 用途：判据 7/8 对「TAG_STYLES 缺席」的平台不再一律判 FAIL（见下）。
  function tagStylesDefault (formatterText) {
    const m = formatterText.match(/TAG_STYLES\[platform\]\s*\|\|\s*'([^']+)'/)
    return m ? m[1] : null
  }

  add(7, '上限表一致（CONTENT_LIMITS / TITLE_LIMITS 必须有键；TAG_STYLES 可缺席走默认）', () => {
    const t = formatter()
    if (!t) return { ok: false, detail: '文件不存在' }
    const missing = []
    for (const name of ['CONTENT_LIMITS', 'TITLE_LIMITS']) {
      const m = t.match(new RegExp(`${name}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`))
      if (!m) { missing.push(`${name} 未找到`); continue }
      if (!new RegExp(`\\b${slug}:`).test(m[1])) missing.push(`${name} 无 ${slug}`)
    }
    // ★ TAG_STYLES 单独处理（2026-10-15 修，判据过严）：
    //   原判据要求三张表**都有**该 slug 的显式键。但 TAG_STYLES 是**标签样式**表，
    //   与另两张「上限表」不同：
    //     · content-formatter.js 的 formatTags 是 `TAG_STYLES[platform] || '#tag'`
    //       —— **有默认兜底**，缺席不是坏；
    //     · 该表 10 个键里 6 个（pipixia/xigua/tengxun_shipin/meiyou/chejiahao/wangyi）
    //      不在 config/platforms.yaml 的 15 个平台里 —— 缺席是常态；
    //     · 默认值 '#tag' 对海外/短视频平台（youtube/tiktok/twitter/instagram/facebook）
    //      的 hashtag 约定**恰好正确**。
    //   实测：原判据下 6 个平台 FAIL，且 detail 全是「TAG_STYLES 无 <slug>」
    //   （CONTENT_LIMITS / TITLE_LIMITS 均命中）—— 全部是判据过严，不是平台缺陷。
    const ts = t.match(/TAG_STYLES\s*=\s*\{([\s\S]*?)\n\}/)
    if (!ts) { missing.push('TAG_STYLES 未找到'); return missing.length === 0 ? { ok: true, detail: '上限表齐' } : { ok: false, detail: missing.join('; ') } }
    const def = tagStylesDefault(t)
    if (!def) { missing.push('TAG_STYLES 默认值不可解析（formatTags 的兜底表达式变了）') }
    else if (!new RegExp(`\\b${slug}:`).test(ts[1])) {
      // 缺席：接受，但必须在 detail 里如实说明走的是默认值
      if (!["'#tag'", "'#tag#'", "'plain'"].includes(`'${def}'`)) {
        missing.push(`TAG_STYLES 无 ${slug} 且默认值 '${def}' 不在允许集`)
      }
    }
    if (missing.length > 0) return { ok: false, detail: missing.join('; ') }
    const hasKey = new RegExp(`\\b${slug}:`).test(ts[1])
    return {
      ok: true,
      detail: hasKey
        ? '上限表齐 + TAG_STYLES 显式命中（注册表一致性由 content-formatter-registry-sync.test.js 钉住）'
        : `上限表齐 + TAG_STYLES 缺席走默认 '${def}'（语义正确，见判据说明）`,
    }
  })

  add(8, 'TAG_STYLES 取值合法（有键则校验取值；缺席则校验默认兜底值）', () => {
    const t = formatter()
    if (!t) return { ok: false, detail: '文件不存在' }
    const m = t.match(/TAG_STYLES\s*=\s*\{([\s\S]*?)\n\}/)
    if (!m) return { ok: false, detail: '未找到 TAG_STYLES' }
    const km = m[1].match(new RegExp(`\\b${slug}:\\s*'([^']+)'`))
    if (!km) {
      // 缺席：不再判 FAIL，改为校验**默认兜底值**本身合法。
      // 这样若有人把 formatTags 的兜底从 '#tag' 改成非法值，本判据会红。
      const def = tagStylesDefault(t)
      if (!def) return { ok: false, detail: 'TAG_STYLES 默认兜底表达式不可解析，无法判定' }
      return ["'#tag'", "'#tag#'", "'plain'"].includes(`'${def}'`)
        ? { ok: true, detail: `TAG_STYLES 无 ${slug}，走默认 '${def}'（合法）` }
        : { ok: false, detail: `TAG_STYLES 无 ${slug}，且默认兜底 '${def}' 不在允许集` }
    }
    return ["'#tag'", "'#tag#'", "'plain'"].includes(`'${km[1]}'`)
      ? { ok: true, detail: `style='${km[1]}'` }
      : { ok: false, detail: `style='${km[1]}' 不在允许集` }
  })

  add(9, 'has_api 与发布链/登记表一致', () => {
    const y = yamlText()
    if (!y) return { ok: false, detail: 'platforms.yaml 不存在' }
    // ⚠️ 原来是 regex + slice：
    //      const re = new RegExp(`^\\s{2}${slug}:\\s*$`, 'm'); const rest = y.slice(y.search(re))
    //      const next = rest.slice(1).search(/^\s{2}\S/)      ← 缺 /m ⇒ 恒 -1
    //    块退化成「文件剩余全部」⇒ 下游 has_api 判据实际问的是「该平台**之后**有没有
    //    任何平台是 true」（文件顺序依赖）。实测 weibo / zhihu / toutiao 因此误报。
    //    改为按行扫描（platformYamlBlock），与回归测试「块提取不能吃到别的平台」同构。
    const blockLines = platformYamlBlock(y, slug)
    if (!blockLines) return { ok: false, detail: `platforms.yaml 无 ${slug}` }
    const block = blockLines.join('\n')
    // ⚠️ `m` 标志不可省（2026-10-15 修，假绿事故）：
    //    原写法 `/^[ \t]{4}has_api:[ \t]*true/` **没有 `m`**，`^` 只锚**字符串开头**，
    //    于是该判据**只在「块的第一行恰好是 has_api」时才真正执行**；
    //    其余平台一律走下面的 `if (!hasApi) return { ok: true, … }` ⇒ **判「无需发布链」而通过**。
    //    实测 15 个平台里 **6 个是假绿**（douyin / tencent_video / kuaishou / bilibili /
    //    baijiahao / facebook），其中 tencent_video 与 facebook 是
    //    `has_api: true` 却 **0 个链文件** —— 真缺口被这条假绿藏住了。
    //    只有恰好把 `has_api` 写在块首行的 youtube / twitter 被正确检查（所以当时只报出这两个）。
    //    ⇒ 与 `structure-lock` 的 `[]` 空转、`check-doc-abs-paths` 的无盘符跳过同型：
    //      **判据在多数输入上不执行，却一律判通过。**
    //    回归锁：`verify-platform-onboarding.test.js` 的「判据 9 不依赖 has_api 在块中的位置」，
    //    用真实数据 `facebook`（has_api 不在首行 + 无链 ⇒ 应 FAIL）作证伪样本。
    const hasApi = /^[ \t]{4}has_api:[ \t]*true/m.test(block)
    if (!hasApi) return { ok: true, detail: 'has_api 非 true ⇒ 无需发布链' }
    const dir = path.join(ROOT, 'packages/api-publish-engine/src/publish/platforms')
    // ★ 链文件名前缀不等于 slug 的平台（2026-10-15 补）：
    //   视频号的链是 `shipinhao-video.js` / `shipinhao-music.js`，而 slug 是 `tencent_video`。
    //   证据：`config/platforms.yaml` 的 tencent_video 块自带注释
    //   「使视频号完整链（src/publish/platforms/shipinhao-video.js，分片 + Content-MD5 +
    //     post_draft/post_create 双分支，带链级测试）从未被触发」；
    //   且 `shipinhao-video.js:73` 调 `formatArticleBody('tencent_video', …)`、
    //   `shipinhao.js:2` 注释确认 `constructor 'tencent_video'` —— 即**调度 id 就是 tencent_video**，
    //   `shipinhao` 只是**文件名**。
    //   没有这张表时，判据会因**命名**差异报「无链」——那是判据错，不是平台错。
    const CHAIN_NAME_ALIASES = { tencent_video: 'shipinhao' }
    const chainPrefix = (CHAIN_NAME_ALIASES[slug] || slug) + '-'
    const chainFiles = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(chainPrefix)) : []
    if (chainFiles.length === 0) return { ok: false, detail: `has_api:true 但无 publish/platforms/${chainPrefix}*.js` }
    const entries = read('packages/api-publish-engine/src/platform-entries.js') || ''
    return entries.includes(slug)
      ? { ok: true, detail: `链 ${chainFiles.length} 个 + 已被 platform-entries.js 登记` }
      : { ok: false, detail: `链存在但 platform-entries.js 未登记 ${slug}` }
  })

  add(10, '适配器/链含 formatArticleBody 调用（承载形态单一实现）', () => {
    // ⚠️ 判据的第一版只查适配器自身，对 baijiahao 误报 —— 因为适配器 `require` 了链
    // （`publish/platforms/baijiahao-article.js`），而 formatArticleBody 由**链**调用。
    // 判据要看的是「这个平台的内容字段最终经 formatArticleBody 处理」，不是「哪个文件调的」。
    const candidates = []
    const dirs = [
      'packages/api-publish-engine/src/adapters',
      'packages/api-publish-engine/src/publish/platforms',
    ]
    for (const d of dirs) {
      const abs = path.join(ROOT, d)
      if (!fs.existsSync(abs)) continue
      for (const f of fs.readdirSync(abs)) {
        if (!f.endsWith('.js')) continue
        if (f === `${slug}.js` || f.startsWith(slug + '-')) candidates.push(path.join(abs, f))
      }
    }
    if (candidates.length === 0) return { ok: true, detail: `无 ${slug} 适配器/链 ⇒ 不适用` }
    // ★ 判据是「该平台的**内容路径最终到达** formatArticleBody」，即**至少一个**候选文件调用它。
    //   适配器通常只做 require + 委派（实测 baijiahao.js 就是这样，它 require 了
    //   BaijiahaoArticleChain，而 formatArticleBody 由**链**调用）。
    //   ⚠️ 判据的前两版分别写成「适配器必须自己调」和「每个候选文件都必须调」——
    //   前者对 baijiahao 误报，后者同样误报。语义是 any，不是 all。
    const callers = candidates.filter((p) => fs.readFileSync(p, 'utf8').includes('formatArticleBody'))
    return callers.length > 0
      ? {
          ok: true,
          detail: `${callers.length}/${candidates.length} 个候选文件调用 formatArticleBody（${callers.map((p) => path.basename(p)).join(', ')}）`,
        }
      : {
          ok: false,
          detail: `候选文件均未调用 formatArticleBody: ${candidates.map((p) => path.relative(ROOT, p)).join(', ')}`,
        }
  })

  add(11, '测试与文案：formatter 测试 / chain 测试 / locales 成对', () => {
    const missing = []
    const notes = []
    const cf = read('packages/api-publish-engine/test/content-formatter.test.js')
    if (!cf) missing.push('content-formatter.test.js 不存在')
    else if (!cf.includes(slug)) missing.push('content-formatter.test.js 无该 slug')

    const chainDir = path.join(ROOT, 'packages/api-publish-engine/test')
    const chains = fs.existsSync(chainDir) ? fs.readdirSync(chainDir).filter((f) => f.startsWith(slug)) : []
    if (chains.length === 0) missing.push('无该平台的 chain 测试')

    // ⚠️ 判据的第一版要求 locales 里必须有 slug 字面量，对 baijiahao 误报 ——
    // 实测本仓 `locales/zh.js` 里**没有任何平台 slug**：平台显示名来自
    // `config/platforms.yaml` / `platform-definitions.js`，不是 i18n 文案。
    // 故此处只做「**若该 slug 已出现在任一 locale，则两个 locale 必须都出现**」的一致性判据
    // （这才是 locale 成对纪律的真实作用面），不强制要求平台名进 locales。
    const zh = read('apps/desktop/src/locales/zh.js')
    const en = read('apps/desktop/src/locales/en.js')
    if (!zh || !en) missing.push('locales 文件缺失')
    else {
      const inZh = zh.includes(slug)
      const inEn = en.includes(slug)
      if (inZh !== inEn) missing.push(`locales 不成对：zh=${inZh} en=${inEn}`)
      else if (!inZh) notes.push('locales 未含该 slug（合规：平台显示名不在 i18n 面）')
      else notes.push('locales 成对命中该 slug')
    }
    return missing.length === 0
      ? { ok: true, detail: `formatter 测试 + ${chains.length} 个 chain 测试；${notes.join('；')}` }
      : { ok: false, detail: missing.join('; ') }
  })

  add(12, '额外：正文链不含自写的 <p> 包装 / HTML 剥离（源码扫描）', () => {
    const dir = path.join(ROOT, 'packages/api-publish-engine/src')
    if (!fs.existsSync(dir)) return { ok: true, detail: '无 src 目录 ⇒ 不适用' }
    const suspects = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!e.name.endsWith('.js') || e.name === 'content-formatter.js') continue
        const t = fs.readFileSync(p, 'utf8')
        if (!t.includes(slug)) continue
        // 只看代码行（跳过注释）
        const code = t.split(/\r?\n/).filter((l) => {
          const s = l.trim()
          return s && !s.startsWith('*') && !s.startsWith('//') && !s.startsWith('/*')
        }).join('\n')
        // 针由拼接构造，避免断言/扫描自己匹配自己
        if (code.includes("'<" + "p>'") || code.includes('`<' + 'p>') || code.includes('replace(/<' + '[^>]+>/g')) {
          suspects.push(path.relative(ROOT, p))
        }
      }
    }
    walk(dir)
    return suspects.length === 0
      ? { ok: true, detail: '未发现自写包装/剥离（承载形态经 formatArticleBody 单一实现）' }
      : { ok: false, detail: `疑似自写 HTML 处理: ${suspects.join(', ')}` }
  })

  add(13, '额外：顺序不变量 —— 话题转换先于 <p> 包装', () => {
    const t = formatter()
    if (!t) return { ok: false, detail: 'content-formatter.js 不存在' }
    const iTopic = t.indexOf('convertInlineTopics')
    const iWrap = t.search(/<\s*p\s*>/)
    if (iTopic === -1) return { ok: true, detail: '该文件未出现 convertInlineTopics ⇒ 不适用' }
    if (iWrap === -1) return { ok: true, detail: '该文件未出现 <p> 包装 ⇒ 不适用' }
    return iTopic < iWrap
      ? { ok: true, detail: `话题转换(L${t.slice(0, iTopic).split('\n').length}) 先于 <p> 包装(L${t.slice(0, iWrap).split('\n').length})` }
      : { ok: false, detail: '❌ <p> 包装出现在话题转换之前 —— 会让 (^|\\s)#话题 停在单井号形态' }
  })

  return checks
}


/**
 * 取 platforms.yaml 里某个平台段的行数组。
 *
 * ⚠️ 这里刻意**不用 regex + slice**。原实现写成
 *     const next = rest.slice(1).search(/^\s{2}\S/)      ← 缺 /m
 * 无 /m 时 `^` 只匹配字符串开头，而 rest.slice(1) 从行中间开始 ⇒ 恒返回 -1
 * ⇒ block 退化成「文件剩余全部」⇒ 下游 has_api 判据实际问的是
 * 「**该平台之后**有没有任何平台是 true」，与平台自身无关（**文件顺序依赖**）。
 * 实测：weibo / zhihu / toutiao 三个 has_api:false 的平台因此误报
 * 「has_api:true 但无发布链」，而同为 false 的 xiaohongshu 因碰巧有链而通过。
 *
 * 按行扫描没有「行中间起始」这个陷阱：段的边界就是下一个 2 空格缩进的键。
 * 回归：verify-platform-onboarding.test.js 的「平台块提取不能吃到别的平台」。
 */
function platformYamlBlock (yamlText, slug) {
  const lines = yamlText.split(/\r?\n/)
  let inside = false
  const out = []
  for (const l of lines) {
    const m = l.match(/^[ \t]{2}([a-z][a-z0-9_]*):[ \t]*$/)
    if (m) { inside = m[1] === slug; continue }
    if (inside) out.push(l)
  }
  return out.length > 0 ? out : null
}

/** 该 slug 是否在仓库里被认知（用于「不存在的 slug 必须非零退出」） */
function slugIsKnown (slug) {
  try {
    const out = execFileSync('git', ['grep', '-l', `--`, slug, '--', 'config/platforms.yaml'], { cwd: ROOT, encoding: 'utf8' })
    return out.trim().length > 0
  } catch (e) {
    return false
  }
}

function main () {
  const slug = process.argv[2]
  if (!slug) {
    console.error('用法: node scripts/verify-platform-onboarding.js <slug>')
    process.exit(2)
  }
  if (!/^[a-z][a-z0-9_]*$/.test(slug)) {
    console.error(`❌ slug "${slug}" 形态非法（应匹配 ^[a-z][a-z0-9_]*$）`)
    process.exit(2)
  }

  console.log(`\n扩平台自检: ${slug}`)
  console.log('='.repeat(64))

  const known = slugIsKnown(slug)
  if (!known) console.log(`⚠️  config/platforms.yaml 里没有 "${slug}" —— 逐条判 FAIL（不静默通过）\n`)

  let failed = 0
  for (const c of buildChecks(slug)) {
    let r
    try { r = c.fn() } catch (e) { r = { ok: false, detail: '判据抛错: ' + e.message } }
    if (!r.ok) failed++
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  [${String(c.id).padStart(2)}] ${c.title}`)
    console.log(`            ${r.detail}`)
  }

  console.log('='.repeat(64))
  console.log(failed === 0 ? `✅ 全部 13 条判据通过` : `❌ ${failed} 条未通过（共 13 条）`)
  process.exit(failed === 0 && known ? 0 : 1)
}

if (require.main === module) main()

module.exports = { buildChecks, slugIsKnown }
