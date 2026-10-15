const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  evaluateAgentJudgeGate,
  evaluateAutonomousGate,
  verdictNoteFor,
} = require("./agent-review-gate");

function withReportDir(run) {
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-review-gate-"));
  try {
    run(reportDir);
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
}

function writeJson(reportDir, fileName, value) {
  fs.writeFileSync(path.join(reportDir, fileName), JSON.stringify(value));
}

test("Agent Judge 仅在无模型且存在 prompt 包时降级为审计告警", () => {
  withReportDir(reportDir => {
    fs.writeFileSync(path.join(reportDir, "agent-judge-prompt-1.md"), "人工审计包");

    const advisory = evaluateAgentJudgeGate({ reportDir, llmProvider: " NONE " });
    assert.equal(advisory.exitCode, 0);
    assert.equal(advisory.status, "PROMPT_REVIEW_REQUIRED");

    const missing = evaluateAgentJudgeGate({ reportDir, llmProvider: "openai" });
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.status, "MISSING_VERDICT");
  });
});

test("Agent Judge 的真实 verdict 继续阻塞 FAIL 和 NEED_HUMAN", () => {
  withReportDir(reportDir => {
    writeJson(reportDir, "agent-judge-verdict-pass.json", { decision: "PASS" });
    const pass = evaluateAgentJudgeGate({ reportDir, llmProvider: "openai" });
    assert.equal(pass.exitCode, 0);
    assert.equal(pass.status, "PASS");

    fs.rmSync(path.join(reportDir, "agent-judge-verdict-pass.json"));
    writeJson(reportDir, "agent-judge-verdict-fail.json", { decision: "FAIL" });
    const failure = evaluateAgentJudgeGate({ reportDir, llmProvider: "openai" });
    assert.equal(failure.exitCode, 1);
    assert.equal(failure.status, "FAIL");

    fs.rmSync(path.join(reportDir, "agent-judge-verdict-fail.json"));
    writeJson(reportDir, "agent-judge-verdict-human.json", { decision: "NEED_HUMAN" });
    const needHuman = evaluateAgentJudgeGate({ reportDir, llmProvider: "openai" });
    assert.equal(needHuman.exitCode, 1);
    assert.equal(needHuman.status, "NEED_HUMAN");

    fs.rmSync(path.join(reportDir, "agent-judge-verdict-human.json"));
    writeJson(reportDir, "agent-judge-verdict-a.json", { decision: "FAIL" });
    writeJson(reportDir, "agent-judge-verdict-b.json", { decision: "PASS" });
    const sameTime = new Date("2026-07-23T00:00:00.000Z");
    fs.utimesSync(path.join(reportDir, "agent-judge-verdict-a.json"), sameTime, sameTime);
    fs.utimesSync(path.join(reportDir, "agent-judge-verdict-b.json"), sameTime, sameTime);
    assert.equal(evaluateAgentJudgeGate({ reportDir, llmProvider: "openai" }).status, "PASS");
  });
});

test("Agent Judge 只接受本轮开始后生成的报告", () => {
  withReportDir(reportDir => {
    const startedAfterMs = Date.now();
    const stalePath = path.join(reportDir, "agent-judge-verdict-stale.json");
    writeJson(reportDir, "agent-judge-verdict-stale.json", { decision: "PASS" });
    const staleTime = new Date(startedAfterMs - 60_000);
    fs.utimesSync(stalePath, staleTime, staleTime);

    const staleOnly = evaluateAgentJudgeGate({ reportDir, llmProvider: "openai", startedAfterMs });
    assert.equal(staleOnly.exitCode, 1);
    assert.equal(staleOnly.status, "MISSING_VERDICT");

    const freshPath = path.join(reportDir, "agent-judge-prompt-fresh.md");
    fs.writeFileSync(freshPath, "本轮人工审计包");
    const freshTime = new Date(startedAfterMs + 1_000);
    fs.utimesSync(freshPath, freshTime, freshTime);
    const freshPrompt = evaluateAgentJudgeGate({ reportDir, llmProvider: "none", startedAfterMs });
    assert.equal(freshPrompt.exitCode, 0);
    assert.equal(freshPrompt.status, "PROMPT_REVIEW_REQUIRED");
  });
});

