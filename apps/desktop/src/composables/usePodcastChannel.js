/**
 * usePodcastChannel — 播客 RSS 频道（小宇宙收录）数据层
 *
 * 架构前提：小宇宙没有发布 API，它是 RSS 聚合端。本模块不是"新增发布平台"：
 * 不登记 platforms.yaml / publish-capabilities / platform-definitions / rpa selectors，
 * 也不触碰 publishMode。它是一条独立的"频道"实体 —— 频道元信息配置一次，
 * 逐期追加单集，生成/更新 Podcast RSS，再按分发端目录把 feed 地址提交给各聚合端。
 *
 * IPC 合同（与主进程代理共享，键名以合同为准；取用一律经
 *   src/api/podcast-channel.js 的 8 个具名导出，导出名即下列键名）：
 *   channelGet()    → { ok, channel, feedSync }
 *   channelSave(c)  → { ok, channel }
 *   episodeList()   → { ok, episodes }
 *   episodeSave(e)  → { ok, episode }（新增/原地更新，按 id）
 *   episodeRemove(id) → { ok }
 *   feedBuild()     → { ok, xml, path, itemCount }
 *   feedVerify()    → { ok, issues, checks, itemCount }
 *   endpointList()  → { endpoints }
 *
 * 纪律：
 * - 传给主进程的对象一律 JSON.parse(JSON.stringify(x)) 脱壳（QM-2 IPC 参数序列化），
 *   reactive proxy 直接传会抛 "An object could not be cloned"。桥接层也会再脱一次，
 *   对本文件是幂等的；保留本地脱壳是因为它同时承担"不可序列化即返回 null"的判据，
 *   那才会产出 PAYLOAD_NOT_SERIALIZABLE 这个用户可见错误码。
 * - 校验码文案映射只在本文件持有一份（issueText），视图不得再抄第二份。
 * - 分发端目录：优先消费 IPC endpointList()；主进程不可达时降级到共享引擎的
 *   ESM 孪生 podcast-endpoints.browser.js 的本地目录（只读展示，不写库）。
 * - 全程零真实网络请求；feed 可达性自检由主进程注入 headImpl 完成。
 */
import { ref, computed } from 'vue'
import { createPodcastChannelPicker } from './usePodcastChannelPicker'
import i18n from '@/i18n'
// 渲染端 IPC 唯一取用点（单轨制）：本文件任何位置（含注释）都不得直写桌面端暴露面
// 的属性名——结构锁见 src/composables/usePodcastChannel-ipc.test.js「IPC 单轨制结构锁」
import {
  channelList,
  channelCreate,
  channelRename,
  channelSetDefault,
  channelMigrateResolve,
  channelGet,
  channelSave,
  episodeList,
  episodeSave,
  episodeRemove,
  feedBuild,
  feedVerify,
  endpointList,
} from '@/api/podcast-channel'
import { listPodcastEndpoints } from '@multi-publish/shared-utils/src/podcast-endpoints'
// 共享引擎的 ESM 孪生（vite alias 登记，见 apps/desktop/vite.config.js）：只消费枚举与目录，禁止改写
import {
  ITUNES_CATEGORIES,
  EXPLICIT_VALUES,
  EPISODE_TYPE_VALUES,
  EPISODE_FEED_TYPE_VALUES,
  formatDuration,
} from '@multi-publish/shared-utils/src/podcast-rss'

/** IPC 不可用 / 调用抛错的自有错误码（与引擎校验码同层展示，走 podcast.errors.*） */
export const IPC_UNAVAILABLE = 'PODCAST_IPC_UNAVAILABLE'
export const IPC_EXCEPTION = 'PODCAST_IPC_EXCEPTION'
/** 表单载荷无法脱壳为纯 JSON（循环引用等），同样属于渲染侧错误 */
export const PAYLOAD_NOT_SERIALIZABLE = 'PODCAST_PAYLOAD_NOT_SERIALIZABLE'

