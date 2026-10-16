#!/usr/bin/env node
'use strict';

/**
 * safe-delete —— 删除前强制过「是否 tracked」关的守卫（AGENTS.md R0）
 *
 * 为什么需要它
 * -------------
 * 2026-10-07 单日误删 `.ccg/` 目录 5 次。每次的形态都略有不同（传目录路径、
 * `Get-ChildItem -Recurse`、`Get-ChildItem -File` 枚举……），但**根因完全一样**：
 * 「清理临时产物」时把一个**受管目录**当成了「里面的一个临时文件」。
 *
 * 把它写进记忆 / 文档 / 提交信息都没能阻止第 5 次 —— 因为依赖的是临场自觉，
 * 而临场判断在「git status 里有几个 ?? 文件」这种场景下极易把范围放大。
 * 所以要的是**机械拦截**：让误删在执行的那一刻就不可能发生，而不是事后靠恢复。
 *
 * 三道闸（任一不通过即拒绝，不提供「强制」开关）
 * -----------------------------------------------
 *   1. 目标必须是**文件**，不能是目录
 *      —— `.ccg/` 这类「目录里恰好有几个我生成的文件」正是历次事故的形态
 *   2. 目标必须**未被 git 跟踪**（`git ls-files --error-unmatch` 必须失败）
 *      —— tracked 文件一律不动；要删 tracked 文件请用 git rm，走评审
 *   3. 目标必须以 `??` 出现在 `git status --porcelain` 里
 *      —— 「我以为它是临时的」和「git 说它是未跟踪的」必须是同一件事
 *
 * 附带的第四道闸：目标必须在仓库工作区内。仓库外的路径一律拒绝 ——
 * 跨到 `D:\` 或用户目录的删除不该由一个「清临时产物」脚本顺手做掉。
 *
 * 已知边界（如实写明，不假装覆盖）
 * -----------------------------------
 * - 被 `.gitignore` 命中的文件**一律拒绝删除**：它们在 `git status` 里不可见，
 *   闸3 因而拿不到「它确实未受管」的证据。这是刻意的保守取向 ——
 *   实测 `.pi.log` / `.t.log` 这类本机日志会被挡住。想删它们请手工确认后直接删。
 * - 被**改名**的 tracked 文件：改名后新路径在 git 里已无受管身份（内容仍在 HEAD 旧
 *   路径下），守卫会放行。工作副本删掉不构成数据丢失，但「改名意图」会丢。
 *   守卫拦的是「删掉 git 正在管的东西」，不是「猜这个文件将来会不会被提交」。
 * - 闸 3 只在工作区内有意义；`--allow-outside` 放行仓库外路径后不再受闸3 约束。
 *
 * 用法
 * ---
 *   node scripts/safe-delete.cjs <路径> [<路径> ...]
 *   node scripts/safe-delete.cjs --dry-run <路径> ...     # 只报判据，不删
 *   node scripts/safe-delete.cjs --allow-outside <路径>   # 仅对仓库外路径，需同时给绝对路径
 *
 * 删除走 mavis-trash（可恢复），不用 rm。
 */

const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const AUDIT = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Mulpub', 'safe-delete.log');

