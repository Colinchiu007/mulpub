'use strict'

/**
 * toutiao-cover — 头条/西瓜上传页的封面设置（2026-10-22 真机取证后实现）
 *
 * ## 真机证据（`cover-panel.png` + DOM dump）
 * - 页面只有 **3 个 `input[type=file]`，accept 全是视频格式**（`.mp4,.flv,.wmv,...`）
 *   ⇒ **根本不存在 image file input**，任何"设文件到 image input"的做法必然抛
 *     `Script failed to execute`（这正是前两轮的失败原因）。
 * - 点「+ 上传封面」后的 dashed 区（class `trigger-tip`）会弹出对话框：
 *     `m-xigua-dialog m-modal m-poster-upgrade m-video-bg portrait`
 *   内含两个 tab：**「封面截取」（默认激活）** 与 「本地上传」，
 *   正文先是 spinner + **「解析中」**，右下角是 **「下一步」**（解析完成前为禁用态）。
 *
 * ## 采用的路径
 * 走默认的**「封面截取」= 从视频里取帧**，无需任何文件上传：
 *   点触发器 → 等对话框 → 等「解析中」消失/「下一步」可用 → 点「下一步」→ 等对话框关闭。
 *
 * 为什么不用「本地上传」：它才需要 image input，而该 input 是**弹窗内动态创建**的，
 * 我们没有它的真实选择器；从视频取帧既满足「封面必填」，又不依赖未取证的元素。
 */

/**
 * 在页面里点开封面弹窗并走「封面截取 → 下一步」。
 * @param {object} ctx 宿主（RpaViewManager 实例，提供 _sleep）
 * @param {object} win BrowserWindow
 * @param {{ log?: object, platform?: string }} [opts]
 * @returns {Promise<{ ok: boolean, step: string }>} step 取值：clicked-trigger / no-dialog / no-next / done
 */
