// @ts-check
/**
 * toutiao-direct-bridge —— 头条 Node 直连兜底的执行桥（从 rpa-view-platforms 拆出，行数门禁）
 *
 * 职责：cookie 导出（Electron session）→ body 构造（参考产品字段表）→ 页面内 SDK 签名 → Node 直连 POST。
 * 宿主（rpa-view-platforms）只提供 win / article / sign 入口 / log。
 *
 * 背景：DOM 点击被 onClick 闭包门控拦下（PRD §16.8.8，14 项排除定案）；
 * 页面自动保存（source=29）code=0 ⇒ 服务端接受「页面上下文的请求」，
 * 而 Node 侧请求的可用性由本桥真机验证（100005 → cookie 导出修复后待终验）。
 */
'use strict'

const { cookiesFromSession, buildPostData, publishWithSign } = require('./toutiao-direct-publish')
const { formatToutiaoPublishTime } = require('./platform-schedule-time')
const PUBLISH_URL = 'https://mp.toutiao.com/mp/agw/article/publish'
const PUBLISH_QUERY = 'source=mp&type=article&aid=1231&mp_publish_ab_val=0'

/**
 * DOM 流程失败后的兜底发布（也可独立调用）。
 * @param {{win: any, article: {title?: string, content?: string}, sign: Function, log: {info: Function, warn: Function}}} p
 * @returns {Promise<{success: boolean, platform: string, pgcId?: string, error?: string}>}
 */
