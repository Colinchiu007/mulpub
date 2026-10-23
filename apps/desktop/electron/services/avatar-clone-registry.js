// @ts-check
/**
 * avatar-clone-registry — 数字人形象克隆 registry 的安全校验与公开条目构造（纯逻辑）
 *
 * 与 tts-voice-clone-integrity 同型的拆分：只做只读判定与形状归一，
 * 不写任何文件/registry；依赖（fs / store / 路径回调）由调用方注入，
 * 避免与 avatar-clone-service 循环 require。
 *
 * 与 TTS 克隆的分歧点（提案「服务边界」表）：
 *   - 素材是图片/视频而非音频，扩展名与容器判定不同；
 *   - 远端有「训练中」长态，失效判定多一档 training；
 *   - 审计日志独立于 registry（评审 i3：删记录不得丢审计）。
 */
'use strict'

const CAPABILITY_TYPES = Object.freeze({
  USER_CLONE: 'user_clone',
})

// 可接受的形象素材扩展名（photo: 图片；digital_twin: 视频）
const AVATAR_IMAGE_EXTENSIONS = Object.freeze(['.png', '.jpg', '.jpeg', '.webp'])
const AVATAR_VIDEO_EXTENSIONS = Object.freeze(['.mp4', '.mov', '.webm'])
const AVATAR_MEDIA_EXTENSIONS = Object.freeze([...AVATAR_IMAGE_EXTENSIONS, ...AVATAR_VIDEO_EXTENSIONS])

// 形象克隆失效原因
const AVATAR_CLONE_INVALID_REASONS = Object.freeze({
  INVALID_AVATAR_ID: 'invalid_avatar_id',
  SAMPLE_STORAGE_MISSING: 'sample_storage_missing',
  TRAINING_FAILED: 'training_failed',
})

// 删除三态（与 tts-voice-clone-service.DELETE_STATES 同构）
const DELETE_STATES = Object.freeze({
  ACTIVE: 'active',
  PENDING: 'pending',
  REMOTE_DELETED: 'remote_deleted',
})

// 训练状态机（HeyGen /v3/avatars/looks/{id} 的 training_status）
const TRAINING_STATES = Object.freeze({
  TRAINING: 'training',
  COMPLETED: 'completed',
  FAILED: 'failed',
})

const MAX_IDENTIFIER_LENGTH = 128
const MAX_AVATAR_ID_LENGTH = 256
const MAX_NAME_LENGTH = 128

function safeIdentifier (value, maxLength = MAX_IDENTIFIER_LENGTH) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength || !/^[a-zA-Z0-9._-]+$/.test(normalized)) return null
  return normalized
}

function safeDisplayName (value) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_NAME_LENGTH) return null
  // 控制字符一律拒绝（与 TTS 克隆同源）
  if (Array.from(normalized).some((ch) => { const c = ch.charCodeAt(0); return c <= 0x1f || c === 0x7f })) return null
  return normalized
}

/** 来源优先级（提案 Q9）：self > third_party_authorized > 公共目录 */
const SOURCE_PRIORITY = Object.freeze({
  self: 2,
  third_party_authorized: 1,
})

function normalizeSourceKind (value) {
  return Object.prototype.hasOwnProperty.call(SOURCE_PRIORITY, value) ? value : null
}

/**
 * 样本目录形状校验。
 *
 * 目录形态（change: digital-human-multiprovider 起支持两种，按 provider 分段）：
 *   avatar-clone-samples/<providerId>/<ownerHash>/<storageId>   （4 段，新）
 *   avatar-clone-samples/<ownerHash>/<storageId>               （3 段，老数据）
 *
 * 两种都放行是为了让**升级前已克隆的用户仍能看到自己的形象**（老 registry 不迁移，
 * 但已落盘的样本不该被判定成「本地素材已缺失」而误导用户）。
 *
 * 安全要点不变：前缀必须精确、每一段都过 safeIdentifier（不许 `..`、绝对路径、
 * 空段），否则等于把任意文件读取开给调用方。
 */
