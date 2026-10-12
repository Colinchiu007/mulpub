// @ts-check
/**
 * creator IPC handlers — 博主监控与采集的主进程入口
 *
 * 本层只做三件事，**不承载业务逻辑**：
 *   1. 入参校验（越早拒绝越省资源，且能在产生副作用前失败）
 *   2. 调用 creator-* 服务并把领域错误映射成 UI 可消费的形状
 *   3. 依赖缺失时**降级返回**而不是不注册通道
 *
 * 第 3 点沿用 automation IPC 的既有教训：handler 不注册时，渲染层会收到
 * Electron 原生的 "No handler registered for 'creator:collect'"——那句话
 * 对用户毫无意义。统一返回 { code, reason }，让 UI 能显示「服务未就绪」。
 *
 * ⚠ 许可级别（2026-10-12 更正）：本模块通道**并未**登记进
 * `license-access-control` 的 PUBLIC_CHANNELS —— 此前这句注释与实现不符。
 * 现状是「默认 authenticated（需登录）」。是否要改为 public 属**许可策略**变更
 * （与 usage:* / aggregation:* 同级只需一次人工裁决），不在本次修复范围内；
 * 据此注释不再声称已登记，避免下一轮有人照注释去核对却找不到。
 */

const {
  COLLECT_DEFAULTS,
  resolveEffectiveLimit,
  planCollect,
  ClampError,
} = require('../services/creator-limits')

const { CREATOR_INPUT_ERRORS, probeTranscriptDependency } = require('../services/creator-collector')

/** 凭证输入类失败 reason 集合（`creator-credential.validateApiKey` 的取值域）。
 *  单独列出来是为了把「用户改输入就能解决」与「得改环境/看日志」两类分开——
 *  合成一句话会让用户对着不可操作的提示反复重试。 */
const INPUT_REASONS = new Set(['not_a_string', 'empty', 'too_short', 'too_long', 'illegal_chars'])

// 显式 sender 守卫。**必须字面出现在每个注册点的实参里**：
// check-ipc-sender-guard 的 GUARD_PATTERNS 只对 `ipcMain.handle(通道, <实参文本>)`
// 的实参文本做正则匹配，不解析局部 helper 的定义——把守卫藏进 `wrap` 里
// 会被判成「注入咽喉点」而非显式守卫，既过不了占比门禁，也丢掉了纵深防御。
const { withSenderCheck } = require('./helpers')

/** 领域错误 → UI 形状。排查方向不同的错误 MUST 分开，不要合并成一句话。 */
function toIpcError (err) {
  if (err instanceof ClampError) {
    return { code: -11, reason: err.code, message: err.message, max: err.max, count: err.count }
  }
  const code = err && err.code
  // 本特性所有领域错误都以 creator: 前缀标识（输入类见 CREATOR_INPUT_ERRORS，
  // 其余为 discovery_not_found / follow_not_found / quota_would_exceed 等）。
  // **必须整类透传**：只映射输入类枚举会让其余原因落进通用分支丢失 reason，
  // 而「格式不对」「作品不存在」「配额不足」排查方向完全不同。
  if (typeof code === 'string' && code.startsWith('creator:')) {
    return { code: -12, reason: code, message: (err && err.message) || '' }
  }
  return { code: -1, reason: 'creator:failed', message: (err && err.message) || '操作失败' }
}

function requireString (payload, key, { max = 512 } = {}) {
  const v = payload && payload[key]
  if (typeof v !== 'string' || !v.trim()) {
    const e = new Error('缺少必要参数')
    e.code = CREATOR_INPUT_ERRORS.INVALID_INPUT
    throw e
  }
  if (v.trim().length > max) {
    const e = new Error('参数过长')
    e.code = CREATOR_INPUT_ERRORS.INVALID_INPUT
    throw e
  }
  return v.trim()
}

