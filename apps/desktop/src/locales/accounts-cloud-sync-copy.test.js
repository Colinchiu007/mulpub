// @ts-check
/**
 * 「同步云端」汇总/进度文案的精确结构断言（AGENTS.md QM-3 文本结构断言 MUST）。
 *
 * 为什么单独立一个文件而不是只靠组件测试：汇总文案是拼接（含条件段），组件测试里
 * 只用 toContain 级别的存在性断言对「段落丢失 / 段序错乱 / 悬空分隔符」完全免疫。
 * 本文件对 zh / en 各自断言整句字面量，并覆盖条件段「有 / 无」两种形态。
 *
 * 同时锁 zh/en 成对：新增前缀下的键集合必须完全一致（CI Gate 7 只按「文件是否成对变更」
 * 拦截，逐键对齐由本文件负责）。
 */
import { describe, expect, it } from 'vitest'
import zh from './zh.js'
import en from './en.js'

function render (fn, params) {
  const named = (k) => params[k]
  return fn({ named })
}

/**
 * 叶子两种既有写法都要支持：message function（(ctx) => …）与普通字符串（含 {name} 占位符）。
 * 字符串替换口径与 src/i18n/index.js、utils/notifyCore.js 一致（缺参回退空串）。
 */
function copy (leaf, params = {}) {
  if (typeof leaf === 'function') return render(leaf, params)
  return String(leaf).replace(/\{([^{}]+)\}/g, (_token, name) => (params[name] == null ? '' : String(params[name])))
}

const CLOUD_PREFIXES = ['cloudSync', 'cloudDigest', 'cloudOutcome', 'cloudDisconnect']

function cloudKeysOf (locale) {
  const keys = Object.keys(locale.accountsPage).filter(key => CLOUD_PREFIXES.some(prefix => key.startsWith(prefix)))
  const nested = locale.accountsPage.cloudSyncErr
  const errKeys = nested ? Object.keys(nested).map(key => `cloudSyncErr.${key}`) : []
  return [...keys, ...errKeys].sort()
}

describe('accountsPage.cloudSyncDone 文案结构', () => {
  it('中文：三段齐全时为「同步完成：新增 n，更新 n，恢复 n」（与 PRD §10.4 字面一致）', () => {
    expect(copy(zh.accountsPage.cloudSyncDone, { created: 3, updated: 1, restored: 2 }))
      .toBe('同步完成：新增 3，更新 1，恢复 2')
  })

  it('中文：条件段为 0 时整段不出现，且不留悬空冒号', () => {
    expect(copy(zh.accountsPage.cloudSyncDone, { created: 3, updated: 0, restored: 0 }))
      .toBe('同步完成：新增 3')
    const none = copy(zh.accountsPage.cloudSyncDone, { created: 0, updated: 0, restored: 0 })
    expect(none).toBe('同步完成')
    expect(none).not.toContain('：')
  })

  it('英文：与中文同段序同结构', () => {
    expect(copy(en.accountsPage.cloudSyncDone, { created: 3, updated: 1, restored: 2 }))
      .toBe('Sync complete: added 3, updated 1, restored 2')
    expect(copy(en.accountsPage.cloudSyncDone, { created: 0, updated: 2, restored: 0 }))
      .toBe('Sync complete: updated 2')
    expect(copy(en.accountsPage.cloudSyncDone, { created: 0, updated: 0, restored: 0 }))
      .toBe('Sync complete')
  })
})

describe('accountsPage.cloudSyncPartial / cloudSyncAllFailed / cloudSyncProgress 文案结构', () => {
  it('部分成功必须同时给出成功数与失败数（两种语言各一条整句）', () => {
    expect(copy(zh.accountsPage.cloudSyncPartial, { ok: 5, fail: 2 })).toBe('同步部分完成：5 个成功，2 个失败')
    expect(copy(en.accountsPage.cloudSyncPartial, { ok: 5, fail: 2 })).toBe('Sync partially complete: 5 succeeded, 2 failed')
  })

  it('全失败单独成句，不得复用「部分完成」文案', () => {
    expect(copy(zh.accountsPage.cloudSyncAllFailed, { fail: 4 })).toBe('同步失败：4 个账号未上传')
    expect(copy(zh.accountsPage.cloudSyncAllFailed, { fail: 4 })).not.toBe(copy(zh.accountsPage.cloudSyncPartial, { ok: 0, fail: 4 }))
    expect(copy(en.accountsPage.cloudSyncAllFailed, { fail: 4 })).toBe('Sync failed: 4 accounts were not uploaded')
  })

  it('进度行是 done/total 两段斜杠结构，缺参时不得出现字面占位符', () => {
    expect(copy(zh.accountsPage.cloudSyncProgress, { done: 3, total: 8 })).toBe('同步中 3/8')
    expect(copy(en.accountsPage.cloudSyncProgress, { done: 3, total: 8 })).toBe('Syncing 3/8')
    expect(copy(zh.accountsPage.cloudSyncProgress, {})).not.toContain('{')
  })

  it('用户主动中止单独成句：只说明「剩余未同步」，不得复用「全失败」句（两种语言各一条整句）', () => {
    expect(copy(zh.accountsPage.cloudSyncStopped)).toBe('已停止：剩余账号未同步')
    expect(copy(en.accountsPage.cloudSyncStopped)).toBe('Stopped: remaining accounts were not synced')
    // 「已停止」是用户主动停的，语义 ≠ 服务端把全部账号判为失败；两者混用会误导排障方向
    expect(copy(zh.accountsPage.cloudSyncStopped)).not.toBe(copy(zh.accountsPage.cloudSyncAllFailed, { fail: 4 }))
    expect(copy(en.accountsPage.cloudSyncStopped)).not.toBe(copy(en.accountsPage.cloudSyncAllFailed, { fail: 4 }))
  })

  it('按钮三态文案齐备且互不相同（停止 / 正在停止 / 已停止），缺参时不得出现字面占位符', () => {
    const keys = ['cloudSyncStop', 'cloudSyncStopping', 'cloudSyncStopped']
    for (const locale of [zh, en]) {
      const texts = keys.map(key => copy(locale.accountsPage[key]))
      expect(new Set(texts).size).toBe(3)
      for (const text of texts) {
        expect(typeof text).toBe('string')
        expect(text.length).toBeGreaterThan(0)
        expect(text).not.toContain('{')
      }
    }
  })

  it('逐条结果标签与断开文案在 zh/en 下键集合完全成对', () => {
    const zhKeys = cloudKeysOf(zh)
    const enKeys = cloudKeysOf(en)
    expect(zhKeys.length).toBeGreaterThan(30)
    expect(enKeys).toEqual(zhKeys)
  })

  it('错误码文案表成对，且未登记的码不会被误当成已有键', () => {
    const errKeys = Object.keys(zh.accountsPage.cloudSyncErr).sort()
    expect(errKeys).toEqual(Object.keys(en.accountsPage.cloudSyncErr).sort())
    expect(errKeys).toContain('unauthorized')
    expect(zh.accountsPage.cloudSyncErr).not.toHaveProperty('uidInvalid')
  })
})

