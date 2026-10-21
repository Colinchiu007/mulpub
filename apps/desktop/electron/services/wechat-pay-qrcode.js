'use strict'
/**
 * wechat-pay-qrcode.js — 微信 Native `code_url` → 二维码 data URL（主进程侧）。
 *
 * 为什么在主进程而不是渲染层：
 *   ① `qrcode` 的 Node 入口会拖进 pngjs / yargs 等，打进渲染层 bundle 是纯浪费；
 *   ② 主进程只把已有约定格式（`data:image/svg+xml;base64,…`）交给渲染层，
 *      渲染层不需要知道任何二维码细节，也不需要新依赖。
 *
 * 为什么用成熟的 `qrcode` 而不是手写编码器（**对 PRD D3 的显式偏离**）：
 *   PRD-WECHAT-PAY-INTEGRATION §7.2 原定「手写 QR 编码器，零新依赖」。实际评估后推翻：
 *   手写 Byte 模式 + RS 纠错 + 掩码选择 + 格式信息共 350+ 行，而**本机没有任何扫码器/参考
 *   向量可以验证它真的能扫**。对支付路径来说，「生成一张看起来像码但扫不出的图」等于零收入，
 *   且故障形态极隐蔽（界面一切正常）。`qrcode` 是 MIT、周下载千万级的工业实现，
 *   用确定性换正确性，这个取舍在资金链路上是划算的。
 *
 * 选型细节：
 *   - 纠错级 **M**（15% 恢复率）：扫码场景容错与码面密度的常用平衡点
 *   - `margin: 1`：微信扫码对静默区要求不严，1 模块足够，码面更紧凑
 *   - 输出 **SVG**：矢量、无位图内存、任意缩放不失真
 */

const QRCode = require('qrcode')

// `weixin://wxpay/bizpayurl?pr=...` 通常 60–110 字符。上限放到 1024 是为了挡住
// 「上游把整段 JSON 塞进 code_url」这类异常，不是正常的长度预期。
const MAX_QR_TEXT_LENGTH = 1024

const QR_OPTIONS = Object.freeze({
  type: 'svg',
  errorCorrectionLevel: 'M',
  margin: 1,
})

/**
 * `code_url` → `data:image/svg+xml;base64,…`。
 *
 * 两条 fail-closed：
 *   - 空/非字符串 → 抛 `QR_TEXT_INVALID`（绝不返回一张空码让用户对着扫）
 *   - 超长 → 抛 `QR_TEXT_TOO_LONG`（不静默截断；截断会生成一张「看起来像码」的假码）
 */
async function toQrDataUrl (codeUrl, options = {}) {
  if (typeof codeUrl !== 'string' || codeUrl.trim().length === 0) {
    throw Object.assign(new Error('二维码内容为空'), { code: 'QR_TEXT_INVALID' })
  }
  const text = codeUrl.trim()
  if (text.length > MAX_QR_TEXT_LENGTH) {
    throw Object.assign(new Error('二维码内容超长'), { code: 'QR_TEXT_TOO_LONG' })
  }
  const svg = await QRCode.toString(text, { ...QR_OPTIONS, ...(options.qrOptions || {}) })
  if (typeof svg !== 'string' || svg.indexOf('<svg') !== 0) {
    // 库返回了非 SVG：宁可报错也不把未知内容当图片交给渲染层
    throw Object.assign(new Error('二维码生成结果不是 SVG'), { code: 'QR_RENDER_FAILED' })
  }
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64')
}

module.exports = { toQrDataUrl, MAX_QR_TEXT_LENGTH, QR_OPTIONS }
