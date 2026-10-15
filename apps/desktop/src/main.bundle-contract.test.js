import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 首屏 bundle 契约测试（fix-newtab-home-slow）
 *
 * 缺陷背景（2026-10-15 真机实测）：点击顶部「+」新增标签后 3-4 秒才显示应用主页。
 * 根因不是主进程 IPC（实测 createNewTabPage 同步段 24ms/1ms），而是**渲染进程
 * 首屏载荷**：打包产物 index.js = 1.84 MB、index.css = 503 KB，其中
 *   - element-plus **全量**引入（124 个组件全部进主 chunk，min 后 ~877KB JS
 *     + 349KB CSS），而本仓 src 实际只用到 36 个组件；
 *   - Home.vue onMounted 串行 await 6 项数据源（identity → license → accounts
 *     → batch-check-login → dashboard:stats → history:list）。
 *
 * 本测试锁死「按需引入」的结构契约：main.js 不得再出现全量 import，
 * 且必须走 element-plus 组件的显式按需注册入口。
 */

const MAIN = path.join(process.cwd(), 'src/main.js')
const read = () => fs.readFileSync(MAIN, 'utf8')

/** 去掉注释与字符串后的源码，避免注释里的字样触发误判 */
function stripComments (src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('main.js 首屏 bundle 契约（element-plus 按需引入）', () => {
  it('不得全量引入 element-plus 运行时（import ElementPlus from "element-plus"）', () => {
    const src = stripComments(read())
    expect(src).not.toMatch(/import\s+ElementPlus\s+from\s+['"]element-plus['"]/)
    expect(src).not.toMatch(/app\.use\(\s*ElementPlus\s*\)/)
  })

  it('不得全量引入 element-plus 样式（element-plus/dist/index.css）', () => {
    const src = stripComments(read())
    expect(src).not.toMatch(/element-plus\/dist\/index\.css/)
  })

  it('必须经按需注册入口装配 element-plus（app.use(elementPlusOnDemand)）', () => {
    const src = stripComments(read())
    // 注册入口必须在 main.js 内被使用，且其定义在独立模块中
    expect(src).toMatch(/app\.use\(\s*\w*[Ee]lement[Pp]lus\w*\s*\)/)
  })

  it('按需注册模块必须存在且显式列出用到的组件（禁止 "export *" 全量再导出）', () => {
    const mod = path.join(process.cwd(), 'src/plugins/element-plus.js')
    expect(fs.existsSync(mod)).toBe(true)
    const src = stripComments(fs.readFileSync(mod, 'utf8'))
    // 必须从 element-plus/es 具名导入（es/ 是 ESM 树-shaking 入口），
    // 而不是默认导入（默认导入 = 全量）
    expect(src).not.toMatch(/^import\s+ElementPlus\s+from/m)
    expect(src).toMatch(/from\s+['"]element-plus\/es['"]/)
    // 必须显式注册（install 或 app.component），且至少覆盖 20 个组件
    const installCount = (src.match(/app\.component\(/g) || []).length
    const pluginCount = (src.match(/export\s+default\s*\{[\s\S]*?install\s*\(/g) || []).length
    expect(installCount + (pluginCount ? 30 : 0)).toBeGreaterThanOrEqual(20)
  })

  it('按需样式必须只导入用到的组件样式（theme-chalk 单文件），不得导入 index.css', () => {
    const mod = path.join(process.cwd(), 'src/plugins/element-plus.js')
    const src = stripComments(fs.readFileSync(mod, 'utf8'))
    expect(src).not.toMatch(/element-plus\/dist\/index\.css/)
    // 至少导入 base/var 这类共享底座
    expect(src).toMatch(/element-plus\/theme-chalk\/(base|el-var|el-reset)\.css/)
  })

  it('QuillEditor 不再以静态全局组件注册（随 ArticleEditor 懒加载）', () => {
    const src = stripComments(read())
    expect(src).not.toMatch(/app\.component\(\s*['"]QuillEditor['"]/)
    expect(src).not.toMatch(/from\s+['"]@vueup\/vue-quill['"]/)
  })

  it('Quill 的 snow 样式不得出现在首屏（应由 ArticleEditor 动态 import 带入）', () => {
    const src = stripComments(read())
    expect(src).not.toMatch(/@vueup\/vue-quill\/dist\/vue-quill\.snow\.css/)
  })
})
