import { createApiClient } from './http'

const api = createApiClient()

/** 应用菜单配置：列出全部菜单项（含 forced_visible_keys 用于前端灰显） */
export function listAppMenu() {
  return api.get('/app-menu').then(r => r.data)
}

/** 保存显示/隐藏与排序；返回 { items, corrections, count } */
export function saveAppMenu(items) {
  return api.put('/app-menu', { items }).then(r => r.data)
}

/** 恢复默认（全部可见 + 目录默认顺序） */
export function resetAppMenu() {
  return api.post('/app-menu/reset').then(r => r.data)
}
