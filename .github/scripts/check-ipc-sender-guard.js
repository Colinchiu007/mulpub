'use strict';
/* eslint-disable no-console */
/**
 * IPC sender 守卫覆盖检查（P1-14）
 *
 * 口径固化：体检报告问题 14 的原始统计（"336 个 handle / 约 215 个带守卫"）不可复现——
 * 沿用的是 `check-ipc-bridge.js` 的非递归目录扫描，既漏掉 electron 下的子目录，也只认字符串通道名。
 * 本脚本固化为单一口径：**递归扫描 `apps/desktop/electron` 目录下全部 .js 生产源码**，
 * 用结构化解析（注释/字符串感知的参数切分 + 作用域栈）判定每个 `ipcMain.handle(...)` /
 * `ipcMain.on(...)` 注册点的守卫状态。
 *
 * 每个注册点归为五类之一（method 取 handle / on）：
 *  - `explicit`        handler 显式套了 withSenderCheck / isTrustedSender
 *  - `injected`        接收者来自外层函数形参或由其赋值的局部别名（即 window.js / phase5-ipc.js
 *                      注入的 controlledIpcMain，Proxy 内部已无条件执行 isTrustedSender）→ 咽喉点覆盖
 *  - `global`          接收者解析到 `require('electron').ipcMain` 全局对象 → 硬错误，不可豁免
 *  - `sync-unguarded`  ipcMain.on 同步通道未显式校验 sender：createAccessControlledIpcMain 的 Proxy
 *                      只包装 handle，同步通道不经咽喉点，必须逐条豁免或补守卫
 *  - `unknown`         静态无法判定（动态接收者等）→ 必须在豁免清单里逐条说明
 *
 * CI 双校验（两条都必须通过）：
 *  1) 清单式（防漂移）：`injected`/`explicit` 之外的注册点必须登记在 `ipc-guard-exemptions.json`
 *     （channel / risk / reason / owner）；登记了但实际已不需要 → 陈旧条目同样失败。
 *  2) 比例式（防稀释）：显式守卫占比不得低于 `minGuardedRatio`，防止把已有 withSenderCheck 摘掉后
 *     整体"躺"进咽喉点。
 *
 * 另含两条不变量检查（不可豁免）：
 *  - 禁止 `injectedIpcMain || require('electron').ipcMain` 回退写法（漏注入即静默绕过）；
 *  - 同一通道重复注册且守卫状态不一致 → 失败（Electron 后注册者覆盖前者，等于静默增删守卫）。
 *
 * 用法：
 *   node .github/scripts/check-ipc-sender-guard.js                # 人读汇总 + 门禁判定
 *   node .github/scripts/check-ipc-sender-guard.js --json         # 机器可读
 *   node .github/scripts/check-ipc-sender-guard.js --list-unguarded
 *   node .github/scripts/check-ipc-sender-guard.js --base-dir apps/desktop --min-ratio 0.6
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_DIR = path.resolve(__dirname, '../..', 'apps/desktop');
const ELECTRON_DIR = 'electron';
const EXEMPTIONS_REL = 'electron/ipc-guard-exemptions.json';

const GUARD_PATTERNS = [
  /\bwithSenderCheck\b/,
  /\bisTrustedSender\s*\(/,
  /\bassertTrustedSender\s*\(/,
];

// `injectedIpcMain || require('electron').ipcMain`：漏注入时静默落到全局，绕过权限层
const FALLBACK_RE = /\binjectedIpcMain\s*\|\|\s*require\(\s*['"]electron['"]\s*\)\s*\.\s*ipcMain/g;
// 注册点：任意以 ipcMain（含 controlledIpcMain / injectedIpcMain 等驼峰变体）结尾的接收者
// method=handle → 走 createAccessControlledIpcMain Proxy；method=on → 同步通道，Proxy 不拦截
const REGISTRATION_RE = /\b([A-Za-z_$][\w$.]*)\s*\.\s*(handle|on)\s*\(/g;
// 只对“接收者名字以 ipcMain 结尾”的 .on(...) 计入同步 IPC 注册点，避免 EventEmitter 噪声
const IPC_MAIN_RECEIVER_RE = /ipcmain$/i;
// 局部别名：`const ipcMain = injectedIpcMain`（受控实例经局部变量转发，仍属咽喉点覆盖）
const ALIAS_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*(?:;|\r?\n)/g;
// 模块级 electron 解构：用于识别"全局 ipcMain"绑定
const ELECTRON_DESTRUCTURE_RE = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"]electron['"]\s*\)/g;
const ELECTRON_MEMBER_RE = /\b(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]electron['"]\s*\)\s*\.\s*(\w+)/g;

const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
const NON_FUNCTION_WORDS = new Set(['else', 'try', 'finally', 'do', 'return', 'typeof', 'void', 'delete', 'await', 'yield', 'in', 'of', 'new', 'case']);

/** 生产源码判定：排除测试、mock、类型声明 */
function isProductionSourceFile(name) {
  return (
    name.endsWith('.js') &&
    !name.endsWith('.test.js') &&
    !name.endsWith('.spec.js') &&
    !name.endsWith('.d.ts') &&
    name !== 'types.js'
  );
}

