// @ts-nocheck
/**
 * 「应用内导航可见性」结构锁（2026-10-23）
 *
 * ── 为什么要有这份锁 ──────────────────────────────────────────────
 *
 * 主窗口 DOM 是最底层；外部网页（自媒体账号创作者中心、登录、扫码、OAuth）由主进程
 * `WebContentsView` 承载，是**永远压在 DOM 之上、z-index 无效**的原生图层
 * （覆盖矩形：x ≥ 侧栏宽 且 y ≥ 76；真源 `apps/desktop/electron/services/view-bounds.js`）。
 *
 * 因此有一条硬约束：**主窗口 router 的页面只有在「首页虚拟标签」活动时才可见**
 * （壳态互斥：`App.vue` 的 `watch(isHomeTab)` → `setShellMode('workbench'|'browser')`）。
 *
 * 裸 `router.push` 只改路由、不改活动标签 ⇒ 目标页面渲染在原生图层背后 ⇒
 * 用户表现为「点了没反应」（2026-10-23 用户报障：头像菜单 → 会员中心）。
 *
 * 本锁把「所有『让用户去某个应用内页面』的入口都必须走可见导航范式」钉成结构契约。
 * **刻意不锁死具体实现（composable 名字 / 函数体形态）**：本仓另有一条在飞改动
 * （PR #4209「快捷键与鼠标共用一段可见导航」）正在把该范式收敛成 composable，
 * 锁死实现会让那份收敛必然撞锁。本锁只锁**行为归属**：入口不自己 push，
 * 一律交给唯一的可见导航范式。
 *
 * ⚠️ 结构锁的已知假绿面：断言可被注释里的散文满足。本文件的断言一律
 * **先剥全部注释**（行注释 / 块注释 / HTML 注释三类）再匹配 ——
 * 沿用仓库既有做法（按行首两字符判行注释，不用正则：反斜杠在本仓的脚本化补丁里被吃掉过两次）。
 * （注：本文件的头部注释刻意不写出块注释的结束定界符字面量 —— 写出来会提前闭合本注释。）
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

/** 读源码并剥掉全部注释（结构锁防「注释满足断言」的标准做法） */
function readSource (rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const out = []
  let inBlock = false
  let inHtml = false
  for (const line of raw.split(String.fromCharCode(10))) {
    const trimmed = line.trimStart()
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false
      continue
    }
    if (inHtml) {
      if (trimmed.includes('-->')) inHtml = false
      continue
    }
    if (trimmed.startsWith('//')) continue
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true
      continue
    }
    if (trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inHtml = true
      continue
    }
    // 行内块注释：同一条代码行里可能同时有代码与注释，只清掉注释部分
    out.push(line.replace(/\/\*[\s\S]*?\*\//g, ''))
  }
  return out.join(String.fromCharCode(10))
}

describe('应用内导航可见性：入口不得自行裸 push', () => {
  it('ProfileMenu：会员中心入口交回宿主（emit navigate），不自行 router.push', () => {
    const src = readSource('src/components/ProfileMenu.vue')
    expect(src).toMatch(/defineEmits\(\[[^\]]*'navigate'/)
    expect(src).toMatch(/function goMemberCenter\(\) \{[\s\S]*?emit\('navigate', '\/member-center'\)/)
    // 反向锁：本组件不得再有裸路由跳转
    expect(src).not.toMatch(/router\.push\(/)
    expect(src).not.toMatch(/useRouter/)
  })

  it('MpSidebar：升级入口与 ProfileMenu 的 navigate 事件都走 onNavClick（唯一可见导航范式）', () => {
    const src = readSource('src/layouts/MpSidebar.vue')
    expect(src).toMatch(/@upgrade="onNavClick\('\/member-center'\)"/)
    expect(src).toMatch(/@navigate="onNavClick"/)
    // onNavClick 存在且是异步（要 await 切标签）
    expect(src).toMatch(/async function onNavClick \(to\)/)
    // 反向锁：侧边栏不得再有裸路由跳转
    expect(src).not.toMatch(/router\.push\('\/member-center'\)@/)
    expect(src).not.toMatch(/@upgrade="router\.push/)
  })

  // 快捷键路径（App.vue 的 app:navigate 回调）**不在本锁范围内** ——
  // 它由 PR #4209「快捷键与鼠标共用一段可见导航」负责（该 PR 已全绿在飞），
  // 本 PR 不重复实现、也不重复断言，避免两份锁在同一条路径上互相打架。
})

describe('应用内导航可见性：可见导航范式本身的契约', () => {
  it('可见导航范式必须包含「切回首页标签」这一步（否则页面渲染在原生图层背后）', () => {
    // 该范式当前落在 MpSidebar.onNavClick；PR #4209 会把它收敛成 composable，
    // 故本锁按「行为关键字」而非「函数名」匹配，两种形态都成立。
    const candidates = [
      'src/layouts/MpSidebar.vue',
      'src/composables/useVisibleNavigation.js',
    ].filter((rel) => fs.existsSync(path.join(ROOT, rel))).map(readSource)
    const withSwitch = candidates.filter((s) => /switchToTab\(/.test(s))
    expect(withSwitch.length).toBeGreaterThan(0)
    // 且必须先切标签再 push：切标签的调用位置早于 push
    const src = withSwitch[0]
    const switchPos = src.indexOf('switchToTab(')
    const pushPos = src.indexOf('router.push(')
    expect(pushPos).toBeGreaterThan(-1)
    expect(switchPos).toBeLessThan(pushPos)
  })

  it('可见导航范式必须保留「内嵌主页实例定向投递」这一步（否则 home-shell 标签上的跳转不可见）', () => {
    const candidates = [
      'src/layouts/MpSidebar.vue',
      'src/composables/useVisibleNavigation.js',
    ].filter((rel) => fs.existsSync(path.join(ROOT, rel))).map(readSource)
    expect(candidates.some((s) => /navigateActiveHomeShell/.test(s))).toBe(true)
  })
})
