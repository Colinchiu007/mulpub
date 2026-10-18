/**
 * CreateView 与运营中心「字数控制」的接线结构锁（story-text-limit-control）
 *
 * 为什么单独成文件而不是塞进 CreateView.test.js：
 *   ① `check-max-lines` 对测试文件有 1500 行上限，且 CreateView.test.js 已按
 *      `TEST_LEDGER_GREW`（挂账 6884 + 容差 200）顶格 —— 本轮实测再往里加 24 行
 *      就判红（`较登记值 6884 膨胀 221 行`），门禁原话是「测试文件同样要拆（按被测
 *      模块/场景分文件）」；
 *   ② 本文件只做**源码结构断言**，不 mount 组件，因此零 fixture 依赖、毫秒级，
 *      与那份 7000 行的行为测试套件完全解耦。
 *
 * 被锁的缺陷（QM-6 跨家族外部评审 finding #1）：
 *   启动同步由主进程 `autoSyncOnStart()` 的 `setTimeout 3000` 触发，而 `CreateView`
 *   通常在 3s 之前就已挂载。若只在 `mounted()` 里拉一次 `storyTextLimit`，首次读到的
 *   是「尚未 apply」的旧状态，上限会被永久钉在内置默认 10000 ——
 *   表现为「运营在后台改了值、重启应用仍不生效」，且随「用户何时进入本页」随机出现。
 *   修法是订阅主进程 `applyRuntime` 成功后的 `ops-center:runtime-updated` 广播再拉一次
 *   （与 `MpSidebar` 拉菜单同一通道、同一机制），取消订阅压进既有 `cleanups`。
 *
 * 为什么这里只能用结构锁：测试环境没有 `window.electronAPI`，`electron-bridge` 的
 * `on()` 是空操作，行为断言只会测到 no-op 而恒真。真实约束是「订阅必须存在、且挂在
 * cleanups 上、且没有被退化成单次拉取」——这三条都只有源码形态能判定。
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SFC_PATH = path.join(__dirname, 'CreateView.vue')

function readSfc () {
  return fs.readFileSync(SFC_PATH, 'utf8')
}

describe('CreateView × 字数控制接线结构锁', () => {
  it('必须从 @/api/ops-center-sync 引入 onOpsCenterRuntimeUpdated（与 MpSidebar 同一通道）', () => {
    expect(readSfc()).toMatch(
      /import\s*\{[^}]*onOpsCenterRuntimeUpdated[^}]*\}\s*from\s*'@\/api\/ops-center-sync'/,
    )
  })

  it('订阅必须压进 cleanups，并在回调里重拉上限（beforeUnmount 统一释放）', () => {
    expect(readSfc()).toMatch(
      /this\.cleanups\.push\(onOpsCenterRuntimeUpdated\(\(\)\s*=>\s*\{\s*void this\.loadStoryTextLimit\(\)\s*\}\)\)/,
    )
  })

  it('反向锁：不得退化成「只在 mounted 拉一次」', () => {
    const src = readSfc()
    // 调用点应 ≥ 3：方法定义 1 + mounted 首拉 1 + 订阅回调重拉 1
    const callSites = (src.match(/loadStoryTextLimit\(\)/g) || []).length
    expect(callSites, 'loadStoryTextLimit() 出现次数（定义 + mounted + 订阅回调）').toBeGreaterThanOrEqual(3)
    // 且订阅回调必须真的在 mounted 里注册（不是写在别处永不执行的分支里）
    const mountedBlock = src.slice(src.indexOf('async mounted()'), src.indexOf('beforeUnmount()'))
    expect(mountedBlock).toContain('loadStoryTextLimit()')
    expect(mountedBlock).toContain('onOpsCenterRuntimeUpdated(')
  })
})
