import { describe, it, expect, afterEach } from "vitest";
import i18n, {
  detectSystemLocale,
  resolveAppLocale,
  setAppLocale,
  getAppLocale,
} from "@/i18n";
import {
  getPipelineCategory,
  getPipelineName,
} from "@/i18n/pipeline-labels";
import zh from "@/locales/zh";
import en from "@/locales/en";

function collectPaths(node, path = "", acc = []) {
  for (const [key, value] of Object.entries(node)) {
    const next = path ? `${path}.${key}` : key;
    if (value && typeof value === "object") {
      collectPaths(value, next, acc);
    } else {
      acc.push(next);
    }
  }
  return acc;
}

function collectStringLeaves(node, path = "", acc = []) {
  for (const [key, value] of Object.entries(node)) {
    const next = path ? `${path}.${key}` : key;
    if (value && typeof value === "object") {
      collectStringLeaves(value, next, acc);
    } else if (typeof value === "string") {
      acc.push({ path: next, value });
    }
  }
  return acc;
}

function placeholderTokens(value) {
  const tokens = String(value).match(/\{([^{}]+)\}/g) || [];
  return [...new Set(tokens)].sort();
}

function collectLeaves(node, path = "") {
  const leaves = [];
  for (const [key, value] of Object.entries(node)) {
    const next = path ? `${path}.${key}` : key;
    if (value && typeof value === "object") {
      leaves.push(...collectLeaves(value, next));
    } else {
      leaves.push({ path: next, value });
    }
  }
  return leaves;
}

function blockEvalLikeCsp() {
  const RealFunction = globalThis.Function;
  const cspSafeFunction = new Proxy(RealFunction, {
    construct(target, args) {
      if (args.some((arg) => typeof arg === "string")) {
        throw new EvalError("Refused to evaluate a string as JavaScript");
      }
      return Reflect.construct(target, args);
    },
  });
  globalThis.Function = cspSafeFunction;
  return () => {
    globalThis.Function = RealFunction;
  };
}

describe("i18n CSP-safe messages", () => {
  it("zh/en 全部消息叶子都是 Message Function，避免运行时编译", () => {
    for (const locale of ["zh", "en"]) {
      const messages = i18n.global.getLocaleMessage(locale);
      const leaves = collectLeaves(messages);
      expect(leaves.length).toBeGreaterThan(0);
      for (const leaf of leaves) {
        expect(typeof leaf.value, `${locale}.${leaf.path} 应转为函数`).toBe(
          "function"
        );
      }
    }
  });

  it("模拟 CSP 禁止 new Function 时翻译仍然可用（视频创作流水线文案）", () => {
    const restore = blockEvalLikeCsp();
    try {
      i18n.global.locale.value = "zh";
      expect(i18n.global.t("pipelines.names.story2video-compose")).toBe("故事讲述");
      expect(i18n.global.t("pipelines.categories.generated")).toBe("AI 生成");
      expect(i18n.global.t("create.story2video.startPipeline")).toBe("启动流水线");

      const t = (key) => i18n.global.t(key);
      expect(getPipelineName(t, "story2video-compose")).toBe("故事讲述");
      expect(getPipelineCategory(t, "generated")).toBe("AI 生成");

      i18n.global.locale.value = "en";
      expect(getPipelineName(t, "story2video-compose")).toBe("Story Telling");
      expect(getPipelineCategory(t, "generated")).toBe("AI Generated");
    } finally {
      restore();
      i18n.global.locale.value = "zh";
    }
  });

  it("story2video 运行进度文案键存在且支持命名插值（zh/en）", () => {
    i18n.global.locale.value = "zh";
    try {
      expect(i18n.global.t("story2video.elapsed", { duration: "12 秒" })).toBe("已用时 12 秒");
      expect(i18n.global.t("story2video.durationSec", { seconds: 3 })).toBe("3 秒");
      expect(i18n.global.t("story2video.durationMinSec", { minutes: 1, seconds: 48 })).toBe("1 分 48 秒");
      i18n.global.locale.value = "en";
      expect(i18n.global.t("story2video.elapsed", { duration: "12s" })).toBe("Elapsed 12s");
      expect(i18n.global.t("story2video.durationSec", { seconds: 3 })).toBe("3s");
      expect(i18n.global.t("story2video.durationMinSec", { minutes: 1, seconds: 48 })).toBe("1m 48s");
    } finally {
      // 断言失败时也要恢复 locale，避免污染同文件后续用例（claude review I5）
      i18n.global.locale.value = "zh";
    }
  });
});