test("要求本轮时间时，缺失或非法时间必须阻断审计门禁", () => {
  withReportDir(reportDir => {
    fs.writeFileSync(path.join(reportDir, "agent-judge-prompt-current.md"), "人工审计包");

    for (const startedAfterMs of [undefined, "not-a-timestamp", -1]) {
      const result = evaluateAgentJudgeGate({
        reportDir,
        llmProvider: "none",
        startedAfterMs,
        requireCurrentRun: true,
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.status, "INVALID_REPORT_START");
    }
  });
});

test("Agent Judge CLI 将 prompt 审计状态输出为告警并以零退出", () => {
  withReportDir(reportDir => {
    fs.writeFileSync(path.join(reportDir, "agent-judge-prompt-1.md"), "人工审计包");
    const scriptPath = path.join(__dirname, "agent-review-gate.js");
    const result = spawnSync(process.execPath, [
      scriptPath,
      "agent-judge",
      `--report-dir=${reportDir}`,
      "--started-after=0",
      "--llm-provider=none",
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /::warning::PROMPT_REVIEW_REQUIRED/);
  });
});

test("Agent Judge CLI 在缺少本轮时间时 fail closed", () => {
  withReportDir(reportDir => {
    fs.writeFileSync(path.join(reportDir, "agent-judge-prompt-1.md"), "人工审计包");
    const scriptPath = path.join(__dirname, "agent-review-gate.js");
    const result = spawnSync(process.execPath, [
      scriptPath,
      "agent-judge",
      `--report-dir=${reportDir}`,
      "--llm-provider=none",
    ], { encoding: "utf8" });

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /::error::INVALID_REPORT_START/);
  });
});

// PASS 时令牌是**空串**，文件仍然会被创建（0 字节）。这不是边角：PowerShell 的
// Get-Content -Raw 对 0 字节文件返回 $null 而非空串，调用方若直接 .Trim() 会把 PASS 整步打红
//（PR #3477 首轮 CI 实测）。所以产生侧的形状必须被钉住：文件存在、内容为空。
test("PASS 时 --note-file 仍被创建且内容为空串（调用方必须按空文件设计）", () => {
  const scriptPath = path.join(__dirname, "agent-review-gate.js");
  withReportDir(reportDir => {
    const noteFile = path.join(reportDir, "..", "gate9-note-pass.txt");
    writeJson(reportDir, "autonomous-e2e-report-ok.json", { overall: "PASS" });
    const result = spawnSync(process.execPath, [
      scriptPath,
      "autonomous",
      `--report-dir=${reportDir}`,
      "--started-after=0",
      "--audit-exit-code=0",
      "--has-openai-key=false",
      `--note-file=${noteFile}`,
    ], { encoding: "utf8" });
    try {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.ok(fs.existsSync(noteFile), "PASS 也必须落文件：调用方无法区分\"没写\"与\"写了空\"就是缺陷温床");
      const raw = fs.readFileSync(noteFile, "utf8");
      assert.equal(raw, "", "PASS 的令牌必须是空串，不是 PASS 这个词");
    } finally {
      fs.rmSync(noteFile, { force: true });
    }
  });
});

test("自主审计的零退出码仍要求一份 PASS 报告", () => {
  withReportDir(reportDir => {
    const missingOnSuccess = evaluateAutonomousGate({ reportDir, auditExitCode: 0, hasOpenAiKey: false });
    assert.equal(missingOnSuccess.exitCode, 1);
    assert.equal(missingOnSuccess.status, "MISSING_REPORT");

    writeJson(reportDir, "autonomous-e2e-report-inconsistent.json", { overall: "NEED_HUMAN" });
    const inconsistentSuccess = evaluateAutonomousGate({ reportDir, auditExitCode: 0, hasOpenAiKey: false });
    assert.equal(inconsistentSuccess.exitCode, 1);
    assert.equal(inconsistentSuccess.status, "INCONSISTENT_REPORT");

    fs.rmSync(path.join(reportDir, "autonomous-e2e-report-inconsistent.json"));
    writeJson(reportDir, "autonomous-e2e-report-pass.json", { overall: "PASS" });
    assert.equal(evaluateAutonomousGate({ reportDir, auditExitCode: 0, hasOpenAiKey: false }).status, "PASS");

    fs.rmSync(path.join(reportDir, "autonomous-e2e-report-pass.json"));
    assert.equal(evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: false }).status, "MISSING_REPORT");
    writeJson(reportDir, "autonomous-e2e-report-1.json", { overall: "NEED_HUMAN" });

    const advisory = evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: false });
    assert.equal(advisory.exitCode, 0);
    assert.equal(advisory.status, "PROMPT_REVIEW_REQUIRED");

    const llmFailure = evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: true });
    // 有 LLM key 时 NEED_HUMAN 同样只做报告型提示，不再阻塞合并
    assert.equal(llmFailure.exitCode, 0);
    assert.equal(llmFailure.status, "PROMPT_REVIEW_REQUIRED");

    fs.rmSync(path.join(reportDir, "autonomous-e2e-report-1.json"));
    writeJson(reportDir, "autonomous-e2e-report-2.json", { overall: "FAIL" });
    assert.equal(evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: false }).exitCode, 1);
    assert.equal(evaluateAutonomousGate({ reportDir, auditExitCode: 2, hasOpenAiKey: false }).exitCode, 2);
  });
});

