// @ts-check
'use strict'
/**
 * rpa-overseas/youtube.js — YouTube 发布（fail-closed）
 *
 * ## 为什么要重写而不是沿用 rpa-view-platforms.js 里的旧实现
 *
 * 旧实现（`rpa-view-platforms.js` 内 `_publish_youtube`，本 PR 已迁出）有 **5 个 fail-open**：
 *
 * 1. 上传等待超时只 `log.warn`，**继续往下走** ⇒ 上传被掐断卡在中途（如 76%）也算成功；
 * 2. 发布按钮点击失败被 `catch` 吞掉，**仍然 `return {success:true}`**；
 * 3. 没有「受众：非儿童向」必填项；
 * 4. 没有标签；
 * 5. 没有「发布后回读」⇒ 点了按钮就当发了。
 *
 * 这与本仓自己在 `_publish_generic` 里立的纪律直接冲突
 * （"草稿模式不得在什么都没写进去时报成功…假成功比失败危险"）。
 *
 * ## 关键实现细节（都来自真机踩过的坑，不是防御性编程）
 *
 * ① **上传必须等真传完**：浏览器上传靠窗口开着才传得完，
 *    传到一半就点发布并关浏览器 = 上传被掐断。
 *    判据读 `.progress-label` 的文案（"处理/检查/上传完成"），最多等 30 分钟。
 *
 * ② **标题/简介必须一次性灌入，不能逐字输入**：
 *    标题里的 `#`（如 #Shorts）会触发 YouTube 的话题自动补全下拉浮层，
 *    逐字输入会让浮层持续跟随光标弹出、盖住后续「继续/发布」按钮 ⇒ 上传流程卡死。
 *    ⇒ 用 `_setElementContentSafe`（设 innerHTML + 派发 input/change）一次性写入，
 *      并在写完后主动 blur + Escape 关掉可能弹出的浮层。
 *
 * ③ **发布成功的判据是「回读到作品链接」**，不是「点了发布按钮」。
 *    顺带覆盖了「按钮点不到」这种情况（helper 的 `_click` 恒返回 true，不抛错，
 *    所以不能靠它的返回值判定点击成功）。
 */

const { getOverseasSelectors } = require('./selectors')
const { formatArticleBody } = require('@multi-publish/api-publish-engine/src/content-formatter')
const { verifyPublished } = require('./shared')

/** YouTube 上传页（登录未登录都会到这里；未登录会被重定向到 accounts.google.com） */
const YOUTUBE_UPLOAD_URL = 'https://www.youtube.com/upload'
/** Studio 首页（仅用于登录态判定与人工排查，不作为发布入口） */
const YOUTUBE_STUDIO_URL = 'https://studio.youtube.com/'

/** 上传完成的文案判据（页面侧函数字面量；必须硬编码，禁止拼接） */
const UPLOAD_DONE_FN = 'function(){var els=document.querySelectorAll(".progress-label,span.progress-label,ytcp-video-upload-progress");' +
  'for(var i=0;i<els.length;i++){var t=(els[i].innerText||els[i].textContent||"");' +
  'if(/处理|检查|上传完成|已上传|Processing|complete|Checks|Finished/i.test(t))return true}return false}'

/**
 * 安全读当前 URL（窗口可能已销毁）。
 * @param {any} win
 * @returns {string}
 */
function safeUrl (win) {
  try { return String(win.webContents.getURL() || '') } catch (e) { return '' }
}

/**
 * YouTube 发布（fail-closed）
 * @param {any} win
 * @param {any} article
 * @param {{publishVerifyTimeoutMs?: number, uploadWaitTimeoutMs?: number, selectors?: object}} [opts]
 *        超时可注入：默认值供真机使用；测试用小值，避免用例真等（测试键里不能含不稳定量）。
 *        `selectors` 是**显式注入点**：只允许代码/测试注入，绝不从请求体取值。
 *        它的作用是让测试能换掉选择器表、从而**证明实现读的是表而不是自己拼的**
 *        （表里的候选与硬编码字面量相同时，行为断言恒真 ⇒ 锁没牙齿）。
 * @returns {Promise<{success: boolean, platform: string, error?: string, url?: string, verified?: boolean, evidence?: object, warnings?: string[]}>}
 */
