'use strict'
/**
 * publish-mode-config.test.js — W1 §5.1 platforms.yaml publishMode + getPublishMode 读取器
 * 读真实 platforms.yaml（不 mock），校验字段落地 + 派生回退 + 归一 fail-closed。
 */
const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const router = require('../src/api-router')
const mode = require('../src/publish/core/publish-mode')
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
    // 2026-10-24：toutiao 加入本波 —— 头条视频 API 轨正在打通（CSRF 头名已按抓包改为
  // x-secsdk-csrf-token，令牌由 toutiao-csrf-grab 注入），配置为 api-then-dom。
  const w1 = { tencent_video: 1, bilibili: 1, baijiahao: 1, douyin: 1, kuaishou: 1, toutiao: 1 }
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
    // tencent_video：2026-10-06 起 has_api 由 false 修正为 true——旧值与同文件
    // publishMode=api-then-dom 自相矛盾（api-then-dom 本身要求存在 API 轨），
    // 使视频号完整链（shipinhao-video.js，分片 + Content-MD5 + draft/create 双分支）
    // 从未被触发、等同死代码。修正后该平台两字段一致，**不再构成分歧样本**，
    // 故优先级改由 youtube 的反向样本证明，断言本身随之更新。
    expect(router.shouldUseApi('tencent_video')).toBe(true)
    expect(router.getPublishMode('tencent_video')).toBe('api-then-dom')
    // youtube: has_api=true，但 publishMode=dom-only → getPublishMode 应取字段值（反向样本：
    // 若 getPublishMode 由 has_api 派生，这里会得到 api-then-dom，断言即红）
    // ★ 2026-10-16 更新（p3-residual-criteria，CCG 深度评审 i1 upheld 后修复）：
    //   shouldUseApi 已改为**两轴合取**（has_api 且 publishMode ∈ {api-only, api-then-dom}）。
    //   youtube 虽 has_api:true，但 publishMode=dom-only（未入波）⇒ shouldUseApi 为 false。
    //   这条正是 i1 要堵的「过报 API 平台」：旧语义会把 youtube 报成 API 平台，
    //   与 rpa-view-manager.js:68 记载的误入 API 轨事故同款。
    expect(router.shouldUseApi('youtube')).toBe(false)
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

