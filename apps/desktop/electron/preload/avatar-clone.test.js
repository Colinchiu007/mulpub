import { describe, expect, it, vi } from 'vitest'

import { createAvatarCloneApi } from './avatar-clone'

describe('数字人形象克隆 preload API', () => {
  it('只暴露固定的受控 IPC 通道', async () => {
    const ipcRenderer = { invoke: vi.fn(async () => ({ code: 0 })) }
    const api = createAvatarCloneApi(ipcRenderer)

    await api.avatarClone.list({})
    await api.avatarClone.chooseMedia({ type: 'photo' })
    await api.avatarClone.add({ selectionId: 'sel-1', name: 'x', type: 'photo' })
    await api.avatarClone.delete({ avatarId: 'av-1' })
    await api.avatarClone.rename({ avatarId: 'av-1', name: '新名' })

    expect(ipcRenderer.invoke.mock.calls).toEqual([
      ['avatar-clone:list', {}],
      ['avatar-clone:choose-media', { type: 'photo' }],
      ['avatar-clone:add', { selectionId: 'sel-1', name: 'x', type: 'photo' }],
      ['avatar-clone:delete', { avatarId: 'av-1' }],
      ['avatar-clone:rename', { avatarId: 'av-1', name: '新名' }],
    ])
  })

  it('不提供通用 invoke（暴露面只有这五个方法）', () => {
    const ipcRenderer = { invoke: vi.fn(async () => ({ code: 0 })) }
    const api = createAvatarCloneApi(ipcRenderer)
    expect(Object.keys(api.avatarClone).sort()).toEqual([
      'add', 'chooseMedia', 'delete', 'list', 'rename',
    ])
  })
})
