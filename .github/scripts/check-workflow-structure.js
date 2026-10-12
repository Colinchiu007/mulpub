'use strict'
// workflow 结构门禁：抓「GitHub 在排队之前就拒绝这份文件」的那一类形态。
//
// 动因（2026-10-11，87e311c45 / PR #3200）：一次"修 rebase 重复键"的收尾提交顺手删掉了
// gui-test.yml 里 `defaults.run.shell: bash`，留下一个**空值节点**：
//
//     defaults:
//       run:
//
// js-yaml 照单全收（YAML 语法完全合法），于是本仓所有以"能否 parse"为判据的检查全部放行；
// 而 GitHub 的 workflow 编译器把它判为 `Unexpected value ''`，annotation 是这条 run 唯一的现场
// —— 零 job、零日志、REST 侧 check-runs 空数组，只能从 Actions UI 读到原文。后果不是"CI 变慢"，
// 是这条流水线**从 main 上消失**：main 每次 push 红，且此后从 main 切出的每个 PR 都拿不到它。
//
// 因此本锁测的是"必需节点缺席 / 为空 / 形状不对"这一类，而不是 YAML 语法。
// 边界要如实说清，两处刻意不覆盖：
//  ① **未知键拼写**（例如把 timeout-minutes 写成 timeout_minutes）不在范围内——那需要 GitHub
//     官方 schema 的完整键表，凭一份手抄表判红会误伤合法键（permissions 可写字符串简写就是
//     现成的一例）。宁可留这个缺口，也不造一条会假红的锁。
//  ② **本锁无法校验承载它自己的那份 workflow**：quality-gate.yml 自身坏掉时 Gate 3 随之消失。
//     任何 workflow 都不能自证能编译；被覆盖的是动因场景（别的 workflow 坏、quality-gate 好）。
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const REPO_ROOT = path.join(__dirname, '..', '..');

function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// 唯一允许"键在而值为空"的位置：on: 下的**任意事件名**（GitHub 允许省略某个事件的配置，
// 例如 `workflow_dispatch:` 后面什么都不写）。判据的范围是"on 的第一层子键"，不是某个
// 具体事件——本仓 13 份 workflow 实测的 8 处 null 恰好全是 workflow_dispatch，那只是
// 现状样本，不是规则边界（两个模型独立指出这里曾把实测现状写成判据，会误导后来者）。
// 白名单按实测收口，不再多放一类：多放一类就等于把本锁要抓的那个形态放回合法集合。
function isAllowedEmpty (parts) {
  return parts.length === 2 && parts[0] === 'on';
}

function add (out, label, parts, code, message) {
  out.push({ label, code, path: parts.join('.'), message });
}

// 递归找空值节点（本锁的动因形态）。
function walkNulls (node, parts, label, out) {
  if (node === null) {
    if (!isAllowedEmpty(parts)) {
      add(out, label, parts, 'EMPTY_VALUE', '该位置的值必须是一个映射/序列/标量，写成空值会被 GitHub 拒绝');
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkNulls(item, parts.concat('[' + i + ']'), label, out));
    return;
  }
  if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      walkNulls(value, parts.concat(key), label, out);
    }
  }
}

function checkStep (step, parts, label, out) {
  if (!isPlainObject(step)) {
    add(out, label, parts, 'STEP_INVALID', '步骤必须是一个映射');
    return;
  }
  const hasUses = Object.prototype.hasOwnProperty.call(step, 'uses');
  const hasRun = Object.prototype.hasOwnProperty.call(step, 'run');
  if (hasUses && hasRun) {
    add(out, label, parts, 'STEP_BOTH_USES_RUN', 'uses 与 run 只能二选一');
  } else if (!hasUses && !hasRun) {
    add(out, label, parts, 'STEP_NO_ACTION', '步骤必须声明 uses 或 run，否则它什么都不做');
  }
  if (hasRun && (typeof step.run !== 'string' || step.run.trim() === '')) {
    add(out, label, parts.concat('run'), 'STEP_RUN_EMPTY', 'run 必须是非空字符串');
  }
  // with / env 只接受映射；null 由 walkNulls 报 EMPTY_VALUE，此处补"写成数组或标量"
  for (const key of ['with', 'env']) {
    if (Object.prototype.hasOwnProperty.call(step, key) && step[key] !== null && !isPlainObject(step[key])) {
      add(out, label, parts.concat(key), 'STEP_MAPPING_INVALID', key + ' 必须是映射');
    }
  }
}

