// @ts-check
/**
 * apps/desktop/electron/services/windows-file-lock.test.js
 *
 * Windows 独占文件锁夹具自身的回归保护。
 *
 * 背景（2026-09-26 CI 红，run 36237637566 / job 108392212464）：
 * `credential-store.test.js` 的「Windows 主密钥短暂锁释放后仍能完成格式迁移」
 * 报 `Error: Test timed out in 60000ms`。该用例的超时历史上被抬过两次
 * （71e76a5e: 10s→30s；1e22e68f: 30s→60s），仍然红 —— 因为等待本身是**无界**的，
 * 抬高超时只决定它多久之后才失败。
 *
 * 根因：握手机制按单个 stdout data 事件判定 `includes('LOCKED')`。Node 的 data 事件
 * 不代表对端 write 边界，一次 WriteLine 可能被拆成 'LOC' + 'KED'，于是永远匹配不到。
 * 同一份实现被抄成三份（credential-store / account-state-restorer /
 * api-key-manager-atomic-write），三份同病。
 */
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'

import lockHelper from '../../../../test-helpers/windows-file-lock.js'

const {
  createLockHandshake,
  holdExclusiveWindowsFileLock,
  LOCK_MARKER,
  READY_MARKER,
  DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_LOCKED_TIMEOUT_MS,
  DEFAULT_RELEASE_TIMEOUT_MS,
  PRODUCTION_HEADROOM_MS,
  LOCK_CASE_TIMEOUT_MS,
} = lockHelper

/** 造一个可控的假子进程：只暴露 helper 实际使用的接口 */
function fakeChild () {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = vi.fn()
  return child
}

/** 本节只测握手相位，持锁有效性由下面那节用真文件测，故显式关掉探针 */
const handshakeOnly = { verifyLockHeld: false }

describe('createLockHandshake — 按累计缓冲判定，跨 data 事件免疫', () => {
  it('标记被拆成多个 data 事件时仍必须判定为已锁定（本次 CI 超时的根因）', () => {
    const handshake = createLockHandshake()
    expect(handshake.feed('LOC')).toBe(false)
    expect(handshake.isLocked()).toBe(false)
    expect(handshake.feed('KED')).toBe(true)
    expect(handshake.isLocked()).toBe(true)
  })

  it('单个完整块同样判定为已锁定', () => {
    const handshake = createLockHandshake()
    expect(handshake.feed(Buffer.from(LOCK_MARKER + '\r\n'))).toBe(true)
  })

  it('锁定后不得因后续噪声回退，且保留累计原文供诊断', () => {
    const handshake = createLockHandshake()
    handshake.feed('LO')
    handshake.feed('CK')
    expect(handshake.isLocked()).toBe(false)
    expect(handshake.feed('ED ')).toBe(true)
    expect(handshake.feed('noise\r\n')).toBe(true)
    expect(handshake.text()).toContain('LOCKED')
  })

  it('标记大小写敏感：噪声 loc/lock 不得被当成已锁定', () => {
    const handshake = createLockHandshake()
    handshake.feed('loc ')
    handshake.feed('Locked ')
    handshake.feed('lock file held')
    expect(handshake.isLocked()).toBe(false)
  })
})

