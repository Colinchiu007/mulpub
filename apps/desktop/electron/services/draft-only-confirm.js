// @ts-check
/**
 * draft-only-confirm.js — `draftOnly` 的**全部判定**：小红书图文草稿的「硬证据」确认链
 * （xhs-draft-only-hard-evidence，2026-10-15）＋其它平台（头条定时）的既有行为保留。
 *
 * 入口是 `resolveDraftOnly(host, win, ctx)`：小红书走硬证据链，其它平台走
 * `runLegacyDraftOnly`（原实现在 `rpa-view-platforms.js` 的 draftOnly 分支里）。
 * 两者都先过同一道内容闸 `contentGate`。
 *
 * 文件名不带 `xhs-`：它承载**整个 draftOnly 判定**（含非小红书分支），首版只装小红书链时
 * 叫 `xhs-draft-confirm.js`，非小红书分支搬进来后名实不符，故随同改名。
 *
 * ## 修的是什么
 *
 * 真机现场（2026-10-15）报「发布成功」但平台草稿箱**没有新增**：判据是**页面文本正则**
 * （匹配 `body.innerText` 的「已保存／保存成功／自动保存／编辑于…」），命中的是页面
 * **常驻静态文案**、与本次是否落库无关。2026-10-07 的收紧只改了字符形状，没改变本质。
 * 完整时间线与取证见 PRD `01-docs/PRD-XHS-DRAFT-ONLY-HARD-EVIDENCE-2026-10-15.md` §1。
 * 为什么单独成模块：`rpa-view-platforms.js` 是逐文件行数门禁的**点名还账**文件
 * （零增长容差），确认链直接写在那里会触债务熔断（`TARGET_GREW`）。
 *
 * ## 判据：能单独确认成功的只有 ①②
 *
 * - ① 草稿箱计数**增量**（主判据）：**写入内容之前**读基线 N，点存草稿后等计数 > N。
 *   等待条件是「增量本身」，不是「节点出现」。
 * - ② 保存接口**成功响应**（次判据）：URL 命中**窄路径**端点表 **且** `statusCode === 200`。
 *   两个条件缺一不可；监听必须在**点击之前**挂上。
 * - ③ 草稿箱整页重载后的**计数增量**复核（兜底，前两条都不可达才跑）。
 *   它**不新增确认权**：标题命中只作辅助证据上报。
 *
 * 三条全不可达 ⇒ `draftSaved:false`，由调用方 fail-closed 报失败。
 *
 * ## 三条「假成功同形」红线（CCG 跨家族评审在首版修复上抓到 1 Critical）
 *
 * 1. **端点表必须是专属窄路径**。拿「草稿」「保存」这类短词做子串匹配会命中发布页
 *    **自身**的草稿列表查询与埋点 —— 主判据超时期间任意无关 200 都会被读成本次落库，
 *    与原生缺陷**完全同形**。取值直接对齐 Python 侧已真机确认的
 *    `DRAFT_SAVE_RESPONSE_PATTERNS = ["/web_api/sns/v2/note"]`，不自行猜测。
 * 2. **必须显式校验 `statusCode === 200`**。本仓 `_waitForResponse` 的超时兜底分支
 *    （`rpa-view-helpers.js` 的 `fallbackTimer`）会把**非 200** 的命中也 resolve 出来，
 *    所以「resolve 非空」**不等于**「落库成功」；非 200 只记 warning。
 * 3. **标题匹配不得单独确认成功**。它是精确匹配，历史同名草稿会误命中 ⇒ 会把
 *    「计数没涨（很可能真没保存）」翻案成成功。故确认权归计数增量，标题只作辅助证据，
 *    并写进失败文案让用户看得懂为什么报失败。
 *    （此处与 Python 侧**有意分歧**：`recheck_draft_box` 允许标题命中单独返回 True。
 *    收紧理由是风险不对称：误报成功**静默丢数据**，误报失败用户**可重试**。）
 *
 * ## 不变量
 *
 * - 基线读不到（`null`）**不得拿 0 顶替**——「没拿到基线」不是「没增长」的证据；
 * - 基线必须在**写入内容之前**读（平台在填写阶段会自动保存，晚读会把本次草稿吃进基线
 *   ⇒ 主判据恒不增长）；
 * - 单次探测异常保持上一读数继续轮询，不把「读数坏掉」当「没增长」；
 * - 回查抛错 fail-closed 但留 warning——「为什么没确认」必须能在日志里查到。
 */