async function ensureCoverFromVideoFrame (ctx, win, opts) {
  const o = opts || {}
  const log = o.log
  const platform = o.platform || 'toutiao'
  const sleep = (ms) => (ctx && typeof ctx._sleep === 'function' ? ctx._sleep(ms) : new Promise((r) => setTimeout(r, ms)))

  // 1) 点开封面弹窗（页面上「上传封面」这几个字的**最内层**元素就是 dashed 区的 trigger-tip）
  const clicked = await win.webContents.executeJavaScript('(function(){'
    + 'var all=[].slice.call(document.querySelectorAll("div,span,button,label"));'
    + 'var t=all.filter(function(e){var s=(e.innerText||"").trim();return s==="上传封面"||s==="+ 上传封面"});'
    + 'if(!t.length)t=all.filter(function(e){var s=(e.innerText||"").trim();return s.indexOf("上传封面")>=0&&s.length<12});'
    + 'var el=t[t.length-1];if(!el)return false;el.click();return true})()').catch(() => false)
  if (!clicked) return { ok: false, step: 'clicked-trigger' }
  await sleep(1200)

  // 2) 等对话框出现（m-poster-upgrade 是取证到的真实类名）
  let hasDialog = false
  for (let i = 0; i < 12; i++) {
    hasDialog = await win.webContents.executeJavaScript('(function(){'
      + 'var d=[].slice.call(document.querySelectorAll(".m-poster-upgrade,[class*=poster-upgrade]"));'
      + 'return d.some(function(e){return e.getClientRects().length>0})})()').catch(() => false)
    if (hasDialog) break
    await sleep(500)
  }
  if (!hasDialog) {
    if (log) log.warn('RpaView', '[' + platform + '] cover dialog not found after trigger click')
    return { ok: false, step: 'no-dialog' }
  }

  // 3) 等「下一步」可用（解析完成前是 disabled）
  let nextClicked = false
  for (let i = 0; i < 40; i++) {
    // 2026-10-22 真机二次修正：上轮 dump 的 `btns` 里**没有「下一步」**（只有 添加视频/发布）
    // ⇒ 它不是 <button>，而是 div/span 样式按钮 ⇒ 只查 button 永远查不到（表现为"解析超时"）。
    // 现在查 button/div/span/a，取**最内层最后匹配**；禁用态按 class 含 disabled 或 aria-disabled 判。
    nextClicked = await win.webContents.executeJavaScript('(function(){'
      + 'var all=[].slice.call(document.querySelectorAll("button,div,span,a"));'
      + 'var cands=all.filter(function(e){return (e.innerText||"").trim()==="下一步"&&e.getClientRects().length>0});'
      + 'if(!cands.length)return false;'
      + 'var b=cands[cands.length-1];'
      + 'var dis=(b.disabled===true)||(b.getAttribute("aria-disabled")==="true")||/(^| )disabled( |$)|is-disabled|btn-disabled|cannot-click/.test(String(b.className||""));'
      + 'if(dis)return false;b.click();return true})()').catch(() => false)
    if (nextClicked) break
    await sleep(500)
  }
  if (!nextClicked) {
    if (log) log.warn('RpaView', '[' + platform + '] cover dialog: 下一步 never became clickable (解析超时)')
    await closeCoverDialog(win, log, platform)
    return { ok: false, step: 'no-next' }
  }

  // 4a) 2026-10-22 真机：点「下一步」后弹窗**不关**（日志 `dialog still open`）⇒ 还有二次确认。
  // 常见文案：确定 / 完成 / 保存 / 应用 / 确认。逐个试（只点可见且未禁用的），点中即停。
  await sleep(1500)
  for (const label of ["确定", "完成", "保存", "应用", "确认"]) {
    const hit = await win.webContents.executeJavaScript('(function(){'
      + 'var all=[].slice.call(document.querySelectorAll("button,div,span,a"));'
      + 'var c=all.filter(function(e){return (e.innerText||"").trim()===' + JSON.stringify(label) + '&&e.getClientRects().length>0});'
      + 'if(!c.length)return false;var b=c[c.length-1];'
      + 'var dis=(b.disabled===true)||(b.getAttribute("aria-disabled")==="true")||/(^| )disabled( |$)|is-disabled|btn-disabled|cannot-click/.test(String(b.className||""));'
      + 'if(dis)return false;b.click();return true})()').catch(() => false)
    if (hit) { await sleep(1200); break }
  }
  let stillOpen = true
  for (let i = 0; i < 20; i++) {
    stillOpen = await win.webContents.executeJavaScript('(function(){'
      + 'var d=[].slice.call(document.querySelectorAll(".m-poster-upgrade,[class*=poster-upgrade]"));'
      + 'return d.some(function(e){return e.getClientRects().length>0})})()').catch(() => false)
    if (!stillOpen) break
    await sleep(500)
  }
  // 5) 成功判据：弹窗关闭 **或** 封面区已出现预览图（后者更贴近「封面真的落位」）。
  const hasPreview = await win.webContents.executeJavaScript('(function(){'
    + 'var imgs=[].slice.call(document.querySelectorAll("img")).filter(function(e){return e.getClientRects().length>0&&e.naturalWidth>20});'
    + 'return imgs.length>0})()').catch(() => false)
  const ok = !stillOpen || hasPreview === true
  if (log) log.info('RpaView', '[' + platform + '] cover set from video frame (dialog ' + (stillOpen ? 'still open' : 'closed') + ', preview=' + (hasPreview ? 'yes' : 'no') + ', ok=' + ok + ')')
  return { ok: ok, step: 'done' }
}


/**
 * 「本地上传」路径（2026-10-22 真机取证后新增，**首选**）。
 *
 * ## 为什么它是首选
 * 「封面截取」那条路要平台侧解析视频帧，实测**始终不完成**（「下一步」12 秒内一直 `cannot-click`）。
 * 而切到「本地上传」tab 后，弹窗里会**动态创建**第 4 个 file input：
 *   accept = `image/jpg,image/jpeg,image/png`（前 3 个全是视频格式）
 * 弹窗文案变成「点击上传或将文件拖入此区域 … 下一步」。
 *
 * ## 步骤
 * 点触发器 → 等弹窗 → 点「本地上传」tab → 等 image input 出现 → 设文件
 * → 等「下一步」可点 → 点它 → 二次确认 → 校验封面区预览图。
 *
 * @param {object} ctx 宿主（需 _setFileInput / _sleep）
 * @param {object} win BrowserWindow
 * @param {string} coverPath 本地封面图路径
 * @param {{ log?: object, platform?: string }} [opts]
 * @returns {Promise<{ ok: boolean, step: string }>}
 */
