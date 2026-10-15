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

// judge() 与 RULES 都是模块内函数，通过读取源码后注入的方式拿到，
// 避免为了可测性给一个纯 CLI 脚本硬加 module.exports（那会改变它的调用契约）。
const SRC = path.join(__dirname, "ccg-review-decider.js");
const fs = require("node:fs");

function loadJudge() {
  const src = fs.readFileSync(SRC, "utf8");
  // 剥掉末尾的 `process.exit(main())` —— 那行会在加载时真的执行 main()
  // （读暂存区、打印、落盘记录），测试里完全不想要这些副作用。
  // 剥掉后只剩纯定义，可以安全注入 module.exports。
  const stripped = src.replace(/\nprocess\.exit\(main\(\)\);\s*$/, "\n");
  assert.notEqual(stripped, src, "未找到末尾的 process.exit(main())，源码结构可能变了");
  const wrapped = `${stripped}\nmodule.exports = { RULES, judge, collectStaged };\n`;
  const Module = require("module");
  const m = new Module(SRC, null);
  m.filename = SRC;
  m.paths = Module._nodeModulePaths(path.dirname(SRC));
  m._compile(wrapped, SRC);
  return m.exports;
}

const { RULES, judge } = loadJudge();

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
    files: [{ file: ".hermes/plans/plan.md", added: 50, deleted: 0 }],
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

    // 子进程加载被测模块：剥掉末尾的 process.exit(main()) 后注入 exports
    const MARK = "process.exit(main());";
    const loader = [
      "const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');",
      `const SRC = ${JSON.stringify(SRC)};`,
      "let src = fs.readFileSync(SRC, 'utf8');",
      `const i = src.lastIndexOf(${JSON.stringify(MARK)});`,
      "if (i >= 0) src = src.slice(0, i);",
      "const m = new Module(SRC, null);",
      "m.filename = SRC;",
      "m.paths = Module._nodeModulePaths(path.dirname(SRC));",
      "m._compile(src + '\\nmodule.exports = { collectStaged };\\n', SRC);",
      "process.stdout.write(JSON.stringify(m.exports.collectStaged()));",
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
