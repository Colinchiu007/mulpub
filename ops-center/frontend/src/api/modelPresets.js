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
