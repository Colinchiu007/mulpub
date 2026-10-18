// @ts-check
/**
 * rpa-dom-dump — 发布页 DOM 取证通道（video-publish-4，2026-10-18）
 *
 * ## 为什么需要它
 *
 * 四个平台的视频发布失败里，有三条的真因是**页面形状与我们的选择器不符**：
 *   · 视频号：`publish_url` 是平台首页 ⇒ `input[type=file]` / 标题 / 发表按钮全部落空；
 *   · 头条：西瓜上传页没有登记 `file_input` ⇒ 上传整段被跳过；
 *   · 抖音：标题 `readback=0`、上传完成信号未检测到。
 *
 * 靠 `waitForElement timeout sel=xxx` 这类日志只能看到**我们猜的选择器失败了**，
 * 看不到**页面到底有什么**。于是每轮修复都是盲猜 + 一次真机发布（2–3 分钟），
 * 收敛慢且无法审计。
 *
 * 本模块在真机链路上按阶段（导航后 / 上传后 / 点发布前）把页面的**结构摘要**
 * 落成 JSON：文件输入、文本输入、多行输入、contenteditable、按钮（文本/禁用/可见）。
 * 有了它，一次真机运行就能拿到四个平台的真实形状，选择器不再靠猜。
 *
 * ## 安全边界（改这个文件前必须先读）
 *
 * - **默认关闭**：只有 `MP_DOM_DUMP=1` 才采集；生产运行零开销、零落盘。
 * - **只采结构，不采内容**：输入框只记 `valueLength`（数字），不记 value；
 *   可编辑区只记 `textLength`；按钮只记 `innerText` 前 40 字（它本身就是控件标签）。
 * - **不采 cookie / token / URL query**：`url` 只保留 origin + pathname。
 * - 落盘目录固定在系统临时目录下 `mp-dom-dump/`，文件名带平台与阶段。
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/** 采集脚本（页面上下文函数字面量；只回结构，不回内容）。 */
const COLLECT_SCRIPT = 'function(){' +
  'var vis=function(e){return !!(e&&(e.offsetParent||(e.getClientRects&&e.getClientRects().length)))};' +
  'var cut=function(s,n){s=String(s==null?"":s).replace(/\\s+/g," ").trim();return s.length>n?s.slice(0,n):s};' +
  'var cls=function(e){return cut(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className,120)};' +
  'var files=[].slice.call(document.querySelectorAll(\'input[type="file"]\')).map(function(e){return{' +
  'accept:cut(e.getAttribute("accept"),80),multiple:!!e.multiple,disabled:!!e.disabled,visible:vis(e),cls:cls(e),id:cut(e.id,60)}});' +
  'var inputs=[].slice.call(document.querySelectorAll("input")).filter(function(e){return e.type!=="file"&&e.type!=="hidden"}).map(function(e){return{' +
  'type:cut(e.type,20),placeholder:cut(e.placeholder,80),cls:cls(e),id:cut(e.id,60),name:cut(e.name,60),visible:vis(e),valueLength:String(e.value||"").length,maxLength:Number(e.maxLength)||null}});' +
  'var areas=[].slice.call(document.querySelectorAll("textarea")).map(function(e){return{' +
  'placeholder:cut(e.placeholder,80),cls:cls(e),id:cut(e.id,60),visible:vis(e),valueLength:String(e.value||"").length}});' +
  'var editables=[].slice.call(document.querySelectorAll(\'[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]\')).map(function(e){return{' +
  'tag:e.tagName.toLowerCase(),cls:cls(e),id:cut(e.id,60),placeholder:cut(e.getAttribute("data-placeholder")||e.getAttribute("placeholder"),80),' +
  'visible:vis(e),textLength:String(e.innerText||"").length}});' +
  'var buttons=[].slice.call(document.querySelectorAll(\'button,[role="button"],a\')).map(function(e){return{' +
  'text:cut(e.innerText,40),disabled:!!e.disabled,visible:vis(e),cls:cls(e),tag:e.tagName.toLowerCase()}})' +
  '.filter(function(b){return b.text.length>0});' +
  'var uploadish=[].slice.call(document.querySelectorAll(\'[class*="upload"],[class*="Upload"],[class*="drag"],[class*="Drag"]\')).slice(0,20).map(function(e){return{' +
  'cls:cls(e),tag:e.tagName.toLowerCase(),visible:vis(e)}});' +
  'return{urlPath:location.pathname,docTitle:cut(document.title,120),files:files,inputs:inputs,textareas:areas,' +
  'editables:editables,buttons:buttons.slice(0,80),uploadAreas:uploadish,' +
  'bodyTextLength:(document.body&&document.body.innerText||"").length}' +
