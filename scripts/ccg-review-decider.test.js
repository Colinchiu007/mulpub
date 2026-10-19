/**
 * ccg-review-decider 的回归测试。
 *
 * 为什么必须有这个文件（2026-10-15）：
 *   在加这个测试之前，`ccg-review-decider.js` **没有任何测试覆盖**
 *   （`grep ccg-review-decider scripts/*.test.js` 只命中一条注释）。
 *   于是两个缺陷长期存在且无人发现：
 *
 *   缺陷 A（假阳性）：
 *     judge() 的 contentHits 跑在 `staged.changedLines`（含 .md 文档行）上，
 *     而 pathHits 跑在 `codeFiles` 上 —— 两个口径不一致。
 *     ⇒ 在文档里写「加密/口令/鉴权」的分析文字，会被判成「改动涉及加密」，
 *       误置 deepReview.required=true。
 *
 *   缺陷 B（规模失真）：
 *     collectStaged() 用整仓 `git diff --cached -U0`；rebase --continue 走 git
 *     内部 cherry-pick，pre-commit 触发时 GIT_INDEX_FILE 指向 rebase 临时 index
 *     ⇒ 读不到预期内容，规模与模式判定系统性采成 0。
 *
 *   本测试用「内存里构造 staged 对象」的方式直接测 judge()，
 *   不依赖 git 暂存区 —— 因此**也能覆盖 rebase 路径**（那正是缺陷 B 的场景）。
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

// ★ 残余 3（2026-10-15）：原来这里靠「读源码 → 剥掉末尾 process.exit(main()) →
// 注入 module.exports → _compile」来拿模块内函数，理由是「不给纯 CLI 脚本硬加 exports」。
// 但那种做法**依赖源码文本**：本 PR 把结尾改成 `if (require.main === module) process.exit(main())`
// 之后，剥离正则不再匹配 —— 幸好当时留了 `assert.notEqual(stripped, src)` 守卫，
// 否则测试会**静默地**加载一个仍会执行 main() 的版本。
// 现在 decider 自带 require.main 守卫与 exports，测试走正路直连 require。
const SRC = path.join(__dirname, "ccg-review-decider.js");
const fs = require("node:fs");

const decider = require(SRC);
const { RULES, judge } = decider;

/** 构造一个 staged 对象（与 collectStaged 的产出同构） */
function makeStaged({ files, codeChangedLines = [], allChangedLines = [], proposal = false }) {
  const codeExt = (f) => RULES.codeExtensions.has(path.extname(f).toLowerCase());
  const codeFiles = files.filter((f) => codeExt(f.file));
  return {
    files,
    changedLines: allChangedLines,
    codeChangedLines,
    codeFiles,
    proposal: proposal || undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 缺陷 A：contentHits 口径不得含文档行
// ═══════════════════════════════════════════════════════════════════

test("缺陷A反证：只有 .md 文档行含敏感词时不得判 dual", () => {
  // 这是真实事故的精确复现：我写的记录正文含「加密/口令/鉴权」，
  // 旧实现因此判 dual 并误置 deepReview.required。
  const staged = makeStaged({
    files: [{ file: "openspec/records/x.md", added: 3, deleted: 0 }],
    codeChangedLines: ["这里只是普通说明文字，无敏感词。"], // 源码侧无敏感词
    allChangedLines: [
      "# 标题",
      "这里分析加密与口令鉴权机制。", // ← 文档行的敏感词，必须被忽略
    ],
  });
  const r = judge(staged);
  assert.notEqual(r.mode, "dual",
    `只有文档含敏感词时不应判 dual。实际 mode=${r.mode} reason=${r.reason}`);
  assert.equal(r.stats.sensitiveContentHits, 0,
    `sensitiveContentHits 应为 0，实际 ${r.stats.sensitiveContentHits}`);
});

test("缺陷A正控：源码行含敏感词时仍须判 dual", () => {
  const staged = makeStaged({
    files: [{ file: "scripts/foo.js", added: 3, deleted: 0 }],
    codeChangedLines: ["const password = 'x';"],
    allChangedLines: ["const password = 'x';"],
  });
  const r = judge(staged);
  assert.equal(r.mode, "dual", `源码含敏感词应判 dual。实际 mode=${r.mode}`);
  assert.equal(r.stats.sensitiveContentHits, 1);
});

test("缺陷A：文档与源码同时含敏感词时，只计源码那份", () => {
  const staged = makeStaged({
    files: [
      { file: "scripts/foo.js", added: 1, deleted: 0 },
      { file: "docs/bar.md", added: 1, deleted: 0 },
    ],
    codeChangedLines: ["const password = 'x';"],
    allChangedLines: [
      "const password = 'x';",
      "分析加密与口令。",
      "再提一次鉴权。",
    ],
  });
  const r = judge(staged);
  assert.equal(r.mode, "dual");
  assert.equal(r.stats.sensitiveContentHits, 1,
    `只应计源码的 1 处，实际 ${r.stats.sensitiveContentHits}`);
});

test("缺陷A：pathHits 与 contentHits 口径一致（都只看 codeFiles）", () => {
  // 路径命中必须来自源码文件；文档路径不得触发
  const staged = makeStaged({
    files: [{ file: "docs/auth-notes.md", added: 1, deleted: 0 }],
    codeChangedLines: [],
    allChangedLines: ["无害文字"],
  });
  const r = judge(staged);
  assert.equal(r.stats.sensitivePathHits.length, 0,
    `文档路径 auth-notes.md 不该命中敏感路径。实际 ${JSON.stringify(r.stats.sensitivePathHits)}`);
});

// ═══════════════════════════════════════════════════════════════════
// 缺陷 B：规模判定不得因 rebase 路径失真
// ═══════════════════════════════════════════════════════════════════

test("缺陷B：源码规模按 numstat 计算，不依赖 diff 行是否读得到", () => {
  // rebase 路径下 `git diff --cached -U0` 可能读空，但 numstat 仍应可信。
  // 这里构造「codeChangedLines 为空（模拟 diff 读空）但 numstat 有值」的场景。
  const staged = makeStaged({
    files: [
      { file: "scripts/a.js", added: 100, deleted: 20 },
      { file: "scripts/b.js", added: 30, deleted: 5 },
    ],
    codeChangedLines: [], // ← 模拟 rebase 下 diff 读空
    allChangedLines: [],
  });
  const r = judge(staged);
  assert.equal(r.stats.changedLines, 155,
    `changedLines 应按 numstat 累加（100+20+30+5=155），实际 ${r.stats.changedLines}`);
  assert.equal(r.stats.codeFileCount, 2,
    `codeFileCount 应为 2，实际 ${r.stats.codeFileCount}`);
  assert.ok(r.reason.includes("155"), `reason 应体现真实规模，实际: ${r.reason}`);
});

test("缺陷B：超过 dualLineThreshold 时判 dual（规模优先于敏感判定）", () => {
  const staged = makeStaged({
    files: [{ file: "scripts/big.js", added: 150, deleted: 100 }],
    codeChangedLines: [],
    allChangedLines: [],
  });
  const r = judge(staged);
  assert.equal(r.mode, "dual", `250 行 > 200 阈值应判 dual。实际 ${r.mode}`);
  assert.ok(r.reason.includes(String(RULES.dualLineThreshold)),
    `reason 应点名阈值，实际: ${r.reason}`);
});

test("缺陷B：纯文档改动仍走 docs-only skip", () => {
  const staged = makeStaged({
    files: [
      { file: "README.md", added: 10, deleted: 2 },
      { file: "docs/x.md", added: 5, deleted: 0 },
    ],
    codeChangedLines: [],
    allChangedLines: ["一些说明"],
  });
  const r = judge(staged);
  assert.equal(r.mode, "skip", `纯文档应判 skip。实际 ${r.mode}`);
});

// ═══════════════════════════════════════════════════════════════════
// 常规路径（防修 A/B 时把正常行为改坏）
// ═══════════════════════════════════════════════════════════════════

test("常规：小规模无敏感命中 => single", () => {
  const staged = makeStaged({
    files: [{ file: "scripts/small.js", added: 10, deleted: 2 }],
    codeChangedLines: ["const a = 1;"],
    allChangedLines: ["const a = 1;"],
  });
  const r = judge(staged);
  assert.equal(r.mode, "single");
  assert.equal(r.stats.changedLines, 12);
});

test("常规：决策层（方案文件）不按扩展名过滤规模", () => {
  const staged = makeStaged({
    files: [{ file: "openspec/changes/x/proposal.md", added: 50, deleted: 0 }],
    proposal: true,
  });
  // 决策层的规模来自 staged.stats.changedLines
  staged.stats = { changedLines: 80 };
  const r = judge(staged);
  assert.equal(r.stats.changedLines, 80,
    `决策层规模应取 staged.stats.changedLines，实际 ${r.stats.changedLines}`);
});

test("常规：deepReview.required 在 mode != skip 时为 true", () => {
  const single = judge(makeStaged({
    files: [{ file: "scripts/x.js", added: 5, deleted: 0 }],
    codeChangedLines: ["let a;"],
  }));
  const skip = judge(makeStaged({
    files: [{ file: "README.md", added: 5, deleted: 0 }],
    codeChangedLines: [],
  }));
  assert.equal(single.mode !== "skip", true);
  assert.equal(skip.mode, "skip");
  // required 的语义由 saveRecord 决定，这里只验证 mode 分支正确
  assert.ok(["single", "dual"].includes(single.mode));
});

// ═══════════════════════════════════════════════════════════════════
// collectStaged 的真实覆盖（QM-6 评审 i1）
// ═══════════════════════════════════════════════════════════════════
//
// 上面所有用例都用 makeStaged() 伪造对象测 judge()，**collectStaged 零覆盖** ——
// 而它才是缺陷 A/B 的修复主体（逐文件→单次 diff 切段、重命名解析、读取缺口记账）。
// 伪造对象测不出「切段切错」「重命名定位不到」这类问题，所以这里必须上真实暂存区。
//
// 为什么用子进程：collectStaged 内部的 git() 走 process.cwd()，
// 而测试进程的 cwd 不能中途切换 ⇒ 子进程的 cwd 指向夹具仓库。
test("collectStaged 真实覆盖：源码/文档/重命名三类在真实暂存区上的解析", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ccg-collect-${process.pid}-${Date.now()}-`));
  try {
    const g = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    g("init", "-q");
    g("config", "user.email", "t@example.invalid");
    g("config", "user.name", "t");
    g("config", "commit.gpgsign", "false");
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts", "old-name.js"), "const a = 1;\n");
    fs.writeFileSync(path.join(root, "docs", "notes.md"), "初始说明。\n");
    g("add", ".");
    g("commit", "-q", "-m", "base");

    // 三类改动同时在暂存区：
    //   ① 源码：改名 + 改内容（覆盖 i6 的 "old => new" 形态）
    //   ② 文档：改内容且含敏感词（覆盖 i3 的「文档行单列、不进源码视图」）
    fs.renameSync(path.join(root, "scripts", "old-name.js"), path.join(root, "scripts", "new-name.js"));
    fs.writeFileSync(path.join(root, "scripts", "new-name.js"), 'const password = "y";\n');
    fs.writeFileSync(path.join(root, "docs", "notes.md"), "这里分析加密与口令机制。\n");
    g("add", "-A");

    // 子进程加载被测模块：现在直接 require（残余 3 —— 不再剥源码文本）
    const loader = [
      `const m = require(${JSON.stringify(SRC)});`,
      "process.stdout.write(JSON.stringify(m.collectStaged()));",
    ].join("\n");
    const r = spawnSync(process.execPath, ["-e", loader], { cwd: root, encoding: "utf8" });
    assert.strictEqual(r.status, 0, `加载/执行失败：${r.stderr}`);
    const st = JSON.parse(r.stdout);

    // ① 重命名 + 改内容：文件必须被认出来，且它的变更行必须读到（i6）
    assert.ok(
      st.files.some((f) => f.file === "scripts/new-name.js"),
      `重命名后的路径必须解析成新名，实际 files=${JSON.stringify(st.files.map((f) => f.file))}`,
    );
    assert.ok(
      st.codeChangedLines.some((l) => l.includes("password")),
      `重命名文件的变更行必须被读到（否则敏感判定对它静默失效）；实际 codeChangedLines=${JSON.stringify(st.codeChangedLines)}`,
    );
    assert.deepEqual(st.lineReadGaps, [], `不得有「有规模却读不到行」的文件；实际 ${JSON.stringify(st.lineReadGaps)}`);

    // ② 源码视图不得混入文档行（i3 的一半：判定只看源码）
    assert.ok(
      !st.codeChangedLines.some((l) => l.includes("加密") || l.includes("口令")),
      `文档行不得进入 codeChangedLines；实际 ${JSON.stringify(st.codeChangedLines)}`,
    );
    // ③ 文档视图必须拿到文档行（i3 的另一半：改判定 ≠ 丢弃观测点）
    assert.ok(
      st.docChangedLines.some((l) => l.includes("加密")),
      `文档变更行必须被单列出来供报告；实际 ${JSON.stringify(st.docChangedLines)}`,
    );
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 夹具清理失败不影响判据 */ }
  }
});

// ═══════════════════════════════════════════════════════════════════
// 残余 2：把 diff 区间接进 decider（补完缺陷 C 的另一半）
// ═══════════════════════════════════════════════════════════════════
//
// 缺陷：`ccg-gate.js` 调 decider 时一个参数都不传 ⇒ 补跑时暂存区为空 ⇒
// decider 打印「暂存区无变更，跳过审查模式判定」⇒ **模式判定从未执行**，
// 而输出读起来像「无需审查」。修法：decider 支持 `--base`，gate 在补跑时传下去。

/** 造一个隔离 repo：commit1 只放基线，commit2 放待判改动 */
function makeRangeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ccg-range-${process.pid}-${Date.now()}-`));
  const g = (...args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.strictEqual(r.status, 0, `git ${args.join(" ")} 失败：${r.stderr}`);
    return r.stdout.trim();
  };
  g("init", "-q");
  g("config", "user.email", "t@example.invalid");
  g("config", "user.name", "t");
  g("config", "commit.gpgsign", "false");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "base.js"), "const a = 1;\n");
  g("add", ".");
  g("commit", "-q", "-m", "base");
  return { root, g };
}

