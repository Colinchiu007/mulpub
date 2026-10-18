// @ts-check
/**
 * 顶部下移（top inset）单元测试 — 阶段 1.2 / audit-6
 *
 * 存在理由：`WebContentsView` 是压在渲染进程 DOM 之上的原生图层，CSS z-index 无效，
 * 它只能按主进程侧的镜像常量 `BROWSER_CHROME_TOP=76` 定位。渲染层一旦插入常驻 chrome
 * （运营公告横幅），必须把高度报给主进程，否则横幅被外部网页整块盖住
 * （与 2026-09-23「设置弹窗被网页盖住」同形）。这组判据钉的是这条通道的数值口径。
 *
 * @vitest-environment node
 */
const {
  BROWSER_CHROME_TOP,
  TOP_INSET_DEFAULT,
  MAX_TOP_INSET,
  normalizeTopInset,
  contentTopWithInset,
  computeEmbeddedViewBounds,
} = require('./view-bounds')

const WIN = {
  isDestroyed: () => false,
  getBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
  getContentBounds: () => ({ x: 8, y: 39, width: 1424, height: 861 }),
}

describe('normalizeTopInset', () => {
  it('0 是合法值（横幅消失后的收口态）—— 这一点必须与 normalizeSidebarWidth 不同', () => {
    expect(normalizeTopInset(0)).toBe(0)
  })

  it.each([12, 48, 96, MAX_TOP_INSET])('正整数 %i 原样取整保留', (px) => {
    expect(normalizeTopInset(px)).toBe(Math.round(px))
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['字符串', '60'],
    ['负数', -30],
    ['超过上限', MAX_TOP_INSET + 1],
  ])('%s 一律回落默认 0，不得把异常上报值拼进 setBounds', (_label, value) => {
    expect(normalizeTopInset(value)).toBe(TOP_INSET_DEFAULT)
  })

  it('上限是真数且远小于窗口高度（异常值把内容区压成 0 高是本类通道的最大风险）', () => {
    expect(Number.isFinite(MAX_TOP_INSET)).toBe(true)
    expect(MAX_TOP_INSET).toBeGreaterThan(0)
    expect(MAX_TOP_INSET).toBeLessThan(861)
  })
})

describe('contentTopWithInset', () => {
  it('无下移时逐字等于既有常量（浅色/无横幅态不得被本次改造改变）', () => {
    expect(contentTopWithInset(0)).toBe(BROWSER_CHROME_TOP)
    expect(contentTopWithInset(undefined)).toBe(BROWSER_CHROME_TOP)
  })

  it('有下移时是 76 + 下移量', () => {
    expect(contentTopWithInset(48)).toBe(BROWSER_CHROME_TOP + 48)
  })
})

describe('computeEmbeddedViewBounds 的顶部口径', () => {
  it('传入下移后 y 下移、height 等量收窄，x/width 不受影响', () => {
    const base = computeEmbeddedViewBounds(WIN, 200)
    const inset = computeEmbeddedViewBounds(WIN, 200, contentTopWithInset(50))
    expect(inset.y - base.y).toBe(50)
    expect(base.height - inset.height).toBe(50)
    expect(inset.x).toBe(base.x)
    expect(inset.width).toBe(base.width)
  })

  it('非数字的 topOffset 回落 BROWSER_CHROME_TOP，不产生 NaN 坐标', () => {
    const bad = computeEmbeddedViewBounds(WIN, 200, 'abc')
    expect(bad.y).toBe(BROWSER_CHROME_TOP)
    expect(Number.isFinite(bad.height)).toBe(true)
  })

  it('窗口被压得比 chrome 还矮时高度取 0，不得为负（Electron 拒绝负尺寸）', () => {
    const tiny = { getContentBounds: () => ({ width: 300, height: 60 }) }
    const b = computeEmbeddedViewBounds(tiny, 200, contentTopWithInset(20))
    expect(b.height).toBe(0)
  })
})
