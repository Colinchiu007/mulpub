// @ts-check
'use strict'
/**
 * shot-downloader L3 原片下载通道测试（tasks 6.1 RED + 6.3 SSRF 回归）
 *
 * 合同（design D7）：
 *  - 仅 https；allowedHosts 精确主机名匹配（禁通配/禁子域后缀拼接绕过）；
 *  - 内网黑名单兜底（allowedHosts 里塞内网 IP 也拒绝）；
 *  - 每次请求发起前经 DNS lookup 校验解析 IP——主机名判断不可作为唯一防线（6.3）；
 *  - 3xx 手动逐跳跟随，每跳重新过白名单 + DNS 校验，超 MAX_REDIRECTS 拒绝；
 *  - 单文件上限 MAX_DOWNLOAD_BYTES=500MB；流式写 `.part`，探测（probeImpl）通过才 rename；
 *  - 失败/超限/探测不通过/流中断 → 清理临时文件，杜绝半成品入库；
 *  - 显式触发：合同校验不通过时零网络请求；
 *  - 落盘必须位于受控媒体根（getFilmMediaRoot）内，产出可进 renderManifest 的
 *    { shotId, path, sourceKind:'downloaded' } 条目（orderIndex 由调用方编排赋值）。
 *
 * 测试 seam：fetchImpl / lookupImpl / probeImpl 全注入，零真实网络与二进制依赖。
 */
const fs = require('fs')
const path = require('path')
const {
  validateDownloadUrl,
  downloadShot,
  MAX_DOWNLOAD_BYTES,
  MAX_REDIRECTS,
} = require('./shot-downloader')
const { getFilmMediaRoot } = require('./film-render')

const ALLOWED = ['d8j0ntlcm91z4.cloudfront.net']
const OK_URL = 'https://d8j0ntlcm91z4.cloudfront.net/raw/abc.mp4'

function makeResponse ({ status = 200, chunks = [], location = null } = {}) {
  const headers = {}
  if (location) headers.location = location
  return {
    status,
    headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
    body: (async function * () { for (const c of chunks) yield Buffer.from(c) })(),
  }
}

function makeFetch (responses) {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    const r = responses.shift()
    if (typeof r === 'function') return r(url)
    if (r instanceof Error) throw r
    return r
  }
  impl.calls = calls
  return impl
}

function makeLookup (results) {
  const calls = []
  let last = null
  const impl = async (host) => {
    calls.push(host)
    if (results.length) last = results.shift()
    if (last instanceof Error) throw last
    return last
  }
  impl.calls = calls
  return impl
}

/** 受控媒体根内的临时落盘目录 */
function makeDestDir () {
  const root = getFilmMediaRoot()
  fs.mkdirSync(root, { recursive: true })
  return fs.mkdtempSync(path.join(root, 'sd-test-'))
}

const okProbe = async () => { /* 探测通过 */ }

describe('validateDownloadUrl（D7 主机白名单合同）', () => {
  it('https + allowedHosts 精确匹配 → 放行', () => {
    expect(validateDownloadUrl(OK_URL, ALLOWED).ok).toBe(true)
  })

  it('http 协议一律拒绝（仅 https）', () => {
    const r = validateDownloadUrl('http://d8j0ntlcm91z4.cloudfront.net/a.mp4', ALLOWED)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/https/)
  })

  it('host 不在 allowedHosts → 拒绝', () => {
    expect(validateDownloadUrl('https://evil.com/a.mp4', ALLOWED).ok).toBe(false)
  })

  it('后缀拼接伪装（allowed.evil.com）→ 拒绝', () => {
    expect(validateDownloadUrl('https://d8j0ntlcm91z4.cloudfront.net.evil.com/a.mp4', ALLOWED).ok).toBe(false)
  })

  it('禁通配：父域条目不放行子域', () => {
    expect(validateDownloadUrl(OK_URL, ['cloudfront.net']).ok).toBe(false)
    expect(validateDownloadUrl(OK_URL, ['*.cloudfront.net']).ok).toBe(false)
  })

  it('主机名大小写不敏感匹配', () => {
    expect(validateDownloadUrl('https://D8J0NTLCM91Z4.CloudFront.NET/a.mp4', ALLOWED).ok).toBe(true)
  })

  it('allowedHosts 塞内网地址也拒绝（黑名单兜底）', () => {
    expect(validateDownloadUrl('https://127.0.0.1/a.mp4', ['127.0.0.1']).ok).toBe(false)
    expect(validateDownloadUrl('https://localhost/a.mp4', ['localhost']).ok).toBe(false)
    expect(validateDownloadUrl('http://10.0.0.5/a.mp4', ['10.0.0.5']).ok).toBe(false)
  })

  it('非法 URL → 拒绝', () => {
    expect(validateDownloadUrl('not a url', ALLOWED).ok).toBe(false)
    expect(validateDownloadUrl('', ALLOWED).ok).toBe(false)
  })

  it('allowedHosts 缺失/非数组 → 拒绝（fail-closed）', () => {
    expect(validateDownloadUrl(OK_URL, undefined).ok).toBe(false)
    expect(validateDownloadUrl(OK_URL, []).ok).toBe(false)
  })
})

