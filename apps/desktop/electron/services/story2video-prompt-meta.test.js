/**
 * generate_assets 透传 optimize 模型元数据（s2v-result-model-info，2026-10-18）
 *
 * 合同锚点：01-docs/PRD-S2V-RESULT-MODEL-INFO-2026-10-18.md §3.1；主 PRD §7.1.39
 *
 * 目标：把 prompt-engine 返回的 model_used 带到 scene.promptOptimizationMeta，
 * 让 Story2VideoProjectService 能落盘 segments[].promptOptimizationMeta，
 * 任务详情页据此展示"本视频的文本模型"。
 *
 * 为什么单独成文件：story2video-stages.test.js 是 max-lines 测试挂账对象
 * （登记 4152 行 / 容差 200），新增 207 行会把它推红。按"按被测模块/场景分文件"
 * 的口径拆出；纯函数部分直接测 story2video-prompt-meta.js，集成部分走真实 executor。
 */
import { describe, it, expect, vi } from "vitest";
import { registerStory2VideoStages, STORY2VIDEO_STAGE_TYPES } from "./story2video-stages.js";
import {
  PROMPT_OPTIMIZATION_META_KEYS,
  pickPromptOptimizationMeta,
  promptOptimizationMetaOf,
  optimizeItemPrompt,
} from "./story2video-prompt-meta.js";

function makeStageExecutor() {
  const executors = new Map();
  return { executors, register(type, fn) { executors.set(type, fn); } };
}

function makeAssetsExecutor() {
  const stageExecutor = makeStageExecutor();
  const pipeline = {
    stageExecutor,
    _assetGenerator: null,
    aiGenerator: null,
    container: undefined,
    governor: undefined,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    registerStageExecutor(type, fn) { stageExecutor.register(type, fn); return { success: true }; },
  };
  registerStory2VideoStages(pipeline);
  return stageExecutor.executors.get(STORY2VIDEO_STAGE_TYPES.GENERATE_ASSETS);
}

/** 无 assetGenerator 的 legacy python 路径：图片/TTS 都走 callPythonSkill。 */
function makePythonBus() {
  const bus = {
    imgSeq: 0,
    ttsSeq: 0,
    callPythonSkill: vi.fn(async (skill) => {
      if (skill === "generate_image") return { code: 0, data: { path: "image-" + (bus.imgSeq++) + ".png" } };
      if (skill === "generate_tts") return { code: 0, data: { path: "audio-" + (bus.ttsSeq++) + ".mp3", duration: 2 } };
      throw new Error("unexpected Python skill: " + skill);
    }),
  };
  return bus;
}

// ── 纯函数：白名单收窄与 fail-open ────────────────────────────────────────
describe("story2video-prompt-meta 白名单收窄", () => {
  it("白名单与 service 侧 safePromptOptimizationMeta 逐字段对齐", () => {
    expect([...PROMPT_OPTIMIZATION_META_KEYS].sort()).toEqual(
      ["cache_hit", "caller", "key_source", "model_used", "platform", "strategy_used", "style"]
    );
  });

  it("只保留白名单字段，字符串 trim、boolean 原样", () => {
    expect(pickPromptOptimizationMeta({
      optimized_prompt: "不该透传的提示词",
      prompt: "原始 prompt",
      index: 0,
      truncated: true,
      optimize_note: "rate_limited_template_fallback",
      degraded: true,
      model_used: "  deepseek-chat  ",
      strategy_used: "llm",
      key_source: "caller",
      cache_hit: false,
      caller: "story2video",
      platform: "generic",
      style: "photography",
    })).toEqual({
      model_used: "deepseek-chat",
      strategy_used: "llm",
      key_source: "caller",
      cache_hit: false,
      caller: "story2video",
      platform: "generic",
      style: "photography",
    });
  });

  it("null / 非对象 / 数组 / 纯字符串一律返回 null", () => {
    expect(pickPromptOptimizationMeta(null)).toBeNull();
    expect(pickPromptOptimizationMeta(undefined)).toBeNull();
    expect(pickPromptOptimizationMeta("string")).toBeNull();
    expect(pickPromptOptimizationMeta(42)).toBeNull();
    expect(pickPromptOptimizationMeta([])).toBeNull();
    expect(pickPromptOptimizationMeta([{ model_used: "x" }])).toBeNull();
  });

  it("白名单字段全为空白/缺失时返回 null（不留空对象）", () => {
    expect(pickPromptOptimizationMeta({ model_used: "   ", strategy_used: "" })).toBeNull();
    expect(pickPromptOptimizationMeta({})).toBeNull();
  });

  it("promptOptimizationMetaOf 越界 / 非数组 / 非法下标均 fail-open", () => {
    const list = [{ model_used: "m0" }];
    expect(promptOptimizationMetaOf(list, 0)).toEqual({ model_used: "m0" });
    expect(promptOptimizationMetaOf(list, 1)).toBeNull();
    expect(promptOptimizationMetaOf(list, -1)).toBeNull();
    expect(promptOptimizationMetaOf(list, 1.5)).toBeNull();
    expect(promptOptimizationMetaOf(null, 0)).toBeNull();
    expect(promptOptimizationMetaOf("not-array", 0)).toBeNull();
  });

  it("template 降级值如实保留", () => {
    expect(pickPromptOptimizationMeta({
      model_used: "template", strategy_used: "template", key_source: "none", tokens_used: 0,
    })).toEqual({ model_used: "template", strategy_used: "template", key_source: "none" });
  });
});

