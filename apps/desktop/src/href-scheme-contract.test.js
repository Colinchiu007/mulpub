import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * href / window.open 协议校验接线锁（PRD-HREF-SCHEME-GUARD-2026-09-29）
 *
 * 为什么是结构锁而不是单点断言：
 * 这个缺陷的形态是"每个新页面各抄一次裸 :href"，逐组件写用例只能覆盖今天已知的六个点，
 * 第七个点（下一个会话新加的）不会有任何东西变红。所以判据必须扫全仓 `.vue`。
 *
 * 三条反失明措施（本仓踩过的坑，见 AGENTS.md「定位宿主声明文件禁止数 .. 层级」）：
 *   ① 扫描域为空即红（不允许"没找到文件"退化成通过）；
 *   ② 命中数有规模下界（解析退化成空集合时锁不会静默放行）；
 *   ③ 例外清单只能缩小，新增例外必须带理由。
 *
 * ⚠️ 本锁的**已知漏扫域**（QM-6 双模型外部评审指出，写在这里防止后来者误以为
 * "扫过 :href= 就等于 href 面全安全"）：
 *   · `v-html` 注入含 `<a href=…>` 的第三方 HTML（当前仓内无此用法渲染外部数据）
 *   · `render()` / `h('a', { href })` 函数式组件（SFC 模板外）
 *   · `<iframe srcdoc=…>`
 *   · `document.createElement('a'); a.href = …` 命令式创建（当前 2 处均为 `blob:` 本地下载）
 * 而 `:[href]` 动态参数名 与 `v-bind="{ href }"` 对象展开**不是漏扫，是被显式禁止**
 * （见下面「动态参数与对象展开形态」那条断言）——因为这两种写法能把判据整个绕掉。
 */

const SRC_ROOT = path.resolve(__dirname)
const DESKTOP_ROOT = path.resolve(__dirname, '..')

function walkDir (dir, filter, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'dist-electron', 'coverage'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkDir(full, filter, out)
    else if (filter(entry.name)) out.push(full)
  }
  return out
}

const VUE_FILES = walkDir(SRC_ROOT, n => n.endsWith('.vue'))
const SRC_JS_FILES = walkDir(SRC_ROOT, n => n.endsWith('.js'))

/**
 * href 绑定形态。必须同时容忍：
 *   `:href="x"` / `:href='x'` / `:href=x`（Vue 允许不加引号的属性值）
 *   `v-bind:href=…` 同上三种
 *   以及 `=` 两侧的空格（HTML 属性语法本身允许 `:href = "x"`）
 * 捕获组：1=双引号 2=单引号 3=不加引号
 */
const HREF_RE = /(?:v-bind:|:)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'`=]+))/g
const OPEN_RE = /window\.open\(\s*([^,)]+)/g
/** 能把判据绕掉的两种合法 Vue 写法，出现即红 */
const DYNAMIC_ARG_RE = /(?::\[href\]|v-bind:\[href\])/
const OBJECT_BIND_HREF_RE = /v-bind\s*=\s*\{[^}]*\bhref\b/

function scan (re, pick, files = VUE_FILES) {
  const hits = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(re)) {
      hits.push({
        rel: path.relative(DESKTOP_ROOT, file).replace(/\\/g, '/'),
        expr: (pick(m) || '').trim(),
      })
    }
  }
  return hits
}

/**
 * `window.open` 的扫描域必须含 `src` 下的 `.js`（排除测试文件）。
 *
 * 2026-10-07 实测教训：卡片点击的 `createTab → window.open` 降级通道被抽进
 * `src/composables/usePublishHistoryContentLink.js`（PublishHistory.vue 已 1457 行，
 * 逐文件行数门禁 growthAllowance=200 不容留）。若 OPEN_HITS 仍只扫 `.vue`，
 * 这个 `window.open` 会**静默退出扫描域** —— 既不用登记、也不被任何断言看见，
 * 正是本文件头警告的「静默失明」。搬代码不会让判据失效，只会让判据看不见。
 *
 * 写法提醒：本注释里**不能**出现 glob 形态的路径 —— 其中的「星号 + 斜杠」组合
 * 会提前终止块注释，其后内容被当成代码，表现为 esbuild 的
 * 「invalid JS syntax / make sure to name the file with the .jsx extension」假象报错。
 */
