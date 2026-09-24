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
});

// 渲染端 ESM 孪生文件与主进程 CJS 判定必须逐案一致（vite dev /@fs 不能消费 CJS，故双实现；本测试防漂移）。
import * as cjsGuard from '../account-name-guard.js'
import * as esmGuard from '../account-name-guard.browser.js'

describe('account-name-guard browser twin parity (PRD-ACCOUNT-CARD-DISPLAY-FIX-2026-09-24)', () => {
  const cases = ['', '   ', '数字生命丘丘', '作品发布', '头条号', '百家号', 'Bilibili 创作者中心', '0粉丝0关注0获赞账号认证退出登录命运石', '关注', '粉丝', '视频号助手', '微信公众号'] + cjsGuard.NOISE_KEYWORDS.map(kw => '小明' + kw) + cjsGuard.KNOWN_PAGE_TITLES.map(x => ' ' + x.toUpperCase() + ' ')
  it('CJS/ESM 判定逐案一致', () => {
    for (const c of cases) {
      expect([c, esmGuard.isNoiseAccountName(c)]).toEqual([c, cjsGuard.isNoiseAccountName(c)])
    }
  })
  it('关键词/指标词表两侧完全一致（任一侧单改即红）', () => {
    expect(esmGuard.NOISE_KEYWORDS).toEqual(cjsGuard.NOISE_KEYWORDS)
    expect(esmGuard.METRIC_WORDS).toEqual(cjsGuard.METRIC_WORDS)
    expect(esmGuard.KNOWN_PAGE_TITLES).toEqual(cjsGuard.KNOWN_PAGE_TITLES)
  })
})
