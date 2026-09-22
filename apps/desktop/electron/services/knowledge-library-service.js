// @ts-check
/**
 * KnowledgeLibraryService — 知识库业务服务
 *
 * 暴露给 IPC handler 的统一入口，封装参数校验与 store 调用。
 * 依赖：store（含 knowledge-library-store mixin 方法）
 */
const { ERROR } = require('../core/error-codes')

const PERSONAL_CATEGORIES = new Set([
  'personal_ip_persona', 'personal_background', 'personal_stories',
  'growth_experience', 'emotional_experience', 'work_experience',
  'project_experience', 'personal_opinions', 'family_stories',
])

class KnowledgeLibraryService {
  constructor (opts) {
    this._store = opts.store || null
    this._feishuClient = null
    this._patternExtraction = null
  }

  setFeishuClient (fc) {
    this._feishuClient = fc
  }

  /**
   * 注入模式卡片提取服务（入库后异步触发提取；可选依赖，未注入时跳过）
   */
  setPatternExtraction (pe) {
    this._patternExtraction = pe
  }

  _requireStore () {
    if (!this._store || typeof this._store.addViralItem !== 'function') {
      return { code: ERROR.REQUEST_ERROR, message: '知识库存储未就绪' }
    }
    return null
  }

  // ===================== 爆款库 =====================

  addToViral (item) {
    const err = this._requireStore()
    if (err) return err
    if (!item || typeof item !== 'object') return { code: ERROR.VALIDATION_ERROR, message: '参数无效' }
    if (typeof item.content !== 'string' || !item.content.trim()) {
      return { code: ERROR.VALIDATION_ERROR, message: '正文内容不能为空' }
    }
    const id = String(item.id || '') || this._genId()
    const resultId = this._store.addViralItem({ ...item, id })
    if (!resultId) return { code: ERROR.REQUEST_ERROR, message: '保存失败' }
    this._ensureAndTriggerPattern(resultId)
    return { code: ERROR.SUCCESS, data: { id: resultId } }
  }

  addViralBatch (items) {
    const err = this._requireStore()
    if (err) return err
    if (!Array.isArray(items) || items.length === 0) return { code: ERROR.VALIDATION_ERROR, message: '至少需要一条内容' }
    let count = 0
    for (const item of items) {
      const id = String(item.id || '') || this._genId()
      if (this._store.addViralItem({ ...item, id })) {
        count++
        this._ensureAndTriggerPattern(id)
      }
    }
    return { code: ERROR.SUCCESS, data: { count } }
  }

  /**
   * 入库后置钩子：建 pending 模式卡片 + 异步触发 LLM 提取（失败不阻塞入库）
   */
  _ensureAndTriggerPattern (viralItemId) {
    try {
      if (this._store && typeof this._store.ensurePatternCard === 'function') {
        this._store.ensurePatternCard(viralItemId)
      }
      if (this._patternExtraction && typeof this._patternExtraction.triggerExtraction === 'function') {
        this._patternExtraction.triggerExtraction()
      }
    } catch { /* 模式卡片后置钩子失败不影响入库主流程 */ }
  }

  /**
   * F-204：模式卡片队列状态（渲染端页头提示条）；store 缺方法（旧版）→ 0/0 fail-open。
   */
  getPatternQueueStats () {
    if (!this._store || typeof this._store.patternQueueStats !== 'function') {
      return { code: ERROR.SUCCESS, data: { pending: 0, deferred: 0 } }
    }
    const s = this._store.patternQueueStats()
    return { code: ERROR.SUCCESS, data: s }
  }

  listViral (params = {}) {
    const err = this._requireStore()
    if (err) return err
    const result = this._store.listViralItems(params)
    return { code: ERROR.SUCCESS, data: result }
  }

  getViral (id) {
    const err = this._requireStore()
    if (err) return err
    if (!id) return { code: ERROR.VALIDATION_ERROR, message: '缺少 id' }
    const item = this._store.getViralItem(id)
    if (!item) return { code: ERROR.NOT_FOUND, message: '条目不存在' }
    return { code: ERROR.SUCCESS, data: item }
  }