async function publishDirect ({ win, article, sign, log }) {
  try {
    // ① cookie：从头条页所属 session 导出（含 HttpOnly 登录态；document.cookie 拿不到）
    const session = win.webContents && win.webContents.session
    if (!session) return { success: false, platform: 'toutiao', error: 'NO_SESSION' }
    const cookies = await cookiesFromSession(session)
    if (!cookies) return { success: false, platform: 'toutiao', error: 'NO_COOKIES' }

    // ② 正文转 HTML（纯文本 → <p> 段落；转义先行防注入）
    const html = '<p>' + String(article && article.content || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .split(/\n+/).filter(Boolean).join('</p><p>') + '</p>'

    // ③ 平台侧定时（2026-10-07）
    // 旧实现硬编码「当前 +60 秒」——把平台定时能力当作「绕过 DOM 死锁的手段」，
    // 而不是用户可选的定时模式（当时立即路径被页面 deferred 死锁所迫）。
    // 现改为使用调度器透传的真实用户排期时间：article.publishTime 由
    // shared-utils scheduler 随任务下发，此处直接提交给头条，由其服务器到点发布。
    // 未携带 publishTime（立即发布）时才回退到旧的 +60 秒兜底 —— 因为 Node 直连
    // 路径已验证必须带 timer_status=1（立即路径被页面 deferred 死锁，见本文件历史）。
    let timerTime = ''
    if (article && article.publishTime) {
      // 显式注入时区偏移：平台按其服务器时区解释本地墙钟时间，
      // 依赖运行环境 TZ 会让开发机与生产机产出不同结果。
      timerTime = formatToutiaoPublishTime(article.publishTime, -new Date().getTimezoneOffset())
    } else {
      const d = new Date(Date.now() + 60 * 1000)
      const p2 = (n) => (n < 10 ? '0' : '') + n
      timerTime = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
    }

    // ④ 正文与 body
    //
    // 2026-10-07 真机取证（关键）：从零拼的 body **一律被平台拒**（code=7050「提交失败」，
    // pgc_id=0），30 天与 12 分钟同样被拒 ⇒ 与排期跨度无关，是 body 缺字段。
    // 对照：能成功的「重放页面自动保存 body」那条路，body 里带着页面自己生成的
    // `pgc_id` / `title_id` / `tt-anti-token` 上下文 —— 平台认这些标识。
    // 而 preFill 阶段装的 XHR hook（installToutiaoSaveHook）**已经把那个 body 抓到了**
    // （window.__lastSaveBody），只是直连路径从来没用过它。
    //
    // 修法：以页面捕获的自动保存 body 为基底，只**覆盖**我们真正要改的字段
    // （timer_status / timer_time / save），其余（标识、anti-token、编辑器上下文）
    // 原样保留 —— 那才是平台认的东西。捕获不到时才退回从零构造，并明确标注降级。
    let body = null
    let bodySource = 'page-save-body'
    try {
      const captured = await win.webContents.executeJavaScript(
        '(function(){ return (window.__lastSaveBody || "") })()'
      )
      if (typeof captured === 'string' && captured.length > 500) body = captured
    } catch (_e) { /* 页面可能尚未注入 hook；走下面的降级 */ }

    if (!body) {
      bodySource = 'fallback-built'
      body = buildPostData({
        title: String(article && article.title || ''),
        htmlContent: html,
        covers: [],
        publishTime: timerTime,
      })
    } else {
      // 覆盖定时字段并置 save=1（save=0 实为存草稿，2026-10-03 后台对照定案）
      body = body
        .replace(/(^|&)timer_status=[^&]*/, '$1timer_status=1')
        .replace(/(^|&)timer_time=[^&]*/, '$1timer_time=' + encodeURIComponent(timerTime))
        .replace(/(^|&)save=\d+/, '$1save=1')
      // 页面 body 里可能没有 timer 字段（首次自动保存发生在我们设置之前），补上
      if (!/(^|&)timer_status=/.test(body)) body += '&timer_status=1'
      if (!/(^|&)timer_time=/.test(body)) body += '&timer_time=' + encodeURIComponent(timerTime)
    }

    // ⑤ 签名：页面内 SDK 按同一 (url, query, body) 产出 a_bogus
    const signResult = await sign('toutiao_sdk', { url: PUBLISH_URL, query: PUBLISH_QUERY, body }, { win })
    if (!signResult.ok || !signResult.signature) {
      log.warn('RpaView', '[toutiao-direct] 签名失败 via=' + signResult.via + ' reason=' + (signResult.reason || ''))
      return { success: false, platform: 'toutiao', error: 'SIGN_FAILED' }
    }

    // ⑤ Node 直连（参考产品同构：页面内 fetch 的上下文标记会被服务端拒绝 ⇒ 必须 Node 侧发）
    const res = await publishWithSign({ cookies, body, aBogus: signResult.signature })
    log.info('RpaView', '[toutiao-direct] status=' + res.status + ' code=' + res.code + ' msg=' + res.message + ' pgcId=' + res.pgcId)
    if (res.code === 0 && res.pgcId && res.pgcId !== '0') {
      // scheduled=true 表示本次提交携带了 timer_status/timer_time（平台侧定时已受理）
      return { success: true, platform: 'toutiao', pgcId: res.pgcId, scheduled: true }
    }
    // 2026-10-07 真机取证：平台只给一个泛化的 code+message（code=7050「提交失败」），
    // 无法区分「签名失效 / 参数缺字段 / 排期不被接受 / 频率限制」——这四类的修法完全不同。
    // 这里把**原始报文**与本次提交的排期字段落到日志里，否则每次都要重新复现才能猜。
    // 只记字段名与时间值，不记正文与 cookie。
    log.warn('RpaView', '[toutiao-direct] rejected code=' + res.code +
      ' timerTime=' + timerTime + ' bodySource=' + bodySource +
      ' bodyKeys=' + body.split('&').map((kv) => kv.split('=')[0]).join(',') +
      ' raw=' + String(res.raw || '').slice(0, 400))
    return { success: false, platform: 'toutiao', error: 'API_REJECTED:' + res.code + ':' + (res.message || '').slice(0, 60) }
  } catch (e) {
    log.warn('RpaView', '[toutiao-direct] 异常: ' + (e && e.message))
    return { success: false, platform: 'toutiao', error: 'DIRECT_THREW:' + String(e && e.message).slice(0, 60) }
  }
}

/**
 * 一站式入口：DOM 结果失败（verification timeout）时自动切 Node 直连。
 * @param {{win: any, article: {title?: string, content?: string}, domResult: {success?: boolean, error?: string}, sign: Function, log: {info: Function, warn: Function}}} p
 */
async function publishToutiaoWithFallback (p) {
  const domResult = p.domResult
  if (!domResult || domResult.success !== false || !/verification timeout/.test(String(domResult.error || ''))) {
    return domResult
  }
  p.log.warn('RpaView', '[toutiao] DOM verification timeout → Node 直连兜底')
  const direct = await publishDirect(p)
  if (direct.success) return direct
  p.log.warn('RpaView', '[toutiao-direct] 兜底未成功: ' + (direct.error || ''))
  return domResult
}

/**
 * 头条发布完整流程（从 rpa-view-platforms 外移，行数门禁）：
 * DOM 流程（host._publish_generic）失败且为 verification timeout 时，自动切 Node 直连兜底。
 * @param {{win: any, article: any, host: any, sign: Function, log: any, getPublishUrl: Function, stripHtml: Function}} p
 * @returns {Promise<{success: boolean, platform?: string, pgcId?: string, error?: string}>}
 */
async function publishToutiao (p) {
  const { win, article, host, log, getPublishUrl, stripHtml } = p
  const config = host._getPlatformConfig('toutiao')
  const contentType = article.video_path ? 'video' : 'image'
  const publishUrl = getPublishUrl('toutiao', contentType)
  // ProseMirror 走纯文本通道；Quill 草稿会把 HTML 规范化为 <p>，
  // 不剥离会让 <p> 以字面量出现在文章正文（真机 verify snapshot 实证）。
  const plainContent = stripHtml(article && article.content)

  // 2026-10-07 P0（真机 E2E 抓出，PR #3033）：带 publishTime 时，任何**不携带
  // timer_status/timer_time** 的路径都不得被当作成功。头条发布页的定时控件从未
  // 被 RPA 驱动，因此下面两条路径的语义都是「立即发布」：
  //   ① _publish_generic 点「发布」按钮（draftOnly=false）
  //   ② publishViaPageXhr 重放页面**自动保存** body（只把 save 0→1）
  // 真机事实：把排期设到 7 天后，走的正是 ② —— 平台返回 code=0「提交成功」
  // 与一个真实 pgcId，本地记录 status=executed、发布记录时间=当下，
  // 而内容**已经被立即发出**。这正是本次改造要消灭的「以为已排期、实际已发出」，
  // 且它躲过了上一次修复：那次只在「DOM 成功」分支前加了守卫，
  // 而 ② 的早退恰好在守卫**之前**，于是定时意图被静默吞掉。
  //
  // 修法（防患优先，不做事后检测）：带定时意图时
  //   · DOM 走 draftOnly —— 只存草稿，绝不点发布（从源头掐掉 ①）；
  //   · 跳过 XHR 重放兜底 —— 它重放的自动保存 body 里没有 timer 字段（掐掉 ②）；
  //   · 唯一出口是 Node 直连（publishDirect 是唯一会提交 timer_status/timer_time 的路径）；
  //   · 直连失败即 fail-closed，绝不回退到任何会立即发布的路径。
  const scheduled = Boolean(article && article.publishTime)

  const domResult = await host._publish_generic(win, { ...article, content: plainContent }, 'toutiao', {
    ...config,
    publish_url: publishUrl || config.publish_url,
    // 「展示封面」必填且默认「单图」但封面为空（真机取证）⇒ 传入封面图；第 52 轮实验证实封面非阻塞点
    prePublishHook: 'uploadCover',
    hookContext: { coverPath: (article.images && article.images[0]) || article.cover_path || null },
    // 2026-10-03 ⭐ preFill：编辑器加载完成后立刻装 XHR hook（比兜底时重装早整个发布周期，
    // 捕获填充触发的所有自动保存请求；兜底时 body 早已在手，不再受 60s 后页面关闭影响）
    preFill: 'installToutiaoSaveHook',
    // 带定时意图 ⇒ DOM 只落草稿，不点发布（见上方 P0 说明）
    ...(scheduled ? { draftOnly: true } : {}),
  })

  if (scheduled) {
    log.warn('RpaView', '[toutiao] 带定时意图：DOM 仅存草稿、跳过 XHR 重放，强制走 Node 直连提交排期')
    const direct = await publishDirect({ win, article: { ...article, content: plainContent }, sign: p.sign, log })
    if (direct.success) return { ...direct, scheduled: true }
    // fail-closed：直连失败即失败，不回退（回退 = 立即发布 = 用户以为已排期而内容已发出）
    log.warn('RpaView', '[toutiao] 定时直连失败，不允许回退到立即发布路径: ' + (direct.error || ''))
    return { ...direct, success: false, error: direct.error || 'SCHEDULE_SUBMIT_FAILED' }
  }

  // 2026-10-03 ⭐ 兜底（在 DOM 流程【之后】执行——页面此时已填充、未关闭）：
  // 1) 重装 XHR hook（导航已重置上下文，之前装的必失效）
  // 2) 微调标题触发页面自动保存 ⇒ 页面自己发 save=1 publish 请求 ⇒ hook 捕获
  // 3) 用捕获的 body 原样重放（改 save=1 保持），即完成真发布
  // ⚠️ 本兜底会立即发布，仅在**无定时意图**时可达（上方 scheduled 分支已 fail-closed 截断）。
  if (domResult && domResult.success === false && /verification timeout/.test(String(domResult.error || ''))) {
    log.warn('RpaView', '[toutiao] DOM verification timeout → 页面 XHR 重放兜底')
    const xhrResult = await publishViaPageXhr({ win, title: article && article.title, log })
    if (xhrResult.success) return xhrResult
  }

  return publishToutiaoWithFallback({ win, article: { ...article, content: plainContent }, domResult, sign: p.sign, log })
}

/**
 * 构造「触发自动保存」的标题扰动脚本（字符串，在页面上下文执行）。
 *
 * ⚠️ 2026-10-15 真机事故（BUGFIX-TOUTIAO-TITLE-SUFFIX-2026-10-15）：
 * 旧实现把标题改成 `原标题.slice(0,26) + ' ' + Date.now().toString().slice(-4)`
 * 后**从不还原**，页面据此自动保存，重放 body 的 `title=` 就带着这串数字
 * （用户标题「DeepSeek崩了」→ 头条号上变成「DeepSeek崩了 1935」，
 * 1935 = 当时的 epoch 毫秒数后 4 位）。根因是**把「触发手段」当成了「发布内容」**。
 *
 * 新契约（三条不可破）：
 *   ① 扰动值 = 原标题 + 一个零宽空格（U+200B）—— React 能感知差异（触发自动保存），
 *      但零宽字符**不可见**，即便保存请求抢跑也不会把可见数字漏进标题；
 *      同时不对原标题做任何截断（旧 slice(0,26) 会把长标题砍短）。
 *   ② 派发 input 后**立即还原为原标题**，再派发第二次 input ⇒ React 的
 *      最后一次 onChange 携带的是正确标题（自动保存发出正确内容）。
 *   ③ 扰动脚本内绝不出现 `Date.now` / 取后 N 位 / 对标题值做 slice 这类会把
 *      时钟或截断漏进用户内容的写法（结构锁见 tests/toutiao-title-no-pollution.test.js D 组）。
 *
 * @returns {string} 页面上下文执行的 IIFE 源码；返回值 RESTORED / NO_TITLE
 */
function buildTitleBumpScript () {
  return `(function(){
    var ta=[...document.querySelectorAll('textarea,input')].find(function(e){return /标题/.test(e.placeholder||'')})
    if(!ta) return 'NO_TITLE'
    var s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set
    // ① 先记下原值（扰动前的真实标题，之后原样写回，一个字符都不改）
    var orig=String(ta.value||'')
    // ② 扰动：追加零宽空格（不可见，且与原值不同 ⇒ React 感知变化 → 触发自动保存）
    s.call(ta, orig+'\\u200b')
    ta.dispatchEvent(new Event('input',{bubbles:true}))
    // ③ 还原：写回第 ① 步记下的原值，再派发一次 input ⇒ React 的
    //    最后一次 onChange 携带正确标题（自动保存发出正确内容）
    s.call(ta, orig)
    ta.dispatchEvent(new Event('input',{bubbles:true}))
    return 'RESTORED'
  })()`
}

/**
 * 兜底覆盖 body 里的 `title=` 字段（防保存请求抢跑）。
 *
 * 为什么需要它：扰动脚本虽已还原标题，但页面 React 的自动保存是**异步**的 ——
 * 若保存请求在还原前就发出，hook 捕获到的 `__lastSaveBody` 仍带扰动值。
 * 本函数在重放前把 `title=` 强制改为正确标题，是「不污染」的最后一道闸。
 *
 * 判据口径：`title=` 必须**紧跟等号**（`(^|&)title=`），故不会误伤
 * `title_id=` 这类邻键（本仓 2026-10-15 真机事故的 body 里同时存在二者）。
 * 无 `title=` 字段时追加到末尾；空标题不覆盖（fail-safe：不拿空值破坏
 * 页面已生成的标题，宁可保留原值也不发布空标题）。
 *
 * @param {string} body form-urlencoded 请求体
 * @param {string} title 正确标题
 * @returns {string} 覆盖后的请求体
 */
function overrideBodyTitle (body, title) {
  const b = String(body == null ? '' : body)
  const wanted = String(title == null ? '' : title)
  if (!wanted) return b
  const encoded = encodeURIComponent(wanted)
  if (/(^|&)title=/.test(b)) return b.replace(/(^|&)title=[^&]*/, '$1title=' + encoded)
  return b + '&title=' + encoded
}

/**
 * 页面 XHR 真发布（2026-10-03 真机验证：save=1 → code=0「提交成功」，后台作品列表可见）：
 * 在页面上下文里【实时读取编辑器内容】构造 body（含页面自动保存产生的 pgc_id/title_id），
 * save=1（真发布语义；save=0 实为存草稿——2026-10-03 后台对照定案），
 * 用【页面自身的 XMLHttpRequest】同步发出 —— 继承页面全部上下文（SDK 注入的 tt-anti-token 等）。
 * @param {{win: any, title?: string, log: any}} p
 * @returns {Promise<{success: boolean, platform: string, pgcId?: string, error?: string}>}
 */
async function publishViaPageXhr ({ win, title, log }) {
  /** 派发 Ctrl+S（头条保存草稿快捷键；走 CDP 真实键盘事件） */
  async function tcDispatchCtrlS (win) {
    try {
      const dbg = win.webContents.debugger
      try { await dbg.attach('1.3') } catch (_) { /* 已附加 */ }
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, windowsVirtualKeyCode: 83, code: 'KeyS' })
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, windowsVirtualKeyCode: 83, code: 'KeyS' })
    } catch (_e) { /* 忽略 */ }
  }
  try {
    // hook 必须在页面加载后重装（每次导航重置 JS 上下文）；再触发一次 input 促发自动保存
    const setup = `(function(){
      window.__lastSaveBody=''; window.__titleId=''
      var oo=XMLHttpRequest.prototype.open, os=XMLHttpRequest.prototype.send
      XMLHttpRequest.prototype.open=function(m,u){this.__u=String(u);return oo.apply(this,arguments)}
      XMLHttpRequest.prototype.send=function(b){
        try{ var u=this.__u||''
          if(u.indexOf('article/publish')>=0&&b){
            var tb=String(b).match(/title_id=([^&]+)/); if(tb) window.__titleId=tb[1]
            window.__lastSaveBody=String(b)
          }
        }catch(e){}
        return os.apply(this,arguments)
      }
      var ta=[...document.querySelectorAll('textarea,input')].find(function(e){return /标题/.test(e.placeholder||'')})
      if(ta){ var s=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set
        s.call(ta, ta.value); ta.dispatchEvent(new Event('input',{bubbles:true})) }
      return 'SETUP_OK'
    })()`
    await win.webContents.executeJavaScript(setup)
    // ⭐ 复刻诊断脚本成功路径：给标题一个【新值】（React 感知变化 → 触发自动保存）。
    // 应用 RPA 填充后 React state 可能未感知变化（恢复草稿态），从不出保存请求；
    // 而诊断脚本每次填新标题值，2s 内必触发自动保存（多次真机复现）。
    //
    // 2026-10-15 事故修复：扰动值改为「原标题 + 零宽空格」并在同一次脚本内还原，
    // 不再用 `Date.now().toString().slice(-4)` 这类可见数字后缀 —— 旧写法把
    // 发布标题变成了「原标题 1935」（详见 buildTitleBumpScript 的契约说明）。
    await win.webContents.executeJavaScript(buildTitleBumpScript())
    // 等自动保存（最长 12s；诊断脚本实证 2-8s 内必到）
    for (let i = 0; i < 6; i++) {
      if (await win.webContents.executeJavaScript('String(window.__lastSaveBody||"").length>500')) break
      await new Promise((r) => setTimeout(r, 2000))
    }
    // 重放前兜底覆盖 title=：自动保存是异步的，hook 捕获到的 body 可能仍带扰动值
    // （2026-10-15 真机事故的第二道闸，见 overrideBodyTitle 契约）。
    // title 由 Node 侧从 article 透传，页面脚本只做字符串替换（不引入新上下文）。
    const safeTitle = typeof title === 'string' ? title : ''
    const js = `(function(){
      // 原样重放页面自己的自动保存 body（含新鲜 pgc_id/title_id/tt-anti-token 上下文），
      // 仅把 save 改为 1（真发布；save=0 实为存草稿——2026-10-03 后台对照定案）
      var b=window.__lastSaveBody
      if(!b||b.length<500) return JSON.stringify({ok:false,reason:'NO_BODY'})
      var b2=b.replace(/(^|&)save=\\d+/,'$1save=1')
      // title= 兜底覆盖：判据要求 title 后紧跟等号，故不误伤 title_id 邻键。
      // 空标题不覆盖（fail-safe：不拿空值破坏页面已生成的标题）。
      var wantTitle=${JSON.stringify(safeTitle)}
      if(wantTitle){
        var encTitle=encodeURIComponent(wantTitle)
        if(/(^|&)title=/.test(b2)) b2=b2.replace(/(^|&)title=[^&]*/,'$1title='+encTitle)
        else b2=b2+'&title='+encTitle
      }
      var x=new XMLHttpRequest()
      x.open('POST','/mp/agw/article/publish?source=mp&type=article&aid=1231&mp_publish_ab_val=0',false)
      x.setRequestHeader('Content-Type','application/x-www-form-urlencoded;charset=UTF-8')
      x.send(b2)
      try{ var j=JSON.parse(x.responseText); return JSON.stringify({ok:true,code:j.code,msg:j.message,pgc:(j.data&&j.data.pgc_id)||''}) }
      catch(e){ return JSON.stringify({ok:false,reason:'PARSE:'+String(e&&e.message).slice(0,50)}) }
    })()`
    const raw = await win.webContents.executeJavaScript(js)
    const r = JSON.parse(raw)
    log.info('RpaView', '[toutiao-xhr] code=' + r.code + ' msg=' + r.msg + ' pgcId=' + (r.pgc || '') + ' reason=' + (r.reason || '-'))
    if (r.ok && r.code === 0 && r.pgc && r.pgc !== '0') {
      return { success: true, platform: 'toutiao', pgcId: r.pgc }
    }
    return { success: false, platform: 'toutiao', error: 'XHR_REJECTED:' + r.code + ':' + (r.msg || r.reason || '').slice(0, 60) }
  } catch (e) {
    log.warn('RpaView', '[toutiao-xhr] 异常: ' + (e && e.message))
    return { success: false, platform: 'toutiao', error: 'XHR_THREW:' + String(e && e.message).slice(0, 60) }
  }
}

