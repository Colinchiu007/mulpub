// @ts-check
/**
 * image-adapter-aspect-contract.test.js — 图片适配器宽高比参数契约结构锁
 *
 * ## 这道锁防的是什么（两次踩坑的共同教训）
 *
 * **第一次（2026-10-02，PR #2787）**：agnes-image.js 把 Agnes API 请求体字段名 `ratio`
 * 误用作输入参数契约名（`params.ratio`），而流水线统一契约键是 `aspect_ratio`
 * （asset-generator / story2video-stages）。参数名不匹配导致 Story2Video 竖屏（9:16）
 * 的生成请求被静默丢弃，永远回退 16:9 横屏：成片 720x1280 竖屏、两侧黑边
 * （实测项目 mur2tzc8_ru1r 的 segment_0000_image.png 为 2624x1472）。
 *
 * **第二次（2026-10-06，本次）**：#2787 只补了 agnes-image **一个**适配器，而当时项目
 * 里的 9 个图片适配器中有 6 个（openai-image / grok-image / recraft / flux /
 * local-diffusion / comfyui）**根本不读画幅**。于是换个图片 Provider 就原样复现。
 *
 * 两次的共同根因不是「某个适配器写错了」，而是**画幅契约没有单一真源，也没有一道
 * 覆盖全部适配器的锁**。本文件就是那道锁：
 *
 * - **穷举式**：动态扫描适配器目录，把所有「实现了 generateImage」的适配器都纳入检查，
 *   新增图片适配器若不消费画幅契约 → 本文件立即变红，**不再依赖人记得去改**。
 * - **单一真源**：所有适配器必须经 `_base/aspect-ratio.js` 的 readAspectRatio 读画幅，
 *   禁止各自发明解析（历史 bug 的形态正是「各自发明」）。
 * - **豁免显式化**：确实无法消费画幅的适配器（如 comfyui，尺寸在 workflow 图里）必须
 *   写进 EXEMPT_ADAPTERS 并附豁免理由，理由缺失同样变红——豁免必须是「显式决策」，
 *   不能是「 unnoticed 的漏网」。
 *
 * 定位：**结构锁**（扫描源码），不 mock 网络、不发请求。配套行为锁在各自 *.test.js 的
 * 「2026-10-06 回归」用例（真实执行 generateImage 并断言请求体/尺寸）。
 * 反证纪律：把任一适配器的解析改回只认单一键、或删掉 EXEMPT_ADAPTERS 里的理由注释，
 * 本文件对应断言立即变红。
 */

const fs = require('fs')
const path = require('path')

const ADAPTERS_DIR = path.join(__dirname)

/**
 * 豁免名单：文件名 → 豁免理由（必须非空）。
 * 新增条目时**必须**写清楚「为什么这个适配器拿不到画幅」以及「风险由谁承担」。
 */
const EXEMPT_ADAPTERS = Object.freeze({
  'comfyui.js':
    '尺寸写在 ComfyUI workflow 图（EmptyLatentImage 节点）里，不在 /prompt 请求体；'
    + '适配器当前不注入 workflow 模板，改为下发画幅无生效路径。'
    + '风险：ComfyUI 出图比例取决于用户自备 workflow，Story2Video 竖屏仍可能出横图；'
    + '待办：接入 workflow 模板时同步消费 readAspectRatio。',
})

function readSource(fileName) {
  return fs.readFileSync(path.join(ADAPTERS_DIR, fileName), 'utf8')
}

function listAdapterFiles() {
  return fs
    .readdirSync(ADAPTERS_DIR)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && !f.startsWith('_'))
    .sort()
}

