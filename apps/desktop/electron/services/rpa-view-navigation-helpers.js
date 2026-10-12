// @ts-check
/**
 * rpa-view-navigation-helpers.js — RPA 发布流程的导航/等待类 helper（mixin 片段）
 *
 * 拆分自 rpa-view-platforms.js (2026-09-29)：原文件超逐文件行数门禁
 * （check-max-lines LEDGER_GREW）。这些方法都是通过 `this.*` 调用的自包含 helper，
 * 抽出后用 Object.assign 合回 platformsMixin，行为不变。
 *
 * 依赖：log（logger）+ 宿主 mixin 提供的 this._waitForElement/_sleep/_waitForCondition。
 */
'use strict'

const log = require('./logger')
const {
  normalizePublishId,
  sanitizePublishResultUrl,
} = require('./rpa-publish-id-extract')

/**
 * HTML → 纯文本（模块级工具，2026-09-30；2026-10-12 收敛为引擎单一实现的委托）。
 * 用于无标题平台的描述合并：发布页 Quill 编辑器把草稿正文规范化为 HTML
 * （`<p>…</p>`），而平台描述是纯文本语义（计数器按可见字符算），
 * 不剥标签会让 `<p>` 以字面量出现在作品描述里（快手截图取证）。
 * 块级标签收口为换行，避免段落被粘连；三个以上连续换行压成两行。
 *
 * 实现委托 `api-publish-engine/src/content-formatter.js` 的 `htmlToPlainText`
 * （单一真源；**标签名白名单**判据 —— 修复宽判据把代码片段 `#include <stdio.h>`
 * 当标签整段吃掉的真实缺陷）。语义与本函数历史口径一致：`<br>`→换行、块级闭合→换行、
 * 实体解码、`\n{3,}`→`\n\n`、trim。
 */
function stripHtmlToPlainText (html) {
  return require('@multi-publish/api-publish-engine/src/content-formatter').htmlToPlainText(html)
}


