// @ts-check
/**
 * publish-precondition — 发布前置门禁（publish-precondition-gate，2026-10-18）
 *
 * ## 修的是什么
 *
 * 2026-10-17 批量发布 9 平台 6 失败，其中两条的真实错误被**下游症状**掩盖：
 *
 *   头条 → 报 `publish btn not found`
 *     真因：`videoPublishUrls.toutiao` 指向西瓜视频上传页
 *     （`profile_v4/xigua/upload-video`），而 `PLATFORM_PUBLISH_SELECTORS.toutiao`
 *     是**图文文章页**那一套、且**没有 `file_input`** ⇒
 *     日志 `file input hasVideo=true selectorCount=0` ⇒ 上传整段被跳过 ⇒
 *     标题/正文/发布按钮全部落空，最终在最后一步报「找不到发布按钮」。
 *
 *   抖音 → 报 `publish timeout`
 *     真因：日志 `video upload-complete signal not detected … continuing best-effort`
 *     + `douyin title: fill not applied (readback=0)` ⇒ 上传未确认、标题未写入，
 *     仍继续点发布（平台因必填项为空而拒绝）⇒ 65s 后超时。
 *
 * 两条同源：**上游关键步骤失败后没有 fail-fast，而是「尽力继续」，最终在
 * 「发布/验证」阶段以一条与根因无关的错误收尾**。后果不只是文案错：
 *   · 用户以为「平台抽风」，实际是我们没把内容送进去；
 *   · 发布按钮点击是**副作用动作**，白点一轮就是一次真实提交尝试（风控面）；
 *   · 失败落进「已提交」分类会吃掉整个发布间隔窗口（视频号 60′）。
 *
 * ## 判据
 *
 * 在**点发布按钮之前**断言「内容真的进去了」的四个最小前提：
 *   P1 有视频 ⇒ 平台必须登记了 `file_input` 选择器（否则是「未实现」，不是「失败」）
 *   P2 有视频 ⇒ 上传阶段必须确认完成（`fillReport.upload.ok === true`）
 *   P3 有标题且平台非 no-title 合并路径 ⇒ 标题必须写入成功
 *   P4 有正文 ⇒ 正文必须写入成功
 *
 * 三条不可破：
 *  ① **只在点发布之前判**。这里失败 ⇒ 平台写操作**必然没有发生**，因此调用方
 *    可以显式标 `definitelyNotSent`（早于任何提交），比「靠错文本猜」可靠得多；
 *  ② **不放宽判据**。缺选择器就是未实现（fail-closed 拒绝），不尝试「猜一个
 *    button 点点看」——猜错会命中「定时发布」这类危险控件；
 *  ③ **文案必须可操作**：说清「哪个环节没成」「本次没发出」「要不要重新登录/改用图文」。
 */

/**
 * 失败原因枚举。值同时是 `fillReport` 与诊断里的机器可读标识，**不要改名**。
 * @readonly
 */
const REASONS = Object.freeze({
  UPLOAD_SELECTOR_MISSING: 'upload-selector-missing',
  UPLOAD_NOT_COMPLETED: 'upload-not-completed',
  TITLE_NOT_FILLED: 'title-not-filled',
  CONTENT_NOT_FILLED: 'content-not-filled',
  UPLOAD_EXCEPTION: 'upload-exception',
})

/** 平台显示名（文案用；缺省回退平台 id）。 */
const PLATFORM_LABELS = Object.freeze({
  wechat_mp: '微信公众号',
  zhihu: '知乎',
  douyin: '抖音',
  xiaohongshu: '小红书',
  tencent_video: '视频号',
  kuaishou: '快手',
  toutiao: '今日头条',
  bilibili: 'Bilibili',
  baijiahao: '百家号',
  weibo: '微博',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  twitter: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
})

/** 视频入口缺失时的平台专属补充说明（只说事实，不承诺能力）。 */
const VIDEO_ENTRY_HINTS = Object.freeze({
  toutiao: '头条视频走西瓜视频上传页，但本仓尚未登记该页的上传入口选择器（图文链路不受影响）',
})

/**
 * 平台显示名。
 * @param {string} platform
 * @returns {string}
 */
function labelOf (platform) {
  return PLATFORM_LABELS[platform] || String(platform || '该平台')
}

/**
 * 失败文案（面向用户）。四条固定结构：
 *   ① 哪个平台 ② 哪个环节 ③ 本次是否发出 ④ 下一步做什么
 * @param {string} reason
 * @param {string} platform
 * @param {{ detail?: string }} [ctx]
 * @returns {string}
 */