'}'

/**
 * 是否开启（默认关闭；只有显式 `MP_DOM_DUMP=1` 才采集）。
 * @param {NodeJS.ProcessEnv|object} [env]
 * @returns {boolean}
 */
function isEnabled (env) {
  const e = env || process.env
  return String(e.MP_DOM_DUMP || '') === '1'
}

/** 落盘目录（系统临时目录下，避免污染仓库）。 */
function dumpDir () {
  return path.join(os.tmpdir(), 'mp-dom-dump')
}

/** 只保留 origin + pathname：不落 query（可能含 token）。 */
function safePath (rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''))
    return u.origin + u.pathname
  } catch (_) {
    return ''
  }
}

/**
 * 采集一次（阶段内）。未开启时**不触碰页面**（零开销）。
 *
 * 永不抛错：取证失败绝不能影响发布主链。
 * @param {object} win BrowserWindow / WebContentsView 外壳
 * @param {string} platform 平台 id
 * @param {string} stage 阶段标签（nav / uploaded / prepublish / verify）
 * @param {object} [opts] `{ dir, logger }`（测试注入用）
 * @returns {Promise<object|null>} 采集结果（未开启或失败返回 null）
 */
async function dumpDom (win, platform, stage, opts = {}) {
  if (opts.env ? !isEnabled(opts.env) : !isEnabled()) return null
  try {
    const raw = await win.webContents.executeJavaScript('(' + COLLECT_SCRIPT + ')()')
    if (!raw || typeof raw !== 'object') return null
    const record = {
      platform,
      stage,
      at: new Date().toISOString(),
      urlPath: safePath(win.webContents.getURL()) || raw.urlPath || '',
      docTitle: raw.docTitle,
      counts: {
        files: raw.files.length,
        inputs: raw.inputs.length,
        textareas: raw.textareas.length,
        editables: raw.editables.length,
        buttons: raw.buttons.length,
      },
      files: raw.files,
      inputs: raw.inputs,
      textareas: raw.textareas,
      editables: raw.editables,
      buttons: raw.buttons,
      uploadAreas: raw.uploadAreas,
      bodyTextLength: raw.bodyTextLength,
    }
    const dir = opts.dir || dumpDir()
    fs.mkdirSync(dir, { recursive: true })
    const safePlatform = String(platform || 'unknown').replace(/[^\w-]/g, '_')
    const safeStage = String(stage || 'stage').replace(/[^\w-]/g, '_')
    const file = path.join(dir, safePlatform + '-' + safeStage + '-' + Date.now() + '.json')
    fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8')
    const logger = opts.logger
    if (logger && typeof logger.info === 'function') {
      logger.info('RpaView', '[' + platform + '] dom-dump ' + stage + ' files=' + record.counts.files
        + ' inputs=' + record.counts.inputs + ' editables=' + record.counts.editables
        + ' buttons=' + record.counts.buttons + ' -> ' + file)
    }
    return record
  } catch (_) {
    return null
  }
}

module.exports = { COLLECT_SCRIPT, dumpDom, dumpDir, isEnabled, safePath }
