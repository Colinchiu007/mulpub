import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

__enableElectronMock()

let reclaim
let planReclaim
let groupKeyOf
let isThrowawayPartitionName
let wipeSessionStorage
let scheduleReclaim
let PROBE_LIMIT
let authLoginSlot
let partitionNameOf

beforeEach(async () => {
  vi.resetModules()
  const mod = await import('./auth-partition-reclaim.js')
  reclaim = mod.reclaimStaleAuthPartitions
  planReclaim = mod.planReclaim
  groupKeyOf = mod.groupKeyOf
  isThrowawayPartitionName = mod.isThrowawayPartitionName
  wipeSessionStorage = mod.wipeSessionStorage
  scheduleReclaim = mod.scheduleReclaim
  PROBE_LIMIT = mod.PROBE_LIMIT
  partitionNameOf = mod.partitionNameOf
  // 槽位规则已外移到独立模块（2026-10-21，QM-6 外部评审 i4 + 行数门禁）
  authLoginSlot = await import('./auth-login-slot.js')
})

const REAL = {
  // 本机 debug profile 实测形态（21 个目录 / 436MB），保留真实时间戳位数
  'auth-auth-wechat_mp-1790343224833': true,
  'auth-auth-wechat_mp-1790418403514': true,
  'auth-auth-zhihu-1790343393950': true,
  'auth-auth-zhihu-1790352605579': true,
  'silent-auth-douyin-1790400000001': true,
  'account-18c23d34': true,
  'account-ef2ccaa2': true,
  'logto-identity': true,
  'auth-zhihu-1700000000000': true,
}

function mkTmp () {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `mp-auth-reclaim-${process.pid}-`))
  return base
}

/** 在 userData 下按真实形态铺目录，返回 base */
function mkProfile (names, sub = path.join('session', 'Partitions')) {
  const base = mkTmp()
  const root = path.join(base, sub)
  fs.mkdirSync(root, { recursive: true })
  for (const n of names) fs.mkdirSync(path.join(root, n), { recursive: true })
  return base
}

function rmrf (p) {
  try { fs.rmSync(p, { recursive: true, force: true }) } catch (_e) { /* 临时目录清不掉不影响结论 */ }
}

const cleanups = []
afterEach(() => {
  while (cleanups.length) rmrf(cleanups.pop())
})

function track (base) { cleanups.push(base); return base }

/**
 * 超额组：同一平台造 n 份临时分区（字典序按尾号递增）。
 * 删除类用例必须用它 —— 新规则下组内份数 <= PROBE_LIMIT 时**一份都不该删**，
 * 用小手数的旧夹具会得到"没有删除对象"的假失败。
 */
function bigGroup (platform, n) {
  return Array.from({ length: n }, (_x, i) => 'auth-auth-' + platform + '-' + String(1000 + i))
}

