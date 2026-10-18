import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { extractRewriteHistoryId, REWRITE_LINEAGE_MAX_LENGTH } from './rewrite-lineage'

/**
 * 改写关联 id 提取（PRD-PUBLISH-REWRITE-LINEAGE-2026-10-05 §四）
 *
 * 为什么要有"唯一提取实现"：`rewriteHistoryId` 由主进程生成并随 IPC 信封回到渲染层，
 * 而渲染层有**四个**改写入口（改写页 / 发布页 AI 面板 / 热门选题一键成片 / 采集页改写）。
 * 四处各抄一份 `res.data.rewriteHistoryId` 的读法，必然出现"有人传 res、有人传 data、
 * 有人把数字兜成字符串"的口径分裂 —— 而分裂的症状不是报错，是**归因榜静默少一路**。
 * 本文件除行为锁外，另有一条结构锁扫这四个文件，要求它们引用本实现。
 */

const ENVELOPE_OK = (id) => ({ code: 0, data: { success: true, result: '正文', rewriteHistoryId: id } })

describe('extractRewriteHistoryId — 判据', () => {
  it('合法信封返回原样 id', () => {
    expect(extractRewriteHistoryId(ENVELOPE_OK('md0kx9a1b2c3'))).toBe('md0kx9a1b2c3')
  })

  it('首尾空白被裁掉（主进程生成的 id 本不应带空白，带着也只能是上游异常）', () => {
    expect(extractRewriteHistoryId(ENVELOPE_OK('  md0kx9a1b2c3  '))).toBe('md0kx9a1b2c3')
  })

  it('非 0 码 / success=false / 信封缺失 ⇒ null（不得把失败信封里的字段当真值）', () => {
    expect(extractRewriteHistoryId({ code: -1, data: { success: true, rewriteHistoryId: 'x' } })).toBeNull()
    expect(extractRewriteHistoryId({ code: 0, data: { success: false, rewriteHistoryId: 'x' } })).toBeNull()
    expect(extractRewriteHistoryId({ code: 0 })).toBeNull()
    expect(extractRewriteHistoryId(null)).toBeNull()
    expect(extractRewriteHistoryId(undefined)).toBeNull()
    expect(extractRewriteHistoryId('not-an-object')).toBeNull()
    expect(extractRewriteHistoryId({ code: 0, data: '不是对象' })).toBeNull()
  })

  it('id 缺席 / null / 空串 / 纯空白 ⇒ null（是 null，不是空串）', () => {
    expect(extractRewriteHistoryId(ENVELOPE_OK(undefined))).toBeNull()
    expect(extractRewriteHistoryId(ENVELOPE_OK(null))).toBeNull()
    expect(extractRewriteHistoryId(ENVELOPE_OK(''))).toBeNull()
    expect(extractRewriteHistoryId(ENVELOPE_OK('   \n '))).toBeNull()
  })

  it('非字符串一律拒绝 —— 禁止用 String() 兜底把 123 变成 "123"', () => {
    expect(extractRewriteHistoryId(ENVELOPE_OK(123))).toBeNull()
    expect(extractRewriteHistoryId(ENVELOPE_OK(true))).toBeNull()
    expect(extractRewriteHistoryId(ENVELOPE_OK({ id: 'x' }))).toBeNull()
    expect(extractRewriteHistoryId(ENVELOPE_OK(['x']))).toBeNull()
  })

  it('超长度上限 ⇒ null（上限存在的意义是拦住"把整段别的字段塞进来"）', () => {
    const tooLong = 'a'.repeat(REWRITE_LINEAGE_MAX_LENGTH + 1)
    expect(extractRewriteHistoryId(ENVELOPE_OK(tooLong))).toBeNull()
    // 边界：恰好等于上限必须放行，否则上限本身成了新断点
    expect(extractRewriteHistoryId(ENVELOPE_OK('a'.repeat(REWRITE_LINEAGE_MAX_LENGTH))))
      .toBe('a'.repeat(REWRITE_LINEAGE_MAX_LENGTH))
  })

  it('含控制字符 ⇒ null（NUL 会一路带到 SQL 参数里，绝不该出现在 id 中）', () => {
    expect(extractRewriteHistoryId(ENVELOPE_OK('ab\u0000cd'))).toBeNull()
    expect(extractRewriteHistoryId(ENVELOPE_OK('ab\u001fcd'))).toBeNull()
    expect(extractRewriteHistoryId(ENVELOPE_OK('ab\u007fcd'))).toBeNull()
  })

  it('实测形态：主进程生成器产出的 id 必须能通过（禁止判据窄到把自己上游拒了）', () => {
    // 与 services/store/performance-loop-store.js 的 _genId 同式：base36 时间戳 + ≤8 位 base36 随机
    const samples = Array.from({ length: 500 }, () =>
      Date.now().toString(36) + Math.random().toString(36).slice(2, 10))
    for (const s of samples) {
      expect(extractRewriteHistoryId(ENVELOPE_OK(s))).toBe(s)
    }
  })
})

