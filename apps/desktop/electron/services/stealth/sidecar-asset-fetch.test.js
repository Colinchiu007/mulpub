// @ts-check
/**
 * sidecar-asset-fetch.test.js — 可复用「下载 + 校验」单元契约（PR-2 §7.1）
 *
 * 判据来源：tasks 7.1「postinstall 下载路径适配（fail=warn → 手动 fetch-bin →
 * 通道降级三级）」+ design.md D4「完整性校验在下载后与 spawn 前两次」。
 *
 * 为什么抽这个单元：camofox wrapper 的 postinstall **不做任何 sha256 校验**
 * （只匹配资源名前缀，且失败走 process.exit(0) 静默"成功"）。故 fetch-bin 必须
 * 自带校验，而该校验逻辑与 sidecar-host.start() 的下载后校验**必须是同一份**
 * —— 抄两份必然漂移，漂移形状是「fetch-bin 拉的构件 sidecar-host 拒收」或反之。
 *
 * 契约：
 *  1. 下载后校验不符 ⇒ 删除已落盘载荷 + 抛错（不把校验不过的字节留在磁盘上）
 *  2. 目标已存在且校验通过 ⇒ 跳过下载（幂等；fetch-bin 可重复跑）
 *  3. 目标已存在但校验不符 ⇒ 重新拉取（自愈：上次拉到一半/被截断）
 *  4. fetchFile 抛错（网络失败）⇒ 原样抛出并清理 stage，不冒充成功
 *  5. 校验用 sidecar-lock 的官方 sha256（apps/desktop/sidecar-lock.json），
 *     不用 camofox 自身
 */
import { describe, it, expect, vi } from 'vitest'
const fs = require('fs')
const os = require('os')
const path = require('path')

const { fetchAndVerifyAsset } = require('./sidecar-asset-fetch')

const GOOD = 'a'.repeat(64)

function makeWorkDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mp-asset-' + process.pid + '-'))
}

/** 默认假依赖：下载即写文件，sha256 恒返回正确值 */
function makeDeps (workDir, over = {}) {
  const calls = { fetched: [], sha: [], removed: [] }
  const deps = {
    fetchFile: async (url, dest) => { calls.fetched.push({ url, dest }); fs.writeFileSync(dest, 'payload') },
    sha256File: async (p) => { calls.sha.push(p); return GOOD },
    removeFile: (p) => { calls.removed.push(p); try { fs.rmSync(p, { force: true }) } catch (_e) { /* 已不存在，视为已清理 */ } },
  }
  return { deps: Object.assign(deps, over.deps || {}), calls }
}