async function publishYoutube (win, article, opts) {
  const options = opts || {}
  const publishVerifyTimeoutMs = Number.isFinite(options.publishVerifyTimeoutMs)
    ? options.publishVerifyTimeoutMs
    : 60000
  const uploadWaitTimeoutMs = Number.isFinite(options.uploadWaitTimeoutMs)
    ? options.uploadWaitTimeoutMs
    : 1800000
  // 选择器来源：默认取真源表 + 本仓增量表；测试可显式注入一张假表来验证「读的是表」。
  const sel = (options.selectors && typeof options.selectors === 'object')
    ? options.selectors
    : getOverseasSelectors('youtube')
  const warnings = []
  const fail = (reason) => ({
    success: false,
    platform: 'youtube',
    error: 'youtube ' + reason,
    verified: false,
    warnings: warnings.length ? warnings : undefined,
  })

  // ---------- 1. 导航到上传页 ----------
  // 平台配置（config/platforms.yaml）是 publish_url 的单一真源；此处常量仅作缺省兜底。
  this._emitProgress('youtube', 'navigating to upload page...', 5)
  let uploadUrl = YOUTUBE_UPLOAD_URL
  try {
    const cfg = this._getPlatformConfig('youtube', article)
    if (cfg && cfg.publish_url) uploadUrl = cfg.publish_url
  } catch (e) {
    warnings.push('platform config unreadable, using built-in upload url')
  }
  await this._navigateAndWait(win, uploadUrl, 3000)

  const curUrl = safeUrl(win)
  if (/accounts\.google\.com|\/signin|ServiceLogin/i.test(curUrl)) {
    return fail('not logged in (url=' + curUrl.slice(0, 120) + ')')
  }

  // ---------- 2. 必须有视频文件 ----------
  if (!article || !article.video_path) {
    return fail('needs video file')
  }

  // ---------- 3. 注入视频文件 ----------
  this._emitProgress('youtube', 'uploading video...', 25)
  const fileSel = sel.file_input.join(', ')
  if (!await this._waitForElement(win, fileSel, 20000)) {
    return fail('file input not found')
  }
  try {
    await this._setFileInput(win, article.video_path, fileSel)
  } catch (e) {
    return fail('file upload failed: ' + (e && e.message ? e.message : String(e)))
  }

  // ---------- 4. 等详情对话框（标题框出现 = 文件已附加） ----------
  this._emitProgress('youtube', 'waiting for details dialog...', 35)
  if (!await this._waitForElement(win, '#title-textarea', 120000)) {
    return fail('details dialog not ready (title textarea not found)')
  }

  // ---------- 5. 标题（一次性灌入 + 关补全浮层） ----------
  this._emitProgress('youtube', 'filling title...', 55)
  if (article.title) {
    const ok = await this._setElementContentSafe(win, sel.title_input.join(', '), String(article.title))
    if (!ok) warnings.push('title element not found')
    await dismissAutocomplete(win)
  }

  // ---------- 6. 简介 ----------
  this._emitProgress('youtube', 'filling description...', 62)
  if (article.content) {
    const body = formatArticleBody('youtube', String(article.content))
    if (body) {
      const ok = await this._setElementContentSafe(win, sel.desc_textarea.join(', '), body)
      if (!ok) warnings.push('description element not found')
      await dismissAutocomplete(win)
    }
  }

  // ---------- 7. 封面（失败不致命） ----------
  if (article.cover_path) {
    try {
      const coverSel = sel.cover_input.join(', ')
      if (await this._waitForElement(win, coverSel, 8000)) {
        await this._setFileInput(win, article.cover_path, coverSel)
      } else {
        warnings.push('cover input not found (skipped)')
      }
    } catch (e) {
      warnings.push('cover upload skipped: ' + (e && e.message ? e.message : String(e)))
    }
  }

  // ---------- 8. 受众：非儿童向（点不到只告警，不阻断） ----------
  try {
    const audienceSel = sel.audience_not_for_kids.join(', ')
    if (await this._waitForElement(win, audienceSel, 8000)) {
      await this._click(win, audienceSel)
    } else {
      warnings.push('audience radio not found (未显式设置「非儿童向」)')
    }
  } catch (e) {
    warnings.push('audience radio click failed: ' + (e && e.message ? e.message : String(e)))
  }

  // ---------- 9. 标签（在「显示更多」折叠区里） ----------
  if (Array.isArray(article.tags) && article.tags.length) {
    try {
      await this._click(win, sel.tags_toggle.join(', '))
      await this._sleep(800)
      await this._fillInput(win, sel.tags_input.join(', '), article.tags.join(',') + ',')
    } catch (e) {
      warnings.push('tags fill skipped: ' + (e && e.message ? e.message : String(e)))
    }
  }

  // ---------- 10. 连点「下一步」直到可见性步骤 ----------
  this._emitProgress('youtube', 'next steps...', 72)
  for (let i = 0; i < 5; i++) {
    const visSel = sel.visibility_btn.join(', ')
    // ⚠️ `_waitForElement` 是 querySelector 语义（取**第一个**匹配），
    //    而 visibility_btn 的首个候选是 `name="PUBLIC"` —— 该 radio 只在
    //    「可见性」步骤才渲染 ⇒ 前面步骤里查它等于「还没到可见性步骤」。
    if (await this._waitForElement(win, visSel, 5000)) break
    try {
      await this._click(win, sel.next_btn.join(', '))
      // ⚠️ 点完 Next 必须**等下一步渲染完**再判：否则等待超时会被误读成
      //    「还没到可见性步骤」⇒ 再点一次 Next ⇒ 可能连跳两步、跳过可见性设置。
      await this._sleep(2000)
    } catch (e) {
      warnings.push('next button click failed at step ' + (i + 1))
      break
    }
  }

  // ---------- 11. 可见性 ----------
  this._emitProgress('youtube', 'setting visibility...', 78)
  const privacy = String(article.privacy || 'public').toLowerCase()
  const privacyMap = { public: 'PUBLIC', unlisted: 'UNLISTED', private: 'PRIVATE' }
  const visName = privacyMap[privacy] || 'PUBLIC'
  // ⚠️ 选择器**只从 selectors 表取**（不在实现里硬编码选择器形状）⇒ 单一真源。
  //   可见性候选取 `visibility_radio[可见性]` 这个**显式映射**，不做字面子串匹配。
  const wantRadio = (sel.visibility_radio && sel.visibility_radio[visName]) || ''
  try {
    if (wantRadio && await this._waitForElement(win, wantRadio, 5000)) {
      await this._click(win, wantRadio)
    } else {
      warnings.push('visibility radio not found (未显式设置可见性)')
    }
  } catch (e) {
    warnings.push('visibility click failed: ' + (e && e.message ? e.message : String(e)))
  }

  // ---------- 12. 等上传真正完成（超时 = 失败，不放行） ----------
  this._emitProgress('youtube', 'waiting for upload completion...', 85)
  const uploadDone = await this._waitForCondition(win, UPLOAD_DONE_FN, uploadWaitTimeoutMs, 5000)
  if (!uploadDone) {
    return fail('upload did not complete within 30min (可能上传被掐断，不放行)')
  }

  // ---------- 13. 点发布 ----------
  this._emitProgress('youtube', 'publishing...', 92)
  try {
    await this._click(win, sel.publish_btn.join(', '))
  } catch (e) {
    return fail('publish button click failed: ' + (e && e.message ? e.message : String(e)))
  }

  // ---------- 14. 回读作品链接（= 发布的正证据） ----------
  // ⚠️ helper 的 `_click` 恒返回 true，不抛错 ⇒ 点击成功与否**不能**靠它的返回值判定。
  //    这里用「回读到作品链接」统一覆盖「点不到」与「点了没生效」两种情况。
  this._emitProgress('youtube', 'verifying published video...', 96)
  const evidence = await waitForPublishedLink.call(this, win, sel.published_link || [], publishVerifyTimeoutMs)
  if (!evidence) {
    return fail('published but video link not found (无法证明内容已发出)')
  }

  const verify = await verifyPublished(win, 'youtube', { accountId: article.accountId })
  return {
    success: true,
    platform: 'youtube',
    verified: !!verify.verified,
    url: evidence.videoUrl,
    evidence: { videoUrl: evidence.videoUrl, verify },
    warnings: warnings.length ? warnings : undefined,
  }
}

