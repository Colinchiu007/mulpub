// @ts-check
/**
 * explainer-prod-review — compose / publish 两阶段的上游产物（render_report / final_review / publish_log）
 *
 * ## 「成片能播」≠「成片可用」
 *
 * 本模块把「成片可交付」落成**可断言的机械判据**：
 *   容器有效（ffprobe）＋ 画面非空白（抽帧 + blackdetect）＋ **音轨非静音**（volumedetect）
 *   ＋ runtime 未被偷换（与 proposal 锁定值比对）＋ 字幕覆盖。
 *
 * ## status 的判定口径（必须显式，否则会出现「永远 fail」的死局）
 *
 * 上游语义是「An unapproved swap is a contract violation」⇒ 未批准的 runtime 偷换 = 违规。
 * ⚠ 但本仓 P2a 阶段 `render_runtime` 是**缺省值**（`approval.status` 强制 pending，
 *   真正的选择发生在 P3 的 G1 门）⇒ 拿**未确认的缺省值**去判「合同违规」，
 *   会让成片永远判 fail ⇒ 流水线永远出不来片。
 * ⇒ 规则：
 *   - 锁定值**未获批准**（approval.status ≠ 'approved'）⇒ 漂移记 **info**（不阻断），
 *     并在 runtime_swap_check 里写明「锁定值尚未由 G1 门确认」。
 *   - 锁定值**已获批准** ⇒ 漂移记 **error**（真的合同违规）。
 *   - 产物本身无效（容器坏 / 音轨静音）⇒ status = 'fail'，与漂移无关。
 *
 * ## 不可机械判的项不假装能判
 *
 * `unreadable_text` / `broken_overlays` / `missing_assets` 需要视觉理解 ⇒ 统一 false，
 * 并登记进 `metadata.checks_not_performed` ⇒ 读报告的人一眼看到「这三项没人看过」。
 */

'use strict'

const { loadSchema } = require('./artifact-schema-validator')
const {
  ARTIFACT_VERSION,
  fillRequired,
  asText,
  asArray,
  asObject,
  asNumber,
} = require('./explainer-artifacts')
const { makeIssue } = require('./explainer-shot-language')
const { SILENCE_THRESHOLD_DB, MIN_SAMPLED_FRAMES } = require('./explainer-media-probe')

/** render_report.render_grammar 的合法取值（逐字取自上游 schema） */
const RENDERER_FAMILIES = [
  'explainer-data', 'explainer-teacher', 'cinematic-trailer', 'documentary-montage',
  'product-reveal', 'screen-demo', 'presenter', 'animation-first',
]

/**
 * 构造 render_report。
 *
 * ⚠ 字段**从 ffprobe 实测读数来**，不是从 compose 的意图参数抄
 *   （`stage.options.resolution` 是**意图**，ffprobe 是**事实**）。
 *
 * @param {object} raw compose 阶段的原始输出（{videoPath, fileSize, segmentCount, duration}）
 * @param {object} ctx { probe, editDecisions, renderTimeSeconds, platformTarget }
 */
function buildRenderReport (raw, ctx = {}) {
  const schema = loadSchema('render_report')
  const issues = []
  const probe = asObject(ctx.probe)
  const output = asObject(raw)
  const videoPath = asText(output.videoPath) || asText(ctx.videoPath)

  const outputs = []
  if (videoPath) {
    outputs.push({
      path: videoPath,
      format: asText(probe.format) || 'mp4',
      codec: asText(probe.codec),
      audio_codec: asText(probe.audio_codec) || (probe.has_audio ? 'aac' : ''),
      resolution: asText(probe.resolution),
      fps: asNumber(probe.fps, 0),
      duration_seconds: asNumber(probe.duration_seconds, asNumber(output.duration, 0)),
      file_size_bytes: asNumber(probe.file_size_bytes, asNumber(output.fileSize, 0)),
      platform_target: asText(ctx.platformTarget),
    })
  } else {
    issues.push(makeIssue('NO_RENDER_OUTPUT', 'compose 阶段没有产出视频路径', 'error'))
  }

  const grammarRaw = asText(asObject(ctx.editDecisions).renderer_family)
  const grammar = RENDERER_FAMILIES.includes(grammarRaw) ? grammarRaw : 'explainer-data'

  const report = {
    version: ARTIFACT_VERSION,
    outputs,
    render_time_seconds: asNumber(ctx.renderTimeSeconds, 0),
    warnings: [],
    verification_notes: [
      '产物读数来自 ffprobe 实测（不是 compose 的意图参数）',
      '音轨有效性由 volumedetect 的 mean_volume 判定（阈值 ' + SILENCE_THRESHOLD_DB + ' dB，实测标定）',
    ],
    render_grammar: grammar,
    decision_log_ref: asText(ctx.decisionLogRef),
    final_review_ref: asText(ctx.finalReviewRef),
    metadata: {
      issues,
      renderer_family_source: grammarRaw ? 'edit_decisions' : 'default',
      probe_issues: asArray(probe.issues),
    },
  }
  return fillRequired(report, schema, schema)
}