// ── optimizeItemPrompt：null 项防御（两处消费点共用）──────────────────────
describe("optimizeItemPrompt null 项防御", () => {
  it("字符串原样返回", () => {
    expect(optimizeItemPrompt("优化后的提示词")).toBe("优化后的提示词");
  });

  it("按 prompt → optimized_prompt → optimized 取文本", () => {
    expect(optimizeItemPrompt({ prompt: "p" })).toBe("p");
    expect(optimizeItemPrompt({ optimized_prompt: "op" })).toBe("op");
    expect(optimizeItemPrompt({ optimized: "o" })).toBe("o");
    // 同时存在时 prompt 优先（与既有口径一致）
    expect(optimizeItemPrompt({ prompt: "p", optimized_prompt: "op" })).toBe("p");
  });

  it("null / undefined / 数字 / 数组一律返回空串（不抛错）", () => {
    expect(optimizeItemPrompt(null)).toBe("");
    expect(optimizeItemPrompt(undefined)).toBe("");
    expect(optimizeItemPrompt(42)).toBe("");
    expect(optimizeItemPrompt([])).toBe("");
    expect(optimizeItemPrompt([{ prompt: "x" }])).toBe("");
  });

  it("对象但无提示词字段时返回空串", () => {
    expect(optimizeItemPrompt({ index: 0 })).toBe("");
    expect(optimizeItemPrompt({})).toBe("");
  });
});

