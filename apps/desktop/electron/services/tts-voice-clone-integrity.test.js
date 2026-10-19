import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

const catalogMocks = vi.hoisted(() => ({
  getVoiceCapability: vi.fn(),
}));

vi.mock("./tts-voice-catalog", () => ({
  CAPABILITY_TYPES: { USER_CLONE: "user_clone" },
  getVoiceCapability: catalogMocks.getVoiceCapability,
}));

import { TtsVoiceCloneService, cloneRegistrySettingKey } from "./tts-voice-clone-service";

const SENDER_KEY = "webcontents:1";

/**
 * owner 隔离的 store 替身：getUserSetting/setUserSetting 都按 owner 分区，
 * 与 tts-voice-clone-service 的 owner 隔离契约一致。
 */
function createOwnerStore(initialOwner = "user-a") {
  let activeOwner = initialOwner;
  const valuesByOwner = new Map();

  function getValues(owner) {
    if (!valuesByOwner.has(owner)) valuesByOwner.set(owner, new Map());
    return valuesByOwner.get(owner);
  }

  return {
    getOwnerSubject: vi.fn(() => activeOwner),
    getUserSetting: vi.fn((key, defaultValue, owner) => {
      const values = getValues(owner);
      return values.has(key) ? values.get(key) : defaultValue;
    }),
    setUserSetting: vi.fn((key, value, owner) => {
      getValues(owner).set(key, value);
    }),
    getValue: (owner, key) => getValues(owner).get(key),
    setActiveOwner: (owner) => {
      activeOwner = owner;
    },
  };
}

/**
 * 2026-10-18 事故：项目 mvdxd21s_o1ws 的 SQLite registry 里克隆音色仍为 active，
 * 但 voice-clone-samples/<ownerHash>/<storageId> 目录已被清理。TTS 被供应商拒绝
 * （you don't have access to this voice_id）后，重克隆回退因目录 ENOENT 必然失败。
 * 因此「registry 有记录」不等于「音色可用」：listClones 必须暴露失效原因，
 * 并提供只读的 getCloneVoiceStatus 供流水线在生成前 fail fast。
 */
