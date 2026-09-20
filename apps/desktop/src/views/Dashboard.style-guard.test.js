/**
 * Dashboard 样式源码守卫（QM-5 回归保护 · PR #2114 事故反哺）
 *
 * 背景：PR #2075 数据看板重构引入两处「渲染隐形」缺陷，均无法被挂载断言发现
 * （vitest 不启用 CSS 注入，getComputedStyle 拿不到 SFC 样式），故本文件在
 * SFC 源码层用 @vue/compiler-sfc + postcss 解析 <style scoped>，锁定不变量：
 *  1. 奶油·薰衣草 token 必须定义在 :global(:root)（scoped 裸 :root 会编译成
 *     :root[data-v-xxx] 永不匹配 → token 静默失效 → hero 白字白底）；
 *  2. scoped 块不允许出现剥掉 :global() 后仍含 :root 的选择器；
 *  3. 任何非 keyframes 规则不允许「基础 opacity:0 + animation」同体共存
 *     （视觉 runner 注入 animation:0s!important 会重置 animation-name → 永久隐形，
 *     像素基线曾被这种模式污染成空白页；淡入必须交给 keyframes from{opacity:0}）；
 *  4. hero 卡（.stat-card.large）背景必须引用 var(--deep-purple) 渐变。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parse } from "@vue/compiler-sfc";
import postcss from "postcss";

const source = readFileSync(path.join(__dirname, "Dashboard.vue"), "utf8");
const descriptor = parse(source, { filename: "Dashboard.vue" }).descriptor;

const scopedCss = (descriptor.styles || [])
  .filter((block) => block.scoped)
  .map((block) => block.content)
  .join("\n");

const root = postcss.parse(scopedCss);

/** 收集非 keyframes 规则（keyframes 步骤里的 opacity:0 是合法淡入写法） */
function eachRule(fn) {
  root.walkRules((rule) => {
    const parent = rule.parent;
    if (parent && parent.type === "atrule" && /keyframes/i.test(parent.name || "")) return;
    fn(rule);
  });
}

const declOf = (rule, prop) =>
  rule.nodes.find((n) => n.type === "decl" && n.prop === prop);

describe("Dashboard 样式源码守卫（PR #2075/#2114 事故回归保护）", () => {
  it("奶油·薰衣草 token 定义在 :global(:root)，scoped 编译后可真正挂到 html", () => {
    let tokenRule = null;
    eachRule((rule) => {
      if (rule.selector.replace(/\s+/g, "") === ":global(:root)") tokenRule = rule;
    });
    expect(tokenRule, "缺少 :global(:root) 规则（scoped 裸 :root 永不匹配）").toBeTruthy();
    for (const token of ["--lavender-primary", "--lavender-light", "--lavender-accent", "--deep-purple"]) {
      expect(declOf(tokenRule, token), `:global(:root) 缺少 ${token}`).toBeTruthy();
    }
  });

  it("scoped 块内不允许剥掉 :global() 后仍含裸 :root 的选择器", () => {
    const offenders = [];
    eachRule((rule) => {
      for (const sel of rule.selector.split(",")) {
        const stripped = sel.replace(/:global\([^)]*\)/g, " ");
        if (/:root\b/.test(stripped)) offenders.push(sel.trim());
      }
    });
    expect(offenders, `裸 :root 选择器会被编译为 :root[data-v-xxx]：${offenders.join(" | ")}`).toHaveLength(0);
  });

  it("不允许「基础 opacity:0 + animation」同体共存（动画禁用环境永久隐形模式）", () => {
    const offenders = [];
    eachRule((rule) => {
      const op = declOf(rule, "opacity");
      const anim = declOf(rule, "animation") || declOf(rule, "animation-name");
      if (op && anim && Number(op.value.trim()) === 0) {
        offenders.push(rule.selector.replace(/\s+/g, " "));
      }
    });
    expect(
      offenders,
      `以下规则靠动画从 opacity:0 变可见，视觉测试/reduced-motion 下会隐形：${offenders.join(" | ")}`
    ).toHaveLength(0);
  });

  it("hero 卡背景引用 var(--deep-purple) 渐变（token 失效即白底回归）", () => {
    let heroBg = null;
    eachRule((rule) => {
      if (rule.selector.replace(/\s+/g, "") === ".stat-card.large") {
        const d = declOf(rule, "background");
        if (d) heroBg = d.value;
      }
    });
    expect(heroBg, "缺少 .stat-card.large 的 background 声明").toBeTruthy();
    expect(heroBg).toContain("linear-gradient");
    expect(heroBg).toContain("var(--deep-purple)");
  });
});
