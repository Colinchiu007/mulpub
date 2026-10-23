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
  avatarProviderLabel: '数字人服务商',
  avatarProviderPlaceholder: '请选择数字人服务商',
  avatarProviderMissing: '使用数字人需要在模型设置中配置数字人服务商',
  avatarProviderSwitched: '已切换到{name}，请重新选择形象与音色',
  avatarProviderSingle: '当前仅配置了一家数字人服务商，切换需先在模型设置中添加',
  avatarLabel: '数字人形象',
  avatarVoiceLabel: '数字人音色',
  avatarPlaceholder: '请选择数字人形象',
  avatarVoicePlaceholder: '请选择音色',
  avatarRefresh: '刷新列表',
  avatarLoading: '正在加载数字人列表…',
  avatarLoadFailed: '数字人列表加载失败：{reason}',
  avatarCachedFailed: '列表为缓存数据，刷新失败：{reason}',
  avatarEmpty: '未获取到可用数字人形象，请检查数字人服务商配置',
  avatarVoiceEmpty: '未获取到可用音色，请检查数字人服务商配置',
  avatarGotoSettings: '前往配置 →',
  avatarNeedAvatar: '请先选择数字人形象',
  avatarNeedVoice: '请先选择数字人音色',
  avatarErrUnsupported: '该服务商不支持数字人能力',
  avatarErrInvalidArgs: '参数不合法',
  avatarErrApiUnavailable: '接口不可用',
  avatarErrServiceUnavailable: '服务暂时不可用',
  avatarErrAuthFailed: 'API Key 无效或已过期',
  avatarErrUnknown: '未知错误',
  // ── 形象克隆（avatar-voice-clone，2026-10-22）────────────────────
  avatarCloneSectionTitle: '我的克隆形象',
  avatarCloneManage: '管理克隆形象',
  avatarCloneCreate: '克隆新形象',
  avatarCloneTypePhoto: '用照片创建',
  avatarCloneTypeVideo: '用视频创建',
  avatarCloneNameLabel: '形象名称',
  avatarCloneNamePlaceholder: '给这个形象起个名字',
  avatarCloneSourceSelf: '我上传的',
  avatarCloneSourceThirdParty: '他人授权上传',
  avatarCloneTraining: '训练中…',
  avatarCloneTrainingFailed: '训练失败',
  avatarCloneRemoteGone: '远端已不存在',
  avatarCloneSampleGone: '本地素材已缺失',
  avatarCloneDelete: '删除',
  avatarCloneRename: '重命名',
  avatarCloneDeleteConfirm: '删除后该形象将不能再用，确定删除吗？',
  avatarCloneEmpty: '还没有克隆形象',
  avatarCloneEmptyHint: '上传一张照片或一段视频，克隆出一个可长期复用的数字人形象',
  // change: digital-human-multiprovider —— 声音克隆入口提示。
  // 声音克隆的 UI 在「配音 → 音色复制/克隆」面板（S2vConfigPanels），
  // 与形象克隆是两条独立链路；这里只负责告知用户「本服务商支持自己的声音」。
  avatarCloneVoiceHint: '本服务商还支持克隆你自己的声音：在下方「数字人音色」旁的「音色复制 / 克隆」里上传录音即可，克隆成功后即可在此选择。',
  avatarCloneVoiceUnsupported: '当前服务商不支持克隆声音，只能使用它提供的现成音色。',
  // 声音克隆内联区（change: hifly-voice-subtitle-parity）：入口从配音面板
  // 收敛到数字人面板，provider/model 由当前数字人服务商决定、不给用户选。
  avatarCloneVoiceTitle: '克隆我的声音',
  avatarCloneVoiceHintInline: '上传一段录音即可克隆出你自己的声音，克隆成功后可在上方「数字人音色」中选择。',
  // change: avatar-voice-clone-bundled —— 声音与形象绑在一次创建里
  avatarCloneVoiceHintBundled: '选一段录音，与形象一起创建。创建成功后可直接在上方「数字人音色」中选用；不选则只克隆形象。',
  avatarCloneVoiceChooseMedia: '选择本地录音文件',
  avatarCloneVoiceSelected: '已选录音',
  // 字幕（change: hifly-voice-subtitle-parity）：仅飞影支持（官方 create_by_tts 的
  // st_* 字段族）；HeyGen 无对应契约，故面板对不支持的 provider 整个不渲染。
  avatarSubtitleShow: '添加字幕',
  avatarSubtitleHide: '收起字幕设置',
  avatarSubtitleHint: '开启后会在成片上烧录字幕，样式即时生效，无需重新生成形象。',
  avatarSubtitleFontName: '字体',
  avatarSubtitleFontNamePlaceholder: '留空使用服务商默认字体',
  avatarSubtitleFontSize: '字号',
  avatarSubtitlePrimaryColor: '文字颜色',
  avatarSubtitleOutlineColor: '描边颜色',
  avatarSubtitleAdvancedNote: '字幕位置与区域大小使用服务商默认值，暂不在应用内调整。',
  avatarCloneCreating: '正在创建克隆形象…',
  avatarCloneChooseMedia: '选择{media}',
  avatarCloneErrInvalidArgs: '参数不合法',
  avatarCloneErrSelection: '素材选择已过期，请重新选择',
  avatarCloneErrSampleInvalid: '素材格式不支持，请按提示的类型选择文件',
  avatarCloneErrSampleUnreadable: '素材读取失败，请检查文件是否可访问',
  avatarCloneErrDuplicate: '该形象已存在',
  avatarCloneErrNotFound: '形象不存在',
  avatarCloneErrStore: '本地存储不可用',
  // {name} 由调用点代入当前数字人服务商名（change: hifly-voice-subtitle-parity）。
  // 此前写死「HeyGen」——切到飞影后报这个错会把人指错方向。
  avatarCloneErrProvider: '{name}暂时不可用，请稍后重试',
  avatarCloneErrUnknown: '未知错误',
  avatarCloneNoticeTitle: '关于克隆形象与声音',
  avatarCloneNoticeBody: '克隆功能会把上传的照片/视频/录音用于训练你自己的数字人形象与音色。请确认你已获得其中人物（包括你自己）的授权；使用他人肖像或声音产生的法律责任由使用者承担。',
  avatarCloneNoticeAck: '我已了解',
}