describe("系统语言自动检测与设置切换（user-facing-messages）", () => {
  const originalNavigatorLanguage = globalThis.navigator?.language;

  afterEach(() => {
    try { localStorage.removeItem("locale") } catch (_) {}
    if (typeof originalNavigatorLanguage === "string") {
      Object.defineProperty(globalThis.navigator, "language", {
        value: originalNavigatorLanguage,
        configurable: true,
      })
    }
    i18n.global.locale.value = "zh";
  });

  it("detectSystemLocale：zh* → zh，en* → en，其余 → en", () => {
    const set = (value) => Object.defineProperty(globalThis.navigator, "language", { value, configurable: true })
    set("zh-CN"); expect(detectSystemLocale()).toBe("zh")
    set("zh-Hans"); expect(detectSystemLocale()).toBe("zh")
    set("en-US"); expect(detectSystemLocale()).toBe("en")
    set("en-GB"); expect(detectSystemLocale()).toBe("en")
    set("fr-FR"); expect(detectSystemLocale()).toBe("en")
    set("ja-JP"); expect(detectSystemLocale()).toBe("en")
  });

  it("resolveAppLocale：显式设置优先于系统语言", () => {
    Object.defineProperty(globalThis.navigator, "language", { value: "en-US", configurable: true })
    try { localStorage.setItem("locale", "zh") } catch (_) {}
    expect(resolveAppLocale()).toBe("zh")
    try { localStorage.setItem("locale", "en") } catch (_) {}
    expect(resolveAppLocale()).toBe("en")
  });

  it("resolveAppLocale：无显式设置时按系统语言", () => {
    Object.defineProperty(globalThis.navigator, "language", { value: "en-US", configurable: true })
    expect(resolveAppLocale()).toBe("en")
    Object.defineProperty(globalThis.navigator, "language", { value: "zh-CN", configurable: true })
    expect(resolveAppLocale()).toBe("zh")
  });

  it("setAppLocale 持久化并即时生效，getAppLocale 返回当前语言", () => {
    expect(setAppLocale("en")).toBe("en")
    expect(getAppLocale()).toBe("en")
    expect(i18n.global.locale.value).toBe("en")
    try { expect(localStorage.getItem("locale")).toBe("en") } catch (_) {}
    expect(setAppLocale("zh")).toBe("zh")
    expect(getAppLocale()).toBe("zh")
  });
});

