// @ts-check
/**
 * upload-waiter.js — 视频上传等待循环（mixin 片段，rpa-view-navigation-helpers 的下沉拆分）
 *
 * 为什么独立成文件（2026-10 publish-progress-dup-upload）：
 * 逐文件行数门禁（.github/scripts/check-max-lines.js，limit=500）下
 * rpa-view-navigation-helpers.js 登记 495 行已无膨胀余量，而 v4 等待策略要加
 * 探针串 + 自实现轮询循环。故按本仓既有 mixin 拆分范式下沉到本文件，
 * 由 rpa-view-platforms.js 用 Object.assign 合回（与 navigationHelpers 同款接线）。
 *
 * 依赖：log（logger）+ upload-wait-strategy（纯判定）+ 宿主提供的 this._sleep/_emitProgress。
 * 方法内只通过 this.* 访问宿主 mixin，不反向依赖 platforms/navigation。
 */
'use strict'

const log = require('./logger')
const {
  computeBudgetMs,
  decideUploadWait,
} = require('./upload-wait-strategy')

/**
 * 读取视频字节数（供上传等待预算自适应）。
 * 拿不到（路径缺失/已清理/无权限）返回 null —— 调用方回退到既有 900000ms 预算，
 * 不因取体积失败而改变等待语义。
 * @param {string|null|undefined} videoPath
 * @returns {number|null}
 */
function readVideoFileBytes (videoPath) {
  if (typeof videoPath !== 'string' || !videoPath) return null
  try {
    const size = require('fs').statSync(videoPath).size
    return Number.isFinite(size) && size > 0 ? size : null
  } catch (_) {
    return null
  }
}

