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
 *
 * 两处必须知道的口径（QM-6 前端轴 F11 + 后端轴 #9，已采纳为说明而非改数）：
 * ① **那两条长尾样本是左删失的**——11097/12744 是"用例被 10s 全局预算切断那一刻的墙钟"，
 *    真实耗时只会 ≥ 它。所以 `60000 ≥ 12744 × 4` 这个余量是按**下限**算的，天然偏乐观。
 *    本片合入后该用例有了自己的预算，重测拿到的就是**未删失值**；届时若 max 逼近 15000ms
 *    （= 预算 ÷ 4），`case-timeout-audit.js` 会以 rc=4 出声，按数抬预算，不得反过来放宽断言。
 * ② `maxObservedMs` 是**手动维护**的 CI 长尾上限，不是每次跑完自动落盘的实时最大值（进程内台账
 *    `elapsedSamples` 随测试进程结束就没了，它只服务"贴脸逼近"那条断言）。要改这个数，唯一的
 *    正当路径是当场跑一次复测入口并把它的输出整份粘回来。
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
 * 余量判据（把"贴脸"这条不等式做成纯函数，而不是埋在断言里）：
 * 埋在断言里时它只在"这台机器今天够快"的条件下为真——想反证它就得等到一次真的贴脸，
 * 那不是变异反证，是碰运气。抽成函数后可以用选定的数去证它真的有牙（M14）。
 * 与复测脚本 rc=4 用**同一条不等式**（QM-6 前端轴 G5）：差别只在测量对象（这里是本次单样本，
 * 那里是整个窗口的 max），判据本身不许有两把尺子。
 * @param {number} maxMs 观测到的耗时（ms）
 * @param {number} budgetMs 该用例声明的预算（ms）
 * @param {number} multiplier 安全系数（与 provenance 同源）
 * @returns {boolean}
 */
function headroomSufficient(maxMs, budgetMs, multiplier) {
  if (![maxMs, budgetMs, multiplier].every(Number.isFinite)) return false;
  if (maxMs <= 0 || budgetMs <= 0 || multiplier <= 0) return false;
  return maxMs * multiplier <= budgetMs;
}

/**
 * 从一行（已剥 ANSI 的）vitest verbose 输出里取该用例的耗时毫秒；不属该用例的行返回 null。
 * 坐标必须是**这一条**用例：同文件其它用例都是毫秒级，混进来会把分布读成"没有长尾"。
 *
 * 两道边界而不是两个 `includes`（QM-6 后端轴 #8 命中）：`includes(name)` 对「名字是我这条的
 * **超集**」的另一条用例同样成立（例如以后有人加一条 `…且不写产出（重复跑）`），于是两次不同的
 * 耗时会被并进同一份分布，读数看起来更"充实"却不再测它声称的那条。判据改成
 * **「耗时数字前面紧邻的必须是这条用例名，且行尾就是这条耗时」**——超集名在 `endsWith` 这一步就被拒。
 * @param {string} line
 * @returns {number|null}
 */
function parseGuiCliE2eDuration(line) {
  if (typeof line !== 'string') return null;
  if (!line.includes(GUI_CLI_E2E_TEST_FILE)) return null;
  const t = line.trimEnd();
  const m = /(\d+)ms$/.exec(t);
  if (!m) return null;
  if (!t.slice(0, m.index).trimEnd().endsWith(GUI_CLI_E2E_TEST_NAME)) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/**
 * 禁词扫描前剥注释（QM-6 后端轴 #1 + 前端轴 F9 命中，且本文件自己的说明**必然**提到旧预算数字）。
 * 顺序：先块注释再行注释——块注释里可以嵌 `//`，反序会把块注释的收尾（星号斜杠）当行注释吃掉。
 * 行注释只在 `//` 处于行首或空白后时才剥，避免吃掉 `https://` 这类字符串。
 * ⚠️ 残余：这一剥法对"字符串字面量里以空白开头的 `// …`"会过剥，方向只会**削弱**禁词锁而不会误伤，
 * 因此保留；承重判据（锚点存在性、引用位置）一律跑在**未剥**的原文上。
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^\s*|(?<=\s))\/\/.*$/gm, '');
}

/**
 * 找"下一条用例的起点"，用于把预算引用**钉在本条用例之内**（QM-6 前端轴 G1）。
 * 抽成纯函数而不是写在断言里，理由与 `headroomSufficient` 同一条：锚点的"宽"必须能被测——
 * 只认 `it('` 一种写法时，下一条用例被合规地写成 `it("` 或 `it.each(`，锚点就取到 -1 或更后面那条，
 * "预算属于本条用例"这件事**静默放宽**，而这种放宽在只跑一次的情况下完全看不出来。
 * 取不到边界一律返回 -1，由调用方判红（**不许**退化成"到文件末尾"）。
 * @param {string} src
 * @param {number} fromIndex 从这条用例起点之后开始找
 * @returns {number} 边界下标，找不到返回 -1
 */
function findNextCaseIndex(src, fromIndex) {
  const m = /\n\s*it(\.each|\.skip|\.skipIf|\.only)?\s*[(]/.exec(src.slice(fromIndex));
  return m ? fromIndex + m.index : -1;
}

/**
 * 台账锁用的安全系数，**故意小于** provenance 的那个。
 * 两个量不是同一个东西：`provenance.safetyMultiplier` 乘的是**一个窗口里 CI 分布的 max**，
 * 这里乘的是**本次这一条样本**——而这一条样本受当前这台机器的负载支配。
 *
 * 为什么不统一成一把尺子（这是被实测否证的尝试，不是理论选择）：统一用 4 之后，本机在一次
 * 高负载跑里量到 **21678ms**，`21678 × 4 = 86712 > 60000` ⇒ 台账锁红，而同一时刻 CI 分布的
 * max 还是 12744ms、余量成立。那次红报的是"我这台机器今天很忙"，不是"预算贴脸"，
 * 属于把环境噪声写成判据。所以这里保留一个更松的系数，并把它与 provenance 系数的**大小关系**
 * 交给出处锁钉住（只许 `台账系数 ≤ 分布系数`，反过来的话台账会先于脚本失效）。
 */
const LEDGER_HEADROOM_FACTOR = 2;

module.exports = {
  GUI_CLI_E2E_TEST_FILE,
  GUI_CLI_E2E_TEST_NAME,
  GUI_CLI_E2E_SUITE_NAME,
  GUI_CLI_E2E_CASE_TIMEOUT_MS,
  GUI_CLI_E2E_BUDGET_PROVENANCE,
  LEDGER_HEADROOM_FACTOR,
  recordGuiCliE2eElapsed,
  guiCliE2eElapsedSamples,
  headroomSufficient,
  findNextCaseIndex,
  parseGuiCliE2eDuration,
  stripComments,
};
