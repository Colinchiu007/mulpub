const assert = require('assert')
const fs = require('fs')
const path = require('path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../../..')
// 12 条 axios 公告（GHSA-3pq3/542g/9fr6/c29m/mghh/vh66/x97p 等）的修复版本下限（2026-10-01 实测）
const AXIOS_FLOOR = '1.20.0'
// npm 独立锁域：ops-center/frontend 不在 pnpm workspace（pnpm-workspace.yaml 的 packages 只有 apps/* 与 packages/*），
// 它用自己的 package-lock.json，所以它的"真实解析版本"只能从那把锁里读，不能 require.resolve。
const NPM_LOCKED_CONSUMERS = ['ops-center/frontend']
// 扫描退化时必须立刻变红的已知消费方清单（只能扩大，不能缩小）
const MUST_BE_COVERED = ['apps/desktop', 'packages/ai-writer', 'packages/api-publish-engine', 'ops-center/frontend']

function parseVersion(value) {
  const match = /^(?:\^|~)?(\d+)\.(\d+)\.(\d+)$/.exec(String(value).trim())
  assert(match, `无法解析稳定版本：${value}`)
  return match.slice(1).map(Number)
}

function isAtLeast(actual, minimum) {
  const current = parseVersion(actual)
  const expected = parseVersion(minimum)
  for (let index = 0; index < expected.length; index += 1) {
    if (current[index] > expected[index]) return true
    if (current[index] < expected[index]) return false
  }
  return true
}

// 「有上界的写法」清单是单一真源：判据与失败文案都不得各自再写一份。
// 动因（QM-6 外部评审实测，2026-10-05）：失败文案让人「改成带 ^/~ 的写法」，而两处判据硬编码成
// /^\^?\d/ —— 照文案写 ~ 会被自家门禁判红，指引与判据互斥。^ 与 ~ 都是有上界（不跨 major / 不跨 minor），
// 精确版本同样有上界；裸 >= / > 没有。三档各由下面 hasUpperBound 的一条支路守。
const BOUNDED_PREFIXES = ['^', '~']
function hasUpperBound(range) {
  const s = String(range).trim()
  return /^(?:\^|~)?\d+\.\d+\.\d+$/.test(s) || /^(?:\^|~)x$/.test(s) || /^(?:\^|~)\*\*$/.test(s)
}
function boundedHint() {
  return `改成 ${BOUNDED_PREFIXES.join(' / ')} 开头的写法或精确版本`
}
function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'))
}

function listWorkspaceAxiosConsumers() {
  const consumers = []
  for (const group of ['apps', 'packages']) {
    const base = path.join(ROOT, group)
    assert(fs.existsSync(base), `扫描域不完整：缺少 ${group}/ 目录`)
    for (const name of fs.readdirSync(base)) {
      const manifest = path.join(base, name, 'package.json')
      if (!fs.existsSync(manifest)) continue
      const pkg = readJson(manifest)
      if (pkg.dependencies && pkg.dependencies.axios) consumers.push(`${group}/${name}`)
    }
  }
  return consumers
}

test('生产依赖不允许解析到存在高危公告的 Axios 版本', () => {
  const apiPackage = readJson(path.resolve(__dirname, '..', 'package.json'))
  // pnpm-lock.yaml 为唯一锁文件（2026-08-13 由 package-lock.json 迁移）
  const lockfile = fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const axiosMatches = [...lockfile.matchAll(/axios@(\d+\.\d+\.\d+)/g)].map((m) => m[1])

  assert(isAtLeast(apiPackage.dependencies.axios, AXIOS_FLOOR))
  assert(axiosMatches.length > 0, 'pnpm-lock.yaml 未找到 axios 条目')
  // 断言锁文件中所有 axios 版本均 >= 地板，避免首个字典序匹配掩盖低危版本。
  // 整表地板抬得到 1.20.0 的前提是 pnpm-workspace.yaml 的 axios override：只升 workspace 包的区间抬不动
  // 这条断言，因为 dev 域 nx@20.8.4 自带一份 axios（实测 1.18.1），而门禁扫描面 `pnpm audit --prod` 看不见它。
  for (const version of axiosMatches) {
    assert(isAtLeast(version, AXIOS_FLOOR), `pnpm-lock.yaml 存在低危 axios 版本 ${version}`)
  }
  // override 必须还在，否则下一个人删掉它时这条锁会静默退回"只看 prod"。
  const workspace = fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const overrideMatch = /^\s+axios:\s*'([^']+)'\s*$/m.exec(workspace)
  assert(
    overrideMatch,
    'pnpm-workspace.yaml 缺 axios override：门禁只扫 --prod，dev 域副本（nx）会重新漂回低危版本',
  )
  const overrideRange = overrideMatch[1]
  // 无上界的写法（>=x.y.z）会允许下一次非 --frozen-lockfile 的 install 把 axios 静默 resolve 到新大版本。
  assert(
    hasUpperBound(overrideRange),
    `axios override 区间 "${overrideRange}" 没有上界：${boundedHint()}（整表判据见本文件末尾的「每条 pnpm override 都必须有上界」）`,
  )
  assert(isAtLeast(overrideRange, AXIOS_FLOOR), `axios override "${overrideRange}" 低于修复版本 ${AXIOS_FLOOR}`)
})

