// @ts-check
/**
 * sidecar-host.test.js — B1 PR-2 §6 sidecar-host 五态契约锁（tasks 6.2 + design.md D4）
 *
 * 判据来源：
 * - tasks.md 6.1：start(manifest)/health()/stop()/onExit；下载后 sha256 强制校验（拒落地）
 *   + spawn 前完整性复检；Windows 受控路径复制后 spawn
 * - tasks.md 6.2：RED 五态 = spawn 失败 / 端口冲突 / 异常退出清理 / sha256 不符拒落地 /
 *   篡改拒 spawn
 * - design.md D4：token 由宿主 crypto.randomBytes(32) 生成、经 spawn **env** 注入（不经
 *   argv——argv 同 /proc/<pid>/cmdline 可读）；TTL 绑 sidecar 进程寿命；撤销 = kill。
 * - design.md D4：完整性校验两次（下载后 + spawn 前）——「禁 TOFU + 防篡改」。
 *
 * 测试纪律：不真实出网（fetchFile 注入）、不真实 spawn（spawn 注入）、不真实起端口
 * （probePort 注入）；可写状态一律 os.tmpdir() + PID，不得固定仓库内共享文件。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const { createSidecarHost } = require('./sidecar-host')

const GOOD_SHA = 'a'.repeat(64)
const BAD_SHA = 'b'.repeat(64)

function makeWorkDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mp-sidecar-' + process.pid + '-'))
}

function makeManifest (over = {}) {
  return Object.assign({
    id: 'ddddocr',
    vendor: 'ddddocr',
    version: '1.5.5',
    license: 'MIT',
    listen: { host: '127.0.0.1', port: 0 },
    download: { url: 'https://example.invalid/ddddocr.bin', sha256: GOOD_SHA },
    bin: { command: 'python', args: ['-m', 'ddddocr.api.server'] },
  }, over)
}

/**
 * 默认注入依赖。sha256File 按**调用次序**返回：第 1 次（stage，下载后校验）返回正确值，
 * 第 2 次（final，spawn 前复检）返回错误值 —— 让「两次校验」的次序成为可判定判据。
 */
function makeDeps (workDir, over = {}) {
  const calls = { spawn: [], fetch: [], killed: [], removed: [], logs: [], sha: [] }
  const deps = {
    workDir,
    logger: {
      warn: (...a) => calls.logs.push(['warn', ...a]),
      info: (...a) => calls.logs.push(['info', ...a]),
    },
    fetchFile: async (url, dest) => { calls.fetch.push({ url, dest }); fs.writeFileSync(dest, 'payload') },
    sha256File: async (p) => { calls.sha.push(p); return GOOD_SHA },
    probePort: async () => ({ ok: true }),
    spawn: (command, args, opts) => {
      calls.spawn.push({ command, args, opts })
      return {
        pid: 4242,
        killed: false,
        on: () => {},
        kill () { this.killed = true; calls.killed.push(this.pid) },
      }
    },
  }
  return { deps: Object.assign(deps, over.deps || {}), calls }
}