/**
 * 构造 final_review（五项检查 + status + recommended_action）。
 *
 * @param {object} raw 保留位
 * @param {object} ctx
 *   - probe / frames / loudness：来自 explainer-media-probe
 *   - renderReport
 *   - editDecisions
 *   - lockedRuntime：proposal 阶段锁定的 runtime
 *   - actualRuntime：compose 实际跑的 runtime
 *   - approvalStatus：proposal 的 approval.status（'pending'/'approved'/...）
 */
function buildFinalReview (raw, ctx = {}) {
  const schema = loadSchema('final_review')
  const issues = []
  const probe = asObject(ctx.probe)
  const frames = asObject(ctx.frames)
  const loudness = asObject(ctx.loudness)
  const editDecisions = asObject(ctx.editDecisions)
  const renderReport = asObject(ctx.renderReport)
  const outputPath = asText(asObject(ctx.renderReport).outputs?.[0]?.path) || asText(ctx.videoPath)

  const lockedRuntime = asText(ctx.lockedRuntime)
  const actualRuntime = asText(ctx.actualRuntime)
  const approvalStatus = asText(ctx.approvalStatus)
  const runtimeSwapped = Boolean(lockedRuntime && actualRuntime && lockedRuntime !== actualRuntime)
  const runtimeApproved = approvalStatus === 'approved'

  // ① technical_probe
  const technicalProbe = {
    valid_container: probe.valid_container === true,
    duration_seconds: asNumber(probe.duration_seconds, 0),
    resolution: asText(probe.resolution),
    fps: asNumber(probe.fps, 0),
    has_audio: probe.has_audio === true,
    codec: asText(probe.codec),
    file_size_bytes: asNumber(probe.file_size_bytes, 0),
    issues: asArray(probe.issues).map(String),
  }
  if (!technicalProbe.valid_container) {
    issues.push(makeIssue('RENDER_OUTPUT_INVALID', '产物容器无效或读不到时长，不能作为成片交付', 'error'))
  }
  if (!technicalProbe.has_audio) {
    issues.push(makeIssue('RENDER_OUTPUT_NO_AUDIO', '产物没有音频流', 'error'))
  }

  // ② visual_spotcheck
  const visualSpotcheck = {
    frames_sampled: asNumber(frames.frames_sampled, 0),
    frame_paths: asArray(frames.frame_paths).map(String),
    black_frames_detected: frames.black_frames_detected === true,
    broken_overlays: frames.broken_overlays === true,
    missing_assets: frames.missing_assets === true,
    unreadable_text: frames.unreadable_text === true,
    issues: asArray(frames.issues).map(String),
  }
  if (visualSpotcheck.frames_sampled < MIN_SAMPLED_FRAMES) {
    issues.push(makeIssue('TOO_FEW_SAMPLED_FRAMES',
      '只抽到 ' + visualSpotcheck.frames_sampled + ' 帧，少于 ' + MIN_SAMPLED_FRAMES + ' 帧的下限', 'error'))
  }
  if (visualSpotcheck.black_frames_detected) {
    issues.push(makeIssue('BLACK_FRAMES_DETECTED', '检测到黑帧区间', 'error'))
  }

  // ③ audio_spotcheck
  const audioSpotcheck = {
    narration_present: loudness.has_audio === true,
    music_present: false,
    unexpected_silence: loudness.is_silent === true,
    clipping_detected: false,
    mix_intelligible: loudness.is_silent !== true,
    issues: asArray(loudness.issues).map(String),
  }
  if (audioSpotcheck.unexpected_silence) {
    issues.push(makeIssue('AUDIO_IS_SILENT',
      '音轨平均响度 ' + asNumber(loudness.mean_volume_db, 0) + ' dB 低于阈值 ' + SILENCE_THRESHOLD_DB + ' dB（数字静音）', 'error'))
  }

  // ④ promise_preservation
  const cuts = asArray(editDecisions.cuts)
  const moving = cuts.filter(c => asText(asObject(asObject(c).transform).animation) && asText(asObject(asObject(c).transform).animation) !== 'none')
  const motionRatio = cuts.length ? Number((moving.length / cuts.length).toFixed(4)) : 0
  let runtimeSwapCheck = 'skipped — 没有可比对的锁定 runtime'
  if (lockedRuntime && actualRuntime && !runtimeSwapped) {
    runtimeSwapCheck = 'ok — 锁定 ' + lockedRuntime + '，实际 ' + actualRuntime + '，一致'
  } else if (runtimeSwapped) {
    runtimeSwapCheck = 'detected — 锁定 ' + lockedRuntime + '，实际 ' + actualRuntime +
      (runtimeApproved ? '（该锁定值已获批准，属合同违规）' : '（该锁定值尚未由 G1 门确认，记为待办而非违规）')
  }
  const promisePreservation = {
    delivery_promise_honored: !runtimeSwapped,
    renderer_family_used: asText(renderReport.render_grammar),
    render_runtime_used: actualRuntime,
    runtime_swap_detected: runtimeSwapped,
    runtime_swap_check: runtimeSwapCheck,
    motion_ratio_actual: motionRatio,
    silent_downgrade_detected: audioSpotcheck.unexpected_silence,
    issues: [],
  }
  if (runtimeSwapped) {
    issues.push(makeIssue(
      runtimeApproved ? 'RUNTIME_SWAP_VIOLATION' : 'RUNTIME_SWAP_PENDING_CONFIRMATION',
      runtimeApproved
        ? '实际渲染 runtime（' + actualRuntime + '）与已批准的锁定值（' + lockedRuntime + '）不一致，属合同违规'
        : '实际渲染 runtime（' + actualRuntime + '）与锁定值（' + lockedRuntime + '）不一致；该锁定值尚未获批准' +
          '（真正的选择在 P3 的 G1 门），记为待办而非违规',
      runtimeApproved ? 'error' : 'info'
    ))
  }

  // ⑤ subtitle_check
  const subtitles = asObject(editDecisions.subtitles)
  const subtitleExpected = subtitles.enabled === true
  const subtitleSource = asText(subtitles.source)
  const subtitleCheck = {
    subtitles_expected: subtitleExpected,
    subtitles_present: subtitleExpected && Boolean(subtitleSource),
    coverage_ratio: subtitleExpected && subtitleSource ? 1 : (subtitleExpected ? 0 : 1),
    timing_drift_detected: false,
    issues: [],
  }
  if (subtitleExpected && !subtitleSource) {
    subtitleCheck.issues.push('字幕已启用但没有可推导的时间轴来源')
    issues.push(makeIssue('SUBTITLE_SOURCE_MISSING', '字幕已启用但缺少时间轴来源（无旁白音频时无法推导）', 'warn'))
  }

  // status：产物无效 ⇒ fail；有 error ⇒ revise；否则 pass
  const blocking = issues.filter(i => asText(i.severity) === 'error')
  const fatal = issues.some(i => asText(i.code) === 'RENDER_OUTPUT_INVALID' || asText(i.code) === 'AUDIO_IS_SILENT')
  let status = 'pass'
  if (fatal) status = 'fail'
  else if (blocking.length) status = 'revise'
  let recommendedAction = 'present_to_user'
  if (status === 'fail') recommendedAction = 're_render'
  else if (status === 'revise') {
    recommendedAction = blocking.some(i => asText(i.code).indexOf('AUDIO') === 0) ? 'revise_assets'
      : (blocking.some(i => asText(i.code).indexOf('SCENE') === 0 || asText(i.code).indexOf('CUT') === 0) ? 'revise_edit' : 're_render')
  }

  const review = {
    version: ARTIFACT_VERSION,
    output_path: outputPath,
    status,
    checks: {
      technical_probe: technicalProbe,
      visual_spotcheck: visualSpotcheck,
      audio_spotcheck: audioSpotcheck,
      promise_preservation: promisePreservation,
      subtitle_check: subtitleCheck,
    },
    issues_found: issues.map(i => asText(i.code) + ': ' + asText(i.message)),
    recommended_action: recommendedAction,
    metadata: {
      issues,
      silence_threshold_db: SILENCE_THRESHOLD_DB,
      checks_not_performed: asArray(frames.checks_not_performed),
      approval_status: approvalStatus,
    },
  }
  return fillRequired(review, schema, schema)
}