test("自主审计忽略本轮开始前残留的 NEED_HUMAN 报告", () => {
  withReportDir(reportDir => {
    const startedAfterMs = Date.now();
    const reportPath = path.join(reportDir, "autonomous-e2e-report-stale.json");
    writeJson(reportDir, "autonomous-e2e-report-stale.json", { overall: "NEED_HUMAN" });
    const staleTime = new Date(startedAfterMs - 60_000);
    fs.utimesSync(reportPath, staleTime, staleTime);

    const result = evaluateAutonomousGate({
      reportDir,
      auditExitCode: 1,
      hasOpenAiKey: false,
      startedAfterMs,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.status, "MISSING_REPORT");

    const successWithStaleReport = evaluateAutonomousGate({
      reportDir,
      auditExitCode: 0,
      hasOpenAiKey: false,
      startedAfterMs,
    });
    assert.equal(successWithStaleReport.exitCode, 1);
    assert.equal(successWithStaleReport.status, "MISSING_REPORT");
  });
});

// ---- #907：裁判没出结论 ≠ 真·需人工复核 ----
// 实测（2026-09-28，最近 5 次 main run 的 quality-gate-autonomous-reports 产物）：
//   5/5 全部 parseError="Empty text"、_rawOutput=""、items=[]、coverage.summary.total=0
// 即 LLM 裁判在 CI 上**一次都没产出结论**，而 agent-review-gate 把它和"真需人工"一起
// 判成 PROMPT_REVIEW_REQUIRED + exit 0 ⇒ 绿的 Gate 9 完全不表达"审计没跑成"。
// 这里只把两者**区分开**（状态名 + CI annotation），刻意**不改成阻塞**：
// autonomous 在 Gate Result 的 needs 里、Gate Result 是必需检查，此刻判红等于永久卡死全仓合并。
test("自主审计：裁判空返回必须报 AUDIT_NO_VERDICT，且仍不阻塞", () => {
  withReportDir(reportDir => {
    writeJson(reportDir, "autonomous-e2e-report-1.json", {
      overall: "NEED_HUMAN",
      coverage: { _verdict: { decision: "NEED_HUMAN", items: [], _parseError: "Empty text", _rawOutput: "" } },
    });
    const noVerdict = evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: true });
    assert.equal(noVerdict.status, "AUDIT_NO_VERDICT");
    assert.equal(noVerdict.exitCode, 0);
    assert.match(noVerdict.message, /does NOT mean coverage was audited/);

    fs.rmSync(path.join(reportDir, "autonomous-e2e-report-1.json"));
    writeJson(reportDir, "autonomous-e2e-report-2.json", {
      overall: "NEED_HUMAN",
      coverage: { _verdict: { decision: "NEED_HUMAN", items: [{ feature: "feat_x", status: "missing" }], _rawOutput: '{"decision":"NEED_HUMAN"}' } },
    });
    const realAdvisory = evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: true });
    assert.equal(realAdvisory.status, "PROMPT_REVIEW_REQUIRED");
    assert.equal(realAdvisory.exitCode, 0);
  });
});

