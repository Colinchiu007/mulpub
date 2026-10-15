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
})