/** 顶级分类列表（引擎单一真源派生，视图下拉用） */
export const CHANNEL_CATEGORIES = Object.freeze(Object.keys(ITUNES_CATEGORIES))

/** 子分类（按顶级派生，引擎单一真源） */
export function subCategoriesOf (top) {
  return Object.freeze([...(ITUNES_CATEGORIES[top] || [])])
}

/** 分级取值 / 单集类型 / feed 类型枚举（引擎单一真源） */
export const EXPLICIT_OPTIONS = EXPLICIT_VALUES
export const EPISODE_TYPE_OPTIONS = EPISODE_TYPE_VALUES
export const CHANNEL_EPISODE_TYPE_OPTIONS = EPISODE_FEED_TYPE_VALUES

/** 把响应式对象脱壳成可序列化的纯 JSON；失败（循环引用等）返回 null 并由调用方报错 */
export function toPlain (value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

/** 生成单集 id/guid 草稿用短标识 */
function genId () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/**
 * IPC 信封 → 渲染层结论的**唯一**归一点（QM-6 前端评审指出托管 composable 抄了第二份）。
 * 两份判据必然漂移：`subCode` 优先这条规则一旦只在一处更新，另一处就会拿 EC 数字去查文案，
 * 症状是「新增的领域码只显示成一句通用失败」——正是 §6 每码成对要防的形态。
 * 调用方各自保留自己的 try/catch（异常→IPC_EXCEPTION 的措辞属于调用现场，不该上收）。
 */
export function normalizeIpcEnvelope (envelope) {
  if (!envelope || envelope.available !== true) return { ok: false, code: IPC_UNAVAILABLE }
  const res = envelope.result
  if (res == null || typeof res !== 'object') return { ok: false, code: IPC_EXCEPTION }
  if (res.ok === false && res.subCode) return Object.assign({}, res, { code: res.subCode })
  return res
}

/**
 * 校验码 → 用户可见文案。未知码走带 code 的兜底文案（禁止把裸码直接甩给用户，
 * 也不允许静默吞掉——未知码必须可见，否则新增校验码会以"空白提示"的形态逃逸）。
 */
export function issueText (issue) {
  const code = issue && issue.code ? String(issue.code) : ''
  const { t, te } = i18n.global
  const key = `podcast.errors.${code}`
  if (code && te(key)) return t(key)
  return t('podcast.errors.fallback', { code: code || 'UNKNOWN' })
}

/**
 * 表单 ↔ 引擎合同键名的唯一映射点。
 *
 * 为什么必须存在：引擎 validateChannel 读的是 `categoryId`（形如 "Arts/Books"，最多两级）
 * 与 `feedType`，而界面表单按用户阅读习惯持有 `category` + `subCategory` + `feedType`。
 * 少一次映射的症状是「分类明明选了、保存却报『播客分类不能为空』」——
 * 用户以为是校验坏了，实际是键名断链（AGENTS.md「适配器入参键必须与调用方契约键一致」同源）。
 * 反向映射用于编辑回填，缺它会把已存的 categoryId 显示成空下拉。
 */
export function channelFormToPayload (form) {
  const { category, subCategory, ...rest } = form || {}
  const top = String(category || '').trim()
  const sub = String(subCategory || '').trim()
  const payload = { ...rest }
  if (top) payload.categoryId = sub ? `${top}/${sub}` : top
  return payload
}

/** 引擎载荷 → 表单（回填用） */
export function channelPayloadToForm (payload) {
  const base = makeChannelDraft()
  if (!payload || typeof payload !== 'object') return base
  const [top = '', sub = ''] = String(payload.categoryId || '').split('/').map((s) => s.trim())
  const { categoryId, ...rest } = payload
  return { ...base, ...rest, category: top, subCategory: sub }
}

/** 频道表单草稿（默认值与引擎校验默认口径一致：language=zh-CN、feedType=episodic） */
function makeChannelDraft () {
  return {
    title: '',
    link: '',
    description: '',
    subtitle: '',
    language: 'zh-CN',
    author: '',
    ownerName: '',
    ownerEmail: '',
    explicit: 'no',
    feedType: 'episodic',
    coverUrl: '',
    coverSize: '',
    category: '',
    subCategory: '',
    audioSource: 'url',
  }
}

// 刀 1 起频道是复数：这 7 个调用必须带 channelId，且**只在这一个出口注入**。
// 在 7 个调用点各写一份 `channelId: activeChannelId.value` 是本仓反复踩过的「一件事两处写」，
// 漏一处就是「读 A 频道、写 B 频道」级别的错乱。endpoint 目录与频道无关，故不在表内。
const CHANNEL_SCOPED = new Set([
  channelGet, channelSave, episodeList, episodeSave, episodeRemove, feedBuild, feedVerify,
])

/**
 * @returns 频道状态 / 单集列表 / feed 生成与自检 / 分发端目录 的全部状态与动作
 */
/**
 * 校验码 → 用户可见文案（模块级唯一实现）。
 * 视图侧一律经这一个函数取文案：卡片与页面各自写一份 `te(key) ? t(key) : fallback` 时，
 * 「未知码不得静默」这条判据就会在两处漂移，最后只剩界面上一句空白提示。
 */
export function errorCodeText (code) {
  const key = `podcast.errors.${String(code || '')}`
  const { t, te } = i18n.global
  return code && te(key) ? t(key) : t('podcast.errors.fallback', { code: String(code || 'UNKNOWN') })
}

export function usePodcastChannel () {
  const channel = ref(null) // null = 未配置
  const channelLoaded = ref(false)
  const savingChannel = ref(false)
  const channelError = ref('')
  // 公网 feed 的同步真源（channel.json 的 feedSync 段）。null = 从未发布或从未写入。
  const feedSync = ref(null)

  const episodes = ref([])
  const episodesLoaded = ref(false)
  const savingEpisode = ref(false)
  const episodesError = ref('')

  const feedResult = ref(null) // { ok, xml, path, itemCount } | { ok:false, error }
  const buildingFeed = ref(false)

  const verifyResult = ref(null) // { ok, issues, checks, itemCount } | { ok:false, error }
  const verifying = ref(false)

  const endpoints = ref([])
  const endpointsError = ref('')

  const channelIssues = computed(() => {
    const issues = []
    if (verifyResult.value && Array.isArray(verifyResult.value.issues)) {
      for (const it of verifyResult.value.issues) {
        if (String((it && it.code) || '').startsWith('CHANNEL_')) issues.push(it)
      }
    }
    return issues
  })

  /**
   * 统一 IPC 调用：命名空间缺失**或权限前置条件不满足**（未登录 / 许可证未激活，
   * 由桥接层归进 available:false）→ IPC_UNAVAILABLE；其余调用抛错 → IPC_EXCEPTION。
   * 取用桌面端暴露面的动作不在本文件发生，一律经 src/api/podcast-channel.js
   *（IPC 渲染端访问单轨制，check-frontend-consistency 计数钉 0）。
   * 形参收的是**桥接层函数引用**而非方法名字符串：字符串派发会让桥接层退化成
   * 「按变量名转发」，ipc-exposure-contract 的静态对账就看不见这条路径。
   */
  async function call (invoke, ...args) {
    if (CHANNEL_SCOPED.has(invoke)) {
      // 没有频道上下文就先补，而不是带着空串发出去：空串打到主进程会被判
      // PODCAST_CHANNEL_ID_REQUIRED，用户看到的是一句莫名其妙的失败
      if (!activeChannelId.value) await ensureChannel()
      const head = args[0]
      const base = head && typeof head === 'object' ? head : (typeof head === 'string' ? { id: head } : {})
      args = [Object.assign({}, base, { channelId: activeChannelId.value }), ...args.slice(1)]
    }
    let envelope
    try {
      envelope = await invoke(...args)
    } catch (err) {
      return { ok: false, code: IPC_EXCEPTION, message: (err && err.message) || String(err) }
    }
    // 归一规则只在 `normalizeIpcEnvelope` 一处（含「领域码优先」这条，见该函数注释）
    return normalizeIpcEnvelope(envelope)
  }

  async function loadChannel () {
    await ensureChannel()
    channelError.value = ''
    const res = await call(channelGet)
    if (res.ok) {
      channel.value = res.channel == null ? null : res.channel
      // 横幅的唯一数据来源就是这里；主进程不带 feedSync 时保持 null，
      // 不得凭空造一个「已同步」——那会把「读侧没接线」演成「一切正常」。
      feedSync.value = res.feedSync == null ? null : res.feedSync
    } else {
      channelError.value = res.code || IPC_EXCEPTION
    }
    channelLoaded.value = true
    return res
  }

  async function loadEpisodes () {
    await ensureChannel()
    episodesError.value = ''
    const res = await call(episodeList)
    if (res.ok) {
      episodes.value = Array.isArray(res.episodes) ? res.episodes : []
    } else {
      episodesError.value = res.code || IPC_EXCEPTION
    }
    episodesLoaded.value = true
    return res
  }

  /**
   * 分发端目录：优先 IPC（主进程与引擎 CJS 同源）；不可达时降级本地 ESM 孪生目录。
   * 降级只影响指引展示（纯静态数据），不影响任何写操作。
   */
  async function loadEndpoints () {
    endpointsError.value = ''
    const res = await call(endpointList)
    if (res && res.endpoints && Array.isArray(res.endpoints) && res.endpoints.length > 0) {
      endpoints.value = res.endpoints
      return { ok: true, source: 'ipc' }
    }
    try {
      endpoints.value = listPodcastEndpoints()
      if (!res.ok) endpointsError.value = res.code || IPC_EXCEPTION
      return { ok: true, source: 'local' }
    } catch {
      endpoints.value = []
      endpointsError.value = IPC_UNAVAILABLE
      return { ok: false, code: IPC_UNAVAILABLE }
    }
  }

  /** 保存频道配置；载荷先脱壳（QM-2 IPC 序列化纪律） */
  async function saveChannel (payload) {
    savingChannel.value = true
    channelError.value = ''
    try {
      const plain = toPlain(payload)
      if (plain == null) {
        channelError.value = PAYLOAD_NOT_SERIALIZABLE
        return { ok: false, code: PAYLOAD_NOT_SERIALIZABLE }
      }
      const res = await call(channelSave, channelFormToPayload(plain))
      if (res.ok && res.channel) channel.value = res.channel
      else if (!res.ok) channelError.value = res.code || IPC_EXCEPTION
      return res
    } finally {
      savingChannel.value = false
    }
  }

  /** 新增/原地更新单集（按 id）；成功后同步本地列表 */
  async function saveEpisode (payload) {
    savingEpisode.value = true
    episodesError.value = ''
    try {
      const plain = toPlain(payload)
      if (plain == null) {
        episodesError.value = PAYLOAD_NOT_SERIALIZABLE
        return { ok: false, code: PAYLOAD_NOT_SERIALIZABLE }
      }
      const res = await call(episodeSave, plain)
      if (res.ok && res.episode) {
        const saved = res.episode
        const idx = episodes.value.findIndex((e) => e && e.id === saved.id)
        if (idx >= 0) episodes.value.splice(idx, 1, saved)
        else episodes.value.push(saved)
      } else if (!res.ok) {
        episodesError.value = res.code || IPC_EXCEPTION
      }
      return res
    } finally {
      savingEpisode.value = false
    }
  }

  async function removeEpisode (id) {
    episodesError.value = ''
    const res = await call(episodeRemove, String(id == null ? '' : id))
    if (res.ok) {
      episodes.value = episodes.value.filter((e) => e && e.id !== id)
    } else {
      episodesError.value = res.code || IPC_EXCEPTION
    }
    return res
  }

  /** 生成 feed 文件到 userData（主进程落盘并跑引擎校验） */
  async function buildFeed () {
    buildingFeed.value = true
    feedResult.value = null
    try {
      const res = await call(feedBuild)
      feedResult.value = res && res.ok
        ? { ok: true, path: res.path || '', itemCount: Number(res.itemCount) || 0 }
        : { ok: false, code: (res && res.code) || IPC_EXCEPTION, issues: (res && res.issues) || [] }
      return feedResult.value
    } finally {
      buildingFeed.value = false
    }
  }

  /** feed 自检（可达性等由主进程注入 headImpl 执行；渲染层零出站） */
  async function verifyFeed () {
    verifying.value = true
    verifyResult.value = null
    try {
      const res = await call(feedVerify)
      // ok 取自引擎语义（issues 为空才算通过），不沿用 IPC envelope 的 ok——
      // 主进程成功路径恒回 code=0，envelope.ok 对任何有 issues 的结果都是 true。
      const issues = Array.isArray(res?.issues) ? res.issues : null
      verifyResult.value = issues
        ? {
            ok: issues.length === 0,
            issues,
            checks: Array.isArray(res.checks) ? res.checks : [],
            itemCount: Number(res.itemCount) || 0,
          }
        : { ok: false, code: (res && res.code) || IPC_EXCEPTION, issues: [], checks: [], itemCount: 0 }
      return verifyResult.value
    } finally {
      verifying.value = false
    }
  }

  /** 单集表单草稿（guid/pubDate 预填，其余留空由用户填写） */
  function makeEpisodeDraft () {
    return {
      id: genId(),
      title: '',
      description: '',
      audioUrl: '',
      localFilePath: '',
      durationSec: null,
      sizeBytes: null,
      pubDate: new Date().toISOString(),
      explicit: '',
      episodeType: 'full',
      guid: `podcast-${genId()}`,
    }
  }

  /** 列表时长展示：引擎 formatDuration 单一口径 */
  function durationText (sec) {
    const n = Number(sec)
    if (!Number.isFinite(n) || n <= 0) return ''
    return formatDuration(n)
  }


  // 频道目录域拆到 usePodcastChannelPicker.js（逐文件行数门禁 + 「目录态与页面态各有各的不变量」）；
  // 本文件只留页面态与它的清理责任，切换频道时要清什么由这里说，不由目录模块猜。
  const picker = createPodcastChannelPicker({
    call,
    ipcException: IPC_EXCEPTION,
    onChannelActivated: async () => {
      channel.value = null
      episodes.value = []
      feedResult.value = null
      verifyResult.value = null
      feedSync.value = null // 随频道归属一起失效：留着 A 的 failed 去按 B 的 channelId 出站＝面向错误目标的不可逆外发写（QM-6 #1）
      await loadChannel()
      await loadEpisodes()
    },
  })
  const {
    channels,
    activeChannelId,
    migrationStatus,
    migrationConflicts,
    channelCap,
    channelCount,
    channelListError,
    switchingChannel,
    loadChannels,
    ensureChannel,
    createChannel,
    renameChannel,
    setDefaultChannel,
    resolveMigration,
    switchChannel,
    refreshQuota,
  } = picker

  return {
    // 状态
    channels,
    activeChannelId,
    migrationStatus,
    migrationConflicts,
    channelCap,
    channelCount,
    switchingChannel,
    loadChannels,
    createChannel,
    renameChannel,
    setDefaultChannel,
    resolveMigration,
    switchChannel,
    refreshQuota,
    channel,
    feedSync,
    channelLoaded,
    savingChannel,
    channelError,
    episodes,
    episodesLoaded,
    savingEpisode,
    episodesError,
    feedResult,
    buildingFeed,
    verifyResult,
    verifying,
    endpoints,
    endpointsError,
    channelIssues,
    // 动作
    loadChannel,
    loadEpisodes,
    loadEndpoints,
    saveChannel,
    saveEpisode,
    removeEpisode,
    buildFeed,
    verifyFeed,
    makeEpisodeDraft,
    makeChannelDraft,
    durationText,
    errorText: errorCodeText,
    channelListError,
    issueText,
  }
}
