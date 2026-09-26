// @ts-check
/**
 * account-profile-collector.test.js — 账号资料采集与写回契约
 * （PRD-ACCOUNT-PROFILE-INFO-2026-09-23，T1~T6）
 *
 * 缺陷背景：昵称/头像提取能力自 2026-08 起就存在，但（a）只挂在渲染层零调用的
 * account:add 死通道上、（b）2026-09-14 曾因函数体引用未导入标识符（no-undef）
 * 被 catch 吞成 {}，功能自引入以来从未生效；（c）未命中字段被算成空串 PATCH 下去，
 * 反向清空上一次已获取的真值。本文件把这三类退化全部钉住。
 *
 * 关键手法：用 new Function 在全新作用域里求值采集器的字符串源码 ——
 * 采集器一旦闭合任何模块作用域变量（require/PLATFORM_ACCOUNT_INFO_SELECTORS/log…），
 * 这里就会 ReferenceError 而不是静默返回空对象。这同时覆盖了 Playwright
 * （函数体被序列化注入页面）与 Electron executeJavaScript（只能接受字符串）两个运行时。
 */
import { describe, expect, it, vi } from 'vitest'

const { JSDOM } = require('jsdom')
const ap = require('@multi-publish/shared-utils/src/account-profile')
const { PLATFORM_ACCOUNT_INFO_SELECTORS } = require('@multi-publish/shared-utils/src/platform-definitions')

/** 在隔离作用域中执行采集器源码（等价于页面上下文）。 */
function collect (bodyHtml, platformSelectors = null) {
  const dom = new JSDOM('<!doctype html><html><head></head><body>' + bodyHtml + '</body></html>')
  const factory = new Function('document', 'return (' + ap.accountInfoCollector.toString() + ')')
  return factory(dom.window.document)({ platformSelectors })
}

describe('accountInfoCollector — 昵称多层回退（T1）', () => {
  it('命中平台专用选择器时优先采用（专用表先于通用表，未命中才继续兜底）', () => {
    const both = '<div class="ProfileHeader-name"> 知乎用户甲 </div><span class="user-nickname">通用昵称</span>'
    expect(collect(both, { nickname: ['.ProfileHeader-name'] }).nickName).toBe('知乎用户甲')
    expect(collect('<div class="whatever">噪声</div>', { nickname: ['.should-miss'] }).nickName).toBeUndefined()
  })

  it('通用选择器兜底（class 含 nickname）', () => {
    expect(collect('<span class="user-nickname">通用昵称</span>').nickName).toBe('通用昵称')
  })

  // 历史断言（「无 DOM 命中时回落 og/twitter/document.title」）把网页标题当成了昵称来源，
  // 属于「测试反向固化错误行为」：2026-09-26 生产库 6 条脏 account_name 里有 4 条
  // （小红书创作服务平台 / 快手创作者服务平台 / 抖音创作者中心 / 哔哩哔哩 (゜）正是这条兜底产出的。
  // 网页标题永远不是账号昵称，故此处改为断言「标题一律不采纳」。
  it('标题类来源一律不作为昵称（og:title / twitter:title / document.title）', () => {
    const cases = [
      '<meta property="og:title" content="公众号甲">',
      '<meta name="twitter:title" content="推特标题名">',
      '<title>我的主页 - 哔哩哔哩</title>',
      '<title>哔哩哔哩 (゜-゜)つロ 干杯~-bilibili</title>',
      '<title>小红书创作服务平台</title>',
    ]
    for (const head of cases) {
      const dom = new JSDOM('<!doctype html><html><head>' + head + '</head><body></body></html>')
      const factory = new Function('document', 'return (' + ap.accountInfoCollector.toString() + ')')
      expect([head, factory(dom.window.document)({}).nickName]).toEqual([head, undefined])
    }
  })

  it('昵称选择器不得命中统计块/占位文案等装饰容器', () => {
    // 生产脏数据的另外两条来源：宽匹配选择器吃到了页面统计块与输入框占位文案。
    expect(collect('<div class="creator-data"><span>485.9万人看过</span></div>').nickName).toBeUndefined()
    expect(collect('<div class="user-info">分享此刻的想法...同步到圈子发想法</div>').nickName).toBeUndefined()
    expect(collect('<div class="profile-card"><strong>0粉丝0关注0获赞</strong></div>').nickName).toBeUndefined()
  })

  it('昵称候选超长（容器整块文本）不采纳，短昵称正常采纳', () => {
    const long = '甲'.repeat(31)
    expect(collect('<span class="user-nickname">' + long + '</span>').nickName).toBeUndefined()
    expect(collect('<span class="user-nickname">甲乙丙</span>').nickName).toBe('甲乙丙')
  })
})

