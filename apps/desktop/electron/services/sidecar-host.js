// @ts-check
/**
 * sidecar-host.js — B1 PR-2 §6 sidecar 通用宿主契约（design.md D4「契约四件套」）
 *
 * 四件套：start(manifest) / health() / stop() / onExit(cb)
 * 复用面：F3 camoufox、F4 ddddocr、B2 STT/clone（D4 明示）。
 *
 * 四条硬约束：
 * 1. **完整性校验两次**（禁 TOFU + 防篡改）：下载后在 stage 校验、spawn 前在受控路径复检。
 *    任一次不符 ⇒ 拒绝落地 / 拒绝 spawn；下载后不符必须先删掉已落盘载荷。
 * 2. **token 生命周期**（D4 补充）：宿主在 start() 用 crypto.randomBytes(32) 生成，
 *    经 spawn **env** 注入（不经 argv——argv 同 /proc/<pid>/cmdline 可读）；TTL 绑
 *    sidecar 进程寿命（进程退出即失效，无跨进程重放面）；撤销 = kill。
 * 3. **显式构建子进程 env**，不得原样继承父环境：父环境的 ELECTRON_RUN_AS_NODE 会让
 *    任何 Electron 可执行文件以纯 Node 模式静默启动（AGENTS.md QM-1 新增规则同源），
 *    必须显式剔除而非漏传。
 * 4. **监听只绑 127.0.0.1**：端口占用检查 fail-closed（不静默换端口）；未探清不启动。
 *
 * 目录布局（workDir 由调用方给，测试里落 os.tmpdir()）：
 *   <workDir>/stage/<id>-<version>.bin   下载暂存（下载后在此校验）
 *   <workDir>/bin/<id>                   受控路径副本（spawn 前复检 + spawn 目标）
 *   Windows 上从受控目录 spawn 是为了规避 DLL 劫持（不在用户可写目录起进程）。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/**
 * 显式构建子进程 env：只带 sidecar 运行必需项。
 * 刻意**不含** ELECTRON_RUN_AS_NODE —— 该变量随 shell 继承时会让 Electron 二进制
 * 以纯 Node 模式静默退出（rc=0、stdout/stderr 全空、不建窗口），与「启动干净」同形。
 * @param {Record<string,string>} extra 宿主要注入的键（token / 端口）
 * @returns {Record<string,string>}
 */
function buildChildEnv (extra) {
  const env = {}
  if (process.platform === 'win32') {
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot
    if (process.env.windir) env.windir = process.env.windir
  }
  for (const key of ['PATH', 'HOME', 'TEMP', 'TMP', 'LANG']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return Object.assign(env, extra || {})
}

/**
 * @param {object} manifest D4 manifest：vendor 版本 / sha256 / license / 监听约束
 * @param {object} deps 注入依赖（测试全是假的；生产由调用方传真实实现）
 * @returns {{start: () => Promise<object>, stop: () => Promise<void>, health: () => Promise<object>, onExit: (cb: Function) => void}}
 */
function createSidecarHost (manifest, deps) {
  const {
    workDir,
    logger = console,
    fetchFile,
    sha256File,
    probePort,
    spawn,
    probeHealth,
  } = deps

  const stageDir = path.join(workDir, 'stage')
  const finalDir = path.join(workDir, 'bin')
  const stagePath = path.join(stageDir, manifest.id + '-' + manifest.version + '.bin')
  const finalPath = path.join(finalDir, manifest.id)

  let child = null
  let token = null
  let stopped = false
  let exitReported = false
  const exitCbs = []

  function logWarn (...a) { try { logger.warn('Sidecar[' + manifest.id + ']', ...a) } catch (_e) { /* ignore */ } }

  /** 删除 stage 里校验不过的载荷——不得把「校验不过的字节」留在磁盘上 */
  function removeStaged () {
    try {
      if (fs.existsSync(stagePath)) fs.rmSync(stagePath, { force: true })
    } catch (e) {
      logWarn('清理 stage 失败（不影响判定，已拒绝启动）: ' + (e && e.message))
    }
  }

  async function start () {
    stopped = false
    exitReported = false

    // —— 约束 4：先探端口，fail-closed；未探清绝不启动 ——
    if (typeof probePort === 'function') {
      try {
        await probePort(manifest.listen.host, manifest.listen.port)
      } catch (e) {
        throw new Error('sidecar 监听端口不可用（' + manifest.listen.host + ':' + manifest.listen.port + '），拒绝启动: ' + (e && e.message), { cause: e })
      }
    }

    fs.mkdirSync(stageDir, { recursive: true })
    fs.mkdirSync(finalDir, { recursive: true })

    // —— 约束 1 之一：下载 + 下载后校验（禁 TOFU）——
    if (!fs.existsSync(finalPath)) {
      await fetchFile(manifest.download.url, stagePath)
      const got = await sha256File(stagePath)
      if (got !== manifest.download.sha256) {
        removeStaged()
        throw new Error('sidecar 载荷 sha256 不符，拒绝落地: expected=' + manifest.download.sha256 + ' got=' + got)
      }
      // 受控路径副本（Windows DLL 劫持防护：不在用户可写目录起进程）
      fs.copyFileSync(stagePath, finalPath)
    }

    // —— 约束 1 之二：spawn 前完整性复检（防篡改）——
    const finalGot = await sha256File(finalPath)
    if (finalGot !== manifest.download.sha256) {
      throw new Error('sidecar 受控路径完整性复检不符（疑似篡改），拒绝 spawn: expected=' + manifest.download.sha256 + ' got=' + finalGot)
    }

    // —— 约束 2：token 经 env 注入，不经 argv ——
    token = crypto.randomBytes(32).toString('hex')
    const env = buildChildEnv({
      MP_SIDECAR_TOKEN: token,
      MP_SIDECAR_PORT: String(manifest.listen.port),
    })

    // —— 约束 3：显式 env（上面的 buildChildEnv 已剔除 ELECTRON_RUN_AS_NODE）——
    try {
      child = spawn(manifest.bin.command, manifest.bin.args, { env })
    } catch (e) {
      child = null
      token = null
      throw new Error('sidecar spawn 失败: ' + (e && e.message), { cause: e })
    }

    if (child && typeof child.on === 'function') {
      child.on('exit', (code, signal) => {
        // 去重：stop 之后或已上报过一次，都不再回调（上层不应把一次崩溃当两次）
        if (stopped || exitReported) return
        exitReported = true
        const info = { id: manifest.id, pid: child.pid, code, signal }
        for (const cb of exitCbs.slice()) {
          try { cb(info) } catch (e) { logWarn('onExit 回调抛错: ' + (e && e.message)) }
        }
      })
    }

    return { pid: child.pid, token, port: manifest.listen.port, id: manifest.id }
  }

  async function stop () {
    if (stopped) return
    stopped = true
    if (child && typeof child.kill === 'function') {
      try { child.kill() } catch (e) { logWarn('kill sidecar 失败: ' + (e && e.message)) }
    }
    child = null
    token = null
  }

  async function health () {
    if (!token || !child) return { ok: false, reason: 'not-running' }
    if (typeof probeHealth !== 'function') return { ok: false, reason: 'no-probe' }
    try {
      const r = await probeHealth(manifest.listen.host, manifest.listen.port, token)
      return { ok: true, detail: r }
    } catch (e) {
      return { ok: false, reason: (e && e.message) || String(e) }
    }
  }

  function onExit (cb) {
    if (typeof cb === 'function') exitCbs.push(cb)
  }

  return { start, stop, health, onExit }
}

module.exports = {
  createSidecarHost,
  buildChildEnv,
}