function describeFailure (reason, platform, ctx) {
  const name = labelOf(platform)
  const detail = ctx && ctx.detail ? String(ctx.detail) : ''
  const tail = '本次未向平台提交任何内容，也未占用发布间隔。'
  switch (reason) {
    case REASONS.UPLOAD_SELECTOR_MISSING: {
      const hint = VIDEO_ENTRY_HINTS[platform] || '本仓尚未登记该平台的视频上传入口选择器'
      return name + ' 视频发布尚未支持：' + hint + '。' + tail + '请改用图文发布，或改用其他平台。'
    }
    case REASONS.UPLOAD_NOT_COMPLETED:
      return name + ' 视频上传未完成' + (detail ? '（' + detail + '）' : '')
        + '，已中止，未点击发布。' + tail + '请重试；若反复失败请确认视频文件可正常播放、体积未超平台上限。'
    case REASONS.UPLOAD_EXCEPTION:
      return name + ' 视频上传出错' + (detail ? '（' + detail + '）' : '')
        + '，已中止，未点击发布。' + tail + '请重试。'
    case REASONS.TITLE_NOT_FILLED:
      return name + ' 标题未写入' + (detail ? '（' + detail + '）' : '')
        + '，已中止，未点击发布。' + tail + '请重试；若反复失败请检查标题长度是否超平台上限。'
    case REASONS.CONTENT_NOT_FILLED:
      return name + ' 正文未写入' + (detail ? '（' + detail + '）' : '')
        + '，已中止，未点击发布。' + tail + '请重试；若反复失败请检查正文字数是否超平台上限。'
    default:
      return name + ' 发布前置检查未通过' + (detail ? '（' + detail + '）' : '') + '，已中止，未点击发布。' + tail
  }
}

/**
 * 评估发布前置条件。
 *
 * @param {object} input
 * @param {string} input.platform 平台 id
 * @param {object} input.article 文章/视频载荷（用 `video_path` / `title` / `content`）
 * @param {object} [input.selectors] 平台选择器（用 `file_input`）
 * @param {object} [input.fillReport] 填表结果（用 `upload` / `title` / `content`）
 * @param {boolean} [input.draftOnly] 草稿模式（不点发布，前置判据只关心落库）
 * @param {boolean} [input.noTitlePlatform] 平台无独立标题框（标题并入描述，P3 不适用）
 * @returns {{ ok: true } | { ok: false, reason: string, message: string, detail?: string }}
 */
function evaluatePublishPreconditions (input) {
  const src = input || {}
  const platform = String(src.platform || '')
  const article = src.article || {}
  const selectors = src.selectors || {}
  const report = src.fillReport || {}

  const hasVideo = Boolean(article.video_path)
  const hasTitle = Boolean(article.title)
  const hasContent = Boolean(article.content)

  const fail = (reason, detail) => ({
    ok: false,
    reason,
    ...(detail ? { detail: String(detail) } : {}),
    message: describeFailure(reason, platform, { detail }),
  })

  // P1：有视频但平台没登记上传入口 ⇒ 「未实现」，不是「失败」
  if (hasVideo) {
    const inputs = Array.isArray(selectors.file_input) ? selectors.file_input : []
    if (inputs.length === 0) return fail(REASONS.UPLOAD_SELECTOR_MISSING)
  }

  const upload = report.upload
  if (hasVideo) {
    // P2：上传必须**被确认**完成。缺 upload 记录 = 上传块根本没执行（选择器为空、
    //     或流程提前跳过），与「执行了但失败」同样不许继续。
    if (!upload || typeof upload !== 'object') return fail(REASONS.UPLOAD_NOT_COMPLETED, '上传阶段未执行')
    if (upload.ok !== true) {
      if (upload.reason === REASONS.UPLOAD_EXCEPTION || upload.error) {
        return fail(REASONS.UPLOAD_EXCEPTION, upload.error || upload.detail)
      }
      return fail(REASONS.UPLOAD_NOT_COMPLETED, upload.detail || '未检测到上传完成信号')
    }
  }

  // P3：标题（no-title 平台把标题并进描述，由 P4 覆盖）
  if (hasTitle && !src.noTitlePlatform) {
    const title = report.title
    if (!title || title.ok !== true) return fail(REASONS.TITLE_NOT_FILLED, title && title.error)
  }

  // P4：正文
  if (hasContent) {
    const content = report.content
    if (!content || content.ok !== true) return fail(REASONS.CONTENT_NOT_FILLED, content && content.error)
  }

  return { ok: true }
}

module.exports = {
  REASONS,
  PLATFORM_LABELS,
  VIDEO_ENTRY_HINTS,
  labelOf,
  describeFailure,
  evaluatePublishPreconditions,
}
