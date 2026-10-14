// @ts-check
/**
 * ops-runtime-snapshot.js — 运行时策略三层降级数据源的 L2/L3 承载 + config_hash 单一真源
 *
 * 为什么单独成文件（2026-10-07，ops-center-resilience）：
 *   ops-center-sync.js 已在 max-lines 债务清单上（基线 570 行 / 允许增长 200），本 change
 *   的三层降级与上报逻辑如果继续塞进去会直接顶破门禁。新逻辑一律放这里与
 *   ops-resilience-reporter.js，ops-center-sync 只做接线。
 *
 * 三层数据源（design §4.1）：
 *   L1 内存 this._runtime + 6 个注入管理器的内存态（本文件不管）
 *   L2 settings[opsCenterRuntimeSnapshot] —— **完整原始 bootstrap payload**
 *   L3 resources/ops-seed/runtime-bootstrap.json（随 asar / 安装包发布）
 *
 * 为什么 L2 存原始 payload 而非归一化摘要（design §4.2）：
 *   applyRuntime 里 6 个注入管理器（platform_defs / content_templates / keyword_watchlist /
 *   rewrite_strategies / rewrite_hard_constraints / rewrite_ai_taste_map）的入参就是原始块，
 *   存原文 → 启动时把同一个 payload 再喂一次 applyRuntime 即可重放全部内存态，
 *   无需为每个 setter 单独设计持久化格式（那正是「重启丢 6 类数据」的根因）。
 *
 * 落盘时机（design §4.3，由调用方保证语义，本模块只提供原子入口）：
 *   成功拉到并验签通过 → saveRawSnapshot()
 *   连接失败 / 验签失败 → 根本不调用本模块（不写 L2、不推进 syncedAt）
 */
'use strict'

const fs = require('fs')
const path = require('path')
const nodeCrypto = require('crypto')

/** config_hash 的计算范围（design §1.2，跨端契约，服务端同名常量必须逐字一致） */
const RUNTIME_BLOCKS = [
  'announcements', 'update_policy', 'content_policy', 'feature_flags',
  'platform_defs', 'content_templates', 'keyword_watchlist',
  'rewrite_strategies', 'rewrite_hard_constraints', 'rewrite_ai_taste_map',
  'pipelineOptions', 'appMenu', 'contentCategories',
]

/** L2 快照的 settings 键（design §4.1） */
const SNAPSHOT_SETTING_KEY = 'opsCenterRuntimeSnapshot'

/** L3 种子相对路径（design §4.4） */
const SEED_RELATIVE_PATH = path.join('resources', 'ops-seed', 'runtime-bootstrap.json')

/** 种子与 L2 快照的体积上限：对齐 ops-center-sync 的 MAX_CATALOG_BYTES（1MB） */
const MAX_SNAPSHOT_BYTES = 1024 * 1024

/** 种子超过该天数未更新时 CI 告警（design §4.4 第 7 条，警告不阻塞） */
const SEED_MAX_AGE_DAYS = 90

/**
 * 每个数据块在运行时被消费的类型（供 L3 种子 CI 校验第 2 条使用）。
 *
 * 判据**逐条对着 ops-center-sync.js 的 applyRuntime 与服务端 get_runtime_bootstrap 的真实形态**推导，
 * 不是照着文档想当然写的（首版就照想当然写错过一轮，被 export-ops-seed 的自检当场拦下）：
 *   - array          —— applyRuntime 用 Array.isArray 判定（platform_defs / content_templates 等）
 *   - object-or-null —— 服务端可能下发 null，客户端按 falsy 处理（update_policy / pipelineOptions 等）
 *   - array-or-object—— contentCategories：服务端发 {items,count}，客户端 normalizeContentCategories
 *                       同时接受裸数组与 {items}（sidebar-menu-merge 归一化口径）
 * 判错的代价是**误拦合法的种子**或**放过结构坏掉的种子**，两边都是坏处，所以必须逐块实测。
 */