async function ensureCoverViaLocalUpload (ctx, win, coverPath, opts) {
  const o = opts || {}
  const log = o.log
  const platform = o.platform || 'toutiao'
  const sleep = (ms) => (ctx && typeof ctx._sleep === 'function' ? ctx._sleep(ms) : new Promise((r) => setTimeout(r, ms)))
  if (!coverPath) return { ok: false, step: 'no-cover-path' }

  // 1) 点开封面弹窗
  const clicked = await win.webContents.executeJavaScript('(function(){'
    + 'var all=[].slice.call(document.querySelectorAll("div,span,button,label"));'
    + 'var t=all.filter(function(e){return (e.innerText||"").trim()==="上传封面"});'
    + 'var el=t[t.length-1];if(!el)return false;el.click();return true})()').catch(() => false)
  if (!clicked) return { ok: false, step: 'clicked-trigger' }
  await sleep(1500)

  // 2) 等弹窗，然后点「本地上传」tab（真实元素是 <li class="selected...">）
  let hasDialog = false
  for (let i = 0; i < 12; i++) {
    hasDialog = await win.webContents.executeJavaScript('(function(){'
      + 'var d=[].slice.call(document.querySelectorAll(".m-poster-upgrade,[class*=poster-upgrade]"));'
      + 'return d.some(function(e){return e.getClientRects().length>0})})()').catch(() => false)
    if (hasDialog) break
    await sleep(500)
  }
  if (!hasDialog) return { ok: false, step: 'no-dialog' }

  const tabClicked = await win.webContents.executeJavaScript('(function(){'
    + 'var all=[].slice.call(document.querySelectorAll("div,span,button,a,li"));'
    + 'var c=all.filter(function(e){return (e.innerText||"").trim()==="本地上传"&&e.getClientRects().length>0});'
    + 'if(!c.length)return false;var el=c[c.length-1];el.click();return true})()').catch(() => false)
  if (!tabClicked) { await closeCoverDialog(win, log, platform); return { ok: false, step: 'no-local-tab' } }
  await sleep(1200)

  // 3) 设文件到**动态出现的 image input**
  const imageSel = 'input[type="file"][accept*="image"]'
  let setErr
  try { await setFileViaCdp(win, coverPath, imageSel) } catch (e1) {
    if (log) log.warn('RpaView', '[' + platform + '] cover cdp setFile failed: ' + String(e1 && e1.message).slice(0, 100))
    try { await ctx._setFileInput(win, coverPath, imageSel); setErr = null } catch (e2) {
      setErr = e2
      if (log) log.warn('RpaView', '[' + platform + '] cover local upload: set file failed: ' + String(e2 && e2.message).slice(0, 100))
    }
  }
  if (setErr) { await closeCoverDialog(win, log, platform); return { ok: false, step: 'set-file-failed' } }
  await sleep(2500)

  // 4) 等「下一步」可点（cannot-click 也要认出来）
  let nextClicked = false
  for (let i = 0; i < 30; i++) {
    nextClicked = await win.webContents.executeJavaScript('(function(){'
      + 'var all=[].slice.call(document.querySelectorAll("button,div,span,a"));'
      + 'var c=all.filter(function(e){return (e.innerText||"").trim()==="下一步"&&e.getClientRects().length>0});'
      + 'if(!c.length)return false;var b=c[c.length-1];'
      + 'var dis=(b.disabled===true)||(b.getAttribute("aria-disabled")==="true")||/(^| )disabled( |$)|is-disabled|btn-disabled|cannot-click/.test(String(b.className||""));'
      + 'if(dis)return false;b.click();return true})()').catch(() => false)
    if (nextClicked) break
    await sleep(500)
  }
  if (!nextClicked) { await closeCoverDialog(win, log, platform); return { ok: false, step: 'no-next' } }
  await sleep(1500)

  // 5) 二次确认（确定/完成/保存）
  for (const label of ['确定', '完成', '保存']) {
    const hit = await win.webContents.executeJavaScript('(function(){'
      + 'var all=[].slice.call(document.querySelectorAll("button,div,span,a"));'
      + 'var c=all.filter(function(e){return (e.innerText||"").trim()===' + JSON.stringify(label) + '&&e.getClientRects().length>0});'
      + 'if(!c.length)return false;var b=c[c.length-1];var dis=(b.disabled===true)||/(disabled|cannot-click)/.test(String(b.className||""));if(dis)return false;b.click();return true})()').catch(() => false)
    if (hit) { await sleep(1200); break }
  }

  // 6) 判据：弹窗关闭 或 出现封面预览图
  const stillOpen = await win.webContents.executeJavaScript('(function(){'
    + 'var d=[].slice.call(document.querySelectorAll(".m-poster-upgrade,[class*=poster-upgrade]"));'
    + 'return d.some(function(e){return e.getClientRects().length>0})})()').catch(() => false)
  const hasPreview = await win.webContents.executeJavaScript('(function(){'
    + 'var imgs=[].slice.call(document.querySelectorAll("img")).filter(function(e){return e.getClientRects().length>0&&e.naturalWidth>20});'
    + 'return imgs.length>0})()').catch(() => false)
  const ok = !stillOpen || hasPreview === true
  if (log) log.info('RpaView', '[' + platform + '] cover local upload: dialog=' + (stillOpen ? 'open' : 'closed') + ' preview=' + (hasPreview ? 'yes' : 'no') + ' ok=' + ok)
  return { ok: ok, step: ok ? 'done' : 'no-effect' }
}