function walkJs(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJs(full, out);
    else if (entry.isFile() && isProductionSourceFile(entry.name)) out.push(full);
  }
  return out;
}

/**
 * 生成"受保护区间"掩码：下标 i 为 1 表示该字符位于注释 / 字符串 / 模板串 / 正则字面量内部。
 * 避免把 JSDoc 用法示例里的 `ipcMain.handle(...)` 误计成真实注册点。
 * @param {string} src
 * @returns {Uint8Array}
 */
function buildProtectedMask(src) {
  const mask = new Uint8Array(src.length);
  const n = src.length;
  let i = 0;
  const prevSignificant = () => {
    for (let k = i - 1; k >= 0; k--) if (!/\s/.test(src[k])) return src[k];
    return '';
  };
  const mark = (from, to) => {
    for (let k = from; k < to && k < n; k++) mask[k] = 1;
  };

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? n : nl;
      mark(i, end); i = end; continue;
    }
    if (c === '/' && next === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      mark(i, end); i = end; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '\n') break;
        if (src[j] === c) { j++; break; }
        j++;
      }
      mark(i, j); i = j; continue;
    }
    if (c === '`') {
      let j = i + 1;
      mark(i, j);
      while (j < n) {
        if (src[j] === '\\') { mark(j, j + 2); j += 2; continue; }
        if (src[j] === '`') { mark(j, j + 1); j++; break; }
        if (src[j] === '$' && src[j + 1] === '{') {
          let d = 0;
          mark(j, j + 2); j += 2;
          while (j < n) {
            if (src[j] === '{') d++;
            else if (src[j] === '}') { if (d === 0) { mark(j, j + 1); j++; break; } d--; }
            j++;
          }
          continue;
        }
        mark(j, j + 1); j++;
      }
      i = j; continue;
    }
    if (c === '/' && /[([{,=:!&|?;+*%~^-]/.test(prevSignificant())) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { closed = true; break; }
        else if (src[j] === '\n') break;
        j++;
      }
      if (closed) { mark(i, j + 1); i = j + 1; continue; }
    }
    i++;
  }
  return mask;
}

/**
 * 结构化参数切分：从 openIdx 指向的 '(' 之后开始，返回顶层参数文本数组与结束位置。
 * @returns {{args: string[], end: number} | null}
 */
