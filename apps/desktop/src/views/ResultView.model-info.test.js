import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import zh from "@/locales/zh";
import en from "@/locales/en";
import UiButton from "@/components/UiButton.vue";
import ResultView from "./ResultView.vue";
import { resolveModelSummaryParts, resolveModelSummaryText, VIDEO_ENABLED_MODES } from "./video-creation/composables/useResultModelInfo";

vi.mock("@/api/publisher", () => ({
  story2videoExportZip: vi.fn(),
  story2videoCreateShareUrl: vi.fn(),
  story2videoCopyPath: vi.fn(),
  story2videoShowInFolder: vi.fn(),
  story2videoSaveAs: vi.fn(),
  story2videoGetProject: vi.fn(),
  story2videoImportMedia: vi.fn(),
  story2videoUpdateSegments: vi.fn(),
  story2videoReplaceSegmentAudio: vi.fn(),
  story2videoRetrySegment: vi.fn(),
  story2videoRecomposeProject: vi.fn(),
  story2videoSelectSceneMaterial: vi.fn(),
  story2videoGenerateSceneImage: vi.fn(),
  story2videoGenerateSceneVideo: vi.fn(),
  story2videoGenerateSceneAiVideo: vi.fn(),
  story2videoRegenerateSceneSubtitle: vi.fn(),
  story2videoRegenerateSceneAudio: vi.fn(),
  story2videoRegenerateScenePrompt: vi.fn(),
  pipelineGetRunContext: vi.fn(),
  pipelinePauseRun: vi.fn(),
  videoProcess: vi.fn(),
}));

vi.mock("@/api/tts-voice-catalog", () => ({
  getTtsVoiceCatalog: vi.fn(),
}));

const router = createRouter({ history: createWebHistory(), routes: [
  { path: "/", component: { template: "<div>root</div>" } },
  { path: "/create", name: "create", component: { template: "<div>create</div>" } },
  { path: "/create/result", name: "create-result", component: { template: "<div>result</div>" } },
  { path: "/publish", name: "publish", component: { template: "<div>publish</div>" } },
] });