describe('auth-partition-reclaim：形态识别', () => {
  it('只认每次新建的临时分区前缀', () => {
    expect(isThrowawayPartitionName('auth-auth-wechat_mp-1790418403514')).toBe(true)
    expect(isThrowawayPartitionName('auth-auth-saved-kuaishou-1790418403999')).toBe(true)
    expect(isThrowawayPartitionName('silent-auth-douyin-1790400000001')).toBe(true)
  })

  it('绝不认领账号分区/身份分区/legacy 单前缀', () => {
    // account-* 是标签页长期分区，里面是在用凭证；误判即抹号
    expect(isThrowawayPartitionName('account-18c23d34')).toBe(false)
    expect(isThrowawayPartitionName('logto-identity')).toBe(false)
    expect(isThrowawayPartitionName('rpa-kuaishou-acct1')).toBe(false)
    // legacy 形态与 auth-<真实 accountId> 同形，无法安全区分 ⇒ 一律不碰
    expect(isThrowawayPartitionName('auth-zhihu-1700000000000')).toBe(false)
    expect(isThrowawayPartitionName('auth-18c23d34')).toBe(false)
  })

  it('同组键剥掉尾部时间戳，非时间戳后缀自成一组', () => {
    expect(groupKeyOf('auth-auth-wechat_mp-1790418403514')).toBe('auth-auth-wechat_mp')
    expect(groupKeyOf('auth-auth-wechat_mp-1790343224833')).toBe('auth-auth-wechat_mp')
    // 结尾不是 -<数字> 时不得与人合批（否则会被当成同组而误删）
    expect(groupKeyOf('auth-auth-wechat_mp-manual')).toBe('auth-auth-wechat_mp-manual')
    expect(groupKeyOf('auth-auth-zhihu-1')).not.toBe(groupKeyOf('auth-auth-zhihu-manual'))
  })

  it('扫码形态 auth-auth-<平台>-<ts>-<seq> 必须与 openLogin 归到同一组（否则每次扫码自成一组、永远删不掉）', () => {
    // 只剥一段数字会让 qrcode 的三个会话都成为"本组最新"，回收面收不拢；
    // 分组粒度必须等于 listAuthPartitionCandidates 的前缀粒度（auth-auth-<平台>-）。
    expect(groupKeyOf('auth-auth-wechat_mp-1790348243918-12')).toBe('auth-auth-wechat_mp')
    expect(groupKeyOf('auth-auth-wechat_mp-1790348243918-1')).toBe('auth-auth-wechat_mp')
    expect(groupKeyOf('auth-auth-wechat_mp-1790348243918-12'))
      .toBe(groupKeyOf('auth-auth-wechat_mp-1790348243918'))
    // 三种形态必须并进**同一组**：分组若按会话形态各成一组，K+1 份里每份都是"本组最新"，
    // 删除数会是 0 —— 用超额份数正好把"分组粒度对不对"变成可执行判据。
    const six = bigGroup('wechat_mp', PROBE_LIMIT + 1)
    const mixed = six.slice(0, -1).map((n) => n + '-1')
    mixed.push(six[six.length - 1])
    const plan = planReclaim(mixed)
    expect(plan.victims).toEqual(mixed.slice(0, mixed.length - PROBE_LIMIT))
    expect(plan.kept).toEqual(mixed.slice(mixed.length - PROBE_LIMIT))
  })
})

describe('auth-partition-reclaim：分组保留判据', () => {
  it('组内份数不超过 PROBE_LIMIT ⇒ 一份都不删（#2734：定位端要按内容探这些份）', () => {
    const plan = planReclaim(Object.keys(REAL))
    expect(plan.victims).toEqual([])
    expect(plan.kept.sort()).toEqual([
      'auth-auth-wechat_mp-1790343224833',
      'auth-auth-wechat_mp-1790418403514',
      'auth-auth-zhihu-1790343393950',
      'auth-auth-zhihu-1790352605579',
      'silent-auth-douyin-1790400000001',
    ].sort())
    expect(plan.skippedActive).toEqual([])
  })

  it('超出窗口的旧目录才进 victims：K+3 份的组删掉最旧的 3 份', () => {
    const g = bigGroup('zhihu', PROBE_LIMIT + 3)
    const plan = planReclaim(g)
    expect(plan.victims).toEqual(g.slice(0, 3))
    expect(plan.kept).toEqual(g.slice(3))
  })

  it('正在使用的分区一律不列为删除对象（窗口外也豁免）', () => {
    const g = bigGroup('zhihu', PROBE_LIMIT + 3)
    const plan = planReclaim(g, [g[0]])
    expect(plan.victims).toEqual(g.slice(1, 3))
    expect(plan.skippedActive).toEqual([g[0]])
    expect(plan.kept).toContain(g[0])
  })

  it('最新那份若在使用中，同组超出窗口的旧份仍照删不误', () => {
    const g = bigGroup('zhihu', PROBE_LIMIT + 3)
    const plan = planReclaim(g, [g[g.length - 1]])
    expect(plan.skippedActive).toEqual([g[g.length - 1]])
    expect(plan.victims).toEqual(g.slice(0, 3))
  })

  it('空输入与非临时分区的组合不产出任何删除项', () => {
    expect(planReclaim([]).victims).toEqual([])
    expect(planReclaim(['account-1', 'logto-identity']).victims).toEqual([])
  })
})

