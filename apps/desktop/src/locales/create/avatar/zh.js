/**
 * 数字人（avatar-spokesperson）配置区文案（locales 结构拆分，2026-10-19）。
 *
 * 为什么独立成子模块：`create/zh.js` 与 `create/en.js` 已逼近 500 行门禁
 * （.github/scripts/check-max-lines.js 的 NEW_OVER_LIMIT），新增 21 键会把它们
 * 推过线。按仓内既有范式（locales/<namespace>/{zh,en}.js + 装配文件 import）
 * 拆出，键名与拆出前完全一致，zh/en 成对维护（CI Gate 7）。
 *
 * 装配方式：在 `create/zh.js` / `create/en.js` 的 story2video.ui 里
 * `...avatarZh` / `...avatarEn` 展开。
 */
export default {
  avatarSectionTitle: '数字人',
  avatarLabel: '数字人形象',
  avatarVoiceLabel: '数字人音色',
  avatarPlaceholder: '请选择数字人形象',
  avatarVoicePlaceholder: '请选择音色',
  avatarRefresh: '刷新列表',
  avatarLoading: '正在加载数字人列表…',
  avatarLoadFailed: '数字人列表加载失败：{reason}',
  avatarCachedFailed: '列表为缓存数据，刷新失败：{reason}',
  avatarEmpty: '未获取到可用数字人形象，请检查 HeyGen 配置',
  avatarVoiceEmpty: '未获取到可用音色，请检查 HeyGen 配置',
  avatarProviderMissing: '使用数字人需要在模型设置中配置 HeyGen',
  avatarGotoSettings: '前往配置 →',
  avatarNeedAvatar: '请先选择数字人形象',
  avatarNeedVoice: '请先选择数字人音色',
  avatarErrUnsupported: '该服务商不支持数字人能力',
  avatarErrInvalidArgs: '参数不合法',
  avatarErrApiUnavailable: '接口不可用',
  avatarErrServiceUnavailable: '服务暂时不可用',
  avatarErrAuthFailed: 'API Key 无效或已过期',
  avatarErrUnknown: '未知错误',
}
