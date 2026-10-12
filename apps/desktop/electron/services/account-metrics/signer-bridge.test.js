// @ts-check
/**
 * 签名桥回归（QM-6 后端轴 MAJOR：签名基址口径）
 *
 * 发布链对同一个 `xiaohongshu.x-s-browser` 命令默认只把 **pathname + search** 交给 `_webmsxyw`
 * （`api-publish-engine/src/publish/platforms/xiaohongshu-draft.js:184-191`）。采集侧原先传绝对 URL，
 * 而平台按请求行复算 ⇒ 签名不匹配、采集恒被拒，且旧实现不读 `MP_XHS_SIGN_URI`、无法用现成开关纠正。
 */
import { describe, it, expect, afterEach } from 'vitest'

const { xhsSignatureHeaders, signBaseUri } = require('./signer-bridge')

const ORIGINAL = process.env.MP_XHS_SIGN_URI
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MP_XHS_SIGN_URI
  else process.env.MP_XHS_SIGN_URI = ORIGINAL
})

describe('signBaseUri', () => {
  it('默认转成 pathname + search（与发布链同口径）', () => {
    expect(signBaseUri('https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/analyze/list?type=0&page_num=1'))
      .toBe('/api/galaxy/creator/datacenter/note/analyze/list?type=0&page_num=1')
  })

  it('MP_XHS_SIGN_URI=absolute 时才用绝对 URL（保留唯一出口的既有语义）', () => {
    process.env.MP_XHS_SIGN_URI = 'absolute'
    expect(signBaseUri('https://creator.xiaohongshu.com/a/b?c=1')).toBe('https://creator.xiaohongshu.com/a/b?c=1')
  })

  it('非法/空输入原样返回，不抛错', () => {
    expect(signBaseUri('')).toBe('')
    expect(signBaseUri('not-a-url')).toBe('not-a-url')
    expect(signBaseUri(null)).toBe('')
  })
})

describe('xhsSignatureHeaders', () => {
  it('对象形态（extractor 直接回对象）取 X-s/X-t', () => {
    expect(xhsSignatureHeaders({ 'X-s': 'XYW_abc', 'X-t': '1791541509850' }))
      .toEqual({ 'X-s': 'XYW_abc', 'X-t': '1791541509850' })
  })

  it('JSON 字符串形态同样可解析（历史实现两种都出现过）', () => {
    expect(xhsSignatureHeaders('{"X-s":"XYW_abc","X-t":"1"}')).toEqual({ 'X-s': 'XYW_abc', 'X-t': '1' })
  })

  it('裸签名串缺少 X-t ⇒ null（X-t 是必填头，缺了平台必拒，不得只发 X-s）', () => {
    expect(xhsSignatureHeaders('XYW_abc')).toBeNull()
  })

  it('结构不可识别 ⇒ null（编排层据此报 unsupported，绝不硬发）', () => {
    for (const bad of [null, undefined, '', {}, { 'X-s': 'a' }, 123, []]) {
      expect(xhsSignatureHeaders(bad), String(bad)).toBeNull()
    }
  })
})
