const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { findViolations, isExcluded, parseArgs, PATTERNS, mergeBaseline, evaluateBaseline, domainStats, assertDomainHealthy, scopeBucket, ROOTS, OPS_SRC_ROOT, DOMAIN_FLOORS } = require('./check-frontend-consistency');
const GATE_SRC = fs.readFileSync(path.join(__dirname, 'check-frontend-consistency.js'), 'utf8').replace(/\r/g, '');

function makeTmpSrc (files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-consistency-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

test('检出视图中的 window.confirm 违规', () => {
  const src = makeTmpSrc({
    'views/Demo.vue': '<script>\nexport default {\n  methods: {\n    del() { if (window.confirm( "sure" )) this.remove(); }\n  }\n}\n</script>\n',
  });
  const result = findViolations(src);
  assert.equal(result.windowConfirm.length, 1);
  assert.match(result.windowConfirm[0].file, /views\/Demo\.vue$/);
  assert.equal(result.windowConfirm[0].line, 4);
});

test('检出 composable 中直调 window.electronAPI 违规', () => {
  const src = makeTmpSrc({
    'composables/useDemo.js': 'export function useDemo() {\n  return window.electronAPI.storeList()\n}\n',
  });
  const result = findViolations(src);
  assert.equal(result.rendererIpcDirect.length, 1);
  assert.equal(result.rendererIpcDirect[0].line, 2);
});

test('干净文件零违规', () => {
  const src = makeTmpSrc({
    'views/Clean.vue': '<template><el-button @click="onDel">删除</el-button></template>\n<script>\nimport { ElMessageBox } from \'element-plus\'\nimport { deleteRecord } from \'@/api/publisher\'\nexport default { methods: { async onDel() { await ElMessageBox.confirm(\'确认删除?\'); await deleteRecord() } } }\n</script>\n',
    'api/bridge.js': 'export const invoke = (ch, payload) => window.electronAPI.invoke(ch, payload)\n',
  });
  const result = findViolations(src);
  assert.equal(result.windowConfirm.length, 0);
  // api/ 目录不在扫描范围（白名单桥接层）
  assert.equal(result.rendererIpcDirect.length, 0);
});

test('测试文件与 __tests__ 目录被排除', () => {
  assert.equal(isExcluded('views/PublishHistory.test.js'), true);
  assert.equal(isExcluded('components/__tests__/x.js'), true);
  assert.equal(isExcluded('views/PublishHistory.vue'), false);
});

test('parseArgs 拒绝未知选项', () => {
  assert.throws(() => parseArgs(['--bogus']), /unknown option/);
  assert.deepEqual(parseArgs(['--json']).json, true);
});

test('src 根入口文件（App.vue/main.js）纳入扫描', () => {
  const src = makeTmpSrc({
    'App.vue': '<script>\nconst api = window.electronAPI\n</script>\n<template><div /></template>\n',
    'main.js': 'if (window.electronAPI?.logError) window.electronAPI.logError(e)\n',
    'views/Ok.vue': '<template><div /></template>\n',
  });
  const result = findViolations(src);
  // 口径（批次 0 收紧）：按**消费点**逐次计数 —— main.js 那一行有 2 处引用即计 2
  // （旧实现按行计 1）。生产基线 windowConfirm/rendererIpcDirect 均为 0，收紧不改变判定。
  assert.equal(result.rendererIpcDirect.length, 3); // App.vue 1 + main.js 2
});

test('注释行不计违规，行内代码仍计入', () => {
  const src = makeTmpSrc({
    'composables/useDoc.js': [
      '// 通过 window.electronAPI 调用（注释不计数）',
      ' * window.confirm 的 JSDoc 续行也不计数',
      '/* block window.electronAPI */',
      '<!-- html comment window.electronAPI -->',
      'export const x = 1 // trailing window.confirm( 仍计数',
    ].join('\n'),
  });
  const result = findViolations(src);
  assert.equal(result.rendererIpcDirect.length, 0);
  assert.equal(result.windowConfirm.length, 1);
});

test('PATTERNS 覆盖四个契约维度，且每个维度显式声明扫描根', () => {
  assert.deepEqual(Object.keys(PATTERNS).sort(), ['appleAlias', 'opsElectronApi', 'rendererIpcDirect', 'windowConfirm']);
  // roots 必须**显式写在每条规则上**：靠"缺省=desktop"的隐式约定，下一个会话加一条规则时
  // 会以为它自动覆盖两个应用，而它其实只扫了桌面端 —— 那是"扩了域但只有名字扩了"。
  for (const [key, p] of Object.entries(PATTERNS)) {
    assert.ok(Array.isArray(p.roots) && p.roots.length > 0, `${key} 必须显式声明 roots`);
    for (const r of p.roots) assert.ok(['desktop', 'ops'].includes(r), `${key} 的根 ${r} 未注册`);
  }
  assert.deepEqual(PATTERNS.windowConfirm.roots.slice().sort(), ['desktop', 'ops']);
  assert.deepEqual(PATTERNS.opsElectronApi.roots, ['ops']);
  assert.deepEqual(PATTERNS.rendererIpcDirect.roots, ['desktop']);
  assert.deepEqual(PATTERNS.appleAlias.roots, ['desktop']);
  // ops 侧必须走全域遍历：RENDERER_DIRS 是桌面端目录名，套到 ops 会漏掉 api/ config/ constants/
  assert.equal(PATTERNS.windowConfirm.scopeByRoot.ops, 'anySrc');
});

// ---- 批次 6：别名层退役后的「钉 0」锁 ----

test('别名回潮门禁基线必须钉在 0（任何新增 var(--apple- 引用都应立即 CI 失败）', () => {
  const baseline = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'frontend-consistency-baseline.json'), 'utf8'),
  );
  assert.equal(
    baseline.appleAlias,
    0,
    '批次 6 起 appleAlias 基线必须为 0：抬高基线等于给别名层回潮开后门（门禁语义 = 命中数必须为 0）',
  );
});