const uploadWaiterMixin = {
  // ========== 视频上传完成判定（v4 自适应轮询） ==========
  // v1/v2/v3 留在 rpa-view-navigation-helpers.js 的历史注释里。v4 改三点：
  //   ① 自实现 3s 轮询（不再用 _waitForCondition 黑盒），每轮取结构化信号；
  //   ② 等待期把**页面自身上传百分比**映射为真实进度上报（30~49 波段，stage 串不变）；
  //   ③ 预算按文件大小自适应（computeBudgetMs：909KB→90s；不传 fileBytes 仍 900000 兜底）；
  //   ④ 停滞检测（百分比 180s 不变 + 结构性信号）提前 best-effort 放行。
  // 行为兼容：done → true；besteffort → 打既有 warn 日志并返回 false。
  async _waitForVideoUploadComplete(win, platform, timeoutMs, opts = {}) {
    // 上传信号探针（页面上下文执行的函数字面量串）。旧版只回一个布尔
    // （负向信号不命中 && 正向信号命中），而抖音上传完成后页面残留可见
    // `[class*=progress]` 元素/「转码中」文本 ⇒ uploading 恒真 ⇒ 白等满 15 分钟。
    // 改为返回四元组交由 decideUploadWait 加权决策：
    //   uploading = 上传中/正在上传/剩余时间/转码中/上传失败 + 可见进度类元素 + 百分比<100
    //   pagePercent = 页面自报百分比（(\d{1,3})\s*%，无则 null）→ 真实进度上报
    //   positive = https 视频预览 || 编辑器输入 || location.href 含 post/video
    //   structural = 任意可见 video（含 blob 预览）|| 编辑器输入 || 上传完成类文案
    // 2026-10-22（关键）：RPA 窗口是**隐藏窗口**，`innerText` 依赖渲染/布局，可能返回空串；
    // 而西瓜上传页**只靠文本判据**（无 <video>、无编辑器输入），一旦 t 恒空 ⇒
    // doneCopy/doneText/uploadingText/百分比全部失效，只能等预算耗尽。
    // 实测：17:49:07 开始上传 → 17:59:08（整整 600s）仍报未检测到；而外部探测同页可见「上传成功」。
    // 故文本取值改为 innerText || textContent（textContent 不依赖渲染），并上报 textLen 以便诊断。
    const probe = 'function(){var t=(document.body&&(document.body.innerText||document.body.textContent))||"";'
      + 'var pv=[...document.querySelectorAll("[class*=progress],[class*=uploading],[class*=percent],[class*=Percent]")].filter(function(e){return e.offsetParent&&e.clientHeight>0}).length;'
      + 'var m=t.match(/(\\d{1,3})\\s*%/);var pct=m?Number(m[1]):-1;'
      + 'var uploadingText=/上传中[….]{1,3}|正在上传|剩余时间[:\uff1a]|转码中|上传失败/.test(t);'
      + 'var uploading=uploadingText||pv>0||(pct>=0&&pct<100);'
      + 'var vv=[...document.querySelectorAll("video")].some(function(v){var s=v.currentSrc||v.src||"";return s.indexOf("https:")===0&&v.getClientRects().length>0});'
      + 'var ed=!!document.querySelector(\'input[placeholder*="标题"],textarea[placeholder],[contenteditable="true"]\');'
      + 'var vu=[...document.querySelectorAll("video")].some(function(v){return v.getClientRects().length>0});'
      + 'var doneText=/重新上传|重新选择|上传完成|上传成功/.test(t);'
      // doneCopy：强完成文案（只认「成功/完成/完毕」，不认「重新上传」这类可能是静态提示的词）。
      // 2026-10-21 真机取证（西瓜上传页）：上传成功后页面明写「上传成功」+「重新上传 删除」，
      // 但 videoCount=0、无 textarea/contenteditable、placeholder 不含「标题」、URL 不含 post/video
      // ⇒ 旧 positive 的四个判据全落空 ⇒ P4(positive && !uploading) 永不成立 ⇒ 干等满预算。
      // 强完成文案是**平台无关的语义信号**，补进 positive 才能让该类页面正常收敛。
      + 'var doneCopy=/上传成功|上传完成|上传完毕|设置封面|检测为高清/.test(t);'
      // 2026-10-22：把「强完成文案」(doneStrong) 与「纯文本上传中」(uploadingText) 单列上报。
      // 原因：uploading 里的 pv>0 是弱 DOM 形状判据（容器类名即可命中），它会让 P4 永不成立——
      // 与 L48-50 记的抖音同型故障一模一样。西瓜页实测：页面已显示「上传成功」但仍有
      // xigua-upload-video* 容器 ⇒ uploading 恒真。强语义证据不得被弱形状判据否决。
      + 'return {uploading:!!uploading,uploadingText:!!uploadingText,pagePercent:pct>=0?pct:null,positive:!!(vv||ed||doneCopy||location.href.indexOf("post/video")!==-1),doneStrong:!!doneCopy,structural:!!(vu||ed||doneText),textLen:t.length}}'
    const bytes = Number(opts && opts.fileBytes)
    const minMs = (require('./upload-wait-strategy').PLATFORM_MIN_BUDGET_MS || {})[platform]
const budgetMs = Number.isFinite(bytes) && bytes > 0 ? computeBudgetMs(bytes, { minMs }) : (timeoutMs || 900000)
    const startedAt = Date.now()
    let prevPagePercent = null
    let stableSince = startedAt
    let lastReported = null
    for (;;) {
      const now = Date.now()
      // 2026-10-22（真机挂死现场）：任务卡在 uploading file... 后**一小时无任何进展**、
      // 连 300s 的 best-effort 日志都没出现 ⇒ `_probeUploadSignal` 的 Promise 永不 resolve
      // （executeJavaScript 依赖渲染进程应答；窗口被隐藏/节流/渲染进程挂起时可能永不应答），
      // 而循环里**没有单次探测的超时**，于是整条发布链永久挂起（连预算判定都执行不到）。
      // 修法：每次探测都套一层**硬超时**，超时按「无效帧」处理（不刷新停滞计时、不判完成），
      // 让预算与停滞判定继续生效 —— 循环终止性优先于单次采集成功。
      const PROBE_TIMEOUT_MS = 15000
      const signal = await Promise.race([
        this._probeUploadSignal(win, probe),
        new Promise((resolve) => setTimeout(() => resolve({
          uploading: false, uploadingText: false, pagePercent: null,
          positive: false, doneStrong: false, structural: false, probeTimedOut: true,
        }), PROBE_TIMEOUT_MS)),
      ])
      // 首帧记录文本长度：这是判断「探针读不到页面文本」与「页面真的没渲染」的唯一分界。
      if (this._probeTextLenLogged !== true) {
        this._probeTextLenLogged = true
        log.info('RpaView', '[' + platform + '] upload probe textLen=' + signal.textLen + ' (innerText||textContent)')
      }
      // 超时可见化：否则「探测一直不返回」与「页面一直没完成」在日志上完全同形。
      if (signal.probeTimedOut) {
        this._probeTimeoutCount = (this._probeTimeoutCount || 0) + 1
        if (this._probeTimeoutCount === 1 || this._probeTimeoutCount % 20 === 0) log.warn('RpaView', '[' + platform + '] upload probe timed out x' + this._probeTimeoutCount + '（渲染进程未应答，按无效帧继续）')
      }
      // 评审整改 C4（2026-10）：只有**有效百分比帧**且与上一有效值不同才重置停滞计时；
      // 连续无效帧（pagePercent=null，页面 DOM 未就绪/executeJavaScript 容错路径）
      // 不得刷新 stableSince，否则停滞判定永远凑不满 180s（预算形同虚设的变体）。
      if (signal.pagePercent !== null && signal.pagePercent !== prevPagePercent) {
        prevPagePercent = signal.pagePercent
        stableSince = now
      }
      if (this._uploadConfirmed) { log.info('RpaView', '[' + platform + '] upload confirmed via publishBtnAfter, skip polling'); return true }
      const decision = decideUploadWait({
        elapsedMs: now - startedAt,
        budgetMs,
        pagePercent: signal.pagePercent,
        prevPagePercent,
        uploading: signal.uploading,
        positiveSignal: signal.positive,
        structuralSignal: signal.structural,
        doneStrong: signal.doneStrong,
        uploadingText: signal.uploadingText,
        stableSinceMs: now - stableSince,
      })
      // 进度只增不减（页面百分比抖动不至于让用户看到进度条倒退）
      const reportPercent = decision.reportPercent
      if (reportPercent !== null && (lastReported === null || reportPercent > lastReported)) {
        lastReported = reportPercent
        this._emitProgress(platform, 'waiting upload...', reportPercent)
      }
      if (decision.action === 'done') return true
      if (decision.action === 'besteffort') {
        log.warn('RpaView', '[' + platform + '] video upload-complete signal not detected (preview/url), continuing best-effort')
        return false
      }
      // 稳定期（25s，防 blob 预览误判的历史纪律）由 decideUploadWait 内部守：
      // 稳定期内也轮询上报页面百分比，但不判定 done/besteffort。
      // 评审整改 C3（2026-10）：_sleep 异常不得中断等待循环（否则预算「必然返回」
      // 的保证被打破）；sleep 失败按「继续等待」处理，下一轮照常探针+决策。
      try {
        await this._sleep(3000)
      } catch (_sleepErr) { /* 容错继续：循环终止性优先于单次休眠失败 */ }
    }
  },

  /**
   * 视频上传整段（从「有没有入口」到「有没有被确认」），结果写进 `fillReport.upload`。
   *
   * 为什么下沉到这里（publish-precondition-gate，2026-10-18）：这段逻辑原先内联在
   * `rpa-view-platforms._publish_generic` 里，两个形态缺陷都出在它身上——
   *   ① 选择器缺失时**整段静默跳过、不留任何记录**（头条现场 `selectorCount=0`）；
   *   ② `_waitForVideoUploadComplete` 的返回值被**丢弃**（抖音现场 besteffort 放行后继续点发布）。
   * 下沉后 `_publish_generic` 只剩一行调用，且「上传事实」有唯一产出点，
   * 前置门禁（`publish-precondition.js`）才有东西可判。
   *
   * 三态口径（缺一不可）：
   *   平台没登记入口 ⇒ `{ok:false, reason:'upload-selector-missing'}`（= 未实现，不是失败）
   *   等待被确认     ⇒ `{ok:true}`
   *   未确认/抛错    ⇒ `{ok:false, detail|error}`（**不得**默认成功）
   *
   * @param {object} win BrowserWindow
   * @param {object} article 文章/视频载荷
   * @param {string} platform 平台 id
   * @param {object} sel 平台选择器
   * @param {object} fillReport 填表结果（本函数写 `.upload`）
   * @param {object} retry FieldRetryState
   * @returns {Promise<void>}
   */
  async _runVideoUpload(win, article, platform, sel, fillReport, retry) {
    if (!article.video_path) return
    const inputs = Array.isArray(sel.file_input) ? sel.file_input : []
    if (inputs.length === 0) {
      fillReport.upload = { ok: false, reason: 'upload-selector-missing', detail: 'platform has no file_input selector' }
      log.warn('RpaView', '[' + platform + '] video present but platform has no file_input selector (video publish unsupported)')
      return
    }
    retry.addField('file_upload')
    while (!retry.isDone('file_upload')) {
      try {
        this._emitProgress(platform, 'uploading file...', 25)
        // 逐候选定位文件输入（上传落地页常有多个 input[type=file]，首个未必负责视频）
        const fileSel = await this._resolveSelector(win, inputs, 15000, 3000)
        if (!fileSel) {
          // 2026-10-23 诊断：视频号上传卡在重试循环且未进入 _setFileInput ⇒ 打印页面真实 input。
          try {
            const shape = await win.webContents.executeJavaScript('(function(){var a=[].slice.call(document.querySelectorAll("input[type=file]"));return a.map(function(e){return (e.accept||"-")+"|"+(e.className||"").toString().slice(0,24)}).join(" ; ")||"NONE"})()', true)
            log.warn('RpaView', '[' + platform + '] file inputs on page: ' + shape)
          } catch (_e9) { /* 诊断失败忽略 */ }
          // 2026-10-23：视频号页面无 input[type=file]，改走 CDP 文件选择器拦截。
          if (platform === 'tencent_video') { // chooserGuard
            let chooserDone = false
            try { chooserDone = await this._uploadViaFileChooser(win, article.video_path) }
            catch (_e10) { log.warn('RpaView', '[tencent_video] chooser threw: ' + _e10.message) }
            // dropViaCdpGuard：视频号上传区是纯拖拽区（点击不弹原生选择器），改用 CDP 真实拖放。
            if (!chooserDone && typeof this._dropViaCdp === 'function') {
              let dropped2 = false
              try { dropped2 = await this._dropViaCdp(win, article.video_path, '[class*=upload],[class*=dragger],[class*=drop],div[class*=empty],[class*=uploader],[class*=add]') }
              catch (_e11) { log.warn('RpaView', '[tencent_video] cdp-drop threw: ' + _e11.message) }
              if (dropped2) {
                const ok2 = await this._waitForVideoUploadComplete(win, platform, 600000, { fileBytes: readVideoFileBytes(article.video_path) }).catch(() => false)
                if (ok2) { fillReport.upload = { ok: true }; retry.markDone('file_upload'); this._emitProgress(platform, 'file uploaded', 40); break }
              }
            }
            if (chooserDone) {
              const ok = await this._waitForVideoUploadComplete(win, platform, 600000, { fileBytes: readVideoFileBytes(article.video_path) }).catch(() => false)
              fillReport.upload = ok ? { ok: true } : { ok: false, detail: '选择器注入后未等到上传完成信号' }
              if (ok) { retry.markDone('file_upload'); this._emitProgress(platform, 'file uploaded', 40); break }
            }
          }
          if (!retry.retry('file_upload')) break
          await this._sleep(2000); continue
        }
        await this._setFileInput(win, article.video_path, fileSel)
        // 2026-10-23：视频号即使 _setFileInput 返回成功，页面仍可能不接受文件（截图实证）。
        // always try the chooser：无条件再用 CDP 文件选择器注入一次，作为第二通道。
        if (platform === 'tencent_video' && typeof this._uploadViaFileChooser === 'function') {
          try {
            const ok2 = await this._uploadViaFileChooser(win, article.video_path)
            log.info('RpaView', '[tencent_video] chooser second pass: ' + ok2)
          } catch (_e8) { log.warn('RpaView', '[tencent_video] chooser second pass failed: ' + _e8.message) }
        }
        // 完成判定：百家号看「预览/编辑器/发布按钮可用」，其余平台走上传等待器
        let uploadDone
        if (platform === 'baijiahao') {
          uploadDone = await this._waitForCondition(win, 'function(){var t=(document.body&&document.body.innerText)||"";var hasPreview=/预览|编辑|描述|简介|标题/.test(t);var ed=document.querySelector("[contenteditable=true],[data-lexical-editor=true]");var btn=[...document.querySelectorAll("button")].find(function(b){return (b.innerText||"").trim()==="发布"&&!b.disabled});return hasPreview&&(ed!==null||btn!==null)}', 180000, 1000)
          if (!uploadDone) log.warn('RpaView', '[' + platform + '] upload complete wait timeout (video may still be processing)')
        } else {
          uploadDone = await this._waitForVideoUploadComplete(win, platform, 900000, { fileBytes: readVideoFileBytes(article.video_path) })
        }
        fillReport.upload = uploadDone
          ? { ok: true }
          : { ok: false, detail: '未检测到上传完成信号（页面未出现预览/编辑器/上传完成文案）' }
        // 表单就绪：上传完成后平台 SPA 渲染标题/简介有延迟（B站/快手要等切到编辑表单）
        const formReady = await this._waitForCondition(win, 'function(){return !!document.querySelector(\'input[placeholder*="标题"],textarea,[contenteditable="true"]\')}', 120000, 1500)
        if (!formReady) log.warn('RpaView', '[' + platform + '] editor form not ready after upload (still trying fields)')
        // i3（第三轮裁决）：取证是旁路，模块加载/采集失败都**不得**打断上传确认主链。
        try { await require('./rpa-dom-dump').dumpDom(win, platform, 'uploaded', { logger: log }) } catch (_) { /* 旁路失败忽略 */ }
        retry.markDone('file_upload'); this._emitProgress(platform, 'file uploaded', 40)
      } catch (e) {
        log.warn('RpaView', '[' + platform + '] upload: ' + e.message)
        fillReport.upload = { ok: false, error: e.message }
        if (!retry.retry('file_upload')) break
        await this._sleep(2000)
      }
    }
    // 重试用尽兜底：没拿到明确结论一律按「未完成」记（不得默认成功）
    if (!fillReport.upload) {
      fillReport.upload = retry.isDone('file_upload') ? { ok: true } : { ok: false, detail: '上传步骤重试已用尽，未确认完成' }
    }
  },

  /**
   * 取一帧上传信号（在页面上下文执行探针函数串）。
   * executeJavaScript 异常/非对象返回一律容错为「无信号」（不抛错、不中断等待循环）。
   * @param {object} win BrowserWindow（WebContentsView 宿主）
   * @param {string} probeFn 页面上下文函数字面量串（硬编码，禁止拼接用户输入）
   * @returns {Promise<{uploading:boolean,pagePercent:number|null,positive:boolean,structural:boolean}>}
   */
  async _probeUploadSignal(win, probeFn) {
    // ⚠ 这里加字段必须与下方 return **同步**（2026-10-22 血的教训）。
    // 本方法会把页面返回值**按白名单重建**——新增的上游字段若不加进白名单，
    // 会在这一层被静默丢弃：doneStrong/uploadingText/textLen 就这样丢了整整两轮，
    // 表现为「页面明明显示上传成功，判定层永远收不到」，且没有任何报错。
    // 与 router 丢 track/apiTrackFailed（PR #4185）是同一类缺陷：翻译层白名单漏字段。
    const empty = { uploading: false, uploadingText: false, pagePercent: null, positive: false, doneStrong: false, structural: false, textLen: null }
    if (typeof probeFn !== 'string' || !probeFn) return empty
    try {
      const raw = await win.webContents.executeJavaScript('(' + probeFn + ')()')
      if (!raw || typeof raw !== 'object') return empty
      // null/undefined 必须先拦：Number(null) === 0 会被误读成「页面报 0%」，
      // 进而让判定长期卡在「百分比 <100」分支（等待预算形同虚设）。
      const rawPct = raw.pagePercent === null || raw.pagePercent === undefined ? null : Number(raw.pagePercent)
      const pct = rawPct !== null && Number.isFinite(rawPct) && rawPct >= 0 && rawPct <= 100 ? rawPct : null
      const rawLen = Number(raw.textLen)
      return {
        uploading: Boolean(raw.uploading),
        uploadingText: Boolean(raw.uploadingText),
        pagePercent: pct,
        positive: Boolean(raw.positive),
        doneStrong: Boolean(raw.doneStrong),
        structural: Boolean(raw.structural),
        textLen: Number.isFinite(rawLen) ? rawLen : null,
      }
    } catch (_e) {
      return empty
    }
  },

  /**
   * 2026-10-23（视频号实测 file inputs on page: NONE）：上传器没有 input[type=file]，
   * 点击上传区才由 JS 动态创建并弹出文件选择器。用 CDP 拦截选择器，直接把文件交给它。
   * 判据：Page.fileChooserOpened 事件拿到 backendNodeId ⇒ DOM.setFileInputFiles 成功。
   */
  async _uploadViaFileChooser(win, filePath, clickSelectors) {
    const path = require('path')
    const dbg = win.webContents.debugger
    let attachedHere = false
    try {
      // attachGuard（2026-10-23）：attach 必须在 try 内——发布网络捕获已附着同一 target 时
      // attach 会抛「Another debugger is already attached」，此前它写在外面导致整轮静默。
      if (!dbg.isAttached()) { dbg.attach('1.3'); attachedHere = true }
      await dbg.sendCommand('Page.enable')
      // deep-input：在 pierce 后的节点树里找 input[type=file]（含 shadow root），直接 setFileInputFiles。
      try {
        const deepDoc = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
        let _inputNodeId = 0
        const walkDeep = (n) => {
          if (!n || _inputNodeId) return
          if (n.nodeName === 'INPUT') {
            const a = n.attributes || []
            for (let i = 0; i < a.length; i += 2) { if (a[i] === 'type' && String(a[i+1]).toLowerCase() === 'file') { _inputNodeId = n.nodeId; return } }
          }
          const kids = [].concat(n.children || [], n.shadowRoots || [])
          for (const k of kids) walkDeep(k)
        }
        let _wujieShadow = 0
        const findWujie = (n) => {
          if (!n || _wujieShadow) return
          const a = n.attributes || []
          for (let i = 0; i < a.length; i += 2) { if (a[i] === 'class' && String(a[i+1]).indexOf('wujie_iframe') >= 0) { if (n.shadowRoots && n.shadowRoots[0]) { _wujieShadow = n.shadowRoots[0].nodeId; return } } }
          const kids = [].concat(n.children || [], n.shadowRoots || [])
          for (const k of kids) findWujie(k)
        }
        findWujie(deepDoc.root)
        if (_wujieShadow) {
          try {
            const wq = await dbg.sendCommand('DOM.querySelector', { nodeId: _wujieShadow, selector: '.upload input[type="file"]' })
            if (wq && wq.nodeId) { _inputNodeId = wq.nodeId; log.info('RpaView', 'cdp-drop: wujie-shadow input found nodeId=' + _inputNodeId) }
          } catch (_eWq) {}
        }
        walkDeep(deepDoc.root)
        if (_inputNodeId) {
          await dbg.sendCommand('DOM.setFileInputFiles', { files: [require('path').resolve(filePath)], nodeId: _inputNodeId })
          log.info('RpaView', 'cdp-drop: deep-input setFileInputFiles ok nodeId=' + _inputNodeId + ' (not returning; fall through to shadow-scan)')
        }
        log.info('RpaView', 'cdp-drop: deep-input found no file input')
      } catch (eD) { log.warn('RpaView', 'cdp-drop: deep-input failed ' + (eD && eD.message ? eD.message.slice(0,80) : '')) }
      // shadow-scan：上传区不在普通 DOM（主帧只出页头、编辑器 iframe 恒空），改递归穿透 shadowRoot。
      try {
        const sv = await win.webContents.executeJavaScript("(function(){var out={found:false};var seen=0;function walk(root,depth){if(!root||depth>8||seen>4000)return null;var els;try{els=root.querySelectorAll('*')}catch(e){return null}for(var i=0;i<els.length;i++){var e=els[i];seen++;var t='';try{t=e.innerText||''}catch(e2){}if(t&&(t.indexOf('上传时长')>=0||t.indexOf('添加视频')>=0||t.indexOf('点击上传')>=0)){return e}var cn='';try{cn=String(e.className||'')}catch(e3){}if(cn&&(cn.indexOf('upload')>=0||cn.indexOf('dragger')>=0||cn.indexOf('drop')>=0)){return e}if(e.shadowRoot){var r=walk(e.shadowRoot,depth+1);if(r)return r}}return null}var cands=[];function collect(root,depth){if(!root||depth>8)return;var els;try{els=root.querySelectorAll('*')}catch(e){return}for(var i=0;i<els.length;i++){var e=els[i];var t='';try{t=e.innerText||''}catch(e2){}var cn='';try{cn=String(e.className||'')}catch(e3){}var isHit=(t&&(t.indexOf('上传时长')>=0||t.indexOf('点击上传')>=0))||(cn&&(cn.indexOf('dragger')>=0||cn.indexOf('drop')>=0||cn.indexOf('upload')>=0));if(isHit){var r0=e.getBoundingClientRect();var area=r0.width*r0.height;if(area>=400&&area<=400000)cands.push({e:e,area:area})}if(e.shadowRoot)collect(e.shadowRoot,depth+1)}}collect(document,0);cands.sort(function(a,b){return a.area-b.area});var hit=cands.length?cands[0].e:walk(document,0);if(!hit)return out;hit.setAttribute('data-mp-drop','1');var r=hit.getBoundingClientRect();return {found:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height),via:'shadow-scan'}})()", true)
        log.info('RpaView', 'cdp-drop: shadow-scan ' + JSON.stringify(sv))
        if (sv && sv.found && sv.w > 0 && sv.h > 0) {
          // click-chooser-first：CDP 真鼠标点击 + 选择器拦截（isTrusted=true）
          try { if (await this._clickThenChooser(win, sv.x, sv.y, filePath)) { log.info('RpaView', 'cdp-drop: dispatched (click-chooser) ' + filePath); return true } } catch (_eCC) {}
          const _abs2 = require('path').resolve(filePath)
          const _d = { items: [{ mimeType: 'text/plain', data: '' }], files: [_abs2], dragOperationsMask: 1 }
          for (const _t of ['dragEnter','dragOver','drop']) {
            await dbg.sendCommand('Input.dispatchDragEvent', { type: _t, x: sv.x, y: sv.y, data: _d })
          }
          log.info('RpaView', 'cdp-drop: dispatched (shadow-scan) ' + filePath)
          try { dbg.detach() } catch (_eS) {}
          return true
        }
      } catch (eS) { log.warn('RpaView', 'cdp-drop: shadow-scan failed ' + (eS && eS.message ? eS.message.slice(0,80) : '')) }
      // frame-scan：pierce/querySelector 对 iframe 无效，改用 createIsolatedWorld + Runtime.evaluate 在每帧内定位。
      try {
        const ft2 = await dbg.sendCommand('Page.getFrameTree')
        const flat2 = []
        const walk2 = (n) => { if(!n) return; flat2.push(n.frame); if(n.childFrames) n.childFrames.forEach(walk2) }
        walk2(ft2.frameTree)
        // 2026-10-24 帧探针：编辑器 iframe 首扫时 text='' kids=0（尚未渲染）⇒ 轮询等待。
        let _frameReady = false
        for (let attempt = 0; attempt < 20 && !_frameReady; attempt++) {
          for (const f of flat2) {
            if (!f || !f.id) continue
            if (!String(f.url||'').includes('/micro/content/')) continue
            try {
              const w0 = await dbg.sendCommand('Page.createIsolatedWorld', { frameId: f.id, worldName: 'mp-probe' })
              const ev0 = await dbg.sendCommand('Runtime.evaluate', { contextId: w0.executionContextId, expression: '(document.body?document.body.children.length:0)', returnByValue: true })
              const kids = (ev0 && ev0.result && ev0.result.value) || 0
              if (kids > 0) { _frameReady = true; break }
            } catch (_e0) { /* 该帧不可注入 */ }
          }
          if (!_frameReady) await new Promise((r) => setTimeout(r, 1000))
        }
        log.info('RpaView', 'frame-scan: ready=' + _frameReady + ' after poll')
        log.info('RpaView', 'frame-scan: frames=' + flat2.length + ' ' + flat2.map(f=>String(f.url||'').slice(0,60)).join(' | '))
        let _hitCount = 0
        for (const f of flat2) {
          if (!f || !f.id) continue
          try {
            const w2 = await dbg.sendCommand('Page.createIsolatedWorld', { frameId: f.id, worldName: 'mp-drop' })
            const ev = await dbg.sendCommand('Runtime.evaluate', { contextId: w2.executionContextId, expression: "(function(){  var els=[].slice.call(document.querySelectorAll('div,section,span,button'));  var hit=null;  for(var i=0;i<els.length;i++){var e=els[i];var t=(e.innerText||'');if(t&&(t.indexOf('上传时长')>=0||t.indexOf('添加视频')>=0||t.indexOf('点击上传')>=0)){hit=e;break}}  if(!hit){var c=[].slice.call(document.querySelectorAll('[class*=upload],[class*=dragger],[class*=drop],[class*=uploader]'));if(c.length){hit=c[0]}}  if(!hit) return {found:false,probe:'frame-probe text=' + (document.body?document.body.innerText.replace(/\s+/g,' ').slice(0,160):'<nobody>') + ' inputs=' + document.querySelectorAll('input[type=file]').length + ' kids=' + (document.body?document.body.children.length:0)};  hit.setAttribute('data-mp-drop','1');  var r=hit.getBoundingClientRect();  return {found:true,x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height)};})()", returnByValue: true })
            const rv = ev && ev.result && ev.result.value
            if (rv && !rv.found && rv.probe) { log.info('RpaView', 'cdp-drop: ' + rv.probe) }
            if (rv && rv.found && rv.w > 0 && rv.h > 0) {
              log.info('RpaView', 'cdp-drop: frame-scan hit ' + String(f.url||'').slice(0,60) + ' ' + JSON.stringify(rv))
              await dbg.sendCommand('Input.dispatchDragEvent', { type: 'dragEnter', x: rv.x, y: rv.y, data: { items: [{ mimeType: 'text/plain', data: '' }], files: [require('path').resolve(filePath)], dragOperationsMask: 1 } })
              await dbg.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', x: rv.x, y: rv.y, data: { items: [{ mimeType: 'text/plain', data: '' }], files: [require('path').resolve(filePath)], dragOperationsMask: 1 } })
              await dbg.sendCommand('Input.dispatchDragEvent', { type: 'drop', x: rv.x, y: rv.y, data: { items: [{ mimeType: 'text/plain', data: '' }], files: [require('path').resolve(filePath)], dragOperationsMask: 1 } })
              log.info('RpaView', 'cdp-drop: dispatched (frame-scan) ' + filePath)
              try { dbg.detach() } catch (e0) {}
              return true
            }
          } catch (e16) { log.warn('RpaView', 'frame-scan: inject failed ' + String(f.url||'').slice(0,50) + ' :: ' + (e16 && e16.message ? e16.message.slice(0,80) : '')) }
        }
      } catch (e17) { log.warn('RpaView', 'frame-scan: no frame tree :: ' + (e17 && e17.message ? e17.message.slice(0,80) : '')) }
      await dbg.sendCommand('DOM.enable')
      await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })
      const opened = new Promise((resolve) => {
        const onMsg = (_e, method, params) => {
          if (method === 'Page.fileChooserOpened') { dbg.removeListener('message', onMsg); resolve(params) }
        }
        dbg.on('message', onMsg)
        setTimeout(() => resolve(null), 8000)
      })
      const sel = JSON.stringify(clickSelectors || '[class*=upload],[class*=dragger],[class*=drop],div[class*=add],div[class*=empty],span[class*=plus]')
      await win.webContents.executeJavaScript('(function(){var c=[].slice.call(document.querySelectorAll(' + sel + ')).filter(function(e){return e.getClientRects().length>0});if(!c.length)return "NO_TARGET";c[c.length-1].click();return "CLICKED"})()', true)
      const params = await opened
      if (!params || !params.backendNodeId) { log.warn('RpaView', 'file-chooser: no fileChooserOpened within 8s (click did not open a native chooser)'); return false }
      await dbg.sendCommand('DOM.setFileInputFiles', { files: [path.resolve(filePath)], backendNodeId: params.backendNodeId })
      log.info('RpaView', 'file-chooser upload ok: ' + path.basename(filePath))
      return true
    } catch (e) {
      log.warn('RpaView', 'file-chooser upload failed: ' + e.message)
      return false
    } finally {
      try { await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: false }) } catch (_) {}
      if (attachedHere) { try { dbg.detach() } catch (_) {} }
    }
  },


  /**
   * 2026-10-23：视频号上传区是**纯拖拽区**（点击不弹原生选择器，实测两次 no fileChooserOpened）。
   * 用 CDP Input.dispatchDragEvent 把真实文件路径拖进去（dragData.files 支持绝对路径）。
   */
  /**
   * 2026-10-24（竞品 shipinghaoRun 逐字对照）：视频号页面是 wujie 微前端，
   * 上传框在 document.querySelector('.wujie_iframe').shadowRoot 内：
   *   const videoDom = shadowm.shadowRoot.querySelector('.upload')
   *   const inputDom = videoDom.querySelector('input[type="file"]')
   *   manualDispatchFileEvent({dom: inputDom, element: HTMLInputElement, elementKey: 'files', value: files.files, event: 'change'})
   * 即：用 HTMLInputElement.prototype 的原生 files setter 写值，再派发 change。
   */
  /**
   * 2026-10-24：JS 写入 files 被平台拒（isTrusted）⇒ 改用 CDP 真实鼠标点击 + 文件选择器拦截。
   * Input.dispatchMouseEvent 是浏览器级输入，isTrusted=true，等价真人点击。
   */
  async _clickThenChooser (win, x, y, filePath) {
    const path2 = require('path')
    const dbg = win.webContents.debugger
    let attached = false
    try {
      if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true }
      await dbg.sendCommand('Page.enable')
      await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true })
      const opened = new Promise((resolve) => {
        const h = (_e, method, params) => { if (method === 'Page.fileChooserOpened') { dbg.removeListener('message', h); resolve(params) } }
        dbg.on('message', h)
        setTimeout(() => { try { dbg.removeListener('message', h) } catch (_e0) {} ; resolve(null) }, 6000)
      })
      for (const type of ['mousePressed', 'mouseReleased']) {
        await dbg.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
      }
      const ev = await opened
      if (!ev || !ev.backendNodeId) { log.warn('RpaView', 'click-chooser: no fileChooserOpened'); return false }
      await dbg.sendCommand('DOM.setFileInputFiles', { files: [path2.resolve(filePath)], backendNodeId: ev.backendNodeId })
      log.info('RpaView', 'click-chooser: set files via backendNodeId=' + ev.backendNodeId)
      return true
    } catch (eC) {
      log.warn('RpaView', 'click-chooser failed: ' + (eC && eC.message ? eC.message.slice(0,120) : ''))
      return false
    } finally {
      if (attached) { try { dbg.detach() } catch (_e1) {} }
    }
  },

  async _uploadViaWujie (win, filePath) {
    const fs2 = require('fs')
    const path2 = require('path')
    const abs = path2.resolve(filePath)
    // wujie-ready-wait：页面未初始化时 .wujie_iframe 还不存在，直接灌文件会静默失败。
    try {
      const readyExpr = 'new Promise(function(res){var n=0;var t=setInterval(function(){n++;var h=document.querySelector(".wujie_iframe");if(h&&h.shadowRoot){clearInterval(t);res(true)}else if(n>40){clearInterval(t);res(false)}},200)})'
      const ready = await Promise.race([
        win.webContents.executeJavaScript(readyExpr, true),
        new Promise(function (res) { setTimeout(function () { res(false) }, 9000) })
      ])
      log.info('RpaView', 'wujie-ready-wait: ready=' + ready)
      if (!ready) return false
    } catch (_eR) { log.warn('RpaView', 'wujie-ready-wait failed'); return false }
    const b64 = fs2.readFileSync(abs).toString('base64')
    const name = path2.basename(abs)
    const expr = '(function(){' +
      'var host=document.querySelector(".wujie_iframe");' +
      'if(!host||!host.shadowRoot)return {ok:false,why:"no-wujie-shadow"};' +
      'var up=host.shadowRoot.querySelector(".upload");' +
      'if(!up)return {ok:false,why:"no-upload"};' +
      'var input=up.querySelector(\'input[type="file"]\');' +
      'if(!input)return {ok:false,why:"no-input"};' +
      'var bin=atob("' + b64 + '");var arr=new Uint8Array(bin.length);' +
      'for(var i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);' +
      'var f=new File([arr],' + JSON.stringify(name) + ',{type:"video/mp4"});' +
      'var dt=new DataTransfer();dt.items.add(f);' +
      'var d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"files");' +
      'if(d&&d.set){d.set.call(input,dt.files)}else{input.files=dt.files}' +
      'input.dispatchEvent(new Event("change",{bubbles:true}));' +
      'var r=up.getBoundingClientRect();' +
      'var pb=[].slice.call(host.shadowRoot.querySelectorAll("button")).some(function(b){return (b.innerText||"").indexOf("发表")>=0});' +
      'return {ok:true,w:Math.round(r.width),h:Math.round(r.height),n:f.size,publishBtnAfter:pb};' +
    '})()'
    try {
      const r = await Promise.race([
        win.webContents.executeJavaScript(expr, true),
        new Promise(function (_res, rej) { setTimeout(function () { rej(new Error('wujie-upload timeout 20s')) }, 20000) })
      ])
      log.info('RpaView', 'wujie-upload: ' + JSON.stringify(r))
      if (r && r.publishBtnAfter === true) { this._uploadConfirmed = true; log.info('RpaView', 'wujie-upload: publishBtnAfter=true -> upload confirmed by page') }
      return !!(r && r.ok)
    } catch (eW) {
      log.warn('RpaView', 'wujie-upload failed: ' + (eW && eW.message ? eW.message.slice(0,120) : ''))
      return false
    }
  },

  async _dropViaCdp (win, filePath, selector) {
    // 一次性问清：本页有哪些 shadow host（上传区必挂在其中之一）
    try {
      const _hosts = await win.webContents.executeJavaScript("(function(){var out=[];var all=document.querySelectorAll('*');for(var i=0;i<all.length&&out.length<12;i++){var e=all[i];if(e.shadowRoot){out.push((e.tagName||'')+'.'+String(e.className||'').slice(0,40)+'#'+(e.id||''))}}return out})()", true)
      log.info('RpaView', 'shadow-hosts: ' + JSON.stringify(_hosts))
    } catch (_eH) { log.warn('RpaView', 'shadow-hosts probe failed') }
    // wujie-first restored（2026-10-24 01:04 实测 ok:true, n=255745）：竞品选择器在本页有效。
    try { if (await this._uploadViaWujie(win, filePath)) { log.info('RpaView', 'cdp-drop: wujie-first ok'); return true } } catch (_eWf) {}
    const path = require('path')
    const dbg = win.webContents.debugger
    let attached = false
    try {
      if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true }
      await dbg.sendCommand('DOM.enable')
      // pierce: true —— 视频号发布页的上传区在 iframe(micro/content/post/create) 内，主文档查不到。
      const doc = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true })
      // 文字锚点（2026-10-23 截图）：上传区里有「上传时长8小时内…」/「添加视频」，比类名稳。
      let useSel = selector
      try {
        const marked = await win.webContents.executeJavaScript('(function(){var a=[].slice.call(document.querySelectorAll("div,section"));for(var i=0;i<a.length;i++){var t=a[i].innerText||"";if(t.indexOf("上传时长")>=0||t.indexOf("添加视频")>=0||t.indexOf("点击上传")>=0){a[i].setAttribute("data-mp-drop","1");return "marked"}}return "none"})()', true)
        if (marked === 'marked') useSel = '[data-mp-drop="1"]'
      } catch (_e12) { /* 锚点失败沿用原选择器 */ }
      let q = await dbg.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: useSel })
      // frameId fallback：pierce 对 iframe 不一定生效，改按 frameId 逐帧查。
      if(!q || !q.nodeId){
        try {
          const ft = await dbg.sendCommand('Page.getFrameTree')
          const flat = []
          const walk = (n) => { if(!n) return; flat.push(n.frame); if(n.childFrames) n.childFrames.forEach(walk) }
          walk(ft.frameTree)
          for(const f of flat){
            if(!f || !f.id) continue
            try {
              const fd = await dbg.sendCommand('DOM.getDocument', { depth: -1, frameId: f.id })
              const fq = await dbg.sendCommand('DOM.querySelector', { nodeId: fd.root.nodeId, selector: useSel })
              if(fq && fq.nodeId){ q = fq; log.info('RpaView', 'cdp-drop: hit in frame ' + String(f.url||'').slice(0,80)); break }
            } catch (_e14) { /* 该帧不可查，继续 */ }
          }
        } catch (_e15) { /* 无 frame tree，沿用 pierce 结果 */ }
      }
      if (!q || !q.nodeId) { log.warn('RpaView', 'cdp-drop: target not found ' + selector); return false }
      // boxModelPrimary：穿透 iframe 后的节点只能用 CDP 取几何；JS 的 document.querySelector 在
      // 主文档执行，查不到 iframe 内的元素。取不到时回落到视口中心。
      let x = 400, y = 300, rect = null
      try {
        const box = await dbg.sendCommand('DOM.getBoxModel', { nodeId: q.nodeId })
        const c = box && box.model && box.model.content
        if (c && c.length >= 8) {
          x = Math.round((c[0] + c[2] + c[4] + c[6]) / 4)
          y = Math.round((c[1] + c[3] + c[5] + c[7]) / 4)
          rect = { via: 'boxModel', x, y }
        }
      } catch (_e13) { /* 回落视口中心 */ }
      log.info('RpaView', 'cdp-drop: target rect ' + JSON.stringify(rect) + ' -> (' + x + ',' + y + ')')
      // 2026-10-23：CDP 报 `Invalid parameters` —— dragData.items 不能是空数组，
      // 必须至少一项；文件本体走 files（绝对路径）。
      const _abs = path.resolve(filePath)
      // minimalDragData：CDP 对 title/baseURL 的空串敏感，只保留必需字段。
      const data = {
        items: [{ mimeType: 'text/plain', data: '' }],
        files: [_abs],
        dragOperationsMask: 1
      }
      for (const type of ['dragEnter', 'dragOver', 'drop']) {
        await dbg.sendCommand('Input.dispatchDragEvent', { type, x, y, data })
      }
      log.info('RpaView', 'cdp-drop: dispatched ' + path.basename(filePath) + ' -> ' + selector)
      return true
    } catch (e) { log.warn('RpaView', 'cdp-drop failed: ' + e.message); return false }
    finally { if (attached) { try { dbg.detach() } catch (_) { /* ignore */ } } }
  },

}

module.exports = { uploadWaiterMixin, readVideoFileBytes }
