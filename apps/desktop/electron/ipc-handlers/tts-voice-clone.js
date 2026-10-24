// @ts-check
"use strict";

const path = require("node:path");

const { TtsVoiceCloneService } = require("../services/tts-voice-clone-service");
const { withSenderCheck, EC } = require("./helpers");

function isSafeIdentifier(value, maxLength = 256) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    /^[a-zA-Z0-9._-]+$/.test(value)
  );
}

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function isSafeName(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 128 &&
    !hasControlCharacter(value)
  );
}

function hasOnlyAllowedKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function normalizeBaseValues(args) {
  if (!isSafeIdentifier(args.providerId, 128) || !isSafeIdentifier(args.model, 128)) return null;
  return { providerId: args.providerId, model: args.model };
}

function normalizeBaseArgs(args) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    !hasOnlyAllowedKeys(args, ["providerId", "model"])
  )
    return null;
  return normalizeBaseValues(args);
}

function normalizeAddArgs(args) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    !hasOnlyAllowedKeys(args, ["providerId", "model", "name", "selectionId", "consent"])
  )
    return null;
  const base = normalizeBaseValues(args);
  if (
    !base ||
    !isSafeName(args.name) ||
    !isSafeIdentifier(args.selectionId, 128) ||
    args.consent !== true
  )
    return null;
  return { ...base, name: args.name.trim(), selectionId: args.selectionId, consent: true };
}

function normalizeDeleteArgs(args) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    !hasOnlyAllowedKeys(args, ["providerId", "model", "voiceId"])
  )
    return null;
  const base = normalizeBaseValues(args);
  if (!base || !isSafeIdentifier(args.voiceId)) return null;
  return { ...base, voiceId: args.voiceId };
}

function normalizeRenameArgs(args) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    !hasOnlyAllowedKeys(args, ["providerId", "model", "voiceId", "name"])
  )
    return null;
  const base = normalizeBaseValues(args);
  if (!base || !isSafeIdentifier(args.voiceId) || !isSafeName(args.name)) return null;
  return { ...base, voiceId: args.voiceId, name: args.name.trim() };
}

/**
 * 克隆音色可调参数范围（change: hifly-voice-edit-ui）。
 * 与 service / adapter 同源同界，是 renderer 前的**第一道闸**。
 * 官方飞影 POST /voice/edit：三字段都必填、都是**字符串**，
 * rate 0.5~2.0 / volume 0.1~2.0 / pitch 0.1~2.0。
 * 「字符串」是服务端硬约束（真实 Token 侧证：传数字被「参数格式不正确」拒绝）。
 */
const CLONE_VOICE_PARAM_RANGES = Object.freeze({
  rate: Object.freeze({ min: 0.5, max: 2.0 }),
  volume: Object.freeze({ min: 0.1, max: 2.0 }),
  pitch: Object.freeze({ min: 0.1, max: 2.0 }),
});

/**
 * 归一「修改克隆音色参数」入参。
 * 与 normalizeRenameArgs 同型，差异只在三个参数：都选填、都必须是字符串且在界内、
 * 且**至少要给一项**（一项都不给等于空操作，视为非法）。
 */
function normalizeEditParamsArgs(args) {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    !hasOnlyAllowedKeys(args, ["providerId", "model", "voiceId", "rate", "volume", "pitch"])
  )
    return null;
  const base = normalizeBaseValues(args);
  if (!base || !isSafeIdentifier(args.voiceId)) return null;

  const params = {};
  let hasAny = false;
  for (const [key, range] of Object.entries(CLONE_VOICE_PARAM_RANGES)) {
    const raw = args[key];
    if (raw === undefined) continue;
    // 官方要字符串形态（数字会被服务端拒）
    if (typeof raw !== "string" || !raw.trim()) return null;
    const trimmed = raw.trim();
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num < range.min || num > range.max) return null;
    params[key] = trimmed;
    hasAny = true;
  }
  if (!hasAny) return null;
  return { ...base, voiceId: args.voiceId, ...params };
}

function invalidArguments() {
  return { code: EC.VALIDATION_ERROR, message: "VOICE_CLONE_INVALID_ARGUMENTS" };
}

function getDialog(deps) {
  if (deps.dialog && typeof deps.dialog.showOpenDialog === "function") return deps.dialog;
  try {
    return require("electron").dialog;
  } catch (_) {
    return null;
  }
}

function sampleDialogOptions(requirements) {
  const extensions = Array.isArray(requirements && requirements.allowedExtensions)
    ? requirements.allowedExtensions
        .filter((value) => typeof value === "string" && /^\.[a-z0-9]+$/i.test(value))
        .map((value) => value.slice(1))
    : [];
  return {
    title: "Choose voice samples",
    properties: ["openFile", "multiSelections"],
    filters: extensions.length > 0 ? [{ name: "Audio samples", extensions }] : [],
  };
}

function senderKey(event) {
  if (!event || !event.sender || !Number.isInteger(event.sender.id) || event.sender.id < 0)
    return null;
  return `webcontents:${event.sender.id}`;
}