  updateViral (id, updates) {
    const err = this._requireStore()
    if (err) return err
    if (!id) return { code: ERROR.VALIDATION_ERROR, message: '缺少 id' }
    if (!updates || typeof updates !== 'object') return { code: ERROR.VALIDATION_ERROR, message: '缺少更新数据' }
    const ok = this._store.updateViralItem(id, updates)
    if (!ok) return { code: ERROR.REQUEST_ERROR, message: '更新失败' }
    return { code: ERROR.SUCCESS, data: null }
  }

  deleteViral (id) {
    const err = this._requireStore()
    if (err) return err
    if (!id) return { code: ERROR.VALIDATION_ERROR, message: '缺少 id' }
    const ok = this._store.deleteViralItem(id)
    if (!ok) return { code: ERROR.REQUEST_ERROR, message: '删除失败' }
    return { code: ERROR.SUCCESS, data: null }
  }

  searchViral (query, limit) {
    const err = this._requireStore()
    if (err) return err
    const items = this._store.searchViralItems(query, limit)
    return { code: ERROR.SUCCESS, data: items }
  }

  // ===================== 个人知识库 =====================

  addPersonal (item) {
    const err = this._requireStore()
    if (err) return err
    if (!item || typeof item !== 'object') return { code: ERROR.VALIDATION_ERROR, message: '参数无效' }
    if (typeof item.content !== 'string' || !item.content.trim()) {
      return { code: ERROR.VALIDATION_ERROR, message: '正文内容不能为空' }
    }
    if (!PERSONAL_CATEGORIES.has(String(item.category || ''))) {
      return { code: ERROR.VALIDATION_ERROR, message: '请选择有效的知识类别' }
    }
    const id = String(item.id || '') || this._genId()
    const resultId = this._store.addPersonalItem({ ...item, id })
    if (!resultId) return { code: ERROR.REQUEST_ERROR, message: '保存失败' }
    return { code: ERROR.SUCCESS, data: { id: resultId } }
  }

  addPersonalBatch (items) {
    const err = this._requireStore()
    if (err) return err
    if (!Array.isArray(items) || items.length === 0) return { code: ERROR.VALIDATION_ERROR, message: '至少需要一条内容' }
    let count = 0
    for (const item of items) {
      if (!item.content || !PERSONAL_CATEGORIES.has(String(item.category || ''))) continue
      const id = String(item.id || '') || this._genId()
      if (this._store.addPersonalItem({ ...item, id })) count++
    }
    return { code: ERROR.SUCCESS, data: { count } }
  }

  listPersonal (params = {}) {
    const err = this._requireStore()
    if (err) return err
    const result = this._store.listPersonalItems(params)
    return { code: ERROR.SUCCESS, data: result }
  }

  getPersonal (id) {
    const err = this._requireStore()
    if (err) return err
    if (!id) return { code: ERROR.VALIDATION_ERROR, message: '缺少 id' }
    const item = this._store.getPersonalItem(id)
    if (!item) return { code: ERROR.NOT_FOUND, message: '条目不存在' }
    return { code: ERROR.SUCCESS, data: item }
  }

  updatePersonal (id, updates) {
    const err = this._requireStore()
    if (err) return err
    if (!id) return { code: ERROR.VALIDATION_ERROR, message: '缺少 id' }
    if (!updates || typeof updates !== 'object') return { code: ERROR.VALIDATION_ERROR, message: '缺少更新数据' }
    const ok = this._store.updatePersonalItem(id, updates)
    if (!ok) return { code: ERROR.REQUEST_ERROR, message: '更新失败' }
    return { code: ERROR.SUCCESS, data: null }
  }

  deletePersonal (id) {
    const err = this._requireStore()
    if (err) return err
    if (!id) return { code: ERROR.VALIDATION_ERROR, message: '缺少 id' }
    const ok = this._store.deletePersonalItem(id)
    if (!ok) return { code: ERROR.REQUEST_ERROR, message: '删除失败' }
    return { code: ERROR.SUCCESS, data: null }
  }