describe("克隆样本完整性 — listClones invalidReason / getCloneVoiceStatus（2026-10-18）", () => {
  const MM_PROVIDER = "minimax-tts";
  const MM_MODEL = "speech-2.8-turbo";
  const INTEGRITY_OWNER = "user-integrity";
  let store;
  let sandbox;
  let userData;

  beforeEach(() => {
    store = createOwnerStore(INTEGRITY_OWNER);
    sandbox = nodeFs.mkdtempSync(path.join(os.tmpdir(), "clone-integrity-test-"));
    userData = path.join(sandbox, "userData");
    catalogMocks.getVoiceCapability.mockReset();
    catalogMocks.getVoiceCapability.mockImplementation((providerId, model) => ({
      providerId,
      model,
      type: "user_clone",
      canListVoices: true,
      defaultVoiceId: null,
      clone: {
        enabled: true,
        entry: "adapter",
        implementation: "adapter",
        messageKey: "tts.voice.clone.available",
      },
      reason: null,
    }));
  });

  afterEach(() => {
    nodeFs.rmSync(sandbox, { recursive: true, force: true });
  });

  function createIntegrityService(adapterVoiceId = "MiniMaxCloneVoice_integrity1") {
    const manager = {
      getProvider: vi.fn(() => ({
        id: MM_PROVIDER,
        category: "tts",
        models: [MM_MODEL, "speech-2.8-hd"],
      })),
      callAdapter: vi.fn(async () => ({
        code: 0,
        data: { voiceId: adapterVoiceId, name: "音色完整性" },
      })),
    };
    const service = new TtsVoiceCloneService({
      store,
      modelProviderManager: manager,
      userDataPath: userData,
      randomUUID: () => "clone-stage-integrity",
      createSelectionToken: () => "selection-integrity",
      probeDuration: vi.fn(async () => 12.5),
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });
    return { service, manager };
  }

  function registryOf() {
    return store.getValue(INTEGRITY_OWNER, cloneRegistrySettingKey(MM_PROVIDER, MM_MODEL));
  }

  function sampleStorageOf(voiceId) {
    const registry = registryOf();
    const voice = registry && registry.voices.find((item) => item.id === voiceId);
    return voice && voice.sampleStorage;
  }

  function sampleDirectoryPath(voiceId) {
    const sampleStorage = sampleStorageOf(voiceId);
    expect(sampleStorage).toBeDefined();
    return path.join(userData, ...sampleStorage.relativeDir.split("/"));
  }

  async function addCloneWithSamples(service) {
    const samplePath = path.join(sandbox, "integrity.wav");
    await nodeFs.promises.writeFile(samplePath, Buffer.from("RIFF-integrity-audio"));
    const selection = await service.createSampleSelection(
      { providerId: MM_PROVIDER, model: MM_MODEL },
      [samplePath],
      SENDER_KEY,
    );
    expect(selection.code).toBe(0);
    const added = await service.addCloneFromSelection(
      {
        providerId: MM_PROVIDER,
        model: MM_MODEL,
        name: "音色完整性",
        selectionId: selection.data.selectionId,
        consent: true,
      },
      SENDER_KEY,
    );
    expect(added.code).toBe(0);
    return added.data.voice.id;
  }

  it("样本目录缺失时 listClones 标记 invalid + sample_storage_missing", async () => {
    const { service } = createIntegrityService();
    const voiceId = await addCloneWithSamples(service);
    await nodeFs.promises.rm(sampleDirectoryPath(voiceId), { recursive: true, force: true });

    const listed = await service.listClones({ providerId: MM_PROVIDER, model: MM_MODEL });

    expect(listed.code).toBe(0);
    expect(listed.data.voices).toContainEqual(
      expect.objectContaining({
        id: voiceId,
        invalid: true,
        invalidReason: "sample_storage_missing",
      }),
    );
  });

  it("样本目录完好时 listClones 不标记 invalid，也不回传 invalidReason", async () => {
    const { service } = createIntegrityService();
    const voiceId = await addCloneWithSamples(service);

    const listed = await service.listClones({ providerId: MM_PROVIDER, model: MM_MODEL });

    expect(listed.code).toBe(0);
    const voice = listed.data.voices.find((item) => item.id === voiceId);
    expect(voice).toBeDefined();
    expect(voice.invalid).not.toBe(true);
    expect(voice).not.toHaveProperty("invalidReason");
  });

  it("非法 voice_id 优先级高于样本缺失（invalid_voice_id）", async () => {
    // MiniMax 克隆 voice_id 有长度/字符/末位约束，旧版本生成过 "01" 这类非法 id
    const { service } = createIntegrityService("01");
    const voiceId = await addCloneWithSamples(service);
    expect(voiceId).toBe("01");
    await nodeFs.promises.rm(sampleDirectoryPath(voiceId), { recursive: true, force: true });

    const listed = await service.listClones({ providerId: MM_PROVIDER, model: MM_MODEL });

    expect(listed.code).toBe(0);
    expect(listed.data.voices).toContainEqual(
      expect.objectContaining({
        id: "01",
        invalid: true,
        invalidReason: "invalid_voice_id",
      }),
    );
  });

  it("无 sampleStorage 的历史记录不因样本状态被判失效", async () => {
    const { service } = createIntegrityService();
    store.setUserSetting(
      cloneRegistrySettingKey(MM_PROVIDER, MM_MODEL),
      {
        version: 2,
        providerId: MM_PROVIDER,
        model: MM_MODEL,
        voices: [
          {
            id: "MiniMaxCloneVoice_hist1",
            name: "历史音色",
            source: "user_clone",
            createdAt: Date.now(),
            deletionState: "active",
          },
        ],
      },
      INTEGRITY_OWNER,
    );

    const listed = await service.listClones({ providerId: MM_PROVIDER, model: MM_MODEL });

    expect(listed.code).toBe(0);
    const voice = listed.data.voices.find((item) => item.id === "MiniMaxCloneVoice_hist1");
    expect(voice).toBeDefined();
    expect(voice.invalid).not.toBe(true);
    expect(voice).not.toHaveProperty("invalidReason");
  });

  it("getCloneVoiceStatus：registered+valid / registered+invalid(sample_storage_missing) / registered:false", async () => {
    const { service } = createIntegrityService();
    const voiceId = await addCloneWithSamples(service);

    const healthy = await service.getCloneVoiceStatus({
      providerId: MM_PROVIDER,
      model: MM_MODEL,
      voiceId,
    });
    expect(healthy).toMatchObject({
      code: 0,
      data: {
        registered: true,
        name: "音色完整性",
        invalid: false,
        invalidReason: null,
      },
    });

    await nodeFs.promises.rm(sampleDirectoryPath(voiceId), { recursive: true, force: true });
    const broken = await service.getCloneVoiceStatus({
      providerId: MM_PROVIDER,
      model: MM_MODEL,
      voiceId,
    });
    expect(broken).toMatchObject({
      code: 0,
      data: { registered: true, invalid: true, invalidReason: "sample_storage_missing" },
    });

    const absent = await service.getCloneVoiceStatus({
      providerId: MM_PROVIDER,
      model: MM_MODEL,
      voiceId: "MiniMaxCloneVoice_absent1",
    });
    expect(absent).toMatchObject({ code: 0, data: { registered: false } });
  });

  it("getCloneVoiceStatus 遵守 owner 隔离：另一个 owner 查不到", async () => {
    const { service } = createIntegrityService();
    const voiceId = await addCloneWithSamples(service);

    store.setActiveOwner("user-integrity-other");
    const otherService = createIntegrityService().service;
    const result = await otherService.getCloneVoiceStatus({
      providerId: MM_PROVIDER,
      model: MM_MODEL,
      voiceId,
    });

    expect(result).toMatchObject({ code: 0, data: { registered: false } });
  });

  it("getCloneVoiceStatus 走 findCloneSamples 风格的模型候选回退", async () => {
    const { service } = createIntegrityService();
    const voiceId = await addCloneWithSamples(service);

    // registry 实际绑定 speech-2.8-turbo，用 speech-2.8-hd 查询也应命中（恢复任务模型可能不同步）
    const result = await service.getCloneVoiceStatus({
      providerId: MM_PROVIDER,
      model: "speech-2.8-hd",
      voiceId,
    });

    expect(result).toMatchObject({
      code: 0,
      data: { registered: true, invalid: false, invalidReason: null },
    });
  });

  it("getCloneVoiceStatus：非法入参 / 无 owner / 存储不可用返回稳定错误码", async () => {
    const { service } = createIntegrityService();
    await expect(
      service.getCloneVoiceStatus({ providerId: MM_PROVIDER, model: MM_MODEL }),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      service.getCloneVoiceStatus({
        providerId: "bad provider",
        model: MM_MODEL,
        voiceId: "MiniMaxCloneVoice_1",
      }),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_INVALID_ARGUMENTS" });

    const noOwnerService = new TtsVoiceCloneService({
      store: null,
      userDataPath: userData,
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });
    await expect(
      noOwnerService.getCloneVoiceStatus({
        providerId: MM_PROVIDER,
        model: MM_MODEL,
        voiceId: "MiniMaxCloneVoice_1",
      }),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_OWNER_UNAVAILABLE" });

    const bareStore = { getOwnerSubject: () => INTEGRITY_OWNER };
    const noStoreService = new TtsVoiceCloneService({
      store: bareStore,
      userDataPath: userData,
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });
    await expect(
      noStoreService.getCloneVoiceStatus({
        providerId: MM_PROVIDER,
        model: MM_MODEL,
        voiceId: "MiniMaxCloneVoice_1",
      }),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_STORE_UNAVAILABLE" });
  });
});
