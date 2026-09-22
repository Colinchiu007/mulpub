// @ts-check
'use strict'
/**
 * shot-downloader — L3 原片下载通道（openspec change: film-full-corpus-production，design D7）
 *
 * 安全合同（全部 fail-closed）：
 *  - 仅 https；主机名必须与 kit 元数据 allowedHosts 精确匹配（禁通配/子域后缀）；
 *  - 内网地址黑名单兜底（即使塞进 allowedHosts 也拒绝）；
 *  - 每次请求（含 3xx 每一跳）发起前先 DNS 解析并校验 IP——主机名判断不作为唯一防线；
 *  - 3xx 手动逐跳跟随（redirect:'manual'），每跳重新过白名单 + DNS 校验，
 *    超 MAX_REDIRECTS 跳拒绝（防环）；
 *  - 单文件上限 MAX_DOWNLOAD_BYTES=500MB，流超限立即中止；
 *  - 流式写 `.part` 临时文件 → ffprobe 探测通过才 rename 为正式片段（杜绝半成品入库）；
 *  - 任何失败路径清理 `.part`；落盘目录必须位于受控媒体根（getFilmMediaRoot）内；
 *  - 仅在显式调用 downloadShot 时产生网络请求，无自动预取。
 *
 * 测试 seam（与 video-gen _testDownload / film-render _testProbe 同构）：
 *  - fetchImpl(url, init) → fetch 风格 Response；lookupImpl(hostname) → string[]；
 *  - probeImpl(path) → 校验通过 resolve / 失败 reject。生产不传走真实 fetch/dns/ffprobe。
 *
 * 产物条目：{ shotId, path, sourceKind:'downloaded' }——orderIndex 由上层
 * （production-driver / 回收面板）编排后赋值，可直接进 renderManifest（组 5 契约）。
 */

const fs = require('fs')
const path = require('path')
const dns = require('dns').promises
const { probeClip, getFilmMediaRoot } = require('./film-render')

/** 单文件大小上限（D7：500MB） */
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024
/** 3xx 手动跟随的最大跳数 */
const MAX_REDIRECTS = 3

/** 内网/回环/链路本地地址判定（IPv4 + IPv6，含映射地址） */
function isPrivateAddress (address) {
  const a = String(address || '').toLowerCase()
  if (!a) return true
  if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7))
  if (a === '::1' || a === '') return true
  if (a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80')) return true
  if (a.startsWith('127.') || a.startsWith('10.') || a.startsWith('192.168.') || a.startsWith('169.254.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(a)) return true
  if (a === 'localhost') return true
  return false
}

/**
 * 下载 URL 合同校验（不发请求）：仅 https + allowedHosts 精确匹配 + 内网黑名单兜底。
 * @param {string} url
 * @param {string[]|undefined} allowedHosts kit 元数据登记的来源域清单
 * @returns {{ ok: boolean, reason?: string }}
 */
function validateDownloadUrl (url, allowedHosts) {
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
    return { ok: false, reason: 'allowedHosts 清单缺失，拒绝下载（fail-closed）' }
  }
  let parsed
  try { parsed = new URL(String(url)) } catch { return { ok: false, reason: 'URL 格式不正确' } }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: '下载通道仅允许 https 协议' }
  }
  const hostname = String(parsed.hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!hostname) return { ok: false, reason: 'URL 缺少主机名' }
  if (isPrivateAddress(hostname)) {
    return { ok: false, reason: '不允许访问内网地址（SSRF 防护）' }
  }
  const allowed = allowedHosts.map((h) => String(h || '').toLowerCase())
  if (!allowed.includes(hostname)) {
    return { ok: false, reason: '主机名不在 allowedHosts 精确清单内：' + hostname }
  }
  return { ok: true }
}

/** 落盘目录必须位于受控媒体根内（组 5 parseRenderManifest 同口径，保证条目可直接进 manifest） */
function validateDestDir (destDir) {
  const resolved = path.resolve(String(destDir || ''))
  const root = path.resolve(getFilmMediaRoot())
  const withSep = root.endsWith(path.sep) ? root : root + path.sep
  if (resolved !== root && !resolved.startsWith(withSep)) {
    return { ok: false, error: '下载落盘目录必须位于受控媒体根内：' + root }
  }
  return { ok: true }
}

async function defaultLookup (hostname) {
  const rows = await dns.lookup(hostname, { all: true, verbatim: true })
  return rows.map((r) => r.address)
}

/**
 * 显式触发单镜原片下载（D7 全合同）。
 * @param {{
 *   url: string, shotId: string, destDir: string, fileName: string,
 *   allowedHosts: string[], maxBytes?: number,
 *   fetchImpl?: Function, lookupImpl?: Function, probeImpl?: Function, signal?: AbortSignal,
 * }} opts
 * @returns {Promise<{ ok: boolean, path?: string, size?: number, entry?: object, error?: string }>}
 */
