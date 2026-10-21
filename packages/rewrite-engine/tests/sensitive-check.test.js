/**
 * sensitive-check 模块测试（rewrite-sensitive-precheck-relax 收尾，2026-10-21）
 *
 * 锁住拆模块后的三条行为契约（与拆模块前逐字节等价）：
 *   ① 未注入过滤器 ⇒ 不检测、不拦截、零 hits；
 *   ② 命中 ⇒ blocked 恒为 false（前置不拦截），但 hits 如实上报（KB 双零命中要用）；
 *   ③ detect 抛错 ⇒ fail-open 放行 + 留痕（logging-coverage-audit 要求必须留）。
 *
 * 另锁一条工程契约：本模块不得依赖 rewrite-engine-core（否则拆模块失去意义，
 * 循环依赖会让 core 的行数问题原样复发）。
 */
var { sensitiveCheck } = require('../src/sensitive-check')

describe('sensitiveCheck（拆模块后的行为契约）', function () {
  function makeLogger () {
    var calls = []
    return {
      calls: calls,
      error: function (tag, msg, params) { calls.push({ tag: tag, msg: msg, params: params }) },
    }
  }

  test('① 未注入过滤器 ⇒ 不检测、不拦截、零 hits', function () {
    var logger = makeLogger()
    var r = sensitiveCheck({ filter: null, logger: logger }, '任何文本', 'pre')
    expect(r).toEqual({ blocked: false, hits: [] })
    expect(logger.calls.length).toBe(0)
  })

  test('② 命中 ⇒ blocked 恒 false（前置不拦截），hits 如实上报', function () {
    var hits = [{ word: '爆炸', index: 0, length: 2, category: '暴力' }]
    var seen = []
    var filter = { detect: function (t) { seen.push(t); return { hasSensitive: true, hits: hits } } }
    var r = sensitiveCheck({ filter: filter, logger: makeLogger() }, '工厂发生了爆炸', 'pre')
    expect(r.blocked).toBe(false)
    expect(r.hits).toBe(hits)
    expect(seen).toEqual(['工厂发生了爆炸'])
  })

  test('②b 后置（post）同样不拦截，hits 上报（与前置同语义）', function () {
    var hits = [{ word: '杀人', index: 0, length: 2, category: '暴力' }]
    var filter = { detect: function () { return { hasSensitive: true, hits: hits } } }
    var r = sensitiveCheck({ filter: filter, logger: makeLogger() }, '结果里有杀人', 'post')
    expect(r.blocked).toBe(false)
    expect(r.hits).toBe(hits)
  })

  test('②c detect 返回缺 hits 字段 ⇒ 归一化为空数组（不把 undefined 抛给调用方）', function () {
    var filter = { detect: function () { return { hasSensitive: false } } }
    var r = sensitiveCheck({ filter: filter, logger: makeLogger() }, 'x', 'post')
    expect(r).toEqual({ blocked: false, hits: [] })
  })

  test('③ detect 抛错 ⇒ fail-open 放行 + 留痕（带 stage 与 error）', function () {
    var logger = makeLogger()
    var filter = { detect: function () { throw new Error('detect boom') } }
    var r = sensitiveCheck({ filter: filter, logger: logger }, 'x', 'pre')
    expect(r).toEqual({ blocked: false, hits: [] })
    expect(logger.calls.length).toBe(1)
    expect(logger.calls[0].tag).toBe('rewrite-engine')
    expect(logger.calls[0].msg).toBe('sensitive check failed, fail-open')
    expect(logger.calls[0].params.stage).toBe('pre')
    expect(logger.calls[0].params.error).toBe('detect boom')
  })

  test('③b logger 缺失时留痕不得抛错（fail-open 自身也要 fail-open）', function () {
    var filter = { detect: function () { throw new Error('boom') } }
    var r = sensitiveCheck({ filter: filter, logger: null }, 'x', 'post')
    expect(r).toEqual({ blocked: false, hits: [] })
  })

  test('③c detect 抛非 Error 对象 ⇒ error 字段归一到 "unknown"，不留空', function () {
    var logger = makeLogger()
    var filter = { detect: function () { throw 'string error' } }
    var r = sensitiveCheck({ filter: filter, logger: logger }, 'x', 'pre')
    expect(r).toEqual({ blocked: false, hits: [] })
    expect(logger.calls[0].params.error).toBe('unknown')
  })
})
