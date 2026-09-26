import { describe, expect, it } from "vitest";
import { isNoiseAccountName } from "../account-name-guard.js";

describe("account-name-guard isNoiseAccountName", () => {
  it("空值视为噪声（无可展示信息）", () => {
    expect(isNoiseAccountName("")).toBe(true);
    expect(isNoiseAccountName("   ")).toBe(true);
    expect(isNoiseAccountName(null)).toBe(true);
  });
  it("会话/后台 chrome 文本判为噪声", () => {
    expect(isNoiseAccountName("0粉丝0关注0获赞账号认证退出登录命运石")).toBe(
      true,
    );
    expect(isNoiseAccountName("Bilibili 创作者中心")).toBe(true);
  });
  it("已知页面标题判为噪声", () => {
    for (const t of ["作品发布", "头条号", "百家号", "视频号助手"])
      expect(isNoiseAccountName(t)).toBe(true);
  });
  it("真实昵称不受影响", () => {
    expect(isNoiseAccountName("数字生命丘丘")).toBe(false);
    expect(isNoiseAccountName("知乎测试账号")).toBe(false);
  });
  it("含单个「关注」不误杀", () => {
    expect(isNoiseAccountName("关注的旅人")).toBe(false);
  });

  // 样本取自 2026-09-26 生产 accounts.json 里实际入库的 6 条脏 account_name。
  // 旧实现是「已知页面标题」枚举黑名单，只拦住了「抖音创作者中心」1 条，
  // 其余 5 条全部放行并显示到账号卡片上（本次 Bug 的表象）。
  it("生产脏数据六例全部命中（结构化规则，不靠逐个枚举）", () => {
    const polluted = [
      "485.9万人看过", // 今日头条：统计块文本
      "分享此刻的想法...同步到圈子发想法", // 知乎：输入框占位文案
      "哔哩哔哩 (゜", // Bilibili：document.title 按首个连字符截断
      "小红书创作服务平台", // 小红书：网页标题
      "快手创作者服务平台", // 快手：网页标题
      "抖音创作者中心", // 抖音：网页标题
    ];
    expect(polluted.filter(isNoiseAccountName)).toEqual(polluted);
  });

  it("结构化规则不误杀真实昵称", () => {
    for (const n of [
      "数字生命丘丘",
      "知乎测试账号",
      "关注的旅人",
      "小新的日常(vlog)", // 括号成对
      "阿b(≧▽≦)", // 颜文字成对
      "1998年的夏天", // 以数字开头但不是统计量
      "36氪",
      "某地政务服务中心",
    ]) {
      expect([n, isNoiseAccountName(n)]).toEqual([n, false]);
    }
  });

  it("省略号/未闭合括号/指标量词/站点后缀各自的判定边界", () => {
    expect(isNoiseAccountName("想法……")).toBe(true); // 中文省略号
    expect(isNoiseAccountName("A(B")).toBe(true); // 括号未闭合
    expect(isNoiseAccountName("1.2万次阅读")).toBe(true);
    expect(isNoiseAccountName("8888获赞")).toBe(true);
    expect(isNoiseAccountName("XX开放平台")).toBe(true);
    expect(isNoiseAccountName("1.2万")).toBe(false); // 纯数字是粉丝数文案，不是昵称判定目标
  });

  // 「A - B」这种被空格包裹的分隔符是网页标题的形态指纹（`<title>页面名 - 站点名</title>`）。
  // 旧实现试图「剥掉后缀」把它救成昵称，而正则匹配的是第一个分隔符，于是
  // `哔哩哔哩 (゜-゜)つロ 干杯~-bilibili` 被切成 `哔哩哔哩 (゜`。正确做法是整串不采纳。
  it("空格包裹的分隔符 = 页面标题指纹", () => {
    for (const t of ["头条号 - 个人中心", "我的主页 - 哔哩哔哩", "某作品 | 知乎", "甲 · 乙"]) {
      expect([t, isNoiseAccountName(t)]).toEqual([t, true]);
    }
    // 无空格包裹的连字符/间隔号是昵称里的常见写法，不得误杀
    for (const n of ["A-B", "K-Line", "小·明", "上下-五千年"]) {
      expect([n, isNoiseAccountName(n)]).toEqual([n, false]);
    }
  });
});