/** 在隔离 repo 里 require decider 并调一个采集函数，返回其 JSON 结果 */
function collectIn(root, expr) {
  const loader = `process.stdout.write(JSON.stringify(require(${JSON.stringify(SRC)})${expr}));`;
  const r = spawnSync(process.execPath, ["-e", loader], { cwd: root, encoding: "utf8" });
  assert.strictEqual(r.status, 0, `子进程失败：${r.stderr}`);
  return JSON.parse(r.stdout);
}

test("collectRange 真实覆盖：判的是 base...HEAD 里那批改动，且能读到变更行", () => {
  const { root, g } = makeRangeRepo();
  try {
    fs.writeFileSync(path.join(root, "scripts", "feature.js"), 'const password = "x";\n');
    g("add", ".");
    g("commit", "-q", "-m", "feature");

    const st = collectIn(root, '.collectRange("HEAD~1")');
    assert.ok(
      st.files.some((f) => f.file === "scripts/feature.js"),
      `区间采集必须认出新文件；实际 ${JSON.stringify(st.files.map((f) => f.file))}`,
    );
    assert.ok(
      st.codeChangedLines.some((l) => l.includes("password")),
      `区间采集必须读到变更行（否则敏感判定失效）；实际 ${JSON.stringify(st.codeChangedLines)}`,
    );
    assert.deepStrictEqual(st.lineReadGaps, [], `不得有读取缺口；实际 ${JSON.stringify(st.lineReadGaps)}`);
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
});

test("collectRange 用三点语义：base 之后主干自己的改动不得算进本次", () => {
  const { root, g } = makeRangeRepo();
  try {
    // 主干侧（base 之后、我的分支之前）另有一笔改动
    fs.writeFileSync(path.join(root, "scripts", "mainline.js"), "const m = 1;\n");
    g("add", ".");
    g("commit", "-q", "-m", "mainline");
    const forkPoint = g("rev-parse", "HEAD");

    // 我的分支：新增一个分支 ref，从 forkPoint 起算「我的改动」
    g("checkout", "-q", "-b", "feature");
    fs.writeFileSync(path.join(root, "scripts", "mine.js"), "const mine = 1;\n");
    g("add", ".");
    g("commit", "-q", "-m", "mine");
    // 主干再前进一笔（模拟「从同一 base 拉出后主干也在动」）
    g("checkout", "-q", "-");
    fs.writeFileSync(path.join(root, "scripts", "mainline2.js"), "const m2 = 1;\n");
    g("add", ".");
    g("commit", "-q", "-m", "mainline2");
    g("checkout", "-q", "feature");

    const st = collectIn(root, '.collectRange("master")');
    const names = st.files.map((f) => f.file);
    assert.ok(names.includes("scripts/mine.js"), `必须包含我自己的改动；实际 ${JSON.stringify(names)}`);
    assert.ok(
      !names.includes("scripts/mainline2.js"),
      `三点语义下不得把主干在分叉点之后的改动算进来；实际 ${JSON.stringify(names)}`,
    );
    void forkPoint;
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
});

test("残余2：--base 不存在时必须说「未判定」，不得说「暂存区无变更，跳过审查模式判定」", () => {
  const { root } = makeRangeRepo();
  try {
    const r = spawnSync(process.execPath, [SRC, "--print", "--base", "no-such-rev"], {
      cwd: root,
      encoding: "utf8",
    });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    assert.match(out, /未判定/, `必须显式说「未判定」；实际输出：\n${out}`);
    // ★ 深度审查 i4 修正：这里原来断的是「不得出现 `暂存区无变更，跳过审查模式判定`」——
    //   而那串字**本次已从源码里删掉**，于是该断言**永真、形同虚设**（假绿锁）。
    //   负向断言必须断「一旦退回旧行为就会重新出现的词」。旧措辞里唯一的动词是
    //   **「跳过」**，而本路径的新措辞不含它 ⇒ 换成断 `跳过` 才是有判别力的。
    assert.doesNotMatch(
      out,
      /跳过/,
      `不得让「读不到输入」伪装成「跳过/无需审查」；实际输出：\n${out}`,
    );
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
});

test("残余2：空暂存区且无 --base 时，必须点明「这不是无需审查，是没判」", () => {
  const { root } = makeRangeRepo();
  try {
    const r = spawnSync(process.execPath, [SRC, "--print"], { cwd: root, encoding: "utf8" });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    assert.match(out, /未判定/, `必须说「未判定」；实际输出：\n${out}`);
    assert.match(out, /没判/, `必须点明「没判」而不是「无需审查」；实际输出：\n${out}`);
    assert.match(out, /--base/, `必须给出补救命令；实际输出：\n${out}`);
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
});

test("残余2 接线锁：带显式路径补跑时，gate 必须把 --base 传给 decider（断言效果，不断言日志）", () => {
  // ⛔ 为什么必须断言「效果」而不能断言 gate 打的那行日志：
  //   第一版本锁断言输出里有「审查模式判定基准：」—— **变异 M2（摘掉
  //   deciderArgs.push）实测仍然 16/16 全绿**，因为那行 console.log 与 push 是
  //   相邻但**无因果**的两条语句，摘掉 push 日志照打。锁因此完全无效。
  //   现在改成断言「decider 真的判了这批改动」：输出里必须出现模式判定结论
  //   （`审查模式判定 [验证层…]: DUAL|SINGLE|SKIP`）且**不得**出现 `未判定`。
  //   M2 下 decider 收不到 --base ⇒ 落到空暂存区分支 ⇒ 两条断言同时失败。
  //
  // 为什么需要「区间非空」的仓库：本工作区 HEAD == origin/main（尚无提交），
  //   base...HEAD 为空 ⇒ 即使 --base 正确传下去也只会打印「未判定」，无法区分。
  //   故用临时仓库：基线在 commit1，HEAD（feature 分支）在 commit2。
  //
  // 为什么用 CCG_SKILLS_DIR 指向桩目录：真 CCG 未安装时 gate 会在 resolveCcgDir()
  //   直接返回（打印「已跳过 CCG 门禁」），**根本走不到**判定器那一段 —— 那会让本锁
  //   在 CI 上永久静默跳过（本仓登记过的「通配锁全程未执行却被当成已反证」同型）。
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), `ccg-stub-${process.pid}-${Date.now()}-`));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `ccg-wire-${process.pid}-${Date.now()}-`));
  try {
    fs.writeFileSync(path.join(stub, "run_skill.js"), "process.exit(0);\n");
    const g = (...args) => {
      const r0 = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      assert.strictEqual(r0.status, 0, `git ${args.join(" ")} 失败：${r0.stderr}`);
      return r0.stdout.trim();
    };
    g("init", "-q");
    // 本机 git 默认分支是 master，而 gate 的 base 候选是 origin/main / main
    // ⇒ 不改名就永远找不到 base（实测：会正确地出声告警、并保持「未判定」）。
    g("symbolic-ref", "HEAD", "refs/heads/main");
    g("config", "user.email", "t@example.invalid");
    g("config", "user.name", "t");
    g("config", "commit.gpgsign", "false");
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "base.js"), "const a = 1;\n");
    g("add", ".");
    g("commit", "-q", "-m", "base");
    g("checkout", "-q", "-b", "feature");
    fs.writeFileSync(path.join(repo, "src", "feature.js"), 'const password = "x";\n');
    g("add", ".");
    g("commit", "-q", "-m", "feature");

    const gate = path.resolve(__dirname, "ccg-gate.js");
    const r = spawnSync(process.execPath, [gate, "verify-quality", "src/feature.js"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, CCG_SKILLS_DIR: stub },
    });
    const out = `${r.stdout || ""}${r.stderr || ""}`;

    assert.doesNotMatch(
      out,
      /已跳过 CCG 门禁/,
      `桩目录没生效，gate 提前退出 ⇒ 本锁会退化成静默跳过；实际输出：\n${out}`,
    );
    assert.match(
      out,
      /审查模式判定 \[[^\]]*\]:\s*(SKIP|SINGLE|DUAL)/,
      `gate 没把 --base 传下去 ⇒ 判定器没判这批改动（M2 形态）；实际输出：\n${out}`,
    );
    assert.doesNotMatch(
      out,
      /未判定/,
      `补跑路径上判定器仍落回「未判定」⇒ --base 未生效；实际输出：\n${out}`,
    );
  } finally {
    try { fs.rmSync(stub, { recursive: true, force: true }) } catch { /* 夹具 */ }
    try { fs.rmSync(repo, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
});

// ═══════════════════════════════════════════════════════════════════
// 深度审查 i1 / i3 的修正锁（2026-10-15）
// ═══════════════════════════════════════════════════════════════════

test("i1 锁：暂存区非空时，带显式目标也必须仍判暂存区（不得只凭 explicit 就改判区间）", () => {
  // 指控原文（深度审查 i1，Critical）：「显式目标 ⇒ 无条件传 --base，但显式目标≠事后补跑：
  //   pre-commit 带暂存改动跑 verify-quality <file> 时，decider 改判 base...HEAD，
  //   刚暂存的改动被漏掉」。
  // 该指控成立：带着暂存改动查单个文件是**合法且常见**的用法。
  // 修法：判据从「有显式目标」改成「**暂存区为空**」。
  // 本锁断言：暂存区非空 + 显式目标 ⇒ 输出必须点明「仍判暂存区」且**不得**出现区间基准。
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), `ccg-stub2-${process.pid}-${Date.now()}-`));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `ccg-i1-${process.pid}-${Date.now()}-`));
  try {
    fs.writeFileSync(path.join(stub, "run_skill.js"), "process.exit(0);\n");
    const g = (...args) => {
      const r0 = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      assert.strictEqual(r0.status, 0, `git ${args.join(" ")} 失败：${r0.stderr}`);
      return r0.stdout.trim();
    };
    g("init", "-q");
    g("symbolic-ref", "HEAD", "refs/heads/main");
    g("config", "user.email", "t@example.invalid");
    g("config", "user.name", "t");
    g("config", "commit.gpgsign", "false");
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "base.js"), "const a = 1;\n");
    g("add", ".");
    g("commit", "-q", "-m", "base");
    g("checkout", "-q", "-b", "feature");
    // 关键：改动**只暂存、不提交** —— 这才是「提交前只想查某个文件」的现场
    fs.writeFileSync(path.join(repo, "src", "staged-only.js"), 'const password = "x";\n');
    g("add", "src/staged-only.js");
    assert.notStrictEqual(g("diff", "--cached", "--name-only"), "", "夹具前提：暂存区必须非空");

    const gate = path.resolve(__dirname, "ccg-gate.js");
    const r = spawnSync(process.execPath, [gate, "verify-quality", "src/staged-only.js"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, CCG_SKILLS_DIR: stub },
    });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    assert.doesNotMatch(out, /已跳过 CCG 门禁/, `桩目录没生效；实际输出：\n${out}`);
    assert.match(
      out,
      /暂存区有 \d+ 个改动\s*⇒ 模式判定仍判暂存区/,
      `暂存区非空时必须仍判暂存区；实际输出：\n${out}`,
    );
    assert.doesNotMatch(
      out,
      /审查模式判定基准：/,
      `暂存区非空时**不得**改判区间（i1 形态）；实际输出：\n${out}`,
    );
    // 并且判定确实发生了（不是「未判定」糊过去）
    assert.match(
      out,
      /审查模式判定 \[[^\]]*\]:\s*(SKIP|SINGLE|DUAL)/,
      `暂存区路径上必须真的判出模式；实际输出：\n${out}`,
    );
  } finally {
    try { fs.rmSync(stub, { recursive: true, force: true }) } catch { /* 夹具 */ }
    try { fs.rmSync(repo, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
});

test("i3 锁：区间为空时，提示必须给出**可用**基准，不得再把失效的 origin/main 当补救", () => {
  // 指控原文（深度审查 i3，Warning）：「合并后补跑（HEAD==base）时三点区间必为空，
  //   提示「说明 base 选错了」，但补救示例仍是 --base origin/main —— 恰是已失效的基准」。
  // 该指控成立：最常触发本分支的场景里，origin/main 就是那个空的基准。
  const { root, g } = makeRangeRepo();
  try {
    // ⚠ 必须用 `branch -M` 而不是 `symbolic-ref HEAD refs/heads/main`：
    //   在**已有提交之后** symbolic-ref 会留下一个 **unborn** 的 main
    //   （实测 `git rev-parse main` 解析失败）⇒ 走到的是「读不到 base」分支，
    //   而不是本锁要验的「区间为空」分支。
    g("branch", "-M", "main");
    // HEAD == base ⇒ 区间必空（模拟「改动已并入 base」）
    assert.strictEqual(g("rev-parse", "--abbrev-ref", "HEAD"), "main");
    const r = spawnSync(process.execPath, [SRC, "--print", "--base", "main"], {
      cwd: root,
      encoding: "utf8",
    });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    assert.match(out, /未判定/, `必须说「未判定」；实际输出：\n${out}`);
    // ① 情形一：改动还没提交 ⇒ 去掉 --base
    assert.match(out, /去掉 --base/, `必须给出「去掉 --base 判暂存区」这条路；实际输出：\n${out}`);
    // ② 情形二：改动已并入 base ⇒ 换更早的基准
    assert.match(out, /main~1/, `必须给出一个真正可用的更早基准示例；实际输出：\n${out}`);
    // ③ 把 HEAD / base 的短 sha 写出来，便于用户自己判断落在哪个情形
    assert.match(out, /HEAD=[0-9a-f]{4,}/, `必须报出 HEAD 短 sha；实际输出：\n${out}`);
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
});

test("i6 锁：CCG_DECIDER_BASE 是坏值时必须被拒并告警，不得先印基准行再印未判定（自相矛盾）", () => {
  // 指控原文（深度审查 i6，Info）：「CCG_DECIDER_BASE 未经校验即作为候选：设坏值/不存在
  //   rev 时，gate 先印「基准：坏值...HEAD」，decider 再打未判定，输出自相矛盾」。
  // 该指控成立 —— 输入未校验就进候选，是「判据判错输入」的又一处。
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), `ccg-stub3-${process.pid}-${Date.now()}-`));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `ccg-i6-${process.pid}-${Date.now()}-`));
  try {
    fs.writeFileSync(path.join(stub, "run_skill.js"), "process.exit(0);\n");
    const g = (...args) => {
      const r0 = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
      assert.strictEqual(r0.status, 0, `git ${args.join(" ")} 失败：${r0.stderr}`);
      return r0.stdout.trim();
    };
    g("init", "-q");
    g("symbolic-ref", "HEAD", "refs/heads/main");
    g("config", "user.email", "t@example.invalid");
    g("config", "user.name", "t");
    g("config", "commit.gpgsign", "false");
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "base.js"), "const a = 1;\n");
    g("add", ".");
    g("commit", "-q", "-m", "base"); // 暂存区为空 ⇒ 走「事后补跑」分支

    const gate = path.resolve(__dirname, "ccg-gate.js");
    const r = spawnSync(process.execPath, [gate, "verify-quality", "src/base.js"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, CCG_SKILLS_DIR: stub, CCG_DECIDER_BASE: "no-such-rev-xyz" },
    });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    assert.doesNotMatch(out, /已跳过 CCG 门禁/, `桩目录没生效；实际输出：\n${out}`);
    assert.match(
      out,
      /CCG_DECIDER_BASE 指定的基准「no-such-rev-xyz」不是有效 rev/,
      `坏 env 必须被点名拒绝；实际输出：\n${out}`,
    );
    assert.doesNotMatch(
      out,
      /审查模式判定基准：/,
      `坏 env 被拒后**不得**再打印基准行（否则输出自相矛盾）；实际输出：\n${out}`,
    );
  } finally {
    try { fs.rmSync(stub, { recursive: true, force: true }) } catch { /* 夹具 */ }
    try { fs.rmSync(repo, { recursive: true, force: true }) } catch { /* 夹具 */ }
  }
});