const SEED_BLOCK_TYPES = {
  announcements: 'array',
  update_policy: 'object-or-null',
  content_policy: 'object-or-null',
  feature_flags: 'object-or-null',
  platform_defs: 'array',
  content_templates: 'array',
  keyword_watchlist: 'array',
  rewrite_strategies: 'array',
  rewrite_hard_constraints: 'object-or-null',
  rewrite_ai_taste_map: 'array',
  pipelineOptions: 'object-or-null',
  appMenu: 'object-or-null',
  contentCategories: 'array-or-object',
}

/**
 * canonical JSON 序列化：与 ops-center 后端 json.dumps(ensure_ascii=False, sort_keys=True,
 * separators=(",", ":"), allow_nan=False) 对齐（键字典序、字符串 JSON 转义、UTF-8 输出）。
 *
 * 2026-10-07 从 ops-center-sync.js 原样迁入：config_hash 要在「客户端 / 导出脚本 / CI 校验」
 * 三处算出同一个值，若各写一份必然漂移。既有固定向量（ops-center-sync.test.js）继续锚定本实现。
 */
function canonicalJson (value) {
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'string') return JSON.stringify(value)
  if (t === 'boolean') return value ? 'true' : 'false'
  if (t === 'number') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (t === 'object') {
    const keys = Object.keys(value).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}'
  }
  throw new Error('cannot canonicalize type: ' + t)
}

/**
 * config_hash：13 个数据块 canonical JSON 的 SHA-256 前 16 位（design §1.2）。
 * 三条不可违背的约束在这里落地：不含 synced_at / config_version / config_hash / signature；
 * 缺失键补 null 而非跳过（否则「删掉一个数据块」与「该键本来不存在」不可区分）。
 */
function computeConfigHash (payload) {
  const src = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const subset = {}
  for (const block of RUNTIME_BLOCKS) {
    subset[block] = Object.prototype.hasOwnProperty.call(src, block) ? src[block] : null
  }
  // 非整数数字在两端序列化不一致（实测 1.0 / 1e16 / 1.5e-7 / -0.0 / >2^53 全部不同），
  // 会让服务端的 config_hash 与客户端算出的不一致 ⇒ ACK 永远判为「hash 变了」⇒
  // 每 24h 全量客户端空烧一次流量，且看板上的 hash 对不上任何客户端。
  //
  // 为什么是「直接抛错」而不是「修正序列化」：canonicalJson 同时是 **Ed25519 签名路径**
  // （与 ops-center 后端 canonical_json 逐字节对齐），改它的数字格式会让**已部署客户端的
  // 验签全部失败**。收紧序列化是破坏性变更，不属于本次韧性范围。
  //
  // 为什么当前是安全的：bootstrap 的 13 个数据块实测**零浮点**（全是 int/bool/string），
  // 平台元数据等只有整数阈值。但那是**数据现状**不是**机制保证** —— 一旦运营在配置里
  // 填了个 0.5 的限流阈值，这里就必须炸出来，而不是静默算出两个 hash。
  assertNoFractionalNumbers(subset)
  return nodeCrypto.createHash('sha256').update(canonicalJson(subset), 'utf8').digest('hex').slice(0, 16)
}

/** 递归检查：非有限数（NaN/Infinity）与「序列化文本与 JS 规范不符」的 number 一律抛错。 */
function assertNoFractionalNumbers (value, path = '') {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`config_hash 输入含非有限数${path ? ' @ ' + path : ''}：${value}（跨端序列化不一致，必须先清理）`)
    }
    // 非整数一律拒绝：JS 对 1.5 输出 "1.5"、对 1.5e-7 输出 "1.5e-7"，而 Python 输出
    // "1.5" 与 "1.5e-07" —— 指数形式的补零差异足以让两端 hash 不同。
    if (!Number.isInteger(value)) {
      throw new Error(`config_hash 输入含非整数${path ? ' @ ' + path : ''}：${value}（JS 与 Python 序列化文本不同，会导致两端 config_hash 不一致）`)
    }
    // 整数值但超出双精度安全范围：Python 原样输出，JS Number 已丢精度 ⇒ 两端 hash 必不同。
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new Error(`config_hash 输入超出双精度安全整数范围${path ? ' @ ' + path : ''}：${value}（JS Number 已丢精度，两端 hash 不一致）`)
    }
    return
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) assertNoFractionalNumbers(value[i], `${path}[${i}]`)
    return
  }
  if (isPlainObject(value)) {
    for (const k of Object.keys(value)) assertNoFractionalNumbers(value[k], path ? `${path}.${k}` : k)
  }
}

