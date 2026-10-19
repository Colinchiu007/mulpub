#!/usr/bin/env node
/**
 * shipinhao-session-probe.cjs — 视频号会话活性探针（只读授权请求，不传内容、不发稿）
 *
 * ## 用途
 * 视频号的 HTTP 登录检测结构性不确定（应用自身 `accountCheckLogin` 返回
 * `CHECK_LOGIN_INCONCLUSIVE`，见 openspec/records/shipinhao-session-probe.md §1.2）。
 * 唯一可信的活性验证是**真实走链第一步 `getUploadAuthKey`**——
 * 本脚本只发这一条授权请求，不上传任何内容、不发布。
 *
 * ## 用法
 *   node scripts/shipinhao-session-probe.cjs <cookie串> <finderId> [finderUin]
 *
 * cookie 来源（任选）：
 *   ① 账号管理 → 视频号 → 设置 里导出；
 *   ② 信封库解密（credential-store）—— 该读取路径尚未暴露成脚本参数。
 *
 * ## 结论判定（对齐 shipinhao-video.js 既有两码语义）
 *   authKey 非空            → ACTIVE（会话可用）
 *   errCode 300012/300014   → EXPIRED（登录失效，需重新扫码）
 *   其它非零                → BLOCKED_OR_CHANGED（风控/改版，人工看 message）
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

function main () {
  const [cookie, finderId, finderUin] = process.argv.slice(2)
  if (!cookie || !finderId) {
    console.log('用法: node scripts/shipinhao-session-probe.cjs <cookie串> <finderId> [finderUin]')
    console.log('  cookie: 视频号创作者平台的完整 cookie 串')
    console.log('  finderId: _log_finder_id（账号管理信封里的视频号标识）')
    process.exit(2)
  }
  const { ShipinhaoVideoChain } = require('../src/publish/platforms/shipinhao-video')
  const chain = new ShipinhaoVideoChain({
    cookie, finderId, finderUin: finderUin || finderId, userAgent: UA,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  chain.getUploadAuthKey()
    .then((authKey) => {
      const s = typeof authKey === 'string' ? authKey : JSON.stringify(authKey)
      console.log('VERDICT = ACTIVE')
      console.log('authKey = ' + String(s).slice(0, 80) + (String(s).length > 80 ? '…' : ''))
    })
    .catch((e) => {
      const msg = String((e && e.message) || e)
      if (/300012|300014|登录|未登录/.test(msg)) {
        console.log('VERDICT = EXPIRED（登录失效，请重新扫码）')
      } else {
        console.log('VERDICT = BLOCKED_OR_CHANGED（风控或改版，人工看 message）')
      }
      console.log('detail = ' + msg.slice(0, 300))
      process.exit(1)
    })
}

main()