const log = require('./logger')

// 保存接口的**专属路径**模式（红线 1）。取值有据可查：Python 侧同轨常量
// `xiaohongshu_selectors.py` 的 `DRAFT_SAVE_RESPONSE_PATTERNS`，其注释记载该端点经
// 真机确认——页内自动保存/存草稿与笔记提交走**同一个端点**，成功回包
// {code:0, data:{note_id, draft_id}}。
const SAVE_RESPONSE_PATTERNS = ['/web_api/sns/v2/note']

// 草稿箱计数节点。活体取证 2026-10-08 实测为 `SPAN.draft-title`，文本形如「草稿箱(1)」，
// 与 Python 侧 DRAFT_BOX_COUNTER_SELECTOR 同源。Electron 侧 platforms 配置里**没有**
// draft_box_counter 这一项，所以这就是实际生效值；仍先读配置是为了平台改版时能不改码救急
// （配置若给数组则取首个——`querySelectorAll` 不接受数组，喂进去会静默查不到，
// 把「选择器形态错」伪装成「节点不存在」）。
const COUNTER_SEL = '.draft-title'

// ① 主判据的等待上限：等「计数增量」本身（与 Python 侧 CONFIRM_TIMEOUT_S=20 对齐）。
const CONFIRM_TIMEOUT_MS = 20000
// ② 次判据的监听窗口：必须覆盖「点击存草稿 → 平台落库」这段，且要盖过①的等待
// （①跑完再 await 它，若窗口短于①就会在自己还在等的时候就超时收摊）。
const SAVE_RESPONSE_TIMEOUT_MS = 30000
// ③ 兜底复核：整页 goto 贵，窗口短、只跑一次。
const RECHECK_TIMEOUT_MS = 8000
const RECHECK_INTERVAL_MS = 1500
const POLL_INTERVAL_MS = 1500

/**
 * 计数选择器取值归一化：配置优先，数组取首个，否则回落常量。
 * @param {any} configured 平台配置里的 draft_box_counter
 * @returns {string}
 */
function resolveCounterSel (configured) {
  if (Array.isArray(configured)) return String(configured[0] || COUNTER_SEL)
  return configured ? String(configured) : COUNTER_SEL
}

/**
 * 读「草稿箱(N)」计数。
 *
 * 读不到节点、或节点文本不含计数，一律返回 `null`：基线未知时调用方**不得**凭
 * 「看着像 0」报成功，也不得拿 0 顶替。逐元素判可见（`offsetParent`）以避开 SPA
 * 常驻隐藏模板。括号与空格是**显示格式不是协议**（半角/全角都收），免得平台换个
 * 括号就把唯一确认通道整个押在字符形状上。
 *
 * @param {{webContents: any}} win
 * @param {string} counterSel
 * @returns {Promise<number|null>}
 */
async function readDraftBoxCounter (win, counterSel) {
  try {
    const raw = await win.webContents.executeJavaScript(
      '(function(){var sel=' + JSON.stringify(counterSel || COUNTER_SEL) + ';' +
      'var els=document.querySelectorAll(sel);var texts=[];' +
      'for(var i=0;i<els.length;i++){var e=els[i];if(e.offsetParent){var t=(e.innerText||e.textContent||"").trim();if(t)texts.push(t)}}' +
      'return JSON.stringify(texts.slice(0,3))})()')
    const texts = JSON.parse(raw || '[]')
    for (const t of texts) {
      const m = /草稿箱\s*[（(]\s*(\d+)\s*[）)]/.exec(t)
      if (m) return parseInt(m[1], 10)
    }
    if (texts.length > 0) {
      log.info('RpaView', '[xiaohongshu] 草稿箱计数节点可见但文本解析不出计数（sel=' + counterSel +
        '，收到 ' + texts.length + ' 条文本）——显示形态可能已漂移')
    }
    return null
  } catch (e) {
    log.info('RpaView', '[xiaohongshu] 草稿箱计数探测异常: ' + ((e && e.message) || e))
    return null
  }
}

