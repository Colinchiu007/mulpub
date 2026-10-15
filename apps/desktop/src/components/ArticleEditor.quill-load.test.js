/**
 * ArticleEditor.quill-load.test.js — **真实 Quill**（不 mock）装载回归
 *
 * 与 `ArticleEditor.test.js` 的分工：那边在组件边界断言「传给 Quill 的 content 属性」，
 * 快而稳；本文件把真正的 `@vueup/vue-quill` 装进 jsdom，直接读编辑器 DOM 的 `<p>` 数 ——
 * 因为本次事故的机理正是「Quill 把纯文本当 HTML 写进 root.innerHTML」，只有真跑一遍
 * 才能证明「装载后编辑器里确实是多段」，而不是「属性值看着对、真编辑器仍是一段」。
 *
 * 反证（本地实测，2026-10-15）：把 ArticleEditor.vue 的 `get` 改回 `props.modelValue`
 * ⇒ 本文件「两段」用例当场红（编辑器里只剩 1 个 `<p>`，且段间文字黏连）。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import i18n from '@/i18n'
import ArticleEditor from './ArticleEditor.vue'

/** Quill 实例化是异步的（loadQuill() + 一次 MutationObserver 轮询），按 tick+定时器推进等待 */
async function mountRichEditor (modelValue) {
  const w = mount(ArticleEditor, {
    props: { modelValue },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  for (let i = 0; i < 60; i++) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 5))
    if (w.find('.ql-editor').exists() && w.find('.ql-editor').element.innerHTML.trim()) break
  }
  return w
}

function paragraphs (w) {
  return [...w.find('.ql-editor').element.querySelectorAll('p')]
}

describe('ArticleEditor × 真实 Quill — 段落结构（百家号「一整段」根因回归）', () => {
  it('纯文本两段装载 ⇒ 编辑器里是两个 <p>（不是一个）', async () => {
    const w = await mountRichEditor('第一段\n\n第二段')
    const ps = paragraphs(w)
    expect(ps.length).toBe(2)
    expect(ps[0].textContent).toBe('第一段')
    expect(ps[1].textContent).toBe('第二段')
    w.unmount()
  })

  it('六段源文装载 ⇒ 六个 <p>（本次线上事故的真实形态）', async () => {
    const src = ['一', '二', '三', '四', '五', '六'].join('\n\n')
    const w = await mountRichEditor(src)
    const ps = paragraphs(w)
    expect(ps.length).toBe(6)
    expect(ps.map((p) => p.textContent).join('')).toBe('一二三四五六')
    w.unmount()
  })

  it('已是 HTML 的内容装载 ⇒ 原样渲染，不二次包装', async () => {
    const w = await mountRichEditor('<p>甲</p><p>乙</p>')
    const ps = paragraphs(w)
    expect(ps.length).toBe(2)
    expect(ps.map((p) => p.textContent).join('')).toBe('甲乙')
    w.unmount()
  })

  it('代码片段不被当标签：<stdio.h> 以文本形态保留（白名单判据）', async () => {
    const w = await mountRichEditor('#include <stdio.h>')
    const ps = paragraphs(w)
    expect(ps.length).toBe(1)
    expect(ps[0].textContent).toBe('#include <stdio.h>')
    w.unmount()
  })
})