// ---- 批次 0：别名回潮门禁（ui-apple-token-retirement）----

test('appleAlias：检出 CSS 中的 var(--apple- 消费（含文件与行号）', () => {
  const src = makeTmpSrc({
    'styles/history-page.css': 'a {\n  color: var(--apple-accent);\n}\n',
  });
  const result = findViolations(src);
  assert.equal(result.appleAlias.length, 1);
  assert.match(result.appleAlias[0].file, /styles\/history-page\.css$/);
  assert.equal(result.appleAlias[0].line, 2);
});

test('appleAlias：按消费点计数（同一行 2 次算 2 处）', () => {
  const src = makeTmpSrc({
    'components/UiButton.vue': [
      '<style scoped>',
      '.ui-btn-primary {',
      '  background: var(--apple-accent);',
      '  border-color: var(--apple-accent, #007aff);',
      '}',
      '.ui-btn-secondary { background: var(--apple-surface-primary); color: var(--apple-text-primary) }',
      '</style>',
    ].join('\n'),
  });
  const result = findViolations(src);
  assert.equal(result.appleAlias.length, 4); // 1 + 1 + 2（同一行两处）
  assert.deepEqual(result.appleAlias.map((v) => v.line), [3, 4, 6, 6]);
});

test('appleAlias：CSS 注释不计（块注释；CSS 里 // * <!-- 不是注释）', () => {
  const src = makeTmpSrc({
    'styles/x.css': [
      '/* var(--apple-accent) 待退役 */',
      '.a { color: var(--apple-accent) } /* trailing 仍计数 */',
    ].join('\n'),
  });
  const result = findViolations(src);
  assert.equal(result.appleAlias.length, 1);
  assert.equal(result.appleAlias[0].line, 2);
});

