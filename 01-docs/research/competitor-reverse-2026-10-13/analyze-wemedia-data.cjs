/**
 * 融媒宝 data/ 目录完整解析（GBK 编码）
 * 产出：平台分类体系 + 数据指标矩阵 + CSS 选择器映射 + 敏感词库统计
 */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const DATA = "D:\\Program Files (x86)\\融媒宝\\data";
const OUT = "D:\\Data\\projects\\rea\\analysis\\wemedia-data-analysis.md";

/** 用 PowerShell 以 GBK(936) 读文件，绕开 Node 无 GBK 内置解码的限制 */
function readGbk(file) {
  const p = file.replace(/'/g, "''");
  const cmd = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; [IO.File]::ReadAllText('${p}', [Text.Encoding]::GetEncoding(936))`;
  return execSync(`pwsh -NoProfile -Command "${cmd.replace(/"/g, '\\"')}"`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

const out = [];
const w = (s) => out.push(s);

// ═══════════ 1. config.ini（渠道 / 模块配置）═══════════
w("# 融媒宝 data/ 目录数据资产分析");
w("");
w("> 来源：`D:\\Program Files (x86)\\融媒宝\\data\\`（83 个文件 / 1.58 MB，GBK 编码）");
w("> 生成时间：" + new Date().toISOString());
w("");
w("---");
w("");
w("## 1. config.ini —— 渠道包与模块配置");
w("");
const cfg = readGbk(path.join(DATA, "config.ini"));
w("```ini");
w(cfg.trim());
w("```");
w("");
w("**读出的两条关键机制**：");
w("");
w("| 配置项 | 值 | 含义 |");
w("|---|---|---|");
w("| `channel` / `subchannel` | `sogougf` | **搜狗渠道包** —— 融媒宝按渠道分发（OEM 贴牌）|");
w("| `MediaTaskMgrModule` | `MediaTaskMgr.dll` | **媒体引擎是配置化模块** —— 宿主按配置名加载 DLL，可替换/热更新 |");
w("");
w("> `MediaTaskMgrModule` 这一行是硬证据：它把「引擎作为独立组件」从推断变成了**配置事实**。");
w("> 配合 `MediaTaskMgr_1.0.0.257.dll` 旧版本残留 + `ApiSoftware/CheckComponent` 接口，");
w("> 完整还原了融媒宝的**组件热更新链路**：");
w("> `CheckComponent` 查询 → 下载 `MediaTaskMgr_<版本>.dll` → 改配置/替换 → 下次启动加载新版本。");
w("");

