/**
 * usePodcastHosting.js — 对象存储托管配置与「把本频道 feed 发出去」的渲染层状态
 *
 * 为什么不塞进 usePodcastChannel.js：那个文件是**页面态的聚合**（频道/单集/feed/分发端），
 * 已经贴着逐文件行数门禁的上限；更要紧的是判据不同 —— 托管是**全局一份**（跨频道共用凭证），
 * 发布是**按频道**的动作，两者混在一个 composable 里会出现「切频道要不要清托管」这种伪问题。
 *
 * ⛔ secret 的驻留边界：AK/SK 只存在于表单 ref 里，`saveHosting` 一旦返回就立刻清空。
 *    主进程回的是掩码，渲染层任何时候都不持有明文 —— 这条不是洁癖：状态树会进 DevTools、
 *    进错误上报的 payload、进崩溃转储，而它们都没有「只看一次」的语义。
 */
import { computed, ref } from 'vue'

import {
  hostingGet, hostingSave, hostingCheck, feedPublish,
} from '@/api/podcast-channel'

import { IPC_EXCEPTION, IPC_UNAVAILABLE, issueText, toPlain } from './usePodcastChannel'

const SECRET_FIELDS = ['accessKeyId', 'accessKeySecret']

export function makeHostingForm () {
  return {
    provider: 'oss',
    endpoint: '',
    bucket: '',
    pathPrefix: '',
    accessKeyId: '',
    accessKeySecret: '',
  }
}

export function usePodcastHosting () {
  const hosting = ref(null)
  const hostingLoaded = ref(false)
  const savingHosting = ref(false)
  const checking = ref(false)
  const publishing = ref(false)
  const checkResult = ref(null)
  const publishResult = ref(null)
  const hostingError = ref('')
  const hostingIssues = ref([])

  const configured = computed(() => Boolean(hosting.value && hosting.value.configured))
  /** 表单回填：secret 永不回填（主进程也不回显），空值即「保持不变」 */
  const formFromHosting = () => Object.assign(makeHostingForm(), {
    provider: (hosting.value && hosting.value.provider) || 'oss',
    endpoint: (hosting.value && hosting.value.endpoint) || '',
    bucket: (hosting.value && hosting.value.bucket) || '',
    pathPrefix: (hosting.value && hosting.value.pathPrefix) || '',
  })

  async function call (invoke, ...args) {
    let envelope
    try {
      envelope = await invoke(...args)
    } catch (err) {
      return { ok: false, code: IPC_EXCEPTION, message: (err && err.message) || String(err) }
    }
    if (!envelope || !envelope.available) return { ok: false, code: IPC_UNAVAILABLE }
    const res = envelope.result
    if (res == null || typeof res !== 'object') return { ok: false, code: IPC_EXCEPTION }
    if (res.ok === false && res.subCode) return Object.assign({}, res, { code: res.subCode })
    return res
  }

  async function loadHosting () {
    hostingError.value = ''
    const res = await call(hostingGet)
    if (res.ok) {
      hosting.value = res.hosting == null ? null : res.hosting
      hostingLoaded.value = true
    } else {
      hostingError.value = res.code || IPC_EXCEPTION
    }
    return res
  }

  async function saveHosting (form, opts = {}) {
    hostingError.value = ''
    hostingIssues.value = []
    const payload = {
      provider: form.provider,
      endpoint: form.endpoint,
      bucket: form.bucket,
      pathPrefix: form.pathPrefix,
    }
    // 缺席 = 保持不变：只有用户真填了才提交，否则连空串都不发（空串会被落盘层判成覆写）
    for (const f of SECRET_FIELDS) {
      if (typeof form[f] === 'string' && form[f].trim() !== '') payload[f] = form[f]
    }
    if (opts.clearSecret === true) payload.clearSecret = true
    savingHosting.value = true
    try {
      const res = await call(hostingSave, toPlain(payload))
      if (res.ok) {
        hosting.value = res.hosting || null
        hostingIssues.value = []
      } else {
        hostingError.value = res.code || IPC_EXCEPTION
        hostingIssues.value = Array.isArray(res.issues) ? res.issues : []
      }
      return res
    } finally {
      // 无论成功失败都收：失败的 secret 也不该继续留在渲染层状态里
      for (const f of SECRET_FIELDS) form[f] = ''
      savingHosting.value = false
    }
  }

  async function checkHosting () {
    hostingError.value = ''
    checking.value = true
    try {
      const res = await call(hostingCheck)
      if (res.ok) checkResult.value = res
      else hostingError.value = res.code || IPC_EXCEPTION
      return res
    } finally {
      checking.value = false
    }
  }

  /** 发布 feed 到 OSS。返回体本身是分层的（success / failed / busy…），不在这里压成布尔。 */
  async function publishFeed (channelId) {
    hostingError.value = ''
    publishResult.value = null
    publishing.value = true
    try {
      const res = await call(feedPublish, { channelId })
      if (res.ok) publishResult.value = res
      else hostingError.value = res.code || IPC_EXCEPTION
      return res
    } finally {
      publishing.value = false
    }
  }

  return {
    hosting,
    hostingLoaded,
    hostingError,
    hostingIssues,
    savingHosting,
    checking,
    publishing,
    checkResult,
    publishResult,
    configured,
    formFromHosting,
    loadHosting,
    saveHosting,
    checkHosting,
    publishFeed,
    hostingIssueText: (issue) => issueText(issue),
  }
}
