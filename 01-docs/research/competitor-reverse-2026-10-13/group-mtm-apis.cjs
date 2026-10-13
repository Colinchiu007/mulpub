/**
 * 按平台归并 MediaTaskMgr.dll 的 1338 个 URL
 * 产出：每平台 API 端点清单 + 功能推断
 */
const fs = require("node:fs");

const SRC = "D:\\Data\\projects\\rea\\analysis\\mtm-strings-all.json";
const OUT = "D:\\Data\\projects\\rea\\analysis\\mtm-platform-apis.md";

const values = JSON.parse(fs.readFileSync(SRC, "utf8")).raw_result
  .map((i) => i.value)
  .filter((v) => typeof v === "string" && /^https?:\/\//i.test(v));

// 域名 → 平台名映射
const DOMAIN_MAP = [
  [/cashtoutiao\.com/i, "惠头条/快头条"],
  [/creator\.miaopai\.com|miaopai\.com/i, "秒拍"],
  [/fhh\.ifeng\.com|ifeng\.com|ifengimg/i, "凤凰号"],
  [/mp\.163\.com|dy\.163\.com|163\.com/i, "网易号"],
  [/mp\.sina\.com\.cn|sina\.com\.cn|sinaimg|hs\.blog\.sina|my\.sina/i, "新浪看点"],
  [/mp\.sogou\.com/i, "搜狗号"],
  [/kuaichuan\.360|360kuai/i, "快传号"],
  [/my\.tv\.sohu\.com|tv\.sohu\.com|sohu\.com/i, "搜狐视频"],
  [/youku\.com/i, "优酷"],
  [/baijiahao\.baidu\.com|baidu\.com|bdstatic/i, "百家号/百度"],
  [/toutiao\.com|pstatp|snssdk|bytedance/i, "今日头条"],
  [/douyin|aweme|amemv/i, "抖音"],
  [/kuaishou|gifshow|chenzhongtech/i, "快手"],
  [/bilibili|hdslb/i, "哔哩哔哩"],
  [/xiaohongshu|xhscdn/i, "小红书"],
  [/mp\.weixin\.qq\.com|weixin\.qq|wx\.qq/i, "微信公众号"],
  [/weibo\.com|weibo\.cn|sina\.com\.cn\/top/i, "微博"],
  [/zhihu\.com|zhimg/i, "知乎"],
  [/om\.qq\.com|qq\.com|gtimg|qqmail/i, "腾讯系"],
  [/dayu|uc\.cn|uczzd|alibaba|aliyuncs|taobao|tmall/i, "阿里系/大鱼号"],
  [/qutoutiao|qtt/i, "趣头条"],
  [/yidian|yidianzixun/i, "一点号"],
  [/huputiyu|hupu/i, "虎扑"],
  [/babytree/i, "宝宝树"],
  [/wutiao|5tiao/i, "五条号"],
  [/xiaomixiangkan|mi\.com/i, "小米想看"],
  [/dongfang|eastday|mini\.eastday/i, "东方号"],
  [/sogou/i, "搜狗"],
  [/17van\.com/i, "融媒宝自有后端"],
  [/iclient\.ifeng/i, "凤凰客户端分享"],
  [/haotf|hao0202/i, "好头条?"],
  [/1sapp|yidianzixun/i, "1sapp?"],
  [/quwenge|rym\./i, "渠道导流?"],
  [/w3\.org|apache\.org|ibm\.com|ecma-international|rfc-editor|unix\.org|safaribooksonline/i, "（标准/文档 URI，非业务）"],
];

function platformOf(url) {
  for (const [re, name] of DOMAIN_MAP) if (re.test(url)) return name;
  return "（其他/未分类）";
}

const byPlatform = new Map();
for (const u of values) {
  const p = platformOf(u);
  if (!byPlatform.has(p)) byPlatform.set(p, new Set());
  byPlatform.get(p).add(u);
}

const out = [];
const w = (s) => out.push(s);
w("# MediaTaskMgr.dll 平台 API 端点清单（原生层提取）");
w("");
w(`> 来源：REA \`search .{4,} --kind strings\` on \`MediaTaskMgr.dll\`（Ghidra 12.1.4）`);
w(`> URL 总数：**${values.length}**（去重后按平台归并）`);
w("");
w("---");
w("");
w("## 平台覆盖总览");
w("");
w("| 平台 | 端点数 |");
w("|---|---|");
const sorted = [...byPlatform.entries()].sort((a, b) => b[1].size - a[1].size);
for (const [p, set] of sorted) w(`| ${p} | ${set.size} |`);

w("");
w("---");
w("");
w("## 各平台 API 端点详情");
w("");
for (const [p, set] of sorted) {
  if (p.startsWith("（")) continue;
  w(`### ${p}（${set.size} 个端点）`);
  w("");
  w("```");
  [...set].sort().forEach((u) => w(u));
  w("```");
  w("");
}

// 其他
const other = byPlatform.get("（其他/未分类）");
if (other) {
  w("---");
  w("");
  w(`## 其他/未分类（${other.size} 个）`);
  w("");
  w("```");
  [...other].sort().forEach((u) => w(u));
  w("```");
}

fs.writeFileSync(OUT, out.join("\n"), "utf8");
console.log(`写入: ${OUT}`);
console.log(`\n平台分布:`);
for (const [p, set] of sorted) console.log(`  ${String(set.size).padStart(5)}  ${p}`);
