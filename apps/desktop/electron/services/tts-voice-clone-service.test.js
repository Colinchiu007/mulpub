import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import * as nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

const catalogMocks = vi.hoisted(() => ({
  getVoiceCapability: vi.fn(),
}));

vi.mock("./tts-voice-catalog", () => ({
  CAPABILITY_TYPES: { USER_CLONE: "user_clone" },
  getVoiceCapability: catalogMocks.getVoiceCapability,
}));

import { TtsVoiceCloneService, cloneRegistrySettingKey } from "./tts-voice-clone-service";

const PROVIDER_ID = "elevenlabs";
const MODEL = "eleven_multilingual_v2";
const SENDER_KEY = "webcontents:1";
const PREFERENCE_KEY = `tts-voice-preference:v1:${PROVIDER_ID}:${MODEL}`;

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

function createManager() {
  return {
    getProvider: vi.fn(() => ({
      id: PROVIDER_ID,
      category: "tts",
      models: [MODEL],
    })),
    callAdapter: vi.fn(async (_providerId, method) => {
      if (method === "cloneVoice")
        return { code: 0, data: { voiceId: "voice-clone-a", name: "Adapter name" } };
      return { code: 0, data: null };
    }),
  };
}

function ownerHash(owner) {
  return createHash("sha256").update(owner, "utf8").digest("hex");
}

function canonicalPath(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  let existingPath = resolvedPath;
  const missingSegments = [];
  while (!nodeFs.existsSync(existingPath)) {
    const parentPath = path.dirname(existingPath);
    if (parentPath === existingPath) return resolvedPath;
    missingSegments.unshift(path.basename(existingPath));
    existingPath = parentPath;
  }
  return path.join(nodeFs.realpathSync.native(existingPath), ...missingSegments);
}

function cloneInput(selectionId, name = "Voice", consent = true) {
  return {
    providerId: PROVIDER_ID,
    model: MODEL,
    name,
    selectionId,
    consent,
  };
}

function createFfprobeChild(stdout, onInput) {
  const child = new EventEmitter();
  const inputChunks = [];
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  child.stdin.on("data", (chunk) => inputChunks.push(Buffer.from(chunk)));
  child.stdin.on("end", () => {
    onInput(Buffer.concat(inputChunks));
    child.stdout.end(stdout);
    child.stderr.end();
    child.emit("close", 0, null);
  });
  return child;
}

