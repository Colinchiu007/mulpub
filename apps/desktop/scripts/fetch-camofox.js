#!/usr/bin/env node
// @ts-check
/**
 * fetch-camofox.js — 手动拉取 camoufox 构件（PR-2 §7.1 的「手动 fetch-bin」级）
 *
 * 三级降级链的第一级前移与第二级落地：
 *   第一级（前移）：`pnpm-workspace.yaml` 的 `allowBuilds` 白名单不含 `@askjo/camofox-browser`
 *                  （pnpm 11 起构建白名单只从该文件读；`pnpm.neverBuiltDependencies` 是旧版
 *                  package.json 字段，现已被忽略并告警）⇒ 它的 postinstall 永不运行，
 *                  install 不再触发 ~500MB 下载，也不再受它「失败走 exit(0) 静默成功」之害
 *   第二级（本脚本）：用户显式 `pnpm run fetch:camofox` 才拉，且**自带校验**
 *   第三级：sidecar-host.start() 的 spawn 前复检（§6.1/6.2 已落地）
 *
 * 为什么不像 camofox 那样"install 时自动拉"：
 *   ① 每次 install 拉 500MB，所有人（含 CI）都被拖慢
 *   ② 它的下载链路**不做 sha256 校验**（checkAsset 只匹配资源名前缀）
 *   ③ 它的失败路径是 `process.exit(0)` —— 下载失败也显示安装成功，用户要到发布
 *      那一步才崩，极难归因
 *
 * 本脚本的 hash 来源是 apps/desktop/sidecar-lock.json 里 GitHub Releases 的官方
 * sha256（§6.3 两源取证的产物），不用 camofox 自身。
 *
 * 退出码：0=成功（含"已是最新跳过下载"）；1=失败（错误打到 stderr）。
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const { fetchAndVerifyAsset } = require('../electron/services/stealth/sidecar-asset-fetch')
const { resolveAsset } = require('../electron/services/sidecar-lock')

/** 平台键映射：process.platform + arch → sidecar-lock 的 asset 键 */
function currentPlatformKey () {
  const plat = process.platform === 'win32' ? 'win32'
    : process.platform === 'darwin' ? 'darwin'
      : 'linux'
  const arch = process.arch === 'ia32' ? 'ia32' : 'x64'
  return plat + '-' + arch
}

/** camoufox 缓存根（与 wrapper postinstall 的 camoufoxCacheDir 同构，便于共存） */
function defaultCacheDir () {
  const home = os.homedir()
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'camoufox')
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    return path.join(base, 'camoufox', 'camoufox', 'Cache')
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'camoufox')
}

/** 从 GitHub Releases 页面 URL 推出资产直链（lock 只记了 asset 名与 hash） */
function assetDownloadUrl (release, assetName) {
  // lock.sources.camoufoxRelease.api = .../releases/{repo}/releases/tags/{tag}
  const m = /\/repos\/([^/]+\/[^/]+)\/releases\/tags\/(.+)$/.exec(release.api || '')
  const repo = m ? m[1] : 'daijro/camoufox'
  const tag = m ? m[2] : release.tag
  return 'https://github.com/' + repo + '/releases/download/' + tag + '/' + assetName
}

async function main () {
  const platformKey = process.argv[2] || currentPlatformKey()
  const cacheDir = process.env.CAMOUFOX_CACHE_DIR || defaultCacheDir()
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sidecar-lock.json'), 'utf8'))

  const asset = resolveAsset(lock, 'camoufox', platformKey)
  const release = lock.sources.camoufoxRelease
  const url = assetDownloadUrl(release, asset.asset)
  const destPath = path.join(cacheDir, asset.asset)

  process.stdout.write('[fetch:camofox] platform=' + platformKey + '\n')
  process.stdout.write('[fetch:camofox] release=' + release.tag + ' asset=' + asset.asset + '\n')
  process.stdout.write('[fetch:camofox] sha256=' + asset.sha256 + '\n')
  process.stdout.write('[fetch:camofox] dest=' + destPath + '\n')

  const r = await fetchAndVerifyAsset(
    { url, destPath, expectedSha256: asset.sha256 },
    {
      fetchFile: downloadTo,
      sha256File: sha256Of,
    }
  )

  if (r.downloaded) {
    process.stdout.write('[fetch:camofox] 下载并校验通过（' + asset.size + ' 字节）\n')
  } else {
    process.stdout.write('[fetch:camofox] 已存在且校验通过，跳过下载\n')
  }

  // 写 wrapper 约定 的 version.json，让 camoufox-browser 运行期认为已就绪
  const versionFile = path.join(cacheDir, 'version.json')
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(versionFile, JSON.stringify({
    bundledRelease: lock.components.camoufox.bundledRelease,
    asset: asset.asset,
    sha256: asset.sha256,
    fetchedBy: 'mulpub fetch:camofox',
    fetchedAt: new Date().toISOString(),
  }, null, 2) + '\n')
  process.stdout.write('[fetch:camofox] 已写 ' + versionFile + '\n')
  process.stdout.write('[fetch:camofox] OK\n')
}

/** 生产用下载：跟随重定向落地到 dest */
async function downloadTo (url, dest) {
  const https = require('https')
  const http = require('http')
  const { URL } = require('url')
  const u = new URL(url)
  const get = u.protocol === 'https:' ? https.get : http.get
  await new Promise((resolve, reject) => {
    const req = get(u, (res) => {
      // GitHub 资产直链会 302 到 objects.githubusercontent.com
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        downloadTo(res.headers.location, dest).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url))
        return
      }
      const out = fs.createWriteStream(dest)
      res.pipe(out)
      out.on('finish', () => out.close(resolve))
      out.on('error', reject)
    })
    req.on('error', reject)
  })
}

/** 生产用 sha256：流式计算，避免大文件全量进内存 */
async function sha256Of (p) {
  const crypto = require('crypto')
  const h = crypto.createHash('sha256')
  await new Promise((resolve, reject) => {
    const s = fs.createReadStream(p)
    s.on('data', (c) => h.update(c))
    s.on('error', reject)
    s.on('end', resolve)
  })
  return h.digest('hex')
}

main().catch((e) => {
  process.stderr.write('[fetch:camofox] 失败: ' + (e && e.message ? e.message : String(e)) + '\n')
  process.exitCode = 1
})
