/**
 * 「未保存离开」守卫的覆盖面合同（UX-AUDIT-2026-10-17 阶段 0.5 / audit-3）
 *
 * audit-3 的原症状「文章写一半点侧边栏即丢草稿」对 Publish 不成立（keep-alive 保活，
 * 锁在 publish-draft-keepalive.test.js），成立范围收敛为**未被 include 的编辑态页面**。
 * 本文件就是那句"先枚举再挂"的执行体：判据不靠人记，靠扫。
 *
 * 判据：src/views/**\/*.vue 里含「用户可输入正文」形态（<textarea> 带 v-model）的视图，
 * 三者必须成立其一 —— ① 在 App.vue 的 keep-alive include 内 ② 已挂 useUnsavedLeaveGuard
 * ③ 在 DEBT 里带 reason 承认。清单只能缩小；新增未守卫的编辑视图当场判红。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const VIEWS_DIR = path.resolve(__dirname, 'views')
const APP_VUE = path.resolve(__dirname, 'App.vue')

function listViews (dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listViews(full, out)
    else if (entry.isFile() && entry.name.endsWith('.vue')) out.push(full)
  }
  return out
}

function keepAliveInclude () {
  const src = fs.readFileSync(APP_VUE, 'utf8')
  const m = src.match(/<keep-alive\s+:include="(\[[^\]]*\])"/)
  if (!m) throw new Error('App.vue 里找不到 keep-alive 的 :include 表达式 —— 判据的坐标已失效')
  return JSON.parse(m[1].replace(/'/g, '"'))
}

// 已承认的欠账：必须写 reason。收敛一条就删一条（不删即报陈旧）。
// 每条的 reason 都来自当场 grep 实况（有无 autosave / 落真源的出口），不是凭视图名猜。
const DEBT = {
  'views/CreateView.vue': '5034 行超大视图；本审计明确不重构它（§5「不做的事」），'
    + '守卫需在自身拆分批次里逐块挂，届时删除本条',
  'views/ResultView.vue': '1889 行 options API 视图；正文编辑经 story2video 场景 service 落库'
    + '（实测 :937/:1083 有 persisted 路径），是否仍需离开拦截取决于「编辑未提交」窗口有多长，'
    + '归阶段 3 该视图自身批次裁决',
  'views/HotTopics.vue': '已有显式保存出口 draftSave(:696) 与 persistEditedDrafts(:760)，'
    + '但两者都是手动触发（实测全文件无 watch/localStorage 自动落盘）⇒ 确有离开丢失风险，'
    + '守卫需在阶段 2 的「编辑草稿」批次一并挂',
  'views/AutoPipelineView.vue': '实测该文件无 watch/localStorage/draftSave/store 任何自动落盘出口'
    + '⇒ textarea 内容离开即丢；本批先登记，守卫与管线编辑态一起收（阶段 2）',
  'views/ContactSheetView.vue': '实测无自动落盘出口；联系表单文本离开即丢。'
    + '与阶段 1.10「帮助与支持」指向的反馈表单同属一条链，届时随该批一起挂守卫',
  'views/PodcastChannelView.vue': 'channelForm.description / editingEpisode.description '
    + '实测无自动落盘出口；播客频道与单集描述的保存走显式提交，归阶段 2 播客链一起收',
  'views/PromptEvalView.vue': '367 行提示词评测试验台，form.sourceText/context/optimizedPrompt '
    + '实测无自动落盘出口；输入更像一次性的评测参数而非作品正文，是否值得打扰用户需在阶段 2 '
    + '评测批次里按「误拦代价」裁决（恒打扰与恒不拦同样是缺陷）',
  'views/Collection.vue': '采集页有 useCollectionDrafts 的手动草稿出口（draftSave），'
    + '实测无 watch/localStorage 自动落盘 ⇒ 确有离开丢失风险；与阶段 2 的采集页 onMounted '
    + '改造同批挂守卫',
}

describe('未保存离开守卫的覆盖面', () => {
  const included = keepAliveInclude()
  const files = listViews(VIEWS_DIR)
  const editable = []
  const missing = []

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    const rel = path.relative(path.resolve(__dirname), file).replace(/\\/g, '/')
    const name = path.basename(file, '.vue')
    // 用户可输入正文的形态：<textarea v-model="...">（含多行写法）
    if (!/<textarea[^>]*v-model=/is.test(src.replace(/\r/g, ''))) continue
    editable.push(rel)
    const guarded = /useUnsavedLeaveGuard/.test(src)
    if (included.includes(name) || guarded || DEBT[rel]) continue
    missing.push(rel)
  }

  it('判定域非空：确实扫到了带正文输入的编辑视图（防解析退化成空集假绿）', () => {
    expect(files.length).toBeGreaterThan(30)
    expect(editable.length).toBeGreaterThan(3)
    expect(included).toContain('Publish')
  })

  it('每个编辑视图都要么保活、要么挂守卫、要么在欠账里写明理由', () => {
    expect(missing).toEqual([])
  })

  it('欠账清单只能缩小：登记的项必须仍在判定域里（删除守卫后不许留陈旧豁免）', () => {
    const stale = Object.keys(DEBT).filter(k => !editable.includes(k))
    expect(stale).toEqual([])
  })

  it('RewriteView 已挂守卫，且脏判据是内容级而非恒真', () => {
    const src = fs.readFileSync(path.resolve(VIEWS_DIR, 'RewriteView.vue'), 'utf8')
    expect(src).toMatch(/useUnsavedLeaveGuard\(\{[\s\S]*isDirty:\s*\(\)\s*=>/)
    expect(src).toMatch(/!savedDraftId/)
  })
})