function git(args, cwd) {
  return cp.spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function repoRoot(startDir) {
  const r = git(['rev-parse', '--show-toplevel'], startDir);
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

/** 解析为绝对路径（不要求存在，交给后续闸判）。 */
function abs(p, cwd) {
  return path.resolve(cwd || ROOT, p);
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 核心判据。抽成纯函数是为了能单测——CLI 里内联的话，回归锁就只能对着真实
 * 仓库跑，测不出「构造出来的场景也判红」这件事本身。
 *
 * @returns {{ok: boolean, reason?: string, target: string, isDir: boolean,
 *            tracked: boolean, untrackedListed: boolean, insideRepo: boolean}}
 */
function judge(targetAbs, repoAbs, opts = {}) {
  const isDir = safeIsDir(targetAbs);
  const insideRepo = repoAbs ? isInside(targetAbs, repoAbs) : false;

  const trackedRes = repoAbs && !isDir
    ? git(['ls-files', '--error-unmatch', '--', path.relative(repoAbs, targetAbs)], repoAbs)
    : { status: 1 };
  const tracked = trackedRes.status === 0;

  let untrackedListed = false;
  // 闸 3 只在「工作区内」有意义：仓库外路径不在 git status 的管辖范围，
  // 用它当判据会让 --allow-outside 永远无法放行（自我实现的死锁）。
  if (repoAbs && !isDir && insideRepo) {
    const rel = path.relative(repoAbs, targetAbs).replace(/\\/g, '/');
    const st = git(['status', '--porcelain', '--', rel], repoAbs);
    if (st.status === 0) {
      untrackedListed = st.stdout.split('\n').some((l) => l.trimStart().startsWith('??'));
    }
  } else if (!insideRepo) {
    untrackedListed = true; // 仓库外无「受管」概念，交给边界闸判
  }

  const base = { target: targetAbs, isDir, tracked, untrackedListed, insideRepo };

  // 闸 1：不是文件
  if (isDir) {
    return { ...base, ok: false, reason: `目标是目录 —— 拒绝。历史 5 次误删全部始于「把一个目录当成里面的临时文件」。要删目录请先逐条列出其中的未跟踪文件。` };
  }
  // 仓库边界
  if (!repoAbs) {
    return { ...base, ok: false, reason: '不在 git 仓库内 —— 拒绝（本脚本只清仓库里的未跟踪产物）。' };
  }
  if (!insideRepo && !opts.allowOutside) {
    return { ...base, ok: false, reason: `目标在工作区之外（${repoAbs}）—— 拒绝。跨到工作区外的删除不属于「清理临时产物」。` };
  }
  // 闸 2：被跟踪
  if (tracked) {
    return { ...base, ok: false, reason: '目标被 git 跟踪 —— 拒绝。要删受管文件请用 git rm 并走评审，不要绕过。' };
  }
  // 闸 3：不在未跟踪列表
  if (!untrackedListed) {
    return { ...base, ok: false, reason: '目标未出现在 git status 的 ?? 列表里 —— 拒绝。「我以为它是临时的」不算依据，git 的清单才算。' };
  }
  return { ...base, ok: true };
}

function safeIsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

function audit(line) {
  try {
    fs.mkdirSync(path.dirname(AUDIT), { recursive: true });
    fs.appendFileSync(AUDIT, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch (_) { /* 审计写不进去也不该阻断清理 */ }
}

function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const allowOutside = argv.includes('--allow-outside');
  const targets = argv.filter((a) => !a.startsWith('--'));
  if (!targets.length) {
    console.error('用法: node scripts/safe-delete.cjs [--dry-run] [--allow-outside] <路径> ...');
    process.exit(2);
  }

  let failed = 0;
  for (const t of targets) {
    const cwd = path.isAbsolute(t) ? path.parse(t).root : ROOT;
    const absPath = abs(t, cwd);
    const repoAbs = repoRoot(fs.existsSync(absPath) && safeIsDir(absPath) ? absPath : path.dirname(absPath))
      || repoRoot(ROOT);
    const v = judge(absPath, repoAbs, { allowOutside });
    const rel = repoAbs && isInside(absPath, repoAbs) ? path.relative(repoAbs, absPath) : absPath;

    if (!v.ok) {
      failed++;
      console.error(`✗ 拒绝删除 ${rel}\n  ${v.reason}`);
      audit(`REFUSED\t${rel}\t${v.reason}`);
      continue;
    }
    if (dryRun) {
      console.log(`· [dry-run] 允许删除 ${rel}（未跟踪、非目录、在工作区内）`);
      continue;
    }
    // 走可恢复删除（后端解析链：外部命令优先，平台内置兜底，全不可用则失败而非静默）
    const r = deleteRecoverable(absPath);
    if (!r.ok) {
      failed++;
      console.error(`✗ 删除失败 ${rel}\n  ${r.error}`);
      audit(`FAILED\t${rel}\t${r.error}`);
      continue;
    }
    console.log(`✓ 已删除（可恢复）${rel}${r.backend ? `（backend=${r.backend}）` : ''}`);
    audit(`DELETED\t${rel}${r.backend ? `\tbackend=${r.backend}` : ''}`);
  }
  process.exit(failed ? 1 : 0);
}

// ── 可恢复删除的后端解析链 ────────────────────────────────────────────────
// 「可恢复」是 R0 铁律的核心语义，不能外包给一个未随仓库交付的外部命令：
// 2026-10-09 至 2026-10-16 实测，mavis-trash 缺失时四道闸全过、--dry-run 报
// 「允许删除」，实跑却一律 'mavis-trash' 不是内部或外部命令 ⇒ 审计写 FAILED，
// 而 12 例回归测试全绿（它们只测判据层，删除路径仅被一条字符串结构锁覆盖）。
// 因此这里在 mavis-trash 之后追加**平台内置**后端；全部不可用时返回失败并把
// 文件原样留在盘上 —— 删不掉就必须承认删不掉，绝不退化为不可恢复删除。

/** 平台内置（不依赖外部 PATH）的可恢复删除实现。 */
const BUILTIN_BACKENDS = {
  win32: 'windows-recycle',
  darwin: 'macos-finder-trash',
  linux: 'freedesktop-gio-trash',
};

/**
 * 给出该平台的可恢复删除候选（有序：外部命令在前保持向后兼容）。
 * 每项：{ id, kind }，kind ∈ 'external'（依赖 PATH）| 'builtin'（平台自带能力）。
 */
function trashBackends(platform = process.platform) {
  const list = [{ id: 'mavis-trash', kind: 'external' }];
  const builtin = BUILTIN_BACKENDS[platform];
  if (builtin) list.push({ id: builtin, kind: 'builtin' });
  return list;
}

// PowerShell 送回收站：脚本经 -Command 内联（纯 ASCII）。路径**不用命令行参数**
// 传入 —— powershell -Command 会把后续实参拼接进脚本文本，路径里的盘符冒号会被
// 当成新的表达式记号（实测 ParserError「意外的标记 D:\...」）；改经环境变量
// MAVIS_TRASH_PATH 传入，脚本从 $env 读取，彻底绕开引号与拼接问题。
const WIN_RECYCLE_PS = [
  'Add-Type -AssemblyName Microsoft.VisualBasic;',
  '$p=$env:MAVIS_TRASH_PATH;',
  'if(-not $p){ [Console]::Error.WriteLine(\'mavis: MAVIS_TRASH_PATH not set\'); exit 1 };',
  'if(-not (Test-Path -LiteralPath $p -PathType Leaf))',
  "{ [Console]::Error.WriteLine('mavis: not a file: '+$p); exit 1 };",
  "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(",
  "$p,[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,",
  "[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin); exit 0",
].join(' ');

/** 执行单个内置后端。返回 {status, stdout, stderr} 形状（与 spawnSync 一致）。 */
function runBuiltinBackend(backend, absPath) {
  if (backend.id === 'windows-recycle') {
    return cp.spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', WIN_RECYCLE_PS],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, MAVIS_TRASH_PATH: absPath },
      }
    );
  }
  if (backend.id === 'freedesktop-gio-trash') {
    return cp.spawnSync('gio', ['trash', '--', absPath], { encoding: 'utf8', windowsHide: true });
  }
  if (backend.id === 'macos-finder-trash') {
    // osascript 经 Finder 删除即进废纸篓；路径由 shell 安全引用规则之外的方式传入。
    const script = `tell application "Finder" to delete POSIX file "${absPath.replace(/"/g, '\\"')}"`;
    return cp.spawnSync('osascript', ['-e', script], { encoding: 'utf8', windowsHide: true });
  }
  return { status: -1, stderr: `unknown builtin backend: ${backend.id}` };
}

/**
 * 可恢复删除：按候选顺序尝试，第一个成功即返回。
 * @returns {{ok: boolean, backend?: string, error?: string}}
 *          全部失败时 ok=false 且**目标文件保持原样**（本函数不做任何不可恢复删除）。
 */
function deleteRecoverable(absPath, opts = {}) {
  const candidates = Array.isArray(opts.backends) ? opts.backends : trashBackends();
  if (candidates.length === 0) {
    return { ok: false, error: '无可用的可恢复删除后端（backends 为空）—— 文件保持原样，请先补齐后端再清理' };
  }
  const errors = [];
  for (const b of candidates) {
    const r = b.kind === 'external'
      ? cp.spawnSync('mavis-trash', [absPath], { encoding: 'utf8', shell: true, windowsHide: true })
      : runBuiltinBackend(b, absPath);
    if (r && r.status === 0) return { ok: true, backend: b.id };
    errors.push(`${b.id}: ${((r && (r.stderr || r.stdout)) || '').trim() || `status=${r && r.status}`}`);
  }
  return {
    ok: false,
    error: `所有可恢复删除后端都失败（文件保持原样）：${errors.join(' | ')}`,
  };
}

// ⚠ CLI 入口必须在文件末尾：main → deleteRecoverable → trashBackends 读取的
// BUILTIN_BACKENDS 是 const，入口若放在它初始化之前，真跑 CLI 会触发 TDZ
// （ReferenceError），而 node --test 只 require 不执行 main，全绿测试看不见这个崩溃
// ——2026-10-16 实测：17/17 绿的同一份代码，CLI 实跑立即崩。
if (require.main === module) main(process.argv.slice(2));

module.exports = { judge, isInside, repoRoot, trashBackends, deleteRecoverable };