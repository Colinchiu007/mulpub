/**
 * tts-voices-clone —— TTS 音色克隆的增删改（选择样本 / 自动入库 / 删除 / 重命名）
 *
 * 归属：克隆 CRUD 与行内重命名态；目录与音色选择见 `useTtsVoices`。
 */
import { state, requireDeps, s2vVoiceOptions } from './tts-voices-state'
import {
  getS2VVoiceCloneContext,
  isCurrentS2VVoiceCloneRequest,
  toS2VVoiceOption,
  friendlyVoiceCatalogError,
  nextS2VVoiceCloneName,
  selectS2VVoice,
} from './tts-voices-shared'
import {
  addTtsVoiceClone,
  chooseTtsVoiceCloneSamples,
  deleteTtsVoiceClone,
  renameTtsVoiceClone,
} from '@/api/tts-voice-clone'
import { confirmDanger } from '@/utils/confirm-danger'

async function chooseS2VVoiceCloneSamples() {
  const d = requireDeps()
  const context = getS2VVoiceCloneContext()
  const cloneEnabled = state.s2vVoiceCapability?.type === 'user_clone'
    && state.s2vVoiceCapability?.clone?.enabled === true
  if (!context || !cloneEnabled) return

  const requestId = ++state.s2vVoiceCloneRequestId
  state.s2vVoiceCloneLoading = true
  state.s2vVoiceCloneError = ''
  try {
    const result = await chooseTtsVoiceCloneSamples(d.cloneForIpc(context))
    if (!isCurrentS2VVoiceCloneRequest(requestId, context)) return
    const selectionId = typeof result?.data?.selectionId === 'string' ? result.data.selectionId : ''
    const sampleCount = Array.isArray(result?.data?.samples) ? result.data.samples.length : 0
    if (result?.code === 0 && selectionId && sampleCount > 0) {
      state.s2vVoiceCloneSelection = { selectionId, sampleCount }
      // 2026-08-12 需求调整：选择本地文件后自动保存为克隆音色（默认名「音色XXX」），
      // 不再需要手动填写名称并点击「添加克隆音色」；如需改名使用列表中的「重命名」。
      // 先释放「选择中」加载态，让 addS2VVoiceClone 进入自己的加载流程。
      if (isCurrentS2VVoiceCloneRequest(requestId, context)) state.s2vVoiceCloneLoading = false
      await addS2VVoiceClone(nextS2VVoiceCloneName())
      return
    }
    state.s2vVoiceCloneSelection = null
    if (result?.code !== 0) state.s2vVoiceCloneError = friendlyVoiceCatalogError(result?.message) || d.t('create.story2video.voice.cloneSamplePickFailed')
  } catch (error) {
    // 异常路径硬化（2026-08-13 审查 W1）：IPC 封装层已将 reject 统一转为错误码，此处兜底
    if (isCurrentS2VVoiceCloneRequest(requestId, context)) {
      state.s2vVoiceCloneSelection = null
      state.s2vVoiceCloneError = friendlyVoiceCatalogError(error?.message) || d.t('create.story2video.voice.cloneSamplePickFailed')
    }
  } finally {
    if (isCurrentS2VVoiceCloneRequest(requestId, context)) state.s2vVoiceCloneLoading = false
  }
}

