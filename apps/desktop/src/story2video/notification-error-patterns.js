/**
 * Story2Video 通知错误归一化正则单一真源。
 *
 * 迁移自 story2video-notifications.js（2026-10-02，逐文件行数门禁 NEW_OVER_LIMIT：
 * 517 行 >= 500）。拆分原则：这些正则常量只被 resolveMessageKey 一个函数消费，
 * 按「归一化正则」与「key/参数/插值引擎」两个内聚块切开；常量名、正则字面量、
 * 注释逐字保留，主模块通过本模块导入，行为零变化（notifications.test.js +
 * story2video-notifications.test.js 全量回归锁定）。
 */
// API Key 未配置/未设置/缺失/解密失败 → 独立提示（2026-08-09：避免被归一化成「未找到模型」误导排查）。
// 拆分为命名子模式便于维护；decrypt failed/解密失败 仅在 api-key 上下文内匹配，避免把非 key 解密错误误归类。
const API_KEY_UNCONFIGURED_PATTERN = /(api\s*key\s*not\s*configured|(?:尚未配置|未配置|未设置).{0,12}api\s*key|api\s*key.{0,12}(?:not\s*configured|未配置))/i
const API_KEY_MISSING_PATTERN = /(missing api key|api key required|no api key|api key.{0,16}(?:missing|required|not found|未找到))/i
const API_KEY_DECRYPT_PATTERN = /(api[ _-]?key.{0,20}(?:decrypt failed|解密失败)|(?:decrypt failed|解密失败).{0,20}api[ _-]?key)/i
const MODEL_API_KEY_PATTERN = new RegExp('(?:' + [
  API_KEY_UNCONFIGURED_PATTERN.source,
  API_KEY_MISSING_PATTERN.source,
  API_KEY_DECRYPT_PATTERN.source,
].join('|') + ')', 'i')
const MODEL_CONFIGURATION_PATTERN = /(默认\s*LLM|默认.*模型|未找到.*(?:默认.*)?(?:LLM|模型)|模型.*不可用)/i
const ACCESS_DENIED_PATTERN = /(当前许可证无权访问|当前账号没有所需权益|未授权|未登录|需要登录|access denied|not authorized|permission denied|sign[ -]?in required)/i
const RATE_LIMITED_PATTERN = /(rate\s*limit|rate_limit|限流|频率.*(?:受限|限制)|too\s*many\s*requests|Error\s+code:\s*429|rpm\s+exhausted|429\s+Too\s+Many)/i
// 供应商明确表示用量窗口已耗尽时优先于通用 429 分类（例如 opencode GoUsageLimitError）。
// 只匹配“已达到/耗尽”语义，避免把普通 usage limit 配置说明误报为额度错误。
const USAGE_LIMIT_EXCEEDED_PATTERN = /(GoUsageLimitError|(?:\d+\s*[- ]?hour|daily|weekly|monthly)?\s*usage\s+limit\s+(?:has\s+been\s+)?(?:reached|exhausted|exceeded))/i
const QUOTA_EXCEEDED_PATTERN = /((?:insufficient|exhausted|exceeded|out\s+of).{0,40}(?:quota|balance|token|credit)|(?:quota|balance|token|credit)s?.{0,40}(?:exceeded|insufficient|exhausted)|(?:余额|额度|配额).{0,20}(?:不足|不够|超|耗尽)|insufficient[_\s]*balance|billing|payment\s*required|(?:用量|Token\s*Plan|额度).{0,24}(?:上限|超|耗尽|用尽|用完)|(?:plan|套餐).{0,20}(?:expired|upgrade|到期)|usage\s*limit)/i
// 多次空结果（empty_result）：服务波动或账号问题，与内容安全审查是两类原因（2026-08-16 复审补强）
const EMPTY_RESULT_PATTERN = /(repeatedly returned no result|多次未返回结果)/i
// 供应商 API Key 无效/已过期（区别于缺失：model_api_key_required 只覆盖未配置/未找到）
const API_KEY_INVALID_PATTERN = /(api[ _-]?key.{0,24}(?:invalid|expired|失效|过期|无效|错误|不正确)|(?:invalid|expired)\s+api[ _-]?key|invalid\s+api\s*key|api\s*key\s*已?(?:过期|失效|无效)|鉴权失败|认证失败|密钥(?:无效|错误|过期)|authenticat|credential|(?:token|凭证).{0,16}(?:invalid|expired|无效|失效))/i
const TEXT_ONLY_PATTERN = /(只支持\s*(?:text|文案)|text\s*mode|text input only)/i
// 字数上限可变（story-text-limit-control）：默认值 6000 → 10000 且可由运营中心下发覆盖。
// 旧正则把 6000 写死在字面量里，上限变成 10000 后「超过 10000」会判为不匹配、错误归因落空
// （PRD §7.8）。改为 4-6 位数字通配，6000 / 10000 两档都命中（两档均有测试锁定）。
const TEXT_TOO_LONG_PATTERN = /(超过\s*\d{4,6}|最多\s*\d{4,6}|\d{4,6}.*(?:字符|character)|text.*(?:too long|exceeds))/i
const PREVIEW_MISSING_PATTERN = /(未返回.*可预览.*视频|preview.*(?:missing|video)|no previewable video)/i
const VOICE_INVALID_PATTERN = /(voice\s+(?:id\s+)?(?:wrong|invalid|not\s+found|does\s+not\s+exist|unavailable|missing)|(?:invalid|unsupported)\s+voice|voice_id.*(?:invalid|wrong|not\s+found|not\s+exist|unsupported)|cloned?\s+voice.*(?:not\s+found|not\s+available|unavailable)|voice.*(?:not\s+found|does\s+not\s+exist|invalid|unavailable)|\u97f3\u8272.*(?:\u65e0\u6548|\u4e0d\u5b58\u5728|\u5931\u6548|\u9519\u8bef|\u4e0d\u5b58\u5728)|\u5f53\u524d\u8d26\u53f7.*\u97f3\u8272|\u8d26\u53f7.*\u97f3\u8272|\u5c5e\u4e8e.*\u5176\u4ed6.*\u8d26\u53f7)/i
// 所选克隆音色不可用（2026-10-18 事故）：供应商对 story2video 旁白阶段返回
// `you don't have access to this voice_id`，且后端新增稳定前缀 VOICE_CLONE_UNAVAILABLE。
// 既有 VOICE_INVALID_PATTERN 只覆盖 not found / invalid / unavailable 等「音色本身无效」形态，
// 匹配不到「没有访问权」这一更具体的语义；本模式比 VOICE_INVALID_PATTERN 更具体，
// resolveMessageKey 必须先判定本模式，避免被泛化音色提示或 TTS 聚合错误吞掉。
const VOICE_CLONE_UNAVAILABLE_PATTERN = /(VOICE_CLONE_UNAVAILABLE|(?:don'?t|do not|cannot|can'?t)\s+have\s+access\s+to\s+(?:this\s+)?voice|voice_id[^\n]{0,40}(?:no\s+access|not\s+found|not\s+accessible))/i
const PIPELINE_CONCURRENCY_PATTERN = /(流水线正在(?:后台)?运行|最多同时运行|同时运行.*条|满负荷运行|concurrency limit)/i
const COMPOSE_SEGMENT_DURATION_PATTERN = /(单段旁白时长不能超过|single (?:narration|voice) segment.{0,40}(?:duration|limit))/i
const COMPOSE_DURATION_PATTERN = /((?:成片总时长|旁白音频总时长)不能超过|(?:requested|composed) video duration exceeds the allowed limit)/i
const CONTENT_POLICY_PATTERN = /(needs_user_input|content[_\s-]?policy.*review|内容政策|需要.*修改文案)/i
const OPTIMIZE_SERVICE_PATTERN = /(prompt-engine.*未运行|prompt-engine.*不可达|PromptBridge.*未注入|ECONNREFUSED.*8013)/i
const UNSUPPORTED_PARAMS_PATTERN = /(UnsupportedParamsError|unsupported.*param|不支持.*参数)/i
const COMPOSE_STAGE_PATTERN = /(narration concat|bgm mix|webm transcode|output validation|ffmpeg|旁白合并|背景音乐.{0,12}混|输出校验|视频校验|视频合成)/i
const TIMEOUT_PATTERN = /(timeout|timed out|etimedout|超时)/i
// 视频任务编辑页场景素材操作失败归一化（2026-08-14）
const SCENE_AUDIO_MISSING_PATTERN = /(没有旁白音频|no narration audio|missing.*(?:narration|voice).*audio|scene audio path is not allowed or unreadable)/i
const SCENE_IMAGE_MISSING_PATTERN = /(没有可用的图片素材|no available image|missing.*image.*(?:scene|segment)|scene media path is not allowed or unreadable)/i
// 视频素材缺失/不可读（2026-09-18）：历史记录已取消项目再次合成时，选中视频素材可能已缺失
const SCENE_VIDEO_MISSING_PATTERN = /(视频[12]?素材不存在|视频素材不可读|视频素材超出限制|no (?:valid |available )?video (?:material|asset)|video (?:material|asset|path).*(?:missing|unavailable|unreadable|not allowed))/i
const SCENE_SLOT_EMPTY_PATTERN = /(素材槽位暂无素材|slot.*(?:empty|missing)|material slot)/i
// 场景内容重新生成失败归一化（2026-08-15 历史记录场景编辑/重合成）
const SCENE_SUBTITLE_REGENERATE_FAILED_PATTERN = /(无法重新生成字幕|无法拆分字幕|subtitle.*(?:regenerat|split).*(?:fail|unavailable|invalid))/i
const SCENE_AUDIO_REGENERATE_FAILED_PATTERN = /(无法生成语音|语音生成服务不可用|无法重新生成(?:旁白|语音)|tts.*(?:fail|unavailable|invalid))/i
const SCENE_PROMPT_REGENERATE_FAILED_PATTERN = /(无法重新生成优化词|提示词优化服务不可用|优化词类型无效|优化结果无效|prompt.*(?:regenerat|optimiz).*(?:fail|unavailable|invalid))/i
const SCENE_AI_VIDEO_GENERATE_FAILED_PATTERN = /(无法生成 AI 视频|未配置可用的视频供应商|AI 视频生成服务不可用|AI 视频生成失败|视频(?:生成|下载|文件)(?:调用失败|任务失败|未返回任务|超时或失败|超过|无法解码|结果为空|任务状态为|失败)|ai video.*(?:fail|unavailable|invalid))/i
// compose 预检失败（2026-10-20 事故 error-message-user-friendly-audit）：
// 主进程现已返回稳定 errorCode（COMPOSE_*），但历史库里存量 run.error 只带英文原文
// （如 `Input media exceeds the total size limit`），归一化层必须同时认两条通道，
// 否则旧数据仍会在失败卡片上直出英文。
const COMPOSE_INPUT_SIZE_EXCEEDED_PATTERN = /(Input media exceeds the total size limit|input media exceeds.*(?:size|limit)|媒体总大小超过|输入媒体.*超过.*(?:上限|限制))/i
const COMPOSE_SCENE_MEDIA_UNREADABLE_PATTERN = /(Scene media path is not allowed or unreadable|scene media (?:path )?(?:rejected|unreadable|missing))/i
const COMPOSE_SCENE_AUDIO_UNREADABLE_PATTERN = /(Scene audio path is not allowed or unreadable|scene audio (?:path )?(?:rejected|unreadable|missing))/i