// 视频信息区模型信息（s2v-result-model-info，2026-10-18）
// 合同锚点：01-docs/PRD-S2V-RESULT-MODEL-INFO-2026-10-18.md §3.2 / §4；主 PRD §7.1.39
//
// 为什么单独成文件：ResultView.test.js 是 max-lines 测试挂账对象（登记 2175 行 / 容差 200），
// 新增 245 行会把两个测试文件同时推红。按"按被测模块/场景分文件"的口径拆出，
// 逻辑主体改成对纯函数模块 useResultModelInfo.js 的直接断言（不需要 mount），
// 只保留少量 DOM 级用例钉"格式 + 模型在同一行 / 空态不渲染"这两个形状契约。
describe("ResultView 模型信息（s2v-result-model-info）", () => {
  const SEP = " · ";
  // 与 locale 同步的标签断言：若 zh 文案变了，这里会红，提示同步核对 en
  const L = {
    textModel: "文本模型",
    voiceModel: "语音模型",
    imageModel: "图片模型",
    videoModel: "视频模型",
  };
  const label = (key) => L[key];

  beforeEach(async () => {
    await router.push("/");
  });

  // ── 纯函数级：取值口径 / 门控 / 优先级 / 回退 ──────────────────────────────
  describe("resolveModelSummaryText 取值口径", () => {
    const FULL_PROJECT = {
      projectId: "p-full",
      options: {
        videoMode: "ai-judged",
        voiceProvider: "minimax-tts",
        voiceModel: "speech-02-hd",
        imageProvider: "minimax-image",
        imageModel: "MiniMax Image",
        videoProvider: "minimax-video",
        videoModel: "MiniMax Hailuo",
      },
      segments: [
        {
          id: "s0",
          promptOptimizationMeta: { strategy_used: "llm", model_used: "deepseek" },
          imageMeta: { provider: "minimax-image", model: "MiniMax Image" },
          audioMeta: { provider: "minimax-tts", model: "speech-02-hd" },
          videoMeta: { provider: "minimax-video", model: "MiniMax Hailuo" },
        },
      ],
    };

    it("四项齐备时按固定顺序拼装", () => {
      expect(resolveModelSummaryText(FULL_PROJECT, FULL_PROJECT.segments, label)).toBe(
        "文本模型: deepseek" + SEP + "语音模型: speech-02-hd" + SEP +
        "图片模型: MiniMax Image" + SEP + "视频模型: MiniMax Hailuo"
      );
    });

    it("videoMode=off 时不渲染视频模型项", () => {
      const project = { ...FULL_PROJECT, options: { ...FULL_PROJECT.options, videoMode: "off" } };
      const text = resolveModelSummaryText(project, project.segments, label);
      expect(text).not.toContain("视频模型");
      expect(text).toContain("图片模型: MiniMax Image");
    });

    it("videoMode 缺省时不渲染视频模型项", () => {
      const options = { ...FULL_PROJECT.options };
      delete options.videoMode;
      expect(resolveModelSummaryText({ ...FULL_PROJECT, options }, FULL_PROJECT.segments, label))
        .not.toContain("视频模型");
    });

    it("videoMode=fixed 时渲染视频模型项", () => {
      const project = { ...FULL_PROJECT, options: { ...FULL_PROJECT.options, videoMode: "fixed" } };
      expect(resolveModelSummaryText(project, project.segments, label)).toContain("视频模型: MiniMax Hailuo");
    });

    it("videoMode 大写/带空白同样归一为启用", () => {
      const project = { ...FULL_PROJECT, options: { ...FULL_PROJECT.options, videoMode: "  AI-Judged " } };
      expect(resolveModelSummaryText(project, project.segments, label)).toContain("视频模型: MiniMax Hailuo");
    });

    it("videoMode 启用但 provider/model 均为空时不渲染（不留空壳）", () => {
      const options = { ...FULL_PROJECT.options, videoMode: "ai-judged" };
      delete options.videoProvider;
      delete options.videoModel;
      const text = resolveModelSummaryText({ ...FULL_PROJECT, options }, [], label);
      expect(text).not.toContain("视频模型");
      expect(text).not.toMatch(/视频模型\s*:/);
    });
    it("无 promptOptimizationMeta 时不渲染文本模型项", () => {
      const segments = [{ id: "s0", imageMeta: { model: "MiniMax Image" }, audioMeta: { model: "speech-02-hd" } }];
      const text = resolveModelSummaryText(FULL_PROJECT, segments, label);
      expect(text).not.toContain("文本模型");
      expect(text).toContain("语音模型: speech-02-hd");
    });

    it("segments 的 model 优先于 options 的 model（展示实际执行的模型）", () => {
      const project = { ...FULL_PROJECT, options: { ...FULL_PROJECT.options, imageModel: "opt-image-model" } };
      const segments = [{ id: "s0", imageMeta: { model: "seg-image-model" } }];
      const text = resolveModelSummaryText(project, segments, label);
      expect(text).toContain("图片模型: seg-image-model");
      expect(text).not.toContain("opt-image-model");
    });

    it("segments 的 provider 优先于 options 的 model", () => {
      const project = { options: { imageModel: "opt-image-model" }, segments: [{ id: "s0", imageMeta: { provider: "seg-image-provider" } }] };
      expect(resolveModelSummaryText(project, project.segments, label)).toContain("图片模型: seg-image-provider");
    });

    it("model 缺失时回退到 provider", () => {
      const project = { options: { imageProvider: "agnes-image", voiceProvider: "edge-tts" }, segments: [{ id: "s0" }] };
      const text = resolveModelSummaryText(project, project.segments, label);
      expect(text).toContain("图片模型: agnes-image");
      expect(text).toContain("语音模型: edge-tts");
    });

    it("逐段扫描取首个非空：第一段空、第二段有值", () => {
      const segments = [
        { id: "s0", imageMeta: { model: "  " } },
        { id: "s1", imageMeta: { model: "second-image" } },
      ];
      expect(resolveModelSummaryText({ options: {}, segments }, segments, label)).toContain("图片模型: second-image");
    });

    it("model_used 为 template（限流降级）时如实呈现", () => {
      const segments = [{ id: "s0", promptOptimizationMeta: { strategy_used: "template", model_used: "template" } }];
      expect(resolveModelSummaryText({ options: {}, segments }, segments, label)).toContain("文本模型: template");
    });

    it("纯文件预览模式（project 为 null）返回空", () => {
      expect(resolveModelSummaryText(null, [], label)).toBe("");
      expect(resolveModelSummaryParts(null, [], label)).toEqual([]);
    });

    it("四项全空时返回空串", () => {
      expect(resolveModelSummaryText({ options: {}, segments: [] }, [], label)).toBe("");
    });

    it("segments 非数组时不崩溃，options 的值仍生效（按 [] 处理）", () => {
      // PRD §4.1：segments 非数组时按空数组处理——不是把 options 也一并作废
      expect(resolveModelSummaryText({ options: { imageModel: "x" } }, null, label)).toBe("图片模型: x");
      expect(resolveModelSummaryText({ options: { imageModel: "x" } }, undefined, label)).toBe("图片模型: x");
      expect(resolveModelSummaryText({ options: { imageModel: "x" } }, "not-array", label)).toBe("图片模型: x");
    });

    it("segments 非数组且无 options 时不崩溃且摘要为空", () => {
      expect(resolveModelSummaryText({ options: {}, segments: null }, null, label)).toBe("");
    });

    it("project.options 非对象时不崩溃且摘要为空", () => {
      expect(resolveModelSummaryText({ options: "not-an-object", segments: [] }, [], label)).toBe("");
    });

    it("segments 含非对象项时安全跳过", () => {
      const segments = [null, "str", 42, { id: "s3", imageMeta: { model: "ok-image" } }];
      expect(resolveModelSummaryText({ options: {}, segments }, segments, label)).toBe("图片模型: ok-image");
    });

    it("摘要不含连续分隔符、不以分隔符开头或结尾、无空标签", () => {
      const text = resolveModelSummaryText(FULL_PROJECT, FULL_PROJECT.segments, label);
      expect(text).not.toMatch(/·\s*·/);
      expect(text.startsWith("·")).toBe(false);
      expect(text.endsWith("·")).toBe(false);
      expect(text).not.toMatch(/:\s*·/);
      expect(text).not.toMatch(/:\s*$/);
    });

    it("VIDEO_ENABLED_MODES 只含 fixed 与 ai-judged", () => {
      expect([...VIDEO_ENABLED_MODES].sort()).toEqual(["ai-judged", "fixed"]);
    });
  });

  // ── 回归锁：视频配置的真实落点不是 options，是 story2videoTextConfig.config.video ──
  //
  // 缺陷根因（change: s2v-video-model-source）：story2video-project-service.js 的
  // `_safeOptions` 白名单（keys 数组）**不含任何 video 字段**，所以持久化清单里
  // `project.options` 永远没有 videoMode / videoProvider / videoModel；真实落盘点是
  // `normalizeStory2VideoTextParams` 产出的 `story2videoTextConfig.config.video`
  // （{ mode, provider, model, ... }，见 story2video-text-config.js）。
  // 首版只读 options ⇒ 视频模型项在生产环境**恒不显示**；上方那批用例之所以全绿，
  // 是因为夹具把 videoMode 塞进了 options（虚构位置），绕过了真实数据路径。
  describe("视频模型：真实落盘字段（story2videoTextConfig.config.video）", () => {
    const REAL_PROJECT = {
      projectId: "p-real",
      // 真实形状：options 里没有任何 video 字段
      options: {
        voiceProvider: "minimax-tts",
        voiceModel: "speech-02-hd",
        imageProvider: "minimax-image",
        imageModel: "MiniMax Image",
      },
      story2videoTextConfig: {
        version: 1,
        config: {
          video: { mode: "fixed", provider: "minimax-video", model: "MiniMax Hailuo" },
        },
      },
      segments: [
        {
          id: "s0",
          promptOptimizationMeta: { model_used: "deepseek" },
          imageMeta: { provider: "minimax-image", model: "MiniMax Image" },
          audioMeta: { provider: "minimax-tts", model: "speech-02-hd" },
        },
      ],
    };

    it("mode 取自 config.video.mode 时渲染视频模型项（缺陷主锁）", () => {
      const text = resolveModelSummaryText(REAL_PROJECT, REAL_PROJECT.segments, label);
      expect(text).toContain("视频模型: MiniMax Hailuo");
      // 其余三项不受影响，确认不是「整行变宽」掩盖了问题
      expect(text).toContain("文本模型: deepseek");
      expect(text).toContain("图片模型: MiniMax Image");
    });

    it("config.video.mode=off 时不渲染视频模型项", () => {
      const project = {
        ...REAL_PROJECT,
        story2videoTextConfig: {
          version: 1,
          config: { video: { ...REAL_PROJECT.story2videoTextConfig.config.video, mode: "off" } },
        },
      };
      expect(resolveModelSummaryText(project, project.segments, label)).not.toContain("视频模型");
    });

    it("config.video.mode 缺省时不渲染视频模型项", () => {
      const project = {
        ...REAL_PROJECT,
        story2videoTextConfig: { version: 1, config: { video: { provider: "minimax-video", model: "MiniMax Hailuo" } } },
      };
      expect(resolveModelSummaryText(project, project.segments, label)).not.toContain("视频模型");
    });

    it("model 取自 config.video.model（segments 无 videoMeta 时）", () => {
      const project = {
        ...REAL_PROJECT,
        story2videoTextConfig: {
          version: 1,
          config: { video: { mode: "ai-judged", provider: "minimax-video", model: "Hailuo-Pro" } },
        },
      };
      expect(resolveModelSummaryText(project, project.segments, label)).toContain("视频模型: Hailuo-Pro");
    });

    it("model 缺失时回退 config.video.provider", () => {
      const project = {
        ...REAL_PROJECT,
        story2videoTextConfig: {
          version: 1,
          config: { video: { mode: "fixed", provider: "minimax-video", model: "" } },
        },
      };
      expect(resolveModelSummaryText(project, project.segments, label)).toContain("视频模型: minimax-video");
    });

    it("segments[].videoMeta.model 优先于 config.video.model（实际执行 > 配置）", () => {
      const segments = [{ id: "s0", videoMeta: { provider: "p-actual", model: "actual-video-model" } }];
      const project = {
        ...REAL_PROJECT,
        story2videoTextConfig: {
          version: 1,
          config: { video: { mode: "fixed", provider: "minimax-video", model: "configured-model" } },
        },
      };
      const text = resolveModelSummaryText(project, segments, label);
      expect(text).toContain("视频模型: actual-video-model");
      expect(text).not.toContain("configured-model");
    });

    it("options.videoMode 作为历史兼容回退仍生效（旧夹具/旧清单）", () => {
      const project = {
        ...REAL_PROJECT,
        options: { ...REAL_PROJECT.options, videoMode: "fixed", videoModel: "Legacy-Video" },
        story2videoTextConfig: undefined,
      };
      expect(resolveModelSummaryText(project, project.segments, label)).toContain("视频模型: Legacy-Video");
    });

    it("story2videoTextConfig 畸形（null/非对象/config 缺失）时不崩且不渲染视频模型", () => {
      for (const bad of [null, "x", 42, {}, { config: null }, { config: { video: null } }]) {
        const project = { ...REAL_PROJECT, story2videoTextConfig: bad };
        const text = resolveModelSummaryText(project, project.segments, label);
        expect(typeof text).toBe("string");
        expect(text).not.toContain("视频模型");
      }
    });
  });

  // ── DOM 级：与「格式」同行 + 空态不渲染 ───────────────────────────────────
  describe("ResultView 模板接线", () => {
    // 从 zh locale 按点号路径解析，让 DOM 级断言写成真实中文而不是 key
    function zhText(key) {
      return String(key).split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), zh);
    }

    function mountWithProject(project) {
      return mount(ResultView, {
        global: {
          plugins: [router],
          components: { UiButton },
          mocks: { $t: (key) => (typeof zhText(key) === "string" ? zhText(key) : key) },
        },
      });
    }

    async function setup(project) {
      const w = mountWithProject(project);
      w.vm.loading = false;
      w.vm.project = project;
      w.vm.projectId = project?.projectId || "p";
      w.vm.segments = Array.isArray(project?.segments) ? project.segments : [];
      w.vm.videoPath = project?.videoPath || "C:/v/video.mp4";
      await nextTick();
      return w;
    }

    it("模型摘要与「格式」在同一个 <p> 内（同行容器）", async () => {
      const w = await setup({
        projectId: "p-row",
        videoPath: "C:/v/video.mp4",
        options: { imageModel: "MiniMax Image", videoMode: "ai-judged", videoModel: "MiniMax Hailuo" },
        segments: [{ id: "s0", imageMeta: { model: "MiniMax Image" }, videoMeta: { model: "MiniMax Hailuo" } }],
      });
      const row = w.find('[data-testid="video-format-models"]');
      expect(row.find('[data-testid="video-format"]').exists()).toBe(true);
      expect(row.find('[data-testid="video-models"]').exists()).toBe(true);
      // 同一个 <p>，不是两个并列的 <p>
      expect(row.element.tagName).toBe("P");
      expect(row.find('[data-testid="video-models"]').text()).toContain("图片模型: MiniMax Image");
      w.unmount();
    });

    it("四项全空时不渲染模型摘要，格式行只剩「格式: MP4」", async () => {
      const w = await setup({ projectId: "p-empty", videoPath: "C:/v/video.mp4", options: {}, segments: [] });
      expect(w.find('[data-testid="video-models"]').exists()).toBe(false);
      expect(w.find('[data-testid="video-format-models"]').text()).toBe("格式: MP4");
      w.unmount();
    });

    it("项目对象更新后模型信息随之重算", async () => {
      const w = await setup({
        projectId: "p-live",
        videoPath: "C:/v/video.mp4",
        options: { imageModel: "Old Image" },
        segments: [{ id: "s0" }],
      });
      expect(w.find('[data-testid="video-models"]').text()).toContain("图片模型: Old Image");
      const nextSegments = [{ id: "s0", imageMeta: { model: "New Image Model" } }];
      w.vm.project = { projectId: "p-live", options: {}, segments: nextSegments };
      w.vm.segments = nextSegments.map(segment => ({ ...segment }));
      await nextTick();
      expect(w.find('[data-testid="video-models"]').text()).toContain("图片模型: New Image Model");
      w.unmount();
    });
  });

  // ── locale 成对（Gate 7 的结构化预检）────────────────────────────────────
  describe("locale 成对", () => {
    it("zh/en 的 create.story2video.modelInfo 四个键齐备且为非空字符串", () => {
      for (const locale of [zh, en]) {
        const node = locale.create.story2video.modelInfo;
        expect(node).toBeTruthy();
        for (const key of ["textModel", "voiceModel", "imageModel", "videoModel"]) {
          expect(typeof node[key], `${locale === zh ? "zh" : "en"}.${key}`).toBe("string");
          expect(node[key].length).toBeGreaterThan(0);
        }
      }
    });
  });
});
