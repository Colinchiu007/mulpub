/**
 * ops-center-sync API 封装 — 运营后台模型配置运行时同步
 *
 * 桥接 Vue 组件 ↔ Electron 主进程 ops-center-sync.js（IPC：get/save/now）。
 * 运营后台配置（限流/模型/能力）经目录端点自动下发到桌面端，前端不再手工填写限流。
 */
function getApi () {
  return window.electronAPI || null
}

/** 读取同步配置（URL / 是否已配置 Key / 自动同步 / 上次同步时间；不含明文 Key） */
export async function opsCenterSyncGet () {
  const api = getApi()
  if (!api || !api.opsCenterSyncGet) return { code: -1, message: 'electronAPI not available', config: null }
  return api.opsCenterSyncGet()
}

/** 保存同步配置；apiKey 传空表示保留现有 Key */
export async function opsCenterSyncSave (payload) {
  const api = getApi()
  if (!api || !api.opsCenterSyncSave) return { code: -1, message: 'electronAPI not available' }
  return api.opsCenterSyncSave(payload)
}

/** 立即从运营后台拉取目录并下发到本地模型配置 */
export async function opsCenterSyncNow () {
  const api = getApi()
  if (!api || !api.opsCenterSyncNow) return { code: -1, message: 'electronAPI not available' }
  return api.opsCenterSyncNow()
}

/** 读取运行时策略状态（公告 / 版本发布 / 内容安全），不含敏感字段 */
export async function opsCenterSyncRuntime () {
  const api = getApi()
  if (!api || !api.opsCenterSyncRuntime) return { code: -1, message: 'electronAPI not available', data: null }
  return api.opsCenterSyncRuntime()
}

/** 视频创作流水线选项控制（2026-08-31）：运营中心下发的可见性与默认值 */
export async function opsCenterSyncPipelineOptions () {
  const api = getApi()
  if (!api || !api.opsCenterSyncPipelineOptions) return { code: -1, message: 'electronAPI not available', data: null }
  return api.opsCenterSyncPipelineOptions()
}

/**
 * 应用端左侧边栏菜单配置（2026-09-15）：运营中心「应用菜单」下发的显示/隐藏与排序。
 * data 为 null 表示本轮无有效配置 —— 调用方应 fail-open 回退本地默认菜单（不阻塞导航）。
 */
export async function opsCenterSyncAppMenu () {
  const api = getApi()
  if (!api || !api.opsCenterSyncAppMenu) return { code: -1, message: 'electronAPI not available', data: null }
  return api.opsCenterSyncAppMenu()
}

/**
 * 订阅「运营配置已更新」事件（主进程 applyRuntime 成功后广播）。
 * 运营中心改菜单/公告/开关后，渲染端据此重拉配置：启动那次同步晚于侧边栏首帧，没有该事件用户要多重启一次才看得到本次改动。
 * @param {(payload: {syncedAt?: string}) => void} callback
 * @returns {Function} 取消订阅函数（非 Electron 环境返回空操作）
 */
export function onOpsCenterRuntimeUpdated (callback) {
  const api = getApi()
  if (!api || typeof api.onOpsCenterRuntimeUpdated !== 'function') return () => {}
  return api.onOpsCenterRuntimeUpdated(callback)
}