function splitCallArgs(src, openIdx) {
  const args = [];
  let depth = 0;
  let cur = '';
  let i = openIdx + 1;
  const n = src.length;
  const prevSignificant = () => {
    for (let k = i - 1; k >= 0; k--) if (!/\s/.test(src[k])) return src[k];
    return '';
  };

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { const nl = src.indexOf('\n', i); i = nl === -1 ? n : nl; continue; }
    if (c === '/' && next === '*') { const close = src.indexOf('*/', i + 2); i = close === -1 ? n : close + 2; continue; }
    if (c === '"' || c === "'") {
      const quote = c;
      cur += c; i++;
      while (i < n) {
        if (src[i] === '\\') { cur += src[i] + (src[i + 1] || ''); i += 2; continue; }
        cur += src[i];
        if (src[i] === quote) { i++; break; }
        if (src[i] === '\n') break;
        i++;
      }
      continue;
    }
    if (c === '`') {
      cur += c; i++;
      while (i < n) {
        if (src[i] === '\\') { cur += src[i] + (src[i + 1] || ''); i += 2; continue; }
        if (src[i] === '`') { cur += '`'; i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          let d = 0;
          cur += '${'; i += 2;
          while (i < n) {
            if (src[i] === '{') d++;
            else if (src[i] === '}') { if (d === 0) { cur += '}'; i++; break; } d--; }
            cur += src[i]; i++;
          }
          continue;
        }
        cur += src[i]; i++;
      }
      continue;
    }
    if (c === '/' && /[([{,=:!&|?;+*%~^-]/.test(prevSignificant())) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) { closed = true; break; }
        else if (src[j] === '\n') break;
        j++;
      }
      if (closed) { cur += src.slice(i, j + 1); i = j + 1; continue; }
    }

    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) { args.push(cur.trim()); return { args, end: i }; }
      depth--;
    }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; i++; continue; }
    cur += c;
    i++;
  }
  return null;
}

