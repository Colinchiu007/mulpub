// @ts-check
/**
 * publish-republish-snapshot.js — 「再次发布」快照的**单一真源**（写侧 + 读侧）
 *
 * 缺陷背景（2026-10-15 用户报障，PRD-PUBLISH-RECORD-REPUBLISH-2026-10-15 §2.1）：
 * 发布记录的两个落库点（`bootstrap/phase4-events.js` 的 `task:success` / `task:failed`）
 * 只写 platform/title/taskId/status/result/封面/publishMode —— **正文与选项一个字节都没存**，
 * 所以「再次发布」无从还原。实测活体 72 条记录的顶层键频次里没有 content/images/
 * platformOverrides/accountId 中的任何一个。
 *
 * 为什么快照**不写进 publish-history.jsonl 的那一行**：
 * `publish-history.js` 的 `readRecords()` 是「整文件 readFileSync + 逐行 JSON.parse」，
 * 而 `listRecords()` 每次分页都重读整文件，历史页的筛选补页扫描（useFilterScan，上限 40 页）
 * 会连续调用它；`updateRecordAudit` 还会整文件重写。把 10 KB 级正文写进每一行，
 * 等于把一次筛选从 ~0.5 MB 解析放大到数十 MB 量级，直接违反 QM-2。
 * 因此快照落在 **owner 作用域的 SQLite `settings` 表**（与草稿箱同基础设施），
 * 按 `recordId` 一键一读，O(1)，记录行体积零增长。
 *
 * ⛔ 安全红线：任务载荷里**真实存在** `article.cookies`（`publish-audit-requery.js` 读它，
 * 用于审核回查的凭证补齐）。快照**必须按白名单逐字段提取，严禁 `...article` 整体展开** ——
 * 展开一次就是把平台会话凭证写进本地数据库。回归锁：
 * `publish-republish-snapshot.test.js`「归一后键集合精确等于白名单，且不含凭证字段」。
 *
 * 契约：
 *   - 写入永不抛错（旁路）：任何失败只返回 `{saved:false, reason}`，发布主流程不受影响。
 *   - 读取永不抛错：损坏/污染/越权一律返回 `null`，由 UI 走「无快照」分支。
 *   - 读回**再过一次白名单**（纵深防御）：存储被塞进任意键也不能注回表单。
 *   - 快照存在性由 `readSnapshotIndex` 现算（`hasRepublishSnapshot` 不落库），
 *     因此淘汰/删除后 UI 标志自动变 false，不存在「标志说有、实际没有」的漂移。
 */
'use strict'

/**
 * 基础字段白名单（**必存**，缺键等于还原时静默丢内容）。
 * 与草稿箱的 ARTICLE_FIELDS 同族；差异只在「不还原 publishTime」、多出发布选项字段，
 * 逐条理由见 PRD §4.1。
 */
const SNAPSHOT_FIELDS = Object.freeze([
  'title',
  'content',
  'author',
  'cover_url',
  'cover_path',
  'cover_file',
  'video_path',
  'images',
  'image_files',
  'tags',
  'topics',
  'mentions',
  'contentFormat',
  'aiGenerated',
  'platformOverrides',
  'rewriteHistoryId',
  'platform',
  'accountId',
  // 平台/账号**按发布表单的形状**给出（`normalizeAccountIds` 的数组形态），
  // 这样渲染端「快照 → 表单」只需要一份实现（features/publish/publish-snapshot.js）：
  // 草稿与本快照的差别只剩来源不同，不再是「一个存 accounts 一个存 accountId」。
  'platforms',
  'accounts',
])

/** 条件字段：**有值才写键**（无条件挂空值会让下游分不清「没有」与「被抹掉」） */
const OPTIONAL_SNAPSHOT_FIELDS = Object.freeze(['visibilitySemantic', 'publishMode', 'batchId'])

/** 数组型字段：缺失回落 `[]` 而不是 `''`（空串会触发发布契约的「images 文件引用无效」） */
const ARRAY_FIELDS = Object.freeze(new Set(['images', 'image_files', 'tags', 'topics', 'mentions']))

const SNAPSHOT_KEY_PREFIX = 'publish-republish-snapshot:'
const SNAPSHOT_INDEX_KEY = 'publish-republish-snapshot:index'

/** 索引上限：超出即淘汰最旧（并真删其快照键）。200 条 ≈ 覆盖历史页前 4 页。 */
const MAX_SNAPSHOTS = 200
/** 单条快照体积上限（防把整段二进制/base64 塞进 settings） */
const MAX_SNAPSHOT_BYTES = 512 * 1024
/** recordId 长度上限（真实值形如 `mv4y7b7oeh2k`） */
const MAX_RECORD_ID_LENGTH = 64
/** 数组字段元素个数上限（正常图文远低于此；超出的必是脏数据） */
const MAX_ARRAY_ITEMS = 50
/** 字符串字段长度上限（正文单独放宽到体积闸门，其余字段没有理由超长） */
const MAX_STRING_LENGTH = 8192

