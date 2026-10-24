/**
 * useAvatarClone —— 数字人形象克隆（avatar-voice-clone）
 *
 * 与 useAvatarCatalog 分开：目录读的是 HeyGen 公共形象，本 composable 管的是
 * 「用户自己上传素材克隆出来的形象」——有创建/删除/重命名/训练轮询等写操作，
 * 且带 attestation 与审计语义，混进只读目录会让职责边界失真。
 *
 * 素材刻意走两段式（chooseMedia → add）：renderer 不直接传路径或字节，
 * 路径只能由主进程对话框产生（与 tts-voice-clone 同型的安全边界）。
 *
 * change: hifly-voice-subtitle-parity —— 本 composable 也管**声音**克隆的最小闭环
 * （createVoiceClone）。形象与声音共用一套「两段式 + 竞态守卫 + 错误映射」，
 * 但状态字段分开（voiceCreating / voiceCreateError / voiceCreatedName）：
 * 两者可并行操作，共用一个 creating 会让「上传照片时不能同时上传录音」这种
 * 假约束出现。
 */
import { ref, computed } from 'vue'
import {
  listAvatarClones,
  chooseAvatarCloneMedia,
  addAvatarClone,
  deleteAvatarClone,
  renameAvatarClone,
} from '@/api/avatar-clone'
import {
  chooseTtsVoiceCloneSamples,
  addTtsVoiceClone,
} from '@/api/tts-voice-clone'

const clones = ref([])
const loading = ref(false)
const error = ref('')
/** 一次性合规提示是否已阅（写 userSetting，不再弹出） */
const noticeAcknowledged = ref(false)
/** 正在创建中的 selectionId（用于禁用重复提交） */
const creating = ref(false)
const createError = ref('')
/** 声音克隆区状态（与形象克隆分开，两者可并行） */
const voiceCreating = ref(false)
const voiceCreateError = ref('')
const voiceCreatedName = ref('')
/**
 * 已选中的形象素材 selectionId（change: avatar-voice-clone-bundled）。
 * 声音与形象绑在同一次创建里，所以两条素材各选一次、一起下发。
 */
const mediaSelectionId = ref('')
/** 已选中的录音 selectionId（同上；空串表示还没选，仍可只克隆形象） */
const voiceSelectionId = ref('')
let requestId = 0
let loadRequestId = 0
let voiceRequestId = 0

function reset () {
  clones.value = []
  loading.value = false
  error.value = ''
  creating.value = false
  createError.value = ''
  // 声音克隆状态一并复位：切换服务商时上一条的错误/成功提示不该留着
  voiceCreating.value = false
  voiceCreateError.value = ''
  voiceCreatedName.value = ''
  // 两条素材选择态一并复位：切换服务商时不能留着上一家的 selectionId
  mediaSelectionId.value = ''
  voiceSelectionId.value = ''
}

/**
 * 错误码 → locale key 映射。
 *
 * 与 useAvatarCatalog.friendlyError 同型的理由：CI Gate 7 的 CJK 基线扫描
 * 拦截渲染端新增中文字面量，用户可见文案一律走 locale；未识别的错误透出
 * 原始 message（多为 ASCII 错误码）。
 */
function friendlyError (message) {
  const text = String(message || '')
  if (text.includes('AVATAR_CLONE_INVALID_ARGUMENTS')) return 'avatarCloneErrInvalidArgs'
  if (text.includes('AVATAR_CLONE_SELECTION_UNAVAILABLE')) return 'avatarCloneErrSelection'
  if (text.includes('AVATAR_CLONE_SAMPLE_INVALID')) return 'avatarCloneErrSampleInvalid'
  if (text.includes('AVATAR_CLONE_SAMPLE_UNREADABLE')) return 'avatarCloneErrSampleUnreadable'
  if (text.includes('AVATAR_CLONE_DUPLICATE_ID')) return 'avatarCloneErrDuplicate'
  if (text.includes('AVATAR_CLONE_NOT_FOUND')) return 'avatarCloneErrNotFound'
  if (text.includes('AVATAR_CLONE_STORE_UNAVAILABLE')) return 'avatarCloneErrStore'
  if (text.includes('AVATAR_CLONE_PROVIDER_UNAVAILABLE')) return 'avatarCloneErrProvider'
  return text || 'avatarCloneErrUnknown'
}