describe('auth-partition-reclaim：与定位端的读取中性关系（本模块存在理由）', () => {
  // #2734 起定位端在同组内从新到旧**按内容**探，最多 PROBE_LIMIT 份。
  // 于是"读中性"的正确形状从「末位不变」变成「**整个候选集不变**」：
  // 回收保留数必须等于探测窗口，否则回收会把定位端的候选自己吃掉 —— 那正是本条要钉的耦合。
  it('回收前后 listAuthPartitionCandidates 完全相同（回收不得吃掉定位端的候选）', async () => {
    const { listAuthPartitionCandidates } = await import('./auth-partition.js')
    const g = bigGroup('zhihu', PROBE_LIMIT + 3)
    const base = track(mkProfile(g.concat(['account-18c23d34', 'logto-identity'])))
    const before = listAuthPartitionCandidates('zhihu', null, base)
    expect(before).toEqual(g.slice().reverse().slice(0, PROBE_LIMIT))

    const summary = reclaim({ userDataPath: base })
    expect(summary.removed).toEqual(g.slice(0, 3))

    expect(listAuthPartitionCandidates('zhihu', null, base)).toEqual(before)
    // 窗口内的每一份都还在盘上（"候选集不变"不能只比返回名，要比可读性）
    for (const n of before) {
      expect(fs.existsSync(path.join(base, 'session', 'Partitions', n)), n).toBe(true)
    }
  })

  it('探测窗口与保留数是同一个常量（两处各写一遍即互相吃掉候选）', async () => {
    const { PROBE_LIMIT: lookupLimit } = await import('./auth-partition.js')
    expect(lookupLimit).toBe(PROBE_LIMIT)
  })

  it('未声明标记的平台也不得被顺带删掉（回收域按前缀闭合）', () => {
    const base = track(mkProfile(['account-aaa', 'auth-zhihu-1700000000000', 'logto-identity']))
    const summary = reclaim({ userDataPath: base })
    expect(summary.removed).toEqual([])
    expect(fs.readdirSync(path.join(base, 'session', 'Partitions')).sort()).toEqual([
      'account-aaa', 'auth-zhihu-1700000000000', 'logto-identity',
    ])
  })
})

