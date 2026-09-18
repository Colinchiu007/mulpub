import { createApiClient } from './http'

const api = createApiClient()

export function listRewriteHardConstraints() {
  return api.get('/rewrite-hard-constraints').then(r => r.data)
}

export function createRewriteHardConstraint(data) {
  return api.post('/rewrite-hard-constraints', data).then(r => r.data)
}

export function updateRewriteHardConstraint(id, data) {
  return api.put(`/rewrite-hard-constraints/${encodeURIComponent(id)}`, data).then(r => r.data)
}

export function deleteRewriteHardConstraint(id) {
  return api.delete(`/rewrite-hard-constraints/${encodeURIComponent(id)}`).then(r => r.data)
}

export function setDefaultRewriteHardConstraint(id) {
  return api.post(`/rewrite-hard-constraints/${encodeURIComponent(id)}/set-default`).then(r => r.data)
}