/**
 * 剔除内容安全词库（design §4.4 第 6 条，安全硬约束）：词库进包 = 可被逆向提取，
 * 把过期的封禁词库打进客户端等于公开词库。只保留 enabled 开关与替换串等非词库字段。
 * 不修改入参（导出脚本与读取路径共用它，必须无副作用）。
 */
function stripContentWordList (payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  if (!payload.content_policy || typeof payload.content_policy !== 'object' || Array.isArray(payload.content_policy)) return payload
  if (!Object.prototype.hasOwnProperty.call(payload.content_policy, 'word_list')) return payload
  const contentPolicy = { ...payload.content_policy }
  delete contentPolicy.word_list
  return { ...payload, content_policy: contentPolicy }
}

/**
 * L3 种子只有一个候选：asar 内的 <app>/resources/ops-seed/runtime-bootstrap.json。
 * 「随 asar 发布」是 PRD-OPS-CENTER-RESILIENCE §7 与 openspec design §4.5 写定的形态，
 * 打包配置的 files 白名单也确实把它打进了 app.asar。
 *
 * 这里曾有第二个候选 <process.resourcesPath>/ops-seed/…，注释写的是「extraResources 从 resources/
 * 拷出时」——但 package.json 的 build.extraResources 从未登记 ops-seed，所以安装后那条路径
 * 永远不存在：它是一个看上去提供回退、实际一次都命中不了的装饰候选，还会让人误以为包外有副本。
 * 2026-10-14 删除。真要搬出包外，必须同一 PR 里补 extraResources 登记并恢复第二候选，缺一不可。
 * 开发态该候选等价于仓库路径 apps/desktop/resources/ops-seed/runtime-bootstrap.json。
 */
function resolveSeedPaths ({ appDir } = {}) {
  const base = appDir || __dirname
  return [path.join(base, '..', '..', SEED_RELATIVE_PATH)]
}

