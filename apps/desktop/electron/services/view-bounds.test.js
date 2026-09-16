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
    expect(normalizeSidebarWidth(0)).toBe(SIDEBAR_WIDTH_DEFAULT)
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

describe('computeEmbeddedViewBounds 侧栏宽度=0 防御（回归 2026-09-15 平台链接浮层盖住侧边栏）', () => {
  it('侧栏宽度=0 时回落默认 200，绝不 x=0 覆盖侧边栏', () => {
    const bounds = computeEmbeddedViewBounds(createRealShapeWindow(), 0)
    // 关键：x 必须是 200（默认侧栏宽），不能是 0——否则 WebContentsView 盖住 x=0 的 MpSidebar
    expect(bounds.x).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(bounds).toEqual({ x: 200, y: 76, width: 1224, height: 785 })
  })

  it('侧栏宽度为非法负值同样回落默认 200', () => {
    const bounds = computeEmbeddedViewBounds(createRealShapeWindow(), -3)
    expect(bounds.x).toBe(SIDEBAR_WIDTH_DEFAULT)
  })
})

/**
 * 联动契约（2026-09-16 加固）：
 * BROWSER_CHROME_TOP 是与渲染进程 DOM 的 TabBar/NavBar CSS 高度**手工同步**的常量。
 * WebContentsView 是原生图层，不受 CSS overflow 裁剪——若组件高度改动而常量未同步，
 * 浏览器标签会覆盖 TabBar/NavBar 或留下缝隙。本组测试直接读取 .vue 源码里的
 * 根容器 height，与常量对账，任何一侧单改都会失败。
 */
describe('BROWSER_CHROME_TOP 与 TabBar/NavBar CSS 高度联动', () => {
  const fs = require('fs')
  const path = require('path')

  const SRC_COMPONENTS = path.join(__dirname, '..', '..', 'src', 'components')

  /** 读 .vue 源码并剥离块注释（slash-star 注释），避免注释中的示例选择器干扰正则 */
  function readComponentCss(fileName) {
    const source = fs.readFileSync(path.join(SRC_COMPONENTS, fileName), 'utf8')
    return source.replace(/\/\*[\s\S]*?\*\//g, '')
  }

  /**
   * 提取指定根选择器规则块（到首个 `}` 为止，根选择器均为无嵌套的顶层规则，
   * 若未来被挪进 @media / CSS 嵌套需同步调整本提取逻辑）。
   */
  function readRootRule(fileName, selector) {
    const match = readComponentCss(fileName).match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))
    if (!match) throw new Error(`${fileName} 中未找到根选择器 ${selector} 的规则块`)
    return match[1]
  }

  /** height 带词边界：排除 min-height / max-height / line-height 等误匹配 */
  function readRootHeightPx(ruleBody, fileName, selector) {
    const height = ruleBody.match(/(?<![\w-])height:\s*(\d+(?:\.\d+)?)px/)
    if (!height) throw new Error(`${fileName} 的 ${selector} 未声明固定 px 高度`)
    return Number(height[1])
  }

  function assertNotFlexShrinkable(fileName, selector) {
    const ruleBody = readRootRule(fileName, selector)
    // 精确匹配 0（排除 0.5 等非零值），根容器失守会连带破坏 76px 契约
    expect(ruleBody).toMatch(/flex-shrink:\s*0(?![.\d])/)
  }

  it('TabBar(36) + NavBar(40) === BROWSER_CHROME_TOP(76)，与渲染进程 DOM 顶高一致', () => {
    const tabBarHeight = readRootHeightPx(readRootRule('TabBar.vue', '\\.tab-bar'), 'TabBar.vue', '.tab-bar')
    const navBarHeight = readRootHeightPx(readRootRule('NavBar.vue', '\\.nav-bar'), 'NavBar.vue', '.nav-bar')
    expect(tabBarHeight).toBe(36)
    expect(navBarHeight).toBe(40)
    expect(tabBarHeight + navBarHeight).toBe(BROWSER_CHROME_TOP)
  })

  it('TabBar/NavBar 根容器均不可被 flex 压缩（flex-shrink: 0）', () => {
    assertNotFlexShrinkable('TabBar.vue', '\\.tab-bar')
    assertNotFlexShrinkable('NavBar.vue', '\\.nav-bar')
  })

  it('前提：全局 box-sizing: border-box 重置存在（否则 border 使实高超出 76px 契约）', () => {
    const resetCss = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'styles', 'cohere-design-system.css'),
      'utf8',
    )
    expect(resetCss).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*box-sizing:\s*border-box/)
  })
})
