'use strict'
/**
 * 微信公众号适配器 —— API 轨接线（PRD-WECHAT-MP-API-TRACK-2026-10-12）
 *
 * 本文件曾是「可被调用但从不发布」的空壳：`publish()` 忽略入参 `postData`、
 * 只 `GET /cgi-bin/appmsgpublish?sub=list`（**已发布内容列表**），拿到
 * `base_resp.ret === 0` 就 `return { success: true, note: "Auth OK…" }`。
 * 调用方 `publishViaApi()` 因此正常 resolve，上层（HTTP 发布 API）会拿到
 * **假成功**——平台没建任何草稿，我们却报成功。这与上一轮修复的公众号
 * 「保存成功但草稿没内容」是同一类缺陷。
 *
 * 现在按参考产品（4.0）的实测契约真实发布，四段职责下沉到
 * `./wechat-mp/` 四个模块（会话 / 图片 / 草稿字段 / 错误），本文件只做接线：
 *   会话 bootstrap → 封面上传 → 建草稿（appMsgId 强校验）→ 回读校验
 *
 * 判据（R4）：**appMsgId 是唯一成功依据**，且回读三项必须齐全。
 */
const { BasePlatformAdapter } = require('../base-adapter')
const { stripTopicsFromContent } = require('../content-formatter')
const logger = require('../logger')
const { BASE, fetchSession, checkMassSendProtection } = require('./wechat-mp/session')
const { uploadImage, isPlatformCdn } = require('./wechat-mp/assets')
const { buildDraftBody, createDraft, readbackDraft } = require('./wechat-mp/draft')
const { publishArticle } = require('./wechat-mp/publish')
const { WechatMpError } = require('./wechat-mp/errors')

const DRAFT_EDIT_URL = BASE + '/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&type=77&lang=zh_CN'

function hostOf (url) {
  try { return new URL(String(url)).host } catch (e) { return '' }
}

class WechatMpAdapter extends BasePlatformAdapter {
  constructor () {
    super('wechat_mp')
    this.apiBase = BASE
  }

  getReferer () { return BASE + '/cgi-bin/appmsgpublish' }
  getOrigin () { return BASE }

  getHeaders (cookie, extra) {
    return super.getHeaders(cookie, {
      'Content-Type': 'application/x-www-form-urlencoded',
      authority: 'mp.weixin.qq.com',
      ...extra,
    })
  }

  /** 图文平台没有视频；显式返回 null（不误判为视频平台链路）。 */
  async uploadVideo () { return null }

  /**
   * 封面上传（独立入口，供 execute() 的封面分支或其他调用方使用）。
   * 失败直接抛——基类 execute 的 catch 会把它转成 fail-closed，
   * 不允许「封面没上去但继续发」（上一轮的故障形态）。
   */
  async uploadCover (taskData, cookie) {
    const source = String((taskData && (taskData.cover || taskData.cover_path)) || '')
    if (!source) return null
    const session = await fetchSession(this.http, { cookie })
    const uploaded = await uploadImage(this.http, { cookie, session, source })
    logger.info('wechat-mp-api:cover-uploaded', 'cover uploaded', { sourceKind: uploaded.sourceKind, urlHost: hostOf(uploaded.url) })
    return uploaded
  }

  buildPostData (taskData, uploadResult) {
    const td = taskData || {}
    // 话题内联描述：描述里已知话题剥离（公众号话题走标签字段，正文不重复携带）
    // 正文承载形态（publish-article-body-format）：本适配器**不**在此处包 `<p>` ——
    // 形态适配落在真正的平台字段边界 `adapters/wechat-mp/draft.js` 的 `buildArticleFields`
    // （`content0`），全链只此一处调用 `formatArticleBody('wechat_mp', …)`，避免两处口径。
    // 话题剥离保持在本层先做（正则 `(^|\s)#话题` 需要纯文本边界；包 `<p>` 后边界失效）。
    const stripped = stripTopicsFromContent(td.content || '', td.tags || [])
    const uploaded = uploadResult && uploadResult.cover
    const commentRaw = td.comment_setting !== undefined
      ? td.comment_setting
      : (td.openComment === false ? 0 : 3)
    return {
      title: td.title || '',
      content: stripped.content,
      tags: (td.tags || []).join(','),
      // 封面：execute 阶段已上传则复用（少一次往返）；否则只带来源，由 publish 自己传
      cover_url: (uploaded && uploaded.url) || '',
      cover_path: String(td.cover_path || td.cover || ''),
      // P1-4/P1-5/P3-3：摘要/作者/评论开关（参考产品 digest/author/need_open_comment）
      digest: String(td.digest || '').slice(0, 120),
      author: String(td.author || '').slice(0, 60),
      commentSetting: commentRaw,
      contentSourceUrl: String(td.content_source_url || ''),
      isOriginal: td.is_original === true || td.original === true,
      allowFastReprint: td.allow_fast_reprint === true,
      openFansMsg: td.open_fans_msg === true,
      disableRecommend: td.disable_recommend === true,
      // 发布方式（wechat-mp-publish-track）：draft（默认，只进草稿箱）/ publish（发布，不推送粉丝）/ masssend（群发，推送粉丝）
      publishMode: td.publish_mode || (td.mass_send === true ? 'masssend' : (td.free_publish === true ? 'publish' : 'draft')),
      publishTime: Number(td.publish_time) || 0,
      // 定向群发参数（参考产品 buildPushData 消费；缺省即全量）
      sex: td.sex, groupId: td.group_id, country: td.country, province: td.province, city: td.city,
      isMulti: Array.isArray(td.contentList) && td.contentList.length > 1,
    }
  }