/**
 * 等计数**增量**（等待条件是增量本身，不是「节点出现」）。
 *
 * `baseline` 为 null 时直接返回 false——「没拿到基线」不是「没增长」的证据，
 * 也不得拿 0 顶替。单次探测异常保持上一读数继续轮询，不中断、不抹平。
 *
 * @param {{_sleep: (ms: number) => Promise<any>}} host
 * @param {number|null|undefined} baseline
 * @returns {Promise<boolean>} 是否观察到计数变大
 */
async function waitForDraftBoxIncrement (host, win, counterSel, baseline, timeoutMs, intervalMs) {
  if (baseline === null || baseline === undefined) return false
  const deadline = Date.now() + (timeoutMs || CONFIRM_TIMEOUT_MS)
  let now = baseline
  while (Date.now() < deadline) {
    await host._sleep(intervalMs || POLL_INTERVAL_MS)
    let read = null
    try { read = await readDraftBoxCounter(win, counterSel) } catch (_) { /* 保持 null：读数坏掉不等于没增长 */ }
    if (read !== null && read !== undefined) {
      now = read
      if (now > baseline) return true
    }
  }
  log.info('RpaView', '[xiaohongshu] 草稿箱计数未增长（baseline=' + baseline + ' → now=' + now + '），退到下一通道')
  return false
}

/**
 * 兜底通道：整页重载草稿箱后复核。贵，只在①②都不可达时跑一次。
 *
 * 返回 `{ increment, titleSeen }` 两条**分开**的事实，由调用方决定怎么用：
 * - `increment`：重载后重新读计数，观察到比 baseline 变大。它是**确认权来源**——
 *   与①同一判据，只是在「新加载的页面」上再读一次，覆盖①遇到的一次性读失败。
 * - `titleSeen`：列表里见到同名条目，**只作辅助证据**（红线 3）。
 *
 * URL 由调用方按 `config.publish_url` 单一真源传入（草稿箱入口与发布页同 URL，
 * 见 `xiaohongshu_selectors.py` 的 DRAFT_BOX_URL）；硬编码域名会绕开平台配置，
 * 与 ops-base-single-src 刚收敛的「平台地址单一真源」原则冲突。导航优先走
 * `host._navigateAndWait`（等 did-finish-load + 稳定），不用裸 loadURL——后者只等到
 * 「导航开始」，轮询窗口可能整个落在还没渲染的空白页上。
 *
 * @returns {Promise<{increment: boolean, titleSeen: boolean}>}
 */
async function recheckDraftBox (host, win, title, baseline, counterSel, boxUrl, timeoutMs, intervalMs) {
  const out = { increment: false, titleSeen: false }
  try {
    if (typeof host._navigateAndWait === 'function') {
      await host._navigateAndWait(win, boxUrl, 1500)
    } else {
      await win.webContents.loadURL(boxUrl)
    }
  } catch (e) {
    log.warn('RpaView', '[xiaohongshu] 草稿箱回查异常（整页重载失败），按未确认处理: ' + ((e && e.message) || e))
    return out
  }
  const deadline = Date.now() + (timeoutMs || RECHECK_TIMEOUT_MS)
  // 「草稿箱真的渲染出来了」的存在性前提（CCG 深度评审 i7）：标题探针用的宽泛后代选择器
  // `[class*="draft"] [class*="title"]` 在编辑区/提示里也可能命中，一旦误命中会把失败文案
  // 切成「见到了同名条目」，误导用户该做什么。所以先要求计数节点可读，再采信标题命中。
  let counterReadable = false
  while (Date.now() < deadline) {
    await host._sleep(intervalMs || RECHECK_INTERVAL_MS)
    // 每轮都读计数：既供「增量」确认权，也充当上面的存在性前提
    let read = null
    try { read = await readDraftBoxCounter(win, counterSel) } catch (_) { /* 保持 null：读数坏掉不等于没增长 */ }
    if (read !== null && read !== undefined) {
      counterReadable = true
      if (!out.increment && baseline !== null && baseline !== undefined && read > baseline) out.increment = true
    }
    // 辅助证据：列表里的同名条目（**不给确认权**，且需存在性前提）
    if (!out.titleSeen && title && counterReadable) {
      try {
        out.titleSeen = Boolean(await win.webContents.executeJavaScript(
          '(function(){var want=' + JSON.stringify(String(title)) + ';' +
          'var els=document.querySelectorAll(\'[class*="draft"] [class*="title"],[class*="draft-title"]\');' +
          'for(var i=0;i<els.length;i++){var e=els[i];if(!e.offsetParent)continue;' +
          'var t=(e.innerText||e.textContent||"").trim();if(t&&t===want)return true}return false})()'))
      } catch (_) { /* 单次探测失败继续轮询 */ }
    }
    if (out.increment) break
  }
  if (!out.increment) {
    log.info('RpaView', '[xiaohongshu] 草稿箱重载复核未获计数增量（baseline=' + String(baseline) + '）' +
      (out.titleSeen ? '；列表见到同名条目，但仅作辅助证据、不作确认权' : ''))
  }
  return out
}

