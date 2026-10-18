/**
 * 视频任务编辑页（ResultView）模型信息解析 —— 纯函数，无 Vue / DOM 依赖。
 *
 * 合同锚点：01-docs/PRD-S2V-RESULT-MODEL-INFO-2026-10-18.md §3.2 / §4
 * 主 PRD：01-docs/PRD.md §7.1.39
 *
 * 为什么抽成独立模块：ResultView.vue 是 max-lines 点名还账对象（零增长容差），
 * 而模型信息的取值口径（优先级 / 门控 / 脏数据防御）本身是可独立测的逻辑面。
 * 抽走后宿主只留 2 行 computed 接线，逻辑与测试都不必挤进 1900 行的视图文件。
 *
 * 取值口径（两条易错，均有测试锁）：
 *   ① segments[].*Meta（provider 实际执行）优先于 project.options（用户提交意图）；
 *      多模态 provider 内部路由到别的模型、provider 忽略 model 参数时两者会不一致。
 *   ② model 优先于 provider；provider 仅在 model 缺失时兜底。
 */

/** 视频增强模式枚举中视为「启用了视频模型」的值（与 pipeline-model-preflight 的 video 能力需求同源）。 */
const VIDEO_ENABLED_MODES = new Set(['fixed', 'ai-judged']);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const cleanText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');

/** 逐段取首个非空值；segments 非数组 / 单项非对象时安全跳过。 */
const firstSegmentValue = (segments, pick) => {
  if (!Array.isArray(segments)) return '';
  for (const segment of segments) {
    if (!isPlainObject(segment)) continue;
    const value = pick(segment);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

/**
 * 解析模型信息摘要的各段文本（不含标签，标签由调用方按 locale 拼）。
 *
 * @param {object|null} project story2video:get-project 返回的项目对象
 * @param {Array<object>} segments 前端分段数组（含 provider 实际返回的 *Meta）
 * @param {function} label 标签解析函数：label('textModel'|'voiceModel'|'imageModel'|'videoModel') => string
 * @returns {string[]} 非空段的有序数组；顺序固定为 文本 → 语音 → 图片 → 视频
 */
function resolveModelSummaryParts (project, segments, label) {
  if (!isPlainObject(project)) return [];
  const options = isPlainObject(project.options) ? project.options : {};
  const optionText = (key) => cleanText(options[key]);

  // segments 实际执行值优先（model 先、provider 后），再回退 options 的 model，最后 options 的 provider
  const resolveModel = (metaKey, modelKey, providerKey) => (
    firstSegmentValue(segments, segment => segment?.[metaKey]?.model) ||
    firstSegmentValue(segments, segment => segment?.[metaKey]?.provider) ||
    optionText(modelKey) ||
    optionText(providerKey)
  );

  const parts = [];

  // 文本模型：optimize 阶段 prompt-engine 返回的 model_used（含 'template' 降级值，如实呈现）
  const textModel = firstSegmentValue(segments, segment => segment?.promptOptimizationMeta?.model_used);
  if (textModel) parts.push(label('textModel') + ': ' + textModel);

  const voiceModel = resolveModel('audioMeta', 'voiceModel', 'voiceProvider');
  if (voiceModel) parts.push(label('voiceModel') + ': ' + voiceModel);

  const imageModel = resolveModel('imageMeta', 'imageModel', 'imageProvider');
  if (imageModel) parts.push(label('imageModel') + ': ' + imageModel);

  // 视频模型双重门控：videoMode 为 fixed/ai-judged 才算启用视频增强；off/缺省一律不显示。
  // 只按 videoProvider 有无判断会把「曾选过 provider 后又把 mode 切回 off」误显示成启用。
  const videoMode = cleanText(options.videoMode).toLowerCase();
  if (VIDEO_ENABLED_MODES.has(videoMode)) {
    const videoModel = resolveModel('videoMeta', 'videoModel', 'videoProvider');
    if (videoModel) parts.push(label('videoModel') + ': ' + videoModel);
  }

  return parts;
}

/** 摘要文本：段间以 ` · ` 连接；无任何段时返回空串（调用方据此整段不渲染）。 */
function resolveModelSummaryText (project, segments, label) {
  return resolveModelSummaryParts(project, segments, label).join(' · ');
}

module.exports = {
  VIDEO_ENABLED_MODES,
  resolveModelSummaryParts,
  resolveModelSummaryText,
};