function registerHandlers (ipcMain, deps) {
  const {
    creatorStore,      // creator-store 实例
    creatorCollector,  // resolveChannelId / listPosts
    creatorMonitor,    // probeCreator / classifyFailure 等
    creatorQuota,      // { probePool, collectPool, canSpend, spend }
    creatorCredential, // creator-credential 提供者（PRD §7.4）
    pythonBridge,      // 正文（字幕）增强腿；缺失不阻塞发现
    log,
  } = deps || {}

  // 降级注册同样要守卫：不能出现「服务缺失时反而无守卫」的旁路。
  // 形参刻意叫 ch 而不是 channel：check-ipc-sender-guard 对**动态**通道名按
  // 实参表达式文本生成标签（`<expr:ch>`），automation.js:35 用的也是 `channel`，
  // 同名会被判成「同一通道重复注册且守卫状态不一致」而报 ERROR。
  const degraded = (ch) => ipcMain.handle(ch, withSenderCheck(() => ({
    code: -1,
    reason: 'service-unavailable',
    // 这条消息**必须**只描述"服务没起来"，不得复述成"缺少采集依赖"：
    // 渲染层按 reason 选文案，而"依赖缺失"另有 creator:dependency-status 这条真源。
    // 旧渲染层把本 reason 渲染成「缺少采集依赖。请执行：」（命令位恒空），
    // 是 2026-10-12 那次「整页不可用且零可操作信息」的直接成因。
    message: '博主监控主进程服务未就绪，请重启应用后重试',
    channel: ch,
  })))

  const wrap = (fn) => async (_evt, payload) => {
    try {
      return await fn(payload || {})
    } catch (err) {
      if (log && log.warn) log.warn('[ipc:creator]', (err && err.message) || String(err))
      return toIpcError(err)
    }
  }

  const wired = !!(creatorStore && creatorCollector && creatorMonitor)

  // ── 只读/凭证通道：与 creator 业务服务是否就绪**无关**，一律注册 ─────────
  // 为什么不能跟写通道一起走降级：凭证与依赖状态恰恰是"服务没起来时用户最需要看到的东西"，
  // 把它们也降级会让排查入口消失（页面只剩一句失败，没有任何可操作项）。

  // 凭证状态（只读，**永不**回传明文：只有 status 与 fingerprint）
  ipcMain.handle('creator:credential-status', withSenderCheck(wrap(async () => {
    if (!creatorCredential || typeof creatorCredential.status !== 'function') {
      return { code: 0, status: 'unavailable', reason: 'credential-service-unavailable' }
    }
    const r = creatorCredential.status()
    return { code: 0, ...r }
  })))

  // 保存凭证：**全仓唯一**接受 YouTube API Key 明文的通道（写入方向无法避免，PRD §7.4）。
  // 渲染层在成功回包后 MUST 立刻清空输入框，不写任何持久化 store。
  ipcMain.handle('creator:credential-set', withSenderCheck(wrap(async (payload) => {
    if (!creatorCredential || typeof creatorCredential.setApiKey !== 'function') {
      return { code: -1, reason: 'creator:credential_unavailable', detail: 'credential-service-unavailable' }
    }
    const r = creatorCredential.setApiKey(payload && payload.key)
    if (!r.ok) {
      // 三类分因：输入非法（用户改输入）/ 系统密钥库不可用（用户改环境）/ 持久化失败（重试或看日志）
      const reason = INPUT_REASONS.has(r.reason)
        ? 'creator:credential_invalid'
        : (r.reason === 'persist-failed'
          ? 'creator:credential_persist_failed'
          : 'creator:credential_unavailable')
      return { code: -1, reason, detail: r.reason, status: r.status }
    }
    return { code: 0, status: r.status, fingerprint: r.fingerprint, looksLikeGoogleKey: r.looksLikeGoogleKey }
  })))

  ipcMain.handle('creator:credential-clear', withSenderCheck(wrap(async () => {
    if (!creatorCredential || typeof creatorCredential.clear !== 'function') {
      return { code: -1, reason: 'creator:credential_unavailable', detail: 'credential-service-unavailable' }
    }
    const r = creatorCredential.clear()
    return r.ok ? { code: 0, status: r.status } : { code: -1, reason: 'creator:credential_persist_failed', detail: r.reason }
  })))

  // 依赖状态（只读、**非阻塞**）：把"哪条腿缺、缺了怎么办"如实交回渲染层，
  // 兑现 PRD §16「禁止静默降级」（缺字幕依赖时采集仍可用，但 MUST 让用户看见质量降级）。
  ipcMain.handle('creator:dependency-status', withSenderCheck(wrap(async () => {
    const probe = probeTranscriptDependency({ pythonBridge })
    return {
      code: 0,
      // 发现腿：Node 内置 https + Data API v3，无第三方包（见 creator-collector-runtime）
      discovery: { ready: wired, reason: wired ? '' : 'service-unavailable' },
      // 正文腿：字幕经 Python content-aggregator；缺失只是质量降级（full → partial/stub）
      transcript: {
        ready: probe.ready,
        optional: true,
        reason: probe.reason || '',
        installHint: probe.installHint || '',
      },
    }
  })))

  // ── 依赖缺失：仍注册通道，返回可消费的降级结果 ──────────────────
  if (!wired) {
    log && log.error && log.error('Creator', 'creator services not provided — handlers in degraded mode')
    for (const ch of [
      'creator:list', 'creator:pending-total', 'creator:follow', 'creator:unfollow', 'creator:toggle',
      'creator:check-now', 'creator:discoveries', 'creator:collect', 'creator:platforms',
      'creator:collect-one', 'creator:skip-one', 'creator:send-to-writer',
    ]) degraded(ch)
    return
  }

  // ── 博主列表（含待采集角标） ─────────────────────────────────
  ipcMain.handle('creator:list', withSenderCheck(wrap(async () => {
    const creators = await creatorStore.listCreators()
    const items = []
    for (const c of creators) {
      items.push({ ...c, pendingCount: creatorStore.countPending(c.id) })
    }
    return { code: 0, items, totalPending: items.reduce((s, x) => s + x.pendingCount, 0) }
  })))

  // ── 待采集总数（页签角标的读通道）───────────────────────────
  // 为什么单独开一个通道而不复用 creator:list：角标要在**父组件**渲染
  // （Collection.vue 的 tab 按钮上），而列表数据在 CreatorMonitor 子组件里。
  // 让父组件拉整份列表等于切页重复拉一次全量数据。
  // 口径与 creator:list 的 totalPending 保持同源（各博主 pending 之和）。
  ipcMain.handle('creator:pending-total', withSenderCheck(wrap(async () => {
    const creators = await creatorStore.listCreators()
    let total = 0
    for (const c of creators) {
      if (c.enabled === 0 || c.status === 'paused_by_user') continue
      total += creatorStore.countPending(c.id)
    }
    return { code: 0, total }
  })))

  // ── 关注博主（多平台，PRD-CREATOR-MULTI-PLATFORM-2026-10-12 §5.1）──
  // 平台由渲染层显式传 platform（youtube/douyin/xiaohongshu），缺省 youtube 兼容旧调用。
  // 解析走 creator-platforms 的统一入口（fail-closed）：URL 与所选平台不一致 → wrong_platform；
  // canonical ID 落库（youtube=UC…、douyin=sec_uid、xhs=用户 ID）——绝不对用户输入做平台猜测。
  ipcMain.handle('creator:follow', withSenderCheck(wrap(async (payload) => {
    const input = requireString(payload, 'input')
    const platform = (typeof payload.platform === 'string' && payload.platform.trim()) ? payload.platform.trim() : 'youtube'

    // 多平台解析（creator:platforms 提供清单；这里只做解析与 canonical 化）
    const { parseCreatorInput } = require('../services/creator-platforms')
    const parsed = parseCreatorInput(input, platform)
    // 配额校验 MUST 在写库之前：超限时拒绝且不产生任何行（仅 YouTube 有 Data API 配额池；
    // 抖音/小红书按平台最小间隔与失败分级管控，不走 units 配额）
    if (platform === 'youtube' && creatorQuota) {
      const pool = typeof creatorQuota.probePool === 'number' ? creatorQuota.probePool : 1500
      const existing = await creatorStore.listFollowsForQuota()
      const interval = payload.checkIntervalMin || 60
      creatorMonitor.assertQuotaFits(existing, pool, { check_interval_min: interval })
    }

    let canonicalId = parsed.creatorId || parsed.raw
    let platformUrl = ''
    if (platform === 'youtube') {
      // 先解析成 canonical ID 再落库——绝不把用户输入当 external_id 存
      canonicalId = await creatorCollector.resolveChannelId(input)
      platformUrl = `https://www.youtube.com/channel/${canonicalId}`
    } else if (platform === 'douyin') {
      platformUrl = `https://www.douyin.com/user/${canonicalId}`
    } else if (platform === 'xiaohongshu') {
      platformUrl = `https://www.xiaohongshu.com/user/profile/${canonicalId}`
    }

    const creator = await creatorStore.upsertCreator({
      platform,
      externalId: canonicalId,
      displayName: payload.displayName || '',
      handle: payload.handle || '',
      avatarUrl: '',
      platformUrl,
    })
    const follow = await creatorStore.upsertFollow({
      creatorId: creator.id,
      checkIntervalMin: payload.checkIntervalMin || 60,
      perCreatorLimit: payload.perCreatorLimit ?? null,
    })
    return { code: 0, creator, follow }
  })))

  // 平台清单 + 会话状态（添加弹窗的平台选择与「未登录」提示的数据源）
  ipcMain.handle('creator:platforms', withSenderCheck(wrap(async () => {
    const { PLATFORM_META } = require('../services/creator-platforms')
    let status = {}
    try {
      status = (creatorCollector && typeof creatorCollector.platformStatus === 'function')
        ? (await creatorCollector.platformStatus() || {})
        : {}
    } catch (_) { status = {} }
    return {
      code: 0,
      platforms: Object.entries(PLATFORM_META).map(([id, meta]) => ({
        id,
        label: meta.label,
        localeKey: meta.localeKey,
        supported: meta.supported,
        hasSession: !!(status[id] && status[id].hasSession),
      })),
    }
  })))

  // ── 取消关注 / 暂停恢复 ─────────────────────────────────────
  ipcMain.handle('creator:unfollow', withSenderCheck(wrap(async (payload) => {
    const followId = requireString(payload, 'followId', { max: 64 })
    await creatorStore.deleteFollow(followId)
    return { code: 0 }
  })))

  ipcMain.handle('creator:toggle', withSenderCheck(wrap(async (payload) => {
    const followId = requireString(payload, 'followId', { max: 64 })
    const follow = await creatorStore.setFollowEnabled(followId, !!payload.enabled)
    return { code: 0, follow }
  })))

  // ── 立即检查 ────────────────────────────────────────────────
  ipcMain.handle('creator:check-now', withSenderCheck(wrap(async (payload) => {
    const followId = requireString(payload, 'followId', { max: 64 })
    const r = await creatorMonitor.probeCreator(followId, { manual: true })
    return { code: 0, ...r }
  })))

  // ── 发现列表 ────────────────────────────────────────────────
  ipcMain.handle('creator:discoveries', withSenderCheck(wrap(async (payload) => {
    const limit = Number.isInteger(payload.limit) ? payload.limit : 50
    const offset = Number.isInteger(payload.offset) ? payload.offset : 0
    const items = await creatorStore.listDiscoveries({
      creatorId: payload.creatorId || null,
      state: payload.state || 'pending',
      limit, offset,
    })
    return { code: 0, items, limit, offset }
  })))

  // ── 批量采集 ────────────────────────────────────────────────
  ipcMain.handle('creator:collect', withSenderCheck(wrap(async (payload) => {
    const follow = await creatorStore.getFollow(requireString(payload, 'followId', { max: 64 }))
    if (!follow) {
      const e = new Error('关注项不存在')
      e.code = 'creator:follow_not_found'
      throw e
    }
    const effectiveLimit = resolveEffectiveLimit(follow.per_creator_limit)

    // 默认数量取「一键采集」通道的 5；手动批量通道会显式传 50
    const count = payload.count ?? COLLECT_DEFAULTS.oneClick

    const pending = await creatorStore.listDiscoveries({
      creatorId: follow.creator_id, state: 'pending', limit: effectiveLimit, offset: 0,
    })

    // 超限在此抛错，此时尚未发起任何采集请求 —— 零副作用
    const plan = planCollect({ pending, count, effectiveLimit })

    // 必须传**数组**：`creator-runtime.js` 的 collectBatch 形参是 discoveries 列表，
    // 内部 `Array.isArray(discoveries) ? discoveries : []` 兜底。
    // 传对象会被兜底成空列表 —— 症状是「一条都没采、failed 也是 0」，
    // 不报错、不告警，看起来像「没东西可采」。
    const r = await creatorMonitor.collectBatch(plan.selected)
    return {
      code: 0,
      collected: r.collected,
      failed: r.failed,
      remain: plan.remain,
      truncated: plan.truncated,
      available: plan.available,
      max: effectiveLimit,
    }
  })))

  // ── 单条采集：零填参，不受数量上限约束，但仍受配额约束 ────────
  ipcMain.handle('creator:collect-one', withSenderCheck(wrap(async (payload) => {
    const discoveryId = requireString(payload, 'discoveryId', { max: 64 })
    const r = await creatorMonitor.collectOne(discoveryId)
    return { code: 0, ...r }
  })))

  ipcMain.handle('creator:skip-one', withSenderCheck(wrap(async (payload) => {
    const discoveryId = requireString(payload, 'discoveryId', { max: 64 })
    // 必须看 store 的判定结果：跳过一条**已终态**（collected/skipped）的条目时，
    // 什么都不改。原实现丢掉返回值恒回 {code:0}，UI 会显示「已跳过」
    // 而库里状态没变——用户点了没反应却以为成功了。
    const r = creatorStore.skipDiscovery(discoveryId)
    if (r && r.ok === false) {
      const e = new Error('该作品已处理，无法跳过')
      e.code = r.reason === 'not_found' ? 'creator:discovery_not_found' : 'creator:invalid_state'
      throw e
    }
    return { code: 0 }
  })))

  // ── 送入 AI 写作 ────────────────────────────────────────────
  // 复用既有 full-auto-pipeline 的 collect → rewrite → create 三段，**不执行 publish**
  // （非目标 N1：不做一键搬运发布）。幂等键见下，避免同一内容反复点重复消耗 LLM 额度。
  ipcMain.handle('creator:send-to-writer', withSenderCheck(wrap(async (payload) => {
    const discoveryId = requireString(payload, 'discoveryId', { max: 64 })
    const pipeline = deps.fullAutoPipeline
    if (!pipeline || typeof pipeline.startRun !== 'function') {
      return { code: -1, reason: 'pipeline-unavailable', message: 'AI 写作流水线未就绪' }
    }
    const item = await creatorStore.getDiscovery(discoveryId)
    if (!item) {
      const e = new Error('作品不存在')
      e.code = 'creator:discovery_not_found'
      throw e
    }
    // 幂等：同一份内容（id + updated_at）重复点击返回同一个 runId，而不是重复起跑
    const sig = `${item.id}:${item.updated_at || item.collected_at || ''}`
    const started = await pipeline.startRun({
      urls: [item.url].filter(Boolean),
      sourceType: 'url',
      stages: { collect: false, rewrite: true, create: true, publish: false },
      idempotencyKey: `creator:${sig}`,
    })
    if (!started || started.success === false) {
      return { code: -1, reason: 'writer-start-failed', message: (started && started.error) || 'AI 写作启动失败' }
    }
    return { code: 0, runId: started.runId, idempotencyKey: `creator:${sig}` }
  })))
}

module.exports = { registerHandlers, toIpcError, COLLECT_DEFAULTS }