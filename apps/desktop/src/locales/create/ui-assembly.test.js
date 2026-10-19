// 验证 locale 装配后 key 是否可见（走真实 i18n 实例）
import { describe, it, expect } from 'vitest'
import i18n from '@/i18n'

describe('locale 装配验证', () => {
  it('create.story2video.ui.avatar* 可见', () => {
    const keys = [
      'avatarSectionTitle', 'avatarLabel', 'avatarVoiceLabel', 'avatarPlaceholder',
      'avatarVoicePlaceholder', 'avatarRefresh', 'avatarLoading', 'avatarEmpty',
      'avatarNeedAvatar', 'avatarNeedVoice',
    ]
    for (const k of keys) {
      const path = 'create.story2video.ui.' + k
      const value = i18n.global.t(path)
      // 未命中时 vue-i18n 返回 key 本身
      expect(value, path).not.toBe(path)
    }
  })

  it('ui 原有 key 未被破坏', () => {
    const path = 'create.story2video.ui.sectionBasic'
    expect(i18n.global.t(path)).not.toBe(path)
  })
})
