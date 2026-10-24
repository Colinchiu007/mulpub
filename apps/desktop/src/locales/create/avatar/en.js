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
  // change: digital-human-multiprovider — voice clone entry hint.
  // The voice clone UI lives in "Voiceover → Voice copy / clone" (S2vConfigPanels);
  // this only tells the user that the current provider supports their own voice.
  avatarCloneVoiceHint: 'This provider also supports cloning your own voice: upload a recording under "Voice copy / clone" next to Digital human voice, then pick it here.',
  avatarCloneVoiceUnsupported: 'The current provider does not support voice cloning; only its built-in voices are available.',
  // Inline voice clone section (change: hifly-voice-subtitle-parity): the entry
  // moved from the voiceover panel into the digital human panel; provider/model
  // come from the current digital human provider and are not user-selectable.
  avatarCloneVoiceTitle: 'Clone my voice',
  avatarCloneVoiceHintInline: 'Upload a recording to clone your own voice, then pick it under Digital human voice above.',
  // change: avatar-voice-clone-bundled — voice is created together with the avatar
  avatarCloneVoiceHintBundled: 'Pick a recording to create it together with the avatar. It then appears under Digital human voice above; skip it to clone the avatar only.',
  avatarCloneVoiceChooseMedia: 'Choose a local audio file',
  // change: hifly-clone-material-hints — material requirements. Hifly returns no
  // reason on clone failure (observed: empty message), so all hard limits plus the
  // "must contain a voice" warning have to be stated up front.
  avatarCloneVoiceMaterialHint: 'Requires mp3 / m4a / wav, up to 20MB, 5s-3min, and must contain a clear human voice (silence or music-only audio will fail).',
  avatarCloneVoiceSelected: 'Recording selected',
  // Subtitles (change: hifly-voice-subtitle-parity): Hifly only (the official
  // create_by_tts st_* family). HeyGen has no equivalent contract, so the panel
  // is not rendered at all for providers that do not support it.
  avatarSubtitleShow: 'Add subtitles',
  avatarSubtitleHide: 'Hide subtitle settings',
  avatarSubtitleHint: 'Subtitles are burned into the output video; style changes apply without re-training the avatar.',
  avatarSubtitleFontName: 'Font',
  avatarSubtitleFontNamePlaceholder: 'Leave empty for the provider default font',
  avatarSubtitleFontSize: 'Font size',
  avatarSubtitlePrimaryColor: 'Text color',
  avatarSubtitleOutlineColor: 'Outline color',
  avatarSubtitleAdvancedNote: 'Subtitle position and box size use the provider defaults for now.',
  avatarCloneCreating: 'Creating cloned avatar…',
  avatarCloneChooseMedia: 'Select {media}',
  avatarCloneErrInvalidArgs: 'Invalid arguments',
  avatarCloneErrSelection: 'The media selection expired, please select again',
  avatarCloneErrSampleInvalid: 'Unsupported media format, please pick a file of the prompted type',
  avatarCloneErrSampleUnreadable: 'Could not read the media, check that the file is accessible',
  avatarCloneErrDuplicate: 'This avatar already exists',
  avatarCloneErrNotFound: 'Avatar not found',
  avatarCloneErrStore: 'Local storage is unavailable',
  // {name} is substituted with the current provider name by the call site
  // (change: hifly-voice-subtitle-parity). It used to hardcode "HeyGen",
  // which pointed users the wrong way after switching to Hifly.
  avatarCloneErrProvider: '{name} is temporarily unavailable, please retry later',
  avatarCloneErrUnknown: 'Unknown error',
  avatarCloneNoticeTitle: 'About avatar and voice cloning',
  avatarCloneNoticeBody: 'Cloning uses your uploaded photo/video/audio to train your own digital human avatar and voice. Make sure you have permission from everyone shown or recorded, including yourself. You are responsible for any legal liability arising from using another person\'s likeness or voice.',
  avatarCloneNoticeAck: 'Got it',
}
