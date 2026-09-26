// @ts-check
import { describe, expect, it } from 'vitest'

import { resolveAccountDisplayName } from '@/utils/account-display-name'

const OPT = { platformLabel: '今日头条' }

describe('resolveAccountDisplayName — manual 一律原样显示', () => {
  // 这一组是本次回归的核心：它们全部命中守卫的形态规则，但因为是用户显式命名而必须显示。
  it.each([
    '阿飞 - 自由职业',      // 空格包裹的分隔符
    'Rhythm · 音乐厅',      // 空格包裹的间隔号
    '小美…的厨房',          // 省略号
    'David | 职场导师',     // 空格包裹的竖线
    '广东政务服务平台',      // 站点 chrome 后缀
    '哔哩哔哩 (゜',         // 括号不闭合
    '小红书创作服务平台',    // 即使恰好等于某个平台的页面名
  ])('manual %s 不得被过滤', (name) => {
    const acc = { account_name: name, name_source: 'manual' }
    expect(resolveAccountDisplayName(acc, OPT)).toBe(name)
  })
})

describe('resolveAccountDisplayName — auto 必须过噪声守卫', () => {
  it('真实昵称原样返回', () => {
    expect(resolveAccountDisplayName({ account_name: '数字生命丘丘', name_source: 'auto' }, OPT))
      .toBe('数字生命丘丘')
  })

  // 生产 accounts.json 里实际入库的 6 条脏值，逐条必须被拦。
  it.each([
    '485.9万人看过',
    '分享此刻的想法...同步到圈子发想法',
    '哔哩哔哩 (゜',
    '小红书创作服务平台',
    '快手创作者服务平台',
    '抖音创作者中心',
  ])('auto 脏值 %s 回落平台名', (name) => {
    expect(resolveAccountDisplayName({ account_name: name, name_source: 'auto' }, OPT)).toBe('今日头条')
  })

  it('name_source 缺失按 auto 处理（存量行向后兼容）', () => {
    expect(resolveAccountDisplayName({ account_name: '小红书创作服务平台' }, OPT)).toBe('今日头条')
    expect(resolveAccountDisplayName({ account_name: '真昵称' }, OPT)).toBe('真昵称')
  })
})

describe('resolveAccountDisplayName — 兜底链与边界', () => {
  // 本用例曾是「name 也当第二候选（过守卫）」的契约。该候选在真实数据上只会放行形态规则
  // 抓不到的页面标题（快手 name = 「快手，记录世界 记录你」：无连字符/省略号/平台后缀，
  // 守卫判不出噪声），即 Bug 的第二落点。故断言反转：name 一律不作为显示名来源。
  it('account_name 不合格时绝不采用 name（name 恒为 document.title 落盘位）', () => {
    expect(resolveAccountDisplayName({ account_name: '', name: '我的小号', name_source: 'auto' }, OPT))
      .toBe('今日头条')
    expect(resolveAccountDisplayName({ account_name: '', name: '首页 - 知乎' }, OPT)).toBe('今日头条')
    expect(resolveAccountDisplayName({ account_name: '', name: '公众号' }, OPT)).toBe('今日头条')
    // 真实存量形态：account_name 是「快手创作者服务平台」（命中平台后缀被拦），
    // name 是页面标语（守卫判不出）—— 旧实现会显示这条标语。
    expect(resolveAccountDisplayName({
      account_name: '快手创作者服务平台',
      name: '快手，记录世界 记录你',
    }, OPT)).toBe('今日头条')
  })

  it('两个字段都不合格时回落平台名', () => {
    expect(resolveAccountDisplayName({ account_name: '', name: '' }, OPT)).toBe('今日头条')
    expect(resolveAccountDisplayName({}, OPT)).toBe('今日头条')
    expect(resolveAccountDisplayName(null, OPT)).toBe('今日头条')
    expect(resolveAccountDisplayName(undefined, OPT)).toBe('今日头条')
  })

  it('无平台名可回落时返回空串（不得抛错，也不得显示 undefined）', () => {
    expect(resolveAccountDisplayName({ account_name: '头条号' }, {})).toBe('')
    expect(resolveAccountDisplayName({ account_name: '头条号' })).toBe('')
  })

  it('非字符串字段值不得被 String() 强转成可读文本', () => {
    expect(resolveAccountDisplayName({ account_name: { nope: 1 }, name: ['x'] }, OPT)).toBe('今日头条')
    expect(resolveAccountDisplayName({ account_name: 123, name_source: 'manual' }, OPT)).toBe('今日头条')
  })

  it('首尾空白被裁掉后再判定', () => {
    expect(resolveAccountDisplayName({ account_name: '  真昵称  ', name_source: 'auto' }, OPT)).toBe('真昵称')
  })
})
