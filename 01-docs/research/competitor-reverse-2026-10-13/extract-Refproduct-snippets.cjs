/**
 * 提取参考产品关键模块的具体实现代码片段
 * 针对高复用价值的技术点，输出可读代码片段
 */
const fs = require("node:fs");
const path = require("node:path");

const BUNDLE = path.join(
  "D:\\Temp\\rea-extracted-e6351f4c-9ad7-4b5e-a8cc-96ac16bf5f8a\\packages\\main\\dist\\index.cjs",
);
const OUT = "D:\\Data\\projects\\rea\\analysis\\refproduct-snippets.txt";

const text = fs.readFileSync(BUNDLE, "utf8");
const lines = text.split(/\r?\n/);

// webpack 模块切分
const starts = [];
lines.forEach((line, i) => {
  const m = /^\/\*\*\*\/ (\d+):/.exec(line);
  if (m) starts.push({ id: m[1], line: i });
});
const moduleMap = new Map();
for (let i = 0; i < starts.length; i++) {
  const start = starts[i].line;
  const end = i + 1 < starts.length ? starts[i + 1].line : lines.length;
  moduleMap.set(starts[i].id, lines.slice(start, end).join("\n"));
}

const out = [];
const w = (s) => out.push(s);

function extractAround(body, regex, before = 3, after = 25, label = "") {
  const bl = body.split("\n");
  const results = [];
  bl.forEach((line, i) => {
    if (regex.test(line)) {
      const s = Math.max(0, i - before);
      const e = Math.min(bl.length, i + after);
      results.push({ at: i + 1, chunk: bl.slice(s, e).join("\n") });
    }
  });
  return results;
}

// ============ 1. UA 伪装实现 ============
w("################ 1. UA 伪装（User-Agent 伪装）################\n");
const uaMods = ["4565", "90673", "51280", "92719", "67318"];
for (const id of uaMods) {
  const body = moduleMap.get(id);
  if (!body) continue;
  w(`\n----- module ${id} (${(Buffer.byteLength(body) / 1024).toFixed(1)} KB) -----`);
  const hits = extractAround(
    body,
    /userAgent|User-Agent|Mozilla|Chrome\/|navigator\.userAgent/,
    2,
    12,
  );
  hits.slice(0, 3).forEach((h) => {
    w(`  [L${h.at}]`);
    h.chunk.split("\n").forEach((l) => w(`    ${l.slice(0, 300)}`));
    w("");
  });
}

// ============ 2. 抖音登录态检测 ============
w("\n\n################ 2. 平台登录态检测（localStorage 轮询）################\n");
{
  const body = moduleMap.get("4658");
  const hits = extractAround(body, /DouYinAuthorizeConfig/, 2, 45);
  hits.slice(0, 1).forEach((h) => {
    w(`[module 4658, L${h.at}]`);
    h.chunk.split("\n").forEach((l) => w(`  ${l.slice(0, 400)}`));
  });
}

// ============ 3. 风控 sleep ============
w("\n\n################ 3. 风控随机延时（sleep）################\n");
for (const id of ["81074", "82926"]) {
  const body = moduleMap.get(id);
  if (!body) continue;
  w(`\n----- module ${id} -----`);
  const hits = extractAround(body, /function sleep|sleep=|random.*sleep|Math\.random\(\).*1000|setTimeout\(resolve/, 3, 10);
  hits.slice(0, 2).forEach((h) => {
    w(`  [L${h.at}]`);
    h.chunk.split("\n").forEach((l) => w(`    ${l.slice(0, 300)}`));
    w("");
  });
}

// ============ 4. 窗口池化复用 ============
w("\n\n################ 4. 窗口池化复用（window pool）################\n");
{
  const body = moduleMap.get("63474");
  const hits = extractAround(body, /pool|reuse/, 2, 18);
  hits.slice(0, 4).forEach((h) => {
    w(`[module 63474, L${h.at}]`);
    h.chunk.split("\n").forEach((l) => w(`  ${l.slice(0, 350)}`));
    w("");
  });
}

// ============ 5. OSS 直传 ============
w("\n\n################ 5. OSS 直传上传 ################\n");
{
  const body = moduleMap.get("4658");
  const hits = extractAround(body, /oss|aliyuncs|sts/, 2, 20);
  hits.slice(0, 3).forEach((h) => {
    w(`[module 4658, L${h.at}]`);
    h.chunk.split("\n").forEach((l) => w(`  ${l.slice(0, 350)}`));
    w("");
  });
}

// ============ 6. 重试机制 ============
w("\n\n################ 6. 重试机制 ################\n");
{
  const body = moduleMap.get("2713");
  const hits = extractAround(body, /retry|retries|maxRetries|backoff/, 3, 15);
  hits.slice(0, 3).forEach((h) => {
    w(`[module 2713, L${h.at}]`);
    h.chunk.split("\n").forEach((l) => w(`  ${l.slice(0, 350)}`));
    w("");
  });
}

// ============ 7. IPC 通道定义 ============
w("\n\n################ 7. IPC 通道（主进程 handler）################\n");
{
  const body = moduleMap.get("63474");
  const hits = extractAround(body, /ipcMain\.handle\(|ipcMain\.on\(/, 1, 3);
  w(`共 ${hits.length} 处 ipcMain 注册`);
  hits.slice(0, 30).forEach((h) => {
    w(`  [L${h.at}] ${h.chunk.split("\n").slice(1, 3).join(" ").slice(0, 250)}`);
  });
}

// ============ 8. AI 调用 ============
w("\n\n################ 8. AI 调用 ################\n");
{
  const body = moduleMap.get("4658");
  const hits = extractAround(body, /openai|qwen|deepseek|chatgpt|gpt-|dashscope/, 2, 12);
  hits.slice(0, 3).forEach((h) => {
    w(`[module 4658, L${h.at}]`);
    h.chunk.split("\n").forEach((l) => w(`  ${l.slice(0, 350)}`));
    w("");
  });
}

fs.writeFileSync(OUT, out.join("\n"), "utf8");
console.log(`written: ${OUT}`);
console.log(`lines: ${out.length}`);