describe("TtsVoiceCloneService", () => {
  let sandboxPath;
  let userDataPath;
  let store;
  let manager;
  let service;

  function createService(overrides = {}) {
    return new TtsVoiceCloneService({
      store,
      modelProviderManager: manager,
      userDataPath,
      randomUUID: () => "clone-stage-a",
      createSelectionToken: () => "selection-a",
      probeDuration: vi.fn(async () => 3.25),
      getVoiceCapability: catalogMocks.getVoiceCapability,
      ...overrides,
    });
  }

  function cloneSampleDirectory(owner, storageId) {
    return path.join(
      userDataPath,
      "voice-clone-samples",
      ownerHash(owner),
      storageId,
    );
  }

  async function chooseSamples(targetService, samplePaths, senderKey = SENDER_KEY) {
    return targetService.createSampleSelection(
      { providerId: PROVIDER_ID, model: MODEL },
      samplePaths,
      senderKey,
    );
  }

  async function cloneFromPaths(
    targetService,
    samplePaths,
    name = "Voice",
    senderKey = SENDER_KEY,
  ) {
    const selection = await chooseSamples(targetService, samplePaths, senderKey);
    if (selection.code !== 0) return selection;
    return targetService.addCloneFromSelection(
      cloneInput(selection.data.selectionId, name),
      senderKey,
    );
  }

  beforeEach(async () => {
    sandboxPath = await nodeFs.promises.mkdtemp(path.join(os.tmpdir(), "tts-voice-clone-"));
    userDataPath = path.join(sandboxPath, "user-data");
    store = createOwnerStore();
    manager = createManager();
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
    service = createService();
  });

  afterEach(async () => {
    if (sandboxPath) await nodeFs.promises.rm(sandboxPath, { recursive: true, force: true });
  });

  it("只为显式启用 USER_CLONE 的 provider/model 开放克隆入口，并使用 ElevenLabs 本地五样本上限", async () => {
    catalogMocks.getVoiceCapability.mockReturnValueOnce({
      providerId: PROVIDER_ID,
      model: MODEL,
      type: "user_clone",
      canListVoices: true,
      defaultVoiceId: null,
      clone: {
        enabled: false,
        entry: "none",
        implementation: "not_implemented",
        messageKey: "tts.voice.clone.notImplemented",
      },
      reason: null,
    });
    expect(service.getRequirements({ providerId: PROVIDER_ID, model: MODEL })).toMatchObject({
      code: -1,
      message: "VOICE_CLONE_UNSUPPORTED",
    });

    const requirements = service.getRequirements({ providerId: PROVIDER_ID, model: MODEL });
    expect(requirements).toMatchObject({
      code: 0,
      data: { maxSampleCount: 5, sampleLimitScope: "local_safety" },
    });
    expect(
      service.getRequirements({ providerId: PROVIDER_ID, model: "eleven_turbo_v2_5" }),
    ).toMatchObject({ code: 0, data: { maxSampleCount: 5, sampleLimitScope: "local_safety" } });
    const samplePaths = await Promise.all(
      Array.from({ length: 5 }, async (_value, index) => {
        const samplePath = path.join(sandboxPath, `voice-${index}.wav`);
        await nodeFs.promises.writeFile(samplePath, `audio-${index}`);
        return samplePath;
      }),
    );
    await expect(chooseSamples(service, samplePaths)).resolves.toMatchObject({
      code: 0,
      data: {
        samples: expect.arrayContaining([expect.objectContaining({ name: "sample-05.wav" })]),
      },
    });
    const sixthSamplePath = path.join(sandboxPath, "voice-5.wav");
    await nodeFs.promises.writeFile(sixthSamplePath, "audio-5");
    await expect(chooseSamples(service, [...samplePaths, sixthSamplePath])).resolves.toMatchObject({
      code: -1,
      message: "VOICE_CLONE_INVALID_ARGUMENTS",
    });
  });

  it("仅把 native 选择的样本保存在短期 owner/sender/provider/model 绑定令牌中", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");

    const selection = await chooseSamples(service, [samplePath]);
    const senderHijacked = await service.addCloneFromSelection(
      cloneInput(selection.data.selectionId),
      "webcontents:2",
    );
    const modelHijacked = await service.addCloneFromSelection(
      { ...cloneInput(selection.data.selectionId), model: "other-model" },
      SENDER_KEY,
    );
    store.setActiveOwner("user-b");
    const ownerHijacked = await service.addCloneFromSelection(
      cloneInput(selection.data.selectionId),
      SENDER_KEY,
    );
    store.setActiveOwner("user-a");
    const accepted = await service.addCloneFromSelection(
      cloneInput(selection.data.selectionId),
      SENDER_KEY,
    );
    const replayed = await service.addCloneFromSelection(
      cloneInput(selection.data.selectionId),
      SENDER_KEY,
    );

    expect(selection).toMatchObject({
      code: 0,
      data: { selectionId: "selection-a", samples: [{ name: "sample-01.wav" }] },
    });
    expect(JSON.stringify(selection)).not.toContain(samplePath);
    expect(JSON.stringify(selection)).not.toContain("bytes");
    expect(senderHijacked).toMatchObject({
      code: -1,
      message: "VOICE_CLONE_SELECTION_UNAVAILABLE",
    });
    expect(modelHijacked).toMatchObject({ code: -1, message: "VOICE_CLONE_SELECTION_UNAVAILABLE" });
    expect(ownerHijacked).toMatchObject({ code: -1, message: "VOICE_CLONE_SELECTION_UNAVAILABLE" });
    expect(accepted).toMatchObject({ code: 0, data: { selectedVoiceId: "voice-clone-a" } });
    expect(replayed).toMatchObject({ code: -1, message: "VOICE_CLONE_SELECTION_UNAVAILABLE" });
    expect(manager.callAdapter).toHaveBeenCalledTimes(1);
  });

  it("仅接受显式 consent === true 的克隆请求，拒绝不会消耗已选样本", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    const selection = await chooseSamples(service, [samplePath]);
    const requestWithoutConsent = {
      providerId: PROVIDER_ID,
      model: MODEL,
      name: "Voice",
      selectionId: selection.data.selectionId,
    };

    await expect(
      service.addCloneFromSelection(requestWithoutConsent, SENDER_KEY),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      service.addCloneFromSelection(
        cloneInput(selection.data.selectionId, "Voice", false),
        SENDER_KEY,
      ),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    expect(manager.callAdapter).not.toHaveBeenCalled();

    await expect(
      service.addCloneFromSelection(cloneInput(selection.data.selectionId), SENDER_KEY),
    ).resolves.toMatchObject({ code: 0, data: { selectedVoiceId: "voice-clone-a" } });
  });

  it("远端成功后持久化 owner-scoped 样本，且 IPC/registry 不泄露来源路径或字节", async () => {
    const samplePath = path.join(sandboxPath, "speaker.wav");
    const sampleBytes = Buffer.from("RIFF-test-audio");
    await nodeFs.promises.writeFile(samplePath, sampleBytes);

    const result = await cloneFromPaths(service, [samplePath], "我的音色");

    const registry = store.getValue("user-a", cloneRegistrySettingKey(PROVIDER_ID, MODEL));
    const clone = registry.voices[0];
    const persistedDirectory = cloneSampleDirectory("user-a", "clone-stage-a");
    const relativeDir = `voice-clone-samples/${ownerHash("user-a")}/clone-stage-a`;
    expect(result).toMatchObject({ code: 0, data: { selectedVoiceId: "voice-clone-a" } });
    const [providerId, method, adapterRequest] = manager.callAdapter.mock.calls[0];
    expect([providerId, method]).toEqual([PROVIDER_ID, "cloneVoice"]);
    expect(Object.keys(adapterRequest).sort()).toEqual(["name", "samples"]);
    expect(adapterRequest.samples).toHaveLength(1);
    const forwardedSample = adapterRequest.samples[0];
    expect(Object.keys(forwardedSample).sort()).toEqual(["blob", "contentType", "fileName"]);
    expect(forwardedSample).toMatchObject({ fileName: "sample-01.wav", contentType: "audio/wav" });
    expect(forwardedSample.blob).toBeInstanceOf(Blob);
    expect(Buffer.from(await forwardedSample.blob.arrayBuffer())).toEqual(sampleBytes);
    expect(clone).toEqual({
      id: "voice-clone-a",
      name: "Adapter name",
      source: "user_clone",
      createdAt: expect.any(Number),
      deletionState: "active",
      sampleStorage: {
        relativeDir,
        sampleCount: 1,
      },
    });
    expect(JSON.stringify(registry)).not.toContain(samplePath);
    expect(JSON.stringify(registry)).not.toContain("RIFF-test-audio");
    expect(JSON.stringify(registry)).not.toContain("bytes");
    await expect(
      nodeFs.promises.readFile(path.join(persistedDirectory, "sample-01.wav")),
    ).resolves.toEqual(sampleBytes);

    const listed = await service.listClones({ providerId: PROVIDER_ID, model: MODEL });
    expect(listed).toMatchObject({
      code: 0,
      data: {
        voices: [
          {
            id: "voice-clone-a",
            name: "Adapter name",
            source: "user_clone",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(samplePath);
    expect(JSON.stringify(result)).not.toContain("RIFF-test-audio");
    expect(JSON.stringify(listed)).not.toContain(samplePath);
    expect(JSON.stringify(listed)).not.toContain("RIFF-test-audio");
    expect(JSON.stringify(listed)).not.toContain("sampleStorage");
  });

  it("owner-scoped registry 让 A 的创建/列出/删除对 B 完全不可见", async () => {
    const samplePath = path.join(sandboxPath, "owner-isolation.wav");
    await nodeFs.promises.writeFile(samplePath, "owner-isolation-audio");
    manager.callAdapter
      .mockResolvedValueOnce({ code: 0, data: { voiceId: "voice-owner-a", name: "Owner A" } });

    const ownerAResult = await cloneFromPaths(service, [samplePath], "Owner A");
    expect(ownerAResult).toMatchObject({ code: 0, data: { selectedVoiceId: "voice-owner-a" } });
    await expect(service.listClones({ providerId: PROVIDER_ID, model: MODEL })).resolves.toMatchObject({
      code: 0,
      data: { voices: [{ id: "voice-owner-a", name: "Owner A" }] },
    });

    store.setActiveOwner("user-b");
    const ownerBService = createService({ randomUUID: () => "clone-stage-b" });
    await expect(ownerBService.listClones({ providerId: PROVIDER_ID, model: MODEL })).resolves.toMatchObject({
      code: 0,
      data: { voices: [] },
    });
    await expect(
      ownerBService.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-owner-a" }),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_NOT_FOUND" });

    store.setActiveOwner("user-a");
    await expect(
      service.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-owner-a" }),
    ).resolves.toMatchObject({ code: 0, data: { voiceId: "voice-owner-a" } });
    store.setActiveOwner("user-b");
    await expect(ownerBService.listClones({ providerId: PROVIDER_ID, model: MODEL })).resolves.toMatchObject({
      code: 0,
      data: { voices: [] },
    });
    expect(manager.callAdapter).toHaveBeenLastCalledWith(PROVIDER_ID, "deleteVoice", "voice-owner-a");
  });

  it("registry 与公开返回值不包含音频 Buffer、base64、绝对路径或原始音频内容", async () => {
    const samplePath = path.join(sandboxPath, "metadata-boundary.wav");
    const sampleBytes = Buffer.from("RIFF-metadata-boundary-audio");
    const sampleBase64 = sampleBytes.toString("base64");
    await nodeFs.promises.writeFile(samplePath, sampleBytes);
    const result = await cloneFromPaths(service, [samplePath], "Metadata safe");
    const listed = await service.listClones({ providerId: PROVIDER_ID, model: MODEL });
    const registry = store.getValue("user-a", cloneRegistrySettingKey(PROVIDER_ID, MODEL));
    const serialized = JSON.stringify({ result, listed, registry });

    expect(serialized).not.toContain(samplePath);
    expect(serialized).not.toContain(sampleBytes.toString("utf8"));
    expect(serialized).not.toContain(sampleBase64);
    expect(serialized).not.toContain("Buffer");
    expect(serialized).not.toContain("/voice-clone-samples/");
    expect(serialized).not.toContain("\\voice-clone-samples\\");
    expect(registry.voices[0]).toEqual(expect.objectContaining({
      id: "voice-clone-a",
      name: "Adapter name",
      source: "user_clone",
    }));
    expect(listed.data.voices[0]).not.toHaveProperty("sampleStorage");
  });
  it("持久化失败时补偿 deleteVoice 并清理部分受控样本目录", async () => {
    const samplePath = path.join(sandboxPath, "speaker.wav");
    await nodeFs.promises.writeFile(samplePath, "RIFF-in-memory-audio");
    await nodeFs.promises.mkdir(userDataPath, { recursive: true });
    const canonicalUserDataPath = canonicalPath(userDataPath);
    const persistenceFailingFs = {
      ...nodeFs,
      promises: {
        ...nodeFs.promises,
        writeFile: vi.fn(async (targetPath, ...args) => {
          const canonicalTargetPath = canonicalPath(targetPath);
          if (
            canonicalTargetPath === canonicalUserDataPath ||
            canonicalTargetPath.startsWith(`${canonicalUserDataPath}${path.sep}`)
          ) {
            throw new Error("sample persistence failed");
          }
          return nodeFs.promises.writeFile(targetPath, ...args);
        }),
      },
    };
    const persistenceFailingService = createService({ fs: persistenceFailingFs });

    const result = await cloneFromPaths(persistenceFailingService, [samplePath]);

    expect(result).toMatchObject({ code: -1, message: "VOICE_CLONE_STORAGE_UNAVAILABLE" });
    expect(manager.callAdapter.mock.calls.map(([, method]) => method)).toEqual([
      "cloneVoice",
      "deleteVoice",
    ]);
    expect(store.getValue("user-a", cloneRegistrySettingKey(PROVIDER_ID, MODEL))).toBeUndefined();
    await expect(
      nodeFs.promises.stat(cloneSampleDirectory("user-a", "clone-stage-a")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("缺少可用 userData 根目录时 fail closed，不创建远端音色", async () => {
    const samplePath = path.join(sandboxPath, "speaker.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    const unavailableStorageService = createService({ userDataPath: "" });

    await expect(cloneFromPaths(unavailableStorageService, [samplePath])).resolves.toMatchObject({
      code: -1,
      message: "VOICE_CLONE_STORAGE_UNAVAILABLE",
    });
    expect(manager.callAdapter).not.toHaveBeenCalled();
  });
  it("在 adapter await 期间固定 owner 快照，避免音色写入切换后的用户", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    const selection = await chooseSamples(service, [samplePath]);
    let resolveClone;
    manager.callAdapter.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveClone = resolve;
        }),
    );

    const pending = service.addCloneFromSelection(
      cloneInput(selection.data.selectionId, "Owner A voice"),
      SENDER_KEY,
    );
    await vi.waitFor(() => expect(manager.callAdapter).toHaveBeenCalledTimes(1));
    store.setActiveOwner("user-b");
    resolveClone({ code: 0, data: { voiceId: "voice-owner-a", name: "Owner A voice" } });

    await expect(pending).resolves.toMatchObject({
      code: 0,
      data: { selectedVoiceId: "voice-owner-a" },
    });
    const ownerArguments = [
      ...store.getUserSetting.mock.calls.map(([, , owner]) => owner),
      ...store.setUserSetting.mock.calls.map(([, , owner]) => owner),
    ];
    expect(ownerArguments.every((owner) => owner === "user-a")).toBe(true);
    expect(
      store.getValue("user-a", cloneRegistrySettingKey(PROVIDER_ID, MODEL)).voices,
    ).toHaveLength(1);
    expect(store.getValue("user-b", cloneRegistrySettingKey(PROVIDER_ID, MODEL))).toBeUndefined();
  });

  it("拒绝符号链接、目录和非音频扩展，不调用 provider 或写入设置", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    const directoryPath = path.join(sandboxPath, "directory.wav");
    const textPath = path.join(sandboxPath, "voice.txt");
    await nodeFs.promises.writeFile(samplePath, "audio");
    await nodeFs.promises.mkdir(directoryPath);
    await nodeFs.promises.writeFile(textPath, "not audio");

    const symbolicFileSystem = {
      ...nodeFs,
      promises: {
        ...nodeFs.promises,
        lstat: vi.fn(async (targetPath) => {
          if (path.resolve(targetPath) === samplePath) return { isSymbolicLink: () => true };
          return nodeFs.promises.lstat(targetPath);
        }),
      },
    };
    const symbolicService = createService({ fs: symbolicFileSystem });

    await expect(chooseSamples(symbolicService, [samplePath])).resolves.toMatchObject({
      code: -1,
      message: "VOICE_CLONE_SAMPLE_INVALID",
    });
    await expect(chooseSamples(service, [directoryPath])).resolves.toMatchObject({
      code: -1,
      message: "VOICE_CLONE_SAMPLE_INVALID",
    });
    await expect(chooseSamples(service, [textPath])).resolves.toMatchObject({
      code: -1,
      message: "VOICE_CLONE_SAMPLE_EXTENSION_UNSUPPORTED",
    });
    expect(manager.callAdapter).not.toHaveBeenCalled();
    expect(store.setUserSetting).not.toHaveBeenCalled();
  });

  it("ffprobe 缺失、超时或空输出时 fail closed，不伪造时长", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    const unavailableProbeService = createService({ ffprobePath: "", probeDuration: undefined });

    await expect(chooseSamples(unavailableProbeService, [samplePath])).resolves.toMatchObject({
      code: -1,
      message: "VOICE_CLONE_SAMPLE_DURATION_INVALID",
    });
    expect(manager.callAdapter).not.toHaveBeenCalled();
    expect(store.setUserSetting).not.toHaveBeenCalled();
  });

  it("用已读取的同一内存 Buffer 探测并转交样本，避免文件替换导致验证与上传不一致", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    const validatedBytes = Buffer.from("RIFF-validated-audio");
    const replacementBytes = Buffer.from("RIFF-replaced--audio");
    await nodeFs.promises.writeFile(samplePath, validatedBytes);
    const probeDuration = vi.fn(async (probeBuffer) => {
      await nodeFs.promises.writeFile(samplePath, replacementBytes);
      return 3.25;
    });
    const bufferBoundService = createService({ probeDuration });

    const result = await cloneFromPaths(bufferBoundService, [samplePath]);

    expect(result).toMatchObject({ code: 0, data: { selectedVoiceId: "voice-clone-a" } });
    expect(probeDuration).toHaveBeenCalledTimes(1);
    const [probeBuffer] = probeDuration.mock.calls[0];
    expect(Buffer.isBuffer(probeBuffer)).toBe(true);
    expect(probeBuffer).toEqual(validatedBytes);
    const [, , adapterRequest] = manager.callAdapter.mock.calls[0];
    expect(Buffer.from(await adapterRequest.samples[0].blob.arrayBuffer())).toEqual(probeBuffer);
    await expect(nodeFs.promises.readFile(samplePath)).resolves.toEqual(replacementBytes);
  });

  it("ffprobe 无音频流时 fail closed，并只从内存管道接收已读取的样本字节", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    const sampleBytes = Buffer.from("RIFF-buffer-bound-audio");
    const probeInputs = [];
    await nodeFs.promises.writeFile(samplePath, sampleBytes);
    const child = createFfprobeChild(
      JSON.stringify({
        format: { duration: "3.25", format_name: "wav" },
        streams: [{ codec_type: "video" }],
      }),
      (input) => probeInputs.push(input),
    );
    const spawnFfprobe = vi.fn(() => child);
    const defaultProbeService = createService({
      ffprobePath: "ffprobe-test",
      probeDuration: undefined,
      spawn: spawnFfprobe,
    });

    const result = await chooseSamples(defaultProbeService, [samplePath]);

    expect(result).toMatchObject({ code: -1, message: "VOICE_CLONE_SAMPLE_DURATION_INVALID" });
    expect(probeInputs).toEqual([sampleBytes]);
    expect(spawnFfprobe).toHaveBeenCalledWith("ffprobe-test", expect.arrayContaining(["pipe:0"]), {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    expect(spawnFfprobe.mock.calls[0][1]).not.toContain(samplePath);
    expect(manager.callAdapter).not.toHaveBeenCalled();
    expect(store.setUserSetting).not.toHaveBeenCalled();
  });

  it("远端克隆成功但 registry 写入失败时调用 deleteVoice 补偿并清理已落盘样本", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    store.setUserSetting.mockImplementationOnce(() => {
      throw new Error("store unavailable");
    });

    const result = await cloneFromPaths(service, [samplePath]);

    expect(result).toMatchObject({ code: -1, message: "VOICE_CLONE_STORE_UNAVAILABLE" });
    expect(manager.callAdapter).toHaveBeenNthCalledWith(
      1,
      PROVIDER_ID,
      "cloneVoice",
      expect.any(Object),
    );
    expect(manager.callAdapter).toHaveBeenNthCalledWith(
      2,
      PROVIDER_ID,
      "deleteVoice",
      "voice-clone-a",
    );
    expect(store.getValue("user-a", cloneRegistrySettingKey(PROVIDER_ID, MODEL))).toBeUndefined();

    await expect(
      nodeFs.promises.stat(cloneSampleDirectory("user-a", "clone-stage-a")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("删除在 pending 和 remote_deleted 检查点之间可恢复，并仅删除当前 owner 的远端音色", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    manager.callAdapter
      .mockResolvedValueOnce({ code: 0, data: { voiceId: "voice-a", name: "Voice A" } })
      .mockResolvedValueOnce({ code: 0, data: { voiceId: "voice-b", name: "Voice B" } });
    await cloneFromPaths(service, [samplePath], "A");

    store.setActiveOwner("user-b");
    const userBService = createService({ randomUUID: () => "clone-stage-b" });
    await cloneFromPaths(userBService, [samplePath], "B");

    store.setActiveOwner("user-a");
    manager.callAdapter.mockClear();
    manager.callAdapter.mockResolvedValueOnce({ code: -1, message: "provider unavailable" });
    const firstDelete = await service.deleteClone({
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "voice-a",
    });
    const key = cloneRegistrySettingKey(PROVIDER_ID, MODEL);
    expect(firstDelete).toMatchObject({ code: -1, message: "VOICE_CLONE_PROVIDER_UNAVAILABLE" });
    expect(store.getValue("user-a", key).voices[0]).toMatchObject({ deletionState: "pending" });
    await expect(
      nodeFs.promises.stat(cloneSampleDirectory("user-a", "clone-stage-a")),
    ).resolves.toMatchObject({ isDirectory: expect.any(Function) });

    manager.callAdapter.mockResolvedValueOnce({ code: 0, data: null });
    await expect(
      service.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-a" }),
    ).resolves.toMatchObject({ code: 0, data: { voiceId: "voice-a" } });
    expect(manager.callAdapter).toHaveBeenLastCalledWith(PROVIDER_ID, "deleteVoice", "voice-a");
    expect(store.getValue("user-a", key).voices).toHaveLength(0);
    expect(store.getValue("user-b", key).voices).toHaveLength(1);
    await expect(
      nodeFs.promises.stat(cloneSampleDirectory("user-a", "clone-stage-a")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      nodeFs.promises.stat(cloneSampleDirectory("user-b", "clone-stage-b")),
    ).resolves.toMatchObject({ isDirectory: expect.any(Function) });

    const userBRegistry = store.getValue("user-b", key);
    userBRegistry.voices[0].deletionState = "remote_deleted";
    store.setUserSetting(key, userBRegistry, "user-b");
    store.setActiveOwner("user-b");
    manager.callAdapter.mockClear();
    await expect(
      userBService.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-b" }),
    ).resolves.toMatchObject({ code: 0, data: { voiceId: "voice-b" } });
    expect(manager.callAdapter).not.toHaveBeenCalled();
    expect(store.getValue("user-b", key).voices).toHaveLength(0);
    await expect(
      nodeFs.promises.stat(cloneSampleDirectory("user-b", "clone-stage-b")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("adapter 不支持 deleteVoice（如 MiniMax 无删除 API）时删除为纯本地管理并成功", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    await cloneFromPaths(service, [samplePath], "MiniMax Clone");
    const key = cloneRegistrySettingKey(PROVIDER_ID, MODEL);
    expect(store.getValue("user-a", key).voices).toHaveLength(1);

    manager.supportsAdapterMethod = vi.fn(async () => false);
    manager.callAdapter.mockClear();
    await expect(
      service.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-clone-a" }),
    ).resolves.toMatchObject({ code: 0, data: { voiceId: "voice-clone-a" } });
    expect(manager.supportsAdapterMethod).toHaveBeenCalledWith(PROVIDER_ID, "deleteVoice");
    // 不支持远端删除：绝不调用 deleteVoice，也不返回「服务不可用」
    expect(manager.callAdapter).not.toHaveBeenCalledWith(PROVIDER_ID, "deleteVoice", expect.anything());
    // 本地记录与样本已清理
    expect(store.getValue("user-a", key).voices).toHaveLength(0);
    await expect(
      nodeFs.promises.stat(cloneSampleDirectory("user-a", "clone-stage-a")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("adapter 支持 deleteVoice 时删除仍先执行远端删除", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    await cloneFromPaths(service, [samplePath], "Eleven Clone");
    manager.supportsAdapterMethod = vi.fn(async () => true);
    manager.callAdapter.mockClear();
    manager.callAdapter.mockResolvedValueOnce({ code: 0, data: null });

    await expect(
      service.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-clone-a" }),
    ).resolves.toMatchObject({ code: 0, data: { voiceId: "voice-clone-a" } });
    expect(manager.supportsAdapterMethod).toHaveBeenCalledWith(PROVIDER_ID, "deleteVoice");
    expect(manager.callAdapter).toHaveBeenLastCalledWith(PROVIDER_ID, "deleteVoice", "voice-clone-a");
  });

  it("adapter 支持 deleteVoice 但远端删除失败时仍返回 PROVIDER_UNAVAILABLE 且保留本地记录", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    await cloneFromPaths(service, [samplePath], "Eleven Clone");
    manager.supportsAdapterMethod = vi.fn(async () => true);
    manager.callAdapter.mockClear();
    manager.callAdapter.mockResolvedValueOnce({ code: -1, message: "provider unavailable" });

    await expect(
      service.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-clone-a" }),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_PROVIDER_UNAVAILABLE" });
    const key = cloneRegistrySettingKey(PROVIDER_ID, MODEL);
    expect(store.getValue("user-a", key).voices).toHaveLength(1);
  });

  it("缺少 supportsAdapterMethod 能力查询时回退旧行为（尝试远端删除）", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    await cloneFromPaths(service, [samplePath], "Legacy");
    // manager 默认不含 supportsAdapterMethod → 回退远端删除
    manager.callAdapter.mockClear();
    manager.callAdapter.mockResolvedValueOnce({ code: 0, data: null });
    await expect(
      service.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-clone-a" }),
    ).resolves.toMatchObject({ code: 0, data: { voiceId: "voice-clone-a" } });
    expect(manager.callAdapter).toHaveBeenLastCalledWith(PROVIDER_ID, "deleteVoice", "voice-clone-a");
  });

  it("能力查询返回 null（探测失败/无法判定）时回退尝试远端删除，不静默降级为纯本地删除", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    await cloneFromPaths(service, [samplePath], "Unknown");
    manager.supportsAdapterMethod = vi.fn(async () => null);
    manager.callAdapter.mockClear();
    manager.callAdapter.mockResolvedValueOnce({ code: -1, message: "provider unavailable" });

    await expect(
      service.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-clone-a" }),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_PROVIDER_UNAVAILABLE" });
    expect(manager.callAdapter).toHaveBeenLastCalledWith(PROVIDER_ID, "deleteVoice", "voice-clone-a");
    // 远端删除失败 → 本地记录保留（不静默删除）
    const key = cloneRegistrySettingKey(PROVIDER_ID, MODEL);
    expect(store.getValue("user-a", key).voices).toHaveLength(1);
  });

  it("adapter 不支持 deleteVoice 且本地样本清理失败时返回 STORAGE_UNAVAILABLE 并保留记录", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    await cloneFromPaths(service, [samplePath], "LocalOnly");
    manager.supportsAdapterMethod = vi.fn(async () => false);
    manager.callAdapter.mockClear();
    // 让样本清理失败：直接替换 fs.promises.rm 抛错（cleanup 使用 nodeFs.promises.rm）
    const originalRm = nodeFs.promises.rm.bind(nodeFs.promises);
    nodeFs.promises.rm = vi.fn(async () => {
      throw new Error("rm failed");
    });
    try {
      await expect(
        service.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-clone-a" }),
      ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_STORAGE_UNAVAILABLE" });
      const key = cloneRegistrySettingKey(PROVIDER_ID, MODEL);
      expect(store.getValue("user-a", key).voices).toHaveLength(1);
    } finally {
      nodeFs.promises.rm = originalRm;
    }
    expect(manager.callAdapter).not.toHaveBeenCalledWith(PROVIDER_ID, "deleteVoice", expect.anything());
  });

  it("删除当前选中的克隆会清除持久化偏好", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    await cloneFromPaths(service, [samplePath]);
    store.setUserSetting(PREFERENCE_KEY, {
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "voice-clone-a",
      selectedAt: Date.now(),
    }, "user-a");

    await expect(service.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-clone-a" }))
      .resolves.toMatchObject({ code: 0 });
    expect(store.getValue("user-a", PREFERENCE_KEY)).toBeNull();
  });

  it("删除未选中的克隆会保留持久化偏好", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    manager.callAdapter
      .mockResolvedValueOnce({ code: 0, data: { voiceId: "voice-a", name: "Voice A" } })
      .mockResolvedValueOnce({ code: 0, data: { voiceId: "voice-b", name: "Voice B" } });
    let storageIndex = 0;
    const multiCloneService = createService({
      randomUUID: () => "clone-stage-" + (++storageIndex),
    });
    await cloneFromPaths(multiCloneService, [samplePath], "A");
    await cloneFromPaths(multiCloneService, [samplePath], "B");
    const preference = {
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "voice-a",
      selectedAt: Date.now(),
    };
    store.setUserSetting(PREFERENCE_KEY, preference, "user-a");

    await expect(multiCloneService.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-b" }))
      .resolves.toMatchObject({ code: 0 });
    expect(store.getValue("user-a", PREFERENCE_KEY)).toEqual(preference);
  });

  it("偏好存储清理失败时不会错误报告删除成功", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    await cloneFromPaths(service, [samplePath]);
    store.setUserSetting(PREFERENCE_KEY, {
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "voice-clone-a",
      selectedAt: Date.now(),
    }, "user-a");
    store.setUserSetting.mockImplementation((key, value, owner) => {
      if (key === PREFERENCE_KEY) throw new Error("preference store unavailable");
      store.getValue(owner, key);
    });

    await expect(service.deleteClone({ providerId: PROVIDER_ID, model: MODEL, voiceId: "voice-clone-a" }))
      .resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_STORE_UNAVAILABLE" });
  });

  it("remote_deleted 阶段的样本清理失败可重试，且不会重复删除远端音色", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    await cloneFromPaths(service, [samplePath], "Recoverable");
    const key = cloneRegistrySettingKey(PROVIDER_ID, MODEL);
    const persistedDirectory = cloneSampleDirectory("user-a", "clone-stage-a");
    const cleanupFailingFs = {
      ...nodeFs,
      promises: {
        ...nodeFs.promises,
        rm: vi.fn(async (targetPath, ...args) => {
          if (canonicalPath(targetPath) === canonicalPath(persistedDirectory))
            throw new Error("sample cleanup failed");
          return nodeFs.promises.rm(targetPath, ...args);
        }),
      },
    };
    const cleanupFailingService = createService({ fs: cleanupFailingFs });

    manager.callAdapter.mockClear();
    manager.callAdapter.mockResolvedValueOnce({ code: 0, data: null });
    await expect(
      cleanupFailingService.deleteClone({
        providerId: PROVIDER_ID,
        model: MODEL,
        voiceId: "voice-clone-a",
      }),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_STORAGE_UNAVAILABLE" });
    expect(manager.callAdapter).toHaveBeenCalledWith(PROVIDER_ID, "deleteVoice", "voice-clone-a");
    expect(store.getValue("user-a", key).voices[0]).toMatchObject({
      deletionState: "remote_deleted",
    });
    await expect(nodeFs.promises.stat(persistedDirectory)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });

    manager.callAdapter.mockClear();
    await expect(
      service.deleteClone({
        providerId: PROVIDER_ID,
        model: MODEL,
        voiceId: "voice-clone-a",
      }),
    ).resolves.toMatchObject({ code: 0, data: { voiceId: "voice-clone-a" } });
    expect(manager.callAdapter).not.toHaveBeenCalled();
    expect(store.getValue("user-a", key).voices).toHaveLength(0);
    await expect(nodeFs.promises.stat(persistedDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("拒绝引用其他 owner 存储目录的 registry metadata", async () => {
    const key = cloneRegistrySettingKey(PROVIDER_ID, MODEL);
    store.setUserSetting(
      key,
      {
        version: 2,
        providerId: PROVIDER_ID,
        model: MODEL,
        voices: [
          {
            id: "voice-clone-a",
            name: "Voice",
            source: "user_clone",
            createdAt: Date.now(),
            deletionState: "active",
            sampleStorage: {
              relativeDir: `voice-clone-samples/${ownerHash("user-b")}/clone-stage-b`,
              sampleCount: 1,
            },
          },
        ],
      },
      "user-a",
    );

    await expect(
      service.listClones({ providerId: PROVIDER_ID, model: MODEL }),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_REGISTRY_INVALID" });
  });

  it("串行化同一 owner/provider/model 的 add/delete，避免 add 期间把有效克隆误判为未找到", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    const selection = await chooseSamples(service, [samplePath]);
    let resolveClone;
    manager.callAdapter.mockImplementation(async (_providerId, method) => {
      if (method === "cloneVoice")
        return new Promise((resolve) => {
          resolveClone = resolve;
        });
      return { code: 0, data: null };
    });

    const addPromise = service.addCloneFromSelection(
      cloneInput(selection.data.selectionId),
      SENDER_KEY,
    );
    await vi.waitFor(() => expect(manager.callAdapter).toHaveBeenCalledTimes(1));
    const deletePromise = service.deleteClone({
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "voice-concurrent",
    });
    let deleteSettled = false;
    deletePromise.finally(() => {
      deleteSettled = true;
    });
    await Promise.resolve();
    expect(deleteSettled).toBe(false);

    resolveClone({ code: 0, data: { voiceId: "voice-concurrent", name: "Concurrent" } });
    await expect(addPromise).resolves.toMatchObject({
      code: 0,
      data: { selectedVoiceId: "voice-concurrent" },
    });
    await expect(deletePromise).resolves.toMatchObject({
      code: 0,
      data: { voiceId: "voice-concurrent" },
    });
    expect(manager.callAdapter.mock.calls.map(([, method]) => method)).toEqual([
      "cloneVoice",
      "deleteVoice",
    ]);
    expect(
      store.getValue("user-a", cloneRegistrySettingKey(PROVIDER_ID, MODEL)).voices,
    ).toHaveLength(0);
  });

  it("过期选择令牌不能用于克隆", async () => {
    const samplePath = path.join(sandboxPath, "voice.wav");
    await nodeFs.promises.writeFile(samplePath, "audio");
    let now = 100;
    const expiringService = createService({ now: () => now, selectionTtlMs: 10 });
    const selection = await chooseSamples(expiringService, [samplePath]);
    now = 110;

    await expect(
      expiringService.addCloneFromSelection(cloneInput(selection.data.selectionId), SENDER_KEY),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_SELECTION_UNAVAILABLE" });
    expect(manager.callAdapter).not.toHaveBeenCalled();
  });
});


describe("_probeMediaDuration — pipe 拿不到 duration 时回退临时文件（回归 wav 误报时长不符）", () => {
  const pipeNoDuration = JSON.stringify({
    programs: [],
    streams: [{ codec_type: "audio" }],
    format: { format_name: "wav" },
  });
  const fileWithDuration = JSON.stringify({
    programs: [],
    streams: [{ codec_type: "audio" }],
    format: { format_name: "wav", duration: "27.120907" },
  });

  function makeService() {
    // probeDuration 不注入 → 走默认 this._probeMediaDuration
    // ffprobePath 必须显式注入：CI（Linux self-hosted）无捆绑 ffprobe，避免环境依赖导致 early-return
    return new TtsVoiceCloneService({
      store: createOwnerStore(),
      modelProviderManager: createManager(),
      userDataPath: path.join(os.tmpdir(), "clone-probe-test-" + Math.random().toString(36).slice(2)),
      ffprobePath: "ffprobe-test",
      randomUUID: () => "clone-stage-a",
      createSelectionToken: () => "selection-a",
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });
  }

  it("pipe 无 duration 时回退临时文件探测并返回正确时长，临时文件已清理", async () => {
    const service = makeService();
    const probeSpy = vi.spyOn(service, "_runFfprobe").mockResolvedValue(pipeNoDuration);
    const fileSpy = vi.spyOn(service, "_runFfprobeFile").mockImplementation(async (filePath) => {
      expect(nodeFs.existsSync(filePath)).toBe(true);
      return fileWithDuration;
    });

    const result = await service._probeMediaDuration(Buffer.from("fake-wav-bytes"));

    expect(result).toBe(27.120907);
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(fileSpy).toHaveBeenCalledTimes(1);
    const tempPath = fileSpy.mock.calls[0][0];
    expect(tempPath).toMatch(/voice-clone-probe-/);
    expect(nodeFs.existsSync(tempPath)).toBe(false); // finally 已清理
  });

  it("pipe 直接拿到 duration 时不回退临时文件", async () => {
    const service = makeService();
    const pipeOk = JSON.stringify({
      programs: [],
      streams: [{ codec_type: "audio" }],
      format: { format_name: "mp3", duration: "12.5" },
    });
    const probeSpy = vi.spyOn(service, "_runFfprobe").mockResolvedValue(pipeOk);
    const fileSpy = vi.spyOn(service, "_runFfprobeFile").mockResolvedValue(fileWithDuration);

    const result = await service._probeMediaDuration(Buffer.from("fake-mp3-bytes"));

    expect(result).toBe(12.5);
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(fileSpy).not.toHaveBeenCalled();
  });

  it("pipe 与临时文件都失败时返回 null（不抛错）", async () => {
    const service = makeService();
    const probeSpy = vi.spyOn(service, "_runFfprobe").mockRejectedValue(new Error("pipe boom"));
    const fileSpy = vi.spyOn(service, "_runFfprobeFile").mockResolvedValue("{not-json");

    const result = await service._probeMediaDuration(Buffer.from("garbage"));

    expect(result).toBeNull();
    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(fileSpy).toHaveBeenCalledTimes(1);
  });
})

describe("listClones — MiniMax 克隆音色 voice_id 合规性", () => {
  let mmStore;
  let mmSandbox;
  let mmUserData;

  beforeEach(() => {
    mmStore = createOwnerStore("user-mm");
    mmSandbox = nodeFs.mkdtempSync(path.join(os.tmpdir(), "mm-clone-voice-test-"));
    mmUserData = path.join(mmSandbox, "userData");
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
    nodeFs.rmSync(mmSandbox, { recursive: true, force: true });
  });

  function createMinimaxService(adapterVoiceId) {
    const minimaxManager = {
      getProvider: vi.fn(() => ({ id: "minimax-tts", category: "tts", models: ["speech-2.8-turbo"] })),
      callAdapter: vi.fn(async () => ({ code: 0, data: { voiceId: adapterVoiceId, name: "克隆音色" } })),
    };
    const minimaxService = new TtsVoiceCloneService({
      store: mmStore,
      modelProviderManager: minimaxManager,
      userDataPath: mmUserData,
      randomUUID: () => "clone-stage-mm",
      createSelectionToken: () => "selection-mm",
      probeDuration: vi.fn(async () => 12.5),
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });
    return { minimaxManager, minimaxService };
  }

  it("旧版非法 voice_id（如 01）在 listClones 中被标记 invalid", async () => {
    const samplePath = path.join(mmSandbox, "mm-invalid.wav");
    await nodeFs.promises.writeFile(samplePath, Buffer.from("RIFF-mm-invalid-audio"));
    // 模拟旧版 adapter 生成非法 voice_id 并已持久化到 registry
    const { minimaxManager, minimaxService } = createMinimaxService("01");
    const selection = await minimaxService.createSampleSelection(
      { providerId: "minimax-tts", model: "speech-2.8-turbo" },
      [samplePath],
      SENDER_KEY,
    );
    expect(selection.code).toBe(0);
    const added = await minimaxService.addCloneFromSelection(
      {
        providerId: "minimax-tts",
        model: "speech-2.8-turbo",
        name: "克隆音色",
        selectionId: selection.data.selectionId,
        consent: true,
      },
      SENDER_KEY,
    );
    expect(added).toMatchObject({ code: 0 });

    const listed = await minimaxService.listClones({ providerId: "minimax-tts", model: "speech-2.8-turbo" });
    expect(listed.code).toBe(0);
    expect(listed.data.voices).toContainEqual(expect.objectContaining({ id: "01", invalid: true }));
  });

  it("合法 voice_id 的克隆不被标记 invalid", async () => {
    const samplePath = path.join(mmSandbox, "mm-valid.wav");
    await nodeFs.promises.writeFile(samplePath, Buffer.from("RIFF-mm-valid-audio"));
    const { minimaxManager, minimaxService } = createMinimaxService("MiniMaxVoice_abc123");
    const selection = await minimaxService.createSampleSelection(
      { providerId: "minimax-tts", model: "speech-2.8-turbo" },
      [samplePath],
      SENDER_KEY,
    );
    const added = await minimaxService.addCloneFromSelection(
      {
        providerId: "minimax-tts",
        model: "speech-2.8-turbo",
        name: "克隆音色",
        selectionId: selection.data.selectionId,
        consent: true,
      },
      SENDER_KEY,
    );
    expect(added).toMatchObject({ code: 0 });

    const listed = await minimaxService.listClones({ providerId: "minimax-tts", model: "speech-2.8-turbo" });
    expect(listed.code).toBe(0);
    const voice = listed.data.voices.find((item) => item.id === "MiniMaxVoice_abc123");
    expect(voice).toBeDefined();
    expect(voice.invalid).not.toBe(true);
  });

  it("多模态模型（minimax-multimodal）声明 tts 能力时可添加克隆音色（回归 VOICE_CLONE_MODEL_MISMATCH）", async () => {
    const samplePath = path.join(mmSandbox, "mm-multimodal.wav");
    await nodeFs.promises.writeFile(samplePath, Buffer.from("RIFF-mm-multimodal-audio"));
    const multimodalManager = {
      getProvider: vi.fn(() => ({
        id: "minimax-multimodal",
        category: "multimodal",
        capabilities: ["llm", "tts", "image", "video"],
        capability_models: { llm: "MiniMax-M2.7", tts: "speech-2.8-turbo", image: "image-01", video: "MiniMax-Hailuo-2.3" },
        models: ["speech-2.8-turbo", "image-01", "MiniMax-Hailuo-2.3", "MiniMax-M2.7"],
      })),
      callAdapter: vi.fn(async () => ({ code: 0, data: { voiceId: "MiniMaxVoice_mm123", name: "克隆音色" } })),
    };
    const multimodalService = new TtsVoiceCloneService({
      store: mmStore,
      modelProviderManager: multimodalManager,
      userDataPath: mmUserData,
      randomUUID: () => "clone-stage-mm-multi",
      createSelectionToken: () => "selection-mm-multi",
      probeDuration: vi.fn(async () => 12.5),
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });

    const selection = await multimodalService.createSampleSelection(
      { providerId: "minimax-multimodal", model: "speech-2.8-turbo" },
      [samplePath],
      SENDER_KEY,
    );
    expect(selection.code).toBe(0);
    const added = await multimodalService.addCloneFromSelection(
      {
        providerId: "minimax-multimodal",
        model: "speech-2.8-turbo",
        name: "克隆音色",
        selectionId: selection.data.selectionId,
        consent: true,
      },
      SENDER_KEY,
    );
    expect(added.code).toBe(0);
    expect(multimodalManager.callAdapter).toHaveBeenCalledWith("minimax-multimodal", "cloneVoice", expect.any(Object));
  });

  it("未声明 tts 能力的多模态模型添加克隆被拒（VOICE_CLONE_MODEL_MISMATCH）", async () => {
    const samplePath = path.join(mmSandbox, "mm-no-tts.wav");
    await nodeFs.promises.writeFile(samplePath, Buffer.from("RIFF-mm-no-tts-audio"));
    const noTtsManager = {
      getProvider: vi.fn(() => ({
        id: "minimax-multimodal",
        category: "multimodal",
        capabilities: ["image"],
        models: ["image-01"],
      })),
      callAdapter: vi.fn(async () => ({ code: 0, data: { voiceId: "x", name: "x" } })),
    };
    const noTtsService = new TtsVoiceCloneService({
      store: mmStore,
      modelProviderManager: noTtsManager,
      userDataPath: mmUserData,
      randomUUID: () => "clone-stage-mm-notts",
      createSelectionToken: () => "selection-mm-notts",
      probeDuration: vi.fn(async () => 12.5),
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });

    const selection = await noTtsService.createSampleSelection(
      { providerId: "minimax-multimodal", model: "speech-2.8-turbo" },
      [samplePath],
      SENDER_KEY,
    );
    expect(selection.code).toBe(0);
    const added = await noTtsService.addCloneFromSelection(
      {
        providerId: "minimax-multimodal",
        model: "speech-2.8-turbo",
        name: "克隆音色",
        selectionId: selection.data.selectionId,
        consent: true,
      },
      SENDER_KEY,
    );
    expect(added).toMatchObject({ code: -1, message: "VOICE_CLONE_MODEL_MISMATCH" });
    expect(noTtsManager.callAdapter).not.toHaveBeenCalled();
  });
})

describe("renameClone — 克隆音色重命名（2026-08-12）", () => {
  let store;
  let sandbox;
  let userData;

  beforeEach(() => {
    store = createOwnerStore("user-rename");
    sandbox = nodeFs.mkdtempSync(path.join(os.tmpdir(), "rename-clone-voice-test-"));
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

  function createService(manager) {
    return new TtsVoiceCloneService({
      store,
      modelProviderManager: manager,
      userDataPath: userData,
      randomUUID: () => "clone-stage-rename",
      createSelectionToken: () => "selection-rename",
      probeDuration: vi.fn(async () => 12.5),
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });
  }

  async function addOneClone(service, manager, providerId = "minimax-tts", model = "speech-2.8-turbo", adapterVoiceId = "MiniMaxVoice_rename1") {
    const samplePath = path.join(sandbox, "rename.wav");
    await nodeFs.promises.writeFile(samplePath, Buffer.from("RIFF-rename-audio"));
    const selection = await service.createSampleSelection(
      { providerId, model },
      [samplePath],
      SENDER_KEY,
    );
    expect(selection.code).toBe(0);
    const added = await service.addCloneFromSelection(
      {
        providerId,
        model,
        name: "克隆音色",
        selectionId: selection.data.selectionId,
        consent: true,
      },
      SENDER_KEY,
    );
    expect(added).toMatchObject({ code: 0 });
    expect(manager.callAdapter).toHaveBeenCalledWith(providerId, "cloneVoice", expect.any(Object));
  }

  it("重命名只更新本地 registry 展示名，不调用远端 adapter，voice_id 保持不变", async () => {
    const manager = {
      getProvider: vi.fn(() => ({ id: "minimax-tts", category: "tts", models: ["speech-2.8-turbo"] })),
      callAdapter: vi.fn(async () => ({ code: 0, data: { voiceId: "MiniMaxVoice_rename1", name: "克隆音色" } })),
    };
    const service = createService(manager);
    await addOneClone(service, manager);
    manager.callAdapter.mockClear();

    const renamed = await service.renameClone({
      providerId: "minimax-tts",
      model: "speech-2.8-turbo",
      voiceId: "MiniMaxVoice_rename1",
      name: "我的专属音色",
    });
    expect(renamed).toMatchObject({
      code: 0,
      data: { voice: { id: "MiniMaxVoice_rename1", name: "我的专属音色" } },
    });
    expect(manager.callAdapter).not.toHaveBeenCalled();

    const listed = await service.listClones({ providerId: "minimax-tts", model: "speech-2.8-turbo" });
    expect(listed.code).toBe(0);
    expect(listed.data.voices).toContainEqual(
      expect.objectContaining({ id: "MiniMaxVoice_rename1", name: "我的专属音色" }),
    );
  });

  it("多模态模型（minimax-multimodal，声明 tts）重命名克隆成功", async () => {
    const manager = {
      getProvider: vi.fn(() => ({
        id: "minimax-multimodal",
        category: "multimodal",
        capabilities: ["llm", "tts", "image", "video"],
        capability_models: { llm: "MiniMax-M2.7", tts: "speech-2.8-turbo", image: "image-01", video: "MiniMax-Hailuo-2.3" },
        models: ["speech-2.8-turbo", "image-01", "MiniMax-Hailuo-2.3", "MiniMax-M2.7"],
      })),
      callAdapter: vi.fn(async () => ({ code: 0, data: { voiceId: "MiniMaxVoice_mm_ren", name: "克隆音色" } })),
    };
    const service = createService(manager);
    await addOneClone(service, manager, "minimax-multimodal", "speech-2.8-turbo", "MiniMaxVoice_mm_ren");
    manager.callAdapter.mockClear();

    const renamed = await service.renameClone({
      providerId: "minimax-multimodal",
      model: "speech-2.8-turbo",
      voiceId: "MiniMaxVoice_mm_ren",
      name: "音色001",
    });
    expect(renamed).toMatchObject({ code: 0, data: { voice: { id: "MiniMaxVoice_mm_ren", name: "音色001" } } });
    expect(manager.callAdapter).not.toHaveBeenCalled();
  });

  it("未声明 tts 能力的多模态模型重命名被拒（VOICE_CLONE_MODEL_MISMATCH）", async () => {
    const manager = {
      getProvider: vi.fn(() => ({
        id: "minimax-multimodal",
        category: "multimodal",
        capabilities: ["image"],
        models: ["image-01"],
      })),
      callAdapter: vi.fn(),
    };
    const service = createService(manager);
    const result = await service.renameClone({
      providerId: "minimax-multimodal",
      model: "speech-2.8-turbo",
      voiceId: "MiniMaxVoice_x",
      name: "音色001",
    });
    expect(result).toMatchObject({ code: -1, message: "VOICE_CLONE_MODEL_MISMATCH" });
    expect(manager.callAdapter).not.toHaveBeenCalled();
  });

  it("重命名不存在的克隆返回 VOICE_CLONE_NOT_FOUND", async () => {
    const manager = {
      getProvider: vi.fn(() => ({ id: "minimax-tts", category: "tts", models: ["speech-2.8-turbo"] })),
      callAdapter: vi.fn(),
    };
    const service = createService(manager);
    const result = await service.renameClone({
      providerId: "minimax-tts",
      model: "speech-2.8-turbo",
      voiceId: "MiniMaxVoice_missing",
      name: "音色001",
    });
    expect(result).toMatchObject({ code: -1, message: "VOICE_CLONE_NOT_FOUND" });
  });

  it("空名称/非法 voice_id 等参数 fail closed（VOICE_CLONE_INVALID_ARGUMENTS）", async () => {
    const service = createService({
      getProvider: vi.fn(),
      callAdapter: vi.fn(),
    });
    await expect(
      service.renameClone({ providerId: "minimax-tts", model: "speech-2.8-turbo", voiceId: "MiniMaxVoice_x", name: "" }),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      service.renameClone({ providerId: "minimax-tts", model: "speech-2.8-turbo", voiceId: "MiniMaxVoice_x", name: "   " }),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      service.renameClone({ providerId: "minimax-tts", model: "speech-2.8-turbo", voiceId: "bad voice id!", name: "音色001" }),
    ).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
  });
});

describe("多模态模型克隆样本限制（2026-08-12）", () => {
  it("minimax-multimodal 的本地克隆限制与 minimax-tts 完全一致（1 个样本、10s-5min、≤20MB）", () => {
    const store = createOwnerStore("user-limits");
    const manager = {
      getProvider: vi.fn(() => ({
        id: "minimax-multimodal",
        category: "multimodal",
        capabilities: ["tts"],
        models: ["speech-2.8-turbo"],
      })),
      callAdapter: vi.fn(),
    };
    const service = new TtsVoiceCloneService({
      store,
      modelProviderManager: manager,
      userDataPath: path.join(nodeFs.mkdtempSync(path.join(os.tmpdir(), "mm-limits-voice-test-")), "userData"),
      randomUUID: () => "clone-stage-limits",
      createSelectionToken: () => "selection-limits",
      probeDuration: vi.fn(async () => 12.5),
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });
    catalogMocks.getVoiceCapability.mockReset();
    catalogMocks.getVoiceCapability.mockImplementation((providerId, model) => ({
      providerId,
      model,
      type: "user_clone",
      canListVoices: true,
      defaultVoiceId: null,
      clone: { enabled: true, entry: "adapter", implementation: "adapter", messageKey: "tts.voice.clone.available" },
      reason: null,
    }));

    const mm = service.getRequirements({ providerId: "minimax-multimodal", model: "speech-2.8-turbo" });
    const tts = service.getRequirements({ providerId: "minimax-tts", model: "speech-2.8-turbo" });
    expect(mm.code).toBe(0);
    expect(tts.code).toBe(0);
    expect(mm.data).toMatchObject({
      maxSampleCount: 1,
      maxSampleBytes: 20 * 1024 * 1024,
      minSampleDurationSeconds: 10,
      maxSampleDurationSeconds: 300,
      allowedExtensions: [".mp3", ".m4a", ".wav"],
    });
    expect(mm.data.maxSampleCount).toBe(tts.data.maxSampleCount);
    expect(mm.data.maxSampleBytes).toBe(tts.data.maxSampleBytes);
    expect(mm.data.minSampleDurationSeconds).toBe(tts.data.minSampleDurationSeconds);
    expect(mm.data.maxSampleDurationSeconds).toBe(tts.data.maxSampleDurationSeconds);
    expect(mm.data.allowedExtensions).toEqual(tts.data.allowedExtensions);
  });

describe("findCloneSamples — owner 解析修复（2026-08-18）", () => {
  it("findCloneSamples 使用 _captureOwner 正确解析 owner 并返回 persisted samples", async () => {
    const store = createOwnerStore("user-clone-find");
    const userDataDir = nodeFs.mkdtempSync(path.join(os.tmpdir(), "clone-find-test-"));
    const service = new TtsVoiceCloneService({
      store,
      modelProviderManager: createManager(),
      userDataPath: userDataDir,
      randomUUID: () => "clone-find-uuid",
      createSelectionToken: () => "selection-find",
      probeDuration: vi.fn(async () => 10),
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });

    // Manually write a registry entry as if a clone was previously created
    const registryKey = "tts-voice-clones:v2:minimax-tts:speech-2.8-turbo";
    const owner = "user-clone-find";
    store.setUserSetting(registryKey, {
      version: 2,
      providerId: "minimax-tts",
      model: "speech-2.8-turbo",
      voices: [{
        id: "MiniMaxCloneVoice_test123",
        name: "test-voice",
        source: "user_clone",
        createdAt: Date.now(),
        deletionState: "active",
        sampleStorage: {
          relativeDir: "voice-clone-samples/user-clone-find/test-storage-id",
          sampleCount: 1,
        },
      }],
    }, owner);

    // findCloneSamples should now resolve owner via _captureOwner and find the entry
    const result = await service.findCloneSamples("MiniMaxCloneVoice_test123", "minimax-tts", "speech-2.8-turbo");
    expect(result).not.toBeNull();
    expect(result.sampleStorage).toBeDefined();
    expect(result.sampleStorage.relativeDir).toBe("voice-clone-samples/user-clone-find/test-storage-id");
    expect(result.name).toBe("test-voice");
  });

  it("findCloneSamples 在 owner 不匹配时返回 null", async () => {
    const store = createOwnerStore("user-other");
    const service = new TtsVoiceCloneService({
      store,
      modelProviderManager: createManager(),
      userDataPath: nodeFs.mkdtempSync(path.join(os.tmpdir(), "clone-find-nomatch-")),
      randomUUID: () => "clone-find-uuid-2",
      createSelectionToken: () => "selection-find-2",
      probeDuration: vi.fn(async () => 10),
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });

    // Registry exists but under a different owner
    const registryKey = "tts-voice-clones:v2:minimax-tts:speech-2.8-turbo";
    store.setUserSetting(registryKey, {
      version: 2,
      providerId: "minimax-tts",
      model: "speech-2.8-turbo",
      voices: [{
        id: "MiniMaxCloneVoice_other",
        name: "other-voice",
        source: "user_clone",
        createdAt: Date.now(),
        deletionState: "active",
        sampleStorage: { relativeDir: "voice-clone-samples/user-other/xxx", sampleCount: 1 },
      }],
    }, "user-other");

    // Active owner is "user-other" but store returns settings for that owner — should work
    const result = await service.findCloneSamples("MiniMaxCloneVoice_other", "minimax-tts", "speech-2.8-turbo");
    expect(result).not.toBeNull();
    expect(result.sampleStorage).toBeDefined();
  });
});
});

describe("replaceCloneVoiceId — 重克隆后持久化迁移", () => {
  it("替换 owner registry 中的旧 id，并同步迁移当前用户偏好", async () => {
    const owner = "user-recovery";
    const store = createOwnerStore(owner);
    const userDataPath = nodeFs.mkdtempSync(path.join(os.tmpdir(), "clone-recovery-"));
    const manager = createManager();
    const service = new TtsVoiceCloneService({
      store,
      modelProviderManager: manager,
      userDataPath,
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });
    const providerId = PROVIDER_ID;
    const model = MODEL;
    const oldVoiceId = "voice-clone-old";
    const newVoiceId = "voice-clone-recovered";
    const registryKey = cloneRegistrySettingKey(providerId, model);
    store.setUserSetting(registryKey, {
      version: 2,
      providerId,
      model,
      voices: [{
        id: oldVoiceId,
        name: "Recovered voice",
        source: "user_clone",
        createdAt: 123,
        deletionState: "active",
        sampleStorage: {
          relativeDir: `voice-clone-samples/${ownerHash(owner)}/storage-1`,
          sampleCount: 1,
        },
      }],
    }, owner);
    store.setUserSetting(PREFERENCE_KEY, { providerId, model, voiceId: oldVoiceId, selectedAt: 456 }, owner);

    try {
      await expect(service.replaceCloneVoiceId({
        providerId,
        model,
        voiceId: oldVoiceId,
        replacementVoiceId: newVoiceId,
      })).resolves.toMatchObject({
        code: 0,
        data: { migrated: true, preferenceMigrated: true, voice: { id: newVoiceId } },
      });

      expect(store.getValue(owner, registryKey).voices).toEqual([
        expect.objectContaining({
          id: newVoiceId,
          name: "Recovered voice",
          sampleStorage: expect.objectContaining({ sampleCount: 1 }),
        }),
      ]);
      expect(store.getValue(owner, PREFERENCE_KEY)).toMatchObject({
        providerId,
        model,
        voiceId: newVoiceId,
        selectedAt: 456,
      });
    } finally {
      nodeFs.rmSync(userDataPath, { recursive: true, force: true });
    }
  });

  it("目标 id 已存在时拒绝迁移，不覆盖其他克隆记录", async () => {
    const owner = "user-recovery-duplicate";
    const store = createOwnerStore(owner);
    const userDataPath = nodeFs.mkdtempSync(path.join(os.tmpdir(), "clone-recovery-duplicate-"));
    const manager = createManager();
    const service = new TtsVoiceCloneService({
      store,
      modelProviderManager: manager,
      userDataPath,
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });
    const registryKey = cloneRegistrySettingKey(PROVIDER_ID, MODEL);
    const voices = [
      {
        id: "voice-clone-old",
        name: "Old",
        source: "user_clone",
        createdAt: 1,
        deletionState: "active",
        sampleStorage: { relativeDir: `voice-clone-samples/${ownerHash(owner)}/storage-1`, sampleCount: 1 },
      },
      {
        id: "voice-clone-existing",
        name: "Existing",
        source: "user_clone",
        createdAt: 2,
        deletionState: "active",
        sampleStorage: { relativeDir: `voice-clone-samples/${ownerHash(owner)}/storage-2`, sampleCount: 1 },
      },
    ];
    store.setUserSetting(registryKey, { version: 2, providerId: PROVIDER_ID, model: MODEL, voices }, owner);

    try {
      await expect(service.replaceCloneVoiceId({
        providerId: PROVIDER_ID,
        model: MODEL,
        voiceId: "voice-clone-old",
        replacementVoiceId: "voice-clone-existing",
      })).resolves.toMatchObject({ code: -1, message: "VOICE_CLONE_DUPLICATE_ID" });
      expect(store.getValue(owner, registryKey).voices).toEqual(voices);
    } finally {
      nodeFs.rmSync(userDataPath, { recursive: true, force: true });
    }
  });

  describe("MiMo TTS 克隆样本限制（2026-09-18）", () => {
    const MIMO_PROVIDER = "mimo-tts";
    const MIMO_MODEL = "mimo-v2.5-tts-voiceclone";

    function createMimoService() {
      const store = createOwnerStore();
      const manager = {
        getProvider: vi.fn(() => ({
          id: MIMO_PROVIDER,
          category: "tts",
          models: ["mimo-v2.5-tts", "mimo-v2.5-tts-voiceclone"],
        })),
        callAdapter: vi.fn(async (_providerId, method) => {
          if (method === "cloneVoice")
            return { code: 0, data: { id: "mimo-clone-test-uuid", name: "音色001" } };
          return { code: 0, data: null };
        }),
      };
      const userDataPath = nodeFs.mkdtempSync(path.join(os.tmpdir(), "s2v-mimo-clone-test-"));
      const service = new TtsVoiceCloneService({
        store,
        modelProviderManager: manager,
        userDataPath,
        getVoiceCapability: () => ({
          type: "user_clone",
          canListVoices: true,
          defaultVoiceId: null,
          clone: { enabled: true, entry: "desktop_upload", implementation: "adapter_implemented", messageKey: "tts.voice.clone.desktopUpload" },
        }),
        now: () => 1000,
        createSampleStorageId: () => "storage-mimo-1",
        createSelectionToken: () => "selection-mimo-1",
        probeDuration: async () => 30,
      });
      return { store, manager, service, userDataPath };
    }

    it("getRequirements 返回 MiMo 样本限制（单文件、mp3/wav、≤10MB）", () => {
      const { service } = createMimoService();
      const requirements = service.getRequirements({ providerId: MIMO_PROVIDER, model: MIMO_MODEL });
      expect(requirements).toMatchObject({
        code: 0,
        data: {
          maxSampleCount: 1,
          maxSampleBytes: 10 * 1024 * 1024,
          allowedExtensions: [".mp3", ".wav"],
          sampleLimitScope: "local_safety",
        },
      });
    });

    it("mimo-v2.5-tts（预置音色模型）同样返回克隆样本限制", () => {
      const { service } = createMimoService();
      const requirements = service.getRequirements({ providerId: MIMO_PROVIDER, model: "mimo-v2.5-tts" });
      expect(requirements).toMatchObject({
        code: 0,
        data: {
          maxSampleCount: 1,
          allowedExtensions: [".mp3", ".wav"],
        },
      });
    });

    it("mp3 样本可通过 createSampleSelection（provider 限制在 add 阶段由 _assertPreparedSample 校验）", async () => {
      const { service, userDataPath } = createMimoService();
      const mp3Path = path.join(userDataPath, "voice.mp3");
      nodeFs.writeFileSync(mp3Path, "audio-data");
      try {
        const result = await service.createSampleSelection(
          { providerId: MIMO_PROVIDER, model: MIMO_MODEL },
          [mp3Path],
          SENDER_KEY,
        );
        expect(result).toMatchObject({ code: 0 });
        expect(result.data.samples).toHaveLength(1);
      } finally {
        nodeFs.rmSync(userDataPath, { recursive: true, force: true });
      }
    });
  });
});
