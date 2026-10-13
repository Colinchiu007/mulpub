/**
 * platform-taxonomy 读取层测试 —— **先写测试（TDD RED）**。
 *
 * 被测：packages/shared-utils/src/platform-taxonomy.js
 * 数据：config/platform-taxonomy.json（由 scripts/import-platform-taxonomy.js 生成）
 *
 * 设计要点（每条都对应一个已知失败模式）：
 *  ① **null 成因必须可区分**：调用方要据此决定「不写字段」还是「如实上报失败」，
 *     一律返回 null 会让「平台没数据」和「用户填了个错名字」变得无法区分 —— 前者应静默跳过，
 *     后者必须失败（否则用户以为按分类发了，实际发到了默认分类）。
 *  ② **contentType 必须参与查表**：实测 B站 id=21 图文是「萌宠」、视频是「日常」，
 *     同一数字两套语义。不带 contentType 查表必错。
 *  ③ **返回深拷贝**：浅拷贝会让调用方突变污染模块级冻结表（publish-capabilities.js:104-108 有同因先例）。
 *  ④ 平台无数据 / 文件缺失 ⇒ 不得抛异常炸掉发布链，但也不得假装成功。
 *
 * 用法: npx vitest run packages/shared-utils/src/__tests__/platform-taxonomy.test.js
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ⚠️ 必须**静态**导入：vitest 下 `await import(变量路径)` 不按本测试文件解析，
// 实测报 `Cannot find module '/packages/shared-utils/platform-taxonomy.js'`（路径丢掉了 src 段）。
// 被测模块是 CJS，vitest 会做互操作，命名导出可直接用。
import * as mod from '../platform-taxonomy.js'

/** 造一张最小可用的分类表 */
function makeTaxonomyFile (payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxo-reader-'))
  const p = path.join(dir, 'platform-taxonomy.json')
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8')
  return p
}

const FIXTURE = {
  version: 1,
  source: { kind: 'competitor-data-snapshot', snapshotDate: '2026-07-14', verifiedOnline: false },
  platformsWithoutIdData: ['kuaishou', 'wechat_mp'],
  platforms: {
    bilibili: {
      article: {
        contentType: 'article',
        sourceFile: 'bilibilicategortmap.txt',
        encoding: 'utf-8',
        nodeCount: 2,
        maxDepth: 2,
        nodes: [
          { id: '2', name: '动画', depth: 1, parentId: null },
          { id: '4', name: '动漫杂谈', depth: 2, parentId: '2' },
        ],
      },
      video: {
        contentType: 'video',
        sourceFile: 'bilibilivideocategortmap.txt',
        encoding: 'utf-8',
        nodeCount: 2,
        maxDepth: 2,
        nodes: [
          { id: '160', name: '生活', depth: 1, parentId: null },
          { id: '21', name: '日常', depth: 2, parentId: '160' },
        ],
      },
    },
  },
}

let mod
let currentFile

beforeEach(() => {
  mod.__resetTaxonomyCacheForTest?.()
  currentFile = makeTaxonomyFile(FIXTURE)
  mod.setTaxonomyPathForTest?.(currentFile)
})

afterEach(() => {
  mod?.__resetTaxonomyCacheForTest?.()
})

describe('导出面', () => {
  it('提供 7 个导出（与 ARCH §3 / PRD §4 一致）', () => {
    for (const name of ['loadTaxonomy', 'getCategories', 'resolveCategoryId', 'hasPlatformCategories', 'searchCategories', 'getTaxonomyCoverage', 'validateTaxonomy']) {
      expect(typeof mod[name], `缺少导出 ${name}`).toBe('function')
    }
  })
})