// 消费方清单由扫描得出，不写死：新增一个直接依赖 axios 的 workspace 包会自动进入判据，
// 而 MUST_BE_COVERED 保证"扫描退化成空集"是红的而不是绿的。
test('每一个 axios 直接消费方的声明区间与实际解析版本都必须 >= 修复版本', () => {
  const workspaceConsumers = listWorkspaceAxiosConsumers()
  assert(
    workspaceConsumers.length >= 3,
    `扫描到的 axios 直接消费方只有 ${workspaceConsumers.length} 个，扫描域疑似失效`,
  )
  const all = [...workspaceConsumers, ...NPM_LOCKED_CONSUMERS]
  for (const rel of MUST_BE_COVERED) {
    assert(all.includes(rel), `消费方清单漏掉了 ${rel}（判据覆盖面缩小）`)
  }

  for (const rel of workspaceConsumers) {
    const pkg = readJson(path.join(ROOT, rel, 'package.json'))
    assert(
      isAtLeast(pkg.dependencies.axios, AXIOS_FLOOR),
      `${rel} 声明的 axios ${pkg.dependencies.axios} 低于修复版本 ${AXIOS_FLOOR}`,
    )
    // 真解析而非只读文本：从消费方目录解析它实际会 require 到的 axios，防"声明升了但被别处旧版覆盖"。
    // 注意 node-linker=hoisted 下这几个包解析到同一份根 node_modules/axios，这条锁的是"覆盖"不是"每包一份"。
    const resolvedPath = require.resolve('axios/package.json', { paths: [path.join(ROOT, rel)] })
    const resolved = readJson(resolvedPath).version
    assert(
      isAtLeast(resolved, AXIOS_FLOOR),
      `${rel} 实际解析到的 axios 是 ${resolved}，低于 ${AXIOS_FLOOR}（${resolvedPath}）`,
    )
  }

  for (const rel of NPM_LOCKED_CONSUMERS) {
    const pkg = readJson(path.join(ROOT, rel, 'package.json'))
    assert(
      isAtLeast(pkg.dependencies.axios, AXIOS_FLOOR),
      `${rel} 声明的 axios ${pkg.dependencies.axios} 低于修复版本 ${AXIOS_FLOOR}`,
    )
    const lock = readJson(path.join(ROOT, rel, 'package-lock.json'))
    const entry = lock.packages && lock.packages['node_modules/axios']
    assert(entry, `${rel} 的 package-lock.json 缺少 node_modules/axios 条目（npm 布局变更，需同步本判据）`)
    assert(
      isAtLeast(entry.version, AXIOS_FLOOR),
      `${rel} 锁里的 axios 是 ${entry.version}，低于 ${AXIOS_FLOOR}（npm 域不受 pnpm override 约束）`,
    )
  }
})
// ── 「每条 override 都必须有上界」整表棘轮（2026-10-05）──
// 动因：本文件早就对 axios 单独判过这件事，但判据只覆盖 axios 那一条。pnpm-workspace.yaml 里
// undici / fast-uri 两条一直写成 `>=`，注释里明写着"属同族隐患，但改它们要重新 resolve 那两个包，
// 本 PR 不夹带" —— 于是这个隐患挂了整整 6 天（2026-09-29 的 #2613 建立，到本 PR 才收），期间
// **没有任何东西在看它**。逐条点名式断言只能守住"写它的那个人当时想到的那一条"，所以这里改成
// 按整张覆写表判：新增一条无上界覆写当场红，不需要有人记得来补注释或记得来抄断言。
// electron 的地板取 4 条公告里最高的修复下界（GHSA-9qh4-3jw8-366w / GHSA-gr2m-v5gq-v685 /
// GHSA-j84w-jfhq-vhvj 是 >=43.4.1，GHSA-qmv3-fv6v-rmhq 是 >=43.5.0 ⇒ 地板 43.5.0）。
// 它与其他三条形态不同：undici / fast-uri / axios 是**传递依赖**，electron 是 workspace 根与
// apps/desktop 的 devDependency，同时又是 rpa-engine / shared-utils 的 optional peer —— 后两条的
// 区间（>=33.0.0 / >=20.0.0）本来就包含修复版，pnpm 会沿用旧解，只有 override 能同时按住这四条路径。
// undici / fast-uri 的地板在 2026-10-24 抬过一次：GitHub Advisory Database 当日新增
// undici 3 条（GHSA-xjj6-f33q-929c high / GHSA-4qv8-2p9j-2685 / GHSA-f72v-6w45-q472，修复下界 >=7.30.1）
// 与 fast-uri 4 条（GHSA-w74x-v6f9-j3xg / GHSA-wjr9-j795-jxcr / GHSA-333x-w4r6-6crp / GHSA-xhq7-xmqj-769h，
// 修复下界 >=3.1.9），使依赖漏洞审计门禁在 main 上以 7 条 NEW_ADVISORY 连红。
// 地板必须跟着公告的修复下界走：地板停在 7.29.1 / 3.1.7 时，锁里解析到 7.30.0 / 3.1.8
// （都在地板之上、都在修复下界之下）⇒ 这条棘轮判绿、审计门禁判红，两条判据各说各话。
// brace-expansion 的两条是 **parent>child 限定式**（2026-10-24 引入）：6 条 high 公告
// （GHSA-3jxr-9vmj-r5cp / GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895 / GHSA-q2hr-2g5m-vwhr /
// GHSA-qhr7-859c-m2p7 / GHSA-6j4f-fj2g-mc7p）的修复下界分两条线：1.x 线 >=1.1.21、4.x/5.x 线 >=5.0.12；
// 2.x/3.x 无公告。两个槽位的消费方要求的**导出形状不同**（minimatch@3 把 require 结果当函数调、
// minimatch@10 用 .expand）⇒ 必须各钉在自己 major 内，不能平铺。
const OVERRIDE_FLOORS = {
  undici: '7.30.1',
  'fast-uri': '3.1.9',
  axios: AXIOS_FLOOR,
  electron: '43.5.0',
  'minimatch@3>brace-expansion': '1.1.21',
  'minimatch@10>brace-expansion': '5.0.12',
}