describe('downloadShot（显式触发、限额、.part + 探测 rename）', () => {
  let destDir
  beforeEach(() => { destDir = makeDestDir() })
  afterEach(() => { try { fs.rmSync(destDir, { recursive: true, force: true }) } catch { /* 忽略 */ } })

  async function run (over = {}) {
    return downloadShot({
      url: over.url || OK_URL,
      shotId: 'shot-uuid-1',
      destDir,
      fileName: 'shot_000.mp4',
      allowedHosts: ALLOWED,
      fetchImpl: over.fetchImpl || makeFetch([makeResponse({ chunks: ['DATA-'] })]),
      lookupImpl: over.lookupImpl || makeLookup([['104.16.0.1']]),
      probeImpl: over.probe || okProbe,
      maxBytes: over.maxBytes,
    })
  }

  it('合同校验不通过 → 零网络请求（无显式触发不下载）', async () => {
    const fetchImpl = makeFetch([])
    const r = await run({ fetchImpl, url: 'https://evil.com/a.mp4' })
    expect(r.ok).toBe(false)
    expect(fetchImpl.calls.length).toBe(0)
  })

  it('落盘目录超出受控媒体根 → 拒绝且零请求', async () => {
    const fetchImpl = makeFetch([])
    const r = await downloadShot({
      url: OK_URL, shotId: 's', destDir: fs.mkdtempSync(path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'outside-')), '')),
      fileName: 'a.mp4', allowedHosts: ALLOWED,
      fetchImpl, lookupImpl: makeLookup([['104.16.0.1']]), probeImpl: okProbe,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/媒体根|受控/)
    expect(fetchImpl.calls.length).toBe(0)
  })

  it('成功：流式写 .part → 探测通过 → rename 正式文件，返回 downloaded 条目', async () => {
    const probed = []
    const r = await run({ probe: async (p) => { probed.push(p) } })
    expect(r.ok).toBe(true)
    const finalPath = path.join(destDir, 'shot_000.mp4')
    expect(fs.existsSync(finalPath)).toBe(true)
    expect(fs.readFileSync(finalPath, 'utf8')).toBe('DATA-')
    expect(fs.existsSync(finalPath + '.part')).toBe(false)
    // 探测发生在 rename 之前，且针对 .part 文件
    expect(probed.length).toBe(1)
    expect(probed[0]).toBe(finalPath + '.part')
    expect(r.entry).toEqual({ shotId: 'shot-uuid-1', path: finalPath, sourceKind: 'downloaded' })
  })

  it('单文件超限 → 拒绝并清理 .part（默认上限 500MB）', async () => {
    expect(MAX_DOWNLOAD_BYTES).toBe(500 * 1024 * 1024)
    const fetchImpl = makeFetch([makeResponse({ chunks: ['A'.repeat(8), 'B'.repeat(8)] })])
    const r = await run({ fetchImpl, maxBytes: 10 })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/上限/)
    expect(fs.existsSync(path.join(destDir, 'shot_000.mp4'))).toBe(false)
    expect(fs.readdirSync(destDir).filter((f) => f.endsWith('.part')).length).toBe(0)
  })

  it('探测不通过（坏文件）→ 不入库，.part 清理', async () => {
    const r = await run({ probe: async () => { throw new Error('无视频流') } })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/无视频流|验证/)
    expect(fs.existsSync(path.join(destDir, 'shot_000.mp4'))).toBe(false)
    expect(fs.readdirSync(destDir).filter((f) => f.endsWith('.part')).length).toBe(0)
  })

  it('请求抛错 → 失败且不残留 .part/正式文件', async () => {
    const r = await run({ fetchImpl: makeFetch([new Error('network down')]) })
    expect(r.ok).toBe(false)
    expect(fs.readdirSync(destDir).length).toBe(0)
  })

  it('流中途断开 → 清理已写的 .part，不产出半成品', async () => {
    const broken = makeResponse({ chunks: [] })
    let seen = 0
    broken.body = (async function * () {
      yield Buffer.from('PARTIAL-')
      seen++
      throw new Error('stream reset')
    })()
    const r = await run({ fetchImpl: makeFetch([broken]) })
    expect(r.ok).toBe(false)
    expect(seen).toBe(1)
    expect(fs.existsSync(path.join(destDir, 'shot_000.mp4'))).toBe(false)
    expect(fs.readdirSync(destDir).filter((f) => f.endsWith('.part')).length).toBe(0)
  })
})

