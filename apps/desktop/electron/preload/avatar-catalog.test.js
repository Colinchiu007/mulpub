import { describe, expect, it, vi } from 'vitest'

import { createAvatarCatalogApi } from './avatar-catalog'

describe('数字人形象/音色目录 preload API', () => {
  it('只暴露固定的受控 IPC 通道', async () => {
    const ipcRenderer = { invoke: vi.fn(async () => ({ code: 0 })) }
    const api = createAvatarCatalogApi(ipcRenderer)

    await api.avatarCatalog.avatars({ providerId: 'heygen' })
    await api.avatarCatalog.voices({ providerId: 'heygen', refresh: true })
    await api.avatarCatalog.invalidate({ providerId: 'heygen' })

    expect(ipcRenderer.invoke.mock.calls).toEqual([
      ['avatar-catalog:avatars', { providerId: 'heygen' }],
      ['avatar-catalog:voices', { providerId: 'heygen', refresh: true }],
      ['avatar-catalog:invalidate', { providerId: 'heygen' }],
    ])
  })
})
