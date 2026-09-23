'use strict';
/* eslint-disable no-console */
/**
 * check-ipc-sender-guard.js 的契约测试（P1-14 / QM-5 回归保护）
 *
 * 覆盖三类必须成立的事实：
 *  1) 分类正确：explicit / injected（形参与局部别名）/ global / fallback / unknown，
 *     且注释与字符串里的 ipcMain.handle 不算注册点（体检报告口径失真的根因之一）。
 *  2) 双校验不可被绕过：未登记 unknown 失败、登记了但不再需要（陈旧条目）同样失败、
 *     global/fallback 即使登记豁免也失败、显式守卫占比低于阈值失败。
 *  3) 同通道重复注册且守卫状态不一致 → 失败（Electron 后注册覆盖前者）。
 *
 * 运行：node --test .github/scripts/check-ipc-sender-guard.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scriptPath = path.join(__dirname, 'check-ipc-sender-guard.js');
const guard = require(scriptPath);

/** 把一段源码写成临时 electron 目录下的文件，返回 {rootDir, filePath, relPath} */
function fixture(name, source) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-guard-'));
  const filePath = path.join(rootDir, 'electron', name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source, 'utf8');
  return { rootDir, filePath, relPath: path.posix.join('electron', name) };
}

function analyze(name, source) {
  const { filePath, relPath } = fixture(name, source);
  return guard.analyzeFile(filePath, relPath);
}

const okExemptions = { entries: [], minGuardedRatio: 0 };

test('分类：withSenderCheck 判为 explicit，裸 ipcMain 形参判为 injected', () => {
  const regs = analyze('a.js', [
    'function register (ipcMain) {',
    "  ipcMain.handle('a:guarded', withSenderCheck(async (e) => e));",
    "  ipcMain.handle('a/plain', async (e) => e);",
    '}',
  ].join('\n'));
  assert.equal(regs.length, 2);
  assert.equal(regs.find((r) => r.channel === 'a:guarded').via, 'explicit');
  assert.equal(regs.find((r) => r.channel === 'a/plain').via, 'injected');
});

test('分类：const ipcMain = injectedIpcMain 局部别名仍属咽喉点覆盖', () => {
  // P1-14 修复后的 10 个 service 就是这个写法，误判为 unknown 会让门禁形同虚设
  const regs = analyze('b.js', [
    'class S {',
    '  registerIpcHandlers (injectedIpcMain) {',
    '    if (!injectedIpcMain) throw new Error("need injected");',
    '    const ipcMain = injectedIpcMain;',
    "    ipcMain.handle('b:one', async (e) => e);",
    '  }',
    '}',
  ].join('\n'));
  assert.equal(regs.length, 1);
  assert.equal(regs[0].via, 'injected');
});

test('分类：接收者解析到 require("electron") 的全局 ipcMain → global（不可豁免）', () => {
  const regs = analyze('c.js', [
    "const { ipcMain } = require('electron');",
    "ipcMain.handle('c:raw', async (e) => e);",
  ].join('\n'));
  assert.equal(regs.length, 1);
  assert.equal(regs[0].via, 'global');
  const res = guard.evaluate(regs, { entries: [{ channel: 'c:raw', risk: 'low', reason: 'x', owner: 'y' }], minGuardedRatio: 0 });
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /绕过 createAccessControlledIpcMain|全局 ipcMain/);
});

test('分类：injectedIpcMain || require("electron").ipcMain 回退写法 → fallback（不可豁免）', () => {
  const regs = analyze('d.js', [
    'function register (injectedIpcMain) {',
    "  const ipcMain = injectedIpcMain || require('electron').ipcMain;",
    "  ipcMain.handle('d:one', async (e) => e);",
    '}',
  ].join('\n'));
  assert.equal(regs.length, 1);
  assert.equal(regs[0].via, 'fallback');
  const res = guard.evaluate(regs, { entries: [{ channel: 'd:one', risk: 'low', reason: 'x', owner: 'y' }], minGuardedRatio: 0 });
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /回退文件|不可豁免/);
});

test('口径：注释与字符串里的 ipcMain.handle 不计为注册点', () => {
  const regs = analyze('e.js', [
    '/**',
    " * 用法示例：",
    " *   ipcMain.handle('fake:from-doc', withSenderCheck(fn))",
    ' */',
    'function register (ipcMain) {',
    "  const doc = 'ipcMain.handle(\"fake:from-string\", fn)';",
    "  ipcMain.handle('e:real', async (e) => e);",
    '  return doc;',
    '}',
  ].join('\n'));
  assert.deepEqual(regs.map((r) => r.channel), ['e:real']);
});

test('口径：动态通道名以 <expr:...> 摘要呈现，不静默丢弃', () => {
  const regs = analyze('f.js', [
    'function register (ipcMain) {',
    "  for (const ch of ['f:a', 'f:b']) ipcMain.handle(ch, async (e) => e);",
    '}',
  ].join('\n'));
  assert.equal(regs.length, 1);
  assert.match(regs[0].channel, /^<expr:/);
});

test('双校验：未登记的 unknown 注册点必须失败', () => {
  const regs = [{ channel: 'x:one', receiver: 'bus', via: 'unknown', file: 'electron/x.js', line: 1 }];
  const res = guard.evaluate(regs, okExemptions);
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /未登记/);
});