  searchPersonal (query, limit) {
    const err = this._requireStore()
    if (err) return err
    const items = this._store.searchPersonalItems(query, limit)
    return { code: ERROR.SUCCESS, data: items }
  }

  // ===================== 批量导入 =====================

  async importFiles (files, categoryPerFile) {
    const err = this._requireStore()
    if (err) return err
    if (!Array.isArray(files) || files.length === 0) return { code: ERROR.VALIDATION_ERROR, message: '至少需要一个文件' }
    if (files.length > 20) return { code: ERROR.VALIDATION_ERROR, message: '单批最多20个文件' }

    const { parseFile, isSupportedFile } = require('./file-parser')
    const results = []
    for (let i = 0; i < files.length; i++) {
      const fp = files[i]
      try {
        if (!isSupportedFile(fp)) {
          results.push({ index: i, path: fp, error: '不支持的文件格式' })
          continue
        }
        const parsed = await parseFile(fp)
        if (!parsed.content || !parsed.content.trim()) {
          results.push({ index: i, path: fp, error: '文件内容为空' })
          continue
        }
        const cat = categoryPerFile && categoryPerFile[i] ? categoryPerFile[i] : 'personal_stories'
        if (!PERSONAL_CATEGORIES.has(cat)) {
          results.push({ index: i, path: fp, error: '无效的知识类别' })
          continue
        }
        const id = this._genId()
        const ok = this._store.addPersonalItem({
          id, category: cat,
          title: parsed.title || '',
          content: parsed.content,
          source_file: require('path').basename(fp),
          file_type: require('path').extname(fp).replace('.', ''),
        })
        results.push({ index: i, path: fp, id: ok ? id : null, title: parsed.title, ok: !!ok })
      } catch (e) {
        results.push({ index: i, path: fp, error: e.message })
      }
    }
    return { code: ERROR.SUCCESS, data: { total: files.length, results } }
  }

  // ===================== 飞书导出 =====================

  async exportViralToFeishu (title) {
    const err = this._requireStore()
    if (err) return err
    if (!this._feishuClient) return { code: ERROR.REQUEST_ERROR, message: '飞书客户端未配置' }
    const count = this._store.countViralItems()
    if (count === 0) return { code: ERROR.VALIDATION_ERROR, message: '爆款库为空，没有可导出的内容' }
    // Paginate through all items
    const pageSize = 50
    const totalPages = Math.ceil(count / pageSize)
    let allItems = []
    for (let p = 1; p <= totalPages; p++) {
      const { items } = this._store.listViralItems({ page: p, pageSize })
      allItems = allItems.concat(items)
    }
    // Build markdown content
    let md = '# ' + (title || '爆款库导出') + '\n\n'
    md += '> 导出时间：' + new Date().toLocaleString('zh-CN') + ' | 共 ' + count + ' 条\n\n'
    for (const item of allItems) {
      md += '## ' + (item.title || '(无标题)') + '\n\n'
      if (item.author) md += '**博主**：' + item.author + '\n\n'
      if (item.url) md += '**链接**：' + item.url + '\n\n'
      if (item.platform) md += '**平台**：' + item.platform + '\n\n'
      md += '**正文**：\n' + (item.content || '') + '\n\n'
      let tagList // 初值在 try/catch 两条路径都会被赋值，无需初始化（no-useless-assignment）
      try { tagList = JSON.parse(item.tags || '[]') } catch { tagList = [] }
      if (tagList.length) md += '**标签**：' + tagList.map(t => '#' + t).join(' ') + '\n\n'
      md += '**数据**：👍' + (item.likes || 0) + ' ⭐' + (item.collections || 0) + ' 💬' + (item.comments || 0) + '\n\n'
      if (item.published_at) md += '**发布时间**：' + item.published_at + '\n\n'
      md += '---\n\n'
    }
    try {
      const docId = await this._feishuClient.createDocument(title || '爆款库导出')
      await this._feishuClient.appendContent(docId, docId, md)
      return { code: ERROR.SUCCESS, data: { docId, count } }
    } catch (e) {
      return { code: ERROR.REQUEST_ERROR, message: '飞书导出失败: ' + e.message }
    }
  }

