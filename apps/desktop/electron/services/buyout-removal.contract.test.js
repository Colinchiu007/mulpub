/**
 * 买断授权模型移除契约锁（remove-buyout-license，2026-10-17）
 *
 * 为什么需要源码级契约锁，而不是只写行为测试：
 * 「某形态已被移除」这个事实，行为测试证明不了 —— 删掉的功能没有调用方，
 * 测试自然也不会去点它。能证明"不再存在"的只有对产物本身的断言。
 *
 * 本文件锁两类东西：
 *   ① **买断形态不得回归**：¥99/永久文案、payment:* 通道、本地下单/授权写入路径
 *   ② **存量数据不得因清理而受损**：历史 lifetime 授权必须迁移为 pro 而非降级
 *
 * 第 ② 类是本次最容易出错的地方：`lifetime` 类型在全仓只被读、从不被写
 * （仅 license-manager.js 两处判断），看起来像死代码可以直接删；但**历史上可能
 * 已经写入过这种数据**。直接删判断 = 让那批已付费用户静默降级为免费。
 * 正解是加载时规范化 lifetime → pro，再删掉所有 lifetime 判断。
 *
 * ⚠️ 位置说明：本文件**必须**放在 `electron/services/` 下。`apps/desktop/vitest.config.js`
 * 的 include 是白名单（`src/**`、`electron/services/**`、`electron/publishers/**` 等），
 * 放在 `electron/` 根目录**一个测试都不会跑而 CI 仍然全绿** —— 该配置里有同样的警告注释，
 * 本仓 startup-compat.test.js 曾因此逃逸过一次。
 */
const fs = require('fs')
const path = require('path')

// license-manager 的加解密密钥由 `scryptSync(app.getPath('userData'), salt, 32)` 派生
// （见其 L43/L56/L92），纯 Node 测试环境下 `require('electron').app` 是 undefined，
// 于是 save() 直接崩、文件根本写不出来。这里把 app 打桩成**固定**的 userData 路径：
// 密钥因此稳定，encrypt/save 与 decrypt/load 才能round-trip。
// 注意路径必须固定 —— 每次返回不同目录会让密钥变化、已写文件解不开。
vi.mock('electron', () => ({
  app: { getPath: () => require('os').tmpdir(), isPackaged: false },
}))

// rel 相对本文件所在目录（apps/desktop/electron/services/）解析
function read (rel) {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8')
}
function exists (rel) {
  return fs.existsSync(path.join(__dirname, rel))
}

/**
 * 剥离注释后再做"不得出现 X"的断言。
 * 为什么要剥：清理时**应该**在注释里记录「原先是 X、为什么删」，那是给下一个人
 * 的线索；如果源码扫描连注释一起判红，等于逼人把历史说明也删掉，反而丢信息。
 */
function stripComments (s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '')
}

