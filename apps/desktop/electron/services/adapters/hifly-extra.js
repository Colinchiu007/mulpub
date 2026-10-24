// @ts-check
/**
 * hifly-extra.js — 飞影「辅助与作品管理」端点（prototype mixin）
 *
 * change: hifly-full-api。从 hifly.js 拆出（该文件已 465 行，max-lines 硬线 500），
 * 与 hifly-clone 同型的挂载方式：
 *   Object.assign(HiFlyAdapter.prototype, require('./hifly-extra').extraMethods)
 *
 * 覆盖 5 个此前未实现的端点：
 *   GET    /account/credit          查询账户积分（免费）
 *   GET    /video/lively_templates  查询网感模板列表（免费）
 *   GET    /project/cover_styles    查询封面模板列表（免费）
 *   POST   /project/covers          创建封面（**免费**）
 *   DELETE /video/task              删除作品（免费，仅普通视频创作任务）
 *
 * 计费口径（官方文档逐条核对，2026-10-24）：
 *   - 查询类全部免费；
 *   - **创建封面也是免费**（本项目里唯一免费的「创建」类端点，
 *     6 个创作端点 create_by_audio / create_by_template / translate /
 *     create_by_sing / create_by_image / audio/create_by_tts 全部标注「会产生积分消耗」）。
 *
 * 设计原则：所有分页/枚举参数在本地就校验。
 * 理由与服务端一致——越界请求会消耗一次往返，而服务端只回通用错误，
 * 用户不知道该改哪个值。
 */

const { ProviderError, ERROR_CODES } = require('./_base/provider-error')

/** 分页上限（官方：lively_templates 与 cover_styles 均为默认 20、最大 200）。 */
const MAX_PAGE_SIZE = 200

/**
 * 网感模板的画面方向（官方 type 枚举）。
 * 0 竖屏（默认）/ 1 横屏 / 2 方形 / 3 原始比例。
 */
const LIVELY_TEMPLATE_TYPES = Object.freeze([0, 1, 2, 3])

/** 封面画布比例（官方 canvas_preset 枚举）。 */
const COVER_CANVAS_PRESETS = Object.freeze(['9:16', '3:4'])

/** 封面输出格式（官方 output_format 枚举）。 */
const COVER_OUTPUT_FORMATS = Object.freeze(['jpg', 'png'])

/**
 * 校验并归一正整数分页参数。
 *
 * @param {any} raw 原值
 * @param {{ min: number, max?: number, field: string }} spec
 * @returns {number|undefined} 合法时返回数字；未传返回 undefined
 */
function normalizePositiveInt (raw, spec) {
  if (raw === undefined || raw === null || raw === '') return undefined
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isInteger(num) || num < spec.min) {
    throw new ProviderError(
      ERROR_CODES.INVALID_CONFIG,
      `${spec.field} must be an integer >= ${spec.min} (got ${String(raw)})`,
    )
  }
  if (spec.max !== undefined && num > spec.max) {
    throw new ProviderError(
      ERROR_CODES.INVALID_CONFIG,
      `${spec.field} must be <= ${spec.max} (got ${num})`,
    )
  }
  return num
}

/** 校验值必须属于给定枚举。 */
function assertInEnum (value, allowed, field) {
  if (value === undefined || value === null || value === '') return undefined
  if (!allowed.includes(value)) {
    throw new ProviderError(
      ERROR_CODES.INVALID_CONFIG,
      `${field} must be one of ${allowed.join('/')} (got ${String(value)})`,
    )
  }
  return value
}

