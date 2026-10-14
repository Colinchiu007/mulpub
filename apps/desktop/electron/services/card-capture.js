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

module.exports = {
  DEFAULT_WIDTH_PX,
  DEFAULT_HEIGHT_PX,
  DEFAULT_TIMEOUT_MS,
  buildMeasurementScript,
  buildPageScript,
  renderCardsToPng,
  TimeoutError,
}
