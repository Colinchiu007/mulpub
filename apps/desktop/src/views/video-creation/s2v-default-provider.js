// @ts-check
/**
 * s2v-default-provider —— 「流水线生成器下拉该默认选中谁」的唯一判定实现。
 *
 * 拆分理由：CI 债务熔断对单文件有 500 行上限（scripts/check-debt-budget.js /
 * .github/scripts/check-max-lines.js 的 NEW_OVER_LIMIT），create-view-module-utils.js
 * 已接近上限，故按子域单独成文件。
 *
 * 背景（2026-10-18 Bug 修复）：用户在「模型设置」把某类别模型设为默认、或把多模态模型
 * 的某能力（如 MiniMax 的 TTS）设为默认后，视频创作各流水线页的生成器下拉仍默认旧模型。
 * 根因是前端从未读取「谁是默认」，只按 listProviders 的 `ORDER BY is_default DESC`
 * 排序副作用取首项。
 *
 * 判定口径与主进程 ModelProviderManager._multimodalProviderFor **逐条对齐**，
 * 避免出现「设置里显示默认 A、下拉默认 B」的双源真相。
 */

/**
 * 解析某能力（tts/image/video）在流水线生成器下拉中应默认选中的 provider id。
 *
 * 判定口径（与主进程一致）：
 *   - 普通 provider（`category !== 'multimodal'`）：`is_default === true`
 *   - 多模态 provider：`config.capability_defaults` 含该能力，**或**整体 `is_default === true`
 *     （旧版「多模态整体默认」等价于其所有已声明能力均为默认）
 *   - 多模态 provider 还必须 `capabilities` 含该能力，否则其「默认」不适用于本下拉 ——
 *     防止 image 默认的多模态抢走 tts 下拉的默认位
 *
 * 优先级（自上而下，取第一个命中）：
 *   1. `preferredId`（主进程 `getDefault(category)` 返回值）——
 *      须在候选列表内 **且** 通过上面的口径校验，否则忽略（绝不返回悬空 id）
 *   2. 候选列表内第一个满足口径的
 *   3. 候选列表首项（保持 2026-08-12 起的旧兜底，保证「无任何默认」时行为不回退）
 *   4. 候选列表为空 → `''`（上游渲染「自动 Edge TTS」/「无」占位）
 *
 * 「用户显式选择」由调用方在传入前处理（显式选择优先于默认），本函数只回答
 * 「没有显式选择时该选谁」。
 *
 * 全分支 fail-closed 不抛错（脏入参一律降级到下一档）。
 *
 * @param {Array<object>|null|undefined} providers 候选 provider 列表（已过滤 enabled+configured）
 * @param {string} category 能力/类别：tts / image / video
 * @param {string} [preferredId] 优先尝试的 id（如主进程 getDefault 返回值）
 * @returns {string} provider id；无候选时返回空串
 */
export function resolveS2VDefaultProviderId(providers, category, preferredId) {
  if (!Array.isArray(providers) || providers.length === 0) return ''
  const cap = typeof category === 'string' ? category.trim() : ''
  const candidates = providers.filter(p => p && typeof p === 'object' && typeof p.id === 'string' && p.id)

  const isDefaultFor = (p) => {
    if (p.is_default === true) return true
    const cfg = p.config && typeof p.config === 'object' && !Array.isArray(p.config) ? p.config : null
    if (!cfg || !Array.isArray(cfg.capability_defaults)) return false
    return cfg.capability_defaults.includes(cap)
  }

  // 多模态必须声明支持该能力，否则其「默认」不适用于本下拉
  const supportsCapability = (p) => {
    if (p.category !== 'multimodal') return true
    return Array.isArray(p.capabilities) && p.capabilities.includes(cap)
  }

  const asUsableDefault = (id) => {
    if (typeof id !== 'string' || !id) return null
    const hit = candidates.find(p => p.id === id)
    if (!hit) return null
    return isDefaultFor(hit) && supportsCapability(hit) ? hit : null
  }

  // 1) 主进程 getDefault 给出的 id（真源），校验它确实是该能力的默认且在列表内
  const preferred = asUsableDefault(preferredId)
  if (preferred) return preferred.id
  // 2) 列表内第一个满足默认口径的
  const inList = candidates.find(p => isDefaultFor(p) && supportsCapability(p))
  if (inList) return inList.id
  // 3) 兜底：首项（保持旧行为）
  return candidates[0].id
}