function readOverridesBlock(text, label) {
  const lines = text.split(/\r?\n/)
  const starts = lines.reduce((acc, l, i) => (/^overrides:\s*$/.test(l) ? acc.concat(i) : acc), [])
  assert(starts.length === 1, `${label} 的 overrides: 段应当恰好一个，实际 ${starts.length} 个（重复键会让 YAML 解析器只认一个）`)
  const out = {}
  for (let i = starts[0] + 1; i < lines.length; i += 1) {
    const l = lines[i]
    // 段里允许出现顶格注释（本仓 pnpm-workspace.yaml 就是：axios 那条 override 前面有 8 行顶格说明）。
    // 拿 /^[^\s]/ 直接 break 会在第一条注释处停下 —— 这个 bug 由本测试自己抓到过（读到 2 条而不是 3 条）。
    if (/^#/.test(l) || /^\s*#/.test(l) || l.trim() === '') continue
    if (/^[^\s]/.test(l)) break
    // 键有两种形态：**平铺**（`undici: '^7.30.1'`）与 **parent>child 限定式**
    // （`'minimatch@3>brace-expansion': '^1.1.21'`）。后者是 pnpm 的官方覆写语法，
    // 用于「同一个包在不同父级下必须落在不同 major」的情形（2026-10-24 引入 brace-expansion 时用到：
    // minimatch@3 要 CJS 的函数导出、minimatch@10 要 5.x 的具名导出 ⇒ 平铺会打断其中一方）。
    // ⇒ 键的字符类必须收下 `@` 与 `>`，否则这两行会被判「解析不了」而把整条用例打红。
    const m = /^\s{2}'?([\w./@>-]+)'?:\s*(.+?)\s*$/.exec(l)
    assert(m, `${label} overrides 段第 ${i + 1} 行解析不了：${JSON.stringify(l)} —— 解析不了即拦，禁止静默跳过`)
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return out
}

test('每条 pnpm override 都必须有上界（裸 >= 下限一律判红）', () => {
  const workspace = fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const overrides = readOverridesBlock(workspace, 'pnpm-workspace.yaml')
  const names = Object.keys(overrides)
  assert(names.length >= 3, `覆写表只读到 ${names.length} 条（${names.join(',')}）—— 规模下界不成立说明解析退化，不得当成"没问题"`)
  for (const [name, range] of Object.entries(overrides)) {
    assert(
      hasUpperBound(range),
      `override ${name}: "${range}" 没有上界。override 是整体替换依赖区间，写 >=x.y.z 就等于允许下一次非 --frozen-lockfile 的 install 把它静默抬到新 major（实测 registry：undici dist-tags.latest=8.11.2、fast-uri latest=4.2.1，而锁里是 7.30.1 / 3.1.9）。${boundedHint()}。`,
    )
  }
  for (const [name, floor] of Object.entries(OVERRIDE_FLOORS)) {
    assert(Object.prototype.hasOwnProperty.call(overrides, name), `override ${name} 不见了：它守的是已登记公告的修复下限`)
    assert(isAtLeast(overrides[name], floor), `override ${name}="${overrides[name]}" 低于修复版本 ${floor}`)
  }
})

test('lock 的 overrides 段必须与 workspace 逐条一致（手工按行重放后由这条自证）', () => {
  const workspace = readOverridesBlock(fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8'), 'pnpm-workspace.yaml')
  const lock = readOverridesBlock(fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8'), 'pnpm-lock.yaml')
  assert.deepStrictEqual(lock, workspace, 'pnpm-lock.yaml 的 overrides 与 pnpm-workspace.yaml 漂移：CI 的 pnpm install --frozen-lockfile 会直接拒绝，本地先在这里拦')
})

test('收上界不得改变解析结果：锁里 undici / fast-uri 仍落在同一 major 且不低于修复版', () => {
  const lock = fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const expectMajor = { undici: '7', 'fast-uri': '3' }
  for (const [name, major] of Object.entries(expectMajor)) {
    const versions = [...lock.matchAll(new RegExp(`^\\s{2}${name}@(\\d+\\.\\d+\\.\\d+):`, 'gm'))].map((m) => m[1])
    assert(versions.length > 0, `pnpm-lock.yaml 里找不到 ${name} 的解析条目（锁形态变更需同步本判据）`)
    for (const v of versions) {
      assert(isAtLeast(v, OVERRIDE_FLOORS[name]), `锁里 ${name}@${v} 低于修复下限 ${OVERRIDE_FLOORS[name]}`)
      assert(String(v).startsWith(`${major}.`), `锁里 ${name}@${v} 跨出了 major ${major} —— 本次改动只收上界、不抬 major，出现跨 major 说明有人在同一次改动里夹带了升级`)
    }
  }
})
test('brace-expansion 的两个槽位必须各自落在自己 major 的修复版上（parent>child 覆写必须真的生效）', () => {
  // 动因（2026-10-24）：6 条 high 公告覆盖 brace-expansion 的两条修复线
  // （1.x 线 >=1.1.21、4.x/5.x 线 >=5.0.12），而**两个槽位的消费方要求的导出形状不同**
  // （minimatch@3 把 require 结果当函数调、minimatch@10 用具名 .expand）⇒ 只能各钉在自己 major 内。
  // 这条用例守的是「覆写真的生效」：override 写对了但锁里没落到修复版（pnpm 复用旧解、或键写错被忽略），
  // 公告照旧命中 ⇒ 主干红。
  const lock = fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const versions = [...lock.matchAll(/^\s{2}brace-expansion@(\d+\.\d+\.\d+):/gm)].map((m) => m[1])
  assert(versions.length > 0, 'pnpm-lock.yaml 里找不到 brace-expansion 的解析条目（锁形态变更需同步本判据）')
  const majors = new Set(versions.map((v) => v.split('.')[0]))
  // 两个槽位都必须还在：少一个 ⇒ 某个消费方换了 major ⇒ 那条线的公告会重新命中
  assert(majors.has('1'), `锁里没有 brace-expansion 的 1.x 槽位（实际解析 ${versions.join(', ')}）—— 1.x 线公告的修复下界是 >=1.1.21`)
  assert(majors.has('5'), `锁里没有 brace-expansion 的 5.x 槽位（实际解析 ${versions.join(', ')}）—— 4.x/5.x 线公告的修复下界是 >=5.0.12`)
  for (const v of versions) {
    const major = v.split('.')[0]
    if (major === '1') {
      assert(isAtLeast(v, '1.1.21'), `锁里 brace-expansion@${v} 低于 1.x 线修复下界 1.1.21`)
    } else if (major === '4' || major === '5') {
      assert(isAtLeast(v, '5.0.12'), `锁里 brace-expansion@${v} 低于 4.x/5.x 线修复下界 5.0.12`)
    } else {
      // 2.x / 3.x 不在任何一条公告的易感区间里（实测易感区间只有 `<1.1.x` 与 `>=4.0.0 <5.0.x`）
      assert(major === '2' || major === '3', `锁里 brace-expansion@${v} 落在未登记的 major ${major}：1.x 与 4.x/5.x 两条线都有公告，2.x/3.x 没有 —— 出现别的 major 说明有人夹带了升级`)
    }
  }
})
test('失败文案建议的写法必须被判据接受（防「文案让你写 ~、判据把 ~ 判红」互斥）', () => {
  for (const p of BOUNDED_PREFIXES) {
    assert(hasUpperBound(p + '1.2.3'), `判据不得只认 ^ —— 文案列出的 ${p} 开头的合法写法必须被接受`)
  }
  assert(hasUpperBound('1.2.3'), '精确版本同样有上界')
  assert(!hasUpperBound('>=1.2.3'), '裸 >= 下限必须判红')
  assert(!hasUpperBound('>1.2.3'), '裸 > 下限必须判红')
  // 文案里出现的每个写法前缀，都必须 ∈ BOUNDED_PREFIXES（由真源生成即成立；这条防有人改回硬编码）
  const hint = boundedHint()
  for (const tok of hint.split(' ')) {
    if (tok === '^' || tok === '~') {
      assert(BOUNDED_PREFIXES.includes(tok) && hasUpperBound(tok + '7.29.1'), `文案列出的 ${tok} 必须被判据接受`)
    }
  }
  assert(hint.includes('^') && hint.includes('~'), '文案必须同时列出 ^ 与 ~，否则读日志的人不知道 ~ 也可')
})

test('结构锁：判据与文案不得再各自硬编码（两处调用点必须都走真源）', () => {
  const full = fs.readFileSync(__filename, 'utf8')
  // 扫描域必须截到本锁之前：needle 写在断言行里，扫全文会命中自己（自指假红，实测踩过）。
  // 锚点缺失即红 —— 不许让 indexOf 返回 -1 时 slice 把区间静默放大成整份文件。
  const lockStart = full.indexOf("test('失败文案建议的写法")
  assert(lockStart > 0, '找不到行为锁的起始锚点：本锁的扫描域无法确定，拒绝在不确定域上判绿')
  const src = full.slice(0, lockStart)
  assert(src.includes('hasUpperBound(overrideRange)'), 'axios 单条判据必须走真源')
  assert(src.includes('hasUpperBound(range)'), '整表棘轮判据必须走真源')
  // needle 用拼接构造，使被禁字面量不出现在「包含该断言的那一行」里
  // 只扫代码行：上面的动因注释里原样抄过旧写法（那是给读者的现场证据），扫全文会让注释把锁撞红。
  const code = src.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const forbiddenRegex = ['/', '^', '\\', '^', '?', '\\', 'd', '/'].join('')
  assert(!code.includes(forbiddenRegex), '不得再出现硬编码前缀正则 —— 它就是两条互斥语句的源头')
  const forbiddenHint = '没有上界：改成带 ' + ['^', '/', '~'].join('')
  assert(!code.includes(forbiddenHint), '失败文案不得再硬写「^/~」，必须由 boundedHint() 生成')
  const hints = (src.match(/boundedHint\(\)/g) || []).length
  assert(hints >= 2, `两处失败文案都必须引用 boundedHint()，实到 ${hints}`)
})
