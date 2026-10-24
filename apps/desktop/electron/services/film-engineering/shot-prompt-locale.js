// @ts-check

/**
 * 语种回退的**统一函数**（design D21.3）。
 *
 * doctrine / palette / 任务模板三处都走这一条规则：**缺该语种 ⇒ 回落 zh**，并把回退事实记进
 * `fallbackLocales`（按来源分组，design D22）⇒ 消费方分得清是哪一处回退。
 * ⚠ 回退事实必须进哈希（否则「换语种 ⇒ 哈希不变」⇒ 重开项目检不出资产变了）。
 */

/**
 * 取双语对象的指定语种，**缺该语种回退 zh**（design D21.3 的统一回退函数）。
 * @param {any} obj - {zh, en}
 * @param {string} locale
 * @returns {{text: string, fallback: boolean, resolved: string}}
 */
function pickLocaleText (obj, locale) {
  const loc = locale === 'en' ? 'en' : 'zh'
  const o = obj && typeof obj === 'object' ? obj : {}
  const primary = typeof o[loc] === 'string' && o[loc].trim() ? o[loc] : ''
  if (primary) return { text: primary, fallback: false, resolved: loc }
  const zh = typeof o.zh === 'string' && o.zh.trim() ? o.zh : ''
  if (!zh) return { text: '', fallback: false, resolved: loc }
  return { text: zh, fallback: true, resolved: 'zh' }
}

module.exports = {
  pickLocaleText,
}