test('appleAlias：.vue/.js 的 // 与 JSDoc 续行不计，行内尾注释仍计入', () => {
  const src = makeTmpSrc({
    'components/Demo.vue': [
      '<style scoped>',
      '// var(--apple-accent) 行注释',
      '/* var(--apple-accent) 块注释 */',
      '/*',
      ' * var(--apple-accent) JSDoc 续行',
      ' */',
      '.x { color: var(--apple-surface-primary) } /* trailing 仍计数 */',
      '</style>',
    ].join('\n'),
  });
  const result = findViolations(src);
  assert.equal(result.appleAlias.length, 1);
  assert.equal(result.appleAlias[0].line, 7);
});

test('appleAlias：注释在前、代码在同一行必须仍被检出（批次 0 反证暴露的盲区）', () => {
  const src = makeTmpSrc({
    'styles/y.css': '/* 说明 */ .a { color: var(--apple-accent) }\n',
  });
  const result = findViolations(src);
  assert.equal(result.appleAlias.length, 1);
  assert.equal(result.appleAlias[0].line, 1);
});

test('appleAlias：跨行块注释内的 var(--apple- 不计', () => {
  const src = makeTmpSrc({
    'styles/z.css': [
      '/*',
      '  var(--apple-accent) 在块注释内部',
      '*/',
      '.a { color: var(--apple-surface-primary) }',
    ].join('\n'),
  });
  const result = findViolations(src);
  assert.equal(result.appleAlias.length, 1);
  assert.equal(result.appleAlias[0].line, 4);
});

test('appleAlias：测试文件与 __tests__ 目录被排除', () => {
  const src = makeTmpSrc({
    'styles/x.test.css': 'a { color: var(--apple-accent) }\n',
    'components/__tests__/y.vue': '<style>a{color:var(--apple-accent)}</style>\n',
  });
  const result = findViolations(src);
  assert.equal(result.appleAlias.length, 0);
});

test('新增扫描面不放宽既有两模式的判定（CSS 不进入渲染层扫描面）', () => {
  const src = makeTmpSrc({
    'styles/legacy.css': '/* window.confirm( 与 window.electronAPI 在样式里只是注释提及 */\n',
    'views/Ok.vue': '<template><div /></template>\n',
  });
  const result = findViolations(src);
  assert.equal(result.windowConfirm.length, 0);
  assert.equal(result.rendererIpcDirect.length, 0);
});

test('共享基线写入必须保留他方键（check-color-literals / check-css-var-defined 同文件）', () => {
  const old = { windowConfirm: 0, rendererIpcDirect: 0, colorLiterals: 129, cssVarUndefined: 64 };
  const merged = mergeBaseline(old, { windowConfirm: 0, rendererIpcDirect: 0, appleAlias: 339 });
  assert.deepEqual(merged, {
    windowConfirm: 0,
    rendererIpcDirect: 0,
    colorLiterals: 129,
    cssVarUndefined: 64,
    appleAlias: 339,
  });
});

test('共享基线写入：他方键在旧基线缺失时不得凭空补 0（避免掩盖配置错误）', () => {
  const merged = mergeBaseline({ windowConfirm: 1 }, { windowConfirm: 0, appleAlias: 5 });
  assert.deepEqual(merged, { windowConfirm: 0, appleAlias: 5 });
});

test('基线缺键必须 fail-closed（不得因 undefined 比较而静默放行）', () => {
  const failures = evaluateBaseline(
    { windowConfirm: 0, rendererIpcDirect: 0, appleAlias: 339 },
    { windowConfirm: 0, rendererIpcDirect: 0, opsElectronApi: 0 }, // 缺 appleAlias
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /appleAlias/);
  assert.match(failures[0], /基线缺少/);
});

