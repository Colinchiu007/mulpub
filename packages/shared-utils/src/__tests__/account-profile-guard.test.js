import { describe, expect, it } from "vitest";
import { profileForCreate, buildProfilePatch } from "../account-profile.js";

describe("account-profile 噪声昵称不写库", () => {
  it("profileForCreate 丢弃噪声昵称并回落 fallback", () => {
    expect(
      profileForCreate({ nickName: "作品发布" }, "兜底名").account_name,
    ).toBe("兜底名");
    expect(
      profileForCreate({ nickName: "0粉丝0关注0获赞退出登录" }, "")
        .account_name,
    ).toBe("");
  });
  it("profileForCreate 保留真实昵称", () => {
    expect(
      profileForCreate({ nickName: "数字生命丘丘" }, "x").account_name,
    ).toBe("数字生命丘丘");
  });
  it("buildProfilePatch 不下发噪声昵称，但粉丝照常回填", () => {
    const patch = buildProfilePatch(
      { nickName: "头条号", followers: 888 },
      { account_name: "", followers: null },
    );
    expect(patch.account_name).toBeUndefined();
    expect(patch.followers).toBe(888);
  });
  it("buildProfilePatch 正常昵称照常下发", () => {
    expect(
      buildProfilePatch({ nickName: "数字生命丘丘" }, { account_name: "旧名" })
        .account_name,
    ).toBe("数字生命丘丘");
  });
});
