// @ts-check
/**
 * knowledge-library-viral-engagement — 爆款库回采写回功能域（viral-library-integration P1-a）
 *
 * 从 knowledge-library-store 拆出，规避主 store 文件越过债务熔断 500 行预算（同 PR-1
 * engagement 拆分范式）。导出：
 * - _engagementNum：P0 契约原语（NULL=未知 / 0=真实零），主 store 与回采共用同一实现；
 * - _normUrlForMatch：URL 双侧匹配规范化纯函数；
 * - updateViralEngagementByNormUrl：回采写回方法（混入 store mixin，this 绑定 store 实例）。
 */
const log = require('../logger')

// P0 契约（viral-library-integration）：NULL = 未知（缺失/非法），0 = 真实零互动。
// 两者语义不得被 Number(x)||0 压平——下游统计（均值分母、ratio）依此区分。
function _engagementNum (v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) return null
  return Math.floor(n)
}

// P1-a（viral-library-integration）：URL 匹配规范化——协议 http/https 视同、host 小写、
// 去尾斜杠、去 utm_* 查询参与 fragment（path 段大小写保留，平台路径区分大小写不误合）。
// 两侧同函数（回采 URL vs viral_library.url），JS 侧比较，无 schema 迁移。
function _normUrlForMatch (url) {
  if (typeof url !== 'string') return ''
  let t = url.trim()
  if (!t) return ''
  t = t.replace(/^https?:\/\//i, '')
  t = t.split('#')[0]
  const m = t.match(/^([^/?]*)([\s\S]*)$/)
  const host = String((m && m[1]) || '').toLowerCase()
  const rest = String((m && m[2]) || '')
  const qi = rest.indexOf('?')
  let p = qi >= 0 ? rest.slice(0, qi) : rest
  const query = qi >= 0 ? rest.slice(qi + 1) : ''
  p = p.replace(/\/+$/, '')
  const kept = query.split('&').filter((kv) => kv && !/^utm_/i.test(kv.split('=')[0])).sort()
  return host + p + (kept.length ? '?' + kept.join('&') : '')
}

/**
 * 回采写回爆款库（viral-library-integration P1-a，主进程内部方法，无 IPC）：
 * 按 _normUrlForMatch 双侧匹配 viral_library.url，NULL 可补、变大可更新、变小拒绝+warn
 * （互动数只增不减是平台常识，减小视为解析错误）；likes 变化且 collections 已知时
 * 按 P0-c 口径重算 like_collect_ratio；updated_at 刷新；source 不变。
 * @param {string} url - 回采侧原始 URL
 * @param {{ likes?: number|null, comments?: number|null }} engagement - 未知字段跳过不动旧值
 * @returns {{ matched: number, updated: number }}
 */
function updateViralEngagementByNormUrl (url, engagement = {}) {
  if (!this._ready) return { matched: 0, updated: 0 }
  const norm = _normUrlForMatch(url)
  if (!norm) return { matched: 0, updated: 0 }
  try {
    const rows = this.db.prepare(
      "SELECT id, url, likes, comments, collections FROM viral_library WHERE url IS NOT NULL AND url <> ''"
    ).all() || []
    const now = new Date().toISOString()
    let matched = 0
    let updated = 0
    for (const row of rows) {
      if (_normUrlForMatch(row.url) !== norm) continue
      matched++
      const sets = []
      const args = []
      let effLikes = row.likes
      const merge = (field, raw) => {
        const next = _engagementNum(raw)
        if (next === null) return // 本轮回采对该字段未知 → 不动旧值
        const cur = _engagementNum(row[field])
        if (cur !== null) {
          if (next < cur) {
            log.warn('Store', 'updateViralEngagementByNormUrl: ' + field + ' decreased (' + cur + ' -> ' + next + '), rejected for id=' + row.id)
            return
          }
          if (next === cur) return
        }
        sets.push(field + ' = ?')
        args.push(next)
        if (field === 'likes') effLikes = next
      }
      merge('likes', engagement.likes)
      merge('comments', engagement.comments)
      if (!sets.length) continue
      const col = _engagementNum(row.collections)
      const lk = _engagementNum(effLikes)
      const ratio = (lk === null || col === null || col === 0)
        ? null
        : Math.round((lk / col) * 100) / 100
      sets.push('like_collect_ratio = ?')
      args.push(ratio)
      sets.push('updated_at = ?')
      args.push(now)
      args.push(String(row.id))
      this.db.prepare('UPDATE viral_library SET ' + sets.join(', ') + ' WHERE id = ?').run(...args)
      updated++
    }
    return { matched, updated }
  } catch (e) {
    log.warn('Store', 'updateViralEngagementByNormUrl failed: ' + e.message)
    return { matched: 0, updated: 0 }
  }
}

module.exports = { _engagementNum, _normUrlForMatch, updateViralEngagementByNormUrl }
