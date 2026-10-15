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

// Gate Result 用的可见性令牌：两类语义共用一条通道，令牌文本自身必须能区分——
// ①「审计没有真正发生」（NO_REPORT / INVALID_REPORT / NO_VERDICT）；
// ②「审计发生了，但量的不是本 PR」（COVERAGE_BACKLOG）。
// 阻塞路径（MISSING_REPORT/INVALID_REPORT 等）同样落盘，见 main() 的 --note-file 注释。
// 单一实现放在这里：workflow 不得再自行 Get-ChildItem/ConvertFrom-Json 读报告——那份第二实现
// 不带 started-after，重跑或残留时会把上一轮的旧报告当成本轮结论（#46）。
const VERDICT_NOTE_BY_STATUS = {
  MISSING_REPORT: "NO_REPORT",
  INVALID_REPORT: "INVALID_REPORT",
  AUDIT_NO_VERDICT: "NO_VERDICT",
  COVERAGE_BACKLOG_REPORT: "COVERAGE_BACKLOG",
};

function verdictNoteFor(status) {
  return VERDICT_NOTE_BY_STATUS[status] || "";
}

// 覆盖失败能否归因于本 PR（2026-10-15 判据改造，动因见 record gate9-ratchet）。
// 审计器收到 --required-feature-ids 时会把评估面按这些 id 收窄
// （requirements-runner.js 的 filterPrdItemsByFeatureIds），此时的 FAIL 说的是
// 「本 PR 声称实现的特性没实现」；没有 id 时评估面是整份 PRD 对全仓实现的存量比对，
// 同一个 FAIL 说的是存量欠账——与本 PR 改了什么无关，而且那个数是裁判自报的
// （coverageRate 写在 verdict.summary，items 数由裁判自己决定），同一份代码两次跑
// 可以落在不同结论两侧（实测 main 0.34/41 项、#3617 0.36/218 项、#3372 0.374/227 项）。
// 不稳定的量没有资格决定全仓每个 PR 能不能合并：存量欠账进报告不进闸门，
// 可归因的失败照旧当场红。
function parseFeatureIds(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

// 只认「本轮唯一的失败项就是覆盖」。按 overall 字符串降级会把视觉/功能失败一起豁免，
// 所以必须逐码判；exitCodes 缺失、为空、非数组、含未知码一律不降级（fail-closed）。
function isCoverageOnlyFailure(report) {
  const codes = report && report.exitCodes;
  if (!Array.isArray(codes) || codes.length === 0 || !codes.every((code) => code === "COVERAGE_FAIL")) return false;
  // 降级还有第二条前提：本轮**确实量出了项**。审计器自己崩溃时（run-autonomous-e2e.js 的
  // catch 分支）exitCodes 同样只有 COVERAGE_FAIL，但没有逐条结果——那种 FAIL 不是存量欠账
  // 而是"审计没跑成"，照旧阻塞；否则崩溃会被读成"审过了，欠账是别人的"。
  // ⚠️ 物证一律取 coverage.details（审计器逐条写出的那一份），**不取 coverage.summary.total**：
  // 后者是由 details 经 summarize() 派生的计数（requirements-runner.js:117），读它等于把判据
  // 架在一条跨文件约定上——哪天生产方改成"total 写裁判自报数"，闸门就静默漏放。
  // （QM-6 后端轴 finding #1 的内核；它给的「还要求 missing>0」被拒：#3617 的真实产物就是
  // missing=0 / partial=130 / decision=FAIL，按那条本片一条也放不了。）
  const details = report.coverage && report.coverage.details;
  return Array.isArray(details) && details.length > 0;
}

// 降级放行时把现场数字一并写进注解：只说"这是存量"等于让下一个读者重新去翻 artifact。
// ⚠️ 这些数一律从 coverage.details[].type 自己数，**不得**拿 coverage.summary.failed
// 当「未覆盖数」：requirements-runner.js:114 把 PARTIAL 映射成 PASSED，#3617 的真实产物里
// summary={total:218,passed:218,failed:0} 与 coverageRate:0.36 同时成立——照抄后者会打出
// 「覆盖 36%，未覆盖 0」这种自相矛盾的句子（2026-10-15 拿 artifact 复跑才抓到）。
function coverageShape(report) {
  const coverage = (report && report.coverage) || {};
  const details = Array.isArray(coverage.details) ? coverage.details : [];
  const countBy = (type) => details.filter((item) => item && item.type === type).length;
  return {
    rate: typeof coverage.coverageRate === "number" ? `${(coverage.coverageRate * 100).toFixed(1)}%` : "N/A",
    inScope: Number.isFinite(coverage.auditedCount) ? String(coverage.auditedCount) : "N/A",
    judged: String(details.length),
    covered: countBy("covered"),
    partial: countBy("partial"),
    missing: countBy("missing"),
    // 未知 type 归 other 并照打：生产方将来加第五种状态时，四个分项之和仍等于 judged，
    // 不会悄悄少算（QM-6 后端轴 finding #3）。
    other: details.length - countBy("covered") - countBy("partial") - countBy("missing"),
  };
}

function evaluateAutonomousGateDecision({ reportDir, auditExitCode, hasOpenAiKey, startedAfterMs, requireCurrentRun = false, requiredFeatureIds = "" }) {
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
  if (isCoverageOnlyFailure(report)) {
    const ids = parseFeatureIds(requiredFeatureIds);
    if (ids.length > 0) {
      return evaluation(1, "COVERAGE_FAIL", `Autonomous coverage audit failed on the features this PR declares (${ids.join(", ")}); the audited scope is exactly those features.`);
    }
    const shape = coverageShape(report);
    return evaluation(0, "COVERAGE_BACKLOG_REPORT", `Autonomous coverage audit measured the whole-repo PRD backlog (self-reported coverageRate ${shape.rate}; PRD items in scope ${shape.inScope}, judge picked ${shape.judged}: covered ${shape.covered} / partial ${shape.partial} / missing ${shape.missing} / other ${shape.other}). Both the rate and the item set are the judge's own choice, so this green does NOT mean coverage is acceptable.`);
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
      requiredFeatureIds: args["required-feature-ids"],
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