describe('买断授权模型移除契约锁', () => {
  describe('① 买断链路的代码产物必须已删除', () => {
    it('payment-manager 服务必须已删除（¥99 一次性买断的唯一来源）', () => {
      expect(
        exists('../services/payment-manager.js'),
        'services/payment-manager.js 仍存在：它是 ¥99 买断的唯一来源，且其 activate 链路已被 S1 切断（支付成功也不授权）'
      ).toBe(false)
    })

    it('payment IPC handler 必须已删除', () => {
      expect(exists('../ipc-handlers/payment.js'), 'ipc-handlers/payment.js 仍存在').toBe(false)
    })

    it('ipc-handlers/index.js 不得再注册 payment handler', () => {
      const src = read('../ipc-handlers/index.js')
      expect(src).not.toMatch(/require\(['"]\.\/payment['"]\)/)
    })

    it('IPC 通道白名单不得再登记任何 payment:* 通道', () => {
      const src = read('../ipc-handlers/license-access-control.js')
      const hits = src.match(/['"]payment:[a-z-]+['"]/g) || []
      expect(
        hits,
        '白名单仍登记 payment 通道：' + hits.join(', ') + '（通道本身已删，登记项会变成悬空权限）'
      ).toEqual([])
    })

    it('preload 不得再暴露 payment* 桥接', () => {
      for (const f of ['../preload/access-control.js', '../preload/system.js']) {
        const src = stripComments(read(f))
        const hits = src.match(/\bpayment[A-Z]\w+/g) || []
        expect(hits, f + ' 仍暴露 payment 桥接：' + hits.join(', ')).toEqual([])
      }
    })

    it('渲染层不得再导出 payment* API 封装', () => {
      const src = stripComments(read(path.join('..', '..', 'src', 'api', 'publisher.js')))
      const hits = src.match(/\bpayment(?:CreateOrder|ListOrders|GetOrder)|\bpaymentSimulate|\bpaymentCancel/g) || []
      expect(hits, 'publisher.js 仍导出 payment API：' + hits.join(', ')).toEqual([])
    })

    it('UpgradeModal 不得再出现买断价格文案与支付调用', () => {
      const src = read(path.join('..', '..', 'src', 'components', 'UpgradeModal.vue'))
      // 只允许出现在注释里的历史说明，不允许出现在模板/逻辑里
      const codeOnly = src
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(codeOnly, 'UpgradeModal 仍有 ¥99 买断价格').not.toContain('¥99')
      expect(codeOnly, 'UpgradeModal 仍有「永久」买断文案').not.toContain('永久')
      expect(codeOnly, 'UpgradeModal 仍在调用下单 API').not.toMatch(/paymentCreateOrder|paymentSimulate|paymentCancel/)
    })
  })

  describe('② 本地授权写入路径必须已移除（订阅只由服务端授予）', () => {
    const src = () => read('license-manager.js')

    it('license-manager 不得再有 activate() 写入买断授权', () => {
      expect(
        src(),
        'license-manager 仍有 activate()：它会写 type=pro + expiresAt=null（买断语义），与订阅制的到期结算直接冲突'
      ).not.toMatch(/\n\s{2}activate\s*\(/)
    })

    it('license-manager 不得在授权写入路径写 expiresAt = null（买断落库特征）', () => {
      // 迁移方法内允许 `expiresAt = null`：那是**保持**存量买断授权的语义
      // （已付费永久授权不能在清理中被打折扣），不是"新写入一份买断"。
      const withoutMigration = stripComments(src()).replace(/_migrateLegacyLicenseType\s*\(\s*\)\s*\{[\s\S]*?\n {2}\}/, '')
      expect(
        withoutMigration,
        '授权写入路径仍有 expiresAt = null：买断落库特征必须随 activate() 一并移除'
      ).not.toMatch(/expiresAt\s*=\s*null/)
    })

    it('license-manager 不得再用 lifetime 做授权判定（仅允许加载期迁移读取）', () => {
      const src2 = src()
      // 授权判定函数体内不得出现 lifetime
      const isProBody = src2.match(/isPro\s*\(\)\s*\{[\s\S]*?\n\s{2}\}/)
      expect(isProBody, 'isPro() 未找到').not.toBeNull()
      expect(
        isProBody[0],
        'isPro() 仍用 lifetime 判定授权：该类型不再产生，判定应收敛为 type==="pro"'
      ).not.toContain('lifetime')
      // 但迁移必须存在 —— 否则存量 lifetime 用户会被静默降级
      expect(
        src2,
        '缺少 _migrateLegacyLicenseType()：存量 lifetime 授权会降级为免费'
      ).toContain('_migrateLegacyLicenseType')
    })
  })

  describe('③ 存量数据迁移（清理不得让已付费用户降级）', () => {
    const os = require('os')
    const LicenseManager = require('./license-manager')

    // 为什么不构造真实的加密 license 文件来测「load 后变 pro」：
    // license-manager 的加解密密钥由 `scryptSync(app.getPath('userData'), …)` 派生，
    // 纯 Node 测试环境没有 Electron 的 app，save() 直接抛错、文件写不出来；
    // 而它内部的 encrypt() 没导出，复刻 v2 加密格式（SALT+IV+TAG+ciphertext）
    // 会让测试耦合到实现细节。所以拆成两个更稳的判据：
    //   ① 迁移函数的语义（内存态）      ② load() 确实接入了迁移（源码接线锁）

    it('_migrateLegacyLicenseType 必须把 lifetime 规范化为 pro，且保持永不过期', () => {
      const lm = new LicenseManager(path.join(os.tmpdir(), 'lic-unit-' + process.pid + '.json'))
      lm._data = { type: 'lifetime', licenseKey: 'LEGACY-0001', expiresAt: null, features: ['ai_write'] }
      lm._migrateLegacyLicenseType()
      expect(lm._data.type, '历史 lifetime 必须被迁移为 pro').toBe('pro')
      expect(lm._data.expiresAt, '存量买断授权应保持永不过期，不得在清理中被打折扣').toBeNull()
      expect(lm.getInfo().isPro, '历史 lifetime 用户必须仍然享有 Pro').toBe(true)
    })

    it('迁移必须是幂等的（已是 pro 不受影响）', () => {
      const lm = new LicenseManager(path.join(os.tmpdir(), 'lic-unit2-' + process.pid + '.json'))
      lm._data = { type: 'pro', licenseKey: 'K', expiresAt: null, features: ['ai_write'] }
      lm._migrateLegacyLicenseType()
      expect(lm._data.type).toBe('pro')
    })

    it('load() 的两条成功分支都必须接入迁移（否则存量用户读盘即降级）', () => {
      const src2 = read('license-manager.js')
      // 定义 1 次 + 主文件分支调用 1 次 + .bak 恢复分支调用 1 次 = 至少 3 次
      const hits = (src2.match(/_migrateLegacyLicenseType\(\)/g) || []).length
      expect(
        hits,
        `_migrateLegacyLicenseType 出现 ${hits} 次；load() 主文件与 .bak 两条成功分支都要调用，` +
        '少一条就会让走 .bak 恢复的用户降级'
      ).toBeGreaterThanOrEqual(3)
      // 迁移结果必须落盘（方法体内有 save()）
      const body = src2.match(/_migrateLegacyLicenseType\s*\(\s*\)\s*\{[\s\S]*?\n {2}\}/)
      expect(body, '迁移方法未找到').not.toBeNull()
      expect(body[0], '迁移后必须 save() 落盘，否则每次启动都要重新迁移').toContain('this.save()')
    })
  })

  describe('④ 订阅侧能力必须保持完好（本次不动的边界）', () => {
    it('会员中心兑换码核销链路不受影响（服务端权威）', () => {
      const src = read(path.join('..', '..', 'src', 'views', 'MemberCenter.vue'))
      expect(src, '兑换码入口必须仍在').toContain('member-center-redeem')
      expect(src, '兑换码必须仍走服务端核销').toMatch(/redeem/i)
    })

    it('三档价目展示必须仍在（订阅制的对外呈现）', () => {
      const src = read(path.join('..', '..', 'src', 'views', 'MemberCenter.vue'))
      expect(src).toContain('member-center-plans')
      expect(src).toMatch(/priceMonthlyCents/)
    })
  })
})