/**
 * 安装 XHR 捕获 hook（由 rpa-view-platforms._execHook 在 preFill 阶段调用）：
 * 在编辑器加载完成后立即挂钩，捕获填充触发的所有 publish 自动保存请求 body。
 * hook 挂在 window.__lastSaveBody；兜底重放时直接读取（无需再等）。
 * @param {{win: any, log: any}} p
 * @returns {Promise<void>}
 */
async function installToutiaoSaveHook ({ win, log }) {
  try {
    const setup = `(function(){
      if(window.__lastSaveBody!==undefined) return 'ALREADY'
      window.__lastSaveBody=''; window.__titleId=''
      var oo=XMLHttpRequest.prototype.open, os=XMLHttpRequest.prototype.send
      XMLHttpRequest.prototype.open=function(m,u){this.__u=String(u);return oo.apply(this,arguments)}
      XMLHttpRequest.prototype.send=function(b){
        try{ var u=this.__u||''
          if(u.indexOf('article/publish')>=0&&b){
            var tb=String(b).match(/title_id=([^&]+)/); if(tb) window.__titleId=tb[1]
            window.__lastSaveBody=String(b)
          }
        }catch(e){}
        return os.apply(this,arguments)
      }
      return 'HOOKED'
    })()`
    await win.webContents.executeJavaScript(setup)
    if (log) log.info('RpaView', '[toutiao] preFill XHR hook 已安装（捕获自动保存 body）')
  } catch (_e) { /* hook 失败不影响 DOM 流程 */ }
}

module.exports = {
  publishDirect, publishToutiaoWithFallback, publishToutiao, installToutiaoSaveHook,
  // 2026-10-15 标题污染修复：扰动脚本与 body title 覆盖的单一实现
  // （tests/toutiao-title-no-pollution.test.js 直接锁这两个导出）
  buildTitleBumpScript, overrideBodyTitle, publishViaPageXhr,
}

