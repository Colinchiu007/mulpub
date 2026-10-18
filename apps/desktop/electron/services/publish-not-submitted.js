// @ts-check
/**
 * 「可确证未送出」判定（publish-frequency-policy-v2 P0-1 的细粒度补点）
 *
 * 背景：执行器层（bootstrap.js）只能区分「进入 publish() 之前 / 之内」。进入之后的失败默认
 * 按**已提交**处理（保守）。但其中有一族失败是**可以证明平台写操作从未发生**的 ——
 * 登录态失效 / 凭证缺失 —— 它们本不该吃掉整个间隔窗口。
 *
 * ⚠️ 标记错误的方向性后果不对称，必须记牢：
 *   · 把「已送出」误标为「未送出」 ⇒ 回滚窗口 ⇒ 早于窗口的重复发布（**危险侧**）
 *   · 把「未送出」漏标       ⇒ 多等一个窗口                  （安全侧）
 * 所以判据是**封闭词表**，每条都必须能说明「它为什么必然发生在平台写之前」，
 * 且**不得**收录泛化错误（如「API 发布失败」「网络超时」—— 前者可能发生在提交之后）。
 *
 * 契约（消费方为 task-queue._maybeRollback 与 bootstrap.js 执行器）：
 *   命中 ⇒ 在 Error 实例上置 `definitelyNotSent = true`（不改变 message、不吞错误）
 */

/**
 * 封闭词表。新增条目必须同时给出「发生在平台写之前」的机制性理由。
 *
 * ⚠️ 评审 i2 之后的收窄（实测教训，勿回退）：
 *   原词表还含 `未登录|登录失效|登录超时|请重新登录|请先登录` 这些中文短语。它们**不能**
 *   证明「未送出」—— `rpa-view-platforms.js` 的失败检测正则里就有 `登录失效|请登录`，
 *   那是**动作之后**从页面文本判出来的，此时内容可能已经被平台接收。若据此打标，
 *   已提交窗口会被误回滚 ⇒ 早于窗口的重复发布（危险侧）。
 *   现在只保留 **RPA 各平台登录态早退**的确切英文措辞（`<platform> not logged in`，
 *   见 rpa-view-platforms.js 的 early-return 点）与**发出请求之前**的凭证缺失。
 * @type {ReadonlyArray<{ re: RegExp, why: string }>}
 */
const NOT_SENT_SIGNATURES = Object.freeze([
  {
    re: /not logged in/i,
    why: 'RPA 各平台在导航到发布页后先判登录态并 early-return（rpa-view-platforms.js 多处），'
      + '发生在任何表单填充/提交之前 —— 这是唯一被实测确认「必然早于平台写」的措辞',
  },
  {
    re: /Cookie 缺失|凭证不可用|凭证缺失/,
    why: 'API 直连轨在 cookie 为空时于发出任何请求之前抛出（publisher-router ApiPublisher）。'
      + '注意：该分支已在源码里**无条件**打标，词表收录只为让判定与文档同源',
  },
  {
    re: /风控挂起|RiskSuspended/,
    why: '风控挂起由执行器在派发之前拦截，未进入任何平台请求（与进入 publish() 之前的失败同族，'
      + '此处收录只为闭合词表；实际不会走到发布器的失败出口）',
  },
])

/**
 * 判断一段错误文本是否属于「可确证未送出」族。
 * @param {string} text
 * @returns {boolean}
 */
function isProvablyNotSubmitted (text) {
  if (typeof text !== 'string' || !text) return false
  return NOT_SENT_SIGNATURES.some((s) => s.re.test(text))
}

/**
 * 命中词表时在错误对象上打标。
 * 返回值语义是**「判定文本命中词表」**，不是「已成功写属性」—— 传字符串时无法写属性
 * （字符串不可变），但判定结果照样为 true，调用方可据此决定自己的处理。
 * 不修改 message、不吞错误、不抛：调用方随后照常 throw 同一个对象。
 * @param {Error|object|string} err
 * @param {string} [text] - 判定文本；缺省取 err.message（err 本身是字符串时就取它）
 * @returns {boolean} 是否命中「可确证未送出」词表
 */
function markDefinitelyNotSent (err, text) {
  const probe = typeof text === 'string' && text
    ? text
    : (typeof err === 'string' ? err : (err && err.message) || '')
  if (!isProvablyNotSubmitted(probe)) return false
  if (err && typeof err === 'object') err.definitelyNotSent = true
  return true
}

/** 供结构锁/文档使用：导出词表（只读） */
function listSignatures () {
  return NOT_SENT_SIGNATURES.map((s) => ({ source: s.re.source, why: s.why }))
}

/**
 * 按发布器结果打「可确证未送出」标：**显式标优先，词表兜底**。
 *
 * 两条通道刻意分开、互不放宽：显式标来自发布器在**点发布按钮之前**的拦截
 * （`publish-precondition.js` 的上传/标题/正文/能力四判据），那一刻平台写操作必然未发生；
 * 词表兜底只能靠错误文本，判据弱一档，所以不得反过来放宽显式通道的语义。
 * @param {Error|object} err 要打标的对象
 * @param {{definitelyNotSent?:boolean, error?:string}} result 发布器返回的结果
 * @returns {boolean} 是否已标记为未送出
 */
function markNotSentByResult (err, result) {
  if (result && result.definitelyNotSent === true) {
    if (err && typeof err === 'object') err.definitelyNotSent = true
    return true
  }
  return markDefinitelyNotSent(err, result && result.error)
}

module.exports = { isProvablyNotSubmitted, markDefinitelyNotSent, markNotSentByResult, listSignatures, NOT_SENT_SIGNATURES }