describe('auth-partition-reclaim：真实文件系统回收', () => {
  it('删目录、保留其余，并如实汇总', () => {
    const g = bigGroup('zhihu', PROBE_LIMIT + 3)
    const keep = ['account-18c23d34', 'auth-auth-wechat_mp-1790418403514', 'logto-identity']
    const names = g.concat(keep)
    const base = track(mkProfile(names))
    const summary = reclaim({ userDataPath: base })
    expect(summary.removed).toEqual(g.slice(0, 3))
    const left = fs.readdirSync(path.join(base, 'session', 'Partitions')).sort()
    expect(left).toEqual(g.slice(3).concat(keep).sort())
    expect(summary.scanned).toBe(names.length)
    expect(summary.errors).toBe(0)
  })

  it('两种历史根目录（session/Partitions 与 Partitions）都覆盖', () => {
    const rootBase = mkTmp()
    track(rootBase)
    const second = path.join(rootBase, 'Partitions')
    fs.mkdirSync(second, { recursive: true })
    const g = bigGroup('douyin', PROBE_LIMIT + 1)
    for (const n of g) fs.mkdirSync(path.join(second, n), { recursive: true })
    const summary = reclaim({ userDataPath: rootBase })
    expect(summary.removed).toEqual([g[0]])
    expect(fs.existsSync(path.join(second, g[0]))).toBe(false)
    expect(fs.existsSync(path.join(second, g[1]))).toBe(true)
  })

  it('目录不存在时静默返回，不抛不报错', () => {
    const base = track(mkTmp())
    expect(reclaim({ userDataPath: base })).toMatchObject({ scanned: 0, removed: [], errors: 0 })
  })

  it('userDataPath 缺失时不猜路径（fail closed，绝不删当前 profile）', () => {
    const log = { warn: vi.fn(), info: vi.fn(), notify: vi.fn() }
    const summary = reclaim({ app: { getPath: () => '' }, log })
    expect(summary.removed).toEqual([])
    expect(summary.errors).toBe(0)
    expect(log.notify).not.toHaveBeenCalled()
  })

  it('删除失败只计错并继续处理其余对象，函数不抛', () => {
    const g = bigGroup('zhihu', PROBE_LIMIT + 3)
    const base = track(mkProfile(g))
    const log = { warn: vi.fn(), info: vi.fn(), notify: vi.fn() }
    const boom = new Error('EBUSY: resource busy')
    const fsImpl = Object.assign(Object.create(Object.getPrototypeOf(fs)), fs, {
      rmSync (p, o) {
        if (String(p).endsWith(g[0])) throw boom
        return fs.rmSync(p, o)
      },
    })
    const summary = reclaim({ userDataPath: base, fsImpl, log })
    expect(summary.removed).toEqual(g.slice(1, 3))
    expect(summary.errors).toBe(1)
    const failCall = log.notify.mock.calls.find((c) => c[1] === 'partition-remove-failed')
    expect(failCall).toBeTruthy()
    expect((failCall[2] || {}).params.name).toContain(g[0])
  })

  it('realpath 逃出分区根的目标拒绝删除（禁止碰父目录之外的路径）', () => {
    const g = bigGroup('wechat_mp', PROBE_LIMIT + 2)
    const base = track(mkProfile(g))
    const log = { warn: vi.fn(), info: vi.fn(), notify: vi.fn() }
    const escaped = path.join(base, 'session', 'Partitions', g[0])
    const fsImpl = Object.assign(Object.create(Object.getPrototypeOf(fs)), fs, {
      realpathSync (p) {
        if (String(p) === escaped) return path.join(base, 'secret-data')
        return fs.realpathSync(p)
      },
    })
    const summary = reclaim({ userDataPath: base, fsImpl, log })
    expect(summary.removed).toEqual(g.slice(1, 2))
    expect(summary.errors).toBe(1)
    expect(fs.existsSync(escaped)).toBe(true)
    const refusedCall = log.notify.mock.calls.find((c) => c[1] === 'delete-outside-root-refused')
    expect(refusedCall).toBeTruthy()
  })

  it('有产出时留痕一行（静默回收等于没修）', () => {
    const g = bigGroup('xiaohongshu', PROBE_LIMIT + 1)
    const base = track(mkProfile(g))
    const log = { warn: vi.fn(), info: vi.fn(), notify: vi.fn() }
    reclaim({ userDataPath: base, log })
    const scannedCall = log.notify.mock.calls.find((c) => c[1] === 'reclaim-scanned')
    expect(scannedCall).toBeTruthy()
    expect((scannedCall[2] || {}).params.removed).toBe(1)
    // pinned= 是「窗口外但本进程在册」的计数：没有它，日志里的 kept 大于 K 会看起来像 bug
    expect((scannedCall[2] || {}).params.pinned).toBe(0)
  })
})

describe('auth-partition-reclaim：scheduleReclaim', () => {
  it('延迟到下一个 immediate，调用方同步期不做任何 fs 动作', async () => {
    const g = bigGroup('x', PROBE_LIMIT + 1)
    const base = mkProfile(g)
    cleanups.push(base)
    const calls = []
    const fsImpl = {
      existsSync (p) { calls.push('existsSync'); return fs.existsSync(p) },
      readdirSync (p) { return fs.readdirSync(p) },
      statSync (p) { return fs.statSync(p) },
      realpathSync (p) { return fs.realpathSync(p) },
      rmSync (p, o) { calls.push('rmSync'); return fs.rmSync(p, o) },
    }
    scheduleReclaim({ userDataPath: base, fsImpl })
    expect(calls).toEqual([])
    await new Promise(function (resolve) { setImmediate(resolve) })
    expect(calls).toContain('rmSync')
    expect(fs.existsSync(path.join(base, 'session', 'Partitions', g[0]))).toBe(false)
  })

  it('底层抛错只 warn，不外泄给调用方（回收属旁路）', async () => {
    const log = { warn: vi.fn(), info: vi.fn(), notify: vi.fn() }
    const base = mkTmp()
    cleanups.push(base)
    const fsImpl = {
      existsSync: () => true,
      readdirSync: () => { throw new Error('EACCES: permission denied') },
      statSync: () => ({ isDirectory: () => true }),
      realpathSync: (p) => p,
      rmSync: () => { throw new Error('不该走到这里') },
    }
    let threw = false
    try { scheduleReclaim({ userDataPath: base, fsImpl, log }) } catch (_e) { threw = true }
    expect(threw).toBe(false)
    expect(log.notify).not.toHaveBeenCalled()
    await new Promise(function (resolve) { setImmediate(resolve) })
    const rdFailCall = log.notify.mock.calls.find((c) => c[1] === 'partition-readdir-failed')
    expect(rdFailCall).toBeTruthy()
    expect((rdFailCall[2] || {}).error).toContain('permission denied')
  })
})

