/**
 * wechat-mp-profile-parser.js — 公众号（wechat_mp）登录页模板的身份解析
 *
 * 为什么从 http-profile-api.js 拆出来（2026-10-23）：
 * ① 逐文件行数门禁（500 行阻断）：公众号模板解析把 http-profile-api.js 顶到 643 行；
 * ② 关注点独立：这段逻辑只跟**公众号登录页模板**有关，与「资料来源表」「取数编排」无关，
 *    单独成模块后不会被别的平台的字段路径挤占。
 *
 * 依赖方向单向：profile-value-rules ← wechat-mp-profile-parser ← http-profile-api
 * （login-checker 侧也复用本模块的 parseWechatMpIdentity 取 uid —— 登录判定与资料提取
 * 读的是同一页，各写一份正则必然漂移）。
 *
 * 本模块**无 logger**：解析失败只返回结构化 `reason`，由调用方决定要不要出声 ——
 * 解析器自己打日志会让「同一段解析」在不同调用点产生不同副作用。
 */
const { normalizeUid } = require('./platform-uid')
const {
  trimText,
  normalizeAvatarUrl,
  isPlausibleNickname,
  TEMPLATE_PLACEHOLDER_RE,
} = require('./profile-value-rules')

/**
 * 可解析页面的体积上限（CCG 评审 i6）。
 * 正常公众号登录页约 60KB ⇒ 2MB 是「异常大」的量级，不是正常页面的量级。
 * 超过它就**整体不解析**（而不是截断）—— 截断会把 `head_img` 之类的字段切掉，
 * 制造「解析不出」与「字段不在」两种不同的假空值，排查时反而更糊。
 */
const MAX_PARSE_HTML_BYTES = 2 * 1024 * 1024

/**
 * 登录页形态关键词 —— **唯一真源**（CCG 评审 i5）。
 *
 * 此前同一份关键词在三处各抄了一遍（解析器、资料提取侧的告警判定、登录判定的 checkHtml），
 * 改一处忘另一处就会让「判定未登录」与「判定已登录」在两处给出相反结论。
 * 现在只在这里定义一次，调用方一律 import。
 */
const LOGIN_PAGE_KEYWORDS_RE = /扫码登录|请使用微信扫码|请登录|welcome_login/

/**
 * 字段取值表 —— **模块初始化时一次性构建**（CCG 评审 i4 / i6）。
 *
 * 为什么不留成「按需编译 + Map 缓存」：字段集合是**封闭的 5 个**，
 * 动态编译等于把一份常量表变成运行期可变状态（导出面还要多背一个内部缓存），
 * 而收益为零。表建好之后：① 没有每次调用现编正则的开销；② 没有「内部状态被导出」的面；
 * ③ 新增字段必须显式登记（漏登记 ⇒ 取不到，而不是悄悄取错）。
 *
 * 每项按**同种引号闭合**取（`"…"` 配对 / `'…'` 配对），因此值里可以含**异种**引号
 * （CCG 评审 i5：合并成 `[^"']*` 会让含引号的昵称被静默截断）。
 * 真实模板里同种引号若要出现在值中必须被转义（模板的转义形态是 HTML 实体 `&quot;`），
 * 所以同种引号闭合不会漏掉真值。
 */