// ─────────────────────────────────────────────────────────────────────────────
// ★ CCG 第八轮 i2（upheld）回归锁 —— 两个读者对**同一份坏配置**必须同结论
//
// 动因（含一次真实的修复失败）：该轮先只加了 `opts.safe` 选项，却**没有任何生产调用方传它**
// （全仓仅 rpa-view-manager.js 与 src/index.js 两处调用，都是裸调），于是坏配置照样抛错、
// 照样与 shouldUseApi 分叉 —— 新增分支永远走不到，属与第六轮 i3 同型的**死代码**。
// 本组用例同时锁三件事：
//   ① 行为：非法 publishMode 默认抛错、带 safe 则告警 + dom-only；
//   ② 一致性：合法配置下两个读者必须互相印证（mode !== 'dom-only' ⇔ shouldUseApi true）；
//   ③ **接线**：生产代码里凡 getPublishMode( 调用必须带 { safe: true }（防死代码复发）。
// ─────────────────────────────────────────────────────────────────────────────
describe('§5.1 两读者同口径（CCG 第八轮 i2 回归锁）', function () {
  const fs = require('node:fs')
  const path = require('node:path')
  const REPO = path.resolve(__dirname, '..', '..', '..')

  test('非法 publishMode：默认 fail-closed 抛错', function () {
    expect(() => router.resolvePublishMode({ has_api: true, publishMode: 'bogus-mode' }))
      .toThrow(/unknown publishMode/i)
    expect(() => router.resolvePublishMode({ has_api: true, publishMode: 'API-ONLY' }))
      .toThrow(/unknown publishMode/i)
    // ★ 能力轴为 false 时也必须校验（原实现在归一时先短路了能力轴 ⇒ 静默 false，与另外两读者分叉）
    expect(() => router.resolvePublishMode({ has_api: false, publishMode: 'bogus-mode' }))
      .toThrow(/unknown publishMode/i)
    // ⚠️ 上面那条测的是 cfg 级入口（它本就没有短路）。**真正会退化的是 isApiTrack**：
    //    它的旧写法 `if (!cfg || !cfg.has_api) return false` 在归一之前返回。
    //    实测（本轮变异 M2）只测 resolvePublishMode 时，把短路改回去**不会变红** ⇒
    //    必须直接钉 isApiTrack 这一侧。
    expect(() => router.isApiTrack({ has_api: false, publishMode: 'bogus-mode' }))
      .toThrow(/unknown publishMode/i)
    expect(() => router.isApiTrack({ has_api: false, publishMode: 'API-ONLY' }))
      .toThrow(/unknown publishMode/i)
  })

  test('非法 publishMode + safe：告警并回落 dom-only（与 shouldUseApi=false 同结论）', function () {
    expect(router.resolvePublishMode({ has_api: true, publishMode: 'bogus-mode' }, { safe: true }))
      .toBe('dom-only')
    expect(router.resolvePublishMode({ has_api: false, publishMode: 'bogus-mode' }, { safe: true }))
      .toBe('dom-only')
    // isApiTrack 的 fail-safe 版必须给出**同一结论**
    expect(router.isApiTrackSafe({ has_api: true, publishMode: 'bogus-mode' })).toBe(false)
  })

  test('一致性命中：合法配置下 getPublishMode 与 shouldUseApi 必须互相印证', function () {
    const platforms = router.loadConfig()
    for (const k of Object.keys(platforms)) {
      const mode = router.getPublishMode(k)
      // 走 API 轨 ⇔ 两轴合取成立（同一份配置，两个读者不得给出相反结论）
      expect(router.shouldUseApi(k), `${k}: mode=${mode}`).toBe(mode !== 'dom-only')
    }
    // 规模下界：防「遍历到空集合 ⇒ 恒真」的假绿
    expect(Object.keys(platforms).length).toBeGreaterThanOrEqual(15)
  })

  test('★ 接线锁：生产代码里 getPublishMode 调用必须显式带 safe（防「加了选项没人传」的死代码）', function () {
    // 只扫生产代码（排除 test 目录与文档），锚点是 `getPublishMode(` 调用点。
    const targets = [
      path.join(REPO, 'apps/desktop/electron/services/rpa-view-manager.js'),
      path.join(REPO, 'packages/api-publish-engine/src/index.js'),
    ]
    const offenders = []
    let calls = 0
    for (const f of targets) {
      const src = fs.readFileSync(f, 'utf8').split('\n')
      src.forEach((l, i) => {
        if (!/\.getPublishMode\s*\(/.test(l)) return
        if (/^\s*\/\//.test(l)) return
        calls++
        if (!/safe\s*:\s*true/.test(l)) offenders.push(`${path.basename(f)}:${i + 1}`)
      })
    }
    // 下界：锚点必须真的命中（防正则写错导致「零命中 ⇒ 恒过」）
    expect(calls, '未扫到任何 getPublishMode 调用 ⇒ 接线锁基准失效').toBeGreaterThanOrEqual(2)
    expect(offenders, `以下生产调用点未传 { safe: true } ⇒ 坏配置会与 shouldUseApi 分叉: ${offenders.join(', ')}`)
      .toEqual([])
  })
})

describe('§5.1 ADR-0008：RSS 是协议通道，不是发布平台', function () {
  test('publishMode 值域仍为三态（未为 RSS 新增第四态）', function () {
    expect(Object.values(mode.MODES)).toEqual(['api-only', 'api-then-dom', 'dom-only'])
  })

  test('误配 rss 归一 fail-closed，不静默回落 api-then-dom', function () {
    // 回落会把 RSS 通道送进 DOM/API 轨调度，去点一个并不存在的选择器——
    // 静默缺陷的源头，所以这里必须是当场抛出。
    expect(() => mode.normalizeMode('rss')).toThrow(/unknown publishMode/)
    expect(() => mode.decideRoute({ mode: 'rss' })).toThrow(/unknown publishMode/)
  })

  test('platforms.yaml 不含任何分发端 id', function () {
    const keys = Object.keys(yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')).platforms)
    expect(keys).not.toContain('xiaoyuzhou')
    expect(keys).not.toContain('apple_podcasts')
    expect(keys).not.toContain('spotify')
  })
})
