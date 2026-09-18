// @ts-check
"use strict";

const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { CAPABILITY_TYPES, getVoiceCapability } = require("./tts-voice-catalog");
const { findFfprobe } = require("./media-tool-paths");

const CLONE_REGISTRY_VERSION = 2;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_VOICE_ID_LENGTH = 256;
const MAX_VOICE_NAME_LENGTH = 128;
const MAX_SAMPLE_COUNT = 10;
const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_SAMPLE_BYTES = 25 * 1024 * 1024;
const MAX_SAMPLE_DURATION_SECONDS = 15 * 60;
const MAX_TOTAL_DURATION_SECONDS = 30 * 60;
const DEFAULT_SAMPLE_SELECTION_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_SAMPLE_SELECTIONS = 8;
const MAX_ACTIVE_SAMPLE_SELECTION_BYTES = MAX_TOTAL_SAMPLE_BYTES * 2;
const FFPROBE_TIMEOUT_MS = 15 * 1000;
const MAX_FFPROBE_OUTPUT_BYTES = 128 * 1024;
const CLONE_SAMPLE_STORAGE_DIRECTORY = "voice-clone-samples";
const LOCAL_CLONE_SAMPLE_LIMITS = Object.freeze({
  elevenlabs: Object.freeze({
    eleven_multilingual_v2: Object.freeze({ maxSampleCount: 5 }),
    eleven_turbo_v2_5: Object.freeze({ maxSampleCount: 5 }),
    eleven_monolingual_v1: Object.freeze({ maxSampleCount: 5 }),
  }),
  // MiMo 官方音色复刻要求（speech-synthesis-v2.5）：
  // 单文件、mp3/wav、Base64 后 ≤10MB（本地校验按原始字节 ≤10MB 保守执行）
  'mimo-tts': Object.freeze({
    'mimo-v2.5-tts': Object.freeze({ maxSampleCount: 1, maxSampleBytes: 10 * 1024 * 1024, allowedExtensions: ['.mp3', '.wav'] }),
    'mimo-v2.5-tts-voiceclone': Object.freeze({ maxSampleCount: 1, maxSampleBytes: 10 * 1024 * 1024, allowedExtensions: ['.mp3', '.wav'] }),
  }),
  // MiniMax 官方音色快速复刻要求（speech-voice-clone）：
  // 单文件、mp3/m4a/wav、时长 10s-5min、大小 ≤20MB
  'minimax-tts': Object.freeze({
    'speech-2.8-turbo': Object.freeze({ maxSampleCount: 1, maxSampleBytes: 20 * 1024 * 1024, minSampleDurationSeconds: 10, maxSampleDurationSeconds: 300, allowedExtensions: ['.mp3', '.m4a', '.wav'] }),
    'speech-2.8-hd': Object.freeze({ maxSampleCount: 1, maxSampleBytes: 20 * 1024 * 1024, minSampleDurationSeconds: 10, maxSampleDurationSeconds: 300, allowedExtensions: ['.mp3', '.m4a', '.wav'] }),
    'speech-2.6-hd': Object.freeze({ maxSampleCount: 1, maxSampleBytes: 20 * 1024 * 1024, minSampleDurationSeconds: 10, maxSampleDurationSeconds: 300, allowedExtensions: ['.mp3', '.m4a', '.wav'] }),
    'speech-2.6-turbo': Object.freeze({ maxSampleCount: 1, maxSampleBytes: 20 * 1024 * 1024, minSampleDurationSeconds: 10, maxSampleDurationSeconds: 300, allowedExtensions: ['.mp3', '.m4a', '.wav'] }),
  }),
  // 多模态模型（minimax-multimodal）内部委托 minimax-tts adapter 实现 TTS/克隆能力，
  // 样本限制必须与 minimax-tts 完全一致（官方单文件 10s-5min、≤20MB），
  // 否则「语音生成器默认多模态模型」后克隆提示会出现错误的宽松限制。
  'minimax-multimodal': Object.freeze({
    'speech-2.8-turbo': Object.freeze({ maxSampleCount: 1, maxSampleBytes: 20 * 1024 * 1024, minSampleDurationSeconds: 10, maxSampleDurationSeconds: 300, allowedExtensions: ['.mp3', '.m4a', '.wav'] }),
    'speech-2.8-hd': Object.freeze({ maxSampleCount: 1, maxSampleBytes: 20 * 1024 * 1024, minSampleDurationSeconds: 10, maxSampleDurationSeconds: 300, allowedExtensions: ['.mp3', '.m4a', '.wav'] }),
    'speech-2.6-hd': Object.freeze({ maxSampleCount: 1, maxSampleBytes: 20 * 1024 * 1024, minSampleDurationSeconds: 10, maxSampleDurationSeconds: 300, allowedExtensions: ['.mp3', '.m4a', '.wav'] }),
    'speech-2.6-turbo': Object.freeze({ maxSampleCount: 1, maxSampleBytes: 20 * 1024 * 1024, minSampleDurationSeconds: 10, maxSampleDurationSeconds: 300, allowedExtensions: ['.mp3', '.m4a', '.wav'] }),
  }),
});
const DELETE_STATES = Object.freeze({
  ACTIVE: "active",
  PENDING: "pending",
  REMOTE_DELETED: "remote_deleted",
});
const ALLOWED_AUDIO_EXTENSIONS = Object.freeze({
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
});

const cloneRegistryLocks = new Map();

class VoiceCloneError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function success(data) {
  return { code: 0, data };
}

function failure(message, data) {
  return data === undefined ? { code: -1, message } : { code: -1, message, data };
}

function safeIdentifier(value, maxLength = MAX_IDENTIFIER_LENGTH) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || !/^[a-zA-Z0-9._-]+$/.test(normalized))
    return null;
  return normalized;
}

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function safeDisplayName(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_VOICE_NAME_LENGTH || hasControlCharacter(normalized))
    return null;
  return normalized;
}

function cloneRegistrySettingKey(providerId, model) {
  return `tts-voice-clones:v2:${providerId}:${model}`;
}

function clonePreferenceSettingKey(providerId, model) {
  return `tts-voice-preference:v1:${providerId}:${model}`;
}

function hashOwnerSubject(ownerSubject) {
  return crypto.createHash("sha256").update(ownerSubject, "utf8").digest("hex");
}

function isPathWithin(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return Boolean(
    relativePath &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath),
  );
}

function cloneSampleStorageRelativeDir(owner, storageId) {
  return `${CLONE_SAMPLE_STORAGE_DIRECTORY}/${owner.hash}/${storageId}`;
}

