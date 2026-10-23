/**
 * useAvatarClone —— 数字人形象克隆（avatar-voice-clone）
 *
 * 与 useAvatarCatalog 分开：目录读的是 HeyGen 公共形象，本 composable 管的是
 * 「用户自己上传素材克隆出来的形象」——有创建/删除/重命名/训练轮询等写操作，
 * 且带 attestation 与审计语义，混进只读目录会让职责边界失真。
 *
 * 素材刻意走两段式（chooseMedia → add）：renderer 不直接传路径或字节，
 * 路径只能由主进程对话框产生（与 tts-voice-clone 同型的安全边界）。
 */
import { ref, computed } from 'vue'
import {
  listAvatarClones,
  chooseAvatarCloneMedia,
  addAvatarClone,
  deleteAvatarClone,
  renameAvatarClone,
} from '@/api/avatar-clone'

const clones = ref([])
const loading = ref(false)
const error = ref('')
/** 一次性合规提示是否已阅（写 userSetting，不再弹出） */
const noticeAcknowledged = ref(false)
/** 正在创建中的 selectionId（用于禁用重复提交） */
const creating = ref(false)
const createError = ref('')
let requestId = 0
let loadRequestId = 0

function reset () {
  clones.value = []
  loading.value = false
  error.value = ''
  creating.value = false
  createError.value = ''
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
 * 两步创建：先弹主进程对话框选素材，再按 selectionId 创建。
 *
 * @param {object} input
 * @param {'photo'|'digital_twin'} input.type
 * @param {string} input.name
 * @param {'self'|'third_party_authorized'} [input.sourceKind]
 * @param {string} [input.providerId] 数字人服务商（change: digital-human-multiprovider）
 */
async function createAvatarClone (input) {
  const my = ++requestId
  creating.value = true
  createError.value = ''
  try {
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
    const selectionId = chosen.data && chosen.data.selectionId
    if (!selectionId) {
      createError.value = friendlyError(chosen && chosen.message)
      return { success: false }
    }

    const added = await addAvatarClone({
      selectionId,
      name: input.name,
      type: input.type,
      sourceKind: input.sourceKind,
      providerId: input.providerId,
    })
    if (my !== requestId) return { success: false, canceled: true }
    if (added && added.code === 0 && added.data && added.data.avatar) {
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
  clones,
  usableClones,
  trainingClones,
  loading,
  error,
  createError,
  creating,
  noticeAcknowledged,
}

export const avatarCloneComputeds = {
  usableClones,
  trainingClones,
}

export const avatarCloneMethods = {
  loadAvatarClones,
  createAvatarClone,
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
