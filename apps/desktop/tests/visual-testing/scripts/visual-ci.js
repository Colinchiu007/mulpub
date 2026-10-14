/**
 * CI Visual Testing Integration Script
 *
 * Refactored to use @multi-publish/ai-autonomous-tester package.
 *
 * 完整 CI 流程:
 * 1. Pixel diff tests
 * 2. Agent judge report generation (供 Agent view_image 判断)
 *
 * GitHub Actions Usage:
 *
 * jobs:
 *   visual-test:
 *     runs-on: ubuntu-latest
 *     steps:
 *       - uses: actions/checkout@v4
 *       - uses: actions/setup-node@v4
 *         with:
 *           node-version: "22"
 *       - run: npm ci
 *       - run: npm run test:visual:ci
 */

const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { findProjectRoot } = require("@multi-publish/ai-autonomous-tester");
const { pixelTests: PIXEL_TESTS, runPixelSuite } = require("./run-pixel-tests");

const ROOT = findProjectRoot(__dirname);
const REPORT_DIR = path.join(ROOT, "apps/desktop/tests/visual-testing/reports");
const SCREENSHOT_DIR = path.join(ROOT, "apps/desktop/tests/visual-testing/screenshots");
const BASELINE_DIR = path.join(ROOT, "apps/desktop/tests/visual-testing/base-screenshots");
const META_DIR = path.join(ROOT, "apps/desktop/tests/visual-testing/meta");
const PIXEL_REPORT_PATH = path.join(REPORT_DIR, "ci-pixel-results.json");
const JUDGE_REPORT_PATH = path.join(REPORT_DIR, "agent-judge-results.json");
const JUDGE_MARKDOWN_PATH = path.join(REPORT_DIR, "judge-report.md");
const DEFAULT_TEST_URL = "http://127.0.0.1:5174";
const PIXEL_STATUSES = new Set(["PASSED", "FAILED"]);

const c = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", blue: "\x1b[34m",
};

function log(color, prefix, message) {
  console.log(`${color}[${prefix}]${c.reset} ${message}`);
}

