import { createApiClient } from './http'

const api = createApiClient()

export function grantMemberPlan(data) {
  return api.post('/member/grants', data).then(r => r.data)
}
