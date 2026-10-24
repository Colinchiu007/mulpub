// 全仓 CI 作业超时的取证注册表 —— 「预算数值必须有可重跑的实测支撑」这条纪律的**数据单点**。
//
// 来路（三段，都写在案）：
//   2026-10-18：第一版只覆盖 `QG Coverage` 一格。动因是 `timeout-minutes: 40` 撞死过两趟 main push
//     （run 39037127191 = #3836、run 39084091986 都恰好停在 40.0 分钟），后果不是"跑挂"而是
//     **main 侧证据永久丢失**；而当时没有任何东西在看这个数够不够。
//   2026-10-19：同一机制发现 60 也已不够（真实耗时涨到 43.3）⇒ 定为 65；并把采样器
//     「在飞作业被当成漏样」的缺陷修掉（否则只要仓库有 CI 在跑，预算常量就永远调不了）。
//   2026-10-20（本文件当前形态）：用户要求"把其余超时常量也纳入取证治理"。全仓实测 **24 格**
//     分布在 11 个 workflow —— 本文件从"单格常量"升格为**逐格注册表**：每一格都必须登记，
//     登记值必须与 workflow 实际值同源，且必须带可重跑的实测分布。
//
// 为什么数值放 JSON、判据放 JS：先例是 `scripts/doc-abs-paths-baseline.json` 与
// `scripts/gate-record-debt-ledger.json` —— **数据与代码分开**：改数不必改判据，审数不必读代码。
//
// 依赖：只用 node 内置模块。本文件被 `quality-gate.yml` 的 `changes` job 间接点名，
// 而那个 job 没有 Install deps（见 AGENTS.md「进白名单的前提锁」）。
'use strict';

const fs = require('fs');
const path = require('path');

const REGISTRY_REL = path.join('scripts', 'gate-timeout-registry.json');
const SCHEMA_VERSION = 1;
const STATES = new Set(['measured', 'seeded']);
const WORKFLOW_RE = /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/;
const JOB_ID_RE = /^[A-Za-z0-9_-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// coverage 这一格的历史兼容出口：既有消费者直接 require `TIMEOUT_MINUTES` / `PROVENANCE`。
// **它们不是第二份数据** —— 全部从注册表派生，派生源只有一处，所以不可能漂移。
const COVERAGE_WORKFLOW = '.github/workflows/quality-gate.yml';
const COVERAGE_JOB_ID = 'coverage';

function fail(msg) {
  // 注册表坏了必须**当场炸**：半份注册表会让"未登记"看起来像"没有问题"，
  // 那正是本仓反复登记的「把工具的失明读成结论」同型。
  const e = new Error('[GATE-TIMEOUT-REGISTRY] ' + msg);
  e.code = 'REGISTRY_INVALID';
  throw e;
}

const isPosInt = (v) => Number.isInteger(v) && v > 0;
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const isNonNegNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * 校验一份已 parse 的注册表对象。**逐字段、fail closed**，不做"尽力修复"：
 * 修一半的注册表比没有注册表更危险 —— 它会以合法外表继续放行。
 */
function validateRegistry(reg) {
  if (!reg || typeof reg !== 'object' || Array.isArray(reg)) fail('顶层必须是对象');
  if (reg.schema !== SCHEMA_VERSION) fail('schema 必须是 ' + SCHEMA_VERSION + '，实际 ' + reg.schema);
  for (const k of ['minSamples', 'staleDays', 'seededGraceDays']) {
    if (!isPosInt(reg[k])) fail(k + ' 必须是正整数，实际 ' + reg[k]);
  }
  if (!Array.isArray(reg.jobs) || reg.jobs.length === 0) fail('jobs 必须是非空数组');
  const seen = new Set();
  for (let i = 0; i < reg.jobs.length; i++) {
    const j = reg.jobs[i];
    const at = 'jobs[' + i + ']';
    if (!j || typeof j !== 'object') fail(at + ' 必须是对象');
    if (typeof j.workflow !== 'string' || !WORKFLOW_RE.test(j.workflow)) {
      fail(at + '.workflow 必须是 .github/workflows/*.yml 形态，实际 ' + JSON.stringify(j.workflow));
    }
    if (typeof j.jobId !== 'string' || !JOB_ID_RE.test(j.jobId)) {
      fail(at + '.jobId 非法：' + JSON.stringify(j.jobId));
    }
    if (typeof j.displayName !== 'string' || !j.displayName.trim()) fail(at + '.displayName 必填');
    if (j.samplerPattern !== undefined &&
        (typeof j.samplerPattern !== 'string' || !j.samplerPattern.trim())) {
      fail(at + '.samplerPattern 若给就必须是非空字符串');
    }
    if (!isPosInt(j.timeoutMinutes)) fail(at + '.timeoutMinutes 必须是正整数');
    if (!STATES.has(j.state)) {
      fail(at + '.state 必须是 ' + [...STATES].join('/') + '，实际 ' + JSON.stringify(j.state));
    }
    const p = j.provenance;
    if (!p || typeof p !== 'object') fail(at + '.provenance 必填');
    if (!isNonNegInt(p.samples)) fail(at + '.provenance.samples 必须是 ≥0 整数');
    if (!isNonNegNum(p.maxMinutes)) fail(at + '.provenance.maxMinutes 必须是 ≥0 数字');
    if (!isNonNegNum(p.p90Minutes)) fail(at + '.provenance.p90Minutes 必须是 ≥0 数字');
    if (!isNonNegInt(p.censoredAtCeiling)) fail(at + '.provenance.censoredAtCeiling 必须是 ≥0 整数');
    if (!isPosInt(p.ceilingMinutesSampled)) fail(at + '.provenance.ceilingMinutesSampled 必须是正整数');
    if (!isNonNegInt(p.runsListed)) fail(at + '.provenance.runsListed 必须是 ≥0 整数');
    if (typeof p.collectedAt !== 'string' || !DATE_RE.test(p.collectedAt)) {
      fail(at + '.provenance.collectedAt 必须是 YYYY-MM-DD（与采样器逐字一致：UTC 日期）');
    }
    // 内部自洽：挡住"手抄错一位"的典型形态。
    if (p.p90Minutes > p.maxMinutes) fail(at + ' p90=' + p.p90Minutes + ' 大于 max=' + p.maxMinutes);
    if (p.samples > p.runsListed) fail(at + ' samples=' + p.samples + ' 大于 runsListed=' + p.runsListed);
    if (p.censoredAtCeiling > 0 && p.ceilingMinutesSampled < p.maxMinutes) {
      fail(at + ' 有截尾样本时 ceilingMinutesSampled(' + p.ceilingMinutesSampled +
        ') 不得小于 maxMinutes(' + p.maxMinutes + ')');
    }
    const key = j.workflow + '#' + j.jobId;
    if (seen.has(key)) fail('重复登记：' + key);
    seen.add(key);
  }
  return true;
}

/** 从仓库根加载并校验注册表 → { raw, jobs, byKey, file } */
function loadRegistry(root) {
  const base = root || path.join(__dirname, '..', '..');
  const file = path.join(base, REGISTRY_REL);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail('读不到 ' + file + ' — ' + e.message);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    fail(file + ' 不是合法 JSON — ' + e.message);
  }
  validateRegistry(raw);
  const byKey = new Map();
  for (const j of raw.jobs) byKey.set(j.workflow + '#' + j.jobId, j);
  return { raw, jobs: raw.jobs.slice(), byKey, file };
}

