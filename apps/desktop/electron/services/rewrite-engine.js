// @ts-check
/**
 * RewriteEngineService — 改写引擎桥接层
 *
 * 桥接 @multi-publish/rewrite-engine 包 + aiGenerator 统一 provider 网关。
 * 改写策略运行时下发由 RewriteStrategyManager 提供，推理走 aiGenerator.generateWithDefault('llm')。
 * v3: 知识库使用 SQLite 持久化存储，质量评估可选 embedding 客户端。
 * v4: 三层 KnowledgeContextBuilder 集成（用户偏好 + 爆款库 + 个人知识库）。
 */

const { RewriteEngine, KnowledgeBase, RewriteQualityEvaluator, KnowledgeContextBuilder, extractWithLLM } = require("@multi-publish/rewrite-engine")
const { SensitiveFilter } = require("@multi-publish/rewrite-engine")
const { SQLiteStorage } = require("@multi-publish/rewrite-engine")
const log = require("./logger")

class RewriteEngineService {
  constructor(opts) {
    opts = opts || {}
    this._strategyManager = opts.strategyManager || null
    this._aiGenerator = opts.aiGenerator || null
    this._store = opts.store || null
    this._knowledgeLibrary = null
    this._engine = null
  }

  setStrategyManager(sm) {
    this._strategyManager = sm
    this._engine = null // setter 使缓存失效（审查 W-53：否则后续 rewrite 用旧依赖）
  }

  setAiGenerator(gen) {
    this._aiGenerator = gen
    this._engine = null
  }

  setStore(store) {
    this._store = store
    this._engine = null
  }

  /**
   * 设置知识库业务服务（三层融合的爆款库+个人知识库数据源）
   * @param {object} kl - KnowledgeLibraryService 实例
   */
  setKnowledgeLibrary(kl) {
    this._knowledgeLibrary = kl
    this._engine = null
  }

  /**
   * 设置 store（效果闭环：改写历史持久化；可选依赖，未注入时跳过历史记录）
   */
  setPerformanceStore(store) {
    this._perfStore = store || null
    this._engine = null
  }

  /**
   * 设置爆款潜力评分器（viral-rewrite-integration：第 4 评估维度；可选依赖）
   * @param {function} fn - async (text) => { score: number, mode: string }
   */
  setViralScorer(fn) {
    this._viralScorer = typeof fn === 'function' ? fn : null
    this._engine = null
  }

  _ensureEngine(force) {
    // 首次构建后复用引擎实例，避免每次 rewrite() 重建知识库/评估器
    if (this._engine && !force) return this._engine

    if (!this._strategyManager) {
      throw new Error("改写策略管理器未注入")
    }
    const llmClient = {
      chat: async (systemPrompt, userPrompt) => {
        if (!this._aiGenerator) {
          throw new Error("AI 推理网关未注入")
        }
        const result = await this._aiGenerator.generateWithDefault("llm", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        })
        return result && typeof result.content === "string" ? result.content : ""
      },
    }
    // 构建知识库（优先 SQLite，降级内存）
    let kb
    if (this._store && this._store.db) {
      const storage = new SQLiteStorage(this._store.db)
      kb = new KnowledgeBase({ storage })
    } else {
      kb = new KnowledgeBase()
    }
    kb.init()

    // 构建质量评估器（可选 embedding 客户端）
    let embeddingClient = null
    if (this._aiGenerator && typeof this._aiGenerator.getEmbedding === 'function') {
      embeddingClient = { getEmbedding: (text) => this._aiGenerator.getEmbedding(text) }
    }
    const qualityEvaluator = new RewriteQualityEvaluator({ embeddingClient })

