// @ts-check
/**
 * story2video-voice-guard — 克隆音色前置守卫与 TTS 失败聚合（纯逻辑 + pipelineEngine 注入）
 *
 * 2026-10-18 事故：项目 mvdxd21s_o1ws 的 generate_assets 阶段 9 条 TTS 全部被供应商拒绝
 * （you don't have access to this voice_id），而本地克隆样本目录已丢失，导致「重新克隆」
 * 恢复路径 ENOENT；最终失败信息把同一句英文按场景重复 9 次，没有可操作信息。
 * 本模块提供：
 *   - isClonedVoiceUnavailableMessage：克隆音色不可用统一判定（tryReCloneVoice 复用）
 *   - resolveVoiceCloneGuard：生成前只读守卫（容器取 ttsVoiceCloneService → getCloneVoiceStatus）
 *   - buildVoiceCloneUnavailableError / buildVoiceCloneAggregateError：可操作错误文案
 *   - summarizeAssetFailures：相同错误合并为场景区间（Image/TTS 共用）
 * 守卫自身故障（服务缺失/方法缺失/查询抛错）一律「不阻断」，不得把守卫问题变成任务失败。
 */
"use strict";

/**
 * 统一判定 TTS 错误是否属于「克隆音色不可用 / 无权访问」。
 * 覆盖供应商真实文案（MiniMax "you don't have access to this voice_id"、
 * "invalid params, voice id wrong" 等）与既有中文分支；供 tryReCloneVoice
 * 恢复路径与 generate_assets 失败聚合共用，避免两处判定漂移。
 * @param {unknown} message
 * @returns {boolean}
 */
