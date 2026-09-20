// @ts-check
/**
 * Hot Topics IPC handlers — 热门选题模块前端桥接
 *
 * 通道：
 *   hot-topics:fetch      → HotTopicsService.fetchTopics({ force })
 *   hot-topics:get-cache  → HotTopicsService.getCache()
 */

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{ hotTopicsService: { fetchTopics: Function, getCache: Function }, store?: object, identityService?: object, log?: object }} deps
 */
function registerHandlers(ipcMain, deps) {
  const { hotTopicsService, store, identityService, log } = deps
  const logger = log || { info: () => {}, warn: () => {}, error: () => {} }
  const FAVORITES_KEY = 'hot_topics_favorites'

  function _getOwnerSubject() {
    if (!identityService) return null
    try {
      const state = identityService.getState()
      const sub = state && state.user && state.user.sub
      if (typeof sub === 'string' && sub.trim()) return sub.trim()
    } catch (_) { void _ }
    return null
  }

  function _readFavorites(owner) {
    if (!store || typeof store.getUserSetting !== 'function') return []
    const raw = store.getUserSetting(FAVORITES_KEY, [], owner)
    if (Array.isArray(raw)) return raw
    return []
  }

  function _writeFavorites(favorites, owner) {
    if (!store || typeof store.setUserSetting !== 'function') return
    store.setUserSetting(FAVORITES_KEY, favorites, owner)
  }

  // 白名单字段剥离：防止被攻陷渲染器传入超大/含多余字段的 topic 对象
  function _sanitizeTopic(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const id = typeof raw.id === 'string' ? raw.id.slice(0, 128) : ''
    const topic = typeof raw.topic === 'string' ? raw.topic.slice(0, 500) : ''
    if (!id || !topic) return null
    return {
      id,
      topic,
      channel: typeof raw.channel === 'string' ? raw.channel.slice(0, 32) : '',
      category: typeof raw.category === 'string' ? raw.category.slice(0, 32) : 'general',
      rank: Number.isFinite(Number(raw.rank)) ? Number(raw.rank) : null,
      hotValue: Number.isFinite(Number(raw.hotValue)) ? Number(raw.hotValue) : null,
      url: typeof raw.url === 'string' ? raw.url.slice(0, 2048) : null,
      fetchedAt: Number.isFinite(Number(raw.fetchedAt)) ? Number(raw.fetchedAt) : null,
    }
  }

  // deps 缺失时 warn + 跳过注册（不中断其他模块的 IPC 注册链），调用方会拿到 invoke 超时/不存在
  if (!hotTopicsService) {
    logger.warn('[hot-topics] deps.hotTopicsService missing, skip channel registration')
    return
  }

  ipcMain.handle('hot-topics:fetch', async (_event, payload) => {
    try {
      const force = !!(payload && payload.force)
      // 方案E/B：UI 显式指定待补拉分类（空分类「补拉该分类」按钮）；非法项剥离，上限 10
      const boostCategories = Array.isArray(payload && payload.boostCategories)
        ? payload.boostCategories.filter(c => typeof c === 'string' && c.length <= 32).slice(0, 10)
        : []
      const data = await hotTopicsService.fetchTopics({ force, boostCategories })
      return { code: 0, data }
    } catch (e) {
      logger.error('[hot-topics] fetch failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: 'HOT_TOPICS_FETCH_FAILED' }
    }
  })

  ipcMain.handle('hot-topics:get-cache', async () => {
    try {
      return { code: 0, data: hotTopicsService.getCache() }
    } catch (e) {
      logger.error('[hot-topics] get-cache failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: 'HOT_TOPICS_CACHE_FAILED' }
    }
  })

  // ── 收藏 CRUD（owner-scoped，复用 settings-store getUserSetting/setUserSetting）──
  ipcMain.handle('hot-topics:favorite-add', async (_event, payload) => {
    try {
      const owner = _getOwnerSubject()
      if (owner === null) return { code: -2, message: 'FAVORITE_AUTH_REQUIRED' }
      const topic = _sanitizeTopic(payload && payload.topic)
      if (!topic) return { code: -1, message: 'FAVORITE_INVALID_TOPIC' }
      const favorites = _readFavorites(owner)
      const existing = favorites.find(f => f.topic && f.topic.id === topic.id)
      if (existing) return { code: 0, data: existing }
      const entry = { topic, favoritedAt: Date.now() }
      favorites.unshift(entry)
      _writeFavorites(favorites, owner)
      return { code: 0, data: entry }
    } catch (e) {
      logger.error('[hot-topics] favorite-add failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: 'FAVORITE_ADD_FAILED' }
    }
  })

  ipcMain.handle('hot-topics:favorite-remove', async (_event, payload) => {
    try {
      const owner = _getOwnerSubject()
      if (owner === null) return { code: -2, message: 'FAVORITE_AUTH_REQUIRED' }
      const topicId = payload && payload.topicId
      if (!topicId) return { code: -1, message: 'FAVORITE_INVALID_TOPIC_ID' }
      const favorites = _readFavorites(owner)
      const idx = favorites.findIndex(f => f.topic && f.topic.id === topicId)
      if (idx === -1) return { code: 0, data: false }
      favorites.splice(idx, 1)
      _writeFavorites(favorites, owner)
      return { code: 0, data: true }
    } catch (e) {
      logger.error('[hot-topics] favorite-remove failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: 'FAVORITE_REMOVE_FAILED' }
    }
  })

  ipcMain.handle('hot-topics:favorite-list', async () => {
    try {
      const owner = _getOwnerSubject()
      if (owner === null) return { code: -2, message: 'FAVORITE_AUTH_REQUIRED', data: [] }
      const favorites = _readFavorites(owner)
      return { code: 0, data: favorites }
    } catch (e) {
      logger.error('[hot-topics] favorite-list failed:', e && e.message ? e.message : String(e))
      return { code: -99, message: 'FAVORITE_LIST_FAILED', data: [] }
    }
  })
}

module.exports = registerHandlers
