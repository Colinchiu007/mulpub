/**
 * 参考产品渲染层（React）结构提取
 */
const fs = require("node:fs");
const path = require("node:path");

const DIST = "D:\\Data\\projects\\rea\\analysis\\refproduct-asar\\packages\\renderer\\dist";
const MAIN = path.join(DIST, "main-BTf-V4ZI.js");
const src = fs.readFileSync(MAIN, "utf8");

const out = [];
const w = (s) => out.push(s);
w("# 参考产品渲染层结构分析");
w("");
w("> 来源：`analysis/refproduct-asar/packages/renderer/dist/`");
w("> 主包 `main-BTf-V4ZI.js`（124.7 KB，React 19 打包产物）");
w("");
w("---");
w("");

// ═══ 1. 窗口架构 ═══
w("## 1. 多窗口架构（9 个独立 HTML 窗口）");
w("");
w("参考产品把不同界面拆成**独立 Electron 窗口**，每个窗口是独立的 React SPA：");
w("");
w("| 窗口 | `<title>` | 入口 JS | 用途推断 |");
w("|---|---|---|---|");
const WINDOWS = [
  ["index.html", "（空）", "main-BTf-V4ZI.js", "**主窗口**（标签页 + 分屏浏览器）"],
  ["collect.html", "**加载错误** ⚠️", "collect-CRh-pEpX.js", "**采集窗口**（标题是模板复制 bug）"],
  ["error.html", "加载错误", "error-DSGktFUz.js", "错误页"],
  ["notice.html", "（空）", "notice-3DOZPZSS.js", "通知窗口"],
  ["online.html", "在线状态", "online-D5HJKZAH.js", "在线状态指示"],
  ["placeholder.html", "新标签页", "placeholder-C3yQyJfc.js", "新标签占位页"],
  ["splitPlaceholder.html", "新标签页", "splitPlaceholder-BzUxLLqP.js", "**分屏占位页**"],
  ["tool.html", "**Tool** ⚠️", "tool-BHbYCDPK.js", "工具页（标题未本地化）"],
  ["update.html", "**Tool** ⚠️", "update-BtqyzxYt.js", "更新页（标题误抄 tool.html）"],
];
for (const [f, t, e, d] of WINDOWS) w(`| \`${f}\` | ${t} | \`${e}\` | ${d} |`);
w("");
w("### 1.1 代码质量观察：9 个窗口里 3 个标题错误");
w("");
w("| 问题 | 文件 | 现象 |");
w("|---|---|---|");
w("| 模板复制未改 | `collect.html` | 采集窗口的标题写成「加载错误」——从 `error.html` 抄模板时漏改 |");
w("| 模板复制未改 | `update.html` | 更新页标题写成「Tool」——从 `tool.html` 抄模板时漏改 |");
w("| 未本地化 | `tool.html` | 标题是英文 `Tool`，而产品是纯中文界面 |");
w("");
w("> 这类问题在手工维护多入口 HTML 时很常见。");
w("> **本项目对照**：本项目是单入口 Vue SPA（`apps/desktop/src/`），");
w("> 不存在多 HTML 入口的标题漂移问题；且 i18n 有 `locales/zh.js` / `en.js` **成对提交门禁**");
w("> （CI Gate 7 `check-locale-sync.js`），不会出现「中文产品里混英文标题」。");
w("");
w("### 1.2 每个窗口都有 CSP");
w("");
w("所有窗口统一声明：");
w("```html");
w('<meta content="script-src \'self\' blob:" http-equiv="Content-Security-Policy" />');
w("```");
w("");
w("**评估**：`script-src 'self' blob:` 阻止了内联脚本与外部脚本，是合理的加固。");
w("但未见 `object-src` / `base-uri` / `frame-ancestors` 等指令，属**部分加固**。");
w("本项目 `apps/desktop/electron/core/ipc-security.js` + `access-level.js` 的安全面更完整。");
w("");

// ═══ 2. React 结构 ═══
w("---");
w("");
w("## 2. 渲染层技术特征");
w("");
const FEATURES = [
  ["React", /React/g, "React 19 运行时"],
  ["useState", /useState/g, "函数组件状态"],
  ["useEffect", /useEffect/g, "副作用"],
  ["useMemo", /useMemo/g, "记忆化"],
  ["useCallback", /useCallback/g, "回调记忆化"],
  ["useRef", /useRef/g, "引用"],
  ["createContext", /createContext/g, "Context"],
  ["lucide", /lucide/g, "lucide 图标库"],
  ["className", /className/g, "JSX"],
  ["dnd", /dnd|pangea/gi, "拖拽（@hello-pangea/dnd）"],
  ["zod", /zod/gi, "校验（zod）"],
  ["dayjs", /dayjs/gi, "日期（dayjs）"],
  ["nanoid", /nanoid/gi, "ID 生成"],
  ["debounce", /debounce/gi, "防抖"],
  ["throttle", /throttle/gi, "节流"],
  ["tailwind", /tailwind/gi, "Tailwind"],
  ["socket", /socket/gi, "socket.io"],
];
w("| 特征 | 出现次数 | 说明 |");
w("|---|---:|---|");
for (const [name, re, desc] of FEATURES) {
  const n = (src.match(re) || []).length;
  if (n > 0) w(`| \`${name}\` | ${n} | ${desc} |`);
}
w("");

// ═══ 3. IPC 调用面 ═══
w("---");
w("");
w("## 3. 渲染层调用的 IPC 通道");
w("");
const ipcCalls = new Set();
// electronAPI.xxx / window.electronAPI.xxx
for (const m of src.matchAll(/(?:window\.)?electronAPI\.(\w+)/g)) ipcCalls.add(m[1]);
for (const m of src.matchAll(/(?:window\.)?api\.(\w+)\s*\(/g)) ipcCalls.add("api." + m[1]);
w(`从渲染层主包中提取到 **${ipcCalls.size}** 个桥接调用点：`);
w("");
w("```");
[...ipcCalls].sort().forEach((c) => w(c));
w("```");
w("");

// ═══ 4. 中文界面文案（功能线索）═══
w("---");
w("");
w("## 4. 中文界面文案（功能线索）");
w("");
const zh = [...new Set(src.match(/[\u4e00-\u9fff][\u4e00-\u9fff\w\s，。、：；！？（）\-]{1,24}/g) || [])];
w(`共提取 **${zh.length}** 条中文字符串，前 120 条（反映功能面）：`);
w("");
w("```");
zh.slice(0, 120).forEach((s) => w(s.trim()));
w("```");
w("");

fs.writeFileSync("D:\\Data\\projects\\rea\\analysis\\refproduct-renderer.md", out.join("\n"), "utf8");
console.log("写入: refproduct-renderer.md");
console.log("行数:", out.length);
console.log("IPC 调用点:", ipcCalls.size);
console.log("中文字符串:", zh.length);