function isClonedVoiceUnavailableMessage(message) {
  const text = typeof message === "string" ? message : message == null ? "" : String(message);
  if (!text) return false;
  return (
    /(?:don't|do not|doesn't|does not|cannot|can't)\s+have\s+access.*voice/i.test(text) ||
    /voice_id.*(?:not\s+found|not\s+exist|invalid|wrong|not\s+support|no\s+access)/i.test(text) ||
    /(?:cloned?|custom)\s+voice.*(?:not\s+found|not\s+available|unavailable|not\s+accessible)/i.test(
      text,
    ) ||
    /voice\s+(?:id\s+)?(?:wrong|not\s+found|does\s+not\s+exist|unavailable|missing)/i.test(text) ||
    /invalid\s+params,?\s*voice\s*id\s*wrong/i.test(text) ||
    /当前账号.*音色|账号.*音色|属于.*其他.*账号/.test(text) ||
    /音色.*(?:无效|不存在|失效|错误|不支持)/.test(text) ||
    /voice.*(?:无效|不存在|失效|错误|不支持)/i.test(text) ||
    /声音.*(?:无效|不存在|失效|错误|不支持)/.test(text)
  );
}

// 克隆音色失效原因 → 用户可读中文（与 tts-voice-clone-service 的 invalidReason 对齐）
const CLONE_VOICE_INVALID_REASON_TEXT = Object.freeze({
  sample_storage_missing: "本地克隆样本已丢失，供应商也可能已不再受理该音色",
  invalid_voice_id: "音色 ID 不合法",
});

function cloneVoiceInvalidReasonText(reason) {
  return CLONE_VOICE_INVALID_REASON_TEXT[reason] || "音色已不可用";
}

/**
 * 构造「克隆音色已失效」的可操作性错误文案（generate_assets / finalize_assets 共用）。
 * @param {{voiceId: string, name?: string, reason?: string}} input
 * @returns {string}
 */
function buildVoiceCloneUnavailableError({ voiceId, name, reason }) {
  const displayName =
    typeof name === "string" && name.trim() ? name.trim() : String(voiceId || "");
  return (
    "VOICE_CLONE_UNAVAILABLE: 所选克隆音色「" +
    displayName +
    "」已失效（" +
    cloneVoiceInvalidReasonText(reason) +
    "），请在「声音」设置中重新克隆或改选其它音色后重新启动；本次未生成任何图片与旁白。"
  );
}

/**
 * 运行期聚合：全部 TTS 失败且原因均为「克隆音色不可用」时，返回一条可操作错误；
 * 其它情况返回 null（调用方继续使用逐条失败摘要）。
 * @param {Array<{error?: string}>} failedTts
 * @returns {string|null}
 */
function buildVoiceCloneAggregateError(failedTts) {
  if (!Array.isArray(failedTts) || failedTts.length === 0) return null;
  if (!failedTts.every((item) => isClonedVoiceUnavailableMessage(item && item.error))) return null;
  return "VOICE_CLONE_UNAVAILABLE: 所选克隆音色已不可用（供应商拒绝访问，且本地样本无法用于重新克隆）。请在「声音」设置中重新克隆或改选其它音色后重新启动。";
}

/**
 * 克隆音色前置守卫：在启动图片/视频/旁白生成之前，只读确认所选克隆音色仍可用。
 * 命中 registry 失效（本地样本丢失 / voice_id 非法）时返回可直接展示的
 * VOICE_CLONE_UNAVAILABLE 错误文案；服务缺失、方法缺失或查询抛错一律返回 null 不阻断。
 * @param {{pipelineEngine: any, voiceId: string, providerId: string, model: string}} input
 * @returns {Promise<string|null>}
 */
async function resolveVoiceCloneGuard({ pipelineEngine, voiceId, providerId, model }) {
  // 容器取服务：未注册/取不到/抛错一律视为「无服务」，守卫不阻断（守卫故障不得变成任务失败）
  const cloneService = (() => {
    try {
      const container = pipelineEngine && pipelineEngine.container;
      return container && typeof container.get === "function"
        ? container.get("ttsVoiceCloneService")
        : null;
    } catch (_) {
      return null;
    }
  })();
  if (!cloneService || typeof cloneService.getCloneVoiceStatus !== "function") return null;

  let status;
  try {
    status = await cloneService.getCloneVoiceStatus({ providerId, model, voiceId });
  } catch (_) {
    return null;
  }
  const data =
    status && status.code === 0 && status.data && typeof status.data === "object"
      ? status.data
      : null;
  if (!data || data.registered !== true || data.invalid !== true) return null;

  const reason =
    typeof data.invalidReason === "string" && data.invalidReason ? data.invalidReason : "unknown";
  const log = pipelineEngine && pipelineEngine.log;
  if (log && typeof log.warn === "function") {
    // 仅记录定位所需字段：不记录音频内容、密钥或绝对路径
    log.warn("Story2VideoStages", "[Story2Video] cloned voice blocked by preflight", {
      voiceId,
      provider: providerId,
      reason,
    });
  }
  return buildVoiceCloneUnavailableError({ voiceId, name: data.name, reason });
}

/**
 * 把失败场景索引格式化为「#3」/「#1-#3」/「#1, #3」/「#?」。
 * @param {Array<number|null>} indexes 场景号（1 基）；null 表示原结果缺少 index
 * @returns {string}
 */
function formatFailureIndexes(indexes) {
  const known = indexes.filter((value) => Number.isInteger(value)).sort((a, b) => a - b);
  const hasUnknown = indexes.some((value) => !Number.isInteger(value));
  if (known.length === 0) return "#?";
  const contiguous = known.every(
    (value, position) => position === 0 || value === known[position - 1] + 1,
  );
  let text =
    known.length > 1 && contiguous
      ? "#" + known[0] + "-#" + known[known.length - 1]
      : known.map((value) => "#" + value).join(", ");
  if (hasUnknown) text += ", #?";
  return text;
}

/**
 * 汇总资源失败：相同错误消息合并为一条，场景号输出区间/列表。
 * 2026-10-18 事故：9 条 TTS 失败原因完全相同，旧实现把同一句英文按场景重复 9 次。
 * 单条失败保持旧格式 `<label> #3: <message>`；Image/TTS 两类资源共用本函数。
 * @param {string} label 资源类别（TTS/Image）
 * @param {Array<{index?: number, error?: string}>} results
 * @returns {string[]}
 */
function summarizeAssetFailures(label, results) {
  const grouped = new Map();
  for (const item of Array.isArray(results) ? results : []) {
    const index = Number.isInteger(item?.index) ? item.index + 1 : null;
    const message =
      typeof item?.error === "string" && item.error.trim()
        ? item.error.trim().replace(/\s+/g, " ").slice(0, 500)
        : label + " generation failed";
    if (!grouped.has(message)) grouped.set(message, []);
    grouped.get(message).push(index);
  }
  return [...grouped.entries()].map(
    ([message, indexes]) => label + " " + formatFailureIndexes(indexes) + ": " + message,
  );
}

module.exports = {
  isClonedVoiceUnavailableMessage,
  buildVoiceCloneUnavailableError,
  buildVoiceCloneAggregateError,
  resolveVoiceCloneGuard,
  summarizeAssetFailures,
};