// ═══════════════════════════════════════════════════════════════════
// 记录名内容寻址（ccg-record-content-addressing，2026-10-16）
// ═══════════════════════════════════════════════════════════════════

const HEX64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'.replace(/^0/, 'a')
const PARENT40 = 'b'.repeat(40)

test('recordFileName：暂存 diff 非空 ⇒ 用内容寻址名（不再用父 sha）', () => {
  assert.strictEqual(decider.recordFileName(HEX64, PARENT40), `${HEX64}.json`)
})

test('recordFileName：同一变更 ⇒ 同名（收敛，不再因 amend 产生孤儿）', () => {
  assert.strictEqual(
    decider.recordFileName(HEX64, PARENT40),
    decider.recordFileName(HEX64, 'c'.repeat(40)),
    '父 sha 变了但变更相同 ⇒ 必须仍是同一个文件，否则「闭环需再提交、再提交又生成新名」不收敛'
  )
})

test('recordFileName：不同变更 ⇒ 不同名（撞名的反向锁）', () => {
  const other = 'f'.repeat(64)
  assert.notStrictEqual(
    decider.recordFileName(HEX64, PARENT40),
    decider.recordFileName(other, PARENT40),
    '同一父 sha 下的不同变更必须写到不同文件 —— 这正是本轮三次 add/add 冲突的根因'
  )
})

