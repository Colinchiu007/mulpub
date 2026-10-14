/**
 * preset-managed-fields.js — 「编辑中的服务商是否受运营下发管束」判据（2026-10-14）
 *
 * 背景：预设服务商（`is_preset === true`）的模型列表由运营目录下发，
 * `ModelProviderManager.applyCatalog()` 在目录项带完整 `models` 数组时**整表覆盖**
 * （`UPDATE model_providers SET models = ?`）。若前端不锁，用户改了也在下次同步被静默冲掉。
 *
 * 为什么抽成独立模块：这条判据**曾经存在过**，但写的是「是否连上运营中心」，
 * 而那个判断在所部署的版本里**恒为假** ⇒ 只读保护一次都没生效，且**没有任何测试能发现**。
 * 内联 computed 不可单测，是它得以长期静默失效的直接原因。
 *
 * 判据必须是**数据事实**（`is_preset`），不是连接状态：
 *   · 数据事实与「此刻连没连上」无关，断开连接编辑时同样该锁；
 *   · 连接状态是易变的，把它当判据等于让同一份代码在不同时刻有不同行为，且无法用固定夹具覆盖。
 */

/**
 * @param {Array<{id: string, is_preset?: boolean}>} providers 本地服务商列表
 * @param {string} editingId 正在编辑的服务商 id（空串/undefined = 新增，非预设）
 * @returns {boolean} true 表示该行的受管字段（模型列表）应只读
 */
export function presetManagedFields (providers, editingId) {
  if (!editingId || !Array.isArray(providers)) return false
  const row = providers.find((item) => item && item.id === editingId)
  return row ? row.is_preset === true : false
}