function checkJob (job, parts, label, out) {
  if (!isPlainObject(job)) {
    add(out, label, parts, 'JOB_INVALID', '作业必须是一个映射');
    return;
  }
  if (Object.prototype.hasOwnProperty.call(job, 'defaults')) {
    const defaults = job.defaults;
    if (defaults !== null) {
      if (!isPlainObject(defaults) || Object.keys(defaults).length === 0) {
        add(out, label, parts.concat('defaults'), 'DEFAULTS_EMPTY', 'defaults 必须至少含 run 一项');
      } else if (Object.prototype.hasOwnProperty.call(defaults, 'run')) {
        const run = defaults.run;
        if (run !== null && (!isPlainObject(run) || Object.keys(run).length === 0)) {
          add(out, label, parts.concat('defaults', 'run'), 'DEFAULTS_EMPTY',
            'defaults.run 必须至少含 shell 或 working-directory（写成空值即本锁的动因形态）');
        }
      }
    }
  }
  if (Object.prototype.hasOwnProperty.call(job, 'steps')) {
    // 两条互斥/必需判据由 QM-6 双模型独立命中（两个模型各自构造夹具喂进 checkWorkflowText
    // 实测返回空数组）。带 steps 的作业缺 runs-on、或同时带 uses，GitHub 同样在排队前拒绝，
    // 与 defaults.run 空值属同一类"门禁章程内的漏网形态"。
    if (Object.prototype.hasOwnProperty.call(job, 'uses')) {
      add(out, label, parts, 'JOB_BOTH_STEPS_AND_USES', 'steps 与 uses 只能二选一：普通作业 / 复用另一个 workflow');
    }
    if (!Object.prototype.hasOwnProperty.call(job, 'runs-on')) {
      add(out, label, parts.concat('runs-on'), 'JOB_MISSING_RUNS_ON', '带 steps 的作业必须声明 runs-on');
    }
    const steps = job.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      add(out, label, parts.concat('steps'), 'STEPS_INVALID', 'steps 必须是非空序列');
      return;
    }
    steps.forEach((step, i) => checkStep(step, parts.concat('steps', '[' + i + ']'), label, out));
    return;
  }
  // 没有 steps 的作业只能靠 uses 复用另一个 workflow
  if (!Object.prototype.hasOwnProperty.call(job, 'uses')) {
    add(out, label, parts, 'JOB_NO_ACTION_TARGET', '作业必须有 steps 或 uses');
  }
}

/**
 * 校验一份 workflow 文本。
 * @param {string} text YAML 原文
 * @param {string} label 文件名（出现在报告与 ::error 里，用于定位）
 * @returns {Array<{label:string,code:string,path:string,message:string}>}
 */
function checkWorkflowText (text, label) {
  const out = [];
  let doc;
  try {
    doc = yaml.load(text);
  } catch (err) {
    add(out, label, [], 'YAML_PARSE_FAIL', 'YAML 无法解析：' + err.message);
    return out;
  }
  if (!isPlainObject(doc)) {
    add(out, label, [], 'WORKFLOW_INVALID', 'workflow 根节点必须是映射');
    return out;
  }
  walkNulls(doc, [], label, out);

  if (!Object.prototype.hasOwnProperty.call(doc, 'jobs')) {
    add(out, label, ['jobs'], 'JOBS_INVALID', '缺少 jobs');
  } else if (doc.jobs !== null) {
    // jobs 为 null 由 walkNulls 报 EMPTY_VALUE，这里只判"非空映射"的其余形态
    if (!isPlainObject(doc.jobs) || Object.keys(doc.jobs).length === 0) {
      add(out, label, ['jobs'], 'JOBS_INVALID', 'jobs 必须是非空映射');
    } else {
      for (const [id, job] of Object.entries(doc.jobs)) {
        checkJob(job, ['jobs', id], label, out);
      }
    }
  }
  return out;
}

/**
 * 扫描某个仓库根下的全部 workflow。
 * 目录读不到一律抛错：不完整的遍历判定全绿是假绿（与 worktree 链接扫描 R3 同款坑）。
 */
function collect ({ root = REPO_ROOT } = {}) {
  const dir = path.join(root, '.github', 'workflows');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    throw new Error('无法读取 workflow 目录 ' + dir + '：' + err.message);
  }
  const files = [];
  const violations = [];
  for (const name of names.sort()) {
    if (!/\.ya?ml$/.test(name)) continue;
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) continue;
    files.push(full);
    for (const v of checkWorkflowText(fs.readFileSync(full, 'utf8'), name)) violations.push(v);
  }
  return { files, violations };
}

function main () {
  const rootArg = process.argv.slice(2).find((a) => a.startsWith('--root='));
  const root = rootArg ? path.resolve(rootArg.slice('--root='.length)) : REPO_ROOT;
  let files, violations;
  try {
    ({ files, violations } = collect({ root }));
  } catch (err) {
    // 扫描器自身故障必须与"发现违规"可区分（rc=2 vs rc=1）：否则"读不到目录"会被
    // 读成"workflow 有问题"，而真正的问题是门禁瞎了。对齐 check-step-failfast.js 的出口口径。
    console.error('ERROR: ' + (err && err.message));
    process.exitCode = 2;
    return -1;
  }
  for (const v of violations) {
    // ::error 注解让 GitHub 直接把它顶到 run 页面，不再需要人肉去翻 annotation 区
    console.error(`::error file=${v.label}::GitHub Actions 会拒绝这份 workflow —— ${v.path} (${v.code})：${v.message}`);
  }
  console.log(`[workflow-structure] root=${root} files=${files.length} violations=${violations.length}`);
  if (violations.length > 0) process.exitCode = 1;
  return violations.length;
}

if (require.main === module) main();

module.exports = { REPO_ROOT, checkWorkflowText, collect };
