'use strict'

/**
 * 头条直连桥必须按内容类型取选择器（toutiao-bridge-content-type，2026-10-21）
 *
 * ── 动因（真机实证）─────────────────────────────────────────
 * 2026-10-21 用**已认证**新头条号 45261bb5 跑视频发布，被 fail-closed 拒绝：
 *   「今日头条 视频发布尚未支持：头条视频走西瓜视频上传页，但本仓尚未登记该页的上传入口选择器」
 *   submitAttempted=false（未提交、未占间隔）
 *
 * 但选择器**其实早已登记**（`PLATFORM_PUBLISH_SELECTORS.toutiao_video`，
 * 2026-10-18 真机取证，file_input/title_input/desc/publish_btn 齐全），
 * 且 `resolvePublishSelectors` 会按 `article.video_path` 自动合并。
 *
 * 真因：`toutiao-direct-bridge.js` 里 `host._getPlatformConfig('toutiao')`
 * **没传 article** ⇒ `resolvePublishSelectors` 收到 `article=undefined`
 * ⇒ `wantsVideo=false` ⇒ 返回**图文**选择器（无 file_input）⇒ 门禁误判"未实现"。
 *
 * ── 锁两条 ──────────────────────────────────────────────────
 * ① 头条桥必须传 article（否则视频选择器永不生效）；
 * ② contentType 已按 video_path 判，桥内不能再出现"不传 article 的取配置调用"。
 *
 * 判据模式：静态结构锁（读真实源码断言），同 douyin-dom-publish-id.test.js。
 */

const fs = require('node:fs')
const path = require('node:path')

function loadSrc () {
  const P = path.resolve(__dirname, '../src/toutiao-direct-bridge.js')
  return fs.readFileSync(P, 'utf8')
}

describe('头条直连桥按内容类型取选择器', () => {
  const src = loadSrc()

  test('① 取平台配置必须传 article（否则视频选择器永不生效）', () => {
    // 旧形状：host._getPlatformConfig('toutiao')  ← 漏 article
    expect(/host\._getPlatformConfig\('toutiao'\)/.test(src)).toBe(false)
    // 新形状：host._getPlatformConfig('toutiao', article)
    expect(/host\._getPlatformConfig\('toutiao',\s*article\)/.test(src)).toBe(true)
  })

  test('② contentType 仍按 video_path 判（不被本次改动破坏）', () => {
    expect(/const contentType = article\.video_path \? 'video' : 'image'/.test(src)).toBe(true)
  })

  test('③ 传给 _publish_generic 的 article 含 video_path（合并选择器的前提）', () => {
    // _publish_generic 的 4 参 publishConfig 里必须带本次 article（含 video_path），
    // 否则即使配置取对，通用链内部仍按图文走。
    expect(/host\._publish_generic\(win,\s*\{\s*\.\.\.article,\s*content:\s*plainContent\s*\},\s*' toutiao'/.test(src) === false).toBe(true)
    expect(/host\._publish_generic\(win,\s*\{\s*\.\.\.article/.test(src)).toBe(true)
  })
})
