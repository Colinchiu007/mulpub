// @ts-check
/**
 * auth-partition — API-first 凭证分区兜底模块回归测试（D1，kuaishou-w3-live-fix）
 *
 * 契约：
 * 1. findAuthPartitionDir 与 _restoreAuthPartitionCookies 同源前缀规则（auth-auth-/auth-/account-）
 * 2. collectAuthPartitionCookies 只读分区，按 isPlatformCookieDomain 过滤，同名去重，拼 name=value 串
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

__enableElectronMock()

let authPartition

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authPartition = await import('./auth-partition.js')
  authPartition = authPartition.default || authPartition
})

function mockFsPartitions (dirs) {
  const fs = require('fs')
  vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
    const s = String(p).replace(/\\/g, '/')
    return s.endsWith('/Partitions')
  })
  vi.spyOn(fs, 'readdirSync').mockReturnValue(dirs)
  vi.spyOn(fs, 'statSync').mockImplementation(() => ({ isDirectory: () => true }))
}

describe('auth-partition — findAuthPartitionDir', () => {
  it('按 account-{accountId} 前缀定位分区名', () => {
    mockFsPartitions(['account-a4505f45', 'browse-tab-1'])
    expect(authPartition.findAuthPartitionDir('kuaishou', 'a4505f45')).toBe('account-a4505f45')
  })

  it('按 auth-auth-{platform}- 前缀定位，多候选取最新（sort 尾部）', () => {
    mockFsPartitions(['auth-auth-kuaishou-100', 'auth-auth-kuaishou-200', 'other'])
    expect(authPartition.findAuthPartitionDir('kuaishou', null)).toBe('auth-auth-kuaishou-200')
  })

  it('无匹配分区返回 null', () => {
    mockFsPartitions(['browse-tab-1', 'other'])
    expect(authPartition.findAuthPartitionDir('kuaishou', 'acc-1')).toBeNull()
  })
})

describe('auth-partition — collectAuthPartitionCookies', () => {
  function mockPartitionCookies (cookies) {
    const electron = require('electron')
    electron.session.fromPartition = vi.fn(() => ({
      cookies: { get: vi.fn().mockResolvedValue(cookies) },
    }))
  }

  it('D1 主场景：kuaishou 分区 cookie 拼出 name=value; 串', async () => {
    mockFsPartitions(['account-a4505f45'])
    mockPartitionCookies([
      { name: 'kuaishou.web.cp.api_st', value: 'sess', domain: 'cp.kuaishou.com' },
      { name: 'userId', value: 'u1', domain: '.kuaishou.com' },
    ])
    const res = await authPartition.collectAuthPartitionCookies('kuaishou', 'a4505f45')
    expect(res.partition).toBe('account-a4505f45')
    expect(res.cookieString).toBe('kuaishou.web.cp.api_st=sess; userId=u1')
    expect(res.count).toBe(2)
  })

  it('跨平台域 cookie 被过滤（不串味）', async () => {
    mockFsPartitions(['account-a4505f45'])
    mockPartitionCookies([
      { name: 'sid', value: 'ks', domain: 'cp.kuaishou.com' },
      { name: 'xhs_token', value: 'nope', domain: 'xiaohongshu.com' },
    ])
    const res = await authPartition.collectAuthPartitionCookies('kuaishou', 'a4505f45')
    expect(res.cookieString).toBe('sid=ks')
    expect(res.count).toBe(1)
  })

  it('同名 cookie 去重（保留后出现的高优先级值）', async () => {
    mockFsPartitions(['account-a4505f45'])
    mockPartitionCookies([
      { name: 'did', value: 'old', domain: 'kuaishou.com' },
      { name: 'did', value: 'new', domain: 'cp.kuaishou.com' },
    ])
    const res = await authPartition.collectAuthPartitionCookies('kuaishou', 'a4505f45')
    expect(res.cookieString).toBe('did=new')
    expect(res.count).toBe(1)
  })

  it('分区不存在时返回空结果，不抛错', async () => {
    mockFsPartitions(['browse-tab-1'])
    const res = await authPartition.collectAuthPartitionCookies('kuaishou', 'acc-missing')
    expect(res.cookieString).toBe('')
    expect(res.partition).toBeNull()
    expect(res.count).toBe(0)
  })

  it('分区 session 读取抛错时降级为空结果（不得炸发布主链）', async () => {
    mockFsPartitions(['account-a4505f45'])
    const electron = require('electron')
    electron.session.fromPartition = vi.fn(() => { throw new Error('partition locked') })
    const res = await authPartition.collectAuthPartitionCookies('kuaishou', 'a4505f45')
    expect(res.cookieString).toBe('')
  })
})
