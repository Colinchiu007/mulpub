/**
 * usePublishTargetBulk.test.js — 「全选」判据的单元测试（publish-target-select-all）
 *
 * 被测：`apps/desktop/src/features/publish/usePublishTargetBulk.js`（纯函数 + 依赖注入）。
 *
 * 三条本文件最重要的锁（与 P2-8b `usePublishGroupApply.test.js` 同族）：
 * 1. **可发布判据必须问注入的 getAvailableAccountIds**，不得自己数 `platform.accounts.length`
 *    —— 后者包含停用账号（`usePublishPlatformCatalog` 刻意保留停用账号以显示禁用态）。
 * 2. **同段锁**：源码剥离注释后不得出现 await / nextTick。拆帧会让 `reconcileSelectedAccounts`
 *    的默认账号回填插在中间，产生"多出一个号"的不可解释状态。
 * 3. **分类互斥且穷尽**：added + already + skipped === 平台目录规模。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { selectAllPublishTargets } from './usePublishTargetBulk'

// 夹具：平台目录 + 可用账号集合 + 已选平台。全部由 opts 指定，
// 不依赖任何 store —— 本文件的判据必须在无 Vue、无 IPC 的环境里可表述。
function makeDeps (opts = {}) {
  const platforms = opts.platforms || [
    { id: 'wechat_mp', label: '微信公众号', accounts: [{ id: 'wx-1' }, { id: 'wx-2' }] },
    { id: 'zhihu', label: '知乎', accounts: [{ id: 'zh-1' }] },
    { id: 'douyin', label: '抖音', accounts: [] },
    { id: 'bilibili', label: '哔哩哔哩', accounts: [{ id: 'bili-1' }] },
  ]
  // 可用账号集合：默认只有 wechat_mp 与 bilibili 有可用账号（zhihu 全停用、douyin 未登录）
  const availableByPlatform = opts.availableByPlatform || {
    wechat_mp: ['wx-1', 'wx-2'],
    bilibili: ['bili-1'],
  }
  const selectedPlatforms = opts.selectedPlatforms || []
  const calls = []
  const injectable = {
    getAvailableAccountIds: (platformId) => (availableByPlatform[platformId] || []).slice(),
    isPlatformSelected: (platformId) => selectedPlatforms.includes(platformId),
    selectPlatform: (platformId) => { calls.push(['platform', platformId]) },
  }

  return {
    platforms,
    calls,
    // 单数形态：被测函数只收一个参数（目录 + 注入依赖打平），与实现签名一致
    deps: { platforms, ...injectable },
    injectable,
  }
}

describe('selectAllPublishTargets（发布页全选）', () => {
  it('只选有可用账号的平台；无可用账号的平台进 skipped 且不调用写入器', () => {
    const { deps, calls } = makeDeps({})

    const result = selectAllPublishTargets(deps)

    expect(result.ok).toBe(true)
    expect(result.added).toEqual(['wechat_mp', 'bilibili'])
    expect(result.already).toEqual([])
    // 顺序按平台目录顺序（可预期），且两步写入都发生
    expect(calls).toEqual([['platform', 'wechat_mp'], ['platform', 'bilibili']])
    expect(result.skipped).toEqual([
      { platformId: 'zhihu', reason: 'no-account' },
      { platformId: 'douyin', reason: 'no-account' },
    ])
  })

  it('分类互斥且穷尽：added + already + skipped === 平台目录规模（L1）', () => {
    const { deps } = makeDeps({ selectedPlatforms: ['bilibili'] })

    const result = selectAllPublishTargets(deps)

    expect(result.added).toEqual(['wechat_mp'])
    expect(result.already).toEqual(['bilibili'])
    expect(result.skipped).toHaveLength(2)
    expect(result.added.length + result.already.length + result.skipped.length).toBe(4)
  })

  it('可发布判据问注入的 getAvailableAccountIds，不数 platform.accounts.length（L2）', () => {
    // zhihu 有 1 个账号但已停用 ⇒ availableByPlatform 里没有它 ⇒ 必须落 skipped。
    // 旧实现若读 accounts.length 会把 zhihu 当成可发布，本用例当场红。
    // 夹具里保留 wechat_mp 作为"确实可发布"的对照，避免整目录落进 no-targets 分支
    // （那条分支同样正确，但会把本用例要盯的"停用账号被当成可发布"掩盖掉）。
    const { deps } = makeDeps({
      platforms: [
        { id: 'wechat_mp', label: '微信公众号', accounts: [{ id: 'wx-1' }] },
        { id: 'zhihu', label: '知乎', accounts: [{ id: 'zh-1' }] },
      ],
      availableByPlatform: { wechat_mp: ['wx-1'] },
    })

    const result = selectAllPublishTargets(deps)

    expect(result.added).toEqual(['wechat_mp'])
    expect(result.skipped).toEqual([{ platformId: 'zhihu', reason: 'no-account' }])
  })

  it('目录为空 / 全无可用账号 ⇒ no-targets，且不调用任何写入器（L3）', () => {
    const { deps, calls } = makeDeps({
      platforms: [],
      availableByPlatform: {},
    })

    const result = selectAllPublishTargets(deps)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-targets')
    expect(result.added).toEqual([])
    expect(result.already).toEqual([])
    expect(result.skipped).toEqual([])
    expect(calls).toEqual([])
  })

  it('全无可用账号但目录非空同样判 no-targets（不是 ok + 空 added）', () => {
    const { deps } = makeDeps({ availableByPlatform: {} })

    const result = selectAllPublishTargets(deps)

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-targets')
  })

  it('平台已被选中 ⇒ 不重复 selectPlatform，计入 already（L4）', () => {
    const { deps, calls } = makeDeps({ selectedPlatforms: ['wechat_mp'] })

    const result = selectAllPublishTargets(deps)

    expect(result.added).toEqual(['bilibili'])
    expect(result.already).toEqual(['wechat_mp'])
    expect(calls).toEqual([['platform', 'bilibili']])
  })

  it('全部平台已选中 ⇒ added=0、already=全部、零写入', () => {
    const { deps, calls } = makeDeps({ selectedPlatforms: ['wechat_mp', 'bilibili'] })

    const result = selectAllPublishTargets(deps)

    expect(result.added).toEqual([])
    expect(result.already).toEqual(['wechat_mp', 'bilibili'])
    expect(calls).toEqual([])
  })

  it('幂等：同一状态下连点两次全选，第二次零写入且 added=0（与按组添加同语义）', () => {
    const first = makeDeps({})
    const r1 = selectAllPublishTargets(first.deps)
    expect(r1.added).toEqual(['wechat_mp', 'bilibili'])

    // 第二次：把第一次的写入结果回填成"已选中"（模拟真实宿主）
    const second = makeDeps({ selectedPlatforms: ['wechat_mp', 'bilibili'] })
    const r2 = selectAllPublishTargets(second.deps)
    expect(r2.added).toEqual([])
    expect(r2.already).toEqual(['wechat_mp', 'bilibili'])
    expect(second.calls).toEqual([])
  })

  it('非法入参不抛错：platforms 非数组 ⇒ no-targets', () => {
    for (const bad of [null, undefined, 'wechat_mp', 42, {}]) {
      const { deps } = makeDeps({})
      const result = selectAllPublishTargets({ ...deps, platforms: bad })
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('no-targets')
    }
  })

  it('平台项缺 id / 非字符串 id 不进入任何桶（不得写进 undefined 键）', () => {
    const { deps } = makeDeps({
      platforms: [{ id: 'wechat_mp', label: 'x' }, { id: 42 }, { label: 'no-id' }, null],
      availableByPlatform: { wechat_mp: ['wx-1'] },
    })
    const result = selectAllPublishTargets(deps)

    expect(result.added).toEqual(['wechat_mp'])
    // 两个坏项不计入 added/already，也不得出现在 skipped 里（它们不是"没有账号的平台"）
    expect(result.skipped).toEqual([])
    expect(result.added.length + result.already.length + result.skipped.length).toBe(1)
  })

  it('selected 恒等于 added + already（供上层播报直接读，不得再自行推断）', () => {
    const { deps } = makeDeps({ selectedPlatforms: ['bilibili'] })

    const result = selectAllPublishTargets(deps)

    // selected 是 added + already 的排序并集（排序让"同一状态的两次调用逐字节相等"可断言）
    expect(result.selected).toEqual([...result.added, ...result.already].sort())
    expect(result.selected).toEqual(['bilibili', 'wechat_mp'])
  })

  // L5 同段锁：与 usePublishGroupApply.test.js 同型。取源路径禁止数 `..`、禁止只信
  // process.cwd()（pnpm hoisted + junction 会指向不存在的位置）；"读不到 ⇒ 跳过"
  // 就是把锁拆掉，所以读不到必须失败。
  it('实现不得引入 await/nextTick：写入必须在同一同步段完成（L5）', () => {
    const REL = ['src', 'features', 'publish', 'usePublishTargetBulk.js']
    const candidates = []
    let dir = process.cwd()
    for (let depth = 0; depth < 6 && dir !== path.parse(dir).root; depth++) {
      candidates.push(path.join(dir, ...REL))
      candidates.push(path.join(dir, 'apps', 'desktop', ...REL))
      dir = path.dirname(dir)
    }
    const sourcePath = candidates.find(p => fs.existsSync(p))
    expect(sourcePath, `读不到被测源文件，扫过 ${candidates.length} 个候选路径（首个：${candidates[0]}）—— 源码锁不得在"读不到"时放行`).toBeTruthy()
    const src = fs.readFileSync(sourcePath, 'utf8')
    expect(src.length, '源文件过小，解析目标可疑：' + sourcePath).toBeGreaterThan(500)
    expect(src.includes('export function selectAllPublishTargets'), '解析到的文件不含被测实现：' + sourcePath).toBe(true)
    const codeOnly = src.split(/\r?\n/)
      .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect(codeOnly.includes('nextTick'), '写入被推迟到下一个 tick，默认账号回填会插在中间').toBe(false)
    const asyncHit = /\bawait\b/.exec(codeOnly)
    expect(asyncHit, '出现 await 即说明写入不再同段完成：' + (asyncHit && asyncHit[0])).toBeNull()
  })
})