function runNodeScript(scriptRelPath, args = []) {
  const scriptAbs = path.join(ROOT, scriptRelPath);
  return execFileSync("node", [scriptAbs, ...args], {
    cwd: path.join(ROOT, "apps/desktop"),
    encoding: "utf8",
    stdio: "pipe",
  });
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function resolveVisualTestUrl(options = {}) {
  const env = options.env || process.env;
  return options.url || env.TEST_URL || DEFAULT_TEST_URL;
}

function missingApprovedBaselines(tests = PIXEL_TESTS, baselineDir = BASELINE_DIR) {
  return tests
    .filter(test => !fs.existsSync(path.join(baselineDir, `${test.name}.png`)))
    .map(test => test.name);
}

function assertApprovedBaselines(tests = PIXEL_TESTS, baselineDir = BASELINE_DIR) {
  const missing = missingApprovedBaselines(tests, baselineDir);
  if (missing.length > 0) {
    throw new Error(`缺少人工审核的视觉基线: ${missing.join(', ')}`);
  }
  return missing;
}

function hasCompletePixelResult(pixelResult) {
  if (!pixelResult || !Number.isInteger(pixelResult.total) || pixelResult.total < 1) return false;
  if (!Number.isInteger(pixelResult.passed) || !Number.isInteger(pixelResult.failed)) return false;
  if (pixelResult.passed < 0 || pixelResult.failed < 0 || pixelResult.passed + pixelResult.failed !== pixelResult.total) {
    return false;
  }
  return Array.isArray(pixelResult.details)
    && pixelResult.details.length === pixelResult.total
    && pixelResult.details.every(detail => detail && typeof detail.name === "string" && PIXEL_STATUSES.has(detail.status))
    && pixelResult.details.filter(detail => detail.status === "PASSED").length === pixelResult.passed
    && pixelResult.details.filter(detail => detail.status === "FAILED").length === pixelResult.failed;
}

function isCiFailure(pixelResult, agentReport) {
  return !hasCompletePixelResult(pixelResult) || pixelResult.failed > 0 || agentReport !== "success";
}

function writePixelResultReport(pixelResult, outputPath = PIXEL_REPORT_PATH) {
  if (!hasCompletePixelResult(pixelResult)) {
    throw new Error("像素测试结果不完整，拒绝生成 Agent 审核输入");
  }
  const report = {
    generatedAt: new Date().toISOString(),
    results: pixelResult.details.map(detail => ({
      test: detail.name,
      route: detail.route,
      status: detail.status,
      error: detail.error || null,
      misMatchPercentage: detail.misMatchPercentage ?? null,
      diffImagePath: detail.diffImagePath || null,
      screenshotPath: detail.screenshotPath || null,
      baselinePath: detail.baselinePath || null,
      threshold: detail.threshold ?? null,
    })),
  };
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  return outputPath;
}

function expectedJudgeDetails(pixelResult) {
  return pixelResult ? pixelResult.details : null;
}

function validateAgentJudgeReport({ pixelResult, outputJsonPath, outputMarkdownPath, startedAt }) {
  try {
    const expected = expectedJudgeDetails(pixelResult);
    if (!fs.existsSync(outputJsonPath) || !fs.existsSync(outputMarkdownPath)) return false;
    const outputStat = fs.statSync(outputJsonPath);
    const markdownStat = fs.statSync(outputMarkdownPath);
    if (outputStat.size < 2 || markdownStat.size < 2) {
      return false;
    }
    const report = JSON.parse(fs.readFileSync(outputJsonPath, "utf8"));
    if (!report || !report.summary || !Array.isArray(report.tests)) return false;
    // 新鲜度只能取内容时间戳：mtime 属内核时钟域，与 Date.now() 不同源，
    // 系统时间往回跳一步就会把本轮报告误判成过期。
    // markdown 无时间戳但不单独判：真判据是同一份对象在 agent-visual-judge.js 里
    // 由一对相邻 writeFileSync 同时落盘（json 新则 md 必新）。
    const generatedAtMs = Date.parse(report.generatedAt);
    if (!Number.isFinite(generatedAtMs) || generatedAtMs < startedAt - 1000) return false;
    if (!Number.isInteger(report.summary.total) || report.summary.total < 1 || report.tests.length !== report.summary.total) {
      return false;
    }
    if (!Number.isInteger(report.summary.pixelFailed) || !Number.isInteger(report.summary.pixelPassed)) return false;
    if (report.summary.pixelFailed + report.summary.pixelPassed !== report.summary.total) return false;
    if (!report.tests.every(test => test && typeof test.testName === "string" && typeof test.needsAgentReview === "boolean")) {
      return false;
    }
    if (expected) {
      if (report.summary.total !== expected.length) return false;
      const expectedNames = expected.map(detail => detail.name).sort();
      const actualNames = report.tests.map(test => test.testName).sort();
      if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) return false;
      const expectedFailed = expected.filter(detail => detail.status === "FAILED").length;
      if (report.summary.pixelFailed !== expectedFailed || report.summary.pixelPassed !== expected.length - expectedFailed) {
        return false;
      }
    }
    const markdown = fs.readFileSync(outputMarkdownPath, "utf8");
    return markdown.includes("# Agent Visual Judge Report") && markdown.includes("## Summary");
  } catch (_) {
    return false;
  }
}

function readPixelResultReport(inputPath) {
  const report = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (!report || !Array.isArray(report.results) || report.results.length === 0) {
    throw new Error("像素结果报告为空或格式无效");
  }
  const details = report.results.map(result => ({
    name: result.test || result.name,
    route: result.route,
    status: result.status,
    error: result.error || null,
  }));
  if (!details.every(detail => typeof detail.name === "string" && typeof detail.status === "string")) {
    throw new Error("像素结果报告包含无效测试项");
  }
  const passed = details.filter(detail => detail.status === "PASSED").length;
  const pixelResult = {
    total: details.length,
    passed,
    failed: details.length - passed,
    details,
  };
  if (!hasCompletePixelResult(pixelResult)) throw new Error("像素结果报告不完整");
  return pixelResult;
}

