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

/**
 * 链文件名前缀 != slug 的平台（⑨ 与 ⑪ 共用，**单一来源**）。
 *
 * 视频号的链是 `shipinhao-video.js` / `shipinhao-music.js`，而 slug 是 `tencent_video`。
 * 证据：`config/platforms.yaml` 的 tencent_video 块自带注释说明「视频号完整链
 * （src/publish/platforms/shipinhao-video.js，分片 + Content-MD5 + post_draft/post_create
 * 双分支，带链级测试）从未被触发」；且 `shipinhao-video.js:73` 调
 * `formatArticleBody('tencent_video', …)`、`shipinhao.js:2` 注释确认 `constructor 'tencent_video'`
 * —— 即**调度 id 就是 tencent_video**，`shipinhao` 只是**文件名**。
 *
 * 没有这张表时，判据会因**命名**差异报「无链」/「无链级测试」——那是判据错，不是平台错。
 * （2026-10-16 p3-residual-criteria：⑨ 早已用它，⑪ 漏用 ⇒ tencent_video 的链级测试
 *   `shipinhao-*.test.js` 存在却被判「无」，属同型假 FAIL；现已同源。）
 */
const CHAIN_NAME_ALIASES = { tencent_video: 'shipinhao' }

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
    // ★ 链文件名前缀不等于 slug 的平台：用模块级 CHAIN_NAME_ALIASES（⑨⑪ 同源，见文件头）。
    //   没有这张表时，判据会因**命名**差异报「无链」——那是判据错，不是平台错。
    const chainPrefix = (CHAIN_NAME_ALIASES[slug] || slug) + '-'
    const chainFiles = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(chainPrefix)) : []

    // ⚠️ 2026-10-16 p3-residual-criteria 修（**判据把两个轴混为一谈**）：
    //    原判据要求 `has_api:true` ⇒ 必须有链 + `platform-entries.js` 登记，否则 FAIL。
    //    但本仓语义是**两个独立轴**（`publish-mode-config.test.js` 有锚点注释）：
    //      · `has_api`     = 该平台**有没有** API 发布实现；
    //      · `publishMode` = 当前**走哪条轨**（dom-only / api-only / api-then-dom）。
    //    实测 youtube / twitter：`has_api:true` + `publishMode:dom-only` + **0 个链**，
    //    但二者**都有完整的 API 适配器**（adapters/youtube.js 是 YouTube Data API v3 + OAuth2，
    //    adapters/twitter.js 同构）⇒ `has_api:true` 是**诚实的**（两轴各自成立），
    //    原判据却因此恒红 —— 那是**判据错**，不是平台错。
    //    对照 facebook（修复前）：`has_api:true` 却**既无链也无适配器** ⇒ 真·空声明，
    //    已按**配置缺陷**改 `has_api:false`（见 config/platforms.yaml 该块注释）。
    //    ⇒ 新口径分三层：① 无声明 ⇒ 无需链；② 有声明 ⇒ 至少有**实现证据**（链或适配器）；
    //      ③ 有链 ⇒ 还必须被 `platform-entries.js` 登记（这一层不变：要真走轨就必须登记）。
    const adapterFile = path.join(ROOT, 'packages/api-publish-engine/src/adapters', `${slug}.js`)
    const hasAdapter = fs.existsSync(adapterFile)

    if (chainFiles.length === 0) {
      // ★ CCG 自扮演裁决 i1（2026-10-16，upheld）：上面那条放宽**还必须看 `publishMode`**。
      //   只看「有没有实现证据」会漏掉一种真缺口：声明了 `publishMode: api-only|api-then-dom`
      //   （= 现在就该走 API/DOM 轨）却**没有链** —— 那一轨没有可调度的实现。
      //   当前 15 个平台里 `api-*` 轨的全部都有链，故本分支不会误伤；
      //   它的作用是把「两轴不一致」在**已声明 API 轨**时挡下来（这是 i1 指出的松弛）。
      //
      // ★ CCG 第三轮 i3（2026-10-16，upheld）：缺省派生必须与**运行时同源**。
      //   运行时（api-router.js 的 getPublishMode / isApiTrack）在 publishMode 缺省时按
      //   `has_api:true → api-then-dom` 派生；而本判据原来把缺省当 `''` ⇒ 判「未入波」PASS。
      //   **同一份配置，判据与运行时给出相反语义** ⇒ 两轴不一致被漏报。
      //   现在本判据按同一条派生规则取值，缺省即 api-then-dom（有声明才算未入波）。
      // ★ CCG 第七轮 i4（Info，已加固）：原正则 `[A-Za-z-]+` 对**带引号**（`'dom-only'`）
      //   或**尾随注释**（`dom-only   # 说明`）的取值会匹配失败 ⇒ 落进缺省派生，
      //   实为 dom-only 的平台可能被误判成 api-then-dom 而假 FAIL。
      //   改为：先抓行尾全部内容，再剥离引号与注释，最后才校验取值。
      const pmLine = block.match(/^[ \t]{4}publishMode:[ \t]*(.+)$/m)
      let publishMode = ''
      let pmMatch = null
      if (pmLine) {
        let v = pmLine[1].trim()
        v = v.replace(/\s+#.*$/, '').trim()   // 去尾随注释
        v = v.replace(/^['"]|['"]$/g, '')     // 去首尾引号
        if (v !== '') { publishMode = v; pmMatch = [pmLine[0], v] }
      }
      // ★ 缺省派生必须与运行时同源（CCG 第三轮 i3，upheld）：
      //   运行时 api-router.js 的 derivePublishMode 在 publishMode 缺省时按
      //   `has_api:true → api-then-dom`、否则 dom-only 派生。本判据若把缺省当 ''，
      //   就会判「未入波」而 PASS ⇒ **同一份配置，判据与运行时给出相反结论**。
      //   （第七轮 i4 重构时一度漏掉这段，是 test 17 的结构锁把它抓回来的。）
      if (publishMode === '') {
        publishMode = hasApi ? 'api-then-dom' : 'dom-only'
      }
      // ★ CCG 第七轮 i3（upheld）：**API 轨的实现证据不只有 DOM 链**。
      //   本 PR 已自证：适配器（`src/adapters/<slug>.js` + `src/index.js` 注册）就是 API 轨的
      //   实现面（youtube/twitter 正是靠它获得 has_api:true 的资格）。原判据在「api-* 轨且无链」
      //   时**无条件 FAIL**，于是「api-only + 已注册适配器」这种合法组合被假 FAIL ——
      //   依旧把 DOM 链当成唯一 API 实现证据，两轴仍混淆。
      //   新口径：api-* 轨 ⇒ 链**或适配器**任一即可（链优先，因其同时给出 DOM 轨能力）；
      //   两者都没有才 FAIL「该轨无可调度实现」。
      if (publishMode === 'api-only' || publishMode === 'api-then-dom') {
        if (!hasAdapter) {
          return {
            ok: false,
            detail: `has_api:true 且 publishMode=${publishMode}${pmMatch ? '' : '（缺省，按运行时同源派生）'}（需走 API 轨）`
              + `但既无 publish/platforms/${chainPrefix}*.js 也无 adapters/${slug}.js ⇒ 该轨无可调度实现`,
          }
        }
        // 有适配器（ API 轨实现面），可能没有 DOM 链 —— 合法（未入波的双轨平台）
        return {
          ok: true,
          detail: `has_api:true 且 publishMode=${publishMode}，API 轨由 adapters/${slug}.js 承载（已注册）`
            + `，DOM 链 ${chainFiles.length} 个`,
        }
      }
      // ★ CCG 第七轮 i4（Info）补：publishMode 既不是 api-* 也不是 dom-only ⇒ **非法值**。
      //   此时不能落进下面「有适配器 ⇒ PASS」——运行时 isApiTrack/getPublishMode 对非法值是
      //   **fail-closed 抛错**的，判据若放行就与运行时再次分叉（正是本 PR 要消灭的那类）。
      if (publishMode !== 'dom-only') {
        return {
          ok: false,
          detail: `publishMode='${publishMode}' 不是合法三态（api-only|api-then-dom|dom-only）`
            + ' ⇒ 运行时会 fail-closed 抛错，判据不得放行',
        }
      }
      if (!hasAdapter) {
        return {
          ok: false,
          detail: `has_api:true 但既无 publish/platforms/${chainPrefix}*.js 也无 adapters/${slug}.js ⇒ 空声明`,
        }
      }
      // ★ CCG 第八轮 i3（upheld）：光看「文件在 + index.js 里有 require 字串」仍不够 ——
      //   registration 字串命中 ≠ api-router **真的会把这个平台调度到适配器**。
      //   最硬的判据是直接问运行时：require api-router，调它的 shouldUseApi(slug)。
      //   它读同一份 platforms.yaml、走同一套两轴合取 ⇒ 判据与运行时**同源**。
      //
      //   ⚠️ 本次实测立刻抓到一个**判据与运行时的真实分歧**（对账的价值）：
      //     youtube/twitter 是「has_api:true（有实现）+ publishMode=dom-only（未入波）」，
      //     旧口径判「未入波 ⇒ PASS」，而运行时 shouldUseApi 对它们返回 **false**
      //     （两轴合取：没有 API 轨可走）。裁定：**运行时是对的**（能力轴不等于轨道轴），
      //     判据旧口径错。故这里的对账断言改为：
      //       · shouldUseApi(slug) === false ⇒ 该平台当前不走 API 轨 ⇒ **PASS**
      //         （detail 说明「未入波：有实现、当前 DOM 轨」）；
      //       · shouldUseApi(slug) === true  ⇒ 必须配有实现证据（链或适配器），否则 FAIL；
      //       · 读不到 api-router ⇒ FAIL（fail-closed，判据不闭环）。
      let runtimeSays = null
      let runtimeErr = null
      let runtimeSkipped = null
      try {
        const router = require(path.join(ROOT, 'packages/api-publish-engine/src/api-router.js'))
        runtimeSays = router.shouldUseApi(slug)
      } catch (e) {
        // ★ 第十轮实测（CI 的 changes job 当场红）：该 job **不装依赖**，而 api-router.js
        //   载入即 `require('js-yaml')` ⇒ MODULE_NOT_FOUND。AGENTS.md 明文规定：
        //   接进 changes job 的锁**只能 require node 内置模块**。故必须区分两种失败，二者处置相反：
        //     · MODULE_NOT_FOUND（依赖缺失）⇒ **显式降级**：仍按字面证据判定，但 detail 必须写明
        //       「运行时对账未执行」+ 原因。既不静默通过（那正是本判据要消灭的弱点），
        //       也不把「环境缺依赖」当成「判据不闭环」而误红（否则该 job 里本判据永远红）。
        //     · 其它错误（语法错、require 到坏模块…）⇒ 仍 fail-closed 判红。
        if (e && (e.code === 'MODULE_NOT_FOUND' || e.code === 'ERR_MODULE_NOT_FOUND')) {
          runtimeSkipped = String(e.message || '').split('\n')[0]
        } else {
          runtimeErr = e.message
        }
      }
      if (runtimeErr) {
        return {
          ok: false,
          detail: `require api-router 失败，无法与运行时对账 ⇒ 判据不闭环（fail-closed）: ${runtimeErr}`,
        }
      }
      // 降级说明：任何 PASS 路径都必须把它带上，避免「未对账」被读成「已对账」。
      const skipNote = runtimeSkipped
        ? `⚠ 运行时对账未执行：本环境缺少产品依赖（${runtimeSkipped}）；`
          + '本次**仅按字面实现证据**判定，请在装了依赖的环境复跑以取得同源对账'
        : ''
      // ★ 未取得运行时结论时**单独走一条分支**：绝不宣称 `shouldUseApi(...)=x`。
      //   初版把降级塞进下面的 `runtimeSays !== true` 分支，detail 里照样写着
      //   `shouldUseApi('youtube')=false` —— 那是**没做过的对账却报告了结论**，
      //   与「判据不得停在字面证据」要消灭的形态同型（本轮自测当场抓到）。
      if (runtimeSkipped) {
        return {
          ok: true,
          detail: `has_api:true 且有 API 实现（adapters/${slug}.js、publishMode=${publishMode}）`
            + ` ⇒ 按字面证据判定${publishMode === 'dom-only' ? '『未入波』（当前 DOM 轨）' : '可入 API 轨'}；${skipNote}`,
        }
      }
      if (runtimeSays !== true) {
        return {
          ok: true,
          detail: `has_api:true 但运行时 api-router.shouldUseApi('${slug}')=false`
            + ` ⇒ 未入波：有 API 实现（adapters/${slug}.js、publishMode=${publishMode}），当前不走 API 轨${skipNote}`,
        }
      }
      if (!hasAdapter) {
        return {
          ok: false,
          detail: `运行时 shouldUseApi('${slug}')=true（要走 API 轨）但 adapters/${slug}.js 不存在`
            + ' ⇒ 该轨无可调度实现',
        }
      }
      return {
        ok: true,
        detail: `has_api:true 且运行时 api-router.shouldUseApi('${slug}')=true（两轴合取同源对账通过）`
          + `，DOM 链 ${chainFiles.length} 个${skipNote}`,
      }
    }
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

  add(11, '测试与文案：formatter 覆盖（注册表驱动）/ chain 测试（有链才要求）/ locales 成对', () => {
    const missing = []
    const notes = []

    // ① formatter 覆盖（2026-10-16 p3-residual-criteria 修，**判据过严**）：
    //    原判据要求 `test/content-formatter.test.js` 里出现该 slug 的**字面量**。
    //    但本仓 formatter 限值的真实覆盖是**按注册表遍历**的契约锁
    //    （content-formatter-registry-sync.test.js 的 A 用例遍历
    //      Object.keys(registry.PLATFORM_PUBLISH_META)，逐平台断言 truncateContent 与
    //      contentMax 一致）——**注册表加平台，覆盖自动跟上**，不需要逐平台写字面量。
    //    实测：原判据下 youtube / tiktok / twitter / instagram / facebook 全判 FAIL，
    //    而它们的限值其实**已被 A 用例逐平台断言** ⇒ 全部是**假 FAIL**。
    //    判据改为问「该平台在注册表内吗」——这才是「覆盖得到它吗」的真正前提。
    let inRegistry = false
    try {
      const reg = require(path.join(ROOT, 'packages/shared-utils/src/publish-capabilities.js'))
      inRegistry = Object.keys(reg.PLATFORM_PUBLISH_META || {}).includes(slug)
    } catch (e) { /* 加载失败按下面的 missing 记账 */ }
    if (!inRegistry) {
      missing.push('不在注册表 PLATFORM_PUBLISH_META 内 ⇒ formatter 的注册表驱动契约锁覆盖不到它')
    } else {
      notes.push('formatter 覆盖由注册表驱动契约锁提供（已含该平台）')
    }

    // ② chain 测试：**有链才要求**（2026-10-16 修，**判据不可满足**）：
    //    原判据无条件要求 `test/<slug>*.js`。但 dom-only 且无链的平台
    //    （wechat_mp / weibo / toutiao / instagram / facebook 等）**本来就没有链可测**，
    //    该要求对它们**恒不可满足** —— 这不是平台缺陷，是判据写错了作用面。
    //    改为「有链 ⇒ 必须有链级测试」，并用与判据⑨**同源**的别名表（tencent_video → shipinhao），
    //    否则视频号那两个链级测试（shipinhao-*.test.js）存在却被判「无」。
    const chainPrefix = (CHAIN_NAME_ALIASES[slug] || slug) + '-'
    const chainDirAbs = path.join(ROOT, 'packages/api-publish-engine/src/publish/platforms')
    const testDirAbs = path.join(ROOT, 'packages/api-publish-engine/test')
    const chainFiles = fs.existsSync(chainDirAbs)
      ? fs.readdirSync(chainDirAbs).filter((f) => f.startsWith(chainPrefix) && f.endsWith('.js'))
      : []
    const chainTests = fs.existsSync(testDirAbs)
      ? fs.readdirSync(testDirAbs).filter((f) => f.startsWith(chainPrefix) && f.endsWith('.test.js'))
      : []
    if (chainFiles.length > 0) {
      if (chainTests.length === 0) {
        missing.push(`有 ${chainFiles.length} 个链（${chainPrefix}*.js）但无链级测试（${chainPrefix}*.test.js）`)
      } else {
        notes.push(`链 ${chainFiles.length} 个 + 链级测试 ${chainTests.length} 个`)
      }
    } else {
      notes.push('无发布链 ⇒ 不要求链级测试（dom-only 平台本来就没有链）')
    }

    // ③ locales 成对（原有语义保留）
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
      ? { ok: true, detail: notes.join('；') }
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
