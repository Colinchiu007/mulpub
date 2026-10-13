/**
 * 三方平台覆盖度对比：本项目 vs 参考产品 vs 融媒宝
 * 输出：精确的缺口清单（按中文垂类 / 国际分类）
 */
const fs = require("node:fs");

// ─── 本项目现有平台（来自 config/platforms.yaml，已核实 15 个）───
const PROJECT = {
  wechat_mp: "微信公众号",
  zhihu: "知乎",
  weibo: "新浪微博",
  douyin: "抖音",
  xiaohongshu: "小红书",
  tencent_video: "腾讯视频",
  kuaishou: "快手",
  toutiao: "今日头条",
  youtube: "YouTube",
  tiktok: "TikTok",
  bilibili: "哔哩哔哩",
  baijiahao: "百家号",
  twitter: "Twitter/X",
  instagram: "Instagram",
  facebook: "Facebook",
};

// ─── 参考产品平台（36 个 AuthorizeConfig 类，人工映射为中文名）───
const REFPRODUCT = {
  AI_DouBao: "豆包(AI)",
  AiQiYi: "爱奇艺号",
  AZhan: "AcFun(A站)",
  BaiJiaHao: "百家号",
  Bilibili: "哔哩哔哩",
  CheJiaHao: "车家号",
  CSDN: "CSDN",
  DaYuHao: "大鱼号",
  DeWu: "得物",
  DouBan: "豆瓣",
  DouYin: "抖音",
  DuoDuoShiPin: "多多视频",
  FengWang: "凤凰号",
  JianShu: "简书",
  KuaiChuanHao: "快传号",
  KuaiShou: "快手",
  MeiPai: "美拍",
  MeiYou: "美柚",
  PiPiXia: "皮皮虾",
  QiEHao: "企鹅号",
  SouHuHao: "搜狐号",
  SouHuShiPin: "搜狐视频",
  TengXunShiPin: "腾讯视频",
  TengXunWeiShi: "腾讯微视",
  TouTiaoHao: "今日头条",
  WangYiHao: "网易号",
  WeiXinGongZhongHao: "微信公众号",
  WeiXinShiPinHao: "微信视频号",
  WifiWanNengYaoShi: "WiFi万能钥匙",
  XiaoHongShu: "小红书",
  XiaoHongShuShangJiaHao: "小红书商家号",
  XinLangWeiBo: "新浪微博",
  XueQiuHao: "雪球号",
  YiCheHao: "易车号",
  YiDianHao: "一点号",
  ZhiHu: "知乎",
};

// ─── 融媒宝平台（来自 data.zip 的 *categortmap.txt，136 项中的平台前缀）───
const WEMEDIA = {
  acfun: "AcFun(A站)",
  aiqiyi: "爱奇艺号",
  baihua: "百花号",
  baijiahao: "百家号",
  bilibili: "哔哩哔哩",
  dafeng: "大风号",
  dayu: "大鱼号",
  dongfang: "东方号",
  douyin: "抖音",
  huitoutiao: "惠头条",
  kaidi: "开递号",
  kuaichuan: "快传号",
  kuaishou: "快手",
  meipai: "美拍",
  miaopai: "秒拍",
  qie: "企鹅号",
  qqkandian: "QQ看点",
  qqkantiao: "QQ看条",
  qutoutiao: "趣头条",
  sinakandian: "新浪看点",
  sogou: "搜狗号",
  sohu: "搜狐号",
  tencentvideo: "腾讯视频",
  toutiao: "今日头条",
  wangyi: "网易号",
  weibo: "新浪微博",
  weixin: "微信公众号",
  wutiao: "五条号",
  yidian: "一点号",
  zhihu: "知乎",
};

const projectNames = new Set(Object.values(PROJECT));
const projectDomestic = new Set(
  Object.entries(PROJECT)
    .filter(([k]) => !["youtube", "tiktok", "twitter", "instagram", "facebook"].includes(k))
    .map(([, v]) => v),
);

console.log("=".repeat(78));
console.log("三方平台覆盖对比");
console.log("=".repeat(78));
console.log(`本项目:  15 个（含 5 个国际平台）`);
console.log(`参考产品:  ${Object.keys(REFPRODUCT).length} 个（纯中文平台）`);
console.log(`融媒宝:  ${Object.keys(WEMEDIA).length} 个（纯中文平台）`);