test('基线判定：等于基线通过，超出基线失败', () => {
  const full = { windowConfirm: 0, rendererIpcDirect: 0, opsElectronApi: 0, appleAlias: 339 };
  assert.deepEqual(evaluateBaseline(full, { ...full }), []);
  const over = evaluateBaseline({ ...full, appleAlias: 340 }, { ...full });
  assert.equal(over.length, 1);
  assert.match(over[0], /340 处 > 基线 339 处/);
});

// ==================== UX 审计 5.1/5.2：ops-center 纳入扫描域 ====================

function makeRoot (files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-root-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const TMP_CLEAN_OPS = makeRoot({ 'views/Keep.vue': '<template><p>ok</p></template>\n' });

test('跨根检测：ops 侧的原生 window.confirm 必须被同一条规则命中，且路径前缀是 ops 自己的根', () => {
  const d = makeRoot({ 'views/Desk.vue': '<script>\nwindow.confirm("x")\n</script>\n' });
  const o = makeRoot({ 'views/Workbench.vue': '<script>\nasync function del() {\n  if (!window.confirm(\'确认删除？\')) return\n}\n</script>\n' });
  const r = findViolations(d, o);
  assert.equal(r.windowConfirm.length, 2, '两个根各 1 处');
  const files = r.windowConfirm.map((v) => v.file).sort();
  assert.match(files[0], /^apps\/desktop\/src\/views\//, '桌面端命中必须带桌面端前缀');
  assert.match(files[1], /^ops-center\/frontend\/src\/views\//, 'ops 命中必须带 ops 前缀（写死前缀会让门禁点出一个不存在的位置）');
  assert.equal(r.windowConfirm.filter((v) => v.root === 'ops').length, 1);
  assert.equal(r.windowConfirm.find((v) => v.root === 'ops').line, 3);
});

test('scope 缓存必须按 (根, scope) 分键：两根同名 scope 共用一条缓存 = 第二个根根本没被扫', () => {
  // 反证 FC-M2 实测暴露：只让两根走**不同** scope 的夹具，对"缓存键少了 rootId"结构性免疫
  // （不同字符串本来就不相撞）。所以这里必须强制两根走同一个 scope 字面量。
  const savedByRoot = PATTERNS.windowConfirm.scopeByRoot;
  try {
    PATTERNS.windowConfirm.scopeByRoot = {}; // 两根都按 scope='renderer' 取清单 ⇒ 键相撞才会现形
    const d = makeRoot({ 'views/A.vue': 'window.confirm("a")\n' });
    const o = makeRoot({ 'views/B.vue': 'window.confirm("b")\n' });
    const r = findViolations(d, o);
    assert.equal(r.windowConfirm.length, 2, '实现若共用 scope 单键，第二个根会读到第一个根的清单 ⇒ 计数变成 1');
    assert.deepEqual(r.windowConfirm.map((v) => v.root).sort(), ['desktop', 'ops']);
    assert.deepEqual(r.windowConfirm.map((v) => v.file.split('/views/')[1]).sort(), ['A.vue', 'B.vue']);
  } finally {
    PATTERNS.windowConfirm.scopeByRoot = savedByRoot;
  }
});

test('domainStats 的读数必须等于非缓存路径的 ground truth（缓存串台会把 A 根的数量报给 B 根）', () => {
  const { listAllSrcFiles } = require('./check-frontend-consistency');
  const stats = domainStats();
  const byRoot = {};
  for (const s of stats) byRoot[s.root] = s;
  for (const s of stats) {
    assert.equal(s.anySrc, listAllSrcFiles(s.dir).length, s.root + ' 的 anySrc 读数必须等于独立遍历的结果');
  }
  // 两个应用的规模差得很远：读数相等就是串台的形状（本仓实测 ops 83 对 desktop 540）。
  assert.ok(byRoot.ops.anySrc < byRoot.desktop.anySrc,
    'ops(' + byRoot.ops.anySrc + ') 必须小于 desktop(' + byRoot.desktop.anySrc + ') —— 相等说明两根读到同一份清单');
  assert.ok(byRoot.ops.renderer < byRoot.desktop.renderer, 'renderer 桶同样不得串台');
});

test('ops 侧域是全域遍历：api/ config/ constants/ 这些 RENDERER_DIRS 覆盖不到的目录必须被看见', () => {
  const d = makeRoot({ 'views/Keep.vue': '<p>clean</p>\n' });
  const o = makeRoot({
    'api/http.js': 'export const ask = () => window.confirm("api 目录")\n',
    'config/flags.js': 'window.confirm("config 目录")\n',
    'constants/labels.js': 'window.confirm("constants 目录")\n',
  });
  const r = findViolations(d, o);
  assert.equal(r.windowConfirm.length, 3, 'ops 用桌面端的 RENDERER_DIRS 会一个都扫不到（api/config/constants 不在表里）');
});

test('反向边界：ops 引用 window.electronAPI 命中 opsElectronApi，桌面端引用不得命中它', () => {
  const d = makeRoot({
    'views/Electron.vue': '<script>\nwindow.electronAPI.storeList()\nwindow.confirm("d")\n</script>\n',
    'api/bridge.js': 'export const invoke = (c) => window.electronAPI.invoke(c)\n',
  });
  const o = makeRoot({ 'views/Copied.vue': 'export function x() {\n  return window.electronAPI.foo()\n}\n' });
  const r = findViolations(d, o);
  assert.equal(r.opsElectronApi.length, 1, '桌面端的 electronAPI 引用不得进 ops 的规则');
  assert.match(r.opsElectronApi[0].file, /^ops-center\/frontend\/src\/views\/Copied\.vue$/);
  assert.equal(r.rendererIpcDirect.length, 1, '桌面端 views/ 那处仍由 rendererIpcDirect 负责（api/ 是白名单桥接层，不计）');
  assert.match(r.rendererIpcDirect[0].file, /^apps\/desktop\/src\/views\/Electron\.vue$/);
});

test('规则不得越根：appleAlias（桌面端 tokens.css 专属）在 ops 里出现 var(--apple-) 不得被命中', () => {
  const d = makeRoot({ 'views/Keep.vue': '<p>clean</p>\n' });
  const o = makeRoot({ 'styles/x.css': '.a { color: var(--apple-accent); }\n' });
  const r = findViolations(d, o);
  assert.equal(r.appleAlias.length, 0, '把桌面端资产规则套到 ops 只会造出语义错配、既不可修也不可解释的"存量"');
});

test('未注册扫描根必须抛错，不得静默当成"这个根没东西"', () => {
  const saved = PATTERNS.opsElectronApi.roots;
  try {
    PATTERNS.opsElectronApi.roots = ['nope'];
    assert.throws(() => findViolations(TMP_CLEAN_OPS, TMP_CLEAN_OPS), /未知扫描根/);
  } finally {
    PATTERNS.opsElectronApi.roots = saved;
  }
});

// ---- 域健康守卫（扩域最常见的失败形态是"路径写错 ⇒ 0 文件 ⇒ 0 违规 ⇒ 读成通过"）----

test('域健康：根不存在 / 域为空 / 域塌方 三种失明都必须出声', () => {
  assert.deepEqual(assertDomainHealthy([{ root: 'ghost', dir: '/nope', exists: false, renderer: 0, anySrc: 0 }]), [
    '扫描根不存在：ghost → /nope',
  ]);
  const emptyOps = [
    { root: 'desktop', dir: '/d', exists: true, renderer: 400, anySrc: 600 },
    { root: 'ops', dir: '/o', exists: true, renderer: 0, anySrc: 0 },
  ];
  const errs = assertDomainHealthy(emptyOps, {});
  assert.equal(errs.length, 1, '只应报 ops 那条（未被消费的 ops:renderer 不得报错）');
  assert.match(errs[0], /域为空：ops:anySrc/);
  const shrunk = assertDomainHealthy([
    { root: 'desktop', dir: '/d', exists: true, renderer: 3, anySrc: 600 },
    { root: 'ops', dir: '/o', exists: true, renderer: 54, anySrc: 83 },
  ], { 'desktop:renderer': 200 });
  assert.match(shrunk.join('|'), /域塌方：desktop:renderer 只扫到 3 个文件，低于下界 200/);
});

test('域健康：真实仓两根都必须被看见，且读数不低于登记的下界', () => {
  const stats = domainStats();
  assert.equal(stats.length, 2, '扫描根清单变成 ' + stats.length + ' 条 —— 结构锁需同步');
  assert.deepEqual(stats.map((s) => s.root), ['desktop', 'ops']);
  assert.deepEqual(Object.keys(DOMAIN_FLOORS).sort(), ['desktop:anySrc', 'desktop:renderer', 'ops:anySrc']);
  // 下界的键必须与"被消费的 (根,scope)"同集，否则要么有死配置，要么有没人守的域。
  const consumed = [];
  for (const p of Object.values(PATTERNS)) {
    for (const rid of p.roots || []) consumed.push(rid + ':' + scopeBucket((p.scopeByRoot || {})[rid] || p.scope || 'renderer'));
  }
  assert.deepEqual(Array.from(new Set(consumed)).sort(), Object.keys(DOMAIN_FLOORS).sort());
  assert.deepEqual(assertDomainHealthy(stats), []);
  for (const s of stats) {
    assert.ok(s.exists, s.root + ' 根必须存在：' + s.dir);
    assert.ok(s.anySrc > 0, s.root + ' 全域读数必须 > 0');
  }
  const ops = stats.find((s) => s.root === 'ops');
  assert.ok(ops.anySrc >= 60, 'ops 域实测 83 个文件，读数低于 60 说明目录被搬或遍历器换形态');
});

test('真实仓双根现场：main 必须显式传两个根；默认第二参数为 null（防单测读宿主状态）', () => {
  assert.match(GATE_SRC, /findViolations \(srcRoot = SRC_ROOT, opsSrcRoot = null\)/, '默认必须不读真实 ops 目录');
  assert.match(GATE_SRC, /findViolations\(SRC_ROOT, OPS_SRC_ROOT\)/, 'main 必须两个根都传，否则扩域只在测试里成立');
  assert.match(GATE_SRC, /domainStats\(\)/, 'main 必须做域健康检查');
  assert.match(GATE_SRC, /process\.exit\(2\)/, '自身故障必须走退出码 2，不得与"发现违规"的 1 混档');
  const r = findViolations(ROOTS[0].dir, OPS_SRC_ROOT);
  for (const key of Object.keys(PATTERNS)) {
    assert.ok(Array.isArray(r[key]), key + ' 必须返回数组');
  }
});

test('本批修复落点：PromptEvalWorkbench 的删除入口不得再有原生 confirm，且必须有取消与失败两条出口', () => {
  const p = path.join(ROOTS[1].dir, 'views', 'PromptEvalWorkbench.vue');
  assert.ok(fs.existsSync(p), 'ops 根路径解析失败：' + p);
  const src = fs.readFileSync(p, 'utf8').replace(/\r/g, '');
  assert.doesNotMatch(src, /window\.confirm\s*\(/, '原生确认框必须已被替换');
  assert.match(src, /import \{ ElMessageBox \} from 'element-plus'/, '必须按本应用既有风格显式引入');
  assert.match(src, /await ElMessageBox\.confirm\(/, '删除必须等确认结果');
  assert.match(src, /\} catch \{\s*\n\s*return\s*\n {2}\}/, '取消必须"什么都不做"（fail-closed）');
  assert.match(src, /删除失败/, '删除调用本身必须有失败出口（原生 confirm 那版完全没有）');
});
