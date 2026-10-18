// @ts-check
/**
 * 上传时序与上传完成强判定 —— 结构锁（publish-precondition-gate，2026-10-18 拆出）
 *
 * 为什么单独成文件：这三条锁原在 `rpa-view-platforms.test.js` 里，而该文件已
 * 1524 行、超过 1500 测试行数上限（`.github/scripts/check-max-lines.js` 的
 * `testLimit`）。上传整段下沉到 `upload-waiter._runVideoUpload` 后新增了跨文件
 * 证据，判据必须跟着改形态——继续塞回原文件只会把「超限」再推高。
 *
 * 三条锁守的都是**顺序不变量**，只是证据现在跨了两个文件：
 *   ① `_publish_generic` 里「调用上传」必须早于「filling title...」
 *   ② 注入文件之后必须有「编辑器表单就绪等待」（否则还在上传落地页就填字段）
 *   ③ 上传完成必须走**强判定** `_waitForVideoUploadComplete`（blob 预览不算完成）
 */
const fs = require('fs')
const platformsMixin = require('./rpa-view-platforms')

/** 主文件 + 拆分文件的合并文本（拆走的方法不会断锁）。 */
function readPlatformsSource () {
  const parts = [fs.readFileSync(require.resolve('./rpa-view-platforms'), 'utf-8')]
  for (const rel of ['./rpa-publish-id-extract', './rpa-view-navigation-helpers', './upload-waiter', './rpa-view-artifacts']) {
    try { parts.push(fs.readFileSync(require.resolve(rel), 'utf-8')) } catch (_) { /* 拆分文件可缺省 */ }
  }
  return parts.join('\n')
}

function genericBody () {
  const source = readPlatformsSource()
  const start = source.indexOf('async _publish_generic')
  const end = source.indexOf('\n  // ========== ', start + 10)
  return source.slice(start, end > 0 ? end : undefined)
}

function uploadBody () {
  const source = fs.readFileSync(require.resolve('./upload-waiter'), 'utf-8')
  const start = source.indexOf('async _runVideoUpload')
  const end = source.indexOf('\n  /**', start + 10)
  return source.slice(start, end > 0 ? end : undefined)
}

describe('rpa-view-platforms — 视频上传时序与完成强判定', () => {
  it('视频上传发生在标题填充之前（调用点在 generic，注入点在下沉实现里）', () => {
    const body = genericBody()
    const uploadIdx = body.indexOf('this._runVideoUpload(')
    const titleIdx = body.indexOf("'filling title...'")
    expect(uploadIdx).toBeGreaterThan(-1)
    expect(titleIdx).toBeGreaterThan(-1)
    expect(uploadIdx).toBeLessThan(titleIdx)
    // 真正注入文件的地方在下沉的实现里
    expect(uploadBody()).toContain('_setFileInput(win, article.video_path')
  })

  it('上传后有编辑器表单就绪等待（而非直接填字段）', () => {
    const body = uploadBody()
    const setFileIdx = body.indexOf('_setFileInput(win, article.video_path')
    const waitIdx = body.indexOf('_waitForCondition')
    const formWarnIdx = body.indexOf('editor form not ready after upload')
    expect(setFileIdx).toBeGreaterThan(-1)
    expect(waitIdx).toBeGreaterThan(setFileIdx)
    expect(formWarnIdx).toBeGreaterThan(setFileIdx)
    // 表单就绪判据本身仍必须盯标题/正文候选
    expect(body).toContain('input[placeholder*="标题"]')
  })

  it('视频上传完成强判定存在于 generic 与 douyin 两条链路', () => {
    const source = readPlatformsSource()
    expect(source).toMatch(/async\s+_waitForVideoUploadComplete\s*\(/)
    // generic 链路：走下沉实现，实现里必须用强判定（不是旧的 !p||s 弱判据）
    expect(genericBody()).toContain('this._runVideoUpload(')
    expect(uploadBody()).toContain('this._waitForVideoUploadComplete(')
    const douyinStart = source.indexOf('async _publish_douyin')
    const douyinEnd = source.indexOf('\n  async _', douyinStart + 10)
    const douyinBody = source.slice(douyinStart, douyinEnd > 0 ? douyinEnd : undefined)
    expect(douyinBody).toContain('this._waitForVideoUploadComplete(')
    // blob 本地预览在注入瞬间就存在，判定必须要求 https 服务端预览源（smoke5 实锤）
    expect(source).toMatch(/currentSrc/)
    expect(source).toMatch(/indexOf\("https:"\)===0/)
  })

  it('下沉后的上传实现三态记录齐备（未实现/已确认/未确认）', () => {
    const body = uploadBody()
    expect(body).toContain("reason: 'upload-selector-missing'")
    expect(body).toContain('fillReport.upload = uploadDone')
    // 「重试用尽但没结论」必须按未完成记，不得默认成功
    expect(body).toMatch(/重试已用尽/)
  })

  it('mixins 导出包含 uploadWaiter（接线锁：拆走的实现真的挂回了 platformsMixin）', () => {
    expect(typeof platformsMixin._runVideoUpload).toBe('function')
    expect(typeof platformsMixin._waitForVideoUploadComplete).toBe('function')
  })
})