const FIELD_MATCHERS = (() => {
  const esc = (f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const quoted = (field) => ([
    new RegExp('(?<![A-Za-z0-9_])' + esc(field) + '\\s*:\\s*"([^"]*)"'),
    new RegExp('(?<![A-Za-z0-9_])' + esc(field) + "\\s*:\\s*'([^']*)'"),
  ])
  // 函数名与左括号之间允许空白（CCG 评审 i3：`handlerNickname (` 也该匹配 ——
  // 模板改个空格不该让昵称静默消失，而模板什么时候改不由我方决定）。
  const callArg = (field) => ([
    new RegExp(esc(field) + '\\s*:\\s*\\w+\\s*\\(\\s*"([^"]*)"'),
    new RegExp(esc(field) + "\\s*:\\s*\\w+\\s*\\(\\s*'([^']*)'"),
  ])
  return {
    nick_name_decode: { call: callArg('nick_name_decode') },
    real_nick_name: { quoted: quoted('real_nick_name') },
    nick_name: { quoted: quoted('nick_name') },
    head_img: { quoted: quoted('head_img') },
    head_url: { quoted: quoted('head_url') },
  }
})()

/**
 * 按给定的正则组依次匹配，取第一个命中的捕获组。
 * @param {RegExp[]} patterns
 * @param {string} html
 * @returns {string|null}
 */
function matchFirst (patterns, html) {
  for (const re of patterns) {
    const m = re.exec(html)
    if (m) return m[1]
  }
  return null
}

/**
 * 取「字段: "值"」或「字段: '值'」形态的值。
 * @param {string} html
 * @param {string} field
 * @returns {string|null}
 */
function matchQuotedValue (html, field) {
  const entry = FIELD_MATCHERS[field]
  if (!entry || !entry.quoted) return null
  return matchFirst(entry.quoted, html)
}

/**
 * 取「字段: fn("值")」形态的值（如 `nick_name_decode: handlerNickname("名字", false)`）。
 * @param {string} html
 * @param {string} field
 * @returns {string|null}
 */
function matchCallArg (html, field) {
  const entry = FIELD_MATCHERS[field]
  if (!entry || !entry.call) return null
  return matchFirst(entry.call, html)
}

/**
 * 公众号 loginpage HTML 的身份解析 —— **唯一实现**。
 * 登录判定表（uid 提取）与账号资料表（昵称 + 头像 + uid）读的是同一页，
 * 各写一份正则必然漂移（昵称抽到了但 uid 没抽到这类半命中最难查）。
 *
 * 依赖与校验（CCG 评审 i3）：
 * - 依赖：页面模板内嵌 `window.wx.commonData.data` 账号资料对象，字段见下表。
 *   模板改版会让这里取不到 —— 属**如实降级**（取不到就不产出，不猜），
 *   不做「换个正则再试」，因为那只会把「模板变了」伪装成「账号没登录」。
 * - 校验：uid 走 `normalizeUid` 形态白名单（占位值 `0`/`null`/`{{userId}}` 一律拒绝）；
 *   昵称/头像拒绝空串与模板占位（`{{nickname}}` 之类），避免把模板变量当账号资料落库。
 *
 * 字段判据来自**真实服务端页面模板**（2026-10-23 实测，模板自带注释）：
 *   uin              账号 ID（数字）
 *   nick_name        // encode 一次            → 只 encode 过，**可能是转义残渣**
 *   nick_name_decode // encode 一次 decode 一次，因为空格需要特殊转义处理 → **显示用这个**
 *   real_nick_name   // 真实 nick_name，后台无兜底逻辑，未设置则返回空
 *   head_img         // ''.replace('http://', 'https://') → **头像**（平台自己把 http 换成 https）
 *   head_url         → 头像的另一种 URL 形态（head_img 缺失时回落）
 *
 * 失败可诊断（CCG 评审 i3）：`reason` 给出**结构化失败原因**，让「模板改版」与
 * 「字段值不合法」可区分 —— 二者的修法完全不同（前者要改解析，后者要改校验）。
 * @param {unknown} html
 * @returns {{nickname: string, platformAccountId: string, avatar: string, reason: string}}
 */
function parseWechatMpIdentity (html) {
  const empty = { nickname: '', platformAccountId: '', avatar: '', reason: 'no_html' }
  if (!html || typeof html !== 'string') return empty
  // 异常大页面兜底（CCG 评审 i6）：错误页/广告注入可能返回超大页面，
  // 正则扫描代价随之线性增长。**只拦异常大**——正常页面（~60KB）不能截断，
  // 截断会把 `head_img` 之类的字段切掉，反而制造假空值。
  // 判据按**字节**算（`String.length` 是 UTF-16 单元数，中文页会低估体积）。
  if (Buffer.byteLength(html, 'utf8') > MAX_PARSE_HTML_BYTES) {
    return { nickname: '', platformAccountId: '', avatar: '', reason: 'page_too_large' }
  }
  // 明确登录页形态优先短路：即便页面内出现示例 uin / nick_name 也不产出
  // （与 checkHtml 同一黑名单口径 —— 关键词是同一份，见 LOGIN_PAGE_KEYWORDS_RE）
  if (LOGIN_PAGE_KEYWORDS_RE.test(html)) return { nickname: '', platformAccountId: '', avatar: '', reason: 'login_page' }
  const uinMatch = /uin:\s{0,}"([0-9]{3,})"/.exec(html)
  const uid = normalizeUid(uinMatch && uinMatch[1])

  // 昵称三候选，按「显示正确性」排序：解码后的 > 真实昵称 > 只 encode 过的。
  // 取值用「同种引号闭合」（matchCallArg / matchQuotedValue），避免含引号的昵称被静默截断。
  const candidates = [
    matchCallArg(html, 'nick_name_decode'),
    matchQuotedValue(html, 'real_nick_name'),
    matchQuotedValue(html, 'nick_name'),
  ]
  let nickname = ''
  let nicknameRejected = false
  for (const raw of candidates) {
    const candidate = trimText(raw)
    if (!candidate) continue
    // 模板占位值（`{{nickname}}`）= **字段在、但服务端没填**（CCG 评审 i1）。
    // 它与「字段不存在」是两种事实：前者是「值不合格」，后者才是「字段缺失」。
    // 混为一谈会让 reason 误报成 identity_fields_missing（⇒ 误判成「模板改版」），
    // 而真实原因多半只是「这次没渲染出昵称」。故占位值同样计入「取到了但不合格」。
    if (TEMPLATE_PLACEHOLDER_RE.test(candidate)) { nicknameRejected = true; continue }
    if (!isPlausibleNickname(candidate)) { nicknameRejected = true; continue }
    nickname = candidate
    break
  }

  // 头像：head_img（平台自己把 http:// 换成 https://）→ head_url 回落
  // 原始值**单独留变量**：下方 reason 判定要区分「页面里根本没有头像字段」
  // 与「有字段但值不合法（scheme 被拒）」—— 只看归一后的 avatar 区分不了。
  const rawHeadImg = matchQuotedValue(html, 'head_img')
  const rawHeadUrl = matchQuotedValue(html, 'head_url')
  const avatar = normalizeAvatarUrl(rawHeadImg) || normalizeAvatarUrl(rawHeadUrl)

  // 失败原因（结构化，便于排查「模板改版」vs「值不合法」）
  let reason = ''
  if (!uid && !nickname && !avatar) {
    reason = nicknameRejected ? 'identity_fields_invalid' : 'identity_fields_missing'
  } else if (!nickname && nicknameRejected) {
    reason = 'nickname_invalid'
  } else if (!avatar && (rawHeadImg || rawHeadUrl)) {
    reason = 'avatar_rejected_scheme'
  }

  return { nickname, platformAccountId: uid, avatar, reason }
}

module.exports = {
  parseWechatMpIdentity,
  // 登录页关键词必须留在导出面：登录判定侧（http-login-checker.js）复用同一份，
  // 这正是本轮消除「三处各抄一遍」的关键（CCG 评审 i4）。
  LOGIN_PAGE_KEYWORDS_RE,
}
