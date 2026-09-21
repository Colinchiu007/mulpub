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
 *  4. hero 卡（.stat-card.large）背景必须引用 var(--deep-purple) 渐变；
 *  5. 网格算术不变量：桌面列数 == hero span + 普通卡数（防「孤儿换行」，
 *     2026-09-21 布局缺陷：4 列网格塞 5 个网格单元 → 第 4 卡孤立换行）；
 *  6. 阴影/表面 token 必须在 tokens.css 有定义（PR #2075 同类复发：
 *     引用了从未定义的 --shadow-sm/--cream-surface → 声明整体失效 → 白卡白底隐形）；
 *  7. 登录门禁三个类必须有样式（裸 native button 事故）；
 *  8. 统计卡图标禁止 emoji 字面量（与 el-icon 线性图标体系不一致）；
 *  9. hero 卡必须含右侧装饰节点（2 列宽内容只占左半 → 深紫空斑）。
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

  it("网格算术不变量：桌面列数 == hero span + 普通卡数（防孤儿换行）", () => {
    // 从模板统计 stats-grid 内卡片：总数与 large 数
    const tpl = descriptor.template.content;
    const gridStart = tpl.indexOf('class="stats-grid"');
    expect(gridStart, "模板缺少 .stats-grid 容器").toBeGreaterThan(-1);
    const gridSection = tpl.slice(gridStart, tpl.indexOf("\n      <!--", gridStart));
    const cardCount = (gridSection.match(/class="stat-card"/g) || []).length
      + (gridSection.match(/class="stat-card large"/g) || []).length;
    const largeCount = (gridSection.match(/class="stat-card large"/g) || []).length;
    expect(cardCount, "stats-grid 内应有统计卡").toBeGreaterThan(0);

    // 从样式取桌面列数与 hero span（@media 块外的基础定义）
    let cols = null;
    let heroSpan = null;
    root.walkRules((rule) => {
      const inMedia = rule.parent && rule.parent.type === "atrule" && /media/i.test(rule.parent.name || "");
      if (inMedia) return;
      if (rule.selector.replace(/\s+/g, "") === ".stats-grid") {
        const d = declOf(rule, "grid-template-columns");
        if (d) {
          const m = d.value.match(/repeat\((\d+),/);
          if (m) cols = Number(m[1]);
        }
      }
      if (rule.selector.replace(/\s+/g, "") === ".stat-card.large") {
        const d = declOf(rule, "grid-column");
        if (d) {
          const m = d.value.match(/span\s+(\d+)/);
          if (m) heroSpan = Number(m[1]);
        }
      }
    });
    expect(cols, ".stats-grid 缺少 repeat(N, …) 列定义").toBeTruthy();
    heroSpan = heroSpan || 1;
    const units = largeCount * heroSpan + (cardCount - largeCount);
    expect(
      cols,
      `网格算术错误：${cardCount} 张卡（hero span ${heroSpan}）共 ${units} 个网格单元，但只有 ${cols} 列 → 会孤儿换行`
    ).toBe(units);
  });

  it("阴影/表面 token 必须有全局定义（未定义 var → 声明失效卡隐形）", () => {
    // 设计 token 合法定义源：tokens.css（唯一来源）+ 历史全局文件（cohere/apple，存量槽位）
    const stylesDir = path.join(__dirname, "..", "styles");
    const globalCss = ["tokens.css", "cohere-design-system.css", "apple-design-tokens.css"]
      .map((f) => readFileSync(path.join(stylesDir, f), "utf8"))
      .join("\n");
    // 收集 scoped 块中引用的全部 var(--x)（排除带 fallback 的 var(--x, …) 可一并检查，从严：全部要求定义）
    const referenced = new Set();
    root.walkDecls((decl) => {
      for (const m of decl.value.matchAll(/var\((--[a-z0-9-]+)/gi)) referenced.add(m[1]);
    });
    // 本文件 :global(:root) 自定义的 token 也算已定义
    const selfDefined = new Set();
    root.walkDecls((decl) => {
      if (decl.prop && decl.prop.startsWith("--")) selfDefined.add(decl.prop);
    });
    const missing = [...referenced].filter(
      (name) => !selfDefined.has(name) && !new RegExp(`${name}\\s*:`).test(globalCss)
    );
    expect(missing, `引用了未定义的设计 token（声明会整体失效）：${missing.join(", ")}`).toHaveLength(0);
    // 关键槽位显式断言：卡阴影与卡面必须存在（历史事故点，只认 tokens.css 新定义）
    const tokensCss = readFileSync(path.join(stylesDir, "tokens.css"), "utf8");
    for (const key of ["--shadow-sm", "--shadow-md", "--shadow-lg", "--cream-surface"]) {
      expect(tokensCss, `tokens.css 缺少 ${key} 定义`).toMatch(new RegExp(`${key}\\s*:`));
    }
  });

  it("登录门禁三类必须有样式定义（禁裸 native button）", () => {
    const selectors = new Set();
    eachRule((rule) => {
      for (const sel of rule.selector.split(",")) selectors.add(sel.replace(/\s+/g, "").trim());
    });
    for (const cls of [".dashboard-login-gate", ".gate-hint", ".gate-sign-in"]) {
      const has = [...selectors].some((s) => s.includes(cls));
      expect(has, `scoped 样式缺少 ${cls} 定义`).toBe(true);
    }
  });

  it("统计卡图标禁止 emoji 字面量（统一 el-icon 线性图标体系）", () => {
    const tpl = descriptor.template.content;
    const emojiHits = [...tpl.matchAll(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu)].map((m) => m[0]);
    expect(emojiHits, `模板含 emoji 图标（与 el-icon 体系不一致）：${emojiHits.join(" ")}`).toHaveLength(0);
  });

  it("hero 卡必须含右侧装饰节点（stat-decor，消除 2 列宽深紫空斑）", () => {
    const tpl = descriptor.template.content;
    expect(tpl.includes("stat-decor"), "模板缺少 hero 装饰节点 .stat-decor").toBe(true);
    let hasRule = false;
    eachRule((rule) => {
      if (rule.selector.includes(".stat-decor")) hasRule = true;
    });
    expect(hasRule, "scoped 样式缺少 .stat-decor 规则").toBe(true);
  });
});
