/**
 * useHistoryCoverThumbnails — 发布历史页「真实封面缩略图」的解析与加载
 *
 * ## 为什么单独成文件
 *
 * `PublishHistory.vue` 逐文件行数门禁已挂账 1205 行（growthAllowance 200 ⇒ 上限 1405），
 * 而此前该文件已 1393 行 —— 只剩 12 行余量。解析逻辑（本地路径判定、IPC 读取、
 * 缓存、竞态）全部落在这里，视图侧只留「引入 + 一处取值 + 模板里一个 src」。
 * 与 `usePublishHistoryContentLink.js` 的拆出同因。
 *
 * ## 修的是什么
 *
 * 用户报障「发布的历史记录页，发布任务的缩略图好像不是发布的真实的封面图片」。
 * 根因不在渲染端：`thumbnailUrl(record)` 读 `thumbnail|thumbnailUrl|cover|coverUrl`，
 * 而两个落库点（`bootstrap/phase4-events.js` 的 task:success / task:failed）
 * **一个封面键都没写** ⇒ 恒为空 ⇒ 模板回退平台图标。
 * 写侧已由 `publish-record-cover.js` 补齐（新增 `cover_path` / `cover_url`），
 * 本模块负责把写侧的产物**渲染出来**。
 *
 * ## 两条不可省的约束
 *
 * ① **本地绝对路径不能直接当 `<img src>`**：渲染层 CSP 的 `img-src` 不含 `file:`，
 *    必须经主进程 `cover:read-data` 转 dataURL（既有通道，`useCoverPreview.js` 同源结论）。
 * ② **迟到响应不得写回**：用户快速切筛选/翻页会让同一条记录的封面请求被重新发起，
 *    迟到的旧响应若写状态，缩略图会显示上一次的封面 —— 那比「没有缩略图」更糟
 *    （错误证据）。故每次加载领一个序号，写状态前比对，不等即整段丢弃。
 */
import { onScopeDispose, ref, watch } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { safeHttpUrl } from '@multi-publish/shared-utils/src/safe-http-url'

/** 本地图片路径判据（盘符 / UNC / POSIX 绝对路径 / file://）；协议判据一律走 `safeHttpUrl` */
export function isLocalImagePath (value) {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (!v) return false
  if (v.startsWith('file://')) return true
  if (v.startsWith('\\\\')) return true
  if (/^[a-zA-Z]:[\\/]/.test(v)) return true
  if (v.startsWith('/')) return true
  return false
}

function trimmed (value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * @param {import('vue').Ref<Array<object>>|import('vue').ComputedRef<Array<object>>} records 当前展示的记录集合
 * @param {{readCoverData?: Function}} [options] 测试替身注入点（默认走 `cover:read-data` IPC）
 */
export function useHistoryCoverThumbnails (records, options = {}) {
  // path -> { status: 'ok' | 'failed', url }
  const state = ref({})
  const inFlight = new Set()
  let generation = 0

  const reader = typeof options.readCoverData === 'function'
    ? options.readCoverData
    : () => getApi()?.readCoverData

  async function load (imagePath) {
    if (inFlight.has(imagePath)) return
    inFlight.add(imagePath)
    const token = generation
    let next = { status: 'failed', url: '' }
    try {
      const read = reader()
      if (typeof read === 'function') {
        const result = await read(imagePath)
        const url = result?.data?.dataUrl || result?.dataUrl || ''
        if (result?.code === 0 && typeof url === 'string' && url.trim()) {
          next = { status: 'ok', url }
        }
      }
    } catch (_) {
      // 读取失败 → 回退平台图标（不得渲染破图）；原因不影响展示面，故不弹错
    } finally {
      inFlight.delete(imagePath)
    }
    if (token !== generation) return
    state.value = { ...state.value, [imagePath]: next }
  }

  /** 远程封面候选（顺序即优先级），全部须过共享协议判据 */
  function remoteUrlOf (record) {
    return safeHttpUrl(record?.cover_url)
      || safeHttpUrl(record?.coverUrl)
      || safeHttpUrl(record?.thumbnailUrl)
      || safeHttpUrl(record?.thumbnail)
      || safeHttpUrl(record?.cover)
      || ''
  }

  /** 本地封面候选：`cover_path` 优先（写侧语义最明确），其余为存量键兼容 */
  function localPathOf (record) {
    for (const candidate of [record?.cover_path, record?.thumbnailUrl, record?.thumbnail, record?.cover]) {
      const v = trimmed(candidate)
      if (isLocalImagePath(v)) return v
    }
    return ''
  }

  /**
   * 同步解析出可渲染的封面地址；本地封面仍在读取时返回空串（**不闪成远程图/平台图标**）。
   * @returns {string}
   */
  function coverUrlFor (record) {
    const localPath = localPathOf(record)
    if (localPath) {
      const entry = state.value[localPath]
      if (entry && entry.status === 'ok') return entry.url
      if (!entry) return ''
    }
    return remoteUrlOf(record)
  }

  watch(records, (list) => {
    if (!Array.isArray(list)) return
    for (const record of list) {
      const localPath = localPathOf(record)
      if (!localPath || state.value[localPath]) continue
      void load(localPath)
    }
  }, { immediate: true })

  onScopeDispose(() => { generation += 1 })

  return { coverUrlFor, isLocalImagePath }
}
