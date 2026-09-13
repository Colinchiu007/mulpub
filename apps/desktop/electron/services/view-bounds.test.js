// @ts-check
/**
 * view-bounds 单元测试 — 内嵌 WebContentsView 客户区定位唯一来源
 *
 * 回归背景（2026-09-13）：
 * 账号管理点击账号卡片 → 打开平台网页（WebContentsView 内嵌标签）后，
 * 「右侧没有整个网页的滚动条、底部内容显示不全」。
 * 根因：布局用了 mainWindow.getBounds()（外框，含标题栏/菜单栏/边框），
 * 而 contentView 子视图的 setBounds 使用客户区坐标系 —— 视图比可见区域
 * 宽出左右边框、高出标题栏+底边框，滚动条与底部内容被窗口裁掉。
 * 本组测试钉死「必须用客户区尺寸」这一契约。
 *
 * @vitest-environment node
 */
const {
  BROWSER_CHROME_TOP,
  SIDEBAR_WIDTH_DEFAULT,
  normalizeSize,
  getContentSize,
  normalizeSidebarWidth,
  computeEmbeddedViewBounds,
} = require('./view-bounds')

/** 外框与客户区并存的真实窗口形态：外框大出标题栏+边框（Windows 100% DPI 典型值） */
const OUTER_BOUNDS = { x: 0, y: 0, width: 1440, height: 900 }
const CONTENT_BOUNDS = { x: 8, y: 39, width: 1424, height: 861 }

function createRealShapeWindow() {
  return {
    getBounds: () => ({ ...OUTER_BOUNDS }),
    getContentBounds: () => ({ ...CONTENT_BOUNDS }),
  }
}

describe('getContentSize（客户区尺寸读取与降级）', () => {
  it('优先使用 getContentBounds()（客户区），而不是 getBounds()（外框）', () => {
    const win = createRealShapeWindow()
    expect(getContentSize(win)).toEqual({ width: 1424, height: 861 })
  })

  it('getContentBounds 缺失时降级到 getContentSize() [width, height]', () => {
    const win = {
      getBounds: () => ({ ...OUTER_BOUNDS }),
      getContentSize: () => [1400, 850],
    }
    expect(getContentSize(win)).toEqual({ width: 1400, height: 850 })
  })

  it('客户区 API 全部缺失时才兜底 getBounds()（保证旧 mock 不崩）', () => {
    const win = { getBounds: () => ({ ...OUTER_BOUNDS }) }
    expect(getContentSize(win)).toEqual({ width: 1440, height: 900 })
  })

  it('无窗口或全部 API 抛错时返回 0 尺寸，不向调用方抛异常', () => {
    expect(getContentSize(null)).toEqual({ width: 0, height: 0 })
    expect(getContentSize({})).toEqual({ width: 0, height: 0 })
    const exploding = {
      getContentBounds: () => { throw new Error('destroyed') },
      getContentSize: () => { throw new Error('destroyed') },
      getBounds: () => { throw new Error('destroyed') },
    }
    expect(getContentSize(exploding)).toEqual({ width: 0, height: 0 })
  })

  it('非法尺寸（0 / 负值 / 缺字段）被跳过并继续降级', () => {
    const win = {
      getContentBounds: () => ({ width: 0, height: 0 }),
      getBounds: () => ({ width: 1000, height: 700 }),
    }
    expect(getContentSize(win)).toEqual({ width: 1000, height: 700 })
  })
})

describe('normalizeSize', () => {
  it('接受正尺寸对象与二元数组', () => {
    expect(normalizeSize({ width: 10, height: 20 })).toEqual({ width: 10, height: 20 })
    expect(normalizeSize([30, 40])).toEqual({ width: 30, height: 40 })
  })

  it('拒绝非法输入', () => {
    expect(normalizeSize(undefined)).toBeNull()
    expect(normalizeSize({})).toBeNull()
    expect(normalizeSize({ width: -1, height: 5 })).toBeNull()
    expect(normalizeSize([1])).toBeNull()
    expect(normalizeSize([0, 0])).toBeNull()
  })
})

describe('normalizeSidebarWidth', () => {
  it('非法值回落默认宽度', () => {
    expect(normalizeSidebarWidth(undefined)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(normalizeSidebarWidth(NaN)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(normalizeSidebarWidth(-1)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(normalizeSidebarWidth(601)).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  it('合法值原样返回（含窄屏 68px），小数四舍五入', () => {
    expect(normalizeSidebarWidth(68)).toBe(68)
    expect(normalizeSidebarWidth(200.4)).toBe(200)
  })
})

describe('computeEmbeddedViewBounds（内嵌视图布局契约）', () => {
  it('基于客户区计算：左侧留出侧栏、顶部留出 TabBar+NavBar', () => {
    const bounds = computeEmbeddedViewBounds(createRealShapeWindow(), 200)
    // 契约：width/height 来自客户区 1424x861，而不是外框 1440x900。
    // 若回归到外框尺寸，将得到 1240x824 —— 右侧滚动条与底部内容会被窗口裁掉。
    expect(bounds).toEqual({ x: 200, y: 76, width: 1224, height: 785 })
  })

  it('顶部偏移默认 TabBar(36)+NavBar(40)=76', () => {
    expect(BROWSER_CHROME_TOP).toBe(76)
  })

  it('未提供侧栏宽度时使用默认 200', () => {
    const bounds = computeEmbeddedViewBounds(createRealShapeWindow())
    expect(bounds.x).toBe(200)
  })

  it('极小窗口下宽高下限为 0，不产生负尺寸', () => {
    const win = { getContentBounds: () => ({ width: 100, height: 50 }) }
    expect(computeEmbeddedViewBounds(win, 200)).toEqual({ x: 200, y: 76, width: 0, height: 0 })
  })

  it('支持自定义顶部偏移（分屏监控 NAV_HEIGHT=56 场景）', () => {
    const bounds = computeEmbeddedViewBounds(createRealShapeWindow(), 200, 56)
    expect(bounds).toEqual({ x: 200, y: 56, width: 1224, height: 805 })
  })
})