async function addS2VVoiceClone(name = nextS2VVoiceCloneName()) {
  const d = requireDeps()
  const context = getS2VVoiceCloneContext()
  const selectionId = state.s2vVoiceCloneSelection?.selectionId
  const normalizedName = String(name || '').trim()
  if (!context || !selectionId || !normalizedName || state.s2vVoiceCloneLoading) return

  const requestId = ++state.s2vVoiceCloneRequestId
  state.s2vVoiceCloneLoading = true
  state.s2vVoiceCloneError = ''
  // 克隆进行中占位行：选完文件立即反馈「创建中」，避免长时间无响应观感（2026-08-13）
  state.s2vVoiceClonePending = {
    id: 'pending-' + requestId,
    name: normalizedName,
    sampleCount: state.s2vVoiceCloneSelection?.sampleCount || 1,
  }
  try {
    const result = await addTtsVoiceClone(d.cloneForIpc({
      ...context,
      name: normalizedName,
      selectionId,
      consent: true,
    }))
    if (!isCurrentS2VVoiceCloneRequest(requestId, context)) return
    const voice = result?.code === 0 ? toS2VVoiceOption(result.data?.voice) : null
    if (!voice) {
      // 自动保存失败：一次性选择令牌已被主进程销毁，清除本地快照避免「已选择 N 个样本」误导
      state.s2vVoiceCloneSelection = null
      state.s2vVoiceClonePending = null
      state.s2vVoiceCloneError = friendlyVoiceCatalogError(result?.message) || d.t('create.story2video.voice.cloneAddFailed')
      return
    }
    state.s2vVoiceClones = [
      ...state.s2vVoiceClones.filter(item => item.id !== voice.id),
      voice,
    ]
    state.s2vVoiceCloneSelection = null
    state.s2vVoiceClonePending = null
    // 克隆成功后自动把「语音 / 音色 ID」下拉切到新音色（s2v-voice-clone-auto-select）。
    // 必须先记下切换前的选中项：selectS2VVoice 内部会以「进入时的 voiceId」为回滚锚点，
    // 若在此处先写 voice.id，回滚目标就变成新值本身 ⇒ 偏好持久化失败时「回滚」是空操作，
    // 下拉会停留在一个从未保存成功的音色上（本行与 selectS2VVoice 的时序契约）。
    const previousVoiceId = d.getS2vConfig().voiceId
    d.getS2vConfig().voiceId = voice.id
    const selected = await selectS2VVoice(voice.id, { rollbackVoiceId: previousVoiceId })
    if (!selected) {
      // 偏好未落盘：克隆事实已成立（音色在下拉里），但不得谎报「已添加并已设为默认」。
      // 错误文案由 selectS2VVoice 写入 s2vVoiceCatalogError，这里只保证不弹成功提示。
      return
    }
    d.showOptionsToast(d.translate(
      'create.story2video.voice.cloneSuccessToast',
      d.t('create.story2video.voice.cloneSuccessToast', { name: voice.name }),
      'Cloned voice "' + voice.name + '" added',
      { name: voice.name },
    ))
  } catch (error) {
    // 异常路径硬化（2026-08-13 审查 W1）：IPC 封装层已将 reject 统一转为错误码，
    // 此处兜底保证未知 reject 也不「占位行凭空消失且无提示」。
    if (isCurrentS2VVoiceCloneRequest(requestId, context)) {
      state.s2vVoiceCloneSelection = null
      state.s2vVoiceClonePending = null
      state.s2vVoiceCloneError = friendlyVoiceCatalogError(error?.message) || d.t('create.story2video.voice.cloneAddFailed')
    }
  } finally {
    if (isCurrentS2VVoiceCloneRequest(requestId, context)) {
      state.s2vVoiceCloneLoading = false
      state.s2vVoiceClonePending = null
    }
  }
}

function s2vVoiceCloneStatusText() {
  const d = requireDeps()
  const pending = state.s2vVoiceClonePending
  if (!pending) return ''
  const count = Number.isFinite(pending.sampleCount) ? pending.sampleCount : 1
  return d.translate(
    'create.story2video.voice.cloneStatusPending',
    d.t('create.story2video.voice.cloneStatusPending', { count }),
    'Selected ' + count + ' sample(s). Uploading and cloning the voice... (usually 10-60 s, please wait)',
    { count },
  )
}