function isSafeCloneSampleStorage(value, owner) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set(["relativeDir", "sampleCount"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (
    !owner ||
    typeof owner.hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(owner.hash) ||
    typeof value.relativeDir !== "string" ||
    !Number.isSafeInteger(value.sampleCount) ||
    value.sampleCount <= 0 ||
    value.sampleCount > MAX_SAMPLE_COUNT
  ) {
    return false;
  }
  const segments = value.relativeDir.split("/");
  return (
    segments.length === 3 &&
    segments[0] === CLONE_SAMPLE_STORAGE_DIRECTORY &&
    segments[1] === owner.hash &&
    safeIdentifier(segments[2], 128) !== null
  );
}

/**
 * 按 provider 校验克隆音色 voice_id 是否合法。
 * MiniMax 官方对自定义克隆 voice_id 有严格约束（长度 [8,256]、首字母、仅 [A-Za-z0-9_-]、
 * 末位非 -/_）；存量数据若以旧逻辑生成了非法 id（如 "01"），合成时会被平台拒绝
 * （"invalid params, voice id wrong"），需要标记失效并让偏好回退默认音色。
 * 其他 provider 无此约束，恒视为合法。
 */
function isProviderCloneVoiceIdValid(providerId, id) {
  if (providerId === "minimax-tts" || providerId === "minimax" || providerId === "minimax-multimodal") {
    try {
      const { isValidMiniMaxCloneVoiceId } = require("./adapters/minimax-tts");
      return isValidMiniMaxCloneVoiceId(id);
    } catch (_) {
      return true;
    }
  }
  return true;
}

function getLocalCloneSampleLimits(providerId, model) {
  const providerLimits = LOCAL_CLONE_SAMPLE_LIMITS[providerId];
  const modelLimits = providerLimits && providerLimits[model];
  const maxTotalBytes = modelLimits && Number.isFinite(modelLimits.maxSampleBytes)
    ? Math.min(MAX_TOTAL_SAMPLE_BYTES, Math.max(MAX_TOTAL_SAMPLE_BYTES, modelLimits.maxSampleBytes * modelLimits.maxSampleCount))
    : MAX_TOTAL_SAMPLE_BYTES;
  return {
    maxSampleCount: modelLimits ? modelLimits.maxSampleCount : MAX_SAMPLE_COUNT,
    maxSampleBytes: modelLimits && Number.isFinite(modelLimits.maxSampleBytes)
      ? modelLimits.maxSampleBytes
      : MAX_SAMPLE_BYTES,
    minSampleDurationSeconds: modelLimits && Number.isFinite(modelLimits.minSampleDurationSeconds)
      ? modelLimits.minSampleDurationSeconds
      : 0,
    maxSampleDurationSeconds: modelLimits && Number.isFinite(modelLimits.maxSampleDurationSeconds)
      ? modelLimits.maxSampleDurationSeconds
      : MAX_SAMPLE_DURATION_SECONDS,
    maxTotalBytes,
    maxTotalDurationSeconds: MAX_TOTAL_DURATION_SECONDS,
    allowedExtensions: modelLimits && Array.isArray(modelLimits.allowedExtensions)
      ? [...modelLimits.allowedExtensions]
      : Object.keys(ALLOWED_AUDIO_EXTENSIONS),
  };
}

function copyCapability(capability) {
  return {
    providerId: capability.providerId,
    model: capability.model,
    type: capability.type,
    canListVoices: capability.canListVoices === true,
    defaultVoiceId: capability.defaultVoiceId || null,
    clone:
      capability.clone && typeof capability.clone === "object"
        ? {
            enabled: capability.clone.enabled === true,
            entry: capability.clone.entry || null,
            implementation: capability.clone.implementation || null,
            messageKey: capability.clone.messageKey || null,
          }
        : null,
    reason: capability.reason || null,
  };
}

function normalizeAdapterVoice(value, fallbackName) {
  if (typeof value === "string") {
    const id = safeIdentifier(value, MAX_VOICE_ID_LENGTH);
    return id ? { id, name: fallbackName } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = safeIdentifier(value.voiceId || value.voice_id || value.id, MAX_VOICE_ID_LENGTH);
  if (!id) return null;
  return {
    id,
    name: safeDisplayName(value.name || value.displayName || value.display_name) || fallbackName,
  };
}

function isSafeCloneVoice(value, providerId, model, owner) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set([
    "id",
    "name",
    "source",
    "createdAt",
    "deletionState",
    "sampleStorage",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  const id = safeIdentifier(value.id, MAX_VOICE_ID_LENGTH);
  const name = safeDisplayName(value.name);
  const deletionState =
    value.deletionState === undefined ? DELETE_STATES.ACTIVE : value.deletionState;
  return Boolean(
    id &&
    name &&
    value.source === CAPABILITY_TYPES.USER_CLONE &&
    Number.isFinite(value.createdAt) &&
    Object.values(DELETE_STATES).includes(deletionState) &&
    (value.sampleStorage === undefined || isSafeCloneSampleStorage(value.sampleStorage, owner)) &&
    providerId.length > 0 &&
    model.length > 0,
  );
}

function isSafeCloneRegistry(value, providerId, model, owner) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set(["version", "providerId", "model", "voices"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  if (
    value.version !== CLONE_REGISTRY_VERSION ||
    value.providerId !== providerId ||
    value.model !== model
  )
    return false;
  if (
    !Array.isArray(value.voices) ||
    !value.voices.every((voice) => isSafeCloneVoice(voice, providerId, model, owner))
  )
    return false;
  return new Set(value.voices.map((voice) => voice.id)).size === value.voices.length;
}

function publicVoice(voice) {
  return {
    id: voice.id,
    name: voice.name,
    source: voice.source,
    createdAt: voice.createdAt,
  };
}

class TtsVoiceCloneService {
  constructor(deps = {}) {
    this._store = deps.store || null;
    this._modelProviderManager = deps.modelProviderManager || null;
    this._fs = deps.fs || fs;
    this._app = deps.app || null;
    this._userDataPath = typeof deps.userDataPath === "string" ? deps.userDataPath : null;
    this._getUserDataPath =
      typeof deps.getUserDataPath === "function" ? deps.getUserDataPath : null;
    this._createSampleStorageId =
      typeof deps.createSampleStorageId === "function"
        ? deps.createSampleStorageId
        : typeof deps.randomUUID === "function"
          ? deps.randomUUID
          : crypto.randomUUID;
    this._now = typeof deps.now === "function" ? deps.now : () => Date.now();
    this._getVoiceCapability =
      typeof deps.getVoiceCapability === "function" ? deps.getVoiceCapability : getVoiceCapability;
    this._createSelectionToken =
      typeof deps.createSelectionToken === "function"
        ? deps.createSelectionToken
        : crypto.randomUUID;
    this._selectionTtlMs =
      Number.isFinite(deps.selectionTtlMs) && deps.selectionTtlMs > 0
        ? deps.selectionTtlMs
        : DEFAULT_SAMPLE_SELECTION_TTL_MS;
    this._ffprobePath = typeof deps.ffprobePath === "string" ? deps.ffprobePath : findFfprobe();
    this._spawn = typeof deps.spawn === "function" ? deps.spawn : spawn;
    this._probeDuration =
      typeof deps.probeDuration === "function"
        ? deps.probeDuration
        : (buffer) => this._probeMediaDuration(buffer);
    this._setTimeout = typeof deps.setTimeout === "function" ? deps.setTimeout : setTimeout;
    this._clearTimeout = typeof deps.clearTimeout === "function" ? deps.clearTimeout : clearTimeout;
    this._sampleSelections = new Map();
    this._selectionExpiryTimers = new Map();
    this._log =
      typeof deps.log === "object" && deps.log && typeof deps.log.warn === "function"
        ? deps.log
        : require("./logger");
  }

  getRequirements(input) {
    const request = this._normalizeRequest(input);
    if (!request) return failure("VOICE_CLONE_INVALID_ARGUMENTS");
    const capability = this._getCloneCapability(request);
    if (!capability) return this._unsupportedResponse(request);
    const sampleLimits = getLocalCloneSampleLimits(request.providerId, request.model);
    return success({
      providerId: request.providerId,
      model: request.model,
      capability: copyCapability(capability),
      sampleLimitScope: "local_safety",
      ...sampleLimits,
      durationProbe: "ffprobe",
      allowedExtensions: sampleLimits.allowedExtensions,
    });
  }

  async listClones(input) {
    const request = this._normalizeRequest(input);
    if (!request) return failure("VOICE_CLONE_INVALID_ARGUMENTS");
    const owner = this._captureOwner();
    if (!owner) return failure("VOICE_OWNER_UNAVAILABLE");
    const capability = this._getCloneCapability(request);
    if (!capability) return this._unsupportedResponse(request);
    if (!this._hasUserSettings()) return failure("VOICE_CLONE_STORE_UNAVAILABLE");

    const registryResult = this._readRegistry(request, owner);
    if (registryResult.error) return registryResult.error;
    return success({
      providerId: request.providerId,
      model: request.model,
      voices: registryResult.registry.voices.map((voice) => {
        const publicEntry = publicVoice(voice);
        if (!isProviderCloneVoiceIdValid(request.providerId, voice.id)) publicEntry.invalid = true;
        return publicEntry;
      }),
    });
  }

  async createSampleSelection(input, paths, senderKey) {
    const request = this._normalizeRequest(input);
    if (!request || !this._isSafeSenderKey(senderKey)) {
      return failure("VOICE_CLONE_INVALID_ARGUMENTS");
    }
    const owner = this._captureOwner();
    if (!owner) return failure("VOICE_OWNER_UNAVAILABLE");
    const capability = this._getCloneCapability(request);
    if (!capability) return this._unsupportedResponse(request);
    const sampleLimits = getLocalCloneSampleLimits(request.providerId, request.model);
    if (!this._areSafeSelectionPaths(paths, sampleLimits.maxSampleCount)) {
      return failure("VOICE_CLONE_INVALID_ARGUMENTS");
    }

    let samples;
    try {
      samples = await this._prepareSamples(paths, sampleLimits);
    } catch (error) {
      return failure(
        error instanceof VoiceCloneError ? error.code : "VOICE_CLONE_STORAGE_UNAVAILABLE",
      );
    }

    this._purgeExpiredSelections();
    const selectionBytes = samples.reduce((total, sample) => total + sample.bytes, 0);
    if (
      this._sampleSelections.size >= MAX_ACTIVE_SAMPLE_SELECTIONS ||
      this._activeSelectionBytes() + selectionBytes > MAX_ACTIVE_SAMPLE_SELECTION_BYTES
    ) {
      return failure("VOICE_CLONE_SELECTION_UNAVAILABLE");
    }
    const selectionId = safeIdentifier(this._createSelectionToken(), 128);
    if (!selectionId || this._sampleSelections.has(selectionId))
      return failure("VOICE_CLONE_SELECTION_UNAVAILABLE");
    const expiresAt = this._now() + this._selectionTtlMs;
    const selection = {
      providerId: request.providerId,
      model: request.model,
      owner,
      senderKey,
      samples,
      bytes: selectionBytes,
      expiresAt,
    };
    this._sampleSelections.set(selectionId, selection);
    if (!this._scheduleSelectionExpiry(selectionId, selection)) {
      this._discardSelection(selectionId);
      return failure("VOICE_CLONE_SELECTION_UNAVAILABLE");
    }
    return success({
      selectionId,
      expiresAt,
      samples: samples.map((sample, index) => this._selectedSampleSummary(sample, index)),
    });
  }

  async addCloneFromSelection(input, senderKey) {
    const request = this._normalizeSelectionAddRequest(input);
    if (!request || !this._isSafeSenderKey(senderKey))
      return failure("VOICE_CLONE_INVALID_ARGUMENTS");
    const owner = this._captureOwner();
    if (!owner) return failure("VOICE_OWNER_UNAVAILABLE");
    this._purgeExpiredSelections();
    const selection = this._sampleSelections.get(request.selectionId);
    if (
      !selection ||
      selection.senderKey !== senderKey ||
      selection.owner.subject !== owner.subject ||
      selection.providerId !== request.providerId ||
      selection.model !== request.model
    ) {
      return failure("VOICE_CLONE_SELECTION_UNAVAILABLE");
    }
    this._discardSelection(request.selectionId);
    return this._addClone(
      {
        providerId: request.providerId,
        model: request.model,
        name: request.name,
        samples: selection.samples,
      },
      owner,
    );
  }

  async _addClone(request, owner) {
    return this._withRegistryLock(request, owner, () => this._addCloneLocked(request, owner));
  }

  async _addCloneLocked(request, owner) {
    const capability = this._getCloneCapability(request);
    if (!capability) return this._unsupportedResponse(request);
    if (!this._hasUserSettings()) return failure("VOICE_CLONE_STORE_UNAVAILABLE");
    if (!this._hasMatchingProvider(request.providerId, request.model))
      return failure("VOICE_CLONE_MODEL_MISMATCH");
    const sampleLimits = getLocalCloneSampleLimits(request.providerId, request.model);
    const sampleStorage = this._createSampleStorageDescriptor(owner, request.samples.length);
    if (!sampleStorage || !this._resolveUserDataPath())
      return failure("VOICE_CLONE_STORAGE_UNAVAILABLE");

    let adapterSamples;
    try {
      adapterSamples = this._buildAdapterCloneSamples(request.samples, sampleLimits);
    } catch (error) {
      return failure(error instanceof VoiceCloneError ? error.code : "VOICE_CLONE_SAMPLE_INVALID");
    }

    let adapterResult;
    try {
      adapterResult = await this._modelProviderManager.callAdapter(
        request.providerId,
        "cloneVoice",
        {
          name: request.name,
          samples: adapterSamples,
        },
      );
    } catch (error) {
      // 记录真实失败原因（ProviderError code / 消息），避免「服务不可用」吞掉可排查细节
      const detail = error && (error.message || error.code) ? (error.message || error.code) : String(error);
      this._log.warn("TtsVoiceClone", "cloneVoice adapter failed: " + detail);
      return failure("VOICE_CLONE_PROVIDER_UNAVAILABLE");
    }

    const adapterVoice =
      adapterResult && adapterResult.code === 0
        ? normalizeAdapterVoice(adapterResult.data, request.name)
        : null;
    if (!adapterVoice) return failure("VOICE_CLONE_PROVIDER_UNAVAILABLE");

    const registryResult = this._readRegistry(request, owner);
    if (registryResult.error) {
      return await this._withRemoteCloneCompensation(
        request.providerId,
        adapterVoice.id,
        registryResult.error,
      );
    }
    if (registryResult.registry.voices.some((voice) => voice.id === adapterVoice.id)) {
      return await this._withRemoteCloneCompensation(
        request.providerId,
        adapterVoice.id,
        failure("VOICE_CLONE_DUPLICATE_ID"),
      );
    }

    let persistedSampleStorage;
    try {
      persistedSampleStorage = await this._persistCloneSamples(
        owner,
        sampleStorage,
        request.samples,
        sampleLimits,
      );
    } catch (_) {
      return await this._withRemoteCloneCompensation(
        request.providerId,
        adapterVoice.id,
        failure("VOICE_CLONE_STORAGE_UNAVAILABLE"),
        () => this._cleanupCloneSampleStorage(owner, sampleStorage),
      );
    }

    const clone = {
      id: adapterVoice.id,
      name: adapterVoice.name,
      source: CAPABILITY_TYPES.USER_CLONE,
      createdAt: this._now(),
      deletionState: DELETE_STATES.ACTIVE,
      sampleStorage: persistedSampleStorage,
    };
    const nextRegistry = {
      ...registryResult.registry,
      voices: [...registryResult.registry.voices, clone],
    };
    if (!this._writeRegistry(registryResult.key, nextRegistry, owner.subject)) {
      return await this._withRemoteCloneCompensation(
        request.providerId,
        adapterVoice.id,
        failure("VOICE_CLONE_STORE_UNAVAILABLE"),
        () => this._cleanupCloneSampleStorage(owner, persistedSampleStorage),
      );
    }

    return success({
      providerId: request.providerId,
      model: request.model,
      selectedVoiceId: clone.id,
      voice: publicVoice(clone),
    });
  }
  async deleteClone(input) {
    const request = this._normalizeDeleteRequest(input);
    if (!request) return failure("VOICE_CLONE_INVALID_ARGUMENTS");
    const owner = this._captureOwner();
    if (!owner) return failure("VOICE_OWNER_UNAVAILABLE");
    return this._withRegistryLock(request, owner, () => this._deleteCloneLocked(request, owner));
  }

  async _deleteCloneLocked(request, owner) {
    const capability = this._getCloneCapability(request);
    if (!capability) return this._unsupportedResponse(request);
    if (!this._hasUserSettings()) return failure("VOICE_CLONE_STORE_UNAVAILABLE");
    if (!this._hasMatchingProvider(request.providerId, request.model))
      return failure("VOICE_CLONE_MODEL_MISMATCH");

    const registryResult = this._readRegistry(request, owner);
    if (registryResult.error) return registryResult.error;
    const clone = registryResult.registry.voices.find((voice) => voice.id === request.voiceId);
    if (!clone) return failure("VOICE_CLONE_NOT_FOUND");

    let workingClone = clone;
    let workingRegistry = registryResult.registry;
    const deletionState = clone.deletionState || DELETE_STATES.ACTIVE;
    // 远端删除仅在 adapter 支持 deleteVoice 时执行（如 ElevenLabs）；
    // 不支持（如 MiniMax 无删除 API）时删除为纯本地管理操作：移除本地记录/样本/偏好，
    // 不得因远端 API 缺失而把「删除」报成「音色克隆服务暂时不可用」。
    const remoteDeleteSupported = await this._supportsRemoteDelete(request);
    if (deletionState !== DELETE_STATES.REMOTE_DELETED && remoteDeleteSupported) {
      if (deletionState !== DELETE_STATES.PENDING) {
        workingClone = { ...clone, deletionState: DELETE_STATES.PENDING };
        workingRegistry = this._replaceClone(workingRegistry, workingClone);
        if (!this._writeRegistry(registryResult.key, workingRegistry, owner.subject))
          return failure("VOICE_CLONE_STORE_UNAVAILABLE");
      }
      let adapterResult;
      try {
        adapterResult = await this._modelProviderManager.callAdapter(
          request.providerId,
          "deleteVoice",
          workingClone.id,
        );
      } catch (_) {
        return failure("VOICE_CLONE_PROVIDER_UNAVAILABLE");
      }
      if (!this._isDeleteSuccess(adapterResult)) return failure("VOICE_CLONE_PROVIDER_UNAVAILABLE");
      workingClone = { ...workingClone, deletionState: DELETE_STATES.REMOTE_DELETED };
      workingRegistry = this._replaceClone(workingRegistry, workingClone);
      if (!this._writeRegistry(registryResult.key, workingRegistry, owner.subject))
        return failure("VOICE_CLONE_STORE_UNAVAILABLE");
    }

    if (!(await this._cleanupCloneSampleStorage(owner, workingClone.sampleStorage)))
      return failure("VOICE_CLONE_STORAGE_UNAVAILABLE");

    const nextRegistry = {
      ...workingRegistry,
      voices: workingRegistry.voices.filter((voice) => voice.id !== workingClone.id),
    };
    if (!this._writeRegistry(registryResult.key, nextRegistry, owner.subject))
      return failure("VOICE_CLONE_STORE_UNAVAILABLE");
    if (!(await this._clearDeletedClonePreference(request, workingClone, owner)))
      return failure("VOICE_CLONE_STORE_UNAVAILABLE");
    return success({ providerId: request.providerId, model: request.model, voiceId: clone.id });
  }

  /**
   * 重命名本地克隆音色（2026-08-12）。
   *
   * 仅更新当前 owner 的本地 registry 展示名（name），不触碰远端 voice_id 与样本：
   * - voice_id 由供应商在 cloneVoice 时生成并作为合成标识，改名不改变身份；
   * - 新名称走 safeDisplayName 同款校验（1..128、无控制字符）；
   * - 名称允许重复（供应商不要求唯一），前端以「音色XXX」自动命名避免默认冲突。
   */
    /**
   * 根据 voiceId 查找克隆音色的原始音频样本路径（用于跨账号重新克隆）。
   * 返回 { sampleStorage, name } 或 null。
   */
  async findCloneSamples(voiceId, providerId, model) {
    if (!this._store || !voiceId) return null
    const owner = this._captureOwner()
    if (!owner) return null
    // Try exact model key first, then fall back to known TTS models
    // (handles case where pipeline resumes without voiceModel or model changed).
    // MiniMax 克隆音色 registry 绑定在 speech-2.8-turbo 等模型下；
    // MiMo 克隆音色 registry 绑定在 mimo-v2.5-tts-voiceclone 下。
    const candidateModels = [
      model,
      'speech-2.8-turbo', 'speech-02-hd', 'speech-2.8-hd', 'speech-2.6-hd', 'speech-2.6-turbo',
      'mimo-v2.5-tts-voiceclone', 'mimo-v2.5-tts',
    ].filter(Boolean)
    const triedKeys = new Set()
    for (const m of candidateModels) {
      const key = cloneRegistrySettingKey(providerId, m)
      if (triedKeys.has(key)) continue
      triedKeys.add(key)
      let registry
      try {
        registry = this._store.getUserSetting(key, null, owner.subject)
      } catch (_) { continue }
      if (!registry || !Array.isArray(registry.voices)) continue
      const clone = registry.voices.find(v => v.id === voiceId && v.deletionState === DELETE_STATES.ACTIVE)
      if (clone && clone.sampleStorage) {
        return { sampleStorage: clone.sampleStorage, name: clone.name, model: m }
      }
    }
    return null
  }

  /**
   * Persist a provider-issued replacement id after a cloned voice is recreated.
   * The original samples remain attached to the replacement record so a later
   * run can recover directly instead of retrying the stale id first.
   */
  async replaceCloneVoiceId(input) {
    const request = this._normalizeVoiceIdReplacementRequest(input);
    if (!request) return failure("VOICE_CLONE_INVALID_ARGUMENTS");
    const owner = this._captureOwner();
    if (!owner) return failure("VOICE_OWNER_UNAVAILABLE");
    return this._withRegistryLock(request, owner, () =>
      this._replaceCloneVoiceIdLocked(request, owner),
    );
  }

  async _replaceCloneVoiceIdLocked(request, owner) {
    if (!this._hasUserSettings()) return failure("VOICE_CLONE_STORE_UNAVAILABLE");
    const registryResult = this._readRegistry(request, owner);
    if (registryResult.error) return registryResult.error;
    const clone = registryResult.registry.voices.find((voice) => voice.id === request.voiceId);
    if (!clone) return failure("VOICE_CLONE_NOT_FOUND");
    if (request.replacementVoiceId === clone.id) {
      return success({
        providerId: request.providerId,
        model: request.model,
        voice: publicVoice(clone),
        migrated: false,
      });
    }
    if (registryResult.registry.voices.some((voice) => voice.id === request.replacementVoiceId)) {
      return failure("VOICE_CLONE_DUPLICATE_ID");
    }
    if (!isProviderCloneVoiceIdValid(request.providerId, request.replacementVoiceId)) {
      return failure("VOICE_CLONE_INVALID_VOICE_ID");
    }

    const replacement = { ...clone, id: request.replacementVoiceId };
    const nextRegistry = this._replaceClone(registryResult.registry, replacement, clone.id);
    if (!this._writeRegistry(registryResult.key, nextRegistry, owner.subject)) {
      return failure("VOICE_CLONE_STORE_UNAVAILABLE");
    }

    const preferenceKey = clonePreferenceSettingKey(request.providerId, request.model);
    let preference;
    try {
      preference = this._store.getUserSetting(preferenceKey, null, owner.subject);
    } catch (_) {
      // The registry is already migrated; keep the successful TTS recovery and
      // let the next catalog load repair a preference store read failure.
      return success({
        providerId: request.providerId,
        model: request.model,
        voice: publicVoice(replacement),
        migrated: true,
        preferenceMigrated: false,
      });
    }
    if (preference && typeof preference === "object" && preference.voiceId === clone.id) {
      try {
        this._store.setUserSetting(preferenceKey, {
          ...preference,
          providerId: request.providerId,
          model: request.model,
          voiceId: replacement.id,
        }, owner.subject);
      } catch (_) {
        this._log.warn(
          "TtsVoiceClone",
          "replacement voice preference migration failed; registry replacement retained",
        );
        return success({
          providerId: request.providerId,
          model: request.model,
          voice: publicVoice(replacement),
          migrated: true,
          preferenceMigrated: false,
        });
      }
      return success({
        providerId: request.providerId,
        model: request.model,
        voice: publicVoice(replacement),
        migrated: true,
        preferenceMigrated: true,
      });
    }

    return success({
      providerId: request.providerId,
      model: request.model,
      voice: publicVoice(replacement),
      migrated: true,
      preferenceMigrated: false,
    });
  }

async renameClone(input) {
    const request = this._normalizeRenameRequest(input);
    if (!request) return failure("VOICE_CLONE_INVALID_ARGUMENTS");
    const owner = this._captureOwner();
    if (!owner) return failure("VOICE_OWNER_UNAVAILABLE");
    return this._withRegistryLock(request, owner, () =>
      this._renameCloneLocked(request, owner),
    );
  }

  async _renameCloneLocked(request, owner) {
    const capability = this._getCloneCapability(request);
    if (!capability) return this._unsupportedResponse(request);
    if (!this._hasUserSettings()) return failure("VOICE_CLONE_STORE_UNAVAILABLE");
    if (!this._hasMatchingProvider(request.providerId, request.model))
      return failure("VOICE_CLONE_MODEL_MISMATCH");

    const registryResult = this._readRegistry(request, owner);
    if (registryResult.error) return registryResult.error;
    const clone = registryResult.registry.voices.find((voice) => voice.id === request.voiceId);
    if (!clone) return failure("VOICE_CLONE_NOT_FOUND");

    const nextClone = { ...clone, name: request.name };
    const nextRegistry = this._replaceClone(registryResult.registry, nextClone);
    if (!this._writeRegistry(registryResult.key, nextRegistry, owner.subject))
      return failure("VOICE_CLONE_STORE_UNAVAILABLE");
    return success({
      providerId: request.providerId,
      model: request.model,
      voice: publicVoice(nextClone),
    });
  }

  /**
   * 判断当前 provider 的 adapter 是否支持远端删除克隆音色。
   * - 明确支持（如 ElevenLabs DELETE /v1/voices/{id}）→ 删除需先完成远端 deleteVoice；
   * - 明确不支持（如 MiniMax 官方 clone API 无删除端点）→ 删除为纯本地管理操作；
   * - 无法判定（探测异常 / 能力查询 API 缺失）→ 回退旧行为（尝试远端删除），
   *   避免把「探测失败」静默降级为纯本地删除而遗留远端音色。
   */
  async _supportsRemoteDelete(request) {
    if (!this._modelProviderManager || typeof this._modelProviderManager.callAdapter !== "function")
      return true;
    if (typeof this._modelProviderManager.supportsAdapterMethod !== "function") return true;
    let verdict;
    try {
      verdict = await this._modelProviderManager.supportsAdapterMethod(request.providerId, "deleteVoice");
    } catch (_) {
      return true;
    }
    return verdict === false ? false : true;
  }

  async _clearDeletedClonePreference(request, deletedClone, owner) {
    const key = clonePreferenceSettingKey(request.providerId, request.model);
    let preference;
    try {
      preference = this._store.getUserSetting(key, null, owner.subject);
    } catch (_) {
      return false;
    }
    if (!preference || typeof preference !== "object" || preference.voiceId !== deletedClone.id)
      return true;
    try {
      this._store.setUserSetting(key, null, owner.subject);
      return true;
    } catch (_) {
      return false;
    }
  }
  _normalizeRequest(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const providerId = safeIdentifier(input.providerId);
    const model = safeIdentifier(input.model);
    return providerId && model ? { providerId, model } : null;
  }

  _normalizeDeleteRequest(input) {
    const request = this._normalizeRequest(input);
    const voiceId = input && safeIdentifier(input.voiceId, MAX_VOICE_ID_LENGTH);
    return request && voiceId ? { ...request, voiceId } : null;
  }

  _normalizeVoiceIdReplacementRequest(input) {
    const request = this._normalizeRequest(input);
    const voiceId = input && safeIdentifier(input.voiceId, MAX_VOICE_ID_LENGTH);
    const replacementVoiceId = input && safeIdentifier(input.replacementVoiceId, MAX_VOICE_ID_LENGTH);
    return request && voiceId && replacementVoiceId
      ? { ...request, voiceId, replacementVoiceId }
      : null;
  }

  _normalizeRenameRequest(input) {
    const request = this._normalizeRequest(input);
    const voiceId = input && safeIdentifier(input.voiceId, MAX_VOICE_ID_LENGTH);
    const name = input && safeDisplayName(input.name);
    return request && voiceId && name ? { ...request, voiceId, name } : null;
  }

  _normalizeSelectionAddRequest(input) {
    const request = this._normalizeRequest(input);
    if (!request || !safeDisplayName(input.name) || input.consent !== true) return null;
    const selectionId = safeIdentifier(input.selectionId, 128);
    return selectionId ? { ...request, name: input.name.trim(), selectionId } : null;
  }

  _areSafeSelectionPaths(paths, maxSampleCount) {
    return (
      Array.isArray(paths) &&
      paths.length > 0 &&
      Number.isSafeInteger(maxSampleCount) &&
      maxSampleCount > 0 &&
      paths.length <= maxSampleCount &&
      paths.every(
        (value) =>
          typeof value === "string" &&
          value.length > 0 &&
          value.length <= 4096 &&
          path.isAbsolute(value),
      )
    );
  }

  _isSafeSenderKey(value) {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 512 &&
      !hasControlCharacter(value)
    );
  }

  _scheduleSelectionExpiry(selectionId, selection) {
    let timer;
    try {
      timer = this._setTimeout(() => {
        if (this._sampleSelections.get(selectionId) === selection)
          this._discardSelection(selectionId);
      }, this._selectionTtlMs);
    } catch (_) {
      return false;
    }
    if (timer && typeof timer.unref === "function") timer.unref();
    this._selectionExpiryTimers.set(selectionId, timer);
    return true;
  }

  _discardSelection(selectionId) {
    const timer = this._selectionExpiryTimers.get(selectionId);
    this._selectionExpiryTimers.delete(selectionId);
    if (timer !== undefined) {
      try {
        this._clearTimeout(timer);
      } catch (_) {
        void 0;
      }
    }
    this._sampleSelections.delete(selectionId);
  }

  _purgeExpiredSelections() {
    const now = this._now();
    for (const [selectionId, selection] of this._sampleSelections) {
      if (!selection || selection.expiresAt <= now) this._discardSelection(selectionId);
    }
  }

  _activeSelectionBytes() {
    let total = 0;
    for (const selection of this._sampleSelections.values()) {
      total += Number.isSafeInteger(selection && selection.bytes) ? selection.bytes : 0;
    }
    return total;
  }

  _selectedSampleSummary(sample, index) {
    return {
      name: sample.name || `sample-${String(index + 1).padStart(2, "0")}`,
      contentType: sample.contentType,
      durationSeconds: sample.durationSeconds,
    };
  }

  _captureOwner() {
    if (!this._store || typeof this._store.getOwnerSubject !== "function") return null;
    try {
      const subject = this._store.getOwnerSubject();
      if (typeof subject !== "string" || !subject) return null;
      return { subject, hash: hashOwnerSubject(subject) };
    } catch (_) {
      return null;
    }
  }

  _hasUserSettings() {
    return (
      Boolean(this._store) &&
      typeof this._store.getUserSetting === "function" &&
      typeof this._store.setUserSetting === "function"
    );
  }

  _hasMatchingProvider(providerId, model) {
    if (!this._modelProviderManager || typeof this._modelProviderManager.callAdapter !== "function")
      return false;
    if (typeof this._modelProviderManager.getProvider !== "function") return true;
    try {
      const provider = this._modelProviderManager.getProvider(providerId);
      if (!provider) return false;
      // 多模态模型（category=multimodal）在能力选择器中同样承担 TTS 角色（与 tts-voice-service 同合同）：
      // 必须声明支持 tts 能力才放行，避免把不含 TTS 能力的多模态模型用于克隆。
      if (provider.category === "multimodal") {
        const capabilities = Array.isArray(provider.capabilities) ? provider.capabilities : [];
        if (!capabilities.includes("tts")) return false;
      } else if (provider.category && provider.category !== "tts") {
        return false;
      }
      if (!Array.isArray(provider.models) || provider.models.length === 0) return true;
      if (provider.models.includes(model)) return true;
      // 多模态：capability_models.tts 也是合法 TTS 模型（避免只列 models 时漏判默认 TTS 模型）
      if (
        provider.capability_models &&
        typeof provider.capability_models === "object" &&
        typeof provider.capability_models.tts === "string"
      ) {
        return provider.capability_models.tts === model;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  _getCloneCapability(request) {
    const capability = this._getVoiceCapability(request.providerId, request.model);
    if (
      !capability ||
      capability.type !== CAPABILITY_TYPES.USER_CLONE ||
      !capability.clone ||
      capability.clone.enabled !== true
    )
      return null;
    return capability;
  }

  _unsupportedResponse(request) {
    let capability;
    try {
      capability = this._getVoiceCapability(request.providerId, request.model);
    } catch (_) {
      return failure("VOICE_CLONE_UNSUPPORTED");
    }
    return failure(
      "VOICE_CLONE_UNSUPPORTED",
      capability ? { capability: copyCapability(capability) } : undefined,
    );
  }

  _readRegistry(request, owner) {
    const key = cloneRegistrySettingKey(request.providerId, request.model);
    let value;
    try {
      value = this._store.getUserSetting(key, null, owner.subject);
    } catch (_) {
      return { error: failure("VOICE_CLONE_STORE_UNAVAILABLE") };
    }
    if (value === null || value === undefined) {
      return {
        key,
        registry: {
          version: CLONE_REGISTRY_VERSION,
          providerId: request.providerId,
          model: request.model,
          voices: [],
        },
      };
    }
    if (!isSafeCloneRegistry(value, request.providerId, request.model, owner)) {
      return { error: failure("VOICE_CLONE_REGISTRY_INVALID") };
    }
    return { key, registry: value };
  }

  _replaceClone(registry, replacement, previousId = replacement.id) {
    return {
      ...registry,
      voices: registry.voices.map((voice) => (voice.id === previousId ? replacement : voice)),
    };
  }

  _writeRegistry(key, registry, ownerSubject) {
    try {
      this._store.setUserSetting(key, registry, ownerSubject);
      return true;
    } catch (_) {
      return false;
    }
  }

  _resolveUserDataPath() {
    let userDataPath = this._userDataPath;
    if (userDataPath === null && this._getUserDataPath) {
      try {
        userDataPath = this._getUserDataPath();
      } catch (_) {
        return null;
      }
    }
    if (userDataPath === null && this._app && typeof this._app.getPath === "function") {
      try {
        userDataPath = this._app.getPath("userData");
      } catch (_) {
        return null;
      }
    }
    if (userDataPath === null) {
      try {
        const { app } = require("electron");
        userDataPath = app && typeof app.getPath === "function" ? app.getPath("userData") : null;
      } catch (_) {
        return null;
      }
    }
    if (
      typeof userDataPath !== "string" ||
      !userDataPath ||
      userDataPath.length > 4096 ||
      hasControlCharacter(userDataPath) ||
      !path.isAbsolute(userDataPath)
    ) {
      return null;
    }
    try {
      const resolvedUserDataPath = path.resolve(userDataPath);
      return resolvedUserDataPath === path.parse(resolvedUserDataPath).root
        ? null
        : resolvedUserDataPath;
    } catch (_) {
      return null;
    }
  }

  _createSampleStorageDescriptor(owner, sampleCount) {
    let storageId;
    try {
      storageId = safeIdentifier(this._createSampleStorageId(), 128);
    } catch (_) {
      return null;
    }
    if (!storageId) return null;
    const sampleStorage = {
      relativeDir: cloneSampleStorageRelativeDir(owner, storageId),
      sampleCount,
    };
    return isSafeCloneSampleStorage(sampleStorage, owner) ? sampleStorage : null;
  }

  async _readSafeDirectory(directoryPath, parentDirectory) {
    let directoryStat;
    try {
      directoryStat = await this._fs.promises.lstat(directoryPath);
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
      throw new VoiceCloneError("VOICE_CLONE_STORAGE_UNAVAILABLE");

    const canonicalDirectory = await this._fs.promises.realpath(directoryPath);
    if (
      !path.isAbsolute(canonicalDirectory) ||
      (parentDirectory && !isPathWithin(parentDirectory, canonicalDirectory))
    ) {
      throw new VoiceCloneError("VOICE_CLONE_STORAGE_UNAVAILABLE");
    }

    const canonicalStat = await this._fs.promises.lstat(canonicalDirectory);
    if (canonicalStat.isSymbolicLink() || !canonicalStat.isDirectory())
      throw new VoiceCloneError("VOICE_CLONE_STORAGE_UNAVAILABLE");
    return canonicalDirectory;
  }

  async _getOrCreateUserDataDirectory() {
    const userDataPath = this._resolveUserDataPath();
    if (!userDataPath) return null;
    try {
      await this._fs.promises.mkdir(userDataPath, { recursive: true, mode: 0o700 });
      return await this._readSafeDirectory(userDataPath);
    } catch (_) {
      return null;
    }
  }

  async _createSafeChildDirectory(parentDirectory, childName, allowExisting) {
    if (!safeIdentifier(childName, 128)) return null;
    const childPath = path.resolve(parentDirectory, childName);
    if (!isPathWithin(parentDirectory, childPath)) return null;
    try {
      await this._fs.promises.mkdir(childPath, { mode: 0o700 });
    } catch (error) {
      if (!allowExisting || !error || error.code !== "EEXIST") return null;
    }
    try {
      return await this._readSafeDirectory(childPath, parentDirectory);
    } catch (_) {
      return null;
    }
  }

  async _getOrCreateSampleOwnerDirectory(owner) {
    const userDataDirectory = await this._getOrCreateUserDataDirectory();
    if (!userDataDirectory) return null;
    const sampleRootDirectory = await this._createSafeChildDirectory(
      userDataDirectory,
      CLONE_SAMPLE_STORAGE_DIRECTORY,
      true,
    );
    if (!sampleRootDirectory) return null;
    return this._createSafeChildDirectory(sampleRootDirectory, owner.hash, true);
  }

  async _persistCloneSamples(owner, sampleStorage, samples, sampleLimits) {
    if (
      !isSafeCloneSampleStorage(sampleStorage, owner) ||
      !Array.isArray(samples) ||
      samples.length !== sampleStorage.sampleCount
    ) {
      throw new VoiceCloneError("VOICE_CLONE_STORAGE_UNAVAILABLE");
    }
    const storageId = sampleStorage.relativeDir.split("/")[2];
    const ownerDirectory = await this._getOrCreateSampleOwnerDirectory(owner);
    if (!ownerDirectory) throw new VoiceCloneError("VOICE_CLONE_STORAGE_UNAVAILABLE");
    const sampleDirectory = await this._createSafeChildDirectory(ownerDirectory, storageId, false);
    if (!sampleDirectory) throw new VoiceCloneError("VOICE_CLONE_STORAGE_UNAVAILABLE");

    for (const sample of samples) {
      this._assertPreparedSample(sample, sampleLimits);
      const samplePath = path.resolve(sampleDirectory, sample.name);
      if (!isPathWithin(sampleDirectory, samplePath))
        throw new VoiceCloneError("VOICE_CLONE_STORAGE_UNAVAILABLE");
      await this._fs.promises.writeFile(samplePath, sample.buffer, {
        flag: "wx",
        mode: 0o600,
      });
      const persistedStat = await this._fs.promises.lstat(samplePath);
      if (
        persistedStat.isSymbolicLink() ||
        !persistedStat.isFile() ||
        persistedStat.size !== sample.bytes
      ) {
        throw new VoiceCloneError("VOICE_CLONE_STORAGE_UNAVAILABLE");
      }
      const canonicalSamplePath = await this._fs.promises.realpath(samplePath);
      if (!isPathWithin(sampleDirectory, canonicalSamplePath))
        throw new VoiceCloneError("VOICE_CLONE_STORAGE_UNAVAILABLE");
    }
    return sampleStorage;
  }

  async _cleanupCloneSampleStorage(owner, sampleStorage) {
    if (sampleStorage === undefined) return true;
    if (!isSafeCloneSampleStorage(sampleStorage, owner)) return false;

    const userDataPath = this._resolveUserDataPath();
    if (!userDataPath) return false;
    try {
      const userDataDirectory = await this._readSafeDirectory(userDataPath);
      if (!userDataDirectory) return true;
      const sampleRootPath = path.resolve(userDataDirectory, CLONE_SAMPLE_STORAGE_DIRECTORY);
      if (!isPathWithin(userDataDirectory, sampleRootPath)) return false;
      const sampleRootDirectory = await this._readSafeDirectory(sampleRootPath, userDataDirectory);
      if (!sampleRootDirectory) return true;
      const ownerDirectoryPath = path.resolve(sampleRootDirectory, owner.hash);
      if (!isPathWithin(sampleRootDirectory, ownerDirectoryPath)) return false;
      const ownerDirectory = await this._readSafeDirectory(ownerDirectoryPath, sampleRootDirectory);
      if (!ownerDirectory) return true;
      const storageId = sampleStorage.relativeDir.split("/")[2];
      const sampleDirectoryPath = path.resolve(ownerDirectory, storageId);
      if (!isPathWithin(ownerDirectory, sampleDirectoryPath)) return false;
      const sampleDirectory = await this._readSafeDirectory(sampleDirectoryPath, ownerDirectory);
      if (!sampleDirectory) return true;
      await this._fs.promises.rm(sampleDirectory, { recursive: true, force: false });
      return true;
    } catch (_) {
      return false;
    }
  }

  async _withRegistryLock(request, owner, work) {
    const lockKey = `${owner.subject}\u0000${request.providerId}\u0000${request.model}`;
    const previous = cloneRegistryLocks.get(lockKey) || Promise.resolve();
    /** @type {() => void} */
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = () => resolve();
    });
    const tail = previous.then(() => gate);
    cloneRegistryLocks.set(lockKey, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (cloneRegistryLocks.get(lockKey) === tail) cloneRegistryLocks.delete(lockKey);
    }
  }
  _isDeleteSuccess(result) {
    return (
      Boolean(result && result.code === 0) ||
      Boolean(result && result.data && result.data.notFound === true) ||
      Boolean(
        result &&
        (result.message === "VOICE_NOT_FOUND" || result.message === "VOICE_CLONE_NOT_FOUND"),
      )
    );
  }

  async _withRemoteCloneCompensation(providerId, voiceId, result, cleanup) {
    /** @type {boolean} */
    let remoteDeleted = true;
    // MiMo 等纯本地克隆 provider 无远端 deleteVoice：跳过远端补偿，只做本地样本清理
    // （远端无残留，补偿语义退化为「本地清理成功即视为补偿完成」）。
    const isLocalOnlyCloneProvider = providerId === "mimo-tts";
    if (!isLocalOnlyCloneProvider) {
      try {
        const compensation = await this._modelProviderManager.callAdapter(
          providerId,
          "deleteVoice",
          voiceId,
        );
        remoteDeleted = this._isDeleteSuccess(compensation);
      } catch (_) {
        remoteDeleted = false;
      }
    }
    let samplesCleaned = true;
    if (typeof cleanup === "function") {
      try {
        samplesCleaned = (await cleanup()) === true;
      } catch (_) {
        samplesCleaned = false;
      }
    }
    return remoteDeleted && samplesCleaned ? result : failure("VOICE_CLONE_ROLLBACK_REQUIRED");
  }

  async _prepareSamples(paths, sampleLimits) {
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > sampleLimits.maxSampleCount)
      throw new VoiceCloneError("VOICE_CLONE_SAMPLE_INVALID");
    const samples = [];
    const seenPaths = new Set();
    let totalBytes = 0;
    let totalDurationSeconds = 0;
    for (const [index, sourcePath] of paths.entries()) {
      const sample = await this._prepareOneSample(sourcePath, index, seenPaths, sampleLimits);
      totalBytes += sample.bytes;
      totalDurationSeconds += sample.durationSeconds;
      if (totalBytes > sampleLimits.maxTotalBytes)
        throw new VoiceCloneError("VOICE_CLONE_TOTAL_SIZE_EXCEEDED");
      if (totalDurationSeconds > sampleLimits.maxTotalDurationSeconds)
        throw new VoiceCloneError("VOICE_CLONE_TOTAL_DURATION_EXCEEDED");
      samples.push(sample);
    }
    return samples;
  }

  _buildAdapterCloneSamples(samples, sampleLimits) {
    if (
      !Array.isArray(samples) ||
      samples.length === 0 ||
      samples.length > sampleLimits.maxSampleCount
    )
      throw new VoiceCloneError("VOICE_CLONE_SAMPLE_INVALID");

    let totalBytes = 0;
    let totalDurationSeconds = 0;
    return samples.map((sample) => {
      this._assertPreparedSample(sample, sampleLimits);
      totalBytes += sample.bytes;
      totalDurationSeconds += sample.durationSeconds;
      if (totalBytes > sampleLimits.maxTotalBytes)
        throw new VoiceCloneError("VOICE_CLONE_TOTAL_SIZE_EXCEEDED");
      if (totalDurationSeconds > sampleLimits.maxTotalDurationSeconds)
        throw new VoiceCloneError("VOICE_CLONE_TOTAL_DURATION_EXCEEDED");
      return {
        blob: new Blob([sample.buffer], { type: sample.contentType }),
        fileName: sample.name,
        contentType: sample.contentType,
      };
    });
  }

  _assertPreparedSample(sample, sampleLimits) {
    const allowedExtensions = Array.isArray(sampleLimits.allowedExtensions)
      ? sampleLimits.allowedExtensions
      : Object.keys(ALLOWED_AUDIO_EXTENSIONS);
    const minDuration = Number.isFinite(sampleLimits.minSampleDurationSeconds)
      ? sampleLimits.minSampleDurationSeconds
      : 0;
    if (
      !sample ||
      !Buffer.isBuffer(sample.buffer) ||
      !safeIdentifier(sample.name, 128) ||
      !Object.values(ALLOWED_AUDIO_EXTENSIONS).includes(sample.contentType) ||
      !Number.isSafeInteger(sample.bytes) ||
      sample.bytes !== sample.buffer.length ||
      sample.bytes <= 0 ||
      sample.bytes > sampleLimits.maxSampleBytes ||
      typeof sample.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(sample.sha256) ||
      !Number.isFinite(sample.durationSeconds) ||
      sample.durationSeconds < minDuration ||
      sample.durationSeconds > sampleLimits.maxSampleDurationSeconds
    ) {
      throw new VoiceCloneError("VOICE_CLONE_SAMPLE_INVALID");
    }
    const calculatedHash = crypto.createHash("sha256").update(sample.buffer).digest("hex");
    if (calculatedHash !== sample.sha256) throw new VoiceCloneError("VOICE_CLONE_SAMPLE_INVALID");
    const extension = path.extname(sample.name).toLowerCase();
    if (
      !ALLOWED_AUDIO_EXTENSIONS[extension] ||
      ALLOWED_AUDIO_EXTENSIONS[extension] !== sample.contentType ||
      !allowedExtensions.includes(extension)
    ) {
      throw new VoiceCloneError("VOICE_CLONE_SAMPLE_INVALID");
    }
  }
  async _prepareOneSample(sourcePath, index, seenPaths, sampleLimits) {
    const sourceStat = await this._fs.promises.lstat(sourcePath).catch(() => null);
    if (!sourceStat || sourceStat.isSymbolicLink() || !sourceStat.isFile())
      throw new VoiceCloneError("VOICE_CLONE_SAMPLE_INVALID");
    const canonicalSourcePath = await this._fs.promises.realpath(sourcePath).catch(() => null);
    if (
      !canonicalSourcePath ||
      !path.isAbsolute(canonicalSourcePath) ||
      seenPaths.has(canonicalSourcePath)
    ) {
      throw new VoiceCloneError("VOICE_CLONE_SAMPLE_INVALID");
    }
    seenPaths.add(canonicalSourcePath);
    const extension = path.extname(canonicalSourcePath).toLowerCase();
    const contentType = ALLOWED_AUDIO_EXTENSIONS[extension];
    if (!contentType) throw new VoiceCloneError("VOICE_CLONE_SAMPLE_EXTENSION_UNSUPPORTED");
    const canonicalStat = await this._fs.promises.lstat(canonicalSourcePath).catch(() => null);
    if (
      !canonicalStat ||
      canonicalStat.isSymbolicLink() ||
      !canonicalStat.isFile() ||
      canonicalStat.size <= 0
    ) {
      throw new VoiceCloneError("VOICE_CLONE_SAMPLE_INVALID");
    }
    if (canonicalStat.size > sampleLimits.maxSampleBytes)
      throw new VoiceCloneError("VOICE_CLONE_SAMPLE_TOO_LARGE");

    let buffer;
    try {
      buffer = await this._fs.promises.readFile(canonicalSourcePath);
    } catch (_) {
      throw new VoiceCloneError("VOICE_CLONE_SAMPLE_INVALID");
    }
    if (
      !Buffer.isBuffer(buffer) ||
      buffer.length === 0 ||
      buffer.length > sampleLimits.maxSampleBytes ||
      buffer.length !== canonicalStat.size
    ) {
      throw new VoiceCloneError("VOICE_CLONE_SAMPLE_INVALID");
    }
    let durationSeconds;
    try {
      durationSeconds = Number(await this._probeDuration(buffer));
    } catch (_) {
      throw new VoiceCloneError("VOICE_CLONE_SAMPLE_DURATION_INVALID");
    }
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      durationSeconds > sampleLimits.maxSampleDurationSeconds
    ) {
      throw new VoiceCloneError("VOICE_CLONE_SAMPLE_DURATION_INVALID");
    }
    return {
      buffer,
      name: "sample-" + String(index + 1).padStart(2, "0") + extension,
      contentType,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      bytes: buffer.length,
      durationSeconds,
    };
  }

  async _probeMediaDuration(buffer) {
    if (
      !this._ffprobePath ||
      !Buffer.isBuffer(buffer) ||
      buffer.length === 0 ||
      buffer.length > MAX_SAMPLE_BYTES
    ) {
      return null;
    }
    let parsed = null;
    try {
      parsed = this._parseProbe(await this._runFfprobe(buffer));
    } catch (_) {
      // pipe 失败 → 落入临时文件回退
    }
    // 明确无音频流 → fail closed，不回退（避免把非音频当样本）
    if (parsed && parsed.hasAudioStream === false) return null;
    if (parsed && parsed.duration !== null) return parsed.duration;
    // 有音频流但 ffprobe 从 pipe:0 拿不到 duration（部分 wav，如带 LIST chunk 的
    // RIFF）→ 写临时文件用文件模式探测，文件模式可完整解析 duration。
    return this._probeMediaDurationViaTempFile(buffer);
  }

  /** 解析 ffprobe JSON，返回 { duration, hasAudioStream, formatName }。 */
  _parseProbe(stdout) {
    try {
      const probe = JSON.parse(stdout);
      const format = probe && probe.format;
      const durationSeconds = format ? Number.parseFloat(format.duration) : Number.NaN;
      const hasAudioStream =
        Array.isArray(probe && probe.streams) &&
        probe.streams.some((stream) => stream && stream.codec_type === "audio");
      const formatName =
        format && typeof format.format_name === "string" && format.format_name.trim()
          ? format.format_name
          : "";
      const duration =
        formatName && hasAudioStream && Number.isFinite(durationSeconds) && durationSeconds > 0
          ? durationSeconds
          : null;
      return { duration, hasAudioStream, formatName };
    } catch (_) {
      return null;
    }
  }

  /** 临时文件回退探测：避免 ffprobe 流式（pipe）对部分 wav 无法解析 duration。 */
  async _probeMediaDurationViaTempFile(buffer) {
    const tempPath = path.join(
      os.tmpdir(),
      "voice-clone-probe-" + crypto.randomBytes(6).toString("hex") + ".wav"
    );
    try {
      await this._fs.promises.writeFile(tempPath, buffer, { mode: 0o600 });
    } catch (_) {
      return null;
    }
    try {
      const stdout = await this._runFfprobeFile(tempPath);
      const parsed = this._parseProbe(stdout);
      return parsed ? parsed.duration : null;
    } catch (_) {
      return null;
    } finally {
      try {
        await this._fs.promises.unlink(tempPath);
      } catch (_) {
        void 0;
      }
    }
  }

  /** 文件路径版 ffprobe（安全骨架与 _runFfprobe 一致：超时/输出上限/进程清理）。 */
  _runFfprobeFile(filePath) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this._spawn(
          this._ffprobePath,
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration,format_name:stream=codec_type",
            "-of",
            "json",
            filePath,
          ],
          { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
        );
      } catch (error) {
        reject(error);
        return;
      }
      if (
        !child ||
        !child.stdout ||
        typeof child.stdout.on !== "function" ||
        !child.stderr ||
        typeof child.stderr.on !== "function" ||
        typeof child.once !== "function"
      ) {
        try {
          if (child && typeof child.kill === "function") child.kill();
        } catch (_) {
          void 0;
        }
        reject(new Error("ffprobe process is unavailable"));
        return;
      }

      let completed = false;
      let timeout;
      let outputBytes = 0;
      const stdoutChunks = [];
      const terminate = () => {
        try {
          if (typeof child.kill === "function") child.kill();
        } catch (_) {
          void 0;
        }
      };
      const settle = (handler, value) => {
        if (completed) return;
        completed = true;
        try {
          this._clearTimeout(timeout);
        } catch (_) {
          void 0;
        }
        handler(value);
      };
      const fail = (error) => {
        terminate();
        settle(reject, error);
      };
      const consumeOutput = (chunk, keep) => {
        const output = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
        outputBytes += output.length;
        if (outputBytes > MAX_FFPROBE_OUTPUT_BYTES) {
          fail(new Error("ffprobe output exceeded limit"));
          return;
        }
        if (keep) stdoutChunks.push(output);
      };

      try {
        timeout = this._setTimeout(() => fail(new Error("ffprobe timed out")), FFPROBE_TIMEOUT_MS);
      } catch (error) {
        terminate();
        reject(error);
        return;
      }
      if (timeout && typeof timeout.unref === "function") timeout.unref();

      child.stdout.on("data", (chunk) => consumeOutput(chunk, true));
      child.stderr.on("data", (chunk) => consumeOutput(chunk, false));
      child.once("error", fail);
      child.once("close", (code, signal) => {
        if (code !== 0 || signal) {
          settle(reject, new Error("ffprobe failed"));
          return;
        }
        settle(resolve, Buffer.concat(stdoutChunks).toString("utf8"));
      });
    });
  }

  _runFfprobe(buffer) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this._spawn(
          this._ffprobePath,
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "pipe",
            "-show_entries",
            "format=duration,format_name:stream=codec_type",
            "-of",
            "json",
            "pipe:0",
          ],
          { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
        );
      } catch (error) {
        reject(error);
        return;
      }
      if (
        !child ||
        !child.stdin ||
        typeof child.stdin.end !== "function" ||
        !child.stdout ||
        typeof child.stdout.on !== "function" ||
        !child.stderr ||
        typeof child.stderr.on !== "function" ||
        typeof child.once !== "function"
      ) {
        try {
          if (child && typeof child.kill === "function") child.kill();
        } catch (_) {
          void 0;
        }
        reject(new Error("ffprobe process is unavailable"));
        return;
      }

      let completed = false;
      let timeout;
      let outputBytes = 0;
      const stdoutChunks = [];
      const terminate = () => {
        try {
          if (typeof child.kill === "function") child.kill();
        } catch (_) {
          void 0;
        }
      };
      const settle = (handler, value) => {
        if (completed) return;
        completed = true;
        try {
          this._clearTimeout(timeout);
        } catch (_) {
          void 0;
        }
        handler(value);
      };
      const fail = (error) => {
        terminate();
        settle(reject, error);
      };
      const consumeOutput = (chunk, keep) => {
        const output = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
        outputBytes += output.length;
        if (outputBytes > MAX_FFPROBE_OUTPUT_BYTES) {
          fail(new Error("ffprobe output exceeded limit"));
          return;
        }
        if (keep) stdoutChunks.push(output);
      };

      try {
        timeout = this._setTimeout(() => fail(new Error("ffprobe timed out")), FFPROBE_TIMEOUT_MS);
      } catch (error) {
        terminate();
        reject(error);
        return;
      }
      if (timeout && typeof timeout.unref === "function") timeout.unref();

      child.stdout.on("data", (chunk) => consumeOutput(chunk, true));
      child.stderr.on("data", (chunk) => consumeOutput(chunk, false));
      child.once("error", fail);
      child.stdin.once("error", fail);
      child.once("close", (code, signal) => {
        if (code !== 0 || signal) {
          settle(reject, new Error("ffprobe failed"));
          return;
        }
        settle(resolve, Buffer.concat(stdoutChunks).toString("utf8"));
      });
      try {
        child.stdin.end(buffer);
      } catch (error) {
        fail(error);
      }
    });
  }
}

module.exports = {
  ALLOWED_AUDIO_EXTENSIONS,
  CLONE_REGISTRY_VERSION,
  MAX_SAMPLE_BYTES,
  MAX_SAMPLE_COUNT,
  MAX_TOTAL_SAMPLE_BYTES,
  TtsVoiceCloneService,
  cloneRegistrySettingKey,
  hashOwnerSubject,
};
