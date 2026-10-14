'use strict'

/**
 * card-capture — 把长文按页渲染成 PNG（P2-3，设计文 §7.2(2) / §7.7）
 *
 * ## 形态：照抄 cover-cropper.js（本仓既有唯一真源）
 *
 * ```js
 * new BrowserWindow({ show: false,
 *   webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true } })
 * win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
 * try { ... } finally { if (win && !win.isDestroyed()) win.destroy() }
 * ```
 *
 * ⚠️ 计划文写「安全传值走 `core/js-eval-payload.js` 的 `buildEvalScript`」，
 * **但先例 `cover-cropper.js` 用的是 `data:text/html` URL 而非 `buildEvalScript`**。
 * 本模块**照先例**：页面内容经 `data:` URL 传入，不注入脚本。
 * 理由是 `data:` URL 下 `sandbox:true` + `contextIsolation:true` 已足以隔离，
 * 而 `buildEvalScript` 的用途是「往已加载页面注入」的另一场景（见 tab-lifecycle.js）。
 *
 * ## 分层：纯函数与 Electron 分离
 *
 * 先例把可单测的部分抽成纯函数（`buildCropPage`），本模块同样：
 *
 *   · `buildMeasurementScript(opts)` —— **纯**，产出测量页 HTML
 *   · `buildPageScript(index, opts)`  —— **纯**，产出第 N 页 HTML
 *   · `renderCardsToPng(...)`        —— **依赖 Electron**，真正开窗口截图
 *
 * ⇒ 判据 ①②（字符串断言）与 ③（分页集成）**不需要 Electron 就能验证**；
 *   判据 ④⑤（渲染不溢出 / 性能）需要真机，故在测试里**显式 skip 并说明原因**，
 *   而不是写一个「看起来在测其实没测」的假绿。
 *
 * ## ★ 失败纪律（计划文原文，三条都不省）
 *
 * 1. 窗口创建失败 / 页面加载失败 / **任一步截图失败** ⇒ **抛错**
 * 2. **已成功的页丢弃** —— 「部分产物比没有更危险，用户会以为发全了」
 * 3. 超时 ⇒ **销毁窗口 + 抛 `TimeoutError`**
 */

const { BrowserWindow } = require('electron')

/** 默认视口宽度（设计文 §7.7：图文卡片 1006px） */
const DEFAULT_WIDTH_PX = 1006
/** 默认视口高度 */
const DEFAULT_HEIGHT_PX = 1440
/** 单次渲染总超时 */
const DEFAULT_TIMEOUT_MS = 8000

/**
 * 测量页：把**全部内容**放进一个离屏但**参与布局**的容器里量高度。
 *
 * ⚠️ 两个关键约束，各自有反例：
 *
 *   · 用 `position:absolute; left:-10000px` **而不是** `display:none`
 *     —— `display:none` 的元素**不参与布局**，高度恒为 0，测量会全部返回 0。
 *   · 宽度必须**显式写死**（`1006px`）而不是靠视口
 *     —— 换行位置随宽度变化，宽度不确定 ⇒ 高度不可复现。
 *
 * @param {{ widthPx?: number, extraCss?: string }} [opts]
 */
function buildMeasurementScript ({ widthPx = DEFAULT_WIDTH_PX, extraCss = '' } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#fff;}
  #measure{position:absolute;left:-10000px;top:0;width:${widthPx}px;box-sizing:border-box;}
  ${extraCss}
</style></head><body><div id="measure"></div></body></html>`
}

/**
 * 第 N 页 HTML。
 *
 * `noMarginTop` 用于**切分产生的后半段**：该段不是段落开头，首行不该有段前距。
 * ⚠️ 只对**本页第一个块**生效 —— 对整页统一清零会把页内其余段落间距也吃掉。
 *
 * @param {number} index 页序号（0 基）
 * @param {{ widthPx?: number, noMarginTop?: boolean, extraCss?: string }} [opts]
 */
function buildPageScript (index, { widthPx = DEFAULT_WIDTH_PX, noMarginTop = false, extraCss = '' } = {}) {
  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError(`buildPageScript: index 必须是非负整数，收到 ${JSON.stringify(index)}`)
  }
  const firstBlock = noMarginTop ? '#page > *:first-child{margin-top:0 !important;}' : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#fff;}
  #page{width:${widthPx}px;box-sizing:border-box;}
  ${firstBlock}
  ${extraCss}
</style></head><body><div id="page" data-page-index="${index}"></div></body></html>`
}