/**
 * 错误码「语义分组」文案（PRD §7.5 码表收口）。
 *
 * 为什么不逐码建键：服务端可回 20+ 个码（真源是 packages/api-publish-engine/src/cloud-accounts
 * 的 validate-account.js / handlers.js / envelope-crypto.js / cloud-account-repository.js，
 * 外加主进程自补的 ACCOUNT_REJECTED 等），其中绝大多数对用户是同一句话。逐码建键会造出一批
 * 几乎没人看的死键（AGENTS.md 禁止死键），故按「用户能做什么」分组，未登记码走 cloudFailed 兜底。
 *
 * 本文件负责三件事：整句精确断言（QM-3 文本结构断言 MUST）、键集合两语成对、防撞句
 * ——分组文案彼此不得重复，也不得与既有码位文案、断开按钮的 cloudDisconnectFailed 撞句。
 */
describe('accountsPage.cloudSyncErr.* 分组文案', () => {
  const NEW_GROUP_KEYS = ['invalidData', 'invalidCredential', 'tooMany', 'disconnectPartial', 'cloudFailed']
  const EXISTING_KEYS = ['unauthorized', 'serviceUnavailable', 'kmsUnavailable', 'credentialTooLarge', 'budgetExceeded', 'inProgress']

  it('中文整句：五个分组各一条，与 PRD §7.5 落笔字面一致', () => {
    expect(zh.accountsPage.cloudSyncErr.invalidData).toBe('账号信息格式不正确，未上传')
    expect(zh.accountsPage.cloudSyncErr.invalidCredential).toBe('登录数据格式不正确，未上传')
    expect(zh.accountsPage.cloudSyncErr.tooMany).toBe('本次提交账号过多，未上传')
    expect(zh.accountsPage.cloudSyncErr.disconnectPartial).toBe('云端未完全清除，请重试')
    expect(zh.accountsPage.cloudSyncErr.cloudFailed).toBe('云端未接受该账号，请稍后重试')
  })

  it('英文整句：与中文同组同位，逐条精确断言', () => {
    expect(en.accountsPage.cloudSyncErr.invalidData).toBe('The account details are malformed and were not uploaded')
    expect(en.accountsPage.cloudSyncErr.invalidCredential).toBe('The sign-in data is malformed and was not uploaded')
    expect(en.accountsPage.cloudSyncErr.tooMany).toBe('Too many accounts in this batch, nothing was uploaded')
    expect(en.accountsPage.cloudSyncErr.disconnectPartial).toBe('The cloud was not fully cleared, please retry')
    expect(en.accountsPage.cloudSyncErr.cloudFailed).toBe('The cloud did not accept this account, please try again later')
  })

  it('五个新键在 zh/en 下都成对存在（CI Gate 7 只查文件是否成对变更，逐键对齐由本条负责）', () => {
    for (const key of NEW_GROUP_KEYS) {
      expect(typeof zh.accountsPage.cloudSyncErr[key]).toBe('string')
      expect(typeof en.accountsPage.cloudSyncErr[key]).toBe('string')
    }
    expect(Object.keys(zh.accountsPage.cloudSyncErr).sort())
      .toEqual([...NEW_GROUP_KEYS, ...EXISTING_KEYS].sort())
  })

  it('分组文案两两不相同，且与既有六个码位文案也不相同（防撞句）', () => {
    for (const locale of [zh, en]) {
      const table = locale.accountsPage.cloudSyncErr
      const all = [...NEW_GROUP_KEYS, ...EXISTING_KEYS].map(key => table[key])
      // 每条都必须是非空整句：空串就是界面上那片空白
      for (const text of all) expect(text.trim().length).toBeGreaterThan(0)
      expect(new Set(all).size).toBe(all.length)
    }
  })

  it('过程区的 disconnectPartial 与断开按钮的 cloudDisconnectFailed 不得撞句（各司其职）', () => {
    for (const locale of [zh, en]) {
      const partial = locale.accountsPage.cloudSyncErr.disconnectPartial
      const button = locale.accountsPage.cloudDisconnectFailed
      expect(partial).not.toBe(button)
      // 按钮句自带已删/剩余计数，过程区句子不得掺进计数占位符（过程区没有这两个数）
      expect(button).toContain('{deleted}')
      expect(button).toContain('{remaining}')
      expect(partial).not.toContain('{')
    }
  })
})