describe('accountInfoCollector — 头像三层回退（T2）', () => {
  it('img src 优先；无 src 时取 data-src', () => {
    expect(collect('<div class="avatar"><img src="https://cdn/a.png"></div>').avatar).toBe('https://cdn/a.png')
    expect(collect('<div class="avatar"><img data-src="https://cdn/b.png"></div>').avatar).toBe('https://cdn/b.png')
  })

  it('背景图 url() 与 og:image 回退', () => {
    expect(collect('<div class="avatar-img" style="background-image:url(\'https://cdn/c.png\')"></div>').avatar)
      .toBe('https://cdn/c.png')
    const dom = new JSDOM('<!doctype html><html><head><meta property="og:image" content="https://cdn/d.png"></head><body></body></html>')
    const factory = new Function('document', 'return (' + ap.accountInfoCollector.toString() + ')')
    expect(factory(dom.window.document)({}).avatar).toBe('https://cdn/d.png')
  })

  it('完全没有头像线索时不产出 avatar 键（不得用空串冒充）', () => {
    const info = collect('<div>只有文字</div>')
    expect('avatar' in info).toBe(false)
  })
})

describe('accountInfoCollector — 粉丝数与平台 ID（T3）', () => {
  it('「1.2万」折算为 12000，千分位逗号剥离', () => {
    expect(ap.collectFollowersText).toBeUndefined() // 防误导出：解析必须在采集器内部完成
    expect(collect('<span class="fans-count">1.2万</span>').followers).toBe(12000)
    expect(collect('<span class="fans-count">1,234 粉丝</span>').followers).toBe(1234)
    expect(collect('<span class="fans-count">暂无数据</span>').followers).toBeUndefined()
  })

  it('平台专用选择器未命中时回退通用选择器（不得因平台表落空就放弃）', () => {
    expect(collect('<span class="user-nickname">跨表兜底</span>', { nickname: ['.should-miss'] }).nickName).toBe('跨表兜底')
    expect(collect('<span class="fans-count">999</span>', { followers: ['.should-miss'] }).followers).toBe(999)
  })

  it('平台 ID 取 data-user-id / data-account-id 属性', () => {
    expect(collect('<div data-user-id="uid-9">x</div>').platformAccountId).toBe('uid-9')
    expect(collect('<div data-account-id="wx-1">x</div>', PLATFORM_ACCOUNT_INFO_SELECTORS.wechat_mp).platformAccountId).toBe('wx-1')
  })
})