test("自主审计：只有空白输出也算空结论，缺字段的旧报告保持原行为", () => {
  withReportDir(reportDir => {
    writeJson(reportDir, "autonomous-e2e-report-1.json", {
      overall: "NEED_HUMAN",
      coverage: { _verdict: { decision: "NEED_HUMAN", items: [], _rawOutput: "   \n " } },
    });
    assert.equal(evaluateAutonomousGate({ reportDir, auditExitCode: 1 }).status, "AUDIT_NO_VERDICT");

    fs.rmSync(path.join(reportDir, "autonomous-e2e-report-1.json"));
    writeJson(reportDir, "autonomous-e2e-report-2.json", { overall: "NEED_HUMAN" });
    assert.equal(evaluateAutonomousGate({ reportDir, auditExitCode: 1 }).status, "PROMPT_REVIEW_REQUIRED",
      "报告里没有 _verdict 字段时不得凭空判成空结论（历史形状保持原行为）");
  });
});


// ── #46：verdict 令牌的单一实现 ────────────────────────────────────────────
// Gate 9 原先在 workflow 里内联一份 Get-ChildItem + ConvertFrom-Json 的 verdict 探针，
// 与 agent-review-gate.js 的 judgeVerdictMissing 构成第二份同用途实现；而且它按
// 「目录里最新的报告」取文件、不带 started-after ⇒ 重跑或残留时会读上一轮的旧报告。
// workflow-contract 的 doesNotMatch(gate9, /Get-ChildItem|ConvertFrom-Json/) 因此长期红。
// 正解：令牌由门禁自己算并落盘，workflow 只读那个令牌文件。
test("自主审计为每种「审计没有真正发生」的状态产出对应 verdict 令牌", () => {
  withReportDir(reportDir => {
    const missing = evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: false });
    assert.equal(missing.status, "MISSING_REPORT");
    assert.equal(missing.verdictNote, "NO_REPORT");

    fs.writeFileSync(path.join(reportDir, "autonomous-e2e-report-broken.json"), "这不是 JSON");
    const broken = evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: false });
    assert.equal(broken.status, "INVALID_REPORT");
    assert.equal(broken.verdictNote, "INVALID_REPORT", "报告不可解析必须与「根本没报告」区分开");

    fs.rmSync(path.join(reportDir, "autonomous-e2e-report-broken.json"));
    writeJson(reportDir, "autonomous-e2e-report-empty.json", {
      overall: "NEED_HUMAN",
      coverage: { _verdict: { _rawOutput: "", items: [] } },
    });
    const noVerdict = evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: false });
    assert.equal(noVerdict.status, "AUDIT_NO_VERDICT");
    assert.equal(noVerdict.exitCode, 0, "阻塞化前提是端点可用性被实测证明（issue #907），本次不改判据");
    assert.equal(noVerdict.verdictNote, "NO_VERDICT");

    fs.rmSync(path.join(reportDir, "autonomous-e2e-report-empty.json"));
    writeJson(reportDir, "autonomous-e2e-report-review.json", { overall: "NEED_HUMAN" });
    assert.equal(evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: false }).verdictNote, "", "真出了结论就不该再打「未审计」令牌");

    fs.rmSync(path.join(reportDir, "autonomous-e2e-report-review.json"));
    writeJson(reportDir, "autonomous-e2e-report-pass.json", { overall: "PASS" });
    assert.equal(evaluateAutonomousGate({ reportDir, auditExitCode: 0, hasOpenAiKey: false }).verdictNote, "");
  });
});