describe('auth-partition-reclaim：wipeSessionStorage', () => {
  it('清存储与清缓存各调一次并返回 true', async () => {
    const clearStorageData = vi.fn().mockResolvedValue(undefined)
    const clearCache = vi.fn().mockResolvedValue(undefined)
    const ok = await wipeSessionStorage({ clearStorageData, clearCache }, { warn: vi.fn() })
    expect(ok).toBe(true)
    expect(clearStorageData).toHaveBeenCalledTimes(1)
    expect(clearCache).toHaveBeenCalledTimes(1)
  })

  it('宿主没有 clearCache 时仍能清存储', async () => {
    const clearStorageData = vi.fn().mockResolvedValue(undefined)
    expect(await wipeSessionStorage({ clearStorageData }, { warn: vi.fn() })).toBe(true)
    expect(clearStorageData).toHaveBeenCalledTimes(1)
  })

  it('清空失败只 warn 并返回 false，不抛', async () => {
    const log = { warn: vi.fn(), notify: vi.fn() }
    const session = { clearStorageData: vi.fn().mockRejectedValue(new Error('boom')) }
    expect(await wipeSessionStorage(session, log)).toBe(false)
    const wipeFail = log.notify.mock.calls.find((c) => c[1] === 'session-wipe-failed')
    expect(wipeFail).toBeTruthy()
    expect((wipeFail[2] || {}).error).toContain('boom')
  })

  it('session 缺失/无该 API 时如实留痕并返回 false', async () => {
    const log = { warn: vi.fn(), notify: vi.fn() }
    expect(await wipeSessionStorage(null, log)).toBe(false)
    expect(await wipeSessionStorage({}, log)).toBe(false)
    expect(log.notify).toHaveBeenCalledTimes(2)
  })

  it('clearStorageData/clearCache 归属核对：必须挂在 Session 而不是 WebContents', () => {
    // 逐级上溯找 electron.d.ts（与 auth-view-manager.test.js 的宿主归属锁同口径）：
    // 本仓 node-linker=hoisted，electron 装在 worktree 根，数 `..` 会指错并退化成静默跳过。
    const path_ = require('path')
    let dir = __dirname
    let dtsPath = null
    for (let i = 0; i < 8; i += 1) {
      const cand = path_.join(dir, 'node_modules', 'electron', 'electron.d.ts')
      if (fs.existsSync(cand)) { dtsPath = cand; break }
      const parent = path_.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    expect(dtsPath, 'electron.d.ts 未找到 —— 宿主 API 归属锁禁止静默跳过').not.toBeNull()
    const dts = fs.readFileSync(dtsPath, 'utf8')
    const start = dts.indexOf('class Session extends')
    expect(start).toBeGreaterThan(-1)
    const body = dts.slice(start, dts.indexOf('\n  }', start))
    expect(body).toContain('clearStorageData(options?: ClearStorageDataOptions): Promise<void>;')
    expect(body).toContain('clearCache(): Promise<void>;')
    // 反失明：解析退化不得静默通过
    expect(body.length).toBeGreaterThan(1000)
  })
})

// 登录槽位（2026-10-21）：登录视图改为「同一平台复用同一分区」，
// 第三方登录页的 HTTP 缓存得以跨多次登录留存（头条号登录页实测 43MB 背景视频
// + 1.3MB 风控 SDK ⇒ 冷缓存时图形验证码要几秒后才弹出）。
describe('auth-partition-reclaim：登录槽位（按平台复用的稳定分区）', () => {
  it('槽位分区名按平台固定：同一平台恒定，不同平台互不相同', () => {
    expect(authLoginSlot.loginSlotAccountIdOf('toutiao')).toBe('auth-toutiao-slot')
    expect(authLoginSlot.loginSlotPartitionNameOf('toutiao')).toBe('auth-auth-toutiao-slot')
    // 同一平台两次登录必须落到同一个目录 —— 这是「缓存跨次留存」的前提
    expect(authLoginSlot.loginSlotPartitionNameOf('toutiao')).toBe(authLoginSlot.loginSlotPartitionNameOf('toutiao'))
    expect(authLoginSlot.loginSlotPartitionNameOf('toutiao')).not.toBe(authLoginSlot.loginSlotPartitionNameOf('kuaishou'))
  })

  it('平台非法时如实返回 null（不拼出脏目录名）', () => {
    expect(authLoginSlot.loginSlotAccountIdOf(null)).toBe(null)
    expect(authLoginSlot.loginSlotAccountIdOf('')).toBe(null)
    expect(authLoginSlot.loginSlotPartitionNameOf(undefined)).toBe(null)
  })

  it('槽位落在平台级前缀下 —— 发布链兜底读取端零改动即可读到它', () => {
    // auth-partition.listAuthPartitionCandidates 的前缀是 `auth-auth-<platform>-`
    const slot = authLoginSlot.loginSlotPartitionNameOf('toutiao')
    expect(slot.startsWith('auth-auth-toutiao-')).toBe(true)
    // 且它按字典序排在时间戳目录之后（数字 < 字母）⇒ 读取端「从新到旧」会先探槽位
    const legacy = 'auth-auth-toutiao-1790000000000'
    expect(slot > legacy).toBe(true)
  })

  it('槽位不是一次性分区：回收端永不把它当 victim 删掉', () => {
    const slot = authLoginSlot.loginSlotPartitionNameOf('toutiao')
    expect(authLoginSlot.isLoginSlotPartitionName(slot)).toBe(true)
    // 关键：不能进回收面。少了这条，槽位会在下次 sweep 被连目录删掉 ⇒ 缓存全丢。
    expect(isThrowawayPartitionName(slot)).toBe(false)
    const plan = planReclaim([slot, 'auth-auth-toutiao-1790000000000'], [])
    expect(plan.victims).not.toContain(slot)
    expect(plan.kept).not.toContain(slot)
  })

  it('槽位判定只认「auth-auth- 前缀 + -slot 后缀」，时间戳目录不受影响', () => {
    expect(authLoginSlot.isLoginSlotPartitionName('auth-auth-toutiao-1790000000000')).toBe(false)
    expect(authLoginSlot.isLoginSlotPartitionName('account-abc')).toBe(false)
    expect(isThrowawayPartitionName('auth-auth-toutiao-1790000000000')).toBe(true)
  })

  it('清凭证保留 HTTP 缓存：keepHttpCache 时只调 clearStorageData', async () => {
    const clearStorageData = vi.fn().mockResolvedValue(undefined)
    const clearCache = vi.fn().mockResolvedValue(undefined)
    const ok = await wipeSessionStorage({ clearStorageData, clearCache }, { warn: vi.fn() }, { keepHttpCache: true })
    expect(ok).toBe(true)
    expect(clearStorageData).toHaveBeenCalledTimes(1)
    // 缓存正是槽位存在的理由 —— 清掉等于每次登录都从零下载第三方资源
    expect(clearCache).not.toHaveBeenCalled()
  })

  it('开局清理：一律清理（不做「空槽位就跳过」——用 localStorage 存登录态的平台会漏）', async () => {
    const clearStorageData = vi.fn().mockResolvedValue(undefined)
    const clearCache = vi.fn().mockResolvedValue(undefined)
    const session = {
      clearStorageData,
      clearCache,
      cookies: { get: vi.fn().mockResolvedValue([]) }, // 一个 Cookie 都没有
    }
    const result = await authLoginSlot.wipeLoginSlotCredentials(session, { notify: vi.fn() }, {})
    expect(result.wiped).toBe(true)
    expect(clearStorageData).toHaveBeenCalledTimes(1)
    expect(clearCache).not.toHaveBeenCalled()
  })

  it('开局清理：不依赖 cookies.get（探针异常时不得跳过隔离）', async () => {
    const clearStorageData = vi.fn().mockResolvedValue(undefined)
    const clearCache = vi.fn().mockResolvedValue(undefined)
    const session = { clearStorageData, clearCache } // 压根没有 cookies.get
    const result = await authLoginSlot.wipeLoginSlotCredentials(session, { notify: vi.fn() }, {})
    expect(result.wiped).toBe(true)
    expect(clearStorageData).toHaveBeenCalledTimes(1)
  })

  it('开局清理带硬上限：清理卡死时如实返回 timeout 且不抛', async () => {
    const session = {
      clearStorageData: vi.fn(() => new Promise(() => {})),
      clearCache: vi.fn(),
      cookies: { get: vi.fn().mockResolvedValue([{ name: 'a', value: '1', domain: '.x.example' }]) },
    }
    const result = await authLoginSlot.wipeLoginSlotCredentials(session, { notify: vi.fn() }, { timeoutMs: 20 })
    expect(result.wiped).toBe(false)
    expect(result.reason).toBe('timeout')
  })

  it('开局清理失败（抛错）只留日志、不外泄给调用方（清理是旁路）', async () => {
    const log = { notify: vi.fn(), warn: vi.fn() }
    const session = {
      clearStorageData: vi.fn().mockRejectedValue(new Error('boom')),
      clearCache: vi.fn(),
      cookies: { get: vi.fn().mockResolvedValue([{ name: 'a', value: '1', domain: '.x.example' }]) },
    }
    const result = await authLoginSlot.wipeLoginSlotCredentials(session, log, {})
    expect(result.wiped).toBe(false)
    expect(log.notify).toHaveBeenCalled()
  })

  it('槽位命名与豁免必须同源：命名产出的名字必须被豁免判定认出来（防两处漂移）', () => {
    for (const platform of ['toutiao', 'wechat_mp', 'kuaishou', 'zhihu', 'bilibili']) {
      const name = authLoginSlot.loginSlotPartitionNameOf(platform)
      expect(name, platform).toBeTruthy()
      expect(authLoginSlot.isLoginSlotPartitionName(name), platform).toBe(true)
      expect(isThrowawayPartitionName(name), platform).toBe(false)
    }
  })

  it('槽位目录名必须与通用命名规则一致（auth-<accountId>）—— 两处各写一份必然漂移', () => {
    // 槽位模块自己实现了「auth-<accountId>」这条规则（它不能反向依赖本模块，否则成环），
    // 故用回环契约锁把两份实现钉在一起：本模块的 partitionNameOf 是唯一真源。
    for (const platform of ['toutiao', 'wechat_mp', 'kuaishou', 'zhihu', 'bilibili']) {
      const accountId = authLoginSlot.loginSlotAccountIdOf(platform)
      expect(authLoginSlot.loginSlotPartitionNameOf(platform), platform).toBe(partitionNameOf(accountId))
    }
  })

  it('超时预算：非法环境变量回落默认，合法值生效且封顶', () => {
    expect(authLoginSlot.resolveSlotWipeTimeoutMs({}, undefined)).toBe(1200)
    expect(authLoginSlot.resolveSlotWipeTimeoutMs({ MP_LOGIN_SLOT_WIPE_TIMEOUT_MS: 'abc' }, undefined)).toBe(1200)
    expect(authLoginSlot.resolveSlotWipeTimeoutMs({ MP_LOGIN_SLOT_WIPE_TIMEOUT_MS: '-5' }, undefined)).toBe(1200)
    expect(authLoginSlot.resolveSlotWipeTimeoutMs({ MP_LOGIN_SLOT_WIPE_TIMEOUT_MS: '1500' }, undefined)).toBe(1500)
    expect(authLoginSlot.resolveSlotWipeTimeoutMs({ MP_LOGIN_SLOT_WIPE_TIMEOUT_MS: '999999' }, undefined)).toBe(60000)
  })

  it('端到端：真实目录里铺一个槽位，回收后它必须还在（反证「槽位被 sweep 吃掉」）', () => {
    const slot = authLoginSlot.loginSlotPartitionNameOf('toutiao')
    const base = mkProfile([slot, 'auth-auth-toutiao-1790000000000', 'auth-auth-toutiao-1790000000001'])
    cleanups.push(base)
    const summary = reclaim({ userDataPath: base })
    expect(summary.removed).not.toContain(slot)
    expect(fs.existsSync(path.join(base, 'session', 'Partitions', slot))).toBe(true)
  })
})
