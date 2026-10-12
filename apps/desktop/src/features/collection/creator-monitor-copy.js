/**
 * creator-monitor-copy.js —「博主监控」渲染层的文案映射（纯函数，从 CreatorMonitor.vue 拆出
 * 以守住 check-max-lines 的 500 行新代码硬限；同时让错误映射可脱离组件单测）。
 *
 * 纪律沿用本文件来源（PRD-CREATOR-MONITOR-COLLECT §17 / PRD-CREATOR-MULTI-PLATFORM §7）：
 *   - 查表而非拼接：所有 locale key 以字面量出现（check-locale-sync --keys 可静态解析）；
 *   - 按 reason 分因：每个 reason 只对应一条语义明确的文案来源，占位符禁止空串渲染。
 */

/**
 * 凭证横幅 key（PRD §7.4 四态 + read_failed）。主进程未就绪（credential-service-unavailable）
 * 时不显示——那条信息由 degraded 横幅承担，避免两条自相矛盾。
 */
function credentialBannerKey (credential) {
  const c = credential
  if (!c) return ''
  if (c.status === 'ok') return ''
  if (c.status === 'unavailable' && c.reason === 'credential-service-unavailable') return ''
  switch (c.status) {
  case 'not_configured': return 'collection.creatorCredentialStatusNotConfigured'
  case 'unavailable': return 'collection.creatorCredentialStatusUnavailable'
  case 'decrypt_failed': return 'collection.creatorCredentialStatusDecryptFailed'
  case 'read_failed': return 'collection.creatorCredentialStatusReadFailed'
  default: return ''
  }
}

/**
 * 添加博主的领域 reason → 文案 key。platform 用于带平台名的文案（signature_failed /
 * credential_missing-for-platform）。返回 '' 表示没有专属文案（调用方回退 r.message）。
 */
function followErrorKey (reason) {
  switch (reason) {
  case 'creator:invalid_input': return 'collection.creatorErrInvalidInput'
  case 'creator:not_a_channel': return 'collection.creatorErrNotAChannel'
  case 'creator:channel_not_found': return 'collection.creatorErrChannelNotFound'
  case 'creator:credential_missing': return 'collection.creatorErrCredentialMissing'
  case 'creator:wrong_platform': return 'collection.creatorErrWrongPlatform'
  case 'creator:unsupported_platform': return 'collection.creatorErrUnsupportedPlatform'
  default: return ''
  }
}

/** 需要带平台名的 reason 单列（调用方先查 followErrorKey，miss 再查这里） */
function followErrorKeyWithPlatform (reason) {
  switch (reason) {
  case 'creator:signature_failed': return 'collection.creatorErrSignatureFailed'
  case 'creator:credential_missing_for_platform': return 'collection.creatorErrCredentialMissingForPlatform'
  default: return ''
  }
}

/** 平台 id → locale key（creator:platforms 清单 miss 时的静态兜底） */
function platformLocaleKey (id) {
  return ({
    youtube: 'collection.creatorPlatformYoutube',
    douyin: 'collection.creatorPlatformDouyin',
    xiaohongshu: 'collection.creatorPlatformXiaohongshu',
  })[id] || ''
}

/** 正文腿（字幕增强）缺依赖的非阻塞提示（带确切命令；无命令不渲染占位符） */
function transcriptHintText (dependency, t) {
  const d = dependency
  if (!d || !d.transcript || d.transcript.ready) return ''
  return t('collection.creatorDependencyOptionalHint', { command: d.transcript.installHint || '' })
}

/** 平台 id → 展示名（纯数据版；组件层用 t(key) 渲染）。全 miss 返回 ''。 */
function platformLabelOf (id, platformList) {
  const p = (platformList || []).find((x) => x.id === id)
  if (p && p.label) return p.label
  return ({ youtube: 'YouTube' })[id] || ''
}

export {
  platformLabelOf,
  credentialBannerKey,
  followErrorKey,
  followErrorKeyWithPlatform,
  platformLocaleKey,
  transcriptHintText,
}
