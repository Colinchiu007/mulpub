// hot-topics API — 热门选题模块 IPC 桥接（渲染层）
import { invokeWithFallback } from './electron-bridge'

export async function hotTopicsFetch(force = false, boostCategories = []) {
  return invokeWithFallback('hotTopicsFetch', { code: -1, data: null }, { force, boostCategories })
}

export async function hotTopicsGetCache() {
  return invokeWithFallback('hotTopicsGetCache', { code: -1, data: null })
}

// 收藏
export async function hotTopicsFavoriteAdd(topic) {
  return invokeWithFallback('hotTopicsFavoriteAdd', { code: -1, message: 'IPC unavailable' }, topic)
}

export async function hotTopicsFavoriteRemove(topicId) {
  return invokeWithFallback('hotTopicsFavoriteRemove', { code: -1, message: 'IPC unavailable' }, topicId)
}

export async function hotTopicsFavoriteList() {
  return invokeWithFallback('hotTopicsFavoriteList', { code: -1, data: [] })
}
