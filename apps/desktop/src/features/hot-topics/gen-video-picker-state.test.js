// @ts-check
import { describe, it, expect } from 'vitest'
import {
  activePickerUid,
  nextPickerUid,
  computeGenVideoPickerPlacement,
  computeGenVideoPickerMenuSize,
  PICKER_MENU_GAP,
  PICKER_MENU_MIN_HEIGHT,
  PICKER_MENU_MAX_HEIGHT,
} from './gen-video-picker-state'

describe('gen-video-picker-state', () => {
  it('allocates strictly increasing picker uids', () => {
    const a = nextPickerUid()
    const b = nextPickerUid()
    expect(b).toBeGreaterThan(a)
    expect(activePickerUid.value).toBe(null)
  })

  it('opens downward when there is enough room below', () => {
    expect(computeGenVideoPickerPlacement({
      buttonRect: { top: 200, bottom: 240 },
      menuHeight: 320,
      viewportTop: 0,
      viewportBottom: 1000,
    })).toBe('bottom')
    expect(PICKER_MENU_GAP).toBe(6)
  })

  it('flips upward when the panel would be clipped below and there is more room above', () => {
    expect(computeGenVideoPickerPlacement({
      buttonRect: { top: 300, bottom: 340 },
      menuHeight: 320,
      viewportTop: 0,
      viewportBottom: 420,
    })).toBe('top')
  })

  it('stays downward when neither side fits but below is larger', () => {
    expect(computeGenVideoPickerPlacement({
      buttonRect: { top: 60, bottom: 100 },
      menuHeight: 320,
      viewportTop: 0,
      viewportBottom: 360,
    })).toBe('bottom')
  })

  it('defaults downward for unavailable geometry', () => {
    expect(computeGenVideoPickerPlacement()).toBe('bottom')
    expect(computeGenVideoPickerPlacement({ buttonRect: null, menuHeight: 320 })).toBe('bottom')
    expect(computeGenVideoPickerPlacement({ buttonRect: { top: 0, bottom: 0 }, menuHeight: NaN })).toBe('bottom')
  })

  it('clamps the menu height to the space on the chosen side', () => {
    // 下方 101px 可用（526 - 425）：压缩到 101-6=95 → 但受最小高度 160 保护
    expect(computeGenVideoPickerMenuSize({
      placement: 'bottom',
      buttonRect: { top: 387, bottom: 425 },
      viewportTop: 184,
      viewportBottom: 526,
    })).toBe(PICKER_MENU_MIN_HEIGHT)
    // 上方可用 202px：197 是有效高度（不小于最小、不大于理想值）
    expect(computeGenVideoPickerMenuSize({
      placement: 'top',
      buttonRect: { top: 387, bottom: 425 },
      viewportTop: 184,
      viewportBottom: 526,
    })).toBe(197)
    // 空间充足时保持理想高度
    expect(computeGenVideoPickerMenuSize({
      placement: 'bottom',
      buttonRect: { top: 200, bottom: 240 },
      viewportTop: 0,
      viewportBottom: 1200,
    })).toBe(PICKER_MENU_MAX_HEIGHT)
    // 几何缺失时回退理想高度
    expect(computeGenVideoPickerMenuSize()).toBe(PICKER_MENU_MAX_HEIGHT)
  })
})
