/**
 * tts-voice-clone-params.js — 克隆音色参数编辑（prototype mixin）
 *
 * change: hifly-voice-edit-ui。从 tts-voice-clone-service.js 拆出：
 * 该文件已被 check-debt-budget 的点名还账清单盯上（target 1783 行、零增长容差），
 * 直接堆进去会报 TARGET_GREW。与 avatar-clone 的拆分方式同型：
 *   Object.assign(TtsVoiceCloneService.prototype, require('./tts-voice-clone-params').editParamsMethods)
 *
 * 能力来源：飞影官方 POST /voice/edit（修改已克隆声音的语速/音量/语调）。
 * 此前只实现了克隆的增/查/删/改名，克隆完的声音无法调参数，
 * 而要调只能删了重建（浪费配额、丢审计链）。
 *
 * 契约要点（文档 + 真实 Token 双重核对，2026-10-24）：
 *  - `voice` 必填；`rate`/`volume`/`pitch` 必填且都是**字符串**；
 *  - 范围 rate 0.5~2.0 / volume 0.1~2.0 / pitch 0.1~2.0，默认均 1.0；
 *  - 传数字会被服务端以「参数格式不正确」拒绝 ⇒ 「字符串」是硬约束；
 *  - 响应只有 code/message/request_id ⇒ 提交即完成，无 task 概念；
 *  - **只对自己克隆的音色可编辑**：公共音色返回通用「声音编辑失败」，
 *    与其它失败无法区分 ⇒ 只能在入口（本地 registry 命中）区分，不能在失败时猜原因。
 */

/**
 * 克隆音色可调参数及其取值范围。
 *
 * 与 adapter（hifly-clone.js 的 VOICE_PARAM_RANGES）**同源同界**，
 * 但这里是主进程的第一道闸：拦在 service 层，比走到 adapter 才发现更早、
 * 错误也更可读。
 */
const CLONE_VOICE_PARAM_RANGES = Object.freeze({
  rate: Object.freeze({ min: 0.5, max: 2.0 }),
  volume: Object.freeze({ min: 0.1, max: 2.0 }),
  pitch: Object.freeze({ min: 0.1, max: 2.0 }),
});

/**
 * 校验音色参数对象。
 *
 * registry 是持久化面，脏数据会让下次读取**整条音色**被判非法而消失
 * （isSafeCloneVoice 对 params 有独立校验），所以写之前必须挡住。
 */
