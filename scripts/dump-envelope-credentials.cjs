#!/usr/bin/env node
'use strict'

/**
 * dump-envelope-credentials.cjs —— 从磁盘解密账号凭据（信封库，不经 GUI）
 *
 * ── 为什么需要它 ──────────────────────────────────────────
 * 应用未启动时也想验证发布链（如 API 轨是否失败）——此前只能等 GUI 起来。
 * 但凭据本身是**磁盘上的加密文件**（`<user-data>/credentials/<accountId>.json.enc`，
 * 多租户时在 `credentials/owners/<sha256(ownerSubject)>/` 下），
 * 加密方式在本仓 `credential-store.js` 里是确定的（PBKDF2-SHA512 + AES-256-GCM），
 * masterKey 也在同目录 `.masterkey`（纯 hex，不需 Electron safeStorage）。
 *
 * ⇒ 可在 Node 里直接解密，不必启动 GUI。
 *
 * 与发布链的关系（PRD §16.18.2 已记）：发布链主源正是**信封库** `authData.cookies`，
 * 分区 cookie 只是回退。所以本工具取到的就是**发布链实际使用的凭据**——
 * 比"用分区 cookie 探测"更接近真实（分区凭据可能已失效，导致误判，如视频号 300330 那次）。
 *
 * ── ⚠ 当前状态：解不开（安全边界按设计生效）────────────────
 * 2026-10-21 实测三条路全堵，故本工具**暂不可用**（保留代码作为排查记录）：
 *   ① 纯 Node：masterKey 文件是 `safeStorage:v1:<base64>` 形态 —— 被 Electron
 *      `safeStorage.encryptString()` 包过，不是裸 hex ⇒ 拿不到 PBKDF2 输入；
 *   ② PowerShell + DPAPI（ProtectedData/CurrentUser）：报 "The data is invalid" ——
 *      safeStorage 在 DPAPI 外层还有自己的格式头，不是裸 DPAPI 密文；
 *   ③ Electron Node 模式（ELECTRON_RUN_AS_NODE=1）：`require('electron')` 返回的
 *      对象没有 safeStorage（该模式只暴露部分 API）⇒ 也解不开。
 *
 * ⇒ **结论：信封库凭据只能经 GUI 应用取得**（安全边界按设计生效，这不是缺陷）。
 *   本工具留档的意义：证明"绕开 GUI 取凭据"这条路走不通，后续会话不必重试。
 *   若将来要支持，唯一正道是让 GUI 应用暴露一个**受控的**导出 IPC（带授权与审计）。
 *
 * ── 用法 ────────────────────────────────────────────────────
 *   node scripts/dump-envelope-credentials.cjs <accountId> [--cred-dir <path>] [--cookie-string]
 *
 * ⚠ 只读本机凭据，用于自有账号验证；输出含敏感数据，勿提交/勿外传。
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ALGORITHM = 'aes-256-gcm'
const SALT_LENGTH = 32
const IV_LENGTH = 16
const TAG_LENGTH = 16
const KEY_LENGTH = 32
const PBKDF2_ITERATIONS = 200000 // 与 credential-store.js 对齐
const DEFAULT_CRED = 'D:/Data/projects/mulpub/shared-user-data/credentials'

function argOf (flag) {
  const i = process.argv.indexOf(flag)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

/** 在 credDir 及其 owners/<hash>/ 子目录里找 <accountId>.json.enc */
function findEncFile (credDir, accountId) {
  const direct = path.join(credDir, accountId + '.json.enc')
  if (fs.existsSync(direct)) return direct
  const owners = path.join(credDir, 'owners')
  if (fs.existsSync(owners)) {
    for (const ns of fs.readdirSync(owners)) {
      const p = path.join(owners, ns, accountId + '.json.enc')
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

/** masterKey 与 enc 文件同目录（或上一层） */
function loadMasterKey (encFile, credDir) {
  const dirs = [path.dirname(encFile), credDir]
  for (const d of dirs) {
    for (const name of ['.masterkey', '.masterkey.bak']) {
      const p = path.join(d, name)
      if (!fs.existsSync(p)) continue
      const raw = fs.readFileSync(p, 'utf8').trim()
      if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase()
      try {
        const j = JSON.parse(raw)
        for (const k of ['masterKey', 'key', 'master_key', 'value']) {
          if (j && typeof j[k] === 'string' && /^[0-9a-f]{64}$/i.test(j[k])) return j[k].toLowerCase()
        }
      } catch (_e) { /* 非 JSON */ }
      const m = raw.match(/[0-9a-f]{64}/i)
      if (m) return m[0].toLowerCase()
    }
  }
  return null
}

function decrypt (payload, masterKey) {
  const salt = payload.subarray(0, SALT_LENGTH)
  const iv = payload.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
  const tag = payload.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
  const enc = payload.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
  const key = crypto.pbkdf2Sync(masterKey, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512')
  const d = crypto.createDecipheriv(ALGORITHM, key, iv)
  d.setAuthTag(tag)
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'))
}

function cookieStringOf (data) {
  if (!data) return ''
  if (Array.isArray(data.cookies)) return data.cookies.map((c) => c.name + '=' + c.value).join('; ')
  if (typeof data.cookies === 'string') return data.cookies
  return ''
}

function main () {
  const accountId = process.argv[2]
  if (!accountId || accountId.startsWith('--')) {
    console.log('用法: node scripts/dump-envelope-credentials.cjs <accountId> [--cred-dir <path>] [--cookie-string]')
    process.exit(2)
  }
  if (!/^[A-Za-z0-9_-]+$/.test(accountId)) { console.error('accountId 含非法字符'); process.exit(2) }
  const credDir = argOf('--cred-dir') || DEFAULT_CRED
  const encFile = findEncFile(credDir, accountId)
  if (!encFile) { console.error('未找到 ' + accountId + '.json.enc（cred-dir=' + credDir + '）'); process.exit(1) }
  const masterKey = loadMasterKey(encFile, credDir)
  if (!masterKey) { console.error('未取到 masterKey'); process.exit(1) }

  let data
  try {
    data = decrypt(fs.readFileSync(encFile), masterKey)
  } catch (e) {
    console.error('解密失败: ' + e.message + '（masterKey 或迭代数可能不匹配）')
    process.exit(1)
  }

  if (process.argv.includes('--cookie-string')) {
    console.log(cookieStringOf(data))
    return
  }
  const cs = cookieStringOf(data)
  console.log(JSON.stringify({
    accountId,
    encFile: path.basename(path.dirname(encFile)) === 'credentials' ? '(root)' : 'owners/' + path.basename(path.dirname(encFile)).slice(0, 8),
    platform: data.platform || null,
    cookieCount: Array.isArray(data.cookies) ? data.cookies.length : 0,
    cookieStringLength: cs.length,
    cookieNames: Array.isArray(data.cookies) ? data.cookies.map((c) => c.name) : [],
    localStorageKeys: data.localStorage && typeof data.localStorage === 'object' ? Object.keys(data.localStorage) : [],
  }, null, 1))
}

main()