/**
 * ② 的监听必须挂在这里、而不是 confirmDraftSaved 里：`_waitForResponse` 只监听
 * **注册之后**完成的响应、不回放历史，挂在点击之后就必然错过真正的保存响应
 * （CCG 深度评审 i2）。故调用方在**点击之前**调用本函数拿到 promise，点击后把
 * promise 交给 `confirmDraftSaved` 兑现。
 *
 * @returns {Promise<any>|null} 监听 promise（不成立时返回 null ⇒ ②通道不启用）
 */
function mountSaveResponseWatch (host, win) {
  if (!SAVE_RESPONSE_PATTERNS.length || typeof host._waitForResponse !== 'function') return null
  return host._waitForResponse(win, SAVE_RESPONSE_PATTERNS, SAVE_RESPONSE_TIMEOUT_MS).catch(() => null)
}

/**
 * 跑完确认链，返回判定结果（不构造返回值、不写业务文案——那些留在调用方）。
 *
 * @param {object} host RpaViewManager 混入对象（`_sleep` / `_navigateAndWait`）
 * @param {object} win
 * @param {{ title?: string, baseline: number|null, counterSel: string, boxUrl: string, saveRespPromise: Promise<any>|null }} opts
 * @returns {Promise<{ draftSaved: boolean, evidence: string, baseline: number|null, titleSeen: boolean }>}
 */
async function confirmDraftSaved (host, win, opts) {
  const { title, baseline, counterSel, boxUrl } = opts || {}
  const saveRespPromise = opts && opts.saveRespPromise

  // ① 主判据：等计数增量（等待条件是「增量本身」，不是「节点出现」）
  const counterConfirmed = (baseline === null || baseline === undefined)
    ? false
    : await waitForDraftBoxIncrement(host, win, counterSel, baseline, CONFIRM_TIMEOUT_MS, POLL_INTERVAL_MS)

  // ② 次判据：保存接口的成功响应。两个条件缺一不可——URL 命中窄路径端点表（红线 1）
  // 且 HTTP 200（红线 2）。
  // 返回形状**已对着真实 helper 核过**（不靠桩互证）：`rpa-view-helpers.js` 的
  // `_waitForResponseExclusive` 成功路径 resolve `{url, statusCode, matchedUrls}`（平铺）。
  // 回归锁：xhs-draft-only-hard-evidence.test.js 的 H10 断言该 helper 的这一行仍在。
  let responseConfirmed = false
  if (!counterConfirmed && saveRespPromise) {
    try {
      const resp = await saveRespPromise
      if (resp && resp.statusCode === 200) {
        responseConfirmed = true
      } else if (resp) {
        log.warn('RpaView', '[xiaohongshu] draft-only: 捕获到保存接口响应但非成功码，不作为落库证据 statusCode=' +
          resp.statusCode + ' url=' + String(resp.url || '').slice(0, 120))
      }
    } catch (_) { /* 监听失败不当判据，继续往下走 */ }
  }

  // ③ 兜底通道（不给标题匹配单独的确认权，红线 3）
  let recheckIncrement = false
  let titleSeen = false
  if (!counterConfirmed && !responseConfirmed) {
    const recheck = await recheckDraftBox(host, win, title, baseline, counterSel, boxUrl, RECHECK_TIMEOUT_MS, RECHECK_INTERVAL_MS)
    recheckIncrement = recheck.increment
    titleSeen = recheck.titleSeen
  }

  const draftSaved = counterConfirmed || responseConfirmed || recheckIncrement
  const evidence = counterConfirmed ? 'counter-increment'
    : (responseConfirmed ? 'save-response'
      : (recheckIncrement ? 'counter-increment-after-reload' : 'none'))
  log.info('RpaView', '[xiaohongshu] draft-only done saved=' + Boolean(draftSaved) +
    ' evidence=' + evidence + ' baseline=' + String(baseline) +
    ' titleSeen=' + Boolean(titleSeen) + ' url=' + (win.webContents.getURL() || ''))

  return { draftSaved, evidence, baseline: baseline === undefined ? null : baseline, titleSeen }
}

