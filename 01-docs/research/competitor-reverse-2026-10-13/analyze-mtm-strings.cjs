/**
 * 解析 MediaTaskMgr.dll 的完整字符串清单（REA search 输出）
 * 分类归并，产出结构化结论
 */
const fs = require("node:fs");

const SRC = "D:\\Data\\projects\\rea\\analysis\\mtm-strings-all.json";
const OUT = "D:\\Data\\projects\\rea\\analysis\\mtm-strings-analysis.md";

const raw = fs.readFileSync(SRC, "utf8");
const json = JSON.parse(raw);
const items = json.raw_result ?? json.normalized_result ?? [];
console.log(`字符串总数: ${items.length}`);

const values = items.map((i) => i.value).filter((v) => typeof v === "string");

// ─── 分类规则 ───
const CATEGORIES = [
  {
    key: "任务类型（task registry）",
    re: /^[a-z_]*task[a-z_]*$|_task_|task_/i,
  },
  { key: "ffmpeg 操作", re: /ffmpeg/i },
  { key: "视频处理", re: /video|mp4|h264|h265|codec|encode|decode|transcode|clip|trim|merge|concat|watermark|subtitle/i },
  { key: "音频处理", re: /audio|mp3|aac|wav|voice|tts|peiyin|volume|mix/i },
  { key: "图片处理", re: /image|img|jpg|jpeg|png|webp|thumb|crop|cover|canvas/i },
  { key: "平台名", re: /douyin|kuaishou|bilibili|xiaohongshu|weixin|weibo|zhihu|toutiao|baijiahao|sohu|163|dayu|qie|yidian|acfun|meipai|miaopai|iqiyi|csdn|jianshu|douban|dewu|xueqiu/i },
  { key: "HTTP/API", re: /^https?:\/\/|\.com|\.cn|api|url|request|response|header|cookie|token|upload|download/i },
  { key: "文件/路径", re: /\.(dll|exe|json|txt|ini|log|tmp|dat|db|xml|zip|bak|cfg)$|\\|\//i },
  { key: "配置项", re: /^(cfg|config|setting|option|param|arg|env)_/i },
  { key: "日志/错误", re: /error|fail|warn|debug|trace|exception|assert|invalid|denied|timeout/i },
  { key: "线程/同步", re: /thread|mutex|lock|critical|semaphore|event|wait|signal|atomic/i },
  { key: "内存/资源", re: /alloc|free|new |delete|memory|buffer|pool|cache|heap/i },
  { key: "COM/接口", re: /IUnknown|IDispatch|QueryInterface|GUID|CLSID|CoCreate|COM /i },
  { key: "SQL/存储", re: /sqlite|select |insert |update |delete from|table|db_/i },
];

const buckets = new Map();
for (const c of CATEGORIES) buckets.set(c.key, []);
const uncategorized = [];

for (const v of values) {
  let placed = false;
  for (const c of CATEGORIES) {
    if (c.re.test(v)) {
      buckets.get(c.key).push(v);
      placed = true;
    }
  }
  if (!placed) uncategorized.push(v);
}

const out = [];
const w = (s) => out.push(s);

w("# MediaTaskMgr.dll 字符串清单分析");
w("");
w(`> 来源：REA \`search .{4,} --kind strings\` on \`MediaTaskMgr.dll\``);
w(`> 字符串总数：**${items.length}**`);
w(`> 生成时间：${new Date().toISOString()}`);
w("");
w("---");
w("");
w("## 分类统计");
w("");
w("| 类别 | 数量 |");
w("|---|---|");
for (const [k, v] of buckets) w(`| ${k} | ${v.length} |`);
w(`| （未分类） | ${uncategorized.length} |`);

// ─── 任务类型详情（最有价值）───
w("");
w("---");
w("");
w("## ⭐ 任务类型注册表（原生任务调度器的核心）");
w("");
const taskStrs = [...new Set(values.filter((v) => /task/i.test(v) && v.length < 120))].sort();
w(`共 ${taskStrs.length} 条含 "task" 的字符串：`);
w("");
w("```");
taskStrs.forEach((t) => w(t));
w("```");

// ─── ffmpeg ───
w("");
w("## ffmpeg 相关（原生层直接操作）");
w("");
const ffStrs = [...new Set(values.filter((v) => /ffmpeg/i.test(v)))].sort();
w(`共 ${ffStrs.length} 条：`);
w("");
w("```");
ffStrs.forEach((t) => w(t));
w("```");

// ─── 视频/音频/图片操作 ───
for (const [title, key] of [["视频处理相关", "视频处理"], ["音频处理相关", "音频处理"], ["图片处理相关", "图片处理"]]) {
  const list = [...new Set(buckets.get(key))].sort();
  w("");
  w(`## ${title}（${list.length} 条，节选前 80）`);
  w("");
  w("```");
  list.slice(0, 80).forEach((t) => w(t.slice(0, 160)));
  w("```");
}

// ─── 平台名 ───
w("");
w("## 平台相关字符串");
w("");
const platStrs = [...new Set(buckets.get("平台名"))].sort();
w(`共 ${platStrs.length} 条（节选前 80）：`);
w("");
w("```");
platStrs.slice(0, 80).forEach((t) => w(t.slice(0, 160)));
w("```");

// ─── URL ───
w("");
w("## URL / API 端点");
w("");
const urlStrs = [...new Set(values.filter((v) => /^https?:\/\//i.test(v)))].sort();
w(`共 ${urlStrs.length} 条：`);
w("");
w("```");
urlStrs.forEach((t) => w(t));
w("```");

// ─── 错误/日志格式串（反映内部结构）───
w("");
w("## 错误/日志格式串（反映内部设计）");
w("");
const errStrs = [...new Set(buckets.get("日志/错误"))].filter((v) => v.length > 8).sort();
w(`共 ${errStrs.length} 条（节选前 60）：`);
w("");
w("```");
errStrs.slice(0, 60).forEach((t) => w(t.slice(0, 160)));
w("```");

// ─── 配置项 ───
w("");
w("## 配置键（反映可调参数）");
w("");
const cfgStrs = [...new Set(values.filter((v) => /^[a-z][a-z0-9_]*(size|count|timeout|limit|max|min|level|path|dir|retry|thread|buffer|quality|fps|bitrate|resolution|width|height)$/i.test(v)))].sort();
w(`共 ${cfgStrs.length} 条：`);
w("");
w("```");
cfgStrs.forEach((t) => w(t));
w("```");

fs.writeFileSync(OUT, out.join("\n"), "utf8");
console.log(`\n写入: ${OUT}`);
console.log(`行数: ${out.length}`);
console.log(`\n关键统计:`);
console.log(`  含 task 串: ${taskStrs.length}`);
console.log(`  ffmpeg 串: ${ffStrs.length}`);
console.log(`  URL: ${urlStrs.length}`);
console.log(`  平台串: ${platStrs.length}`);