describe('collector 双运行时入口（T4/T5）', () => {
  it('buildCollectorExpression 内联选择器且可独立求值', async () => {
    const expr = ap.buildCollectorExpression(PLATFORM_ACCOUNT_INFO_SELECTORS.zhihu)
    expect(expr).toContain('ProfileHeader-name')
    expect(expr).not.toContain('require(')
    const dom = new JSDOM('<!doctype html><html><body><div class="ProfileHeader-name">内联求值</div></body></html>')
    const fn = new Function('document', 'return ' + expr)
    expect(fn(dom.window.document).nickName).toBe('内联求值')
  })

  it('collectWithPlaywright 保持既有调用形状：evaluate(fn, { platformSelectors })', async () => {
    const evaluate = vi.fn(async () => ({ nickName: '张三' }))
    const info = await ap.collectWithPlaywright({ evaluate }, 'zhihu')
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(evaluate.mock.calls[0][0]).toBe(ap.accountInfoCollector)
    expect(evaluate.mock.calls[0][1].platformSelectors).toBe(PLATFORM_ACCOUNT_INFO_SELECTORS.zhihu)
    expect(info).toEqual({ nickName: '张三' })

    const nullProbe = vi.fn(async () => ({}))
    await ap.collectWithPlaywright({ evaluate: nullProbe }, '')
    expect(nullProbe.mock.calls[0][1].platformSelectors).toBeNull()
  })

  it('采集失败静默降级 {}：Playwright 抛错、webContents 不可用、返回非对象', async () => {
    await expect(ap.collectWithPlaywright({ evaluate: vi.fn(async () => { throw new Error('boom') }) }, 'zhihu'))
      .resolves.toEqual({})
    await expect(ap.collectWithWebContents(null, 'zhihu')).resolves.toEqual({})
    await expect(ap.collectWithWebContents({ executeJavaScript: vi.fn(async () => 'not-an-object') }, 'zhihu'))
      .resolves.toEqual({})
    await expect(ap.collectWithWebContents({ executeJavaScript: vi.fn(async () => { throw new Error('crash') }) }, 'zhihu'))
      .resolves.toEqual({})
    const ok = vi.fn(async () => ({ nickName: '甲' }))
    await expect(ap.collectWithWebContents({ executeJavaScript: ok }, 'weibo')).resolves.toEqual({ nickName: '甲' })
    expect(ok.mock.calls[0][0]).toContain('gn_name')
  })
})

describe('buildProfilePatch — 「字段缺席 = 不修改」契约（T6）', () => {
  it('提取全失败 → 空补丁（绝不产出空串反向覆写真源）', () => {
    expect(ap.buildProfilePatch({})).toEqual({})
    expect(ap.buildProfilePatch({ nickName: '   ', avatar: '' })).toEqual({})
    expect(ap.buildProfilePatch(null, null)).toEqual({})
    expect(ap.buildProfilePatch('垃圾', {})).toEqual({})
  })

  it('只产出命中字段，且与真源相同的字段跳过（不制造无意义写盘）', () => {
    expect(ap.buildProfilePatch({ nickName: '新昵称', avatar: 'https://x/a.png' }))
      .toEqual({ account_name: '新昵称', avatar: 'https://x/a.png' })
    expect(ap.buildProfilePatch(
      { nickName: '旧昵称', avatar: 'https://x/a.png', followers: 12, platformAccountId: 'uid-1' },
      { account_name: '旧昵称', avatar: 'https://x/a.png', followers: 12, platform_account_id: 'uid-1' },
    )).toEqual({})
  })

  it('followers：0 合法、负数与非数字拒绝', () => {
    expect(ap.buildProfilePatch({ followers: 0 })).toEqual({ followers: 0 })
    expect(ap.buildProfilePatch({ followers: -5 })).toEqual({})
    expect(ap.buildProfilePatch({ followers: 'abc' })).toEqual({})
    expect(ap.buildProfilePatch({ followers: '88' })).toEqual({ followers: 88 })
  })

  it('profileForCreate：新行无旧值可保护，昵称回落显示名，未命中留空', () => {
    expect(ap.profileForCreate({}, '显示名')).toEqual({
      account_name: '显示名', platform_account_id: '', followers: null, avatar: '',
    })
    expect(ap.profileForCreate({ nickName: '真名', avatar: 'u', followers: 3 }, '显示名')).toEqual({
      account_name: '真名', platform_account_id: '', followers: 3, avatar: 'u',
    })
  })
})
