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
