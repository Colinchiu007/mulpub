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

  // 2026-10-20 视觉系统升级：本条断言的**意图**是「hero 卡背景必须是**已定义的渐变 token**，
  // 一旦引用了不存在的变量 → 声明整体失效 → 深底白字退化成白底白字（PR #2075 事故形态）」。
  // 升级后 hero 卡改用全局品牌渐变 `--brand-gradient`（与首页主任务卡同一套 token，
  // 消除"看板是另一条紫路径"的不统一），故断言从"必须引用 --deep-purple"
  // 改为"必须引用已定义的渐变 token"—— **意图不变，只是 token 换了**。
  // 额外加一条正向锁：--brand-gradient 必须在 tokens.css 有定义（否则同样会静默失效）。
  it("hero 卡背景引用已定义的渐变 token（token 失效即白底回归）", () => {
    let heroBg = null;
    eachRule((rule) => {
      if (rule.selector.replace(/\s+/g, "") === ".stat-card.large") {
        const d = declOf(rule, "background");
        if (d) heroBg = d.value;
      }
    });
    expect(heroBg, "缺少 .stat-card.large 的 background 声明").toBeTruthy();
    // 直接写渐变，或引用一个本身就是渐变的 token（--brand-gradient）
    const gradientTokenRef = heroBg.match(/var\((--[a-z0-9-]+)\)/i);
    if (gradientTokenRef) {
      const tokensCss = readFileSync(path.join(__dirname, "..", "styles", "tokens.css"), "utf8");
      const tokenName = gradientTokenRef[1];
      const decl = new RegExp(`${tokenName}\\s*:\\s*([^;]+);`).exec(tokensCss);
      expect(decl, `tokens.css 缺少 ${tokenName} 定义（引用它等于声明失效 → 白底回归）`).toBeTruthy();
      expect(decl[1], `${tokenName} 必须是渐变（linear-gradient）`).toContain("linear-gradient");
    } else {
      expect(heroBg).toContain("linear-gradient");
    }
  });

  // CCG 评审 i4：hero 卡现在引用 --brand-gradient（暗色主题也必须有定义）。
  // 旧断言只查了「tokens.css 里有这个 token」，但**没查暗色块里有没有**——
  // 暗色下若缺定义，hero 卡会回退到无背景（白字压暗底 → 不可读）。
  // 这里补一条亮/暗双档同构断言：两个块都必须定义 --brand-gradient，且值都含渐变。
  it("品牌渐变 token 亮/暗双档同构（暗色下 hero 卡不得回退成无背景）", () => {
    const tokensCss = readFileSync(path.join(__dirname, "..", "styles", "tokens.css"), "utf8");
    const readBlock = (scope) => {
      const re = scope === "dark"
        ? /^\[data-theme="dark"\]\s*\{/m
        : /^:root\s*\{/m;
      const m = re.exec(tokensCss);
      expect(m, `tokens.css 缺少 ${scope} 作用域`).toBeTruthy();
      let depth = 0;
      let end = -1;
      for (let i = tokensCss.indexOf("{", m.index); i < tokensCss.length; i++) {
        if (tokensCss[i] === "{") depth++;
        else if (tokensCss[i] === "}") {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      return tokensCss.slice(m.index, end);
    };
    for (const scope of ["light", "dark"]) {
      const block = readBlock(scope);
      const decl = /--brand-gradient\s*:\s*([^;]+);/.exec(block);
      expect(decl, `tokens.css 的 ${scope} 作用域缺少 --brand-gradient 定义`).toBeTruthy();
      expect(decl[1], `${scope} 档的 --brand-gradient 必须是渐变`).toContain("linear-gradient");
    }
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
    // 设计 token 合法定义源：tokens.css（唯一来源）+ cohere 全局文件（批次 6 起别名层已删除）
    const stylesDir = path.join(__dirname, "..", "styles");
    const globalCss = ["tokens.css", "cohere-design-system.css"]
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

  // 本条经历了两次反转，两次都是产品决策变化，不是判据失效 —— 历史一并留在此处，
  // 免得后人看到"先加后删"以为是无谓反复：
  //
  // 【第 1 版｜2026-10-16】断言 TrialBanner **必须在 .cohere-content 内部**。
  //   事故：横幅曾挂在外面，成为全页唯一没有水平 padding（--space-xxl）的元素 ——
  //   背景块左边缘贴容器边、与卡片不对齐，且被 .banner-text 的 flex:1 拉满整页宽度。
  //   该缺陷无法被挂载断言发现（vitest 不注入 CSS，DOM 查询照样通过），
  //   故只能在模板层锁位置关系。
  //
  // 【第 2 版｜2026-10-17，当前】断言 **不得再出现 TrialBanner**。
  //   用户决策方案 C：撤下。理由是横幅文案「当前为免费版，部分功能受限」在本页
  //   是误导 —— 本页三个数据源门禁都是登录而非套餐，没有任何一项内容因套餐受限。
  //   套餐差异改由各区块的「锁区块占位」真实体现（PRD §3.2）。
  //
  // 反转后的守护点：防止有人把横幅加回来。若将来确有理由恢复，请连同
  // 「必须放在 .cohere-content 内部」这条一起恢复（见 Dashboard.vue 模板注释）。
  it("看板页不得再出现 TrialBanner（误导文案已撤，防回潮）", () => {
    const tpl = descriptor.template.content;
    const bannerIdx = tpl.indexOf("<TrialBanner");
    expect(
      bannerIdx,
      "模板又出现了 <TrialBanner>：该横幅已因文案误导撤下（用户决策方案 C）。" +
        "若确需恢复，必须同时恢复「位于 .cohere-content 内部」的位置约束"
    ).toBe(-1);
    // 连带断言：组件导入也一并移除，避免留下死引用
    expect(tpl).not.toContain("trial-banner");
  });

  // CCG i7 指出：反转 TrialBanner 位置守卫后，新加的附加区块**没有**同等的
  // 位置锁 —— 上一版那条「必须在 .cohere-content 内部」的守护面就此空了。
  // 这里给它补上，锁的是同一个失效模式（放在 content 外 ⇒ 丢水平 padding、
  // 与下方卡片左右不对齐），只不过对象换成了 DashboardExtraPanels。
  it("DashboardExtraPanels 必须位于 .cohere-content 内部（丢 padding 回归保护）", () => {
    const tpl = descriptor.template.content;
    const contentIdx = tpl.indexOf('class="cohere-content"');
    const panelsIdx = tpl.indexOf("<DashboardExtraPanels");
    expect(contentIdx, "模板缺少 .cohere-content 容器").toBeGreaterThan(-1);
    expect(panelsIdx, "模板缺少 <DashboardExtraPanels>").toBeGreaterThan(-1);
    expect(
      panelsIdx,
      "<DashboardExtraPanels> 必须放在 .cohere-content 内部：放在外侧它会成为全页" +
        "唯一没有水平 padding（--space-xxl）的元素，背景块左边缘贴容器边、与下方卡片不对齐" +
        "（该失效模式在 TrialBanner 上真实发生过，见上一条注释第 1 版）"
    ).toBeGreaterThan(contentIdx);

    // 且必须在 .cohere-content 的**闭合**之前：证明是嵌套而非同层后置。
    // 用 div 深度计数定位与开头匹配的闭合标签，避免被内层嵌套 div 误导。
    const tags = [];
    for (const m of tpl.matchAll(/<div\b/g)) tags.push({ i: m.index, t: "o" });
    for (const m of tpl.matchAll(/<\/div>/g)) tags.push({ i: m.index, t: "c" });
    tags.sort((a, b) => a.i - b.i || (a.t === "o" ? -1 : 1));
    let depth = 0;
    let closeIdx = -1;
    for (const tag of tags) {
      if (tag.t === "o") depth += 1;
      else {
        depth -= 1;
        if (depth === 0 && tag.i > contentIdx) { closeIdx = tag.i; break; }
      }
    }
    expect(closeIdx, "未找到 .cohere-content 的闭合标签").toBeGreaterThan(-1);
    expect(
      panelsIdx,
      "<DashboardExtraPanels> 越过了 .cohere-content 的闭合标签（同层而非嵌套 → padding 不生效）"
    ).toBeLessThan(closeIdx);
  });

  // CCG 深度审查 i3 提出：上一次的修法只靠人工删掉死代码，没有任何机器守卫，
  // 同类问题可以静默长回来。这里补一条源码级锁，锁的正是本次那个失效模式：
  //
  // 事故形态（fix-upgrade-payment-entry）：Dashboard.vue 曾同时具备
  //   import UpgradeModal + const showUpgradeModal = ref(false) + 4 处
  //   @upgrade="showUpgradeModal = true"，**但模板从未渲染 <UpgradeModal>**。
  //   ref 被设置却无消费方 ⇒ 用户点「升级解锁」毫无反应。
  //   lint 当时已报 no-unused-vars，却被 eslint-disable 掩盖 —— 于是真 bug 被永久藏住。
  //
  // 为什么锁在源码层而不是行为层：行为测试（Dashboard.test.js）能证明「现在点下去
  // 会跳转」，但证明不了「没人把弹窗路径加回来」。而这三者同时存在时，行为测试
  // 依然可能通过（跳转和死绑定可以并存），只有源码不变量能拦住。
  it("升级入口必须走路由跳转，不得回潮为「设置 ref 但模板不渲染」的死绑定", () => {
    const tpl = descriptor.template.content;
    // ① 模板里不得再出现升级弹窗标签
    expect(tpl, "模板又渲染了 <UpgradeModal>：正式包中该弹窗只有「筹备中」，是死胡同").not.toContain(
      "<UpgradeModal"
    );
    // ② 不得再出现「设置一个只给弹窗用的 ref」这种死绑定
    expect(tpl, "模板又出现 showUpgradeModal 死绑定（点了不会有任何反应）").not.toContain(
      "showUpgradeModal"
    );
    // ③ 正向锁：四个锁区块的 CTA 必须都接到 goToMemberCenter
    const ctaBindings = tpl.match(/@upgrade="goToMemberCenter"/g) || [];
    expect(
      ctaBindings.length,
      `升级 CTA 的绑定数应为 4（trend / perf / platform / pattern 四个锁区块），实际 ${ctaBindings.length}`
    ).toBe(4);
  });
});
