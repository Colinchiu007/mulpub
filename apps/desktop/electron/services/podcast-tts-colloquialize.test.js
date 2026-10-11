'use strict'
/**
 * 刀 4 第 3 片·下半（口语化层）行为锁。
 *
 * 锁的重点在**方向**上：
 * - 「不合格输出被丢弃并回退原文」必须是行为断言（断言返回的 content 逐字等于输入），
 *   而不是断言"reason 字段写了什么"——reason 是给人看的，回退才是成果。
 * - 旁路（无 provider / 调用异常 / 空返回 / 结构不合格）一律**不拒绝出期**；
 *   把可选增强做成硬前提，等于让一个不影响正确性的环节决定用户能否发布。
 * - `platform` 不得进 prompt 是 PRD §7.4.1 的明写口径，靠**函数签名 + 源码扫描**两条一起守
 *   （只测一条时，下一次有人加参数就漏）。
 */
import { describe, it, expect, vi } from 'vitest'
const path = require('node:path')

const MODULE = path.resolve(__dirname, 'podcast-tts-colloquialize.js')
async function load () { return import(MODULE) }

const THREE_PARAS = '第一段有结论。\n\n第二段是展开说明。\n\n第三段收尾'

describe('buildColloquializePrompt —— 单点 prompt 与字段边界', () => {
  it('system 取自模块单点常量，user 只含标题与正文', async () => {
    const { buildColloquializePrompt, SYSTEM_PROMPT } = await load()
    const p = buildColloquializePrompt({ title: '本期话题', content: '正文内容' })
    expect(p.system).toBe(SYSTEM_PROMPT)
    expect(p.user).toContain('【标题】本期话题')
    expect(p.user).toContain('【正文】\n正文内容')
  })

  it('无标题时不产出空的标题行（空标题行会诱导模型补一个标题）', async () => {
    const { buildColloquializePrompt } = await load()
    const p = buildColloquializePrompt({ content: '只有正文' })
    expect(p.user.indexOf('【标题】')).toBe(-1)
    expect(p.user.startsWith('【正文】')).toBe(true)
  })

  it('platform 不得进 prompt：签名只有 title/content，且源码里 prompt 构造函数不出现 platform', async () => {
    const { buildColloquializePrompt } = await load()
    expect(buildColloquializePrompt.length).toBeLessThanOrEqual(1)
    const fs = require('node:fs')
    const src = fs.readFileSync(MODULE, 'utf8')
    const start = src.indexOf('function buildColloquializePrompt')
    const end = src.indexOf('\n}', start)
    expect(src.slice(start, end)).not.toMatch(/platform/)
    expect(src).not.toMatch(/【平台】/)
  })

  it('system 里明确禁止增删段落与改动段尾标点（否则下游客观校验无依据）', async () => {
    const { SYSTEM_PROMPT } = await load()
    expect(SYSTEM_PROMPT).toContain('不得增加、删除、合并任何换行')
    expect(SYSTEM_PROMPT).not.toContain('按空行分段')
    expect(SYSTEM_PROMPT).toContain('最后一个字符必须与该段输入时的最后一个字符相同')
    expect(SYSTEM_PROMPT).toContain('markdown 代码块围栏')
  })
})