function isPlainObject (v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/** 种子文件年龄（天）；exported_at 非法时返回 null（无法判定新鲜度，不臆造） */
function seedAgeDays (exportedAt, now) {
  const at = Date.parse(String(exportedAt || ''))
  if (!Number.isFinite(at)) return null
  return Math.floor(((now || Date.now()) - at) / 86400000)
}

/**
 * L3 种子校验（design §4.4 的 7 条 CI 判据，本模块是唯一实现）。
 * errors 阻塞构建；warnings 只告警（第 7 条：过期不阻塞）。
 * @param {any} raw 解析后的种子对象
 * @param {{bytes?:number, hasBom?:boolean, hasReplacementChar?:boolean, file?:string, now?:number}} [opts]
 */
function validateSeedPayload (raw, opts = {}) {
  const errors = []
  const warnings = []
  const file = opts.file || 'runtime-bootstrap.json'
  if (!isPlainObject(raw)) {
    errors.push(`SEED_NOT_OBJECT: ${file} 顶层必须是 JSON 对象`)
    return { errors, warnings }
  }
  // 第 4 条：编码完整性（BOM 会让 JSON.parse 直接失败，U+FFFD 说明文件已被坏编码污染）
  if (opts.hasBom) errors.push(`SEED_BOM: ${file} 含 UTF-8 BOM，必须以无 BOM 的 UTF-8 保存`)
  if (opts.hasReplacementChar) errors.push(`SEED_REPLACEMENT_CHAR: ${file} 含 U+FFFD 替换字符（编码已损坏）`)
  // 第 3 条：体积上限（对齐运行时 1MB 响应上限）
  const bytes = Number(opts.bytes)
  if (Number.isFinite(bytes) && bytes > MAX_SNAPSHOT_BYTES) {
    errors.push(`SEED_TOO_LARGE: ${file} ${bytes} 字节，超过 1MB 上限`)
  }
  const meta = isPlainObject(raw._meta) ? raw._meta : null
  if (!meta) errors.push(`SEED_META_MISSING: ${file} 缺少 _meta`)
  // 第 1 条 + 第 2 条：13 个数据块键齐全且类型与运行时一致
  for (const block of RUNTIME_BLOCKS) {
    if (!Object.prototype.hasOwnProperty.call(raw, block)) {
      errors.push(`SEED_BLOCK_MISSING: ${file} 缺少数据块 ${block}`)
      continue
    }
    const value = raw[block]
    const expected = SEED_BLOCK_TYPES[block]
    const ok = expected === 'array' ? Array.isArray(value)
      : expected === 'object-or-null' ? (value === null || isPlainObject(value))
        : expected === 'array-or-object' ? (Array.isArray(value) || isPlainObject(value))
          : isPlainObject(value)
    if (!ok) errors.push(`SEED_BLOCK_TYPE: ${file} 数据块 ${block} 类型与运行时不一致（期望 ${expected}）`)
  }
  // 第 6 条：词库残留是安全硬约束，错误信息必须同时点出文件与字段
  if (isPlainObject(raw.content_policy) && Object.prototype.hasOwnProperty.call(raw.content_policy, 'word_list')) {
    errors.push(`SEED_WORD_LIST_PRESENT: ${file} 的 content_policy.word_list 必须剔除（词库进包等于公开词库）`)
  }
  // 第 5 条：_meta.config_hash 与实算一致
  const actual = computeConfigHash(raw)
  const declared = meta && typeof meta.config_hash === 'string' ? meta.config_hash : ''
  if (declared !== actual) {
    errors.push(`SEED_HASH_MISMATCH: ${file} _meta.config_hash=${declared || '(空)'} 与实算 ${actual} 不一致`)
  }
  // 第 7 条：超过 90 天未更新只警告，不阻塞构建
  const age = seedAgeDays(meta && meta.exported_at, opts.now)
  if (age === null) warnings.push(`SEED_EXPORTED_AT_INVALID: ${file} _meta.exported_at 无法解析，无法判断新鲜度`)
  else if (age > SEED_MAX_AGE_DAYS) warnings.push(`SEED_STALE: ${file} _meta.exported_at 距今 ${age} 天，超过 ${SEED_MAX_AGE_DAYS} 天，请重新导出种子`)
  return { errors, warnings }
}

/**
 * L2/L3 承载服务。所有读路径对「缺失 / 损坏 / 超限」一律返回空值而非抛错：
 * 启动路径不允许被一个坏文件阻断（design §4.1 场景「L3 也不存在」必须不崩溃）。
 */
/**
 * 晚到注入器的补喂。
 *
 * 为什么需要：L2/L3 水合跑在 `autoSyncOnStart()` 开头，但 `setPlatformConfig` 在 phase1 里
 * 位于 `autoSyncOnStart()` **之后**（phase1-context.js:457 vs :240）。不补这一下，
 * platform_defs（平台字数/封面尺寸）在恢复时注入器仍是 null —— 6 类数据里唯独它恢复不回来，
 * 而症状与「压根没做持久化」完全一样，极难归因。
 *
 * 为什么做成「保留重放 payload + 晚到补喂」而不是去调 phase1 的调用顺序：
 * 顺序依赖是隐式契约，下一次插桩（加一行 setter、挪一段初始化）就会静默打翻；
 * 补喂则是显式的、对顺序不敏感的。
 *
 * 失败一律吞掉并告警：补喂是尽力而为，不能让一个坏的管理器阻断启动。
 * @returns 应用条数；未适用（无 payload / 目标 / 块非数组）返回 null
 */
function replayLateBlock (payload, blockName, target, log, tag) {
  if (!isPlainObject(payload) || !target) return null
  const value = payload[blockName]
  if (!Array.isArray(value)) return null
  const notify = (event, extra) => {
    if (log && typeof log.notify === 'function') log.notify('OpsCenterSync', event, extra)
  }
  try {
    const n = target.applyRemote(value)
    notify(tag + '-replayed-late', { params: { applied: n } })
    return n
  } catch (e) {
    notify(tag + '-late-replay-error', { level: 'WARN', error: String((e && e.message) || e) })
    return null
  }
}

class OpsRuntimeSnapshot {
  constructor ({ store, log, seedPath, appDir, now } = {}) {
    this._store = store
    this._log = log || { info () {}, warn () {}, error () {}, notify () {} }
    this._now = typeof now === 'function' ? now : () => Date.now()
    this._seedPaths = seedPath ? [seedPath] : resolveSeedPaths({ appDir })
  }

  /** 存储侧读取（与 ops-center-sync 同口径：必须走 getSettingObject，再 JSON.parse 会读成 [object Object]） */
  _readSetting () {
    const store = this._store
    if (!store || typeof store.getSettingObject !== 'function') return {}
    try {
      const value = store.getSettingObject(SNAPSHOT_SETTING_KEY, {})
      return isPlainObject(value) ? value : {}
    } catch (e) {
      this._log.notify && this._log.notify('OpsRuntimeSnapshot', 'snapshot-read-failed', { level: 'WARN', error: String((e && e.message) || e) })
      return {}
    }
  }

  /**
   * 写 L2 快照（**完整原始 payload**）。仅在「拉取成功 + 验签通过」后由调用方调用；
   * 连接失败 / 契约破坏路径不调用本方法，这是 design §4.3 真值表的落点。
   */
  saveRawSnapshot (payload) {
    if (!this._store || typeof this._store.setSetting !== 'function') {
      return { ok: false, reason: 'store-unavailable' }
    }
    if (!isPlainObject(payload)) return { ok: false, reason: 'invalid-payload' }
    let text
    try { text = JSON.stringify(payload) } catch (e) { return { ok: false, reason: 'unserializable: ' + String((e && e.message) || e) } }
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > MAX_SNAPSHOT_BYTES) return { ok: false, reason: 'snapshot-exceeds-1MB' }
    const savedAt = new Date(this._now()).toISOString()
    try {
      this._store.setSetting(SNAPSHOT_SETTING_KEY, {
        savedAt,
        configHash: computeConfigHash(payload),
        configVersion: Number.isFinite(Number(payload.config_version)) ? Number(payload.config_version) : 0,
        bytes,
        payload,
      })
      return { ok: true, savedAt, configHash: computeConfigHash(payload), bytes }
    } catch (e) {
      this._log.notify && this._log.notify('OpsRuntimeSnapshot', 'snapshot-persist-failed', { level: 'WARN', error: String((e && e.message) || e) })
      return { ok: false, reason: String((e && e.message) || e) }
    }
  }

  /** L2 原始 payload；缺失 / 损坏 / 非对象一律 null（调用方据此降级到 L3） */
  readSnapshotPayload () {
    const record = this._readSetting()
    return isPlainObject(record.payload) ? record.payload : null
  }

  /** L2 元信息（保存时间 / hash / 版本），供启动日志与 ACK 判据使用 */
  readSnapshotMeta () {
    const record = this._readSetting()
    return {
      savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
      configHash: typeof record.configHash === 'string' ? record.configHash : '',
      configVersion: Number.isFinite(Number(record.configVersion)) ? Number(record.configVersion) : 0,
    }
  }

  /**
   * 探测种子文件。exists 与 usable 分开报：文件存在但超限/非法时 exists 仍为 true，
   * 否则启动日志会把「种子被拒」误报成「包内没有种子」，排查时找不到真因。
   */
  _probeSeed () {
    for (const candidate of this._seedPaths) {
      // 只按 fd 探测，不用 fs.statSync：种子在包内是 asar 里的文件，而 Electron 的 asar 兼容层
      // （asarStatsToFsStats）造 Stats 用的是 Node 已废弃的 fs.Stats 构造 ⇒ 打包版每次启动都往
      // stderr 吐一行 DEP0180。open+fstat 拿到同样的 isFile/size 且不触发那条路径（实测对照：
      // statSync/lstatSync/promises.stat 触发；existsSync/readFileSync/openSync+fstatSync 不触发）。
      // 一处已知边沿（外部评审命中）：若某候选 stat 得开但 open 打不开（Windows 共享占用/杀软瞬时持锁），
      // 旧码会报 exists:true，新码报 exists:false。降级行为两者完全一致（都不加载、回退内置默认），
      // 差的只是启动日志里那个诊断标注——排查日志时按这一条对照，不要把它读成「种子没打进包」。
      let fd = null
      let size = 0
      try {
        fd = fs.openSync(candidate, 'r')
        const stat = fs.fstatSync(fd)
        if (!stat.isFile()) continue
        size = stat.size
      } catch (_) {
        continue
      } finally {
        if (fd !== null) { try { fs.closeSync(fd) } catch (_) { /* 关不上不影响探测结论 */ } }
      }
      if (size > MAX_SNAPSHOT_BYTES) {
        this._log.notify && this._log.notify('OpsRuntimeSnapshot', 'seed-rejected', { level: 'WARN', params: { path: candidate, size } })
        return { path: candidate, size, exists: true, usable: false, payload: null }
      }
      let raw
      try { raw = JSON.parse(fs.readFileSync(candidate, 'utf8')) } catch (_) {
        this._log.notify && this._log.notify('OpsRuntimeSnapshot', 'seed-parse-failed', { level: 'WARN', params: { path: candidate, size } })
        return { path: candidate, size, exists: true, usable: false, payload: null }
      }
      if (!isPlainObject(raw)) return { path: candidate, size, exists: true, usable: false, payload: null }
      // 读取路径再次剔除词库：CI 是第一道防线，这里是第二道（本地/历史种子也可能是带词库的老版本）
      return { path: candidate, size, exists: true, usable: true, payload: stripContentWordList(raw) }
    }
    return { path: this._seedPaths[0] || '', size: 0, exists: false, usable: false, payload: null }
  }

  /** L3 种子；缺失或非法返回 null（调用方据此退回代码内置默认值，不阻断启动） */
  readSeed () {
    const probe = this._probeSeed()
    if (!probe.usable) return null
    const meta = isPlainObject(probe.payload._meta) ? probe.payload._meta : {}
    const payload = { ...probe.payload }
    delete payload._meta
    const staleDays = seedAgeDays(meta.exported_at, this._now())
    return {
      payload,
      meta: {
        configVersion: Number.isFinite(Number(meta.config_version)) ? Number(meta.config_version) : 0,
        configHash: typeof meta.config_hash === 'string' ? meta.config_hash : '',
        exportedAt: typeof meta.exported_at === 'string' ? meta.exported_at : '',
        source: typeof meta.source === 'string' ? meta.source : '',
      },
      staleDays: staleDays === null ? 0 : staleDays,
      path: probe.path,
    }
  }

  /** 种子存在性与新鲜度（供启动日志与降级事件标注层级用，不抛错） */
  getSeedStatus () {
    const probe = this._probeSeed()
    if (!probe.exists || !probe.usable) {
      return { exists: probe.exists, usable: probe.usable, path: probe.path, size: probe.size, stale: false, staleDays: 0, configHash: '' }
    }
    const meta = isPlainObject(probe.payload._meta) ? probe.payload._meta : {}
    const age = seedAgeDays(meta.exported_at, this._now())
    const staleDays = age === null ? 0 : age
    return {
      exists: true,
      usable: true,
      path: probe.path,
      size: probe.size,
      stale: staleDays > SEED_MAX_AGE_DAYS,
      staleDays,
      configHash: typeof meta.config_hash === 'string' ? meta.config_hash : '',
    }
  }
}

module.exports = {
  OpsRuntimeSnapshot,
  RUNTIME_BLOCKS,
  SEED_BLOCK_TYPES,
  SEED_RELATIVE_PATH,
  SEED_MAX_AGE_DAYS,
  SNAPSHOT_SETTING_KEY,
  MAX_SNAPSHOT_BYTES,
  canonicalJson,
  computeConfigHash,
  resolveSeedPaths,
  replayLateBlock,
  seedAgeDays,
  stripContentWordList,
  validateSeedPayload,
}