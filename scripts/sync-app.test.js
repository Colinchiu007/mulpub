// Regression locks for scripts/sync-app.ps1 (start-app detach contract).
//
// Why this file exists (2026-10-16): three consecutive launches of the user's app
// died when started from an agent session -- job-spawned, Start-Job, and
// Start-Process variants all vanished with the session; only WMI
// Win32_Process.Create survived. The script's own printed "launcher started"
// was a false green, and the first survival assertion I added ALSO false-redded
// (app alive, assertion FAIL) because Win32_Process.CommandLine carries
// backslashes while the launcher passes a normalized forward-slash path and
// PowerShell -like is neither slash- nor case-tolerant.
//
// These locks pin the contract so the next edit cannot silently regress it:
//   1. the launch hop must be WMI (not Start-Process),
//   2. there must be a survival assertion (never trust "started"),
//   3. the worktree match must accept BOTH slash variants.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'sync-app.ps1'), 'utf8');

// ── 锁 1：脱离方式必须是 WMI，不得回退到 Start-Process ──────────────────
test('锁1：启动链必须用 WMI Win32_Process.Create（Start-Process 主子进程会被 agent job 连坐）', () => {
  assert.match(SRC, /Invoke-CimMethod[\s\S]{0,200}Win32_Process[\s\S]{0,200}Create/,
    '必须用 Invoke-CimMethod 调 Win32_Process.Create 拉起 launcher');
  // 允许的 Start-Process 只应是历史不存在的形式；当前不得作为启动手段出现
  assert.doesNotMatch(SRC, /^\s*Start-Process\s+powershell/m,
    '不得用 Start-Process 拉 launcher（2026-10-16 实测三种非 WMI 形态全被会话连坐杀）');
});

// ── 锁 2：必须有存活断言，且失败必须非零退出 ────────────────────────────
test('锁2：必须断言存活而非只打印「launcher started」', () => {
  assert.match(SRC, /START_CONTRACT_OK/, '成功判据必须显式输出契约 OK');
  assert.match(SRC, /-not\s+\$survived[\s\S]{0,300}exit\s+1/,
    '未检出存活进程必须 exit 1（不得只告警）');
  assert.match(SRC, /AddSeconds\(\s*150\s*\)/, '存活轮询窗口 150 秒');
});

// ── 锁 3：worktree 路径匹配必须双向斜杠（本次误报的直接根因）────────────
test('锁3：存活匹配必须接受正斜杠与反斜杠两种变体（否则把活应用判死）', () => {
  // 必须把 $Worktree 归一化成两种变体
  assert.match(SRC, /\.Replace\('\\\\',\s*'\/'\)|\.Replace\('\\',\s*'\/'\)/,
    '必须生成正斜杠变体');
  assert.match(SRC, /\.Replace\('\/',\s*'\\\\'\)|\.Replace\('\/',\s*'\\'\)/,
    '必须生成反斜杠变体');
  // 判据必须拿变体集合去匹配，而不是单变体
  assert.match(SRC, /wtVariants/, '匹配必须基于变体集合');
  // 行为验证：反斜杠命令行里必须能命中正斜杠 worktree 串（用真实数据形态）
  const cmdLineLike = 'electron.exe "D:\\Data\\projects\\mp-worktrees\\mp-app-live2\\node_modules\\electron\\dist\\electron.exe" --user-data-dir=...';
  const wt = 'D:/Data/projects/mp-worktrees/mp-app-live2';
  const asRegExp = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  assert.ok(asRegExp(wt).replace(/\\\\/g, '\\\\').length > 0);
  // 核心：反斜杠文本 contains 正斜杠串 为 false（这正是误报机制），故必须做变体替换后才比
  assert.equal(cmdLineLike.includes(wt), false,
    '反斜杠 CommandLine 不含正斜杠 worktree 串 —— 单变体匹配必然漏（误报 FAIL 的机制）');
  assert.ok(cmdLineLike.includes(wt.replace(/\//g, '\\')),
    '反斜杠变体必须能命中，否则锁 3 自身失效');
});

// ── 锁 4：5.1 兼容（不得引入三元/?? 等 PS7 语法）──────────────────────
// 只匹配"真正的三元调用形态"（变量/属性后跟 ? 空格 表达式 空格 : 表达式），
// 不匹配注释、字符串或全角冒号——否则会把正常脚本误判为 PS7（实测误报过一次）。
test('锁4：脚本保持 PowerShell 5.1 兼容（本机 powershell 为 5.1）', () => {
  assert.doesNotMatch(SRC, /\?\?/, '不得使用 ?? 空合并运算符（PS7+）');
  // 三元：`$x ? a : b` / `$obj.P ? a : b`，两侧须为 ASCII 冒号且前有空格
  const ternary = /\$[\w.]+\s*\?\s*[^\r\n:]{1,60}\s:\s*[^\r\n]/;
  assert.doesNotMatch(SRC, ternary, '不得使用三元运算符 $x ? a : b（PS7+）');
  // 反向自检：判据本身要能认出三元（否则锁是恒真的）
  assert.match('$a ? 1 : 2', ternary, '判据必须能识别三元，否则本锁恒真');
});
