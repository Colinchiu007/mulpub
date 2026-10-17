/**
 * feature 键名漂移锁（dash-full-entitlement，对应评审 Critical i4）。
 *
 * 为什么这条必须机械锁死：
 * 渲染层按 `dashboard_full` 这个字符串判定是否解锁完整看板。若服务端哪天
 * 改了 feature 名（或客户端与服务端键名漂移），**没有任何报错** ——
 * hasFeatureOf 只会安静地返回 false，于是**全部付费用户静默降级为免费版**。
 * 这是典型的无声故障：界面看起来"正常工作"，只是内容少了，没人会报障。
 *
 * 本锁把客户端常量与服务端真源（plan-matrix.js 的派生逻辑）钉在一起：
 * 任一侧改名而另一侧没跟，这里就红。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { DASHBOARD_FULL_FEATURE } from './entitlement-gate'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * 从当前测试文件向上逐级找仓库根（以 pnpm-workspace.yaml 为锚）。
 *
 * 为什么不用 `path.resolve(here, '..', '..', '..', '..', '..')`（CCG i3 提出，已采纳）：
 * 数层级会把「目录结构调整」变成静默失效 —— 少算或多算一层，readFileSync 直接 ENOENT，
 * 而失败信息只会说「文件不存在」，看不出是路径算错了。锚点查找对目录搬家免疫。
 */
function findRepoRoot (start) {
  let dir = start
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

const repoRoot = findRepoRoot(here)
const PLAN_MATRIX = repoRoot
  ? path.join(repoRoot, 'packages', 'api-publish-engine', 'src', 'auth', 'plan-matrix.js')
  : null

describe('dashboard_full feature 键名一致性（防无声降级）', () => {
  it('能定位仓库根与服务端真源文件', () => {
    // 先断锚点本身：路径算错时这条给的是「找不到仓库根」，
    // 而不是下游三条各报一次 ENOENT —— 定位成本差一个量级。
    expect(repoRoot, '未找到 pnpm-workspace.yaml，无法定位仓库根').toBeTruthy()
    expect(existsSync(PLAN_MATRIX), '服务端真源不存在：' + PLAN_MATRIX).toBe(true)
  })

  it('服务端真源 plan-matrix.js 确实派生了这个 feature', () => {
    const src = readFileSync(PLAN_MATRIX, 'utf8')
    // 形如：if (matrix.dashboard === 'full') features.push('dashboard_full')
    expect(src).toMatch(/features\.push\(\s*['"]dashboard_full['"]\s*\)/)
  })

  it('客户端常量与服务端键名逐字一致', () => {
    const src = readFileSync(PLAN_MATRIX, 'utf8')
    // 必须取**全部** push 的字面量再比对：plan-matrix 里有三个条件 push
    // （video_create / schedule_batch / dashboard_full），不带 /g 的 match 只
    // 返回第一个（video_create）——那样会把断言比错对象，却仍然"通过了一条"。
    const pushed = [...src.matchAll(/features\.push\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
    expect(pushed.length, 'plan-matrix.js 未找到任何 features.push 字面量').toBeGreaterThan(0)
    expect(pushed).toContain(DASHBOARD_FULL_FEATURE)
  })

  it('free 档不得含该 feature（服务端矩阵基线）', () => {
    const src = readFileSync(PLAN_MATRIX, 'utf8')
    // free 段 dashboard: 'basic' —— full 才派生
    expect(src).toMatch(/dashboard:\s*'basic'/)
    expect(src).toMatch(/dashboard:\s*'full'/)
  })
})