// 控制字符永不该出现在合法作品/记录 id 里；放过去就是脏数据进 SQL 参数。
// 与渲染层 `src/utils/rewrite-lineage.js` 的 CONTROL_CHARS 同口径（parity 用例逐值比对）。
// eslint-disable-next-line no-control-regex -- 这里要判的就是控制字符本身
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const REWRITE_LINEAGE_MAX_LENGTH = 64

/**
 * 归因链 id 归一，口径与渲染层 `src/utils/rewrite-lineage.js` 的 `normalizeRewriteLineage`
 * **逐用例一致**（由本模块测试的 parity 用例拦截）。
 * 返回 null 而不是空串：下游全部按「键缺席 = 不挂载」处理，空串会被读成「有值」。
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeRewriteLineage (value) {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (!id) return null
  if (id.length > REWRITE_LINEAGE_MAX_LENGTH) return null
  if (CONTROL_CHARS.test(id)) return null
  return id
}

/** @param {unknown} value */
function toBoundedString (value, max = MAX_STRING_LENGTH) {
  if (typeof value !== 'string') return ''
  const text = value
  return text.length > max ? text.slice(0, max) : text
}

/**
 * 深拷贝一个 JSON 安全的数组（元素限 string/number/boolean/普通对象）。
 * 非法元素**剔除而不是保留**：宁可少一个附件引用，也不确定性地写进库里。
 * @param {unknown} value
 * @returns {Array}
 */
function toJsonArray (value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
    if (item === null || item === undefined) continue
    const type = typeof item
    if (type === 'string' || type === 'number' || type === 'boolean') {
      out.push(item)
      continue
    }
    if (type === 'object' && !Array.isArray(item)) {
      try {
        out.push(JSON.parse(JSON.stringify(item)))
      } catch (_) { /* 循环引用等：剔除该元素 */ }
    }
  }
  return out
}

/**
 * 平台覆盖（`platformOverrides`）归一：`{ [platform]: { title, content, ...平台字段 } }`。
 * 只保留「平台 → 一层标量/字符串数组」的形状，杜绝嵌套对象把任意结构带进库。
 * @param {unknown} value
 * @returns {Record<string, object>}
 */
function normalizePlatformOverrides (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [platform, raw] of Object.entries(value)) {
    if (!platform || platform.length > 64) continue
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = {}
    for (const [field, fieldValue] of Object.entries(raw)) {
      if (!field || field.length > 64) continue
      if (typeof fieldValue === 'string') entry[field] = toBoundedString(fieldValue)
      else if (typeof fieldValue === 'number' && Number.isFinite(fieldValue)) entry[field] = fieldValue
      else if (typeof fieldValue === 'boolean') entry[field] = fieldValue
      else if (Array.isArray(fieldValue)) entry[field] = toJsonArray(fieldValue)
    }
    if (Object.keys(entry).length > 0) out[platform] = entry
  }
  return out
}

/**
 * 把一次发布的任务载荷归一成快照（**纯函数**：不读时钟以外的外部状态）。
 *
 * @param {object} input
 * @param {string} input.recordId 历史记录主键（`history.addRecord()` 返回的 `entry.id`）
 * @param {string} [input.platform]
 * @param {object} [input.article] `task.article`（**含 cookies，故只按白名单取键**）
 * @param {string} [input.publishMode]
 * @param {string} [input.batchId]
 * @param {string} [input.savedAt] 注入时刻（测试用；缺省取当前时间）
 * @returns {object|null} 归一后的快照；输入不是对象时返回 null
 */
