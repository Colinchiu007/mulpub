import { describe, expect, it, vi } from "vitest";
import path from "node:path";

import registerTtsVoiceCloneHandlers from "./tts-voice-clone";

function createIpcMain() {
  const handlers = new Map();
  return {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    handlers,
  };
}

function validEvent(senderId = 1) {
  return {
    sender: { id: senderId },
    senderFrame: { url: "app://localhost/" },
  };
}

function trustedEventWithoutSenderId() {
  return { senderFrame: { url: "app://localhost/" } };
}

describe("TTS 音色克隆 IPC", () => {
  it("注册固定克隆通道，样本只通过主进程 dialog 转为一次性令牌", async () => {
    const ipcMain = createIpcMain();
    const samplePath = path.resolve("samples", "voice.wav");
    const dialog = {
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [samplePath] })),
    };
    const ttsVoiceCloneService = {
      getRequirements: vi.fn(() => ({
        code: 0,
        data: { allowedExtensions: [".wav"], maxSampleCount: 5 },
      })),
      listClones: vi.fn(async (input) => ({ code: 0, data: input })),
      createSampleSelection: vi.fn((_input, paths, senderKey) => ({
        code: 0,
        data: {
          selectionId: "selection-a",
          samples: paths.map(() => ({ name: "sample-01.wav", contentType: "audio/wav" })),
        },
      })),
      addCloneFromSelection: vi.fn(async (input, senderKey) => ({
        code: 0,
        data: { ...input, senderKey },
      })),
      deleteClone: vi.fn(async (input) => ({ code: 0, data: input })),
      renameClone: vi.fn(async (input) => ({ code: 0, data: input })),
    };

    registerTtsVoiceCloneHandlers(ipcMain, { ttsVoiceCloneService, dialog });

    expect([...ipcMain.handlers.keys()]).toEqual([
      "tts-voice-clone:requirements",
      "tts-voice-clone:choose-samples",
      "tts-voice-clone:list",
      "tts-voice-clone:add",
      "tts-voice-clone:delete",
      "tts-voice-clone:rename",
      "tts-voice-clone:editParams",
    ]);
    await expect(
      ipcMain.handlers.get("tts-voice-clone:requirements")(validEvent(), {
        providerId: "elevenlabs",
        model: "eleven_multilingual_v2",
      }),
    ).resolves.toMatchObject({ code: 0, data: { maxSampleCount: 5 } });
    await expect(
      ipcMain.handlers.get("tts-voice-clone:choose-samples")(validEvent(), {
        providerId: "elevenlabs",
        model: "eleven_multilingual_v2",
      }),
    ).resolves.toEqual({
      code: 0,
      data: {
        selectionId: "selection-a",
        samples: [{ name: "sample-01.wav", contentType: "audio/wav" }],
      },
    });
    expect(ttsVoiceCloneService.getRequirements).toHaveBeenCalledWith({
      providerId: "elevenlabs",
      model: "eleven_multilingual_v2",
    });
    await expect(
      ipcMain.handlers.get("tts-voice-clone:rename")(validEvent(), {
        providerId: "elevenlabs",
        model: "eleven_multilingual_v2",
        voiceId: "voice-a",
        name: "我的音色",
      }),
    ).resolves.toMatchObject({ code: 0 });
    expect(ttsVoiceCloneService.renameClone).toHaveBeenCalledWith({
      providerId: "elevenlabs",
      model: "eleven_multilingual_v2",
      voiceId: "voice-a",
      name: "我的音色",
    });
    expect(ttsVoiceCloneService.createSampleSelection).toHaveBeenCalledWith(
      {
        providerId: "elevenlabs",
        model: "eleven_multilingual_v2",
      },
      [samplePath],
      "webcontents:1",
    );
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Audio samples", extensions: ["wav"] }],
      }),
    );
  });

  it("拒绝 renderer 额外传入的路径、Buffer、base64、Blob 或音频字节，且不调用服务或 dialog", async () => {
    const ipcMain = createIpcMain();
    const dialog = { showOpenDialog: vi.fn() };
    const ttsVoiceCloneService = {
      getRequirements: vi.fn(),
      listClones: vi.fn(),
      createSampleSelection: vi.fn(),
      addCloneFromSelection: vi.fn(),
      deleteClone: vi.fn(),
      renameClone: vi.fn(),
    };
    registerTtsVoiceCloneHandlers(ipcMain, { ttsVoiceCloneService, dialog });
    const base = { providerId: "elevenlabs", model: "eleven_multilingual_v2" };

    await expect(
      ipcMain.handlers.get("tts-voice-clone:requirements")(validEvent(), {
        ...base,
        base64: "RIFF",
      }),
    ).resolves.toMatchObject({ code: -2, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      ipcMain.handlers.get("tts-voice-clone:choose-samples")(validEvent(), {
        ...base,
        audio: new Uint8Array([1, 2, 3]),
      }),
    ).resolves.toMatchObject({ code: -2, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      ipcMain.handlers.get("tts-voice-clone:add")(validEvent(), {
        ...base,
        name: "Voice",
        selectionId: "selection-a",
      }),
    ).resolves.toMatchObject({ code: -2, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      ipcMain.handlers.get("tts-voice-clone:add")(validEvent(), {
        ...base,
        name: "Voice",
        selectionId: "selection-a",
        consent: false,
      }),
    ).resolves.toMatchObject({ code: -2, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      ipcMain.handlers.get("tts-voice-clone:add")(validEvent(), {
        ...base,
        name: "Voice",
        selectionId: "selection-a",
        consent: "true",
      }),
    ).resolves.toMatchObject({ code: -2, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      ipcMain.handlers.get("tts-voice-clone:add")(validEvent(), {
        ...base,
        name: "Voice",
        selectionId: "selection-a",
        consent: true,
        paths: [path.resolve("sample.wav")],
        buffer: Buffer.from("audio"),
        blob: new Blob(["audio"]),
      }),
    ).resolves.toMatchObject({ code: -2, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      ipcMain.handlers.get("tts-voice-clone:delete")(validEvent(), {
        ...base,
        voiceId: "voice-a",
        samples: [{ bytes: "audio" }],
      }),
    ).resolves.toMatchObject({ code: -2, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      ipcMain.handlers.get("tts-voice-clone:rename")(validEvent(), {
        ...base,
        voiceId: "voice-a",
        name: "",
      }),
    ).resolves.toMatchObject({ code: -2, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      ipcMain.handlers.get("tts-voice-clone:rename")(validEvent(), {
        ...base,
        voiceId: "voice-a",
        name: "Voice",
        extra: true,
      }),
    ).resolves.toMatchObject({ code: -2, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    await expect(
      ipcMain.handlers.get("tts-voice-clone:rename")(validEvent(), {
        ...base,
        name: "Voice",
      }),
    ).resolves.toMatchObject({ code: -2, message: "VOICE_CLONE_INVALID_ARGUMENTS" });

    expect(ttsVoiceCloneService.getRequirements).not.toHaveBeenCalled();
    expect(ttsVoiceCloneService.createSampleSelection).not.toHaveBeenCalled();
    expect(ttsVoiceCloneService.addCloneFromSelection).not.toHaveBeenCalled();
    expect(ttsVoiceCloneService.deleteClone).not.toHaveBeenCalled();
    expect(ttsVoiceCloneService.renameClone).not.toHaveBeenCalled();
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
  });

  it("仅把同一受信 WebContents 的一次性选择令牌交给克隆服务", async () => {
    const ipcMain = createIpcMain();
    const ttsVoiceCloneService = {
      getRequirements: vi.fn(),
      listClones: vi.fn(),
      createSampleSelection: vi.fn(),
      addCloneFromSelection: vi.fn(async (input, senderKey) => ({
        code: 0,
        data: { input, senderKey },
      })),
      deleteClone: vi.fn(),
    };
    registerTtsVoiceCloneHandlers(ipcMain, {
      ttsVoiceCloneService,
      dialog: { showOpenDialog: vi.fn() },
    });

    const addRequest = {
      providerId: "elevenlabs",
      model: "eleven_multilingual_v2",
      name: "Voice",
      selectionId: "selection-a",
      consent: true,
    };
    await expect(
      ipcMain.handlers.get("tts-voice-clone:add")(validEvent(9), addRequest),
    ).resolves.toMatchObject({ code: 0 });

    expect(ttsVoiceCloneService.addCloneFromSelection).toHaveBeenCalledWith(
      {
        providerId: "elevenlabs",
        model: "eleven_multilingual_v2",
        name: "Voice",
        selectionId: "selection-a",
        consent: true,
      },
      "webcontents:9",
    );
    expect(ttsVoiceCloneService.addCloneFromSelection.mock.calls[0][0]).not.toBe(addRequest);
  });

  it("缺失 WebContents 身份时 fail closed，不交给克隆服务", async () => {
    const ipcMain = createIpcMain();
    const ttsVoiceCloneService = {
      getRequirements: vi.fn(),
      listClones: vi.fn(),
      createSampleSelection: vi.fn(),
      addCloneFromSelection: vi.fn(),
      deleteClone: vi.fn(),
    };
    registerTtsVoiceCloneHandlers(ipcMain, {
      ttsVoiceCloneService,
      dialog: { showOpenDialog: vi.fn() },
    });

    await expect(
      ipcMain.handlers.get("tts-voice-clone:add")(trustedEventWithoutSenderId(), {
        providerId: "elevenlabs",
        model: "eleven_multilingual_v2",
        name: "Voice",
        selectionId: "selection-a",
        consent: true,
      }),
    ).resolves.toMatchObject({ code: -2, message: "VOICE_CLONE_INVALID_ARGUMENTS" });
    expect(ttsVoiceCloneService.addCloneFromSelection).not.toHaveBeenCalled();
  });

  // ── change: hifly-voice-edit-ui：修改克隆音色参数（语速/音量/语调）──────
  describe("editCloneParams", () => {
    function setup(serviceOverrides) {
      const ipcMain = createIpcMain();
      const ttsVoiceCloneService = {
        getRequirements: vi.fn(() => ({ code: 0, data: {} })),
        listClones: vi.fn(async () => ({ code: 0, data: { voices: [] } })),
        createSampleSelection: vi.fn(() => ({ code: 0, data: {} })),
        addCloneFromSelection: vi.fn(async () => ({ code: 0, data: {} })),
        deleteClone: vi.fn(async () => ({ code: 0, data: {} })),
        renameClone: vi.fn(async () => ({ code: 0, data: {} })),
        editCloneParams: vi.fn(async () => ({ code: 0, data: { voice: { id: "v-1" } } })),
        ...serviceOverrides,
      };
      registerTtsVoiceCloneHandlers(ipcMain, { ttsVoiceCloneService, dialog: { showOpenDialog: vi.fn() } });
      return { ipcMain, ttsVoiceCloneService };
    }

    it("通道 tts-voice-clone:editParams 已注册", () => {
      const { ipcMain } = setup({});
      expect([...ipcMain.handlers.keys()]).toContain("tts-voice-clone:editParams");
    });

    it("providerId/model/voiceId 与三个参数一路带到 service", async () => {
      const { ipcMain } = setup({});
      const code = await ipcMain.handlers.get("tts-voice-clone:editParams")(validEvent(), {
        providerId: "hifly",
        model: "hifly-video",
        voiceId: "v-1",
        rate: "1.2",
        volume: "1.0",
        pitch: "0.9",
      });
      expect(code.code).toBe(0);
      expect(code.data.voice.id).toBe("v-1");
    });

    it("参数为数字时整请求被拒（官方要字符串）", async () => {
      const { ipcMain, ttsVoiceCloneService } = setup({});
      const res = await ipcMain.handlers.get("tts-voice-clone:editParams")(validEvent(), {
        providerId: "hifly",
        model: "hifly-video",
        voiceId: "v-1",
        rate: 1.2,
      });
      expect(res.code).not.toBe(0);
      expect(ttsVoiceCloneService.editCloneParams).not.toHaveBeenCalled();
    });

    it("三个参数一个都不给时被拒（调用方至少改一项）", async () => {
      const { ipcMain, ttsVoiceCloneService } = setup({});
      const res = await ipcMain.handlers.get("tts-voice-clone:editParams")(validEvent(), {
        providerId: "hifly",
        model: "hifly-video",
        voiceId: "v-1",
      });
      expect(res.code).not.toBe(0);
      expect(ttsVoiceCloneService.editCloneParams).not.toHaveBeenCalled();
    });

    it("缺 providerId / model / voiceId 时被拒", async () => {
      const { ipcMain, ttsVoiceCloneService } = setup({});
      const res = await ipcMain.handlers.get("tts-voice-clone:editParams")(validEvent(), {
        rate: "1.0",
      });
      expect(res.code).not.toBe(0);
      expect(ttsVoiceCloneService.editCloneParams).not.toHaveBeenCalled();
    });
    // 注：owner 校验不在 IPC 层（withSenderCheck 只看 senderFrame.url），
    // 而在 service 的 _captureOwner()。缺 sender.id 的场景由 service 层
    // 用例覆盖（VOICE_OWNER_UNAVAILABLE），这里不重复测。
  });

});