async function deleteS2VVoiceClone(voiceId) {
  const d = requireDeps()
  const context = getS2VVoiceCloneContext()
  const normalizedVoiceId = typeof voiceId === 'string' ? voiceId.trim() : ''
  if (!context || !normalizedVoiceId || state.s2vVoiceCloneLoading) return

  const requestId = ++state.s2vVoiceCloneRequestId
  state.s2vVoiceCloneLoading = true
  state.s2vVoiceCloneError = ''
  try {
    // 危险操作门禁（docs/frontend-interaction-spec.md §2）：删除克隆音色不可逆，
    // 确认文案须说明后果并点名受影响音色；取消时直接返回，不调用删除 API。
    const target = state.s2vVoiceClones.find(item => item.id === normalizedVoiceId)
    const voiceName = target?.name || normalizedVoiceId
    const confirmed = await confirmDanger({
      title: d.t('create.story2video.voice.cloneDeleteConfirmTitle'),
      message: d.t('create.story2video.voice.cloneDeleteConfirmMessage', { name: voiceName }),
      confirmText: d.t('create.story2video.voice.cloneDeleteConfirmButton'),
    })
    if (!confirmed) return

    const result = await deleteTtsVoiceClone(d.cloneForIpc({ ...context, voiceId: normalizedVoiceId }))
    if (!isCurrentS2VVoiceCloneRequest(requestId, context)) return
    if (result?.code !== 0) {
      state.s2vVoiceCloneError = friendlyVoiceCatalogError(result?.message) || d.t('create.story2video.voice.cloneDeleteFailed')
      return
    }
    state.s2vVoiceClones = state.s2vVoiceClones.filter(voice => voice.id !== normalizedVoiceId)
    state.s2vVoiceCatalog = state.s2vVoiceCatalog.filter(voice => voice.id !== normalizedVoiceId)
    if (d.getS2vConfig().voiceId === normalizedVoiceId) {
      const fallbackVoiceId = s2vVoiceOptions.value[0]?.id || ''
      d.getS2vConfig().voiceId = fallbackVoiceId
      if (fallbackVoiceId) await selectS2VVoice(fallbackVoiceId)
    }
  } finally {
    if (isCurrentS2VVoiceCloneRequest(requestId, context)) state.s2vVoiceCloneLoading = false
  }
}

function startS2VVoiceCloneRename(voiceId) {
  const d = requireDeps()
  const voice = state.s2vVoiceClones.find(item => item.id === voiceId)
  if (!voice || state.s2vVoiceCloneLoading) return
  state.s2vVoiceCloneRenamingId = voiceId
  state.s2vVoiceCloneRenameDraft = voice.name || ''
  state.s2vVoiceCloneError = ''
}

function cancelS2VVoiceCloneRename() {
  const d = requireDeps()
  state.s2vVoiceCloneRenamingId = ''
  state.s2vVoiceCloneRenameDraft = ''
  state.s2vVoiceCloneError = ''
}

async function renameS2VVoiceClone(voiceId) {
  const d = requireDeps()
  const context = getS2VVoiceCloneContext()
  const normalizedVoiceId = typeof voiceId === 'string' ? voiceId.trim() : ''
  const name = String(state.s2vVoiceCloneRenameDraft || '').trim()
  if (!context || !normalizedVoiceId || !name || state.s2vVoiceCloneLoading) return

  const requestId = ++state.s2vVoiceCloneRequestId
  state.s2vVoiceCloneLoading = true
  state.s2vVoiceCloneError = ''
  try {
    const result = await renameTtsVoiceClone(d.cloneForIpc({ ...context, voiceId: normalizedVoiceId, name }))
    if (!isCurrentS2VVoiceCloneRequest(requestId, context)) return
    const voice = result?.code === 0 ? toS2VVoiceOption(result.data?.voice) : null
    if (!voice) {
      state.s2vVoiceCloneError = friendlyVoiceCatalogError(result?.message) || d.t('create.story2video.voice.cloneRenameFailed')
      return
    }
    // 重命名只更新展示名；保留旧条目的 invalid 标记，避免失效克隆在重命名后被误判为可用
    const previous = state.s2vVoiceClones.find(item => item.id === voice.id)
    if (previous?.invalid === true) voice.invalid = true
    state.s2vVoiceClones = state.s2vVoiceClones.map(item => item.id === voice.id ? voice : item)
    state.s2vVoiceCloneRenamingId = ''
    state.s2vVoiceCloneRenameDraft = ''
  } finally {
    if (isCurrentS2VVoiceCloneRequest(requestId, context)) state.s2vVoiceCloneLoading = false
  }
}

export {
  chooseS2VVoiceCloneSamples,
  addS2VVoiceClone,
  s2vVoiceCloneStatusText,
  deleteS2VVoiceClone,
  startS2VVoiceCloneRename,
  cancelS2VVoiceCloneRename,
  renameS2VVoiceClone,
}