function registerTtsVoiceCloneHandlers(ipcMain, deps = {}) {
  const service =
    deps.ttsVoiceCloneService ||
    new TtsVoiceCloneService({
      store: deps.store,
      modelProviderManager: deps.modelProviderManager,
      app: deps.app,
    });
  const dialog = getDialog(deps);

  ipcMain.handle(
    "tts-voice-clone:requirements",
    withSenderCheck((_event, args) => {
      const input = normalizeBaseArgs(args);
      if (!input) return invalidArguments();
      try {
        return service.getRequirements(input);
      } catch (_) {
        return { code: EC.REQUEST_ERROR, message: "VOICE_CLONE_UNAVAILABLE" };
      }
    }),
  );

  ipcMain.handle(
    "tts-voice-clone:choose-samples",
    withSenderCheck(async (event, args) => {
      const input = normalizeBaseArgs(args);
      if (!input) return invalidArguments();
      let requirements;
      try {
        requirements = service.getRequirements(input);
      } catch (_) {
        return { code: EC.REQUEST_ERROR, message: "VOICE_CLONE_UNAVAILABLE" };
      }
      if (!requirements || requirements.code !== 0)
        return requirements || { code: EC.REQUEST_ERROR, message: "VOICE_CLONE_UNAVAILABLE" };
      if (!dialog) return { code: EC.REQUEST_ERROR, message: "VOICE_CLONE_DIALOG_UNAVAILABLE" };
      try {
        const result = await dialog.showOpenDialog(sampleDialogOptions(requirements.data));
        if (!result || result.canceled === true) return { code: 0, data: { paths: [] } };
        const paths =
          Array.isArray(result.filePaths) &&
          result.filePaths.every((value) => typeof value === "string" && path.isAbsolute(value))
            ? [...result.filePaths]
            : null;
        const key = senderKey(event);
        return paths && key
          ? service.createSampleSelection(input, paths, key)
          : { code: EC.REQUEST_ERROR, message: "VOICE_CLONE_DIALOG_UNAVAILABLE" };
      } catch (_) {
        return { code: EC.REQUEST_ERROR, message: "VOICE_CLONE_DIALOG_UNAVAILABLE" };
      }
    }),
  );

  ipcMain.handle(
    "tts-voice-clone:list",
    withSenderCheck(async (_event, args) => {
      const input = normalizeBaseArgs(args);
      if (!input) return invalidArguments();
      try {
        return await service.listClones(input);
      } catch (_) {
        return { code: EC.REQUEST_ERROR, message: "VOICE_CLONE_UNAVAILABLE" };
      }
    }),
  );

  ipcMain.handle(
    "tts-voice-clone:add",
    withSenderCheck(async (event, args) => {
      const input = normalizeAddArgs(args);
      const key = senderKey(event);
      if (!input || !key) return invalidArguments();
      try {
        return await service.addCloneFromSelection(input, key);
      } catch (_) {
        return { code: EC.REQUEST_ERROR, message: "VOICE_CLONE_UNAVAILABLE" };
      }
    }),
  );

  ipcMain.handle(
    "tts-voice-clone:delete",
    withSenderCheck(async (_event, args) => {
      const input = normalizeDeleteArgs(args);
      if (!input) return invalidArguments();
      try {
        return await service.deleteClone(input);
      } catch (_) {
        return { code: EC.REQUEST_ERROR, message: "VOICE_CLONE_UNAVAILABLE" };
      }
    }),
  );

  ipcMain.handle(
    "tts-voice-clone:rename",
    withSenderCheck(async (_event, args) => {
      const input = normalizeRenameArgs(args);
      if (!input) return invalidArguments();
      try {
        return await service.renameClone(input);
      } catch (_) {
        return { code: EC.REQUEST_ERROR, message: "VOICE_CLONE_UNAVAILABLE" };
      }
    }),
  );

  // change: hifly-voice-edit-ui —— 修改克隆音色的语速/音量/语调。
  // 只对**自己克隆的**音色可用：服务端对公共音色返回通用失败、无法区分，
  // 所以「是不是我的」这层判断在主进程 service 里靠本地 registry 做。
  ipcMain.handle(
    "tts-voice-clone:editParams",
    withSenderCheck(async (_event, args) => {
      const input = normalizeEditParamsArgs(args);
      if (!input) return invalidArguments();
      try {
        return await service.editCloneParams(input);
      } catch (_) {
        return { code: EC.REQUEST_ERROR, message: "VOICE_CLONE_UNAVAILABLE" };
      }
    }),
  );
}

module.exports = registerTtsVoiceCloneHandlers;
module.exports.normalizeAddArgs = normalizeAddArgs;
module.exports.normalizeBaseArgs = normalizeBaseArgs;
module.exports.normalizeDeleteArgs = normalizeDeleteArgs;
module.exports.normalizeRenameArgs = normalizeRenameArgs;
module.exports.normalizeEditParamsArgs = normalizeEditParamsArgs;
module.exports.senderKey = senderKey;
