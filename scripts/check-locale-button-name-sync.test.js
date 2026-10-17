// check-locale-button-name-sync.test.js — 引导文案里引用的按钮名必须与 locale 逐字一致
// 动因（2026-10-17，用户会话遗留第 3 条）：PRD §4.3 阶段引导的文案里**手写了按钮名**
// （「获取收藏夹」「加载收藏内容」「采集并改写」）。若将来有人改 loadBtn/loadContents/
// collectAndRewrite 的文案而忘了同步改引导，界面会出现「引导让你点一个不存在的按钮」。
// 该回归此前无任何机械判据覆盖（组件锁只断言包含关键词，像素门禁对折叠组失明）。
// 判据形态：**显式登记表**而非启发式正则 —— 本仓实测教训是启发式一次引入 5 个假阳。
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const ROOT = path.join(__dirname, '..')

// 被测模块路径在 test 里按仓库布局解析（scripts/ 的上一级是仓库根）
const script = path.join(ROOT, 'scripts', 'check-locale-button-name-sync.js')
const { checkButtonNameSync, REGISTRY } = require(script)

function tmpLocale (content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-btn-'))
  const coll = path.join(dir, 'collection')
  fs.mkdirSync(coll)
  for (const f of ['zh.js', 'en.js']) {
    fs.writeFileSync(path.join(coll, f), content, 'utf8')
  }
  return dir
}

test('登记表必须存在且每条登记齐全（防登记表被清空后判据变哑）', () => {
  assert.ok(Array.isArray(REGISTRY) && REGISTRY.length >= 2, '登记表至少要有 stepHint 两条')
  for (const r of REGISTRY) {
    assert.ok(r.localeKey, 'localeKey 必填')
    assert.ok(Array.isArray(r.refKeys) && r.refKeys.length >= 1, 'refKeys 至少 1 个')
    // locales 可选：数组（两边同表）或对象（zh/en 各自的 refKeys），不允许其它形态
    if (r.locales !== undefined) {
      const okShape = Array.isArray(r.locales) ||
        (r.locales && typeof r.locales === 'object' &&
          (!r.locales.zh || Array.isArray(r.locales.zh)) &&
          (!r.locales.en || Array.isArray(r.locales.en)))
      assert.ok(okShape, 'locales 只能是数组或 {zh:[],en:[]} 对象')
    }
  }
})

test('文案与被引用按钮名逐字一致 → PASS', () => {
  const dir = tmpLocale([
    'export default {',
    '  zhihuFav: {',
    '  zhihuFavlist: {',
    "loadBtn: '获取收藏夹',",
    '  },',
    '  zhihuFav: {',
    "    loadContents: '加载收藏内容',",
    "    collectAndRewrite: '采集并改写',",
    "    stepHintNoFavlists: \"下一步：点「获取收藏夹」拉取列表。\",",
    "    stepHintNeedContents: \"下一步：点「加载收藏内容」加载条目并「采集并改写」。\",",
    '  },',
    '}',
  ].join('\n'))
  const res = checkButtonNameSync({ localesDir: dir })
  assert.equal(res.ok, true, JSON.stringify(res.findings))
})

test('按钮文案改了、引导没跟 → FAIL 且点名两侧现值', () => {
  const dir = tmpLocale([
    'export default {',
    '  zhihuFav: {',
    '  zhihuFavlist: {',
    "loadBtn: '拉取收藏夹',",
    '  },',
    '  zhihuFav: {',
    "    loadContents: '加载收藏内容',",
    "    collectAndRewrite: '采集并改写',",
    "    stepHintNoFavlists: \"下一步：点「获取收藏夹」拉取列表。\",", // 引导还是旧名
    "    stepHintNeedContents: \"下一步：点「加载收藏内容」加载条目并「采集并改写」。\",",
    '  },',
    '}',
  ].join('\n'))
  const res = checkButtonNameSync({ localesDir: dir })
  assert.equal(res.ok, false)
  const f = res.findings.find((x) => x.localeKey === 'zhihuFav.stepHintNoFavlists')
  assert.ok(f, '应点名 zhihuFav.stepHintNoFavlists（findings 用完整 key）')
  assert.ok(f.detail.includes('拉取收藏夹') && f.detail.includes('获取收藏夹'), '应同时给出期望值与现值')
})

test('引导里出现未被登记引用的旧按钮名不算红（只管登记过的引用，防启发式假阳）', () => {
  const dir = tmpLocale([
    'export default {',
    '  zhihuFav: {',
    '  zhihuFavlist: {',
    "loadBtn: '获取收藏夹',",
    '  },',
    '  zhihuFav: {',
    "    loadContents: '加载收藏内容',",
    "    collectAndRewrite: '采集并改写',",
    '    // 这条文案提到别的按钮名（未登记），不该被本判据拦',
    "    stepHintNoFavlists: \"下一步：点「获取收藏夹」，同时记得先加载内容。\",",
    "    stepHintNeedContents: \"下一步：点「加载收藏内容」，随后可「采集并改写」。\",",
    '  },',
    '}',
  ].join('\n'))
  const res = checkButtonNameSync({ localesDir: dir })
  assert.equal(res.ok, true)
})

test('登记的 localeKey 在 locale 里缺失 → FAIL（key 被删而登记没跟）', () => {
  const dir = tmpLocale([
    'export default {',
    '  zhihuFav: {',
    '  zhihuFavlist: {',
    "loadBtn: '获取收藏夹',",
    '  },',
    '  zhihuFav: {',
    "    loadContents: '加载收藏内容',",
    '  },',
    '}',
  ].join('\n'))
  const res = checkButtonNameSync({ localesDir: dir })
  assert.equal(res.ok, false)
  assert.ok(res.findings.some((x) => x.kind === 'missing-key'))
})

test('zh 与 en 都要过（任一语言不一致即红）', () => {
  const zhOk = [
    'export default {',
    '  zhihuFav: {',
    '  zhihuFavlist: {',
    "loadBtn: '获取收藏夹',",
    '  },',
    '  zhihuFav: {',
    "    loadContents: '加载收藏内容',",
    "    collectAndRewrite: '采集并改写',",
    "    stepHintNoFavlists: \"下一步：点「获取收藏夹」拉取列表。\",",
    "    stepHintNeedContents: \"下一步：点「加载收藏内容」。\",",
    '  },',
    '}',
  ].join('\n')
  const enBad = [
    'export default {',
    '  zhihuFav: {',
    '  zhihuFavlist: {',
    "loadBtn: 'Load Favorites',",
    '  },',
    '  zhihuFav: {',
    "    loadContents: 'Load items',",
    '    stepHintNoFavlists: \'Next: click "Fetch Favorites" first.\',', // 引导与按钮名不一致
    '    stepHintNeedContents: \'Next: click "Load items".\',',
    '  },',
    '}',
  ].join('\n')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-btn-'))
  const coll = path.join(dir, 'collection')
  fs.mkdirSync(coll)
  fs.writeFileSync(path.join(coll, 'zh.js'), zhOk, 'utf8')
  fs.writeFileSync(path.join(coll, 'en.js'), enBad, 'utf8')
  const res = checkButtonNameSync({ localesDir: dir })
  assert.equal(res.ok, false)
  assert.ok(res.findings.some((x) => x.locale === 'en'), '应点名 en')
})
