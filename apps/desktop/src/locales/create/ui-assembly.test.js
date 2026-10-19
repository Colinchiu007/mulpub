// @ts-check
/**
 * locale 结构拆分后的装配契约锁（2026-10-19，avatar-heygen-wiring）。
 *
 * 背景：`create/zh.js` 与 `create/en.js` 逼近 500 行门禁，把两段文案拆成子模块：
 *   - `create/avatar/{zh,en}.js` —— 数字人 21 键
 *   - `create/ui/{zh,en}.js`     —— 原 `story2video.ui` 整块
 * 装配点在 `create/{zh,en}.js` 的 `story2video.ui` 内。
 *
 * 这套拆法有两个**真实踩过的**失败模式，各配一条锁：
 *
 * 1. **重复定义**（deep review 首轮抓到的真 bug）：拆分时从 git HEAD 取的 ui 块
 *    里仍含 avatar 键，于是同一个键同时在 `avatar/*.js` 与 `ui/*.js` 里，
 *    `...uiZh` 静默覆盖 `...avatarZh`。功能"看起来正常"（值恰好一样），
 *    但改一处不生效、删一处不报错 —— 靠肉眼读不出来。
 *
 * 2. **漏装配**：子模块建好了但 import 后忘了展开（`...zh`），或展开层级错了
 *    （平铺在 `story2video` 而不是 `story2video.ui`），则整段 key unresolved，
 *    且**原有 key 一起消失**（如 `sectionBasic`）。单测里 `$t` 返回 key 本身，
 *    只有在断言"不等于 key"时才暴露。
 */
import { describe, it, expect } from 'vitest'
import i18n from '@/i18n'
import avatarZh from './avatar/zh'
import avatarEn from './avatar/en'
import uiZh from './ui/zh'
import uiEn from './ui/en'
import createZh from './zh'
import createEn from './en'

const UI_PREFIX = 'create.story2video.ui.'

/** 扁平化嵌套对象为点路径键集（只用于检测重复，不关心值）。 */
function flattenKeys (obj, prefix = '') {
  const out = []
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flattenKeys(v, path))
    else out.push(path)
  }
  return out
}

describe('locale 子模块装配契约', () => {
  it('avatar 子模块与 ui 子模块的键集不相交（防重复定义）', () => {
    for (const [label, avatar, ui] of [
      ['zh', avatarZh, uiZh],
      ['en', avatarEn, uiEn],
    ]) {
      const avatarKeys = new Set(flattenKeys(avatar))
      const dupes = flattenKeys(ui).filter((k) => avatarKeys.has(k))
      expect(dupes, `[${label}] avatar 与 ui 子模块重复定义的键`).toEqual([])
    }
  })

  it('装配后 avatar 键可见（防漏展开）', () => {
    const keys = [
      'avatarSectionTitle', 'avatarLabel', 'avatarVoiceLabel', 'avatarPlaceholder',
      'avatarVoicePlaceholder', 'avatarRefresh', 'avatarLoading', 'avatarLoadFailed',
      'avatarCachedFailed', 'avatarEmpty', 'avatarVoiceEmpty', 'avatarProviderMissing',
      'avatarGotoSettings', 'avatarNeedAvatar', 'avatarNeedVoice', 'avatarErrUnsupported',
      'avatarErrInvalidArgs', 'avatarErrApiUnavailable', 'avatarErrServiceUnavailable',
      'avatarErrAuthFailed', 'avatarErrUnknown',
    ]
    for (const k of keys) {
      const path = UI_PREFIX + k
      // 未命中时 vue-i18n 返回 key 本身 —— 只断言"存在"抓不到漏装配
      expect(i18n.global.t(path), path).not.toBe(path)
    }
  })

  it('装配后 ui 原有键可见（防展开层级写错）', () => {
    for (const k of ['sectionBasic', 'sectionAppearance', 'avatarRefresh']) {
      const path = UI_PREFIX + k
      expect(i18n.global.t(path), path).not.toBe(path)
    }
  })

  it('zh / en 两份装配结构对等（同层同键，防单侧漏改）', () => {
    const zhUiKeys = flattenKeys(createZh.story2video.ui).sort()
    const enUiKeys = flattenKeys(createEn.story2video.ui).sort()
    expect(zhUiKeys).toEqual(enUiKeys)
  })
})
