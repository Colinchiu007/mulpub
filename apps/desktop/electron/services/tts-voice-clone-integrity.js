// @ts-check
/**
 * tts-voice-clone-integrity — 克隆音色样本完整性判定（纯逻辑 + 依赖注入）
 *
 * 2026-10-18 事故：SQLite registry 中克隆记录仍为 active，但本地
 * voice-clone-samples/<ownerHash>/<storageId> 目录已被清理，导致
 * 「供应商拒绝访问 → 用本地样本重新克隆」的恢复路径必然 ENOENT。
 * 本模块只做只读判定，不写任何文件/registry：
 *   - inspectSampleStorage：样本目录三态（ok / missing / unknown）
 *   - computeCloneInvalidReason：失效原因（invalid_voice_id 优先于 sample_storage_missing）
 *   - buildPublicCloneEntries：listClones 公开条目 + 失效标记
 *   - readCloneVoiceStatus：getCloneVoiceStatus 主体（模型候选回退与 findCloneSamples 同风格）
 *   - findCloneSamplesWithRuntime：findCloneSamples 主体（行为与返回形状保持不变）
 * 依赖（fs / store / 路径与安全校验回调）全部由调用方注入，避免与 service 循环 require。
 */
"use strict";

const path = require("node:path");

// 可接受的克隆样本音频扩展名（与 tts-voice-clone-service.ALLOWED_AUDIO_EXTENSIONS 同源）
const SAMPLE_AUDIO_EXTENSIONS = Object.freeze([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".opus",
  ".wav",
  ".webm",
]);
const SAMPLE_AUDIO_EXTENSION_SET = new Set(SAMPLE_AUDIO_EXTENSIONS);

// 克隆音色失效原因（与前端/流水线 invalidReason 契约一致）
const CLONE_INVALID_REASONS = Object.freeze({
  INVALID_VOICE_ID: "invalid_voice_id",
  SAMPLE_STORAGE_MISSING: "sample_storage_missing",
});

// findCloneSamples / getCloneVoiceStatus 共用的模型候选回退顺序：先精确 model，再已知 TTS 模型。
// 恢复任务可能没有携带 voiceModel，或用户切换过模型；MiniMax 克隆 registry 绑定
// speech-2.8-turbo 等模型下，MiMo 克隆 registry 绑定 mimo-v2.5-tts-voiceclone 下。
const CLONE_CANDIDATE_MODELS = Object.freeze([
  "speech-2.8-turbo",
  "speech-02-hd",
  "speech-2.8-hd",
  "speech-2.6-hd",
  "speech-2.6-turbo",
  "mimo-v2.5-tts-voiceclone",
  "mimo-v2.5-tts",
]);

function success(data) {
  return { code: 0, data };
}

function failure(message) {
  return { code: -1, message };
}

/**
 * 判定克隆样本目录的持久化状态（只读探测，不创建/修复任何文件）。
 * - 'ok'：sampleStorage 合法且目录内至少有一个音频文件（可重新克隆）；
 * - 'missing'：sampleStorage 描述非法 / 目录不存在 / 非目录 / 符号链接 / 目录内无音频文件；
 * - 'unknown'：无 sampleStorage（历史记录）或 userData 路径不可解析 / 目录读取失败，
 *   这类情况不能据此判失效（避免误杀历史数据）。
 * @param {{
 *   fs: any,
 *   userDataPath: string|null,
 *   owner: {subject: string, hash: string},
 *   sampleStorage: {relativeDir: string, sampleCount: number}|undefined,
 *   isSafeSampleStorage: (value: unknown, owner: unknown) => boolean,
 *   isPathWithin: (parentPath: string, candidatePath: string) => boolean,
 * }} input
 * @returns {Promise<'ok'|'missing'|'unknown'>}
 */
async function inspectSampleStorage({
  fs,
  userDataPath,
  owner,
  sampleStorage,
  isSafeSampleStorage,
  isPathWithin,
}) {
  if (!sampleStorage || typeof sampleStorage !== "object" || Array.isArray(sampleStorage))
    return "unknown";
  if (!isSafeSampleStorage(sampleStorage, owner)) return "missing";
  if (!userDataPath) return "unknown";
  const directoryPath = path.resolve(userDataPath, sampleStorage.relativeDir);
  if (!isPathWithin(userDataPath, directoryPath)) return "missing";

  let directoryStat;
  try {
    directoryStat = await fs.promises.lstat(directoryPath);
  } catch (error) {
    // 目录不存在 = 样本已丢失；其它 lstat 失败（权限/IO）无法判定，保守返回 unknown
    return error && error.code === "ENOENT" ? "missing" : "unknown";
  }
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return "missing";

  let entries;
  try {
    entries = await fs.promises.readdir(directoryPath);
  } catch (_) {
    return "unknown";
  }
  const hasAudioFile =
    Array.isArray(entries) &&
    entries.some((entry) =>
      SAMPLE_AUDIO_EXTENSION_SET.has(path.extname(String(entry)).toLowerCase()),
    );
  return hasAudioFile ? "ok" : "missing";
}

/**
 * 计算单条克隆记录的失效原因：voice_id 非法（历史数据）优先于本地样本缺失；
 * 两者都不命中返回 null（记录可用）。
 * @param {{providerId: string, voiceId: string, isVoiceIdValid: (providerId: string, voiceId: string) => boolean, sampleStorageStatus: string}} input
 * @returns {string|null}
 */
