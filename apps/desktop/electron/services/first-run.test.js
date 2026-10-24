/**
 * first-run —— 首启判定只能由用户动作完成（UX 审计 1.4，ux-audit-first-run-launch）
 *
 * 修前的真实形态：`runSetup()` 在窗口创建路径上无条件写 `first-run-done` 并广播 done，
 * 于是 `/first-run` 向导对所有新用户永久不可达（P2-E 移除浏览器检查后遗留的自动收口）。
 * 本文件把"标记只能由显式动作写入"钉成契约，并锁住新增 IPC 通道的三处配对
 * （handler 注册 / 授权白名单 / preload 导出）—— 少任一处的症状是"点了没反应且没有错误"。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TMP_USER_DATA = path.join(os.tmpdir(), `mp-first-run-test-${process.pid}-${Math.floor(Math.random() * 1e6)}`)

// 本仓的 electron 拦截是**共享单例**（test-setup.js 的 Module._load 在 electronMockEnabled 时
// 直接返回 __electronMock，注册同名 mock 不会生效），所以这里改它的 getPath 并在结束后还原。
// logger 走 __registerMock（按 resolved 路径段匹配），不用 vi.mock —— 被测模块是 CJS require。
__enableElectronMock()
const logMock = { info: () => {}, warn: () => {}, error: () => {} }
const realAppPath = __electronMock.app.getPath
const calls = { info: [], warn: [], error: [] }
logMock.info = (...a) => calls.info.push(a)
logMock.warn = (...a) => calls.warn.push(a)
logMock.error = (...a) => calls.error.push(a)
__registerMock('./logger', logMock)

function freshWin () {
  const sent = []
  return { sent, webContents: { send: (channel, payload) => { sent.push([channel, payload]) } } }
}

describe('first-run 服务', () => {
  let firstRun

  beforeEach(async () => {
    vi.resetModules()
    __electronMock.app.getPath = () => TMP_USER_DATA
    fs.rmSync(TMP_USER_DATA, { recursive: true, force: true })
    fs.mkdirSync(TMP_USER_DATA, { recursive: true })
    calls.info.length = 0; calls.warn.length = 0; calls.error.length = 0
    firstRun = await import('./first-run.js')
  })

  afterEach(() => {
    fs.rmSync(TMP_USER_DATA, { recursive: true, force: true })
  })

  afterAll(() => {
    __electronMock.app.getPath = realAppPath
  })

  it('无标记时 runSetup 不得写 first-run-done（自动收口就是本批要修的缺陷）', async () => {
    const win = freshWin()
    await firstRun.runSetup(win)
    expect(fs.existsSync(path.join(TMP_USER_DATA, 'first-run-done')), '主进程不得替用户完成首启').toBe(false)
  })

  it('无标记时广播 needed，让渲染端决定导航（不是靠推送抢先到达）', async () => {
    const win = freshWin()
    await firstRun.runSetup(win)
    expect(win.sent).toEqual([['first-run:status', { type: 'needed' }]])
  })

  it('已有标记时广播 done 且既不写盘也不重复写', async () => {
    const marker = path.join(TMP_USER_DATA, 'first-run-done')
    fs.writeFileSync(marker, 'done:manual')
    const win = freshWin()
    await firstRun.runSetup(win)
    expect(win.sent).toEqual([['first-run:status', { type: 'done' }]])
    expect(fs.readFileSync(marker, 'utf8')).toBe('done:manual')
  })

  it('markDone 是唯一写者，且重复调用幂等（不追加、不抛错）', async () => {
    expect(firstRun.markDone).toBeTypeOf('function')
    expect(firstRun.markDone()).toMatchObject({ ok: true })
    const marker = path.join(TMP_USER_DATA, 'first-run-done')
    const first = fs.readFileSync(marker, 'utf8')
    expect(first).toContain('done:')
    expect(firstRun.markDone()).toMatchObject({ ok: true })
    expect(fs.readFileSync(marker, 'utf8')).toBe(first)
  })

  it('markDone 写盘失败必须返回失败并留日志，不得把半成功报成成功', async () => {
    const realWrite = fs.writeFileSync
    fs.writeFileSync = () => { throw new Error('EROFS: read-only file system') }
    try {
      const res = firstRun.markDone()
      expect(res.ok).toBe(false)
      expect(res.message).toContain('EROFS')
      expect(calls.error.length, "写盘失败必须出声").toBeGreaterThan(0)
      expect(fs.existsSync(path.join(TMP_USER_DATA, 'first-run-done'))).toBe(false)
    } finally {
      fs.writeFileSync = realWrite
    }
  })

  // QM-6 i10：标记落盘必须是原子替换 —— isSetupDone() 只看 existsSync，所以「半写/0 字节的
  // 最终名文件」会被读成已完成，向导永久消失且日志零痕迹（与本批要修的自动收口同形，换了成因）。
  it('markDone 落盘后最终名内容完整且不留临时名 residue', async () => {
    // 这条是 i10 的**判别式**：写入落点必须是临时名。只断言"最终名内容完整"对
    // "直接 writeFileSync(最终名)"完全免疫（那份内容同样是完整的），反证会 MISSED。
    const targets = []
    const realWrite = fs.writeFileSync
    fs.writeFileSync = (...args) => {
      targets.push(String(args[0]))
      return realWrite.apply(fs, args)
    }
    let res
    try {
      res = firstRun.markDone()
    } finally {
      fs.writeFileSync = realWrite
    }
    expect(res).toMatchObject({ ok: true })
    expect(targets.length, '至少要真的写过一次').toBeGreaterThan(0)
    expect(targets.some((t) => /first-run-done$/.test(t)),
      '最终名不得被直接写：' + targets.join(', ')).toBe(false)
    const marker = path.join(TMP_USER_DATA, 'first-run-done')
    expect(fs.readFileSync(marker, 'utf8'), '最终名必须是全量内容').toMatch(/^done:2\d{3}-/)
    const residue = fs.readdirSync(TMP_USER_DATA).filter((n) => n.startsWith('first-run-done.tmp-'))
    expect(residue, '不得留下临时名文件：' + residue.join(',')).toEqual([])
  })

  it('markDone 遇到并发写者已落成最终名时如实报 reused，不得冒报本次写入', async () => {
    const marker = path.join(TMP_USER_DATA, 'first-run-done')
    const realWrite = fs.writeFileSync
    // 真实文件系统制造竞态：在临时名写完后、rename 之前，把最终名让给另一个写者。
    // Windows 下真实 rename 会因此抛错，POSIX 下会覆盖成功 —— 两种平台形态都必须落到
    // 同一条不变式：ok 为真、最终名存在且内容是完整的、没有临时名残留。
    fs.writeFileSync = (...args) => {
      const out = realWrite.apply(fs, args)
      if (String(args[0]).includes('.tmp-')) realWrite(marker, 'done:other-writer')
      return out
    }
    try {
      const res = firstRun.markDone()
      expect(res.ok, '并发落成不是失败：' + JSON.stringify(res)).toBe(true)
      expect(fs.existsSync(marker)).toBe(true)
      expect(fs.readFileSync(marker, 'utf8'), '最终名不得是半写状态').toMatch(/^done:/)
      const residue = fs.readdirSync(TMP_USER_DATA).filter((n) => n.startsWith('first-run-done.tmp-'))
      expect(residue, 'rename 失败分支必须清掉临时名：' + residue.join(',')).toEqual([])
    } finally {
      fs.writeFileSync = realWrite
    }
  })

  it('markDone 的 rename 失败且最终名不在场时必须原样进失败处理，不得留下半状态', async () => {
    const realRename = fs.renameSync
    fs.renameSync = () => { throw new Error('EXDEV: cross-device link not permitted') }
    try {
      const res = firstRun.markDone()
      expect(res.ok).toBe(false)
      expect(res.message).toContain('EXDEV')
      expect(fs.existsSync(path.join(TMP_USER_DATA, 'first-run-done'))).toBe(false)
      const residue = fs.readdirSync(TMP_USER_DATA).filter((n) => n.startsWith('first-run-done.tmp-'))
      expect(residue, '失败路径不得留临时名：' + residue.join(',')).toEqual([])
      expect(calls.error.length, '失败必须出声').toBeGreaterThan(0)
    } finally {
      fs.renameSync = realRename
    }
  })

  it('checkDeps 如实反映标记在场与否', async () => {
    expect(firstRun.checkDeps()).toEqual({ setupDone: false })
    firstRun.markDone()
    expect(firstRun.checkDeps()).toEqual({ setupDone: true })
  })

  it('reset 撤掉标记（排障出口仍在，且不会被"自动收口"悄悄盖回来）', async () => {
    firstRun.markDone()
    firstRun.reset()
    expect(firstRun.checkDeps()).toEqual({ setupDone: false })
  })
})

describe('first-run:complete 通道的三处配对（缺一即"点了没反应且无错误"）', () => {
  // 不用 __dirname：本文件是 ESM，__dirname 未定义时 path.resolve 会抛或得到错根，
  // 而"读不到文件"在 fs.readFileSync 下是抛错、在有些夹具里会被读成通过 ⇒ 一律用 import.meta.url 上溯。
  const HERE = path.dirname(fileURLToPath(import.meta.url))
  const DESKTOP = path.resolve(HERE, '..', '..')

  it('ipc handler 必须注册该通道', () => {
    const src = fs.readFileSync(path.join(DESKTOP, 'electron', 'ipc-handlers', 'misc.js'), 'utf8')
    expect(src).toContain("ipcMain.handle('first-run:complete'")
  })

  it('授权白名单必须登记该通道', () => {
    const src = fs.readFileSync(path.join(DESKTOP, 'electron', 'ipc-handlers', 'license-access-control.js'), 'utf8')
    expect(src, "未登记 PUBLIC_CHANNELS ⇒ 未授权用户点「完成」被静默挡掉").toContain("'first-run:complete'")
  })

  it('preload 必须导出对应方法，且访问控制清单同步', () => {
    const sys = fs.readFileSync(path.join(DESKTOP, 'electron', 'preload', 'system.js'), 'utf8')
    expect(sys).toContain("invoke('first-run:complete')")
    const acl = fs.readFileSync(path.join(DESKTOP, 'electron', 'preload', 'access-control.js'), 'utf8')
    expect(acl, 'preload 导出名未进 access-control 清单 ⇒ sandbox 侧可能拿不到').toContain('firstRunComplete')
  })
})

/**
 * QM-6 第二轮 i2：读侧只看 `fs.existsSync(最终名)` 对**已经存在**的坏标记完全免疫。
 *
 * i10 的临时名 + rename 只保证「今后」产出的标记是全量的；旧实现直写最终名在产线机器上
 * （进程被杀 / 杀软占用）留下的 0 字节或半写文件，以及任何第三方写入，都被 `existsSync`
 * 读成「已完成」⇒ 向导对那批老用户永久消失、日志零痕迹 —— 症状与本 PR 要修的自动收口同形，
 * 只是换了成因。开通自动落标记后新用户行为改变、存量 profile 携带旧写法标记，
 * 这个迁移面必须由读侧接住，而不是"下次写对了就好了"。
 */
