// @ts-check
/**
 * ZhihuFavlist IPC handlers — 知乎收藏夹批量采集/改写
 *
 * 通道：
 *   zhihu-favlist:list          → 收藏夹列表（官方 API）
 *   zhihu-favlist:contents      → 收藏夹内容 URL 列表（分页遍历）
 *   zhihu-favlist:batch-collect → 批量采集（BatchRateController 串行 + 间隔 + 退避）
 *   zhihu-favlist:batch-rewrite  → 批量改写（同上）
 *   zhihu-favlist:cancel        → 取消进行中的批量任务（collect/rewrite/fav-batch）
 *   zhihu-fav-batch:run         → 「采集并改写」编排（2026-10-03：勾选清单条目 →
 *                                 采集 → 图片本地化 → 自动改写 → 进度双边界推送）
 *   zhihu-favlist:unified-contents → 「全部收藏」聚合清单（多夹合并去重 + favTime 降序截断）
 *   zhihu-fav-batch:cancel      → 取消采集并改写任务
 *
 * Access Secret 来源：`services/zhihu-credential`（设置页「设置 → 知乎 API」写入；
 * 旧版全局明文 `zhihu_access_secret` 作为只读兼容保留）。
 */

const ZhihuFavlistService = require('../services/zhihu-favlist-service')
const BatchRateController = require('../services/batch-rate-controller')
const { classifyZhihuUrl, buildUnifiedFavItems, normalizeFavItem } = require('../services/zhihu-fav-core')
const credential = require('../services/zhihu-credential')
// 改写 payload 注入桌面「模型设置」默认 llm（Python /aggregation/rewrite 只读 env 会误报 LLM_KEY_MISSING）
const { applyLlmToBody } = require('../services/llm-runtime-config')

/** 进行中批量任务的取消标记（单例：同类型任务同时只允许一个） */
const activeBatches = { collect: null, rewrite: null, favBatch: null }

/**
 * 勾选条目 → 采集条目 id/createdAt 映射（forceRecollect 覆盖时保留原 id/createdAt）。
 * 模块级：与 activeBatches 同生命周期；上限 5000 条 FIFO 防无限增长。
 */
const knownEntryMeta = new Map()

function genEntryId () {
  return 'fb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
}

function rememberEntryMeta (url, meta) {
  knownEntryMeta.set(url, meta)
  // QM-6 m2：while 循环删除（原 if 只在恰为 5001 时删一次）
  while (knownEntryMeta.size > 5000) {
    const first = knownEntryMeta.keys().next().value
    knownEntryMeta.delete(first)
  }
}

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{
 *   store: { getSetting: (k: string) => any },
 *   urlCollector: { collect: (url: string, opts?: object) => Promise<object> },
 *   pythonBridge: { requestBackend: (m: string, p: string, b?: unknown) => Promise<unknown> },
 *   imageLocalizer?: { localize: (url: string, index?: number) => Promise<string|null> },
 *   log?: { info: Function, warn: Function, error: Function },
 * }} deps
 */
