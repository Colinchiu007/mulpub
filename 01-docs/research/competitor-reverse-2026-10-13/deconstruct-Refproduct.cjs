/**
 * 参考产品 app.asar 主进程 webpack bundle 拆解脚本
 * 按 webpack 模块边界切分 index.cjs，提取每个模块的特征签名
 */
const fs = require("node:fs");
const path = require("node:path");

const BUNDLE = path.join(
  "D:\\Temp\\rea-extracted-e6351f4c-9ad7-4b5e-a8cc-96ac16bf5f8a\\packages\\main\\dist\\index.cjs",
);

const text = fs.readFileSync(BUNDLE, "utf8");
const lines = text.split(/\r?\n/);

// 收集 webpack 模块起始行
const starts = [];
lines.forEach((line, i) => {
  const m = /^\/\*\*\*\/ (\d+):/.exec(line);
  if (m) starts.push({ id: m[1], line: i });
});

console.log(`bundle lines: ${lines.length}`);
console.log(`webpack modules: ${starts.length}`);

// 切分模块
const modules = [];
for (let i = 0; i < starts.length; i++) {
  const start = starts[i].line;
  const end = i + 1 < starts.length ? starts[i + 1].line : lines.length;
  const body = lines.slice(start, end).join("\n");
  modules.push({
    id: starts[i].id,
    startLine: start + 1,
    endLine: end,
    bytes: Buffer.byteLength(body),
    body,
  });
}

// 特征提取：每类技术点的正则
const FEATURES = [
  { name: "平台-抖音", re: /creator\.douyin\.com/ },
  { name: "平台-快手", re: /cp\.kuaishou\.com|passport\.kuaishou\.com/ },
  { name: "平台-B站", re: /member\.bilibili\.com|bilibili\.com/ },
  { name: "平台-小红书", re: /creator\.xiaohongshu\.com|xiaohongshu\.com/ },
  { name: "平台-公众号", re: /mp\.weixin\.qq\.com/ },
  { name: "平台-知乎", re: /zhihu\.com/ },
  { name: "平台-微博", re: /weibo\.com/ },
  { name: "平台-头条", re: /toutiao\.com/ },
  { name: "平台-百家号", re: /baijiahao\.com/ },
  { name: "登录态-localStorage", re: /waitForLocalStorage|localStorage\.getItem/ },
  { name: "登录态-cookie", re: /session\.cookies|getCookies/ },
  { name: "登录态-AuthorizeConfig", re: /AuthorizeConfig/ },
  { name: "授权-oauth", re: /oauth|authorize|access_token|refresh_token/ },
  { name: "上传-inputFile", re: /input\[type=file\]|type=.file.|setInputFiles/ },
  { name: "上传-表单", re: /FormData|multipart\/form-data/ },
  { name: "上传-OSS直传", re: /oss-cn-|aliyuncs\.com|sts\.aliyuncs/ },
  { name: "反爬-验证码", re: /captcha|geetest|verifycode|滑块/ },
  { name: "反爬-风控sleep", re: /sleep\(|delay\(|setTimeout\(.{0,20}\d{4}/ },
  { name: "反爬-UA伪装", re: /userAgent|User-Agent|navigator\.userAgent/ },
  { name: "反爬-webdriver隐藏", re: /navigator\.webdriver|Object\.defineProperty\(navigator/ },
  { name: "窗口-多开", re: /new BrowserWindow|WebContentsView/ },
  { name: "窗口-池化复用", re: /pool|reuse/ },
  { name: "窗口-隐藏", re: /setVisible\(false|show:\s*false/ },
  { name: "窗口-后台节流", re: /backgroundThrottling/ },
  { name: "截图", re: /desktopCapturer|capturePage|screenshot/ },
  { name: "剪贴板", re: /clipboard/ },
  { name: "快捷键", re: /globalShortcut/ },
  { name: "IPC-通道", re: /ipcMain\.(handle|on)\(/ },
  { name: "IPC-invoke", re: /ipcRenderer\.invoke/ },
  { name: "网络-axios", re: /axios/ },
  { name: "网络-socket.io", re: /socket\.io|io\(/ },
  { name: "网络-请求池", re: /p-limit|pLimit|concurrency/ },
  { name: "任务队列", re: /queue|TaskQueue|concurrency/ },
  { name: "重试机制", re: /retry|retries|maxRetries/ },
  { name: "定时任务", re: /cron|schedule|setInterval/ },
  { name: "日志", re: /logger|log4js|winston|pino/ },
  { name: "配置存储", re: /electron-store|conf\.set|store\.set/ },
  { name: "数据库-sqlite", re: /sqlite|better-sqlite3/ },
  { name: "数据库-leveldb", re: /leveldb|LevelDB/ },
  { name: "AI-调用", re: /openai|qwen|deepseek|chatgpt|gpt-/ },
  { name: "视频处理", re: /ffmpeg|fluent-ffmpeg/ },
  { name: "图片处理", re: /sharp|jimp|canvas/ },
  { name: "加解密", re: /crypto\.(createCipher|createHash|createHmac)|AES|RSA/ },
];

// 统计每个模块命中的特征
const rows = [];
for (const mod of modules) {
  const hits = FEATURES.filter((f) => f.re.test(mod.body)).map((f) => f.name);
  if (hits.length > 0) {
    rows.push({
      id: mod.id,
      kb: (mod.bytes / 1024).toFixed(1),
      lines: mod.endLine - mod.startLine,
      hits,
    });
  }
}

console.log(`\n=== 命中特征的模块数: ${rows.length} / ${modules.length} ===\n`);

// 全局特征统计
const globalStats = new Map();
for (const r of rows) {
  for (const h of r.hits) globalStats.set(h, (globalStats.get(h) || 0) + 1);
}
console.log("=== 全局技术点分布（按模块数）===");
[...globalStats.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));

// 输出明细
const out = path.join(
  "D:\\Data\\projects\\rea\\analysis\\refproduct-modules.json",
);
fs.writeFileSync(out, JSON.stringify(rows, null, 2), "utf8");
console.log(`\n明细已写入: ${out}`);
