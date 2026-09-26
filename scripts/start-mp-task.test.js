/**
 * start-mp-task.ps1 结构锁
 *
 * 事故（2026-09-26/27 两次误判后实测）：脚本顶部 `$ErrorActionPreference = 'Stop'`，
 * 而它用 `$output = & $bash $initScript $TaskName 2>&1` 捕获子进程输出。Windows
 * PowerShell 5.1 下「EAP=Stop + 2>&1 捕获 native 命令 stderr」会把**任何**一行 stderr
 * 变成终止性 NativeCommandError —— 而 git 在**成功**时也要往 stderr 写进度
 * （实测原文 `Preparing worktree (new branch 'fix-start-mp-task-stderr')`）。
 * 后果：worktree 已经建成，脚本却在下一行中止，以 rc=1 退出，并跳过 `.git` 存在性校验、
 * 结果报告与开 shell。两次现场归因（「静默失败」「只有 fetch 失败才 rc=1」）都是错的，
 * 因为都从单次观测外推、没做机制级最小复现。
 *
 * 本锁不测 PowerShell 语义（那随宿主版本变），只锁「捕获点必须处在被临时放宽、并在
 * finally 里恢复的 EAP 作用域内」这条可静态判定的写法约束。把修复改成 no-op 会立刻变红。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'start-mp-task.ps1');
const lines = fs.readFileSync(SCRIPT, 'utf8').split(/\r?\n/);

const CAPTURE_RE = /2>&1/;
const EAP_ASSIGN_RE = /^\s*\$ErrorActionPreference\s*=\s*(.+?)\s*$/;
const RELAXED = new Set(["'Continue'", "'SilentlyContinue'"]);

// 只认真语句子进程捕获（必须带调用运算符 `& $xxx`）。注释里也会出现 "2>&1"
// —— 本文件与脚本的说明文字都是这种写法，把它们算进来会让锁自我报警而没人看得懂。
function isCapture(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) return false;
  return CAPTURE_RE.test(line) && /&\s*\$/.test(line);
}

function eapAssignments() {
  const out = [];
  lines.forEach((line, index) => {
    const match = line.match(EAP_ASSIGN_RE);
    if (match) out.push({ line: index + 1, value: match[1] });
  });
  return out;
}

function captureLines() {
  const out = [];
  lines.forEach((line, index) => {
    if (isCapture(line)) out.push({ line: index + 1, text: line.trim() });
  });
  return out;
}

test('基线：脚本顶部仍以 Stop 运行（本锁的前提，前提变了锁要一起改）', () => {
  const assignments = eapAssignments();
  assert.ok(assignments.length >= 2, '脚本必须包含 EAP 赋值（顶部 Stop + 捕获期放宽）');
  assert.equal(assignments[0].value, "'Stop'", '顶部应显式声明 $ErrorActionPreference = Stop');
});

test('每一处 2>&1 捕获都必须处在「已临时放宽」的 EAP 作用域内', () => {
  const captures = captureLines();
  assert.ok(captures.length >= 1, '至少应有一处子进程输出捕获（否则本锁失效，需一并删除）');
  const assignments = eapAssignments();

  for (const capture of captures) {
    const before = assignments.filter((item) => item.line < capture.line);
    const active = before[before.length - 1];
    assert.ok(
      active && RELAXED.has(active.value),
      `第 ${capture.line} 行「${capture.text}」处在 EAP=${active ? active.value : before.length ? '?' : '未设置（继承 Stop）'} 下：`
      + 'git 成功时也会写 stderr（如 Preparing worktree / From https://…），'
      + 'Stop + 2>&1 会把它变成终止性错误，导致 worktree 已建成却以 rc=1 中止。'
      + '捕获前必须 $ErrorActionPreference = Continue。'
    );
  }
});

test('放宽的 EAP 必须在同一 try 的 finally 里恢复（不允许整段脚本降级为 Continue）', () => {
  const captures = captureLines();
  assert.ok(captures.length >= 1);
  const firstCapture = captures[0].line;
  const restoreIndex = lines.findIndex(
    (line, index) => index >= firstCapture && /\$ErrorActionPreference\s*=\s*\$[A-Za-z]/.test(line)
  );
  assert.notEqual(restoreIndex, -1, '捕获之后必须把 EAP 恢复成进入前的值（保存/恢复成对）');
  const finallyIndex = lines.findIndex(
    // PowerShell 惯例写作 `} finally {`（同行），也可独立成行
    (line, index) => index > firstCapture && /^\s*\}?\s*finally\s*\{/.test(line)
  );
  assert.ok(
    finallyIndex !== -1 && finallyIndex < restoreIndex && restoreIndex - finallyIndex < 10,
    '恢复语句必须紧跟在 finally 开头（避免异常路径下 EAP 永久停在 Continue）'
  );
});

test('回归护栏：不得重新出现「Stop 生效期间」的 native 捕获', () => {
  // 顶部 Stop 之后、第一次放宽之前的区间里，不允许出现任何 2>&1 捕获
  const assignments = eapAssignments();
  const firstRelaxed = assignments.find((item) => RELAXED.has(item.value));
  assert.ok(firstRelaxed, '脚本必须包含放宽 EAP 的赋值');
  const early = captureLines().filter((item) => item.line < firstRelaxed.line);
  assert.deepEqual(early, [], '放宽之前的捕获点同样会被良性 stderr 打断：' + JSON.stringify(early));
});