describe('checkStructure —— 分段结构不变量', () => {
  it('段数不同即不合格（模型合并段落是最常见的失真）', async () => {
    const { checkStructure } = await load()
    expect(checkStructure(THREE_PARAS, '第一段有结论。\n\n第二段是展开说明。').ok).toBe(false)
    expect(checkStructure(THREE_PARAS, THREE_PARAS).ok).toBe(true)
  })

  it('空行位置必须保持（在段落之间插空行同样改变块边界）', async () => {
    const { checkStructure } = await load()
    expect(checkStructure('甲。\n\n乙。', '甲。\n\n\n乙。').ok).toBe(false)
  })

  it('段尾补标点 / 换标点 / 删标点三种失真各自独立判不合格', async () => {
    const { checkStructure } = await load()
    expect(checkStructure('收尾', '收尾。').ok).toBe(false)
    expect(checkStructure('收尾。', '收尾！').ok).toBe(false)
    expect(checkStructure('收尾。', '收尾').ok).toBe(false)
    expect(checkStructure('收尾。', '收尾说完了。').ok).toBe(true)
  })

  it('reason 只含结构与下标，不含用户文本（日志不得落用户正文）', async () => {
    const { checkStructure } = await load()
    const r = checkStructure('机密句子。\n\n另一段机密。', '机密句子。\n\n另一段机密！')
    expect(r.ok).toBe(false)
    expect(r.reason).not.toMatch(/机密/)
    expect(r.reason).toBe('last_char_changed_at:2')
  })
})

describe('colloquializeCopy —— 采用与旁路的方向', () => {
  it('结构合格的改写被采用，applied=true', async () => {
    const { colloquializeCopy, COLLOQUIALIZE_REASONS } = await load()
    const out = await colloquializeCopy({
      content: THREE_PARAS,
      invoke: async () => '第一段有结论。\n\n第二段展开了说。\n\n第三段收尾',
    })
    expect(out.applied).toBe(true)
    expect(out.reason).toBe(COLLOQUIALIZE_REASONS.APPLIED)
    expect(out.content).toBe('第一段有结论。\n\n第二段展开了说。\n\n第三段收尾')
  })

  it('整份被代码块围栏包住时先剥壳再判（剥壳不得吞掉段间空行）', async () => {
    const { colloquializeCopy } = await load()
    const out = await colloquializeCopy({
      content: THREE_PARAS,
      invoke: async () => '```text\n第一段有结论。\n\n第二段是展开说明。\n\n第三段收尾\n```',
    })
    expect(out.applied).toBe(true)
    expect(out.content.indexOf('```')).toBe(-1)
    expect(out.content.split('\n').length).toBe(THREE_PARAS.split('\n').length)
  })

  it('结构不合格 ⇒ 逐字回退原文并出声一次，绝不部分采用', async () => {
    const { colloquializeCopy, COLLOQUIALIZE_REASONS } = await load()
    const warn = vi.fn()
    const out = await colloquializeCopy({
      content: THREE_PARAS,
      warn,
      invoke: async () => '只有一段被合并后的文本。',
    })
    expect(out).toEqual({ content: THREE_PARAS, applied: false, reason: COLLOQUIALIZE_REASONS.STRUCTURE_REJECTED })
    expect(out.content).toBe(THREE_PARAS)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('分段结构')
  })

  it('无 invoke（没配 provider）走旁路：原文照出、拒绝出期不是这里的口径', async () => {
    const { colloquializeCopy, COLLOQUIALIZE_REASONS } = await load()
    const out = await colloquializeCopy({ content: THREE_PARAS })
    expect(out).toEqual({ content: THREE_PARAS, applied: false, reason: COLLOQUIALIZE_REASONS.NO_PROVIDER })
  })

  it('enabled=false 时一个 LLM 调用都不发起（计费前置，不是"调了再丢结果"）', async () => {
    const { colloquializeCopy, COLLOQUIALIZE_REASONS } = await load()
    const invoke = vi.fn(async () => '不该被用到')
    const out = await colloquializeCopy({ content: THREE_PARAS, enabled: false, invoke })
    expect(out.reason).toBe(COLLOQUIALIZE_REASONS.NOT_ENABLED)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('调用异常与空返回各自旁路，异常只出声一次且不含用户正文', async () => {
    const { colloquializeCopy, COLLOQUIALIZE_REASONS } = await load()
    const warn = vi.fn()
    const boom = await colloquializeCopy({
      content: '机密正文。\n\n另一段。',
      warn,
      invoke: async () => { throw new Error('provider 超时') },
    })
    expect(boom).toEqual({ content: '机密正文。\n\n另一段。', applied: false, reason: COLLOQUIALIZE_REASONS.INVOKE_FAILED })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).not.toMatch(/机密/)
    // F2：异常分支只准记类型。注入侧 message 常带请求体片段，落进日志就是泄漏用户正文
    expect(String(warn.mock.calls[0][0])).not.toMatch(/provider 超时/)
    expect(String(warn.mock.calls[0][0])).toContain('Error')

    const empty = await colloquializeCopy({ content: THREE_PARAS, invoke: async () => '   ' })
    expect(empty.reason).toBe(COLLOQUIALIZE_REASONS.EMPTY_OUTPUT)
    expect(empty.content).toBe(THREE_PARAS)
  })

  it('非字符串返回（对象/undefined）按空处理，不把 [object Object] 喂进分块层', async () => {
    const { colloquializeCopy, COLLOQUIALIZE_REASONS } = await load()
    for (const bad of [undefined, null, { text: '甲。' }, 42]) {
      const out = await colloquializeCopy({ content: THREE_PARAS, invoke: async () => bad })
      expect(out.applied).toBe(false)
      expect(out.reason).toBe(COLLOQUIALIZE_REASONS.EMPTY_OUTPUT)
    }
  })
})

describe('本层不得自己走出站（口语化只在宿主注入的通道上跑）', () => {
  it('源码 require 只允许零依赖，且代码里不出现网络/provider 字面量', () => {
    const fs = require('node:fs')
    const src = fs.readFileSync(MODULE, 'utf8')
    const requires = [...src.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => m[2])
    expect(requires).toEqual([])
    // 必须先剥注释再扫：本文件的注释**如实写着**「由宿主绑定 ai-generator 的 chatCompletion」，
    // 不剥注释这条锁会把文档当代码命中（同仓「结构锁不剥注释 = 幽灵通道」的镜像形态——这里反过来会造假红）。
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/\b(fetch|axios|http\.request|https\.request|chatCompletion|callModel|AssetGenerator)\b/)
    // 码表单点：旁路只回 reason，不另造用户可见码
    expect([...new Set([...code.matchAll(/'PODCAST_[A-Z_]+'/g)].map((x) => x[0]))]).toEqual([])
  })
})

