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
 * 取值口径（三条易错，均有测试锁）：
 *   ① segments[].*Meta（provider 实际执行）优先于配置（用户提交意图）；
 *      多模态 provider 内部路由到别的模型、provider 忽略 model 参数时两者会不一致。
 *   ② model 优先于 provider；provider 仅在 model 缺失时兜底。
 *   ③ video 的配置与门控字段**不在 options**：`_safeOptions` 白名单不收 video 字段，
 *      真实落点是 `story2videoTextConfig.config.video`（见下方 resolveModelSummaryParts 内注释）。
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
  //
  // ⚠ 门控字段的**真实落点不是 options**（change: s2v-video-model-source）：
  //   story2video-project-service.js 的 `_safeOptions` 白名单只收 transition/resolution/
  //   image*/voice* 等，**不含任何 video 字段** ⇒ 持久化清单的 project.options 里永远没有
  //   videoMode/videoProvider/videoModel。视频配置由 normalizeStory2VideoTextParams 落盘到
  //   story2videoTextConfig.config.video（{ mode, provider, model, ... }）。
  //   首版只读 options，导致本项在生产环境恒不显示；options 一路保留为历史清单的兼容回退。
  const textConfig = isPlainObject(project.story2videoTextConfig) ? project.story2videoTextConfig : null;
  const textConfigBody = textConfig && isPlainObject(textConfig.config) ? textConfig.config : null;
  const videoConfig = textConfigBody && isPlainObject(textConfigBody.video) ? textConfigBody.video : {};
  const videoText = (key) => cleanText(videoConfig[key]);

  const videoMode = (videoText('mode') || cleanText(options.videoMode)).toLowerCase();
  if (VIDEO_ENABLED_MODES.has(videoMode)) {
    // 取值优先级：segments 的 videoMeta（provider 实际返回，落盘时 safeAssetMeta 保留
    // provider/model）> story2videoTextConfig.config.video（本次生成时的配置）> options（兼容）
    const videoModel = firstSegmentValue(segments, segment => segment?.videoMeta?.model) ||
      firstSegmentValue(segments, segment => segment?.videoMeta?.provider) ||
      videoText('model') ||
      videoText('provider') ||
      optionText('videoModel') ||
      optionText('videoProvider');
    if (videoModel) parts.push(label('videoModel') + ': ' + videoModel);
  }

  return parts;
}

/** 摘要文本：段间以 ` · ` 连接；无任何段时返回空串（调用方据此整段不渲染）。 */
function resolveModelSummaryText (project, segments, label) {
  return resolveModelSummaryParts(project, segments, label).join(' · ');
}

export {
  VIDEO_ENABLED_MODES,
  resolveModelSummaryParts,
  resolveModelSummaryText,
};