test('recordFileName：暂存 diff 为空（纯 .ccg 提交）⇒ 回落父 sha 名，且不得返回空名', () => {
  const n = decider.recordFileName('', PARENT40)
  assert.strictEqual(n, `${PARENT40}.json`, '空 diff（如只改 .ccg）必须回落到既有 40 位形态，保持门禁可识别')
  for (const bad of [undefined, null, '   ']) {
    assert.match(decider.recordFileName(bad, PARENT40), /^[0-9a-f]{40}\.json$/, `非内容寻址输入必须回落，实际 ${bad}`)
  }
})

test('结构锁：saveRecord 必须经由 recordFileName 取名（防纯函数被测而调用点漂移）', () => {
  // 读源码后**先归一化行尾**：本仓源码是 CRLF，直接找 '\n}\n' 会匹配不到
  // （同一坑在本轮变异脚本上已踩过一次）。归一化只影响本测试内的字符串，不改文件。
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
  // 切片边界用**顶层函数收尾**（列 0 的 `}`），不用 `\n  }`：
  // 后者会被函数体内部的 `  })();` 之类缩进误命中，导致切片在调用点之前就截断
  // —— 本测试首版正栽在这里（假红）。修的是**判据脆弱**，不是放松断言。
  const start = src.indexOf('function saveRecord')
  assert.ok(start > 0, '找不到 saveRecord 定义')
  const end = src.indexOf('\n}\n', start)
  assert.ok(end > start, 'saveRecord 的顶层收尾定位失败')
  const body = src.slice(start, end + 3)
  assert.match(body, /recordFileName\s*\(/, 'saveRecord 内必须调用 recordFileName；否则本文件的纯函数测试与实际落盘脱钩')
  assert.doesNotMatch(body, /\`\$\{sha\}\.json\`/, 'saveRecord 不得再直接拼模板 `${sha}.json`')
})


// ═══════════════════════════════════════════════════════════════════
// QM-6 复审追加（2026-10-16）
// ═══════════════════════════════════════════════════════════════════

test('QM-6 i3：闭环白名单与门禁同源（改一处忘另一处必须当场红）', () => {
  // 重复定义的风险只能用等价锁兜底：直接读门禁源码断言两处集合相等。
  const gate = fs.readFileSync(path.join(__dirname, 'check-pr-exec-record.js'), 'utf8')
  const m = gate.match(/CLOSED_DEEP_REVIEW_STATUSES = new Set\(\[([^\]]*)\]\)/)
  assert.ok(m, '门禁侧的白名单定义形态变了，本锁需同步更新（不允许静默失配）')
  const fromGate = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort()
  const fromDecider = [...decider.CLOSED_DEEP_REVIEW_STATUSES].sort()
  assert.deepStrictEqual(fromDecider, fromGate,
    'decider 与门禁的闭环白名单必须一致；否则「已闭环」在两处判定不同 ⇒ 要么丢结论要么误红')
})

test('QM-6 i3：已闭环的同名记录不得被静默覆盖（否则 amend 抹掉审查结论）', () => {
  // 内容寻址让同一变更落到同一文件（这是收敛性的来源），副作用是后写覆盖先写。
  //
  // ★ 行为锁（不是结构锁）：直接调用 shouldPreserveClosedRecord。
  //   首版只用「grep saveRecord 源码字面」的结构锁，变异反证立即抓到缺口 ——
  //   把 `if (cond)` 改成 `if (false && cond)` 后所有字面仍在、结构锁全绿，
  //   而行为已失效。故抽纯函数 + 用行为锁守它。
  const f = decider.shouldPreserveClosedRecord
  assert.strictEqual(typeof f, 'function', 'shouldPreserveClosedRecord 必须导出（否则本锁退化成结构锁）')

  // 已闭环 ⇒ 必须保留（不覆盖）
  for (const st of ['cleared', 'needs_revision', 'self_play_resolved']) {
    assert.strictEqual(f({ deepReview: { status: st } }), true,
      `status=${st} 是闭环态 ⇒ 必须保留旧记录`)
  }
  // ★ 第三轮 i3：blocked/pending **不按状态名无条件保留** ——
  //   第二轮我把它们直接加进保留集，但实测本 PR 自带的 5e658b47….json 就是
  //   self_play_pending + findings:null：那种记录没有任何实质内容，
  //   保留它只会让同内容 amend 每次另存 alt、无限累积，且与「保留=有实质内容」自相矛盾。
  for (const st of ['self_play_blocked', 'self_play_pending']) {
    assert.strictEqual(f({ deepReview: { status: st, findings: null } }), false,
      `status=${st} 且 findings:null ⇒ 无实质内容 ⇒ 必须允许覆盖（否则冻结 + alt 累积）`)
    assert.strictEqual(f({ deepReview: { status: st, findings: [] } }), false,
      `status=${st} 且 findings 空数组 ⇒ 同样无实质内容 ⇒ 必须允许覆盖`)
    assert.strictEqual(f({ deepReview: { status: st, findings: [{ id: 'i1' }] } }), true,
      `status=${st} 但 findings 非空 ⇒ 有实质内容 ⇒ 必须保留`)
  }
  // 未闭环且无 findings ⇒ 必须允许覆盖（否则同一变更永远无法更新自己的 pending）
  for (const st of ['pending', '']) {
    assert.strictEqual(f({ deepReview: { status: st } }), false,
      `status=${st} 无 findings ⇒ 必须允许覆盖`)
  }
  // 字段缺失/畸形 ⇒ 一律允许覆盖（fail-open 于「写」，而不是 fail-open 于「丢结论」）
  for (const bad of [null, undefined, {}, { deepReview: null }, { deepReview: {} }, { deepReview: { status: 123 } }]) {
    assert.strictEqual(f(bad), false, `畸形输入必须允许覆盖，实际 ${JSON.stringify(bad)}`)
  }
  // 白名单/保留集外的自造值，且无 findings ⇒ 允许覆盖
  assert.strictEqual(f({ deepReview: { status: 'done' } }), false, '集外的 done 且无 findings 不得保留')
  // ★ 状态是未来新态、但已有 findings ⇒ 仍保留（判据是「有实质内容」，不是枚举状态）
  assert.strictEqual(f({ deepReview: { status: 'some_future_state', findings: [{ id: 'i1' }] } }), true,
    '任何状态只要已有 findings 就必须保留 —— 枚举追不上未来态')
  // 有 findings 但为空数组 ⇒ 不算实质内容
  assert.strictEqual(f({ deepReview: { status: 'pending', findings: [] } }), false,
    'findings 为空数组不算实质内容，应允许覆盖')
})

test('QM-6 第二轮 i5：另存名必须全局唯一（同 sha 前缀不得互相覆盖）', () => {
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
  assert.match(src, /-again-\$\{sha\}-/, 'alt 名必须含**完整** sha（首版只用 slice(0,8)，同前缀会互覆盖）')
  assert.match(src, /toISOString\(\)\.replace\(\/\[:\.\]\/g, ""\)/, 'alt 时间戳形态由生产方决定（本条锁它的字面写法）；两处描述是否同源不由本条自证，而由下一条「跨模块命名对齐锁」拿真实产物名去问 AUDIT_ARTIFACT_RE')
})

test('QM-6 第三轮 i5：哈希算失败时不得静默回落父 sha（那正是要消灭的撞名）', () => {
  // saveRecord 的 try/catch 若把哈希失败吞成 undefined ⇒ recordFileName 回落父 sha
  // saveRecord 的 try/catch 若把哈希失败吞成 undefined ⇒ recordFileName 回落父 sha
  // ⇒ 恰好回到本次要消灭的跨分支撞名，且无任何告警。必须显式出声。
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
  const s = src.indexOf('function saveRecord')
  const e = src.indexOf('\n}\n', s)
  const body = src.slice(s, e + 3)
  assert.match(body, /无法计算 stagedDiffHash/, '哈希失败必须显式告警，不得静默')
  assert.match(body, /不写判定记录/, '告警必须点明处置是「不写记录」—— 写父 sha 名会撞名，比不写更糟')
  assert.match(body, /return null/, 'error 分支必须 return null 不落盘，否则仍会写出撞名的父 sha 记录')
  assert.match(body, /console\.error/, '告警必须走 stderr（decider 无 shell 的 say()；且不得污染 stdout）')
  // 不得调用不存在的 say()（它是 deep-review.sh 的函数，decider 里会直接抛 ReferenceError）。
  // ★ 必须**先剥掉注释行**再查 —— 首版用 /\bsay\(/ 直接查全 body，
  //   结果匹配到我自己写的注释「没有 shell 的 say()」⇒ 恒假红（判据错，不是实现错）。
  const codeOnly = body.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  assert.doesNotMatch(codeOnly, /\bsay\(/, '不得调用不存在的 say() —— 它是 deep-review.sh 的函数')
  // 告警后仍用父 sha（无替代命名），但记录里必须写 null 让「无键」可见
  assert.match(body, /hashResult\.empty/, '必须区分「空 diff」与「算失败」—— 前者回落是设计，后者是故障')
})

test('QM-6 第三轮 i4：哈希配方必须固定 diff 行为（跨机器/换配置要对得上）', () => {
  // diff 文本的 sha256 受 diff.external / noprefix / textconv / autocrlf / renames 等
  // 用户配置影响；不固定的话同一个变更在不同机器会算出不同键 ⇒ 记录找不到。
  //
  // ★ 必须**剥掉注释行**再查：这三个 flag 会出现在解释性注释里（本 PR 就有），
  //   直接查全 body 会匹配到注释 ⇒ 把真实调用删掉后断言仍绿（变异 M18 实测踩过）。
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
  const s = src.indexOf('function saveRecord')
  const e = src.indexOf('\n}\n', s)
  const body = src.slice(s, e + 3)
  const codeOnly = body.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  for (const flag of ['--no-textconv', '--no-ext-diff', '--no-renames']) {
    assert.ok(codeOnly.includes(flag), `哈希配方必须含 ${flag}（在**代码**里，不是注释里）`)
  }
  // 且必须是 git 调用参数的一部分（形如 "diff", "--cached", ...）
  assert.match(codeOnly, /"diff",\s*"--cached",\s*"--no-textconv",\s*"--no-ext-diff",\s*"--no-renames"/,
    '三个 flag 必须紧跟 --cached 出现在同一次 git 调用里')
})

test('QM-6 第二轮 i1：三条路径全落空且有改动时必须报「故障」而非「没跑判定器」', () => {
  const sh = fs.readFileSync(path.join(__dirname, 'deep-review.sh'), 'utf8')
  // 判据：用「非 .ccg diff 行数 > 0」区分「本就不该有记录」与「记录丢了」
  assert.match(sh, /这是\*\*故障\*\*，不是/, '必须明确判为故障，而不是笼统的「没跑判定器」')
  assert.match(sh, /_DIFFLINES/, '必须实测 diff 行数作为判据')
  assert.match(sh, /git diff --cached --no-textconv --no-ext-diff --no-renames -- \. ':\(exclude\)\.ccg'/, '必须给出两条口径的自检命令（与实现同参数）')
})

test('QM-6 第二轮 i4：_read_mode 必须经 argv 传路径（不得内插进 -e 字符串）', () => {
  const sh = fs.readFileSync(path.join(__dirname, 'deep-review.sh'), 'utf8')
  assert.doesNotMatch(sh, /require\('\.\/\$f'\)/, '不得把 $f 内插进 node -e 的单引号串（引号/换行会注入或错位）')
  assert.match(sh, /path\.resolve\(process\.argv\[1\]\)/, '必须经 argv 取路径并 resolve 成绝对路径')
  assert.match(sh, /"\$f" 2>\/dev\/null/, '必须把 $f 作为独立 argv 传给 node')
  // ★ 下标必须是 argv[1]：`node -e <script> <arg>` 中 -e 的脚本不占 argv ⇒ arg 在 argv[1]。
  //   写成 argv[2] 会得到 undefined ⇒ path.resolve 抛 ERR_INVALID_ARG_TYPE
  //   ⇒ 记录明明存在却读不出 ⇒ 被误判「无记录」。这个 bug 真实发生过一轮。
  assert.doesNotMatch(sh, /process\.argv\[2\]/, '不得用 argv[2] —— node -e 的脚本不占 argv，arg 在 argv[1]')
})

test('QM-6 第二轮 i4 行为锁：真跑一次，记录存在就必须真的读到 mode', () => {
  // 纯结构锁抓不到 argv 下标的 bug（字面确实在），必须真跑。
  // 这条锁直接复现当时的故障形态：构造一条合法记录，用与脚本相同的调用方式读它。
  const os = require('node:os')
  const { spawnSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argv-lock-'))
  try {
    fs.writeFileSync(path.join(dir, 'r.json'), JSON.stringify({ mode: 'dual' }))
    const code = `
      const path = require('path');
      const f = path.resolve(process.argv[1]);
      let r;
      try { r = require(f); } catch (e) { process.exit(4); }
      const m = r && typeof r.mode === 'string' ? r.mode : '';
      if (!m) process.exit(3);
      process.stdout.write(m);
    `
    const r = spawnSync(process.execPath, ['-e', code, path.join(dir, 'r.json')], { encoding: 'utf8' })
    assert.strictEqual(r.status, 0, '调用必须成功（status=0）；非 0 说明 argv 下标又错了')
    assert.strictEqual(r.stdout.trim(), 'dual', '必须真的读到 mode')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})


test('QM-6 第四轮 i1 行为锁：同变更反复 amend 不得累积多份 alt', () => {
  // 同变更 amend 时 stagedDiffHash 相同 ⇒ 每次都走到「拒写并另存」分支 ⇒
  // 每次都新时间戳 ⇒ 反复 amend 会产生一堆 <64hex>-again-<sha>-<ts>.json。
  //
  // ★ 行为锁（不是结构锁）：首版用「grep altPrefix / readdirSync / unlinkSync 字面」，
  //   变异把 altPrefix 改成 null 后字面全在 ⇒ 锁不红，而去重已失效（M22 实测踩过）。
  //   故改为：真调 saveRecord 两次，数同前缀 alt 的份数。
  const os = require('node:os')
  const { execFileSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-lock-'))
  const origCwd = process.cwd()  // 先取字符串（未绑定的方法引用调用会出问题）
  try {
    // ★ 必须是**真 git 仓库**且 index 干净：这样 git diff --cached 返回空串
    //   ⇒ hashResult.empty=true ⇒ 走「空 diff 回落父 sha」路径。
    //   （非 git 目录会走 error 分支 return null，压根到不了拒写分支 —— 首版正栽在这里。）
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'pipe' })
    fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n')
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: dir, stdio: 'pipe' })
    process.chdir(dir)
    // 造一份「已闭环」的既有记录。文件名用**父 sha 名**（回落路径找的就是它）。
    const SHA = 'b'.repeat(40)
    const reviewsDir = path.join(dir, '.ccg', 'reviews')
    fs.mkdirSync(reviewsDir, { recursive: true })
    const first = path.join(reviewsDir, SHA + '.json')
    fs.writeFileSync(first, JSON.stringify({
      sha: SHA, mode: 'dual',
      deepReview: { required: true, status: 'cleared', performedBy: 'x', findings: [{ id: 'i1' }] },
    }))
    // 连写两次（模拟 amend 后又 amend）：都应走拒写分支
    decider.saveRecord({ mode: 'dual', reason: 'probe', stats: {} }, SHA, 'diff', undefined)
    decider.saveRecord({ mode: 'dual', reason: 'probe2', stats: {} }, SHA, 'diff', undefined)
    const alts = fs.readdirSync(reviewsDir).filter((n) => n.startsWith(SHA + '-again-') && n.endsWith('.json'))
    assert.strictEqual(alts.length, 1,
      '同变更两次写入必须只留一份 alt（去重生效）；实际 ' + alts.length + ' 份：' + alts.join(', '))
    // 原有闭环记录不得被覆盖
    const kept = JSON.parse(fs.readFileSync(first, 'utf8'))
    assert.strictEqual(kept.deepReview.status, 'cleared', '已闭环记录不得被覆盖')
  } finally {
    process.chdir(origCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('QM-6 第四轮 i2：首个提交（无 HEAD^）也必须能命中记录', () => {
  // 残留风险里「未实测无 HEAD^ 场景」那条 —— 首版整个内容寻址段被 _PARENT2 非空守卫挡掉，
  // 于是按 stagedDiffHash 命名的记录在首提交里永远找不到。
  const sh = fs.readFileSync(path.join(__dirname, 'deep-review.sh'), 'utf8')
  assert.match(sh, /git show --no-textconv --no-ext-diff --no-renames --format=/, '无 HEAD^ 时必须改用 git show 取首个提交的 diff')
  assert.match(sh, /仓库只有一笔提交/, '必须明示走了首提交路径')
})

test('QM-6 第四轮 i6：哈希算失败必须不写记录（写则撞名，比不写更糟）', () => {
  // 不写只会让门禁报「缺记录」（可见、可定位）；写父 sha 名则产生一个会与他人冲突的文件。
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
  const s = src.indexOf('function saveRecord')
  const e = src.indexOf('\n}\n', s)
  const body = src.slice(s, e + 3)
  const iRet = body.indexOf('return null')
  const iWrite = body.indexOf('fs.writeFileSync(file')
  assert.ok(iRet > 0, 'error 分支必须 return null')
  assert.ok(iRet < iWrite, 'return null 必须在写文件之前，否则仍然落盘')
})

test('QM-6 第四轮自查：git 调用失败时不得把 null 当成 diff 内容算哈希', () => {
  // 实测踩到（为 i1 行为锁造夹具时发现）：git() 失败返回 null，
  // 而 String(null) 是字符串 "null"（非空）⇒ 旧版 if (!d.trim()) 判不出空
  // ⇒ 对 "null" 算 sha256 得到 74234e98…（sha256("null")）这个稳定但无意义的哈希
  // ⇒ 记录落在假名字下且永远找不到。症状：非 git 目录里 saveRecord 也「成功」写 64 位记录。
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
  // 必须先判 null/undefined，再判空串
  assert.match(src, /d === null \|\| d === undefined/,
    '必须先判 git() 的 null 返回；否则 String(null)="null" 会被当成有内容')
  assert.doesNotMatch(src, /String\(git\(\[/,
    '不得对 git() 的返回值直接 String() —— 那正是把 null 变成 "null" 的一步')
  // 行为证：在非 git 目录里调用，必须 return null 且不写文件
  const os = require('node:os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullhash-'))
  const origCwd = process.cwd()
  try {
    process.chdir(dir)
    const out = decider.saveRecord({ mode: 'dual', reason: 'p', stats: {} }, 'c'.repeat(40), 'diff', undefined)
    assert.strictEqual(out, null, '非 git 目录必须 return null 不落盘（写则产出无意义哈希的记录）')
    const files = fs.existsSync(path.join(dir, '.ccg', 'reviews'))
      ? fs.readdirSync(path.join(dir, '.ccg', 'reviews'))
      : []
    assert.strictEqual(files.length, 0, '不得写出任何记录文件')
  } finally {
    process.chdir(origCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ══════════════════════════════════════════════════════════════════════════
//  QM-6 评审后端可配置（change: qm6-review-backend-config，2026-10-18）
//  动因：换 critic 的三种旋钮全部静默失效，而仓里把后端对抄成六份字面量 ——
//  判定器说「两个后端都不可用」，入口体检仍按老名单，两边互不认账。
// ══════════════════════════════════════════════════════════════════════════

const RB_LIB = require(path.join(__dirname, 'lib', 'ccg-review-backends.js'))

/** 用给定 env 造一个 detectBackends() 形状的对象，但不碰 PATH（PATH 结果因机而异）。 */
function fakeBackends(env) {
  const prev = { c: process.env.MP_QM6_CRITIC, p: process.env.MP_QM6_PROPOSER }
  if (env.MP_QM6_CRITIC === undefined) delete process.env.MP_QM6_CRITIC
  else process.env.MP_QM6_CRITIC = env.MP_QM6_CRITIC
  if (env.MP_QM6_PROPOSER === undefined) delete process.env.MP_QM6_PROPOSER
  else process.env.MP_QM6_PROPOSER = env.MP_QM6_PROPOSER
  try {
    const resolved = RB_LIB.resolveBackends()
    const names = RB_LIB.backendNames(resolved)
    const installed = env.installed || names
    const byName = {}
    for (const n of names) byName[n] = installed.includes(n)
    return { names, byName, resolved, wrapper: 'x', wrapperExists: true }
  } finally {
    if (prev.c === undefined) delete process.env.MP_QM6_CRITIC
    else process.env.MP_QM6_CRITIC = prev.c
    if (prev.p === undefined) delete process.env.MP_QM6_PROPOSER
    else process.env.MP_QM6_PROPOSER = prev.p
  }
}

test('后端对文案必须由单一真源派生：换 critic 后目标串与覆盖提示都要跟着变', () => {
  const f = decider.backendNoticeLines
  assert.strictEqual(typeof f, 'function',
    'backendNoticeLines 必须导出 —— 否则本锁退化成「读源码字面」，改文案就失配')

  const dflt = f(fakeBackends({}), 'dual').join('\n')
  assert.match(dflt, /双模型\(claude \+ opencode\)/, `默认必须报既有形态，实得：${dflt}`)
  assert.doesNotMatch(dflt, /已被覆盖/, '未覆盖时不得凭空打「已被覆盖」')

  const swapped = f(fakeBackends({ MP_QM6_CRITIC: 'codex' }), 'dual').join('\n')
  assert.match(swapped, /双模型\(codex \+ opencode\)/, `换 critic 后目标串必须跟着变，实得：${swapped}`)
  assert.doesNotMatch(swapped, /双模型\(claude/, '旧后端名不得残留在目标串里')
  // 覆盖必须出声：静默的旋钮等于没旋钮（本次事故的第一手原因就是没有任何地方回显
  // 「你以为的 critic 是谁」）。
  assert.match(swapped, /评审后端已被覆盖/, '覆盖必须出声')
  assert.match(swapped, /critic=codex\(env\)/, '出声必须点名来源档位（env/cli/default）')
})

test('同族单后端是显式配置，不得报成「少了一个后端」的降级', () => {
  // needDistinct 判据的反直觉一侧：proposer===critic 时 names 只有一个元素，
  // 若沿用旧的 `available.length < 2` 就会把「一个人干两份活」打成就绪度不足。
  const same = fakeBackends({ MP_QM6_CRITIC: 'claude', MP_QM6_PROPOSER: 'claude' })
  const out = decider.backendNoticeLines(same, 'dual').join('\n')
  assert.doesNotMatch(out, /降级为单后端/, `同族单后端不得报降级，实得：${out}`)
  assert.match(out, /后端就绪/, '同族单后端且该后端可用 ⇒ 必须照样报就绪')

  // 反向：双后端里真缺一个 ⇒ 必须报降级（这条不把上面那条否证掉）
  const half = fakeBackends({ installed: ['claude'] })
  assert.match(decider.backendNoticeLines(half, 'dual').join('\n'), /降级为单后端 \+ 补一次 agent 自评/)
})

test('一个后端都不可用时的文案必须点名「探测了哪些名字」，不得写死「两个」', () => {
  // 「两个后端 CLI 都不可用」这句里的量词是抄来的：换成单后端配置后它会说错数量，
  // 而排查者会去找一个不存在的第二个后端。
  const none = fakeBackends({ MP_QM6_CRITIC: 'codex', installed: [] })
  const out = decider.backendNoticeLines(none, 'dual').join('\n')
  assert.match(out, /都不可用/, '不可用分支必须保留')
  assert.match(out, /已探测 codex \/ opencode/, `必须点名实际探测的名单，实得：${out}`)
  assert.doesNotMatch(out, /两个后端/, '不得再写死量词「两个」')
})

test('detectBackends 的探测名单必须跟随配置（不能再固定成 claude/opencode 两个键）', () => {
  const prev = { c: process.env.MP_QM6_CRITIC, p: process.env.MP_QM6_PROPOSER }
  process.env.MP_QM6_CRITIC = 'codex'
  try {
    const b = decider.detectBackends()
    assert.deepEqual(b.names, ['codex', 'opencode'], `名单必须跟着配置走，实得 ${JSON.stringify(b.names)}`)
    assert.ok('codex' in b.byName, 'byName 必须按配置的名字建键')
    assert.equal('claude' in b.byName, false, '配置里没写的后端不得再被探测（旧实现写死两个键）')
    assert.equal(b.resolved.critic, 'codex')
  } finally {
    if (prev.c === undefined) delete process.env.MP_QM6_CRITIC
    else process.env.MP_QM6_CRITIC = prev.c
    if (prev.p === undefined) delete process.env.MP_QM6_PROPOSER
    else process.env.MP_QM6_PROPOSER = prev.p
  }
})

test('判定记录必须写下「本次请求的后端对」，否则换后端在机器上不留痕', () => {
  // 这是本刀的关键落点：请求值落进记录后，check-pr-exec-record.js 才能拿它与
  // 驱动回填的 deepReview.performedBy 对账。没有这一字段，「设了没生效」就只能靠人盯终端。
  const { execFileSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `qm6-rec-${process.pid}-`))
  const origCwd = process.cwd()
  const prev = process.env.MP_QM6_CRITIC
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'pipe' })
    fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n')
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: dir, stdio: 'pipe' })
    process.chdir(dir)
    process.env.MP_QM6_CRITIC = 'codex'
    const SHA = 'a'.repeat(40)
    const out = decider.saveRecord({ mode: 'dual', reason: 'probe', stats: {} }, SHA, 'diff', undefined)
    assert.ok(out, 'saveRecord 必须返回落盘路径')
    const rec = JSON.parse(fs.readFileSync(out, 'utf8'))
    assert.ok(rec.reviewBackends, '记录必须含 reviewBackends 字段')
    assert.equal(rec.reviewBackends.critic, 'codex')
    assert.equal(rec.reviewBackends.from.critic, 'env', '必须记下来源档位，便于区分「谁设的」')
    assert.equal(rec.reviewBackends.proposer, 'opencode')
    assert.equal(rec.reviewBackends.overridden, true)
  } finally {
    process.chdir(origCwd)
    if (prev === undefined) delete process.env.MP_QM6_CRITIC
    else process.env.MP_QM6_CRITIC = prev
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('禁词锁：decider 代码里不得再出现写死的后端名字面量（剥注释后判）', () => {
  // 必须剥注释：本文件与 lib 的说明文字里合法地出现这些名字（在说「过去是什么」），
  // 不剥注释的禁词锁会恒假红 —— 这是本仓记过的同型错误（判据错，不是实现错）。
  // 也不得连 ".claude" 这条路径一起误杀：它在引号里带点，判据按 "claude" 全引号匹配。
  const raw = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
  const code = raw
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(code, /["'`]claude["'`]/, '不得出现 "claude" 字面量（名单只准来自 lib）')
  assert.doesNotMatch(code, /["'`]opencode["'`]/, '不得出现 "opencode" 字面量（名单只准来自 lib）')
  assert.match(code, /ccg-review-backends/, '必须引用单一真源模块')
  // 反失明：剥注释确实生效了（原文里注释含 claude，代码里不该含）
  assert.ok(/claude/.test(raw), '前提自证：源文件里应仍有 claude（在注释/路径里），否则本锁在测空集')
  assert.ok(!/["'`]claude["'`]/.test(code), '前提自证：剥注释后的代码面应不含该字面量')
})

test('接线锁：两个入口脚本必须引用同一个后端真源，且不得自带名单', () => {
  for (const name of ['deep-review.sh', 'plan-review.sh']) {
    const sh = fs.readFileSync(path.join(__dirname, name), 'utf8')
    assert.match(sh, /\.\s+"\$_self_dir_abs\/lib\/ccg-backends\.sh"/,
      `${name} 必须经单一真源取后端名单，否则它仍会按老名单体检`)
    // 反失明：确认这两份脚本里确实有「按后端循环」这件事，不是把引用加在一个空转的分支上
    assert.match(sh, /report_backends/, `${name} 应仍有 report_backends 体检面`)
  }
})

function toLfLocal (s) { return s.replace(/\r\n/g, '\n') }


// ── QM-6 丙：来源意图必须是结构化字段（不靠 performedBy 散文）────────────────
// 实测主干 827 份产物里 performedBy 有 34 种自由写法，其中 12 条以 "self-play" 开头
// 却同时声明做过外部复核 ⇒ 任何按前缀分级的判据都会当场误判那 12 份。
// 判据只能读 tier（闭集）+ evidence（出处），二者合取才算外部证据。
test('丙：判定记录初始化必须带 tier=unknown 与 evidence=null（新记录天生带字段，不留空让人猜）', () => {
  const init = decider.buildDeepReviewInit
  assert.strictEqual(typeof init, 'function', '必须导出纯函数 buildDeepReviewInit（只 grep 源码的结构锁会被 if(false&&) 绕过，本仓已踩过）')
  for (const m of ['dual', 'single']) {
    const dr = init(m)
    assert.strictEqual(dr.tier, 'unknown', 'mode=' + m + ' 的初始来源档必须是 unknown')
    assert.strictEqual(dr.evidence, null, 'evidence 初始必须是 null，不得是空串（空串会被误当"已填")')
    assert.strictEqual(dr.status, 'pending')
    assert.strictEqual(dr.required, true)
  }
  assert.strictEqual(init('skip').required, false, 'skip 仍不得置 required（缺陷G 口径不变）')
  assert.strictEqual(init('skip').tier, 'unknown', 'skip 也要有 tier 字段，否则下游要处理两种形状')
})

test('丙：saveRecord 必须真的用初始化函数（接线锁，防"字段定义了但没人写")', () => {
  const src = toLfLocal(fs.readFileSync(path.join(__dirname, 'ccg-review-decider.js'), 'utf8'))
  assert.match(src, /deepReview:\s*buildDeepReviewInit\(result\.mode\)/,
    'saveRecord 必须调用 buildDeepReviewInit —— 手写字面量的话新增字段会在下一次被漏掉')
})

// ── QM-6 丙 3.x：降级资格以物证为准 ──────────────────────────────────────────
// detectBackends()（:641）已经在算 {wrapperExists, claude, opencode}，但从未落进判定记录
// ⇒ 「CLI 不可用」只能靠自述。规格里 D6 的落点就是把这份现场钉进产物。
// 夹具沿用本文件既有的「真 git 仓库 + chdir + 真调 saveRecord」写法，不另起一套。
function withTempGitRepo (fn) {
  const os = require('node:os')
  const { execFileSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avail-lock-'))
  const origCwd = process.cwd()
  try {
    // 必须是真 git 仓库且 index 干净：git diff --cached 为空 ⇒ 走「父 sha 命名」回落路径。
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: dir, stdio: 'pipe' })
    fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed' + String.fromCharCode(10))
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' })
    execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: dir, stdio: 'pipe' })
    process.chdir(dir)
    return fn(dir)
  } finally {
    process.chdir(origCwd)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('丙3.4 summarizeBackendAvailability：0/1/2 必须分档（1/2 与 2/2 不得同形）', () => {
  const s = decider.summarizeBackendAvailability
  assert.strictEqual(typeof s, 'function', '必须导出纯函数（内联在 saveRecord 里的话行为锁无从注入）')
  const two = s({ wrapperExists: true, names: ['claude', 'opencode'], byName: { claude: true, opencode: true } })
  const one = s({ wrapperExists: true, names: ['claude', 'opencode'], byName: { claude: true, opencode: false } })
  const none = s({ wrapperExists: false, names: ['claude', 'opencode'], byName: { claude: false, opencode: false } })
  assert.deepStrictEqual([two.count, one.count, none.count], [2, 1, 0])
  assert.notDeepStrictEqual(two, one, '两档必须可区分 —— 只看"有没有"时 2/2 与 1/2 长成一个样')
  assert.strictEqual(one.partial, true)
  assert.strictEqual(two.partial, false)
  assert.strictEqual(two.wrapperReady, true)
  assert.strictEqual(none.wrapperReady, false)
  assert.deepStrictEqual(none.backends, { wrapperExists: false, names: ['claude', 'opencode'], onPath: [] })
})

test('丙3.1 行为锁：saveRecord 必须把可用性写进记录（注入夹具，不碰本机 PATH）', () => {
  withTempGitRepo(() => {
    const written = decider.saveRecord(
      { mode: 'dual', reason: 'probe', stats: {} }, 'a'.repeat(40), 'diff', undefined,
      { wrapperExists: true, names: ['claude', 'opencode'], byName: { claude: true, opencode: false } }
    )
    assert.ok(written, 'saveRecord 应返回落盘路径')
    const rec = JSON.parse(fs.readFileSync(written, 'utf8'))
    assert.ok(rec.backendAvailability, '记录必须含 backendAvailability —— 否则"CLI 不可用"只能靠自述')
    assert.strictEqual(rec.backendAvailability.count, 1)
    assert.strictEqual(rec.backendAvailability.partial, true)
    assert.deepStrictEqual(rec.backendAvailability.backends, { wrapperExists: true, names: ['claude', 'opencode'], onPath: ['claude'] })
    assert.strictEqual(rec.deepReview.tier, 'unknown', '本轮初始化的 tier 不得被可用性落盘顺带改掉')
  })
})

test('丙3.3 默认路径不得丢字段：不注入后端时也要写出可读的可用性', () => {
  withTempGitRepo(() => {
    const written = decider.saveRecord({ mode: 'single', reason: 'probe', stats: {} }, 'b'.repeat(40), 'diff', undefined)
    const rec = JSON.parse(fs.readFileSync(written, 'utf8'))
    assert.ok(rec.backendAvailability, '缺省调用也要有该字段，否则新记录形状分成两种')
    assert.ok(Number.isInteger(rec.backendAvailability.count) && rec.backendAvailability.count >= 0 && rec.backendAvailability.count <= rec.backendAvailability.total, 'count 必须是 0..total 的整数，不得是 undefined 或布尔')
    assert.strictEqual(typeof rec.backendAvailability.wrapperReady, 'boolean')
    const expect = decider.summarizeBackendAvailability(decider.detectBackends())
    assert.deepStrictEqual(rec.backendAvailability, expect,
      '默认路径必须真的探测一次 —— 把 detectBackends 回退摘掉就会写成全 false，与本机现场不符')
    // 反真空留痕：若这台机器两个后端都没装，上一条会因「两边都是 0/false」而恒真 ⇒ 必须打印现场，
    // 让读者看见它到底测到了什么（同仓规矩：每次跑要打印走的是哪条支路 + 关键实测值）。
    console.log('  [avail] 默认路径现场 count=' + expect.count + ' wrapperReady=' + expect.wrapperReady +
      ' names=' + expect.backends.names.join(',') + ' onPath=' + (expect.backends.onPath.join(',') || 'none'))
  })
})

test('丙3.2 接线锁：main 必须把已算出的 backends 传给 saveRecord', () => {
  const src = fs.readFileSync(path.join(__dirname, 'ccg-review-decider.js'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(src, /saveRecord\(\s*result,\s*sha,[\s\S]{0,90}staged\.plannedFiles,\s*backends\s*\)/,
    '调用点漏传 backends ⇒ 记录里的可用性来自第二次探测，与判定时的现场不是同一份（本机 PATH 中途变了就漂移）')
})

// ── 2026-10-17 后端命中：saveRecord 不得把「读不动」当成「没有」而覆盖既有评审证据 ────
test('后端命中：同名记录存在但解析不动 ⇒ 逐字节保留它、本次另存 alt、且出声', () => {
  withTempGitRepo(() => {
    const first = decider.saveRecord(
      { mode: 'dual', reason: 'probe-1', stats: {} }, 'c'.repeat(40), 'diff', undefined,
      { wrapperExists: true, claude: true, opencode: true }
    )
    assert.ok(first, '首次落盘必须有路径')
    const corrupt = '{"mode":"dual","deepReview":{"status":"clea'
    fs.writeFileSync(first, corrupt, 'utf8')

    const logs = []
    const orig = console.log
    console.log = (m) => { logs.push(String(m)) }
    let second
    try {
      second = decider.saveRecord(
        { mode: 'dual', reason: 'probe-2', stats: {} }, 'c'.repeat(40), 'diff', undefined,
        { wrapperExists: true, claude: true, opencode: true }
      )
    } finally { console.log = orig }

    assert.strictEqual(fs.readFileSync(first, 'utf8'), corrupt,
      '损坏的既有记录必须逐字节原样保留 —— 覆盖它等于销毁已交付的评审证据（status/findings 都在那份里）')
    assert.notStrictEqual(second, first, '本次判定必须落到 alt 路径，而不是原地覆盖')
    assert.match(path.basename(second), /-again-/, 'alt 命名必须沿用既有 -again- 形态，便于扫描域认出')
    assert.ok(logs.some((l) => /解析不动/.test(l)), '降级方向必须出声，不得静默改道')
  })
})

// ── 跨模块命名对齐锁（2026-10-17 前端轴命中，实测后果比命中本身更硬）──────────────
// 生产者 alt 名与扫描域形态表从来就没对上：旧实现 .replace(/[:.]/g,'') 留着 ISO 的连字符，
// 产出 `-again-<40hex>-2026-10-17T025039620Z`，而 AUDIT_ARTIFACT_RE 要的是 `20261017T091333.123Z`。
// 主干现存的真件即旧形态（git ls-tree origin/main -- .ccg/reviews 可复取），故 alt 从未参与欠账判定。
const gateNaming = require('./check-pr-exec-record.js')

test('跨模块命名对齐锁：生产者写出的 alt 文件名必须被扫描域的形态表认出', () => {
  withTempGitRepo(() => {
    const first = decider.saveRecord(
      { mode: 'dual', reason: 'p1', stats: {} }, 'e'.repeat(40), 'diff', undefined,
      { wrapperExists: true, claude: true, opencode: true }
    )
    const rec = JSON.parse(fs.readFileSync(first, 'utf8'))
    rec.deepReview = { required: true, status: 'cleared', tier: 'external', evidence: 'ses_probe0001', performedBy: 'claude', findings: [] }
    fs.writeFileSync(first, JSON.stringify(rec), 'utf8')

    const alt = decider.saveRecord(
      { mode: 'dual', reason: 'p2', stats: {} }, 'e'.repeat(40), 'diff', undefined,
      { wrapperExists: true, claude: true, opencode: true }
    )
    assert.notStrictEqual(alt, first, '既有记录已闭环 ⇒ 第二次必须另存 alt')
    assert.match(path.basename(alt), /-again-/, 'alt 必须沿用 -again- 形态')
    assert.ok(gateNaming.AUDIT_ARTIFACT_RE.test('.ccg/reviews/' + path.basename(alt)),
      `alt 产物必须被扫描域认出，否则它不参与欠账判定：${path.basename(alt)}`)
  })
})

// ── 现场形状契约锁（2026-10-17 rebase 到 #3927 之后发现的真缺陷）───────────────────
// 现场事实：detectBackends() 的返回形状变成 { wrapper, wrapperExists, resolved, names, byName } 后，
// 旧的 summarizeBackendAvailability 仍读 b.claude / b.opencode ⇒ 本机明明两个后端都可用，
// 写进判定记录的却是 count=0。丙3.3 那条"和自己推导比一次"的断言两侧同错，完全看不出来。
test('现场形状契约锁：可用性汇总必须由 detectBackends 的真实字段推导（夹具不得替对方把数算好）', () => {
  const live = decider.detectBackends()
  assert.ok(Array.isArray(live.names) && live.names.length >= 1,
    `名单必须非空（探测名单来自单一真源 list），实际=${JSON.stringify(live.names)}`)
  assert.deepStrictEqual([...Object.keys(live.byName)].sort(), [...live.names].sort(),
    'byName 必须逐个覆盖名单 —— 有名字没被探过就等于"没测"')

  const s = decider.summarizeBackendAvailability(live)
  const expected = live.names.filter((n) => live.byName[n] === true)
  console.log('  [现场形状] names=' + live.names.join(',') + ' byName=' + JSON.stringify(live.byName) +
    ' ⇒ count=' + s.count + '/' + s.total + ' wrapperReady=' + s.wrapperReady)
  assert.strictEqual(s.count, expected.length, 'count 必须由真实 byName 推导，不是由夹具里的两个布尔推导')
  assert.strictEqual(s.total, live.names.length, '分母必须等于本轮真要用的后端数')
  assert.deepStrictEqual(s.backends.onPath, expected, 'onPath 必须逐字等于探测命中集')

  // 反向锁：旧形状交进来必须得 0 —— 这不是兼容层，而是把「读错形状 = 静默失明」钉成可见事实
  const legacy = decider.summarizeBackendAvailability({ wrapperExists: true, claude: true, opencode: true })
  assert.strictEqual(legacy.count, 0, '旧形状里没有 names ⇒ 汇总必须得 0；这正说明当初写进记录的 count=0 是读错形状，不是后端真不可用')
  assert.strictEqual(legacy.total, 0, '分母同样为 0，不得凭空算成 2')
})
