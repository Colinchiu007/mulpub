// @ts-check
/**
 * readable-text 回归测试 — HTML 可读纯文本提取（保留原文换行/分段）
 *
 * 覆盖：
 *   - extractReadableText：块级结构 → 换行（段落空行 / 列表项分行 / <br> 换行 / 表格单元格）
 *   - extractReadableText：噪声节点剔除、<pre> 代码块原样保留、空容器不抛错
 *   - normalizeExtractedText：行尾统一 / BOM / 行内空白压缩 / 连续换行收口（纯函数）
 *
 * 背景（本文件的防回归目标）：正文提取曾用 `.text().trim().replace(/\s+/g, ' ')`，
 * 把包括换行在内的所有连续空白压成单个空格 → 正文被压成一整行（「没有分行和分段」）。
 * 因此本文件一律用 `toBe` 精确锁定段落结构；子串匹配（toContain）拦不住这类 Bug。
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

// cheerio 为 CJS 包：用 createRequire 取，避免 ESM interop 下 default 为空
const require = createRequire(import.meta.url);
const cheerio = require("cheerio");
const { extractReadableText, normalizeExtractedText } = require("./readable-text");

/** 便捷：把 HTML 片段包进 <article> 后交给提取器（模拟真实正文容器） */
function extract(html, selector = "article") {
  const $ = cheerio.load(`<html><body><article>${html}</article></body></html>`);
  return extractReadableText($(selector));
}

describe("extractReadableText 块级结构 → 换行", () => {
  it("段落之间保留空行，列表项之间单换行（精确匹配）", () => {
    const out = extract(`
      <h2>小标题</h2>
      <p>第一段。</p>
      <p>第二段。</p>
      <ul><li>要点一</li><li>要点二</li></ul>
    `);
    // 修复前：整篇被压成 "小标题 第一段。 第二段。 要点一要点二"（零换行，且列表项粘连）
    expect(out).toBe("小标题\n\n第一段。\n\n第二段。\n\n要点一\n要点二");
  });

  it("<br> 强制换行保留为单个换行（不产生空行）", () => {
    expect(extract("<p>第一行<br>第二行<br>第三行</p>")).toBe("第一行\n第二行\n第三行");
  });

  it("连续 3 个以上换行压缩为 1 个空行，首尾换行被去除", () => {
    // 真实页面源码缩进会在块级元素之间产生大量空白
    expect(extract("\n\n\n<p>甲</p>\n\n\n\n\n<p>乙</p>\n\n")).toBe("甲\n\n乙");
  });

  it("行内多余空白压缩为单个空格（换行不受影响）", () => {
    expect(extract("<p>甲   乙\t丙\u3000丁</p>")).toBe("甲 乙 丙 丁");
  });

  it("表格：单元格在同一行内以空格分隔，行与行之间换行", () => {
    const out = extract("<table><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td><td>丁</td></tr></table>");
    expect(out).toBe("甲 乙\n丙 丁");
  });

  it("行内标签原样透传（源码无空白即无间距，与浏览器渲染一致）", () => {
    expect(extract("<p><strong>加粗</strong>正文</p>")).toBe("加粗正文");
  });
});

describe("extractReadableText 噪声剔除与代码块", () => {
  it("噪声节点（导航/页脚/脚本/侧栏/按钮）不进入正文，也不制造伪换行", () => {
    const out = extract(`
      <nav>导航</nav><p>正文。</p><script>var a = 1</script>
      <aside>侧栏</aside><footer>页脚</footer><form><button>提交</button></form>
    `);
    expect(out).toBe("正文。");
  });

  it("<pre> 代码块保留内部换行与缩进（不被行内空白压缩抹平）", () => {
    const out = extract("<p>示例：</p><pre>function a() {\n  return 1\n}</pre><p>结束。</p>");
    expect(out).toBe("示例：\n\nfunction a() {\n  return 1\n}\n\n结束。");
  });

  it("<pre> 位于容器首尾时不残留多余空行", () => {
    expect(extract("<pre>a\n  b</pre>")).toBe("a\n  b");
  });

  it("多个 <pre> 各自独立还原，不会串位", () => {
    const out = extract("<pre>第一个\n  缩进</pre><p>中间段。</p><pre>第二个\n  缩进</pre>");
    expect(out).toBe("第一个\n  缩进\n\n中间段。\n\n第二个\n  缩进");
  });

  it("空容器返回空串且不抛错", () => {
    expect(extract("")).toBe("");
    expect(extractReadableText(null)).toBe("");
  });

  it("只有噪声节点时返回空串", () => {
    expect(extract("<nav>导航</nav><footer>页脚</footer>")).toBe("");
  });
});

describe("normalizeExtractedText 空白归一化（纯函数，与 cheerio 解耦）", () => {
  const normalize = normalizeExtractedText;

  it("统一行尾：CRLF / CR / U+2028 / U+2029 全部归一为 LF", () => {
    expect(normalize("甲\r\n乙\r丙\u2028丁\u2029戊")).toBe("甲\n乙\n丙\n丁\n戊");
  });

  it("去除 BOM，避免污染首行首字符", () => {
    expect(normalize("\ufeff正文")).toBe("正文");
  });

  it("行内连续空白（制表符/NBSP/全角空格）压缩为单个半角空格", () => {
    expect(normalize("甲\t\t乙\u00a0\u00a0丙\u3000\u3000丁")).toBe("甲 乙 丙 丁");
  });

  it("保留换行：多行输入不会被压成单行", () => {
    expect(normalize("甲\n乙")).toBe("甲\n乙");
  });

  it("每行去首尾空白；3 个以上换行压成 1 个空行；去首尾换行", () => {
    expect(normalize("\n\n  甲  \n\n\n\n  乙  \n\n")).toBe("甲\n\n乙");
  });

  it("非字符串/空值输入安全返回空串", () => {
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
    expect(normalize("")).toBe("");
  });
});