/**
 * 关闭 YouTube 的话题自动补全浮层。
 * 先 blur（失焦通常即收起）；仍可见再派发 Escape。
 * @param {any} win
 */
async function dismissAutocomplete (win) {
  try {
    await win.webContents.executeJavaScript(
      '(function(){' +
      'var a=document.activeElement;if(a&&a.blur)a.blur();' +
      'var d=document.querySelector("tp-yt-iron-dropdown");' +
      'if(d)d.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));' +
      'return true})()'
    )
  } catch (e) { /* 浮层没弹出来时忽略 */ }
}

/**
 * 轮询回读作品链接。
 * ⚠️ 必须以 `call(this, ...)` 调用：内部要用宿主 mixin 的 `_sleep`。
 * @param {any} win
 * @param {string[]} selectors
 * @param {number} timeoutMs
 * @returns {Promise<{videoUrl: string}|null>}
 */
async function waitForPublishedLink (win, selectors, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 60000)
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const q = JSON.stringify(sel)
      try {
        const href = await win.webContents.executeJavaScript(
          '(function(){var e=document.querySelector(' + q + ');return e?(e.getAttribute("href")||""):""})()'
        )
        if (typeof href === 'string' && href) return { videoUrl: href }
      } catch (e) { /* 下一候选 */ }
    }
    await this._sleep(3000)
  }
  return null
}

module.exports = {
  publishYoutube,
  dismissAutocomplete,
  waitForPublishedLink,
  YOUTUBE_UPLOAD_URL,
  YOUTUBE_STUDIO_URL,
  UPLOAD_DONE_FN,
}