/** 失效标记 → locale key（listClones 已在主进程标好 invalidReason） */
function invalidReasonKey (avatar) {
  if (!avatar || !avatar.invalidReason) return ''
  if (avatar.invalidReason === 'training_failed') return 'avatarCloneTrainingFailed'
  if (avatar.invalidReason === 'invalid_avatar_id') return 'avatarCloneRemoteGone'
  if (avatar.invalidReason === 'sample_storage_missing') return 'avatarCloneSampleGone'
  return 'avatarCloneErrUnknown'
}

/**
 * 加载本账号的克隆形象（requestId 竞态守卫，同 useAvatarCatalog）。
 *
 * change: digital-human-multiprovider —— 带 `providerId`：主进程的 registry 键
 * 与样本目录都按 provider 分段，不传就会拿到默认那家的克隆列表，
 * 表现是「切换了服务商，克隆面板还显示上一家的形象」。
 *
 * @param {{providerId?: string}} [options]
 */
async function loadAvatarClones (options = {}) {
  const my = ++loadRequestId
  loading.value = true
  error.value = ''
  try {
    const result = await listAvatarClones({ providerId: options.providerId || '' })
    if (my !== loadRequestId) return
    if (result && result.code === 0 && result.data && Array.isArray(result.data.avatars)) {
      clones.value = result.data.avatars
    } else {
      clones.value = []
      error.value = friendlyError(result && result.message)
    }
  } catch (e) {
    if (my !== loadRequestId) return
    clones.value = []
    error.value = friendlyError(e && e.message)
  } finally {
    if (my === loadRequestId) loading.value = false
  }
}

/**
 * 创建克隆形象。
 *
 * change: avatar-voice-clone-bundled —— 素材 selectionId 可由调用方预先选好再传入。
 * 这样面板能先分别选「形象素材」和「录音素材」，再一次创建建完两样
 * （声音与形象绑在同一家 provider 下，用上飞影的整体克隆能力）。
 * 不传 selectionId 时仍会自己弹对话框（向后兼容旧调用路径）。
 *
 * @param {object} input
 * @param {'photo'|'digital_twin'} input.type
 * @param {string} input.name
 * @param {'self'|'third_party_authorized'} [input.sourceKind]
 * @param {string} [input.providerId] 数字人服务商（change: digital-human-multiprovider）
 * @param {string} [input.selectionId] 预选的形象素材 selectionId
 * @param {string} [input.voiceSelectionId] 预选的录音 selectionId（配套声音）
 */
/**
 * 选形象素材（change: avatar-voice-clone-bundled）。
 * 主进程对话框 → selectionId，renderer 不碰文件路径。
 *
 * @param {string} type photo | digital_twin
 * @returns {Promise<string|null>} 选中的 type；取消/失败返回 null
 */
async function chooseMedia (type, providerId) {
  const chosen = await chooseAvatarCloneMedia({ type, providerId })
  if (!chosen || chosen.code !== 0) return null
  const selectionId = chosen.data && chosen.data.selectionId
  if (!selectionId) return null
  mediaSelectionId.value = selectionId
  return type
}

/**
 * 选录音素材（change: avatar-voice-clone-bundled）。
 * 与形象素材同型，最终与形象在同一次创建里捆绑下发。
 */
async function chooseVoiceMedia (providerId) {
  const chosen = await chooseAvatarCloneMedia({ type: 'audio', providerId })
  if (!chosen || chosen.code !== 0) return
  const selectionId = chosen.data && chosen.data.selectionId
  if (!selectionId) return
  voiceSelectionId.value = selectionId
}

