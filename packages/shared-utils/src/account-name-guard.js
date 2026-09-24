"use strict";
/**
 * account-name-guard.js — 账号昵称「噪声」判定（单一数据源）
 *
 * 存在理由（PRD-ACCOUNT-CARD-DISPLAY-FIX-2026-09-24）：
 * 早期 DOM 采集把「页面容器 textContent」和「页面标题」当成昵称写进 account_name，
 * 产出一批垃圾显示名，例如：
 *   - 快手：「0粉丝0关注0获赞账号认证退出登录…」（抓到了整块统计/会话区文本）
 *   - 抖音：「作品发布」、今日头条：「头条号」、百家号：「百家号」、
 *     视频号：「视频号助手」、B 站：「Bilibili 创作者中心」（全是页面标题/菜单名）
 * 采集端（account-profile）与展示端（AccountManagementCard）必须用同一份判定，
 * 否则口径漂移会重演。真实昵称（如「数字生命丘丘」）不得被误杀。
 *
 * 判定分三类，命中任一即视为噪声：
 * 1) 会话/UI chrome 关键词：退出登录、创作者中心、发布记录等（昵称不会含这些）。
 * 2) 平台指标块文本：同串里出现 ≥2 个「粉丝/关注/获赞/关注者」计数词
 *    （「0粉丝0关注0获赞」即典型；单个「关注」不算，避免误杀含「关注」的真实昵称）。
 * 3) 已知页面标题精确命中（大小写/首尾空格无关）。
 */

// 会话入口 / 后台 chrome 关键词：出现在 account_name 里必为抓错容器或标题。
const NOISE_KEYWORDS = [
  "退出登录",
  "账号认证",
  "扫码登录",
  "请登录",
  "立即登录",
  "创作者中心",
  "创作中心",
  "数据中心",
  "发布记录",
  "作品管理",
  "内容管理",
  "首页",
  "设置",
  "提现",
  "收益",
];

// 平台指标计数词：命中 ≥2 个才判噪声（避免误杀含单个「关注/粉丝」的真实昵称）。
const METRIC_WORDS = ["粉丝", "获赞", "关注者", "粉丝数", "关注数"];

// 已知「页面标题/菜单名」被误当昵称的精确集合（比较前小写去空格）。
const KNOWN_PAGE_TITLES = [
  "作品发布",
  "头条号",
  "百家号",
  "视频号助手",
  "视频号",
  "bilibili 创作者中心",
  "bilibili",
  "哔哩哔哩",
  "哔哩哔哩创作中心",
  "微信公众号",
  "公众号",
  "大鱼号",
  "搜狐号",
  "网易号",
  "一点号",
  "爱奇艺号",
  "企鹅号",
  "网易订阅号",
];

function isNoiseAccountName(name) {
  const raw = typeof name === "string" ? name.trim() : "";
  if (!raw) return true; // 空值没有可展示信息，视同噪声（由调用方决定兜底文案）
  if (NOISE_KEYWORDS.some((kw) => raw.includes(kw))) return true;
  const metricHits = METRIC_WORDS.reduce(
    (n, w) => n + (raw.split(w).length - 1),
    0,
  );
  if (metricHits >= 2) return true;
  const lowered = raw.toLowerCase();
  if (KNOWN_PAGE_TITLES.includes(lowered)) return true;
  return false;
}

module.exports = {
  isNoiseAccountName,
  NOISE_KEYWORDS,
  METRIC_WORDS,
  KNOWN_PAGE_TITLES,
};
