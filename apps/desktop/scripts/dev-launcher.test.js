// @ts-check
/**
 * dev-launcher.test.js — dev 启动参数/默认 userData 解析（node --test）
 * 回归保护：dev.js 直接启动必须落到固定 D 盘 profile，不得再掉进随机临时目录。
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildElectronArgs, resolveUserDataDir, DEFAULT_USER_DATA_DIR } = require('./dev-launcher')

test('resolveUserDataDir 未设置 env 时使用固定 D 盘默认 profile', () => {
  assert.equal(resolveUserDataDir({}), DEFAULT_USER_DATA_DIR)
  assert.ok(DEFAULT_USER_DATA_DIR.startsWith('D:\\'))
  assert.ok(DEFAULT_USER_DATA_DIR.includes('Multi-Publish-debug-profile'))
})

test('resolveUserDataDir 尊重显式 ELECTRON_USER_DATA_DIR（并发隔离/start-desktop.ps1）', () => {
  assert.equal(resolveUserDataDir({ ELECTRON_USER_DATA_DIR: 'X:\\custom\\profile' }), 'X:\\custom\\profile')
})

test('buildElectronArgs 透传 userData/cache 并默认 CDP 端口 9222', () => {
  const args = buildElectronArgs({
    electronUserDataDir: 'D:\\tmp\\Multi-Publish-debug-profile',
    electronCacheDir: 'D:\\tmp\\Multi-Publish-debug-profile\\cache',
    desktopDir: 'D:\\app',
    platform: 'win32',
  })
  assert.ok(args.includes('--user-data-dir=D:\\tmp\\Multi-Publish-debug-profile'))
  assert.ok(args.includes('--disk-cache-dir=D:\\tmp\\Multi-Publish-debug-profile\\cache'))
  assert.ok(args.includes('--remote-debugging-port=9222'))
  assert.equal(args[args.length - 1], 'D:\\app')
})

test('buildElectronArgs 支持自定义 CDP 端口（worktree 独立端口）', () => {
  const args = buildElectronArgs({
    electronUserDataDir: 'D:/tmp/profile',
    electronCacheDir: 'D:/tmp/profile/cache',
    desktopDir: 'D:/app',
    cdpPort: 9333,
    platform: 'win32',
  })
  assert.ok(args.includes('--remote-debugging-port=9333'))
})

test('resolveUserDataDir 吞并尾随空白（cmd set "VAR=val &" 尾随空格陷阱回归保护）', () => {
  assert.equal(resolveUserDataDir({ ELECTRON_USER_DATA_DIR: ' X:\\custom\\profile ' }), 'X:\\custom\\profile')
  assert.equal(resolveUserDataDir({ ELECTRON_USER_DATA_DIR: 'X:\\custom\\profile  ' }), 'X:\\custom\\profile')
  assert.equal(resolveUserDataDir({ ELECTRON_USER_DATA_DIR: '   ' }), DEFAULT_USER_DATA_DIR)
})
