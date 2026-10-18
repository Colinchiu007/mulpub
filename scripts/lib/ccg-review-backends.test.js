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
    [["--print-names", "--print-table"], /只能指定一个打印模式/],
    [[], /只能指定一个打印模式/],
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