/** 超时错误（可辨识，调用方据此区分「超时」与「其他失败」） */
class TimeoutError extends Error {
  constructor (message) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * 把分页结果渲染成 PNG。
 *
 * ⚠️ **依赖 Electron**，需要真实 offscreen 窗口。判据 ④⑤ 必须真机跑。
 *
 * 失败纪律：**任何一页失败 ⇒ 抛错，且已成功的页一并丢弃**
 * （不是「返回已成功的那几页」—— 部分产物比没有更危险）。
 *
 * @param {{ pages: string[][], widthPx?: number, heightPx?: number, timeoutMs?: number,
 *           measure?: Function, toHtml?: Function }} opts
 * @returns {Promise<Buffer[]>} 每页一张 PNG
 */
async function renderCardsToPng ({
  pages = [],
  widthPx = DEFAULT_WIDTH_PX,
  heightPx = DEFAULT_HEIGHT_PX,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  toHtml = (blocks) => blocks.map((b) => `<p>${String(b)}</p>`).join('\n'),
} = {}) {
  if (!Array.isArray(pages)) throw new TypeError('renderCardsToPng: pages 必须是数组')
  if (pages.length === 0) return []

  let win = null
  const done = [] // 已成功的页 —— 失败时**整体丢弃**
  const timer = { id: null }
  try {
    win = new BrowserWindow({
      show: false,
      width: widthPx,
      height: heightPx,
      webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true },
    })

    const timeout = new Promise((_, reject) => {
      timer.id = setTimeout(() => {
        reject(new TimeoutError(`renderCardsToPng 超时（${timeoutMs}ms，已完成 ${done.length}/${pages.length} 页）`))
      }, timeoutMs)
    })

    const work = (async () => {
      for (let i = 0; i < pages.length; i++) {
        const html = buildPageScript(i, { widthPx }).replace(
          '<div id="page" data-page-index="' + i + '"></div>',
          '<div id="page" data-page-index="' + i + '">' + toHtml(pages[i]) + '</div>'
        )
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        const img = await win.webContents.capturePage()
        const png = img.toPNG()
        if (!png || png.length === 0) {
          throw new Error(`renderCardsToPng: 第 ${i + 1} 页截图为空（capturePage 返回空 buffer）`)
        }
        done.push(png)
      }
      return done
    })()

    return await Promise.race([work, timeout])
  } finally {
    if (timer.id) clearTimeout(timer.id)
    if (win && !win.isDestroyed()) win.destroy()
  }
}

/**
 * 把一段文本包成测量页里的 HTML（**纯函数，可单测**）。
 *
 * 从 `measureTextWithDom` 抽出，是为了让「转义 / margin-top 语义」这些
 * **不依赖 Electron** 的决策可测。真实窗口交互留给 QM-1 集成测试
 * （与 P2-3 判据④⑤ 同型：无 GUI 的 runner 里跑不出可信结果）。
 *
 * @param {string} text 待测文本
 * @param {{ noMarginTop?: boolean }} [item] 分页器传来的 item
 * @returns {string} `#measure` 容器内的 HTML
 */
function buildMeasureFragment (text, item) {
  if (typeof text !== 'string') {
    throw new TypeError(`buildMeasureFragment: text 必须是字符串，收到 ${typeof text}`)
  }
  // ★ 必须转义：正文里的 `<` `>` `&` 若不当实体，会被当成标签，
  //   既改变量到的高度（标签不产生文本行），也可能注入样式。
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  // 段前距只在「本段是段首」时算；切分产生的后半段不是段首（同 buildPageScript 的 noMarginTop）
  const style = item && item.noMarginTop === true ? ' style="margin-top:0"' : ''
  return '<div' + style + '>' + escaped + '</div>'
}

