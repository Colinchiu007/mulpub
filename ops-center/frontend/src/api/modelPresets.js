import { createApiClient } from './http'

const api = createApiClient()

export function listModelPresets(params = {}) {
  return api.get('/model-presets', { params }).then(r => r.data)
}

export function getModelPreset(id) {
  return api.get(`/model-presets/${id}`).then(r => r.data)
}

export function createModelPreset(data) {
  return api.post('/model-presets', data).then(r => r.data)
}

export function updateModelPreset(id, data) {
  return api.put(`/model-presets/${id}`, data).then(r => r.data)
}

export function deleteModelPreset(id) {
  return api.delete(`/model-presets/${id}`).then(r => r.data)
}

export function fetchModelIds(id, data) {
  return api.post(`/model-presets/${id}/fetch-models`, data).then(r => r.data)
}

export function reorderModelPreset(id, action, visibleIds) {
  const body = { action }
  if (Array.isArray(visibleIds)) body.visible_ids = visibleIds
  return api.post(`/model-presets/${id}/reorder`, body).then(r => r.data)
}

/**
 * 能力默认模型总览（voice-model-program-resolved，2026-10-18）。
 * 桌面应用使用某种能力时，具体模型由程序按此处配置的默许模型解析，不再要求用户选择。
 * @returns {Promise<{capabilities: Array<{capability: string, providers: Array<{id,name,category,model,is_configured}>}>, missing_count: number}>}
 */
export function fetchCapabilityOverview() {
  return api.get('/model-presets/capability-overview').then(r => r.data)
}