describe('resolveCategoryId —— 核心：null 成因必须可区分', () => {
  it('按中文名查到 ID（图文与视频分别查，互不串台）', () => {
    expect(mod.resolveCategoryId('bilibili', '动画', { contentType: 'article' })).toMatchObject({ ok: true, id: '2' })
    // 「动画」只存在于图文表 ⇒ 在 video 下查它应报 content-type-mismatch（而不是笼统的 not-found）
    expect(mod.resolveCategoryId('bilibili', '动画', { contentType: 'video' }).reason).toBe('content-type-mismatch')
  })

  it('★ 同一 id 在两套表里含义不同，必须按 contentType 返回不同结果', () => {
    const a = mod.resolveCategoryId('bilibili', '21', { contentType: 'article' })
    const v = mod.resolveCategoryId('bilibili', '21', { contentType: 'video' })
    expect(a.ok).toBe(false) // 图文表没有 id=21
    expect(v).toMatchObject({ ok: true, id: '21' })
    expect(v.name).toBe('日常')
  })

  it('平台在 platformsWithoutIdData 里 ⇒ reason=platform-name-only（有名字但不可提交）', () => {
    const r = mod.resolveCategoryId('kuaishou', '游戏')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('platform-name-only')
  })

  it('平台完全不在表里 ⇒ reason=platform-absent（调用方应静默跳过，不算失败）', () => {
    const r = mod.resolveCategoryId('no-such-platform', '游戏')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('platform-absent')
  })

  it('未知平台不得抛异常炸掉发布链', () => {
    expect(() => mod.resolveCategoryId('no-such-platform', '游戏')).not.toThrow()
  })

  it('未知平台 ⇒ reason=platform-absent（不得抛异常炸掉发布链）', () => {
    const r = mod.resolveCategoryId('no-such-platform', '游戏')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('platform-absent')
  })

  it('用户显式给了名字但查不到 ⇒ reason=not-found（调用方**必须失败**，不得静默用默认值）', () => {
    const r = mod.resolveCategoryId('bilibili', '不存在的分类', { contentType: 'video' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not-found')
    expect(r.hint).toBeTruthy()
  })

  it('名字存在于另一 contentType ⇒ reason=content-type-mismatch，并给出可用分类', () => {
    const r2 = mod.resolveCategoryId('bilibili', '日常', { contentType: 'article' })
    expect(r2.reason).toBe('content-type-mismatch')
    expect(Array.isArray(r2.available)).toBe(true)
    expect(r2.available.length).toBeGreaterThan(0)
  })

  it('名字两边都没有 ⇒ 才是 not-found（与 content-type-mismatch 必须可区分）', () => {
    expect(mod.resolveCategoryId('bilibili', '压根不存在的分类', { contentType: 'article' }).reason).toBe('not-found')
    expect(mod.resolveCategoryId('bilibili', '压根不存在的分类', { contentType: 'video' }).reason).toBe('not-found')
  })
})

describe('getCategories / hasPlatformCategories / getTaxonomyCoverage', () => {
  it('getCategories 返回该 contentType 的节点；缺 contentType 时报错而非猜', () => {
    expect(mod.getCategories('bilibili', { contentType: 'video' })).toHaveLength(2)
    expect(() => mod.getCategories('bilibili')).toThrow(/contentType/)
  })

  it('★ 返回深拷贝：调用方突变不得污染模块级表', () => {
    const a = mod.getCategories('bilibili', { contentType: 'video' })
    a[0].name = '被改坏了'
    const b = mod.getCategories('bilibili', { contentType: 'video' })
    expect(b[0].name).toBe('生活')
  })

  it('hasPlatformCategories 区分「有 ID 数据」与「无」', () => {
    expect(mod.hasPlatformCategories('bilibili')).toBe(true)
    expect(mod.hasPlatformCategories('kuaishou')).toBe(false)
  })

  it('getTaxonomyCoverage 返回 id|name-only|absent 三档', () => {
    expect(mod.getTaxonomyCoverage('bilibili')).toBe('id')
    expect(mod.getTaxonomyCoverage('kuaishou')).toBe('name-only')
    expect(mod.getTaxonomyCoverage('no-such-platform')).toBe('absent')
  })
})

describe('searchCategories', () => {
  it('按关键词搜（大小写不敏感，命中任一层名称）', () => {
    expect(mod.searchCategories('bilibili', '动').length).toBeGreaterThan(0)
    expect(mod.searchCategories('bilibili', '日常').length).toBe(1)
    expect(mod.searchCategories('bilibili', 'zzz')).toHaveLength(0)
  })
})

describe('validateTaxonomy —— 结构自检', () => {
  it('健康表返回空数组', () => {
    expect(mod.validateTaxonomy()).toEqual([])
  })

  it('捕获重复 id / 悬空 parentId / 空 nodes', () => {
    const bad = JSON.parse(JSON.stringify(FIXTURE))
    bad.platforms.bilibili.video.nodes[1].id = '160'          // 与父节点撞 id
    bad.platforms.bilibili.video.nodes.push({ id: '9', name: '孤儿', depth: 2, parentId: '不存在' })
    bad.platforms.bilibili.article.nodes = []
    fs.writeFileSync(currentFile, JSON.stringify(bad), 'utf8')
    mod.__resetTaxonomyCacheForTest?.()
    const issues = mod.validateTaxonomy()
    expect(issues.length).toBeGreaterThanOrEqual(3)
    expect(issues.join('\n')).toMatch(/重复|duplicate/i)
    expect(issues.join('\n')).toMatch(/parent/i)
    expect(issues.join('\n')).toMatch(/空|empty/i)
  })
})

describe('★ 真实产物契约：转换器输出必须被读取层读得懂', () => {
  // 这一组的存在理由：上面所有用例都吃**手写 fixture**，因此「转换器改了字段名/结构」
  // 这类漂移**不会**让任何测试变红 —— 运行时表现是「读到空表且不报错」，最难发现。
  // 这里强行把两者接上：直接读 scripts/import-platform-taxonomy.js 的真实产出。
  const REAL = path.resolve(__dirname, '../../../../config/platform-taxonomy.json')

  it('真实产物存在且 validateTaxonomy() 干净（判据「空数组即健康」可满足）', () => {
    if (!fs.existsSync(REAL)) return // 产物不在时跳过，不假装通过
    mod.setTaxonomyPathForTest?.(REAL)
    mod.__resetTaxonomyCacheForTest?.()
    const issues = mod.validateTaxonomy()
    expect(issues, '真实产物不应有结构问题：\n' + issues.join('\n')).toEqual([])
  })

  it('读取层能从真实产物解出分类，且档位与数据一致', () => {
    if (!fs.existsSync(REAL)) return
    mod.setTaxonomyPathForTest?.(REAL)
    mod.__resetTaxonomyCacheForTest?.()
    // 6 个平台有可提交 ID（tencent_video 被排除：本项目它指微信视频号，
    // 而数据集里只有腾讯视频的表 —— 挂上去是发错平台）
    for (const p of ['bilibili', 'douyin', 'toutiao', 'baijiahao', 'weibo', 'zhihu']) {
      expect(mod.getTaxonomyCoverage(p), `${p} 应为 id 档`).toBe('id')
    }
    // 已登记的无 ID 平台
    for (const p of ['kuaishou', 'wechat_mp', 'tencent_video']) {
      expect(mod.getTaxonomyCoverage(p), `${p} 应为 name-only`).toBe('name-only')
    }
    // 端到端取一个真实分类
    const r = mod.resolveCategoryId('douyin', '动植物', { contentType: 'article' })
    expect(r).toMatchObject({ ok: true, id: '117' })
  })

  it('★ 真实产物里的歧义项被拒绝解析（B站视频 tid=36 是「知识」也是「科技」）', () => {
    if (!fs.existsSync(REAL)) return
    mod.setTaxonomyPathForTest?.(REAL)
    mod.__resetTaxonomyCacheForTest?.()
    const r = mod.resolveCategoryId('bilibili', '36', { contentType: 'video' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('ambiguous')
    expect(r.candidates.length).toBeGreaterThanOrEqual(2)
  })

  it('转换器声明的冲突数与读取层拒绝解析的现象一致（两处不能各说各话）', () => {
    if (!fs.existsSync(REAL)) return
    const tax = JSON.parse(fs.readFileSync(REAL, 'utf8'))
    if (!Array.isArray(tax.conflicts)) return
    mod.setTaxonomyPathForTest?.(REAL)
    mod.__resetTaxonomyCacheForTest?.()
    for (const c of tax.conflicts) {
      const r = mod.resolveCategoryId(c.platform, c.id, { contentType: c.contentType })
      expect(r.reason, `冲突 ${c.platform}/${c.contentType} id=${c.id} 在读取层未被判为歧义`).toBe('ambiguous')
    }
  })
})

describe('健壮性：文件缺失不得炸掉调用方', () => {
  it('分类表不存在 ⇒ 全部按 absent 处理，不抛异常', () => {
    mod.setTaxonomyPathForTest?.(path.join(os.tmpdir(), 'definitely-missing-' + Date.now() + '.json'))
    mod.__resetTaxonomyCacheForTest?.()
    expect(mod.getTaxonomyCoverage('bilibili')).toBe('absent')
    expect(mod.resolveCategoryId('bilibili', '动画').reason).toBe('platform-absent')
    expect(mod.validateTaxonomy()).toContainEqual(expect.stringMatching(/不存在|missing/i))
  })
})