describe('holdExclusiveWindowsFileLock — 每段等待都要有预算且错误可诊断', () => {
  it('子进程从不输出标记时，必须在握手预算内失败并回收子进程，而不是无限挂起', async () => {
    const child = fakeChild()
    const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
      ...handshakeOnly,
      spawnImpl: () => child,
      readyTimeoutMs: 120,
    })

    await expect(pending).rejects.toThrow(/startup[\s\S]*120ms/)
    expect(child.kill).toHaveBeenCalled()
  })

  it('握手需要跨块拼接时也能完成（旧实现在此永久挂起）', async () => {
    const child = fakeChild()
    const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
      ...handshakeOnly,
      spawnImpl: () => child,
      readyTimeoutMs: 1000,
      lockedTimeoutMs: 1000,
    })
    child.stdout.emit('data', 'RE')
    child.stdout.emit('data', 'ADY\r\nLOC')
    child.stdout.emit('data', 'KED\r\n')

    await expect(Promise.race([
      pending.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('still-pending'), 120)),
    ])).resolves.toBe('resolved')
  })

  it('子进程在锁定前退出时，错误必须带上 stderr 原文', async () => {
    const child = fakeChild()
    const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
      ...handshakeOnly,
      spawnImpl: () => child,
      readyTimeoutMs: 1000,
      lockedTimeoutMs: 1000,
    })
    child.stdout.emit('data', 'READY\r\n')
    child.stderr.emit('data', 'Open : Cannot find file')
    child.emit('exit', 1)

    await expect(pending).rejects.toThrow(/before locking the file[\s\S]*Cannot find file/)
  })

  it('锁未释放时 release() 必须在预算内失败（不得让用例裸挂）', async () => {
    const child = fakeChild()
    const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
      ...handshakeOnly,
      spawnImpl: () => child,
      readyTimeoutMs: 1000,
      lockedTimeoutMs: 1000,
      releaseTimeoutMs: 120,
    })
    child.stdout.emit('data', 'READY\r\nLOCKED\r\n')
    const fileLock = await pending

    await expect(fileLock.release()).rejects.toThrow(/was not released within 120ms/)
  })

  it('无人 await exitPromise 时也不得产生 unhandledRejection', async () => {
    const onRejection = vi.fn()
    process.on('unhandledRejection', onRejection)
    try {
      const child = fakeChild()
      const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
        ...handshakeOnly,
        spawnImpl: () => child,
        readyTimeoutMs: 1000,
        lockedTimeoutMs: 1000,
      })
      child.stdout.emit('data', 'READY\r\nLOCKED\r\n')
      await pending
      // 子进程非零退出，而没有任何调用方 await 过 exitPromise
      child.emit('exit', 3)
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect(onRejection).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  it('真跑一次（仅 Windows）：握手在预算内完成，holdMs 后句柄释放', async () => {
    if (process.platform !== 'win32') return
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-win-lock-'))
    const file = path.join(dir, '.masterkey')
    fs.writeFileSync(file, 'legacy', 'utf8')
    try {
      const started = Date.now()
      const fileLock = await holdExclusiveWindowsFileLock(file, 120)
      expect(Date.now() - started).toBeLessThan(60000)
      await fileLock.release()
      expect(Date.now() - started).toBeGreaterThanOrEqual(100)
      // 句柄已 Dispose：文件内容原样可读回
      expect(fs.readFileSync(file, 'utf8')).toBe('legacy')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 90000)
})

describe('握手相位：启动与持锁必须分开计时（2026-09-27 CI 假归因的根）', () => {
  it('子进程连启动标记都没报到 ⇒ 错误点名「启动相位」，不得再说成 LOCKED 缺失', async () => {
    const child = fakeChild()
    const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
      ...handshakeOnly,
      spawnImpl: () => child,
      readyTimeoutMs: 150,
      lockedTimeoutMs: 150,
    })
    child.stdout.emit('data', 'some noise without markers\r\n')

    const message = await pending.then(() => '', (error) => String(error.message))
    // 本次 CI 的原文是 `did not report "LOCKED" within 20000ms (stdout="")`：
    // 它把「PowerShell 还没起来」和「起来后 open 卡住」压成同一句话，导致无从定责。
    expect(message).toMatch(/startup phase/i)
    expect(message).not.toMatch(/did not report "LOCKED"/)
    expect(message).toMatch(/READY/)
    expect(message).toMatch(/stdout="some noise/)
  })

  it('启动标记已到达、持锁标记迟迟不来 ⇒ 错误点名「持锁相位」并带上启动耗时', async () => {
    const child = fakeChild()
    const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
      ...handshakeOnly,
      spawnImpl: () => child,
      readyTimeoutMs: 1000,
      lockedTimeoutMs: 150,
    })
    child.stdout.emit('data', 'READY\r\n')

    const message = await pending.then(() => '', (error) => String(error.message))
    expect(message).toMatch(/lock phase|open phase/i)
    expect(message).toMatch(/150ms/)
    expect(message).toMatch(/READY observed/i)
    expect(child.kill).toHaveBeenCalled()
  })

  it('READY 先到、LOCKED 跨块后到 ⇒ 两相位按各自预算收敛，不误报超时', async () => {
    const child = fakeChild()
    const pending = holdExclusiveWindowsFileLock('D:/tmp/.masterkey', 180, {
      ...handshakeOnly,
      spawnImpl: () => child,
      readyTimeoutMs: 1000,
      lockedTimeoutMs: 1000,
    })
    child.stdout.emit('data', 'READY\r\n')
    await new Promise((resolve) => setImmediate(resolve))
    child.stdout.emit('data', 'LOCK')
    child.stdout.emit('data', 'ED\r\n')

    await expect(Promise.race([
      pending.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('still-pending'), 150)),
    ])).resolves.toBe('resolved')
  })
})

