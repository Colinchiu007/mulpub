import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * T1-5 图标使用守卫（源码级，参照 Home.todo-guard / shell-mode-6a 先例）
 *
 * 规则（docs/frontend-interaction-spec.md 图标语义）：
 * 1. **功能图标位**（按钮/标题装饰/卡片图标/导航项）禁止 emoji，一律 @element-plus/icons-vue；
 * 2. **状态类 emoji 允许**：✅ ❌ ⚠️ ⏳ 🔄（表达结果/进行中，不是功能图标）；
 * 3. **内容/文案类 emoji 允许**：营销话术、引导语、元信息标签（👍 💬 🏷 等语义化修饰）；
 * 4. 本卡先行收敛 4 个文件（Intelligence/Dashboard/ViralAnalysis/Collection），
 *    后续逐批纳入更多文件（每批纳入即在 FILES 中登记，防止回退）。
 */

const srcDir = join(dirname(fileURLToPath(import.meta.url)))

/** 已进入收敛范围的文件（新增文件请在此登记） */
const FILES = [
  'views/Intelligence.vue',
  'views/Dashboard.vue',
  'views/ViralAnalysis.vue',
  'views/Collection.vue',
  'views/ModelProviders.vue',
  'views/CreateView.vue',
  'components/UpgradeModal.vue',
  'components/AiWriterPanel.vue',
]

/** 功能图标位禁用 emoji（不含状态类/内容类） */
const ICON_EMOJI = ['📊', '📈', '📉', '📝', '📋', '💡', '🔗', '⚡', '📄', '✨', '🔥', '🔑', '⚙️', '🚀', '🎯', '🔍', '💾', '📚', '🎬', '🗂', '🗑', '👁']

describe('T1-5 图标使用守卫：功能图标位禁用 emoji', () => {
  for (const rel of FILES) {
    it(`${rel} 无功能图标位 emoji`, () => {
      const content = readFileSync(join(srcDir, rel), 'utf8')
      const hits = ICON_EMOJI.filter((e) => content.includes(e)).map((e) => e)
      expect(hits, `发现功能图标位 emoji: ${hits.join(' ')}`).toEqual([])
    })
  }

  it('状态类 emoji 允许存在（不是为了清空所有 emoji）', () => {
    // 守卫只针对功能图标位；状态类 ✅/❌ 在 Dashboard 中仍在用
    const dash = readFileSync(join(srcDir, 'views/Dashboard.vue'), 'utf8')
    expect(dash).toContain('✅')
  })
})