/**
 * 校验量到的高度（**纯函数，可单测**）。
 *
 * ★ 不返回 0：0 会让分页器以为「这段不占高度」从而把无数段塞进一页。
 *   拿不到高度必须抛错，让 fail-closed 生效。
 *
 * @param {unknown} height `scrollHeight` 的返回值
 * @param {number} textLen 文本长度（仅用于报错定位）
 * @returns {number} 合法高度
 */
function assertMeasuredHeight (height, textLen) {
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) {
    throw new Error(`measureTextWithDom: 量到非法高度 ${JSON.stringify(height)}（text 长度 ${textLen}）`)
  }
  return height
}

/**
 * 用 offscreen 窗口量一段文本的真实渲染高度（px）。
 *
 * 这是 **P2-1 分页器**与**P2-3 测量层**的缝合点：分页器的契约是
 * `measure: (text, item) => Promise<number>`（见 card-paginator-core.js 的 JSDoc），
 * 本函数就是那个 `measure`。
 *
 * ## 为什么不能用一个估算公式代替
 *
 * 分页要按**换行后**的高度切。换行位置取决于：
 *   · 字宽（中英日混排、全角/半角、标点悬挂）
 *   · 段前/段后距、行高
 *   · 模板 CSS（`extraCss`）
 * 任何「字符数 × 每字像素」的公式都会在这几项上漂移，漂移的后果是
 * **一页放不下**（用户看到内容被截断）或**一页只放半页**（排版难看）。
 *
 * @param {string} text 待测文本
 * @param {object} [item] 分页器传来的 item（含 `noMarginTop` 等元数据）
 * @param {{ widthPx?: number, extraCss?: string }} [opts]
 * @returns {Promise<number>} 高度（px）；窗口不可用时抛错（**不返回 0**）
 */
async function measureTextWithDom (text, item, { widthPx = DEFAULT_WIDTH_PX, extraCss = '' } = {}) {
  const fragment = buildMeasureFragment(text, item)
  const win = await getMeasurementWindow({ widthPx, extraCss })
  await win.webContents.loadURL(
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(buildMeasurementScript({ widthPx, extraCss }).replace(
      '<div id="measure"></div>', '<div id="measure">' + fragment + '</div>'
    ))
  )
  const height = await win.webContents.executeJavaScript(
    'document.getElementById("measure").scrollHeight'
  )
  return assertMeasuredHeight(height, String(text).length)
}

/** 复用的测量窗口（懒建） */
let measurementWindow = null

/**
 * 取（必要时建）复用的测量窗口。
 *
 * ⚠️ 与 `renderCardsToPng` 的窗口是**两个**：测量要频繁 `loadURL`，
 * 渲染要 `capturePage`，混用一个会互相踩状态。
 */
async function getMeasurementWindow ({ widthPx, extraCss }) {
  if (measurementWindow && !measurementWindow.isDestroyed()) return measurementWindow
  measurementWindow = new BrowserWindow({
    show: false,
    width: widthPx,
    height: DEFAULT_HEIGHT_PX,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  await measurementWindow.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(buildMeasurementScript({ widthPx, extraCss }))
  )
  return measurementWindow
}

/** 销毁复用的测量窗口（分页结束后必须调，否则进程不退出） */
function closeMeasurementWindow () {
  if (measurementWindow && !measurementWindow.isDestroyed()) measurementWindow.destroy()
  measurementWindow = null
}

module.exports = {
  DEFAULT_WIDTH_PX,
  DEFAULT_HEIGHT_PX,
  DEFAULT_TIMEOUT_MS,
  buildMeasurementScript,
  buildPageScript,
  buildMeasureFragment,
  assertMeasuredHeight,
  renderCardsToPng,
  measureTextWithDom,
  closeMeasurementWindow,
  TimeoutError,
}
