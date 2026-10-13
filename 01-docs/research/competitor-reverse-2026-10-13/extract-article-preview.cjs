/**
 * 融媒宝 ArticlePreview —— 7 平台预览页承载形态取证
 * 用于交叉验证本项目的 content-formatter 承载形态登记表
 */
const fs = require("node:fs");
const path = require("node:path");

const DIR = "D:\\Program Files (x86)\\融媒宝\\Asset\\ArticlePreview";
const OUT = "D:\\Data\\projects\\rea\\analysis\\wemedia-article-preview.md";

const PAPER = {
  Baijia: "百家号 baijiahao",
  Dayu: "大鱼号 dayu",
  Qie: "企鹅号 qie",
  Sohu: "搜狐号 sohu",
  Toutiao: "头条号 toutiao",
  Weixin: "微信公众号 weixin",
  Yidian: "一点号 yidian",
};

const out = [];
const w = (s) => out.push(s);
w("# 融媒宝 ArticlePreview —— 7 平台承载形态取证");
w("");
w("> 来源：`D:\\Program Files (x86)\\融媒宝\\Asset\\ArticlePreview\\`");
w("> 目的：**交叉验证本项目的 `content-formatter` 承载形态登记表**");
w("> 生成时间：" + new Date().toISOString());
w("");
w("---");
w("");
w("## 1. 机制：`ArticlePreview.setContent()`");
w("");
w(fs.readFileSync(path.join(DIR, "ArticlePreview.js"), "utf8").split("\n").slice(19, 33).join("\n"));
w("");
w("**关键**：内容通过 **`document.getElementById(\"content\").innerHTML = content`** 注入 —— ");
w("即**整篇内容被当作 HTML 解析**。");
w("");
w("这解释了为什么 7 个平台各有一份预览页：**每个平台的正文渲染规则不同**，");
w("融媒宝用「独立预览页 + 独立 CSS」来模拟各平台的实际显示效果。");
w("");
w("---");
w("");
w("## 2. 7 个平台的预览页与样式表");
w("");
w("| 平台 | 预览页 | 样式表 | Frame CSS 大小 |");
w("|---|---|---|---:|");
for (const k of Object.keys(PAPER)) {
  const html = path.join(DIR, `${k}Preview.html`);
  const css = path.join(DIR, `${k}Frame.css`);
  if (!fs.existsSync(html)) continue;
  const cs = fs.existsSync(css) ? (fs.statSync(css).size / 1024).toFixed(1) + " KB" : "—";
  w(`| ${PAPER[k]} | \`${k}Preview.html\` | \`${k}Frame.css\` | ${cs} |`);
}
w("");
w("公共基础样式：`FrameBase.css`（所有预览页共同引用）");
w("");
w("---");
w("");
w("## 3. ⭐ 各平台测试夹具（暴露期望的内容形态）");
w("");
w("每个预览页的 `test()` 里有一段**硬编码的示例内容**——这是开发者对「该平台正文长什么样」的理解。");
w("");
for (const k of Object.keys(PAPER)) {
  const html = path.join(DIR, `${k}Preview.html`);
  if (!fs.existsSync(html)) continue;
  const src = fs.readFileSync(html, "utf8");
  const m = src.match(/var content\s*=\s*([\s\S]*?);\s*\n/);
  const titleM = src.match(/var title\s*=\s*(.*?);\s*\n/);
  const mediaM = src.match(/setContent\([^,]*,[^,]*,[^,]*,[^,]*,[^,]*,\s*"([^"]+)"\)/);
  w(`### ${PAPER[k]}`);
  w("");
  w("```javascript");
  if (titleM) w("title = " + titleM[1].trim());
  w("content = " + (m ? m[1].trim() : "(未找到夹具)"));
  if (mediaM) w(`// setContent(..., media="${mediaM[1]}")`);
  w("```");
  w("");
}
w("---");
w("");
w("## 4. ⭐ 各平台 Frame CSS（真实渲染规则）");
w("");
for (const k of Object.keys(PAPER)) {
  const css = path.join(DIR, `${k}Frame.css`);
  if (!fs.existsSync(css)) continue;
  w(`### ${PAPER[k]} —— \`${k}Frame.css\``);
  w("");
  w("```css");
  w(fs.readFileSync(css, "utf8").trim());
  w("```");
  w("");
}
w("---");
w("");
w("## 5. 公共基础样式 `FrameBase.css`");
w("");
w("```css");
w(fs.readFileSync(path.join(DIR, "FrameBase.css"), "utf8").trim());
w("```");
w("");

fs.writeFileSync(OUT, out.join("\n"), "utf8");
console.log("写入:", OUT, "行数:", out.length);