describe('SSRF 回归（6.3：跳转逐跳复验 + DNS 解析 IP 双防线）', () => {
  let destDir
  beforeEach(() => { destDir = makeDestDir() })
  afterEach(() => { try { fs.rmSync(destDir, { recursive: true, force: true }) } catch { /* 忽略 */ } })

  function base (over) {
    return downloadShot({
      url: OK_URL,
      shotId: 's1',
      destDir,
      fileName: 'shot_001.mp4',
      allowedHosts: ALLOWED,
      lookupImpl: makeLookup([['104.16.0.1']]),
      probeImpl: okProbe,
      ...over,
    })
  }

  it('302 跳出白名单 → 拒绝，仅一次请求', async () => {
    const fetchImpl = makeFetch([makeResponse({ status: 302, location: 'https://evil.com/x.mp4' })])
    const r = await base({ fetchImpl })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/跳转/)
    expect(fetchImpl.calls.length).toBe(1)
  })

  it('302 降级到 http → 拒绝', async () => {
    const fetchImpl = makeFetch([makeResponse({ status: 302, location: 'http://d8j0ntlcm91z4.cloudfront.net/x.mp4' })])
    const r = await base({ fetchImpl })
    expect(r.ok).toBe(false)
    expect(fetchImpl.calls.length).toBe(1)
  })

  it('跳转链超 MAX_REDIRECTS → 拒绝（防环）', async () => {
    const responses = []
    for (let i = 0; i <= MAX_REDIRECTS + 2; i++) {
      responses.push(makeResponse({ status: 302, location: 'https://d8j0ntlcm91z4.cloudfront.net/hop' + i }))
    }
    const fetchImpl = makeFetch(responses)
    const r = await base({ fetchImpl })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/跳转/)
    expect(fetchImpl.calls.length).toBeLessThanOrEqual(MAX_REDIRECTS + 1)
  })

  it('302 到白名单内主机 → 跟随成功（逐跳复验）', async () => {
    const fetchImpl = makeFetch([
      makeResponse({ status: 302, location: 'https://d8j0ntlcm91z4.cloudfront.net/final.mp4' }),
      makeResponse({ chunks: ['OK-'] }),
    ])
    const lookups = makeLookup([['104.16.0.1'], ['104.16.0.2']])
    const r = await base({ fetchImpl, lookupImpl: lookups })
    expect(r.ok).toBe(true)
    expect(fetchImpl.calls.length).toBe(2)
    expect(lookups.calls.length).toBe(2)
    expect(fs.readFileSync(path.join(destDir, 'shot_001.mp4'), 'utf8')).toBe('OK-')
  })

  it('DNS 重绑定：同名第二次解析到内网 → 拒绝（主机名不是唯一防线）', async () => {
    const fetchImpl = makeFetch([
      makeResponse({ status: 302, location: 'https://d8j0ntlcm91z4.cloudfront.net/again.mp4' }),
      makeResponse({ chunks: ['X'] }),
    ])
    const lookups = makeLookup([['104.16.0.1'], ['127.0.0.1']])
    const r = await base({ fetchImpl, lookupImpl: lookups })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/内网/)
    expect(fetchImpl.calls.length).toBe(1)
    expect(fs.readdirSync(destDir).length).toBe(0)
  })

  it('解析结果含内网 IP → 请求前拒绝', async () => {
    const fetchImpl = makeFetch([])
    const r = await base({ fetchImpl, lookupImpl: makeLookup([['192.168.1.1']]) })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/内网/)
    expect(fetchImpl.calls.length).toBe(0)
  })

  it('DNS 解析失败 → fail-closed 拒绝', async () => {
    const fetchImpl = makeFetch([])
    const r = await base({ fetchImpl, lookupImpl: makeLookup([new Error('ENOTFOUND')]) })
    expect(r.ok).toBe(false)
    expect(fetchImpl.calls.length).toBe(0)
  })
})