describe('单一实现结构锁 — 四个改写入口不得各抄一份读法', () => {
  const SRC_ROOT = path.resolve(__dirname, '..')
  // 判据域写死为"实际调用 aiRewrite 的四个文件"（PRD §2.1 表），新增第五个入口必须同时登记到这里。
  const PRODUCERS = [
    'views/RewriteView.vue',
    'components/AiWriterPanel.vue',
    'composables/useHotTopicsGenVideo.js',
    'views/Collection.vue',
  ]

  it('扫描域真实存在（路径搬家不能让锁静默空转）', () => {
    for (const rel of PRODUCERS) {
      expect(fs.existsSync(path.join(SRC_ROOT, rel)), `缺文件：${rel}`).toBe(true)
    }
    expect(PRODUCERS.length).toBeGreaterThanOrEqual(4)
  })

  it('每个入口都调用 aiRewrite，且引用共享提取实现（不得出现第二份 res.data.rewriteHistoryId 直读）', () => {
    for (const rel of PRODUCERS) {
      const src = fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8')
      expect(src, `${rel} 应调用 aiRewrite`).toContain('aiRewrite(')
      expect(src, `${rel} 必须引用共享实现`).toMatch(/from ['"][^'"]*utils\/rewrite-lineage['"]/)
      // 结构锁的强判据：出现"直接点读信封字段"的写法即为抄第二份
      expect(src, `${rel} 禁止自抄读法`).not.toMatch(/\.rewriteHistoryId\s*(\|\||\?\.)/)
      expect(src, `${rel} 禁止自抄读法`).not.toMatch(/data\.rewriteHistoryId\s*\|\|/)
    }
  })

  // 历史：本锁原判据是「Collection 的 Python aggregationRewrite 分支必须清掉引擎残留 id」，
  // 前提是 Collection 有两条改写来源（桌面引擎有 id / Python 无 id）。
  // 2026-10-18 fix-collect-antibot-rewrite 把采集页 stealth 分支的自动改写**整体改走桌面
  // 引擎**（Python 后端只读 env，桌面「模型设置」进不去，已配置仍误报；且 Python 链路没有
  // rewriteHistoryId），Collection 不再有 Python 改写入口 ⇒ 原前提消失。
  // 新不变量（同义、方向更根本）：**禁止回退到无 id 的 Python 链路**；所有改写必须经桌面
  // 引擎并把共享 extractor 的 id 写进 collectRewriteLineageId（下游 attachRewriteLineage 用）。
  it('Collection 的改写入口全部走桌面引擎（不得回退到无 rewriteHistoryId 的 Python 链路）', () => {
    const src = fs.readFileSync(path.join(SRC_ROOT, 'views/Collection.vue'), 'utf8')
    expect(
      src.includes('api.aggregationRewrite('),
      'Collection 不得再调用 api.aggregationRewrite（该链路不写 rewrite_history、没有 id，切回去会静默丢失关联）',
    ).toBe(false)
    expect(src).toContain('rewriteViaEngine(')
    expect(
      src,
      'collectRewriteLineageId 必须由共享 extractRewriteHistoryId 赋值（不得自抄读法）',
    ).toMatch(/collectRewriteLineageId\s*=\s*extractRewriteHistoryId\(/)
  })
})