  /**
   * @param {string} cookie
   * @param {object} postData 由 buildPostData 构造
   * @returns {Promise<{success: boolean, platform: string, publishId?: string, url?: string, code?: string, error?: string}>}
   */
  async publish (cookie, postData) {
    const pd = postData || {}
    try {
      // D6：多图文不做半成品
      if (Array.isArray(pd.contentList) && pd.contentList.length > 1) {
        throw new WechatMpError('multi-article-unsupported', '当前版本一次只支持单篇图文，草稿未创建')
      }
      // D7：正文为空 ⇒ 不建草稿（上一轮的故障形态正是「只有标题的草稿」）
      if (!String(pd.content || '').trim()) {
        throw new WechatMpError('draft-not-created', '微信公众号草稿创建失败：正文为空，已中止保存')
      }
      // 封面：已是平台 CDN 就直接用；否则必须能拿到本地来源
      let coverUrl = isPlatformCdn(pd.cover_url) ? String(pd.cover_url) : ''
      const coverSource = String(pd.cover_path || '')
      if (!coverUrl && !coverSource) {
        throw new WechatMpError('cover-required', '微信公众号发布需要封面图片：请先生成或选择封面后重试')
      }

      const session = await fetchSession(this.http, { cookie })
      logger.info('wechat-mp-api:session-ok', 'session ready', {
        hasTicket: Boolean(session.ticketId && session.ticket),
        canAppMsg: session.canAppMsg,
      })

      if (!coverUrl) {
        const uploaded = await uploadImage(this.http, { cookie, session, source: coverSource })
        coverUrl = uploaded.url
        logger.info('wechat-mp-api:cover-uploaded', 'cover uploaded', { sourceKind: uploaded.sourceKind, urlHost: hostOf(coverUrl) })
      }

      const article = {
        title: pd.title || '',
        content: pd.content,
        digest: pd.digest || '',
        author: pd.author || '',
        contentSourceUrl: pd.contentSourceUrl || '',
        commentSetting: pd.commentSetting,
        isOriginal: pd.isOriginal,
        allowFastReprint: pd.allowFastReprint,
        openFansMsg: pd.openFansMsg,
        disableRecommend: pd.disableRecommend,
        coverUrl,
      }

      const body = buildDraftBody(article, 0)
      const { appMsgId } = await createDraft(this.http, { cookie, session, body, count: 1 })

      const rb = await readbackDraft(this.http, { cookie, session, appMsgId, expect: { title: article.title, content: article.content, coverUrl } })
      logger.info('wechat-mp-api:readback', 'draft readback', rb)
      if (!rb.ok) {
        throw new WechatMpError(
          'readback-mismatch',
          '草稿已提交但校验未通过（标题/正文/封面不齐），请到公众号后台草稿箱确认后再决定是否重发',
          rb
        )
      }

      logger.info('wechat-mp-api:draft-created', 'draft created', { appMsgId: String(appMsgId) })

      // 发布方式分支（wechat-mp-publish-track）：draft ⇒ 到此为止；publish/masssend ⇒ 走完整发布链
      const publishMode = pd.publishMode || 'draft'
      if (publishMode !== 'draft') {
        // 群发前置：群发保护预检（只在要群发时请求；失败 fail-open，真正失败由发送链报告）
        const protection = await checkMassSendProtection(this.http, { cookie, session, massSend: publishMode === 'masssend' })
        if (protection && protection.ok === false) {
          throw new WechatMpError('mass-send-protected', protection.error, protection)
        }
        const sent = await publishArticle(this.http, {
          cookie,
          token: session.token,
          appMsgId: String(appMsgId),
          publishMode,
          // 测试注入口：sendPush 重试等待（默认 5s 真实等待）
          delayFn: this.pushDelayFn || undefined,
          task: { publishTime: pd.publishTime, sex: pd.sex, groupId: pd.groupId, country: pd.country, province: pd.province, city: pd.city, isMulti: pd.isMulti },
        })
        if (!sent.ok) {
          throw new WechatMpError(sent.code || 'masssend-push-failed', sent.error || '发布失败', sent.response)
        }
        logger.info('wechat-mp-api:published', 'article published', { appMsgId: String(appMsgId), publishMode, retried: sent.retried })
        return {
          success: true,
          platform: 'wechat_mp',
          publishId: String(appMsgId),
          url: DRAFT_EDIT_URL + '&appmsgid=' + encodeURIComponent(String(appMsgId)) + '&token=' + encodeURIComponent(session.token),
          draft: false,
          publishMode,
          retried: sent.retried,
        }
      }

      return {
        success: true,
        platform: 'wechat_mp',
        publishId: String(appMsgId),
        url: DRAFT_EDIT_URL + '&appmsgid=' + encodeURIComponent(String(appMsgId)) + '&token=' + encodeURIComponent(session.token),
        draft: true,
      }
    } catch (e) {
      const code = (e && e.code) || 'draft-not-created'
      const message = (e && e.message) || '微信公众号发布失败'
      logger.warn('wechat-mp-api:failed', 'publish failed: ' + code, { code, detail: (e && e.detail) || undefined })
      return { success: false, platform: 'wechat_mp', code, error: message, detail: e && e.detail }
    }
  }
}

module.exports = WechatMpAdapter