describe("zh/en 内容同步（i18n-content-sync）", () => {
  it("zh/en locale 叶子键完全对称（缺键即失败）", () => {
    const zhPaths = collectPaths(zh);
    const enPaths = collectPaths(en);
    const zhSet = new Set(zhPaths);
    const enSet = new Set(enPaths);
    expect(zhPaths.filter((p) => !enSet.has(p)), "zh 有而 en 缺失").toEqual([]);
    expect(enPaths.filter((p) => !zhSet.has(p)), "en 有而 zh 缺失").toEqual([]);
  });

  it("zh/en 同 key 文案 {param} 占位符集合一致", () => {
    const zhLeaves = new Map(
      collectStringLeaves(zh).map((l) => [l.path, l.value])
    );
    const enLeaves = new Map(
      collectStringLeaves(en).map((l) => [l.path, l.value])
    );
    for (const [path, zhValue] of zhLeaves) {
      const enValue = enLeaves.get(path);
      if (enValue === undefined) continue; // 缺键由键对称测试覆盖
      expect(placeholderTokens(zhValue), `${path} zh 占位符`).toEqual(
        placeholderTokens(enValue)
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUGFIX-REWRITE-QUALITY-UX 回归保护（2026-09-16）
//
// 事故现场：改写页结果栏原样显示「{original} 字 → {result} 字」——模板占位符泄漏到 UI。
// 根因：toMessageFunctions 把**所有**字符串叶子都包成 `() => source`，丢弃了 vue-i18n
// 传入的插值参数，于是含 {param} 的字符串原样输出。
// 全仓影响面：locales 中 68 条「普通字符串 + {param}」叶子 / 16 处 t(key, params) 调用点。
// 本组用例做全量守卫，防止同类泄漏再次进入语料。
// ─────────────────────────────────────────────────────────────────────────────
describe("i18n {param} 命名插值（BUGFIX-REWRITE-QUALITY-UX 回归）", () => {
  const SENTINEL = "SENTINELVALUE";

  /** 抽取字符串叶子里的占位符名（去重） */
  function paramNames(value) {
    const tokens = String(value).match(/\{([^{}]+)\}/g) || [];
    return [...new Set(tokens.map((t) => t.slice(1, -1)))];
  }

  it("全量守卫：普通字符串叶子里的 {param} 都会被替换，不泄漏原始占位符（zh/en）", () => {
    try {
      for (const [locale, tree] of [
        ["zh", zh],
        ["en", en],
      ]) {
        i18n.global.locale.value = locale;
        const braced = collectStringLeaves(tree).filter(
          (l) => paramNames(l.value).length > 0
        );
        // 语料中确实存在这类叶子（否则本守卫形同虚设）
        expect(braced.length).toBeGreaterThan(0);
        for (const leaf of braced) {
          const params = {};
          for (const name of paramNames(leaf.value)) params[name] = SENTINEL;
          const text = i18n.global.t(leaf.path, params);
          expect(text, `${locale}.${leaf.path} 仍残留占位符`).not.toMatch(
            /\{[^{}]+\}/
          );
          expect(text, `${locale}.${leaf.path} 未注入参数值`).toContain(
            SENTINEL
          );
        }
      }
    } finally {
      i18n.global.locale.value = "zh";
    }
  });

  it("事故用例：rewritePage.metaLength 渲染为可读字数概览", () => {
    try {
      i18n.global.locale.value = "zh";
      expect(
        i18n.global.t("rewritePage.metaLength", { original: 8, result: 720 })
      ).toBe("原文 8 字 → 结果 720 字");
      i18n.global.locale.value = "en";
      expect(
        i18n.global.t("rewritePage.metaLength", { original: 8, result: 720 })
      ).toBe("Source 8 → Result 720 chars");
    } finally {
      i18n.global.locale.value = "zh";
    }
  });

  it("缺参回退空串（与 notifyCore 插值语义一致）且不泄漏花括号", () => {
    i18n.global.locale.value = "zh";
    const text = i18n.global.t("rewritePage.metaLength");
    expect(text).not.toMatch(/\{[^{}]+\}/);
  });

  it("边界值 0 不被当成缺参", () => {
    i18n.global.locale.value = "zh";
    expect(
      i18n.global.t("rewritePage.metaLength", { original: 0, result: 0 })
    ).toBe("原文 0 字 → 结果 0 字");
  });

  it("同一 key 在不同调用间不串参（占位符模板不被缓存污染）", () => {
    i18n.global.locale.value = "zh";
    const a = i18n.global.t("rewritePage.metaLength", { original: 1, result: 2 });
    const b = i18n.global.t("rewritePage.metaLength", { original: 300, result: 400 });
    expect(a).toBe("原文 1 字 → 结果 2 字");
    expect(b).toBe("原文 300 字 → 结果 400 字");
  });

  // CCG 评审 W-2：占位符正则已内联到 replace 调用点，不共享模块级 `g` 正则实例。
  // 若共享带 g 标志的 RegExp，`lastIndex` 会在多次调用间残留，导致间歇性漏替换。
  it("连续多次插值结果完全一致（无共享正则 lastIndex 残留）", () => {
    i18n.global.locale.value = "zh";
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(
        i18n.global.t("rewritePage.metaLength", { original: 7, result: 99 })
      );
    }
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("原文 7 字 → 结果 99 字");
  });

  it("同一字符串内多个不同占位符全部被替换（g 语义未退化）", () => {
    i18n.global.locale.value = "zh";
    // knowledgeBase.importResult 含 3 个不同占位符
    const text = i18n.global.t("knowledgeBase.importResult", {
      total: 3,
      succeeded: 2,
      failed: 1,
    });
    expect(text).not.toMatch(/\{[^{}]+\}/);
    expect(text).toContain("3");
    expect(text).toContain("2");
    expect(text).toContain("1");
  });

  it("无占位符的字符串仍走常量路径（CSP 安全，不引入运行时编译）", () => {
    i18n.global.locale.value = "zh";
    expect(i18n.global.t("rewritePage.title")).toBe("文案改写");
    // 语料叶子依然全部是 Message Function（CSP 硬约束）
    const leaves = collectLeaves(i18n.global.getLocaleMessage("zh"));
    for (const leaf of leaves) {
      expect(typeof leaf.value, `zh.${leaf.path}`).toBe("function");
    }
  });
});
