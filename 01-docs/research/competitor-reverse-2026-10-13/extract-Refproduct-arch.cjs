/**
 * 参考产品：提取平台清单、IPC 契约、核心类结构
 */
const fs = require("node:fs");
const path = require("node:path");

const DIR = "D:\\Temp\\rea-extracted-e6351f4c-9ad7-4b5e-a8cc-96ac16bf5f8a";
const MAIN = path.join(DIR, "packages\\main\\dist\\index.cjs");
const RENDERER_DIR = path.join(DIR, "packages\\renderer\\dist");

const text = fs.readFileSync(MAIN, "utf8");
const out = [];
const w = (s) => out.push(s);

// ============ 1. 平台枚举 Platforms ============
w("################ 参考产品支持的平台（Platforms 枚举）################\n");
{
  const m = /Platforms\s*=|var Platforms|const Platforms/.exec(text);
  // 找 Platforms 定义块
  const re = /Platforms\[([A-Za-z]+)\s*=\s*"?(\d+)"?\]\s*=\s*"([^"]+)"/g;
  let mm;
  const found = new Map();
  while ((mm = re.exec(text)) !== null) {
    found.set(mm[1], mm[3]);
  }
  if (found.size === 0) {
    // 另一种形式: {DouYin:"douyin",...}
    const re2 = /Platforms\s*=\s*\{([^}]{50,4000})\}/;
    const m2 = re2.exec(text);
    if (m2) {
      const pairs = m2[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*"([^"]+)"/g);
      for (const p of pairs) found.set(p[1], p[2]);
    }
  }
  if (found.size > 0) {
    w(`共 ${found.size} 个平台:\n`);
    [...found.entries()].sort().forEach(([k, v]) => w(`  ${k.padEnd(24)} = ${v}`));
  } else {
    w("（未能从 Platforms 枚举提取，改用域名探测）\n");
    const domains = new Set();
    const dre = /https?:\/\/((?:creator|cp|member|www|ark|passport|open)\.[a-z0-9.-]+\.[a-z]{2,})/g;
    let dm;
    while ((dm = dre.exec(text)) !== null) domains.add(dm[1]);
    w(`探测到 ${domains.size} 个创作者平台域名:`);
    [...domains].sort().forEach((d) => w(`  ${d}`));
  }
}

// ============ 2. IPC 完整清单 ============
w("\n\n################ 主进程 IPC handler 完整清单 ################\n");
{
  const re = /ipcMain\.(handle|on)\(\s*['"`]([^'"`]+)['"`]/g;
  let m;
  const channels = [];
  while ((m = re.exec(text)) !== null) {
    channels.push({ verb: m[1], ch: m[2] });
  }
  // IpcChannelEnum 形式的
  const re2 = /ipcMain\.(handle|on)\(\s*(\w+)\.(\w+)/g;
  while ((m = re2.exec(text)) !== null) {
    channels.push({ verb: m[1], ch: `${m[2]}.${m[3]}` });
  }
  w(`共 ${channels.length} 个:\n`);
  // 按前缀分组
  const groups = new Map();
  for (const c of channels) {
    const prefix = c.ch.split(":")[0];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(c.ch);
  }
  [...groups.entries()].sort().forEach(([k, v]) => {
    w(`[${k}] (${v.length})`);
    v.forEach((c) => w(`    ${c}`));
  });
}

// ============ 3. 核心类名 ============
w("\n\n################ 核心类结构 ################\n");
{
  const classRe = /^class (\w+)( extends (\w+))?/gm;
  let m;
  const classes = [];
  while ((m = classRe.exec(text)) !== null) {
    classes.push({ name: m[1], base: m[3] || null });
  }
  // esbuild 压缩后的 class X extends Y{ 形式
  const re2 = /class (\w+) extends (\w+)\{/g;
  while ((m = re2.exec(text)) !== null) {
    if (!classes.find((c) => c.name === m[1]))
      classes.push({ name: m[1], base: m[2] });
  }
  w(`共 ${classes.length} 个顶层类:\n`);
  classes
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((c) => w(`  ${c.name}${c.base ? ` extends ${c.base}` : ""}`));
}

// ============ 4. 渲染进程入口 ============
w("\n\n################ 渲染进程结构 ################\n");
if (fs.existsSync(RENDERER_DIR)) {
  const files = fs.readdirSync(RENDERER_DIR).filter((f) => f.endsWith(".js"));
  files.forEach((f) => {
    const sz = fs.statSync(path.join(RENDERER_DIR, f)).size;
    w(`  ${f.padEnd(36)} ${(sz / 1024).toFixed(1)} KB`);
  });
  // index.html
  const html = path.join(RENDERER_DIR, "index.html");
  if (fs.existsSync(html)) {
    w("\n--- index.html 加载的脚本 ---");
    const h = fs.readFileSync(html, "utf8");
    [...h.matchAll(/<script[^>]*src="([^"]+)"/g)].forEach((m) => w(`  ${m[1]}`));
  }
}

// ============ 5. 反爬/风控细节 ============
w("\n\n################ 反爬与风控细节 ################\n");
{
  const patterns = [
    { label: "webdriver 隐藏", re: /navigator\.webdriver|Object\.defineProperty\(navigator,\s*["']webdriver/ },
    { label: "chrome 运行时伪装", re: /window\.chrome|chrome\.runtime|chrome\.app/ },
    { label: "权限通知覆盖", re: /Notification\.requestPermission|navigator\.permissions/ },
    { label: "插件数量伪装", re: /navigator\.plugins\.length/ },
    { label: "语言伪装", re: /navigator\.language|languages/ },
    { label: "屏幕尺寸伪装", re: /screen\.(width|height|colorDepth)|window\.devicePixelRatio/ },
    { label: "验证码-滑块", re: /geetest|滑块|captcha/ },
    { label: "验证码-OCR", re: /tesseract|ocr/ },
    { label: "Cookie 操作", re: /session\.cookies\.(set|get|remove)/ },
    { label: "localStorage 注入", re: /executeJavaScript/ },
    { label: "UA 自定义", re: /setUserAgent|userAgent:/ },
    { label: "请求间隔/风控", re: /sleep|delay|throttle/ },
  ];
  for (const p of patterns) {
    const cnt = (text.match(new RegExp(p.re.source, "g")) || []).length;
    if (cnt > 0) w(`  ${p.label.padEnd(20)} ${cnt} 处`);
  }
}

// ============ 6. 数据存储 ============
w("\n\n################ 数据存储 ################\n");
{
  const pats = [
    ["sqlite", /sqlite|better-sqlite3|sql\.js/],
    ["leveldb", /leveldb|classic-level/],
    ["electron-store", /electron-store|conf\.(get|set)/],
    ["文件系统缓存", /userData|appData|writeFileSync/],
    ["IndexedDB", /indexedDB/],
    ["OSS 直传", /aliyuncs|oss-cn|sts\.aliyuncs/],
    ["COS 直传", /x-cos-security-token|myqcloud/],
  ];
  for (const [label, re] of pats) {
    const cnt = (text.match(new RegExp(re.source, "g")) || []).length;
    if (cnt > 0) w(`  ${label.padEnd(16)} ${cnt} 处`);
  }
}

fs.writeFileSync(
  "D:\\Data\\projects\\rea\\analysis\\refproduct-architecture.txt",
  out.join("\n"),
  "utf8",
);
console.log("written, lines:", out.length);