function isSafeCloneVoiceParams(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set(["rate", "volume", "pitch"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  for (const [key, range] of Object.entries(CLONE_VOICE_PARAM_RANGES)) {
    const raw = value[key];
    if (raw === undefined) continue;
    if (typeof raw !== "string" || !raw.trim()) return false;
    const num = Number(raw.trim());
    if (!Number.isFinite(num) || num < range.min || num > range.max) return false;
  }
  return true;
}

/**
 * 归一「修改克隆音色参数」入参。
 *
 * 与 _normalizeRenameRequest 同型：providerId/model/voiceId 走同一套校验，
 * 差异只在 params——三个可选字段都必须是字符串且在界内，且至少给一项。
 */
function normalizeEditParamsRequest(service, input) {
  const request = service._normalizeRequest(input);
  if (!request || !input || typeof input !== "object") return null;

  const voiceId =
    typeof input.voiceId === "string" ? input.voiceId.trim() : "";
  // 与 service 的 safeIdentifier(voiceId, MAX_VOICE_ID_LENGTH) 同界：
  // 长度 1~256、只允许字母数字与 _ - : .
  if (!/^[A-Za-z0-9_.:-]{1,256}$/.test(voiceId)) return null;

  const params = {};
  let hasAny = false;
  for (const [key, range] of Object.entries(CLONE_VOICE_PARAM_RANGES)) {
    const raw = input[key];
    if (raw === undefined) continue;
    // 官方要字符串形态（真实 Token 侧证：数字会被拒）
    if (typeof raw !== "string" || !raw.trim()) return null;
    const trimmed = raw.trim();
    const num = Number(trimmed);
    if (!Number.isFinite(num) || num < range.min || num > range.max) return null;
    params[key] = trimmed;
    hasAny = true;
  }
  // 一个参数都不给 ⇒ 空操作，视为非法
  if (!hasAny) return null;
  return { ...request, voiceId, params };
}

/**
 * 把 registry 里的音色记录转成对外形状（与 service 的 publicVoice 等价）。
 *
 * 单独一份是因为它是模块级私有函数、未导出；params 混入后拿不到。
 * 只暴露 id/name/source/createdAt/params——params 供 UI 回显当前值。
 */
function publicVoice(voice) {
  return {
    id: voice.id,
    name: voice.name,
    source: voice.source,
    createdAt: voice.createdAt,
    ...(voice.params ? { params: { ...voice.params } } : {}),
  };
}

const editParamsMethods = {
  /**
   * 修改克隆音色的语速/音量/语调。
   *
   * 与 renameClone 的关键差异：rename 只改本地名，本方法要把参数**下到服务商**
   * （飞影 POST /voice/edit），所以必须先确认 adapter 支持，再把结果持久化。
   *
   * 五层校验顺序（从便宜到贵）：
   *   1. 入参归一（本地，无 IO）——参数类型与范围；
   *   2. adapter 能力探测（本地，无网络）——不支持就 fail-closed；
   *   3. registry 命中（本地读）——只允许改**自己克隆的**音色；
   *   4. 远端调用（唯一有网络的一步）；
   *   5. 参数持久化（本地写）。
   *
   * 第 3 层是产品约束而非技术约束：飞影对**公共音色**返回通用「声音编辑失败」，
   * 与其它失败无法区分，所以只能从入口源头（本地 registry 命中）区分。
   */
  async editCloneParams(input) {
    const request = normalizeEditParamsRequest(this, input);
    if (!request) return { code: -1, message: "VOICE_CLONE_INVALID_ARGUMENTS" };
    const owner = this._captureOwner();
    if (!owner) return { code: -1, message: "VOICE_OWNER_UNAVAILABLE" };
    return this._withRegistryLock(request, owner, () =>
      this._editCloneParamsLocked(request, owner),
    );
  },

  async _editCloneParamsLocked(request, owner) {
    const capability = this._getCloneCapability(request);
    if (!capability) return this._unsupportedResponse(request);
    if (!this._hasUserSettings())
      return { code: -1, message: "VOICE_CLONE_STORE_UNAVAILABLE" };
    if (!this._hasMatchingProvider(request.providerId, request.model))
      return { code: -1, message: "VOICE_CLONE_MODEL_MISMATCH" };

    // adapter 不支持 editVoice ⇒ fail-closed（不得把参数吞掉假装成功）
    const supports = await this._modelProviderManager.supportsAdapterMethod(
      request.providerId,
      "editVoice",
    );
    if (!supports) return { code: -1, message: "VOICE_CLONE_UNSUPPORTED" };

    // 只允许改自己克隆的音色（见方法注释第 3 层）
    const registryResult = this._readRegistry(request, owner);
    if (registryResult.error) return registryResult.error;
    const clone = registryResult.registry.voices.find(
      (voice) => voice.id === request.voiceId,
    );
    if (!clone) return { code: -1, message: "VOICE_CLONE_NOT_FOUND" };

    const adapterResult = await this._modelProviderManager.callAdapter(
      request.providerId,
      "editVoice",
      { voice: clone.id, ...request.params },
    );
    if (!adapterResult || adapterResult.code !== 0) {
      // 服务端 message 原文透出（如飞影「Voice不正确」「声音编辑失败」）。
      // 注意：这是开发者向技术文案，UI 层应转成通用提示，不直出。
      return {
        code: -1,
        message: (adapterResult && adapterResult.message) || "VOICE_CLONE_EDIT_FAILED",
      };
    }

    // 参数与已有值合并（允许只改一项），写进 registry 供 UI 回显
    const nextParams = { ...(clone.params || {}), ...request.params };
    const nextClone = { ...clone, params: nextParams };
    const nextRegistry = this._replaceClone(registryResult.registry, nextClone);
    if (!this._writeRegistry(registryResult.key, nextRegistry, owner.subject))
      return { code: -1, message: "VOICE_CLONE_STORE_UNAVAILABLE" };

    return {
      code: 0,
      data: {
        providerId: request.providerId,
        model: request.model,
        voice: publicVoice(nextClone),
      },
    };
  },
};

module.exports = {
  CLONE_VOICE_PARAM_RANGES,
  isSafeCloneVoiceParams,
  normalizeEditParamsRequest,
  editParamsMethods,
  publicVoice,
};
