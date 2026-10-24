import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * editCloneParams 的独立测试文件（change: hifly-voice-edit-ui）。
 *
 * 为什么单独一个文件：`tts-voice-clone-service.test.js` 已 1846 行，
 * `check-debt-budget.js` 的 TEST_LEDGER 对测试文件也有膨胀容差（200 行），
 * 把 7 个新用例塞进去当场红（实测膨胀 224 行）。
 * 拆分口径按「被测方法与场景」——本文件只覆盖「修改克隆音色参数」这一条链路。
 */

const catalogMocks = vi.hoisted(() => ({
  getVoiceCapability: vi.fn(),
}));

vi.mock("./tts-voice-catalog", () => ({
  CAPABILITY_TYPES: { USER_CLONE: "user_clone" },
  getVoiceCapability: catalogMocks.getVoiceCapability,
}));

import { TtsVoiceCloneService } from "./tts-voice-clone-service";

function createOwnerStore(initialOwner = "user-edit") {
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

const PROVIDER_ID = "hifly";
const MODEL = "hifly-video";
const SENDER_KEY = "webcontents:1";

describe("editCloneParams — 修改克隆音色参数（change: hifly-voice-edit-ui）", () => {
  // 与 renameClone 的差异：rename 只改本地名，本方法要把参数下到服务商。
  // 官方飞影 POST /voice/edit：rate 0.5-2.0 / volume 0.1-2.0 / pitch 0.1-2.0，
  // 三者都是**字符串**（真实 Token 侧证：传数字会被「参数格式不正确」拒绝）。
  let store;
  let sandbox;
  let userData;

  beforeEach(() => {
    store = createOwnerStore();
    sandbox = nodeFs.mkdtempSync(path.join(os.tmpdir(), "edit-clone-params-test-"));
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
      randomUUID: () => "clone-stage-edit",
      createSelectionToken: () => "selection-edit",
      probeDuration: vi.fn(async () => 12.5),
      getVoiceCapability: catalogMocks.getVoiceCapability,
    });
  }

  // 直接写 registry 造一条「已克隆音色」：本 describe 只验证改参数这一层，
  // 不关心素材怎么上传（那条路由由 addCloneFromSelection 的用例覆盖）。
  function seedClone(voiceId, extra = {}) {
    store.setUserSetting(
      `tts-voice-clones:v2:${PROVIDER_ID}:${MODEL}`,
      {
        version: 2,
        providerId: PROVIDER_ID,
        model: MODEL,
        voices: [
          {
            id: voiceId,
            name: "克隆音色",
            source: "user_clone",
            createdAt: Date.now(),
            deletionState: "active",
            ...extra,
          },
        ],
      },
      "user-edit",
    );
  }

  function createManager(overrides = {}) {
    const editVoice = overrides.editVoice;
    const callAdapter = vi.fn(async (_providerId, method) =>
      method === "editVoice" && editVoice ? editVoice() : { code: 0 },
    );
    return {
      callAdapter,
      getProvider: () => ({ id: PROVIDER_ID, category: "tts", models: [MODEL] }),
      supportsAdapterMethod:
        overrides.supportsAdapterMethod || (async () => true),
    };
  }

  it("参数以字符串透传给 adapter.editVoice", async () => {
    const editVoice = vi.fn(async () => ({ code: 0 }));
    const manager = createManager({ editVoice });
    const service = createService(manager);
    seedClone("v-1");

    const res = await service.editCloneParams({
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "v-1",
      rate: "1.2",
      volume: "1.0",
      pitch: "0.9",
    });

    expect(res.code).toBe(0);
    expect(manager.callAdapter).toHaveBeenCalledWith(
      PROVIDER_ID,
      "editVoice",
      expect.objectContaining({
        voice: "v-1",
        rate: "1.2",
        volume: "1.0",
        pitch: "0.9",
      }),
    );
    // 参数要回显（registry 已持久化）
    expect(res.data.voice.params).toEqual({
      rate: "1.2",
      volume: "1.0",
      pitch: "0.9",
    });
  });

  // 本地也要拦一道：adapter 已有校验，但 service 拦能在不进 IPC 的情况下
  // 给出可读错误，且避免为非法参数打一次远端往返。
  it("rate 越界时拒绝且不调 adapter", async () => {
    const manager = createManager({});
    const service = createService(manager);
    seedClone("v-1");

    const res = await service.editCloneParams({
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "v-1",
      rate: "0.4",
    });

    expect(res.code).toBe(-1);
    expect(res.message).toBe("VOICE_CLONE_INVALID_ARGUMENTS");
    expect(manager.callAdapter).not.toHaveBeenCalled();
  });

  it("参数为数字时拒绝（官方要字符串）且不调 adapter", async () => {
    const manager = createManager({});
    const service = createService(manager);
    seedClone("v-1");

    const res = await service.editCloneParams({
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "v-1",
      rate: 1.2,
    });

    expect(res.code).toBe(-1);
    expect(manager.callAdapter).not.toHaveBeenCalled();
  });

  it("三个参数一个都不给时拒绝（调用方至少改一项）", async () => {
    const manager = createManager({});
    const service = createService(manager);
    seedClone("v-1");

    const res = await service.editCloneParams({
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "v-1",
    });

    expect(res.code).toBe(-1);
    expect(manager.callAdapter).not.toHaveBeenCalled();
  });

  // 只对「自己克隆的音色」可编辑（真实 Token 侧证：公共音色服务端拒）。
  it("voiceId 不在本地 registry 时拒绝且不调 adapter", async () => {
    const manager = createManager({});
    const service = createService(manager);

    const res = await service.editCloneParams({
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "not-mine",
      rate: "1.0",
    });

    expect(res.code).toBe(-1);
    expect(res.message).toBe("VOICE_CLONE_NOT_FOUND");
    expect(manager.callAdapter).not.toHaveBeenCalled();
  });

  // adapter 不支持 editVoice（如 ElevenLabs 无此端点）⇒ fail-closed。
  it("adapter 不支持 editVoice 时返回 UNSUPPORTED", async () => {
    const manager = createManager({ supportsAdapterMethod: async () => false });
    const service = createService(manager);
    seedClone("v-1");

    const res = await service.editCloneParams({
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "v-1",
      rate: "1.0",
    });

    expect(res.code).toBe(-1);
    expect(res.message).toBe("VOICE_CLONE_UNSUPPORTED");
  });

  // adapter 返回业务错误时原文透出（如飞影「Voice不正确」「声音编辑失败」）。
  it("adapter 业务失败时透出服务端 message", async () => {
    const manager = createManager({
      editVoice: async () => ({ code: 11, message: "声音编辑失败" }),
    });
    const service = createService(manager);
    seedClone("v-1");

    const res = await service.editCloneParams({
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "v-1",
      rate: "1.0",
    });

    expect(res.code).toBe(-1);
    expect(res.message).toContain("声音编辑失败");
  });

  // 只改一项时，其余参数保留（合并而非覆盖）。
  it("只改一项时其余参数保留", async () => {
    const manager = createManager({});
    const service = createService(manager);
    seedClone("v-1", { params: { rate: "1.2", volume: "1.0" } });

    const res = await service.editCloneParams({
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "v-1",
      pitch: "0.8",
    });

    expect(res.code).toBe(0);
    expect(res.data.voice.params).toEqual({
      rate: "1.2",
      volume: "1.0",
      pitch: "0.8",
    });
  });

  it("registry 里是脏参数时整条音色被判非法（isSafeCloneVoice 守住持久化面）", async () => {
    // 这条锁的是「参数写坏了会让音色消失」这个风险：
    // isSafeCloneVoice 对 params 有独立校验，脏数据 ⇒ 整条记录不合法 ⇒ 读不出。
    const manager = createManager({});
    const service = createService(manager);
    seedClone("v-1", { params: { rate: "9.9" } });

    const res = await service.editCloneParams({
      providerId: PROVIDER_ID,
      model: MODEL,
      voiceId: "v-1",
      rate: "1.0",
    });

    expect(res.code).toBe(-1);
    expect(manager.callAdapter).not.toHaveBeenCalled();
  });
});