test("自主审计 CLI 的 --note-file 把令牌落盘，供 workflow 直接读（含阻塞路径也要写）", () => {
  const scriptPath = path.join(__dirname, "agent-review-gate.js");
  withReportDir(reportDir => {
    const noteFile = path.join(reportDir, "..", "gate9-verdict-note.txt");
    writeJson(reportDir, "autonomous-e2e-report-empty.json", {
      overall: "NEED_HUMAN",
      coverage: { _verdict: { _rawOutput: "", items: [] } },
    });
    const result = spawnSync(process.execPath, [
      scriptPath,
      "autonomous",
      `--report-dir=${reportDir}`,
      "--started-after=0",
      "--audit-exit-code=1",
      "--has-openai-key=false",
      `--note-file=${noteFile}`,
    ], { encoding: "utf8" });
    try {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(fs.readFileSync(noteFile, "utf8").trim(), "NO_VERDICT");
    } finally {
      fs.rmSync(noteFile, { force: true });
    }
  });

  // 阻塞路径同样要写：workflow 在读令牌文件时无法区分「门禁判红」与「门禁崩了」，
  // 只有文件总在，注解才不会在最需要它的时候缺席。
  withReportDir(reportDir => {
    const noteFile = path.join(reportDir, "..", "gate9-verdict-note.txt");
    const result = spawnSync(process.execPath, [
      scriptPath,
      "autonomous",
      `--report-dir=${reportDir}`,
      "--started-after=0",
      "--audit-exit-code=1",
      "--has-openai-key=false",
      `--note-file=${noteFile}`,
    ], { encoding: "utf8" });
    try {
      assert.equal(result.status, 1, "无报告仍须阻塞");
      assert.match(result.stdout, /::error::MISSING_REPORT/);
      assert.equal(fs.readFileSync(noteFile, "utf8").trim(), "NO_REPORT");
    } finally {
      fs.rmSync(noteFile, { force: true });
    }
  });
});

// ── Gate 9 归属判据（2026-10-15）──────────────────────────────────────────
// QG Autonomous 是 required check（经 Gate Result 承重拦合并），而它对**没有声明
// feat_ 特性的 PR** 量的是整份 PRD 对全仓实现的存量比对。实测同一判据：
//   run 38625943131 / job 116065246885（main push 367e1af4a）score 0.34、items 41
//   run 38646664947 / job 116135306680（PR #3617）            score 0.36、items 218
//   2026-10-12 #3372 实测 0.374 / 227，#3413 实测 0.31
// items 数由裁判自己决定（requirements-runner.js:113 的 details 取自 verdict.items，
// 不是 PRD 全量），coverageRate 也是裁判自报（agent-judge.js normalizeSummary）；
// workflow 传的 --threshold=0.5 只喂 VisualTestRunner（run-autonomous-e2e.js:289），
// 对覆盖判据是死参数。⇒「同一份代码两次跑落在不同结论两侧」的量没有资格决定
// 全仓每个 PR 能不能合并。存量欠账进报告不进闸门；本 PR 自己声明要实现的东西
// 没实现，仍然当场红。
// 夹具形状取自 #3617 那次 CI 的**真实 artifact**（run 38646664947 / job 116135306680 里的
// autonomous-e2e-report-2026-10-14T22-23-17-517Z.json），逐字段同形：
//   overall=FAIL  coverageStatus=FAIL  exitCodes=["COVERAGE_FAIL"]
//   coverageRate=0.36  auditedCount=227  details.length=218（88 covered + 130 partial）
//   summary={total:218,passed:218,failed:0} ← PARTIAL 被映射成 PASSED，failed 恒 0
//   _verdict.summary={covered:82,partial:145,missing:0} ← 连它自己的 items 直方图都对不上
function backlogFailReport(extra = {}) {
  const details = [];
  for (let i = 0; i < 88; i++) details.push({ testName: "f" + i, status: "PASSED", type: "covered" });
  for (let i = 0; i < 130; i++) details.push({ testName: "p" + i, status: "PASSED", type: "partial" });
  return {
    overall: "FAIL",
    coverageStatus: "FAIL",
    exitCodes: ["COVERAGE_FAIL"],
    coverage: {
      coverageRate: 0.36,
      auditedCount: 227,
      totalPrdFeaturesRaw: 227,
      details,
      summary: { total: 218, passed: 218, failed: 0 },
      _verdict: { decision: "FAIL", score: 0.36, summary: { covered: 82, partial: 145, missing: 0, coverageRate: 0.36 } },
    },
    ...extra,
  };
}