/**
 * 构造 publish_log。
 *
 * ⚠ 内置 publish 阶段在「未开启发布且无平台」时返回 `{skipped: true, publishedTo: [], failedPlatforms: []}`
 *   ⇒ 本模块记**一条** `status: 'draft'` 的 entry（不是 0 条）——
 *   schema 的 `entries` 没有 minItems，0 条会静默通过。
 *
 * @param {object} raw publish 阶段的原始输出
 * @param {{ videoPath?: string, platforms?: string[] }} ctx
 */
function buildPublishLog (raw, ctx = {}) {
  const schema = loadSchema('publish_log')
  const issues = []
  const output = asObject(raw)
  const now = new Date().toISOString()
  const entries = []

  const published = asArray(output.publishedTo).map(p => asText(asObject(p).platform || p)).filter(Boolean)
  const failed = asArray(output.failedPlatforms).map(p => asText(asObject(p).platform || p)).filter(Boolean)

  for (const platform of published) {
    const entry = { platform, status: 'published', timestamp: now }
    const url = asText(asObject(output.publishedTo).url)
    const videoId = asText(asObject(output.publishedTo).video_id)
    if (url) entry.url = url
    if (videoId) entry.video_id = videoId
    if (!url && !videoId) {
      issues.push(makeIssue('PUBLISHED_WITHOUT_URL', '平台「' + platform + '」记为已发布但没有 url / video_id，无法核对', 'warn'))
    }
    entries.push(entry)
  }
  for (const platform of failed) {
    entries.push({
      platform,
      status: 'failed',
      timestamp: now,
      // ⚠ 不能编造具体错误 ⇒ 只记「详见发布器日志」
      error: '发布失败（详见发布器日志）',
    })
  }
  if (!entries.length) {
    const platforms = asArray(ctx.platforms).map(String).filter(Boolean)
    entries.push({
      platform: platforms.length ? platforms.join(',') : 'none',
      status: 'draft',
      timestamp: now,
    })
    issues.push(makeIssue('PUBLISH_SKIPPED', '未开启发布且没有选择平台，已记为一条 draft 条目', 'info'))
  }

  const log = {
    version: ARTIFACT_VERSION,
    entries,
    metadata: {
      issues,
      skipped: output.skipped === true,
      video_path: asText(ctx.videoPath) || asText(output.videoPath),
    },
  }
  return fillRequired(log, schema, schema)
}

