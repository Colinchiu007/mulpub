'use strict'
/**
 * 微信公众号 API 轨 —— 中性默认字段表（逐条取自参考产品实测契约）
 *
 * 为什么照抄一整份空默认值，而不是「省略不写」：
 * 公众号编辑器的保存请求体是**整表单提交**，参考产品（4.0）
 * `buildArticles()` 明确把这一整套字段写进 body（未用时置空串/0/`{}`/`[]`）。
 * 省略字段等于赌平台对缺字段的容错，而该容错没有一手证据；
 * 照抄则有"这套字段组合在真实后台跑通过"的间接证据。
 *
 * 维护纪律：本表是**契约快照**，不是"我们想要的字段"。改动任意一项都要
 * 在 PRD §5.3 与测试里同步说明，否则就是把别人的实测契约悄悄换成了猜测。
 */

/** 恒为空的字符串字段（编辑器表单里有、本次不使用）。 */
const EMPTY_STRING_FIELDS = [
  'music_id', 'video_id', 'voteid', 'voteismlt', 'supervoteid',
  'cardid', 'cardquantity', 'cardlimit', 'vid_type',
  'shortvideofileid', 'releasefirst', 'platform',
  'reprint_permit_type', 'allow_reprint', 'allow_reprint_modify',
  'ori_white_list', 'video_ori_status', 'hit_nickname', 'free_content',
  'ad_id', 'guide_words', 'share_copyright_url', 'source_article_type',
  'reprint_recommend_title', 'reprint_recommend_content',
  'share_video_id', 'share_voice_id', 'insert_ad_mode',
  'pay_fee', 'pay_preview_percent', 'pay_desc', 'compose_info',
]

/** 恒为 0 的数值字段。 */
const ZERO_FIELDS = [
  'is_cartoon_copyright', 'copyright_img_list', 'fee', 'is_share_copyright',
  'share_page_type', 'is_pay_subscribe', 'danmu_pub_type',
]

/** 恒为固定字面量的字段（与参考产品逐字一致）。 */
const LITERAL_FIELDS = {
  crop_list: '{}',
  show_cover_pic: '0',
  writerid: '0',
  fileid: '0',
  auto_gen_digest: '1',
  copyright_type: '0',
  is_private: 'false',
  fakeid: '',
  share_imageinfo: '{"list":[]}',
  dot: '{}',
  categories_list: '[]',
  appmsg_album_info: '{"appmsg_album_infos":[]}',
  can_insert_ad: '1',
  audio_info: '{"audio_infos":[]}',
}

/** 组装中性默认字段（不含文章内容字段）。 */
function neutralFields () {
  const out = {}
  for (const k of EMPTY_STRING_FIELDS) out[k] = ''
  for (const k of ZERO_FIELDS) out[k] = 0
  for (const [k, v] of Object.entries(LITERAL_FIELDS)) out[k] = v
  return out
}

module.exports = { neutralFields, EMPTY_STRING_FIELDS, ZERO_FIELDS, LITERAL_FIELDS }