/**
 * 运行像素对比测试（直接调用包内 VisualTestRunner）
 */
async function runPixelTests(options = {}) {
  log(c.blue, "INFO", "Running pixel diff tests via package API...");
  const tests = options.tests || PIXEL_TESTS;
  if (options.validateBaselines !== false) {
    assertApprovedBaselines(tests, options.baselineDir || BASELINE_DIR);
  }

  const summary = await (options.runPixelSuite || runPixelSuite)(tests, {
    runner: options.runner,
    url: resolveVisualTestUrl(options),
    allowBaselineCreation: false,
  });
  const details = summary.results.map(entry => {
    const result = entry.result || {};
    const isBaselined = entry.status === "BASELINE_CREATED";
    const status = entry.status === "PASSED" && result.passed === true ? "PASSED" : "FAILED";
    return {
      name: entry.test,
      route: entry.route,
      status,
      error: isBaselined ? "CI 拒绝自动创建视觉基线" : entry.error || result.error || null,
      misMatchPercentage: result.misMatchPercentage ?? null,
      diffImagePath: result.diffImagePath || result.diffPath || null,
      screenshotPath: entry.screenshotPath || result.screenshotPath || null,
      baselinePath: entry.baselinePath || result.baselinePath || null,
      threshold: result.threshold ?? entry.threshold ?? null,
    };
  });
  const passed = details.filter(detail => detail.status === "PASSED").length;
  return { passed, failed: details.length - passed, total: details.length, details };
}

/**
 * 生成 Agent 判断报告（agent-visual-judge.js 调用包内函数）
 */
function runAgentJudge(options = {}) {
  log(c.blue, "INFO", "Generating Agent visual-judge report...");
  const startedAt = Date.now();
  const outputJsonPath = options.outputJsonPath || JUDGE_REPORT_PATH;
  const outputMarkdownPath = options.outputMarkdownPath || JUDGE_MARKDOWN_PATH;
  const runner = options.runNodeScript || runNodeScript;
  const args = options.pixelReportPath ? ["--report", options.pixelReportPath] : [];
  try {
    const output = runner("apps/desktop/tests/visual-testing/scripts/agent-visual-judge.js", args);
    if (!validateAgentJudgeReport({
      pixelResult: options.pixelResult,
      outputJsonPath,
      outputMarkdownPath,
      startedAt,
    })) {
      throw new Error("Agent 视觉报告缺失、过期或与本轮像素结果不一致");
    }
    console.log(output);
    log(c.green, "PASS", "Agent judge report generated");
    return "success";
  } catch (err) {
    log(c.yellow, "WARN", "Agent judge report generation failed");
    return "failed";
  }
}

/**
 * 生成 CI 报告
 */
function generateCIReport(results, startTime, duration) {
  const report = {
    timestamp: new Date().toISOString(),
    duration: `${duration}s`,
    results,
    artifacts: {
      screenshots: SCREENSHOT_DIR,
      reports: REPORT_DIR,
    },
  };

  ensureDir(REPORT_DIR);
  fs.writeFileSync(
    path.join(REPORT_DIR, "ci-report.json"),
    JSON.stringify(report, null, 2)
  );

  console.log(`
================================================================
                    CI 视觉测试报告
================================================================
  总耗时: ${duration}s
  像素对比: ${results.pixel.passed}/${results.pixel.total} 通过
  Agent 报告: ${results.agentReport === "success" ? "已生成" : "失败"}
================================================================
  `);
}

function listArtifacts() {
  console.log("\nTest Artifacts:\n");
  const dirs = [
    { p: SCREENSHOT_DIR, name: "Screenshots" },
    { p: REPORT_DIR, name: "Reports" },
    { p: META_DIR, name: "Meta Data" },
  ];
  for (const d of dirs) {
    if (fs.existsSync(d.p)) {
      const files = fs.readdirSync(d.p).filter(f => !f.startsWith("."));
      log(c.blue, d.name, `${files.length} files`);
    }
  }
  console.log("");
}