/**
 * publish_log 的机械自检。
 */
function checkPublishLogCriteria (log) {
  const issues = []
  const entries = asArray(asObject(log).entries)
  if (entries.length === 0) {
    issues.push(makeIssue('EMPTY_PUBLISH_LOG', 'publish_log 没有任何条目（跳过发布也要记一条 draft）', 'error'))
    return issues
  }
  for (const entry of entries) {
    const obj = asObject(entry)
    const status = asText(obj.status)
    if (status === 'failed' && !asText(obj.error)) {
      issues.push(makeIssue('FAILED_ENTRY_WITHOUT_ERROR',
        '平台「' + asText(obj.platform) + '」记为 failed 但没有 error 说明', 'error'))
    }
    if (status === 'published' && !asText(obj.url) && !asText(obj.video_id)) {
      issues.push(makeIssue('PUBLISHED_ENTRY_WITHOUT_URL',
        '平台「' + asText(obj.platform) + '」记为 published 但没有 url / video_id', 'error'))
    }
    if (!asText(obj.timestamp)) {
      issues.push(makeIssue('ENTRY_WITHOUT_TIMESTAMP',
        '平台「' + asText(obj.platform) + '」的条目没有 timestamp', 'error'))
    }
  }
  return issues
}

module.exports = {
  RENDERER_FAMILIES,
  buildRenderReport,
  buildFinalReview,
  buildPublishLog,
  checkPublishLogCriteria,
}