  async exportPersonalToFeishu (title) {
    const err = this._requireStore()
    if (err) return err
    if (!this._feishuClient) return { code: ERROR.REQUEST_ERROR, message: '飞书客户端未配置' }
    const count = this._store.countPersonalItems()
    if (count === 0) return { code: ERROR.VALIDATION_ERROR, message: '个人知识库为空，没有可导出的内容' }
    const pageSize = 50
    const totalPages = Math.ceil(count / pageSize)
    let allItems = []
    for (let p = 1; p <= totalPages; p++) {
      const { items } = this._store.listPersonalItems({ page: p, pageSize })
      allItems = allItems.concat(items)
    }
    // Group by category
    const groups = {}
    for (const item of allItems) {
      const cat = item.category || 'other'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(item)
    }
    let md = '# ' + (title || '个人知识库导出') + '\n\n'
    md += '> 导出时间：' + new Date().toLocaleString('zh-CN') + ' | 共 ' + count + ' 条 | ' + Object.keys(groups).length + ' 个类别\n\n'
    for (const [cat, items] of Object.entries(groups)) {
      md += '## ' + cat + '（' + items.length + '条）\n\n'
      for (const item of items) {
        md += '### ' + (item.title || '(无标题)') + '\n\n'
        md += (item.content || '') + '\n\n'
        if (item.source_file) md += '📄 来源：' + item.source_file + '\n\n'
        md += '---\n\n'
      }
    }
    try {
      const docId = await this._feishuClient.createDocument(title || '个人知识库导出')
      await this._feishuClient.appendContent(docId, docId, md)
      return { code: ERROR.SUCCESS, data: { docId, count, categories: Object.keys(groups).length } }
    } catch (e) {
      return { code: ERROR.REQUEST_ERROR, message: '飞书导出失败: ' + e.message }
    }
  }

  _genId () {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  }

  // ===================== P2 反馈闭环 =====================

  /**
   * 应用用户反馈，驱动被引用知识条目的置信度更新（采纳 +0.1 / 拒绝 -0.05）。
   * @param {string} action - 'adopted' | 'rejected'
   * @param {Array<{table: string, id: string}>} refs - 本次改写引用的知识条目
   * @returns {{code: number, data?: {boosted: number, penalized: number}}}
   */
  applyFeedback (action, refs) {
    const err = this._requireStore()
    if (err) return err
    if (action !== 'adopted' && action !== 'rejected') {
      return { code: ERROR.VALIDATION_ERROR, message: '反馈动作仅支持 adopted / rejected' }
    }
    if (!Array.isArray(refs) || refs.length === 0) {
      return { code: ERROR.SUCCESS, data: { boosted: 0, penalized: 0 } }
    }
    // 过滤非法 ref（table 白名单 + 非空 id），避免 SQL 注入
    const VALID_TABLES = new Set(['viral_library', 'personal_knowledge'])
    const validRefs = refs.filter(r => r && VALID_TABLES.has(r.table) && typeof r.id === 'string' && r.id)
    if (validRefs.length === 0) {
      return { code: ERROR.SUCCESS, data: { boosted: 0, penalized: 0 } }
    }
    try {
      const { feedbackBoost } = require('@multi-publish/rewrite-engine')
      const adopted = action === 'adopted' ? validRefs : []
      const rejected = action === 'rejected' ? validRefs : []
      feedbackBoost({ db: this._store.db }, adopted, rejected)
      const count = validRefs.length
      return { code: ERROR.SUCCESS, data: { boosted: action === 'adopted' ? count : 0, penalized: action === 'rejected' ? count : 0 } }
    } catch (e) {
      return { code: ERROR.REQUEST_ERROR, message: '反馈应用失败: ' + e.message }
    }
  }
}

module.exports = KnowledgeLibraryService