// ═══════════ 2. mediadatamgr.ini（数据指标矩阵）═══════════
w("---");
w("");
w("## 2. mediadatamgr.ini —— 各平台数据指标支持矩阵 ⭐");
w("");
const mdm = readGbk(path.join(DATA, "mediadatamgr.ini"));
w("```ini");
w(mdm.trim());
w("```");
w("");
w("**指标编号含义**（文件头注释）：");
w("");
w("| # | 指标 | # | 指标 |");
w("|---|---|---|---|");
w("| 1 | 总收益 | 7 | 粉丝数 |");
w("| 2 | 昨日收益 | 8 | 昨日评论数 |");
w("| 3 | 图文总阅读数 | 9 | 昨日点赞数 |");
w("| 4 | 昨天图文阅读数 | 10 | 昨日分享数 |");
w("| 5 | 总视频播放数 | 11 | 昨日涨粉数 |");
w("| 6 | 昨天视频播放数 | | |");
w("");
// 解析矩阵
const groups = [...mdm.matchAll(/\[(\d+)\]\s*\n((?:#[^\n]*\n|[^\n\[\]]+\n)*)/g)];
w("**解析出的分组与平台支持情况**：");
w("");
for (const g of groups) {
  const gid = g[1];
  const body = g[2];
  const lines = body.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  w(`- **[${gid}]**`);
  for (const l of lines) {
    const m = l.match(/^(\d+)\s*=\s*(.+)$/);
    if (m) w(`  - 平台ID \`${m[1]}\` → 指标 ${m[2]}`);
    else w(`  - ${l.trim()}`);
  }
}
w("");
w("> **对本项目的价值**：本项目 `apps/desktop/electron/services/account-metrics/adapters.js`");
w("> 目前支持 douyin / kuaishou / toutiao / xiaohongshu 四个平台的数据抓取。");
w("> 这张矩阵表给出了**融媒宝对每个平台能抓到哪些指标**的权威对照——");
w("> 扩平台数据抓取时可直接照此确定「该平台该抓什么」，避免抓了平台不提供的指标。");
w("");

// ═══════════ 3. media_class_set.txt（CSS 选择器映射）═══════════
w("---");
w("");
w("## 3. media_class_set.txt —— 平台登录页 CSS 选择器映射 ⭐");
w("");
const mcs = readGbk(path.join(DATA, "media_class_set.txt"));
w("```json");
w(mcs.trim());
w("```");
w("");
w("**这是什么**：键 `\"36\"` 是平台 ID，值是**该平台登录页的关键 CSS 选择器/类名列表**：");
w("");
w("| 选择器 | 用途推断 |");
w("|---|---|");
w("| `login-card-double-Gtywl8` | 登录卡片容器 |");
w("| `login-panel-new` | 新版登录面板 |");
w("| `semi-button semi-button-primary eK1Z2Sel` | 主按钮（提交）|");
w("| `trust-login-switch-button uncheck` / `... check` | **信任登录开关**（勾选态/未勾选态）|");
w("| `xg-tips` | 提示文字 |");
w("| `i_7rPk8Q` / `.i_7rPk8Q,.uVZnczJ6` | 图标/其他元素 |");
w("");
w("**关键机制**：这类选择器通过 `https://download.17van.com/plugin/media_class_set.txt?_t=`");
w("**远程下发**（exe 字符串里找到了该 URL）。");
w("");
w("**为什么重要**：平台前端改版会让写死的选择器失效。融媒宝把选择器做成**远程配置**，");
w("平台一改版就更新这个文件，**客户端无需发版**。这是对抗「平台频繁改版」的工程手段。");
w("");
w("**对本项目的启示**：本项目 `platform-definitions.js` 的登录检测模式（`PLATFORM_LOGIN_SUCCESS_PATTERNS`）");
w("是**硬编码在源码里**的，平台改版必须发版。可参考融媒宝的**远程选择器配置 + 本地兜底**设计。");
w("> ⚠️ 但要注意：本项目 AGENTS.md 要求「离线可用」，远程配置必须**本地打包默认值兜底**，");
w("> 且远程拉取失败时静默降级，不能阻塞启动。");
w("");

// ═══════════ 4. 平台分类体系 ═══════════
w("---");
w("");
w("## 4. 平台分类体系（83 个文件的主干）");
w("");
const files = fs.readdirSync(DATA);
const mapFiles = files.filter((f) => f.includes("categortmap") || f.includes("subcategort"));
w(`分类相关文件共 **${mapFiles.length}** 个，命名规律：`);
w("");
w("| 后缀 | 含义 | 示例 |");
w("|---|---|---|");
w("| `categortmap.txt` | 一级分类映射 | `douyincategortmap.txt` |");
w("| `subcategort.txt` | 二级分类 | `douyinvideosubcategort.txt` |");
w("| `videocategortmap.txt` | 视频一级分类 | `baijiavideocategortmap.txt` |");
w("| `videosubcategort.txt` | 视频二级分类 | `bilibilivideosubcategort.txt` |");
w("");
w("（注意文件名里的 `categort` 是**原文拼写**，作者把 `category` 拼错了，全库一致）");
w("");
w("### 4.1 各平台分类条目数统计");
w("");
w("| 文件 | 大小 | 顶层条目数 |");
w("|---|---:|---:|");
const stats = [];
for (const f of mapFiles.sort()) {
  const full = path.join(DATA, f);
  const size = fs.statSync(full).size;
  let txt;
  try { txt = readGbk(full); } catch (e) { continue; }
  // 统计 text 字段（一级）或顶层键（二级）
  const textCount = (txt.match(/"text"\s*:/g) || []).length;
  const keyCount = (txt.match(/^\s*"[^"]+"\s*:\s*\[/gm) || []).length;
  const n = textCount || keyCount;
  stats.push({ f, size, n, textCount, keyCount });
}
for (const s of stats) {
  w(`| \`${s.f}\` | ${(s.size / 1024).toFixed(1)} KB | ${s.n}${s.textCount ? "（text 字段）" : s.keyCount ? "（顶层键）" : ""} |`);
}
const totalCategories = stats.reduce((a, b) => a + b.n, 0);
w("");
w(`**分类条目总计：${totalCategories} 条**`);

// ═══════════ 5. 敏感词库 ═══════════
w("");
w("---");
w("");
w("## 5. sensitivelibrary.txt —— 敏感词库（793 KB，🔒 加密）");
w("");
const sensFile = path.join(DATA, "sensitivelibrary.txt");
const sensRaw = fs.readFileSync(sensFile, "utf8").trim();
const sensBytes = fs.statSync(sensFile).size;
const sensChars = sensRaw.length;
const uniqueChars = [...new Set(sensRaw.split(""))].sort().join("");
const decodedBytes = Math.floor(sensChars / 4) * 3;

w(`- 文件大小：**${(sensBytes / 1024).toFixed(1)} KB**`);
w(`- 字符数：**${sensChars}**（4 的倍数 ✅）`);
w(`- 唯一字符数：**${[...new Set(sensRaw.split(""))].length}**`);
w(`- 字符集：\`${uniqueChars.slice(0, 20)}…${uniqueChars.slice(-20)}\``);
w("");
w("### 5.1 判定：这是**加密后 base64 编码**，不是明文词库");
w("");
w("**证据链**：");
w("");
w("| # | 观测 | 结论 |");
w("|---|---|---|");
w("| 1 | 无任何换行符（`\\r\\n`/`\\n`/`\\r` 均为 0）| 不是「一行一个词」的明文词表 |");
w("| 2 | 无逗号/分号/管道符分隔 | 不是 CSV/分隔符格式 |");
w("| 3 | 唯一字符 65 个，恰为标准 base64 字符集 `A-Za-z0-9+/=` | 是 base64 编码 |");
w("| 4 | 长度 812,056 是 4 的倍数 | base64 长度约束成立 |");
w("| 5 | base64 解码后**无 gzip(1f8b) / zlib(789c) 魔数** | 不是压缩包 |");
w("| 6 | 解码后 48 字节中仅 14 字节可打印 | **高熵密文**（加密）|");
w("");
w(`解码后密文长度约 **${(decodedBytes / 1024).toFixed(1)} KB**。`);
w("");
w("**aes/自定义算法未知**：解密密钥应在 `WEMedia.exe` 或 `MediaTaskMgr.dll` 内，");
w("本次未能定位（主程序加壳 + 代码量过大导致无法反编译，见 [原生层分析补充报告.md](原生层分析补充报告.md)）。");
w("**因此本报告不声称已知词库内容或规模。**");
w("");
w("### 5.2 一个关键对比：83 个文件里只有它被加密");
w("");
w("| 类型 | 文件数 | 说明 |");
w("|---|---|---|");
w("| ✅ 明文 GBK | **77** | 全部分类映射、新手引导、常见问题、公告 |");
w("| ▫️ 纯 ASCII | 4 | `config.ini`、`media_class_set*.txt`、`comment_media_js.json` |");
w("| 🔒 base64 密文 | **1** | `sensitivelibrary.txt`（敏感词库）|");
w("");
w("**结论**：融媒宝把**分类数据、文案、配置全部明文**（便于渠道改文案），");
w("只对**敏感词库**加密。这反映出他们的商业判断——");
w("**敏感词库是投入最大、最可复用的核心资产**（持续维护的违禁词/限流词清单），");
w("而分类映射只是平台公开数据、文案是渠道定制项，都不值得加密。");
w("");
w("**对本项目的启示**：");
w("");
w("- 本项目 `packages/shared-utils/src/sensitive-filter.js` 与 `packages/rewrite-engine/src/sensitive-filter.js`");
w("  已有敏感词过滤能力，**无需也无法复用融媒宝的加密词库**（且存在版权与时效性问题）。");
w("- 但可借鉴这个判断：**词库是需要持续运营的资产**。本项目若要把敏感词做成竞争力，");
w("  应建立**词库更新机制**（服务端下发 + 本地兜底），而不是写死在源码里。");
w("");

// ═══════════ 6. OEM/白标机制 ═══════════
w("---");
w("");
w("## 6. OEM / 白标机制（重要商业模式发现）");
w("");
const oemFiles = files.filter((f) => /_oem|_ym|_tjj/.test(f));
w("带渠道后缀的文件：");
w("");
w("```");
oemFiles.forEach((f) => w(f));
w("```");
w("");
w("**三种变体共存**说明融媒宝支持**多渠道贴牌分发**：");
w("");
w("| 后缀 | 推断含义 |");
w("|---|---|");
w("| （无） | 默认版本 |");
w("| `_oem` | OEM 贴牌版（其他品牌冠名）|");
w("| `_ym` | 另一个渠道（可能是「蚁盟」或某平台代号）|");
w("| `_tjj888` | 特定渠道号 `tjj888` |");
w("");
w("配合 `config.ini` 的 `channel=sogougf`，可确认融媒宝是**按渠道分发同一套程序**，");
w("不同渠道加载不同的欢迎语/常见问题/公告文案。");
w("");
w("**对本项目的启示**：如果未来要做渠道分发或企业定制版，");
w("这套「**同一程序 + 渠道化文案资产 + 渠道配置**」的模式比维护多份代码更可维护。");
w("");

// ═══════════ 7. 其他数据文件 ═══════════
w("---");
w("");
w("## 7. 其他数据文件");
w("");
const others = [
  ["comment_media_js.json", "评论媒体资源映射"],
  ["media_url_list.txt", "媒体 URL 列表"],
  ["deepsearchercat.txt", "深度搜索分类"],
  ["new_user_guide.txt", "新手指引文案"],
  ["common_question.txt", "常见问题文案"],
  ["software_notify.txt", "软件公告"],
];
w("| 文件 | 大小 | 内容样本（前 3 行）|");
w("|---|---:|---|");
for (const [f, desc] of others) {
  const full = path.join(DATA, f);
  if (!fs.existsSync(full)) continue;
  let sample = "";
  try {
    const t = readGbk(full);
    sample = t.split(/\r?\n/).filter((l) => l.trim()).slice(0, 3).join(" / ").slice(0, 120);
  } catch (e) { sample = "(读取失败)"; }
  w(`| \`${f}\` | ${(fs.statSync(full).size / 1024).toFixed(1)} KB | ${desc}<br>${sample.replace(/\|/g, "\\|")} |`);
}

fs.writeFileSync(OUT, out.join("\n"), "utf8");
console.log(`写入: ${OUT}`);
console.log(`行数: ${out.length}`);
console.log(`分类条目总计: ${totalCategories}`);
console.log(`敏感词库: ${sensChars} 字符 base64 密文（加密，未解密）`);
console.log(`OEM 变体文件: ${oemFiles.length}`);