function computeCloneInvalidReason({
  providerId,
  voiceId,
  isVoiceIdValid,
  sampleStorageStatus,
}) {
  if (!isVoiceIdValid(providerId, voiceId)) return CLONE_INVALID_REASONS.INVALID_VOICE_ID;
  return sampleStorageStatus === "missing"
    ? CLONE_INVALID_REASONS.SAMPLE_STORAGE_MISSING
    : null;
}

/**
 * 组装 listClones 的公开条目：逐个记录计算失效原因，未失效的记录保持既有形状
 * （不输出 invalid / invalidReason）。
 * @param {{
 *   voices: Array<object>,
 *   providerId: string,
 *   toPublicVoice: (voice: object) => object,
 *   isVoiceIdValid: (providerId: string, voiceId: string) => boolean,
 *   sampleStorageStatusOf: (sampleStorage: unknown) => Promise<string>,
 * }} input
 * @returns {Promise<Array<object>>}
 */
async function buildPublicCloneEntries({
  voices,
  providerId,
  toPublicVoice,
  isVoiceIdValid,
  sampleStorageStatusOf,
}) {
  const entries = [];
  for (const voice of voices) {
    const publicEntry = toPublicVoice(voice);
    const invalidReason = computeCloneInvalidReason({
      providerId,
      voiceId: voice.id,
      isVoiceIdValid,
      sampleStorageStatus: await sampleStorageStatusOf(voice.sampleStorage),
    });
    if (invalidReason) {
      publicEntry.invalid = true;
      publicEntry.invalidReason = invalidReason;
    }
    entries.push(publicEntry);
  }
  return entries;
}

/**
 * 组装模型候选列表：精确 model 优先，其后是已知 TTS 模型（去重由调用方用 Set 完成）。
 * @param {string} model
 * @returns {string[]}
 */
function buildCloneCandidateModels(model) {
  return [model, ...CLONE_CANDIDATE_MODELS].filter(Boolean);
}

/**
 * getCloneVoiceStatus 主体（只读）：按候选模型查 owner 隔离的 registry，
 * 命中 active 记录后返回 registered/name/invalid/invalidReason。
 * @param {{
 *   store: any,
 *   owner: {subject: string, hash: string},
 *   request: {providerId: string, model: string, voiceId: string},
 *   buildRegistryKey: (providerId: string, model: string) => string,
 *   isVoiceIdValid: (providerId: string, voiceId: string) => boolean,
 *   activeDeletionState: string,
 *   sampleStorageStatusOf: (sampleStorage: unknown) => Promise<string>,
 * }} input
 * @returns {Promise<{code: number, data?: object, message?: string}>}
 */
async function readCloneVoiceStatus({
  store,
  owner,
  request,
  buildRegistryKey,
  isVoiceIdValid,
  activeDeletionState,
  sampleStorageStatusOf,
}) {
  const triedKeys = new Set();
  for (const model of buildCloneCandidateModels(request.model)) {
    const key = buildRegistryKey(request.providerId, model);
    if (triedKeys.has(key)) continue;
    triedKeys.add(key);
    let registry;
    try {
      registry = store.getUserSetting(key, null, owner.subject);
    } catch (_) {
      return failure("VOICE_CLONE_STORE_UNAVAILABLE");
    }
    if (!registry || !Array.isArray(registry.voices)) continue;
    const clone = registry.voices.find(
      (voice) => voice && voice.id === request.voiceId && voice.deletionState === activeDeletionState,
    );
    if (!clone) continue;
    const invalidReason = computeCloneInvalidReason({
      providerId: request.providerId,
      voiceId: clone.id,
      isVoiceIdValid,
      sampleStorageStatus: await sampleStorageStatusOf(clone.sampleStorage),
    });
    return success({
      registered: true,
      name: clone.name,
      invalid: invalidReason !== null,
      invalidReason,
    });
  }
  return success({ registered: false });
}

/**
 * findCloneSamples 主体：行为与返回形状保持不变（{ sampleStorage, name, model } 或 null），
 * 供跨账号重新克隆读取本地样本。
 * @param {{
 *   store: any,
 *   captureOwner: () => {subject: string, hash: string}|null,
 *   voiceId: string,
 *   providerId: string,
 *   model: string,
 *   buildRegistryKey: (providerId: string, model: string) => string,
 *   activeDeletionState: string,
 * }} input
 * @returns {Promise<{sampleStorage: object, name: string, model: string}|null>}
 */
async function findCloneSamplesWithRuntime({
  store,
  captureOwner,
  voiceId,
  providerId,
  model,
  buildRegistryKey,
  activeDeletionState,
}) {
  if (!store || !voiceId) return null;
  const owner = captureOwner();
  if (!owner) return null;
  const triedKeys = new Set();
  for (const candidateModel of buildCloneCandidateModels(model)) {
    const key = buildRegistryKey(providerId, candidateModel);
    if (triedKeys.has(key)) continue;
    triedKeys.add(key);
    let registry;
    try {
      registry = store.getUserSetting(key, null, owner.subject);
    } catch (_) {
      continue;
    }
    if (!registry || !Array.isArray(registry.voices)) continue;
    const clone = registry.voices.find(
      (voice) => voice.id === voiceId && voice.deletionState === activeDeletionState,
    );
    if (clone && clone.sampleStorage) {
      return { sampleStorage: clone.sampleStorage, name: clone.name, model: candidateModel };
    }
  }
  return null;
}

module.exports = {
  SAMPLE_AUDIO_EXTENSIONS,
  CLONE_INVALID_REASONS,
  CLONE_CANDIDATE_MODELS,
  inspectSampleStorage,
  computeCloneInvalidReason,
  buildPublicCloneEntries,
  readCloneVoiceStatus,
  findCloneSamplesWithRuntime,
};
