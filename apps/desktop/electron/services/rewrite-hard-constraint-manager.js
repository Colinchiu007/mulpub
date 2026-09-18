// @ts-check
/**
 * RewriteHardConstraintManager - 改写硬约束运行时管理器
 *
 * 管理运营中心下发的改写硬约束（rewrite_hard_constraints），持久化到本地 JSON。
 * 硬约束是最高优先级的改写规则：无论改写模式和策略如何选择都强制生效，
 * 与策略/模式指令冲突时以硬约束为准。运营中心保证唯一默认版本（is_default）。
 *
 * Storage: JSON file (userData/rewrite-hard-constraints.json)
 */

const fs = require("fs")
const path = require("path")
const { app } = require("electron")
const log = require("./logger")

/** 硬约束内容最大长度（与 ops-center 后端校验一致） */
const MAX_CONTENT_LENGTH = 5000
/** 标题最大长度 */
const MAX_TITLE_LENGTH = 200

/**
 * 远程硬约束类型自防御：类型不符/超限返回 null（跳过）。
 * bootstrap 只下发默认版本（单对象），此处兼容数组取第一个默认项。
 * @returns {object|null} { title, content } 或 null
 */
function sanitizeRemoteHardConstraint (item) {
  if (!item || typeof item !== "object") return null
  // bootstrap 契约：单对象（默认版本）；兼容数组形态（取第一个 is_default 项）
  let raw = item
  if (Array.isArray(item)) {
    raw = item.find((x) => x && typeof x === "object" && x.is_default === true) || null
    if (!raw) return null
  }
  const content = typeof raw.content === "string" ? raw.content.trim() : ""
  if (!content || content.length > MAX_CONTENT_LENGTH) return null
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, MAX_TITLE_LENGTH) : ""
  return { title, content }
}

class RewriteHardConstraintManager {
  constructor(dataPath) {
    this._dataPath = dataPath || path.join(app.getPath("userData"), "rewrite-hard-constraints.json")
    this._current = null // { title, content } | null
    this._loaded = false
  }

  load() {
    try {
      if (fs.existsSync(this._dataPath)) {
        const parsed = JSON.parse(fs.readFileSync(this._dataPath, "utf-8"))
        this._current = sanitizeRemoteHardConstraint(parsed)
      }
    } catch (e) {
      log.warn("RewriteHardConstraintManager", "Failed to load: " + e.message)
    }
    this._loaded = true
  }

  save() {
    try {
      const dir = path.dirname(this._dataPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const tmpPath = this._dataPath + ".tmp"
      fs.writeFileSync(tmpPath, JSON.stringify(this._current, null, 2), "utf-8")
      fs.renameSync(tmpPath, this._dataPath)
    } catch (e) {
      log.warn("RewriteHardConstraintManager", "Failed to save: " + e.message)
    }
  }

  /**
   * 应用运营中心下发的硬约束（运行时下发，默认版本）。
   * @param {object|Array|null} payload - bootstrap 的 rewrite_hard_constraints 字段
   * @returns {boolean} 是否更新（内容变化时 true）
   */
  applyRemote(payload) {
    if (!this._loaded) this.load()
    const safe = sanitizeRemoteHardConstraint(payload)
    if (!safe) return false
    const changed = !this._current
      || this._current.content !== safe.content
      || this._current.title !== safe.title
    if (changed) {
      this._current = safe
      this.save()
    }
    return changed
  }

  /**
   * 获取当前硬约束内容（注入引擎用）。
   * @returns {string} 硬约束文本；未配置返回空串
   */
  getContent() {
    if (!this._loaded) this.load()
    return this._current ? this._current.content : ""
  }

  /** 获取当前硬约束完整信息（含标题；测试与诊断用） */
  getCurrent() {
    if (!this._loaded) this.load()
    return this._current ? { ...this._current } : null
  }
}

RewriteHardConstraintManager.MAX_CONTENT_LENGTH = MAX_CONTENT_LENGTH
RewriteHardConstraintManager.MAX_TITLE_LENGTH = MAX_TITLE_LENGTH
RewriteHardConstraintManager.sanitizeRemoteHardConstraint = sanitizeRemoteHardConstraint

module.exports = RewriteHardConstraintManager
