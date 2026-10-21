/**
 * wechat-pay-qrcode 契约测试（vitest 全局风格，与 electron/services 下其他测试一致）。
 *
 * 判据不能只是「返回了一个字符串」——那对「码能不能扫」零信息。这里锁四件事：
 *   ① **模块矩阵可复算**：用 `qrcode.create()` 取同一文本的 module 数，
 *      断言 SVG 的 viewBox 边长是 `(size + 2 × margin)` 的整数倍（改纠错级/margin 会当场红）
 *   ② **确定性**：同一输入两次输出逐字节相同（否则 UI 每次重渲染都在闪）
 *   ③ **fail-closed**：空串/非字符串/超长一律抛错，绝不返回空码或截断码
 *   ④ **不是常量**：不同内容产出不同码
 */

const QRCode = require('qrcode')

const { toQrDataUrl, MAX_QR_TEXT_LENGTH } = require('./wechat-pay-qrcode')

const SAMPLE = 'weixin://wxpay/bizpayurl?pr=AbCdEfGhIjKlMnOpQrStUv'
const PREFIX = 'data:image/svg+xml;base64,'

function decodeSvg (dataUrl) {
  expect(dataUrl.startsWith(PREFIX)).toBe(true)
  const svg = Buffer.from(dataUrl.slice(PREFIX.length), 'base64').toString('utf8')
  expect(svg.startsWith('<svg')).toBe(true)
  return svg
}

describe('toQrDataUrl', () => {
  it('输出是 SVG data URL，且 viewBox 边长与模块矩阵规模匹配', async () => {
    const svg = decodeSvg(await toQrDataUrl(SAMPLE))
    const qr = QRCode.create(SAMPLE, { errorCorrectionLevel: 'M' })
    const size = qr.modules.size
    expect(size).toBeGreaterThanOrEqual(21)
    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
    expect(viewBox).not.toBeNull()
    const side = Number(viewBox[1])
    // margin: 1 ⇒ 总边长 = (size + 2) × 整数缩放
    expect(side % (size + 2)).toBe(0)
    expect(side).toBeGreaterThan(0)
  })

  it('确定性：同一输入两次输出逐字节相同', async () => {
    expect(await toQrDataUrl(SAMPLE)).toBe(await toQrDataUrl(SAMPLE))
  })

  it('首尾空白被裁掉（不把空白编进码里）', async () => {
    expect(await toQrDataUrl(`  ${SAMPLE}  `)).toBe(await toQrDataUrl(SAMPLE))
  })

  it('空串/非字符串 → QR_TEXT_INVALID（绝不返回空码）', async () => {
    for (const bad of ['', '   ', null, undefined, 123, {}]) {
      await expect(toQrDataUrl(bad)).rejects.toMatchObject({ code: 'QR_TEXT_INVALID' })
    }
  })

  it('超长 → QR_TEXT_TOO_LONG，且上限值本身仍可生成（不把上限写小）', async () => {
    await expect(toQrDataUrl('a'.repeat(MAX_QR_TEXT_LENGTH + 1))).rejects.toMatchObject({ code: 'QR_TEXT_TOO_LONG' })
    await expect(toQrDataUrl('a'.repeat(MAX_QR_TEXT_LENGTH))).resolves.toBeTruthy()
  })

  it('不同内容产出不同码（不是常量）', async () => {
    expect(await toQrDataUrl(SAMPLE)).not.toBe(await toQrDataUrl(`${SAMPLE}X`))
  })
})
