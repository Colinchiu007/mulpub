'use strict'
/**
 * publish-mode-config.test.js — W1 §5.1 platforms.yaml publishMode + getPublishMode 读取器
 * 读真实 platforms.yaml（不 mock），校验字段落地 + 派生回退 + 归一 fail-closed。
 */
const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const router = require('../src/api-router')
const CONFIG_PATH = path.resolve(__dirname, '..', '..', '..', 'config', 'platforms.yaml')

const VALID = ['api-only', 'api-then-dom', 'dom-only']

describe('§5.1 platforms.yaml publishMode 字段', function () {
  let platforms
  beforeAll(function () {
    platforms = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')).platforms
  })

  test('每个平台都有 publishMode 且值合法（三态之一）', function () {
    Object.keys(platforms).forEach(function (k) {
      const pm = platforms[k].publishMode
      expect(pm).toBeDefined()
      expect(VALID).toContain(pm)
    })
  })

  test('W1 波（视频号/B站/百家号）为 api-then-dom', function () {
    expect(platforms.tencent_video.publishMode).toBe('api-then-dom')
    expect(platforms.bilibili.publishMode).toBe('api-then-dom')
    expect(platforms.baijiahao.publishMode).toBe('api-then-dom')
  })

  test('W2 波（抖音）为 api-then-dom', function () {
    expect(platforms.douyin.publishMode).toBe('api-then-dom')
  })

  test('W3 波（快手）为 api-then-dom，has_api 同步翻转 true', function () {
    expect(platforms.kuaishou.publishMode).toBe('api-then-dom')
    expect(platforms.kuaishou.has_api).toBe(true)
  })

  test('未入波平台为 dom-only（含 has_api:true 但暂缓的 youtube/facebook 等）', function () {
    const w1 = { tencent_video: 1, bilibili: 1, baijiahao: 1, douyin: 1, kuaishou: 1 }
    Object.keys(platforms).forEach(function (k) {
      if (!w1[k]) expect(platforms[k].publishMode).toBe('dom-only')
    })
    // 锚点：youtube 虽有 has_api，但未入波 → 双轨服务视为 dom-only
    expect(platforms.youtube.has_api).toBe(true)
    expect(platforms.youtube.publishMode).toBe('dom-only')
  })
})

describe('§5.1 getPublishMode 读取器', function () {
  test('优先读 publishMode 字段，覆盖 has_api 派生', function () {
    // tencent_video: has_api=false，但 publishMode=api-then-dom → 应取字段值
    expect(router.shouldUseApi('tencent_video')).toBe(false)
    expect(router.getPublishMode('tencent_video')).toBe('api-then-dom')
    // youtube: has_api=true，但 publishMode=dom-only → 应取字段值
    expect(router.shouldUseApi('youtube')).toBe(true)
    expect(router.getPublishMode('youtube')).toBe('dom-only')
  })

  test('W1 三平台解析为 api-then-dom', function () {
    expect(router.getPublishMode('tencent_video')).toBe('api-then-dom')
    expect(router.getPublishMode('bilibili')).toBe('api-then-dom')
    expect(router.getPublishMode('baijiahao')).toBe('api-then-dom')
    expect(router.getPublishMode('douyin')).toBe('api-then-dom')
  })

  test('W3 快手解析为 api-then-dom（unsupported 可降级 DOM，risk/login 停报由 runner 保证）', function () {
    expect(router.getPublishMode('kuaishou')).toBe('api-then-dom')
  })

  test('未入波/未知平台解析为 dom-only', function () {
    expect(router.getPublishMode('weibo')).toBe('dom-only')
    expect(router.getPublishMode('nonexistent_platform')).toBe('dom-only')
  })

  test('返回值始终是三态之一（全平台遍历）', function () {
    Object.keys(router.loadConfig()).forEach(function (k) {
      expect(VALID).toContain(router.getPublishMode(k))
    })
  })
})
