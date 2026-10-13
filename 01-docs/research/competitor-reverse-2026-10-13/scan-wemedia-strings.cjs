/**
 * 融媒宝 WEMedia.exe 全量字符串特征扫描
 * ASCII + UTF-16LE 双编码，扫全文件
 */
const fs = require("node:fs");

const path = "D:\\Program Files (x86)\\融媒宝\\WEMedia.exe";
const buf = fs.readFileSync(path);
console.log(`文件大小: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

const PATTERNS = [
  // ─── UI 框架 ───
  ["Qt5", "Qt5", "Qt 框架"],
  ["QtCore", "QtCore", "Qt 核心"],
  ["DuiLib", "DuiLib", "DuiLib UI"],
  ["libcef", "libcef", "CEF"],
  ["CefSharp", "CefSharp", "CEF .NET 绑定"],
  ["Electron", "Electron", "Electron"],
  ["duilib", "duilib", "DuiLib"],
  // ─── 音视频 ───
  ["libvlc", "libvlc", "VLC"],
  ["avcodec", "avcodec", "FFmpeg"],
  ["MediaInfo", "MediaInfo", "MediaInfo"],
  ["ffmpeg", "ffmpeg", "FFmpeg CLI"],
  // ─── 网络 ───
  ["OpenSSL", "OpenSSL", "OpenSSL"],
  ["libcurl", "libcurl", "curl"],
  ["WinHTTP", "WinHTTP", "WinHTTP"],
  // ─── 平台 API ───
  ["creator.douyin.com", "creator.douyin.com", "抖音开放平台"],
  ["cp.kuaishou.com", "cp.kuaishou.com", "快手创作者"],
  ["member.bilibili.com", "member.bilibili.com", "B站"],
  ["creator.xiaohongshu.com", "creator.xiaohongshu.com", "小红书"],
  ["mp.weixin.qq.com", "mp.weixin.qq.com", "公众号"],
  ["zhihu.com", "zhihu.com", "知乎"],
  ["weibo.com", "weibo.com", "微博"],
  ["mp.toutiao.com", "mp.toutiao.com", "头条"],
  ["baijiahao", "baijiahao", "百家号"],
  // ─── 上传/CDN ───
  ["aliyuncs.com", "aliyuncs.com", "阿里云 OSS"],
  ["myqcloud.com", "myqcloud.com", "腾讯云 COS"],
  ["vod", "vod.", "腾讯点播"],
  // ─── 存储 ───
  ["sqlite3", "sqlite3", "SQLite"],
  ["leveldb", "leveldb", "LevelDB"],
  ["redis", "redis", "Redis"],
  // ─── 加壳/保护 ───
  ["VMProtect", "VMProtect", "VMProtect 加壳"],
  ["Themida", "Themida", "Themida 加壳"],
  ["WinLicense", "WinLicense", "WinLicense"],
  ["ASPack", "ASPack", "ASPack 加壳"],
  ["UPX", "UPX!", "UPX 加壳"],
  // ─── 编译器 ───
  ["Visual C++", "Visual C++", "MSVC"],
  ["Delphi", "Delphi", "Delphi"],
  ["GCC", "GCC:", "GCC"],
  ["MinGW", "MinGW", "MinGW"],
  // ─── 功能关键词 ───
  ["AI", "chatgpt", "AI-ChatGPT"],
  ["AI2", "openai", "AI-OpenAI"],
  ["AI3", "qwen", "AI-通义千问"],
  ["AI4", "deepseek", "AI-DeepSeek"],
  ["AI5", "文心一言", "AI-文心一言"],
  ["AI6", "讯飞星火", "AI-讯飞星火"],
  ["TTS", "tts", "语音合成"],
  ["ASR", "asr", "语音识别"],
  ["OCR", "ocr", "文字识别"],
  ["混剪", "混剪", "视频混剪"],
  ["字幕", "字幕", "字幕"],
  ["剪辑", "剪辑", "视频剪辑"],
  ["发布", "发布", "发布"],
  ["登录", "登录", "登录"],
  ["cookie", "cookie", "Cookie"],
  ["localStorage", "localStorage", "localStorage"],
  ["sessionStorage", "sessionStorage", "sessionStorage"],
];

function scanAscii(buf, needle) {
  const p = Buffer.from(needle, "ascii");
  return buf.includes(p);
}
function scanUtf16(buf, needle) {
  const p = Buffer.from(needle, "utf16le");
  return buf.includes(p);
}

const results = [];
for (const [key, needle, label] of PATTERNS) {
  const a = scanAscii(buf, needle);
  const u = scanUtf16(buf, needle);
  if (a || u) results.push({ label, needle, enc: a && u ? "ASCII+UTF16" : a ? "ASCII" : "UTF16" });
}

console.log(`\n命中 ${results.length} / ${PATTERNS.length} 个特征:\n`);
const groups = {
  "UI 框架": ["DuiLib UI", "CEF", "CEF .NET 绑定", "Electron", "Qt 框架", "Qt 核心"],
  "音视频": ["VLC", "FFmpeg", "FFmpeg CLI", "MediaInfo"],
  "网络": ["OpenSSL", "curl", "WinHTTP"],
  "平台 API": ["抖音开放平台", "快手创作者", "B站", "小红书", "公众号", "知乎", "微博", "头条", "百家号"],
  "上传/CDN": ["阿里云 OSS", "腾讯云 COS", "腾讯点播"],
  "存储": ["SQLite", "LevelDB", "Redis"],
  "加壳/保护": ["VMProtect 加壳", "Themida 加壳", "WinLicense", "ASPack 加壳", "UPX 加壳"],
  "编译器": ["MSVC", "Delphi", "GCC", "MinGW"],
  "AI 能力": ["AI-ChatGPT", "AI-OpenAI", "AI-通义千问", "AI-DeepSeek", "AI-文心一言", "AI-讯飞星火", "语音合成", "语音识别", "文字识别"],
  "功能关键词": ["视频混剪", "字幕", "视频剪辑", "发布", "登录", "Cookie", "localStorage", "sessionStorage"],
};
for (const [g, labels] of Object.entries(groups)) {
  const hits = results.filter((r) => labels.includes(r.label));
  if (hits.length === 0) continue;
  console.log(`【${g}】`);
  hits.forEach((h) => console.log(`   ${h.label.padEnd(18)} "${h.needle}"  [${h.enc}]`));
}

// ─── 提取可读的 ASCII 字符串样本 ───
console.log(`\n\n${"=".repeat(70)}`);
console.log("【可读字符串样本】（长度>=8 的 ASCII 串，前 120 个含中文/关键词的）");
console.log("=".repeat(70));
const runs = [];
let cur = [];
for (let i = 0; i < buf.length; i++) {
  const c = buf[i];
  if (c >= 0x20 && c <= 0x7e) {
    cur.push(String.fromCharCode(c));
  } else {
    if (cur.length >= 8) runs.push(cur.join(""));
    cur = [];
  }
  if (runs.length > 200000) break;
}
if (cur.length >= 8) runs.push(cur.join(""));

const interesting = runs.filter((s) =>
  /douyin|kuaishou|bilibili|xiaohongshu|weixin|zhihu|weibo|toutiao|baijia|sohu|163|qq\.com|aliyun|myqcloud|oss|cos|upload|publish|login|cookie|token|api|http|混剪|剪辑|字幕|发布|登录|视频|文章|图文/i.test(s),
);
console.log(`总 ASCII 串: ${runs.length}，其中含关键词: ${interesting.length}`);
console.log(`\n--- URL / 域名（去重，前 60）---`);
const urls = [...new Set(interesting.filter((s) => /^https?:\/\//i.test(s)).map((s) => s.slice(0, 120)))];
urls.slice(0, 60).forEach((u) => console.log(`  ${u}`));

console.log(`\n--- 含中文的可读串（前 40）---`);
// UTF-16LE 中文
const zhRuns = [];
{
  let cur2 = [];
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf[i] | (buf[i + 1] << 8);
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x20 && code <= 0x7e)) {
      cur2.push(String.fromCharCode(code));
    } else {
      if (cur2.length >= 4) zhRuns.push(cur2.join(""));
      cur2 = [];
    }
  }
}
const zhInteresting = zhRuns.filter((s) => /[\u4e00-\u9fff]{2,}/.test(s) && s.length >= 4);
console.log(`UTF-16 含中文串: ${zhInteresting.length}`);
[...new Set(zhInteresting)].slice(0, 40).forEach((s) => console.log(`  ${s.slice(0, 100)}`));
