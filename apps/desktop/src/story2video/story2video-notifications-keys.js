/**
 * story2video-notifications-keys.js — Story2Video 通知的稳定 messageKey 枚举。
 *
 * 从 story2video-notifications.js 拆出（2026-10-20，change: error-message-user-friendly-audit，
 * 逐文件行数门禁：主模块 543 行 >= 500 基线）。
 *
 * 拆分为独立模块的原因：参数归一化模块（story2video-notification-params.js）需要按 key 分派，
 * 主模块需要同一份 key 集合做白名单校验（isKnownMessageKey）与消息渲染。
 * 若 keys 留在主模块，params 模块反向 import 主模块会形成循环依赖
 * （主模块 → params → 主模块），ESM 下虽能被 Webpack/Vite 处理，但会在
 * 「模块加载期常量未初始化」上埋 TDZ 风险。故 keys 单独成文件，两侧都从它导入。
 *
 * 注意：新增 key 必须与 locales/story2video/{zh,en}.js 的文案成对存在
 * （CI Gate 7 check-locale-sync.js --keys 机械校验）。
 */

export const STORY2VIDEO_NOTIFICATION_KEYS = Object.freeze({
  MODEL_CONFIGURATION_REQUIRED: 'story2video.model_configuration_required',
  MODEL_API_KEY_REQUIRED: 'story2video.model_api_key_required',
  // 流水线启动前置校验：模型能力缺失清单（errorCode=PIPELINE_MODEL_REQUIREMENTS_MISSING）
  MODELS_REQUIRED: 'story2video.models_required',
  BGM_SKIPPED: 'story2video.bgm_skipped',
  ACCESS_DENIED: 'story2video.access_denied',
  ORCHESTRATION_FAILED: 'story2video.orchestration_failed',
  TEXT_INPUT_ONLY: 'story2video.text_input_only',
  TEXT_TOO_LONG: 'story2video.text_too_long',
  TEXT_REQUIRED: 'story2video.text_required',
  RUN_STATUS_UNAVAILABLE: 'story2video.run_status_unavailable',
  PREVIEW_MISSING: 'story2video.preview_missing',
  VIDEO_PREVIEW_FAILED: 'story2video.videoPreviewFailed',
  MEDIA_INVALID: 'story2video.media_invalid',
  MEDIA_FORMAT_INVALID: 'story2video.media_format_invalid',
  MEDIA_SIZE_EXCEEDED: 'story2video.media_size_exceeded',
  MEDIA_UNREADABLE: 'story2video.media_unreadable',
  MEDIA_PATH_UNRESOLVED: 'story2video.media_path_unresolved',
  VOICE_INVALID: 'story2video.voice_invalid',
  VOICE_CLONE_UNAVAILABLE: 'story2video.voice_clone_unavailable',
  PROJECT_DELETE_FAILED: 'story2video.project_delete_failed',
  PROJECT_DELETE_CONFIRM: 'story2video.project_delete_confirm',
  RUN_DELETE_FAILED: 'story2video.run_delete_failed',
  RUN_DELETE_CONFIRM: 'story2video.run_delete_confirm',
  TEMPLATE_DELETE_CONFIRM: 'story2video.template_delete_confirm',
  // 历史记录批量删除（2026-08-26）
  BATCH_DELETE_CONFIRM: 'story2video.batch_delete_confirm',
  BATCH_DELETE_SUCCESS: 'story2video.batch_delete_success',
  BATCH_DELETE_PARTIAL: 'story2video.batch_delete_partial',
  BATCH_DELETE_FAILED: 'story2video.batch_delete_failed',
  BGM_LIBRARY_LOAD_FAILED: 'story2video.bgm_library_load_failed',
  BGM_LIBRARY_RENAME_FAILED: 'story2video.bgm_library_rename_failed',
  BGM_LIBRARY_DELETE_FAILED: 'story2video.bgm_library_delete_failed',
  BGM_LIBRARY_DELETE_CONFIRM: 'story2video.bgm_library_delete_confirm',
  HISTORY_LOAD_FAILED: 'story2video.history_load_failed',
  HISTORY_LOCAL_MODE: 'story2video.history_local_mode',
  EXPORT_COMPLETED: 'story2video.export_completed',
  EXPORT_CANCELLED: 'story2video.export_cancelled',
  SAVE_COMPLETED: 'story2video.save_completed',
  PATH_COPIED: 'story2video.path_copied',
  TRIM_COMPLETED: 'story2video.trim_completed',
  SEGMENTS_SAVED: 'story2video.segments_saved',
  SEGMENT_AUDIO_REPLACED: 'story2video.segment_audio_replaced',
  SEGMENT_IMAGE_RETRIED: 'story2video.segment_image_retried',
  SEGMENT_VIDEO_RETRIED: 'story2video.segment_video_retried',
  PROJECT_RECOMPOSED: 'story2video.project_recomposed',
  SCENE_IMAGE_GENERATED: 'story2video.scene_image_generated',
  SCENE_VIDEO_GENERATED: 'story2video.scene_video_generated',
  MATERIAL_SELECTED: 'story2video.material_selected',
  SCENE_AUDIO_MISSING: 'story2video.scene_audio_missing',
  SCENE_IMAGE_MISSING: 'story2video.scene_image_missing',
  SCENE_VIDEO_MISSING: 'story2video.scene_video_missing',
  SCENE_SLOT_EMPTY: 'story2video.scene_slot_empty',
  SCENE_SUBTITLE_REGENERATED: 'story2video.scene_subtitle_regenerated',
  SCENE_SUBTITLE_REGENERATE_FAILED: 'story2video.scene_subtitle_regenerate_failed',
  SCENE_AUDIO_REGENERATED: 'story2video.scene_audio_regenerated',
  SCENE_AUDIO_REGENERATE_FAILED: 'story2video.scene_audio_regenerate_failed',
  SCENE_PROMPT_REGENERATED: 'story2video.scene_prompt_regenerated',
  SCENE_PROMPT_REGENERATE_FAILED: 'story2video.scene_prompt_regenerate_failed',
  SCENE_AI_VIDEO_GENERATED: 'story2video.scene_ai_video_generated',
  SCENE_AI_VIDEO_GENERATE_FAILED: 'story2video.scene_ai_video_generate_failed',
  // compose 预检失败稳定错误码（2026-10-20 error-message-user-friendly-audit）
  COMPOSE_INPUT_SIZE_EXCEEDED: 'story2video.compose_input_size_exceeded',
  COMPOSE_SCENE_MEDIA_UNREADABLE: 'story2video.compose_scene_media_unreadable',
  COMPOSE_SCENE_AUDIO_UNREADABLE: 'story2video.compose_scene_audio_unreadable',
  DEGRADED_ASSETS_WARNING: 'story2video.degraded_assets_warning',
  RATE_LIMITED: 'story2video.rate_limited',
  QUOTA_EXCEEDED: 'story2video.quota_exceeded',
  EMPTY_RESULT: 'story2video.empty_result',
  API_KEY_INVALID: 'story2video.api_key_invalid',
  COMPOSE_TIMEOUT: 'story2video.compose_timeout',
  COMPOSE_DURATION_EXCEEDED: 'story2video.compose_duration_exceeded',
  COMPOSE_SEGMENT_DURATION_EXCEEDED: 'story2video.compose_segment_duration_exceeded',
  NEEDS_USER_INPUT: 'story2video.needs_user_input',
  OPTIMIZE_SERVICE_UNAVAILABLE: 'story2video.optimize_service_unavailable',
  PROVIDER_PARAMS_UNSUPPORTED: 'story2video.provider_params_unsupported',
  ASSET_GENERATION_FAILED: 'story2video.asset_generation_failed',
  OPTIMIZE_FAILED: 'story2video.optimize_failed',
  COMPOSE_FAILED: 'story2video.compose_failed',
  API_ERROR: 'story2video.api_error',
  OPERATION_FAILED: 'story2video.operation_failed',
  UNKNOWN_ERROR: 'story2video.unknown_error',
  PIPELINE_NOT_IMPLEMENTED: 'story2video.pipeline_not_implemented',
  PIPELINE_CONCURRENCY_LIMIT: 'story2video.pipeline_concurrency_limit',
  // 启动参数校验失败（2026-09-04）：normalizeStory2VideoTextParams 抛出的通用 Error 没有 .code 时兜底
  INVALID_PARAMS: 'story2video.invalid_params',
  // 断点恢复失败（pipeline-engine resumeOrchestration errorCode 契约）
  RESUME_SNAPSHOT_NOT_FOUND: 'story2video.resume_snapshot_not_found',
  RESUME_RUN_NOT_FAILED: 'story2video.resume_run_not_failed',
  RESUME_RUN_NOT_ORCHESTRATOR: 'story2video.resume_run_not_orchestrator',
  RESUME_STAGE_NOT_FOUND: 'story2video.resume_stage_not_found',
})