/**
 * 纯 CDP 设文件（2026-10-22）。
 *
 * 为什么不用 `_setFileInput`：它在 CDP 失败时会**回退到 JS 注入**（`_setFileInputViaJs`），
 * 而 JS 给 file input 赋 files 在 Chromium 里本来就不可行（FileList 只读）⇒
 * 回退必然抛 `Script failed to execute`，把真正的 CDP 错误吞掉。
 * 这里只走 CDP，并把 CDP 的**原始错误**抛出来，便于定位。
 * @param {object} win BrowserWindow
 * @param {string} filePath 本地文件
 * @param {string} selector CSS 选择器
 */
async function setFileViaCdp (win, filePath, selector) {
  const dbg = win.webContents.debugger
  try { await dbg.attach("1.3") } catch (_e) { /* 已附加则忽略 */ }
  await dbg.sendCommand("DOM.enable")
  const doc = await dbg.sendCommand("DOM.getDocument", { depth: -1, pierce: true })
  const rootId = doc && doc.root && doc.root.nodeId
  if (!rootId) throw new Error("DOM document unavailable")
  const q = await dbg.sendCommand("DOM.querySelector", { nodeId: rootId, selector: selector })
  if (!q || !q.nodeId) throw new Error("No file input found for " + selector)
  await dbg.sendCommand("DOM.setFileInputFiles", { files: [require("node:path").resolve(filePath)], nodeId: q.nodeId })
  return true
}
// 2026-10-23 R5：失败返回前统一关闭封面弹窗，避免遮挡后续发布点击。
async function closeCoverDialog (win, log, platform) {
  try {
    const closed = await win.webContents.executeJavaScript('(function(){var w=["取消","关闭","×"];var all=[].slice.call(document.querySelectorAll("button,div,span,a"));for(var i=0;i<all.length;i++){var s=(all[i].innerText||"").trim();if(w.indexOf(s)>=0&&all[i].getClientRects().length>0){all[i].click();return s}}return ""})()', true)
    if (log) log.warn('RpaView', '[' + platform + '] cover dialog closed after failure: ' + (closed || 'none'))
  } catch (_e) { /* 无弹窗可关 */ }
  await new Promise((r) => setTimeout(r, 800))
}
module.exports = { ensureCoverFromVideoFrame, ensureCoverViaLocalUpload, setFileViaCdp }