    // 构建三层 KnowledgeContextBuilder（用户偏好 + 爆款库 + 个人知识库）
    let knowledgeLibrary = null
    if (this._knowledgeLibrary) {
      knowledgeLibrary = new KnowledgeContextBuilder({
        knowledgeBase: kb,
        // P1 模式卡片：注入聚合风格指导（卡片缺失/failed 自动回退浅层特征）
        patternCards: {
          get: (viralItemId) => {
            try {
              if (this._store && typeof this._store.getPatternCard === 'function') {
                return this._store.getPatternCard(viralItemId)
              }
            } catch { /* 卡片读取失败视为缺失 */ }
            return null
          },
        },
        // P0 检索修复：LLM 关键词兜底（规则提取为 0 词时触发）。
        // 复用包的 extractWithLLM（停用词过滤/围栏解析与包内单实现，杜绝双实现漂移）；
        // 10s 超时边界防 provider 挂起阻塞改写主流程。
        llmKeywords: async (text, topN) => {
          if (!this._aiGenerator) return []
          try {
            const chatClient = {
              chat: async (systemPrompt, userPrompt) => {
                // 超时计时器必须显式清理（审查 C-48：Promise.race 输家 rejection 未处理）
                let timer = null
                try {
                  const result = await Promise.race([
                    this._aiGenerator.generateWithDefault("llm", {
                      messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt },
                      ],
                    }),
                    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("LLM keyword timeout (10s)")), 10000) }),
                  ])
                  return result && typeof result.content === "string" ? result.content : ""
                } finally {
                  if (timer) clearTimeout(timer)
                }
              },
            }
            return await extractWithLLM(text, topN, chatClient)
          } catch (e) {
            log.warn("RewriteEngine", "LLM keyword fallback failed: " + (e && e.message))
            return [] // fail-open：LLM 兜底失败静默降级为规则关键词
          }
        },
        viralLibrary: {
          search: (query, limit) => {
            const res = this._knowledgeLibrary.searchViral(query, limit)
            return res && res.code === 0 ? res.data : []
          }
        },
        personalKnowledgeBase: {
          search: (query, limit) => {
            const res = this._knowledgeLibrary.searchPersonal(query, limit)
            return res && res.code === 0 ? res.data : []
          }
        }
      })
    }

    const engine = new RewriteEngine({
      llmClient,
      sensitiveFilter: new SensitiveFilter(),
      knowledgeBase: kb,
      qualityEvaluator,
      knowledgeLibrary,
      // viral-rewrite-integration：爆款潜力评分器（未注入时引擎跳过第 4 维）
      viralScorer: this._viralScorer || undefined,
    })
    // 将策略管理器中的策略注入引擎的策略管理器
    if (engine._strategyManager && typeof engine._strategyManager.mergeRemote === "function") {
      engine._strategyManager.clearRemote()
      engine._strategyManager.mergeRemote(this._strategyManager.listRemote())
    }
    this._engine = engine
    return engine
  }

  /**
   * 执行改写
   * @param {object} params - { mode, content, userSettings, strategyId }
   */
  async rewrite(params) {
    const engine = this._ensureEngine()
    const result = await engine.rewrite(params || {})

    // P2 效果闭环：改写成功后持久化历史（写失败仅记日志，不阻塞改写主流程）
    let rewriteHistoryId = null
    if (result && result.success && this._perfStore && typeof this._perfStore.addRewriteHistory === 'function') {
      try {
        rewriteHistoryId = this._perfStore.addRewriteHistory({
          mode: (params && params.mode) || 'imitate',
          originalContent: (params && params.content) || '',
          rewrittenContent: result.result || '',
          strategyId: (result.strategy && result.strategy.id) || '',
          knowledgeRefs: result.knowledgeRefs || [],
          matchedKeywords: (result.metadata && result.metadata.knowledgeKeywords) || [],
        })
      } catch (e) {
        log.warn("RewriteEngine", "rewrite history persist failed: " + (e && e.message))
      }
    }
    if (rewriteHistoryId) result.rewriteHistoryId = rewriteHistoryId
    return result
  }

  /** 列出所有可用策略（内置 + 远程，仅启用） */
  listStrategies() {
    if (!this._strategyManager) return []
    return this._strategyManager.listEnabled()
  }

  /** 获取推荐策略 */
  getRecommendedStrategies(userSettings) {
    const engine = this._ensureEngine()
    return engine.getRecommendedStrategies(userSettings || {})
  }
}

module.exports = RewriteEngineService