const OPEN_SCAN_FILES = VUE_FILES.concat(
  SRC_JS_FILES.filter(f => !/\.(test|spec)\.js$/.test(f))
)

const HREF_HITS = scan(HREF_RE, m => m[1] ?? m[2] ?? m[3])
const OPEN_HITS = scan(OPEN_RE, m => m[1], OPEN_SCAN_FILES)

/**
 * 抽取开始标签的属性串。**不能**用 `<a[^>]*>` —— 属性值里就带 `>`
 * （实测 `ReferenceFinder.vue` 有 `@mouseover="e => e.target.style…"`，
 * 朴素正则会在那个 `>` 处提前截断，该站点的 href 与 v-if 双双漏扫，
 * 而"命中数下界"仍被其它站点满足 ⇒ 属静默失明）。按引号状态扫描。
 */
function startTags (text, tagNames) {
  const out = []
  const tagRe = new RegExp(`<(${tagNames.join('|')})((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'g')
  for (const m of text.matchAll(tagRe)) out.push(m[2] || '')
  return out
}

function attrValue (attrs, nameRe) {
  const m = nameRe.exec(attrs)
  if (!m) return null
  return (m[1] ?? m[2] ?? m[3] ?? '').trim()
}

/** 取出 `safeHttpUrl(<参数>)` 里的参数串；不含判据调用则返回 null */
function safeHttpUrlArg (expr) {
  const m = /safeHttpUrl\((.*)\)/s.exec(expr || '')
  return m ? m[1].trim() : null
}

/** 例外清单：只能带理由进入，且只能缩小 */
const HREF_EXCEPTIONS = []
/** 渲染层允许出现协议正则字面量的文件（当前为空——渲染层一律调共享判据） */
const RENDERER_PROTOCOL_REGEX_ALLOWED = [
  'src/views/Collection.vue', // isVideoPlatformUrl 用 new URL() 解析 + 协议白名单（比 safeHttpUrl 更严），
  // extractUrlFromShareText 的 /^https?:\/\// 只过滤「分享文本里提取的链接」，不渲染 href；2026-09-29 基线修复
]
/**
 * `window.open(...)` 站点登记：这些调用不在渲染层成链，而是被主进程
 * `window.js` 的 `setWindowOpenHandler → openExternalUrl → isAllowedExternalUrl`
 * 拦住（该判据比 safeHttpUrl **更严**：`new URL()` 解析 + 协议白名单 + 拒绝 userinfo）。
 * 登记而非放行判据，是为了让"新增一个 window.open 点"必须被看见。
 */
const OPEN_SITES_GUARDED_IN_MAIN = [
  'src/views/Accounts.vue', // openPlatform() 打开运营中心配置的 dashboard URL，由主进程层更严判据兜
  // 2026-10-07 随 PRD-PUBLISH-HISTORY-PUBLIC-LINK 的拆分迁移：发布记录卡片点击的
  // createTab → window.open 降级通道已整体移入 composable（该视图 1457 行，逐文件行数
  // 门禁 growthAllowance=200 不容留在这里）。登记随之改指新位置——本断言正是为拦住
  // 「文件删了/搬走了，登记还留着」这种陈旧白名单。
  'src/composables/usePublishHistoryContentLink.js', // 发布记录卡片点击打开平台链接：首选 tabStore.createTab 应用内新标签；
  // createTab 失败降级 window.open(url,'_blank')，URL 已过渲染端 safeHttpUrl，
  // window.open 再由主进程 setWindowOpenHandler → isAllowedExternalUrl 更严判据兜底（PRD-PUBLISH-HISTORY-CARD-OPEN-LINK-2026-10-03）
  // 2026-10-15 随 PRD-PUBLISH-RESULT-LINK-INAPP-TAB 登记：发布结果/发布记录「查看文章」的
  // 应用内新标签通道。与上一条同构——普通左键先 createTab（URL 已过渲染端 safeHttpUrl），
  // 建标签失败才降级 window.open(url,'_blank','noopener')，最终仍由主进程
  // setWindowOpenHandler → isAllowedExternalUrl 兜底。改这里必须同步 PRD §5 降级表。
  'src/composables/useInAppLink.js',
]

/**
 * 主进程里"决定某个外部 URL 能否成为用户可点/可打开地址"的文件，必须调共享判据
 * （QM-6 Warning-3：原来只钉两个文件，AC-9 声称的"主进程任何文件"没有东西在守）。
 * 新增同用途文件必须登记；**不同意图**的同类正则不在此列（见 PRD §5.2 逐个点名）。
 */
const MAIN_CHAIN_URL_GATE_FILES = [
  'electron/services/content-intelligence-sources.js',
  'electron/services/hot-topics/channels.js',
  'electron/bootstrap/phase4-events.js',
]

describe('渲染层 href 协议校验接线锁', () => {
  it('扫描域非空（目录解析失败不得退化成"全部通过"）', () => {
    expect(VUE_FILES.length).toBeGreaterThan(20)
    expect(SRC_JS_FILES.length).toBeGreaterThan(20)
  })

  it('必须扫到 :href 绑定点本身（命中集为空即证明判据失明，不接受空通过）', () => {
    expect(HREF_HITS.length).toBeGreaterThanOrEqual(6)
  })

  it('每一处 :href 都必须**被判据包裹**（不是表达式里出现过这个单词就行）', () => {
    const offenders = HREF_HITS
      .filter(h => safeHttpUrlArg(h.expr) === null)
      .filter(h => !HREF_EXCEPTIONS.includes(h.rel))
    expect(offenders.map(o => `${o.rel} → href=${o.expr}`)).toEqual([])
  })

  it('六个已知站点逐个在位（防止"整块删除用例"式绕过上一条）', () => {
    const known = [
      'src/views/Intelligence.vue',
      'src/views/Publish.vue',
      'src/views/PublishHistory.vue',
      'src/views/FilmEngineeringView.vue',
      'src/components/TrendingPanel.vue',
      'src/components/ReferenceFinder.vue',
    ]
    const covered = new Set(HREF_HITS.filter(h => safeHttpUrlArg(h.expr) !== null).map(h => h.rel))
    expect(known.filter(k => !covered.has(k))).toEqual([])
  })

  it('四种绑定形态（双引号/单引号/不加引号/等号两侧空格）必须真的都被扫到', () => {
    // 用构造文本直接验判据本身，避免"当前仓恰好没人这么写"造成锁永久不覆盖该形态
    const probe = [
      `<a :href="a">x</a>`,
      `<a :href='b'>y</a>`,
      `<a :href=c>d</a>`,
      `<a :href = "e">f</a>`,
      `<a v-bind:href="g">h</a>`,
    ].join('\n')
    const found = [...probe.matchAll(HREF_RE)].map(m => (m[1] ?? m[2] ?? m[3]).trim())
    expect(found).toEqual(['a', 'b', 'c', 'e', 'g'])
  })

  it('禁止用动态参数名或对象展开绕过判据（这两种写法能把 safeHttpUrl 整条跳过）', () => {
    const bypass = []
    for (const file of VUE_FILES) {
      const text = fs.readFileSync(file, 'utf8')
      const rel = path.relative(DESKTOP_ROOT, file).replace(/\\/g, '/')
      if (DYNAMIC_ARG_RE.test(text)) bypass.push(`${rel} 用了 :[href] 动态参数名`)
      if (OBJECT_BIND_HREF_RE.test(text)) bypass.push(`${rel} 用 v-bind="{ href }" 对象展开`)
    }
    expect(bypass).toEqual([])
  })

  it('开始标签扫描必须能穿过引号内的 >（否则含箭头函数的站点被静默跳过）', () => {
    const probe = `<a v-if="safeHttpUrl(u)" :href="safeHttpUrl(u)" @mouseover="e => e.target.style.x = 'y'" @click="() => go()"><i/></a>`
    const tags = startTags(probe, ['a'])
    expect(tags).toHaveLength(1)
    expect(tags[0]).toContain('@click="() => go()"')
    expect(attrValue(tags[0], /(?:v-bind:|:)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'`=]+))/)).toBe('safeHttpUrl(u)')
  })

  // QM-6 Info-2：v-if 决定"成不成链"，:href 决定"链到哪"。只锁 :href 的话，
  // 把 v-if 弱化成 `item.url.startsWith('http')` 不会变红 —— 安全边界未失守
  // （:href 返回 null 时 Vue 移除属性），但"降级为纯文本"退化成"点了没反应的死锚点"，
  // 而那正是本 PR 明令禁止的形态。
  it('成链点的 v-if 与 :href 必须取同一个判据表达式（防二者分叉）', () => {
    const pairs = []
    for (const file of VUE_FILES) {
      const text = fs.readFileSync(file, 'utf8')
      for (const attrs of startTags(text, ['a', 'el-link'])) {
        const hrefExpr = attrValue(attrs, /(?:v-bind:|:)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'`=]+))/)
        if (hrefExpr === null) continue
        pairs.push({
          rel: path.relative(DESKTOP_ROOT, file).replace(/\\/g, '/'),
          hrefExpr,
          ifExpr: attrValue(attrs, /\bv-if\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'`=]+))/),
        })
      }
    }
    expect(pairs.length).toBeGreaterThanOrEqual(6)   // 规模下界，防解析退化后 toEqual([]) 恒真
    const diverged = pairs.filter(p => safeHttpUrlArg(p.hrefExpr) !== safeHttpUrlArg(p.ifExpr))
    expect(diverged.map(d => `${d.rel} href=${d.hrefExpr} v-if=${d.ifExpr}`)).toEqual([])
  })

  // QM-6 Info-1：rel=noopener 此前只有 Publish / History 两处被断言，
  // 另外四处靠人看模板。改成结构判据：任何 target="_blank" 的成链点都必须带 noopener。
  it('任何 target="_blank" 的锚点都必须带 rel 含 noopener（reverse tabnabbing）', () => {
    const missing = []
    let blankCount = 0
    for (const file of VUE_FILES) {
      const text = fs.readFileSync(file, 'utf8')
      const rel = path.relative(DESKTOP_ROOT, file).replace(/\\/g, '/')
      for (const attrs of startTags(text, ['a', 'el-link', 'component'])) {
        if (!/target\s*=\s*(?:"_blank"|'_blank'|"_blank")/.test(attrs)) continue
        blankCount++
        const relv = attrValue(attrs, /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'`=]+))/)
        if (!relv || !relv.includes('noopener')) missing.push(`${rel} rel=${JSON.stringify(relv)}`)
      }
    }
    expect(blankCount, '一个 target=_blank 都没扫到 = 判据失明').toBeGreaterThanOrEqual(6)
    expect(missing).toEqual([])
  })
})

describe('单一口径接线锁（禁止第二份协议判定）', () => {
  const twin = path.resolve(DESKTOP_ROOT, '..', '..', 'packages/shared-utils/src/safe-http-url.js')
  const esm = path.resolve(DESKTOP_ROOT, '..', '..', 'packages/shared-utils/src/safe-http-url.browser.js')

  it('共享实现的 CJS 与 ESM 孪生两个文件都必须存在', () => {
    expect(fs.existsSync(twin)).toBe(true)
    expect(fs.existsSync(esm)).toBe(true)
  })

  // QM-6 Warning-1（前端）：两条独立 toContain 有假绿路径 —— alias 整行注释掉、
  // 而 `.browser.js` 字样留在别处，两条都还过；又因 build.commonjsOptions 会把 CJS 自动转 ESM，
  // 生产构建**不会崩**，于是渲染端静默退回 CJS 那份，孪生形同虚设。
  // 所以按**映射条目**断言 key 与 value 同时出现，并断言该行不是注释行。
  it('vite 必须把渲染端导入别名**成条**指向 ESM 孪生（且该行不得被注释掉）', () => {
    const cfg = fs.readFileSync(path.resolve(DESKTOP_ROOT, 'vite.config.js'), 'utf8')
    const entryRe = /'@multi-publish\/shared-utils\/src\/safe-http-url'\s*:\s*[\s\S]{0,200}?safe-http-url\.browser\.js/
    const m = entryRe.exec(cfg)
    expect(m, 'alias 条目必须把 key 与 .browser.js 组成同一条映射').not.toBeNull()
    const lineStart = cfg.lastIndexOf('\n', m.index) + 1
    const beforeKey = cfg.slice(lineStart, m.index)
    expect(beforeKey.trim(), `alias key 前有非缩进内容（疑似注释）：${JSON.stringify(beforeKey)}`).toBe('')
    expect(cfg.slice(m.index, m.index + 220)).toContain('packages/shared-utils/src/safe-http-url.browser.js')
  })

  it('主进程成链侧的每个 URL 门禁文件都必须引用共享实现，且不得自带协议正则', () => {
    expect(MAIN_CHAIN_URL_GATE_FILES.length).toBeGreaterThanOrEqual(3)   // 清单只能缩小
    for (const rel of MAIN_CHAIN_URL_GATE_FILES) {
      const text = fs.readFileSync(path.resolve(DESKTOP_ROOT, rel), 'utf8')
      expect(text, `${rel} 必须引用共享实现`).toContain('safe-http-url')
      expect(text, `${rel} 不得保留自己的协议正则`).not.toMatch(/\/\^https\?:/)
    }
  })

  // QM-6 Warning-3 的落地：渲染层全域不得出现协议正则字面量（一律调共享判据）。
  // 主进程/包里的同类正则**按实测分两类**：成链门禁（必须收敛，见上一条）与
  // 其它意图（剥协议取 host、判绝对性走分支、网络取回守卫）—— 后者见 PRD §5.2 逐个点名，不在本锁范围。
  it('渲染层全域不得自带协议正则字面量（白名单为空，只能带理由新增）', () => {
    const offenders = []
    for (const file of [...VUE_FILES, ...SRC_JS_FILES]) {
      const rel = path.relative(DESKTOP_ROOT, file).replace(/\\/g, '/')
      if (rel.endsWith('href-scheme-contract.test.js')) continue   // 本文件的判据自身
      if (RENDERER_PROTOCOL_REGEX_ALLOWED.includes(rel)) continue
      const text = fs.readFileSync(file, 'utf8')
      if (/\/\^https\?:/.test(text)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('主进程 OS 打开面必须保留自己的更严判据（合并进来就是把安全面放松）', () => {
    const text = fs.readFileSync(path.resolve(DESKTOP_ROOT, 'electron/window.js'), 'utf8')
    expect(text).toMatch(/function isAllowedExternalUrl/)
    expect(text).toMatch(/url\.username/)   // 拒绝 userinfo 这条不能丢
    expect(text).toContain('safe-http-url')  // 二者关系必须写在源码里，防"顺手收敛"
  })
})

describe('渲染层 window.open 站点登记锁', () => {
  it('每一个 window.open 调用点都必须已在册（新增点必须显式登记它靠谁守）', () => {
    const unregistered = OPEN_HITS
      .filter(h => safeHttpUrlArg(h.expr) === null)
      .map(h => h.rel)
      .filter(rel => !OPEN_SITES_GUARDED_IN_MAIN.includes(rel))
    expect([...new Set(unregistered)]).toEqual([])
  })

  it('登记表里的站点必须真的还存在（防"文件删了登记还留着"的陈旧白名单）', () => {
    const present = new Set(OPEN_HITS.map(h => h.rel))
    expect(OPEN_SITES_GUARDED_IN_MAIN.filter(r => !present.has(r))).toEqual([])
  })
})
