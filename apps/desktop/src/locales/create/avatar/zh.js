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
  avatarCloneCreating: '正在创建克隆形象…',
  avatarCloneChooseMedia: '选择{media}',
  avatarCloneErrInvalidArgs: '参数不合法',
  avatarCloneErrSelection: '素材选择已过期，请重新选择',
  avatarCloneErrSampleInvalid: '素材格式不支持，请按提示的类型选择文件',
  avatarCloneErrSampleUnreadable: '素材读取失败，请检查文件是否可访问',
  avatarCloneErrDuplicate: '该形象已存在',
  avatarCloneErrNotFound: '形象不存在',
  avatarCloneErrStore: '本地存储不可用',
  avatarCloneErrProvider: 'HeyGen 暂时不可用，请稍后重试',
  avatarCloneErrUnknown: '未知错误',
  avatarCloneNoticeTitle: '关于克隆形象与声音',
  avatarCloneNoticeBody: '克隆功能会把上传的照片/视频/录音用于训练你自己的数字人形象与音色。请确认你已获得其中人物（包括你自己）的授权；使用他人肖像或声音产生的法律责任由使用者承担。',
  avatarCloneNoticeAck: '我已了解',
}
