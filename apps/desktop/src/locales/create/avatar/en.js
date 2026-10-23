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
  avatarProviderLabel: 'Digital human provider',
  avatarProviderPlaceholder: 'Select a digital human provider',
  avatarProviderMissing: 'Digital human requires a provider configured in Model Settings',
  avatarProviderSwitched: 'Switched to {name}. Please reselect an avatar and a voice',
  avatarProviderSingle: 'Only one digital human provider is configured. Add another in Model Settings to switch',
  avatarLabel: 'Avatar',
  avatarVoiceLabel: 'Voice',
  avatarPlaceholder: 'Select an avatar',
  avatarVoicePlaceholder: 'Select a voice',
  avatarRefresh: 'Refresh list',
  avatarLoading: 'Loading digital humans…',
  avatarLoadFailed: 'Failed to load digital human list: {reason}',
  avatarCachedFailed: 'Showing cached list; refresh failed: {reason}',
  avatarEmpty: 'No avatars available. Check your digital human provider configuration',
  avatarVoiceEmpty: 'No voices available. Check your digital human provider configuration',
  avatarGotoSettings: 'Go to settings →',
  avatarNeedAvatar: 'Select a digital human first',
  avatarNeedVoice: 'Select a voice first',
  avatarErrUnsupported: 'This provider does not support digital humans',
  avatarErrInvalidArgs: 'Invalid arguments',
  avatarErrApiUnavailable: 'Interface unavailable',
  avatarErrServiceUnavailable: 'Service temporarily unavailable',
  avatarErrAuthFailed: 'API key is invalid or expired',
  avatarErrUnknown: 'Unknown error',
  // ── Avatar cloning (avatar-voice-clone, 2026-10-22) ────────────────
  avatarCloneSectionTitle: 'My cloned avatars',
  avatarCloneManage: 'Manage cloned avatars',
  avatarCloneCreate: 'Clone a new avatar',
  avatarCloneTypePhoto: 'Create from a photo',
  avatarCloneTypeVideo: 'Create from a video',
  avatarCloneNameLabel: 'Avatar name',
  avatarCloneNamePlaceholder: 'Give this avatar a name',
  avatarCloneSourceSelf: 'Uploaded by me',
  avatarCloneSourceThirdParty: 'Uploaded with consent',
  avatarCloneTraining: 'Training…',
  avatarCloneTrainingFailed: 'Training failed',
  avatarCloneRemoteGone: 'No longer exists remotely',
  avatarCloneSampleGone: 'Local source media is missing',
  avatarCloneDelete: 'Delete',
  avatarCloneRename: 'Rename',
  avatarCloneDeleteConfirm: 'This avatar can no longer be used after deletion. Delete it?',
  avatarCloneEmpty: 'No cloned avatars yet',
  avatarCloneEmptyHint: 'Upload a photo or a video to clone a reusable digital human avatar',
  avatarCloneCreating: 'Creating cloned avatar…',
  avatarCloneChooseMedia: 'Select {media}',
  avatarCloneErrInvalidArgs: 'Invalid arguments',
  avatarCloneErrSelection: 'The media selection expired, please select again',
  avatarCloneErrSampleInvalid: 'Unsupported media format, please pick a file of the prompted type',
  avatarCloneErrSampleUnreadable: 'Could not read the media, check that the file is accessible',
  avatarCloneErrDuplicate: 'This avatar already exists',
  avatarCloneErrNotFound: 'Avatar not found',
  avatarCloneErrStore: 'Local storage is unavailable',
  avatarCloneErrProvider: 'HeyGen is temporarily unavailable, please retry later',
  avatarCloneErrUnknown: 'Unknown error',
  avatarCloneNoticeTitle: 'About avatar and voice cloning',
  avatarCloneNoticeBody: 'Cloning uses your uploaded photo/video/audio to train your own digital human avatar and voice. Make sure you have permission from everyone shown or recorded, including yourself. You are responsible for any legal liability arising from using another person\'s likeness or voice.',
  avatarCloneNoticeAck: 'Got it',
}
