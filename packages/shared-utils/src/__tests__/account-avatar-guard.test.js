import { describe, it, expect } from 'vitest'

/**
 * account-avatar-guard — 「平台品牌图」判据
 *
 * 背景（2026-10-22 实测）：账号卡上出现**平台 logo** 当作用户头像，
 * 根因是 DOM 采集器的头像兜底链末端抓了 `meta[property="og:image"]`
 * —— 那是**站点级**的品牌图（头条号 `og:image` = `obj/mp/logo-toutiao.png`），
 * 与「这是谁的账号」毫无关系。落盘后它就成了账号的头像，且再也不会被覆盖。
 *
 * 本模块的职责：给出一条**可判定**的规则，把「站点品牌资产」从「用户头像」里剔出去。
 * 刻意**不**判定「平台默认头像」（如 B 站 `noface.jpg`）——那是该账号真实在用的头像，
 * 剔掉它等于让用户看到空白，反而不如展示平台自己的默认图。
 */
import { isBrandImageUrl, filterBrandImageUrls } from '../account-avatar-guard.js'

describe('account-avatar-guard 平台品牌图判据', () => {
  it('头条号站点 logo（实测落盘过的坏值）判为品牌图', () => {
    expect(isBrandImageUrl('https://sf3-cdn-tos.toutiaostatic.com/obj/mp/logo-toutiao.png')).toBe(true)
    expect(isBrandImageUrl('https://p3.toutiaoimg.com/obj/mp/logo-toutiao.png?x-bce-process=image/format,f_auto')).toBe(true)
  })

  it('文件名形态的品牌资产（logo/favicon/brand）判为品牌图', () => {
    expect(isBrandImageUrl('https://example.com/static/logo.png')).toBe(true)
    expect(isBrandImageUrl('https://example.com/favicon.ico')).toBe(true)
    expect(isBrandImageUrl('https://example.com/img/sitelogo.png?v=2')).toBe(true)
    expect(isBrandImageUrl('https://example.com/assets/logo-official.png')).toBe(true)
  })

  it('真实用户头像不得被误判为品牌图', () => {
    expect(isBrandImageUrl('https://i0.hdslb.com/bfs/face/member/noface.jpg')).toBe(false)
    expect(isBrandImageUrl('https://sns-avatar-qc.xhscdn.com/avatar/1040g2jo31f4g7li6me605pm5tehncbt224i4ono?imageView2/2/w/60/format/webp')).toBe(false)
    expect(isBrandImageUrl('https://p6.toutiaoimg.com/img/user-avatar/910883f6e1d6fa105646b9a063f0d9b2~300x300.image')).toBe(false)
    expect(isBrandImageUrl('https://pica.zhimg.com/v2-22dfe7094375e34e38695123acd219db_xl.jpg')).toBe(false)
    expect(isBrandImageUrl('https://wx.qlogo.cn/finderhead/yYI4pIsF7XFJ6ZVIQSYPf0vz9ITZv28GTYwAJy0gK4GgKUmSH9jS5GiblcAIuW5hvTBSsJK9epY0/0')).toBe(false)
  })

  // 回归锁（CCG 评审 i1）：前缀必须是**封闭词表**，不得用「任意词 + 连字符」这种
  // 开放形态 —— `user-logo.png` 是常见的真头像文件名，误杀的后果是
  // 「有头像的账号显示成灰色通用头像」，与本模块要修的缺陷同一类。
  it('真头像文件名里含 logo 字样也不得被误杀（封闭词表，不接受任意前缀）', () => {
    expect(isBrandImageUrl('https://cdn.example.com/user-logo.png')).toBe(false)
    expect(isBrandImageUrl('https://cdn.example.com/avatar/company-logo.jpg')).toBe(false)
    expect(isBrandImageUrl('https://cdn.example.com/catalog.png')).toBe(false)
    expect(isBrandImageUrl('https://cdn.example.com/photos/my-brand-photo.png')).toBe(false)
  })

  // 回归锁（CCG 评审 i2）：品牌词后面的**后缀**同样是封闭词表 ——
  // `logo-portrait.png` / `brand-new-avatar.jpg` 这类真头像文件名不得被误杀。
  it('品牌词后的任意后缀不得被误杀（后缀也是封闭词表）', () => {
    expect(isBrandImageUrl('https://cdn.example.com/logo-portrait.png')).toBe(false)
    expect(isBrandImageUrl('https://cdn.example.com/brand-new-avatar.jpg')).toBe(false)
    expect(isBrandImageUrl('https://cdn.example.com/logo-2024.png')).toBe(false)
  })

  it('非 URL / 空值不判品牌图（宁可不判，也不误杀）', () => {
    expect(isBrandImageUrl('')).toBe(false)
    expect(isBrandImageUrl(null)).toBe(false)
    expect(isBrandImageUrl(undefined)).toBe(false)
    expect(isBrandImageUrl('   ')).toBe(false)
    expect(isBrandImageUrl('not a url')).toBe(false)
  })

  it('filterBrandImageUrls 保留用户头像、剔除品牌图，且保持原有顺序', () => {
    const kept = filterBrandImageUrls([
      'https://example.com/static/logo.png',
      'https://i0.hdslb.com/bfs/face/member/noface.jpg',
      'https://cdn.example.com/avatar/a1.png',
    ])
    expect(kept).toEqual([
      'https://i0.hdslb.com/bfs/face/member/noface.jpg',
      'https://cdn.example.com/avatar/a1.png',
    ])
  })

  it('全部候选都是品牌图时返回空数组（宁可没头像，也不显示错图）', () => {
    expect(filterBrandImageUrls(['https://example.com/logo.png'])).toEqual([])
  })
})