/** 失败时给用户看的文案（红线 3：两种情形用户该做的事不一样，不能只给一句）。 */
function describeUnconfirmed (titleSeen) {
  return titleSeen
    ? '草稿保存未获确认（草稿列表见到了同名条目，但草稿箱计数没有增量、保存接口也没有成功响应；同名旧草稿会被误认，故不据此判成功），已按失败处理以避免假成功'
    : '草稿保存未获确认（草稿箱计数无增量、保存接口无成功响应、草稿箱重载复核仍无增量），已按失败处理以避免假成功'
}

/**
 * 在**写入任何内容之前**读计数基线，产出确认链要用的上下文。
 *
 * 时机本身就是判据的一部分（不变量 2）：平台在填写阶段就会自动保存，晚读会把本次草稿
 * 吃进基线 ⇒ 主判据恒不增长。故调用方必须在标题/正文填写**之前**调用本函数。
 *
 * **读两次取较大值**（CCG 深度评审 i3）：侧边栏是异步渲染的，只读一次时可能赶在计数
 * 真正挂载/回填之前读到 `草稿箱(0)`——那会把「基线低估」变成**与真机缺陷同形的假成功**：
 * 旧稿把计数从 0 抬到 1，①就判增量成立。取两次的较大值等价于「按更保守（更大）的起点
 * 要求增量」，代价是多一次 DOM 读。
 *
 * 两次都读不到时 `baseline` 为 `null`：**不得拿 0 顶替**（「没拿到基线」不是「没增长」
 * 的证据），确认链会把①直接判为不可用。
 *
 * @param {{ _sleep: (ms: number) => Promise<any> }} host RpaViewManager（本函数只用 host._sleep
 *   拉开两次读之间的间隔）
 * @param {any} sel 平台选择器表
 * @returns {Promise<{counterSel: string, baseline: number|null}>}
 */
async function readBaselineContext (host, win, sel) {
  const counterSel = resolveCounterSel(sel && sel.draft_box_counter)
  const first = await readDraftBoxCounter(win, counterSel)
  let baseline = first
  if (first !== null) {
    // 只在第一次读到数时才复核——第一次就 null 时（大概率还没渲染）再读一次同样会空，
    // 白等一轮没有收益。
    await host._sleep(POLL_INTERVAL_MS)
    const second = await readDraftBoxCounter(win, counterSel)
    if (second !== null) {
      if (second !== first) {
        log.info('RpaView', '[xiaohongshu] draft-only: 基线两次读数不一致（' + first + ' / ' + second +
          '），取较大值作为基线（避免低估算出来的假增量）')
      }
      baseline = Math.max(first, second)
    }
  }
  if (baseline === null) {
    log.warn('RpaView', '[xiaohongshu] draft-only: 草稿箱计数基线读不到（sel=' + counterSel + '），计数增量判据不可用')
  } else {
    log.info('RpaView', '[xiaohongshu] draft-only: 草稿箱计数基线=' + baseline + '（写入内容之前）')
  }
  return { counterSel, baseline }
}

/**
 * 内容写入闸（2026-10-07 的既有修复，本刀只是把它从调用方搬进来，行为不变）：
 * 先判「内容真的写进去了吗」，再谈落库。旧实现无条件 return {success:true}——真机 E2E
 * 实测标题/正文/标签三项全部 not found、页面空白，仍报 success 并写入发布历史。
 * 硬性判据：文章带了标题就必须写进去；带了正文就必须写进去。标签是增强项（不写不致命），
 * 单独记 warn 不阻断。
 *
 * 对**所有** draftOnly 平台都适用（原实现即如此），故单独导出：非小红书平台也要用它。
 *
 * @returns {object|null} 通过返回 null；不通过返回与搬出前逐字段一致的失败返回值
 */