describe('fetchAndVerifyAsset — §7.1 下载+校验单一实现', () => {
  let workDir
  beforeEach(() => { workDir = makeWorkDir() })
  afterEach(() => { try { fs.rmSync(workDir, { recursive: true, force: true }) } catch (_e) { /* 清理失败不影响判定 */ } })

  it('① 下载后校验不符 ⇒ 删掉已落盘载荷 + 抛错', async () => {
    const { deps, calls } = makeDeps(workDir, { deps: { sha256File: async () => 'b'.repeat(64) } })
    const destPath = path.join(workDir, 'bin', 'x')
    await expect(fetchAndVerifyAsset({
      url: 'https://example.invalid/x.zip',
      destPath,
      expectedSha256: GOOD,
    }, deps)).rejects.toThrow(/sha256/i)
    // 校验不过的字节不得留在磁盘上（下载落在 .part，故删的是 .part；
    // destPath 从未被创建过——不能留一个"看起来存在"的半成品）
    expect(fs.existsSync(destPath)).toBe(false)
    expect(fs.existsSync(destPath + '.part')).toBe(false)
    expect(calls.removed).toEqual([destPath + '.part'])
  })

  it('② 目标已存在且校验通过 ⇒ 跳过下载（幂等，可重复跑）', async () => {
    const finalPath = path.join(workDir, 'bin', 'x')
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    fs.writeFileSync(finalPath, 'already-here')
    const { deps, calls } = makeDeps(workDir)
    const r = await fetchAndVerifyAsset({
      url: 'https://example.invalid/x.zip', destPath: finalPath, expectedSha256: GOOD,
    }, deps)
    expect(r).toMatchObject({ downloaded: false, path: finalPath })
    expect(calls.fetched).toEqual([]) // 没有重新拉
    expect(calls.sha).toEqual([finalPath]) // 但仍校验过一次
  })

  it('③ 目标已存在但校验不符 ⇒ 重新拉取（自愈截断/半成品）', async () => {
    const finalPath = path.join(workDir, 'bin', 'x')
    fs.mkdirSync(path.dirname(finalPath), { recursive: true })
    fs.writeFileSync(finalPath, 'truncated')
    // 本地计数器：第 1 次（旧文件）校验失败、第 2 次（.part 新下载）通过。
    // 不能用 calls.sha —— override 了 sha256File 就不再走默认记账。
    let n = 0
    const { deps, calls } = makeDeps(workDir, { deps: { sha256File: async () => (++n === 1 ? 'c'.repeat(64) : GOOD) } })
    const r = await fetchAndVerifyAsset({
      url: 'https://example.invalid/x.zip', destPath: finalPath, expectedSha256: GOOD,
    }, deps)
    expect(r).toMatchObject({ downloaded: true, path: finalPath })
    expect(calls.fetched).toHaveLength(1)
    expect(n).toBe(2)
    // 自愈后 destPath 是新内容、无 .part 残留
    expect(fs.readFileSync(finalPath, 'utf8')).toBe('payload')
    expect(fs.existsSync(finalPath + '.part')).toBe(false)
  })

  it('④ 网络失败 ⇒ 原样抛出并清理 stage，不冒充成功', async () => {
    const finalPath = path.join(workDir, 'bin', 'x')
    const { deps, calls } = makeDeps(workDir, {
      deps: { fetchFile: async () => { throw new Error('ECONNREFUSED') } },
    })
    await expect(fetchAndVerifyAsset({
      url: 'https://example.invalid/x.zip', destPath: finalPath, expectedSha256: GOOD,
    }, deps)).rejects.toThrow(/ECONNREFUSED/)
    expect(fs.existsSync(finalPath)).toBe(false)
  })

  it('④ expectedSha256 形态非法 ⇒ 直接拒（不下载、不落盘）', async () => {
    const finalPath = path.join(workDir, 'bin', 'x')
    const { deps, calls } = makeDeps(workDir)
    // 少一位 / 非十六进制 / 非字符串，一律在下载前就拒
    for (const bad of ['a'.repeat(63), 'g'.repeat(64), 123, null, undefined, '']) {
      await expect(fetchAndVerifyAsset({
        url: 'https://example.invalid/x.zip', destPath: finalPath, expectedSha256: bad,
      }, deps), String(bad)).rejects.toThrow(/expectedSha256/)
    }
    // 一条都不该发出去、盘上不该有任何东西
    expect(calls.fetched).toEqual([])
    expect(fs.existsSync(path.join(workDir, 'bin'))).toBe(false)
  })

  it('⑤ 校验用调用方传入的官方 sha256（不用 camofox 自身）', async () => {
    const finalPath = path.join(workDir, 'bin', 'x')
    const { deps, calls } = makeDeps(workDir, { deps: { sha256File: async () => GOOD } })
    await fetchAndVerifyAsset({
      url: 'https://example.invalid/x.zip', destPath: finalPath, expectedSha256: GOOD,
    }, deps)
    // 期望值来自入参而非任何环境/默认
    await expect(fetchAndVerifyAsset({
      url: 'https://example.invalid/x.zip', destPath: path.join(workDir, 'bin', 'y'), expectedSha256: 'd'.repeat(64),
    }, deps)).rejects.toThrow(/sha256/i)
  })
})
