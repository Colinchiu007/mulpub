/**
 * feedSync.status 的三向对账锁（写侧字面量 / 读侧判据 / spec 声明）
 *
 * 动因（QM-6 前端评审 #5，opencode 独立命中）：`partial` 一度是**隐形死分支**——
 * 写侧只落 `failed`/`success`，读侧却判 `partial`，spec 又同时用 `result` 与 `status`
 * 两个名字指同一份数据。任何人读代码都无法区分「预留」与「漏接」，而按 spec 字面实现的
 * 下一个人会写出第二个键，让真源出现两份互不相识的状态。
 *
 * 本锁把「声明」变成机械判据，四条各管一个失败方向：
 *   (b) 写侧会落的非成功态，读侧必须能显示——否则「写了盘用户看不见」重新变成可能；
 *   (c)(d) 闭集里**没有写入者**的取值，必须由 spec 的 reserved 标记逐字声明（预留），
 *          且一旦真的有了写入者，那条声明必须当场作废——不允许「声明」漂成谎言；
 *   (f) 闭集里每个取值至少要被一侧引用，防止死值长期挂在枚举里；
 *   (g) spec 不得再出现 `feedSync.result` 这种与本锁不同的第二个键名。
 * 删值/加值都要同时动 `FEED_SYNC_STATUSES`、spec 与这个标记，改动面被故意做窄。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import PodcastChannelService, { FEED_SYNC_STATUSES } from './podcast-channel-service'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const SPEC = path.join(__dir, '../../../../openspec/changes/podcast-oneclick-publish/specs/podcast-oneclick-publish/spec.md')

function read (rel) {
  return fs.readFileSync(path.join(__dir, rel), 'utf8').replace(/\r\n/g, '\n')
}

/** 取 const X = … 到行首 `})` 之间的片段；锚点缺失必须抛错，静默空串等于锁失效。 */
function sliceFrom (src, anchor, closer) {
  const at = src.indexOf(anchor)
  if (at < 0) throw new Error('结构锁锚点缺失：' + anchor)
  const end = src.indexOf(closer, at)
  if (end < 0) throw new Error('结构锁闭合锚点缺失：' + anchor)
  return src.slice(at, end)
}

function writeStatuses () {
  const src = read('podcast-hosting-service.js')
  const out = []
  const re = /writeFeedSync\(\{\s*status:\s*'([A-Za-z_]+)'/g
  let m
  while ((m = re.exec(src)) !== null) out.push(m[1])
  expect(out.length).toBeGreaterThan(0) // 解析退化为空集合时，下面所有判据都会恒真
  return out
}

function bannerStatuses () {
  const src = read('../../src/components/PodcastHostingCard.vue')
  const body = sliceFrom(src, 'const staleFeedSync', '\n})')
  const out = []
  const re = /===\s*'([A-Za-z_]+)'/g
  let m
  while ((m = re.exec(body)) !== null) out.push(m[1])
  expect(out.length).toBeGreaterThan(0)
  return out
}

/** spec 里的机器可读声明：<!-- feedSync-status-reserved: partial --> */
function reservedFromSpec () {
  const src = fs.readFileSync(SPEC, 'utf8').replace(/\r\n/g, '\n')
  const m = src.match(/<!--\s*feedSync-status-reserved:\s*([^>]*?)\s*-->/)
  if (!m) throw new Error('spec 缺少 feedSync-status-reserved 标记（闭集里存在无写入者的取值时必须声明）')
  return m[1].split(/[,\s]+/).filter(Boolean)
}

describe('feedSync.status · 写侧/读侧/spec 三向对账', () => {
  it('闭集逐字为 success|failed|partial，且 spec 点名引用同一份声明', () => {
    expect(FEED_SYNC_STATUSES).toEqual(['success', 'failed', 'partial'])
    expect(Object.isFrozen(FEED_SYNC_STATUSES)).toBe(true)
    expect(PodcastChannelService.FEED_SYNC_STATUSES).toBe(FEED_SYNC_STATUSES)
    const spec = fs.readFileSync(SPEC, 'utf8')
    expect(spec).toContain('FEED_SYNC_STATUSES')
    for (const s of ['success', 'failed', 'partial']) expect(spec).toContain(s)
  })

  it('写侧字面量必须落在闭集内（越界值当场红）', () => {
    for (const s of writeStatuses()) expect(FEED_SYNC_STATUSES).toContain(s)
  })

  it('写侧会落的非成功态，读侧必须能显示（「写了盘但界面看不见」不得复发）', () => {
    const banner = bannerStatuses()
    for (const s of writeStatuses()) {
      if (s === 'success') continue
      expect(banner, 'status=' + s + ' 有写入者却不在横幅判据里').toContain(s)
    }
  })

  it('读侧判据不得越过闭集', () => {
    for (const s of bannerStatuses()) expect(FEED_SYNC_STATUSES).toContain(s)
  })

  it('闭集里没有写入者的取值，必须恰好等于 spec 声明的预留集（双向）', () => {
    const writers = new Set(writeStatuses())
    const unwritten = FEED_SYNC_STATUSES.filter((s) => !writers.has(s))
    expect(unwritten).toEqual(reservedFromSpec())
    // 反向：已声明为预留的值不得真的有写入者（声明漂成谎言即红）
    for (const s of reservedFromSpec()) expect(writers.has(s)).toBe(false)
  })

  it('闭集里每个取值至少被写侧或读侧引用一次（不留无人认领的死值）', () => {
    const refs = new Set([...writeStatuses(), ...bannerStatuses()])
    for (const s of FEED_SYNC_STATUSES) expect(refs.has(s)).toBe(true)
  })

  it('spec 不得再出现第二个键名（feedSync.result 属历史草稿残留）', () => {
    const spec = fs.readFileSync(SPEC, 'utf8')
    expect(spec).not.toMatch(/feedSync\.result/)
    expect(spec).not.toMatch(/`result`\s*\//)
  })

  it('partial 无生产写入者这一事实必须在 spec 正文与 PRD 里各留一句可见说明', () => {
    const spec = fs.readFileSync(SPEC, 'utf8')
    expect(spec).toContain('暂无生产写入者')
    const prd = fs.readFileSync(path.join(__dir, '../../../../01-docs/PRD-PODCAST-ONECLICK-PUBLISH-2026-10-10.md'), 'utf8')
      .replace(/\r\n/g, '\n')
    expect(prd).toContain('暂无生产写入者')
  })
})