test('双校验：登记在册的 unknown 通过；通道被补守卫后条目变陈旧 → 仍失败', () => {
  const entry = { channel: 'x:one', risk: 'medium', reason: '动态接收者，已人工确认经授权代理注册', owner: 'desktop-sec' };
  const regs = [{ channel: 'x:one', receiver: 'bus', via: 'unknown', file: 'electron/x.js', line: 1 }];
  assert.equal(guard.evaluate(regs, { entries: [entry], minGuardedRatio: 0 }).ok, true);
  const fixed = [{ ...regs[0], via: 'explicit' }];
  const res = guard.evaluate(fixed, { entries: [entry], minGuardedRatio: 0 });
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /陈旧条目/);
});

test('比例式：显式守卫占比低于阈值 → 失败（防整体躺进咽喉点）', () => {
  const regs = [
    { channel: 'g:1', via: 'explicit', file: 'electron/g.js', line: 1 },
    { channel: 'g:2', via: 'injected', file: 'electron/g.js', line: 2 },
    { channel: 'g:3', via: 'injected', file: 'electron/g.js', line: 3 },
    { channel: 'g:4', via: 'injected', file: 'electron/g.js', line: 4 },
  ];
  const res = guard.evaluate(regs, { entries: [], minGuardedRatio: 0.5 });
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /低于门禁阈值/);
  assert.equal(guard.evaluate(regs, { entries: [], minGuardedRatio: 0.2 }).ok, true);
});

test('分类：ipcMain.on 同步通道不经 Proxy，未显式校验即 sync-unguarded', () => {
  // createAccessControlledIpcMain 的 Proxy 只拦截 handle，因此咽喉点对 on 无效
  const regs = analyze('s.js', [
    'function register (ipcMain) {',
    "  ipcMain.on('s:guarded', (event) => { if (!isTrustedSender(event, app)) return });",
    "  ipcMain.on('s:bare', (event, payload) => sideEffect(payload));",
    '}',
  ].join('\n'));
  assert.equal(regs.length, 2);
  assert.equal(regs.find((r) => r.channel === 's:guarded').via, 'explicit');
  const bare = regs.find((r) => r.channel === 's:bare');
  assert.equal(bare.via, 'sync-unguarded');
  assert.equal(bare.method, 'on');

  const res = guard.evaluate([bare], okExemptions);
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /同步通道/);
  // 登记豁免后通过，且通道补守卫后旧条目变陈旧
  const entry = { channel: 's:bare', risk: 'low', reason: '仅主进程内部发送，渲染端不可达', owner: 'desktop-sec' };
  assert.equal(guard.evaluate([bare], { entries: [entry], minGuardedRatio: 0 }).ok, true);
});

test('口径：非 ipcMain 接收者的 .on(...)（EventEmitter 等）不计入同步通道', () => {
  const regs = analyze('t.js', [
    "const { EventEmitter } = require('events');",
    'function register (bus, ipcMain) {',
    "  bus.on('t:event', () => {});",
    "  child.stdout.on('data', () => {});",
    "  ipcMain.handle('t:real', withSenderCheck(async (e) => e));",
    '}',
  ].join('\n'));
  assert.deepEqual(regs.map((r) => r.channel), ['t:real']);
});

test('同通道重复注册且守卫状态不一致 → 失败；状态一致仅告警', () => {
  const inconsistent = [
    { channel: 'h:1', via: 'explicit', file: 'electron/h.js', line: 1 },
    { channel: 'h:1', via: 'global', file: 'electron/h2.js', line: 1 },
  ];
  const res = guard.evaluate(inconsistent, okExemptions);
  assert.equal(res.ok, false);
  assert.match(res.errors.join('\n'), /重复注册且守卫状态不一致/);

  const consistent = [
    { channel: 'h:1', via: 'explicit', file: 'electron/h.js', line: 1 },
    { channel: 'h:1', via: 'explicit', file: 'electron/h2.js', line: 1 },
  ];
  const res2 = guard.evaluate(consistent, okExemptions);
  assert.equal(res2.ok, true);
  assert.ok(res2.warnings.length >= 1);
});

test('豁免清单结构校验：缺 channel/risk/reason/owner 与重复登记都会报错', () => {
  const { errors } = guard.normalizeExemptions({
    entries: [
      { risk: 'low', reason: 'x', owner: 'y' },
      { channel: 'i:1', risk: '  ', reason: 'x', owner: 'y' },
      { channel: 'i:2', risk: 'low', reason: 'x', owner: 'y' },
      { channel: 'i:2', risk: 'low', reason: 'x', owner: 'y' },
    ],
  }, 'exemptions.json');
  assert.equal(errors.length, 3, errors.join(' | '));
});

test('run()：缺失豁免清单文件本身即失败（防空清单被默认放行）', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-guard-run-'));
  fs.mkdirSync(path.join(rootDir, 'electron'), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, 'electron', 'k.js'),
    "function register (ipcMain) { ipcMain.handle('k:1', async (e) => e); }\n",
    'utf8',
  );
  const { result } = guard.run(rootDir);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /缺少豁免清单/);
});

test('真实仓库：electron 生产源码零 global/零 fallback 绕过', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const baseDir = path.join(repoRoot, 'apps', 'desktop');
  if (!fs.existsSync(baseDir)) return; // 允许在精简检出中跳过
  const { result } = guard.run(baseDir);
  assert.equal(result.bypass, 0, '禁止任何绕过受控 ipcMain 的注册点');
  assert.equal(result.unknown, 0, 'unknown 必须清零或登记豁免');
  assert.equal(result.ok, true, result.errors.join('\n'));
});