function findJob(reg, workflow, jobId) {
  if (!reg || !reg.byKey) return null;
  return reg.byKey.get(String(workflow) + '#' + String(jobId)) || null;
}

// ── coverage 兼容出口（派生，非第二份数据）──────────────────────────────────
let _cache = null;
function registry() {
  if (!_cache) _cache = loadRegistry();
  return _cache;
}
function coverageEntry() {
  const e = findJob(registry(), COVERAGE_WORKFLOW, COVERAGE_JOB_ID);
  if (!e) fail('注册表里缺 coverage 这一格（' + COVERAGE_WORKFLOW + '#' + COVERAGE_JOB_ID + '）');
  return e;
}

function coverageProvenance() {
  const e = coverageEntry();
  return Object.assign({
    jobName: 'QG Coverage',
    workflowPath: COVERAGE_WORKFLOW,
  }, e.provenance, {
    safetyMultiplier: require('../gate-budget.js').SAFETY_MULTIPLIER,
    timeoutMinutes: e.timeoutMinutes,
    remeasureCommand: 'node scripts/coverage-budget-sample.js --workflow=quality-gate.yml --job=QG Coverage --limit=120',
  });
}

module.exports = {
  SCHEMA_VERSION, STATES, REGISTRY_REL, COVERAGE_WORKFLOW, COVERAGE_JOB_ID,
  validateRegistry, loadRegistry, findJob, registry, coverageEntry,
  // 兼容出口（派生）。SAFETY_MULTIPLIER 沿用 `scripts/gate-budget.js` 那一个系数，不另立。
  JOB_NAME: 'QG Coverage',
  WORKFLOW_PATH: COVERAGE_WORKFLOW,
  SAFETY_MULTIPLIER: require('../gate-budget.js').SAFETY_MULTIPLIER,
  get TIMEOUT_MINUTES() { return coverageEntry().timeoutMinutes; },
  get PROVENANCE() { return coverageProvenance(); },
};
