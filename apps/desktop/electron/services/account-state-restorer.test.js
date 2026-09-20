import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

import * as restorer from './account-state-restorer.js'

const previousUserDataDir = process.env.ELECTRON_USER_DATA_DIR
let userDataDir

function holdExclusiveWindowsFileLock (filePath, holdMs) {
  const script = [
    '& {',
    'param($file, $holdMs)',
    '$handle = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)',
    'try {',
    '[Console]::Out.WriteLine("LOCKED")',
    '[Console]::Out.Flush()',
    '[Threading.Thread]::Sleep([int]$holdMs)',
    '} finally { $handle.Dispose() }',
    '}',
  ].join('\n')
  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
    filePath,
    String(holdMs),
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  let locked = false
  let resolveLocked
  let rejectLocked
  const lockedPromise = new Promise((resolve, reject) => {
    resolveLocked = resolve
    rejectLocked = reject
  })
  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', error => {
      rejectLocked(error)
      reject(error)
    })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.stdout.on('data', chunk => {
      if (!locked && chunk.toString().includes('LOCKED')) {
        locked = true
        resolveLocked()
      }
    })
    child.once('exit', code => {
      if (!locked) rejectLocked(new Error(`PowerShell exited before locking the file: ${stderr}`))
      if (code === 0) resolve()
      else reject(new Error(`PowerShell file lock exited with code ${code}: ${stderr}`))
    })
  })

  return lockedPromise.then(
    () => ({ exitPromise }),
    async error => {
      try { await exitPromise } catch (_) { /* 原始锁定错误包含更完整的上下文 */ }
      throw error
    },
  )
}

afterEach(() => {
  if (previousUserDataDir === undefined) delete process.env.ELECTRON_USER_DATA_DIR
  else process.env.ELECTRON_USER_DATA_DIR = previousUserDataDir
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true })
  userDataDir = undefined
})