async function downloadShot (opts) {
  const {
    url, shotId, destDir, fileName, allowedHosts,
    maxBytes = MAX_DOWNLOAD_BYTES,
    fetchImpl = globalThis.fetch,
    lookupImpl = defaultLookup,
    probeImpl = probeClip,
    signal = undefined,
  } = opts || {}

  const dirCheck = validateDestDir(destDir)
  if (!dirCheck.ok) return { ok: false, error: dirCheck.error }
  const name = String(fileName || '')
  if (!name || name !== path.basename(name) || name.includes('..')) {
    return { ok: false, error: 'fileName 必须为不含路径分隔符的正式文件名' }
  }
  const urlCheck = validateDownloadUrl(url, allowedHosts)
  if (!urlCheck.ok) return { ok: false, error: 'URL 未通过下载合同校验：' + urlCheck.reason }

  const finalPath = path.join(path.resolve(destDir), name)
  const tmpPath = finalPath + '.part'
  try { fs.mkdirSync(path.dirname(finalPath), { recursive: true }) } catch { /* 已存在 */ }

  let total = 0
  const wsCaught = []
  let written = false
  try {
    let current = url
    let hops = 0
    let res = null
    // 逐跳：每次请求前 DNS 解析校验（主机名判断不作为唯一防线）
    for (;;) {
      const host = new URL(current).hostname
      let addresses
      try {
        addresses = await lookupImpl(host)
      } catch (e) {
        return { ok: false, error: 'DNS 解析失败，拒绝下载（fail-closed）：' + ((e && e.message) || e) }
      }
      if (!Array.isArray(addresses) || addresses.length === 0) {
        return { ok: false, error: 'DNS 解析无结果，拒绝下载（fail-closed）' }
      }
      if (addresses.some((a) => isPrivateAddress(a))) {
        return { ok: false, error: '主机解析到内网地址，拒绝下载（SSRF/DNS 重绑定防护）' }
      }
      try {
        res = await fetchImpl(current, { redirect: 'manual', signal })
      } catch (e) {
        return { ok: false, error: '下载请求失败：' + ((e && e.message) || e) }
      }
      if (!res || typeof res.status !== 'number') {
        return { ok: false, error: '下载响应无效' }
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers && res.headers.get ? res.headers.get('location') : null
        if (++hops > MAX_REDIRECTS) {
          return { ok: false, error: '跳转次数超过上限（' + MAX_REDIRECTS + '），拒绝下载' }
        }
        if (!location) return { ok: false, error: '跳转响应缺少 Location，拒绝下载' }
        let next
        try { next = new URL(location, current).href } catch { return { ok: false, error: '跳转地址无法解析，拒绝下载' } }
        const nextCheck = validateDownloadUrl(next, allowedHosts)
        if (!nextCheck.ok) {
          return { ok: false, error: '跳转目标未通过下载合同校验：' + nextCheck.reason }
        }
        current = next
        continue
      }
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, error: '下载失败：HTTP 状态 ' + res.status }
      }
      break
    }

    // 流式写 .part，超限立即中止；open/write 错误统一有主（不留 uncaught 'error'）
    const ws = fs.createWriteStream(tmpPath)
    written = true
    wsCaught.push(ws)
    let wsErr = null
    ws.on('error', (e) => { if (!wsErr) wsErr = e })
    try {
      for await (const chunk of res.body) {
        total += chunk.length
        if (total > maxBytes) {
          throw new Error('单文件大小超过上限（' + maxBytes + ' 字节）')
        }
        if (wsErr) throw wsErr
        if (!ws.write(chunk)) {
          await new Promise((resolve, reject) => {
            ws.once('drain', resolve)
            ws.once('error', reject)
          })
        }
      }
      if (wsErr) throw wsErr
      await new Promise((resolve, reject) => {
        ws.once('error', reject)
        ws.end((err) => (err ? reject(err) : resolve()))
      })
    } catch (e) {
      try { if (!ws.destroyed) ws.destroy() } catch { /* 忽略 */ }
      throw e
    }

    // ffprobe 验证通过才 rename（杜绝半成品入库）
    try {
      await probeImpl(tmpPath)
    } catch (e) {
      throw new Error('片段验证未通过（ffprobe）：' + ((e && e.message) || e), { cause: e })
    }
    fs.renameSync(tmpPath, finalPath)
    written = false
    return {
      ok: true,
      path: finalPath,
      size: total,
      entry: { shotId: String(shotId || ''), path: finalPath, sourceKind: 'downloaded' },
    }
  } catch (e) {
    return { ok: false, error: '下载失败：' + ((e && e.message) || e) }
  } finally {
    // 失败路径：先等流彻底关闭（含未完成的 open），再清理临时文件，
    // 避免 unlink 与延迟 open 竞态产生 uncaught ENOENT / 残留半成品
    for (const w of wsCaught) {
      try {
        if (!w.destroyed) w.destroy()
        await new Promise((resolve) => { w.closed ? resolve() : w.once('close', resolve) })
      } catch { /* 忽略 */ }
    }
    // rename 成功后 .part 已不存在，此处为兜底清理
    if (written) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath) } catch { /* 清理失败不掩盖原错误 */ }
    }
  }
}

module.exports = {
  downloadShot,
  validateDownloadUrl,
  isPrivateAddress,
  MAX_DOWNLOAD_BYTES,
  MAX_REDIRECTS,
}
