/**
 * useAvatarCatalog —— 数字人形象/音色目录（avatar-spokesperson 流水线）
 *
 * 为什么独立成 composable 而不塞进 useTtsVoices：TTS 音色是「语音合成」语义，
 * 数字人形象是「avatar 资产」，两者 provider 能力与失败语义都不同，混在一起
 * 会让「音色加载失败」和「数字人列表加载失败」无法分别呈现。
 *
 * 竞态守卫沿用 useTtsVoices 的 requestId 范式：切流水线/重复刷新时，
 * 旧请求晚返回不得覆盖新结果（PRD §5.3）。
 */
import { ref, computed } from 'vue'
import { getAvatarCatalog, getAvatarVoiceCatalog } from '@/api/avatar-catalog'

export const AVATAR_PROVIDER_ID = 'heygen'

const avatars = ref([])
const voices = ref([])
const loading = ref(false)
const error = ref('')
/** 有缓存数据时的失败提示（列表仍可用，只是刷新没成功） */
const cachedError = ref('')
const loadedProvider = ref('')
let requestId = 0

function reset () {
  avatars.value = []
  voices.value = []
  loading.value = false
  error.value = ''
  cachedError.value = ''
  loadedProvider.value = ''
}

/**
 * 错误码 → 用户可读文案的 locale key 映射。
 *
 * 为什么不在这里直接写中文：CI Gate 7 的 CJK 基线扫描会拦截渲染端
 * （src/ 下非 locales 文件）新增的中文字符串字面量——用户可见文案一律走 locale。
 * 这里只返回 key，由调用方（CreateView）经 translateWithLocaleFallback 渲染。
 */
function friendlyError (message) {
  const text = String(message || '')
  if (text.includes('AVATAR_CATALOG_UNSUPPORTED_PROVIDER')) return 'avatarErrUnsupported'
  if (text.includes('AVATAR_CATALOG_INVALID_ARGUMENTS')) return 'avatarErrInvalidArgs'
  if (text.includes('AVATAR_CATALOG_API_UNAVAILABLE')) return 'avatarErrApiUnavailable'
  if (text.includes('AVATAR_CATALOG_UNAVAILABLE')) return 'avatarErrServiceUnavailable'
  if (text.includes('AUTH_FAILED') || text.includes('401')) return 'avatarErrAuthFailed'
  // 未识别的错误：透出原始 message（多为 ASCII 错误码，不含中文，不违反 CJK 基线）
  return text || 'avatarErrUnknown'
}

/**
 * 加载目录。
 * @param {{refresh?: boolean, isAlive?: () => boolean}} [options]
 */
async function loadAvatarCatalog (options = {}) {
  const my = ++requestId
  const refresh = options.refresh === true
  loading.value = true
  error.value = ''
  cachedError.value = ''
  try {
    const [avatarRes, voiceRes] = await Promise.all([
      getAvatarCatalog({ providerId: AVATAR_PROVIDER_ID, refresh }),
      getAvatarVoiceCatalog({ providerId: AVATAR_PROVIDER_ID, refresh }),
    ])
    if (my !== requestId) return // 已被更新的请求取代
    if (typeof options.isAlive === 'function' && options.isAlive() === false) return

    const avatarData = avatarRes && avatarRes.code === 0 && avatarRes.data ? avatarRes.data : null
    const voiceData = voiceRes && voiceRes.code === 0 && voiceRes.data ? voiceRes.data : null

    if (avatarData) {
      avatars.value = Array.isArray(avatarData.avatars) ? avatarData.avatars : []
    } else {
      avatars.value = []
    }
    if (voiceData) {
      voices.value = Array.isArray(voiceData.voices) ? voiceData.voices : []
    } else {
      voices.value = []
    }

    const failed = []
    if (!avatarData) failed.push(String(avatarRes?.message || ''))
    if (!voiceData) failed.push(String(voiceRes?.message || ''))
    if (failed.length) {
      const reason = friendlyError(failed.find(Boolean) || '')
      // 曾成功加载过 ⇒ 保留旧列表，只提示刷新失败
      if (loadedProvider.value === AVATAR_PROVIDER_ID) cachedError.value = reason
      else error.value = reason
    } else {
      loadedProvider.value = AVATAR_PROVIDER_ID
    }
  } catch (e) {
    if (my !== requestId) return
    const reason = friendlyError(e && e.message ? e.message : String(e))
    if (loadedProvider.value === AVATAR_PROVIDER_ID) cachedError.value = reason
    else error.value = reason
  } finally {
    if (my === requestId) loading.value = false
  }
}

function refreshAvatarCatalog () {
  return loadAvatarCatalog({ refresh: true })
}

const avatarOptions = computed(() => avatars.value.map((item) => ({
  id: String(item && item.id || '').trim(),
  name: String(item && item.name || item && item.id || '').trim(),
})).filter((item) => item.id))

const avatarVoiceOptions = computed(() => voices.value.map((item) => ({
  id: String(item && item.id || '').trim(),
  name: String(item && item.name || item && item.id || '').trim(),
  language: String(item && item.language || '').trim(),
})).filter((item) => item.id))

export function useAvatarCatalog () {
  return {
    // refs
    avatarLoading: loading,
    avatarError: error,
    avatarCachedError: cachedError,
    // computeds
    avatarOptions,
    avatarVoiceOptions,
    // methods
    loadAvatarCatalog,
    refreshAvatarCatalog,
  }
}

export const avatarCatalogRefs = { loading, error, cachedError }
export const avatarCatalogComputeds = { avatarOptions, avatarVoiceOptions }
export const avatarCatalogMethods = { loadAvatarCatalog, refreshAvatarCatalog }
export function resetAvatarCatalogForTest () { requestId = 0; reset() }