describe('account-state-restorer', () => {
  it('首次保存时无需预先初始化即可创建状态目录', () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-state-'))
    process.env.ELECTRON_USER_DATA_DIR = userDataDir

    restorer.saveAccountRecord({
      accountId: 'acct-first-save',
      platform: 'zhihu',
      accountInfo: { nickname: '知乎账号' },
    })

    const statePath = path.join(userDataDir, 'accounts', 'state.jsonl')
    expect(fs.existsSync(statePath)).toBe(true)
    expect(restorer.getAccountRecord('zhihu', 'acct-first-save')).toEqual(expect.objectContaining({
      accountId: 'acct-first-save',
      platform: 'zhihu',
    }))
  })

  it('never writes cookies or browser storage to the JSONL state file', () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-state-'))
    process.env.ELECTRON_USER_DATA_DIR = userDataDir
    restorer.init()
    restorer.saveAccountRecord({
      accountId: 'acct-1',
      platform: 'wechat_mp',
      cookies: [{ name: 'session', value: 'secret' }],
      localStorage: { token: 'private' },
      accountInfo: { nickname: '公众号' },
    })

    const state = fs.readFileSync(path.join(userDataDir, 'accounts', 'state.jsonl'), 'utf8')
    expect(state).not.toContain('secret')
    expect(state).not.toContain('localStorage')
    expect(restorer.getAccountRecord('wechat_mp', 'acct-1')).toEqual(expect.objectContaining({
      accountId: 'acct-1',
      platform: 'wechat_mp',
    }))
  })

  it('账号公开状态不会写入 accountInfo 中嵌套的敏感字段', () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-state-'))
    process.env.ELECTRON_USER_DATA_DIR = userDataDir
    restorer.init()

    restorer.saveAccountRecord({
      accountId: 'acct-public-profile',
      platform: 'wechat_mp',
      accountInfo: {
        nickName: '公众号',
        avatar: 'https://example.com/avatar.png',
        platformAccountId: 'wx-1',
        token: 'private-token',
        profile: { secret: 'nested-secret' },
      },
    })

    const state = fs.readFileSync(path.join(userDataDir, 'accounts', 'state.jsonl'), 'utf8')
    expect(state).not.toContain('private-token')
    expect(state).not.toContain('nested-secret')
    expect(restorer.getAccountRecord('wechat_mp', 'acct-public-profile')?.accountInfo).toEqual({
      nickName: '公众号',
      avatar: 'https://example.com/avatar.png',
      platformAccountId: 'wx-1',
    })
  })

  it('redacts legacy plaintext records during initialization without losing metadata', () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-state-'))
    process.env.ELECTRON_USER_DATA_DIR = userDataDir
    const dir = path.join(userDataDir, 'accounts')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'state.jsonl'), JSON.stringify({
      accountId: 'acct-legacy',
      platform: 'zhihu',
      cookies: [{ name: 'session', value: 'legacy-secret' }],
      localStorage: { token: 'legacy-private' },
      accountInfo: { nickname: '知乎' },
    }) + '\n', 'utf8')

    restorer.init()
    const state = fs.readFileSync(path.join(dir, 'state.jsonl'), 'utf8')
    expect(state).not.toContain('legacy-secret')
    expect(state).not.toContain('legacy-private')
    expect(restorer.getAccountRecord('zhihu', 'acct-legacy')).toEqual(expect.objectContaining({
      accountId: 'acct-legacy',
      platform: 'zhihu',
      accountInfo: { nickname: '知乎' },
    }))
  })

  if (process.platform === 'win32') {
    it('遗留状态文件被 Windows 短暂占用时会在释放后完成原子脱敏迁移', async () => {
      userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-state-'))
      process.env.ELECTRON_USER_DATA_DIR = userDataDir
      const dir = path.join(userDataDir, 'accounts')
      const statePath = path.join(dir, 'state.jsonl')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(statePath, JSON.stringify({
        accountId: 'acct-locked-legacy',
        platform: 'zhihu',
        cookies: [{ name: 'session', value: 'locked-secret' }],
        accountInfo: { nickname: '知乎' },
      }) + '\n', 'utf8')

      const { exitPromise } = await holdExclusiveWindowsFileLock(statePath, 250)
      try {
        restorer.init()
      } finally {
        await exitPromise
      }

      const state = fs.readFileSync(statePath, 'utf8')
      expect(state).not.toContain('locked-secret')
      expect(JSON.parse(state)).toEqual(expect.objectContaining({
        accountId: 'acct-locked-legacy',
        platform: 'zhihu',
      }))
    })
  }

  it('按账号 ID 删除所有平台的历史状态记录', () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-state-'))
    process.env.ELECTRON_USER_DATA_DIR = userDataDir
    restorer.saveAccountRecord({ accountId: 'acct-shared', platform: 'wechat_mp', accountInfo: { name: 'A' } })
    restorer.saveAccountRecord({ accountId: 'acct-shared', platform: 'zhihu', accountInfo: { name: 'B' } })
    restorer.saveAccountRecord({ accountId: 'acct-keep', platform: 'zhihu', accountInfo: { name: 'C' } })

    expect(restorer.deleteAccountRecordsById('acct-shared')).toBe(true)
    expect(restorer.listLoggedInAccounts()).toEqual([
      expect.objectContaining({ accountId: 'acct-keep', platform: 'zhihu' }),
    ])
  })

  it('相同账号 ID 在不同 owner 下隔离查询和删除', () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-state-'))
    process.env.ELECTRON_USER_DATA_DIR = userDataDir
    restorer.saveAccountRecord({ accountId: 'acct-shared', platform: 'douyin', accountInfo: { name: 'A' } }, 'user-a')
    restorer.saveAccountRecord({ accountId: 'acct-shared', platform: 'douyin', accountInfo: { name: 'B' } }, 'user-b')

    expect(restorer.getAccountRecord('douyin', 'acct-shared', 'user-a').accountInfo).toEqual({ name: 'A' })
    expect(restorer.getAccountRecord('douyin', 'acct-shared', 'user-b').accountInfo).toEqual({ name: 'B' })
    expect(restorer.listLoggedInAccounts('user-a')).toEqual([
      expect.objectContaining({ accountId: 'acct-shared', owner_subject: 'user-a' }),
    ])
    expect(restorer.deleteAccountRecordsById('acct-shared', 'user-a')).toBe(true)
    expect(restorer.getAccountRecord('douyin', 'acct-shared', 'user-a')).toBeNull()
    expect(restorer.getAccountRecord('douyin', 'acct-shared', 'user-b')).not.toBeNull()
  })
})

  it('ELECTRON_USER_DATA_DIR 带尾随空格时仍写入规范目录（cmd set 陷阱回归保护）', () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-state-'))
    process.env.ELECTRON_USER_DATA_DIR = userDataDir + ' '
    restorer.init()
    restorer.saveAccountRecord({ accountId: 'acct-space', platform: 'douyin', accountInfo: { name: 'S' } })
    const statePath = path.join(userDataDir, 'accounts', 'state.jsonl')
    expect(fs.existsSync(statePath)).toBe(true)
    expect(fs.existsSync(userDataDir + ' ' + path.sep + 'accounts')).toBe(false)
  })
