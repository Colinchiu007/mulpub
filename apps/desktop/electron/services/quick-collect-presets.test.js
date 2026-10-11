/**
 * quick-collect-presets — 内置官方指令目录
 *
 * 最硬的一条：`builtin-ai-trends` 的提示词必须与用户给定文本**逐字一致**
 * （下面对照串独立于实现文件手录，抄错即红 —— 它是本次需求的原文，不是实现的回声）。
 */
import { describe, it, expect } from 'vitest'

const AI_TRENDS_PROMPT = "请检索过去48小时内AI与新技术领域的真实动态，覆盖三类：1) 主流大模型/AI框架（如OpenAI、Anthropic、Deepseek、GLM、Kimi、SeeDance、Llama、PyTorch、vLLM等）的新版本发布或安全公告；2) GitHub上热度上升、值得工程师试用的新AI项目；3) 其他对你判断'值不值得关注'有重大影响的事件。输出一份简短摘要：3-5条'建议关注'（每条含事件、来源链接、为什么重要、建议动作），2-3条'可忽略'一句话带过。用中文，不要编造，找不到可靠信息就如实说。"

async function mod () {
  return import('../services/quick-collect-presets')
}

describe('quick-collect-presets', () => {
  it('内置 6 条且 id 唯一、全部 builtin', async () => {
    const { listPresetCommands } = await mod()
    const list = listPresetCommands()
    expect(list).toHaveLength(6)
    expect(new Set(list.map((c) => c.id)).size).toBe(6)
    expect(list.every((c) => c.builtin === true)).toBe(true)
    expect(list.map((c) => c.id)).toEqual([
      'builtin-ai-trends',
      'builtin-platform-policy',
      'builtin-hot-topics',
      'builtin-dev-tools',
      'builtin-peer-content',
      'builtin-risk-alert',
    ])
  })

  it('S1 补遗：中文热榜词条吃到全部垂类信道，创作工具词条吃到垂类科技', async () => {
    const { PRESET_COMMANDS } = await mod()
    const hot = PRESET_COMMANDS.find((c) => c.id === 'builtin-hot-topics')
    expect(hot.sources).toContain('sina_finance')
    expect(hot.sources).toContain('ithome_tech')
    const dev = PRESET_COMMANDS.find((c) => c.id === 'builtin-dev-tools')
    expect(dev.sources).toContain('ithome_tech')
    // 垂类不得混进只讲英文社区的词条（如舆情风险维持 weibo + ithome + 英文检索）
    const risk = PRESET_COMMANDS.find((c) => c.id === 'builtin-risk-alert')
    expect(risk.sources).not.toContain('sina_finance')
  })

  it('AI 领域动向提示词与用户给定文本逐字一致（AC-10）', async () => {
    const { getPresetCommand } = await mod()
    expect(getPresetCommand('builtin-ai-trends').prompt).toBe(AI_TRENDS_PROMPT)
  })

  it('每条内置指令都通过统一校验（同口径，不得自带非法值）', async () => {
    const { listPresetCommands } = await mod()
    const { validateQuickCollectCommand } = await import('../services/quick-collect-command')
    for (const preset of listPresetCommands()) {
      const r = validateQuickCollectCommand(preset)
      expect(r.ok, preset.id + ':' + String(r.code)).toBe(true)
      expect(preset.keywords.length).toBeLessThanOrEqual(3) // 引擎只取前 3 个，多写等于白写
      expect(preset.title.length).toBeLessThanOrEqual(40)
      expect(preset.summary.length).toBeLessThanOrEqual(80)
    }
  })

  it('listPresetCommands 返回深拷贝：改返回值不影响下次读取', async () => {
    const { listPresetCommands } = await mod()
    const first = listPresetCommands()
    first[0].title = '被改坏了'
    first[0].keywords.push('被改坏了')
    const second = listPresetCommands()
    expect(second[0].title).not.toBe('被改坏了')
    expect(second[0].keywords).not.toContain('被改坏了')
    expect(second).toHaveLength(6)
  })

  it('getPresetCommand 未知 id 返回 null；PRESET_IDS 与实际一致', async () => {
    const { getPresetCommand, PRESET_IDS, listPresetCommands } = await mod()
    expect(getPresetCommand('nope')).toBeNull()
    expect([...PRESET_IDS]).toEqual(listPresetCommands().map((c) => c.id))
  })
})