const extraMethods = {
  /**
   * 查询账户积分（GET /account/credit）。
   *
   * 官方响应：`{ code, message, left, request_id }`——**没有 data 包裹**，
   * `left` 直接在顶层（真实调用核对过：`{ code: 0, left: 1582 }`）。
   *
   * 为什么单独校验 `left`：前端会用这个数字决定「还能不能生成」。
   * 缺失时若兜底成 0，UI 会显示「没积分了」——把一次接口异常变成用户以为的余额耗尽。
   * 非整数/负数同样拒（积分是整数，脏读数不可信）。
   *
   * @returns {Promise<{left: number}>}
   */
  async getAccountCredit () {
    const resp = await this._request('/account/credit', { method: 'GET' })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    // _decode 把顶层字段放进 data；若 data 本身是数字（服务端形态变化）也接受
    const raw = decoded.data
    const left = typeof raw === 'number' ? raw : raw && raw.left
    const num = typeof left === 'number' ? left : Number(left)
    if (!Number.isInteger(num) || num < 0) {
      throw new ProviderError(
        ERROR_CODES.PROVIDER_ERROR,
        `飞影未返回合法的积分余额 left（收到 ${JSON.stringify(left)}）`,
        { providerId: this.id },
      )
    }
    return { left: num }
  },

  /**
   * 查询网感模板列表（GET /video/lively_templates）。
   *
   * 官方参数：`template`（指定单个）/ `tag`（标签筛选）/ `title`（标题模糊）/
   * `page`（默认 1）/ `size`（默认 20，最大 200）/ `type`（0 竖屏默认、1 横屏、2 方形、3 原始比例）。
   *
   * `data` 非数组时抛错而不是返回 `[]`——空列表会被 UI 读成「平台没有模板」，
   * 而那是一次解析失败被伪装成业务结论。
   *
   * @returns {Promise<{templates: any[]}>}
   */
  async listLivelyTemplates (params = {}) {
    const page = normalizePositiveInt(params.page, { min: 1, field: 'page' })
    const size = normalizePositiveInt(params.size, { min: 1, max: MAX_PAGE_SIZE, field: 'size' })
    const type = normalizePositiveInt(params.type, { min: 0, max: 3, field: 'type' })
    if (type !== undefined && !LIVELY_TEMPLATE_TYPES.includes(type)) {
      throw new ProviderError(
        ERROR_CODES.INVALID_CONFIG,
        `type must be one of ${LIVELY_TEMPLATE_TYPES.join('/')} (got ${type})`,
      )
    }

    const query = {}
    if (page !== undefined) query.page = String(page)
    if (size !== undefined) query.size = String(size)
    if (type !== undefined) query.type = String(type)
    for (const key of ['template', 'tag', 'title']) {
      const v = params[key]
      if (typeof v === 'string' && v.trim()) query[key] = v.trim()
    }

    const resp = await this._request('/video/lively_templates', { method: 'GET', query })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    const data = decoded.data
    if (!Array.isArray(data)) {
      throw new ProviderError(
        ERROR_CODES.PROVIDER_ERROR,
        '飞影未返回模板列表 data（应为数组）',
        { providerId: this.id },
      )
    }
    return { templates: data }
  },

  /**
   * 查询封面模板列表（GET /project/cover_styles）。
   *
   * 官方参数：`page`（默认 1）/ `size`（默认 20，最大 200）/ `hifly_id`（仅第三方 token 需要，本应用不传）。
   *
   * @returns {Promise<{styles: any[]}>}
   */
  async listCoverStyles (params = {}) {
    const page = normalizePositiveInt(params.page, { min: 1, field: 'page' })
    const size = normalizePositiveInt(params.size, { min: 1, max: MAX_PAGE_SIZE, field: 'size' })

    const query = {}
    if (page !== undefined) query.page = String(page)
    if (size !== undefined) query.size = String(size)

    const resp = await this._request('/project/cover_styles', { method: 'GET', query })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    const data = decoded.data
    if (!Array.isArray(data)) {
      throw new ProviderError(
        ERROR_CODES.PROVIDER_ERROR,
        '飞影未返回封面模板列表 data（应为数组）',
        { providerId: this.id },
      )
    }
    return { styles: data }
  },

  /**
   * 创建封面（POST /project/covers）。**免费**——本项目唯一免费的创建类端点。
   *
   * 官方参数：
   *  - `template` 必填（封面模板标识，来自 cover_styles）；
   *  - `avatar` 可选（替换封面中的数字人形象）；
   *  - `content` 与 `slots` **至少填一项**（content 是自然语言文案，由服务端自动填槽；
   *    slots 是直接指定每个占位符的值）；
   *  - `canvas_preset` 可选：9:16（默认）/ 3:4；
   *  - `output_format` 可选：jpg（默认）/ png。
   *
   * 为什么 content 与 slots 要有「至少一项」的本地校验：
   * 两者都不给时服务端必然拒，但错误文案是通用的；本地拦能直接告诉用户「要么给文案、要么填槽位」。
   *
   * @returns {Promise<{coverUrl: string, raw: any}>}
   */
  async createCover (params = {}) {
    const template = typeof params.template === 'string' ? params.template.trim() : ''
    if (!template) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.template is required')
    }

    const content = typeof params.content === 'string' ? params.content.trim() : ''
    const slots = params.slots
    const hasSlots = Array.isArray(slots) && slots.length > 0
    if (!content && !hasSlots) {
      throw new ProviderError(
        ERROR_CODES.INVALID_CONFIG,
        'params.content or params.slots is required (at least one)',
      )
    }

    const canvasPreset = assertInEnum(params.canvasPreset, COVER_CANVAS_PRESETS, 'canvasPreset')
    const outputFormat = assertInEnum(params.outputFormat, COVER_OUTPUT_FORMATS, 'outputFormat')

    const body = { template }
    if (content) body.content = content
    if (hasSlots) body.slots = slots
    if (canvasPreset) body.canvas_preset = canvasPreset
    if (outputFormat) body.output_format = outputFormat
    if (typeof params.avatar === 'string' && params.avatar.trim()) {
      body.avatar = params.avatar.trim()
    }

    const resp = await this._request('/project/covers', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    const data = decoded.data || {}
    // 封面地址字段名未真实核对过（本轮未调用），按官方「创建封面」语义取常见命名并兜底
    const coverUrl = String(data.cover_url || data.coverUrl || data.url || '').trim()
    if (!coverUrl) {
      throw new ProviderError(
        ERROR_CODES.PROVIDER_ERROR,
        '飞影未返回封面图片地址',
        { providerId: this.id },
      )
    }
    return { coverUrl, raw: data }
  },

  /**
   * 删除作品（DELETE /video/task）。
   *
   * 官方约束：**仅支持普通视频创作任务 ID**，不支持视频翻译 / 唱歌 / 图片驱动返回的任务 ID。
   * adapter 侧无法本地判定任务来源（不记录），所以这条只能由服务端拒、原文透出；
   * 调用方应在 UI 上只对「普通视频创作」的作品给删除入口。
   *
   * @param {string} taskId
   * @returns {Promise<{ok: true}>}
   */
  async deleteWork (taskId) {
    const id = typeof taskId === 'string' ? taskId.trim() : ''
    if (!id) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.taskId is required')
    }
    const resp = await this._request('/video/task', {
      method: 'DELETE',
      query: { task_id: id },
    })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    return { ok: true }
  },
}

module.exports = {
  extraMethods,
  MAX_PAGE_SIZE,
  LIVELY_TEMPLATE_TYPES,
  COVER_CANVAS_PRESETS,
  COVER_OUTPUT_FORMATS,
  normalizePositiveInt,
  assertInEnum,
}
