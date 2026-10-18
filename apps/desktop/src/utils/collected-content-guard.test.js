// @ts-check
/**
 * collected-content-guard 回归测试 — 渲染层采集内容验证页护栏
 *
 * 契约（与主进程 electron/services/url-collector-antibot.js 同源）：
 * 同一输入两端必须同判。本文件**直接 require 主进程模块**，逐条比对判据常量与判定结果，
 * 防止两端各写一份后悄悄漂移（一份改了阈值、另一份没改，就会一边判验证页、一边当文章）。
 *
 * 现场证据：2026-10-18 百家号采集把「百度安全验证」页当正文返回，CHALLENGE 页正文 114 字；
 * 同批 3 份 OK 页不含任何标记。判据细节见主进程测试 url-collector-antibot.test.js 头注释。
 */
import { describe, it, expect } from "vitest";

import * as guard from "./collected-content-guard";
const antiBot = (await import("../../electron/services/url-collector-antibot")).default;

/** 实测 CHALLENGE 页正文（114 字） */
const CHALLENGE_TEXT =
  "网络不给力，请稍后重试 返回首页 问题反馈 百度安全验证 请完成下方验证后继续操作 正在验证... 验证通过 图片未转正 网络不给力，请刷新重试 加载中... 图片由AI生成 拖动左侧滑块使图片为正 扫码验证| 意见反馈 |刷新";
/** 实测 OK 页正文（节选，长文本） */
const OK_TEXT =
  "苹果与Meta破冰合作，Meta最强开源模型Muse Spark Open亮相，两位CEO罕见同框。".repeat(60);
const OK_TITLE = "扎克伯格突然感谢库克接班人——这对斗了十年的老冤家，为了一个AI模型握手了";

describe("isVerificationContent（渲染层判据）", () => {
  it("title=百度安全验证 → true", () => {
    expect(guard.isVerificationContent({ title: "百度安全验证", content: "" })).toBe(true);
  });

  it("实测 CHALLENGE 正文（强标记 ≥2）→ true", () => {
    expect(guard.isVerificationContent({ title: "百度安全验证", content: CHALLENGE_TEXT })).toBe(true);
  });

  it("实测 OK 文章（正常标题 + 长正文）→ false", () => {
    expect(guard.isVerificationContent({ title: OK_TITLE, content: OK_TEXT })).toBe(false);
  });

  it("误杀反例：合法长文含「网络不给力，请刷新重试」→ false", () => {
    const content =
      "我家宽带上周末一直抽风，页面老是提示「网络不给力，请刷新重试」，刷新十几次才打开后台。".repeat(8);
    expect(guard.isVerificationContent({ title: "一次宽带 DNS 故障排查记录", content })).toBe(false);
  });

  it("弱标记全中但无强标记 → false", () => {
    const content = "网络不给力，请刷新重试 正在验证... 验证通过 加载中... 图片由AI生成 " + "正文".repeat(200);
    expect(guard.isVerificationContent({ title: "正常标题", content })).toBe(false);
  });

  it("空/缺失输入 → false 且不抛错", () => {
    expect(guard.isVerificationContent()).toBe(false);
    expect(guard.isVerificationContent(null)).toBe(false);
    expect(guard.isVerificationContent({})).toBe(false);
    expect(guard.isVerificationContent({ title: "", content: "" })).toBe(false);
    expect(guard.isVerificationContent({ title: null, content: null })).toBe(false);
  });
});

describe("两端同源锁（主进程 anti-bot 模块 ⇄ 渲染层 guard）", () => {
  it("判据常量逐项相等（改一端不改另一端当场红）", () => {
    expect([...guard.STRONG_TEXT_MARKERS]).toEqual([...antiBot.STRONG_TEXT_MARKERS]);
    expect([...guard.WEAK_TEXT_MARKERS]).toEqual([...antiBot.WEAK_TEXT_MARKERS]);
    expect(guard.STRONG_TEXT_PATTERNS.map((re) => re.source)).toEqual(
      antiBot.STRONG_TEXT_PATTERNS.map((re) => re.source)
    );
    expect(guard.VERIFICATION_TITLE_MARKER).toBe(antiBot.VERIFICATION_TITLE_MARKER);
    expect(String(guard.CAPTCHA_URL_PATTERN)).toBe(String(antiBot.CAPTCHA_URL_PATTERN));
    expect(guard.MIN_STRONG_MARKERS).toBe(antiBot.MIN_STRONG_MARKERS);
    expect(guard.SHORT_TEXT_LENGTH_LIMIT).toBe(antiBot.SHORT_TEXT_LENGTH_LIMIT);
  });

  it("同一输入两端同判（矩阵覆盖：实测页 / 弱标记 / 长文 / 边界长度）", () => {
    const cases = [
      { title: "百度安全验证", content: CHALLENGE_TEXT },
      { title: "百度安全验证", content: "" },
      { title: OK_TITLE, content: OK_TEXT },
      { title: OK_TITLE, content: CHALLENGE_TEXT },
      { title: "正常标题", content: "请完成下方验证后继续操作" },
      { title: "正常标题", content: "请完成下方验证后继续操作" + "正".repeat(400) },
      { title: "正常标题", content: "请完成下方验证后继续操作 拖动左侧滑块使图片为正" + "正".repeat(400) },
      { title: "正常标题", content: "网络不给力，请刷新重试 正在验证... 验证通过 加载中... 图片由AI生成" },
      { title: "", content: "" },
      { title: "标题里提到验证页但不含完整标记", content: "正文".repeat(100) },
    ];
    for (const c of cases) {
      expect(guard.isVerificationContent(c)).toBe(antiBot.isVerificationContent(c));
      // 同源语义：guard 的 {title, content} 与主进程 {title, text} 是同一判据
      expect(guard.isVerificationContent(c)).toBe(
        antiBot.isVerificationPage({ title: c.title, text: c.content })
      );
    }
  });
});