async function createAvatarClone (input) {
  const my = ++requestId
  creating.value = true
  createError.value = ''
  try {
    let selectionId = input.selectionId || mediaSelectionId.value
    if (!selectionId) {
      const chosen = await chooseAvatarCloneMedia({ type: input.type })
      if (my !== requestId) return { success: false, canceled: true }
      if (!chosen || chosen.code !== 0) {
        createError.value = friendlyError(chosen && chosen.message)
        return { success: false }
      }
      // 用户取消对话框：paths 为空，不是错误
      if (chosen.data && Array.isArray(chosen.data.paths) && chosen.data.paths.length === 0) {
        return { success: false, canceled: true }
      }
      selectionId = chosen.data && chosen.data.selectionId
      if (!selectionId) {
        createError.value = friendlyError(chosen && chosen.message)
        return { success: false }
      }
    }

    const added = await addAvatarClone({
      selectionId,
      name: input.name,
      type: input.type,
      sourceKind: input.sourceKind,
      providerId: input.providerId,
      // change: avatar-voice-clone-bundled —— 配套录音的 selectionId（可选）。
      // 声音与形象绑在同一家 provider 下**一次创建**；不传则只克隆形象。
      ...((input.voiceSelectionId || voiceSelectionId.value)
        ? { voiceSelectionId: input.voiceSelectionId || voiceSelectionId.value }
        : {}),
    })
    if (my !== requestId) return { success: false, canceled: true }
    if (added && added.code === 0 && added.data && added.data.avatar) {
      // 两条素材都已消费，清掉避免下次创建误带
      mediaSelectionId.value = ''
      voiceSelectionId.value = ''
      // 追加到列表头部（最新创建的排最前）
      clones.value = [added.data.avatar, ...clones.value]
      return { success: true, avatar: added.data.avatar }
    }
    createError.value = friendlyError(added && added.message)
    return { success: false }
  } catch (e) {
    if (my !== requestId) return { success: false, canceled: true }
    createError.value = friendlyError(e && e.message)
    return { success: false }
  } finally {
    if (my === requestId) creating.value = false
  }
}

/**
 * 删除克隆形象。
 *
 * change: digital-human-multiprovider —— 带 `providerId`：registry 按 provider
 * 分段，不传就会去删默认那家，用户会看到「删了没反应」或误删别家的形象。
 *
 * @param {string} avatarId
 * @param {{providerId?: string}} [options]
 */
async function removeAvatarClone (avatarId, options = {}) {
  const result = await deleteAvatarClone({ avatarId, providerId: options.providerId || '' })
  if (result && result.code === 0) {
    clones.value = clones.value.filter((a) => a.id !== avatarId)
    return { success: true, pending: Boolean(result.data && result.data.pending) }
  }
  return { success: false, message: friendlyError(result && result.message) }
}

async function renameAvatarCloneById (avatarId, name) {
  const result = await renameAvatarClone({ avatarId, name })
  if (result && result.code === 0 && result.data && result.data.avatar) {
    clones.value = clones.value.map((a) => (a.id === avatarId ? { ...a, name: result.data.avatar.name } : a))
    return { success: true }
  }
  return { success: false, message: friendlyError(result && result.message) }
}

/**
 * 创建克隆声音（change: hifly-voice-subtitle-parity）。
 *
 * 复用 tts-voice-clone 的 IPC 与 service——那条链早已完全 provider 化，
 * 这里只做「按当前数字人 provider 填 providerId/model」的适配，
 * 不另起一套样本存储（否则会有两份目录、两套 TTL、两套清理）。
 *
 * 两段式与形象克隆同型：先弹主进程对话框选录音，再按 selectionId 创建。
 * renderer 始终不碰文件路径或字节。
 *
 * @param {object} input
 * @param {string} input.name 音色名
 * @param {string} input.providerId 当前数字人服务商
 * @param {string} [input.model] 缺省 `<providerId>-video`
 * @returns {Promise<{success: boolean, canceled?: boolean}>}
 */