async function main() {
  console.log("\nCI Visual Testing Pipeline (using @multi-publish/ai-autonomous-tester)\n");
  console.log("================================================================\n");

  const startTime = Date.now();
  log(c.blue, "ENV", `TEST_URL: ${resolveVisualTestUrl()}`);
  log(c.blue, "ENV", `Package: @multi-publish/ai-autonomous-tester`);
  log(c.blue, "INFO", "AI Judgment: Agent view_image (no API Key needed)\n");

  [REPORT_DIR, SCREENSHOT_DIR, BASELINE_DIR, META_DIR].forEach(ensureDir);

  const results = {
    pixel: { total: 0, passed: 0, failed: 0 },
    agentReport: "not_run",
  };

  console.log("\n--- Step 1: Pixel Diff Tests ---\n");
  const pixelResult = await runPixelTests();
  results.pixel = {
    total: pixelResult.total,
    passed: pixelResult.passed,
    failed: pixelResult.failed,
  };

  console.log("\n--- Step 2: Agent Judge Report ---\n");
  const pixelReportPath = writePixelResultReport(pixelResult);
  results.agentReport = runAgentJudge({ pixelResult, pixelReportPath });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  generateCIReport(results, startTime, duration);
  listArtifacts();

  console.log("\n================================================================\n");

  if (isCiFailure(pixelResult, results.agentReport)) {
    if (pixelResult.failed > 0) {
      log(c.yellow, "RESULT", "Pixel diff failed");
      log(c.blue, "INFO", "Download artifacts and run Agent visual judgment in Codex/Claude Desktop");
    } else {
      log(c.yellow, "RESULT", "Agent visual report generation failed");
    }
    console.log("\n================================================================\n");
    process.exit(1);
  }

  log(c.green, "SUCCESS", "CI visual testing pipeline completed!");
  console.log("\n================================================================\n");
  process.exit(0);
}

function runCli(args = process.argv.slice(2)) {
  if (args[0] === "--help") {
  console.log(`
CI Visual Testing Integration Script

Uses @multi-publish/ai-autonomous-tester package.

用法:
  node tests/visual-testing/scripts/visual-ci.js [选项]

选项:
  --pixel-only    只运行像素对比测试
  --agent-only    生成 Agent 判断报告
  --help          显示帮助

环境变量:
  TEST_URL    测试目标 URL (默认: http://localhost:5173)

说明:
  本脚本运行像素对比测试和生成 Agent 判断报告。
  Agent 视觉判断由 Agent（Codex/Claude Desktop）执行：
    npm run test:visual:agent

示例:
  node tests/visual-testing/scripts/visual-ci.js
`);
  } else if (args[0] === "--pixel-only") {
    runPixelTests()
      .then(r => { process.exitCode = isCiFailure(r, "success") ? 1 : 0; })
      .catch(error => {
        log(c.red, "ERROR", error.message);
        process.exitCode = 1;
      });
  } else if (args[0] === "--agent-only") {
    const reportFlagIndex = args.indexOf("--report");
    const pixelReportPath = reportFlagIndex >= 0 ? args[reportFlagIndex + 1] : PIXEL_REPORT_PATH;
    try {
      const pixelResult = readPixelResultReport(pixelReportPath);
      process.exitCode = runAgentJudge({ pixelResult, pixelReportPath }) === "success" ? 0 : 1;
    } catch (error) {
      log(c.red, "ERROR", error.message);
      process.exitCode = 1;
    }
  } else {
    main().catch(err => {
      log(c.red, "ERROR", err.message);
      process.exit(1);
    });
  }
}

if (require.main === module) runCli();

module.exports = {
  DEFAULT_TEST_URL,
  PIXEL_TESTS,
  assertApprovedBaselines,
  hasCompletePixelResult,
  isCiFailure,
  resolveVisualTestUrl,
  runPixelTests,
  writePixelResultReport,
  readPixelResultReport,
  validateAgentJudgeReport,
  runAgentJudge,
  runCli,
};
