/**
 * usePodcastChannelPicker.js — 频道目录域：当前频道是谁、目录里有什么、迁移处于什么态、配额现算
 *
 * 为什么从 usePodcastChannel.js 拆出来（逐文件行数门禁 + 本仓「一件事两处写」反复欠账同源）：
 * 目录域与页面域（频道元信息 / 单集列表 / feed 产物）各有自己的不变量。混在一份文件里时，
 * 「切换频道要清哪几样」就只能靠人记住；拆开后本模块**不知道也不该知道**列表与 feed 的存放形状，
 * 由调用方通过 onChannelActivated 提供清理与重取的实现。
 *
 * ⛔ 配额（cap/count）每次动作前现算，禁止跨动作缓存（评审 #17：删除一期不刷新列表会让禁用态说谎）。
 */
import { ref } from 'vue'
import { channelList, channelCreate, channelRename, channelSetDefault, channelMigrateResolve, episodeList } from '@/api/podcast-channel'

/**
 * @param {object} deps
 * @param {(invoke: Function, ...args: any[]) => Promise<object>} deps.call 唯一的 IPC 出口（含 channelId 注入）
 * @param {string} deps.ipcException IPC 调用抛错时的自有错误码（由页面域持有，避免两个模块各写一份常量）
 * @param {() => Promise<void>} deps.onChannelActivated 频道切换后的清理与重取（列表/feed 的形状只有页面域知道）
 */
export function createPodcastChannelPicker (deps) {
  const { call, ipcException, onChannelActivated } = deps
  const channels = ref([])
  const activeChannelId = ref('')
  const migrationStatus = ref('')
  const migrationConflicts = ref([])
  const channelCap = ref(0)
  const channelCount = ref(0)
  const channelListError = ref('')
  const switchingChannel = ref(false)

  /** 频道目录 + 当前频道 + 迁移状态；未拿到频道前不得再发任何频道作用域调用 */
  async function loadChannels () {
    const res = await call(channelList)
    if (!res.ok) {
      channelListError.value = res.code || IPC_EXCEPTION
      return res
    }
    const data = res.data || res
    channels.value = Array.isArray(data.channels) ? data.channels : []
    migrationStatus.value = data.migrationStatus || ''
    migrationConflicts.value = Array.isArray(data.migrationConflicts) ? data.migrationConflicts : []
    if (!activeChannelId.value || !channels.value.some((x) => x.id === activeChannelId.value)) {
      activeChannelId.value = data.defaultChannelId || (channels.value[0] && channels.value[0].id) || ''
    }
    const first = channels.value.find((x) => x.id === activeChannelId.value)
    channelCap.value = (first && first.cap) || 0
    channelCount.value = (first && first.count) || 0
    return res
  }

  async function ensureChannel () {
    if (!channels.value.length || !activeChannelId.value) await loadChannels()
    return activeChannelId.value
  }

  async function createChannel (name) {
    const res = await call(channelCreate, { name: String(name == null ? '' : name).trim() })
    await loadChannels()
    return res
  }

  async function renameChannel (id, name) {
    const res = await call(channelRename, { channelId: id, name: String(name == null ? '' : name).trim() })
    await loadChannels()
    return res
  }

  async function setDefaultChannel (id) {
    const res = await call(channelSetDefault, { channelId: id })
    await loadChannels()
    return res
  }

  async function resolveMigration (direction) {
    const res = await call(channelMigrateResolve, { direction })
    await loadChannels()
    return res
  }

  async function switchChannel (id) {
    if (!id || id === activeChannelId.value) return { ok: true, skipped: true }
    switchingChannel.value = true
    activeChannelId.value = id
    try {
      // 清理与重取的形状只有页面域知道（见 deps.onChannelActivated 的理由），目录域不得猜。
      // 刀 1 拆分时这里直接写了 channel/episodes/feedResult/verifyResult 与 loadChannel()——
      // 那些标识符在本模块词法作用域里不存在，切频道整条路径必抛 ReferenceError（用户侧＝点了别的
      // 频道什么都没发生）。全仓当时没有一条用例引用 switchChannel，四层门禁因此全绿；QM-5 逃逸链
      // 与回归锁见 usePodcastChannel-switch.test.js 及 01-docs/BUGFIX-PODCAST-CHANNEL-SWITCH-2026-10-11.md。
      await onChannelActivated()
      await refreshQuota()
    } finally {
      switchingChannel.value = false
    }
    return { ok: true }
  }

  /** 每次发布/写动作前现算，禁止跨动作缓存 count（评审 #17） */
  async function refreshQuota () {
    const res = await call(episodeList)
    if (res.ok) {
      const data = res.data || res
      channelCap.value = Number(data.cap) || channelCap.value
      channelCount.value = Number.isFinite(data.count) ? data.count : (Array.isArray(data.episodes) ? data.episodes.length : 0)
    }
    return { cap: channelCap.value, count: channelCount.value }
  }

  return {
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
  }
}