async function createVoiceClone (input) {
  const my = ++voiceRequestId
  voiceCreating.value = true
  voiceCreateError.value = ''
  voiceCreatedName.value = ''
  try {
    const providerId = String((input && input.providerId) || '').trim()
    if (!providerId) {
      voiceCreateError.value = 'avatarCloneErrProvider'
      return { success: false }
    }
    const name = String((input && input.name) || '').trim()
    if (!name) {
      voiceCreateError.value = 'avatarCloneErrInvalidArgs'
      return { success: false }
    }
    const model = (input && input.model) || `${providerId}-video`

    const chosen = await chooseTtsVoiceCloneSamples({ providerId, model })
    if (my !== voiceRequestId) return { success: false, canceled: true }
    if (!chosen || chosen.code !== 0) {
      voiceCreateError.value = friendlyError(chosen && chosen.message)
      return { success: false }
    }
    // 用户取消对话框：paths 为空，不是错误
    if (chosen.data && Array.isArray(chosen.data.paths) && chosen.data.paths.length === 0) {
      return { success: false, canceled: true }
    }
    const selectionId = chosen.data && chosen.data.selectionId
    if (!selectionId) {
      voiceCreateError.value = friendlyError(chosen && chosen.message)
      return { success: false }
    }

    const added = await addTtsVoiceClone({ providerId, model, name, selectionId })
    if (my !== voiceRequestId) return { success: false, canceled: true }
    if (added && added.code === 0) {
      const created = added.data && added.data.voice
      voiceCreatedName.value = (created && created.name) || name
      return { success: true, voice: created }
    }
    voiceCreateError.value = friendlyError(added && added.message)
    return { success: false }
  } catch (e) {
    if (my !== voiceRequestId) return { success: false, canceled: true }
    voiceCreateError.value = friendlyError(e && e.message)
    return { success: false }
  } finally {
    if (my === voiceRequestId) voiceCreating.value = false
  }
}

/** 可用（非失效）的克隆形象——供三要素下拉合并使用 */
const usableClones = computed(() => clones.value.filter((a) => !a.invalidReason && a.trainingState !== 'failed'))

/** 训练中的形象（UI 需要展示进度态） */
const trainingClones = computed(() => clones.value.filter((a) => a.trainingState === 'training'))

/**
 * 合并「公共目录形象」与「克隆形象」为形象下拉选项（提案 Q9）。
 *
 * 优先级：self > third_party_authorized > 公共目录；失效克隆项直接剔除
 * （training_failed / 远端已失效的选项不该出现在下拉里，否则用户选了
 * 要到 generate 阶段才炸）。
 *
 * 纯函数放在 composable 而不是 CreateView 的 methods：CreateView.vue 已逼近
 * 债务基线 maxFileLines，且合并逻辑值得独立单测。
 *
 * @param {Array<{id: string, name: string}>} publicAvatars 公共目录形象
 * @param {(key: string) => string} translate locale 取值函数（composable 不依赖 i18n 实例）
 * @returns {Array<{id: string, name: string, clone: boolean, trainingState?: string}>}
 */
function buildMergedAvatarOptions (publicAvatars, translate) {
  const publicOptions = Array.isArray(publicAvatars) ? publicAvatars : []
  const cloneOptions = usableClones.value.map((a) => ({
    id: a.id,
    name: `${a.name}（${translate('avatarCloneSourceSelf')}）`,
    clone: true,
    trainingState: a.trainingState,
  }))
  return [...cloneOptions, ...publicOptions]
}

export const avatarCloneRefs = {
  mediaSelectionId,
  voiceSelectionId,
  clones,
  usableClones,
  trainingClones,
  loading,
  error,
  createError,
  creating,
  noticeAcknowledged,
  voiceCreating,
  voiceCreateError,
  voiceCreatedName,
}

export const avatarCloneComputeds = {
  usableClones,
  trainingClones,
}

export const avatarCloneMethods = {
  loadAvatarClones,
  chooseMedia,
  chooseVoiceMedia,
  createAvatarClone,
  createVoiceClone,
  removeAvatarClone,
  renameAvatarCloneById,
  invalidReasonKey,
  friendlyError,
  buildMergedAvatarOptions,
  reset,
}

/**
 * 测试专用复位：composable 是模块级单例，跨用例会残留上一条的列表/错误态。
 * 与 useAvatarCatalog.resetAvatarCatalogForTest 同型——不复位会让
 * 「上一条已加载成功」影响下一条的分支判定。
 */
export function resetAvatarCloneForTest () {
  requestId = 0
  loadRequestId = 0
  reset()
}
