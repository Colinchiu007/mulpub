// @ts-check
/**
 * Store IPC handlers
 *
 * 安全：所有渲染进程入口都校验来源，账号查询只返回公开字段。
 */
function registerHandlers(ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  const { app, store, pythonBridge, identityService } = deps
  const credentialStore = deps.credentialStore || deps.AccountManager?.credentialStore
  const accountStateRestorer = deps.accountStateRestorer || deps.AccountManager?.accountStateRestorer
  const publicAccountFields = [
    'id', 'platform', 'name', 'account_name', 'username', 'avatar', 'avatar_url',
    'status', 'is_active', 'is_default', 'has_cookies', 'cookie_count',
    'has_auth_data', 'last_validated', 'created_at', 'updated_at', 'auth_method',
  ]
  const rendererAccountUpdateFields = new Set([
    // 不含 'status'：登录态唯一写者在主进程（AccountManager.persistLoginState → 后端 PATCH）。
    // 渲染层曾借该字段把 UI 词表的 inactive 写进本地 SQLite，而读取方看的是后端 JSON，
    // 于是「批量启用/停用」既污染登录态语义又对展示无效。
    'name', 'account_name', 'avatar', 'avatar_url', 'is_default', 'last_validated',
  ])
  const rendererAccountCreateFields = new Set([
    'id', 'platform', 'name', 'avatar', 'status',
  ])

  /**
   * 从 identityService 提取当前登录用户的 sub（owner_subject）
   * @returns {string|undefined|null}
   *   - string: 当前用户 sub
   *   - undefined: identityService 不存在（legacy 模式，不隔离）
   *   - null: identityService 存在但 sub 缺失（应拒绝访问）
   */
  function _getOwnerSubject() {
    if (!identityService) return undefined
    try {
      const state = identityService.getState()
      const subject = state && state.user && state.user.sub
      if (typeof subject === 'string' && subject.trim()) return subject.trim()
    } catch (_) { void _ }
    return null
  }

  function toRendererAccountCreate(account) {
    if (!account || typeof account !== 'object' || Array.isArray(account)) return null
    // 兼容旧版渲染层残留字段，但绝不把它传入 Store；真实归属只来自 identityService。
    const { owner_subject: _untrustedOwner, ...publicAccount } = account
    const entries = Object.entries(publicAccount)
    if (entries.some(([key]) => !rendererAccountCreateFields.has(key))) return null
    return Object.fromEntries(entries)
  }

  function toPublicAccount(account) {
    const source = account && typeof account === 'object' ? account : {}
    const safeAccount = {}
    for (const key of publicAccountFields) {
      if (source[key] !== undefined) safeAccount[key] = source[key]
    }
    if (Object.prototype.hasOwnProperty.call(source, 'cookies')) {
      const cookies = Array.isArray(source.cookies) ? source.cookies : []
      safeAccount.has_cookies = cookies.length > 0
      safeAccount.cookie_count = cookies.length
    }
    if (Object.prototype.hasOwnProperty.call(source, 'localStorage')) {
      const localStorageData = source.localStorage
      safeAccount.has_auth_data = Boolean(
        localStorageData && typeof localStorageData === 'object' && Object.keys(localStorageData).length > 0,
      )
    }
    return {
      ...safeAccount,
      account_name: safeAccount.account_name || safeAccount.name || '',
      // 启用态与登录态正交：本地库缺 status 时诚实回落 unverified，不得由 is_active 派生。
      status: safeAccount.status || 'unverified',
      is_default: Boolean(safeAccount.is_default),
    }
  }

  function hasScopedSettingsApi() {
    return typeof store.getUserSetting === 'function' && typeof store.setUserSetting === 'function'
  }

  function parseDrafts(raw) {
    if (Array.isArray(raw)) return raw
    if (typeof raw !== 'string') return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch (_) {
      return []
    }
  }

  /**
   * 草稿 id 归一化（draft-batch-delete）。
   *
   * 为什么要归一化：草稿 id 有三个来源——渲染层 `draft_<ts>`、采集页历史载荷、
   * 以及导入/迁移数据，历史上出现过缺 id 与数字 id。删除是按 id 过滤的，
   * `"1" !== 1`、`undefined !== undefined` 这两类假阴性会让「点了删除但草稿还在」，
   * 因此比较一律走字符串口径。
   * @param {unknown} id
   * @returns {string} 空串 = 无有效 id
   */
  function normalizeDraftId(id) {
    if (id === null || id === undefined) return ''
    return String(id).trim()
  }

  /**
   * 给「缺 id / id 重复」的草稿补齐稳定 id（读取侧惰性迁移）。
   *
   * 历史草稿可能是采集页早期版本写入的（当时 id 期待由主进程生成，而主进程
   * 只做了 spread），这类条目在 UI 上既无法定位也无法按 id 删除——这是
   * 「草稿删不掉」的结构性根因。补出来的 id 由 list 落盘一次，之后保持稳定。
   * @param {Array} drafts
   * @returns {{ drafts: Array, changed: boolean }}
   */
  function ensureDraftIds(drafts) {
    const seen = new Set()
    let changed = false
    const normalized = drafts.map((draft, index) => {
      if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return draft
      const id = normalizeDraftId(draft.id)
      if (id && !seen.has(id)) {
        seen.add(id)
        if (id === draft.id) return draft
        changed = true
        return { ...draft, id }
      }
      const stamp = normalizeDraftId(draft.createdAt).replace(/\D/g, '').slice(0, 14)
      const nextId = `draft_legacy_${stamp || 'na'}_${index}`
      seen.add(nextId)
      changed = true
      return { ...draft, id: nextId }
    })
    return { drafts: normalized, changed }
  }

  /**
   * 解析删除入参：单个 id 或 id 数组（批量）。
   * 空数组/全空值一律返回 []，由调用方 fail-closed —— 绝不能把「没指定任何 id」
   * 当成「删除全部」。
   */
  function parseDeleteIds(payload) {
    const list = Array.isArray(payload) ? payload : [payload]
    return [...new Set(list.map(normalizeDraftId).filter(Boolean))]
  }

  /**
   * 按内容指纹定位草稿（publish-fail-draft-guard）：
   * 既有草稿带 _fp 直接比对；历史数据无 _fp 时现算指纹参与比对（读取侧惰性迁移）。
   * @param {Array} drafts
   * @param {string} fp - computeDraftFingerprint 产出的内容指纹
   * @returns {number} 命中下标，未命中 -1
   */
  function findDraftIndexByFingerprint(drafts, fp) {
    if (!Array.isArray(drafts)) return -1
    const { computeDraftFingerprint } = require('../services/draft-fingerprint')
    return drafts.findIndex(d => d && typeof d === 'object' && (
      d._fp === fp || (!d._fp && computeDraftFingerprint(d) === fp)
    ))
  }

  function getUserDataDir() {
    if (typeof deps.userDataDir === 'string' && deps.userDataDir) return deps.userDataDir
    try { return app && typeof app.getPath === 'function' ? app.getPath('userData') : null } catch (_) { return null }
  }

  ipcMain.handle('store:add-account', withSenderCheck((_, account) => {
    try {
      const safeAccount = toRendererAccountCreate(account)
      if (!safeAccount) {
        return { code: EC.VALIDATION_ERROR, message: '账号创建仅支持公开字段' }
      }
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      if (owner !== undefined) {
        const ok = store.addAccount(safeAccount, owner)
        return { code: ok ? 0 : EC.REQUEST_ERROR, data: ok }
      }
      const ok = store.addAccount(safeAccount)
      return { code: ok ? 0 : EC.REQUEST_ERROR, data: ok }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('store:get-account', withSenderCheck((_, id) => {
    try {
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      const account = owner !== undefined ? store.getAccount(id, owner) : store.getAccount(id)
      return { code: account ? 0 : EC.NOT_FOUND, data: account ? toPublicAccount(account) : null }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('store:list-accounts', withSenderCheck((_, platform) => {
    try {
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户', data: [] }
      const accounts = owner !== undefined ? store.listAccounts(platform, owner) : store.listAccounts(platform)
      return { code: 0, data: accounts.map(toPublicAccount) }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message, data: [] }
    }
  }))

  ipcMain.handle('store:delete-account', withSenderCheck((_, id) => {
    try {
      if (id === null || id === undefined || id === '') {
        return { code: EC.VALIDATION_ERROR, message: '账号不能为空' }
      }
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      const account = owner !== undefined ? store.getAccount(id, owner) : store.getAccount(id)
      if (!account) return { code: EC.NOT_FOUND, message: '账号不存在' }
      const platform = account.platform || ''
      const userDataDir = getUserDataDir()
      let credentialSnapshot = null
      let credentialDeleted = false
      if (credentialStore && credentialStore.deleteCredential) {
        if (!userDataDir) return { code: EC.REQUEST_ERROR, message: '无法解析账号凭据目录' }
        const hasCredential = typeof credentialStore.hasCredential === 'function'
          ? (owner !== undefined
              ? credentialStore.hasCredential(id, userDataDir, owner)
              : credentialStore.hasCredential(id, userDataDir))
          : true
        const ownerArgs = owner !== undefined ? [owner] : []
        const deleteArgs = [id, userDataDir, ...ownerArgs]
        if (hasCredential) {
          if (typeof credentialStore.loadCredential !== 'function' || typeof credentialStore.saveCredential !== 'function') {
            return { code: EC.REQUEST_ERROR, message: '账号凭据无法安全备份' }
          }
          credentialSnapshot = credentialStore.loadCredential(...deleteArgs)
          if (!credentialSnapshot || typeof credentialSnapshot !== 'object') {
            return { code: EC.REQUEST_ERROR, message: '账号凭据无法安全备份' }
          }
        }
        if (hasCredential && credentialStore.deleteCredential(...deleteArgs) !== true) {
          // 凭据删除失败不阻断账号元数据删除（与 account-manager.js 对齐）
          console.warn('store:delete-account', '加密凭据文件删除失败，继续删除账号元数据: ' + id)
        }
        credentialDeleted = hasCredential
      }
      const deleted = owner !== undefined ? store.deleteAccount(id, owner) : store.deleteAccount(id)
      if (!deleted) {
        if (credentialDeleted && credentialSnapshot && credentialStore && typeof credentialStore.saveCredential === 'function') {
          const restoreArgs = [id, credentialSnapshot, userDataDir, ...(owner === undefined ? [] : [owner])]
          if (credentialStore.saveCredential(...restoreArgs) !== true) {
            return { code: EC.REQUEST_ERROR, message: '删除账号失败，凭据恢复失败' }
          }
        }
        return { code: EC.REQUEST_ERROR, message: '删除账号失败' }
      }
      if (accountStateRestorer && accountStateRestorer.deleteAccountRecordsById) {
        try {
          if (owner !== undefined) accountStateRestorer.deleteAccountRecordsById(id, owner, userDataDir)
          else accountStateRestorer.deleteAccountRecordsById(id)
        } catch (e) { /* 公开状态清理不覆盖删除结果 */ }
      } else if (accountStateRestorer && accountStateRestorer.deleteAccountRecord) {
        try {
          if (owner !== undefined) {
            accountStateRestorer.deleteAccountRecord(platform, id, owner, userDataDir)
          } else {
            accountStateRestorer.deleteAccountRecord(platform, id)
          }
        } catch (e) { /* 兼容旧实现 */ }
      }
      return { code: 0, data: true }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('store:set-default-account', withSenderCheck(async (_, arg) => {
    try {
      // R51 P1：解构保护
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { platform, accountId } = arg
      if (typeof platform !== 'string' || !platform.trim() || accountId === null || accountId === undefined || accountId === '') {
        return { code: EC.VALIDATION_ERROR, message: '平台和账号不能为空' }
      }
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      const updated = owner !== undefined
        ? store.setDefaultAccount(platform, accountId, owner)
        : store.setDefaultAccount(platform, accountId)
      if (!updated) {
        if (owner !== undefined) {
          return { code: EC.VALIDATION_ERROR, message: '账号不存在或不属于指定平台' }
        }
        if (!pythonBridge || typeof pythonBridge.requestBackend !== 'function') {
          return { code: EC.VALIDATION_ERROR, message: '账号不存在或不属于指定平台' }
        }
        const response = await pythonBridge.requestBackend('GET', '/api/accounts')
        const matched = response?.code === 0 && Array.isArray(response.data) && response.data.some(account =>
          String(account.id) === String(accountId) && account.platform === platform
        )
        if (!matched) return { code: EC.VALIDATION_ERROR, message: '账号不存在或不属于指定平台' }
      }
      // Logto 用户模式的默认账号已保存到 owner_subject 作用域，禁止再写全局旧设置。
      if (owner === undefined && typeof store.setSetting === 'function') {
        store.setSetting(`default_account:${platform}`, String(accountId))
      }
      return { code: 0, data: true }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('store:get-default-account', withSenderCheck((_, platform) => {
    try {
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      const account = owner !== undefined
        ? store.getDefaultAccount(platform, owner)
        : store.getDefaultAccount(platform)
      return { code: account ? 0 : EC.NOT_FOUND, data: account ? toPublicAccount(account) : null }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('store:update-account', withSenderCheck((_, arg) => {
    try {
      // R51 P1：解构保护
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { id, fields } = arg
      if (id === null || id === undefined || id === '') return { code: EC.VALIDATION_ERROR, message: '账号不能为空' }
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length === 0) {
        return { code: EC.VALIDATION_ERROR, message: '缺少可更新字段' }
      }
      const safeFields = Object.fromEntries(
        Object.entries(fields).filter(([key]) => rendererAccountUpdateFields.has(key)),
      )
      if (Object.keys(safeFields).length === 0) {
        return { code: EC.VALIDATION_ERROR, message: '没有可更新的账号字段' }
      }
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      const account = owner !== undefined ? store.getAccount(id, owner) : store.getAccount(id)
      if (!account) return { code: EC.NOT_FOUND, message: '账号不存在' }
      const updated = owner !== undefined
        ? store.updateAccount(id, safeFields, owner)
        : store.updateAccount(id, safeFields)
      if (!updated) return { code: EC.VALIDATION_ERROR, message: '没有可更新的账号字段' }
      return { code: 0, data: true }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('store:add-publish-record', withSenderCheck((_, record) => {
    try {
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      const id = owner !== undefined ? store.addPublishRecord(record, owner) : store.addPublishRecord(record)
      return { code: id ? 0 : EC.REQUEST_ERROR, data: { id } }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('store:list-publish-history', withSenderCheck((_, opts) => {
    try {
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户', data: { total: 0, records: [] } }
      const result = owner !== undefined ? store.listPublishHistory(opts, owner) : store.listPublishHistory(opts)
      return { code: 0, data: result }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message, data: { total: 0, records: [] } }
    }
  }))

  ipcMain.handle('store:get-publish-stats', withSenderCheck(() => {
    try {
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户', data: { total: 0, success: 0, failed: 0, byPlatform: {} } }
      const result = owner !== undefined ? store.getPublishStats(owner) : store.getPublishStats()
      return { code: 0, data: result }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message, data: { total: 0, success: 0, failed: 0, byPlatform: {} } }
    }
  }))

  // 2026-10-02 死路径清理：原先另有 3 个 IPC —— store:add-scheduled-task /
  // store:list-scheduled-tasks / store:delete-task（经由 store/scheduler-store.js 读写
  // SQLite scheduled_tasks 表）。它们**零渲染层调用**（全仓 grep 只有测试引用），
  // 而定时发布的真实调度器走 JSONL `scheduled-tasks.jsonl`（shared-utils/scheduler.js）
  // 与 BatchManager，二者与 SQLite 表无关。留着等于对外暴露一条「看起来能管理定时任务、
  // 实际没有任何界面在用」的假接口，故连同 preload 暴露一并删除。
  // `scheduled_tasks` 表本身保留：base-store.migrateFromJsonl 仍写入、account-store
  // 删除账号时级联清理仍读取（表是历史迁移载体，不是活的功能面）。

  ipcMain.handle('store:get-setting', withSenderCheck((_, key) => {
    try {
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      if (owner !== undefined) {
        if (typeof store.getUserSetting !== 'function') return { code: EC.REQUEST_ERROR, message: '用户设置存储不可用' }
        return { code: 0, data: store.getUserSetting(key, null, owner) }
      }
      return { code: 0, data: store.getSetting(key) }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('store:set-setting', withSenderCheck((_, key, value) => {
    try {
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      if (owner !== undefined) {
        if (typeof store.setUserSetting !== 'function') return { code: EC.REQUEST_ERROR, message: '用户设置存储不可用' }
        store.setUserSetting(key, value, owner)
      } else {
        store.setSetting(key, value)
      }
      return { code: 0, data: true }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  ipcMain.handle('store:list-callback-logs', withSenderCheck((_, limit) => {
    try {
      return { code: 0, data: store.listCallbackLogs(limit) }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message, data: [] }
    }
  }))

  // ─── 草稿箱 IPC handlers（参考产品复用）─────────────────
  // 内容指纹幂等（publish-fail-draft-guard）：同一份内容（内容指纹相同）无论手动保存
  // 多少次、失败自动回存后再手动保存多少次，草稿箱只保留一条——命中即原地更新
  // （保留原 id/createdAt），绝不追加第二条。去重真源只在主进程这一处；
  // 指纹只含内容字段，publishTime/platforms/accounts 等发布指向性元数据不参与。
  ipcMain.handle('draftSave', withSenderCheck((_, draft) => {
    try {
      if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
        return { code: EC.REQUEST_ERROR, message: '草稿内容无效' }
      }
      const { computeDraftFingerprint } = require('../services/draft-fingerprint')
      const fp = computeDraftFingerprint(draft)
      const now = new Date().toISOString()
      // id 兜底由主进程负责：渲染层漏传 id 时若原样落库，该草稿在草稿箱里
      // 既没有稳定 key 也无法按 id 删除（「删不掉」的结构性根因之一）。
      const draftId = normalizeDraftId(draft.id) || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      if (owner !== undefined) {
        if (!hasScopedSettingsApi()) return { code: EC.REQUEST_ERROR, message: '草稿存储不可用' }
        const drafts = parseDrafts(store.getUserSetting('drafts', [], owner))
        const idx = findDraftIndexByFingerprint(drafts, fp)
        if (idx >= 0) {
          const merged = { ...drafts[idx], ...draft, id: drafts[idx].id, createdAt: drafts[idx].createdAt, updatedAt: now, _fp: fp }
          drafts[idx] = merged
          store.setUserSetting('drafts', JSON.stringify(drafts), owner)
          return { code: 0, data: { draftId: merged.id, reused: true } }
        }
        drafts.push({ ...draft, id: draftId, createdAt: now, updatedAt: now, _fp: fp })
        store.setUserSetting('drafts', JSON.stringify(drafts), owner)
        return { code: 0, data: { draftId, reused: false } }
      }
      const raw = store.getSetting('drafts') || '[]'
      const drafts = typeof raw === 'string' ? JSON.parse(raw) : raw
      const idx = findDraftIndexByFingerprint(drafts, fp)
      if (idx >= 0) {
        const merged = { ...drafts[idx], ...draft, id: drafts[idx].id, createdAt: drafts[idx].createdAt, updatedAt: now, _fp: fp }
        drafts[idx] = merged
        store.setSetting('drafts', JSON.stringify(drafts))
        return { code: 0, data: { draftId: merged.id, reused: true } }
      }
      drafts.push({ ...draft, id: draftId, createdAt: now, updatedAt: now, _fp: fp })
      store.setSetting('drafts', JSON.stringify(drafts))
      return { code: 0, data: { draftId, reused: false } }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))

  // 草稿列表：读取时顺手补齐历史缺 id（惰性迁移一次）。不补的话这些条目在 UI 上
  // 既没有稳定 v-for key，也无法按 id 删除——「草稿删不掉」的结构性根因。
  ipcMain.handle('draftList', withSenderCheck(() => {
    try {
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户', data: [] }
      if (owner !== undefined) {
        if (!hasScopedSettingsApi()) return { code: EC.REQUEST_ERROR, message: '草稿存储不可用', data: [] }
        const { drafts, changed } = ensureDraftIds(parseDrafts(store.getUserSetting('drafts', [], owner)))
        if (changed) store.setUserSetting('drafts', JSON.stringify(drafts), owner)
        return { code: 0, data: drafts }
      }
      const { drafts, changed } = ensureDraftIds(parseDrafts(store.getSetting('drafts') || '[]'))
      if (changed) store.setSetting('drafts', JSON.stringify(drafts))
      return { code: 0, data: drafts }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message, data: [] }
    }
  }))

  // 草稿删除（draft-batch-delete）：入参是「单个 id」或「id 数组（批量）」，
  // 一次读写完成，天然原子。批量不做 N 次单删的原因：N 次 = N 次落盘，中途失败
  // 会留下半删状态，UI 也无法如实汇报部分成功。返回值
  // { requested, deleted, remaining } 供前端提示「选中的 N 条里有 M 条已不存在」。
  ipcMain.handle('draftDelete', withSenderCheck((_, payload) => {
    try {
      const ids = parseDeleteIds(payload)
      // fail-closed：没指定 id 绝不能退化成「删除全部」。
      if (ids.length === 0) return { code: EC.REQUEST_ERROR, message: '缺少草稿 id' }
      const owner = _getOwnerSubject()
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      const idSet = new Set(ids)
      const dropById = (drafts) => {
        const kept = drafts.filter(draft => !idSet.has(normalizeDraftId(draft && draft.id)))
        return { kept, deleted: drafts.length - kept.length }
      }
      if (owner !== undefined) {
        if (!hasScopedSettingsApi()) return { code: EC.REQUEST_ERROR, message: '草稿存储不可用' }
        const { kept, deleted } = dropById(parseDrafts(store.getUserSetting('drafts', [], owner)))
        if (deleted > 0) store.setUserSetting('drafts', JSON.stringify(kept), owner)
        return { code: 0, data: { requested: ids.length, deleted, remaining: kept.length } }
      }
      const { kept, deleted } = dropById(parseDrafts(store.getSetting('drafts') || '[]'))
      if (deleted > 0) store.setSetting('drafts', JSON.stringify(kept))
      return { code: 0, data: { requested: ids.length, deleted, remaining: kept.length } }
    } catch (e) {
      return { code: EC.REQUEST_ERROR, message: e.message }
    }
  }))
}

module.exports = registerHandlers

