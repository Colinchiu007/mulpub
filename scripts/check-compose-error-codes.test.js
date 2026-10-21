// @ts-check
/**
 * check-compose-error-codes.test.js — compose 稳定错误码一致性门禁的回归锁
 *
 * 锁三类行为（对应 2026-10-20 事故 error-message-user-friendly-audit 的三处漏改形态）：
 *   ① 删渲染端映射条目 → 必须红（否则新码静默回落英文原文）
 *   ② 删 locale 文案      → 必须红（否则渲染成 i18n key 原文）
 *   ③ 改文案占位符        → 必须红（否则渲染成 {sceneIndex} 空占位符）
 *   ④ 主进程删错误码常量  → 必须红（映射表出现陈旧条目）
 *
 * 变异方法：在临时副本目录里改文件后跑脚本，用 rc 与 stderr 断言。
 * 不用 PowerShell -replace 做变异——它会把 `{scene}` 写成 `\{scene\}` 造成假阴性
 * （本轮实测过一次：变异已应用但门禁 PASS，原因是变异本身没落地）。
 */
'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(__dirname, 'check-compose-error-codes.js')

const ENGINE_REL = path.join('apps', 'desktop', 'electron', 'services', 'story2video-compose-engine.js')
const MAP_REL = path.join('apps', 'desktop', 'src', 'views', 'history-utils.js')
const ZH_REL = path.join('apps', 'desktop', 'src', 'locales', 'story2video', 'zh.js')
const EN_REL = path.join('apps', 'desktop', 'src', 'locales', 'story2video', 'en.js')

/** 复制门禁依赖的四个文件到临时目录，保持相对结构；脚本本体放 scripts/ 子目录（与仓库同构） */
function makeSandbox () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-errcode-sandbox-'))
  for (const rel of [ENGINE_REL, MAP_REL, ZH_REL, EN_REL]) {
    const dest = path.join(root, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(ROOT, rel), dest)
  }
  // 脚本按 __dirname/.. 定位仓库根，故必须放在 <sandbox>/scripts/ 下，
  // 使 ROOT 解析回沙箱根而不是沙箱的父目录（本轮实测踩过：放沙箱根会连读四个文件都 ENOENT）。
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts', path.basename(SCRIPT)))
  return { root, script: path.join(root, 'scripts', path.basename(SCRIPT)) }
}

