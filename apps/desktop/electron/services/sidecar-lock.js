// @ts-check
/**
 * sidecar-lock.js — apps/desktop/sidecar-lock.json 的校验器（tasks 6.3）
 *
 * 为什么需要校验器而不只是一份 JSON：lock 的风险不在「缺字段」而在「看起来填好了」。
 * 三条机械判据：
 * 1. **结构 + hash 形态**：每个 asset 必须有 name/size/sha256，sha256 必须是 64 位十六进制。
 *    形态不对的 hash 比没有 hash 更危险——它会让下游的 sha256 比对恒不匹配（或恒匹配空串）。
 * 2. **pending fail-closed**：status=pending 的组件不得被 sidecar-host 启动。
 *    ddddocr 的 requirements 钉版本与 4 个 onnx 权重 hash 尚未取证，留洞比留假 hash 安全。
 * 3. **两路交叉一致**：components.camoufox.bundledRelease 必须与 sources.camoufoxRelease.tag
 *    （去掉 v 前缀）一致，且每个 asset 名必须以 camoufox-<bundledRelease>- 开头。
 *    这条锁的是「npm wrapper 的 pin」与「GitHub release 的 tag」漂移——两者各写一遍就会漂。
 *
 * 本模块不发起任何网络请求；两路取值由 sidecar-lock-audit（tasks 11.7）在取证时写入本文件。
 */
const fs = require('fs')
const path = require('path')

const LOCK_PATH = path.join(__dirname, '..', '..', 'sidecar-lock.json')
const HEX64 = /^[0-9a-f]{64}$/

/**
 * @param {object} lock 已解析的 lock 对象
 * @returns {{ok: boolean, problems: string[]}}
 */
function validateLock (lock) {
  const problems = []

  if (!lock || typeof lock !== 'object') return { ok: false, problems: ['lock 不是对象'] }
  if (lock.schemaVersion !== 1) problems.push('schemaVersion 必须为 1')

  const components = lock.components
  if (!components || typeof components !== 'object') {
    return { ok: false, problems: problems.concat(['components 缺失或不是对象']) }
  }

  for (const [id, comp] of Object.entries(components)) {
    if (!comp || typeof comp !== 'object') { problems.push(id + ': 组件不是对象'); continue }
    if (comp.status !== 'pinned' && comp.status !== 'pending') {
      problems.push(id + ': status 必须是 pinned|pending，实得 ' + JSON.stringify(comp.status))
      continue
    }
    if (comp.status === 'pending') {
      // pending 只允许「空」(未取证)；若已带 asset 却仍标 pending，是自相矛盾
      const keys = comp.assets ? Object.keys(comp.assets) : []
      if (keys.length > 0) problems.push(id + ': status=pending 但已带 ' + keys.length + ' 个 asset（矛盾）')
      if (!comp._pendingReason) problems.push(id + ': status=pending 必须记录 _pendingReason')
      continue
    }

    // —— pinned：必须有完整 assets，且每个 hash 形态正确 ——
    const assets = comp.assets || {}
    const keys = Object.keys(assets)
    if (keys.length === 0) { problems.push(id + ': status=pinned 但没有 assets'); continue }
    for (const key of keys) {
      const a = assets[key]
      if (!a || typeof a !== 'object') { problems.push(id + '/' + key + ': asset 不是对象'); continue }
      if (typeof a.asset !== 'string' || a.asset.length === 0) problems.push(id + '/' + key + ': 缺 asset 名')
      if (typeof a.size !== 'number' || !(a.size > 0)) problems.push(id + '/' + key + ': size 必须为正整数')
      if (typeof a.sha256 !== 'string' || !HEX64.test(a.sha256)) {
        problems.push(id + '/' + key + ': sha256 必须是 64 位十六进制，实得 ' + JSON.stringify(a.sha256))
      }
    }
  }

  // —— 判据 3：camoufox 两路交叉一致（仅在两侧都已取证时检）——
  const cam = components.camoufox
  const rel = lock.sources && lock.sources.camoufoxRelease
  if (cam && cam.status === 'pinned' && rel) {
    const tagNorm = String(rel.tag || '').replace(/^v/, '')
    if (cam.bundledRelease !== tagNorm) {
      problems.push('camoufox.bundledRelease(' + cam.bundledRelease + ') 与 sources.camoufoxRelease.tag(' + rel.tag + ') 不一致')
    }
    if (rel.draft === true) problems.push('camoufoxRelease 指向 draft release')
    const prefix = 'camoufox-' + cam.bundledRelease + '-'
    for (const [key, a] of Object.entries(cam.assets || {})) {
      if (a && typeof a.asset === 'string' && !a.asset.startsWith(prefix)) {
        problems.push('camoufox/' + key + ': asset 名必须以 ' + prefix + ' 开头，实得 ' + a.asset)
      }
    }
  }

  return { ok: problems.length === 0, problems }
}

/**
 * 读出并校验仓库内的 lock 文件。
 * @returns {{ok: boolean, problems: string[], lock: object}}
 */
function loadAndValidate () {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'))
  const r = validateLock(lock)
  return { ok: r.ok, problems: r.problems, lock }
}

/**
 * 取某平台可用的 asset（用于 sidecar-host 组装 manifest）。
 * pending 组件一律 fail-closed。
 * @param {string} id 组件 id
 * @param {string} platformKey 平台键，如 win32-x64
 */
function resolveAsset (lock, id, platformKey) {
  const comp = lock.components && lock.components[id]
  if (!comp) throw new Error('sidecar-lock: 未知组件 ' + id)
  if (comp.status !== 'pinned') {
    throw new Error('sidecar-lock: 组件 ' + id + ' 尚未钉定（status=' + comp.status + '），拒绝启动')
  }
  const a = comp.assets && comp.assets[platformKey]
  if (!a) {
    throw new Error('sidecar-lock: 组件 ' + id + ' 无平台 ' + platformKey + ' 的构件（可用: ' + Object.keys(comp.assets || {}).join(', ') + '）')
  }
  return a
}

module.exports = {
  LOCK_PATH,
  HEX64,
  validateLock,
  loadAndValidate,
  resolveAsset,
}