/** 从通道实参提取可读通道名：字符串字面量取原值，其余给 <expr> 摘要 */
function channelLabel(argText) {
  const single = argText.match(/^'([^']+)'$/);
  if (single) return single[1];
  const double = argText.match(/^"([^"]+)"$/);
  if (double) return double[1];
  const back = argText.match(/^`([^`$]+)`$/);
  if (back) return back[1];
  return `<expr:${argText.replace(/\s+/g, ' ').slice(0, 40)}>`;
}

function isExplicitlyGuarded(handlerText) {
  return GUARD_PATTERNS.some((re) => re.test(handlerText || ''));
}

/** 取形参列表里的标识符集合 */
function paramNames(paramText) {
  const names = new Set();
  if (!paramText) return names;
  const stripped = paramText.replace(/=[^,]*/g, ''); // 去默认值
  for (const m of stripped.matchAll(/[A-Za-z_$][\w$]*/g)) names.add(m[0]);
  return names;
}

/**
 * 扫描一个文件，返回全部注册点及其守卫判定。
 *
 * 作用域判定（两趟）：
 *  Pass 1 —— 只关心 '{' / '}'（跳过注释与字符串区），对每个 '{' 判定它是否函数体：
 *            向前找前一个有效字符，若是 ')' 则回溯配对 '(' 取形参；若是 '=>' 则取箭头左侧。
 *            控制关键字（if/for/while/switch/catch）后的括号不是形参。
 *  Pass 2 —— 对每个注册点，找包含它的最内层函数作用域：接收者基名在其形参集合内
 *            （或经由 `const ipcMain = injectedIpcMain` 这类局部别名可回溯到形参）→ `injected`。
 *
 * @param {string} filePath
 * @param {string} relPath
 */
function analyzeFile(filePath, relPath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const mask = buildProtectedMask(src);
  const n = src.length;

  // 模块级（顶层）从 require('electron') 拿到的标识符
  const globalBindings = new Set();
  for (const m of src.matchAll(ELECTRON_DESTRUCTURE_RE)) {
    if (mask[m.index]) continue;
    for (const item of m[1].split(',')) {
      const id = item.trim().split(':').pop().trim();
      if (id) globalBindings.add(id);
    }
  }
  for (const m of src.matchAll(ELECTRON_MEMBER_RE)) {
    if (mask[m.index]) continue;
    if (m[2] === 'ipcMain') globalBindings.add(m[1]);
  }

  // 局部别名表（name <- from，decl 为声明位置）
  const aliases = [];
  for (const a of src.matchAll(ALIAS_RE)) {
    if (mask[a.index] === 1) continue;
    aliases.push({ name: a[1], from: a[2], decl: a.index });
  }

  // 回退写法（同一文件内所有注册点一律判为 fallback-capable）
  const hasFallback = FALLBACK_RE.test(src);
  FALLBACK_RE.lastIndex = 0;

  const prevSignificantFrom = (from) => {
    for (let k = from; k >= 0; k--) {
      if (mask[k] === 1 || /\s/.test(src[k])) continue;
      return { ch: src[k], idx: k };
    }
    return { ch: '', idx: -1 };
  };

  const wordEndingAt = (idx) => {
    if (!/[A-Za-z_$]/.test(src[idx] || '')) return '';
    let s = idx;
    while (s >= 0 && /[\w$.]/.test(src[s])) s--;
    return src.slice(s + 1, idx + 1);
  };

  /** 判定 openBrace 处的 '{' 是否函数体，是则返回形参集合，否则返回 null */
  function functionParamsAt(openBrace) {
    const a = prevSignificantFrom(openBrace - 1);
    if (a.ch === ')') {
      let d = 0;
      let k = a.idx;
      for (; k >= 0; k--) {
        if (mask[k] === 1) continue;
        if (src[k] === ')') d++;
        else if (src[k] === '(') { d--; if (d === 0) break; }
      }
      if (k < 0) return null;
      const b = prevSignificantFrom(k - 1);
      if (CONTROL_KEYWORDS.has(wordEndingAt(b.idx))) return null;
      return paramNames(src.slice(k + 1, a.idx));
    }
    if (a.ch === '>' && src[a.idx - 1] === '=') {
      const c = prevSignificantFrom(a.idx - 2);
      if (c.ch === ')') {
        let d = 0;
        let k = c.idx;
        for (; k >= 0; k--) {
          if (mask[k] === 1) continue;
          if (src[k] === ')') d++;
          else if (src[k] === '(') { d--; if (d === 0) break; }
        }
        return k >= 0 ? paramNames(src.slice(k + 1, c.idx)) : new Set();
      }
      return paramNames(wordEndingAt(c.idx));
    }
    return null;
  }

  // Pass 1：作用域区间表（按起始位置排序，内层起始必然更靠后 → 取包含点里起始最大者）
  const scopes = [];
  const stack = [];
  for (let i = 0; i < n; i++) {
    if (mask[i] === 1) continue;
    const c = src[i];
    if (c === '{') {
      const params = functionParamsAt(i);
      stack.push({ start: i, params: params || new Set(), isFunction: Boolean(params) });
      continue;
    }
    if (c === '}') {
      const s = stack.pop();
      if (s) scopes.push({ start: s.start, end: i, params: s.params, isFunction: s.isFunction });
      continue;
    }
  }
  for (const s of stack) scopes.push({ start: s.start, end: n, params: s.params, isFunction: s.isFunction });

  /** 找包含 idx 的最内层函数作用域形参集合（沿作用域链向上合并） */
  function visibleParams(idx) {
    const enclosing = scopes
      .filter((s) => s.isFunction && s.start < idx && idx < s.end)
      .sort((a, b) => b.start - a.start);
    const merged = new Set();
    for (const s of enclosing) s.params.forEach((p) => merged.add(p));
    return merged;
  }

  /** 接收者基名是否可追溯到注入的受控实例（形参，或由形参赋值的局部别名） */
  function resolvesToInjected(base, at, depth = 0) {
    if (depth > 5) return false;
    if (visibleParams(at).has(base)) return true;
    for (const a of aliases) {
      if (a.name !== base || a.decl > at) continue;
      if (globalBindings.has(a.from)) return false; // 别名指向全局 electron.ipcMain → 不算受控
      if (resolvesToInjected(a.from, a.decl, depth + 1)) return true;
    }
    return false;
  }

  const regs = [];
  REGISTRATION_RE.lastIndex = 0;
  let m;
  while ((m = REGISTRATION_RE.exec(src)) !== null) {
    if (mask[m.index] === 1) continue;
    const parsed = splitCallArgs(src, m.index + m[0].length - 1);
    if (!parsed) { REGISTRATION_RE.lastIndex = m.index + m[0].length; continue; }
    if (parsed.args.length >= 2) {
      const receiver = m[1];
      const method = m[2];
      if (method === 'on' && !IPC_MAIN_RECEIVER_RE.test(receiver)) {
        REGISTRATION_RE.lastIndex = parsed.end + 1;
        continue;
      }
      const channel = channelLabel(parsed.args[0]);
      const explicit = isExplicitlyGuarded(parsed.args[1]);
      const base = receiver.split('.')[0];
      let via;
      if (explicit) via = 'explicit';
      else if (method === 'on') via = 'sync-unguarded'; // Proxy 不拦 .on，只能靠 handler 内显式校验
      else if (hasFallback) via = 'fallback';
      else if (visibleParams(m.index).has(base)) via = 'injected';
      else if (globalBindings.has(base)) via = 'global';
      else if (resolvesToInjected(base, m.index)) via = 'injected';
      else via = 'unknown';
      regs.push({
        channel,
        receiver,
        method,
        via,
        file: relPath,
        line: src.slice(0, m.index).split('\n').length,
      });
    }
    REGISTRATION_RE.lastIndex = parsed.end + 1;
  }
  return regs;
}


/**
 * 递归收集全部注册点。
 * @param {string} rootDir apps/desktop 绝对路径
 */
function collectRegistrations(rootDir) {
  const files = walkJs(path.join(rootDir, ELECTRON_DIR), []);
  const regs = [];
  for (const file of files) {
    const rel = path.relative(rootDir, file).replace(/\\/g, '/');
    regs.push(...analyzeFile(file, rel));
  }
  return regs.sort((a, b) => (`${a.file}:${a.channel}`).localeCompare(`${b.file}:${b.channel}`));
}

/**
 * 归一化并校验豁免清单结构。
 * @returns {{entries:Array, errors:string[]}}
 */
function normalizeExemptions(raw, sourceName) {
  const errors = [];
  const entries = Array.isArray(raw && raw.entries) ? raw.entries : [];
  const seen = new Set();
  entries.forEach((e, idx) => {
    const where = `${sourceName} entries[${idx}]`;
    if (!e || typeof e.channel !== 'string' || !e.channel) {
      errors.push(`${where}: 缺少 channel`);
      return;
    }
    if (seen.has(e.channel)) errors.push(`${where}: 通道 ${e.channel} 重复登记`);
    seen.add(e.channel);
    for (const field of ['risk', 'reason', 'owner']) {
      if (typeof e[field] !== 'string' || !e[field].trim()) {
        errors.push(`${where} (${e.channel}): 缺少 ${field}`);
      }
    }
  });
  return { entries, errors };
}

/**
 * 门禁判定（纯函数，便于单测注入内存中的注册点列表）。
 * @param {Array} regs
 * @param {{entries:Array, minGuardedRatio?:number}} exemptions
 */
function evaluate(regs, exemptions) {
  const errors = [];
  const warnings = [];
  const explicit = regs.filter((r) => r.via === 'explicit');
  const ratio = regs.length ? explicit.length / regs.length : 1;

  const exemptMap = new Map();
  for (const e of ((exemptions && exemptions.entries) || [])) {
    if (e && typeof e.channel === 'string') exemptMap.set(e.channel, e);
  }
  const needExempt = regs.filter((r) => r.via === 'unknown');
  const syncUnguarded = regs.filter((r) => r.via === 'sync-unguarded');
  const exemptedChannels = new Set(
    [...needExempt, ...syncUnguarded].filter((r) => exemptMap.has(r.channel)).map((r) => r.channel),
  );

  const missing = [...needExempt, ...syncUnguarded].filter((r) => !exemptMap.has(r.channel));
  if (missing.length) {
    errors.push(`发现 ${missing.length} 个未登记的守卫不可判定注册点（须补 withSenderCheck 或显式豁免）:`);
    for (const r of missing.slice(0, 40)) errors.push(`    ${r.channel}  ${r.file}:${r.line} via=${r.via} method=${r.method}`);
    if (missing.length > 40) errors.push(`    …… 其余 ${missing.length - 40} 条略`);
  }
  if (syncUnguarded.filter((r) => !exemptMap.has(r.channel)).length) {
    errors.push(`其中 ${syncUnguarded.filter((r) => !exemptMap.has(r.channel)).length} 个为 ipcMain.on 同步通道：` +
      `createAccessControlledIpcMain 的 Proxy 只包装 handle，同步通道必须自己调 isTrustedSender/withSenderCheck`);
  }

  const stale = [...exemptMap.keys()].filter((ch) => !exemptedChannels.has(ch));
  if (stale.length) {
    errors.push(`豁免清单存在 ${stale.length} 条陈旧条目（已补守卫或通道已删除，请删除条目）:`);
    for (const ch of stale) errors.push(`    ${ch}`);
  }

  // 硬错误：绕过权限层的写法，不接受任何豁免
  const globalRegs = regs.filter((r) => r.via === 'global');
  if (globalRegs.length) {
    errors.push(`发现 ${globalRegs.length} 个注册点直接落在 require('electron') 的全局 ipcMain 上` +
      `（绕过 createAccessControlledIpcMain 的来源校验与许可证门禁，不可豁免）:`);
    for (const r of globalRegs.slice(0, 40)) errors.push(`    ${r.channel}  ${r.file}:${r.line} receiver=${r.receiver}`);
    if (globalRegs.length > 40) errors.push(`    …… 其余 ${globalRegs.length - 40} 条略`);
  }
  const fallbackRegs = regs.filter((r) => r.via === 'fallback');
  if (fallbackRegs.length) {
    errors.push(`发现 ${fallbackRegs.length} 个注册点位于"` +
      `injectedIpcMain || require('electron').ipcMain` +
      `"回退文件中（漏注入即静默绕过权限层，必须改为未注入即抛错，不可豁免）:`);
    for (const r of [...new Set(fallbackRegs.map((x) => `${x.file}`))]) errors.push(`    ${r}`);
  }

  // 同一通道重复注册且守卫状态不一致：后注册者覆盖前者
  const byChannel = new Map();
  for (const r of regs) {
    // handle 与 on 可以共用通道名（一边回值、一边单向），只比较同一方法的重复注册
    const key = `${r.method}:${r.channel}`;
    if (!byChannel.has(key)) byChannel.set(key, []);
    byChannel.get(key).push(r);
  }
  for (const [key, list] of byChannel) {
    if (list.length < 2) continue;
    const states = new Set(list.map((r) => r.via));
    if (states.size > 1) {
      const loc = list.map((r) => `${r.file}:${r.line}(${r.via})`).join(' vs ');
      errors.push(`通道 ${key} 重复注册且守卫状态不一致，后者会覆盖前者: ${loc}`);
    } else {
      warnings.push(`通道 ${key} 注册 ${list.length} 次（后者覆盖前者），建议去重`);
    }
  }

  const minRatio = Number(exemptions && exemptions.minGuardedRatio);
  if (Number.isFinite(minRatio) && ratio < minRatio) {
    errors.push(`显式守卫占比 ${(ratio * 100).toFixed(1)}% 低于门禁阈值 ${(minRatio * 100).toFixed(1)}%`);
  }

  return {
    ok: errors.length === 0,
    total: regs.length,
    explicit: explicit.length,
    injected: regs.filter((r) => r.via === 'injected').length,
    unknown: needExempt.length,
    bypass: globalRegs.length + fallbackRegs.length,
    uniqueChannels: byChannel.size,
    sync: syncUnguarded.length,
    handle: regs.filter((r) => (r.method || 'handle') === 'handle').length,
    ratio,
    minRatio: Number.isFinite(minRatio) ? minRatio : null,
    errors,
    warnings,
  };
}