export {
  MODEL_API_KEY_PATTERN,
  MODEL_CONFIGURATION_PATTERN,
  ACCESS_DENIED_PATTERN,
  RATE_LIMITED_PATTERN,
  USAGE_LIMIT_EXCEEDED_PATTERN,
  QUOTA_EXCEEDED_PATTERN,
  EMPTY_RESULT_PATTERN,
  API_KEY_INVALID_PATTERN,
  TEXT_ONLY_PATTERN,
  TEXT_TOO_LONG_PATTERN,
  PREVIEW_MISSING_PATTERN,
  VOICE_INVALID_PATTERN,
  VOICE_CLONE_UNAVAILABLE_PATTERN,
  PIPELINE_CONCURRENCY_PATTERN,
  COMPOSE_SEGMENT_DURATION_PATTERN,
  COMPOSE_DURATION_PATTERN,
  CONTENT_POLICY_PATTERN,
  OPTIMIZE_SERVICE_PATTERN,
  UNSUPPORTED_PARAMS_PATTERN,
  COMPOSE_STAGE_PATTERN,
  TIMEOUT_PATTERN,
  SCENE_AUDIO_MISSING_PATTERN,
  SCENE_IMAGE_MISSING_PATTERN,
  SCENE_VIDEO_MISSING_PATTERN,
  SCENE_SLOT_EMPTY_PATTERN,
  SCENE_SUBTITLE_REGENERATE_FAILED_PATTERN,
  SCENE_AUDIO_REGENERATE_FAILED_PATTERN,
  SCENE_PROMPT_REGENERATE_FAILED_PATTERN,
  SCENE_AI_VIDEO_GENERATE_FAILED_PATTERN,
  COMPOSE_INPUT_SIZE_EXCEEDED_PATTERN,
  COMPOSE_SCENE_MEDIA_UNREADABLE_PATTERN,
  COMPOSE_SCENE_AUDIO_UNREADABLE_PATTERN,
}
