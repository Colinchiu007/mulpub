/**
 * user-facing-error.call-site.test.js — 调用点口径（UX 审计 3.8 首批 / 维度 13 敏感信息外泄）
 *
 * 被修的形态：知识库/采集面板 4 处 + 发布频率设置 4 处 + 表现洞察 1 处，共 9 处
 * `ElMessage.error((res && res.message) || t('…'))` 把主进程/后端的**英文原文**直出给用户
 * （`Error: write ECONNREFUSED 127.0.0.1:8000`、`Command failed: …`、内部路径），
 * 既是"看不懂的文案"，也是内部信息外泄。
 *
 * 两条容易写错的边界，本文件各有一条锁：
 *  ① **不能**简单地用 `formatUserError(x).message` —— 认不出时它会给通用兜底
 *     （把「草稿加载失败」这种页面专属信息换成「操作失败」= 信息量下降），
 *     还会在 `matched='passthrough'` 时**原样透出**技术串（等于没修）。
 *  ② 分类结果只有"真的认出来了"（errorCode / code / pattern）才可用。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatUserError, userFacingErrorMessage } from '@/utils/user-facing-error'

const HERE = dirname(fileURLToPath(import.meta.url))
// 被锁的调用点在 src/components 与 src/views 下，本文件在 src/utils ⇒ 必须回到 src 再拼。
const SRC_ROOT = join(HERE, '..')
const SRC = (rel) => readFileSync(join(SRC_ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

// 被禁的形态：把 IPC/后端返回的 message 原样直出给用户（技术串外泄 + 用户看不懂）
const FORBIDDEN_RE = /ElMessage\.[a-z]+\(\((?:res|e|err|result|data) && (?:res|e|err|result|data)\.message\) \|\|/

/** 递归收集扫描域内的渲染端源文件（排除测试与 locale 表） */
function scanDomain (dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (ent.name === 'locales' || ent.name === 'node_modules') continue
      scanDomain(join(dir, ent.name), out)
      continue
    }
    if (!ent.isFile()) continue
    const ext = extname(ent.name)
    if ((ext !== '.vue' && ext !== '.js') || ent.name.endsWith('.test.js')) continue
    out.push(join(dir, ent.name))
  }
  return out
}

describe('userFacingErrorMessage · 调用点口径', () => {
  it('技术串不得透出：ECONNREFUSED / IP:端口 一律被换成分类文案', () => {
    const out = userFacingErrorMessage({ message: 'Error: write ECONNREFUSED 127.0.0.1:8000' }, 'FALLBACK')
    expect(out).toBeTruthy()
    expect(out).not.toContain('ECONNREFUSED')
    expect(out).not.toContain('127.0.0.1')
    expect(out).not.toContain('8000')
  })

  it('认不出时保留页面专属兜底（不得被通用「操作失败」顶掉——那是信息量下降）', () => {
    // 前提自证：passthrough 这一档确实存在，否则下面这条断言测的是一个不发生的分支
    const probe = formatUserError('后端返回的一段人话说明')
    expect(probe.matched, '分类器不再产出 passthrough ⇒ 本文件的第二条锁需要重估').toBe('passthrough')
    expect(userFacingErrorMessage('后端返回的一段人话说明', () => 'PAGE_FALLBACK')).toBe('PAGE_FALLBACK')
  })

  it('已知 errorCode 走分类文案；输入为空也走兜底，不抛错', () => {
    const known = userFacingErrorMessage({ errorCode: 'NETWORK_ERROR' }, 'FALLBACK')
    expect(known).toBeTruthy()
    expect(known).not.toBe('FALLBACK')
    expect(userFacingErrorMessage(null, 'FALLBACK')).toBe('FALLBACK')
    expect(userFacingErrorMessage(undefined, () => 'LATE')).toBe('LATE')
  })
})

describe('调用点已收敛到同一份口径', () => {
  const files = [
    'components/PatternAnalysisPanel.vue',
    'components/PersonalKnowledgePanel.vue',
    'components/ViralLibraryTable.vue',
    'views/KnowledgeBasePage.vue',
    'components/PublishFrequencySettings.vue',
    'views/PerformanceInsights.vue',
  ]
  for (const rel of files) {
    it(rel + '：走 userFacingErrorMessage，且不再把 res.message 直出', () => {
      const s = SRC(rel)
      expect(s).toMatch(/import \{ userFacingErrorMessage \} from '@\/utils\/user-facing-error'/)
      expect(s).toMatch(/ElMessage\.error\(userFacingErrorMessage\((?:res|e), \(\) => t\('[^']+'\)\)\)/)
      expect(s).not.toMatch(FORBIDDEN_RE)
    })
  }
})

describe('禁形态全域棘轮：存量必须为 0（只能保持 0）', () => {
  it('扫描域非空且规模可观（否则"零命中"只是探针失明）', () => {
    const files = scanDomain(SRC_ROOT)
    expect(files.length, '扫描域退化 ⇒ 本棘轮看不见任何东西').toBeGreaterThan(100)
    // 正向对偶：域内确实存在 ElMessage.error( 的调用，否则 FORBIDDEN_RE 恒零命中没有意义
    const withElMessageError = files.filter((f) => /ElMessage\.error\(/.test(readFileSync(f, 'utf8')))
    expect(withElMessageError.length, '域内一条 ElMessage.error 都没有 ⇒ 棘轮保护面为空').toBeGreaterThan(10)
  })

  it('渲染端源码不再出现 ElMessage.*((x && x.message) || …) 的直出形态', () => {
    const hits = []
    for (const f of scanDomain(SRC_ROOT)) {
      const src = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
      const lines = src.split('\n')
      lines.forEach((line, i) => {
        if (FORBIDDEN_RE.test(line)) hits.push(f.slice(SRC_ROOT.length + 1) + ':' + (i + 1))
      })
    }
    // 本 PR 把 9 处（4 知识库 + 4 发布频率 + 1 表现洞察）收敛为 0；新增即红，不得放宽
    expect(hits, '禁形态回潮：' + hits.join(' | ')).toEqual([])
  })
})