describe('图片适配器宽高比参数契约结构锁', () => {
  describe('全量穷举：任何实现 generateImage 的适配器都必须消费画幅契约', () => {
    const imageAdapters = listAdapterFiles().filter((f) => /async\s+generateImage\s*\(/.test(readSource(f)))

    it('扫描确实发现了图片适配器（防止扫描规则本身失效而全绿）', () => {
      // 数量下界锚定：目前 9 个实现 generateImage 的图片适配器。
      // 减少不是问题（删除适配器），但若因重构改名/换写法导致扫描不到任何文件，
      // 下面那些逐个断言会全部空转通过 —— 这里把「空扫描」判为红灯。
      expect(imageAdapters.length).toBeGreaterThan(0)
    })

    it.each(imageAdapters)('%s 要么经 readAspectRatio 读画幅，要么在 EXEMPT_ADAPTERS 里显式豁免', (file) => {
      const source = readSource(file)
      if (Object.prototype.hasOwnProperty.call(EXEMPT_ADAPTERS, file)) return
      expect(source).toMatch(/readAspectRatio\s*\(/)
    })

    it('豁免名单的每条都必须写明理由（豁免是显式决策，不是漏网）', () => {
      for (const [file, reason] of Object.entries(EXEMPT_ADAPTERS)) {
        expect(typeof reason, `${file} 缺豁免理由`).toBe('string')
        expect(reason.trim().length, `${file} 的豁免理由不得为空`).toBeGreaterThan(10)
      }
    })

    it('豁免名单不得包含已消费画幅的适配器（防止滥用豁免把真 bug 藏起来）', () => {
      for (const file of Object.keys(EXEMPT_ADAPTERS)) {
        expect(readSource(file)).not.toMatch(/readAspectRatio\s*\(/)
      }
    })

    it('豁免名单里的文件必须真实存在（防改名后豁免变成空转）', () => {
      for (const file of Object.keys(EXEMPT_ADAPTERS)) {
        expect(fs.existsSync(path.join(ADAPTERS_DIR, file)), `${file} 不存在`).toBe(true)
      }
    })
  })

  describe('单一真源：_base/aspect-ratio.js 是画幅契约的唯一解析实现', () => {
    it('统一契约键顺序固定为 aspect_ratio > aspectRatio > ratio', () => {
      const source = readSource(path.join('_base', 'aspect-ratio.js'))
      expect(source).toMatch(/ASPECT_RATIO_CONTRACT_KEYS\s*=\s*Object\.freeze\(\[\s*'aspect_ratio',\s*'aspectRatio',\s*'ratio'/)
    })

    it('适配器不得自行拼接画幅参数名（禁止绕过单一真源）', () => {
      for (const file of listAdapterFiles()) {
        const source = readSource(file)
        if (!/async\s+generateImage\s*\(/.test(source)) continue
        if (Object.prototype.hasOwnProperty.call(EXEMPT_ADAPTERS, file)) continue
        // 允许经 readAspectRatio 转发；不允许出现 params.aspect_ratio || ... 这种自研优先级
        expect(source, `${file} 疑似自研画幅参数解析`).not.toMatch(
          /params\??\.\s*aspect_ratio\s*\|\|/
        )
      }
    })
  })

  describe('既有契约（2026-10-02 回归，不得回退）', () => {
    it('agnes-image.js 必须经单一真源读画幅（原内联三键表达式已收敛，行为等价）', () => {
      const source = readSource('agnes-image.js')
      expect(source).toMatch(/readAspectRatio\s*\(params\)/)
    })

    // 2026-10-23：视频侧的请求体构造收敛到 agnes-video-request.js（单一真源），
    // 显式画幅解析随之迁到该文件 ⇒ 结构锁改指新位置，**意图不变**：
    // 两个键名都要在（只认一个会让竖屏请求被静默丢弃、永远回退 16:9），
    // 且缺省时必须仍由宽高推导（两个分支都要在）。
    it('agnes-video-request.js 的显式画幅解析必须含 aspect_ratio 分支', () => {
      const source = readSource('agnes-video-request.js')
      expect(source).toMatch(/params\.aspect_ratio\s*\|\|\s*params\.aspectRatio/)
      expect(source).toMatch(/pickAspectRatio\(params\.width,\s*params\.height\)/)
    })

    it('minimax-image.js 必须经单一真源读画幅，并保留 size → 画幅 的既有兜底', () => {
      const source = readSource('minimax-image.js')
      expect(source).toMatch(/readAspectRatio\s*\(params\)\s*\|\|\s*parseAspectRatio/)
    })

    it('imagen.js 的 resolveAspectRatio 必须经单一真源读画幅（枚举归一仍在本适配器内）', () => {
      const source = readSource('imagen.js')
      expect(source).toMatch(/readAspectRatio\s*\(params\)/)
    })

    it('asset-generator.js 必须把 aspect_ratio 与 aspectRatio 双键传给 aiGenerator', () => {
      const source = readSource('../asset-generator.js')
      expect(source).toMatch(/aspect_ratio:\s*opts\.aspect_ratio/)
      expect(source).toMatch(/aspectRatio:\s*opts\.aspect_ratio/)
    })

    it('story2video-stages.js 的 generate_assets 阶段必须把 aspect_ratio 传给 assetGenerator 与 legacy 路径', () => {
      const source = readSource('../story2video-stages.js')
      expect(source).toMatch(/aspect_ratio:\s*aspectRatio/)
      expect(source).toMatch(/aspect_ratio:\s*aspectRatio,\s*\n\s*runId/)
    })
  })
})
