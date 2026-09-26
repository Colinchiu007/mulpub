// @ts-check
/**
 * account-name-source-passthrough.test.js — `name_source` 必须穿过两道投影白名单
 *
 * 存在理由（openspec change: add-account-name-source，D2）：这个字段从后端到渲染层要连续
 * 穿过两道**手工维护的字段白名单** ——
 *   1) packages/python-backend/src/server.py 的 `_account_to_dict`
 *   2) apps/desktop/electron/ipc-handlers/account.js 的 `publicAccountFields`
 * 漏改任意一道，症状都是「用户改了名，界面没反应」，而两侧各自的单测**都会绿**：
 * 后端测自己返回了、IPC 测自己透传了输入。这正是本仓反复出现的「装饰性链路」形态。
 *
 * 手法沿用本目录既有先例（account-manager-profile.test.js 的「接线守卫」describe）：
 * 直接读源文件断言两处都含该字段。它不是行为测试，而是**防止行为测试的输入被静默滤掉**。
 */
import { describe, expect, it } from 'vitest'
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../../../..')

function read (rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
}

describe('name_source 投影白名单接线守卫', () => {
  it('后端 _account_to_dict 必须输出 name_source（否则前端永远拿不到）', () => {
    const src = read('packages/python-backend/src/server.py')
    const projection = src.slice(src.indexOf('def _account_to_dict'))
    expect(projection.slice(0, 1200), '_account_to_dict 必须包含 name_source 键').toContain('name_source')
  })

  it('IPC publicAccountFields 必须包含 name_source', () => {
    const src = read('apps/desktop/electron/ipc-handlers/account.js')
    const whitelist = src.slice(src.indexOf('const publicAccountFields'), src.indexOf('const publicAccountAliases'))
    expect(whitelist.length, '未定位到 publicAccountFields 区块（改名需同步本守卫）').toBeGreaterThan(0)
    expect(whitelist).toContain("'name_source'")
  })

  it('IPC 层不得恢复 `account_name || name` 提前合并（那会让来源标记失去意义）', () => {
    const src = read('apps/desktop/electron/ipc-handlers/account.js')
    expect(src, 'account_name 必须由展示层按 name_source 解析，不得在 IPC 层用 name 顶替')
      .not.toMatch(/account_name:\s*safeAccount\.account_name\s*\|\|/)
  })

  it('渲染层必须存在唯一的账号名解析入口并被各消费点复用', () => {
    const helper = 'apps/desktop/src/utils/account-display-name.js'
    expect(fs.existsSync(path.join(REPO_ROOT, helper)), '缺少共享解析入口 ' + helper).toBe(true)
    const consumers = [
      'apps/desktop/src/features/accounts/components/AccountManagementCard.vue',
      'apps/desktop/src/features/accounts/components/AccountGroupsPanel.vue',
      'apps/desktop/src/features/accounts/components/AccountGroupManager.vue',
    ]
    for (const rel of consumers) {
      expect(read(rel), rel + ' 必须改用共享解析入口').toContain('utils/account-display-name')
    }
  })
})
