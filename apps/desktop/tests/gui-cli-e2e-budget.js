// 单点持有「CLI 端到端」这一条用例的预算与出处 —— 不放测试文件里，因为复测入口
// scripts/case-timeout-audit.js 要 require 这份常量，而测试文件是 vitest 用例、被普通 node
// require 时会因 describe/it 未定义而崩。两边共读一份，避免"脚本判的是旧预算"这种第二份真相。
'use strict';

/** 被测用例所在文件（相对 apps/desktop，与 vitest verbose 行首段逐字一致） */
const GUI_CLI_E2E_TEST_FILE = 'tests/gui-ci-exit-contract.test.js';
/** 被测用例全名（去掉 describe 前缀的那一段），必须与 it() 的字面串逐字相同 */
const GUI_CLI_E2E_TEST_NAME =
  'CLI 端到端：真 git 仓库里文档改动判否、桌面改动判是，取证失败必须 rc=1 且不写产出';
const GUI_CLI_E2E_SUITE_NAME = 'GUI/CI 工作流门禁契约';

/**
 * 用例级预算。为什么不能沿用全局 `--testTimeout=10000`：该用例要在临时目录里真起
 * **17 个子进程**（12 次 git.exe + 5 次 node.exe），Windows runner 上这一步是纯环境开销，
 * 与被测语义（判据脚本的 rc / stdout / GITHUB_OUTPUT）共用同一个预算 ——
 * AGENTS.md QM-3「等待预算必须按相位拆分，环境开销不得与被测语义共用一个预算」的同族落点。
 *
 * 实测分布（2026-10-17，`node scripts/case-timeout-audit.js --runs=8 --json` 从 8 个 main push run
 * 的 CI 作业日志取，共 8 条样本）：空闲 1059 / 1326 / 1453 / 1466 / 1495 / 1657 ms；
 * 负载 11097 / 12744 ms（这两次是被 10s 全局预算切断时的墙钟，即**真实耗时的下限**，不是终点）。
 * 长尾由 runner 负载主导，摆动 8 倍 ⇒ 预算必须挂在长尾上。
 * 取值判据：`≥ maxObservedMs × safetyMultiplier`（下方 provenance 与结构锁各自钉住）。
 * ⛔ 重测量出更低值不构成收紧理由；要收紧先给多窗口对照。
 */
const GUI_CLI_E2E_CASE_TIMEOUT_MS = 60000;

/** @type {{maxObservedMs: number, samples: number, runs: number, jobs: number, safetyMultiplier: number, collectedAt: string, source: string}} */
const GUI_CLI_E2E_BUDGET_PROVENANCE = {
  maxObservedMs: 12744,
  samples: 8,
  runs: 8,
  jobs: 8,
  safetyMultiplier: 4,
  collectedAt: '2026-10-17',
  source: 'CI 作业 QG Desktop Shards（脚本扫两档，命中只落在该文件所属的 1/2）日志里该用例的耗时行'
    + '（✓=跑成、×=被框架切断时的墙钟下限）'
    + '，由 scripts/case-timeout-audit.js 汇总：node scripts/case-timeout-audit.js --runs=8 --json'
    + '；采不到样本以 rc=3 出声——零样本不等于没问题',
};

// 进程内台账：只有**真跑**才记样本。审计脚本与"贴脸逼近"那条断言都取这份数，
// 若允许 mock 注入样本会让后者退化成恒真（同 test-helpers/windows-file-lock.js 的台账口径）。
const elapsedSamples = [];

/** @param {number} ms */
function recordGuiCliE2eElapsed(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 0) {
    throw new Error('ELAPSED_INVALID: ' + ms + ' ⇒ 耗时必须是有限非负数，记进台账就等于给"贴脸逼近"那条断言喂假样本');
  }
  elapsedSamples.push(v);
  return v;
}

function guiCliE2eElapsedSamples() {
  return elapsedSamples.slice();
}

/**
 * 从一行（已剥 ANSI 的）vitest verbose 输出里取该用例的耗时毫秒；不属该用例的行返回 null。
 * 坐标必须是**这一条**用例：同文件其它用例都是毫秒级，混进来会把分布读成"没有长尾"。
 * @param {string} line
 * @returns {number|null}
 */
function parseGuiCliE2eDuration(line) {
  if (typeof line !== 'string') return null;
  if (!line.includes(GUI_CLI_E2E_TEST_FILE)) return null;
  if (!line.includes(GUI_CLI_E2E_TEST_NAME)) return null;
  const m = /(\d+)ms\s*$/.exec(line.trimEnd());
  return m ? Number(m[1]) : null;
}

module.exports = {
  GUI_CLI_E2E_TEST_FILE,
  GUI_CLI_E2E_TEST_NAME,
  GUI_CLI_E2E_SUITE_NAME,
  GUI_CLI_E2E_CASE_TIMEOUT_MS,
  GUI_CLI_E2E_BUDGET_PROVENANCE,
  recordGuiCliE2eElapsed,
  guiCliE2eElapsedSamples,
  parseGuiCliE2eDuration,
};