function isSafeSampleStorage (value, ownerHash) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const allowed = new Set(['relativeDir', 'sampleCount', 'mediaType'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return false
  if (typeof value.relativeDir !== 'string') return false
  const segments = value.relativeDir.split('/')
  if (segments[0] !== 'avatar-clone-samples') return false
  if (segments.length !== 3 && segments.length !== 4) return false
  // 4 段形态：第 2 段是 providerId，第 3 段才是 ownerHash
  const hashIndex = segments.length === 4 ? 2 : 1
  if (segments[hashIndex] !== ownerHash) return false
  if (safeIdentifier(segments[hashIndex + 1], 128) === null) return false
  if (segments.length === 4 && safeIdentifier(segments[1], 128) === null) return false
  if (!Number.isInteger(value.sampleCount) || value.sampleCount < 1) return false
  return value.mediaType === 'image' || value.mediaType === 'video'
}

/**
 * 构造 registry 存储键。
 *
 * change: digital-human-multiprovider —— 补 `providerId` 段：
 * 两家数字人服务商的克隆 id **同形同键**（都是 avatar/look id），不区分 provider
 * 时 HeyGen 与飞影的克隆形象会写进同一份 registry，用户切换 provider 后
 * 看到的是另一家的失效 id（选了要到 generate 阶段才炸）。
 *
 * 老数据（无 providerId 段）自然失效：用户重新克隆即可，不做迁移——
 * 迁移要把「这条记录属于哪家」猜出来，而老 registry 里没存这个信息。
 *
 * @param {{hash: string, providerId?: string}} owner
 * @param {number} version
 * @param {string} defaultProvider 未显式指定时的兜底
 * @returns {string}
 */
function buildRegistryKey (owner, version, defaultProvider) {
  const provider = owner && owner.providerId ? String(owner.providerId) : defaultProvider
  return `avatar-clones:v${version}:${provider}:${owner.hash}`
}

/**
 * 构造样本目录相对路径（与 registry 键同构地按 provider 分段）。
 *
 * 抽成纯函数的理由：它与 buildRegistryKey 必须**同一种分段规则**，
 * 两处各写一遍就会漂移（实测过：storage 按 3 段拼、registry 记 4 段，
 * 表现是「registry 写成功但 existsSync 为 false」的幽灵故障）。
 *
 * @param {{hash: string, providerId?: string}} owner
 * @param {string} storageId
 * @param {string} root 样本根目录名
 * @param {string} defaultProvider
 */
function buildSampleRelativeDir (owner, storageId, root, defaultProvider) {
  const provider = owner && owner.providerId ? String(owner.providerId) : defaultProvider
  return `${root}/${provider}/${owner.hash}/${storageId}`
}

/**
 * 判定 registry 条目是否合法。
 * attestation 是审计链的一环（评审 i3），必填；auditSeq 指向审计日志序号。
 */
function isSafeAvatarClone (value, ownerHash) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const allowed = new Set([
    'id',
    'name',
    'source',
    'sourceKind',
    'attestation',
    'auditSeq',
    'createdAt',
    'deletionState',
    'trainingState',
    'sampleStorage',
    'mediaType',
  ])
  if (Object.keys(value).some((key) => !allowed.has(key))) return false
  const id = safeIdentifier(value.id, MAX_AVATAR_ID_LENGTH)
  const name = safeDisplayName(value.name)
  if (!id || !name) return false
  if (value.source !== CAPABILITY_TYPES.USER_CLONE) return false
  if (!normalizeSourceKind(value.sourceKind)) return false
  const deletionState = value.deletionState === undefined ? DELETE_STATES.ACTIVE : value.deletionState
  if (!Object.values(DELETE_STATES).includes(deletionState)) return false
  const trainingState = value.trainingState === undefined ? TRAINING_STATES.TRAINING : value.trainingState
  if (!Object.values(TRAINING_STATES).includes(trainingState)) return false
  if (!Number.isFinite(value.createdAt)) return false
  if (!Number.isInteger(value.auditSeq) || value.auditSeq < 1) return false
  // attestation：acknowledgedAt 必填（可解析时间），reason 选填
  if (!value.attestation || typeof value.attestation !== 'object' || Array.isArray(value.attestation)) return false
  if (Object.keys(value.attestation).some((key) => !['acknowledgedAt', 'note'].includes(key))) return false
  if (!Number.isFinite(value.attestation.acknowledgedAt)) return false
  if (value.attestation.note !== undefined && typeof value.attestation.note !== 'string') return false
  if (value.mediaType !== 'image' && value.mediaType !== 'video') return false
  return value.sampleStorage === undefined || isSafeSampleStorage(value.sampleStorage, ownerHash)
}

