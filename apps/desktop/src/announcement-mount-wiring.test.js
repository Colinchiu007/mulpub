/**
 * 接线锁：运营公告必须有**生产渲染方**（UX 审计 1.2）
 *
 * 为什么需要单独一把：组件本体与它的数据源都写好了，全仓却零引用——
 * 于是"接口返回了公告、界面上永远看不到"。任何只测组件自身的用例都看不见这件事
 * （测试自己 mount 它，当然渲染得出来），所以这条必须对着**外壳源码**断言。
 *
 * 位置判据取自设计 D1 方案 C：挂在 `.mp-shell-main` 内、`NavBar` 之后、工作区 `main` 之前，
 * 不动主进程 `BROWSER_CHROME_TOP = 76` 几何契约，也不在壳态分支重复渲染。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_VUE = path.resolve(HERE, 'App.vue')

/** 只保留模板里的元素开标签，剥掉注释（注释里提组件名是为了说明"为什么挂在这"） */
function templateTags (src) {
  const start = src.indexOf('<template>')
  const end = src.lastIndexOf('</template>')
  if (start < 0 || end < 0) throw new Error('APP_VUE_TEMPLATE_ANCHOR_MISSING')
  const tpl = src
    .slice(start, end)
    .replace(/<!--[\s\S]*?-->/g, '')
  return tpl
}

describe('公告横幅的接线合同', () => {
  const src = fs.readFileSync(APP_VUE, 'utf8')
  const tpl = templateTags(src)

  it('App.vue 必须渲染 AnnouncementBanner（零渲染方就是本批要修的缺陷）', () => {
    const hits = tpl.match(/<AnnouncementBanner\b/g) || []
    expect(hits, 'App.vue 的模板里没有 <AnnouncementBanner> ⇒ 公告再次变成"存在但无人渲染"').toHaveLength(1)
  })

  it('必须挂在 NavBar 之后、工作台工作区之前（布局避让，不动几何契约）', () => {
    const banner = tpl.indexOf('<AnnouncementBanner')
    const navBar = tpl.indexOf('<NavBar')
    // 必须从 NavBar 往后找：`<main class="mp-workspace">` 在本仓出现**两次**
    // （壳态分支 :22 与工作台分支 :72）。取第一个会把"横幅在 NavBar 之后"这一条
    // 判成假——工作台分支整体在第一个 main 之后。
    const workspace = tpl.indexOf('<main class="mp-workspace', navBar)
    // 锚点缺失必须出声：拿 -1 参与大小比较会静默得出"顺序正确"
    expect(banner, '找不到横幅挂载点').toBeGreaterThan(-1)
    expect(navBar, '找不到 NavBar 挂载点').toBeGreaterThan(-1)
    expect(workspace, '找不到工作区 main').toBeGreaterThan(-1)
    expect(banner).toBeGreaterThan(navBar)
    expect(banner).toBeLessThan(workspace)
  })

  it('不得在内嵌主页壳态分支里渲染（同一份公告不得画两遍）', () => {
    const shellStart = tpl.indexOf('data-testid="mp-home-shell"')
    const shellEnd = tpl.indexOf('<template v-else>')
    expect(shellStart, '壳态分支锚点必须还在，否则本条判据会静默失效').toBeGreaterThan(-1)
    expect(shellEnd, '工作台分支锚点必须还在').toBeGreaterThan(shellStart)
    const shellRegion = tpl.slice(shellStart, shellEnd)
    expect(shellRegion).not.toContain('<AnnouncementBanner')
  })

  it('组件文件必须真实存在（接线指向空气时 vite 才报错，这里提前红）', () => {
    expect(fs.existsSync(path.resolve(HERE, 'components', 'AnnouncementBanner.vue'))).toBe(true)
  })
})