test("存量覆盖 FAIL（评估面不由本 PR 限定）降级为报告型", () => {
  withReportDir(reportDir => {
    writeJson(reportDir, "autonomous-e2e-report-1.json", backlogFailReport());
    const r = evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: true });
    assert.equal(r.exitCode, 0);
    assert.equal(r.status, "COVERAGE_BACKLOG_REPORT");
    // 文案必须自报它量的是全仓存量，并带上**按 details 自己数出来**的现场数字；
    // 否则下一个读者会把这条绿读成「覆盖已达标」。
    assert.match(r.message, /backlog/);
    assert.match(r.message, /36\.0%/);
    assert.match(r.message, /in scope 227/);
    assert.match(r.message, /covered 88 \/ partial 130 \/ missing 0/);
    // 反向锁：summary.failed 因 PARTIAL→PASSED 映射而恒 0，注解里不得出现它
    assert.doesNotMatch(r.message, /not covered/);
  });
});

// 令牌与退出码分格断言：两者压在一条用例里时，「摘掉退出码」和「摘掉令牌」会给出
// 逐字相同的红集，读起来像其中一条没有牙（2026-10-15 变异反证 M6/M7 实测撞车后拆开）。
test("存量降级必须另打 COVERAGE_BACKLOG 可见性令牌（绿要能看出为什么绿）", () => {
  withReportDir(reportDir => {
    writeJson(reportDir, "autonomous-e2e-report-1.json", backlogFailReport());
    const r = evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: true });
    assert.equal(r.status, "COVERAGE_BACKLOG_REPORT");
    assert.equal(r.verdictNote, "COVERAGE_BACKLOG");
    assert.equal(verdictNoteFor("COVERAGE_FAIL"), "", "可归因的阻塞状态不得带「降级留痕」令牌");
  });
});


test("本 PR 声明了 feat_ 特性（审计面按其收窄）→ 覆盖 FAIL 仍然阻塞", () => {
  withReportDir(reportDir => {
    writeJson(reportDir, "autonomous-e2e-report-1.json", backlogFailReport());
    const blocked = evaluateAutonomousGate({
      reportDir, auditExitCode: 1, hasOpenAiKey: true, requiredFeatureIds: "feat_podcast_stock",
    });
    assert.equal(blocked.exitCode, 1, "可归因于本 PR 的覆盖失败必须当场红");
    assert.equal(blocked.status, "COVERAGE_FAIL");
    assert.match(blocked.message, /feat_podcast_stock/);
    assert.equal(blocked.verdictNote, "", "阻塞路径不打「降级留痕」令牌");
  });
});

test("降级判据只认「仅覆盖失败」：混进任何其它失败码一律阻塞", () => {
  withReportDir(reportDir => {
    for (const codes of [["COVERAGE_FAIL", "FUNCTIONAL_FAIL"], ["COVERAGE_FAIL", "VISUAL_FAIL"], ["FUNCTIONAL_FAIL"]]) {
      fs.rmSync(path.join(reportDir, "autonomous-e2e-report-1.json"), { force: true });
      writeJson(reportDir, "autonomous-e2e-report-1.json", backlogFailReport({ exitCodes: codes }));
      const r = evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: true });
      assert.equal(r.exitCode, 1, `${codes.join("+")} 不得被覆盖降级吃掉`);
      assert.notEqual(r.status, "COVERAGE_BACKLOG_REPORT");
    }
  });
});