function runGate (sandbox) {
  try {
    const stdout = execFileSync(process.execPath, [sandbox.script], {
      cwd: sandbox.root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { rc: 0, stdout, stderr: '' }
  } catch (error) {
    return { rc: error.status, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') }
  }
}

function mutate (root, rel, replacer) {
  const file = path.join(root, rel)
  const before = fs.readFileSync(file, 'utf8')
  const after = replacer(before)
  assert.notStrictEqual(after, before, `变异未生效：${rel}（这会让测试变成假绿）`)
  fs.writeFileSync(file, after)
}

/**
 * 行首条目删除助手：匹配 `<换行(可含 \r)><缩进>KEY: '...',` 并整行删除。
 * 仓库文件是 CRLF，正则必须容忍 \r，否则「变异未生效」断言会把测试变成假绿。
 */
function dropLine (source, keyPattern) {
  const re = new RegExp(`(?:\\r?\\n)[ \\t]*${keyPattern}\\s*:\\s*'[^']*',`)
  return source.replace(re, '')
}

test('基线：四侧一致时门禁 PASS', () => {
  const sandbox = makeSandbox()
  try {
    const result = runGate(sandbox)
    assert.strictEqual(result.rc, 0, result.stderr)
    assert.match(result.stdout, /\[compose-error-codes\] PASS/)
  } finally {
    fs.rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('变异①：删渲染端映射条目 → FAIL 且点名该错误码', () => {
  const sandbox = makeSandbox()
  try {
    mutate(sandbox.root, MAP_REL, (s) => dropLine(s, 'COMPOSE_SCENE_AUDIO_UNREADABLE'))
    const result = runGate(sandbox)
    assert.strictEqual(result.rc, 1)
    assert.match(result.stderr, /COMPOSE_SCENE_AUDIO_UNREADABLE 未登记/)
  } finally {
    fs.rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('变异②：删 zh locale 文案 → FAIL 且点名缺失文件', () => {
  const sandbox = makeSandbox()
  try {
    mutate(sandbox.root, ZH_REL, (s) => dropLine(s, 'compose_scene_media_unreadable'))
    const result = runGate(sandbox)
    assert.strictEqual(result.rc, 1)
    assert.match(result.stderr, /compose_scene_media_unreadable 在 locales\/story2video\/zh\.js 缺失/)
  } finally {
    fs.rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('变异③：文案占位符主进程不提供 → FAIL 且点名占位符', () => {
  const sandbox = makeSandbox()
  try {
    mutate(sandbox.root, ZH_REL, (s) => s.replace('第 {scene} 个场景的画面素材', '第 {sceneIndex} 个场景的画面素材'))
    const result = runGate(sandbox)
    assert.strictEqual(result.rc, 1)
    assert.match(result.stderr, /\{sceneIndex\} 在主进程 messageParams 中未提供/)
  } finally {
    fs.rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('变异④：主进程删错误码常量 → FAIL 且报陈旧映射条目', () => {
  const sandbox = makeSandbox()
  try {
    mutate(sandbox.root, ENGINE_REL, (s) => dropLine(s, 'INPUT_SIZE_EXCEEDED'))
    const result = runGate(sandbox)
    assert.strictEqual(result.rc, 1)
    assert.match(result.stderr, /COMPOSE_INPUT_SIZE_EXCEEDED 在主进程 COMPOSE_ERROR_CODES 不存在/)
  } finally {
    fs.rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('变异⑤：删 en locale 文案（zh 仍在）→ FAIL，保证成对', () => {
  const sandbox = makeSandbox()
  try {
    mutate(sandbox.root, EN_REL, (s) => dropLine(s, 'compose_input_size_exceeded'))
    const result = runGate(sandbox)
    assert.strictEqual(result.rc, 1)
    assert.match(result.stderr, /compose_input_size_exceeded 在 locales\/story2video\/en\.js 缺失/)
  } finally {
    fs.rmSync(sandbox.root, { recursive: true, force: true })
  }
})

test('变异⑥：映射表整体消失 → FAIL（不得因找不到映射而静默通过）', () => {
  const sandbox = makeSandbox()
  try {
    mutate(sandbox.root, MAP_REL, (s) => s.replace(/export const COMPOSE_ERROR_KEY_MAP = Object\.freeze\(\{[\s\S]*?\n\}\)/, 'export const COMPOSE_ERROR_KEY_MAP = Object.freeze({\n})'))
    const result = runGate(sandbox)
    assert.strictEqual(result.rc, 1)
    assert.match(result.stderr, /未登记到 COMPOSE_ERROR_KEY_MAP/)
  } finally {
    fs.rmSync(sandbox.root, { recursive: true, force: true })
  }
})

/**
 * 变异⑦：第五侧 —— 渲染端硬编码了一个主进程不存在的码名 ⇒ FAIL。
 *
 * 动因（CCG 外部评审 i3）：`resolveMessageKey` 用 'COMPOSE_XXX' 字面量做分支判断，
 * 这些字面量不在「常量 / 映射表 / 文案」三侧之内。主进程改码名后若不同步改这里，
 * 三侧校验仍全绿，而该分支静默失效、用户又回落英文原文。
 * 本用例把「错码名必须被抓」变成机械断言；同时它也是第五侧的唯一正向反证
 * ——真实仓库里所有字面量都合法，不造错就永远不会红。
 */
test('变异⑦：渲染端硬编码了主进程不存在的码名 → FAIL（第五侧）', () => {
  const sandbox = makeSandbox()
  const rel = 'apps/desktop/src/story2video/story2video-notifications.js'
  const abs = path.join(sandbox.root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(
    abs,
    [
      'export function resolveMessageKey (notification) {',
      "  if (notification?.errorCode === 'COMPOSE_NOT_A_REAL_CODE') return 'story2video.compose_input_size_exceeded'",
      '  return null',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )
  try {
    const result = runGate(sandbox)
    assert.strictEqual(result.rc, 1, '第五侧没有抓住错码名')
    assert.match(result.stderr, /硬编码了 'COMPOSE_NOT_A_REAL_CODE'/)
  } finally {
    fs.rmSync(sandbox.root, { recursive: true, force: true })
  }
})

/**
 * 真实仓库：第五侧（渲染端硬编码字面量）必须真的被扫到。
 *
 * 第五侧对「扫描目标不存在」采取跳过策略（自测沙箱只造四份夹具，不复制整个渲染端目录）。
 * 跳过策略的代价是可能被「删掉文件」绕过，因此这里在真实仓库上把两条前提钉死：
 *   ① 清单里的文件必须存在；
 *   ② 它必须确实包含 'COMPOSE_*' 字面量（否则「扫到 0 条」与「扫了但没命中」同形，形同虚设）。
 * 本用例跑在真实仓库（`__dirname/..`），随 Gate 12g 的 `node --test` 一起执行。
 */
test('真实仓库：第五侧扫描目标存在且确实含 COMPOSE_* 字面量（防删文件逃逸）', () => {
  const root = path.join(__dirname, '..')
  const targets = ['apps/desktop/src/story2video/story2video-notifications.js']
  for (const rel of targets) {
    const abs = path.join(root, rel)
    assert.ok(fs.existsSync(abs), `第五侧扫描目标缺失：${rel} —— 删文件不能成为绕过路径`)
    const src = fs.readFileSync(abs, 'utf8')
    const literals = [...src.matchAll(/'((?:COMPOSE_)[A-Z0-9_]+)'/g)].map((m) => m[1])
    assert.ok(
      literals.length > 0,
      `${rel} 里没有 'COMPOSE_*' 字面量 —— 第五侧扫到 0 条与「扫了但没命中」在日志里同形，需要重新确认扫描目标`,
    )
  }
})
