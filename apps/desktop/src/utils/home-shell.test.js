/**
 * home-shell 工具纯逻辑单测（PRD-TAB-INDEPENDENT-HOME-2026-09-22 §4 数据校验）
 */
import { describe, it, expect } from 'vitest'
import { isHomeShellSearch } from '@/utils/home-shell'

describe('isHomeShellSearch（内嵌主页壳态判据）', () => {
  it('?mp-home-shell=1 命中', () => {
    expect(isHomeShellSearch('?mp-home-shell=1')).toBe(true)
  })

  it('hash 路由共存时仍命中（createWebHashHistory 下 search 形如 ?mp-home-shell=1#/accounts）', () => {
    expect(isHomeShellSearch('?mp-home-shell=1#/accounts')).toBe(true)
  })

  it('参数值非 1 不命中', () => {
    expect(isHomeShellSearch('?mp-home-shell=0')).toBe(false)
    expect(isHomeShellSearch('?mp-home-shell=true')).toBe(false)
  })

  it('无参数 / 空串 / null / undefined 不命中', () => {
    expect(isHomeShellSearch('')).toBe(false)
    expect(isHomeShellSearch('#/')).toBe(false)
    expect(isHomeShellSearch(null)).toBe(false)
    expect(isHomeShellSearch(undefined)).toBe(false)
  })

  it('相似参数名（mp-home-shellx）不误命中', () => {
    expect(isHomeShellSearch('?mp-home-shellx=1')).toBe(false)
  })

  it('多参数中命中', () => {
    expect(isHomeShellSearch('?foo=bar&mp-home-shell=1')).toBe(true)
  })
})