test("降级判据对 exitCodes 形状缺失一律 fail-closed（旧报告形状保持原行为）", () => {
  withReportDir(reportDir => {
    const shapes = [
      { overall: "FAIL" },
      { overall: "FAIL", exitCodes: [] },
      { overall: "FAIL", exitCodes: "COVERAGE_FAIL" },
      { overall: "FAIL", exitCodes: ["SOMETHING_NEW"] },
    ];
    for (const [i, shape] of shapes.entries()) {
      const name = `autonomous-e2e-report-${i}.json`;
      writeJson(reportDir, name, shape);
      const r = evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: true });
      assert.equal(r.exitCode, 1, `形状 ${JSON.stringify(shape)} 不得降级放行`);
      fs.rmSync(path.join(reportDir, name));
    }
  });
});

// 审计器自身崩溃时（run-autonomous-e2e.js 的 catch 分支返回 summary.total=0 且
// coverageStatus 由 classifyCoverageResult 判成 FAIL），exitCodes 同样只有 COVERAGE_FAIL。
// 只看失败码会把「审计没跑成」读成「审过了、欠账是别人的」——降级的前提必须是真量出了项。
test("审计器崩溃形状（只有覆盖失败码但零项）不得降级为存量报告", () => {
  withReportDir(reportDir => {
    writeJson(reportDir, "autonomous-e2e-report-1.json", {
      overall: "FAIL",
      coverageStatus: "FAIL",
      exitCodes: ["COVERAGE_FAIL"],
      coverage: { error: "boom", summary: { total: 0, passed: 0, failed: 0 }, details: [] },
    });
    const r = evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: true });
    assert.equal(r.exitCode, 1, "零项 FAIL 不是存量欠账");
    assert.equal(r.status, "FAIL");
  });
});


test("NEED_HUMAN 与裁判空返回两条既有路径不受本次改造影响", () => {
  withReportDir(reportDir => {
    writeJson(reportDir, "autonomous-e2e-report-1.json", {
      overall: "NEED_HUMAN",
      coverage: { _verdict: { decision: "NEED_HUMAN", items: [{ feature: "f", status: "missing" }], _rawOutput: "{}" } },
    });
    assert.equal(evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: true }).status, "PROMPT_REVIEW_REQUIRED");
    fs.rmSync(path.join(reportDir, "autonomous-e2e-report-1.json"));

    writeJson(reportDir, "autonomous-e2e-report-2.json", {
      overall: "NEED_HUMAN",
      coverage: { _verdict: { decision: "NEED_HUMAN", items: [], _parseError: "Empty text", _rawOutput: "" } },
    });
    assert.equal(evaluateAutonomousGate({ reportDir, auditExitCode: 1, hasOpenAiKey: true }).status, "AUDIT_NO_VERDICT");
  });
});

test("CLI 必须真的把 --required-feature-ids 交给判据（参数不是装饰）", () => {
  const scriptPath = path.join(__dirname, "agent-review-gate.js");
  withReportDir(reportDir => {
    writeJson(reportDir, "autonomous-e2e-report-1.json", backlogFailReport());
    const noteFile = path.join(reportDir, "..", "gate9-note.txt");
    const run = (extraArgs) => spawnSync(process.execPath, [
      scriptPath, "autonomous",
      `--report-dir=${reportDir}`, "--started-after=0", "--audit-exit-code=1",
      "--has-openai-key=true", `--note-file=${noteFile}`, ...extraArgs,
    ], { encoding: "utf8" });

    try {
      const advisory = run([]);
      assert.equal(advisory.status, 0, advisory.stdout + advisory.stderr);
      assert.match(advisory.stdout, /::warning::COVERAGE_BACKLOG_REPORT/);
      assert.equal(fs.readFileSync(noteFile, "utf8").trim(), "COVERAGE_BACKLOG");

      fs.rmSync(noteFile, { force: true });
      const blocked = run(["--required-feature-ids=feat_x"]);
      assert.equal(blocked.status, 1, blocked.stdout + blocked.stderr);
      assert.match(blocked.stdout, /::error::COVERAGE_FAIL/);
      assert.equal(fs.readFileSync(noteFile, "utf8").trim(), "");
    } finally {
      fs.rmSync(noteFile, { force: true });
    }
  });
});