function contentGate (article, fillReport, platform, url) {
  const hardFailures = []
  if (article.title && fillReport.title && fillReport.title.ok === false) hardFailures.push('title: ' + fillReport.title.error)
  if (article.content && fillReport.content && fillReport.content.ok === false) hardFailures.push('content: ' + fillReport.content.error)
  if (fillReport.tags && fillReport.tags.ok === false) {
    log.warn('RpaView', '[' + platform + '] draft: tags not filled (' + fillReport.tags.error + ') — 降级放行（标签为增强项）')
  }
  if (hardFailures.length === 0) return null
  const detail = hardFailures.join(' | ')
  log.error('RpaView', '[' + platform + '] draft-only ABORT: content not filled, refuse to report success -> ' + detail)
  return {
    success: false, platform, draft: true,
    error: '草稿内容未写入页面，已中止（避免假成功）: ' + detail,
    errorCode: 'PUBLISH_DRAFT_CONTENT_NOT_FILLED',
    fillReport,
    url: url || '',
  }
}

/**
 * draftOnly 的**全部判定**：先是「内容到底写进去了没有」这道闸（2026-10-07 假成功修复），
 * 再是硬证据确认链。两者本就是同一条判定链的两段（先确认内容、再确认落库），一起搬到这里。
 *
 * 搬家的直接原因：`rpa-view-platforms.js` 在逐文件行数门禁里是**点名还账**文件（零增长
 * 容差），本刀首版把确认链写在里面，CI 债务熔断检查直接报 `TARGET_GREW`。
 *
 * 返回值与搬出前**逐字段一致**（调用方直接 `return` 它）。
 *
 * @param {object} host RpaViewManager 混入对象（`_click` / `_emitProgress` / `_sleep` / `_navigateAndWait`）
 * @param {{ platform: string, sel: any, article: any, fillReport: any, config: any,
 *           baselineCtx: { counterSel: string, baseline: number|null }|null }} ctx
 */
async function runDraftOnly (host, win, ctx) {
  const { platform, sel, article, fillReport, config } = ctx || {}
  /** @type {any} */
  const baselineCtx = (ctx && ctx.baselineCtx) || {}

  // 内容闸先行（对所有 draftOnly 平台同口径，见 contentGate）
  const gateFailure = contentGate(article, fillReport, platform, win.webContents.getURL())
  if (gateFailure) return gateFailure

  // 分区关系：草稿箱入口就在发布页侧边栏（`DRAFT_BOX_URL` 与发布页同一 URL，见
  // xiaohongshu_selectors.py），故计数读取落在**同一个 RPA 分区、同一个页面**上，
  // 不需要另开窗口；兜底通道的整页 goto 也仍在本分区内（登录态一致、草稿箱内容一致）。
  const counterSel = baselineCtx.counterSel || COUNTER_SEL
  const baseline = baselineCtx.baseline === undefined ? null : baselineCtx.baseline

  host._emitProgress(platform, 'saving draft...', 90)
  // ② 的监听必须在**点击之前**挂上（红线见 mountSaveResponseWatch 注释，评审 i2）。
  const saveRespPromise = mountSaveResponseWatch(host, win)
  // 存草稿入口：平台有显式按钮就点它，**只点一次**；没有则依赖平台自动保存
  // （活体取证 2026-10-08：图文编辑器没有存草稿按钮）。
  if (sel && sel.draft_btn && sel.draft_btn.length > 0) {
    for (const cand of sel.draft_btn) {
      try {
        if (await host._click(win, cand)) { log.info('RpaView', '[' + platform + '] draft button clicked: ' + cand); break }
      } catch (_) { /* 候选失效继续下一个 */ }
    }
  } else {
    log.info('RpaView', '[' + platform + '] draft-only: 未配置存草稿入口，按平台自动保存处理，以草稿箱计数为确认判据')
  }

  const verdict = await confirmDraftSaved(host, win, {
    title: article.title, baseline, counterSel, boxUrl: config && config.publish_url, saveRespPromise,
  })

  if (!verdict.draftSaved) {
    // fail-closed：能单独确认成功的硬证据一条都没拿到 ⇒ 不报成功。内容写进去了但没确认
    // 落库，属于「不确定」，绝不能写成 success（那正是 2026-10-15 假成功的形态）。
    host._emitProgress(platform, 'draft unconfirmed', 100)
    return {
      success: false, platform, draft: true, draftSaved: false,
      error: describeUnconfirmed(verdict.titleSeen),
      errorCode: 'PUBLISH_DRAFT_UNCONFIRMED',
      fillReport,
      url: win.webContents.getURL() || '',
    }
  }
  host._emitProgress(platform, 'draft saved', 100)
  return { success: true, url: win.webContents.getURL() || '', platform, draft: true, draftSaved: true, fillReport, draftEvidence: verdict.evidence }
}

