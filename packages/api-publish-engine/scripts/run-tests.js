'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const VITEST_FILES = new Set([
  'adapters-interface.test.js',
  'api-router.test.js',
  'baijiahao-api-chain.test.js',
  'baijiahao-article-chain.test.js',
  'shipinhao-video-chain.test.js',
  'shipinhao-adapter.test.js',
  'bilibili-video-chain.test.js',
  'douyin-client-sign.test.js',
  'douyin-video-chain.test.js',
  'douyin-image-chain.test.js',
  'douyin-adapter.test.js',
  'douyin-legacy-chain-gate.test.js',
  'douyin-risk.test.js',
  'bilibili-upos.test.js',
  'cos-uploader.test.js',
  'e2e-publish-full-chain.test.js',
  'http-base.test.js',
  'kuaishou-ai-declaration.test.js',
  'kuaishou-video-chain.test.js',
  'kuaishou-adapter.test.js',
  'kuaishou-legacy-chain-gate.test.js',
  'oss-uploader.test.js',
  'publish-core.test.js',
  'publish-governance.test.js',
  'publish-mode-runner.test.js',
  'publish-mode-config.test.js',
  'risk-signals.test.js',
  'risk-suspender.test.js',
  'publish-service.test.js',
  'signer.test.js',
  'signer-local-xyw.test.js',
  'xiaohongshu-draft-chain.test.js',
  'xiaohongshu-adapter-load.test.js',
  'xiaohongshu-note-align.test.js',
  'xiaohongshu-note-inpage.test.js',
  'signer-default-path.test.js',
  'tiktok.test.js',
  'topic-inline-contract.test.js',
  'twitter.test.js',
  'youtube.test.js',
])

// 2026-10-07：同时扫 test/ 与 tests/。此前只扫单数 test/，
// 导致 tests/ 下的文件（小红书三项）从未被执行，却因列在 VITEST_FILES 里
// 被 check-unwired-tests 判为「已接线」而放行 —— 典型的假绿。
// 保留 testDirectory 显式传参的向后兼容：显式传入时只扫该目录。
function discoverTestFiles(testDirectory) {
  const base = path.resolve(__dirname, '..')
  const dirs = testDirectory
    ? [testDirectory]
    : [path.join(base, 'test'), path.join(base, 'tests')]

  const seen = new Set()
  const files = []
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort()) {
      const full = path.join(dir, file)
      if (seen.has(full)) continue
      seen.add(full)
      files.push(full)
    }
  }
  return files.sort()
}

function classifyTestFiles(files) {
  const groups = { direct: [], vitest: [] }
  for (const file of files) {
    const group = VITEST_FILES.has(path.basename(file)) ? groups.vitest : groups.direct
    group.push(file)
  }
  return groups
}

function runProcess(command, args, options = {}) {
  const spawn = options.spawnSync || spawnSync
  const result = spawn(command, args, {
    cwd: options.cwd || path.resolve(__dirname, '..'),
    env: options.env || process.env,
    stdio: options.stdio || 'inherit',
    timeout: options.timeoutMs || 120000,
    windowsHide: true,
  })
  return !result.error && result.status === 0
}

function resolveVitestCli(resolvePackage = require.resolve) {
  return path.join(path.dirname(resolvePackage('vitest')), 'vitest.mjs')
}

function report(options, state, name) {
  if (options.stdio === 'ignore') return
  const log = options.log || console.log
  log(`[API 测试] ${state}：${name}`)
}

function runAllTests(options = {}) {
  const files = options.files || discoverTestFiles(options.testDirectory)
  const groups = classifyTestFiles(files)
  const failed = []

  for (const file of groups.direct) {
    const name = path.basename(file)
    report(options, '开始', name)
    // 守卫必须在**每个直跑子进程**里装上：run-tests.js 的 direct 路径是「一个测试文件一个 node 进程」，父进程装一次等于没装。
    const guardSetup = path.resolve(__dirname, '../../shared-utils/network-egress-guard.setup.js')
    const passed = runProcess(process.execPath, ['--require', guardSetup, file], options)
    report(options, passed ? '通过' : '失败', name)
    if (!passed) failed.push(name)
  }

  if (groups.vitest.length > 0) {
    const vitestCli = options.vitestCli || resolveVitestCli()
    const args = [
      vitestCli,
      'run',
      '--globals',
      '--environment',
      'node',
      '--maxWorkers=1',
      '--no-file-parallelism',
      ...groups.vitest,
    ]
    const name = `Vitest（${groups.vitest.length} 个文件）`
    report(options, '开始', name)
    const passed = runProcess(process.execPath, args, options)
    report(options, passed ? '通过' : '失败', name)
    if (!passed) failed.push('vitest')
  }

  if (failed.length > 0 && options.stdio !== 'ignore') {
    console.error(`API 发布引擎测试失败：${failed.join(', ')}`)
  }
  return failed.length === 0 ? 0 : 1
}

if (require.main === module) process.exitCode = runAllTests()

module.exports = {
  VITEST_FILES,
  classifyTestFiles,
  discoverTestFiles,
  resolveVitestCli,
  runAllTests,
  runProcess,
}