const navigationHelpers = {
  // ========== 导航后弹窗清理 ==========
  // 平台上传落地页会叠加草稿恢复弹窗（快手：继续编辑/放弃）与功能引导遮罩
  // （抖音/B站：我知道了/知道了），不先关掉会遮挡上传区与表单，导致字段选择器
  // 全部 timeout（2026-09 E2E 实锤：快手草稿弹窗遮挡发布流程）。
  // 草稿冲突优先点「放弃」（丢弃陈旧草稿，本次上传走全新流程）；只有「继续编辑」时点它。
  async _dismissPostNavDialogs(win, platform) {
    try {
      const dismissed = await win.webContents.executeJavaScript(
        '(function(){var clicked=[];' +
        'var visible=function(e){return e&&e.offsetParent&&(e.innerText||"").trim().length<=12};' +
        'var find=function(txt){return [...document.querySelectorAll("button,a,span,div,[role=button]")].filter(function(e){return visible(e)&&(e.innerText||"").trim()===txt})};' +
        'var giveup=find("放弃");if(giveup.length){giveup[giveup.length-1].click();clicked.push("放弃")}' +
        'else{var cont=find("继续编辑");if(cont.length){cont[cont.length-1].click();clicked.push("继续编辑")}}' +
        'var acks=find("我知道了").concat(find("知道了"));for(var i=0;i<acks.length;i++){acks[i].click();clicked.push((acks[i].innerText||"").trim())}' +
        'return clicked.join(",")})()'
      )
      if (dismissed) log.info('RpaView', '[' + platform + '] post-nav dialogs dismissed: ' + String(dismissed))
    } catch (e) { log.warn('RpaView', '[' + platform + '] post-nav dialogs: ' + e.message) }
  },

  // ========== 选择器候选回退 ==========
  // 旧实现只用 candidates[0]：平台改版或落地页差异会让首个候选不存在，整条链路
  // 直接 timeout（2026-09 live DOM 实锤：快手编辑页根本没有 input[placeholder*="标题"]，
  // 标题与作品描述同为 div#work-description-edit[contenteditable]）。必须逐候选尝试。
  // 首个候选给完整预算（等 SPA 渲染），其余候选快速判定存在与否。
  async _resolveSelector(win, selectors, firstTimeoutMs, restTimeoutMs) {
    const list = (Array.isArray(selectors) ? selectors : [selectors]).filter((s) => typeof s === 'string' && s.length > 0)
    for (let i = 0; i < list.length; i++) {
      const cand = list[i]
      // eslint-disable-next-line no-await-in-loop
      if (await this._waitForElement(win, cand, i === 0 ? (firstTimeoutMs || 8000) : (restTimeoutMs || 2500))) return cand
    }
    return null
  },

  // 无独立标题字段的平台（快手作品描述）：标题与正文合并成一段文案写进编辑器，
  // 长度按平台 max_content 截断（快手 500），避免后续正文填充把标题覆写掉。
  // 2026-10-08 CCG 评审（W1/W2）统一口径：合并分隔符从 '\n\n' 收敛为 '\n'、
  // 截断从 UTF-16 slice 改为按码点（不切断代理对），与注册表
  // composeNoTitleDescription 及引擎各链（shipinhao/twitter/weibo/tiktok）一致。
  // 2026-09-30 追加（快手截图取证）：正文来自发布页 Quill 编辑器，携带 HTML 标记
  // （`<p>…</p>`）。无标题平台的描述是**纯文本**语义——平台计数器按可见字符算，
  // 且不剥标签会让 `<p>` 以字面量出现在作品描述里。故此处先把 HTML 归一为纯文本。
  _composeEditorCaption(article, maxLen) {
    const limit = Number(maxLen) > 0 ? Number(maxLen) : 2000
    const parts = [article && article.title, stripHtmlToPlainText(article && article.content)]
      .filter((v) => typeof v === 'string' && v.trim().length > 0)
      .map((v) => v.trim())
    const composed = parts.join('\n')
    const chars = Array.from(composed)
    return chars.length > limit ? chars.slice(0, limit).join('') : composed
  },

  // ========== 发布后的二次确认弹窗 ==========
  // 2026-09-30 快手实测：点「发布」后弹出确认框（模态层含「取 消」「确 认」两颗按钮，
  // 另有禁用态的「确定」），不点「确认」则永不提交 → publish verification timeout。
  // 判据：只点**可见且未禁用**的「确认/确定」——页面常同时存在禁用的同名按钮（如
  // 快手「近7天的下载记录」公告里的确定 d=true），不加 disabled 过滤会误点。
  // 按钮文本可能带空格（「确 认」），比较前统一剥空白。
  // 2026-09-30 头条补强：点「预览并发布」后**先弹预览弹窗**（日志 `modals:["预览"]`），
  // 需在弹窗内再点一次「发布」才真正提交。故本函数：
  //   ① 优先在**可见的 modal/dialog/drawer 作用域内**找提交类文案（确认/确定/确认发布/
  //      发布/立即发布/发布文章），避免误点主页面那颗同名的主发布按钮（会重复触发）；
  //   ② 弹窗可能延迟出现，故轮询若干次（每次 2s）而不是只查一次；
  //   ③ 找不到 modal 时回退到全局「确认/确定」（快手等既有平台行为不变）。
  async _confirmPublishDialog(win, platform) {
    const MODAL_TEXTS = ['确认', '确定', '确认发布', '发布', '立即发布', '发布文章']
    const FALLBACK_TEXTS = ['确认', '确定']
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await win.webContents.executeJavaScript(
          '(function(){'
          + 'var modalSel=\'[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"],[class*="drawer"],[class*="Drawer"],[role="dialog"]\';'
          + 'var modals=[...document.querySelectorAll(modalSel)].filter(function(e){return e.getClientRects().length>0});'
          + 'var MODAL=' + JSON.stringify(MODAL_TEXTS) + ';var FB=' + JSON.stringify(FALLBACK_TEXTS) + ';'
          + 'function norm(e){return (e.innerText||"").replace(/\\s+/g,"")}'
          + 'function clickable(e){return e.offsetParent&&!e.disabled&&e.getClientRects().length>0}'
          + 'for(var s=0;s<modals.length;s++){'
          + '  var bs=[...modals[s].querySelectorAll("button,div,span,a")].filter(function(e){return clickable(e)&&MODAL.indexOf(norm(e))!==-1});'
          + '  if(bs.length){bs[bs.length-1].click();return "CONFIRMED_IN_MODAL:"+norm(bs[bs.length-1])}'
          + '}'
          + 'var hit=[...document.querySelectorAll("button,div,span")].filter(function(e){return clickable(e)&&FB.indexOf(norm(e))!==-1});'
          + 'if(hit.length){hit[hit.length-1].click();return "CONFIRMED"}'
          + 'if(!modals.length)return "NO_DIALOG";'
          // 2026-09-30 头条实测补强：该页（WebContentsView 内）点「预览并发布」后只存草稿，
          // 说明真正的提交通道不在 modal 作用域内 ⇒ 诊断必须**同时 dump 全页可见按钮**，
          // 才能看出「点了发布之后页面到底多出了哪个可点控件」。
          + 'var all=[...document.querySelectorAll("button,div[role=button],a")].filter(clickable).map(function(e){return norm(e)}).filter(Boolean);'
          + 'var uniq=[...new Set(all)].slice(0,24).join("/");'
          // 2026-09-30 头条：上一步 dump 显示「点完预览并发布后页面没多出任何提交控件」⇒ 说明**这一击没生效**。
          // 故进一步 dump **发布类按钮自身状态**：disabled / 尺寸 / 是否被遮挡（取该点最顶层元素）。
          + 'var pub=[];var cands=[...document.querySelectorAll("button,div[role=button],a")];'
          + 'for(var i=0;i<cands.length;i++){var e=cands[i];var t=norm(e);'
          + 'if(!/预览并发布|立即发布|^发布$|提交|确认发布/.test(t))continue;'
          + 'var r=e.getBoundingClientRect();var top=null;'
          + 'try{var els=document.elementsFromPoint(r.left+r.width/2,r.top+r.height/2);top=els&&els[0]?String((els[0].innerText||"")||els[0].tagName).trim().slice(0,10):null}catch(_e){}'
          + 'pub.push(t.slice(0,10)+"[dis="+(!!e.disabled)+",vis="+(r.width>0&&r.height>0)+",wh="+Math.round(r.width)+"x"+Math.round(r.height)+",topHit="+top+"]")}'
          + 'return "MODAL_NO_MATCH:"+modals.map(function(m){var bs=[...m.querySelectorAll("button,div,span,a")].filter(clickable).map(function(e){return norm(e)}).filter(Boolean).slice(0,8).join("/");return norm(m).slice(0,40)+"|btns="+bs}).join(" ;; ").slice(0,180)+" || PAGE_BTNS="+uniq.slice(0,200)+" || PUB_STATE="+pub.slice(0,4).join(" ;; ")})()'
        )
        if (result && result.indexOf('CONFIRMED') === 0) {
          log.info('RpaView', '[' + platform + '] publish confirm dialog clicked: ' + result)
          await this._sleep(2500)
          return result
        }
        if (attempt === 0) log.info('RpaView', '[' + platform + '] confirm dialog probe: ' + result)
        await this._sleep(2000)
      }
      return 'NO_CONFIRM'
    } catch (e) {
      log.warn('RpaView', '[' + platform + '] confirm dialog: ' + e.message)
      return null
    }
  },

  // ========== 图片上传后的「图片编辑」模态层收起 ==========
  // 2026-09-29 实测（小红书图文）：图片上传成功后平台自动进入图片编辑（裁剪）界面——
  // 模态层文本「图片编辑 裁剪 模版 贴纸 文字 滤镜 比例 … 裁剪设置 滚动鼠标滚轮或触控板
  // 可缩放图片 完成」。该原生层遮挡「发布」按钮，不收起则发布按钮选择器必然超时
  // （实测 button:has-text("发布") 3s timeout → publish verification failed）。
  // 优先点「完成」（保留默认比例），回退「取消/关闭/×」。
  async _dismissImageEditModal(win, platform) {
    try {
      const result = await win.webContents.executeJavaScript(
        '(function(){var t=(document.body&&document.body.innerText)||"";'
        + 'if(!/裁剪设置|可缩放图片|图片编辑/.test(t))return "NO_EDIT_MODAL";'
        + 'var pick=function(txt){return [...document.querySelectorAll("button,div,span")].filter(function(e){return (e.innerText||"").trim()===txt&&e.offsetParent})};'
        + 'var done=pick("完成");if(done.length){done[done.length-1].click();return "DISMISSED"}'
        + 'var cancel=pick("取消").concat(pick("关闭"),pick("×"));if(cancel.length){cancel[cancel.length-1].click();return "CANCELLED"}'
        + 'return "MODAL_NO_CLOSE"})()'
      )
      if (result && result !== 'NO_EDIT_MODAL') log.info('RpaView', '[' + platform + '] image-edit modal: ' + result)
      if (result === 'DISMISSED' || result === 'CANCELLED') await this._sleep(1500)
      return result
    } catch (e) {
      log.warn('RpaView', '[' + platform + '] image-edit modal: ' + e.message)
      return null
    }
  },

  // ========== 视频上传完成强判定（v1~v3 历史沿革，实现已下沉 upload-waiter.js）==========
  // v1 旧判定 !progress||success 在快手/B站等平台立即为真（页面不用 progress class），
  // 导致还在上传落地页就继续填字段/点发布，全部失败（2026-09 smoke4 实锤）。
  // v2 收紧：blob 本地预览注入瞬间就存在，不能算完成（smoke5 实锤）。
  // v3（2026-09 smoke6 实锤）：快手 25s 即误判完成，因为页内存在 https 广告 video，
  // 故加入平台通用的“正在上传”负向信号（上传中…/剩余时间：/转码中/可见进度条），
  // 预算拉到 15 分钟（B站 96MB 实测超 10 分钟）。
  // v4（2026-10 抖音 909KB 卡 30% 达 15 分 25 秒实锤）：v3 的合取判定会被残留
  // progress 元素锁死，故改为自适应轮询并下沉到 upload-waiter.js（本文件超行数门禁，
  // 且 v4 需新增探针串 + 轮询循环）。此处只留历史沿革，不再保留实现。





  // ========== 头条封面上传（2026-09-30 真机实测）==========
  // 点 `.article-cover-add` 后出现 **2 个** `input[type=file]`；用 CDP 注入**第一个**后封面区
  // **始终无缩略图**（React 受控未接受）⇒ 必填校验拦下提交 ⇒ 作品 `total_count: 0`。
  // 本方法**逐个 input 尝试**，注入走**纯页面内 DataTransfer**（不依赖 CDP nodeId，便于按下标遍历）。
  async _uploadToutiaoCover(win, filePath) {
    // 2026-09-30 判据收紧 + 删「预判已有封面」短路：旧实现把 `background-image !== 'none'` 也算已有
    // 封面，且任意 `img`（图标/占位）都算 ⇒ 真正封面为空、必填校验拦下提交。外审 finding #3：**仅删
    // 短路不够** —— 判据若仍是"有 img"，占位 img 会让首次循环即报 `OK_0`（注入被忽略），旧误报只是
    // 改名。修法：记录**注入前 img 基线数**，计数增加才算生效。
    const THUMB_FN = 'function(){var w=document.querySelector(".article-cover-images-wrap");'
      + 'if(!w)return -1;return w.querySelectorAll("img").length}'
    const readThumbCount = async () => {
      try { return Number(await win.webContents.executeJavaScript('(' + THUMB_FN + ')()')) } catch (_) { return -1 }
    }
    const thumbBaseline = await readThumbCount()
    log.info('RpaView', '[toutiao cover] img 基线=' + thumbBaseline)
    // 展开封面编辑区（渲染可能较慢，先等再点）    await this._waitForElement(win, '.article-cover-add, .article-cover-images-wrap', 12000)
    try {
      const entry = await win.webContents.executeJavaScript(
        '(function(){var a=document.querySelector(\'.article-cover-add\');if(a){a.click();return \'CLICKED_ADD\'}'
        + 'var w=document.querySelector(\'.article-cover-images-wrap\');if(w){w.click();return \'CLICKED_WRAP\'}return \'NO_ENTRY\'})()'
      )
      log.info('RpaView', '[toutiao cover] entry=' + entry)
    } catch (e) { log.warn('RpaView', '[toutiao cover] entry: ' + e.message) }
    await this._sleep(2500)

    // 声明但不预赋初值：初值会被 try 内的真实取值覆盖，预赋初值会触发 no-useless-assignment
    let b64
    let fileName
    let mimeType
    try {
      b64 = require('fs').readFileSync(filePath).toString('base64')
      fileName = require('path').basename(filePath)
      // `_guessMimeType` 是主文件（rpa-view-platforms.js）的模块级函数，本文件不可见，
      // 故此处内联推断（封面只可能是这几种位图）。
      mimeType = /\.jpe?g$/i.test(fileName) ? 'image/jpeg' : (/\.webp$/i.test(fileName) ? 'image/webp' : 'image/png')
    } catch (e) {
      log.warn('RpaView', '[toutiao cover] 读取封面失败: ' + e.message)
      return 'READ_FAILED'
    }

    const total = await win.webContents.executeJavaScript('document.querySelectorAll(\'input[type=file]\').length').catch(() => 0)
    log.info('RpaView', '[toutiao cover] file input 数量=' + total)
    const attempts = Math.max(1, Number(total) || 1)
    for (let i = 0; i < attempts; i += 1) {
      try {
        const r = await win.webContents.executeJavaScript(
          '(function(){var ins=document.querySelectorAll(\'input[type=file]\');var el=ins[' + i + '];'
          + 'if(!el)return \'NO_INPUT_' + i + '\';'
          + 'var b64=' + JSON.stringify(b64) + ';var bin=atob(b64);var n=bin.length;var bytes=new Uint8Array(n);'
          + 'for(var k=0;k<n;k++)bytes[k]=bin.charCodeAt(k);'
          + 'var f=new File([bytes],' + JSON.stringify(fileName) + ',{type:' + JSON.stringify(mimeType) + '});'
          + 'var dt=new DataTransfer();dt.items.add(f);el.files=dt.files;'
          + 'el.dispatchEvent(new Event(\'change\',{bubbles:true}));'
          + 'el.dispatchEvent(new Event(\'input\',{bubbles:true}));'
          + 'return \'INJECTED_' + i + '\'})()'
        )
        log.info('RpaView', '[toutiao cover] input#' + i + ' -> ' + r)
      } catch (e) {
        log.warn('RpaView', '[toutiao cover] input#' + i + ' 注入异常: ' + e.message)
      }
      await this._sleep(5000)
      // 外审 finding #3：**必须与注入前基线比较**才可信 —— 仅"有 img"会把页面原有占位/图标
      // 当成注入成功（旧误报改名而非消除）。基线为 -1（无容器）时退回"存在即算"的宽松语义。
      const nowCount = await readThumbCount()
      if (nowCount > thumbBaseline || (thumbBaseline < 0 && nowCount > 0)) {
        log.info('RpaView', '[toutiao cover] 缩略图已出现（input#' + i + '，img ' + thumbBaseline + '→' + nowCount + '）')
        return 'OK_' + i
      }
      log.warn('RpaView', '[toutiao cover] input#' + i + ' 注入后 img 数未增加（' + thumbBaseline + '→' + nowCount + '），视为未生效')
    }
    log.warn('RpaView', '[toutiao cover] 全部 ' + attempts + ' 个 input 注入后仍未出现缩略图')
    return 'NO_THUMB'
  },

  // ========== A2：发布跳转 URL 轮询（publish-throughput-optimization）==========
  // 替代「_sleep(5000)+单次查 URL」盲等：500ms 间隔轮询 success 跳转，最长 totalMs。
  // 命中返回 true（调用方取 URL 组装成功结果），超时 false。
  async _waitForSuccessNavigation (win, totalMs) {
    const rounds = Math.max(1, Math.round((totalMs || 5000) / 500))
    for (let i = 0; i < rounds; i++) {
      await this._sleep(500)
      try {
        const fu = win.webContents.getURL()
        if (fu.includes('success') || fu.includes('publish/success')) return true
      } catch (_) { /* 窗口可能已销毁 */ }
    }
    return false
  },

  // ========== A2：tag chip 就绪等待（publish-throughput-optimization）==========
  // 回车注入 tag 后平台异步建 chip；就绪判据 = 出现含 tag 文本且可见的元素。
  // 超时返回 false（调用方继续下一个 tag，不失败）。探针内 tag 值经 JSON.stringify
  // 注入字符串常量（R75：_waitForCondition 的 fn 必须是硬编码字面量）。
  async _waitForTagChip (win, tag, timeoutMs) {
    return this._waitForCondition(
      win,
      'function(){var t=' + JSON.stringify(tag) + ';var els=[].concat.apply([],document.querySelectorAll(\'[class*="tag"],[class*="Tag"]\'));return els.some(function(e){return (e.innerText||"").indexOf(t)!==-1&&e.getClientRects().length>0})}',
      timeoutMs || 5000, 500,
    )
  },

  // ========== A2：封面缩略图基线计数等待（publish-throughput-optimization）==========
  // 与 _uploadToutiaoCover 同款「基线递增」判据的通用化：读 selector 域内 img 数作基线，
  // 注入后轮询计数超过基线即确认平台接受；超时返回 false（调用方降级，不失败）。
  // 从 rpa-view-platforms.js 抽出（行数门禁 LEDGER_GREW：该文件已贴容差上限）。
  async _waitForThumbnailIncrease (win, containerSel, injectFn, timeoutMs) {
    try {
      let baseline = -1
      try {
        baseline = Number(await win.webContents.executeJavaScript(
          '(function(){var w=document.querySelector(' + JSON.stringify(containerSel) + ');if(!w)return -1;return w.querySelectorAll("img").length})()'
        ))
      } catch (_) { /* 读不到按 -1 */ }
      if (injectFn) await injectFn()
      const threshold = Number.isFinite(baseline) && baseline >= 0 ? baseline : 0
      return await this._waitForCondition(
        win,
        'function(){var w=document.querySelector(' + JSON.stringify(containerSel) + ');if(!w)return false;return w.querySelectorAll("img").length > ' + threshold + '}',
        timeoutMs || 10000, 500,
      )
    } catch (e) {
      log.warn('RpaView', '[thumbnail wait] ' + (e && e.message))
      return false
    }
  },


}

module.exports = { navigationHelpers, stripHtmlToPlainText }