function isSafeAvatarCloneRegistry (value, ownerHash) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const allowed = new Set(['version', 'ownerHash', 'avatars'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return false
  if (value.version !== 1) return false
  if (value.ownerHash !== ownerHash) return false
  if (!Array.isArray(value.avatars) || !value.avatars.every((a) => isSafeAvatarClone(a, ownerHash))) return false
  return new Set(value.avatars.map((a) => a.id)).size === value.avatars.length
}

/**
 * 构造公开条目（listClones 用）。
 * 失效判定顺序：avatar_id 非法 > training_failed > 样本目录缺失
 * （与 TTS 克隆同型的优先级：身份问题优先于本地资源问题）。
 */
function buildPublicCloneEntries ({ avatars, invalidReasonOf, sampleStorageStatusOf, toPublic }) {
  const out = []
  for (const avatar of avatars) {
    const id = safeIdentifier(avatar.id, MAX_AVATAR_ID_LENGTH)
    if (!id) {
      out.push({ ...toPublic(avatar), invalidReason: AVATAR_CLONE_INVALID_REASONS.INVALID_AVATAR_ID })
      continue
    }
    if (avatar.trainingState === TRAINING_STATES.FAILED) {
      out.push({ ...toPublic(avatar), invalidReason: AVATAR_CLONE_INVALID_REASONS.TRAINING_FAILED })
      continue
    }
    const reason = invalidReasonOf ? invalidReasonOf(avatar) : null
    if (reason) {
      out.push({ ...toPublic(avatar), invalidReason: reason })
      continue
    }
    const status = sampleStorageStatusOf ? sampleStorageStatusOf(avatar.sampleStorage) : 'unknown'
    if (status === 'missing') {
      out.push({ ...toPublic(avatar), invalidReason: AVATAR_CLONE_INVALID_REASONS.SAMPLE_STORAGE_MISSING })
      continue
    }
    out.push(toPublic(avatar))
  }
  return out
}

/**
 * 归一「创建克隆」入参。
 *
 * 扩展名必须与声明的素材类型一致（photo 只能图片、digital_twin 只能视频）：
 * 让 .mp4 走 photo 路径会在 HeyGen 侧变成难定位的 400。
 *
 * @param {unknown} input
 * @param {(fileName: string) => string|null} safeExtension
 */
function normalizeCreateRequest (input, safeExtension) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const name = safeDisplayName(input.name)
  if (!name) return null
  const type = input.type
  if (type !== 'photo' && type !== 'digital_twin') return null
  const mediaType = type === 'photo' ? 'image' : 'video'
  if (!input.media || typeof input.media !== 'object' || !(input.media.blob instanceof Blob)) return null
  if (typeof input.media.fileName !== 'string') return null
  const ext = safeExtension(input.media.fileName)
  if (!ext) return null
  const allowed = mediaType === 'image' ? AVATAR_IMAGE_EXTENSIONS : AVATAR_VIDEO_EXTENSIONS
  if (!allowed.includes(ext)) return null
  const sourceKind = normalizeSourceKind(input.sourceKind) || 'self'
  // change: digital-human-multiprovider —— 透传 providerId：registry 键与样本目录
  // 都按它分段，两家数字人服务商的克隆产物才不会串库。非空字符串才认。
  const providerId = typeof input.providerId === 'string' && input.providerId.trim() ? input.providerId.trim() : null
  return { name, type, mediaType, media: input.media, sourceKind, providerId }
}

/**
 * 把 HeyGen 的 training_status 归一到本地三态。
 *
 * 纯函数：与 heygen-clone.js 里 getAvatarStatus 的 statusMap 是同一条映射的
 * 两个消费侧（一个给 adapter 用、一个给 registry 归一用），刻意不收进同一处——
 * adapter 那份要多返回 progress，registry 这份只要状态词。改动必须两边同步。
 *
 * @param {unknown} rawStatus
 * @returns {'training'|'completed'|'failed'}
 */
function normalizeTrainingState (rawStatus) {
  const raw = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase() : ''
  if (raw === 'ready' || raw === 'completed' || raw === 'success' || raw === 'active') return TRAINING_STATES.COMPLETED
  if (raw === 'failed' || raw === 'error') return TRAINING_STATES.FAILED
  return TRAINING_STATES.TRAINING
}

function normalizeIdRequest (input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const avatarId = safeIdentifier(input.avatarId, MAX_AVATAR_ID_LENGTH)
  if (!avatarId) return null
  // 同 normalizeCreateRequest：删除/重命名也要知道动的是哪家的 registry
  const providerId = typeof input.providerId === 'string' && input.providerId.trim() ? input.providerId.trim() : null
  return { avatarId, providerId }
}

function normalizeRenameRequest (input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const avatarId = safeIdentifier(input.avatarId, MAX_AVATAR_ID_LENGTH)
  const name = safeDisplayName(input.name)
  if (!avatarId || !name) return null
  return { avatarId, name }
}

module.exports = {
  CAPABILITY_TYPES,
  AVATAR_IMAGE_EXTENSIONS,
  AVATAR_VIDEO_EXTENSIONS,
  AVATAR_MEDIA_EXTENSIONS,
  AVATAR_CLONE_INVALID_REASONS,
  DELETE_STATES,
  TRAINING_STATES,
  SOURCE_PRIORITY,
  MAX_AVATAR_ID_LENGTH,
  MAX_NAME_LENGTH,
  safeIdentifier,
  safeDisplayName,
  normalizeSourceKind,
  buildRegistryKey,
  buildSampleRelativeDir,
  isSafeSampleStorage,
  isSafeAvatarClone,
  isSafeAvatarCloneRegistry,
  buildPublicCloneEntries,
  normalizeCreateRequest,
  normalizeIdRequest,
  normalizeRenameRequest,
  normalizeTrainingState,
}
