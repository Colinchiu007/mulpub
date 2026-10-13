const fs = require("node:fs");
const path = require("node:path");

function normalizeLlmProvider(provider) {
  if (typeof provider !== "string") return provider || null;
  const normalized = provider.trim().toLowerCase();
  return normalized === "" || normalized === "none" ? null : normalized;
}

function normalizeStartedAfter(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function requiresValidReportStart(requireCurrentRun, startedAfterMs) {
  return Boolean(requireCurrentRun) && normalizeStartedAfter(startedAfterMs) === null;
}

function latestFile(reportDir, prefix, extension, startedAfterMs = null) {
  if (!reportDir || !fs.existsSync(reportDir)) return null;
  const startedAfter = normalizeStartedAfter(startedAfterMs);

  return fs.readdirSync(reportDir)
    .filter(file => file.startsWith(prefix) && file.endsWith(extension))
    .map(file => {
      const filePath = path.join(reportDir, file);
      return { file, filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .filter(({ mtimeMs }) => startedAfter === null || mtimeMs >= startedAfter)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file))[0]?.filePath || null;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * 判定"LLM 裁判没有产出结论"而非"产出了结论但需人工"。
 *
 * 依据是 agent-judge 的 `_heuristicVerdict` 形状（packages/ai-autonomous-tester/src/agent/
 * agent-judge.js）：解析失败时它写入 `_parseError` 并把原始输出放进 `_rawOutput`；
 * 空返回时 `_rawOutput` 为空白串、`items` 为 []。
 *
 * 报告里没有 `coverage._verdict` 时一律返回 false —— 历史报告/其他形状不得被凭空判成
 * 空结论，那会把一个本来正常的 advisory 变成新状态，掩盖真实差异。
 */
function judgeVerdictMissing(report) {
  const verdict = report && report.coverage && report.coverage._verdict;
  if (!verdict || typeof verdict !== "object") return false;
  if (typeof verdict._parseError === "string" && verdict._parseError.trim() !== "") return true;
  if (Array.isArray(verdict.items) && verdict.items.length > 0) return false;
  return typeof verdict._rawOutput === "string" && verdict._rawOutput.trim() === "";
}

function evaluation(exitCode, status, message) {
  return { exitCode, status, message };
}

function evaluateAgentJudgeGate({ reportDir, llmProvider, startedAfterMs, requireCurrentRun = false }) {
  if (requiresValidReportStart(requireCurrentRun, startedAfterMs)) {
    return evaluation(1, "INVALID_REPORT_START", "A valid current-run report start time is required.");
  }
  const verdictPath = latestFile(reportDir, "agent-judge-verdict-", ".json", startedAfterMs);

  if (!verdictPath) {
    const promptPath = latestFile(reportDir, "agent-judge-prompt-", ".md", startedAfterMs);
    if (!normalizeLlmProvider(llmProvider) && promptPath) {
      return evaluation(0, "PROMPT_REVIEW_REQUIRED", "No LLM configured; the prompt package was uploaded for manual review.");
    }
    return evaluation(1, "MISSING_VERDICT", "No Agent Judge verdict was produced.");
  }

  const verdict = readJson(verdictPath);
  if (verdict.error) {
    return evaluation(1, "INVALID_VERDICT", `Could not parse ${path.basename(verdictPath)}: ${verdict.error}`);
  }
  if (verdict.decision === "PASS") {
    return evaluation(0, "PASS", "Agent Judge verdict is PASS.");
  }
  if (verdict.decision === "FAIL" || verdict.decision === "NEED_HUMAN") {
    return evaluation(1, verdict.decision, `Agent Judge verdict is ${verdict.decision}.`);
  }
  return evaluation(1, "INVALID_VERDICT", "Agent Judge verdict has an unsupported decision.");
}

// 「审计没有真正发生」的三种状态 → Gate Result 用的可见性令牌。
// 单一实现放在这里：workflow 不得再自行 Get-ChildItem/ConvertFrom-Json 读报告——那份第二实现
// 不带 started-after，重跑或残留时会把上一轮的旧报告当成本轮结论（#46）。
const VERDICT_NOTE_BY_STATUS = {
  MISSING_REPORT: "NO_REPORT",
  INVALID_REPORT: "INVALID_REPORT",
  AUDIT_NO_VERDICT: "NO_VERDICT",
};

function verdictNoteFor(status) {
  return VERDICT_NOTE_BY_STATUS[status] || "";
}

function evaluateAutonomousGateDecision({ reportDir, auditExitCode, hasOpenAiKey, startedAfterMs, requireCurrentRun = false }) {
  if (requiresValidReportStart(requireCurrentRun, startedAfterMs)) {
    return evaluation(1, "INVALID_REPORT_START", "A valid current-run report start time is required.");
  }
  if (auditExitCode !== 0 && auditExitCode !== 1) {
    return evaluation(auditExitCode || 2, "INFRA_ERROR", `Autonomous coverage audit exited with ${auditExitCode}.`);
  }

  const reportPath = latestFile(reportDir, "autonomous-e2e-report-", ".json", startedAfterMs);
  if (!reportPath) {
    return evaluation(1, "MISSING_REPORT", "Autonomous coverage audit did not produce a report.");
  }

  const report = readJson(reportPath);
  if (report.error) {
    return evaluation(1, "INVALID_REPORT", `Could not parse ${path.basename(reportPath)}: ${report.error}`);
  }
  if (auditExitCode === 0) {
    if (report.overall === "PASS") {
      return evaluation(0, "PASS", "Autonomous coverage audit passed.");
    }
    return evaluation(1, "INCONSISTENT_REPORT", `Autonomous coverage audit exited with 0 but ${path.basename(reportPath)} is ${report.overall || "missing an overall result"}.`);
  }
  // 需求覆盖审计的 NEED_HUMAN 是「全量 PRD 项需人工复核」的报告型结论（对任意
  // 未覆盖全部 PRD 的 PR 都必然出现，与本次改动质量无关）。统一按报告型处理，
  // 上传报告供人工抽查，但不再让单次审计决定合并。
  if (report.overall === "NEED_HUMAN") {
    // 但「裁判根本没出结论」不是同一种 NEED_HUMAN：实测最近 5 次 main run 的审计产物
    // 全部是 parseError="Empty text" + items=[]，即 LLM 空返回，覆盖率从未被评估过。
    // 把它并进 advisory 会让 Gate 9 恒绿却零信息量，因此单独命名状态，让 CI annotation
    // 与人工抽查都能看出"这次审计没跑成"。
    // ⚠️ 刻意仍返回 exit 0：autonomous 在 Gate Result 的 needs 里、Gate Result 是 main 的
    // 必需检查，而在 LLM 端点恢复可用之前判红等于永久卡死全仓合并。阻塞化的前提是
    // 「端点可用」被实测证明，那一步单独做（见 issue #907）。
    if (judgeVerdictMissing(report)) {
      return evaluation(0, "AUDIT_NO_VERDICT", "Autonomous coverage audit produced no judge verdict (empty LLM output); green here does NOT mean coverage was audited. Blocking this requires the LLM endpoint to be proven available first.");
    }
    return evaluation(0, "PROMPT_REVIEW_REQUIRED", "Autonomous coverage audit needs human review; report uploaded as advisory.");
  }
  if (report.overall === "PASS") {
    return evaluation(1, "INCONSISTENT_REPORT", `Autonomous coverage audit exited with 1 but ${path.basename(reportPath)} is PASS.`);
  }
  return evaluation(1, report.overall || "FAIL", "Autonomous coverage audit did not pass.");
}

// 令牌随结果一起产出：判据与"是否阻塞"解耦（AUDIT_NO_VERDICT 仍 exit 0，见 issue #907）。
function evaluateAutonomousGate(params) {
  const result = evaluateAutonomousGateDecision(params);
  return { ...result, verdictNote: verdictNoteFor(result.status) };
}

function parseArgs(argv) {
  return Object.fromEntries(argv.map(arg => {
    const [key, value = ""] = arg.replace(/^--/, "").split(/=(.*)/, 2);
    return [key, value];
  }));
}

function parseBoolean(value) {
  return String(value).trim().toLowerCase() === "true";
}

function main() {
  const [mode, ...rawArgs] = process.argv.slice(2);
  const args = parseArgs(rawArgs);
  let result;

  if (mode === "agent-judge") {
    result = evaluateAgentJudgeGate({
      reportDir: args["report-dir"],
      llmProvider: args["llm-provider"],
      startedAfterMs: args["started-after"],
      requireCurrentRun: true,
    });
  } else if (mode === "autonomous") {
    result = evaluateAutonomousGate({
      reportDir: args["report-dir"],
      auditExitCode: Number(args["audit-exit-code"]),
      hasOpenAiKey: parseBoolean(args["has-openai-key"]),
      startedAfterMs: args["started-after"],
      requireCurrentRun: true,
    });
  } else {
    result = evaluation(2, "INVALID_MODE", "Expected mode: agent-judge or autonomous.");
  }

  // --note-file：把令牌落到调用方指定的路径。刻意在打印注解与退出之前发生，
  // 使 MISSING_REPORT / INVALID_REPORT 这些**阻塞**路径同样留痕——调用方读不到文件时
  // 无法区分「门禁判红」与「门禁崩了」，所以缺文件必须由调用方自己报出来。
  if (args["note-file"]) {
    fs.writeFileSync(args["note-file"], String(result.verdictNote || ""));
  }

  const annotation = result.exitCode === 0 ? "warning" : "error";
  console.log(`::${annotation}::${result.status}: ${result.message}`);
  process.exit(result.exitCode);
}

if (require.main === module) main();

module.exports = {
  evaluateAgentJudgeGate,
  evaluateAutonomousGate,
  verdictNoteFor,
};