function buildRepublishSnapshot (input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : null
  if (!src) return null
  const article = src.article && typeof src.article === 'object' && !Array.isArray(src.article) ? src.article : {}
  const coverFile = article.cover_file
  const platform = toBoundedString(src.platform, 64)
  const accountId = toBoundedString(article.accountId || src.accountId, 128)

  const snapshot = {
    title: toBoundedString(article.title),
    content: typeof article.content === 'string' ? article.content : '',
    author: toBoundedString(article.author),
    cover_url: toBoundedString(article.cover_url, 2048),
    cover_path: toBoundedString(article.cover_path, 2048),
    // cover_file 在载荷里既可能是对象（{path,name}）也可能是字符串，统一折成路径串
    // （消费端 `readImageAsDataUrl` 要的是路径；对象形态进快照只会在还原时变成第二个真源）
    cover_file: toBoundedString(
      coverFile && typeof coverFile === 'object' && !Array.isArray(coverFile) ? coverFile.path : coverFile,
      2048,
    ),
    video_path: toBoundedString(article.video_path, 2048),
    images: toJsonArray(article.images),
    image_files: toJsonArray(article.image_files),
    tags: toJsonArray(article.tags),
    topics: toJsonArray(article.topics),
    mentions: toJsonArray(article.mentions),
    contentFormat: toBoundedString(article.contentFormat, 32),
    // 默认 true：与 usePublishFlow.buildArticleData 的 `aiGenerated !== false` 同口径
    // （AI 生成内容不声明会违规，缺省必须是「已声明」）
    aiGenerated: article.aiGenerated !== false,
    platformOverrides: normalizePlatformOverrides(article.platformOverrides),
    rewriteHistoryId: normalizeRewriteLineage(article.rewriteHistoryId),
    platform,
    accountId,
    platforms: platform ? [platform] : [],
    accounts: platform && accountId ? { [platform]: [accountId] } : {},
  }

  const visibilitySemantic = toBoundedString(article.visibilitySemantic, 64)
  if (visibilitySemantic) snapshot.visibilitySemantic = visibilitySemantic
  const publishMode = toBoundedString(src.publishMode, 32)
  if (publishMode) snapshot.publishMode = publishMode
  const batchId = toBoundedString(src.batchId, 64)
  if (batchId) snapshot.batchId = batchId
  snapshot.savedAt = toBoundedString(src.savedAt, 64) || new Date().toISOString()

  return snapshot
}

/**
 * 读取侧的归一：把「存储里实际躺着的东西」折成快照白名单形状。
 * 与 `buildRepublishSnapshot` 同表同判据（不复制第二份口径），但**不生成** `savedAt`。
 *
 * @param {unknown} raw
 * @returns {object|null}
 */
function normalizeSnapshot (raw) {
  let value = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch (_) { return null }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = buildRepublishSnapshot({
    recordId: '',
    platform: value.platform,
    article: value,
    publishMode: value.publishMode,
    batchId: value.batchId,
    savedAt: typeof value.savedAt === 'string' && value.savedAt.trim() ? value.savedAt : new Date().toISOString(),
  })
  return snapshot
}

/** owner 语义与 publish-history.js 逐字一致：undefined=legacy、null=拒绝、串=按归属分桶 */
function resolveOwnerSubject (ownerSubject) {
  if (ownerSubject === undefined) return undefined
  if (ownerSubject === null) return null
  if (typeof ownerSubject !== 'string' || !ownerSubject.trim()) return null
  return ownerSubject.trim()
}

function readSetting (key, defaultValue, owner, store) {
  if (owner === undefined) {
    if (typeof store.getSetting !== 'function') return defaultValue
    return store.getSetting(key, defaultValue)
  }
  if (typeof store.getUserSetting !== 'function') return defaultValue
  return store.getUserSetting(key, defaultValue, owner)
}

function writeSetting (key, value, owner, store) {
  if (owner === undefined) {
    if (typeof store.setSetting !== 'function') return false
    store.setSetting(key, value)
    return true
  }
  if (typeof store.setUserSetting !== 'function') return false
  store.setUserSetting(key, value, owner)
  return true
}

function snapshotKey (recordId) {
  return SNAPSHOT_KEY_PREFIX + recordId
}

function isUsableStore (store) {
  return Boolean(store && typeof store === 'object')
}

function normalizeRecordId (recordId) {
  if (typeof recordId !== 'string') return ''
  const id = recordId.trim()
  if (!id || id.length > MAX_RECORD_ID_LENGTH) return ''
  if (CONTROL_CHARS.test(id)) return ''
  return id
}

/**
 * 读取快照索引（新→旧）。索引是「存在性」的唯一真源，读它就是 `hasRepublishSnapshot`。
 * @param {string|undefined|null} ownerSubject
 * @param {{store?: object}} deps
 * @returns {string[]}
 */
function readSnapshotIndex (ownerSubject, deps) {
  const owner = resolveOwnerSubject(ownerSubject)
  if (owner === null) return []
  const store = deps && deps.store
  if (!isUsableStore(store)) return []
  try {
    const raw = readSetting(SNAPSHOT_INDEX_KEY, [], owner, store)
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(list)) return []
    return list.filter(id => typeof id === 'string' && id).slice(0, MAX_SNAPSHOTS)
  } catch (_) {
    return []
  }
}

/** 列表页用的存在性集合：一次读索引，N 条记录 O(1) 命中（避免 N 次 settings 读） */
function readSnapshotIdSet (ownerSubject, deps) {
  return new Set(readSnapshotIndex(ownerSubject, deps))
}

/**
 * 写入一条快照。**旁路**：任何失败只返回 reason，不抛错、不阻塞发布主流程。
 *
 * @param {object} input 见 buildRepublishSnapshot（另需 recordId）
 * @param {string|undefined|null} ownerSubject
 * @param {{store?: object}} deps
 * @returns {{saved: boolean, reason?: string}}
 */