function parseCli(argv) {
  const opts = { json: false, list: false, baseDir: DEFAULT_BASE_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--list-unguarded' || a === '--list') opts.list = true;
    else if (a === '--base-dir') opts.baseDir = path.resolve(argv[++i]);
    else if (a === '--min-ratio') opts.minRatioOverride = Number(argv[++i]);
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

function run(rootDir, { minRatioOverride } = {}) {
  const regs = collectRegistrations(rootDir);
  const exPath = path.join(rootDir, EXEMPTIONS_REL);
  const structErrors = [];
  let exemptions = { entries: [], minGuardedRatio: undefined };
  if (fs.existsSync(exPath)) {
    const raw = JSON.parse(fs.readFileSync(exPath, 'utf8'));
    const parsed = normalizeExemptions(raw, path.basename(exPath));
    exemptions = {
      entries: parsed.entries,
      minGuardedRatio: Number.isFinite(minRatioOverride) ? minRatioOverride : raw.minGuardedRatio,
    };
    structErrors.push(...parsed.errors);
  } else {
    structErrors.push(`缺少豁免清单: ${path.relative(process.cwd(), exPath)}`);
  }
  const result = evaluate(regs, exemptions);
  result.errors = [...structErrors, ...result.errors];
  if (structErrors.length) result.ok = false;
  return { result, regs };
}

function main(argv) {
  const opts = parseCli(argv);
  if (opts.help) {
    console.log('用法: node check-ipc-sender-guard.js [--json] [--list-unguarded] [--base-dir <apps/desktop>] [--min-ratio <0..1>]');
    return 0;
  }
  const { result, regs } = run(opts.baseDir, { minRatioOverride: opts.minRatioOverride });

  if (opts.json) {
    console.log(JSON.stringify({
      ...result,
      registrations: regs,
    }, null, 2));
  } else {
    console.log('');
    console.log('=== IPC sender 守卫覆盖检查 (P1-14) ===');
    console.log('');
    console.log(`  注册点: ${result.total}（handle ${result.handle} / 同步 on ${result.total - result.handle}，唯一通道 ${result.uniqueChannels}）`);
    console.log(`  显式守卫: ${result.explicit}  咽喉点注入: ${result.injected}  不可判定: ${result.unknown}  绕过: ${result.bypass}`);
    console.log(`  显式守卫占比: ${(result.ratio * 100).toFixed(1)}%` +
      (result.minRatio !== null && result.minRatio !== undefined ? `（门禁 >= ${(result.minRatio * 100).toFixed(1)}%）` : ''));
    console.log('');
    if (result.warnings.length) {
      console.log('  [WARN]');
      result.warnings.forEach((w) => console.log('    ' + w));
      console.log('');
    }
    if (result.errors.length) {
      console.log('  [ERROR]');
      result.errors.forEach((e) => console.log(e.startsWith('    ') ? e : `    ${e}`));
      console.log('');
    }
    if (opts.list) {
      const weak = regs.filter((r) => r.via !== 'explicit' && r.via !== 'injected');
      console.log(`  非显式守卫清单（${weak.length}）:`);
      weak.forEach((r) => console.log(`    ${r.channel}  ${r.file}:${r.line} via=${r.via} method=${r.method}`));
      console.log('');
    }
    console.log(result.ok ? '  PASS - 口径一致、无绕过路径、豁免清单无漂移' : '  FAIL');
    console.log('');
  }
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  isProductionSourceFile,
  buildProtectedMask,
  splitCallArgs,
  channelLabel,
  isExplicitlyGuarded,
  analyzeFile,
  collectRegistrations,
  normalizeExemptions,
  evaluate,
  run,
};