describe('QM-6 F1/F2 的能变红锁（2026-10-11）', () => {
  it('F1：prompt 与校验器的段定义必须是同一个（单个换行），不得再出现空行分段字样', async () => {
    const { SYSTEM_PROMPT, checkStructure } = await load()
    expect(SYSTEM_PROMPT).toContain('不得增加、删除、合并任何换行')
    expect(SYSTEM_PROMPT).not.toContain('空行分段')
    // 三段（按单换行=5 行）被合并成一行：块边界变了，必须整份拒
    const five = '甲。' + String.fromCharCode(10) + String.fromCharCode(10) + '乙。' + String.fromCharCode(10) + String.fromCharCode(10) + '丙。'
    expect(checkStructure(five, '甲。乙。丙。').ok).toBe(false)
    expect(checkStructure(five, five).ok).toBe(true)
  })

  it('F2：调用异常的日志只准记错误类型，既不得落用户正文也不得落 message 原文', async () => {
    const { colloquializeCopy, COLLOQUIALIZE_REASONS } = await load()
    const warn = vi.fn()
    const secret = '机密正文段一。' + String.fromCharCode(10) + String.fromCharCode(10) + '机密正文段二。'
    const out = await colloquializeCopy({
      content: secret,
      warn,
      invoke: async () => { throw Object.assign(new Error('provider 超时：正文片段 ' + secret), { name: 'TimeoutError' }) },
    })
    expect(out.applied).toBe(false)
    expect(out.reason).toBe(COLLOQUIALIZE_REASONS.INVOKE_FAILED)
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0][0])
    expect(line).toContain('TimeoutError')
    expect(line).not.toMatch(/provider 超时/)
    expect(line).not.toMatch(/机密/)
  })
})
