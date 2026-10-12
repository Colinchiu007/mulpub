// @ts-check
/**
 * publish-record-cover.js — 发布历史记录的封面字段**单一真源**
 *
 * 缺陷背景（2026-10-12 用户报障「历史记录页的缩略图不是发布的真实封面」）：
 * 消费端 `PublishHistory.vue` 的 `thumbnailUrl(record)` 找
 * `thumbnail|thumbnailUrl|cover|coverUrl`，但两个落库点
 * （`bootstrap/phase4-events.js` 的 `task:success` / `task:failed`）
 * 调 `history.addRecord()` 时**一个封面键都没写** —— 表达式恒空、模板回退平台图标。
 *
 * 因此本模块服务的是「写侧」：把该次发布**实际使用的封面**归一成两个稳定键。
 * 为什么不复用发布器返回的 `result.cover*`：`result` 是各平台发布器的原始返回，
 * 形状逐平台不同（多数平台根本不返回封面），消费端理解不了。
 *
 * 契约（只增不改，与既有键共存）：
 *   - `cover_path`：本地绝对路径（渲染层经 `cover:read-data` 转 dataURL 才能显示，
 *     因为渲染层 CSP 的 img-src 不含 `file:`）。
 *   - `cover_url` ：远程 `http(s)` 地址。
 *   - **两者互斥**：本地封面胜出时 `cover_url` 必须为空串。
 *     依据是仓库既有结论（`src/features/publish/publish-upload-file.js` 的
 *     `resolveCoverFields`）：「本地封面胜出时清空 URL，残留 URL 不得遮蔽用户刚选中的文件」。
 *     记录里留两个非空值，会把消费端的优先级规则重新变成两处判据。
 *   - 无封面时**写空串而不是 undefined**：`JSON.stringify` 会丢掉 `undefined` 键，
 *     消费端就分不清「这次没有封面」与「这个字段从来没被写过」。
 */
const { safeHttpUrl } = require('@multi-publish/shared-utils/src/safe-http-url')

/** 本地图片路径判据：盘符 / UNC / POSIX 绝对路径 / file:// */
function isLocalImagePath (value) {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (!v) return false
  if (/^file:\/\//i.test(v)) return true
  if (v.startsWith('\\\\')) return true
  if (/^[a-zA-Z]:[\\/]/.test(v)) return true
  if (v.startsWith('/')) return true
  return false
}

/** `file:///D:/a.png` → `D:/a.png`；`file://server/share/a.png` → `//server/share/a.png` */
function toLocalPath (value) {
  const v = String(value).trim()
  const m = /^file:\/\/(.*)$/i.exec(v)
  if (!m) return v
  const rest = m[1]
  // 三斜杠形态：file:///D:/a.png → rest = "/D:/a.png"，去掉前导斜杠得到盘符路径
  return /^\/[a-zA-Z]:[\\/]/.test(rest) ? rest.slice(1) : rest
}

function pickFirst (list) {
  for (const raw of list) {
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }
  return ''
}

/**
 * 把一次发布的文章负载归一成历史记录的封面字段。
 *
 * 优先级：`cover_path` → `cover_file.path` → `images[0]`（本地候选），
 * 本地候选全失配时再按同一顺序取第一个合法 `http(s)` 作为 `cover_url`
 * （`cover_url` 字段自身排在这条远程链的最前）。
 *
 * @param {object} article 任务的文章负载（`task.article`）
 * @returns {{cover_path: string, cover_url: string}}
 */
function resolveRecordCover (article) {
  const a = article && typeof article === 'object' && !Array.isArray(article) ? article : {}
  const coverFile = a.cover_file && typeof a.cover_file === 'object' ? a.cover_file : {}
  const candidates = [
    typeof a.cover_path === 'string' ? a.cover_path : '',
    typeof coverFile.path === 'string' ? coverFile.path : '',
    Array.isArray(a.images) && typeof a.images[0] === 'string' ? a.images[0] : '',
  ]

  const localHit = pickFirst(candidates.filter(isLocalImagePath))
  if (localHit) {
    // 本地封面胜出 ⇒ 远程 URL 必须清空（互斥），否则消费端的判据会有两个真源
    return { cover_path: toLocalPath(localHit), cover_url: '' }
  }

  const urlHit = pickFirst([
    typeof a.cover_url === 'string' ? safeHttpUrl(a.cover_url.trim()) || '' : '',
    ...candidates.map(c => (isLocalImagePath(c) ? '' : safeHttpUrl(c) || '')),
  ])
  return { cover_path: '', cover_url: urlHit }
}

module.exports = { resolveRecordCover, isLocalImagePath, toLocalPath }