function saveSnapshot (input, ownerSubject, deps) {
  try {
    const recordId = normalizeRecordId(input && input.recordId)
    if (!recordId) return { saved: false, reason: 'invalid_record_id' }
    const owner = resolveOwnerSubject(ownerSubject)
    if (owner === null) return { saved: false, reason: 'no_owner' }
    const store = deps && deps.store
    if (!isUsableStore(store)) return { saved: false, reason: 'no_store' }

    const snapshot = buildRepublishSnapshot(input)
    if (!snapshot) return { saved: false, reason: 'invalid_input' }
    if (!snapshot.title.trim() && !snapshot.content.trim()) return { saved: false, reason: 'empty_snapshot' }
    let serialized
    try {
      serialized = JSON.stringify(snapshot)
    } catch (_) {
      return { saved: false, reason: 'unserializable' }
    }
    if (serialized.length > MAX_SNAPSHOT_BYTES) return { saved: false, reason: 'too_large' }

    if (!writeSetting(snapshotKey(recordId), snapshot, owner, store)) {
      return { saved: false, reason: 'write_failed' }
    }

    // 索引：前插 + 去重 + 截断；被淘汰的 id 其快照键必须真删，否则 settings 只增不减
    const index = readSnapshotIndex(owner, { store }).filter(id => id !== recordId)
    index.unshift(recordId)
    const kept = index.slice(0, MAX_SNAPSHOTS)
    const dropped = index.slice(MAX_SNAPSHOTS)
    writeSetting(SNAPSHOT_INDEX_KEY, kept, owner, store)
    for (const id of dropped) writeSetting(snapshotKey(id), '', owner, store)

    return { saved: true }
  } catch (_) {
    return { saved: false, reason: 'error' }
  }
}

/**
 * 读取一条快照。任何异常/污染/越权一律 null（UI 走「无快照」分支）。
 * @param {string} recordId
 * @param {string|undefined|null} ownerSubject
 * @param {{store?: object}} deps
 * @returns {object|null}
 */
function readSnapshot (recordId, ownerSubject, deps) {
  try {
    const id = normalizeRecordId(recordId)
    if (!id) return null
    const owner = resolveOwnerSubject(ownerSubject)
    if (owner === null) return null
    const store = deps && deps.store
    if (!isUsableStore(store)) return null
    // 按**键**读，不先查索引：索引只是给列表页加速的派生面，让它决定「能不能读」
    // 会把一次索引漂移放大成「有快照却读不出来」。淘汰与级联删除都是**真删键**，
    // 所以键在 = 数据在，这条判据本身就够。
    const raw = readSetting(snapshotKey(id), null, owner, store)
    if (raw === null || raw === undefined || raw === '') return null
    const normalized = normalizeSnapshot(raw)
    if (!normalized) return null
    return normalized
  } catch (_) {
    return null
  }
}

/**
 * 级联删除（历史记录被删时必须调用，否则 settings 里留下永远读不到的孤儿行）。
 * @param {string[]} ids
 * @param {string|undefined|null} ownerSubject
 * @param {{store?: object}} deps
 * @returns {{deleted: number}}
 */
function deleteSnapshots (ids, ownerSubject, deps) {
  try {
    const owner = resolveOwnerSubject(ownerSubject)
    if (owner === null) return { deleted: 0 }
    const store = deps && deps.store
    if (!isUsableStore(store)) return { deleted: 0 }
    const targets = new Set((Array.isArray(ids) ? ids : [ids]).map(normalizeRecordId).filter(Boolean))
    if (targets.size === 0) return { deleted: 0 }

    const index = readSnapshotIndex(owner, { store })
    let deleted = 0
    for (const id of targets) {
      if (!index.includes(id)) continue
      writeSetting(snapshotKey(id), '', owner, store)
      deleted += 1
    }
    if (deleted > 0) {
      writeSetting(SNAPSHOT_INDEX_KEY, index.filter(id => !targets.has(id)), owner, store)
    }
    return { deleted }
  } catch (_) {
    return { deleted: 0 }
  }
}

module.exports = {
  SNAPSHOT_FIELDS,
  OPTIONAL_SNAPSHOT_FIELDS,
  ARRAY_FIELDS,
  SNAPSHOT_KEY_PREFIX,
  SNAPSHOT_INDEX_KEY,
  MAX_SNAPSHOTS,
  MAX_SNAPSHOT_BYTES,
  buildRepublishSnapshot,
  normalizeSnapshot,
  saveSnapshot,
  readSnapshot,
  readSnapshotIndex,
  readSnapshotIdSet,
  deleteSnapshots,
}