// 非小红书平台沿用至今的「页面文本」判据（原实现在 rpa-view-platforms.js 的 draftOnly
// 分支里，原样搬入，行为不变；见 runLegacyDraftOnly 的注释说明为什么本刀不动它们）。
const LEGACY_CONFIRM_TIMEOUT_MS = 20000
const LEGACY_DRAFT_SAVED_CONDITION = 'function(){var t=(document.body&&document.body.innerText)||"";' +
  'return /编辑于\\s*\\S{1,12}|已保存|保存成功|自动保存/.test(t) && !/编辑于\\s*$/.test(t.trim())}'

/**
 * 非小红书平台 draftOnly 的**既有行为保留**。
 *
 * 头条在带 `publishTime` 时会走这条（`packages/rpa-engine/src/toutiao-direct-bridge.js`
 * 与 `toutiao-schedule-intent.test.js` 都写明「只存草稿、绝不点发布」）。它的判据同样是
 * 「页面文本」——正是本刀在小红书侧认定不成立的那条路。但**本刀只换小红书**：把别的平台
 * 一并切到上面的硬证据链，会让它们的基线恒为 `null`、主判据永久失效，把「本来能报成功的
 * 草稿」变成「恒失败」（CCG 第二轮评审 i2）。它们的判据改造（同样的假成功面）属独立改动，
 * 登记在 PRD §9 与执行记录。
 *
 * 返回值逐字段保留搬出前的语义：`success` 恒 true（内容闸不通过时另说），
 * `draftSaved` 仅作信息位。
 */
async function runLegacyDraftOnly (host, win, ctx) {
  const { platform, article, fillReport } = ctx || {}
  const gateFailure = contentGate(article, fillReport, platform, win.webContents.getURL())
  if (gateFailure) return gateFailure
  const saved = await host._waitForCondition(win, LEGACY_DRAFT_SAVED_CONDITION, LEGACY_CONFIRM_TIMEOUT_MS, POLL_INTERVAL_MS)
  await host._sleep(3000)
  log.info('RpaView', '[' + platform + '] draft-only done saved=' + Boolean(saved) + ' url=' + (win.webContents.getURL() || ''))
  host._emitProgress(platform, 'draft saved', 100)
  return { success: true, url: win.webContents.getURL() || '', platform, draft: true, draftSaved: Boolean(saved), fillReport }
}

/**
 * draftOnly 的**总入口**：按平台分流。
 *
 * 分流放在这里而不是调用方，是为了让 `rpa-view-platforms.js`（逐文件行数门禁的**点名
 * 还账**文件、零增长容差）只留一行委派——它每多一行都在挤压一个已经压线的额度。
 */
async function resolveDraftOnly (host, win, ctx) {
  const platform = ctx && ctx.platform
  return platform === 'xiaohongshu'
    ? runDraftOnly(host, win, ctx)
    : runLegacyDraftOnly(host, win, ctx)
}

module.exports = {
  SAVE_RESPONSE_PATTERNS,
  COUNTER_SEL,
  CONFIRM_TIMEOUT_MS,
  SAVE_RESPONSE_TIMEOUT_MS,
  LEGACY_DRAFT_SAVED_CONDITION,
  resolveCounterSel,
  readDraftBoxCounter,
  waitForDraftBoxIncrement,
  recheckDraftBox,
  mountSaveResponseWatch,
  confirmDraftSaved,
  describeUnconfirmed,
  contentGate,
  readBaselineContext,
  runDraftOnly,
  runLegacyDraftOnly,
  resolveDraftOnly,
}