describe('first-run 服务 —— 坏标记的读侧判据与修复（QM-6 二轮 i2）', () => {
  let firstRun

  beforeEach(async () => {
    vi.resetModules()
    __electronMock.app.getPath = () => TMP_USER_DATA
    fs.rmSync(TMP_USER_DATA, { recursive: true, force: true })
    fs.mkdirSync(TMP_USER_DATA, { recursive: true })
    calls.info.length = 0; calls.warn.length = 0; calls.error.length = 0
    firstRun = await import('./first-run.js')
  })

  afterEach(() => {
    fs.rmSync(TMP_USER_DATA, { recursive: true, force: true })
  })

  const marker = () => path.join(TMP_USER_DATA, 'first-run-done')

  it('0 字节标记（旧直写形态被中途打断的产物）不得读成已完成，且必须出声', () => {
    fs.writeFileSync(marker(), '')
    expect(firstRun.isSetupDone(), '空文件不是"已完成"的证据').toBe(false)
    expect(calls.warn.map((a) => a.join(' ')).join('\n'), '坏标记必须留下可归因的日志').toMatch(/unreadable/)
  })

  it('内容不是 done: 前缀的标记一律判 pending（不靠"看起来像"猜）', () => {
    for (const body of ['garbage', 'true', '{}', 'done', '\r\n']) {
      fs.rmSync(marker(), { force: true })
      fs.writeFileSync(marker(), body)
      expect(firstRun.isSetupDone(), `内容=${JSON.stringify(body)} 时不得判已完成`).toBe(false)
    }
    fs.rmSync(marker(), { force: true })
    fs.writeFileSync(marker(), 'done:2026-10-24T00:00:00.000Z')
    expect(firstRun.isSetupDone(), '正控：合法内容必须判已完成（否则上面四条是恒真）').toBe(true)
  })

  it('runSetup 遇到坏标记必须广播 needed（而不是替用户把向导永久关掉）', async () => {
    fs.writeFileSync(marker(), '')
    const win = { sent: [], webContents: { send: (c, p) => { win.sent.push([c, p]) } } }
    await firstRun.runSetup(win)
    expect(win.sent.some(([c, p]) => c === 'first-run:status' && p && p.type === 'needed'),
      `实际广播: ${JSON.stringify(win.sent)}`).toBe(true)
  })

  it('点「完成」必须能把坏标记原子重写，且如实报 repaired（不得复用"已有所以幂等"那一支）', () => {
    fs.writeFileSync(marker(), '')
    const r = firstRun.markDone()
    expect(r.ok).toBe(true)
    expect(r.reused, '坏标记不算"已有有效标记"，不得报 reused:true').toBe(false)
    expect(r.repaired).toBe(true)
    expect(firstRun.isSetupDone(), '重写后必须真的读得出已完成').toBe(true)
    expect(fs.readFileSync(marker(), 'utf8')).toMatch(/^done:/)
  })

  it('有效标记仍在时保持幂等：不重写内容、reused:true、repaired 不为真', () => {
    const body = 'done:2026-01-01T00:00:00.000Z'
    fs.writeFileSync(marker(), body)
    const r = firstRun.markDone()
    expect(r).toMatchObject({ ok: true, reused: true })
    expect(r.repaired, '幂等路径不得谎报修复').toBeFalsy()
    expect(fs.readFileSync(marker(), 'utf8'), '已有内容必须原样保留').toBe(body)
  })
})
