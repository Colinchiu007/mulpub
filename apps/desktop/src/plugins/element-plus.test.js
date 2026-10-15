import { describe, it, expect } from 'vitest'
import { createApp, h } from 'vue'
import elementPlusOnDemand from './element-plus'

/**
 * element-plus 按需装配的行为验证（fix-newtab-home-slow）
 *
 * 源码契约测试（main.bundle-contract.test.js）锁的是「引入方式」；
 * 本测试锁的是「注册结果」：装配进真实 Vue app 后，组件真的进了注册表。
 *
 * 为什么断言注册表而不是断言 DOM 类名：jsdom 不跑 EP 的真实渲染副作用
 * （实测 h('el-button') 会留下未解析的 <el-button> 标签，而 app._context.components
 * 里 ElButton 明确在册）。注册表才是「模板能不能解析」的直接判据，
 * DOM 类名在 jsdom 下反而是不可靠的间接信号。
 */

function kebabToPascal (name) {
  return 'El' + name.replace(/(^|-)([a-z0-9])/g, (_, __, ch) => ch.toUpperCase())
}

describe('element-plus 按需装配（行为验证）', () => {
  it('装配后注册表含全部按需组件（37 项 = 34 组件 + 3 个 EP 自动附带）', () => {
    const app = createApp({ render: () => h('div') })
    app.use(elementPlusOnDemand)
    const registered = app._context.components
    expect(registered.ElButton).toBeTruthy()
    expect(registered.ElTable).toBeTruthy()
    expect(registered.ElSelect).toBeTruthy()
    expect(registered.ElOption).toBeTruthy()
    expect(registered.ElMessage).toBeUndefined() // 命令式 API 不占注册表
    expect(registered.ElMessageBox).toBeUndefined()
  })

  it('命令式 API（ElMessage / ElMessageBox）被单独导出且可调用', async () => {
    const mod = await import('./element-plus')
    expect(typeof mod.default.install).toBe('function')
    expect(typeof mod.ElMessage).toBe('function')
    // ElMessageBox 在 EP 里是带静态方法的函数（function + confirm/alert/prompt）
    expect(typeof mod.ElMessageBox).toBe('function')
    expect(typeof mod.ElMessageBox.confirm).toBe('function')
    expect(typeof mod.ElMessageBox.alert).toBe('function')
  })

  it('清单完整性：src 的 .vue 里用到的每个 EP 组件都在注册表内（机械锁漏登记）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = path.join(process.cwd(), 'src')
    const used = new Set()
    const scan = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name === 'node_modules') continue; scan(p); continue }
        if (!/\.vue$/.test(e.name)) continue
        const text = fs.readFileSync(p, 'utf8')
        let m
        const re = /<el-([a-z0-9-]+)/g
        while ((m = re.exec(text))) used.add(m[1])
      }
    }
    scan(src)
    // 已知非组件命中：测试文件里的类名前缀桩
    const NOT_STANDALONE = new Set(['upload-stub'])
    const candidates = [...used].filter(u => !NOT_STANDALONE.has(u)).sort()
    expect(candidates.length).toBeGreaterThan(20)

    const app = createApp({ render: () => h('div', candidates.map(c => h('el-' + c))) })
    app.use(elementPlusOnDemand)
    const registered = app._context.components
    // ElRadioButton / ElRadioGroup 由 EP 以 withNoopInstall 挂在 ElRadio 上当子组件，
    // 不在全局注册表里——它们是「父组件附带」形态，判定走 ElRadio。
    const viaParent = new Set(['ElRadioButton', 'ElRadioGroup'])
    const missing = candidates
      .map(c => kebabToPascal(c))
      .filter(name => !registered[name] && !viaParent.has(name))
    expect(missing, '以下 EP 组件在 src 中被使用但未在按需清单注册: ' + missing.join(', ')).toEqual([])
  })

  /**
   * P4 样式闭包锁（2026-10-15 加入，由 QG Visual 的真实红触发）
   *
   * 为什么必须有这一条：P3 只锁「组件注册」，**锁不到样式**。第一版按需改造时
   * 我只导了「模板用到的 36 个组件」的 CSS，QG Visual 当场红 3 处
   * （podcast-channel 21.63% / create-editor 9.48% / create-pipeline 9.47%）。
   * 根因是 EP 组件之间有**纯样式依赖**：内部组件（scrollbar / popper / overlay /
   * option-group / text）从不出现在模板里，但缺 CSS 就视觉回归；另外
   * `radio-group` 依赖 `radio` 本体，而我当时只补了 radio-button/radio-group。
   *
   * 权威来源 = `element-plus/es/components/<name>/style/index.mjs`，
   * 它用**裸 import**（不是 `import ... from`）声明样式依赖——这一点也会坑人：
   * 判据若写成 /from\s+['"]…/ 会匹配 0 条，算出「闭包 = 已导入」的假结论。
   */
  it('P4：样式必须覆盖 element-plus 的完整闭包（不漏纯样式依赖的内部组件）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const pluginPath = path.join(process.cwd(), 'src/plugins/element-plus.js')
    const pluginSrc = fs.readFileSync(pluginPath, 'utf8')

    // 1) 插件显式注册的组件（剥掉注释，避免注释里提到的组件名被当成注册项）
    const arrBody = pluginSrc.match(/const COMPONENTS = \[([\s\S]*?)\n\]/)[1]
    const noComment = arrBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const used = [...noComment.matchAll(/El([A-Za-z0-9]+)/g)]
      .map(m => m[1].replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase())
    expect(used.length, 'COMPONENTS 清单不应退化成空壳').toBeGreaterThan(25)

    // 2) 插件实际 import 的 el-*.css
    const imported = new Set(
      [...pluginSrc.matchAll(/theme-chalk\/(el-[a-z0-9-]+)\.css/g)].map(m => m[1]),
    )

    // 3) 权威闭包：沿 style/index.mjs 递归（裸 import 形态）
    const compDir = path.join(
      process.cwd(), '..', '..', 'node_modules', 'element-plus', 'es', 'components',
    )
    expect(
      fs.existsSync(compDir),
      '找不到 element-plus/es/components —— 本锁依赖已安装依赖，不得静默跳过',
    ).toBe(true)

    const styleDeps = (name) => {
      const p = path.join(compDir, name, 'style', 'index.mjs')
      if (!fs.existsSync(p)) return []
      return [...fs.readFileSync(p, 'utf8')
        .matchAll(/import\s+['"]\.\.\/\.\.\/([a-z0-9-]+)\/style\/index\.mjs['"]/g)]
        .map(m => m[1])
    }
    const closure = new Set()
    const queue = [...used]
    while (queue.length) {
      const n = queue.shift()
      if (closure.has(n)) continue
      closure.add(n)
      for (const d of styleDeps(n)) if (!closure.has(d)) queue.push(d)
    }
    // base 由共享底座 base.css 覆盖，不产出 el-base.css
    const required = [...closure].filter(n => n !== 'base').map(n => 'el-' + n)

    const missing = required.filter(n => !imported.has(n)).sort()
    expect(
      missing,
      '以下 EP 样式在闭包里但未 import（视觉回归风险，QG Visual 会红）: ' + missing.join(', '),
    ).toEqual([])

    // 4) 共享底座（base.css 不带 el- 前缀，不在上面的 imported 集合里，单独断言）
    expect(pluginSrc, '缺少共享底座 base.css').toMatch(/theme-chalk\/base\.css/)
    expect(imported.has('el-var'), '缺少共享底座 el-var.css').toBe(true)
    // 组件样式目录必须真实存在（防路径写错但恰好被 tree-shake 掩盖）
    const chalkDir = path.join(
      process.cwd(), '..', '..', 'node_modules', 'element-plus', 'theme-chalk',
    )
    const missingFile = required.filter(n => !fs.existsSync(path.join(chalkDir, n + '.css')))
    expect(missingFile, 'theme-chalk 里不存在的样式文件: ' + missingFile.join(', ')).toEqual([])
  })

  /**
   * P6 全量产物包含性锁（2026-10-15 加入，由一次 9.48% 的真实像素回归换来）
   *
   * 判据：**插件导入的每个 theme-chalk 文件都必须真的存在于 EP 的全量产物
   * `theme-chalk/index.css` 中**。反向（全量有、子集没有）才是缺失；
   * 而「子集有、全量没有」的文件会带来**全量引入下根本不存在的全局副作用**。
   *
   * 这次踩的是 `el-reset.css`：它含 `input,textarea,button{font-family:inherit}`
   * 以及 `a` / `h1~h6` / `p` / `hr` 等原生元素规则，而 `index.css` 里一条都没有。
   * 多导它的后果：按钮字体从浏览器默认 `Arial` 变成继承应用字体栈，
   * 逐元素计算样式对比 348 个元素里 32 个（全是 BUTTON 及其子节点）字体不同
   * ⇒ create-editor 9.48% / create-pipeline 9.26% / podcast-channel 2.05%
   * 像素回归（同态重复渲染实测 0.00%，已排除抖动）。
   *
   * 只断言「不含 el-reset」是弱锁（换个文件又会重犯），故这里断言**集合关系**。
   *
   * ⚠️ **本锁的第一版被 QM-6 双模型深度审查判红 3 条（2026-10-15），已按下述修法重做**：
   *  - **i1（Critical）**：第一版从文件里抽 `\.el-[a-z0-9-]+` 当首个选择器；而 `el-reset.css`
   *    开头是 `input,textarea,button{…}` 这类**元素选择器**，正则匹配不到 ⇒ 返回 null
   *    ⇒ 被塞进 `placeholders` 桶而**不是** `notInFull`。也就是说「通用集合锁」根本抓不到
   *    el-reset，真正挡住它的只有硬编码那条 —— 与「换个文件也会重犯」的设计目标不符。
   *    修法：改成抽**首个规则的完整选择器**（不再限定 `.el-` 前缀），元素选择器一样要能定位；
   *    只有 **0 字节**文件才允许进「renderless 占位」桶。
   *  - **i2（Warning）**：第一版用 `indexCss.includes(sel)` 做**子串**匹配 —— `.el-radio`
   *    会命中 `index.css` 里的 `.el-radio-group`，文件真缺失也能假通过。
   *    修法：把 `index.css` 解析成**选择器集合**，改判**整串成员关系**，并同时核对
   *    「后缀字符不是类名字符」以排除前缀误配。
   *  - **i3（Warning）**：第一版用魔法数 `placeholders.length < 5`，且把「合法 renderless 0 字节」
   *    与「选择器抽取失败」两类不同对象混在一个桶里。修法：**取消魔法数**，改为
   *    「非空文件必须抽得出首个选择器」，并把两类严格分开统计、分别断言。
   */
  it('P6：导入的每个主题文件都必须存在于 EP 全量产物 index.css 中（防「多导带来全局副作用」）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const pluginSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/plugins/element-plus.js'), 'utf8',
    )
    const imported = [...new Set(
      [...pluginSrc.matchAll(/theme-chalk\/(el-[a-z0-9-]+)\.css/g)].map(m => m[1]),
    )]
    // 锁的输入面必须非空 —— 否则「匹配 0 条」与「真的没有」在输出上一模一样（旧教训）
    expect(imported.length, '从插件里一个主题文件都没解析到，锁退化成空转').toBeGreaterThan(30)

    // 明确禁止：全局元素重置不在全量产物里（硬编码保留为双保险，但不再是唯一防线）
    expect(
      imported.includes('el-reset'),
      'el-reset.css 不在 EP 全量产物 index.css 中，导入它会改变原生元素默认样式'
        + '（2026-10-15 实测造成 9.48% 像素回归）',
    ).toBe(false)

    const chalkDir = path.join(
      process.cwd(), '..', '..', 'node_modules', 'element-plus', 'theme-chalk',
    )
    const indexCss = fs.readFileSync(path.join(chalkDir, 'index.css'), 'utf8')

    /** 括号感知地抽出**首个规则的完整选择器**（不限定 .el- 前缀：元素选择器同样要能定位）。 */
    const firstSelector = (css) => {
      let depth = 0
      let buf = ''
      let inStr = null
      for (let i = 0; i < css.length; i++) {
        const ch = css[i]
        if (inStr) {
          if (ch === '\\') { i++; continue }
          if (ch === inStr) inStr = null
          buf += ch
          continue
        }
        if (ch === '"' || ch === "'") { inStr = ch; buf += ch; continue }
        if (ch === '/' && css[i + 1] === '*') {
          const end = css.indexOf('*/', i + 2)
          i = end === -1 ? css.length : end + 1
          continue
        }
        if (ch === '{') {
          const sel = buf.trim()
          if (depth === 0 && sel && !sel.startsWith('@')) return sel.split(',')[0].trim()
          depth++
          buf = ''
          continue
        }
        if (ch === '}') { depth = Math.max(0, depth - 1); buf = ''; continue }
        buf += ch
      }
      return null
    }

    /** 把全量 index.css 解析成**选择器集合**（用于整串成员判定，避免 i2 的子串误配）。 */
    const indexSelectors = new Set()
    {
      let depth = 0
      let buf = ''
      let inStr = null
      for (let i = 0; i < indexCss.length; i++) {
        const ch = indexCss[i]
        if (inStr) {
          if (ch === '\\') { i++; continue }
          if (ch === inStr) inStr = null
          buf += ch
          continue
        }
        if (ch === '"' || ch === "'") { inStr = ch; buf += ch; continue }
        if (ch === '/' && indexCss[i + 1] === '*') {
          const end = indexCss.indexOf('*/', i + 2)
          i = end === -1 ? indexCss.length : end + 1
          continue
        }
        if (ch === '{') {
          const sel = buf.trim()
          if (depth === 0 && sel && !sel.startsWith('@')) {
            for (const s of sel.split(',')) {
              const t = s.trim()
              if (t) indexSelectors.add(t)
            }
          }
          depth++
          buf = ''
          continue
        }
        if (ch === '}') { depth = Math.max(0, depth - 1); buf = ''; continue }
        buf += ch
      }
    }
    // 解析退化成空集合会让整条锁假绿 —— 加规模下界断言
    expect(indexSelectors.size, 'index.css 选择器解析退化成空集合').toBeGreaterThan(500)

    const emptyFiles = []
    const unparsable = []
    const notInFull = []
    for (const name of imported) {
      const p = path.join(chalkDir, name + '.css')
      if (!fs.existsSync(p)) continue
      const css = fs.readFileSync(p, 'utf8')
      if (!css.trim()) { emptyFiles.push(name); continue } // renderless（0 字节）
      const sel = firstSelector(css)
      if (!sel) { unparsable.push(name); continue } // 非空却抽不出选择器 = 判据失效
      // 整串成员判定；再补一条「同前缀类名不算命中」的反向核对（防 .el-radio → .el-radio-group）
      const exact = indexSelectors.has(sel)
      const prefixOnly = !exact && [...indexSelectors].some(
        s => s.startsWith(sel) && /^[A-Za-z0-9_-]/.test(s.slice(sel.length)),
      )
      if (!exact && !prefixOnly) notInFull.push(name + '（首个选择器 ' + sel + '）')
    }

    expect(
      unparsable,
      '以下非空主题文件抽不出首个选择器 —— 判据失效，必须修判据而不是放宽: ' + unparsable.join(', '),
    ).toEqual([])
    expect(
      notInFull,
      '以下主题文件的首个选择器在全量 index.css 里找不到 —— 它们带来的是全量引入下不存在的样式: '
        + notInFull.join(', '),
    ).toEqual([])
    // 0 字节文件只能是 renderless 占位 —— 逐个点名，不用魔法数阈值
    expect(
      emptyFiles.sort(),
      '0 字节主题文件集合发生变化，请逐个确认它们确实是 renderless 组件',
    ).toEqual(['el-config-provider', 'el-tab-pane', 'el-tooltip'])
  })

  it('P5：样式 import 不得重复（重复行说明批量替换改坏了清单）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const pluginSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/plugins/element-plus.js'), 'utf8',
    )
    const lines = pluginSrc
      .split('\n')
      .map(l => (l.match(/theme-chalk\/(el-[a-z0-9-]+)\.css/) || [])[1])
      .filter(Boolean)
    const dupes = lines.filter((v, i) => lines.indexOf(v) !== i)
    expect([...new Set(dupes)], '重复的样式 import: ' + [...new Set(dupes)].join(', ')).toEqual([])
  })

  /**
   * P7 指令覆盖锁（2026-10-15 加入）
   *
   * P3 扫的是模板里的 `<el-xxx>` **标签**，而 EP 还有一类装配项是**指令**：
   * `v-loading`（`ElLoading`）/ `v-infinite-scroll`（`ElInfiniteScroll`）。
   * `app.use(ElementPlus)` 会一并装上它们，显式按需清单则**必须手动登记**，
   * 而且漏装**不会报错、只会静默少渲染**（加载遮罩整块不出现）。
   *
   * 本项目实测用到 `v-loading` 的 4 个文件：PatternAnalysisPanel /
   * FilmEngineeringView ×2 / PerformanceInsights。本锁把它们变成机械判据：
   * 模板里出现 `v-loading` ⇒ 插件必须 import `ElLoading` 且 `app.use` 它，
   * 并导入 `el-loading.css`（指令样式不在任何组件的样式闭包里）。
   *
   * ⚠️ **本锁的第一版被 QM-6 双模型深度审查判红 1 条（i5, Warning），已重做**：
   *  - 第一版只遍历 `.vue`，且正则 `\sv-(loading|infinite-scroll)\b` **要求 `v-` 前是空白**
   *    ⇒ 紧贴 `(`/引号/行首的用法会漏；`.js`/`.ts` 里 `withDirectives(h(...), [[ElLoading, …]])`
   *    这类**非模板用法**完全不扫。扫描覆盖不全 = 可能给出「已装配」的假绿。
   *  - 修法：① 扫描面扩到 `.vue`/`.js`/`.ts`；② 去掉「必须前置空白」的限制，
   *    改用 `\bv-(loading|infinite-scroll)\b`；③ **加命中数下界断言**（仓库已知至少 4 处
   *    `v-loading`），防止扫描静默退化成 0 命中而假绿（旧教训：匹配 0 条与真的没有
   *    在输出上一模一样）；④ 额外识别 `withDirectives` + 指令名的非模板用法。
   */
  it('P7：模板用到的 EP 指令必须被装配（v-loading ⇒ ElLoading + el-loading.css）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = path.join(process.cwd(), 'src')

    const usedDirectives = new Map() // 指令名 -> 首个使用文件
    let templateHits = 0
    const withDirectivesFiles = []
    const scan = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules') scan(p); continue }
        if (!/\.(vue|js|ts)$/.test(e.name)) continue
        // 排除测试文件：本锁自己的正则/字符串里就含 `v-loading` 字样，扫进去会自指误报
        // （实测：第一版去掉「前置空白」限制后，正好把本文件的 `v-infinite-scroll` 字面量扫成用法）
        if (/\.test\.[jt]s$/.test(e.name) || /\.spec\.[jt]s$/.test(e.name)) continue
        const text = fs.readFileSync(p, 'utf8')
        // ① 模板/属性用法：去掉「v- 前必须是空白」的限制（i5）
        for (const m of text.matchAll(/\bv-(loading|infinite-scroll)\b/g)) {
          templateHits++
          if (!usedDirectives.has(m[1])) usedDirectives.set(m[1], p.replace(src, 'src'))
        }
        // ② 非模板用法：withDirectives(h(...), [[SomeDirective, …]])
        if (/withDirectives\s*\(/.test(text) && /(Loading|resolveDirective\s*\(\s*['"]loading)/.test(text)) {
          withDirectivesFiles.push(p.replace(src, 'src'))
        }
      }
    }
    scan(src)

    // ③ 下界断言：扫描退化会让整条锁假绿
    expect(templateHits, '一个 v-loading/v-infinite-scroll 都没扫到 —— 扫描退化成空转').toBeGreaterThanOrEqual(4)

    const pluginSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/plugins/element-plus.js'), 'utf8',
    )
    const missing = []
    for (const [dir, file] of usedDirectives) {
      if (dir === 'loading') {
        if (!/\bElLoading\b/.test(pluginSrc)) missing.push('v-loading ⇒ 需 import 并 app.use ElLoading（用于 ' + file + '）')
        if (!/theme-chalk\/el-loading\.css/.test(pluginSrc)) missing.push('v-loading ⇒ 需 import el-loading.css（用于 ' + file + '）')
      }
      if (dir === 'infinite-scroll') {
        if (!/\bElInfiniteScroll\b/.test(pluginSrc)) missing.push('v-infinite-scroll ⇒ 需 import 并 app.use ElInfiniteScroll（用于 ' + file + '）')
      }
    }
    // ④ 非模板用法同样要求已装配（当前仓库无命中，命中即必须复核）
    if (withDirectivesFiles.length) {
      if (!/\bElLoading\b/.test(pluginSrc)) {
        missing.push('withDirectives + Loading 出现在 ' + withDirectivesFiles.join(', ') + ' ⇒ 需装配 ElLoading')
      }
    }
    expect(missing, missing.join('; ')).toEqual([])
    // 指令必须真的挂进注册表（不是只 import 了名字）
    const { createApp, h } = await import('vue')
    const app = createApp({ render: () => h('div') })
    app.use(elementPlusOnDemand)
    expect(
      app._context.directives.loading,
      'ElLoading 未挂进 app._context.directives —— v-loading 会静默失效',
    ).toBeTruthy()
  })
})
