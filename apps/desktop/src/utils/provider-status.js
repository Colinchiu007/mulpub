/**
 * provider-status — 模型服务商「配置状态」三态判定（单一真源）
 *
 * 为什么要有这个模块：卡片上的状态标签此前直接翻译数据库的 `enabled` 布尔位
 * （`p.enabled ? 已启用 : 已禁用`）。但 `enabled` 在本仓**不是**「用户手动禁用」的开关，
 * 而是「有没有可用 API Key」的派生位：
 *   - 预设种子行插入时 enabled 硬编码 0（electron/services/model-provider-manager.js:573-575）
 *   - 运营目录同步插入的预设行同样 enabled=0（同文件 :971-972）
 *   - 存了新 Key → enabled=1；清空 Key → enabled=0（同文件 :900-906）
 * UI 上根本没有启用/禁用的开关（toggleEnabled 已实现但未接线到任何元素），
 * 于是「从没配过」的卡片被贴上「已禁用」—— 把内部派生位当成了用户意图。
 *
 * 三态（语义落在「配置事实」上，不落在内部布尔位上）：
 *   enabled         已启用   已配置且会被实际调用（运行时按 enabled=1 过滤）
 *   disabled        已停用   配置还在（Key 仍在），但显式不参与调用
 *   not_configured  未配置   从没填过 Key，不会被调用
 *
 * 已知边界（如实登记，不假装已覆盖）：
 *   「本地免 Key」服务商（piper / local-diffusion / comfyui）没有 Key 可填，
 *   它们一旦 enabled=0 会被判成「未配置」而不是「已停用」——
 *   该状态目前无入口（toggleEnabled 未接线），且「本地免 Key」判据在前端与后端
 *   是两份（前端不校验 URL 协议），这里刻意不复制第二份，避免判据漂移。
 *   「Key 解密失败」同样落到「未配置」：后端 `_getApiKey` 解密异常时返回空串，
 *   掩码串为空 ⇒ 本模块判「没配过」。该形态下卡片上的「测试连接」按钮是禁用的
 *   （测试前置条件是 is_configured），用户无法从界面直接诊断 ⇒ 属已知盲区，
 *   需要查主进程日志，而不是从卡片上看。
 */

export const PROVIDER_STATUS = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  NOT_CONFIGURED: 'not_configured'
}

/**
 * 该服务商是否留着一份可用 API Key。
 *
 * 判据用**掩码串**而不是 `api_key`：后端只在 Key 真的可用时才回掩码
 * （_safeRow：api_key_masked = hasUsableApiKey(key) ? mask(key) : ''），
 * 且 `api_key` 本身从不下发到渲染进程。掩码串非空 ⇒ 后端认定「有可用 Key」
 * ⇒ 此时 enabled=0 只能是「被停用」而不是「没配过」。
 *
 * @param {object|null|undefined} provider
 * @returns {boolean}
 */
export function providerHasUsableApiKey (provider) {
  if (!provider) return false
  const masked = provider.api_key_masked
  return typeof masked === 'string' && masked.trim() !== ''
}

/**
 * 服务商的配置状态三态。
 *
 * @param {object|null|undefined} provider
 * @returns {'enabled'|'disabled'|'not_configured'}
 */
export function providerStatus (provider) {
  if (!provider) return PROVIDER_STATUS.NOT_CONFIGURED
  // is_configured = enabled && (有可用 Key || 本地免 Key) —— 后端算好，渲染进程直接采信
  if (provider.is_configured === true) return PROVIDER_STATUS.ENABLED
  // 有 Key 却没启用 ⇒ 配置还在、只是不参与调用（与「没配过」是两件事）
  if (providerHasUsableApiKey(provider)) return PROVIDER_STATUS.DISABLED
  return PROVIDER_STATUS.NOT_CONFIGURED
}
