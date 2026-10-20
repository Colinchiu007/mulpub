"use strict";
/**
 * QM-6 评审后端对单一真源的行为锁（change: qm6-review-backend-config）。
 *
 * 动因（2026-10-18 实测）：把 critic 换成 codex 试了三种旋钮全无效 ——
 * 改 ~/.claude/.ccg/config.toml（驱动压根不读它）、给入口传 --critic（入口只转发
 * --sha，参数被丢弃）、直连驱动传 --critic（验证层不应用覆盖）。根因是仓侧六份
 * 后端名字面量 + 驱动侧覆盖块只挂在决策层分支。本锁先守住「仓侧只有一份策略」，
 * 并让「设了没生效」在下游变成判不闭合（见 check-pr-exec-record.test.js 的
 * backendMismatch 锁），而不是变成安静地按默认跑完。
 *
 * 接线约束：本文件只 require node 内置模块 —— 它接在 quality-gate.yml 的 changes
 * 作业（无 job 级 if），那个作业没有 Install deps。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const LIB = path.join(__dirname, "ccg-review-backends.js");
const m = require(LIB);

test("清单缺失时才回落 DEFAULTS，且必须如实标 default（与驱动现值对齐）", () => {
  // file:null ⇒ 走「文件不存在」分支。真实清单存在时来源应标 list，那是另一条锁。
  const r = m.resolveBackends({ env: {}, file: null });
  assert.equal(r.proposer, "opencode");
  assert.equal(r.critic, "claude");
  assert.deepEqual(r.from, { proposer: "default", critic: "default" });
  assert.equal(r.overridden, false);
  // 回落必须出声：静默回落 = 「改了清单但没人读到」重新变成不可见。
  assert.ok((r.notes || []).some((n) => /清单缺失/.test(n)), `notes 应点名清单缺失，实得 ${JSON.stringify(r.notes)}`);
});

test("真源清单必须存在、恰好两行有效内容，且默认值与驱动现值一致", () => {
  // 这条是「本仓默认」与「上游驱动 cfgForMode」不打架的唯一机械依据。
  // 清单被删/被改成一行或三行 ⇒ 两个读取方会各取一格错的那一份，当场判红。
  const src = m.loadSourceList();
  assert.ok(src.fileUsed, "必须真的读到清单文件（读不到说明路径漂移，而回落会把漂移伪装成默认值）");
  assert.ok(fs.existsSync(m.SOURCE_FILE), `清单文件必须存在：${m.SOURCE_FILE}`);
  assert.equal(src.critic, m.DEFAULTS.critic);
  assert.equal(src.proposer, m.DEFAULTS.proposer);
  const r = m.resolveBackends({ env: {} });
  assert.deepEqual(r.from, { proposer: "list", critic: "list" }, "默认路径的来源必须如实标 list");
});

test("清单有效行数不为 2 一律抛错（多一行少一行都会让两个读取方取错那一格）", () => {
  for (const bad of ["claude\n", "claude\nopencode\ngemini\n", "", "# 只有注释\n"]) {
    assert.throws(
      () => m.resolveBackends({ env: {}, sourceText: bad }),
      /有效行数/,
      `应拒绝：${JSON.stringify(bad)}`
    );
  }
  // 注释行与空行必须被忽略（清单里那些说明文字不该被当成第三个后端）
  const ok = m.resolveBackends({ env: {}, sourceText: "# c\n\nclaude\n\nopencode\n#\n" });
  assert.equal(ok.critic, "claude");
  assert.equal(ok.proposer, "opencode");
});

test("env 覆盖只改它那一格，另一格仍回落清单", () => {
  const r = m.resolveBackends({ env: { MP_QM6_CRITIC: "codex" }, sourceText: "claude\nopencode\n" });
  assert.equal(r.critic, "codex");
  assert.equal(r.proposer, "opencode");
  assert.equal(r.from.critic, "env");
  assert.equal(r.from.proposer, "list");
  assert.equal(r.overridden, true);
});

test("CLI 参数优先级高于 env（同一条命令里 env 与旗标并存时取旗标）", () => {
  const r = m.resolveBackends({
    env: { MP_QM6_CRITIC: "codex" },
    cli: { critic: "gemini" },
  });
  assert.equal(r.critic, "gemini");
  assert.equal(r.from.critic, "cli");
});

test("空白值算「没配」必须继续回落默认，不得抛错", () => {
  // CI 表达式里 VAR="" 是「未配置」的常见形态；判成故障会把所有 PR 打红。
  const r = m.resolveBackends({ env: { MP_QM6_CRITIC: "  ", MP_QM6_PROPOSER: "" } });
  assert.equal(r.critic, "claude");
  assert.equal(r.proposer, "opencode");
  assert.equal(r.overridden, false);
});

test("非空但不合法的后端名一律抛错（fail closed，不得静默回落）", () => {
  // 静默回落默认值 = 重新制造「以为换了后端其实没换」这个本次要消灭的形态。
  for (const bad of ["codex; rm -rf /", "$(whoami)", "a b", "1claude", "-codex", "x".repeat(33),
    "a`b", "claude|whoami", "a'b", 'a"b', "a\\b", "a\tb"]) {
    assert.throws(
      () => m.resolveBackends({ env: { MP_QM6_CRITIC: bad } }),
      /评审后端名不合法/,
      `应拒绝：${JSON.stringify(bad)}`
    );
    assert.throws(
      () => m.resolveBackends({ cli: { critic: bad } }),
      /评审后端名不合法/,
      `cli 侧同样应拒绝：${JSON.stringify(bad)}`
    );
  }
});

test("合法形态必须放行（含点/横线/下划线，否则会把 codex-cli 一类真名误拒）", () => {
  for (const ok of ["codex", "codex-cli", "claude_code", "gemini.3", "Opencode"]) {
    const r = m.resolveBackends({ env: { MP_QM6_CRITIC: ok } });
    assert.equal(r.critic, ok);
  }
});

test("体检名单按 critic 在前去重，同族单后端不得列出两个", () => {
  assert.deepEqual(
    m.backendNames(m.resolveBackends({ env: {} })),
    ["claude", "opencode"]
  );
  const same = m.resolveBackends({ env: { MP_QM6_CRITIC: "claude", MP_QM6_PROPOSER: "claude" } });
  assert.deepEqual(m.backendNames(same), ["claude"]);
});

test("同名字担任两职时角色文案必须如实说「两者」", () => {
  // 只写「评审后端（主力）」会让体检输出把「只有一个后端」打成「两个都就绪」。
  const same = m.resolveBackends({ env: { MP_QM6_CRITIC: "claude", MP_QM6_PROPOSER: "claude" } });
  assert.match(m.roleOf("claude", same), /两者|同族单后端/);
  const dual = m.resolveBackends({ env: {} });
  assert.equal(m.roleOf("claude", dual), "评审后端（主力）");
  assert.equal(m.roleOf("opencode", dual), "出方案后端 / 跨家族校验");
});

test("目标文案必须与既有记录对照表逐字一致（critic 在前）", () => {
  // openspec/records/fix-ccg-decider-defects.md 的映射表就是按这个形态写的，
  // 换顺序会让历史记录读起来像在说另一个后端对。
  const d = m.resolveBackends({ env: {} });
  assert.equal(m.formatTarget("dual", d), "双模型(claude + opencode)");
  assert.equal(m.formatTarget("single", d), "单模型(claude)");
  const c = m.resolveBackends({ env: { MP_QM6_CRITIC: "codex" } });
  assert.equal(m.formatTarget("dual", c), "双模型(codex + opencode)");
  assert.equal(m.formatTarget("single", c), "单模型(codex)");
});

test("未登记后端名的安装提示不得编造包名", () => {
  assert.equal(m.installHint("claude"), "@anthropic-ai/claude-code");
  assert.equal(m.installHint("totally-unknown"), "对应 CLI");
});

// ---------- CLI 行为锁：真起子进程，不读源码字面 ----------
function runCli(args, env) {
  return spawnSync(process.execPath, [LIB, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...(env || {}) },
  });
}

test("CLI --print-names / --print-table / --target 必须真的按 env 与旗标解析", () => {
  const names = runCli(["--print-names"], { MP_QM6_CRITIC: "codex" });
  assert.equal(names.status, 0, names.stderr);
  // critic 在前：换后端后体检顺序必须跟着变，否则入口仍按老名单体检。
  assert.equal(names.stdout.trim(), "codex opencode");

  const tsv = runCli(["--print-table"], { MP_QM6_CRITIC: "codex" });
  assert.equal(tsv.status, 0, tsv.stderr);
  const rows = tsv.stdout.trim().split(/\r?\n/);
  assert.equal(rows.length, 2, `table 应两行，实得 ${tsv.stdout}`);
  // 分隔符是竖线不是制表符：sh 侧用 IFS='|' read 读，POSIX shell 里写不出可靠的 \t。
  assert.equal(rows[0], "codex|评审后端（主力）|@openai/codex");

  const tgt = runCli(["--target", "dual"], {});
  assert.equal(tgt.status, 0, tgt.stderr);
  assert.equal(tgt.stdout.trim(), "双模型(claude + opencode)");

  // 旗标覆盖 env：入口传的是 --critic <值>，这一格必须赢（否则"传了"读起来等于"没传"）
  const cliWin = runCli(["--critic", "gemini", "--print-names"], { MP_QM6_CRITIC: "codex" });
  assert.equal(cliWin.status, 0, cliWin.stderr);
  assert.equal(cliWin.stdout.trim(), "gemini opencode");
});

test("CLI 参数不得被静默忽略：未知旗标 / 缺值 / 模式数不为 1 一律 rc=2", () => {
  // 这是本仓「参数静默失效」的同型防线：--target 的值若被当未知旗标拒掉，
  // 说明消费顺序写错了；反过来若放行，入口会以为传成功了。
  const cases = [
    [["--print-names", "--oops"], /未知旗标/],
    [["--critic"], /缺值/],
    [["--critic", "--print-names"], /缺值/],
    [["--print-names", "--print-table"], /只能指定一个模式/],
    [[], /只能指定一个模式/],
    [["--target", "both"], /只认 dual \/ single/],
  ];
  for (const [args, expect] of cases) {
    const r = runCli(args, {});
    assert.equal(r.status, 2, `${JSON.stringify(args)} 应 rc=2，实得 rc=${r.status} out=${r.stdout}`);
    assert.match(r.stderr, expect, `${JSON.stringify(args)} 的 stderr 应含 ${expect}，实得 ${r.stderr}`);
    assert.equal(r.stdout, "", `${JSON.stringify(args)} 拒参数时不得同时吐输出`);
  }
});

test("CLI 遇不合法后端名必须 rc=2 且在 stderr 出声（入口据此 fail-closed）", () => {
  const r = runCli(["--print-names"], { MP_QM6_CRITIC: "bad name" });
  assert.equal(r.status, 2, `应 rc=2，实得 rc=${r.status} out=${r.stdout} err=${r.stderr}`);
  assert.match(r.stderr, /评审后端名不合法/);
  assert.equal(r.stdout, "", "rc=2 时不得同时吐出半个名单，否则入口会拿去继续跑");
});

test("反失明：CLI 三种输出都不得为空串（解析退化必须可见）", () => {
  for (const args of [["--print-names"], ["--print-table"], ["--print-json"]]) {
    const r = runCli(args, {});
    assert.equal(r.status, 0, `${args} rc=${r.status} err=${r.stderr}`);
    assert.ok(r.stdout.trim().length > 0, `${args} 输出为空 —— 解析退化`);
  }
});

test("判据本体存在性锁：DEFAULTS 必须与驱动现值对齐（否则本仓默认与驱动默认分叉）", () => {
  assert.deepEqual({ ...m.DEFAULTS }, { proposer: "opencode", critic: "claude" });
  assert.equal(m.ENV_PROPOSER, "MP_QM6_PROPOSER");
  assert.equal(m.ENV_CRITIC, "MP_QM6_CRITIC");
  assert.ok(fs.existsSync(LIB));
});

// ---------- 评审时请求值的回写（applyReviewRequestToRecord + CLI --record-request） ----------
//
// 这一段守的是 #3927 自己造出的假红：评审时换了后端，请求值却没落进判定记录，
// 于是 check-pr-exec-record.js 的 backendMismatch 对账拿"提交时清单里的后端"去比
// "驱动回填的署名"，每一次**合法**覆盖都被判成未闭合。
// 判据一律取**回写后那份文件的实际字节**，不取返回值：返回 ok 而文件没变，
// 下游照样是假红（同型于本仓「夹具自报成功不等于效果成立」）。
const os = require("node:os");

let recSeq = 0;
function mkRecDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), `qm6-rec-${process.pid}-${recSeq++}-`));
}
function writeRec(dir, content) {
  const p = path.join(dir, "rec.json");
  fs.writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf8");
  return p;
}
const REQ_CODEX = {
  critic: "codex",
  proposer: "opencode",
  from: { critic: "cli", proposer: "list" },
  notes: [],
  overridden: true,
};
const AT_COMMIT = {
  critic: "claude",
  proposer: "opencode",
  from: { critic: "list", proposer: "list" },
  notes: [],
  overridden: false,
};

test("回写：新值进顶层、提交时那份挪进 commitRequest、其它字段逐字不动", () => {
  const d = mkRecDir();
  const p = writeRec(d, {
    mode: "dual",
    highRiskDomains: ["auth"],
    reviewBackends: AT_COMMIT,
    deepReview: { status: "cleared", performedBy: "codex" },
  });
  const res = m.applyReviewRequestToRecord(p, REQ_CODEX);
  assert.equal(res.ok, true, res.reason);
  const rec = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(rec.reviewBackends.critic, "codex");
  assert.equal(rec.reviewBackends.overridden, true);
  assert.equal(rec.reviewBackends.commitRequest.critic, "claude",
    "覆盖不得销毁审计链 —— 提交时请求的是谁必须看得见");
  assert.ok(typeof rec.reviewBackends.rewrittenAt === "string" && rec.reviewBackends.rewrittenAt.length > 0,
    "改写时间必须留痕，否则无法区分「本来就这样」和「被回写过」");
  assert.equal(rec.mode, "dual", "回写只动 reviewBackends");
  assert.deepEqual(rec.highRiskDomains, ["auth"], "高危域标签是豁免判据的输入，不得被动");
  assert.equal(rec.deepReview.performedBy, "codex", "驱动回填的那半边由驱动持有");
});

test("回写重跑不叠层：第二次拿到同一请求值时 commitRequest 与 rewrittenAt 原样保留", () => {
  // 真实场景就是重跑：深审会跑多轮（超时重试、逐轮补记录）。若每次都再包一层，
  // commitRequest 会变成"上一次回写的内容"而不是"提交时的内容"，审计链当场失真。
  const d = mkRecDir();
  const p = writeRec(d, { mode: "dual", reviewBackends: AT_COMMIT });
  const first = m.applyReviewRequestToRecord(p, REQ_CODEX);
  assert.equal(first.ok, true, first.reason);
  const afterFirst = JSON.parse(fs.readFileSync(p, "utf8"));
  const second = m.applyReviewRequestToRecord(p, REQ_CODEX);
  assert.equal(second.ok, true, second.reason);
  const afterSecond = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(afterSecond.reviewBackends.commitRequest.critic, "claude",
    "留档必须始终是提交时那份，不能被上一次回写覆盖");
  assert.equal(afterSecond.reviewBackends.rewrittenAt, afterFirst.reviewBackends.rewrittenAt,
    "重跑不得刷新改写时间 —— 那会把「什么时候改的」变成「最近一次什么时候跑的」");
});

test("第二次换**不同**后端时，留档必须仍是提交时那份（QM-6 i1 Critical 的回归锁）", () => {
  // 现场形态：同一棵树上先 --critic codex、再 --critic gpt。第二次进函数时 before 已经是
  // 上一次的回写结果，于是 `next.commitRequest = before` 会把「上一次评审请求的是谁」写成
  // 「提交时请求的是谁」—— spec 那条「MUST NOT 被就地覆盖销毁」恰好在最需要它的多轮换后端场景里失效。
  const d = mkRecDir();
  const p = writeRec(d, { mode: "dual", reviewBackends: AT_COMMIT });
  const REQ_GPT = { critic: "gpt", proposer: "opencode", from: { critic: "cli", proposer: "list" }, notes: [], overridden: true };
  const first = m.applyReviewRequestToRecord(p, REQ_CODEX);
  assert.equal(first.ok, true, first.reason);
  const afterFirst = JSON.parse(fs.readFileSync(p, "utf8"));
  const second = m.applyReviewRequestToRecord(p, REQ_GPT);
  assert.equal(second.ok, true, second.reason);
  const rec = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(rec.reviewBackends.critic, "gpt", "顶层必须是最近一次请求的后端");
  assert.equal(rec.reviewBackends.commitRequest.critic, "claude",
    "留档必须是提交时那份；把它换成上一次的回写值等于把审计锚往前挪了一格");
  assert.equal(rec.reviewBackends.commitRequest.overridden, false,
    "提交时那份的 overridden 不得被连带改成 true —— 那是给自己造一条没发生过的覆盖");
  assert.equal(rec.reviewBackends.rewrittenAt, afterFirst.reviewBackends.rewrittenAt,
    "改写时间锚在第一次改写；多轮换后端不得把它变成「最近一次什么时候跑的」");
});

test("proposer 缺失一律拒写，且一个字节都不许动（QM-6 i4 的回归锁）", () => {
  // 只校验 critic 会让 next.proposer=undefined 被 JSON.stringify 静默丢键 ⇒ 记录缺 proposer，
  // 而对账侧读的正是这一对。半个真源比不写更糟：它看起来像写过了。
  const d = mkRecDir();
  const p = writeRec(d, { mode: "dual", reviewBackends: AT_COMMIT });
  const before = fs.readFileSync(p, "utf8");
  const res = m.applyReviewRequestToRecord(p, { critic: "codex", overridden: true });
  assert.equal(res.ok, false, "proposer 缺失必须拒写");
  assert.match(res.reason, /proposer/, "原因要点名缺的是哪一半，否则调用方只能猜");
  assert.equal(fs.readFileSync(p, "utf8"), before, "拒写就必须逐字节不动 —— 落半份再报错，对账读到的是假源");
});

test("同值回写不留假档：请求值与记录一致时不得造 commitRequest", () => {
  const d = mkRecDir();
  const p = writeRec(d, { mode: "dual", reviewBackends: AT_COMMIT });
  const res = m.applyReviewRequestToRecord(p, { ...AT_COMMIT, overridden: true });
  assert.equal(res.ok, true, res.reason);
  const rec = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(rec.reviewBackends.commitRequest, undefined,
    "没换过后端却留下「提交时请求」的副本 —— 那是给自己造一条没发生过的历史");
  assert.equal(rec.reviewBackends.rewrittenAt, undefined);
});

test("记录读不到 / 不是对象：一律 ok:false 且**不新建**、原字节不动", () => {
  const cases = [
    ["missing", null],
    ["坏 JSON", "{ this is not json"],
    ["顶层是数组", "[]"],
    ["顶层是标量", "42"],
  ];
  for (const [name, content] of cases) {
    const d = mkRecDir();
    const p = path.join(d, "rec.json");
    if (content !== null) fs.writeFileSync(p, content, "utf8");
    const res = m.applyReviewRequestToRecord(p, REQ_CODEX);
    assert.equal(res.ok, false, `${name} 必须判失败`);
    assert.ok(res.reason, `${name} 必须给出原因`);
    assert.equal(fs.existsSync(p), content !== null,
      `${name}：失败路径不得改变文件存在性 —— 新建一份判定产物等于伪造判定`);
    if (content !== null) {
      assert.equal(fs.readFileSync(p, "utf8"), content, `${name}：失败路径不得改写字节`);
    }
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test("入参缺一格就得停：路径为空 / 请求值没有 critic 一律 ok:false", () => {
  const d = mkRecDir();
  const p = writeRec(d, { mode: "dual", reviewBackends: AT_COMMIT });
  const before = fs.readFileSync(p, "utf8");
  assert.equal(m.applyReviewRequestToRecord("", REQ_CODEX).ok, false);
  assert.equal(m.applyReviewRequestToRecord(p, { proposer: "opencode" }).ok, false,
    "critic 缺失的请求值写进去会让对账判据读到半个真源");
  assert.equal(m.applyReviewRequestToRecord(p, null).ok, false);
  assert.equal(fs.readFileSync(p, "utf8"), before, "拒绝的调用一个字节都不能落盘");
  fs.rmSync(d, { recursive: true, force: true });
});

test("记录里没有 reviewBackends（早于本刀的产物）：允许补上，但不留 commitRequest", () => {
  // decider 是这一刀才开始写该字段的；存量产物没有它。回写必须能补，
  // 否则「评审时换了后端」在旧记录上依然没地方落 —— 那正是本次要消灭的假红。
  const d = mkRecDir();
  const p = writeRec(d, { mode: "dual", deepReview: { status: "cleared", performedBy: "claude" } });
  const res = m.applyReviewRequestToRecord(p, REQ_CODEX);
  assert.equal(res.ok, true, res.reason);
  const rec = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(rec.reviewBackends.critic, "codex");
  assert.equal(rec.reviewBackends.commitRequest, undefined);
  fs.rmSync(d, { recursive: true, force: true });
});

// ---------- CLI：--record-request 的三档退出 ----------
const CLEAN_ENV = { MP_QM6_CRITIC: "", MP_QM6_PROPOSER: "" };

test("CLI --record-request：成功回写 rc=0 并出声；默认路径（没覆盖）rc=2 且一个字节都不改", () => {
  const d = mkRecDir();
  const p = writeRec(d, { mode: "dual", reviewBackends: AT_COMMIT });
  const before = fs.readFileSync(p, "utf8");

  const ok = runCli(["--critic", "codex", "--record-request", p], CLEAN_ENV);
  assert.equal(ok.status, 0, `应 rc=0，实得 rc=${ok.status} out=${ok.stdout} err=${ok.stderr}`);
  assert.match(ok.stdout, /已把评审时请求的后端写回/, "成功必须出声，否则入口无法区分「写了」和「没这行」");
  assert.notEqual(fs.readFileSync(p, "utf8"), before, "返回值说了成功，文件却没变 —— 那是假绿");

  // 反向那一格是本刀的承重墙：**没覆盖就不许碰记录**。
  // 默认路径若也回写，每个 PR 的判定产物都会被无关写者改一遍 mtime 与键顺序，
  // 而「谁改过判定产物」正是这条链要审计的东西。
  const after = fs.readFileSync(p, "utf8");
  const plain = runCli(["--record-request", p], CLEAN_ENV);
  assert.equal(plain.status, 2, "与清单一致时不得回写，实得 rc=" + plain.status + " out=" + plain.stdout);
  assert.match(plain.stderr, /不回写/, "拒绝必须点名理由，否则读起来像参数写错了");
  assert.match(plain.stderr, /与清单一致/, "必须说明是「没覆盖」这一档，而不是含糊的失败");
  assert.equal(fs.readFileSync(p, "utf8"), after, "被拒绝的调用不得留下任何改写痕迹");
  fs.rmSync(d, { recursive: true, force: true });
});

test("CLI --record-request：记录缺失 rc=2 且不新建，缺值/与打印模式同现一律 rc=2", () => {
  const d = mkRecDir();
  const missing = path.join(d, "nope.json");
  const r1 = runCli(["--critic", "codex", "--record-request", missing], CLEAN_ENV);
  assert.equal(r1.status, 2, `记录缺失应 rc=2，实得 ${r1.status} out=${r1.stdout}`);
  assert.match(r1.stderr, /读不到判定记录/, "必须点名是记录读不到：" + r1.stderr);
  assert.equal(fs.existsSync(missing), false, "不得新建判定产物");

  for (const [args, expect] of [
    [["--critic", "codex", "--record-request"], /缺值/],
    [["--critic", "codex", "--record-request", "--print-names"], /缺值/],
    [["--print-names", "--record-request", path.join(d, "x.json")], /只能指定一个模式/],
  ]) {
    const r = runCli(args, CLEAN_ENV);
    assert.equal(r.status, 2, `${JSON.stringify(args)} 应 rc=2，实得 ${r.status} err=${r.stderr}`);
    assert.match(r.stderr, expect, `${JSON.stringify(args)} 的 stderr 应含 ${expect}：${r.stderr}`);
    assert.equal(r.stdout, "", `${JSON.stringify(args)} 拒参数时不得同时吐输出`);
  }
  fs.rmSync(d, { recursive: true, force: true });
});

test("回写函数必须是导出面的一部分（入口按仓库相对路径调 CLI，二者缺一即断链）", () => {
  assert.equal(typeof m.applyReviewRequestToRecord, "function",
    "入口的回写跳依赖这个导出；改名或漏导出会让入口以 rc=2 失败，而症状看起来像「后端不可用」");
});
