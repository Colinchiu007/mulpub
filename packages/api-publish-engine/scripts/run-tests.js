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
  'bilibili-upos.test.js',
  'cos-uploader.test.js',
  'e2e-publish-full-chain.test.js',
  'http-base.test.js',
  'kuaishou-ai-declaration.test.js',
  'oss-uploader.test.js',
  'publish-core.test.js',
  'publish-governance.test.js',
  'publish-mode-runner.test.js',
  'publish-mode-config.test.js',
  'risk-suspender.test.js',
  'publish-service.test.js',
  'signer.test.js',
  'tiktok.test.js',
  'twitter.test.js',
  'youtube.test.js',
])

function discoverTestFiles(testDirectory = path.resolve(__dirname, '..', 'test')) {
  return fs.readdirSync(testDirectory)
    .filter((file) => file.endsWith('.test.js'))
    .sort()
    .map((file) => path.join(testDirectory, file))
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
    const passed = runProcess(process.execPath, [file], options)
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
