/**
 * Digital human (avatar-spokesperson) config block copy — locales split, 2026-10-19.
 *
 * Why a separate sub-module: `create/zh.js` and `create/en.js` were already near the
 * 500-line gate (.github/scripts/check-max-lines.js NEW_OVER_LIMIT); adding 21 keys
 * would push them over. Split following the repo convention
 * (locales/<namespace>/{zh,en}.js + assembly-file import). Keys are byte-identical to
 * the pre-split ones; zh/en are maintained as a pair (CI Gate 7).
 *
 * Assembly: spread as `...avatarEn` inside `story2video.ui` of `create/en.js`.
 */
export default {
  avatarSectionTitle: 'Digital human',
  avatarLabel: 'Avatar',
  avatarVoiceLabel: 'Voice',
  avatarPlaceholder: 'Select an avatar',
  avatarVoicePlaceholder: 'Select a voice',
  avatarRefresh: 'Refresh list',
  avatarLoading: 'Loading digital humans…',
  avatarLoadFailed: 'Failed to load digital human list: {reason}',
  avatarCachedFailed: 'Showing cached list; refresh failed: {reason}',
  avatarEmpty: 'No avatars available. Check your HeyGen configuration',
  avatarVoiceEmpty: 'No voices available. Check your HeyGen configuration',
  avatarProviderMissing: 'Digital human requires HeyGen in Model Settings',
  avatarGotoSettings: 'Go to settings →',
  avatarNeedAvatar: 'Select a digital human first',
  avatarNeedVoice: 'Select a voice first',
  avatarErrUnsupported: 'This provider does not support digital humans',
  avatarErrInvalidArgs: 'Invalid arguments',
  avatarErrApiUnavailable: 'Interface unavailable',
  avatarErrServiceUnavailable: 'Service temporarily unavailable',
  avatarErrAuthFailed: 'API key is invalid or expired',
  avatarErrUnknown: 'Unknown error',
}