describe('持锁有效性自证：标记不等于效果（假绿的入口）', () => {
  it('子进程报了 LOCKED 但文件其实没被持有 ⇒ 必须拒绝，不得让用例对着"无锁"断言重试', async () => {
    if (process.platform !== 'win32') return
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-win-lock-fake-'))
    const file = path.join(dir, '.masterkey')
    fs.writeFileSync(file, 'legacy', 'utf8')
    try {
      // 复刻实测到的真实失效形态：PowerShell 因 param 未绑定而 [IO.File]::Open 抛异常，
      // 但默认 ErrorActionPreference=Continue 让脚本继续执行并照样打印 LOCKED。
      const child = fakeChild()
      const pending = holdExclusiveWindowsFileLock(file, 180, {
        spawnImpl: () => child,
        readyTimeoutMs: 1000,
        lockedTimeoutMs: 1000,
      })
      child.stdout.emit('data', 'READY\r\nLOCKED\r\n')

      await expect(pending).rejects.toThrow(/not actually held|lock not verified/i)
      expect(child.kill).toHaveBeenCalled()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)

  it('真跑（仅 Windows）：持锁期间的写打开必须失败，release 后必须成功（正/负双向对照）', async () => {
    if (process.platform !== 'win32') return
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-win-lock-real-'))
    const file = path.join(dir, '.masterkey')
    fs.writeFileSync(file, 'legacy', 'utf8')
    const tryWrite = () => {
      try {
        const handle = fs.openSync(file, 'r+')
        fs.closeSync(handle)
        return 'writable'
      } catch (error) {
        return String(error.code || error.message)
      }
    }
    try {
      expect(tryWrite()).toBe('writable')
      const fileLock = await holdExclusiveWindowsFileLock(file, 400)
      // 探针能过 ⇒ 夹具确实持有独占句柄；否则上面那条"标记不等于效果"的用例就是空断言
      expect(tryWrite()).not.toBe('writable')
      await fileLock.release()
      expect(tryWrite()).toBe('writable')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, 90000)

  it('探针自身要能判"没锁"：无人持锁的真人文件必须被判为可写（防探针恒真）', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    expect(typeof lockHelper.exclusiveLockIsEffective).toBe('function')
    if (process.platform !== 'win32') return
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-win-lock-probe-'))
    const file = path.join(dir, '.masterkey')
    fs.writeFileSync(file, 'x', 'utf8')
    try {
      // 没有任何持有者 ⇒ 探针必须报"未生效"。若探针被改成恒 return true，上一条
      // "标记不等于效果"的用例会假绿，而这一条会立刻红。
      expect(lockHelper.exclusiveLockIsEffective(file)).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('预算不得倒挂：helper 总预算必须小于消费用例声明的超时', () => {
  it('相位预算总和必须被 LOCK_CASE_TIMEOUT_MS 包住，且消费方只能引用该单点', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    // vitest 下 import.meta.url 不是 file: scheme，只能按候选路径找；找不到必须响，
    // 否则这条结构锁会静默退化成"没有断言"。
    const candidates = [
      path.resolve(process.cwd(), 'electron/services/credential-store.test.js'),
      path.resolve(process.cwd(), 'apps/desktop/electron/services/credential-store.test.js'),
    ]
    const found = candidates.find((candidate) => fs.existsSync(candidate))
    expect(found, '找不到消费方用例文件，结构锁失效：' + candidates.join(' / ')).toBeTruthy()
    const source = fs.readFileSync(found, 'utf8')

    const total = DEFAULT_READY_TIMEOUT_MS + DEFAULT_LOCKED_TIMEOUT_MS + DEFAULT_RELEASE_TIMEOUT_MS
    // 倒挂时框架超时先赢，诊断信息被吃掉 —— 等价于没有预算（见 AGENTS.md QM-3 第 ③ 条）
    expect(total).toBeLessThan(LOCK_CASE_TIMEOUT_MS)
    expect(PRODUCTION_HEADROOM_MS).toBeGreaterThan(0)
    // 单点口径：消费方不得自带裸数字超时，否则两处预算会各自漂移（本次 CI 红就是这么来的）
    expect(source.includes('timeout: LOCK_CASE_TIMEOUT_MS'), '消费方未引用统一超时').toBe(true)
    expect(/timeout:\s*\d+/.test(source), '消费方残留裸数字 timeout，会与夹具预算脱钩').toBe(false)
  })

  it('每个调用夹具的测试文件都必须引用 LOCK_CASE_TIMEOUT_MS（防第 4 个静默调用点）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const roots = [
      path.resolve(process.cwd(), 'electron'),
      path.resolve(process.cwd(), 'src'),
      path.resolve(process.cwd(), '../../packages/api-publish-engine/test'),
      path.resolve(process.cwd(), '../../packages/shared-utils/src'),
    ]
    const callers = []
    for (const root of roots) {
      if (!fs.existsSync(root)) continue
      for (const entry of fs.readdirSync(root, { recursive: true })) {
        const name = typeof entry === 'string' ? entry : String(entry)
        if (!/\.test\.js$/.test(name)) continue
        const full = path.join(root, name)
        let text
        try { text = fs.readFileSync(full, 'utf8') } catch (_) { continue }
        if (text.includes('holdExclusiveWindowsFileLock(')) callers.push({ full, text })
      }
    }
    // 至少要有已知的三个生产消费方；只扫到本测试文件说明扫描器退化了（退化即红，不得静默跳过）
    expect(callers.length).toBeGreaterThanOrEqual(4)
    const unwired = callers
      .filter(({ full, text }) => !full.endsWith('windows-file-lock.test.js')
        && !/timeout[^}]*LOCK_CASE_TIMEOUT_MS|LOCK_CASE_TIMEOUT_MS[^}]*timeout/.test(text))
      .map(({ full }) => path.basename(full))
    expect(unwired, '这些调用点没有引用统一超时，会把诊断留给框架超时吞掉: ' + unwired.join(', ')).toEqual([])
  })
})

describe('预算取值来源：常量必须由 CI 实测分布支撑，且留一条可复测的路径（2026-10-01）', () => {
  it('必须导出 LOCK_BUDGET_PROVENANCE，且启动预算至少是实测最大值的 safetyMultiplier 倍', () => {
    const provenance = lockHelper.LOCK_BUDGET_PROVENANCE
    expect(provenance, '缺 LOCK_BUDGET_PROVENANCE：45s 这类预算就成了无出处的数字（本仓踩过"注释里写某宿主是秒级"却未量过）').toBeTruthy()
    expect(Number.isInteger(provenance.maxObservedReadyMs) && provenance.maxObservedReadyMs > 0).toBe(true)
    // 样本量下限：只测一次就当"分布"，与当初把注释当依据是同一个错
    expect(provenance.samples).toBeGreaterThanOrEqual(50)
    expect(provenance.runs).toBeGreaterThanOrEqual(5)
    expect(provenance.safetyMultiplier).toBeGreaterThanOrEqual(2)
    expect(typeof provenance.source).toBe('string')
    expect(provenance.source.length).toBeGreaterThan(20)
    expect(DEFAULT_READY_TIMEOUT_MS).toBeGreaterThanOrEqual(provenance.maxObservedReadyMs * provenance.safetyMultiplier)
    expect(DEFAULT_READY_TIMEOUT_MS).toBeGreaterThan(provenance.maxObservedReadyMs)
  })

  it('复测入口必须落在仓库里，且其输出字段与 provenance 对齐（否则"取值来源"不可复现）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const candidates = [
      path.resolve(process.cwd(), '../../scripts/lock-timing-audit.js'),
      path.resolve(process.cwd(), 'scripts/lock-timing-audit.js'),
    ]
    const found = candidates.find((c) => fs.existsSync(c))
    expect(found, '找不到复测脚本，provenance 就成了死数字：' + candidates.join(' / ')).toBeTruthy()
    const src = fs.readFileSync(found, 'utf8')
    for (const field of Object.keys(lockHelper.LOCK_BUDGET_PROVENANCE)) {
      expect(src.includes(field), '复测脚本没有产出字段 ' + field + '，两边会静默漂移').toBe(true)
    }
    // 探针瞎掉时必须以非零码出声，而不是"0 样本 = 没问题'（AGENTS.md 观察者必须报告自己的失明）
    expect(src).toMatch(/NO_SAMPLES|exitCode = 3/)
    // 三条真实坐标坑必须留在脚本里，否则下一个人会重新踩：status 字段、代理、ANSI 转义
    expect(src).toContain("status === 'completed'")
    expect(src).toContain('--allow-escape-sequences')
    // 第四条（2026-10-01 实测）：本仓 `/actions/workflows/{wf}/runs?event=push&status=completed`
    // 会返回一个**静默截断到 2026-09-15 之前**的窗口（total_count 从 2000+ 掉到 1372），
    // 那个窗口里没有本夹具 ⇒ 复测脚本"跑得通、零样本"。所以过滤必须在客户端做。
    expect(src, '运行列表又用回了服务端 event=/status= 过滤：该组合在本仓返回陈旧截断窗口')
      .not.toMatch(/runs\?[^'"`]*(event=|status=)/)
    expect(src).toContain("r.event === 'push'")
    expect(src).toContain("r.head_branch === 'main'")
    // 且必须翻页：最近 100 条里只有约 9 条是 main push，单页会让 --runs=N 静默缩水
    expect(src, '没有翻页 ⇒ --runs=26 实际只会采到个位数 run').toMatch(/page=\$\{|page:|'&page='|page=/)
    // ── QM-6 外部评审（替代通道，2026-10-02）三条数值/出口一致性补强 ──
    // C1：脚本默认倍率与 provenance.safetyMultiplier 必须是同一个数。原结构锁只比"字段名在不在"，
    //     把脚本默认值从 2 改成 3，provenance 里的 safetyMultiplier 就成了另一套口径而锁照绿。
    const scriptMultiplier = Number(/argOf\('multiplier',\s*(\d+)\)/.exec(src)[1])
    expect(scriptMultiplier, '复测脚本的默认倍率取不到 ⇒ 判据本身坏了')
      .toBe(lockHelper.LOCK_BUDGET_PROVENANCE.safetyMultiplier)
    // I3：provenance 取不到时必须出声，不得回退成脚本里硬编码的第二份 source 文案（两份来源必然漂移）
    expect(src, '缺 provenance 却静默用默认 source = 取值来源出现双版本')
      .toMatch(/PROVENANCE_MISSING/)
    // W1：翻页触顶/样本不足但仍采到东西时，必须单独喊 PARTIAL —— rc=3 只覆盖"一条都没采到"，
    //     "采到了但只覆盖 3/26 个 run"这一档过去只在 errors 计数里，读起来像成功。
    expect(src, 'runs 少于 --runs 要求时没有独立出口，样本量偏小会被读成完整分布')
      .toMatch(/PARTIAL/)
  })

  // ── 2026-10-20：采样域与样本真伪（#68）────────────────────────────────────────
  // 动因（当场实测，4 趟已完成的 main push）：跑本夹具的作业**不止** Shards ——
  //   QG Coverage 每趟留 11 条读数、QG Desktop Shards (1/2) 7 条、(2/2) 4 条；
  //   而 ready 最大值 Coverage=17466ms 远高于 Shards 的 9650/3329ms。
  // 旧 JOB_RE 只认 Shards ⇒ 需要最大预算的那个作业**根本不在采样域里**，
  // provenance 的 max 于是系统性偏小，预算看起来"余量充足"是采样域造成的假象。
  // 第二个坑：这 44 条读数里绝大多数是**单元用例注入的假握手**（`ready=0ms locked=0ms`），
  // 因为夹具只在 `!options.spawnImpl` 时记台账，但**打印**是无条件的 ⇒
  // 只看日志的复测脚本分不清真伪，样本量下限（≥50）可以被假样本凑满。
  // 所以这两条一起修：作业名扩面 + 行里带 `mock=` 标签，且解析只有一处实现。
  it('握手行必须自带 mock 标签，且解析只有夹具里一份实现（复测脚本必须引用它）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    expect(typeof lockHelper.formatTimingLine, '缺 formatTimingLine：打印格式没有单一真源').toBe('function')
    expect(typeof lockHelper.parseTimingLine, '缺 parseTimingLine：复测脚本只能自己抄正则 ⇒ 必然漂移').toBe('function')

    const real = lockHelper.formatTimingLine({ readyMs: 2400, lockedMs: 180, verify: 'ok', holdMs: 900, mock: false })
    const fake = lockHelper.formatTimingLine({ readyMs: 0, lockedMs: 0, verify: 'off', holdMs: 180, mock: true })
    expect(real).toMatch(/mock=false/)
    expect(fake).toMatch(/mock=true/)
    expect(lockHelper.parseTimingLine(real), '真实握手必须被解出').toEqual({ readyMs: 2400, lockedMs: 180, mock: false })
    expect(lockHelper.parseTimingLine(fake), 'mock 握手不得被解成样本（否则样本量下限可被假数据凑满）')
      .toEqual({ readyMs: 0, lockedMs: 0, mock: true })
    // 无标签 = 改动之前落盘的历史日志，**不能当真实分布**，但也不能读成"一条都没打"
    const legacy = lockHelper.parseTimingLine('[windows-file-lock] ready=9999ms locked=123ms verify=ok holdMs=180')
    expect(legacy, '旧格式行必须被识别为 legacy（区分"探针坐标坏了"与"日志早于本次改动"）')
      .toEqual({ readyMs: 9999, lockedMs: 123, mock: null })
    expect(lockHelper.parseTimingLine('nothing here')).toBe(null)

    const cand = [
      path.resolve(process.cwd(), '../../scripts/lock-timing-audit.js'),
      path.resolve(process.cwd(), 'scripts/lock-timing-audit.js'),
    ].find((c) => fs.existsSync(c))
    expect(cand).toBeTruthy()
    const src = fs.readFileSync(cand, 'utf8')
    // 正向对偶必须**锚到可执行语句**：只断言"文件里出现过 parseTimingLine 这个单词"是恒真的 ——
    // 把 collectFromLog 改回自带正则时，那个单词仍留在注释/其它行里，锁照绿（变异 N4 实测命中这一洞）。
    expect(src, '复测脚本没有真的调用夹具的共享解析器（只是提到了名字）')
      .toMatch(/const mod = helper\(\);[\s\S]{0,600}mod\.parseTimingLine\(/)
    expect(src, '脚本里不得再留第二份 ready=/locked= 的解析正则（`/\\[` 与 `/[` 两种写法都要挡）')
      .not.toMatch(/SAMPLE_RE\s*=\s*\/\\?\[/)
    expect(src, '采样域必须留在脚本里且是显式作业名集合（不得退化成扫所有作业）')
      .toMatch(/QG Desktop Shards\|QG Coverage/)
  })

  it('采样域必须覆盖所有真跑该夹具的作业，并对不跑它的作业保持不匹配（A/B 负控）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const cand = [
      path.resolve(process.cwd(), '../../scripts/lock-timing-audit.js'),
      path.resolve(process.cwd(), 'scripts/lock-timing-audit.js'),
    ].find((c) => fs.existsSync(c))
    const { pathToFileURL } = await import('node:url')
    const audit = await import(pathToFileURL(cand).href)
    const { JOB_RE, collectFromLog } = audit
    // A 臂：实测确实产出读数的两个作业族必须命中
    for (const name of ['QG Desktop Shards (1/2)', 'QG Desktop Shards (2/2)', 'QG Coverage']) {
      expect(JOB_RE.test(name), '采样域漏掉真跑了夹具的作业：' + name).toBe(true)
    }
    // B 臂（负控）：不跑该夹具的作业必须不命中 —— 否则"扩面"只是把过滤写宽，
    // 采到的样本从哪来将无法归因。
    for (const name of ['QG Static', 'QG Unit Tests', 'QG Changes', 'GUI Gate Result', 'build']) {
      expect(JOB_RE.test(name), '采样域把没跑夹具的作业也算进来了：' + name).toBe(false)
    }
    // 行为面：真伪与 legacy 分档必须在同一个函数里可观测（不得靠"总数不为 0"下结论）
    const log = [
      '[windows-file-lock] ready=0ms locked=0ms verify=off holdMs=180 mock=true',
      '[windows-file-lock] ready=2400ms locked=180ms verify=ok holdMs=900 mock=false',
      '[windows-file-lock] ready=17466ms locked=140ms verify=ok holdMs=140 mock=false',
      '[windows-file-lock] ready=9999ms locked=123ms verify=ok holdMs=180',
    ].join('\n')
    const got = collectFromLog(log)
    expect(got.samples, '只有 mock=false 的两条算样本').toEqual([2400, 17466])
    expect(got.mock).toBe(1)
    expect(got.legacy, '旧格式行必须单独计数，不得混进 samples 也不得读成"零输出"').toBe(1)
    expect(got.max).toBe(17466)
    // legacy 的 max 仍要报：`ready=0ms` 的假握手只会把 max 压低不会抬高，所以"无标签行的最大值"
    // 是**可用的尾部线索**（不能当分布，但能指出该去查哪个作业）。
    expect(got.legacyMax, '无标签行必须单独报 max ⇒ 标签上线前那次复测也要给出尾部线索').toBe(9999)
    // 全 mock 的日志 = 探针没测到东西：必须与"完全没行"可区分（两者正解不同）
    const allMock = collectFromLog('[windows-file-lock] ready=0ms locked=0ms verify=off holdMs=180 mock=true')
    expect(allMock.samples).toEqual([])
    expect(allMock.mock).toBe(1)
    expect(allMock.legacy).toBe(0)
    expect(allMock.legacyMax).toBe(0)
  })

  it('LEGACY_ONLY 的出声必须逐作业点名 count 与 max，且这句话只有一份实现', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const cand = [
      path.resolve(process.cwd(), '../../scripts/lock-timing-audit.js'),
      path.resolve(process.cwd(), 'scripts/lock-timing-audit.js'),
    ].find((c) => fs.existsSync(c))
    const src = fs.readFileSync(cand, 'utf8')
    const { pathToFileURL } = await import('node:url')
    const audit = await import(pathToFileURL(cand).href)
    expect(typeof audit.formatLegacyNotice, '缺 formatLegacyNotice：零样本那句判词长在 main() 里 ⇒ 本条无法在没有网络的情况下测').toBe('function')

    const msg = audit.formatLegacyNotice({
      'QG Desktop Shards (1/2)': { count: 7, max: 9650 },
      'QG Coverage': { count: 11, max: 17466 },
    })
    expect(msg).toMatch(/LEGACY_ONLY/)
    expect(msg, '必须点名是哪个作业（否则下一个人只知道"日志旧"，不知道尾部落在谁身上）')
      .toMatch(/QG Coverage/)
    expect(msg).toMatch(/QG Desktop Shards \(1\/2\)/)
    expect(msg, '必须报出无标签行的尾部 max ⇒ 这正是"旧域排掉了最长尾"的现场来源').toMatch(/max=17466ms/)
    expect(msg).toMatch(/count=11/)
    expect(msg.replace(/[^\u4e00-\u9fff]/g, ''), '不得把"等窗口攒够"写成"没问题"')
      .toMatch(/不能当真实分布/)
    // 按 max 降序：尾部最大的那个作业必须排在前面（这是本条唯一可执行的动作指向）
    expect(msg.indexOf('QG Coverage'), '尾部最大的作业必须排在前').toBeLessThan(msg.indexOf('QG Desktop Shards'))
    // 空集合 = 真的什么都没取到，此时必须交回 NO_SAMPLES 那一档，不得造出一句假的 LEGACY_ONLY
    expect(audit.formatLegacyNotice({})).toBe('')

    // 反重复：这句话在脚本里只能出现一次（出现两次即两份事实，必然漂移）
    const mentions = src.split('LEGACY_ONLY').length - 1
    expect(mentions, 'LEGACY_ONLY 出现 ' + mentions + ' 次 ⇒ 判词被抄成多份').toBe(1)
    // 正向锚：零样本分支必须真的调用该格式化器（"文件里有个同名函数"不构成接线）
    expect(src, '零样本分支没有调用 formatLegacyNotice ⇒ 分档判词从未被打出来过')
      .toMatch(/if \(!ready\.length\)[\s\S]{0,1200}formatLegacyNotice\(/)
    // 位置锁：无标签累加必须排在 n===0 早退**之前**。标签上线前的那一整趟复测里每个作业都是 n===0，
    // 把累加放到早退之后 = 那份现场（本次改动唯一的动因证据）结构性取不到，而单测照常绿。
    expect(src, '无标签行被 n===0 的早退吃掉 ⇒ 预标签窗口的尾部线索永久丢失')
      .toMatch(/if \(got\.legacy > 0\)[\s\S]{0,400}legacyByJob\.set\([\s\S]{0,700}\r?\n *if \(n === 0\)/)
  })

  it('真跑（仅 Windows）：本次握手必须入台账，且观测值不得贴脸逼近启动预算', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    expect(typeof lockHelper.getLockTimings, '缺 getLockTimings：CI 分布回归检查没有数据来源').toBe('function')
    if (process.platform !== 'win32') {
      // 观察者必须报告自己的失明：非 Windows 上这条不测，但必须在日志里留下一句，
      // 否则"passed"会被读成"观测值与预算核对过"。
      console.log('[windows-file-lock] live-timing-check SKIPPED platform=' + process.platform)
      return
    }
    const before = lockHelper.getLockTimings().length
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-win-lock-timing-'))
    const file = path.join(dir, '.masterkey')
    fs.writeFileSync(file, 'x', 'utf8')
    try {
      const handle = await holdExclusiveWindowsFileLock(file, 250)
      await handle.release()
      const timings = lockHelper.getLockTimings()
      // 空台账 = 这条检查什么都没测；必须在断言之前先证明它有样本
      expect(timings.length, '握手没有入账，本条检查会退化成恒真').toBeGreaterThan(before)
      const last = timings[timings.length - 1]
      // readyMs 为 0 只有两种可能：假子进程混进了台账，或时钟不动。两者都意味着这条
      // "观测值 vs 预算"的比较在测量一个不存在的东西 —— 所以先证样本是真的。
      expect(last.readyMs, 'readyMs=0 ⇒ 台账里混进了 mock 样本，本条检查已失去意义').toBeGreaterThan(0)
      expect(Number.isFinite(last.readyMs)).toBe(true)
      // 贴脸判据：观测启动相位一旦吃掉预算的 90%，就说明该重测并抬预算，而不是等它挂
      expect(last.readyMs, '观测 readyMs 贴脸逼近启动预算 ⇒ 该重测并抬预算，不是放宽断言（AGENTS.md QM-3 两条正解）')
        .toBeLessThan(DEFAULT_READY_TIMEOUT_MS * 0.9)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }, LOCK_CASE_TIMEOUT_MS)
})