describe('sidecar-host — 五态契约（tasks 6.2，D4）', () => {
  let workDir
  beforeEach(() => { workDir = makeWorkDir() })
  afterEach(() => {
    try { fs.rmSync(workDir, { recursive: true, force: true }) } catch (_e) { /* ignore */ }
  })

  it('① sha256 不符拒落地：下载后校验失败必须删除已落盘文件并抛错', async () => {
    const { deps, calls } = makeDeps(workDir, { deps: { sha256File: async () => BAD_SHA } })
    const host = createSidecarHost(makeManifest(), deps)

    await expect(host.start()).rejects.toThrow(/sha256/i)
    // 「校验不过的载荷」不得留在磁盘上
    const stageDir = path.join(workDir, 'stage')
    const leftover = fs.existsSync(stageDir) ? fs.readdirSync(stageDir) : []
    expect(leftover).toEqual([])
    // 绝不进入 spawn
    expect(calls.spawn).toEqual([])
  })

  it('② 篡改拒 spawn：spawn 前复检失败必须拒绝启动（D4 两次校验之二）', async () => {
    // 本地计数器构造「仅第二次校验失败」：第 1 次（stage，下载后校验）通过，
    // 第 2 次（final，spawn 前复检）失败 —— 只有 spawn 前复检这一道能拦住。
    let checks = 0
    const { deps, calls } = makeDeps(workDir, {
      deps: { sha256File: async () => { checks++; return checks === 1 ? GOOD_SHA : BAD_SHA } },
    })
    const host = createSidecarHost(makeManifest(), deps)

    await expect(host.start()).rejects.toThrow(/sha256|篡改/i)
    expect(calls.spawn).toEqual([])
    // 必须真做过两次校验（只校验一次则本态无从触发）
    expect(checks).toBe(2)
  })

  it('③ spawn 失败：spawner 抛错必须 surfaced，且不留半启动状态', async () => {
    const { deps, calls } = makeDeps(workDir, {
      deps: { spawn: () => { throw new Error('spawn ENOENT') } },
    })
    const host = createSidecarHost(makeManifest(), deps)
    await expect(host.start()).rejects.toThrow(/spawn/i)
    // 没有子进程句柄可泄漏：stop 幂等且不抛
    await expect(host.stop()).resolves.toBeUndefined()
    expect(calls.killed).toEqual([])
  })

  it('④ 端口冲突：listen 端口已被占用必须 fail-closed 报错，不得静默换端口', async () => {
    const { deps, calls } = makeDeps(workDir, {
      deps: { probePort: async () => { throw new Error('listen EADDRINUSE') } },
    })
    const host = createSidecarHost(makeManifest(), deps)

    await expect(host.start()).rejects.toThrow(/EADDRINUSE|端口/i)
    // 端口没探清楚就绝不启动进程
    expect(calls.spawn).toEqual([])
    expect(calls.fetch).toEqual([])
  })

  it('⑤ 异常退出清理：sidecar 非正常退出必须走 onExit，且 stop 后不得重复回调', async () => {
    const exitHandlers = []
    const { deps } = makeDeps(workDir, {
      deps: {
        spawn: () => ({
          pid: 4343,
          killed: false,
          on (ev, cb) { if (ev === 'exit') exitHandlers.push(cb) },
          kill () { this.killed = true },
        }),
      },
    })
    const host = createSidecarHost(makeManifest(), deps)
    await host.start()

    const seen = []
    host.onExit((info) => seen.push(info))

    // 异常退出（code !== 0）必须上报
    exitHandlers.forEach((cb) => cb(1, null))
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ pid: 4343, code: 1 })

    // 重复回调必须被去重：上层不应把一次崩溃当两次
    exitHandlers.forEach((cb) => cb(1, null))
    expect(seen).toHaveLength(1)
  })

  it('token 经 env 注入、不经 argv（D4：argv 同 /proc/<pid>/cmdline 可读）', async () => {
    const { deps, calls } = makeDeps(workDir)
    const host = createSidecarHost(makeManifest(), deps)
    await host.start()

    const spawnCall = calls.spawn[0]
    expect(spawnCall).toBeDefined()
    expect(spawnCall.opts.env.MP_SIDECAR_TOKEN).toMatch(/^[0-9a-f]{64}$/)
    // argv 里绝不得出现 token
    expect(JSON.stringify(spawnCall.args)).not.toMatch(/[0-9a-f]{64}/)
  })

  it('显式构建子进程 env：不得原样继承父环境（新 AGENTS.md QM-1 同源纪律）', async () => {
    const { deps, calls } = makeDeps(workDir)
    const prev = process.env.ELECTRON_RUN_AS_NODE
    process.env.ELECTRON_RUN_AS_NODE = '1'
    try {
      const host = createSidecarHost(makeManifest(), deps)
      await host.start()
      expect(calls.spawn[0].opts.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.ELECTRON_RUN_AS_NODE
      else process.env.ELECTRON_RUN_AS_NODE = prev
    }
  })

  it('happy path：start 返回 pid/port/token 且完成了两次 sha256 校验', async () => {
    // 默认 mock 恒返回正确值 ⇒ 允许启动；且它会记录每次校验的路径到 calls.sha
    const { deps, calls } = makeDeps(workDir)
    const host = createSidecarHost(makeManifest(), deps)
    const info = await host.start()

    expect(info.pid).toBe(4242)
    expect(info.token).toMatch(/^[0-9a-f]{64}$/)
    expect(calls.spawn).toHaveLength(1)
    // D4「两次校验」：下载后 + spawn 前，且对象不同（stage 与 final）
    expect(calls.sha).toHaveLength(2)
    expect(calls.sha[0]).not.toBe(calls.sha[1])
  })
})