function registerHandlers (ipcMain, deps) {
  const { store, urlCollector, pythonBridge, log, rateControllerFactory, modelProviderManager } = deps
  const logger = log || { info: () => {}, warn: () => {}, error: () => {}, notify: () => {} }
  const svc = new ZhihuFavlistService({ log: logger })
  // rateControllerFactory：测试注入快速控制器（跳过真实 8s 延迟）；生产用默认参数
  const makeController = (opts) => rateControllerFactory
    ? rateControllerFactory(opts)
    : new BatchRateController({ log: logger, ...opts })

  /**
   * 读取用户配置的知乎 Access Secret。
   *
   * 单一真源：`services/zhihu-credential`（与设置页写配置同一实现）。解析优先级为
   * 「本用户 safeStorage 加密配置 > 旧版全局明文」，因此历史版本里在采集页粘贴过的
   * 明文密钥升级后仍然可用，同时新保存的走密文、按登录身份隔离。
   */
  function getAccessSecret () {
    return credential.resolveSecret(store).secret
  }

  ipcMain.handle('zhihu-favlist:list', async () => {
    try {
      const secret = getAccessSecret()
      const r = await svc.listFavlists(secret)
      if (!r.success) return { code: -1, message: r.error }
      return { code: 0, data: r.favlists }
    } catch (e) {
      logger.error('[zhihu-favlist] list failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: e && e.message ? e.message : String(e) }
    }
  })

  ipcMain.handle('zhihu-favlist:contents', async (_event, arg) => {
    try {
      if (!arg || typeof arg !== 'object') return { code: -2, message: '缺少参数对象' }
      const secret = getAccessSecret()
      const r = await svc.getFavlistContents(secret, arg.urlToken, { maxPages: arg.maxPages })
      if (!r.success) return { code: -1, message: r.error, retryable: Boolean(r.retryable) }
      // 2026-10-03：清单项补 kind（classifyZhihuUrl），供渲染端清单直选展示类型徽标与降级语义
      return { code: 0, data: { items: r.items.map(normalizeFavItem), totals: r.totals } }
    } catch (e) {
      logger.error('[zhihu-favlist] contents failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: e && e.message ? e.message : String(e) }
    }
  })

  // ⚠️ 消费方已下线但仍保留（2026-10-17，change: zhihu-fav-entries-consolidate）：
  // 采集页「旧整夹直采」的「批量采集」按钮已随入口收敛删除，本通道**当前没有 UI 消费者**。
  // 之所以不一起删：删除后端能力属「功能下线」，需单独评审（涉 license-access-control.js
  // 的白名单与 zhihu-favlist.test.js 的后端测试），且未来入口/脚本可能复用。
  // 若确认再无任何消费方，请按功能下线流程处理——不要在重构时顺手删掉。
  ipcMain.handle('zhihu-favlist:batch-collect', async (_event, arg) => {
    try {
      if (!arg || !Array.isArray(arg.urls)) return { code: -2, message: '缺少 URL 列表' }
      if (activeBatches.collect) return { code: -3, message: '已有批量采集任务进行中' }
      const signal = { cancelled: false }
      activeBatches.collect = signal
      const ctrl = makeController({})
      const r = await ctrl.run(arg.urls, async (url) => {
        const result = await urlCollector.collect(url, { manual: false })
        return { ok: Boolean(result && result.success), data: result, retryable: false }
      }, {
        signal,
        onProgress: (idx, total, res) => {
          logger.info('[zhihu-favlist] batch-collect progress', { index: idx + 1, total, ok: res && res.ok })
        },
      })
      activeBatches.collect = null
      return {
        code: 0,
        data: {
          completed: r.completed, failed: r.failed, cancelled: r.cancelled,
          circuitBroken: r.circuitBroken, results: r.results,
        },
      }
    } catch (e) {
      activeBatches.collect = null
      logger.error('[zhihu-favlist] batch-collect failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: e && e.message ? e.message : String(e) }
    }
  })

  // ⚠️ 同上：采集页「批量改写」按钮已随入口收敛删除，本通道当前无 UI 消费者但仍保留。
  // 改写能力现由 zhihu-fav-batch:run 的编排路径承担；删除本通道属功能下线，需单独评审。
  ipcMain.handle('zhihu-favlist:batch-rewrite', async (_event, arg) => {
    try {
      if (!arg || !Array.isArray(arg.contents)) return { code: -2, message: '缺少内容列表' }
      if (activeBatches.rewrite) return { code: -3, message: '已有批量改写任务进行中' }
      const resolved = applyLlmToBody({}, modelProviderManager, logger)
      if (resolved.shortCircuit) return resolved.shortCircuit
      const llm = resolved.body.llm
      const signal = { cancelled: false }
      activeBatches.rewrite = signal
      const ctrl = makeController({ baseIntervalMs: 3000, jitterMs: 2000 })
      const r = await ctrl.run(arg.contents, async (item) => {
        const body = { content: item.content, style: arg.style || '轻松易懂', length: arg.length || 'keep' }
        if (llm) body.llm = llm
        const res = await pythonBridge.requestBackend('POST', '/aggregation/rewrite', body)
        const ok = res && res.result_content
        return { ok: Boolean(ok), data: res, retryable: false }
      }, {
        signal,
        onProgress: (idx, total, res) => {
          logger.info('[zhihu-favlist] batch-rewrite progress', { index: idx + 1, total, ok: res && res.ok })
        },
      })
      activeBatches.rewrite = null
      return {
        code: 0,
        data: {
          completed: r.completed, failed: r.failed, cancelled: r.cancelled,
          circuitBroken: r.circuitBroken, results: r.results,
        },
      }
    } catch (e) {
      activeBatches.rewrite = null
      logger.error('[zhihu-favlist] batch-rewrite failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: e && e.message ? e.message : String(e) }
    }
  })

  ipcMain.handle('zhihu-favlist:cancel', async (_event, arg) => {
    const type = arg && arg.type
    if (type === 'collect' && activeBatches.collect) {
      activeBatches.collect.cancelled = true
      return { code: 0, data: true }
    }
    if (type === 'rewrite' && activeBatches.rewrite) {
      activeBatches.rewrite.cancelled = true
      return { code: 0, data: true }
    }
    if (type === 'fav-batch' && activeBatches.favBatch) {
      activeBatches.favBatch.cancelled = true
      return { code: 0, data: true }
    }
    return { code: 0, data: false }
  })

  // ═══════════════════════════════════════════════════════════════════
  // zhihu-fav-batch —— 「采集并改写」编排通道（2026-10-03）
  // PRD-ZHIHU-FAC-BATCH-2026-10-03 §3.2：勾选清单条目 → 逐条（串行 + 频控）
  // 采集正文 → 图片本地化（C1）→ 自动改写（D2，失败回退原文）→ 进度双边界推送
  // ═══════════════════════════════════════════════════════════════════

  /** 进度推送（双边界：start=采集前、done=完成后；summary 终事件） */
  function sendProgress (event, payload) {
    try {
      if (event && event.sender && typeof event.sender.send === 'function') {
        event.sender.send('zhihu-fav-batch:progress', payload)
      }
    } catch { /* 推送失败不影响编排 */ }
  }

  /** 是否为「仅登记」类型（不采集正文）：专栏/想法/视频 */
  function isRegisterOnlyKind (kind) {
    return kind === 'column' || kind === 'pin' || kind === 'video'
  }

  /** 采集结果是否具备入库资格：有标题或有正文（防空壳，PRD §2.3 内容完整性） */
  function isSubstantive (result) {
    return Boolean(result && (String(result.title || '').trim() || String(result.content || '').trim()))
  }

  /**
   * 单条改写：成功返回改写稿字符串；失败返回 { error }（调用方回退原文）。
   *
   * 失败原因可诊断（2026-10-17，change: collected-results-fix）：
   * 旧版调用方 `catch {}` 把真实异常吞掉，用户只看到「改写失败用原文」却不知道是
   * Python 后端没起（ECONNREFUSED）、接口 500 还是返回了空结果 —— 三种情况对应三种
   * 用户该做的事（起后端 / 看日志 / 换风格重试）。因此把失败原因以字符串形式抛给调用方：
   *   - 成功：返回改写稿（error 为 undefined）
   *   - 接口异常：error = 异常 message（截断 200 字符）
   *   - 返回空 result_content：error = 明确的「空结果」说明
   *
   * 两道护栏（QM-6 评审 #1/#6，2026-10-17）：
   *   ① 非 Error 抛出值（字符串/对象）也要有可读摘要，不能产出 "[object Object]"；
   *   ② 摘要里的内网端点（127.* / localhost / 内网 IP:端口）替换为通用说法 ——
   *      完整原文仍在 log.warn，UI 不暴露内部拓扑。
   *
   * 2026-10-18（fav-force-recollect 自评）：脱敏逻辑抽成 sanitizeDiagText 供采集失败
   * 的 reason 复用 —— reason 同样直传 UI（进度行 + 结果徽标），暴露面与 rewriteError 同级。
   */
  /**
   * 诊断文本脱敏 + 截断：内网 IP/localhost 端点替换为通用说法，保留可读性。
   * @param {string} text
   * @returns {string} ≤200 字符
   */
  function sanitizeDiagText (text) {
    return String(text)
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/g, '后端服务')
      .replace(/\blocalhost(?::\d+)?/gi, '后端服务')
      .slice(0, 200)
  }

  function summarizeRewriteError (e) {
    let msg
    if (e && typeof e === 'object' && typeof e.message === 'string' && e.message) msg = e.message
    else if (typeof e === 'string') msg = e
    else { try { msg = JSON.stringify(e) } catch { msg = String(e) } }
    // 内网端点脱敏 + 截断（单一实现见 sanitizeDiagText）
    return sanitizeDiagText(msg)
  }

  async function rewriteOne (pythonBridge, content, style, llm) {
    let res
    try {
      const body = { content, style: style || '轻松易懂', length: 'keep', ...(llm ? { llm } : {}) }
      res = await pythonBridge.requestBackend('POST', '/aggregation/rewrite', body)
    } catch (e) {
      return { error: summarizeRewriteError(e) }
    }
    const out = res && typeof res.result_content === 'string' ? res.result_content.trim() : ''
    return out || { error: '改写接口返回空结果（result_content 为空），请查看后端日志或换个改写风格重试' }
  }

  ipcMain.handle('zhihu-fav-batch:run', async (event, arg) => {
    try {
      if (!arg || !Array.isArray(arg.items) || arg.items.length === 0) {
        return { code: -2, message: '缺少勾选条目' }
      }
      if (arg.items.length > 100) {
        return { code: -2, message: '单次最多采集 100 条，请分批勾选' }
      }
      if (activeBatches.favBatch) return { code: -3, message: '已有采集任务进行中' }

      const signal = { cancelled: false }
      activeBatches.favBatch = signal
      const { urlCollector, pythonBridge, imageLocalizer } = deps
      // 默认 llm 只解析一次；解析不到不阻断采集编排（改写失败仍回退原文）
      const rewriteLlm = applyLlmToBody({}, modelProviderManager, logger).body.llm
      const forceRecollect = arg.forceRecollect === true
      // QM-6 M4 修复：消费渲染层传来的 collectedUrls（collected_items 的 sourceUrl 全集），
      // 与进程内 knownEntryMeta 取并集——knownEntryMeta 重启即失，跨会话去重靠它兜底
      const knownCollected = new Set(Array.isArray(arg.collectedUrls) ? arg.collectedUrls.map(String) : [])
      const seenInRun = new Set()
      const stats = {
        completed: 0, failed: 0, duplicateSkipped: 0,
        rewriteFailed: 0, registerOnly: 0, cancelled: false, circuitBroken: false,
      }
      const items = []
      const ctrl = makeController({})
      const total = arg.items.length

      const r = await ctrl.run(arg.items, async (it, idx) => {
        const url = it && it.url ? String(it.url) : ''
        const kind = it && it.kind ? String(it.kind) : classifyZhihuUrl(url)
        // ── start 边界（采集体执行前，AGENTS.md 批量进度双边界契约）──
        sendProgress(event, { phase: 'start', index: idx, total, url, kind })
        if (!url) {
          stats.failed++
          sendProgress(event, { phase: 'done', index: idx, total, url, kind, result: { ok: false, error: 'missing-url' } })
          return { ok: false, error: '条目缺少 URL', retryable: false }
        }
        // ── 仅登记类型：专栏/想法/视频 不采集正文 ──
        if (isRegisterOnlyKind(kind)) {
          stats.registerOnly++
          stats.completed++
          const entryId = genEntryId()
          rememberEntryMeta(url, { id: entryId, createdAt: new Date().toISOString() })
          items.push({
            id: entryId, createdAt: new Date().toISOString(),
            title: String(it.title || ''), kind, sourceUrl: url,
            favTime: Number(it.favTime) || 0, images: [], imageFallbacks: [],
          })
          sendProgress(event, { phase: 'done', index: idx, total, url, kind, result: { ok: true, registerOnly: true } })
          return { ok: true, registerOnly: true }
        }
        // ── 去重：本次 run 内 + 勾选清单重复 ──
        if (seenInRun.has(url)) {
          stats.duplicateSkipped++
          sendProgress(event, { phase: 'done', index: idx, total, url, kind, result: { ok: true, duplicate: true } })
          return { ok: true, duplicate: true }
        }
        seenInRun.add(url)
        // ── 去重：已采集（knownEntryMeta 进程记忆 ∪ collectedUrls 跨会话防线；forceRecollect 重采）──
        if (!forceRecollect && (knownEntryMeta.has(url) || knownCollected.has(url))) {
          stats.duplicateSkipped++
          sendProgress(event, { phase: 'done', index: idx, total, url, kind, result: { ok: true, duplicate: true } })
          return { ok: true, duplicate: true }
        }
        // ── 采集 ──
        // forceRefresh：勾「包含已采集（强制重采）」时必须绕过 L6 内容缓存，否则缓存命中返回
        // 空壳 → 下层判 unsubstantive → 表现为「勾了也没用」（2026-10-18，fav-force-recollect）。
        let result
        try {
          result = await urlCollector.collect(url, { manual: false, forceRefresh: forceRecollect })
        } catch (e) {
          stats.failed++
          const throwReason = e && e.message ? sanitizeDiagText(e.message) : '采集过程抛出异常'
          sendProgress(event, { phase: 'done', index: idx, total, url, kind, result: { ok: false, error: 'collect-throw', reason: throwReason } })
          return { ok: false, error: e && e.message ? e.message : String(e), retryable: false }
        }
        if (!result || result.success !== true || !isSubstantive(result)) {
          // cache_hit 返回 {success:true, title:'', content:''} 也在此判失败（防空壳，PRD §3.3.4）
          stats.failed++
          // 失败原因必须可归因（2026-10-18，fav-force-recollect）：done 事件此前只有 code
          // （unsubstantive），渲染层无从解释，用户只看到「完成」却没有结果。
          // 优先级：缓存命中说明 > 采集器自带 error > 泛化兜底。
          const reason = result && result.reason === 'cache_hit'
            ? '重复缓存命中（内容缓存已有该 URL；勾「包含已采集（强制重采）」可绕缓存重采）'
            : (result && typeof result.error === 'string' && result.error.trim()
                ? sanitizeDiagText(result.error.trim())
                : '内容不可提取')
          sendProgress(event, { phase: 'done', index: idx, total, url, kind, result: { ok: false, error: 'unsubstantive', reason } })
          return { ok: false, error: reason, reason, retryable: false }
        }
        // ── 图片本地化（C1：注入 localizer 且 imageLocalization!==false 时启用；失败回退原链）──
        const images = []
        const imageFallbacks = []
        const urls = Array.isArray(result.imageUrls) ? result.imageUrls : []
        if (imageLocalizer && arg.imageLocalization !== false && urls.length) {
          for (let i = 0; i < urls.length; i++) {
            const local = await imageLocalizer.localize(urls[i], i)
            if (local) images.push(local)
            else imageFallbacks.push(String(urls[i]))
          }
        }
        // ── 自动改写（D2：失败/空结果回退原文，条目标注）──
        // 失败原因不再吞掉（2026-10-17）：rewriteOne 以 { error } 形态带出原因摘要，
        // 落条目 rewriteError + done 事件，进度行与结果区才能显示「为什么失败」。
        let rewritten = null
        let rewriteError
        try {
          const r1 = await rewriteOne(pythonBridge, result.content, arg.rewriteStyle, rewriteLlm)
          if (r1 && r1.error) rewriteError = r1.error
          else if (typeof r1 === 'string' && r1) rewritten = r1
        } catch (e) {
          // 兜底：rewriteOne 自身不该抛，但真抛了也不能让整条采集挂掉（同 summarize 规则）
          rewriteError = summarizeRewriteError(e)
        }
        let rewrittenContent
        let rewriteFailed = false
        if (rewritten) {
          rewrittenContent = rewritten
        } else {
          rewriteFailed = true
          stats.rewriteFailed++
          if (rewriteError) log.warn('[zhihu-fav-batch] rewrite failed for ' + url + ': ' + rewriteError)
        }
        // ── 入库（forceRecollect 覆盖保留原 id/createdAt）──
        const prev = knownEntryMeta.get(url)
        const reused = Boolean(prev) && forceRecollect
        const entryId = reused ? prev.id : genEntryId()
        const createdAt = reused ? prev.createdAt : new Date().toISOString()
        rememberEntryMeta(url, { id: entryId, createdAt })
        items.push({
          id: entryId,
          createdAt,
          title: String(result.title || ''),
          content: String(result.content || ''),
          description: String(result.description || ''),
          coverImage: String(result.coverImage || ''),
          publishTime: String(result.publishTime || ''),
          source: 'zhihu',
          sourceUrl: url,
          kind: isRegisterOnlyKind(kind) ? kind : (result.kind || kind || 'unknown'),
          favTime: Number(it.favTime) || 0,
          images,
          imageFallbacks,
          rewrittenContent,
          rewriteFailed,
          rewriteError: rewriteError || undefined,
          batchId: typeof arg.batchId === 'string' ? arg.batchId : undefined,
        })
        stats.completed++
        // ── done 边界 ──
        sendProgress(event, {
          phase: 'done', index: idx, total, url, kind,
          result: { ok: true, rewriteFailed, rewriteError: rewriteError || undefined, images: images.length, fallbacks: imageFallbacks.length },
        })
        return { ok: true, data: items[items.length - 1], rewriteFailed }
      }, {
        signal,
        onProgress: (idx, totalN, res) => {
          logger.info('[zhihu-fav-batch] progress', { index: idx + 1, total: totalN, ok: res && res.ok, duplicate: res && res.duplicate })
        },
      })

      activeBatches.favBatch = null
      stats.cancelled = r.cancelled === true
      stats.circuitBroken = r.circuitBroken === true
      sendProgress(event, { phase: 'summary', ...stats, total })
      return { code: 0, data: { ...stats, items, results: r.results } }
    } catch (e) {
      activeBatches.favBatch = null
      logger.error('[zhihu-fav-batch] run failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: e && e.message ? e.message : String(e) }
    }
  })

  ipcMain.handle('zhihu-fav-batch:cancel', async () => {
    if (activeBatches.favBatch) {
      activeBatches.favBatch.cancelled = true
      return { code: 0, data: true }
    }
    return { code: 0, data: false }
  })

  // 「全部收藏」聚合清单（PRD §3.1 scope=all）：遍历收藏夹（官方 API 列表仅返回前 50 个、
  // 无分页，favlistsCapped 如实上报）→ 逐夹分页取内容 → buildUnifiedFavItems 合并去重
  // 按 favTime 降序截断。仅登记元数据，不触发正文采集。
  ipcMain.handle('zhihu-favlist:unified-contents', async (_event, arg) => {
    try {
      const secret = getAccessSecret()
      if (!secret) return { code: -1, message: '未配置知乎 Access Secret' }
      const listed = await svc.listFavlists(secret)
      if (!listed.success) return { code: -1, message: listed.error, retryable: Boolean(listed.retryable) }
      const favlists = listed.favlists || []
      const collections = []
      for (const f of favlists) {
        const r = await svc.getFavlistContents(secret, f.urlToken, {})
        if (r.success) collections.push(r.items || [])
      }
      const fullMode = arg && arg.fullMode === true
      const unified = buildUnifiedFavItems(collections, { count: arg && arg.count, fullMode })
      return {
        code: 0,
        data: {
          items: unified.items,
          truncated: unified.truncated,
          totalBeforeCut: unified.totalBeforeCut,
          favlistsCapped: favlists.length >= 50,
          fullModeCapped: fullMode && unified.truncated,
        },
      }
    } catch (e) {
      logger.error('[zhihu-favlist] unified-contents failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: e && e.message ? e.message : String(e) }
    }
  })
}

module.exports = registerHandlers
/** 测试缝：清空模块级状态（knownEntryMeta/activeBatches），防跨用例污染 */
module.exports._resetFavBatchStateForTest = function () {
  knownEntryMeta.clear()
  activeBatches.collect = null
  activeBatches.rewrite = null
  activeBatches.favBatch = null
}