// ── 集成：generate_assets 把 meta 挂到 scene ──────────────────────────────
describe("generate_assets 透传 promptOptimizationMeta 到 scene", () => {
  it("optimize entry 的 model_used/strategy_used 透传到 scene", async () => {
    const serviceBus = makePythonBus();
    const result = await makeAssetsExecutor()({
      runId: "run-model-meta-1",
      stage: { options: { concurrency: 1 } },
      params: {},
      context: {
        split: [{ text: "第一段" }],
        optimize: [{
          optimized_prompt: "优化后的提示词",
          model_used: "deepseek-chat",
          strategy_used: "llm",
          key_source: "caller",
          cache_hit: false,
          caller: "story2video",
          platform: "generic",
          style: "photography",
        }],
      },
      serviceBus,
    });

    expect(result.success).toBe(true);
    expect(result.output.scenes[0].promptOptimizationMeta).toEqual({
      model_used: "deepseek-chat",
      strategy_used: "llm",
      key_source: "caller",
      cache_hit: false,
      caller: "story2video",
      platform: "generic",
      style: "photography",
    });
  });

  it("optimized_prompt / optimize_note / truncated 等内部状态不透传", async () => {
    const serviceBus = makePythonBus();
    const result = await makeAssetsExecutor()({
      runId: "run-model-meta-2",
      stage: { options: { concurrency: 1 } },
      params: {},
      context: {
        split: [{ text: "第一段" }],
        optimize: [{
          optimized_prompt: "不该透传的提示词",
          prompt: "原始 prompt",
          index: 0,
          truncated: true,
          optimize_note: "rate_limited_template_fallback",
          degraded: true,
          model_used: "deepseek-chat",
          strategy_used: "llm",
        }],
      },
      serviceBus,
    });

    expect(result.success).toBe(true);
    const meta = result.output.scenes[0].promptOptimizationMeta;
    expect(meta).toEqual({ model_used: "deepseek-chat", strategy_used: "llm" });
    for (const key of ["optimized_prompt", "prompt", "truncated", "optimize_note", "degraded", "index"]) {
      expect(meta, key).not.toHaveProperty(key);
    }
  });

  it("optimize 为纯字符串数组（无 meta）时 promptOptimizationMeta 为 null，阶段不失败", async () => {
    const serviceBus = makePythonBus();
    const result = await makeAssetsExecutor()({
      runId: "run-model-meta-3",
      stage: { options: { concurrency: 1 } },
      params: {},
      context: { split: [{ text: "第一段" }], optimize: ["优化后的提示词"] },
      serviceBus,
    });

    expect(result.success).toBe(true);
    expect(result.output.scenes[0].promptOptimizationMeta).toBeNull();
  });

  it("optimize 单项为 null 时 fail-open，不抛错（同函数两处 null 防御的回归锁）", async () => {
    const serviceBus = makePythonBus();
    const result = await makeAssetsExecutor()({
      runId: "run-model-meta-4",
      stage: { options: { concurrency: 1 } },
      params: {},
      context: { split: [{ text: "第一段" }, { text: "第二段" }], optimize: [null, "优化后的提示词"] },
      serviceBus,
    });

    expect(result.success).toBe(true);
    expect(result.output.scenes[0].promptOptimizationMeta).toBeNull();
    expect(result.output.scenes[1].promptOptimizationMeta).toBeNull();
    // 既有契约：null 项不得让 optimizedPrompts 映射崩溃
    expect(result.output.optimizedPrompts[0].prompt).toBe("");
    expect(result.output.optimizedPrompts[1].prompt).toBe("优化后的提示词");
  });

  it("strategy_used=template（限流降级）时如实透传 model_used=template", async () => {
    const serviceBus = makePythonBus();
    const result = await makeAssetsExecutor()({
      runId: "run-model-meta-5",
      stage: { options: { concurrency: 1 } },
      params: {},
      context: {
        split: [{ text: "第一段" }],
        optimize: [{
          optimized_prompt: "模板提示词",
          model_used: "template",
          strategy_used: "template",
          key_source: "none",
          tokens_used: 0,
        }],
      },
      serviceBus,
    });

    expect(result.success).toBe(true);
    expect(result.output.scenes[0].promptOptimizationMeta).toMatchObject({
      model_used: "template",
      strategy_used: "template",
      key_source: "none",
    });
    expect(result.output.scenes[0].promptOptimizationMeta).not.toHaveProperty("tokens_used");
  });

  it("{ results } 包装的 optimize 响应同样取到第 i 项 meta", async () => {
    const serviceBus = makePythonBus();
    const result = await makeAssetsExecutor()({
      runId: "run-model-meta-6",
      stage: { options: { concurrency: 1 } },
      params: {},
      context: {
        split: [{ text: "第一段" }],
        optimize: { results: [{ optimized_prompt: "优化后的提示词", model_used: "wrapped-model" }] },
      },
      serviceBus,
    });

    expect(result.success).toBe(true);
    expect(result.output.scenes[0].promptOptimizationMeta).toEqual({ model_used: "wrapped-model" });
  });

  it("多场景时逐场景各取自己的 meta", async () => {
    const serviceBus = makePythonBus();
    const result = await makeAssetsExecutor()({
      runId: "run-model-meta-7",
      stage: { options: { concurrency: 1 } },
      params: {},
      context: {
        split: [{ text: "第一段" }, { text: "第二段" }, { text: "第三段" }],
        optimize: [
          { optimized_prompt: "p0", model_used: "model-a" },
          { optimized_prompt: "p1", model_used: "model-b" },
          { optimized_prompt: "p2", model_used: "template", strategy_used: "template" },
        ],
      },
      serviceBus,
    });

    expect(result.success).toBe(true);
    expect(result.output.scenes.map(s => s.promptOptimizationMeta?.model_used)).toEqual([
      "model-a", "model-b", "template",
    ]);
  });
});