// 竞争者拥有的全部平台（去重）
const competitorAll = new Map(); // 中文名 -> [来源]
for (const [k, v] of Object.entries(REFPRODUCT)) {
  if (!competitorAll.has(v)) competitorAll.set(v, []);
  competitorAll.get(v).push("参考产品");
}
for (const [k, v] of Object.entries(WEMEDIA)) {
  if (!competitorAll.has(v)) competitorAll.set(v, []);
  competitorAll.get(v).push("融媒宝");
}

console.log(`\n竞争者平台并集: ${competitorAll.size} 个`);

// ─── 本项目缺失的平台 ───
const missing = [...competitorAll.entries()]
  .filter(([name]) => !projectNames.has(name))
  .map(([name, srcs]) => ({ name, srcs, both: srcs.length > 1 }))
  .sort((a, b) => (b.both ? 1 : 0) - (a.both ? 1 : 0) || a.name.localeCompare(b.name, "zh"));

console.log(`\n${"─".repeat(78)}`);
console.log(`【本项目缺失的平台】共 ${missing.length} 个`);
console.log(`${"─".repeat(78)}`);
console.log(`\n★ 两家竞品都有（最高优先级，${missing.filter((m) => m.both).length} 个）:`);
for (const m of missing.filter((x) => x.both)) {
  console.log(`    ${m.name.padEnd(16)} [${m.srcs.join(" + ")}]`);
}
console.log(`\n○ 仅参考产品有（${missing.filter((m) => !m.both && m.srcs[0] === "参考产品").length} 个）:`);
for (const m of missing.filter((x) => !x.both && x.srcs[0] === "参考产品")) {
  console.log(`    ${m.name}`);
}
console.log(`\n○ 仅融媒宝有（${missing.filter((m) => !m.both && m.srcs[0] === "融媒宝").length} 个）:`);
for (const m of missing.filter((x) => !x.both && x.srcs[0] === "融媒宝")) {
  console.log(`    ${m.name}`);
}

// ─── 竞争者缺失而本项目有的（本项目的差异化优势）───
const advantage = Object.entries(PROJECT).filter(([, v]) => !competitorAll.has(v));
console.log(`\n${"─".repeat(78)}`);
console.log(`【本项目独有（竞品都没有）】共 ${advantage.length} 个 — 这是差异化优势`);
console.log(`${"─".repeat(78)}`);
for (const [k, v] of advantage) console.log(`    ${v.padEnd(16)} (${k})`);

// ─── 覆盖重叠 ───
const overlap = Object.entries(PROJECT).filter(([, v]) => competitorAll.has(v));
console.log(`\n${"─".repeat(78)}`);
console.log(`【三方重叠】共 ${overlap.length} 个`);
console.log(`${"─".repeat(78)}`);
console.log("    " + overlap.map(([, v]) => v).join("、"));

// ─── 按类目分组缺口，给优先级建议 ───
console.log(`\n${"─".repeat(78)}`);
console.log(`【缺口按类目分组 + 建议优先级】`);
console.log(`${"─".repeat(78)}`);
const CATEGORY = {
  "微信生态（与已有 wechat_mp 协同）": ["微信视频号"],
  "大厂内容中台": ["大鱼号", "企鹅号", "网易号", "搜狐号", "凤凰号", "东方号", "新浪看点", "QQ看点", "QQ看条"],
  "技术/知识社区": ["CSDN", "简书", "豆瓣", "雪球号"],
  "视频垂类": ["腾讯微视", "美拍", "秒拍", "AcFun(A站)", "搜狐视频", "多多视频"],
  "汽车垂类": ["车家号", "易车号"],
  "电商/消费垂类": ["得物", "小红书商家号", "美柚", "皮皮虾", "WiFi万能钥匙"],
  "资讯分发（低质流量）": ["趣头条", "惠头条", "快传号", "一点号", "百花号", "大风号", "五条号", "开递号", "搜狗号"],
  "AI 内容平台": ["豆包(AI)"],
};
for (const [cat, list] of Object.entries(CATEGORY)) {
  const hit = list.filter((n) => missing.some((m) => m.name === n));
  if (hit.length === 0) continue;
  console.log(`\n  ${cat}  (${hit.length})`);
  for (const n of hit) {
    const m = missing.find((x) => x.name === n);
    console.log(`      ${n.padEnd(16)} ${m.both ? "★两家都有" : "○" + m.srcs.join("/")}`);
  }
}