// 渲染端 ESM 孪生文件与主进程 CJS 判定必须逐案一致（vite dev /@fs 不能消费 CJS，故双实现；本测试防漂移）。
import * as cjsGuard from '../account-name-guard.js'
import * as esmGuard from '../account-name-guard.browser.js'

describe('account-name-guard browser twin parity (PRD-ACCOUNT-CARD-DISPLAY-FIX-2026-09-24)', () => {
  const cases = ['', '   ', '数字生命丘丘', '作品发布', '头条号', '百家号', 'Bilibili 创作者中心', '0粉丝0关注0获赞账号认证退出登录命运石', '关注', '粉丝', '视频号助手', '微信公众号', '485.9万人看过', '分享此刻的想法...同步到圈子发想法', '哔哩哔哩 (゜', '小红书创作服务平台', '快手创作者服务平台', '1998年的夏天', '36氪', '阿b(≧▽≦)', '头条号 - 个人中心', 'A-B', '小·明'] + cjsGuard.NOISE_KEYWORDS.map(kw => '小明' + kw) + cjsGuard.KNOWN_PAGE_TITLES.map(x => ' ' + x.toUpperCase() + ' ') + cjsGuard.CHROME_SUFFIXES.map(sf => '小明' + sf)
  it('CJS/ESM 判定逐案一致', () => {
    for (const c of cases) {
      expect([c, esmGuard.isNoiseAccountName(c)]).toEqual([c, cjsGuard.isNoiseAccountName(c)])
    }
  })
  it('关键词/指标词表两侧完全一致（任一侧单改即红）', () => {
    expect(esmGuard.NOISE_KEYWORDS).toEqual(cjsGuard.NOISE_KEYWORDS)
    expect(esmGuard.METRIC_WORDS).toEqual(cjsGuard.METRIC_WORDS)
    expect(esmGuard.KNOWN_PAGE_TITLES).toEqual(cjsGuard.KNOWN_PAGE_TITLES)
    expect(esmGuard.CHROME_SUFFIXES).toEqual(cjsGuard.CHROME_SUFFIXES)
    expect(esmGuard.METRIC_PATTERNS.map(r => r.source)).toEqual(cjsGuard.METRIC_PATTERNS.map(r => r.source))
    expect(esmGuard.METRIC_PATTERNS.map(r => r.flags)).toEqual(cjsGuard.METRIC_PATTERNS.map(r => r.flags))
    expect(esmGuard.ELLIPSIS_PATTERN.source).toBe(cjsGuard.ELLIPSIS_PATTERN.source)
    expect(esmGuard.TITLE_SEPARATOR_PATTERN.source).toBe(cjsGuard.TITLE_SEPARATOR_PATTERN.source)
    expect(esmGuard.OPEN_BRACKETS).toBe(cjsGuard.OPEN_BRACKETS)
    expect(esmGuard.CLOSE_BRACKETS).toBe(cjsGuard.CLOSE_BRACKETS)
    // 导出面也必须对称：两侧都导出 hasUnbalancedBrackets 且判定逐例一致
    // （评审指出 CJS 曾只内部使用、ESM 导出，两侧 API 面漂移）。
    expect(typeof esmGuard.hasUnbalancedBrackets).toBe('function')
    expect(typeof cjsGuard.hasUnbalancedBrackets).toBe('function')
    for (const s of ['哔哩哔哩 (゜', 'A(B)', '阿b(≧▽≦)', '小新的日常(vlog)', '（未完', '）多余', '无括号']) {
      expect([s, esmGuard.hasUnbalancedBrackets(s)]).toEqual([s, cjsGuard.hasUnbalancedBrackets(s)])
    }
  })
})
