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

/** 判定「手搓的显示名回退」：回退链里真的引用了 `.name`。
 *  `.name` 是主进程写入 `document.title` 的落盘位，那才是会冒充账号名的东西；
 *  `account_name: x.account_name || ''` 这类空串兜底不属于显示名路径，不该被算进来
 *  （第一版就把 `base-store.js` 的一条空串兜底误判成了违规）。 */
function isRawDisplayFallback (line) {
  const m = line.match(/(?:account_name|name|display_name|displayName)\s*:\s*(.+)$/)
  if (!m) return false
  const value = m[1]
  return /\|\|/.test(value) && /account_name/.test(value) && /\.name\b/.test(value)
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
      'apps/desktop/src/features/publish/components/PublishTargetSelector.vue',
      'apps/desktop/src/composables/usePlatformAccounts.js',
      'apps/desktop/src/stores/accounts.js',
      'apps/desktop/src/views/Accounts.vue',
    ]
    for (const rel of consumers) {
      expect(read(rel), rel + ' 必须改用共享解析入口').toContain('utils/account-display-name')
    }
  })

  // 上面那份消费者清单是**白名单**，对「新写一处 raw 回退」完全失明 —— 实测本 PR 自己就漏了
  // 发布页选择器（PublishTargetSelector.vue 只读 account.name，而 account.name 由主进程写成
  // document.title），并且两处 CHANGELOG/tasks 还把它勾成已完成。故补一条全仓扫描：
  // 渲染层不得再出现 `xxx.account_name || xxx.name` 这种手搓显示名回退。
  it('渲染层不得残留手搓的 `account_name || name` 显示名回退（全仓扫描，非白名单）', () => {
    const offenders = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'locales' || entry.name === 'node_modules') continue
          walk(full)
          continue
        }
        if (!/\.(?:vue|js)$/.test(entry.name)) continue
        if (/\.test\.js$/.test(entry.name)) continue
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/')
        const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/)
        lines.forEach((line, i) => {
          const t = line.trim()
          // 注释里合法地讨论这条规则（本 PR 就有两处），只拦活代码
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
          if (/account_name\s*(\?\?)?\s*\|\|/.test(t)) {
            offenders.push(rel + ':' + (i + 1) + '  ' + t)
          }
        })
      }
    }
    walk(path.join(REPO_ROOT, 'apps/desktop/src'))
    expect(offenders, '以下位置绕过唯一入口手搓显示名回退：\n' + offenders.join('\n')).toEqual([])
  })

  // 同一把锁扩到主进程。只拦「把回退链赋给一个承载显示名的字段」这种形态（日志串里出现
  // account_name || id 不是显示名路径，不该被算进来），命中项必须是**显式登记的死通道**，
  // 且逐条给出复核证据 —— 债务写进散文会过期，写进断言才会被下一笔改动撞出来。
  it('主进程承载显示名的字段不得手搓回退（例外只能是已复核的死通道，且清单只减不增）', () => {
    // 只拦「回退链里真的引用了 `.name`」这一种 —— `.name` 是 document.title 的落盘位，
    // 那才是会冒充账号名的东西。`account_name: a.account_name || ''` 这种空串兜底不是显示名路径。
    const isRawDisplayFallback = (line) => {
      const m = line.match(/(?:account_name|name|display_name|displayName)\s*:\s*(.+)$/)
      if (!m) return false
      const value = m[1]
      return /\|\|/.test(value) && /account_name/.test(value) && /\.name\b/.test(value)
    }
    // 登记格式：'相对路径:行号' -> 复核结论。新增条目必须同时给出「零消费者」的实测证据。
    const KNOWN_DEAD_CHANNELS = new Map([
      ['apps/desktop/electron/ipc-handlers/store.js:73',
        'store:list-accounts / store:get-account：grep -rna storeListAccounts|storeGetAccount apps/desktop/src 排除 .test.js 后 0 命中，唯一引用是 Home.test.js:226 断言它不被调用'],
      ['apps/desktop/electron/ipc-handlers/account.js:707',
        'accounts:batch-open-login：grep -rna batchOpenLogin apps/desktop/src 0 命中（preload 暴露了 accountBatchOpenLogin 但渲染层无调用方），故当前不可见；一旦接线必须改走唯一入口'],
    ])
    const offenders = []
    const unsanctioned = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.js$/.test(entry.name) || /\.test\.js$/.test(entry.name)) continue
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/')
        fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, i) => {
          const t = line.trim()
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
          if (!isRawDisplayFallback(t)) return
          const key = rel + ':' + (i + 1)
          if (KNOWN_DEAD_CHANNELS.has(key)) { offenders.push(key); return }
          unsanctioned.push(key + '  ' + t)
        })
      }
    }
    walk(path.join(REPO_ROOT, 'apps/desktop/electron'))
    expect(unsanctioned, '主进程新增了一处手搓显示名回退，必须改走唯一入口或按死通道复核后登记：\n' + unsanctioned.join('\n')).toEqual([])
    // 反向：登记的死通道若已被删除/改好，清单也必须收口，不留僵尸例外
    for (const key of KNOWN_DEAD_CHANNELS.keys()) {
      expect(offenders, '登记的死通道 ' + key + ' 已不再命中，请把它从清单里删掉（债务已还清）').toContain(key)
    }
  })
})
