/**
 * 融媒宝前端功能模块 API 全清册提取
 * 从 request.js / Ajax*.js 中提取：中文注释 + 函数名 + 端点
 */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ASSET = "D:\\Program Files (x86)\\融媒宝\\Asset";
const OUT = "D:\\Data\\projects\\rea\\analysis\\wemedia-feature-apis.md";

/**
 * 编码处理说明（重要发现）：
 *   融媒宝**混用两种编码** ——
 *     · Asset 下的 .js / .html  → **UTF-8**（无 BOM）
 *     · data 下的 .txt          → **GBK(936)**
 *   实测：把 UTF-8 的 request.js 按 GBK 解码，`产品卖点` 会变成 `浜у搧鍗栫偣`。
 *   所以这里对 JS 直接按 UTF-8 读取。
 */
function readUtf8(file) {
  return fs.readFileSync(file, "utf8");
}

/**
 * GBK 文件（data 目录）走「PowerShell 转存 UTF-8 临时文件」再由 Node 读回，
 * 避免 stdout 管道被控制台代码页二次编码。
 */
const TMP_DIR = path.join(process.env.TEMP || "/tmp", "rea-gbk-cache");
let tmpSeq = 0;
function readGbk(file) {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const tmp = path.join(TMP_DIR, `gbk-${process.pid}-${tmpSeq++}.txt`);
  const src = file.replace(/'/g, "''");
  const dst = tmp.replace(/'/g, "''");
  execSync(
    `pwsh -NoProfile -Command "[IO.File]::WriteAllText('${dst}', [IO.File]::ReadAllText('${src}', [Text.Encoding]::GetEncoding(936)), [Text.UTF8Encoding]::new($false))"`,
    { stdio: "ignore" },
  );
  const txt = fs.readFileSync(tmp, "utf8");
  try { fs.unlinkSync(tmp); } catch (e) { /* 忽略清理失败 */ }
  return txt;
}

/** 解析一个 request/Ajax 文件，抽出 {注释, 函数名, 端点, 方法} */
function parseApiFile(file) {
  let src;
  try { src = readUtf8(file); } catch (e) { return []; }
  const lines = src.split(/\r?\n/);
  const apis = [];
  let pendingComment = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cm = line.match(/^\s*\/\/\s*(.+?)\s*$/);
    if (cm) { pendingComment = cm[1]; continue; }

    // 形式 A：Ajax("https://...", ...) 或 Ajax(baseUrl("/x"), ...)
    const aj = line.match(/Ajax(?:File|Qn)?\(\s*(baseUrl\()?\s*["']([^"']+)["']/);
    if (aj) {
      // 向前找函数名（最近的一个 `name: function` 或 `name = function` 或 `function name`）
      let fname = null;
      for (let k = i; k >= Math.max(0, i - 14); k--) {
        const fm = lines[k].match(/^\s*([A-Za-z_$][\w$]*)\s*[:=]\s*(?:function|\()/) ||
                   lines[k].match(/^\s*function\s+([A-Za-z_$][\w$]*)/);
        if (fm) { fname = fm[1]; break; }
      }
      // 方法
      const mm = src.slice(src.indexOf(aj[0]), src.indexOf(aj[0]) + 600).match(/["'](POST|GET)["']/i);
      const prefix = aj[1] ? "interface.17van.com" : "";
      apis.push({
        comment: pendingComment,
        fn: fname,
        url: prefix ? prefix + aj[2] : aj[2],
        method: mm ? mm[1].toUpperCase() : "?",
        file: path.basename(file),
      });
      pendingComment = null;
      continue;
    }
    if (line.trim() && !line.trim().startsWith("*") && !line.trim().startsWith("/*") && !cm) {
      // 函数定义行（`name: function` / `name = function` / `function name`）保留悬挂注释，
      // 因为注释在函数定义之前、Ajax 调用在函数体内，中间隔着这一行
      const isFnDef = /^\s*(?:[A-Za-z_$][\w$]*\s*[:=]\s*(?:function|\()|function\s+[A-Za-z_$][\w$]*)/.test(line);
      // 纯括号/分隔行也保留
      const isPunct = /^\s*[})\],;]*\s*$/.test(line);
      if (!isFnDef && !isPunct) pendingComment = null;
    }
  }
  return apis;
}

// 功能模块 → 说明
const MODULES = [
  { dir: "dist/view-ai-writing", name: "AI 写作", desc: "一键生成/改写文章" },
  { dir: "dist/view-ai-clip", name: "AI 剪辑", desc: "智能视频剪辑" },
  { dir: "dist/view-smart-clip", name: "智能混剪", desc: "镜头/素材/字幕合成" },
  { dir: "dist/view-dy-interaction", name: "抖音互动", desc: "评论 + 私信运营" },
  { dir: "dist/view-dy-rules", name: "自动回复规则", desc: "关键词回复策略" },
  { dir: "dist/view-dy-analysis", name: "抖音数据分析", desc: "账号/视频/直播/粉丝数据" },
  { dir: "dist/view-quick-reply", name: "快捷回复", desc: "话术库" },
  { dir: "dist/view-xhs-template", name: "小红书模板", desc: "图文模板生成" },
  { dir: "dist/view-work-analysis", name: "作品分析", desc: "全平台作品数据" },
  { dir: "dist/view-dy-publicize", name: "抖音推广", desc: "内容推广" },
  { dir: "AgComment", name: "评论管理", desc: "评论聚合与回复" },
];

const out = [];
const w = (s) => out.push(s);

w("# 融媒宝前端功能模块 API 全清册");
w("");
w("> 来源：`D:\\Program Files (x86)\\融媒宝\\Asset\\`（266 个 JS，多为未压缩，GBK 编码）");
w("> 提取方式：解析各模块 `request.js` / `Ajax*.js` 的 `Ajax(url, ...)` 调用 + 中文注释");
w("> 生成时间：" + new Date().toISOString());
w("");
w("---");
w("");
w("## 认证机制（所有模块共用）");
w("");
w("```javascript");
w("xhr.setRequestHeader(\"loginToken\", interface.loginInfo.logintoken)");
w("```");
w("");
w("所有业务请求都带 **`loginToken` 请求头**（融媒宝自有服务端 token，非平台 token）。");
w("token 来源：`localStorage['AICLIPLOGIN']` 或 `sessionStorage['loginInfo']`，");
w("由原生层通过 `LoginUserChange(logintoken, uid, usertype, ...)` 注入。");
w("");
w("统一错误处理：响应 `code == 10010` → 调用 `window.JsAuthAccountInvalidate(id)`");
w("**通知原生层「账号授权已失效」**（JS → C++ 反向回调）。");
w("");
w("---");
w("");
w("## 数据格式观察：混用两种字符编码");
w("");
w("分析过程中实测发现的编码分布：");
w("");
w("| 位置 | 编码 | 证据 |");
w("|---|---|---|");
w("| `Asset/` 下 .js / .html | **UTF-8**（无 BOM）| 按 UTF-8 读取中文注释正常 |");
w("| `data/` 下 .txt / .ini | **GBK(936)** | 按 UTF-8 读会出现 `⟨U+FFFD×2⟩ֲ⟨U+FFFD×2⟩` 类替换字符 |");
w("");
w("**踩坑记录**：把 UTF-8 的 `request.js` 按 GBK 解码，`产品卖点` 会变成 `浜у搧鍗栫偣`");
w("（UTF-8 字节被按 GBK 解读的典型双重编码）。两类文件必须分别处理。");
w("");
w("**对本项目的参考**：本项目源码统一 UTF-8（有编码门禁），");
w("不存在这个问题。若将来导入第三方数据文件（如平台分类表），需先探测编码。");
w("");
w("---");
w("");

let totalApis = 0;
const allApis = [];

for (const m of MODULES) {
  const dir = path.join(ASSET, m.dir);
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir, { recursive: true })
    .filter((f) => /\.js$/i.test(f) && !/\.min\./i.test(f))
    .map((f) => path.join(dir, f))
    .filter((f) => fs.statSync(f).size < 200 * 1024)
    .filter((f) => /request|Ajax|client|api/i.test(path.basename(f)));

  const apis = [];
  for (const f of files) apis.push(...parseApiFile(f));
  if (apis.length === 0) continue;

  totalApis += apis.length;
  allApis.push({ module: m, apis });

  w(`## ${m.name}（${apis.length} 个接口）`);
  w("");
  w(`> ${m.desc} · 目录 \`${m.dir}\``);
  w("");
  w("| # | 功能（源码注释）| 函数 | 方法 | 端点 |");
  w("|---|---|---|---|---|");
  apis.forEach((a, i) => {
    w(`| ${i + 1} | ${(a.comment || "—").replace(/\|/g, "\\|")} | \`${a.fn || "?"}\` | ${a.method} | \`${a.url}\` |`);
  });
  w("");
}

// ═══ 汇总 ═══
w("---");
w("");
w("## 汇总");
w("");
w(`**共提取 ${totalApis} 个前端接口**，分布在 ${allApis.length} 个功能模块。`);
w("");
w("| 模块 | 接口数 |");
w("|---|---:|");
for (const g of allApis.sort((a, b) => b.apis.length - a.apis.length)) {
  w(`| ${g.module.name} | ${g.apis.length} |`);
}
w("");

// ═══ 后端域名分布 ═══
w("---");
w("");
w("## 后端域名分布");
w("");
const domains = new Map();
for (const g of allApis) for (const a of g.apis) {
  let d = "?";
  const mm = a.url.match(/^(?:https?:\/\/)?([^/]+)/);
  if (mm) d = mm[1];
  domains.set(d, (domains.get(d) || 0) + 1);
}
w("| 域名 | 接口数 | 用途 |");
w("|---|---:|---|");
const DOMAIN_USE = {
  "interface.17van.com": "**业务主接口**（发布/数据/互动/私信/话术）",
  "public.17van.com": "**AI 服务 + 公共接口**（AI 写作/额度/反馈/Office 转换/语音）",
  "bkend.17van.com": "**后台接口**（配置/广告/公告/组件检查/七牛上传）",
  "action.17van.com": "**埋点投递**（deliver-ai / collection / deliver-solve）",
  "download.17van.com": "插件与配置下发",
  "static.17van.com": "静态资源",
};
for (const [d, n] of [...domains.entries()].sort((a, b) => b[1] - a[1])) {
  w(`| \`${d}\` | ${n} | ${DOMAIN_USE[d] || ""} |`);
}
w("");
w("**架构判读**：融媒宝按**职责拆分域名**——");
w("`interface`（业务）/ `public`（AI+公共）/ `bkend`（后台）/ `action`（埋点）。");
w("本项目对应的是单机 + FastAPI 后端（`ops-center` :8010），不存在多域名拆分需求，");
w("但**按职责分层**的思路可用于本项目后端路由组织。");
w("");

// ═══ 命名混乱观察 ═══
w("---");
w("");
w("## 代码质量观察：API 前缀命名混乱");
w("");
const prefixes = new Set();
for (const g of allApis) for (const a of g.apis) {
  const mm = a.url.match(/^interface\.17van\.com\/([A-Za-z]+)/);
  if (mm) prefixes.add(mm[1]);
}
w("同样指向抖音业务的接口，存在**多个不一致的路径前缀**：");
w("");
w("```");
[...prefixes].filter((p) => /douyin|Douyin|pcdouyin|PcDouyin/i.test(p)).sort().forEach((p) => w(`  /${p}/`));
w("```");
w("");
w("`pcdouyin` / `PcDouyinLetter` / `PcDouyinOpen` / `PccDouyinOpen` / `pc` —— ");
w("大小写与字母数都不统一（`Pcc` 疑似 `Pc` 的笔误被沿用）。");
w("这反映**长期迭代中缺少接口命名规范**。");
w("");
w("> 对照本项目：AGENTS.md 有明确的目录/命名规范与门禁（`check-no-brand-residue`、");
w("> `content-formatter` 单一实现、`safe-http-url` 单一实现等），工程纪律明显更强。");
w("");

fs.writeFileSync(OUT, out.join("\n"), "utf8");
console.log(`写入: ${OUT}`);
console.log(`行数: ${out.length}`);
console.log(`总接口数: ${totalApis}（${allApis.length} 个模块）`);
for (const g of allApis.sort((a, b) => b.apis.length - a.apis.length)) {
  console.log(`  ${String(g.apis.length).padStart(3)}  ${g.module.name}`);
}
